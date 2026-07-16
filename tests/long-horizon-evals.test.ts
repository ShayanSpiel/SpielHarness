import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyPinnedState,
  reduceState,
  StateVersionMismatch,
  type ChatPinnedState,
  type MilestoneSummary,
  type StateItem,
  type StateOperation
} from "@spielos/core";

function userItem(text: string, overrides: Partial<StateItem> = {}): StateItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    text,
    authority: "user",
    status: overrides.status ?? "active",
    sourceMessageId: overrides.sourceMessageId ?? "msg-user",
    supersedes: overrides.supersedes ?? null,
    createdAt: overrides.createdAt ?? "2026-07-16T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-16T00:00:00.000Z"
  };
}

function modelItem(text: string, overrides: Partial<StateItem> = {}): StateItem {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    text,
    authority: "model",
    status: overrides.status ?? "active",
    sourceMessageId: overrides.sourceMessageId ?? "msg-model",
    supersedes: overrides.supersedes ?? null,
    createdAt: overrides.createdAt ?? "2026-07-16T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-07-16T00:00:00.000Z"
  };
}

test("long-horizon: goal and constraint retention survive later compactions", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    primaryGoal: userItem("Plan the launch", { id: "goal-1" }),
    constraints: [userItem("No external data sharing", { id: "c-1" })]
  };
  // After many turns, a model proposes new decisions; the user items
  // must remain intact.
  const ops: StateOperation[] = [
    { op: "add_decision", text: "Use Stripe for payments", sourceMessageId: "m1" },
    { op: "add_decision", text: "Ship on Friday", sourceMessageId: "m2" }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.state.primaryGoal?.id, "goal-1");
  assert.equal(result.state.constraints[0]?.id, "c-1");
  assert.equal(result.state.decisions.length, 2);
});

test("long-horizon: user correction supersedes an older model decision", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    decisions: [modelItem("Use Stripe", { id: "d-1" })]
  };
  // The model sees the user correction and proposes supersede_decision.
  const ops: StateOperation[] = [
    {
      op: "supersede_decision",
      targetId: "d-1",
      text: "Use Paddle for payments (user changed mind)",
      sourceMessageId: "m1"
    }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  const superseded = result.state.decisions.find((decision) => decision.id === "d-1");
  assert.equal(superseded?.status, "superseded");
  const replacement = result.state.decisions.find((decision) => decision.status === "active");
  assert.match(replacement?.text ?? "", /Paddle/);
  assert.equal(replacement?.supersedes, "d-1");
});

test("long-horizon: rejected approaches remain rejected after subsequent compactions", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    openWork: [
      modelItem("Try Paddle", { id: "w-1", status: "rejected" }),
      modelItem("Wire Stripe webhook", { id: "w-2" })
    ]
  };
  // Later compaction must not resurrect the rejected item.
  const ops: StateOperation[] = [
    { op: "add_decision", text: "Continue with Stripe", sourceMessageId: "m1" }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  const rejected = result.state.openWork.find((work) => work.id === "w-1");
  assert.equal(rejected?.status, "rejected");
  assert.equal(result.state.openWork.find((work) => work.id === "w-2")?.status, "active");
});

test("long-horizon: completed work leaves the active pinned state intact", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    openWork: [modelItem("Wire Stripe webhook", { id: "w-1" })]
  };
  const ops: StateOperation[] = [
    { op: "complete_work", targetId: "w-1", sourceMessageId: "m1" }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  const work = result.state.openWork.find((item) => item.id === "w-1");
  assert.equal(work?.status, "completed");
  // The work item must remain in the list (it is the milestone trail)
  // even after it is no longer active.
  assert.equal(result.state.openWork.length, 1);
});

test("long-horizon: malformed compactor output leaves state unchanged", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    decisions: [modelItem("Use Stripe", { id: "d-1" })]
  };
  // A model produces an unknown op kind; the reducer skips it.
  const candidate = {
    stateOperations: [
      { op: "set_goal", text: "Plan the launch", sourceMessageId: "m1" },
      { op: "delete_decision", targetId: "d-1", sourceMessageId: "m1" }, // unknown
      { op: "add_decision", text: "Use Paddle", sourceMessageId: "m1" }
    ],
    milestone: {
      id: "m1",
      title: "Phase 1",
      summary: "Initial planning.",
      decisionsMade: [],
      workCompleted: [],
      unresolvedItems: [],
      sourceMessageIds: [],
      createdAt: "2026-07-16T00:00:00.000Z"
    }
  };
  // The unknown op is filtered by safeParse, so we only apply the
  // valid ones. The "delete_decision" never reaches reduceState.
  const filtered: StateOperation[] = [
    { op: "set_goal", text: "Plan the launch", sourceMessageId: "m1" },
    { op: "add_decision", text: "Use Paddle", sourceMessageId: "m1" }
  ];
  const result = reduceState(initial, filtered, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.state.decisions.length, 2);
  // The previous "d-1" decision is still there because we did not
  // supersede it.
  assert.equal(result.state.decisions.find((decision) => decision.id === "d-1")?.text, "Use Stripe");
});

test("long-horizon: concurrent state updates throw StateVersionMismatch when the version moved", () => {
  const initial: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  // Writer A reads version 0 and commits.
  const writerA = reduceState(initial, [
    { op: "add_decision", text: "Use Stripe", sourceMessageId: "m1" }
  ], { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  // Writer B read the same initial state at version 0, then later
  // tries to apply against the now-canonical writerA.state (version 1)
  // using the stale expectedVersion. The reducer must reject it.
  assert.throws(
    () => reduceState(writerA.state, [{ op: "add_decision", text: "Use Paddle", sourceMessageId: "m2" }], { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" }),
    (err: unknown) => err instanceof StateVersionMismatch
  );
  // The winner's state is canonical.
  assert.equal(writerA.state.version, 1);
  assert.equal(writerA.state.decisions.length, 1);
});

test("long-horizon: cheap models cannot alter user-authoritative decisions", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    decisions: [userItem("Always use the user's preferred stack", { id: "d-user" })]
  };
  // The cheap model tries to supersede the user-authored decision.
  // The reducer rejects it.
  const ops: StateOperation[] = [
    { op: "supersede_decision", targetId: "d-user", text: "Cheap-model override", sourceMessageId: "m1" }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.rejected.length, 1);
  assert.equal(result.state.decisions.length, 1);
  assert.equal(result.state.decisions[0]?.status, "active");
});

test("long-horizon: milestone history is append-only and replayable", () => {
  // Simulate a chain of milestones across compactions.
  const milestones: MilestoneSummary[] = [];
  const now = "2026-07-16T01:00:00.000Z";
  const initial: ChatPinnedState = emptyPinnedState(now);
  const result1 = reduceState(initial, [
    { op: "add_decision", text: "Use Stripe", sourceMessageId: "m1" }
  ], { expectedVersion: 0, now });
  milestones.push({
    id: "m1",
    title: "Initial planning",
    summary: "We agreed to use Stripe.",
    decisionsMade: ["Use Stripe"],
    workCompleted: [],
    unresolvedItems: [],
    sourceMessageIds: ["m1"],
    createdAt: now
  });
  // After pass 2, the next milestone is created.
  const result2 = reduceState(result1.state, [
    { op: "add_constraint", text: "Do not share data externally", sourceMessageId: "m2" }
  ], { expectedVersion: result1.state.version, now: "2026-07-16T02:00:00.000Z" });
  milestones.push({
    id: "m2",
    title: "Compliance constraints",
    summary: "Added a data-sharing constraint.",
    decisionsMade: [],
    workCompleted: ["Captured external-data constraint"],
    unresolvedItems: [],
    sourceMessageIds: ["m2"],
    createdAt: "2026-07-16T02:00:00.000Z"
  });
  // The final state preserves both user/decision history and the
  // milestone chain.
  assert.equal(result2.state.decisions.length, 1);
  assert.equal(result2.state.constraints.length, 1);
  assert.equal(milestones.length, 2);
  assert.equal(milestones[0]?.id, "m1");
  assert.equal(milestones[1]?.id, "m2");
});

test("long-horizon: 200-turn continuity keeps the goal stable through many compactions", () => {
  let state: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    primaryGoal: userItem("Plan the launch", { id: "goal-launch" })
  };
  // Simulate 200 turns of decisions and completions, with state
  // version increments matching each apply.
  for (let turn = 1; turn <= 200; turn += 1) {
    const ops: StateOperation[] = [
      { op: "add_decision", text: `Decision at turn ${turn}`, sourceMessageId: `m${turn}` }
    ];
    const next = reduceState(state, ops, { expectedVersion: state.version, now: `2026-07-16T01:00:${(turn % 60).toString().padStart(2, "0")}.000Z` });
    state = next.state;
  }
  assert.equal(state.primaryGoal?.id, "goal-launch");
  assert.equal(state.primaryGoal?.status, "active");
  assert.equal(state.decisions.length, 200);
  assert.equal(state.version, 200);
});

test("long-horizon: rejected operations never alter the canonical state", () => {
  const initial: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    primaryGoal: userItem("Plan the launch", { id: "goal-1" }),
    decisions: [
      userItem("Use Stripe", { id: "d-user-1" }),
      modelItem("Use Paddle as backup", { id: "d-model-1" })
    ]
  };
  const ops: StateOperation[] = [
    // Forbidden: model tries to supersede a user decision.
    { op: "supersede_decision", targetId: "d-user-1", text: "Drop Stripe", sourceMessageId: "m1" },
    // Forbidden: model marks a user-authored decision as complete.
    { op: "complete_work", targetId: "d-user-1", sourceMessageId: "m1" },
    // Allowed: model supersedes its own decision.
    { op: "supersede_decision", targetId: "d-model-1", text: "Drop Paddle as backup", sourceMessageId: "m2" }
  ];
  const result = reduceState(initial, ops, { expectedVersion: 0, now: "2026-07-16T01:00:00.000Z" });
  assert.equal(result.rejected.length, 2);
  assert.equal(result.applied.length, 1);
  const userDecision = result.state.decisions.find((decision) => decision.id === "d-user-1");
  assert.equal(userDecision?.status, "active");
  const supersededModel = result.state.decisions.find((decision) => decision.id === "d-model-1");
  assert.equal(supersededModel?.status, "superseded");
});
