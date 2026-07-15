import {
  appendChatMessage,
  appendRunEvents,
  createChat,
  createFile,
  createRun,
  getRun,
  linkRunInputFiles,
  linkRunOutputFile,
  recordUsage,
  updateChatMetadata,
  updateRun
} from "@spielos/db";
import { errorResponse, getOrg, HttpError, requireWrite } from "../../../../lib/server";
import { resolveExecution, type ExecuteBody } from "../../../../lib/execution-service";
import { generatedFileFolder } from "../../../../lib/workspace-data";
import { streamChatRun, streamRun, type RunCheckpoint, type RunYield } from "@spielos/graph";
import type { RunEvent, RunStatus } from "@spielos/core";

function frame(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function POST(request: Request) {
  try {
    const org = await getOrg();
    requireWrite(org);

    const body = (await request.json()) as ExecuteBody;
    if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

    const idempotencyKey = request.headers.get("idempotency-key") ?? body.idempotencyKey ?? null;
    if (idempotencyKey) {
      const existing = await org.sql<{ id: string; status: string }[]>`
        select id, status from runs
        where org_id = ${org.orgId} and idempotency_key = ${idempotencyKey}
        limit 1
      `;
      if (existing.length > 0) {
        throw new HttpError(409, `Run already exists (${existing[0].id}, ${existing[0].status}).`);
      }
    }

    const chatId: string | null = body.chatId ?? null;
    const [resolved] = await Promise.all([
      resolveExecution(org, body),
      chatId
        ? createChat(org.sql, org.orgId, chatId, body.prompt.trim().slice(0, 80) || "New chat")
        : Promise.resolve(null)
    ]);

    const run = await createRun(org.sql, org.orgId, {
      chatId,
      workflowId: resolved.target.type === "workflow" ? resolved.target.id : null,
      type: resolved.type,
      prompt: body.prompt,
      inputs: {
        target: resolved.target,
        contextFileIds: resolved.contextFileIds,
        modelId: body.modelId ?? null,
        reasoningEffort: body.reasoningEffort ?? null,
        goal: body.goal ?? { objective: body.prompt, constraints: [], successCriteria: ["Return a grounded result."] },
        budget: body.budget ?? {}
      },
      definitionSnapshot: {
        target: resolved.target,
        workflow: resolved.runRequest.workflow,
        singleNode: resolved.runRequest.singleNode,
        roles: resolved.runRequest.roles,
        skills: resolved.runRequest.skills,
        workspaceInstructions: resolved.runRequest.workspaceInstructions,
        memories: resolved.runRequest.memories,
        provider: resolved.runRequest.provider,
        model: resolved.runRequest.model
      },
      idempotencyKey
    });

    if (resolved.contextFileIds.length > 0) {
      await linkRunInputFiles(org.sql, org.orgId, run.id, resolved.contextFileIds);
    }
    if (chatId) {
      await appendChatMessage(org.sql, org.orgId, chatId, "user", body.prompt, { runId: run.id });
      await updateChatMetadata(org.sql, org.orgId, chatId, { activeRunId: run.id, lastRunId: run.id });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(frame({ kind: "run", runId: run.id, type: resolved.type })));
        let outputText = "";
        let terminalStatus: RunStatus = "completed";
        let errorMessage: string | null = null;
        let checkpoint: RunCheckpoint | null = null;
        let compaction: Record<string, unknown> | null = null;
        const usage = { input: 0, output: 0, tools: 0 };
        const billableUsage = { input: 0, output: 0 };
        const onUsage = (next: { input: number; output: number }) => {
          billableUsage.input += next.input;
          billableUsage.output += next.output;
          // Context-window occupancy is per request; parallel/iterative calls should
          // show the largest live working set rather than a misleading cumulative sum.
          usage.input = Math.max(usage.input, next.input);
          // Output capacity is also a per-request model limit. Keep the largest
          // generation in the live inspector while billableUsage remains cumulative.
          usage.output = Math.max(usage.output, next.output);
          controller.enqueue(encoder.encode(frame({
            kind: "usage",
            usage: { inputTokens: usage.input, outputTokens: usage.output, toolCalls: usage.tools }
          })));
        };
        const onToolUsage = (count: number) => {
          const next = usage.tools + count;
          if (body.budget?.maxToolCalls && next > body.budget.maxToolCalls) {
            throw new Error(`Tool-call budget exceeded (${body.budget.maxToolCalls}).`);
          }
          usage.tools = next;
          controller.enqueue(encoder.encode(frame({
            kind: "usage",
            usage: { inputTokens: usage.input, outputTokens: usage.output, toolCalls: usage.tools }
          })));
        };
        const liveEventIds = new Set<string>();
        const queuedEventIds = new Set<string>();
        const queuedEvents: Parameters<typeof appendRunEvents>[3] = [];
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
            payload: event.payload ?? {}
          });
        };
        const flushQueuedEvents = async () => {
          if (queuedEvents.length === 0) return;
          const batch = queuedEvents.splice(0, queuedEvents.length);
          try {
            await appendRunEvents(org.sql, org.orgId, run.id, batch);
          } catch (eventError) {
            queuedEvents.unshift(...batch);
            console.error("[runs/execute] event batch persist failed:", eventError);
          }
        };
        const onEvent = (event: RunEvent) => {
          liveEventIds.add(event.id);
          queueEvent(event);
          controller.enqueue(encoder.encode(frame({ kind: "event", event })));
        };
        let lastControlCheck = 0;
        const executionController = new AbortController();
        const abortFromRequest = () => executionController.abort(request.signal.reason);
        if (request.signal.aborted) abortFromRequest();
        else request.signal.addEventListener("abort", abortFromRequest, { once: true });
        let stopControlMonitor = false;
        let requestedTerminalStatus: RunStatus | null = null;
        const controlMonitor = (async () => {
          while (!stopControlMonitor && !executionController.signal.aborted) {
            await new Promise((resolve) => setTimeout(resolve, 350));
            if (stopControlMonitor || executionController.signal.aborted) break;
            try {
              const durable = await getRun(org.sql, org.orgId, run.id);
              const paused = durable?.status === "waiting_human" && durable.state?.pause && typeof durable.state.pause === "object";
              if (durable?.status === "cancelled" || paused) {
                requestedTerminalStatus = durable.status as RunStatus;
                checkpoint = durable.state as RunCheckpoint;
                executionController.abort(new Error(`Run ${durable.status}.`));
                break;
              }
            } catch (controlError) {
              console.warn("[runs/execute] control monitor failed:", controlError);
            }
          }
        })();

        const gen: AsyncGenerator<RunYield, void, void> =
          resolved.type === "chat"
            ? streamChatRun({
                ...resolved.runRequest,
                runId: run.id,
                directorPrompt: resolved.directorPrompt,
                history: body.messages,
                previousCompaction: body.previousCompaction,
                goal: body.goal,
                budget: body.budget,
                onUsage,
                signal: executionController.signal
              })
            : streamRun({ ...resolved.runRequest, runId: run.id, goal: body.goal, budget: body.budget, onUsage, onToolUsage, onEvent, signal: executionController.signal });

        try {
          for await (const item of gen) {
            if (Date.now() - lastControlCheck >= 500) {
              lastControlCheck = Date.now();
              const durable = await getRun(org.sql, org.orgId, run.id);
              const paused = durable?.status === "waiting_human" && durable.state?.pause && typeof durable.state.pause === "object";
              if (durable?.status === "cancelled" || paused) {
                terminalStatus = durable.status as RunStatus;
                checkpoint = durable.state as RunCheckpoint;
                break;
              }
            }
            if (item.kind === "text") {
              outputText += item.text;
              controller.enqueue(encoder.encode(frame({ kind: "text", text: item.text })));
            } else if (item.kind === "status") {
              controller.enqueue(encoder.encode(frame({ kind: "status", message: item.message })));
            } else if (item.kind === "event") {
              queueEvent(item.event);
              if (item.event.type === "status" && item.event.payload?.category === "compaction") {
                compaction = {
                  summary: item.event.payload.summary,
                  compactedMessageCount: item.event.payload.compactedMessageCount,
                  createdAt: item.event.payload.createdAt
                };
              }
              if (!liveEventIds.has(item.event.id)) {
                controller.enqueue(encoder.encode(frame({ kind: "event", event: item.event })));
              }
              if (queuedEvents.length >= 12) await flushQueuedEvents();
            } else if (item.kind === "artifact") {
              controller.enqueue(encoder.encode(frame({ kind: "artifact", artifact: item.artifact })));
              try {
                const file = await createFile(org.sql, org.orgId, {
                  title: item.artifact.title,
                  body: item.artifact.body,
                  fileType: item.artifact.type === "artifact" ? "artifact" : item.artifact.type,
                  status: "active",
                  metadata: { ...item.artifact.metadata, runId: run.id, runtimeArtifactId: item.artifact.id, seedFolder: generatedFileFolder() }
                });
                await linkRunOutputFile(org.sql, org.orgId, run.id, file.id);
              } catch (err) {
                console.error("[runs/execute] artifact persist failed:", err);
              }
            } else if (item.kind === "human_input") {
              terminalStatus = "waiting_human";
              controller.enqueue(encoder.encode(frame({ kind: "human_input", request: item.request })));
            } else if (item.kind === "checkpoint") {
              checkpoint = item.state;
              await updateRun(org.sql, org.orgId, run.id, { state: checkpoint });
              controller.enqueue(encoder.encode(frame({
                kind: "run_state",
                state: {
                  goal: checkpoint.goal,
                  budget: checkpoint.budget,
                  progress: checkpoint.progress,
                  verification: checkpoint.verification
                }
              })));
            } else if (item.kind === "done") {
              const allowed: RunStatus[] = ["running", "waiting_human", "completed", "failed", "cancelled"];
              terminalStatus = (allowed.includes(item.status as RunStatus) ? item.status : "completed") as RunStatus;
            }
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : "Run failed";
          const durable = await getRun(org.sql, org.orgId, run.id);
          if (requestedTerminalStatus || durable?.status === "cancelled" || durable?.status === "waiting_human" || request.signal.aborted) {
            terminalStatus = requestedTerminalStatus ?? (request.signal.aborted ? "cancelled" : durable?.status as RunStatus);
            if (durable?.state) checkpoint = durable.state as RunCheckpoint;
            errorMessage = null;
          } else {
            terminalStatus = "failed";
            controller.enqueue(encoder.encode(frame({ kind: "error", message: errorMessage })));
          }
        } finally {
          stopControlMonitor = true;
          request.signal.removeEventListener("abort", abortFromRequest);
          await flushQueuedEvents();
          await controlMonitor;
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
              toolCalls: usage.tools
            }
          };
        }

        await updateRun(org.sql, org.orgId, run.id, {
          status: terminalStatus,
          outputs: { text: outputText },
          state: checkpoint ?? undefined,
          error: errorMessage,
          completedAt
        });
        if (chatId && compaction && resolved.type === "chat") {
          await updateChatMetadata(org.sql, org.orgId, chatId, { compaction });
        }
        if (chatId) {
          await updateChatMetadata(org.sql, org.orgId, chatId, {
            activeRunId: terminalStatus === "completed" ? null : run.id,
            lastRunId: run.id
          });
        }

        if (
          resolved.runRequest.provider &&
          resolved.runRequest.model &&
          outputText
        ) {
          try {
            await recordUsage(org.sql, org.orgId, {
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
            await appendChatMessage(org.sql, org.orgId, chatId, "assistant", outputText, { runId: run.id });
          } catch (err) {
            console.warn("[runs/execute] chat persist failed:", err);
          }
        }

        if (checkpoint) {
          controller.enqueue(encoder.encode(frame({
            kind: "run_state",
            state: {
              goal: checkpoint.goal,
              budget: checkpoint.budget,
              progress: checkpoint.progress,
              verification: checkpoint.verification
            }
          })));
        }

        controller.enqueue(encoder.encode(frame({ kind: "done", runId: run.id, status: terminalStatus })));
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
