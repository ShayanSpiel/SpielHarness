"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ExternalStoreAdapter, AppendMessage, ThreadMessageLike } from "@assistant-ui/react";
import { fromThreadMessageLike } from "@assistant-ui/react";
import {
  executionModeSchema,
  DEFAULT_EXECUTION_MODE,
  type ChatMessage,
  type Model,
} from "@spielos/core";
import { consumeSseStream } from "./sse-stream-consumer";
import { useRuntimeStore, type ContextItem, type RuntimeState } from "./runtime-store";

const EMPTY_MESSAGES: readonly ChatMessage[] = Object.freeze([]);
const subscribeRuntime = (callback: () => void) => useRuntimeStore.subscribe(callback);
const getActiveChatId = () => useRuntimeStore.getState().activeChatId;
const getMessagesRecord = () => useRuntimeStore.getState().messages;
const getTransportStatus = () => useRuntimeStore.getState().transportStatus;
const getRunStatus = () => useRuntimeStore.getState().runStatus;

function messageText(message: AppendMessage): string {
  return message.content
    .map((part) => typeof part === "string" ? part : part.type === "text" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

function historyForChat(chatId: string, throughMessageId?: string | null) {
  const all = useRuntimeStore.getState().messages[chatId] ?? [];
  const end = throughMessageId ? all.findIndex((message) => message.id === throughMessageId) : -1;
  const messages = end >= 0 ? all.slice(0, end + 1) : all;
  return messages
    .filter((message) => !message.metadata?.transient && !message.metadata?.error && message.body.trim())
    .map((message) => ({
      role: message.role === "tool" ? "assistant" : message.role,
      content: message.body,
    }));
}

function buildRunPayload(
  store: RuntimeState,
  models: readonly Model[],
  chatId: string,
  prompt: string,
  historyThrough?: string | null,
) {
  const currentChat = store.chats.find((chat) => chat.id === chatId) ?? null;
  const executionMode = executionModeSchema.catch(DEFAULT_EXECUTION_MODE).parse(
    typeof currentChat?.metadata?.executionMode === "string"
      ? currentChat.metadata.executionMode
      : store.pendingExecutionMode,
  );
  const explicit = store.contextItems.find(
    (item): item is ContextItem & { kind: "role" | "skill" | "eval" | "workflow" } =>
      ["role", "skill", "eval", "workflow"].includes(item.kind),
  );
  const runType = executionMode === "direct" && explicit ? explicit.kind : "chat";
  const contextFileIds = store.contextItems
    .filter((item) => ["file", "library", "knowledge", "prompt", "strategy"].includes(item.kind))
    .map((item) => item.id);
  const configuredModelId = typeof currentChat?.metadata?.modelId === "string"
    ? currentChat.metadata.modelId
    : store.pendingModelId;
  const selectedModel = models.find((model) => model.id === configuredModelId && model.enabled)
    ?? models.find((model) => model.enabled)
    ?? null;
  const reasoningEffort = typeof currentChat?.metadata?.reasoningEffort === "string"
    ? currentChat.metadata.reasoningEffort
    : store.pendingReasoningEffort !== "auto"
      ? store.pendingReasoningEffort
      : selectedModel?.config?.capabilities && typeof selectedModel.config.capabilities === "object"
        ? (selectedModel.config.capabilities as Record<string, unknown>).reasoningEffort
        : "auto";

  return {
    prompt,
    chatId,
    type: runType,
    targetId: runType !== "chat" && runType !== "workflow" ? explicit?.id : undefined,
    workflowId: runType === "workflow" ? explicit?.id : undefined,
    contextFileIds,
    chatContextItems: store.contextItems,
    modelId: selectedModel?.id,
    reasoningEffort,
    executionMode,
    suggestedHarnessRefs: store.contextItems
      .filter((item) => ["role", "skill", "workflow", "eval"].includes(item.kind))
      .map((item) => ({ id: item.id, type: item.kind, title: item.title })),
    previousCompaction: currentChat?.metadata?.compaction ?? null,
    goal: {
      objective: prompt,
      constraints: [],
      successCriteria: [runType === "chat"
        ? "Return a grounded response."
        : "Complete every required runtime node and verify a non-empty terminal output."],
    },
    messages: historyForChat(chatId, historyThrough),
  };
}

function optimisticUserMessage(chatId: string, generationId: string, body: string): ChatMessage {
  const current = useRuntimeStore.getState().messages[chatId] ?? [];
  return {
    id: `optimistic:${generationId}`,
    chatId,
    orgId: "",
    role: "user",
    body,
    metadata: { optimistic: true, generationId },
    createdAt: new Date().toISOString(),
    sequenceNumber: (current.at(-1)?.sequenceNumber ?? current.length) + 1,
  };
}

function appendSubmissionError(chatId: string, generationId: string, message: string) {
  const store = useRuntimeStore.getState();
  store.upsertMessage(chatId, {
    id: `error:${generationId}`,
    chatId,
    orgId: "",
    role: "assistant",
    body: message,
    metadata: { error: true, generationId },
    createdAt: new Date().toISOString(),
    sequenceNumber: (store.messages[chatId]?.at(-1)?.sequenceNumber ?? store.messages[chatId]?.length ?? 0) + 1,
  });
}

export function useRuntimeAdapter(models: Model[]): ExternalStoreAdapter {
  const router = useRouter();
  const routerRef = useRef(router);
  const modelsRef = useRef(models);
  routerRef.current = router;
  modelsRef.current = models;

  const activeChatId = useSyncExternalStore(subscribeRuntime, getActiveChatId, getActiveChatId);
  const messagesRecord = useSyncExternalStore(subscribeRuntime, getMessagesRecord, getMessagesRecord);
  const transportStatus = useSyncExternalStore(subscribeRuntime, getTransportStatus, getTransportStatus);
  const runStatus = useSyncExternalStore(subscribeRuntime, getRunStatus, getRunStatus);
  const messages = activeChatId ? messagesRecord[activeChatId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;

  const threadMessages = useMemo(() => messages
    .filter((message) => !message.metadata?.transient || Boolean(message.body.trim()))
    .map((message) => fromThreadMessageLike({
      id: message.id,
      role: message.role === "tool" ? "assistant" : message.role as "assistant" | "user" | "system",
      content: message.body,
      createdAt: new Date(message.createdAt),
    } as ThreadMessageLike, message.id, { type: "complete", reason: "unknown" })), [messages]);

  const submit = useCallback(async (prompt: string, options?: { historyThrough?: string | null; optimistic?: boolean }) => {
    if (!prompt.trim()) return;
    const store = useRuntimeStore.getState();
    const chatId = store.activeChatId ?? crypto.randomUUID();
    const generationId = crypto.randomUUID();
    const idempotencyKey = `turn:${crypto.randomUUID()}`;

    if (options?.optimistic !== false) store.upsertMessage(chatId, optimisticUserMessage(chatId, generationId, prompt));
    store.dispatch({ type: "submission_started", chatId, generationId, idempotencyKey });
    const payload = {
      ...buildRunPayload(useRuntimeStore.getState(), modelsRef.current, chatId, prompt, options?.historyThrough),
      idempotencyKey,
    };

    let response: Response;
    try {
      response = await fetch("/api/runs/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The run could not reach the server.";
      store.dispatch({ type: "submission_rejected", generationId, error: message });
      appendSubmissionError(chatId, generationId, message);
      return;
    }

    if (!response.ok || !response.body) {
      let message = `Run failed with HTTP ${response.status}.`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) message = body.error;
      } catch { /* response was not JSON */ }
      store.dispatch({ type: "submission_rejected", generationId, error: message });
      appendSubmissionError(chatId, generationId, message);
      return;
    }

    try {
      await consumeSseStream(response, generationId, {
        onText: (text, runId) => useRuntimeStore.getState().appendStreamText(chatId, runId, generationId, text),
        onRunBound: ({ runId }) => {
          const latest = useRuntimeStore.getState();
          if (latest.activeRunId === runId && latest.runs[runId]?.generationId === generationId) {
            routerRef.current.replace(`/runs/${runId}`, { scroll: false });
          }
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The run stream was interrupted.";
      const currentRunId = useRuntimeStore.getState().activeRunId;
      if (currentRunId && !currentRunId.startsWith("pending:")) {
        useRuntimeStore.getState().dispatch({ type: "transport_error", runId: currentRunId, error: message });
      } else {
        useRuntimeStore.getState().dispatch({ type: "submission_rejected", generationId, error: message });
      }
    }
  }, []);

  const onNew = useCallback(async (message: AppendMessage) => {
    await submit(messageText(message), { optimistic: true });
  }, [submit]);

  const onCancel = useCallback(async () => {
    const store = useRuntimeStore.getState();
    const runId = store.activeRunId;
    if (!runId || runId.startsWith("pending:")) return;
    store.dispatch({ type: "cancel_requested", runId });
    try {
      const response = await fetch(`/api/runs/${runId}/cancel`, { method: "POST", keepalive: true });
      if (!response.ok) throw new Error(`Cancel failed with HTTP ${response.status}.`);
      await store.restoreRun(runId, { force: true });
    } catch (error) {
      store.dispatch({
        type: "transport_error",
        runId,
        error: error instanceof Error ? error.message : "The run could not be cancelled.",
      });
    }
  }, []);

  const isRunning = ["submitting", "connecting", "streaming", "reconnecting"].includes(transportStatus)
    || (runStatus === "running" && transportStatus !== "error");

  return useMemo(() => ({
    messages: threadMessages,
    isRunning,
    isSendDisabled: isRunning,
    isDisabled: false,
    onNew,
    onCancel,
  }), [threadMessages, isRunning, onNew, onCancel]);
}
