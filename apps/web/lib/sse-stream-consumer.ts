"use client";

import type { ChatMessage, RunStatus, RunEvent, Artifact, HumanInputRequest } from "@spielos/core";
import type { Chat as CoreChat } from "@spielos/core";

type StoreWrites = {
  upsertChat: (chat: CoreChat) => void;
  upsertMessage: (chatId: string, msg: ChatMessage) => void;
  setRunStatus: (status: RunStatus) => void;
  setRunType: (type: string) => void;
  setActiveRunId: (runId: string | null) => void;
  appendEvent: (event: RunEvent) => void;
  clearEvents: () => void;
  clearArtifacts: () => void;
  appendArtifact: (artifact: Artifact) => void;
  setDurableState: (state: Record<string, unknown> | null) => void;
  setLiveUsage: (usage: { inputTokens: number; outputTokens: number; toolCalls: number } | null) => void;
  setHumanInputRequest: (request: HumanInputRequest | null) => void;
  recordCheckpointVersion: (version: number) => void;
  beginRunAttempt: () => string;
  activateRunProjection: (runId: string) => void;
  isGenerationCurrent: (generationId: string) => boolean;
};

export type PendingFrame =
  | { kind: "run"; runId: string }
  | { kind: "chat_created"; chatId: string; chat: CoreChat }
  | { kind: "message_persisted"; chatId: string; message: ChatMessage }
  | { kind: "event"; event: RunEvent }
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "status"; message: string }
  | { kind: "run_state"; state: Record<string, unknown> }
  | { kind: "usage"; usage: { inputTokens: number; outputTokens: number; toolCalls: number } }
  | { kind: "human_input"; request: HumanInputRequest }
  | { kind: "error"; message: string }
  | { kind: "done"; status: RunStatus };

function scheduleFlush(
  pendingRef: { current: PendingFrame[] },
  writes: StoreWrites,
  generationId: string,
  rafScheduledRef: { current: boolean },
  _onNarrativeUpdate?: (text: string) => void
) { void _onNarrativeUpdate;
  if (rafScheduledRef.current) return;
  rafScheduledRef.current = true;
  requestAnimationFrame(() => {
    rafScheduledRef.current = false;
    const frames = pendingRef.current;
    pendingRef.current = [];
    if (!writes.isGenerationCurrent(generationId)) return;
    for (const item of frames) {
      if (item.kind === "run") {
        writes.clearEvents();
        writes.clearArtifacts();
        writes.setActiveRunId(item.runId);
        writes.activateRunProjection(item.runId);
      } else if (item.kind === "chat_created") {
        writes.upsertChat(item.chat);
      } else if (item.kind === "message_persisted") {
        writes.upsertMessage(item.chatId, item.message);
      } else if (item.kind === "event") {
        writes.appendEvent(item.event);
      } else if (item.kind === "artifact") {
        writes.appendArtifact(item.artifact);
      } else if (item.kind === "status") {
        // status messages are informational only
      } else if (item.kind === "run_state") {
        writes.setDurableState(item.state);
      } else if (item.kind === "usage") {
        writes.setLiveUsage(item.usage);
      } else if (item.kind === "human_input") {
        writes.setHumanInputRequest(item.request);
      } else if (item.kind === "error") {
        writes.setRunStatus("failed");
      } else if (item.kind === "done") {
        writes.setRunStatus(item.status);
        if (item.status !== "running" && item.status !== "waiting_human") {
          writes.setActiveRunId(null);
        }
      }
    }
  });
}

export async function consumeSseStream(
  response: Response,
  writes: StoreWrites,
  generationId: string,
  _onNarrativeUpdate?: (text: string) => void
): Promise<{ status: RunStatus; runId: string | null }> { void _onNarrativeUpdate;
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let narrative = "";
  let terminalStatus: RunStatus | null = null;
  let captureRunId: string | null = null;
  const pending: PendingFrame[] = [];
  const rafScheduled = { current: false };

  function pushFrame(frame: PendingFrame) {
    pending.push(frame);
    scheduleFlush({ current: pending }, writes, generationId, rafScheduled, _onNarrativeUpdate);
  }

  async function readLoop(): Promise<void> {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as { type: string; payload: Record<string, unknown> };
          parseSseFrame(parsed, pushFrame, { narrative: () => narrative, setNarrative: (v: string) => { narrative = v; }, captureRunId: () => captureRunId, setCaptureRunId: (v: string | null) => { captureRunId = v; }, terminalStatus: () => terminalStatus, setTerminalStatus: (v: RunStatus) => { terminalStatus = v; } });
        } catch {
          // Skip malformed frames
        }
      }
    }
  }

  await readLoop();

  // Flush any remaining pending frames
  if (pending.length > 0 && writes.isGenerationCurrent(generationId)) {
    const frames = pending.splice(0);
    for (const item of frames) {
      if (item.kind === "run") {
        writes.clearEvents();
        writes.clearArtifacts();
        writes.setActiveRunId(item.runId);
        writes.activateRunProjection(item.runId);
      } else if (item.kind === "chat_created") {
        writes.upsertChat(item.chat);
      } else if (item.kind === "message_persisted") {
        writes.upsertMessage(item.chatId, item.message);
      } else if (item.kind === "event") {
        writes.appendEvent(item.event);
      } else if (item.kind === "artifact") {
        writes.appendArtifact(item.artifact);
      } else if (item.kind === "run_state") {
        writes.setDurableState(item.state);
      } else if (item.kind === "usage") {
        writes.setLiveUsage(item.usage);
      } else if (item.kind === "human_input") {
        writes.setHumanInputRequest(item.request);
      } else if (item.kind === "error") {
        writes.setRunStatus("failed");
      } else if (item.kind === "done") {
        writes.setRunStatus(item.status);
        if (item.status !== "running" && item.status !== "waiting_human") {
          writes.setActiveRunId(null);
        }
      }
    }
  }

  return { status: terminalStatus ?? "failed", runId: captureRunId };
}

function parseSseFrame(
  parsed: { type: string; payload: Record<string, unknown> },
  pushFrame: (frame: PendingFrame) => void,
  ctx: {
    narrative: () => string;
    setNarrative: (v: string) => void;
    captureRunId: () => string | null;
    setCaptureRunId: (v: string | null) => void;
    terminalStatus: () => RunStatus | null;
    setTerminalStatus: (v: RunStatus) => void;
  }
) {
  const { type, payload } = parsed;
  switch (type) {
    case "run": {
      const runId = payload.runId as string;
      ctx.setCaptureRunId(runId);
      pushFrame({ kind: "run", runId });
      break;
    }
    case "chat_created":
      pushFrame({
        kind: "chat_created",
        chatId: payload.chatId as string,
        chat: payload.chat as unknown as CoreChat
      });
      break;
    case "message_persisted":
      pushFrame({
        kind: "message_persisted",
        chatId: payload.chatId as string,
        message: payload.message as unknown as ChatMessage
      });
      break;
    case "event":
      pushFrame({ kind: "event", event: payload.event as unknown as RunEvent });
      break;
    case "artifact":
      pushFrame({ kind: "artifact", artifact: payload.artifact as unknown as Artifact });
      break;
    case "status":
      pushFrame({ kind: "status", message: payload.message as string });
      break;
    case "run_state":
      pushFrame({ kind: "run_state", state: payload.state as Record<string, unknown> });
      break;
    case "usage":
      pushFrame({ kind: "usage", usage: payload.usage as { inputTokens: number; outputTokens: number; toolCalls: number } });
      break;
    case "human_input":
      pushFrame({
        kind: "human_input",
        request: payload.request as HumanInputRequest
      });
      break;
    case "error":
      pushFrame({ kind: "error", message: payload.message as string });
      ctx.setTerminalStatus("failed");
      break;
    case "done":
      pushFrame({ kind: "done", status: payload.status as RunStatus });
      ctx.setTerminalStatus(payload.status as RunStatus);
      break;
  }
}
