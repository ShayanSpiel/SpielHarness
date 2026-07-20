"use client";

import { sseEnvelopeSchema, type ChatMessage, type RunStatus, type RunEvent, type Artifact, type HumanInputRequest, type SseFrame } from "@spielos/core";
import type { Chat as CoreChat } from "@spielos/core";

export type TextUpdateCallback = (text: string) => void;

export type StoreWrites = {
  upsertChat: (chat: CoreChat) => void;
  upsertMessage: (chatId: string, msg: ChatMessage) => void;
  setRunStatus: (status: RunStatus) => void;
  setRunType: (type: string) => void;
  setActiveRunId: (runId: string | null) => void;
  setActivity: (activity: string | null) => void;
  attachStream: (runId: string) => void;
  detachStream: (runId: string) => void;
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
  | { kind: "text"; text: string }
  | { kind: "error"; message: string }
  | { kind: "done"; status: RunStatus };

function applyFrames(frames: PendingFrame[], writes: StoreWrites, generationId: string, onText?: TextUpdateCallback): void {
  if (!writes.isGenerationCurrent(generationId)) return;
  for (const item of frames) {
    switch (item.kind) {
      case "run":
        writes.clearEvents();
        writes.clearArtifacts();
        writes.setActiveRunId(item.runId);
        writes.activateRunProjection(item.runId);
        break;
      case "chat_created":
        writes.upsertChat(item.chat);
        break;
      case "message_persisted":
        writes.upsertMessage(item.chatId, item.message);
        break;
      case "event":
        writes.appendEvent(item.event);
        break;
      case "artifact":
        writes.appendArtifact(item.artifact);
        break;
      case "status":
        writes.setActivity(item.message);
        break;
      case "run_state":
        writes.setDurableState(item.state);
        break;
      case "usage":
        writes.setLiveUsage(item.usage);
        break;
      case "human_input":
        writes.setHumanInputRequest(item.request);
        break;
      case "text":
        onText?.(item.text);
        break;
      case "error":
        writes.setRunStatus("failed");
        break;
      case "done":
        writes.setRunStatus(item.status);
        if (item.status !== "running" && item.status !== "waiting_human") {
          writes.setActiveRunId(null);
        }
        break;
    }
  }
}

function scheduleFlush(
  pendingRef: { current: PendingFrame[] },
  writes: StoreWrites,
  generationId: string,
  rafScheduledRef: { current: boolean },
  onText?: TextUpdateCallback
) {
  if (rafScheduledRef.current) return;
  rafScheduledRef.current = true;
  const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
    ? window.requestAnimationFrame.bind(window)
    : (cb: (t: number) => void) => { cb(typeof performance !== "undefined" ? performance.now() : 0); return 0; };
  raf(() => {
    rafScheduledRef.current = false;
    const frames = pendingRef.current;
    pendingRef.current = [];
    applyFrames(frames, writes, generationId, onText);
  });
}

export async function consumeSseStream(
  response: Response,
  writes: StoreWrites,
  generationId: string,
  onText?: TextUpdateCallback
): Promise<{ status: RunStatus; runId: string | null }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalStatus: RunStatus | null = null;
  let captureRunId: string | null = null;
  let lastCheckpointVersion = 0;
  const pendingFrames: PendingFrame[] = [];
  const rafScheduled = { current: false };

  // Safety net: if the stream does not close (server ReadableStrem
  // controller.close() is never reached) the read-loop would block
  // forever.  Force-exit after 5 minutes so the run cycles out of
  // "running" and the user can retry.
  const STREAM_TIMEOUT_MS = 300_000;
  let streamTimedOut = false;
  const streamTimeout = setTimeout(() => {
    streamTimedOut = true;
    reader.cancel("stream-timeout").catch(() => {});
  }, STREAM_TIMEOUT_MS);

  function pushFrame(frame: PendingFrame) {
    pendingFrames.push(frame);
    scheduleFlush({ current: pendingFrames }, writes, generationId, rafScheduled, onText);
  }

  function processBuffer(flush: boolean): void {
    const parts = buffer.split("\n\n");
    if (flush) {
      buffer = "";
    } else {
      buffer = parts.pop() ?? "";
    }
    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const raw = dataLine.slice(6).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const envelopeResult = sseEnvelopeSchema.safeParse(parsed);
        if (!envelopeResult.success) {
          continue;
        }
        const envelope = envelopeResult.data;
        if (envelope.protocol && envelope.protocol !== "spielos-sse-v1") {
          continue;
        }
        if (typeof envelope.checkpointVersion === "number") {
          if (envelope.checkpointVersion > lastCheckpointVersion) {
            lastCheckpointVersion = envelope.checkpointVersion;
            writes.recordCheckpointVersion(envelope.checkpointVersion);
          }
        }
        const frame: SseFrame = envelope.body;
        if (frame.kind === "run") {
          captureRunId = frame.runId;
          writes.attachStream(frame.runId);
          pushFrame({ kind: "run", runId: frame.runId });
        } else if (frame.kind === "chat_created") {
          pushFrame({ kind: "chat_created", chatId: frame.chatId, chat: frame.chat });
        } else if (frame.kind === "message_persisted") {
          pushFrame({ kind: "message_persisted", chatId: frame.chatId, message: frame.message });
        } else if (frame.kind === "event") {
          pushFrame({ kind: "event", event: frame.event });
        } else if (frame.kind === "artifact") {
          pushFrame({ kind: "artifact", artifact: frame.artifact });
        } else if (frame.kind === "status") {
          pushFrame({ kind: "status", message: frame.message });
        } else if (frame.kind === "run_state") {
          pushFrame({ kind: "run_state", state: frame.state as Record<string, unknown> });
        } else if (frame.kind === "usage") {
          pushFrame({ kind: "usage", usage: frame.usage });
        } else if (frame.kind === "human_input") {
          pushFrame({ kind: "human_input", request: frame.request });
        } else if (frame.kind === "text") {
          pushFrame({ kind: "text", text: frame.text });
        } else if (frame.kind === "error") {
          pushFrame({ kind: "error", message: frame.message });
          terminalStatus = "failed";
        } else if (frame.kind === "done") {
          pushFrame({ kind: "done", status: frame.status });
          terminalStatus = frame.status;
        }
      } catch {
        // Malformed frame — do not corrupt remaining stream
      }
    }
  }

  async function readLoop(): Promise<void> {
    while (true) {
      if (streamTimedOut) break;
      const { done, value } = await reader.read();
      if (done) {
        // Decode and process any remaining bytes — the last chunk may
        // include the final SSE frame (e.g. the `done` frame) that would
        // otherwise be lost.
        buffer += decoder.decode(value, { stream: true });
        processBuffer(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      processBuffer(false);
    }
  }

  await readLoop();

  // Synchronously flush any remaining frames at stream end
  if (pendingFrames.length > 0 && writes.isGenerationCurrent(generationId)) {
    const frames = pendingFrames.splice(0);
    applyFrames(frames, writes, generationId, onText);
  }

  clearTimeout(streamTimeout);

  // Phase 2: release stream ownership so realtime reloads resume
  if (captureRunId) {
    writes.detachStream(captureRunId);
  }

  // If the stream closed cleanly (not a timeout) but no `done` frame
  // was parsed, assume "completed" — the server sent it but it may
  // have been lost in the final chunk.  Timeouts and explicit error
  // frames set terminalStatus to "failed" already.
  if (terminalStatus === null && !streamTimedOut) {
    terminalStatus = "completed";
    writes.setRunStatus("completed");
    writes.setActiveRunId(null);
  }
  return { status: terminalStatus ?? "completed", runId: captureRunId };
}
