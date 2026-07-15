"use client";

import { useMemo, useRef } from "react";
import type { ChatModelAdapter, ChatModelRunResult, ThreadAssistantMessagePart } from "@assistant-ui/react";
import { useRunContext } from "./run-context";
import { useWorkspaceStore } from "./use-workspace-store";
import type { HumanInputRequest, RunEvent, Artifact, RunStatus } from "@spielos/core";

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
  const inFlightMessages = useRef(new Set<string>());
  return useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult, void> {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUser) return;
        const messageKey = lastUser.id;
        if (inFlightMessages.current.has(messageKey)) return;
        inFlightMessages.current.add(messageKey);

        const text = getMessageText(lastUser);
        const ctx = runRef.current;
        const ws = storeRef.current;
        let chatId = ws.activeChatId;
        let createdChatId: string | null = null;
        if (!chatId) {
          const created = await ws.createChat(text.trim().slice(0, 80) || "New chat", false);
          chatId = created.id;
          createdChatId = created.id;
        }

        // Map context items to file ids.
        const contextFileIds = ctx.contextItems
          .filter((item) => item.kind === "file" || item.kind === "library" || item.kind === "knowledge" || item.kind === "prompt" || item.kind === "strategy")
          .map((item) => item.id);

        // Find first explicit target (role/skill/eval/workflow). Empty context is fine.
        const explicit = ctx.contextItems.find((item) =>
          ["role", "skill", "eval", "workflow"].includes(item.kind)
        );
        let type: "chat" | "role" | "skill" | "eval" | "workflow" = "chat";
        let targetId: string | undefined;
        if (explicit) {
          type = explicit.kind as "role" | "skill" | "eval" | "workflow";
          targetId = explicit.id;
        }
        ctx.startRun(type);

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
        await ws.updateChatMetadata(chatId, {
          modelId: selectedModel?.id ?? null,
          reasoningEffort,
          contextItems: ctx.contextItems
        });

        const payload = {
          prompt: text,
          chatId,
          type,
          targetId: type === "workflow" ? undefined : targetId,
          workflowId: type === "workflow" ? targetId : undefined,
          contextFileIds,
          modelId: selectedModel?.id,
          reasoningEffort,
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
          inFlightMessages.current.delete(messageKey);
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
          inFlightMessages.current.delete(messageKey);
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

        const yieldCurrent = (): ChatModelRunResult => ({
          content: [{ type: "text", text: narrative }] as unknown as readonly ThreadAssistantMessagePart[]
        });

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
              } else if (item.kind === "text") {
                narrative += item.text;
              } else if (item.kind === "error") {
                ctx.setActivity(item.message);
                ctx.setRunStatus("failed");
                terminalStatus = "failed";
              } else if (item.kind === "done") {
                const next = item.status as RunStatus;
                if (["running", "waiting_human", "completed", "failed", "cancelled"].includes(next)) {
                  ctx.setRunStatus(next);
                  terminalStatus = next;
                }
              }
              yield yieldCurrent();
            }
          }
        } finally {
          if (!terminalStatus) {
            const interruptedStatus: RunStatus = abortSignal.aborted ? "cancelled" : "failed";
            ctx.setRunStatus(interruptedStatus);
          }
          inFlightMessages.current.delete(messageKey);
          const activeRunId = runRef.current.activeRunId;
          if (
            abortSignal.aborted &&
            activeRunId &&
            terminalStatus !== "completed" &&
            terminalStatus !== "failed" &&
            terminalStatus !== "cancelled"
          ) {
            fetch(`/api/runs/${activeRunId}/cancel`, { method: "POST" }).catch(() => {
              // ignore
            });
          }
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
            void storeRef.current.reload();
          }
        }

        yield yieldCurrent();
      }
    }),
    []
  );
}
