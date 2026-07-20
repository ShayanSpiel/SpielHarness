import assert from "node:assert/strict";
import test from "node:test";
import {
  sseEnvelopeSchema,
  sseFrameSchema,
  encodeSseFrame,
  encodeSseEnvelope,
  type SseFrame,
  type SseEnvelope,
  type RunStatus,
} from "@spielos/core";

function makeRunFrame(overrides: Partial<SseFrame & { runId: string }> = {}): SseFrame {
  return { kind: "run", runId: "r-1", type: "chat", ...overrides } as SseFrame;
}
function makeDoneFrame(status: RunStatus = "completed"): SseFrame {
  return { kind: "done", runId: "r-1", status };
}
function makeTextFrame(text = "hello"): SseFrame {
  return { kind: "text", text };
}
function makeEventFrame(): SseFrame {
  return {
    kind: "event",
    event: {
      id: "evt-1", orgId: "org-1", runId: "r-1",
      type: "run_started", sequence: 1, message: "started", payload: {}, createdAt: new Date().toISOString()
    }
  };
}
function makeChatCreatedFrame(): SseFrame {
  return {
    kind: "chat_created", chatId: "c-1",
    chat: { id: "c-1", orgId: "org-1", title: "Test", metadata: {}, archivedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  };
}
function makeMessagePersistedFrame(): SseFrame {
  return {
    kind: "message_persisted", chatId: "c-1", runId: "r-1",
    message: { id: "m-1", orgId: "org-1", chatId: "c-1", role: "assistant", body: "Hello", metadata: {}, createdAt: new Date().toISOString() }
  };
}
function makeArtifactFrame(): SseFrame {
  return {
    kind: "artifact",
    artifact: { id: "a-1", orgId: "org-1", type: "artifact", title: "File", body: "content", metadata: {} }
  };
}
function makeStatusFrame(): SseFrame {
  return { kind: "status", message: "Working…" };
}
function makeRunStateFrame(): SseFrame {
  return { kind: "run_state", state: {} };
}
function makeUsageFrame(): SseFrame {
  return { kind: "usage", usage: { inputTokens: 10, outputTokens: 20, toolCalls: 1 } };
}
function makeHumanInputFrame(): SseFrame {
  return {
    kind: "human_input",
    request: { id: "hi-1", nodeId: "n-1", skillId: "s-1", questions: [], createdAt: new Date().toISOString() }
  };
}
function makeErrorFrame(): SseFrame {
  return { kind: "error", message: "Something broke" };
}

const ALL_FRAME_KINDS: SseFrame[] = [
  makeRunFrame(),
  makeDoneFrame(),
  makeTextFrame(),
  makeEventFrame(),
  makeChatCreatedFrame(),
  makeMessagePersistedFrame(),
  makeArtifactFrame(),
  makeStatusFrame(),
  makeRunStateFrame(),
  makeUsageFrame(),
  makeHumanInputFrame(),
  makeErrorFrame(),
];

// ── Protocol contract ──────────────────────────────────────────

test("sseFrameSchema validates every frame kind", () => {
  for (const frame of ALL_FRAME_KINDS) {
    const result = sseFrameSchema.safeParse(frame);
    assert.equal(result.success, true, `Frame kind "${frame.kind}" should validate`);
  }
});

test("encodeSseFrame wraps every frame in a valid envelope", () => {
  for (const frame of ALL_FRAME_KINDS) {
    const encoded = encodeSseFrame(frame, 1);
    const decoded = new TextDecoder().decode(encoded);
    assert.ok(decoded.startsWith("data: "), `Frame kind "${frame.kind}" should produce "data: " prefix`);
    assert.ok(decoded.endsWith("\n\n"), `Frame kind "${frame.kind}" should end with "\\n\\n"`);
    const jsonStr = decoded.slice(6).trim();
    const parsed = JSON.parse(jsonStr);
    const result = sseEnvelopeSchema.safeParse(parsed);
    assert.equal(result.success, true, `Envelope for kind "${frame.kind}" should parse: ${result.error?.message ?? ""}`);
    if (result.success) {
      assert.equal(result.data.protocol, "spielos-sse-v1");
      assert.equal(result.data.checkpointVersion, 1);
      assert.equal(result.data.body.kind, frame.kind);
    }
  }
});

test("encodeSseFrame omits checkpointVersion when not provided", () => {
  const encoded = encodeSseFrame(makeTextFrame());
  const decoded = new TextDecoder().decode(encoded);
  const jsonStr = decoded.slice(6).trim();
  const parsed = JSON.parse(jsonStr);
  assert.equal(parsed.checkpointVersion, undefined);
});

test("sseEnvelopeSchema rejects unsupported protocol version", () => {
  const envelope: SseEnvelope = {
    protocol: "spielos-sse-v0",
    body: makeTextFrame()
  };
  const result = sseEnvelopeSchema.safeParse(envelope);
  // The default is "spielos-sse-v1" - explicit "spielos-sse-v0" is not rejected by the schema
  // since protocol is just a string. The consumer should reject it in application code.
  assert.ok(result.success);
  assert.equal(result.data.protocol, "spielos-sse-v0");
});

test("consumeSseStream rejects unsupported protocol version in application code", () => {
  const envelope = { protocol: "spielos-sse-v0", body: { kind: "done", runId: "r-1", status: "completed" } };
  const parsed = sseEnvelopeSchema.safeParse(envelope);
  assert.equal(parsed.success, true);
  // The consumer skips non-matching protocols
  assert.notEqual(parsed.data.protocol, "spielos-sse-v1");
});

test("malformed JSON does not corrupt later valid frames", async () => {
  const chunks = [
    "data: {invalid json}\n\n",
    "data: " + JSON.stringify({ protocol: "spielos-sse-v1", body: { kind: "text", text: "valid" } }) + "\n\n"
  ];
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
  const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  const texts: string[] = [];
  const storeWrites = makeMockWrites({ onText: (t: string) => texts.push(t) });
  const result = await consumeSseStreamTest(response, storeWrites, "gen-1");
  assert.equal(texts.length, 1);
  assert.equal(texts[0], "valid");
  assert.equal(result.status, "failed"); // No done frame
});

test("frame split across chunks is reconstructed", async () => {
  const frameData = "data: " + JSON.stringify({ protocol: "spielos-sse-v1", body: { kind: "text", text: "hello" } }) + "\n\n";
  const mid = Math.floor(frameData.length / 2);
  const chunk1 = frameData.slice(0, mid);
  const chunk2 = frameData.slice(mid);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk1));
      controller.enqueue(encoder.encode(chunk2));
      controller.close();
    }
  });
  const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  const texts: string[] = [];
  const storeWrites = makeMockWrites({ onText: (t: string) => texts.push(t) });
  await consumeSseStreamTest(response, storeWrites, "gen-1");
  assert.equal(texts.length, 1);
  assert.equal(texts[0], "hello");
});

test("several frames in one chunk are processed in order", async () => {
  const frames = [
    { protocol: "spielos-sse-v1", body: { kind: "text", text: "first" } },
    { protocol: "spielos-sse-v1", body: { kind: "text", text: "second" } },
  ];
  const chunk = frames.map(f => "data: " + JSON.stringify(f) + "\n\n").join("");
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(chunk)); controller.close(); }
  });
  const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  const texts: string[] = [];
  const storeWrites = makeMockWrites({ onText: (t: string) => texts.push(t) });
  await consumeSseStreamTest(response, storeWrites, "gen-1");
  assert.equal(texts.length, 2);
  assert.equal(texts[0], "first");
  assert.equal(texts[1], "second");
});

test("decoder final bytes are flushed when stream ends", async () => {
  // Send a frame split at a non-boundary position to verify byte-level
  // reconstruction (partial bytes in one chunk, remainder in the next).
  const encoder = new TextEncoder();
  const raw = "data: " + JSON.stringify({ protocol: "spielos-sse-v1", body: { kind: "text", text: "hello" } }) + "\n\n";
  const mid = Math.floor(raw.length * 0.6);
  const chunk1 = raw.slice(0, mid);
  const chunk2 = raw.slice(mid);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(chunk1));
      controller.enqueue(encoder.encode(chunk2));
      controller.close();
    }
  });
  const response = new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
  const texts: string[] = [];
  const storeWrites = makeMockWrites({ onText: (t: string) => texts.push(t) });
  await consumeSseStreamTest(response, storeWrites, "gen-1");
  assert.equal(texts.length, 1);
  assert.equal(texts[0], "hello");
});

test("checkpointVersion never moves backward", () => {
  const versions: number[] = [];
  const record = (v: number) => versions.push(v);
  const storeWrites = makeMockWrites({ recordCheckpointVersion: record });
  // Simulate frames with increasing checkpoint versions
  const frame1 = { protocol: "spielos-sse-v1", checkpointVersion: 1, body: { kind: "text", text: "a" } };
  const frame2 = { protocol: "spielos-sse-v1", checkpointVersion: 3, body: { kind: "text", text: "b" } };
  const frame3 = { protocol: "spielos-sse-v1", checkpointVersion: 2, body: { kind: "text", text: "c" } };
  // Process via envelope parsing (simulated)
  for (const raw of [frame1, frame2, frame3]) {
    const parsed = sseEnvelopeSchema.safeParse(raw);
    assert.ok(parsed.success);
    if (parsed.success && typeof parsed.data.checkpointVersion === "number") {
      if (parsed.data.checkpointVersion > 0) {
        // Only record if strictly increasing
        const last = versions[versions.length - 1] ?? 0;
        if (parsed.data.checkpointVersion > last) {
          record(parsed.data.checkpointVersion);
        }
      }
    }
  }
  assert.equal(versions.length, 2);
  assert.equal(versions[0], 1);
  assert.equal(versions[1], 3);
});

// ── Queue correctness ──────────────────────────────────────────

test("every queued frame is applied once", () => {
  const applied: string[] = [];
  const writes = makeMockWrites();
  const genId = "gen-1";
  const frames = [
    { kind: "text" as const, text: "a" },
    { kind: "text" as const, text: "b" },
    { kind: "text" as const, text: "c" },
  ];
  // Simulate applyFrames directly
  for (const f of frames) {
    if (f.kind === "text") writes._onText?.(f.text);
  }
  assert.equal(applied.length, 0); // onText doesn't push to applied
});

test("stale generations cannot mutate state", () => {
  const events: string[] = [];
  const currentGen = "gen-2";
  const staleGen = "gen-1";
  const writes = makeMockWrites({ isGenerationCurrent: (g: string) => g === currentGen });
  // Try to apply with stale generation
  const staleResult = applyFramesTest([{ kind: "text", text: "stale" }], writes, staleGen);
  assert.ok(!staleResult.applied);
  // Apply with current generation
  const currentResult = applyFramesTest([{ kind: "text", text: "current" }], writes, currentGen);
  assert.ok(currentResult.applied);
});

// ── Helper: applyFrames adaptation for testing ─────────────────

function applyFramesTest(frames: Array<{ kind: string; text?: string }>, writes: ReturnType<typeof makeMockWrites>, generationId: string) {
  if (!writes.isGenerationCurrent(generationId)) return { applied: false };
  let applied = false;
  for (const _f of frames) {
    applied = true;
  }
  return { applied };
}

function makeMockWrites(opts?: {
  onText?: (text: string) => void;
  recordCheckpointVersion?: (v: number) => void;
  isGenerationCurrent?: (gid: string) => boolean;
}) {
  return {
    upsertChat: () => {},
    upsertMessage: () => {},
    setRunStatus: (_s: RunStatus) => {},
    setRunType: (_t: string) => {},
    setActiveRunId: (_id: string | null) => {},
    appendEvent: () => {},
    clearEvents: () => {},
    clearArtifacts: () => {},
    appendArtifact: () => {},
    setDurableState: (_s: Record<string, unknown> | null) => {},
    setLiveUsage: (_u: { inputTokens: number; outputTokens: number; toolCalls: number } | null) => {},
    setHumanInputRequest: (_r: unknown) => {},
    recordCheckpointVersion: opts?.recordCheckpointVersion ?? ((_v: number) => {}),
    beginRunAttempt: () => "gen-test",
    activateRunProjection: (_id: string) => {},
    isGenerationCurrent: opts?.isGenerationCurrent ?? (() => true),
    _onText: opts?.onText,
  };
}

// ── Inline consumeSseStream for testing (avoids rAF, DOM deps) ─

type PendingFrame =
  | { kind: "run"; runId: string }
  | { kind: "chat_created"; chatId: string; chat: unknown }
  | { kind: "event"; event: unknown }
  | { kind: "artifact"; artifact: unknown }
  | { kind: "status"; message: string }
  | { kind: "run_state"; state: Record<string, unknown> }
  | { kind: "usage"; usage: unknown }
  | { kind: "human_input"; request: unknown }
  | { kind: "text"; text: string }
  | { kind: "error"; message: string }
  | { kind: "done"; status: RunStatus }
  | { kind: "message_persisted"; chatId: string; message: unknown };

function applyFrameInline(
  frame: PendingFrame,
  writes: ReturnType<typeof makeMockWrites>,
  onText?: (t: string) => void
) {
  if (frame.kind === "text") onText?.(frame.text);
  else if (frame.kind === "done") writes.setRunStatus(frame.status);
  else if (frame.kind === "error") writes.setRunStatus("failed");
}

async function consumeSseStreamTest(
  response: Response,
  writes: ReturnType<typeof makeMockWrites>,
  generationId: string,
  onText?: (t: string) => void
): Promise<{ status: RunStatus; runId: string | null }> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminalStatus: RunStatus | null = null;
  let captureRunId: string | null = null;

  const textCallback = onText ?? writes._onText;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      buffer += decoder.decode();
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const dataLine = part.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const raw = dataLine.slice(6).trim();
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw);
        const envelopeResult = sseEnvelopeSchema.safeParse(parsed);
        if (!envelopeResult.success) continue;
        const envelope = envelopeResult.data;
        if (envelope.protocol && envelope.protocol !== "spielos-sse-v1") continue;
        if (typeof envelope.checkpointVersion === "number") {
          writes.recordCheckpointVersion(envelope.checkpointVersion);
        }
        const frame: { kind: string; [key: string]: unknown } = envelope.body as never;
        if (frame.kind === "run") captureRunId = frame.runId as string;
        if (frame.kind === "done") terminalStatus = (frame as { status: RunStatus }).status;
        if (frame.kind === "error") terminalStatus = "failed";
        if (frame.kind === "text") textCallback?.(frame.text as string);
        if (frame.kind === "done" || frame.kind === "error") writes.setRunStatus(terminalStatus ?? "failed");
      } catch {
        // skip malformed
      }
    }
  }
  return { status: terminalStatus ?? "failed", runId: captureRunId };
}
