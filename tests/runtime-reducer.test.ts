import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runtimeReducer, type RuntimeAction } from "@spielos/core";

function fresh() {
  return { runs: {}, activeRunId: null };
}

function makeRunAction(overrides: Partial<RuntimeAction> = {}): RuntimeAction {
  return {
    type: "run_bound",
    chatId: "chat-1",
    runId: "run-1",
    turnId: "turn-1",
    generationId: "gen-1",
    ...overrides,
  } as RuntimeAction;
}

describe("runtimeReducer", () => {
  // 8. Submission creates one pending turn
  it("submission_started creates a pending run entry", () => {
    const state = fresh();
    const action: RuntimeAction = {
      type: "submission_started",
      chatId: "chat-1",
      generationId: "gen-1",
      idempotencyKey: "ik:abc123",
    };
    const next = runtimeReducer(state, action);
    const pendingId = `pending:gen-1`;
    assert.ok(next.runs[pendingId]);
    assert.equal(next.runs[pendingId].transportStatus, "submitting");
    assert.equal(next.runs[pendingId].runStatus, "running");
    assert.equal(next.runs[pendingId].chatId, "chat-1");
    assert.equal(next.activeRunId, pendingId);
  });

  it("submission_started retains the same chat context projection without carrying old activity", () => {
    const prior = runtimeReducer(fresh(), makeRunAction());
    const state = {
      ...prior,
      runs: {
        ...prior.runs,
        "run-1": {
          ...prior.runs["run-1"],
          usage: { inputTokens: 12, outputTokens: 3, toolCalls: 2, contextInputTokens: 7021 },
          durableState: { context: { maxInputTokens: 64000, maxOutputTokens: 8000 } },
          activity: "Old activity",
          events: [{ id: "old-event" } as never],
        },
      },
    };
    const next = runtimeReducer(state, {
      type: "submission_started",
      chatId: "chat-1",
      generationId: "gen-2",
      idempotencyKey: "ik:next",
    });
    const pending = next.runs["pending:gen-2"];
    assert.equal(pending.usage?.contextInputTokens, 7021);
    assert.equal(pending.durableState?.context?.maxInputTokens, 64000);
    assert.equal(pending.activity, null);
    assert.deepEqual(pending.events, []);
  });

  it("submission_started never transfers context between chats", () => {
    const prior = runtimeReducer(fresh(), makeRunAction());
    const state = {
      ...prior,
      runs: {
        ...prior.runs,
        "run-1": { ...prior.runs["run-1"], usage: { inputTokens: 1, outputTokens: 1, toolCalls: 0, contextInputTokens: 9000 } },
      },
    };
    const next = runtimeReducer(state, {
      type: "submission_started",
      chatId: "chat-2",
      generationId: "gen-2",
      idempotencyKey: "ik:other",
    });
    assert.equal(next.runs["pending:gen-2"].usage, null);
  });

  // 9. Run binding attaches the correct chat and turn
  it("run_bound replaces pending entry with real runId", () => {
    const state = fresh();
    const submitAction: RuntimeAction = {
      type: "submission_started",
      chatId: "chat-1",
      generationId: "gen-1",
      idempotencyKey: "ik:abc",
    };
    const afterSubmit = runtimeReducer(state, submitAction);
    const bindAction: RuntimeAction = {
      type: "run_bound",
      chatId: "chat-1",
      runId: "run-1",
      turnId: "turn-1",
      generationId: "gen-1",
    };
    const next = runtimeReducer(afterSubmit, bindAction);
    assert.ok(!next.runs["pending:gen-1"]);
    assert.ok(next.runs["run-1"]);
    assert.equal(next.runs["run-1"].chatId, "chat-1");
    assert.equal(next.runs["run-1"].turnId, "turn-1");
    assert.equal(next.runs["run-1"].generationId, "gen-1");
    assert.equal(next.activeRunId, "run-1");
  });

  it("a detached pending generation cannot take focus when its run frame arrives", () => {
    const submitted = runtimeReducer(fresh(), {
      type: "submission_started",
      chatId: "chat-old",
      generationId: "gen-old",
      idempotencyKey: "turn:old",
    });
    const detached = { ...submitted, activeRunId: null };
    const bound = runtimeReducer(detached, {
      type: "run_bound",
      chatId: "chat-old",
      runId: "run-old",
      turnId: "turn-old",
      generationId: "gen-old",
    });
    assert.equal(bound.activeRunId, null);
    assert.ok(bound.runs["run-old"]);
    assert.equal(bound.runs["run-old"].chatId, "chat-old");
  });

  // 10. Duplicate action is idempotent
  it("run_bound is idempotent when run already exists", () => {
    const state = fresh();
    const bindAction: RuntimeAction = {
      type: "run_bound",
      chatId: "chat-1",
      runId: "run-1",
      turnId: "turn-1",
      generationId: "gen-1",
    };
    const first = runtimeReducer(state, bindAction);
    const second = runtimeReducer(first, bindAction);
    assert.equal(second.runs["run-1"].runId, "run-1");
    assert.equal(second.runs["run-1"].turnId, "turn-1");
    // Should not create a duplicate entry
    assert.equal(Object.keys(second.runs).length, Object.keys(first.runs).length);
  });

  it("run_bound preserves durable projection when a resumed stream rebinds", () => {
    const bound = runtimeReducer(fresh(), makeRunAction());
    const withEvent = runtimeReducer(bound, {
      type: "frame_received",
      runId: "run-1",
      frame: {
        kind: "event",
        event: {
          id: "event-1",
          orgId: "org-1",
          runId: "run-1",
          type: "run_started",
          sequence: 1,
          message: "Started",
          payload: {},
          createdAt: new Date().toISOString(),
        },
      },
      sequence: 0,
      checkpointVersion: 4,
    });
    const rebound = runtimeReducer(withEvent, {
      ...makeRunAction(),
      generationId: "resume-gen",
    });
    assert.equal(rebound.runs["run-1"].events.length, 1);
    assert.equal(rebound.runs["run-1"].checkpointVersion, 4);
    assert.equal(rebound.runs["run-1"].generationId, "resume-gen");
  });

  // 11. Stale generation cannot mutate another run
  it("frame_received with wrong runId is ignored", () => {
    const state = fresh();
    const bindAction: RuntimeAction = {
      type: "run_bound",
      chatId: "chat-1",
      runId: "run-1",
      turnId: "turn-1",
      generationId: "gen-1",
    };
    const withRun = runtimeReducer(state, bindAction);
    const staleFrame: RuntimeAction = {
      type: "frame_received",
      runId: "run-nonexistent",
      frame: { kind: "status", message: "hello" } as any,
      sequence: 0,
    };
    const next = runtimeReducer(withRun, staleFrame);
    assert.equal(next.runs["run-1"].activity, null);
  });

  // 12. Run status and transport status are independent
  it("stream_closed sets transport to closed but preserves run status", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const close: RuntimeAction = {
      type: "stream_closed",
      runId: "run-1",
      status: "completed",
    };
    const next = runtimeReducer(bind, close);
    assert.equal(next.runs["run-1"].transportStatus, "closed");
    assert.equal(next.runs["run-1"].runStatus, "completed");
    // Run remains addressable
    assert.equal(next.runs["run-1"].runId, "run-1");
  });

  // 13. Terminal run remains inspectable
  it("terminal run is still in runs map", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const close: RuntimeAction = { type: "stream_closed", runId: "run-1", status: "failed" };
    const next = runtimeReducer(bind, close);
    assert.ok(next.runs["run-1"]);
    assert.equal(next.runs["run-1"].transportStatus, "closed");
  });

  // 14. Checkpoint version is isolated per run
  it("checkpoint version is per-run, not global", () => {
    const state = fresh();
    const bind1 = runtimeReducer(state, { ...makeRunAction(), runId: "run-1", generationId: "gen-1" });
    const bind2 = runtimeReducer(bind1, { ...makeRunAction(), runId: "run-2", generationId: "gen-2" });
    const hint1: RuntimeAction = { type: "realtime_hint_received", runId: "run-1", checkpointVersion: 5 };
    const hint2: RuntimeAction = { type: "realtime_hint_received", runId: "run-2", checkpointVersion: 3 };
    const after1 = runtimeReducer(bind2, hint1);
    const after2 = runtimeReducer(after1, hint2);
    assert.equal(after2.runs["run-1"].checkpointVersion, 5);
    assert.equal(after2.runs["run-2"].checkpointVersion, 3);
  });

  // 15. Switching chats does not transfer active run state
  it("activeRunId points to correct run after multiple bindings", () => {
    const state = fresh();
    const bind1 = runtimeReducer(state, { ...makeRunAction(), runId: "run-1", chatId: "chat-1", generationId: "gen-1" });
    assert.equal(bind1.activeRunId, "run-1");
    const bind2 = runtimeReducer(bind1, { ...makeRunAction(), runId: "run-2", chatId: "chat-2", generationId: "gen-2" });
    // Last bound run becomes active
    assert.equal(bind2.activeRunId, "run-2");
    // First run still exists
    assert.ok(bind2.runs["run-1"]);
  });

  // 16. Restoration cannot overwrite a newer checkpoint
  it("realtime_hint_received with older checkpoint is ignored", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const newer: RuntimeAction = { type: "realtime_hint_received", runId: "run-1", checkpointVersion: 10 };
    const older: RuntimeAction = { type: "realtime_hint_received", runId: "run-1", checkpointVersion: 5 };
    const afterNewer = runtimeReducer(bind, newer);
    const afterOlder = runtimeReducer(afterNewer, older);
    assert.equal(afterOlder.runs["run-1"].checkpointVersion, 10);
  });

  // 17. Realtime hint cannot overwrite active SSE state
  it("frame_received updates run status correctly", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const open: RuntimeAction = { type: "stream_opened", runId: "run-1", streamId: "stream-1" };
    const opened = runtimeReducer(bind, open);
    assert.equal(opened.runs["run-1"].transportStatus, "streaming");
    assert.equal(opened.runs["run-1"].streamId, "stream-1");
    assert.equal(opened.runs["run-1"].lastStreamSequence, -1);
  });

  it("native lifecycle events replace stale resume activity", () => {
    const bind = runtimeReducer(fresh(), makeRunAction());
    const resumed = {
      ...bind,
      runs: { ...bind.runs, "run-1": { ...bind.runs["run-1"], activity: "Resuming from the durable checkpoint…" } }
    };
    const next = runtimeReducer(resumed, {
      type: "frame_received",
      runId: "run-1",
      sequence: 1,
      frame: {
        kind: "event",
        event: {
          id: "event-node-started",
          orgId: "org-1",
          runId: "run-1",
          type: "node_started",
          sequence: 1,
          message: "Landing Page Builder started.",
          payload: {},
          createdAt: new Date().toISOString()
        }
      }
    });
    assert.equal(next.runs["run-1"].activity, "Landing Page Builder started.");
  });

  // Sequence gap detection
  it("frame_received detects sequence gap", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const frame1: RuntimeAction = {
      type: "frame_received",
      runId: "run-1",
      frame: { kind: "status", message: "first" } as any,
      sequence: 0,
    };
    const after1 = runtimeReducer(bind, frame1);
    assert.equal(after1.runs["run-1"].lastStreamSequence, 0);

    const frameGap: RuntimeAction = {
      type: "frame_received",
      runId: "run-1",
      frame: { kind: "status", message: "gap" } as any,
      sequence: 5,
    };
    const afterGap = runtimeReducer(after1, frameGap);
    assert.equal(afterGap.runs["run-1"].transportStatus, "reconnecting");
  });

  // Duplicate sequence ignored (start at seq 0 after -1 initial)
  it("frame_received ignores duplicate sequence", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const frame1: RuntimeAction = {
      type: "frame_received",
      runId: "run-1",
      frame: { kind: "status", message: "first" } as any,
      sequence: 0,
    };
    const after1 = runtimeReducer(bind, frame1);
    assert.equal(after1.runs["run-1"].activity, "first");
    assert.equal(after1.runs["run-1"].lastStreamSequence, 0);
    const frameDup: RuntimeAction = {
      type: "frame_received",
      runId: "run-1",
      frame: { kind: "status", message: "dup" } as any,
      sequence: 0,
    };
    const afterDup = runtimeReducer(after1, frameDup);
    assert.equal(afterDup.runs["run-1"].activity, "first");
    assert.equal(afterDup.runs["run-1"].lastStreamSequence, 0);
  });

  it("stream_progressed advances text and persistence frames without fabricating events", () => {
    const bound = runtimeReducer(fresh(), makeRunAction());
    const opened = runtimeReducer(bound, { type: "stream_opened", runId: "run-1", streamId: "run-1", initialSequence: 0 });
    const progressed = runtimeReducer(opened, {
      type: "stream_progressed",
      runId: "run-1",
      sequence: 8,
      firstSequence: 1,
      checkpointVersion: 3,
    });
    assert.equal(progressed.runs["run-1"].lastStreamSequence, 8);
    assert.equal(progressed.runs["run-1"].checkpointVersion, 3);
    assert.equal(progressed.runs["run-1"].events.length, 0);
  });

  // Multiple runs don't interfere
  it("multiple runs have isolated state", () => {
    const state = fresh();
    const r1 = runtimeReducer(state, { ...makeRunAction(), runId: "run-1", chatId: "chat-1", generationId: "gen-1" });
    const r2 = runtimeReducer(r1, { ...makeRunAction(), runId: "run-2", chatId: "chat-2", generationId: "gen-2" });
    const frame1: RuntimeAction = {
      type: "frame_received",
      runId: "run-1",
      frame: { kind: "status", message: "run1 status" } as any,
      sequence: 0,
    };
    const after = runtimeReducer(r2, frame1);
    assert.equal(after.runs["run-1"].activity, "run1 status");
    assert.equal(after.runs["run-2"].activity, null);
  });

  // Transport error
  it("transport_error sets error state", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const err: RuntimeAction = {
      type: "transport_error",
      runId: "run-1",
      error: "connection lost",
    };
    const next = runtimeReducer(bind, err);
    assert.equal(next.runs["run-1"].transportStatus, "error");
    assert.equal(next.runs["run-1"].error, "connection lost");
  });

  // Cancel
  it("cancel_requested keeps durable status until the server confirms cancellation", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const cancel: RuntimeAction = { type: "cancel_requested", runId: "run-1" };
    const next = runtimeReducer(bind, cancel);
    assert.equal(next.runs["run-1"].runStatus, "running");
    assert.equal(next.runs["run-1"].transportStatus, "submitting");
    assert.equal(next.runs["run-1"].activity, "Cancelling…");
  });

  // Human input
  it("human_input_received sets waiting_human status", () => {
    const state = fresh();
    const bind = runtimeReducer(state, makeRunAction());
    const hi: RuntimeAction = {
      type: "human_input_received",
      runId: "run-1",
      request: { id: "req-1", nodeId: "n-1", header: "Question", questions: [], createdAt: "" },
    };
    const next = runtimeReducer(bind, hi);
    assert.equal(next.runs["run-1"].runStatus, "waiting_human");
    assert.ok(next.runs["run-1"].humanInput);
  });

  it("human_input_submitted installs the generation used by the resumed stream", () => {
    const bound = runtimeReducer(fresh(), makeRunAction());
    const next = runtimeReducer(bound, {
      type: "human_input_submitted",
      runId: "run-1",
      generationId: "resume-gen",
    });
    assert.equal(next.runs["run-1"].generationId, "resume-gen");
    assert.equal(next.runs["run-1"].runStatus, "running");
    assert.equal(next.runs["run-1"].transportStatus, "submitting");
  });
});
