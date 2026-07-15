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
import type { RunEvent } from "@spielos/core";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

type ReplyBody = {
  requestId: string;
  answers: Record<string, unknown>;
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
    const controlAction = body.requestId === "resume" || body.requestId === "retry";
    const controlAllowed = body.requestId === "resume"
      ? run.status === "waiting_human"
      : body.requestId === "retry" && (run.status === "failed" || run.status === "cancelled");
    if ((!controlAction && run.status !== "waiting_human") || (controlAction && !controlAllowed)) {
      throw new HttpError(409, "Run is not waiting for human input");
    }
    if (controlAction && run.type === "chat") {
      throw new HttpError(409, "Plain chat responses retry as a new response; durable recovery applies to executable runs.");
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
      modelId: typeof previousInputs.modelId === "string" ? previousInputs.modelId : undefined,
      reasoningEffort: typeof previousInputs.reasoningEffort === "string" ? previousInputs.reasoningEffort as ExecuteBody["reasoningEffort"] : undefined,
      goal: previousInputs.goal as ExecuteBody["goal"],
      budget: previousInputs.budget as ExecuteBody["budget"],
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
    if (definitionSnapshot.workspaceInstructions) {
      resolved.runRequest.workspaceInstructions = definitionSnapshot.workspaceInstructions as typeof resolved.runRequest.workspaceInstructions;
    }
    if (definitionSnapshot.memories) {
      resolved.runRequest.memories = definitionSnapshot.memories as typeof resolved.runRequest.memories;
    }
    if (definitionSnapshot.provider) {
      resolved.runRequest.provider = definitionSnapshot.provider as typeof resolved.runRequest.provider;
    }
    if (definitionSnapshot.model) {
      resolved.runRequest.model = definitionSnapshot.model as typeof resolved.runRequest.model;
    }
    let checkpoint: RunCheckpoint = (run.state as RunCheckpoint) ?? {
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
    if (controlAction) {
      checkpoint = {
        ...checkpoint,
        status: "running",
        failed: false,
        failedNode: null,
        error: null,
        pendingHumanInput: null,
        pause: { requested: false, reason: null, requestedAt: null },
        progress: {
          ...(checkpoint.progress ?? { milestone: null, completedActions: [], nextActions: [], unresolvedIssues: [] }),
          nextActions: [body.requestId === "retry" ? "Retry the failed step from the latest checkpoint." : "Resume from the latest checkpoint."],
          unresolvedIssues: []
        },
        verification: checkpoint.verification ? { ...checkpoint.verification, status: "pending", checkedAt: null } : undefined
      };
    }

    // Persist the human answer against the run.
    const previousHumanInputs = (run.human_inputs as Record<string, unknown>) ?? {};
    await updateRun(org.sql, org.orgId, runId, {
      status: "running",
      humanInputs: controlAction ? previousHumanInputs : { ...previousHumanInputs, [body.requestId]: body.answers },
      state: checkpoint,
      error: null,
      completedAt: null
    });

    const firstEventSequence = await nextRunEventSequence(org.sql, org.orgId, runId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ kind: "run", runId, type: target.type })));
        let outputText = "";
        let terminalStatus: "completed" | "failed" | "cancelled" | "waiting_human" = "completed";
        let errorMessage: string | null = null;
        let latestCheckpoint: RunCheckpoint = checkpoint;
        let streamEventSequence = firstEventSequence;
        const priorUsage = {
          input: checkpoint.budget?.inputTokens ?? 0,
          output: checkpoint.budget?.outputTokens ?? 0,
          tools: checkpoint.budget?.toolCalls ?? 0
        };
        const usage = { input: 0, output: 0, tools: 0 };
        const onUsage = (next: { input: number; output: number }) => {
          usage.input += next.input;
          usage.output += next.output;
        };
        const onToolUsage = (count: number) => {
          const next = priorUsage.tools + usage.tools + count;
          const maximum = checkpoint.budget?.maxToolCalls;
          if (maximum && next > maximum) throw new Error(`Tool-call budget exceeded (${maximum}).`);
          usage.tools += count;
        };

        try {
          for await (const item of streamRun({
            ...resolved.runRequest,
            runId,
            resume: controlAction ? {} : body.answers,
            checkpoint,
            goal: executeBody.goal,
            budget: executeBody.budget,
            onUsage,
            onToolUsage,
            signal: request.signal
          })) {
            if (item.kind === "text") {
              outputText += item.text;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: item.text })));
            } else if (item.kind === "status") {
              controller.enqueue(encoder.encode(frame({ kind: "status", message: item.message })));
            } else if (item.kind === "event") {
              const e: RunEvent = { ...item.event, sequence: streamEventSequence++ };
              await appendRunEvents(org.sql, org.orgId, runId, [{
                event_type: e.type,
                node_id: e.nodeId ?? null,
                node_title: e.nodeTitle ?? null,
                skill_id: e.skillId ?? null,
                skill_name: e.skillName ?? null,
                message: e.message,
                payload: e.payload ?? {}
              }]);
              controller.enqueue(encoder.encode(frame({ kind: "event", event: e })));
            } else if (item.kind === "artifact") {
              const file = await createFile(org.sql, org.orgId, {
                title: item.artifact.title,
                body: item.artifact.body,
                fileType: item.artifact.type === "artifact" ? "artifact" : item.artifact.type,
                status: "active",
                metadata: {
                  ...item.artifact.metadata,
                  runId,
                  runtimeArtifactId: item.artifact.id,
                  seedFolder: generatedFileFolder()
                }
              });
              await linkRunOutputFile(org.sql, org.orgId, runId, file.id);
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "checkpoint") {
              latestCheckpoint = item.state;
              await updateRun(org.sql, org.orgId, runId, {
                status: latestCheckpoint.status,
                state: latestCheckpoint,
                error: latestCheckpoint.error
              });
              controller.enqueue(encoder.encode(frame({
                kind: "run_state",
                state: {
                  goal: latestCheckpoint.goal,
                  budget: latestCheckpoint.budget,
                  progress: latestCheckpoint.progress,
                  verification: latestCheckpoint.verification
                }
              })));
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

        const completedAt =
          terminalStatus === "completed" || terminalStatus === "failed" || terminalStatus === "cancelled"
            ? new Date().toISOString()
            : null;

        if (latestCheckpoint.budget) {
          latestCheckpoint = {
            ...latestCheckpoint,
            budget: {
              ...latestCheckpoint.budget,
              inputTokens: priorUsage.input + usage.input,
              outputTokens: priorUsage.output + usage.output,
              toolCalls: priorUsage.tools + usage.tools
            }
          };
        }

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
              inputTokens: usage.input,
              outputTokens: usage.output,
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

        controller.enqueue(encoder.encode(frame({
          kind: "run_state",
          state: {
            goal: latestCheckpoint.goal,
            budget: latestCheckpoint.budget,
            progress: latestCheckpoint.progress,
            verification: latestCheckpoint.verification
          }
        })));

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
