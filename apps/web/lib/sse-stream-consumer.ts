"use client";

import { sseEnvelopeSchema, type RunStatus } from "@spielos/core";
import { useRuntimeStore, type RuntimeAction } from "./runtime-store";

export type TextUpdateCallback = (text: string, runId: string) => void;
export type RunBoundCallback = (identity: {
  runId: string;
  chatId: string | null;
  turnId: string | null;
}) => void;

function sseLog(event: string, data?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "production") console.log(`[SSE] ${event}`, data ?? "");
}

export async function consumeSseStream(
  response: Response,
  generationId: string,
  callbacks?: { onText?: TextUpdateCallback; onRunBound?: RunBoundCallback },
): Promise<{ status: RunStatus; runId: string | null }> {
  if (!response.body) throw new Error("Run response did not contain a stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalStatus: RunStatus | null = null;
  let captureRunId: string | null = null;
  let queuedActions: RuntimeAction[] = [];
  let queuedText = "";
  let flushHandle: number | ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    flushHandle = null;
    const actions = queuedActions;
    const text = queuedText;
    queuedActions = [];
    queuedText = "";
    if (!useRuntimeStore.getState().isGenerationCurrent(generationId)) return;
    for (const action of actions) useRuntimeStore.getState().dispatch(action);
    if (text && captureRunId) callbacks?.onText?.(text, captureRunId);
  };

  const scheduleFlush = () => {
    if (flushHandle !== null) return;
    if (typeof requestAnimationFrame === "function") {
      flushHandle = requestAnimationFrame(flush);
    } else {
      flushHandle = setTimeout(flush, 0);
    }
  };

  const cancelScheduledFlush = () => {
    if (flushHandle === null) return;
    if (typeof flushHandle === "number" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(flushHandle);
    } else {
      clearTimeout(flushHandle as ReturnType<typeof setTimeout>);
    }
    flushHandle = null;
  };

  const flushNow = () => {
    cancelScheduledFlush();
    if (queuedActions.length || queuedText) flush();
  };

  const queueFrame = (action: RuntimeAction) => {
    queuedActions.push(action);
    scheduleFlush();
  };

  const queueProgress = (runId: string, sequence: number, checkpointVersion?: number) => {
    if (sequence < 0) return;
    const last = queuedActions.at(-1);
    if (last?.type === "stream_progressed" && last.runId === runId) {
      queuedActions[queuedActions.length - 1] = {
        ...last,
        sequence: Math.max(last.sequence, sequence),
        checkpointVersion: typeof checkpointVersion === "number"
          ? Math.max(last.checkpointVersion ?? 0, checkpointVersion)
          : last.checkpointVersion,
      };
    } else {
      queuedActions.push({ type: "stream_progressed", runId, sequence, firstSequence: sequence, checkpointVersion });
    }
    scheduleFlush();
  };

  const STREAM_TIMEOUT_MS = 300_000;
  let streamTimedOut = false;
  const streamTimeout = setTimeout(() => {
    streamTimedOut = true;
    sseLog("stream_timeout", { generationId, runId: captureRunId });
    void reader.cancel("stream-timeout");
  }, STREAM_TIMEOUT_MS);

  const processBuffer = (final: boolean) => {
    const parts = buffer.split("\n\n");
    buffer = final ? "" : (parts.pop() ?? "");
    if (!useRuntimeStore.getState().isGenerationCurrent(generationId)) return;

    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue;
      const raw = dataLine.slice(5).trim();
      if (!raw) continue;

      try {
        const result = sseEnvelopeSchema.safeParse(JSON.parse(raw));
        if (!result.success || result.data.protocol !== "spielos-sse-v1") {
          sseLog("invalid_envelope", { issues: result.success ? "protocol" : result.error.issues.length });
          continue;
        }
        const envelope = result.data;
        const frame = envelope.body;
        const sequence = envelope.streamSequence ?? -1;

        if (frame.kind === "run") {
          flushNow();
          captureRunId = frame.runId;
          const identity = {
            runId: frame.runId,
            chatId: frame.chatId ?? null,
            turnId: frame.turnId ?? null,
          };
          useRuntimeStore.getState().dispatch({
            type: "run_bound",
            runId: identity.runId,
            chatId: identity.chatId ?? "",
            turnId: identity.turnId ?? "",
            generationId,
          });
          useRuntimeStore.getState().dispatch({
            type: "stream_opened",
            runId: identity.runId,
            streamId: envelope.streamId ?? identity.runId,
            initialSequence: sequence,
          });
          useRuntimeStore.getState().attachStream(identity.runId);
          if (typeof envelope.checkpointVersion === "number") {
            useRuntimeStore.getState().dispatch({
              type: "checkpoint_observed",
              runId: identity.runId,
              checkpointVersion: envelope.checkpointVersion,
            });
          }
          callbacks?.onRunBound?.(identity);
          sseLog("run_bound", { ...identity, sequence });
          continue;
        }

        if (!captureRunId) {
          sseLog("frame_before_run", { kind: frame.kind });
          continue;
        }

        if (frame.kind === "text") {
          queuedText += frame.text;
          queueProgress(captureRunId, sequence, envelope.checkpointVersion);
          continue;
        }

        if (frame.kind === "chat_created" || frame.kind === "message_persisted") flushNow();

        if (frame.kind === "chat_created") {
          useRuntimeStore.getState().upsertChat(frame.chat);
          useRuntimeStore.getState().dispatch({ type: "stream_progressed", runId: captureRunId, sequence, firstSequence: sequence, checkpointVersion: envelope.checkpointVersion });
        } else if (frame.kind === "message_persisted") {
          useRuntimeStore.getState().reconcilePersistedMessage(frame.chatId, frame.message, generationId);
          useRuntimeStore.getState().dispatch({ type: "stream_progressed", runId: captureRunId, sequence, firstSequence: sequence, checkpointVersion: envelope.checkpointVersion });
        } else if (frame.kind === "done") {
          flushNow();
          terminalStatus = frame.status;
          useRuntimeStore.getState().dispatch({ type: "stream_progressed", runId: captureRunId, sequence, firstSequence: sequence, checkpointVersion: envelope.checkpointVersion });
          useRuntimeStore.getState().dispatch({ type: "stream_closed", runId: captureRunId, status: frame.status });
          sseLog("done", { runId: captureRunId, status: frame.status, sequence });
        } else {
          queueFrame({
            type: "frame_received",
            runId: captureRunId,
            frame,
            sequence,
            checkpointVersion: envelope.checkpointVersion,
          });
        }
      } catch (error) {
        sseLog("parse_error", { message: error instanceof Error ? error.message : "invalid frame" });
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: false });
        processBuffer(true);
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      processBuffer(false);
    }
  } finally {
    clearTimeout(streamTimeout);
    flushNow();
    if (captureRunId) {
      useRuntimeStore.getState().detachStream(captureRunId);
      await useRuntimeStore.getState().restoreRun(captureRunId, { force: true });
      const restoredStatus = useRuntimeStore.getState().runs[captureRunId]?.runStatus;
      if (restoredStatus && restoredStatus !== "idle") terminalStatus = restoredStatus;
    }
  }

  const status = terminalStatus ?? (streamTimedOut ? "running" : "failed");
  if (captureRunId && !terminalStatus && !streamTimedOut) {
    useRuntimeStore.getState().dispatch({ type: "transport_error", runId: captureRunId, error: "The run stream closed before a terminal frame." });
  }
  return { status, runId: captureRunId };
}
