import {
  appendChatMessages,
  appendProjectRevision,
  atomicCheckpoint,
  createFile,
  getProjectSession,
  getRun,
  linkRunOutputFile,
  recordUsage,
  updateChatMetadata,
  type RunEventInput
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../../lib/workspace-data";
import { streamRun, type RunCheckpoint } from "@spielos/graph";

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
    const project = run.project_id
      ? await getProjectSession(org.sql, org.orgId, run.project_id)
      : null;
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
      runId,
      // The execution mode and suggested refs are persisted on the
      // run's `inputs` so resume replays the same mode. The plain
      // chat retry path falls back to direct mode (legacy); durable
      // resume for harness runs preserves the original mode.
      executionMode: previousInputs.executionMode === "director" ? "director" : "direct",
      suggestedHarnessRefs: Array.isArray(previousInputs.suggestedHarnessRefs)
        ? previousInputs.suggestedHarnessRefs as ExecuteBody["suggestedHarnessRefs"]
        : []
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

    // Persist the human answer against the run via an atomic checkpoint.
    const previousHumanInputs = (run.human_inputs as Record<string, unknown>) ?? {};
    const pendingRequestId = checkpoint.pendingHumanInput?.id;
    const persistedPendingAnswers = pendingRequestId ? previousHumanInputs[pendingRequestId] : null;
    const resumeAnswers = controlAction
      ? body.requestId === "retry" && persistedPendingAnswers && typeof persistedPendingAnswers === "object"
        ? persistedPendingAnswers as Record<string, unknown>
        : {}
      : body.answers;
    const initialCheckpoint = await atomicCheckpoint(org.sql, org.orgId, runId, {
      status: "running",
      humanInputs: controlAction ? previousHumanInputs : { ...previousHumanInputs, [body.requestId]: body.answers },
      state: checkpoint,
      error: null,
      completedAt: null,
      expectedCheckpointVersion: Number(run.checkpoint_version ?? 0)
    });
    let checkpointVersion = initialCheckpoint.checkpointVersion;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ kind: "run", runId, type: target.type })));
        let outputText = "";
        const outputFiles: Array<{ id: string; isProject: boolean }> = [];
        let terminalStatus: "completed" | "failed" | "cancelled" | "waiting_human" = "completed";
        let errorMessage: string | null = null;
        let latestCheckpoint: RunCheckpoint = checkpoint;
        const priorUsage = {
          input: checkpoint.budget?.inputTokens ?? 0,
          output: checkpoint.budget?.outputTokens ?? 0,
          tools: checkpoint.budget?.toolCalls ?? 0
        };
        const usage = { input: 0, output: 0, tools: 0 };
        const queuedEventIds = new Set<string>();
        const queuedEvents: RunEventInput[] = [];
        const shouldPersistImmediately = (event: import("@spielos/core").RunEvent) =>
          event.type === "run_started" ||
          event.type === "run_completed" ||
          event.type === "run_failed" ||
          event.type === "run_cancelled" ||
          event.type === "node_started" ||
          event.type === "node_completed" ||
          event.type === "node_failed" ||
          event.type === "human_input_requested" ||
          event.type === "human_input_received" ||
          event.type === "artifact_created" ||
          event.type === "eval_score_updated" ||
          (event.type === "status" && ["context_assembly", "model_generation", "structured_output_repair"].includes(String(event.payload?.category ?? "")));
        const onUsage = (next: { input: number; output: number }) => {
          usage.input += next.input;
          usage.output += next.output;
          controller.enqueue(encoder.encode(frame({
            kind: "usage",
            usage: {
              inputTokens: priorUsage.input + usage.input,
              outputTokens: priorUsage.output + usage.output,
              toolCalls: priorUsage.tools + usage.tools
            }
          })));
        };
        const onToolUsage = (count: number) => {
          const next = priorUsage.tools + usage.tools + count;
          const maximum = checkpoint.budget?.maxToolCalls;
          if (maximum && next > maximum) throw new Error(`Tool-call budget exceeded (${maximum}).`);
          usage.tools += count;
          controller.enqueue(encoder.encode(frame({
            kind: "usage",
            usage: {
              inputTokens: priorUsage.input + usage.input,
              outputTokens: priorUsage.output + usage.output,
              toolCalls: priorUsage.tools + usage.tools
            }
          })));
        };
        const flushAtomicCheckpoint = async (stateOverride?: RunCheckpoint) => {
          if (queuedEvents.length === 0 && stateOverride === undefined) return;
          const batch = queuedEvents.splice(0, queuedEvents.length);
          const result = await atomicCheckpoint(org.sql, org.orgId, runId, {
            events: batch,
            state: stateOverride ?? latestCheckpoint,
            expectedCheckpointVersion: checkpointVersion
          });
          checkpointVersion = result.checkpointVersion;
        };

        try {
          for await (const item of streamRun({
            ...resolved.runRequest,
            runId,
            resume: resumeAnswers,
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
              if (!queuedEventIds.has(item.event.id)) {
                queuedEventIds.add(item.event.id);
                queuedEvents.push({
                  event_type: item.event.type,
                  node_id: item.event.nodeId ?? null,
                  node_title: item.event.nodeTitle ?? null,
                  skill_id: item.event.skillId ?? null,
                  skill_name: item.event.skillName ?? null,
                  message: item.event.message,
                  payload: item.event.payload ?? {}
                });
                if (queuedEvents.length >= 12 || shouldPersistImmediately(item.event)) await flushAtomicCheckpoint();
              }
              controller.enqueue(encoder.encode(frame({ kind: "event", event: item.event })));
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
              outputFiles.push({
                id: file.id,
                isProject: item.artifact.metadata?.renderer === "project" || item.artifact.type === "artifact"
              });
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "checkpoint") {
              latestCheckpoint = item.state;
              await flushAtomicCheckpoint(latestCheckpoint);
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

        // Final atomic checkpoint: bundles the final state, outputs,
        // status, and any remaining events in one transaction.
        try {
          const finalResult = await atomicCheckpoint(org.sql, org.orgId, runId, {
            events: queuedEvents.splice(0, queuedEvents.length),
            state: latestCheckpoint,
            outputs: { text: outputText },
            status: terminalStatus,
            error: errorMessage,
            completedAt,
            expectedCheckpointVersion: checkpointVersion
          });
          checkpointVersion = finalResult.checkpointVersion;
        } catch (finalError) {
          console.error("[runs/reply] final atomic checkpoint failed, falling back:", finalError);
          const { updateRun } = await import("@spielos/db");
          await updateRun(org.sql, org.orgId, runId, {
            status: terminalStatus,
            outputs: { text: outputText },
            state: latestCheckpoint,
            error: errorMessage,
            completedAt
          });
        }

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
              {
                role: "assistant",
                body: outputText,
                metadata: {
                  runId,
                  turnId: run.turn_id ?? undefined,
                  kind: "assistant_reply",
                  resumedFrom: body.requestId
                }
              }
            ]);
          } catch (err) {
            console.warn("[runs/reply] chat persist failed:", err);
          }
        }

        // A workflow commonly creates its first project artifact after the
        // human brief is answered. Treat that resumed execution as a normal
        // revision so later chat edits retain the project lineage.
        if (run.chat_id && project && outputFiles.length > 0) {
          try {
            const projectArtifact = outputFiles.find((file) => file.isProject) ?? outputFiles[0];
            const revision = await appendProjectRevision(org.sql, org.orgId, {
              projectId: project.id,
              expectedProjectVersion: project.version,
              runId,
              turnId: run.turn_id,
              instruction: run.prompt,
              artifactIds: outputFiles.map((file) => file.id),
              author: run.type === "workflow" ? "workflow" : "orchestrator",
              projectStatus: terminalStatus === "waiting_human" ? "review" : terminalStatus === "completed" ? "active" : undefined
            });
            if (revision) {
              await updateChatMetadata(org.sql, org.orgId, run.chat_id, {
                activeProject: {
                  id: revision.project.id,
                  title: revision.project.title,
                  workflowId: revision.project.workflow_id,
                  revisionRoleSlug: typeof revision.project.working_state?.revisionRoleSlug === "string"
                    ? revision.project.working_state.revisionRoleSlug
                    : null,
                  artifactId: projectArtifact?.id ?? revision.project.active_artifact_id,
                  revisionId: revision.revision.id,
                  status: revision.project.status,
                  version: revision.project.version
                }
              });
            }
          } catch (err) {
            console.error("[runs/reply] project revision persist failed:", err);
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
