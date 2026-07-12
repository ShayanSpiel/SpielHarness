import { errorResponse, getOrg, HttpError, requireOrgWrite, requireSupabase } from "../../../../../lib/server";
import { resolveExecution, resolveModelProvider, type ExecuteBody } from "../../../../../lib/execution-service";
import { streamRun } from "@spielos/graph";
import { recordRunUsage } from "../../../../../lib/usage";
import { createRunEventBuffer } from "../../../../../lib/run-event-buffer";
import { persistRunArtifact } from "../../../../../lib/workspace-artifact";

type ReplyBody = {
  requestId: string;
  answers: Record<string, unknown>;
};

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

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireOrgWrite(org);
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
    if (run.status !== "waiting_human") throw new HttpError(409, "Run is not waiting for human input");
    const savedCheckpoint = (run.checkpoint as Record<string, unknown>) ?? {};
    const pendingRequest = savedCheckpoint.humanInputRequest as { id?: string } | undefined;
    if (!pendingRequest?.id || pendingRequest.id !== body.requestId) {
      throw new HttpError(409, "This human-input request is stale or does not belong to the run");
    }

    const previousInputs = (run.inputs as Record<string, unknown>) ?? {};
    const executeBody: ExecuteBody = {
      prompt: String(run.prompt ?? ""),
      target: previousInputs.target as ExecuteBody["target"],
      contextRefs: previousInputs.contextRefs as ExecuteBody["contextRefs"],
      nodes: previousInputs.nodes as ExecuteBody["nodes"],
      runId
    };
    const resolved = await resolveExecution(supabase, org.orgId, executeBody);
    const preferredModelId = resolved.nodes.map((node) => resolved.rolesById[node.roleId]?.modelId).find(Boolean);
    const { provider, model } = await resolveModelProvider(supabase, org.orgId, preferredModelId);

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
        let checkpoint: Record<string, unknown> = savedCheckpoint;
        const eventBuffer = createRunEventBuffer(supabase, org.orgId, runId);
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
            resume: body.answers,
            checkpoint: savedCheckpoint
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
              const created = await persistRunArtifact(supabase, org.orgId, runId, item.artifact, resolved.selectedContext);
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
            await recordRunUsage({ supabase, orgId: org.orgId, runId, provider, model, input: String(run.prompt ?? ""), output: outputText });
            if (run.chat_id && outputText.trim()) {
              const { error: messageError } = await supabase.from("chat_messages").insert({
                org_id: org.orgId,
                chat_id: run.chat_id,
                role: "assistant",
                body: outputText,
                metadata: { runId, resumedFrom: body.requestId }
              });
              if (messageError) throw messageError;
            }
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
          const cancelled = request.signal.aborted || (err instanceof Error && err.name === "AbortError");
          await eventBuffer.flush().catch(() => undefined);
          await supabase
            .from("runs")
            .update({ status: cancelled ? "cancelled" : "failed", completed_at: new Date().toISOString() })
            .eq("id", runId)
            .eq("org_id", org.orgId);
          const failedEvent = runEvent(org.orgId, runId, cancelled ? "run_cancelled" : "run_failed", cancelled ? "Run cancelled." : message, { target: resolved.target });
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
    return errorResponse(err);
  }
}
