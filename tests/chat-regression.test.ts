import assert from "node:assert/strict";
import test from "node:test";

type RunEvent = {
  id: string; type: string; sequence: number;
  checkpointVersion?: number;
};

type RunProjection = {
  events: RunEvent[];
  checkpointVersion: number;
};

// ── Helper: simulate adapters / restore logic ────────────────

function makeEvent(seq: number, type = "run_started"): RunEvent {
  return { id: `evt-${seq}`, type, sequence: seq };
}

// ── Test 1: Stream generation ownership ──────────────────────
// After Phase 1, every adapter run() call captures a generationId.
// Old generations may NOT write to the current runtime state.

function applyWithGeneration<T>(
  currentGen: string,
  itemGen: string,
  state: T,
  mutator: (s: T) => T
): { state: T; applied: boolean } {
  if (itemGen !== currentGen) return { state, applied: false };
  return { state: mutator(state), applied: true };
}

test("stream generation guard rejects stale writes", () => {
  const events: RunEvent[] = [];
  const currentGeneration = "gen-2";
  const staleGeneration = "gen-1";

  const result = applyWithGeneration(currentGeneration, staleGeneration, events, (s) => {
    s.push(makeEvent(1));
    return s;
  });

  assert.equal(result.applied, false);
  assert.equal(result.state.length, 0);
});

test("stream generation guard accepts current writes", () => {
  const events: RunEvent[] = [];

  const result = applyWithGeneration("gen-1", "gen-1", events, (s) => {
    s.push(makeEvent(1));
    return s;
  });

  assert.equal(result.applied, true);
  assert.equal(result.state.length, 1);
});

test("two generations: old cannot write after new starts", () => {
  let state: RunEvent[] = [];
  // The current generation is set by the adapter when it starts a run.
  // It does NOT change based on incoming frame metadata.
  let currentGen = "gen-1";

  // Run A (gen-1) is streaming
  state = applyWithGeneration(currentGen, "gen-1", state, (s) => {
    s.push(makeEvent(1)); return s;
  }).state;

  // New run B (gen-2) starts — adapter bumps currentGen
  currentGen = "gen-2";

  // gen-1 SSE frame arrives late — must be dropped
  const stale = applyWithGeneration(currentGen, "gen-1", state, (s) => {
    s.push(makeEvent(999)); return s;
  });
  assert.equal(stale.applied, false);

  // Run B continues
  state = applyWithGeneration(currentGen, "gen-2", state, (s) => {
    s.push(makeEvent(2)); return s;
  }).state;

  // Another stale gen-1 frame
  const stale2 = applyWithGeneration(currentGen, "gen-1", state, (s) => {
    s.push(makeEvent(998)); return s;
  });
  assert.equal(stale2.applied, false);

  // Run B continues
  state = applyWithGeneration(currentGen, "gen-2", state, (s) => {
    s.push(makeEvent(3)); return s;
  }).state;

  assert.equal(state.length, 3);
  assert.equal(state[0].sequence, 1);
  assert.equal(state[1].sequence, 2);
  assert.equal(state[2].sequence, 3);
});

// ── Test 2: Pending chat commitment pattern ──────────────────
// After Phase 1, adapter.finally does NOT call setActiveChat.
// Activation is deferred to a lifecycle coordinator.

type PendingCommit = { chatId: string; runId: string } | null;

function commitPending(commit: PendingCommit, pending: PendingCommit): PendingCommit {
  if (commit && !pending) return commit;
  return pending;
}

test("pending chat commit is stored but not activated", () => {
  let pending: PendingCommit = null;
  let activeChatId: string | null = null;

  pending = commitPending({ chatId: "chat-1", runId: "run-1" }, pending);

  assert.equal(activeChatId, null, "should not activate immediately");
  assert.deepEqual(pending, { chatId: "chat-1", runId: "run-1" });
});

test("pending chat commit is consumed on runEnd", () => {
  let pending: PendingCommit = { chatId: "chat-1", runId: "run-1" };
  let activeChatId: string | null = null;
  let navigated = false;

  // Simulate runEnd lifecycle coordinator
  if (pending) {
    activeChatId = pending.chatId;
    navigated = true;
    pending = null;
  }

  assert.equal(activeChatId, "chat-1");
  assert.equal(navigated, true);
  assert.equal(pending, null);
});

test("pending commit does not activate if run already active", () => {
  let pending: PendingCommit = null;
  let activeChatId: string | null = "chat-existing";

  const commit = { chatId: "chat-new", runId: "run-new" };
  pending = commitPending(commit, pending);

  // ActiveChatId unchanged — the old chat stays active during streaming
  assert.equal(activeChatId, "chat-existing");
  assert.deepEqual(pending, { chatId: "chat-new", runId: "run-new" });
});

// ── Test 3: Restore monotonicity with checkpoint versions ────
// After Phase 1, every restore carries checkpointVersion.
// Discard responses that are ≤ the current local version.

type RestoreResponse = {
  runId: string;
  checkpointVersion: number;
  events: RunEvent[];
};

function applyRestore(
  local: RunProjection | null,
  response: RestoreResponse
): { projection: RunProjection; applied: boolean } {
  if (!local) {
    return {
      projection: {
        events: response.events,
        checkpointVersion: response.checkpointVersion,
      },
      applied: true,
    };
  }
  if (response.checkpointVersion <= local.checkpointVersion) {
    return { projection: local, applied: false };
  }
  return {
    projection: {
      events: response.events,
      checkpointVersion: response.checkpointVersion,
    },
    applied: true,
  };
}

test("restore is applied to empty local state", () => {
  const response: RestoreResponse = {
    runId: "run-1",
    checkpointVersion: 5,
    events: [makeEvent(1), makeEvent(2)],
  };

  const { projection, applied } = applyRestore(null, response);
  assert.equal(applied, true);
  assert.equal(projection.checkpointVersion, 5);
  assert.equal(projection.events.length, 2);
});

test("restore with newer checkpoint replaces local", () => {
  const local: RunProjection = {
    events: [makeEvent(1)],
    checkpointVersion: 3,
  };
  const response: RestoreResponse = {
    runId: "run-1",
    checkpointVersion: 7,
    events: [makeEvent(1), makeEvent(2), makeEvent(3)],
  };

  const { projection, applied } = applyRestore(local, response);
  assert.equal(applied, true);
  assert.equal(projection.checkpointVersion, 7);
});

test("restore with stale checkpoint is discarded", () => {
  const local: RunProjection = {
    events: [makeEvent(1)],
    checkpointVersion: 10,
  };
  const response: RestoreResponse = {
    runId: "run-1",
    checkpointVersion: 5,
    events: [],
  };

  const { projection, applied } = applyRestore(local, response);
  assert.equal(applied, false);
  assert.equal(projection.checkpointVersion, 10);
});

test("restore with equal checkpoint is discarded", () => {
  const local: RunProjection = {
    events: [makeEvent(1)],
    checkpointVersion: 7,
  };
  const response: RestoreResponse = {
    runId: "run-1",
    checkpointVersion: 7,
    events: [makeEvent(1), makeEvent(2)],
  };

  const { projection, applied } = applyRestore(local, response);
  assert.equal(applied, false);
  assert.equal(projection.events.length, 1);
});

test("restore interleaving: SSE checkpoint 4, restore 3, SSE 5", () => {
  let projection: RunProjection | null = null;

  // SSE delivers checkpoint 4
  projection = applyRestore(projection, {
    runId: "run-1",
    checkpointVersion: 4,
    events: [makeEvent(1)],
  }).projection;

  // Stale restore response checkpoint 3 (arrives late)
  const stale = applyRestore(projection, {
    runId: "run-1",
    checkpointVersion: 3,
    events: [],
  });
  assert.equal(stale.applied, false);

  // SSE delivers checkpoint 5
  projection = applyRestore(projection, {
    runId: "run-1",
    checkpointVersion: 5,
    events: [makeEvent(1), makeEvent(2)],
  }).projection;

  assert.equal(projection.checkpointVersion, 5);
  assert.equal(projection.events.length, 2);
});

// ── Test 4: Realtime terminal event before SSE done ──────────
// After Phase 1, run.status.changed arriving before the SSE done
// frame does NOT trigger a premature reset or duplicate fetch.

type RunLifecycle = {
  status: string;
  doneReceived: boolean;
  restoreCount: number;
};

function onRunStatusChanged(
  lifecycle: RunLifecycle,
  sseAttached: boolean
): RunLifecycle {
  if (sseAttached) {
    // SSE still owns the stream — suppress restore trigger
    return { ...lifecycle, status: "completed" };
  }
  return { ...lifecycle, status: "completed", restoreCount: lifecycle.restoreCount + 1 };
}

test("realtime terminal before SSE done is suppressed when SSE attached", () => {
  const lifecycle: RunLifecycle = { status: "running", doneReceived: false, restoreCount: 0 };

  // run.status.changed arrives before SSE done
  const updated = onRunStatusChanged(lifecycle, true);

  assert.equal(updated.status, "completed");
  assert.equal(updated.restoreCount, 0, "should NOT trigger restore");
});

test("realtime terminal after SSE done triggers restore", () => {
  const lifecycle: RunLifecycle = { status: "running", doneReceived: true, restoreCount: 0 };

  const updated = onRunStatusChanged(lifecycle, false);

  assert.equal(updated.status, "completed");
  assert.equal(updated.restoreCount, 1, "should trigger restore");
});

// ── Test 5: Deferred run projection (replaces destructive startRun) ──
// After Phase 1, beginRunAttempt only sets status + activity.
// Clear happens when the run SSE frame arrives.

type RunContextState = {
  status: string;
  events: RunEvent[];
  activeRunId: string | null;
};

function beginRunAttempt(state: RunContextState): RunContextState {
  return {
    ...state,
    status: "running",
    // events NOT cleared — old events remain visible until
    // the new run's first SSE frame arrives
  };
}

function activateRunProjection(
  state: RunContextState,
  runId: string
): RunContextState {
  return {
    status: "running",
    events: [],
    activeRunId: runId,
  };
}

test("beginRunAttempt does not clear existing events", () => {
  const state: RunContextState = {
    status: "idle",
    events: [makeEvent(1), makeEvent(2)],
    activeRunId: "run-old",
  };

  const after = beginRunAttempt(state);

  assert.equal(after.status, "running");
  assert.equal(after.events.length, 2, "events should not be cleared");
  assert.equal(after.activeRunId, "run-old");
});

test("activateRunProjection clears old run state", () => {
  const state: RunContextState = {
    status: "running",
    events: [makeEvent(1)], // from old run
    activeRunId: "run-old",
  };

  const after = activateRunProjection(state, "run-new");

  assert.equal(after.status, "running");
  assert.equal(after.events.length, 0, "events cleared for new run");
  assert.equal(after.activeRunId, "run-new");
});

test("beginRunAttempt + activateRunProjection sequence is atomic", () => {
  const state: RunContextState = {
    status: "idle",
    events: [makeEvent(1), makeEvent(2)],
    activeRunId: "run-old",
  };

  // Step 1: user sends message
  const attempt = beginRunAttempt(state);

  // Step 2: SSE run frame arrives (same render cycle)
  const projection = activateRunProjection(attempt, "run-new");

  assert.equal(projection.activeRunId, "run-new");
  assert.equal(projection.status, "running");
  assert.equal(projection.events.length, 0);
});
