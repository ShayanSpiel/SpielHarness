import {
  appendChatMessages,
  appendProjectRevision,
  atomicCheckpoint,
  createFile,
  getProjectSession,
  getRun,
  instrumentSql,
  linkRunOutputFile,
  recordUsage,
  updateChatMetadata,
  type RunEventInput
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../../lib/workspace-data";
import { streamRun, streamDirectorRun, type RunCheckpoint } from "@spielos/graph";
import { buildPostgresSaver } from "@spielos/graph/director/checkpointer";
import { buildDirectorToolContext, workflowsForDirector } from "../../../../../lib/director-tools";
import { authDatabasePool } from "../../../../../lib/auth";
import { onRunSignal, registerRun } from "../../../../../lib/run-registry";

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
    const sql = instrumentSql(org.sql);
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
    if (definitionSnapshot.files) {
      resolved.runRequest.files = definitionSnapshot.files as typeof resolved.runRequest.files;
    }
    if (definitionSnapshot.connections) {
      resolved.runRequest.connections = definitionSnapshot.connections as typeof resolved.runRequest.connections;
    }
    if (definitionSnapshot.provider) {
      resolved.runRequest.provider = definitionSnapshot.provider as typeof resolved.runRequest.provider;
    }
    if (definitionSnapshot.model) {
      resolved.runRequest.model = definitionSnapshot.model as typeof resolved.runRequest.model;
    }
    const directorRuntimePolicy = (definitionSnapshot.directorRuntimePolicy
      ?? resolved.directorRuntimePolicy) as typeof resolved.directorRuntimePolicy;
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
      cancelRequestedAt: null,
      pauseRequestedAt: null,
      resumedAt: new Date().toISOString(),
      expectedCheckpointVersion: Number(run.checkpoint_version ?? 0)
    });
    let checkpointVersion = initialCheckpoint.checkpointVersion;

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Resumed executions are durable too: a reload detaches this reader,
        // while an explicit /cancel request remains the cancellation authority.
        let clientConnected = !request.signal.aborted;
        const send = (value: unknown) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encoder.encode(frame(value)));
          } catch {
            clientConnected = false;
          }
        };
        const disconnectClient = () => { clientConnected = false; };
        request.signal.addEventListener("abort", disconnectClient, { once: true });
        send({ kind: "run", runId, type: target.type });
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
          send({
            kind: "usage",
            usage: {
              inputTokens: priorUsage.input + usage.input,
              outputTokens: priorUsage.output + usage.output,
              toolCalls: priorUsage.tools + usage.tools
            }
          });
        };
        const onToolUsage = (count: number) => {
          const next = priorUsage.tools + usage.tools + count;
          const maximum = checkpoint.budget?.maxToolCalls;
          if (maximum && next > maximum) throw new Error(`Tool-call budget exceeded (${maximum}).`);
          usage.tools += count;
          send({
            kind: "usage",
            usage: {
              inputTokens: priorUsage.input + usage.input,
              outputTokens: priorUsage.output + usage.output,
              toolCalls: priorUsage.tools + usage.tools
            }
          });
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
        const executionController = new AbortController();
        let durableCancel = false;
        let durablePause = false;
        const unregister = registerRun(runId, executionController);
        const removeSignalListener = onRunSignal(runId, (reason) => {
          if (reason === "cancel") {
            durableCancel = true;
            if (!executionController.signal.aborted) executionController.abort("cancel");
          } else if (reason === "pause") {
            durablePause = true;
          }
        });
        const checkControl = (): "cancel" | "pause" | null => {
          if (durableCancel || executionController.signal.aborted) return "cancel";
          if (durablePause) return "pause";
          return null;
        };

        try {
          const isDirector = previousInputs.executionMode === "director" && target.type === "chat";
          const snapshottedWorkflows = definitionSnapshot.workflows
            ? definitionSnapshot.workflows as typeof resolved.workflows
            : resolved.workflows;
          const snapshottedEvals = definitionSnapshot.evals
            ? definitionSnapshot.evals as typeof resolved.evals
            : resolved.evals;
          const directorCheckpointer = isDirector
            ? await buildPostgresSaver(process.env.DATABASE_URL?.trim() || null, "public", authDatabasePool)
            : null;
          const iterator = isDirector
            ? streamDirectorRun({
                ...resolved.runRequest,
                runId,
                directorPrompt: resolved.directorPrompt,
                history: undefined,
                chatMetadata: {},
                goal: executeBody.goal,
                budget: resolved.runRequest.budget,
                onUsage,
                onToolUsage,
                signal: executionController.signal,
                checkControl,
                directorThreadId: run.chat_id ?? runId,
                directorCheckpointer,
                directorResume: controlAction ? undefined : { requestId: body.requestId, answers: resumeAnswers },
                directorWorkflows: workflowsForDirector(snapshottedWorkflows),
                directorEvals: snapshottedEvals,
                directorToolContext: buildDirectorToolContext({
                  sql,
                  orgId: org.orgId,
                  userId: org.userId,
                  chatId: run.chat_id ?? null,
                  turnId: run.turn_id ?? null,
                  parentRunId: runId,
                  projectId: run.project_id ?? null,
                  roles: resolved.runRequest.roles,
                  skills: resolved.runRequest.skills,
                  workflows: snapshottedWorkflows,
                  evals: snapshottedEvals,
                  provider: resolved.runRequest.provider,
                  model: resolved.runRequest.model,
                  files: resolved.runRequest.files,
                  searchableFiles: resolved.directorSearchFiles,
                  workspaceInstructions: resolved.runRequest.workspaceInstructions ?? [],
                  memories: resolved.runRequest.memories ?? [],
                  connections: resolved.runRequest.connections,
                  harnessFileAction: resolved.runRequest.harnessFileAction,
                  memoryProposalAction: resolved.runRequest.memoryProposalAction,
                  runtimePolicy: directorRuntimePolicy,
                  signal: executionController.signal
                })
              })
            : streamRun({
                ...resolved.runRequest,
                runId,
                resume: resumeAnswers,
                checkpoint,
                goal: executeBody.goal,
                budget: resolved.runRequest.budget,
                onUsage,
                onToolUsage,
                signal: executionController.signal,
                checkControl
              });
          for await (const item of iterator) {
            if (item.kind === "text") {
              outputText += item.text;
              send({ kind: "text", text: item.text });
            } else if (item.kind === "status") {
              send({ kind: "status", message: item.message });
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
                  payload: item.event.payload ?? {},
                  event_key: item.event.id
                });
                if (queuedEvents.length >= 12 || shouldPersistImmediately(item.event)) await flushAtomicCheckpoint();
              }
              send({ kind: "event", event: item.event });
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
              send({ kind: "artifact", artifact: item.artifact });
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              send({ kind: "human_input", request: item.request });
            } else if (item.kind === "checkpoint") {
              latestCheckpoint = item.state;
              await flushAtomicCheckpoint(latestCheckpoint);
              send({
                kind: "run_state",
                state: {
                  goal: latestCheckpoint.goal,
                  budget: latestCheckpoint.budget,
                  progress: latestCheckpoint.progress,
                  verification: latestCheckpoint.verification
                }
              });
            } else if (item.kind === "done") {
              const allowed = ["completed", "failed", "cancelled", "waiting_human"] as const;
              terminalStatus = allowed.includes(item.status as (typeof allowed)[number])
                ? (item.status as (typeof allowed)[number])
                : "completed";
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Resume failed";
          const durable = await getRun(sql, org.orgId, runId);
          if (durableCancel || executionController.signal.aborted || durable?.cancel_requested_at) {
            terminalStatus = "cancelled";
            errorMessage = null;
            if (durable?.state) latestCheckpoint = durable.state as RunCheckpoint;
          } else if (durablePause || durable?.pause_requested_at) {
            terminalStatus = "waiting_human";
            errorMessage = null;
            if (durable?.state) latestCheckpoint = durable.state as RunCheckpoint;
          } else {
            terminalStatus = "failed";
            send({ kind: "error", message: errorMessage });
          }
        } finally {
          request.signal.removeEventListener("abort", disconnectClient);
          unregister();
          removeSignalListener();
          try { await flushAtomicCheckpoint(); } catch { /* logged by final persistence */ }
        }

        let completedAt =
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

        // Preserve a concurrent durable cancel/pause and finalize through the
        // same atomic persistence authority used by the initial execution.
        const finalRun = await getRun(sql, org.orgId, runId);
        if (finalRun?.cancel_requested_at || finalRun?.status === "cancelled") {
          terminalStatus = "cancelled";
          errorMessage = null;
          if (finalRun.state) latestCheckpoint = finalRun.state as RunCheckpoint;
        } else if (finalRun?.pause_requested_at || finalRun?.status === "waiting_human") {
          terminalStatus = "waiting_human";
          errorMessage = null;
          completedAt = null;
          if (finalRun.state) latestCheckpoint = finalRun.state as RunCheckpoint;
        }
        const finalCheckpointVersion = Number(finalRun?.checkpoint_version ?? checkpointVersion);
        const finalEvents = queuedEvents.splice(0, queuedEvents.length);
        try {
          const finalResult = await atomicCheckpoint(org.sql, org.orgId, runId, {
            events: finalEvents,
            state: latestCheckpoint,
            outputs: { text: outputText },
            status: terminalStatus,
            error: errorMessage,
            completedAt,
            expectedCheckpointVersion: finalCheckpointVersion
          });
          checkpointVersion = finalResult.checkpointVersion;
        } catch (finalError) {
          const latest = await getRun(sql, org.orgId, runId);
          if (latest?.cancel_requested_at || latest?.status === "cancelled") {
            terminalStatus = "cancelled";
            errorMessage = null;
          } else if (latest?.pause_requested_at || latest?.status === "waiting_human") {
            terminalStatus = "waiting_human";
            errorMessage = null;
            completedAt = null;
          }
          try {
            const retryResult = await atomicCheckpoint(org.sql, org.orgId, runId, {
              events: finalEvents,
              state: latestCheckpoint,
              outputs: { text: outputText },
              status: terminalStatus,
              error: errorMessage,
              completedAt,
              expectedCheckpointVersion: Number(latest?.checkpoint_version ?? finalCheckpointVersion)
            });
            checkpointVersion = retryResult.checkpointVersion;
          } catch (retryError) {
            console.error("[runs/reply] final atomic checkpoint failed:", finalError, retryError);
          }
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

        if (run.chat_id) {
          await updateChatMetadata(org.sql, org.orgId, run.chat_id, {
            activeRunId: terminalStatus === "waiting_human" ? runId : null,
            lastRunId: runId
          });
        }

        send({
          kind: "run_state",
          state: {
            goal: latestCheckpoint.goal,
            budget: latestCheckpoint.budget,
            progress: latestCheckpoint.progress,
            verification: latestCheckpoint.verification
          }
        });

        send({ kind: "done", runId, status: terminalStatus });
        if (clientConnected) {
          try { controller.close(); } catch { /* reader detached */ }
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
