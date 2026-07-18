"use client";

import { useMemo, useRef } from "react";
import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { useRunContext } from "./run-context";
import { useWorkspaceStore } from "./use-workspace-store";
import { DEFAULT_EXECUTION_MODE, executionModeSchema, type HumanInputRequest, type RunEvent, type Artifact, type RunStatus } from "@spielos/core";

type StreamFrame =
  | { kind: "run"; runId: string; type: string }
  | { kind: "event"; event: RunEvent }
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "text"; text: string }
  | { kind: "status"; message: string }
  | { kind: "run_state"; state: import("./run-context").DurableRunState }
  | { kind: "usage"; usage: import("./run-context").LiveRunUsage }
  | { kind: "human_input"; request: HumanInputRequest }
  | { kind: "error"; message: string }
  | { kind: "done"; runId: string; status: string };

// Module-level Set so the in-flight key list survives React re-mounts and
// the entire app's component tree. Message keys are globally unique per
// page, so a single Set is enough to de-duplicate in-flight runs.
const inFlightMessages = new Set<string>();

function getMessageText(message: { content: readonly unknown[] }): string {
  return message.content
    .filter(
      (p): p is { type: "text"; text: string } =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: unknown }).type === "text" &&
        typeof (p as { text?: unknown }).text === "string"
    )
    .map((p) => p.text)
    .join("\n");
}

export function useSpielosChatAdapter(): ChatModelAdapter {
  const run = useRunContext();
  const store = useWorkspaceStore();
  const runRef = useRef(run);
  runRef.current = run;
  const storeRef = useRef(store);
  storeRef.current = store;
  return useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult, void> {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        const messageKey = lastUser.id;
        if (inFlightMessages.has(messageKey)) return;
        inFlightMessages.add(messageKey);

        const text = getMessageText(lastUser);
        const ctx = runRef.current;
        const ws = storeRef.current;
        const currentChat = ws.chats.find((entry) => entry.id === ws.activeChatId) ?? null;
        const executionMode = executionModeSchema.catch(DEFAULT_EXECUTION_MODE).parse(
          typeof currentChat?.metadata?.executionMode === "string"
            ? currentChat.metadata.executionMode
            : ctx.pendingExecutionMode
        );
        const explicit = ctx.contextItems.find((item) =>
          ["role", "skill", "eval", "workflow"].includes(item.kind)
        );
        let type: "chat" | "role" | "skill" | "eval" | "workflow" = "chat";
        let targetId: string | undefined;
        if (executionMode === "direct" && explicit) {
          type = explicit.kind as "role" | "skill" | "eval" | "workflow";
          targetId = explicit.id;
        }

        // This must precede chat creation and all network work. The assistant
        // turn is already visible at this point, so render genuine local
        // submission activity immediately while the durable run is created.
        ctx.startRun(type, "Thinking\u2026");

        let chatId = ws.activeChatId;
        let createdChatId: string | null = null;
        if (!chatId) {
          // The execute route creates the chat and run together. Generating
          // the id locally removes a blocking duplicate POST before the SSE
          // request and keeps chat creation inside the durable run boundary.
          chatId = crypto.randomUUID();
          createdChatId = chatId;
        }

        // Map context items to file ids.
        const contextFileIds = ctx.contextItems
          .filter((item) => item.kind === "file" || item.kind === "library" || item.kind === "knowledge" || item.kind === "prompt" || item.kind === "strategy")
          .map((item) => item.id);

        const chat = ws.chats.find((entry) => entry.id === chatId) ?? null;

        const configuredModelId = typeof chat?.metadata?.modelId === "string"
          ? chat.metadata.modelId
          : ctx.pendingModelId;
        const selectedModel = ws.models.find((model) => model.id === configuredModelId && model.enabled)
          ?? ws.models.find((model) => model.enabled)
          ?? null;
        const previousCompaction = chat?.metadata?.compaction && typeof chat.metadata.compaction === "object"
          ? chat.metadata.compaction
          : null;
        const reasoningEffort = typeof chat?.metadata?.reasoningEffort === "string"
          ? chat.metadata.reasoningEffort
          : ctx.pendingReasoningEffort !== "auto"
            ? ctx.pendingReasoningEffort
          : selectedModel?.config?.capabilities && typeof selectedModel.config.capabilities === "object"
            ? (selectedModel.config.capabilities as Record<string, unknown>).reasoningEffort
            : "auto";
        const payload = {
          prompt: text,
          chatId,
          type,
          targetId: type === "workflow" ? undefined : targetId,
          workflowId: type === "workflow" ? targetId : undefined,
          contextFileIds,
          chatContextItems: ctx.contextItems,
          modelId: selectedModel?.id,
          reasoningEffort,
          executionMode,
          suggestedHarnessRefs: ctx.contextItems.map((item) => ({
            id: item.id,
            type: item.kind,
            title: item.title
          })).filter((item) => ["role", "skill", "workflow", "eval"].includes(item.type)),
          previousCompaction,
          goal: {
            objective: text,
            constraints: [],
            successCriteria: [type === "chat" ? "Return a grounded response." : "Complete every required runtime node and verify a non-empty terminal output."]
          },
          messages: messages
            .map((m) => ({
              role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
              content: getMessageText(m)
            }))
            .filter((m) => m.content.trim())
        };

        let response: Response;
        try {
          response = await fetch("/api/runs/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            signal: abortSignal
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Network error";
          ctx.setRunStatus(abortSignal.aborted ? "cancelled" : "failed");
          inFlightMessages.delete(messageKey);
          yield {
            content: [{ type: "text", text: `Run failed: ${message}` }] as unknown as readonly ThreadAssistantMessagePart[]
          };
          return;
        }

        if (!response.ok || !response.body) {
          let message = `Run failed: HTTP ${response.status}`;
          try {
            const data = (await response.json()) as { error?: string };
            if (data.error) message = data.error;
          } catch {
            // ignore
          }
          ctx.setRunStatus("failed");
          inFlightMessages.delete(messageKey);
          yield {
            content: [{ type: "text", text: message }] as unknown as readonly ThreadAssistantMessagePart[]
          };
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let narrative = "";
        let terminalStatus: RunStatus | null = null;

        // Pending side effects to flush on the next animation frame.
        // The set-state calls and event appends are coalesced so a burst
        // of frames produces a single React render.
        type PendingFrame = { kind: "event"; event: RunEvent } | { kind: "artifact"; artifact: Artifact } | { kind: "status"; message: string } | { kind: "run_state"; state: import("./run-context").DurableRunState } | { kind: "usage"; usage: import("./run-context").LiveRunUsage } | { kind: "human_input"; request: HumanInputRequest } | { kind: "error"; message: string } | { kind: "done"; status: RunStatus } | { kind: "run"; runId: string };
        let pending: PendingFrame[] = [];
        let rafScheduled = false;
        let streamClosed = false;
        let lastYielded: ChatModelRunResult = { content: [{ type: "text", text: narrative }] as unknown as readonly ThreadAssistantMessagePart[] };

        const currentResult = (): ChatModelRunResult => {
          lastYielded = { content: [{ type: "text", text: narrative }] as unknown as readonly ThreadAssistantMessagePart[] };
          return lastYielded;
        };

        const applyFrame = (item: PendingFrame) => {
          if (item.kind === "run") {
                ctx.setActiveRunId(item.runId);
          } else if (item.kind === "status") {
            ctx.setActivity(item.message);
          } else if (item.kind === "run_state") {
            ctx.setDurableState(item.state);
            if (item.state.budget) {
              ctx.setLiveUsage({
                inputTokens: item.state.budget.inputTokens,
                outputTokens: item.state.budget.outputTokens,
                toolCalls: item.state.budget.toolCalls
              });
            }
          } else if (item.kind === "usage") {
            ctx.setLiveUsage(item.usage);
          } else if (item.kind === "event") {
            ctx.appendEvent(item.event);
            if (item.event.payload?.category === "context_budget") {
              const inputTokens = item.event.payload.inputTokens;
              if (typeof inputTokens === "number") {
                ctx.setLiveUsage({
                  inputTokens,
                  outputTokens: runRef.current.liveUsage?.outputTokens ?? 0,
                  toolCalls: runRef.current.liveUsage?.toolCalls ?? 0
                });
              }
            }
            if (item.event.type === "run_completed") terminalStatus = "completed";
            if (item.event.type === "run_failed") terminalStatus = "failed";
            if (item.event.type === "run_cancelled") terminalStatus = "cancelled";
          } else if (item.kind === "artifact") {
            ctx.appendArtifact(item.artifact);
          } else if (item.kind === "human_input") {
            ctx.setHumanInputRequest(item.request);
            ctx.setRunStatus("waiting_human");
            terminalStatus = "waiting_human";
          } else if (item.kind === "error") {
            ctx.setActivity(item.message);
            ctx.setRunStatus("failed");
            terminalStatus = "failed";
          } else if (item.kind === "done") {
            if (["running", "waiting_human", "completed", "failed", "cancelled"].includes(item.status)) {
              ctx.setRunStatus(item.status);
              terminalStatus = item.status;
            }
          }
        };

        const flushPending = () => {
          rafScheduled = false;
          if (pending.length === 0) return;
          const queue = pending;
          pending = [];
          for (const item of queue) applyFrame(item);
        };

        const scheduleFlush = () => {
          if (rafScheduled) return;
          rafScheduled = true;
          // requestAnimationFrame is browser-only; if it is missing (SSR or
          // non-DOM environments), flush synchronously so the run is not
          // blocked.
          const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
            ? window.requestAnimationFrame.bind(window)
            : (cb: (t: number) => void) => { cb(typeof performance !== "undefined" ? performance.now() : 0); return 0; };
          raf(() => flushPending());
        };

        const enqueue = (item: PendingFrame) => {
          pending.push(item);
          scheduleFlush();
        };

        const drainAndFinalize = () => {
          if (streamClosed) return;
          streamClosed = true;
          // Apply any frames that the final rAF hadn't flushed yet so
          // the terminal status / done event cannot be stranded.
          flushPending();
        };

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (abortSignal.aborted) {
              try {
                await reader.cancel();
              } catch {
                // ignore
              }
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() ?? "";
            for (const part of parts) {
              const line = part.split("\n").find((entry) => entry.startsWith("data: "));
              if (!line) continue;
              let item: StreamFrame;
              try {
                item = JSON.parse(line.slice(6)) as StreamFrame;
              } catch {
                continue;
              }
              if (item.kind === "run") {
                enqueue({ kind: "run", runId: item.runId });
              } else if (item.kind === "status") {
                enqueue({ kind: "status", message: item.message });
              } else if (item.kind === "run_state") {
                enqueue({ kind: "run_state", state: item.state });
              } else if (item.kind === "usage") {
                enqueue({ kind: "usage", usage: item.usage });
              } else if (item.kind === "event") {
                enqueue({ kind: "event", event: item.event });
              } else if (item.kind === "artifact") {
                enqueue({ kind: "artifact", artifact: item.artifact });
              } else if (item.kind === "human_input") {
                enqueue({ kind: "human_input", request: item.request });
              } else if (item.kind === "text") {
                narrative += item.text;
              } else if (item.kind === "error") {
                enqueue({ kind: "error", message: item.message });
              } else if (item.kind === "done") {
                const next = item.status as RunStatus;
                enqueue({ kind: "done", status: next });
              }
              yield currentResult();
            }
          }
          drainAndFinalize();
        } finally {
          drainAndFinalize();
          if (!terminalStatus) {
            const interruptedStatus: RunStatus = abortSignal.aborted ? "cancelled" : "failed";
            ctx.setRunStatus(interruptedStatus);
          }
          inFlightMessages.delete(messageKey);
          // A component unmount or reload aborts the browser reader too, so it
          // cannot be treated as user cancellation. The visible Stop control
          // calls the durable /cancel endpoint explicitly.
          if (createdChatId && !storeRef.current.activeChatId) {
            const createdAt = new Date().toISOString();
            const localMessages = messages
              .map((message, index) => ({
                id: `local-${message.id || index}`,
                orgId: "",
                chatId: createdChatId,
                role: (message.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
                body: getMessageText(message),
                metadata: {},
                createdAt
              }))
              .filter((message) => message.body.trim());
            if (narrative.trim()) {
              localMessages.push({
                id: `local-assistant-${messageKey}`,
                orgId: "",
                chatId: createdChatId,
                role: "assistant",
                body: narrative,
                metadata: {},
                createdAt
              });
            }
            const restoredRunId = runRef.current.activeRunId;
            storeRef.current.hydrateChat(createdChatId, {
              messages: localMessages,
              metadata: {
                lastRunId: restoredRunId,
                activeRunId: terminalStatus === "completed" ? null : restoredRunId
              }
            });
            storeRef.current.setActiveChat(createdChatId);
          }
        }

        yield currentResult();
      }
    }),
    []
  );
}
