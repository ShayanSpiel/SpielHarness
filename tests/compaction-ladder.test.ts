import assert from "node:assert/strict";
import test from "node:test";
import { emptyPinnedState, type ChatPinnedState, type MilestoneSummary, type Model, type ModelProvider } from "@spielos/core";
import {
  chooseRecentMessages,
  pickCompactionModel,
  runCompactionLadder,
  shouldCompact
} from "@spielos/providers";
import type { ChatMessage } from "@spielos/providers";

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "m",
    orgId: "o",
    name: "n",
    provider: "openai-compatible",
    model: "test-model",
    baseUrl: null,
    secretEnvKey: null,
    config: {},
    enabled: true,
    ...overrides
  };
}

function makeProvider(model: Model): ModelProvider {
  return { ...model };
}

function makeMessages(count: number, prefix = "user"): ChatMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${prefix} ${index} ${"lorem ipsum ".repeat(40)}`
  }));
}

test("shouldCompact fires when the projected total crosses the trigger ratio", () => {
  const messages = makeMessages(40);
  const currentUser = { role: "user" as const, content: "Final question" };
  assert.equal(shouldCompact({ messages, inputLimit: 2000, systemPromptTokens: 200, currentUserMessage: currentUser }), true);
  assert.equal(shouldCompact({ messages: makeMessages(4), inputLimit: 32_000, systemPromptTokens: 200, currentUserMessage: currentUser }), false);
});

test("pickCompactionModel returns the fallback when the primary is flagged cheap", () => {
  const cheap = makeModel({ id: "cheap", config: { capabilities: { tier: "cheap" } } });
  const fallback = makeModel({ id: "fallback" });
  const picked = pickCompactionModel({ primary: cheap, fallback });
  assert.equal(picked.tier, "fallback");
  assert.equal(picked.model.id, "fallback");
});

test("pickCompactionModel returns the primary when it is not flagged cheap", () => {
  const primary = makeModel({ id: "primary" });
  const fallback = makeModel({ id: "fallback" });
  const picked = pickCompactionModel({ primary, fallback });
  assert.equal(picked.tier, "primary");
  assert.equal(picked.model.id, "primary");
});

test("runCompactionLadder returns the original messages when under the trigger ratio", async () => {
  const messages = makeMessages(4);
  const currentUser = { role: "user" as const, content: "Short follow-up" };
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const result = await runCompactionLadder({
    provider,
    model,
    state,
    messages,
    previousMilestone: null,
    inputLimit: 32_000,
    systemPromptTokens: 200,
    currentUserMessage: currentUser
  });
  assert.equal(result.passesRun, 0);
  assert.equal(result.overflow, false);
  assert.equal(result.finalMessages.length, messages.length);
  assert.deepEqual(result.state, state);
});

test("runCompactionLadder surfaces a recoverable overflow when even pass 6 cannot fit", async () => {
  // Make the current user message so large that even after every pass
  // we cannot fit it under the input limit. The ladder must report
  // overflow so the runtime can ask the user to remove context.
  const messages = makeMessages(20, "x".padEnd(400, "y"));
  const currentUser = { role: "user" as const, content: "x".repeat(8000) };
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const result = await runCompactionLadder({
    provider,
    model,
    state,
    messages,
    previousMilestone: null,
    inputLimit: 1024,
    systemPromptTokens: 800,
    currentUserMessage: currentUser
  });
  assert.ok(result.passesRun >= 1, "expected at least one pass attempt");
  assert.equal(result.overflow, true);
});

test("chooseRecentMessages is the underlying trim primitive used by the ladder", () => {
  const messages: ChatMessage[] = [
    { role: "user", content: "a".repeat(400) },
    { role: "assistant", content: "b".repeat(400) },
    { role: "user", content: "c".repeat(400) }
  ];
  const result = chooseRecentMessages(messages, 50);
  assert.equal(result.removed.length, 2);
  assert.equal(result.kept.length, 1);
  assert.equal(result.kept[0]?.content, "c".repeat(400));
});

test("runCompactionLadder records the prior milestone when one is supplied", async () => {
  const previousMilestone: MilestoneSummary = {
    id: "m0",
    title: "Initial planning",
    summary: "We outlined the launch.",
    decisionsMade: ["Use Stripe"],
    workCompleted: ["Initial draft"],
    unresolvedItems: [],
    sourceMessageIds: ["m1"],
    createdAt: "2026-07-16T00:00:00.000Z"
  };
  const messages = makeMessages(4);
  const currentUser = { role: "user" as const, content: "Quick follow-up" };
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const result = await runCompactionLadder({
    provider,
    model,
    state,
    messages,
    previousMilestone,
    inputLimit: 32_000,
    systemPromptTokens: 200,
    currentUserMessage: currentUser
  });
  assert.equal(result.milestones[0]?.id, "m0");
  assert.equal(result.passesRun, 0);
});
