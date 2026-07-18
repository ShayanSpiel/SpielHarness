import {
  atomicCheckpoint,
  appendChatMessage,
  appendChatMessages,
  appendProjectRevision,
  createProjectSession,
  createChat,
  createFile,
  createRun,
  getChat,
  getProjectSession,
  getRun,
  instrumentSql,
  linkRunInputFiles,
  linkRunOutputFile,
  recordUsage,
  updateChatMetadata,
  upsertRunMetrics,
  CheckpointVersionMismatch,
  type InstrumentedSql,
  type RunEventInput
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../lib/workspace-data";
import { streamChatRun, streamRun, streamDirectorRun, type RunCheckpoint, type RunYield } from "@spielos/graph";
import { buildPostgresSaver } from "@spielos/graph/director/checkpointer";
import { registerRun, onRunSignal } from "../../../../lib/run-registry";
import { publishDomainEvent } from "../../../../lib/realtime";
import { buildDirectorToolContext, workflowsForDirector } from "../../../../lib/director-tools";
import { authDatabasePool } from "../../../../lib/auth";
import type { RunEvent, RunStatus, ExecutionMode } from "@spielos/core";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  const reqStart = performance.now();
  try {
    const org = await getOrg();
    requireWrite(org);
    const authMs = performance.now() - reqStart;

    const sql = instrumentSql(org.sql);

    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existing = await sql<{ id: string; status: string }[]>`
        select id, status from runs
        where org_id = ${org.orgId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (existing.length > 0) {
        throw new HttpError(409, `Run already exists (${existing[0].id}, ${existing[0].status}).`);
      }
    }

    const chatId: string | null = body.chatId ?? null;
    // A turn id is created before execution and persists on the user request,
    // execution anchor, run, artifacts, and final reply. It is deliberately
    // distinct from a chat message id: a single turn can own several messages
    // and child runs while still rendering as one compact activity surface.
    const turnId = chatId ? crypto.randomUUID() : null;
    const instrumentedOrg = { ...org, sql };
    const [resolved] = await Promise.all([
      resolveExecution(instrumentedOrg, body),
      chatId
        ? createChat(sql, org.orgId, chatId, body.prompt.trim().slice(0, 80) || "New chat")
        : Promise.resolve(null)
    ]);
    const harnessResolutionMs = performance.now() - reqStart - authMs;
    let project = body.projectId
      ? await getProjectSession(sql, org.orgId, body.projectId)
      : null;
    if (body.projectId && !project) throw new HttpError(404, "Active project not found.");
    if (!project && chatId && resolved.type === "workflow" && resolved.runRequest.workflow) {
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

    const run = await createRun(sql, org.orgId, {
      chatId,
      workflowId: resolved.target.type === "workflow" ? resolved.target.id : null,
      turnId,
      executionKind: resolved.type === "workflow" ? "workflow" : "orchestrator",
      projectId: project?.id ?? null,
      type: resolved.type,
      prompt: body.prompt,
      inputs: {
        target: resolved.target,
        contextFileIds: resolved.contextFileIds,
        modelId: body.modelId ?? null,
        reasoningEffort: body.reasoningEffort ?? null,
        goal: body.goal ?? { objective: body.prompt, constraints: [], successCriteria: ["Return a grounded result."] },
        budget: resolved.runRequest.budget ?? {},
        projectId: project?.id ?? null,
        executionMode: resolved.executionMode,
        suggestedHarnessRefs: resolved.suggestedHarnessRefs
      },
      definitionSnapshot: {
        target: resolved.target,
        workflow: resolved.runRequest.workflow,
        singleNode: resolved.runRequest.singleNode,
        roles: resolved.runRequest.roles,
        skills: resolved.runRequest.skills,
        workspaceInstructions: resolved.runRequest.workspaceInstructions,
        memories: resolved.runRequest.memories,
        files: resolved.runRequest.files,
        connections: resolved.runRequest.connections,
        workflows: resolved.workflows,
        evals: resolved.evals,
        provider: resolved.runRequest.provider,
        model: resolved.runRequest.model,
        directorRuntimePolicy: resolved.directorRuntimePolicy
      },
      idempotencyKey
    });
    const runCreationMs = performance.now() - reqStart - authMs - harnessResolutionMs;
    const chat = chatId ? await getChat(sql, org.orgId, chatId) : null;

    if (resolved.contextFileIds.length > 0) {
      await linkRunInputFiles(sql, org.orgId, run.id, resolved.contextFileIds);
    }
    if (chatId && turnId) {
      await appendChatMessages(sql, org.orgId, chatId, [
        { role: "user", body: body.prompt, metadata: { runId: run.id, turnId, kind: "user_request" } },
        // This renderer-owned assistant message is a durable UI anchor, not
        // model text. It deliberately has non-empty content because the chat
        // runtime drops empty messages while hydrating a saved conversation.
        // The chat renderer recognizes its envelope and mounts the compact
        // native run card under this exact turn after a reload.
        { role: "assistant", body: "[execution_anchor]", metadata: { runId: run.id, turnId, kind: "execution_anchor" } }
      ]);
      await updateChatMetadata(sql, org.orgId, chatId, {
        activeRunId: run.id,
        lastRunId: run.id,
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
      });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // The HTTP reader is only a viewer of the durable run. Navigating or
        // reloading may detach that viewer, but must not cancel the LangGraph
        // execution. Explicit cancellation travels through /cancel instead.
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
        let firstByteSent = false;
        send({ kind: "run", runId: run.id, type: resolved.type });
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
              toolCalls: 0,
              startedAt,
              deadlineAt: maxDurationMs ? new Date(Date.parse(startedAt) + maxDurationMs).toISOString() : null
            }
          }
        });
        let outputText = "";
        let terminalStatus: RunStatus = "completed";
        let errorMessage: string | null = null;
        const outputFiles: Array<{ id: string; isProject: boolean }> = [];
        let checkpoint: RunCheckpoint | null = null;
        let compaction: Record<string, unknown> | null = null;
        let longHorizon: Record<string, unknown> | null = null;
        let compactionMs = 0;
        let inputTokensEstimate = 0;
        let systemPromptTokensEstimate = 0;
        const providerStart = performance.now();
        let firstProviderByteAt: number | null = null;
        let firstClientByteAt: number | null = null;
        let eventPersistMs = 0;
        const usage = { input: 0, output: 0, tools: 0 };
        const billableUsage = { input: 0, output: 0 };
        const onUsage = (next: { input: number; output: number }) => {
          if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
          billableUsage.input += next.input;
          billableUsage.output += next.output;
          usage.input += next.input;
          usage.output += next.output;
          send({
            kind: "usage",
            usage: { inputTokens: usage.input, outputTokens: usage.output, toolCalls: usage.tools }
          });
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
            usage: { inputTokens: usage.input, outputTokens: usage.output, toolCalls: usage.tools }
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
        let checkpointVersion = Number(run.checkpoint_version ?? 0);
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
              onUsage,
              onToolUsage,
              signal: executionController.signal,
              checkControl,
              directorThreadId: chatId ?? run.id,
              directorCheckpointer: await buildPostgresSaver(process.env.DATABASE_URL?.trim() || null, "public", authDatabasePool),
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
                onUsage,
                signal: executionController.signal,
                checkControl
              })
            : streamRun({ ...resolved.runRequest, runId: run.id, chatMetadata: chat?.metadata ?? {}, goal: body.goal, budget: resolved.runRequest.budget, onUsage, onToolUsage, onEvent, signal: executionController.signal, checkControl });

          for await (const item of gen) {
            if (!firstByteSent) {
              firstByteSent = true;
              if (firstProviderByteAt === null) firstProviderByteAt = performance.now();
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
                compaction = {
                  summary: item.event.payload.summary,
                  compactedMessageCount: item.event.payload.compactedMessageCount,
                  createdAt: item.event.payload.createdAt
                };
                const compactionEventStart = performance.now();
                compactionMs = Math.max(compactionMs, compactionEventStart - providerStart);
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
                const file = await createFile(sql, org.orgId, {
                  title: item.artifact.title,
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
              checkpoint = item.state;
              await flushAtomicCheckpoint(checkpoint);
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
              const allowed: RunStatus[] = ["running", "waiting_human", "completed", "failed", "cancelled"];
              terminalStatus = (allowed.includes(item.status as RunStatus) ? item.status : "completed") as RunStatus;
              publishDomainEvent(`run:${run.id}`, {
                type: "run.status.changed",
                orgId: org.orgId,
                runId: run.id,
                status: terminalStatus,
                checkpointVersion,
                ts: new Date().toISOString()
              });
            }
          }
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
          try { await flushAtomicCheckpoint(); } catch { /* logged inside */ }
        }

        const completedAt =
          terminalStatus === "completed" || terminalStatus === "failed" || terminalStatus === "cancelled"
            ? new Date().toISOString()
            : null;

        if (checkpoint?.budget) {
          checkpoint = {
            ...checkpoint,
            budget: {
              ...checkpoint.budget,
              inputTokens: usage.input || checkpoint.budget.inputTokens,
              outputTokens: usage.output || checkpoint.budget.outputTokens,
              toolCalls: Math.max(usage.tools, checkpoint.budget.toolCalls)
            }
          };
        }

        const finalizeStart = performance.now();
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

        // Final atomic checkpoint: bundles the final state, outputs,
        // status, and any remaining events in one transaction. On a
        // process crash here, the next call to getRun sees the prior
        // checkpoint and the next atomicCheckpoint picks up from there.
        // Re-read the current checkpoint version from DB so a concurrent
        // cancel (which bumps the version via its own atomicCheckpoint)
        // doesn't cause a CheckpointVersionMismatch.
        const finalRun = await getRun(sql, org.orgId, run.id);
        if (finalRun?.cancel_requested_at || finalRun?.status === "cancelled") {
          terminalStatus = "cancelled";
          errorMessage = null;
          if (finalRun.state) checkpoint = finalRun.state as RunCheckpoint;
          // The cancel endpoint already persisted the authoritative terminal
          // event. Do not append buffered activity after that event.
          queuedEvents.length = 0;
        } else if (finalRun?.pause_requested_at || finalRun?.status === "waiting_human") {
          terminalStatus = "waiting_human";
          errorMessage = null;
          if (finalRun.state) checkpoint = finalRun.state as RunCheckpoint;
        }
        const finalCheckpointVersion = Number(finalRun?.checkpoint_version ?? checkpointVersion);
        const finalEvents = queuedEvents.splice(0, queuedEvents.length);
        try {
          const finalResult = await atomicCheckpoint(sql, org.orgId, run.id, {
            events: finalEvents,
            state: { ...(checkpoint ?? {}), _timings: timings },
            outputs: { text: outputText },
            status: terminalStatus,
            error: errorMessage,
            completedAt,
            expectedCheckpointVersion: finalCheckpointVersion
          });
          checkpointVersion = finalResult.checkpointVersion;
        } catch (finalError) {
          // A concurrent durable control write may advance the optimistic
          // version between the pre-final read and this transaction. Re-read
          // once, preserve its authoritative terminal/waiting state, and retry
          // through the same atomic persistence authority.
          const latest = await getRun(sql, org.orgId, run.id);
          if (latest?.cancel_requested_at || latest?.status === "cancelled") {
            terminalStatus = "cancelled";
            errorMessage = null;
          } else if (latest?.pause_requested_at || latest?.status === "waiting_human") {
            terminalStatus = "waiting_human";
            errorMessage = null;
          }
          try {
            const retryResult = await atomicCheckpoint(sql, org.orgId, run.id, {
              events: finalEvents,
              state: { ...(checkpoint ?? {}), _timings: timings },
              outputs: { text: outputText },
              status: terminalStatus,
              error: errorMessage,
              completedAt: terminalStatus === "waiting_human" ? null : completedAt,
              expectedCheckpointVersion: Number(latest?.checkpoint_version ?? finalCheckpointVersion)
            });
            checkpointVersion = retryResult.checkpointVersion;
          } catch (retryError) {
            console.error("[runs/execute] final atomic checkpoint failed:", finalError, retryError);
          }
        }
        if (chatId && compaction && resolved.type === "chat") {
          await updateChatMetadata(sql, org.orgId, chatId, { compaction });
        }
        const durableLongHorizon = checkpoint?.longHorizon ?? (longHorizon ? {
          pinnedState: longHorizon.pinnedState,
          milestones: longHorizon.milestones
        } : null);
        if (chatId && durableLongHorizon) {
          await updateChatMetadata(sql, org.orgId, chatId, {
            pinnedState: durableLongHorizon.pinnedState,
            milestones: durableLongHorizon.milestones
          });
        }
        if (chatId) {
          await updateChatMetadata(sql, org.orgId, chatId, {
            // Only resumable runs are active. Keeping failed or cancelled ids
            // here made a later chat hydration present a terminal run as live.
            activeRunId: terminalStatus === "waiting_human" ? run.id : null,
            lastRunId: run.id
          });
        }
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

        if (
          resolved.runRequest.provider &&
          resolved.runRequest.model
        ) {
          try {
            await recordUsage(sql, org.orgId, {
              runId: run.id,
              provider: resolved.runRequest.provider.name,
              model: resolved.runRequest.model.model,
              inputTokens: billableUsage.input || usage.input || checkpoint?.budget?.inputTokens || 0,
              outputTokens: billableUsage.output || usage.output || checkpoint?.budget?.outputTokens || 0,
              costMicros: 0
            });
          } catch (err) {
            console.warn("[runs/execute] usage record failed:", err);
          }
        }

        if (chatId && outputText) {
          try {
            await appendChatMessage(sql, org.orgId, chatId, "assistant", outputText, {
              runId: run.id,
              turnId,
              kind: "assistant_reply",
              ...(isDirectorChat ? { executionMode: "director" } : {})
            });
          } catch (err) {
            console.warn("[runs/execute] chat persist failed:", err);
          }
        }

        const runFinalizeMs = performance.now() - finalizeStart;
        try {
          await upsertRunMetrics(sql, {
            run_id: run.id,
            org_id: org.orgId,
            type: resolved.type,
            status: terminalStatus,
            auth_ms: authMs,
            harness_resolution_ms: harnessResolutionMs,
            run_creation_ms: runCreationMs,
            file_load_ms: 0,
            file_parse_ms: 0,
            compaction_ms: compactionMs,
            provider_ttft_ms: providerTtftMs,
            first_byte_to_client_ms: firstByteToClientMs,
            event_persist_ms: eventPersistMs,
            run_finalize_ms: runFinalizeMs,
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

        send({ kind: "done", runId: run.id, status: terminalStatus });
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
