import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../../lib/server";
import {
  resolveModelProvider,
  resolveExecution,
  streamPlainChat,
  type ExecuteBody
} from "../../../../lib/execution-service";
import { streamRun } from "@spielos/graph";
import { recordRunUsage } from "../../../../lib/usage";
import { createRunEventBuffer } from "../../../../lib/run-event-buffer";
import { persistRunArtifact } from "../../../../lib/workspace-artifact";

function frame(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

function runEvent(orgId: string, runId: string, type: "run_completed" | "run_failed" | "run_cancelled", message: string, payload?: Record<string, unknown>) {
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
    requireOrgWrite(org);
    const supabase = requireSupabase(org);
    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey;
    if (idempotencyKey) {
      const { data: duplicate, error: duplicateError } = await supabase
        .from("runs")
        .select("id, status")
        .eq("org_id", org.orgId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) throw new HttpError(409, `Run already exists (${duplicate.id}, ${duplicate.status}).`);
    }

    const resolved = await resolveExecution(supabase, org.orgId, body);
    const preferredModelId = resolved.nodes.map((node) => resolved.rolesById[node.roleId]?.modelId).find(Boolean);
    const { provider, model } = await resolveModelProvider(supabase, org.orgId, preferredModelId);

    if (body.chatId) {
      const { data: existingChat } = await supabase.from("chats").select("id").eq("id", body.chatId).eq("org_id", org.orgId).maybeSingle();
      if (!existingChat) {
        const { error: chatError } = await supabase.from("chats").insert({
          id: body.chatId,
          org_id: org.orgId,
          title: body.prompt.trim().slice(0, 80) || "New chat"
        });
        if (chatError) throw new HttpError(400, "Invalid or unavailable chat id");
      }
    }

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
      const { data: existingRun, error: existingRunError } = await supabase
        .from("runs")
        .select("id")
        .eq("id", runId)
        .eq("org_id", org.orgId)
        .single();
      if (existingRunError || !existingRun) throw new HttpError(404, "Run not found");
      const { error: updateError } = await supabase
        .from("runs")
        .update({ status: "running", inputs, updated_at: new Date().toISOString() })
        .eq("id", runId)
        .eq("org_id", org.orgId);
      if (updateError) throw updateError;
    } else {
      const { data: created, error } = await supabase
        .from("runs")
        .insert({
          org_id: org.orgId,
          chat_id: body.chatId ?? null,
          workstream_id: resolved.workstreamId,
          run_type: resolved.target.type === "eval" ? "eval" : "custom",
          prompt: body.prompt,
          status: "running",
          inputs,
          idempotency_key: idempotencyKey ?? null,
          requested_by: org.profileId,
          definition_snapshot: {
            target: resolved.target,
            nodes: resolved.nodes,
            selectedContext: resolved.selectedContext,
            workstreamId: resolved.workstreamId
          }
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
        let terminalStatus: "completed" | "failed" | "cancelled" | null = null;
        let outputText = "";
        const artifactIds: string[] = [];
        let checkpoint: Record<string, unknown> = {};
        const eventBuffer = createRunEventBuffer(supabase, org.orgId, runId!);
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
            for await (const delta of streamPlainChat(
              org.orgId,
              body.prompt,
              resolved.directorPrompt,
              resolved.selectedContext,
              resolved.knowledgeFiles,
              body.messages ?? [],
              provider,
              model,
              request.signal
            )) {
              text += delta;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: delta })));
            }
            if (body.chatId) {
              const history = body.messages ?? [];
              const lastUser = [...history].reverse().find((message) => message.role === "user")?.content ?? body.prompt;
              const { error: messageError } = await supabase.from("chat_messages").insert([
                { org_id: org.orgId, chat_id: body.chatId, role: "user", body: lastUser, metadata: { runId } },
                { org_id: org.orgId, chat_id: body.chatId, role: "assistant", body: text, metadata: { runId } }
              ]);
              if (messageError) throw messageError;
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
            await recordRunUsage({ supabase, orgId: org.orgId, runId: runId!, provider, model, input: body.prompt, output: text });
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
          }, request.signal)) {
            if (item.kind === "event") {
              if (item.event.type === "run_completed" || item.event.type === "run_failed" || item.event.type === "run_cancelled") {
                terminalSent = true;
                terminalStatus =
                  item.event.type === "run_failed" ? "failed" :
                  item.event.type === "run_cancelled" ? "cancelled" :
                  "completed";
              }
              await eventBuffer.push(item.event);
              controller.enqueue(encoder.encode(frame({ kind: "event", event: item.event })));
            } else if (item.kind === "artifact") {
              const created = await persistRunArtifact(supabase, org.orgId, runId!, item.artifact, resolved.selectedContext);
              if (created.fileId) {
                artifactIds.push(created.fileId);
                await supabase.from("generated_files").insert({
                  org_id: org.orgId,
                  run_id: runId,
                  file_id: created.fileId,
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
            } else if (item.kind === "values") {
              checkpoint = {
                cursor: item.state.cursor,
                humanInputs: item.state.humanInputs,
                humanInputRequest: item.state.humanInputRequest,
                outputsByNode: item.state.outputsByNode,
                evalAttempts: item.state.evalAttempts,
                output: item.state.output
              };
            }
          }

          await eventBuffer.flush();

          if (waitingForHuman) {
            await supabase
              .from("runs")
              .update({ checkpoint, status: "waiting_human", updated_at: new Date().toISOString() })
              .eq("id", runId)
              .eq("org_id", org.orgId);
          } else {
            await recordRunUsage({ supabase, orgId: org.orgId, runId: runId!, provider, model, input: body.prompt, output: outputText });
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
          const cancelled = request.signal.aborted || (err instanceof Error && err.name === "AbortError");
          await eventBuffer.flush().catch(() => undefined);
          await supabase
            .from("runs")
            .update({ status: cancelled ? "cancelled" : "failed", completed_at: new Date().toISOString() })
            .eq("id", runId)
            .eq("org_id", org.orgId);
          const failedEvent = runEvent(org.orgId, runId!, cancelled ? "run_cancelled" : "run_failed", cancelled ? "Run cancelled." : message, { target: resolved.target });
          await supabase.from("run_events").insert({
            org_id: org.orgId, run_id: runId, event_type: failedEvent.type,
            message: failedEvent.message, payload: failedEvent.payload
          });
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
