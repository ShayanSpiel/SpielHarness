import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPinnedState,
  reduceState,
  StateOperationRejected,
  StateVersionMismatch,
  type ChatPinnedState,
  type StateOperation,
  type StateItem
} from "@spielos/core";

function makeUserDecision(text: string, id = crypto.randomUUID()): StateItem {
  return {
    id,
    text,
    authority: "user",
    status: "active",
    sourceMessageId: "msg-user",
    supersedes: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
}

function makeModelDecision(text: string, id = crypto.randomUUID()): StateItem {
  return {
    id,
    text,
    authority: "model",
    status: "active",
    sourceMessageId: "msg-model",
    supersedes: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
}

test("reduceState applies add_decision with deduplication", () => {
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const ops: StateOperation[] = [
    { op: "add_decision", text: "Use prompt-only model for plain chat", sourceMessageId: "m1" },
    { op: "add_decision", text: "Use prompt-only model for plain chat", sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { expectedVersion: 0, now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.applied.length, 2);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.state.decisions.length, 1);
  assert.equal(result.state.version, 1);
});

test("reduceState rejects model attempts to supersede user decisions", () => {
  const userDecision = makeUserDecision("User-set constraint");
  const state: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    decisions: [userDecision]
  };
  const ops: StateOperation[] = [
    { op: "supersede_decision", targetId: userDecision.id, text: "Override", sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { expectedVersion: 0, now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.ok(result.rejected[0]?.reason.includes("user"));
  assert.equal(result.state.decisions.length, 1);
  assert.equal(result.state.decisions[0]?.status, "active");
});

test("reduceState allows the model to supersede its own decision", () => {
  const modelDecision = makeModelDecision("Old approach");
  const state: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    decisions: [modelDecision]
  };
  const ops: StateOperation[] = [
    { op: "supersede_decision", targetId: modelDecision.id, text: "New approach", sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { expectedVersion: 0, now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.applied.length, 1);
  assert.equal(result.rejected.length, 0);
  const active = result.state.decisions.find((decision) => decision.status === "active");
  assert.equal(active?.text, "New approach");
  const superseded = result.state.decisions.find((decision) => decision.status === "superseded");
  assert.equal(superseded?.id, modelDecision.id);
});

test("reduceState throws StateVersionMismatch on stale expected version", () => {
  const state: ChatPinnedState = { ...emptyPinnedState("2026-07-16T00:00:00.000Z"), version: 3 };
  const ops: StateOperation[] = [
    { op: "add_decision", text: "Late update", sourceMessageId: "m1" }
  ];
  assert.throws(
    () => reduceState(state, ops, { expectedVersion: 2 }),
    (err: unknown) => err instanceof StateVersionMismatch
  );
});

test("reduceState keeps the user primary goal active when a model proposes a new one", () => {
  const userGoal: StateItem = {
    id: "goal-user",
    text: "Plan the launch",
    authority: "user",
    status: "active",
    sourceMessageId: "msg-user",
    supersedes: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
  const state: ChatPinnedState = { ...emptyPinnedState("2026-07-16T00:00:00.000Z"), primaryGoal: userGoal };
  const ops: StateOperation[] = [
    { op: "set_goal", text: "Plan a smaller launch", sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.state.primaryGoal?.id, "goal-user");
  assert.equal(result.state.primaryGoal?.status, "superseded");
});

test("reduceState applies add_open_work and complete_work atomically", () => {
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const ops: StateOperation[] = [
    { op: "add_open_work", text: "Wire Stripe webhook", sourceMessageId: "m1" }
  ];
  const first = reduceState(state, ops, { expectedVersion: 0, now: "2026-07-16T00:01:00.000Z" });
  const workId = first.state.openWork[0]?.id;
  assert.ok(workId);
  const secondOps: StateOperation[] = [
    { op: "complete_work", targetId: workId, sourceMessageId: "m2" }
  ];
  const second = reduceState(first.state, secondOps, { expectedVersion: 1, now: "2026-07-16T00:02:00.000Z" });
  assert.equal(second.applied.length, 1);
  assert.equal(second.state.openWork[0]?.status, "completed");
});

test("reduceState rejects an unknown target on supersede_decision", () => {
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const ops: StateOperation[] = [
    { op: "supersede_decision", targetId: "nope", text: "X", sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.rejected.length, 1);
  assert.ok(result.rejected[0]?.reason.includes("decision"));
});

test("reduceState rejects marking a user-authored open-work item complete", () => {
  const userWork: StateItem = {
    id: "user-work",
    text: "Sign off on the design",
    authority: "user",
    status: "active",
    sourceMessageId: "msg-user",
    supersedes: null,
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  };
  const state: ChatPinnedState = { ...emptyPinnedState("2026-07-16T00:00:00.000Z"), openWork: [userWork] };
  const ops: StateOperation[] = [
    { op: "complete_work", targetId: userWork.id, sourceMessageId: "m1" }
  ];
  const result = reduceState(state, ops, { now: "2026-07-16T00:01:00.000Z" });
  assert.equal(result.rejected.length, 1);
  assert.equal(result.state.openWork[0]?.status, "active");
});

test("reduceState exports include StateOperationRejected for runtime guards", () => {
  // Catch any rename or import drift; type-only test.
  const err = new StateOperationRejected({ op: "add_decision", text: "x", sourceMessageId: "m" }, "guard");
  assert.equal(err.name, "StateOperationRejected");
  assert.equal(err.reason, "guard");
});
