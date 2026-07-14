import {
  appendChatMessages,
  appendRunEvents,
  createFile,
  getRun,
  linkRunOutputFile,
  nextRunEventSequence,
  recordUsage,
  updateRun
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../../lib/workspace-data";
import { streamRun, type RunCheckpoint } from "@spielos/graph";
import type { Artifact, RunEvent } from "@spielos/core";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type ReplyBody = {
  requestId: string;
  answers: Record<string, unknown>;
};

type PendingEvent = {
  event_type: string;
  node_id: string | null;
  node_title: string | null;
  skill_id: string | null;
  skill_name: string | null;
  message: string;
  payload: Record<string, unknown>;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const org = await getOrg();
    requireWrite(org);
    const { id: runId } = await params;
    const body = (await request.json()) as ReplyBody;
    if (!body.requestId || body.answers === undefined) {
      throw new HttpError(400, "requestId and answers are required");
    }

    const run = await getRun(org.sql, org.orgId, runId);
    if (!run) throw new HttpError(404, "Run not found");
    if (run.status !== "waiting_human") {
      throw new HttpError(409, "Run is not waiting for human input");
    }

    // Reconstruct the execution body from the persisted run.
    const previousInputs = (run.inputs as Record<string, unknown>) ?? {};
    const target = previousInputs.target as { type?: ExecuteBody["type"]; id?: string | null } | undefined;
    if (!target?.type) throw new HttpError(500, "Run is missing target");

    const executeBody: ExecuteBody = {
      prompt: run.prompt,
      type: target.type,
      targetId: target.id ?? undefined,
      workflowId: target.id ?? undefined,
      contextFileIds: (previousInputs.contextFileIds as string[]) ?? [],
      runId
    };

    const resolved = await resolveExecution(org, executeBody);
    const definitionSnapshot = (run.definition_snapshot as Record<string, unknown>) ?? {};
    if (definitionSnapshot.workflow) {
      resolved.runRequest.workflow = definitionSnapshot.workflow as typeof resolved.runRequest.workflow;
    }
    if (definitionSnapshot.singleNode) {
      resolved.runRequest.singleNode = definitionSnapshot.singleNode as typeof resolved.runRequest.singleNode;
    }
    if (definitionSnapshot.roles) {
      resolved.runRequest.roles = definitionSnapshot.roles as typeof resolved.runRequest.roles;
    }
    if (definitionSnapshot.skills) {
      resolved.runRequest.skills = definitionSnapshot.skills as typeof resolved.runRequest.skills;
    }
    const checkpoint: RunCheckpoint = (run.state as RunCheckpoint) ?? {
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "waiting_human",
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null
    };

    // Persist the human answer against the run.
    const previousHumanInputs = (run.human_inputs as Record<string, unknown>) ?? {};
    await updateRun(org.sql, org.orgId, runId, {
      status: "running",
      humanInputs: { ...previousHumanInputs, [body.requestId]: body.answers }
    });

    const firstEventSequence = await nextRunEventSequence(org.sql, org.orgId, runId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ kind: "run", runId, type: target.type })));
        const pendingEvents: PendingEvent[] = [];
        const pendingArtifacts: Artifact[] = [];
        let outputText = "";
        let terminalStatus: "completed" | "failed" | "cancelled" | "waiting_human" = "completed";
        let errorMessage: string | null = null;
        let latestCheckpoint: RunCheckpoint = checkpoint;
        let streamEventSequence = firstEventSequence;

        try {
          for await (const item of streamRun({
            ...resolved.runRequest,
            runId,
            resume: body.answers,
            checkpoint,
            signal: request.signal
          })) {
            if (item.kind === "text") {
              outputText += item.text;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: item.text })));
            } else if (item.kind === "status") {
              controller.enqueue(encoder.encode(frame({ kind: "status", message: item.message })));
            } else if (item.kind === "event") {
              const e: RunEvent = { ...item.event, sequence: streamEventSequence++ };
              pendingEvents.push({
                event_type: e.type,
                node_id: e.nodeId ?? null,
                node_title: e.nodeTitle ?? null,
                skill_id: e.skillId ?? null,
                skill_name: e.skillName ?? null,
                message: e.message,
                payload: e.payload ?? {}
              });
              controller.enqueue(encoder.encode(frame({ kind: "event", event: e })));
            } else if (item.kind === "artifact") {
              pendingArtifacts.push(item.artifact);
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "checkpoint") {
              latestCheckpoint = item.state;
            } else if (item.kind === "done") {
              const allowed = ["completed", "failed", "cancelled", "waiting_human"] as const;
              terminalStatus = allowed.includes(item.status as (typeof allowed)[number])
                ? (item.status as (typeof allowed)[number])
                : "completed";
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Resume failed";
          terminalStatus = "failed";
          controller.enqueue(encoder.encode(frame({ kind: "error", message: errorMessage })));
        }

        if (pendingEvents.length > 0) {
          try {
            await appendRunEvents(org.sql, org.orgId, runId, pendingEvents);
          } catch (err) {
            console.error("[runs/reply] event persist failed:", err);
          }
        }

        for (const artifact of pendingArtifacts) {
          try {
            const file = await createFile(org.sql, org.orgId, {
              title: artifact.title,
              body: artifact.body,
              fileType: artifact.type === "artifact" ? "artifact" : artifact.type,
              status: "active",
              metadata: {
                ...artifact.metadata,
                runId,
                runtimeArtifactId: artifact.id,
                seedFolder: generatedFileFolder()
              }
            });
            await linkRunOutputFile(org.sql, org.orgId, runId, file.id);
          } catch (err) {
            console.error("[runs/reply] artifact persist failed:", err);
          }
        }

        const completedAt =
          terminalStatus === "completed" || terminalStatus === "failed" || terminalStatus === "cancelled"
            ? new Date().toISOString()
            : null;

        await updateRun(org.sql, org.orgId, runId, {
          status: terminalStatus,
          outputs: { text: outputText },
          state: latestCheckpoint,
          error: errorMessage,
          completedAt
        });

        if (resolved.runRequest.provider && resolved.runRequest.model && outputText) {
          try {
            await recordUsage(org.sql, org.orgId, {
              runId,
              provider: resolved.runRequest.provider.name,
              model: resolved.runRequest.model.model,
              inputTokens: Math.ceil(run.prompt.length / 4),
              outputTokens: Math.ceil(outputText.length / 4),
              costMicros: 0
            });
          } catch (err) {
            console.warn("[runs/reply] usage record failed:", err);
          }
        }

        if (run.chat_id && outputText) {
          try {
            await appendChatMessages(org.sql, org.orgId, run.chat_id, [
              { role: "assistant", body: outputText, metadata: { runId, resumedFrom: body.requestId } }
            ]);
          } catch (err) {
            console.warn("[runs/reply] chat persist failed:", err);
          }
        }

        controller.enqueue(encoder.encode(frame({ kind: "done", runId, status: terminalStatus })));
        controller.close();
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
