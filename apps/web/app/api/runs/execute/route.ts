import {
  appendProjectRevision,
  atomicCheckpoint,
  CheckpointVersionMismatch,
  createInitialTurn,
  createProjectSession,
  createFile,
  finalizeRunTurn,
  findRunByIdempotency,
  getChat,
  getProjectSession,
  getRun,
  instrumentSql,
  linkRunInputFiles,
  linkRunOutputFile,
  listChatMessages,
  recordUsage,
  upsertRunMetrics,
  updateChatMetadata,
  type ChatMessageRow,
  type ChatRow,
  type InstrumentedSql,
  type RunEventInput,
  type RunRow
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../lib/workspace-data";
import { streamChatRun, streamRun, streamDirectorRun, type RunCheckpoint, type RunYield } from "@spielos/graph";
import { buildPostgresSaver } from "@spielos/graph/director/checkpointer";
import { registerRun, onRunSignal } from "../../../../lib/run-registry";
import { publishDomainEvent } from "../../../../lib/realtime";
import { buildDirectorToolContext, workflowsForDirector } from "../../../../lib/director-tools";
import { chatRowToChat, messageRowToChatMessage, encodeSseFrame } from "@spielos/core";
import type { ModelUsageUpdate, RunEvent, RunStatus, RunType, ExecutionMode, SseFrame } from "@spielos/core";
import { makeReqLogger, generateRequestId } from "../../../../lib/logger";
import { getDbManager, classifyConnectionError } from "../../../../lib/db-manager";

function replayRunResponse(
  run: RunRow,
  chat: ChatRow | null,
  messages: ChatMessageRow[],
): Response {
  const checkpointVersion = Number(run.checkpoint_version ?? 0);
  let streamSequence = 0;
  const stream = new ReadableStream({
    start(controller) {
      const send = (frame: SseFrame) => controller.enqueue(encodeSseFrame(frame, checkpointVersion, {
        streamId: run.id,
        streamSequence: streamSequence++,
      }));
      send({ kind: "run", runId: run.id, type: run.type as RunType, chatId: run.chat_id, turnId: run.turn_id });
      if (chat) send({ kind: "chat_created", chatId: chat.id, chat: chatRowToChat(chat) });
      for (const message of messages) {
        send({ kind: "message_persisted", chatId: message.chat_id, message: messageRowToChatMessage(message), runId: run.id });
      }
      if (run.state && Object.keys(run.state).length > 0) send({ kind: "run_state", state: run.state });
      const status = ["running", "waiting_human", "completed", "failed", "cancelled"].includes(run.status)
        ? run.status as RunStatus
        : "failed";
      send({ kind: "done", runId: run.id, status });
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function contextUsageFromChat(
  metadata: Record<string, unknown> | null | undefined,
  selectedModelId: string | null,
): { inputTokens: number; outputTokens: number; modelId: string | null } {
  const value = metadata?.contextUsage;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { inputTokens: 0, outputTokens: 0, modelId: selectedModelId };
  }
  const record = value as Record<string, unknown>;
  const savedModelId = typeof record.modelId === "string" ? record.modelId : null;
  if (selectedModelId && savedModelId && selectedModelId !== savedModelId) {
    return { inputTokens: 0, outputTokens: 0, modelId: selectedModelId };
  }
  return {
    inputTokens: typeof record.inputTokens === "number" && Number.isFinite(record.inputTokens)
      ? Math.max(0, Math.floor(record.inputTokens))
      : 0,
    outputTokens: typeof record.outputTokens === "number" && Number.isFinite(record.outputTokens)
      ? Math.max(0, Math.floor(record.outputTokens))
      : 0,
    modelId: selectedModelId ?? savedModelId,
  };
}

export async function POST(request: Request) {
  const reqStart = performance.now();
  const rid = generateRequestId();
  const log = makeReqLogger("runs/execute", rid);
  try {
    log.info("POST /api/runs/execute starting");
    const org = await getOrg();
    requireWrite(org);
    const authMs = performance.now() - reqStart;

    const sql = instrumentSql(org.sql);

    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

    const chatId: string | null = body.chatId ?? null;
    const turnId = chatId ? crypto.randomUUID() : null;
    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey ?? null;
    const instrumentedOrg = { ...org, sql };

    if (idempotencyKey) {
      const replay = await findRunByIdempotency(sql, org.orgId, idempotencyKey);
      if (replay) {
        const replayChat = replay.chat_id ? await getChat(sql, org.orgId, replay.chat_id) : null;
        const replayMessages = replay.chat_id ? await listChatMessages(sql, org.orgId, replay.chat_id, { limit: 200 }) : [];
        return replayRunResponse(replay, replayChat, replayMessages);
      }
    }

    // Resolve execution using reads only (no partial writes)
    const resolved = await resolveExecution(instrumentedOrg, body);
    const harnessResolutionMs = performance.now() - reqStart - authMs;

    let project = body.projectId
      ? await getProjectSession(sql, org.orgId, body.projectId)
      : null;
    if (body.projectId && !project) throw new HttpError(404, "Active project not found.");
    if (!project && chatId && resolved.type === "workflow" && resolved.runRequest.workflow) {
      // Ensure chat exists before creating project session (FK constraint)
      await sql`insert into chats (id, org_id, title) values (${chatId}, ${org.orgId}, ${body.prompt.trim().slice(0, 80) || "New chat"}) on conflict (id) do nothing`;
      const revisionRoleSlug = typeof resolved.runRequest.workflow.metadata?.revisionRoleSlug === "string"
        ? resolved.runRequest.workflow.metadata.revisionRoleSlug
        : null;
      project = await createProjectSession(sql, org.orgId, {
        chatId,
        title: resolved.runRequest.workflow.name,
        workflowId: resolved.target.id,
        workingState: { revisionRoleSlug }
      });
    }

    // Atomic initial turn — chat, run, user message, and metadata in one
    // transaction. No execution-anchor assistant message is persisted.
    let initialTurn: import("@spielos/db").InitialTurnResult | null = null;
    if (chatId && turnId) {
      initialTurn = await createInitialTurn(sql, org.orgId, {
        chatId,
        title: body.prompt.trim().slice(0, 80) || "New chat",
        prompt: body.prompt,
        type: resolved.type,
        executionKind: resolved.type === "workflow" ? "workflow" : "orchestrator",
        turnId,
        inputs: {
          target: resolved.target,
          contextFileIds: resolved.contextFileIds,
          modelId: body.modelId ?? null,
          reasoningEffort: body.reasoningEffort ?? null,
          goal: body.goal ?? { objective: body.prompt, constraints: [], successCriteria: ["Return a grounded result."] },
          budget: resolved.runRequest.budget ?? {},
          contextLimits: resolved.runRequest.contextLimits ?? {},
          projectId: project?.id ?? null,
          executionMode: resolved.executionMode,
          suggestedHarnessRefs: resolved.suggestedHarnessRefs
        },
        definitionSnapshot: {
          version: 1,
          target: resolved.target,
          executionMode: resolved.executionMode,
          provider: resolved.runRequest.provider,
          model: resolved.runRequest.model,
          directorRuntimePolicy: resolved.directorRuntimePolicy,
          workflow: resolved.runRequest.workflow,
          singleNode: resolved.runRequest.singleNode,
          roles: resolved.runRequest.workflow
            ? filterReachableRoles(resolved.runRequest.roles, resolved.runRequest.workflow)
            : resolved.runRequest.singleNode && resolved.runRequest.singleNode.role
              ? { [resolved.runRequest.singleNode.role.id]: resolved.runRequest.singleNode.role }
              : {},
          skills: resolved.runRequest.workflow
            ? filterReachableSkills(resolved.runRequest.skills, resolved.runRequest.workflow)
            : resolved.runRequest.singleNode && resolved.runRequest.singleNode.skill
              ? { [resolved.runRequest.singleNode.skill.id]: resolved.runRequest.singleNode.skill }
              : {},
          workflows: resolved.executionMode === "director" ? resolved.workflows : {},
          evals: resolved.runRequest.singleNode?.kind === "eval" && resolved.runRequest.singleNode.evalFile
            ? { [resolved.runRequest.singleNode.evalFile.id]: resolved.runRequest.singleNode.evalFile }
            : {},
          files: resolved.runRequest.files,
          workspaceInstructions: resolved.runRequest.workspaceInstructions,
          memories: resolved.runRequest.memories,
          connections: resolved.runRequest.connections,
        },
        idempotencyKey,
        workflowId: resolved.target.type === "workflow" ? resolved.target.id : null,
        projectId: project?.id ?? null,
        chatMetadata: {
          executionMode: resolved.executionMode,
          modelId: body.modelId ?? null,
          reasoningEffort: body.reasoningEffort ?? "auto",
          contextItems: Array.isArray(body.chatContextItems)
            ? body.chatContextItems.flatMap((item) => {
                if (!item || typeof item.id !== "string" || typeof item.kind !== "string" || typeof item.title !== "string") return [];
                return [{ id: item.id, kind: item.kind, title: item.title }];
              })
            : [],
          ...(project ? {
            activeProject: {
              id: project.id,
              title: project.title,
              workflowId: project.workflow_id,
              revisionRoleSlug: typeof project.working_state?.revisionRoleSlug === "string"
                ? project.working_state.revisionRoleSlug
                : null,
              artifactId: project.active_artifact_id,
              revisionId: project.active_revision_id,
              status: project.status,
              version: project.version
            }
          } : {})
        }
      });
    }
    const runCreationMs = performance.now() - reqStart - authMs - harnessResolutionMs;
    const run = initialTurn?.run ?? (await getRun(sql, org.orgId, body.runId ?? ""));
    if (!run) throw new HttpError(500, "Run could not be created.");
    const chat = initialTurn?.chat ?? (chatId ? await getChat(sql, org.orgId, chatId) : null);
    const selectedModelId = resolved.runRequest.model?.id ?? null;
    const priorContextUsage = contextUsageFromChat(chat?.metadata, selectedModelId);

    if (initialTurn && !initialTurn.created) {
      const replayMessages = run.chat_id ? await listChatMessages(sql, org.orgId, run.chat_id, { limit: 200 }) : [];
      return replayRunResponse(run, chat, replayMessages);
    }

    if (resolved.contextFileIds.length > 0 && run) {
      await linkRunInputFiles(sql, org.orgId, run.id, resolved.contextFileIds);
    }


    const stream = new ReadableStream({
      async start(controller) {
        // The HTTP reader is only a viewer of the durable run. Navigating or
        // reloading may detach that viewer, but must not cancel the LangGraph
        // execution. Explicit cancellation travels through /cancel instead.
        let clientConnected = !request.signal.aborted;
        let checkpointVersion = Number(run.checkpoint_version ?? 0);
        let streamSequence = 0;
        const send = (frame: SseFrame) => {
          if (!clientConnected) return;
          try {
            controller.enqueue(encodeSseFrame(frame, checkpointVersion, {
              streamId: run.id,
              streamSequence: streamSequence++,
            }));
          } catch {
            clientConnected = false;
          }
        };
        const disconnectClient = () => { clientConnected = false; };
        request.signal.addEventListener("abort", disconnectClient, { once: true });
        let firstByteSent = false;
        send({ kind: "run", runId: run.id, type: resolved.type, chatId: run.chat_id, turnId: run.turn_id });
        send({ kind: "status", message: "Thinking\u2026" });
        const startedAt = new Date().toISOString();
        const maxDurationMs = resolved.runRequest.budget?.maxDurationMs ?? null;
        // This is the resolved, file-backed budget already persisted in the
        // run input. Send it before provider work begins so the inspector
        // never briefly substitutes the model's broader context window.
        send({
          kind: "run_state",
          state: {
            budget: {
              maxInputTokens: resolved.runRequest.budget?.maxInputTokens ?? null,
              maxOutputTokens: resolved.runRequest.budget?.maxOutputTokens ?? null,
              maxDurationMs,
              maxToolCalls: resolved.runRequest.budget?.maxToolCalls ?? null,
              inputTokens: 0,
              outputTokens: 0,
              contextInputTokens: priorContextUsage.inputTokens,
              contextOutputTokens: priorContextUsage.outputTokens,
              totalInputTokens: 0,
              totalOutputTokens: 0,
              contextModelId: priorContextUsage.modelId,
              toolCalls: 0,
              startedAt,
              deadlineAt: maxDurationMs ? new Date(Date.parse(startedAt) + maxDurationMs).toISOString() : null
            },
            context: {
              maxInputTokens: resolved.runRequest.contextLimits?.maxInputTokens ?? null,
              maxOutputTokens: resolved.runRequest.contextLimits?.maxOutputTokens ?? null,
            },
          }
        });

        if (initialTurn) {
          send({ kind: "chat_created", chatId: initialTurn.chat.id, chat: chatRowToChat(initialTurn.chat) });
          send({ kind: "message_persisted", chatId: initialTurn.chat.id, message: messageRowToChatMessage(initialTurn.userMessage), runId: run.id });
        }

        // Force HTTP chunk flush before the provider begins.  Without this,
        // Next.js's dev-server proxy may buffer all initial frames and only
        // deliver them when the stream ends, which prevents the client from
        // seeing any intermediate frames until the run is complete.
        try { controller.enqueue(new TextEncoder().encode(":flush\n\n")); } catch { /* */ }

        let outputText = "";
        let terminalStatus: RunStatus | null = null;
        let errorMessage: string | null = null;
        const outputFiles: Array<{ id: string; isProject: boolean }> = [];
        let checkpoint: RunCheckpoint | null = null;
        let longHorizon: Record<string, unknown> | null = null;
        let latestCompaction: Record<string, unknown> | null = null;
        let compactionMs = 0;
        let inputTokensEstimate = 0;
        let systemPromptTokensEstimate = 0;
        const providerStart = performance.now();
        let firstProviderByteAt: number | null = null;
        let firstClientByteAt: number | null = null;
        let eventPersistMs = 0;
        const usage = {
          input: 0,
          output: 0,
          tools: 0,
          contextInput: priorContextUsage.inputTokens,
          contextOutput: priorContextUsage.outputTokens,
          contextModelId: priorContextUsage.modelId,
        };
        const billableUsage = { input: 0, output: 0 };
        const checkpointWithUsage = (state: RunCheckpoint): RunCheckpoint => state.budget ? {
          ...state,
          budget: {
            ...state.budget,
            inputTokens: usage.input,
            outputTokens: usage.output,
            contextInputTokens: usage.contextInput,
            contextOutputTokens: usage.contextOutput,
            totalInputTokens: usage.input,
            totalOutputTokens: usage.output,
            contextModelId: usage.contextModelId,
            toolCalls: usage.tools
          }
        } : state;
        const publishBudgetState = () => {
          send({
            kind: "usage",
            usage: {
              inputTokens: usage.input,
              outputTokens: usage.output,
              toolCalls: usage.tools,
              contextInputTokens: usage.contextInput,
              contextOutputTokens: usage.contextOutput,
              totalInputTokens: usage.input,
              totalOutputTokens: usage.output,
              contextModelId: usage.contextModelId,
            }
          });
        };
        const onModelUsage = (update: ModelUsageUpdate) => {
          if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
          billableUsage.input += update.inputTokens;
          billableUsage.output += update.outputTokens;
          usage.input += update.inputTokens;
          usage.output += update.outputTokens;
          if (update.updatesContext) {
            usage.contextInput = update.inputTokens;
            usage.contextOutput = update.outputTokens;
            usage.contextModelId = update.modelId === "unknown" ? selectedModelId : update.modelId;
          }
          publishBudgetState();
          publishDomainEvent(`run:${run.id}`, {
            type: "run.usage.updated",
            orgId: org.orgId,
            runId: run.id,
            inputTokens: usage.input,
            outputTokens: usage.output,
            toolCalls: usage.tools,
            ts: new Date().toISOString()
          });
        };
        const onToolUsage = (count: number) => {
          if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
          const next = usage.tools + count;
          const maximum = resolved.runRequest.budget?.maxToolCalls;
          if (maximum && next > maximum) {
            throw new Error(`Tool-call budget exceeded (${maximum}).`);
          }
          usage.tools = next;
          send({
            kind: "usage",
            usage: {
              inputTokens: usage.input,
              outputTokens: usage.output,
              toolCalls: usage.tools,
              contextInputTokens: usage.contextInput,
              contextOutputTokens: usage.contextOutput,
              totalInputTokens: usage.input,
              totalOutputTokens: usage.output,
              contextModelId: usage.contextModelId,
            }
          });
        };
        const liveEventIds = new Set<string>();
        const queuedEventIds = new Set<string>();
        const queuedEvents: RunEventInput[] = [];
        const queueEvent = (event: RunEvent) => {
          if (queuedEventIds.has(event.id)) return;
          queuedEventIds.add(event.id);
          queuedEvents.push({
            event_type: event.type,
            node_id: event.nodeId ?? null,
            node_title: event.nodeTitle ?? null,
            skill_id: event.skillId ?? null,
            skill_name: event.skillName ?? null,
            message: event.message,
            payload: event.payload ?? {},
            event_key: event.id
          });
        };
        // Phase 2.5: events are persisted atomically with the run state.
        // `flushAtomicCheckpoint` drains the queue and bundles the events
        // with the current checkpoint state in a single transaction.
        // A crash anywhere in the transaction rolls everything back; the
        // next attempt re-reads the run row and resumes from the
        // authoritative `checkpoint_version`.
        const flushAtomicCheckpoint = async (stateOverride?: RunCheckpoint) => {
          if (queuedEvents.length === 0 && stateOverride === undefined) return;
          const batch = queuedEvents.splice(0, queuedEvents.length);
          const persistStart = performance.now();
          try {
            const result = await atomicCheckpoint(sql, org.orgId, run.id, {
              events: batch,
              state: stateOverride ?? checkpoint ?? undefined,
              expectedCheckpointVersion: checkpointVersion
            });
            checkpointVersion = result.checkpointVersion;
            eventPersistMs += performance.now() - persistStart;
            // Phase 3: refresh the in-memory durable flags from the row
            // we just locked. The atomic checkpoint took a `for update`
            // lock, so any cancel/pause written before this point is
            // now visible. This catches signals that arrived via the DB
            // from a different process or a stale connection.
            if (!durableCancel || !durablePause) {
              const refreshed = await getRun(sql, org.orgId, run.id);
              if (refreshed?.cancel_requested_at) durableCancel = true;
              if (refreshed?.pause_requested_at) durablePause = true;
            }
          } catch (checkpointError) {
            if (batch.length > 0) queuedEvents.unshift(...batch);
            if (checkpointError instanceof CheckpointVersionMismatch) {
              const latest = await getRun(sql, org.orgId, run.id);
              if (latest?.cancel_requested_at || latest?.status === "cancelled" || latest?.pause_requested_at || latest?.status === "waiting_human") {
                checkpointVersion = Number(latest.checkpoint_version ?? checkpointVersion);
                return;
              }
            }
            console.error("[runs/execute] atomic checkpoint failed:", checkpointError);
            throw checkpointError;
          }
        };
        const onEvent = (event: RunEvent) => {
          liveEventIds.add(event.id);
          queueEvent(event);
          send({ kind: "event", event });
          publishDomainEvent(`run:${run.id}`, {
            type: "run.event.appended",
            orgId: org.orgId,
            runId: run.id,
            eventId: event.id,
            eventType: event.type,
            ts: new Date().toISOString()
          });
        };
        const executionController = new AbortController();

        // Phase 3: register the controller so cancel/pause routes can
        // signal this run from another request. The local signal is the
        // fast path; the DB column is the durable record. We track the
        // durable flag in memory and refresh it on checkpoint flush.
        let durableCancel = Boolean(run.cancel_requested_at);
        let durablePause = Boolean(run.pause_requested_at);
        const unregister = registerRun(run.id, executionController);
        const signalListener = onRunSignal(run.id, (reason) => {
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

        const resolvedExecutionMode: ExecutionMode = resolved.executionMode;
        const isDirectorChat = resolvedExecutionMode === "director"
          && resolved.type === "chat"
          && !resolved.runRequest.singleNode;
        const systemPrompt = isDirectorChat
          ? resolved.directorPrompt
          : resolved.assistantPrompt;
        if (systemPrompt) {
          systemPromptTokensEstimate = Math.ceil(systemPrompt.length / 4);
        }
        if (Array.isArray(body.messages)) {
          inputTokensEstimate = body.messages.reduce((sum: number, m: { content?: string }) => {
            return sum + (typeof m?.content === "string" ? Math.ceil(m.content.length / 4) : 0);
          }, 0);
        }

        // The execution mode is the only top-level switch. The
        // direct branch is unchanged from before; the director
        // branch delegates to the deepagents-backed runtime for
        // chat turns with the file-backed Orchestrator role. The
        // director runtime owns the planning loop, subagent
        // delegation, write_todos, summarization, and LangGraph
        // interrupts. It uses the same SSE protocol and the same
        // RunYield shape; the route does not maintain a second
        // parser.
        try {
          const providerName = resolved.runRequest.provider?.name ?? "unknown";
          const modelName = resolved.runRequest.model?.model ?? "unknown";
          log.info("starting provider stream", {
            provider: providerName,
            model: modelName,
            mode: resolvedExecutionMode,
            type: resolved.type,
            singleNode: resolved.runRequest.singleNode,
            runId: run.id
          });
          const gen: AsyncGenerator<RunYield, void, void> = isDirectorChat
            ? streamDirectorRun({
              ...resolved.runRequest,
              runId: run.id,
              directorPrompt: resolved.directorPrompt,
              history: body.messages,
              previousCompaction: body.previousCompaction,
              chatMetadata: chat?.metadata ?? {},
              goal: body.goal,
              budget: resolved.runRequest.budget,
               onModelUsage,
               onToolUsage,
              signal: executionController.signal,
              checkControl,
              directorThreadId: chatId ?? run.id,
              directorCheckpointer: await buildPostgresSaver(process.env.DATABASE_URL?.trim() || null, "public"),
              directorWorkflows: workflowsForDirector(resolved.workflows),
              directorEvals: resolved.evals,
              directorToolContext: buildDirectorToolContext({
                sql,
                orgId: org.orgId,
                userId: org.userId,
                chatId: chatId ?? null,
                turnId,
                parentRunId: run.id,
                projectId: project?.id ?? null,
                roles: resolved.runRequest.roles,
                skills: resolved.runRequest.skills,
                workflows: resolved.workflows,
                evals: resolved.evals,
                provider: resolved.runRequest.provider,
                model: resolved.runRequest.model,
                files: resolved.runRequest.files,
                searchableFiles: resolved.directorSearchFiles,
                workspaceInstructions: resolved.runRequest.workspaceInstructions ?? [],
                memories: resolved.runRequest.memories ?? [],
                connections: resolved.runRequest.connections,
                harnessFileAction: resolved.runRequest.harnessFileAction,
                memoryProposalAction: resolved.runRequest.memoryProposalAction,
                runtimePolicy: resolved.directorRuntimePolicy,
                signal: executionController.signal
              })
            })
          : resolved.type === "chat" && !resolved.runRequest.singleNode
              ? streamChatRun({
                ...resolved.runRequest,
                runId: run.id,
                assistantPrompt: resolved.assistantPrompt,
                history: body.messages,
                previousCompaction: body.previousCompaction,
                chatMetadata: chat?.metadata ?? {},
                goal: body.goal,
                budget: resolved.runRequest.budget,
                onModelUsage,
                signal: executionController.signal,
                checkControl
              })
            : streamRun({
              ...resolved.runRequest,
              runId: run.id,
              chatMetadata: chat?.metadata ?? {},
              conversationHistory: body.messages,
              goal: body.goal,
              budget: resolved.runRequest.budget,
              onModelUsage,
              onToolUsage,
              onEvent,
              signal: executionController.signal,
              checkControl,
            });

          for await (const item of gen) {
            if (!firstByteSent) {
              firstByteSent = true;
              if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
              log.timing("first_byte_to_client", performance.now() - reqStart);
            }
            if (item.kind === "text") {
              if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
              outputText += item.text;
              if (firstClientByteAt === null) firstClientByteAt = performance.now();
              send({ kind: "text", text: item.text });
            } else if (item.kind === "status") {
              if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
              send({ kind: "status", message: item.message });
            } else if (item.kind === "event") {
              if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
              if (item.event.type === "status" && item.event.payload?.category === "compaction") {
                const compactionEventStart = performance.now();
                compactionMs = Math.max(compactionMs, compactionEventStart - providerStart);
                latestCompaction = {
                  compactedMessageCount: item.event.payload.compactedMessageCount ?? null,
                  summary: item.event.payload.summary ?? null,
                  cutoffIndex: item.event.payload.cutoffIndex ?? null,
                  historyPath: item.event.payload.historyPath ?? null,
                  updatedAt: item.event.payload.createdAt ?? new Date().toISOString(),
                };
              }
              if (item.event.type === "status" && item.event.payload?.category === "long_horizon") {
                longHorizon = item.event.payload as Record<string, unknown>;
              }
              queueEvent(item.event);
              if (!liveEventIds.has(item.event.id)) {
                send({ kind: "event", event: item.event });
                publishDomainEvent(`run:${run.id}`, {
                  type: "run.event.appended",
                  orgId: org.orgId,
                  runId: run.id,
                  eventId: item.event.id,
                  eventType: item.event.type,
                  ts: new Date().toISOString()
                });
              }
              if (queuedEvents.length >= 12) await flushAtomicCheckpoint();
            } else if (item.kind === "artifact") {
              send({ kind: "artifact", artifact: item.artifact });
              try {
                const artifactPath = typeof item.artifact.metadata?.path === "string" ? item.artifact.metadata.path : null;
                const file = await createFile(sql, org.orgId, {
                  title: artifactPath ? artifactPath.split("/").pop() ?? item.artifact.title : item.artifact.title,
                  body: item.artifact.body,
                  fileType: item.artifact.type === "artifact" ? "artifact" : item.artifact.type,
                  status: "active",
                  metadata: { ...item.artifact.metadata, runId: run.id, runtimeArtifactId: item.artifact.id, seedFolder: generatedFileFolder() }
                });
                await linkRunOutputFile(sql, org.orgId, run.id, file.id);
                outputFiles.push({
                  id: file.id,
                  isProject: item.artifact.metadata?.renderer === "project" || item.artifact.type === "artifact"
                });
              } catch (err) {
                console.error("[runs/execute] artifact persist failed:", err);
              }
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              send({ kind: "human_input", request: item.request });
            } else if (item.kind === "checkpoint") {
              checkpoint = checkpointWithUsage(item.state);
              // Plain Direct chat and Director chat already persist their
              // assistant turn atomically during finalization. Flushing the
              // same checkpoint here creates a second remote transaction on
              // the critical streaming path without improving recovery:
              // Direct chat has no resumable intermediate step, while
              // DeepAgents owns Director's native per-step checkpointer.
              // Graph workflows keep their intermediate checkpoints because
              // their nodes are independently resumable.
              if (resolved.type !== "chat" || resolved.runRequest.singleNode) {
                await flushAtomicCheckpoint(checkpoint);
              }
              send({
                kind: "run_state",
                state: {
                  goal: checkpoint.goal,
                  budget: checkpoint.budget,
                  progress: checkpoint.progress,
                  verification: checkpoint.verification
                }
              });
            } else if (item.kind === "done") {
              const doneAllowed = ["completed", "failed", "cancelled", "waiting_human"] as const;
              terminalStatus = doneAllowed.includes(item.status as (typeof doneAllowed)[number])
                ? (item.status as (typeof doneAllowed)[number])
                : "completed";
              log.info("provider stream done", { terminalStatus, runId: run.id });
            }
          }
          const streamDuration = performance.now() - providerStart;
          log.info("provider stream completed", { terminalStatus, durationMs: Math.round(streamDuration), runId: run.id });
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Run failed";
          const durable = await getRun(sql, org.orgId, run.id);
          if (durableCancel || executionController.signal.aborted) {
            terminalStatus = "cancelled";
            if (durable?.state) checkpoint = durable.state as RunCheckpoint;
            errorMessage = null;
          } else {
            terminalStatus = "failed";
            send({ kind: "error", message: errorMessage });
          }
        } finally {
          request.signal.removeEventListener("abort", disconnectClient);
          unregister();
          signalListener();
          // Best-effort drain. The final atomic checkpoint below is the
          // durable write; if this throws we still attempt the final one.
          if (resolved.type !== "chat" || resolved.runRequest.singleNode) {
            try { await flushAtomicCheckpoint(); } catch { /* logged inside */ }
          }
        }

        // Wrap remaining work so controller.close() always executes.
        // Even if finalization, usage recording, or pub-sub throws, the
        // client receives a clean stream-end signal instead of hanging.
        try {
        const completedAt =
          terminalStatus && ["completed", "failed", "cancelled"].includes(terminalStatus)
            ? new Date().toISOString()
            : null;

        if (checkpoint?.budget) {
          checkpoint = {
            ...checkpoint,
            budget: {
              ...checkpoint.budget,
              inputTokens: usage.input || checkpoint.budget.inputTokens,
              outputTokens: usage.output || checkpoint.budget.outputTokens,
              contextInputTokens: usage.contextInput || checkpoint.budget.contextInputTokens,
              contextOutputTokens: usage.contextOutput || checkpoint.budget.contextOutputTokens,
              totalInputTokens: usage.input || checkpoint.budget.totalInputTokens,
              totalOutputTokens: usage.output || checkpoint.budget.totalOutputTokens,
              contextModelId: usage.contextModelId ?? checkpoint.budget.contextModelId,
              toolCalls: Math.max(usage.tools, checkpoint.budget.toolCalls)
            }
          };
        }

        const counter = (sql as InstrumentedSql).__counter;
        const providerTtftMs = firstProviderByteAt !== null ? firstProviderByteAt - providerStart : 0;
        const firstByteToClientMs = firstClientByteAt !== null ? firstClientByteAt - providerStart : 0;
        const timings = {
          authMs,
          harnessResolutionMs,
          runCreationMs,
          totalMs: performance.now() - reqStart,
          dbQueryCount: counter?.count ?? 0,
          dbTotalMs: counter?.totalMs ?? 0,
          compactionMs,
          providerTtftMs,
          firstByteToClientMs,
          eventPersistMs,
          inputTokensEstimate,
          systemPromptTokensEstimate
        };

        // ── Atomic finalization ───────────────────────────────────────────
        if (terminalStatus === "failed" && !outputText.trim()) {
          const label = resolved.runRequest.workflow?.name
            ?? resolved.runRequest.singleNode?.title
            ?? (isDirectorChat ? "Director" : "Run");
          outputText = `${label} failed${errorMessage ? `: ${errorMessage}` : "."}`;
        }
        let finalTurnResult: {
          run: RunRow;
          messages: ChatMessageRow[];
          chat: ChatRow | null;
        } | null = null;

        if (chatId) {
          try {
            finalTurnResult = await finalizeRunTurn(
              sql, org.orgId, run.id, chatId, turnId, checkpointVersion,
              {
                outputText: outputText ?? "",
                events: queuedEvents.splice(0, queuedEvents.length),
                state: { ...(checkpoint ?? {}), _timings: timings },
                status: terminalStatus ?? "failed",
                error: errorMessage,
                completedAt: terminalStatus === "waiting_human" ? null : completedAt,
                isDirectorChat,
                longHorizon: checkpoint?.longHorizon ?? (longHorizon ? {
                  pinnedState: longHorizon.pinnedState,
                  milestones: longHorizon.milestones
                } : null),
                chatMetadata: {
                  contextUsage: {
                    inputTokens: usage.contextInput,
                    outputTokens: usage.contextOutput,
                    modelId: usage.contextModelId ?? selectedModelId,
                    updatedAt: new Date().toISOString(),
                  },
                  ...(latestCompaction ? { compaction: latestCompaction } : {}),
                },
              }
            );
            checkpointVersion = Number(finalTurnResult.run.checkpoint_version ?? checkpointVersion);
            terminalStatus = finalTurnResult.run.status as RunStatus;
          } catch (finalizeErr) {
            console.error("[runs/execute] finalizeRunTurn failed:", finalizeErr);
            errorMessage = finalizeErr instanceof Error ? finalizeErr.message : "Run finalization failed.";
            const durable = await getRun(sql, org.orgId, run.id);
            if (durable?.status === "cancelled") {
              terminalStatus = "cancelled";
              checkpointVersion = Number(durable.checkpoint_version ?? checkpointVersion);
            } else if (durable) {
              const failed = await atomicCheckpoint(sql, org.orgId, run.id, {
                status: "failed",
                error: errorMessage,
                completedAt: new Date().toISOString(),
                state: { ...(durable.state ?? {}), status: "failed", error: errorMessage },
                events: [{
                  event_type: "run_failed",
                  node_id: null,
                  node_title: null,
                  skill_id: null,
                  skill_name: null,
                  message: "Run finalization failed.",
                  payload: { phase: "finalization" },
                }],
                expectedCheckpointVersion: Number(durable.checkpoint_version ?? 0),
              });
              checkpointVersion = failed.checkpointVersion;
              terminalStatus = "failed";
            } else {
              terminalStatus = "failed";
            }
            send({ kind: "error", message: errorMessage });
          }
        } else {
          // No chat — finalize run state only
          const finalRun = await getRun(sql, org.orgId, run.id);
          if (finalRun?.cancel_requested_at || finalRun?.status === "cancelled") {
            terminalStatus = "cancelled";
            errorMessage = null;
            queuedEvents.length = 0;
          } else if (finalRun?.pause_requested_at || finalRun?.status === "waiting_human") {
            terminalStatus = "waiting_human";
            errorMessage = null;
          }
          const finalCheckpointVersion = Number(finalRun?.checkpoint_version ?? checkpointVersion);
          const finalEvents = queuedEvents.splice(0, queuedEvents.length);
          try {
            const finalResult = await atomicCheckpoint(sql, org.orgId, run.id, {
              events: finalEvents,
              state: { ...(checkpoint ?? {}), _timings: timings },
              outputs: { text: outputText },
              status: terminalStatus ?? "failed",
              error: errorMessage,
              completedAt,
              expectedCheckpointVersion: finalCheckpointVersion
            });
            checkpointVersion = finalResult.checkpointVersion;
          } catch (finalError) {
            console.error("[runs/execute] final atomic checkpoint failed (headless):", finalError);
          }
        }

        // ── Usage ledger (best-effort) ─────────────────────────────────────
        if (resolved.runRequest.provider && resolved.runRequest.model) {
          try {
            await recordUsage(sql, org.orgId, {
              runId: run.id,
              provider: resolved.runRequest.provider.name,
              model: resolved.runRequest.model.model,
              inputTokens: billableUsage.input,
              outputTokens: billableUsage.output,
              costMicros: 0
            });
          } catch (err) {
            console.warn("[runs/execute] usage record failed:", err);
          }
        }

        // ── Project revision (best-effort, after terminal consistency) ────
        if (chatId && project && outputFiles.length > 0) {
          try {
            const projectArtifact = outputFiles.find((file) => file.isProject) ?? outputFiles[0];
            const revision = await appendProjectRevision(sql, org.orgId, {
              projectId: project.id,
              expectedProjectVersion: project.version,
              runId: run.id,
              turnId,
              instruction: body.prompt,
              artifactIds: outputFiles.map((file) => file.id),
              author: resolved.type === "workflow" ? "workflow" : "orchestrator",
              projectStatus: terminalStatus === "waiting_human" ? "review" : terminalStatus === "completed" ? "active" : undefined
            });
            if (revision) {
              await updateChatMetadata(sql, org.orgId, chatId, {
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
            console.warn("[runs/execute] project revision persistence failed:", err);
          }
        }

        // ── Run metrics (best-effort) ─────────────────────────────────────
        log.info("request complete", {
          status: terminalStatus,
          totalMs: Math.round(timings.totalMs),
          authMs: Math.round(authMs),
          harnessMs: Math.round(harnessResolutionMs),
          runCreationMs: Math.round(runCreationMs),
          providerTtftMs: Math.round(providerTtftMs),
          firstByteToClientMs: Math.round(firstByteToClientMs),
          eventPersistMs: Math.round(eventPersistMs),
          compactionMs: Math.round(compactionMs),
          systemPromptTokensEstimate,
          inputTokensEstimate,
          dbQueries: counter?.count ?? 0,
          dbMs: Math.round(counter?.totalMs ?? 0),
          llmInputTokens: billableUsage.input,
          llmOutputTokens: billableUsage.output,
          runId: run.id,
          provider: resolved.runRequest.provider?.name,
          model: resolved.runRequest.model?.model
        });
        try {
          await upsertRunMetrics(sql, {
            run_id: run.id,
            org_id: org.orgId,
            type: resolved.type,
            status: terminalStatus ?? "failed",
            auth_ms: authMs,
            harness_resolution_ms: harnessResolutionMs,
            run_creation_ms: runCreationMs,
            file_load_ms: 0,
            file_parse_ms: 0,
            compaction_ms: compactionMs,
            provider_ttft_ms: providerTtftMs,
            first_byte_to_client_ms: firstByteToClientMs,
            event_persist_ms: eventPersistMs,
            run_finalize_ms: performance.now() - (reqStart + authMs + harnessResolutionMs + runCreationMs),
            total_ms: timings.totalMs,
            db_query_count: counter?.count ?? 0,
            db_total_ms: counter?.totalMs ?? 0,
            hidden_pre_stream_calls: 0,
            input_tokens_estimate: inputTokensEstimate,
            system_prompt_tokens_estimate: systemPromptTokensEstimate,
            provider_name: resolved.runRequest.provider?.name ?? null,
            model_name: resolved.runRequest.model?.model ?? null
          });
        } catch (metricsError) {
          console.warn("[runs/execute] run metrics persist failed:", metricsError);
        }

        // ── SSE frames ────────────────────────────────────────────────────
        const tSse0 = performance.now();
        const finalMsgs = finalTurnResult?.messages ?? [];
        for (const msg of finalMsgs) {
          send({ kind: "message_persisted", chatId: chatId!, message: messageRowToChatMessage(msg), runId: run.id });
        }
        log.info("step_after_complete__send_final_msgs", { ms: Math.round(performance.now() - tSse0) });

        const tGetChat = performance.now();
        if (chatId && finalTurnResult?.chat) {
          send({ kind: "chat_created", chatId, chat: chatRowToChat(finalTurnResult.chat) });
        }
        log.info("step_after_complete__getChat", { ms: Math.round(performance.now() - tGetChat) });

        const tRunState = performance.now();
        if (checkpoint) {
          send({
            kind: "run_state",
            state: {
              goal: checkpoint.goal,
              budget: checkpoint.budget,
              progress: checkpoint.progress,
              verification: checkpoint.verification
            }
          });
        }

        publishDomainEvent(`run:${run.id}`, {
          type: "run.status.changed",
          orgId: org.orgId,
          runId: run.id,
          status: terminalStatus ?? "failed",
          checkpointVersion,
          ts: new Date().toISOString()
        });
        log.info("step_after_complete__publish_done", { ms: Math.round(performance.now() - tRunState) });

        const tDone = performance.now();
        send({ kind: "done", runId: run.id, status: terminalStatus ?? "failed" });
        log.info("step_after_complete__send_done", { ms: Math.round(performance.now() - tDone) });
      } catch (finalizeErr) {
        console.error("[runs/execute] post-provider finalization failed:", finalizeErr);
        terminalStatus = terminalStatus === "running" || !terminalStatus ? "failed" : terminalStatus;
        send({ kind: "done", runId: run.id, status: terminalStatus ?? "failed" });
      } finally {
        const tClose = performance.now();
        // Yield to the event loop so the enqueued done frame flushes through
        // the HTTP layer before close() signals stream end. Without this
        // delay, controller.close() can finalize the stream before the last
        // enqueued chunk is delivered to the consumer, causing the client to
        // never see the done frame (terminalStatus stays null on the client).
        await new Promise((r) => setTimeout(r, 200));
        try { controller.close(); } catch { /* reader detached */ }
        log.info("step_after_complete__controller_close", { ms: Math.round(performance.now() - tClose) });
      }
    }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (err) {
    const ms = Math.round(performance.now() - reqStart);
    if (err instanceof HttpError) {
      log.warn(`${err.status} ${err.message}`, { ms });
    } else {
      log.error(`POST failed: ${err instanceof Error ? err.message : String(err)}`, { ms });
      const classified = classifyConnectionError(err);
      if (classified.status === 503) {
        getDbManager().invalidate();
      }
    }
    return errorResponse(err);
  }
}

// ── Snapshot helpers ──────────────────────────────────────────────

function filterReachableRoles(
  allRoles: Record<string, import("@spielos/core").Role>,
  workflow: import("@spielos/core").WorkflowFile
): Record<string, import("@spielos/core").Role> {
  const reachable = new Set(workflow.nodes.map((n) => n.roleId));
  const out: Record<string, import("@spielos/core").Role> = {};
  for (const [id, role] of Object.entries(allRoles)) {
    if (reachable.has(id)) out[id] = role;
  }
  return out;
}

function filterReachableSkills(
  allSkills: Record<string, import("@spielos/core").Skill>,
  workflow: import("@spielos/core").WorkflowFile
): Record<string, import("@spielos/core").Skill> {
  const reachable = new Set(workflow.nodes.flatMap((n) => n.skillIds));
  const out: Record<string, import("@spielos/core").Skill> = {};
  for (const [id, skill] of Object.entries(allSkills)) {
    if (reachable.has(id)) out[id] = skill;
  }
  return out;
}
