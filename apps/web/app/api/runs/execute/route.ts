import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../../lib/server";
import {
  envModelProvider,
  resolveExecution,
  streamPlainChat,
  type ExecuteBody
} from "../../../../lib/execution-service";
import { streamRun } from "@spielos/graph";

function frame(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function runEvent(orgId: string, runId: string, type: "run_completed" | "run_failed", message: string, payload?: Record<string, unknown>) {
  return {
    id: `evt_${crypto.randomUUID()}`,
    orgId,
    runId,
    type,
    message,
    payload,
    createdAt: new Date().toISOString()
  };
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

    const resolved = await resolveExecution(supabase, org.orgId, body);
    const { provider, model } = envModelProvider(org.orgId);

    let runId = body.runId;
    const inputs = {
      target: resolved.target,
      contextRefs: resolved.contextRefs,
      selectedContext: resolved.selectedContext,
      nodes: resolved.nodes,
      workstreamId: resolved.workstreamId,
      explicit_context: resolved.contextRefs.length === 0 ? [] : resolved.contextRefs
    };

    if (runId) {
      await supabase
        .from("runs")
        .update({ status: "running", inputs, updated_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("org_id", org.orgId);
    } else {
      const { data: created, error } = await supabase
        .from("runs")
        .insert({
          org_id: org.orgId,
          workstream_id: null,
          run_type: resolved.target.type === "eval" ? "eval" : "custom",
          prompt: body.prompt,
          status: "running",
          inputs
        })
        .select()
        .single();
      if (error) throw error;
      if (!created) throw new HttpError(500, "Failed to create run");
      runId = created.id;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let waitingForHuman = false;
        let terminalSent = false;
        let outputText = "";
        const artifactIds: string[] = [];
        controller.enqueue(encoder.encode(frame({
          kind: "run",
          runId,
          target: resolved.target,
          selectedContext: resolved.selectedContext
        })));

        try {
          if (resolved.target.type === "chat") {
            let text = "";
            controller.enqueue(encoder.encode(frame({
              kind: "status",
              status: { phase: "generating", message: "Director is generating." }
            })));
            for await (const delta of streamPlainChat(org.orgId, body.prompt, resolved.selectedContext)) {
              text += delta;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: delta })));
            }
            await supabase.from("run_events").insert({
              org_id: org.orgId,
              run_id: runId,
              event_type: "run_completed",
              message: "Chat completed.",
              payload: { target: resolved.target, selectedContext: resolved.selectedContext }
            });
            await supabase
              .from("runs")
              .update({
                status: "completed",
                outputs: { text },
                completed_at: new Date().toISOString()
              })
              .eq("id", runId)
              .eq("org_id", org.orgId);
            controller.enqueue(encoder.encode(frame({
              kind: "event",
              event: runEvent(org.orgId, runId!, "run_completed", "Chat completed.", { target: resolved.target })
            })));
            return;
          }

          for await (const item of streamRun({
            orgId: org.orgId,
            runId: runId!,
            prompt: body.prompt,
            nodes: resolved.nodes,
            skills: resolved.skills,
            roles: resolved.rolesById,
            provider,
            model,
            knowledgeFiles: resolved.knowledgeFiles,
            workstreamId: resolved.workstreamId
          })) {
            if (item.kind === "event") {
              if (item.event.type === "run_completed" || item.event.type === "run_failed" || item.event.type === "run_cancelled") {
                terminalSent = true;
              }
              await supabase.from("run_events").insert({
                org_id: org.orgId,
                run_id: runId,
                event_type: item.event.type,
                node: item.event.node ?? null,
                skill: item.event.skill ?? null,
                message: item.event.message,
                payload: item.event.payload
              });
              controller.enqueue(encoder.encode(frame({ kind: "event", event: item.event })));
            } else if (item.kind === "artifact") {
              const { data: createdFile, error: fileError } = await supabase.from("files").insert({
                org_id: org.orgId,
                file_type: item.artifact.type,
                title: item.artifact.title,
                body: item.artifact.body,
                metadata: {
                  ...item.artifact.metadata,
                  sourceRunId: runId,
                  selectedContext: resolved.selectedContext
                },
                status: "active"
              }).select("id").single();
              if (fileError) throw fileError;
              if (createdFile?.id) {
                artifactIds.push(createdFile.id);
                await supabase.from("generated_files").insert({
                  org_id: org.orgId,
                  run_id: runId,
                  file_id: createdFile.id,
                  relationship: "output"
                });
              }
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
            } else if (item.kind === "human_input") {
              waitingForHuman = true;
              await supabase
                .from("runs")
                .update({ status: "waiting_human", updated_at: new Date().toISOString() })
                .eq("id", runId)
                .eq("org_id", org.orgId);
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "text") {
              outputText += item.text;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: item.text })));
            } else if (item.kind === "status") {
              controller.enqueue(encoder.encode(frame({ kind: "status", status: item.status })));
            }
          }

          if (!waitingForHuman) {
            await supabase
              .from("runs")
              .update({
                status: "completed",
                outputs: { text: outputText, artifactIds },
                completed_at: new Date().toISOString()
              })
              .eq("id", runId)
              .eq("org_id", org.orgId);
            if (!terminalSent) {
              const completedEvent = runEvent(org.orgId, runId!, "run_completed", "Run completed.", {
                target: resolved.target,
                selectedContext: resolved.selectedContext
              });
              await supabase.from("run_events").insert({
                org_id: org.orgId,
                run_id: runId,
                event_type: completedEvent.type,
                message: completedEvent.message,
                payload: completedEvent.payload
              });
              controller.enqueue(encoder.encode(frame({ kind: "event", event: completedEvent })));
            }
          }
        } catch (err) {
          console.error("[runs/execute] stream error:", err);
          const message = err instanceof Error ? err.message : "Unknown run error";
          await supabase
            .from("runs")
            .update({ status: "failed", completed_at: new Date().toISOString() })
            .eq("id", runId)
            .eq("org_id", org.orgId);
          const failedEvent = runEvent(org.orgId, runId!, "run_failed", message, { target: resolved.target });
          controller.enqueue(encoder.encode(frame({ kind: "event", event: failedEvent })));
          controller.enqueue(encoder.encode(frame({
            kind: "error",
            message
          })));
        } finally {
          controller.close();
        }
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      }
    });
  } catch (err) {
    console.error("[runs/execute] error:", err);
    return errorResponse(err);
  }
}
