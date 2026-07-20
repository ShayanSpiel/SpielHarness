"use client";

import type { ExternalStoreAdapter, AppendMessage, ThreadMessage, ThreadMessageLike } from "@assistant-ui/react";
import { fromThreadMessageLike } from "@assistant-ui/react";
import type { RunContextValue } from "./run-context";
import type { Store } from "./use-workspace-store";
import type { StartRunConfig } from "@assistant-ui/core";
import { executionModeSchema, DEFAULT_EXECUTION_MODE } from "@spielos/core";
import { consumeSseStream } from "./sse-stream-consumer";

function getMessageText(content: readonly { type: string; text?: string }[]): string {
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n");
}

function buildRunPayload(opts: {
  text: string;
  chatId: string;
  store: Store;
  run: RunContextValue;
  messages: readonly ThreadMessage[];
}) {
  const { text, chatId, store, run, messages } = opts;
  const currentChat = store.chats.find((c) => c.id === chatId) ?? null;
  const executionMode = executionModeSchema.catch(DEFAULT_EXECUTION_MODE).parse(
    typeof currentChat?.metadata?.executionMode === "string"
      ? currentChat.metadata.executionMode
      : run.pendingExecutionMode
  );
  const explicit = run.contextItems.find((item): item is { id: string; kind: "role" | "skill" | "eval" | "workflow"; title: string } =>
    ["role", "skill", "eval", "workflow"].includes(item.kind)
  );
  let runType: "chat" | "role" | "skill" | "eval" | "workflow" | null = "chat";
  let targetId: string | undefined;
  if (executionMode === "direct" && explicit) {
    runType = explicit.kind as "role" | "skill" | "eval" | "workflow";
    targetId = explicit.id;
  }

  const contextFileIds = run.contextItems
    .filter((item): item is { id: string; kind: "file" | "library" | "knowledge" | "prompt" | "strategy"; title: string } =>
      ["file", "library", "knowledge", "prompt", "strategy"].includes(item.kind)
    )
    .map((item) => item.id);

  const configuredModelId = typeof currentChat?.metadata?.modelId === "string"
    ? currentChat.metadata.modelId
    : run.pendingModelId;
  const selectedModel = store.models.find((m) => m.id === configuredModelId && m.enabled)
    ?? store.models.find((m) => m.enabled)
    ?? null;
  const previousCompaction = currentChat?.metadata?.compaction && typeof currentChat.metadata.compaction === "object"
    ? currentChat.metadata.compaction
    : null;
  const reasoningEffort = typeof currentChat?.metadata?.reasoningEffort === "string"
    ? currentChat.metadata.reasoningEffort
    : run.pendingReasoningEffort !== "auto"
      ? run.pendingReasoningEffort
    : selectedModel?.config?.capabilities && typeof selectedModel.config.capabilities === "object"
      ? (selectedModel.config.capabilities as Record<string, unknown>).reasoningEffort
      : "auto";

  return {
    prompt: text,
    chatId,
    type: runType ?? "chat",
    targetId: runType === "workflow" ? undefined : targetId,
    workflowId: runType === "workflow" ? targetId : undefined,
    contextFileIds,
    chatContextItems: run.contextItems,
    modelId: selectedModel?.id,
    reasoningEffort,
    executionMode,
    suggestedHarnessRefs: run.contextItems
      .map((item) => ({ id: item.id, type: item.kind, title: item.title }))
      .filter((item): item is { id: string; type: "role" | "skill" | "workflow" | "eval"; title: string } =>
        ["role", "skill", "workflow", "eval"].includes(item.type)
      ),
    previousCompaction,
    goal: {
      objective: text,
      constraints: [],
      successCriteria: [runType === "chat" ? "Return a grounded response." : "Complete every required runtime node and verify a non-empty terminal output."]
    },
    messages: messages
      .map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: getMessageText(m.content as readonly { type: string; text?: string }[])
      }))
      .filter((m) => m.content.trim())
  };
}

export function buildExternalStoreAdapter(
  store: Store,
  run: RunContextValue
): ExternalStoreAdapter {
  const activeChatId = store.activeChatId;
  const rawMessages = activeChatId ? (store.messages[activeChatId] ?? []) : [];

  const threadMessages = rawMessages
    .filter((msg) => {
      if (msg.role !== "assistant" || typeof msg.metadata?.resumedFrom !== "string") return true;
      try {
        const parsed = JSON.parse(msg.body) as unknown;
        return !(parsed && typeof parsed === "object" && !Array.isArray(parsed));
      } catch {
        return true;
      }
    })
    .map((msg) => fromThreadMessageLike({
      id: msg.id,
      role: msg.role === "tool" ? "assistant" : msg.role,
      content: msg.metadata?.kind === "execution_anchor" ? "[execution_anchor]" : msg.body,
      createdAt: new Date(msg.createdAt)
    } as ThreadMessageLike, msg.id, { type: "complete", reason: "unknown" }));

  return {
    messages: threadMessages,
    isRunning: run.status === "running",
    isDisabled: false,
    async onNew(message: AppendMessage) {
      let chatId = store.activeChatId;
      if (!chatId) {
        chatId = crypto.randomUUID();
      }

      const text = typeof message.content[0] === "string"
        ? message.content[0]
        : getMessageText(message.content as readonly { type: string; text?: string }[]);

      const generationId = run.beginRunAttempt();

      const payload = buildRunPayload({
        text,
        chatId,
        store,
        run,
        messages: threadMessages
      });

      let response: Response;
      try {
        response = await fetch("/api/runs/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Network error";
        run.setRunStatus("failed");
        store.upsertMessage(chatId, {
          id: crypto.randomUUID(),
          chatId,
          orgId: "",
          role: "assistant",
          body: `Run failed: ${msg}`,
          metadata: { error: true },
          createdAt: new Date().toISOString(),
          sequenceNumber: (store.messages[chatId]?.length ?? 0) + 1
        });
        return;
      }

      if (!response.ok || !response.body) {
        let msg = `Run failed: HTTP ${response.status}`;
        try {
          const data = (await response.json()) as { error?: string };
          if (data.error) msg = data.error;
        } catch { /* ignore */ }
        run.setRunStatus("failed");
        store.upsertMessage(chatId, {
          id: crypto.randomUUID(),
          chatId,
          orgId: "",
          role: "assistant",
          body: msg,
          metadata: { error: true },
          createdAt: new Date().toISOString(),
          sequenceNumber: (store.messages[chatId]?.length ?? 0) + 1
        });
        return;
      }

      // Phase 4: consume SSE stream — upserts directly to our store.
      // No generator/yield needed; store reactivity drives the runtime.
      run.clearContinuationText();
      const sseResult = await consumeSseStream(response, {
        upsertChat: (chat) => store.upsertChat(chat),
        upsertMessage: (cid, msg) => store.upsertMessage(cid, msg),
        setRunStatus: (s) => run.setRunStatus(s),
        setRunType: (t: string | null) => run.setRunType(t as import("@spielos/core").RunType | null),
        setActiveRunId: (rid) => run.setActiveRunId(rid),
        appendEvent: (e) => run.appendEvent(e),
        clearEvents: () => run.clearEvents(),
        clearArtifacts: () => run.clearArtifacts(),
        appendArtifact: (a) => run.appendArtifact(a),
        setDurableState: (s) => run.setDurableState(s),
        setLiveUsage: (u) => run.setLiveUsage(u),
        setHumanInputRequest: (r) => run.setHumanInputRequest(r),
        recordCheckpointVersion: (v) => run.recordCheckpointVersion(v),
        beginRunAttempt: () => run.beginRunAttempt(),
        activateRunProjection: (rid) => run.activateRunProjection(rid),
        isGenerationCurrent: (gid: string) => run.isGenerationCurrent(gid)
      }, generationId, (text) => run.appendContinuationText(text));

      // If this created a new chat (no activeChatId at start), commit
      // the pending navigation so ChatRuntimeProvider handles the redirect.
      if (!store.activeChatId && chatId && sseResult.runId) {
        run.commitPendingChat({ chatId, runId: sseResult.runId });
      }
    },
    async onReload(parentId: string | null, _config: StartRunConfig) { void _config; void parentId;
      const chatId = store.activeChatId;
      if (!chatId) return;
      const generationId = run.beginRunAttempt();
      const existingMessages = store.messages[chatId] ?? [];
      const text = parentId
        ? existingMessages.find((m) => m.id === parentId)?.body ?? ""
        : "";
      const payload = buildRunPayload({
        text,
        chatId,
        store,
        run,
        messages: threadMessages
      });
      let response: Response;
      try {
        response = await fetch("/api/runs/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      } catch {
        return;
      }
      if (!response.ok || !response.body) return;
      run.clearContinuationText();
      await consumeSseStream(response, {
        upsertChat: (chat) => store.upsertChat(chat),
        upsertMessage: (cid, msg) => store.upsertMessage(cid, msg),
        setRunStatus: (s) => run.setRunStatus(s),
        setRunType: (t: string | null) => run.setRunType(t as import("@spielos/core").RunType | null),
        setActiveRunId: (rid) => run.setActiveRunId(rid),
        appendEvent: (e) => run.appendEvent(e),
        clearEvents: () => run.clearEvents(),
        clearArtifacts: () => run.clearArtifacts(),
        appendArtifact: (a) => run.appendArtifact(a),
        setDurableState: (s) => run.setDurableState(s),
        setLiveUsage: (u) => run.setLiveUsage(u),
        setHumanInputRequest: (r) => run.setHumanInputRequest(r),
        recordCheckpointVersion: (v) => run.recordCheckpointVersion(v),
        beginRunAttempt: () => run.beginRunAttempt(),
        activateRunProjection: (rid) => run.activateRunProjection(rid),
        isGenerationCurrent: (gid: string) => run.isGenerationCurrent(gid)
      }, generationId, (text) => run.appendContinuationText(text));
    },
    async onCancel() {
      // All user-facing stop actions call the durable cancel endpoint.
      // Local state changes only happen after the server confirms.
      const currentRunId = run.activeRunId;
      if (!currentRunId) {
        run.setRunStatus("cancelled");
        return;
      }
      try {
        const res = await fetch(`/api/runs/${currentRunId}/cancel`, {
          method: "POST",
          keepalive: true
        });
        if (res.ok) {
          run.setRunStatus("cancelled");
        }
      } catch {
        // Failed cancellation must not falsely show final cancellation.
        // The run remains in its current status.
      }
    }
  };
}
