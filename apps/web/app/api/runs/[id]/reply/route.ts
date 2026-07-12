import { errorResponse, getOrg, HttpError, requireSupabase } from "../../../../../lib/server";
import { envModelProvider, resolveExecution, type ExecuteBody } from "../../../../../lib/execution-service";
import { streamRun } from "@spielos/graph";

type ReplyBody = {
  requestId: string;
  answers: Record<string, unknown>;
};

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { id: runId } = await params;
    const body = (await request.json()) as ReplyBody;
    if (!body.requestId || body.answers === undefined) {
      throw new HttpError(400, "requestId and answers are required");
    }

    const { data: run, error: runErr } = await supabase
      .from("runs")
      .select("*")
      .eq("id", runId)
      .eq("org_id", org.orgId)
      .single();
    if (runErr || !run) throw new HttpError(404, "Run not found");

    const previousInputs = (run.inputs as Record<string, unknown>) ?? {};
    const executeBody: ExecuteBody = {
      prompt: String(run.prompt ?? ""),
      target: previousInputs.target as ExecuteBody["target"],
      contextRefs: previousInputs.contextRefs as ExecuteBody["contextRefs"],
      nodes: previousInputs.nodes as ExecuteBody["nodes"],
      runId
    };
    const resolved = await resolveExecution(supabase, org.orgId, executeBody);
    const { provider, model } = envModelProvider(org.orgId);

    const humanInputs = (run.human_inputs as Record<string, unknown>) ?? {};
    const updatedHumanInputs = { ...humanInputs, [body.requestId]: body.answers };
    await supabase
      .from("runs")
      .update({
        status: "running",
        human_inputs: updatedHumanInputs,
        updated_at: new Date().toISOString()
      })
      .eq("id", runId)
      .eq("org_id", org.orgId);

    await supabase.from("run_events").insert({
      org_id: org.orgId,
      run_id: runId,
      event_type: "human_input_received",
      message: "Human input received, resuming run.",
      payload: { requestId: body.requestId }
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let outputText = "";
        const artifactIds: string[] = [];
        controller.enqueue(encoder.encode(frame({
          kind: "run",
          runId,
          target: resolved.target,
          selectedContext: resolved.selectedContext
        })));

        try {
          let waitingForHuman = false;
          let terminalSent = false;
          let terminalStatus: "completed" | "failed" | "cancelled" | null = null;
          for await (const item of streamRun({
            orgId: org.orgId,
            runId,
            prompt: String(run.prompt ?? ""),
            nodes: resolved.nodes,
            skills: resolved.skills,
            roles: resolved.rolesById,
            provider,
            model,
            knowledgeFiles: resolved.knowledgeFiles,
            workstreamId: resolved.workstreamId,
            resume: body.answers
          })) {
            if (item.kind === "event") {
              if (item.event.type === "run_completed" || item.event.type === "run_failed" || item.event.type === "run_cancelled") {
                terminalSent = true;
                terminalStatus =
                  item.event.type === "run_failed" ? "failed" :
                  item.event.type === "run_cancelled" ? "cancelled" :
                  "completed";
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
                status: terminalStatus ?? "completed",
                outputs: { text: outputText, artifactIds },
                completed_at: new Date().toISOString()
              })
              .eq("id", runId)
              .eq("org_id", org.orgId);
            if (!terminalSent) {
              const completedEvent = runEvent(org.orgId, runId, "run_completed", "Run completed.", {
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
          const message = err instanceof Error ? err.message : "Unknown resume error";
          await supabase
            .from("runs")
            .update({ status: "failed", completed_at: new Date().toISOString() })
            .eq("id", runId)
            .eq("org_id", org.orgId);
          const failedEvent = runEvent(org.orgId, runId, "run_failed", message, { target: resolved.target });
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
    return errorResponse(err);
  }
}
