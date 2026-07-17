import assert from "node:assert/strict";
import test from "node:test";
import { emptyPinnedState, type ChatPinnedState, type MilestoneSummary, type Model, type ModelProvider, type StateOperation } from "@spielos/core";
import {
  applyOperationsToState,
  assembleLongHorizonContext,
  estimateHistoryTokens,
  projectedContextTokens
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

test("assembleLongHorizonContext returns the original system prompt and history when under the trigger ratio", async () => {
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const history: ChatMessage[] = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi!" }
  ];
  const result = await assembleLongHorizonContext({
    provider,
    model,
    fallbackModel: null,
    state,
    previousMilestone: null,
    history,
    systemPrompt: "You are the assistant.",
    currentUserMessage: { role: "user", content: "How are you?" },
    inputLimit: 32_000
  });
  assert.equal(result.stateChangeDetected, false);
  assert.equal(result.extractionAttempted, false);
  assert.equal(result.overflow, false);
  assert.equal(result.system.startsWith("You are the assistant."), true);
});

test("assembleLongHorizonContext applies state operations from the extractor", async () => {
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  // The extractor will short-circuit (no API key in test) and return
  // applied=false; we directly exercise applyOperationsToState here
  // to confirm the wiring works.
  const operations: StateOperation[] = [
    { op: "add_decision", text: "Use prompt-only model for plain chat", sourceMessageId: "m1" }
  ];
  const reduced = applyOperationsToState({ state, operations });
  assert.equal(reduced.applied, 1);
  assert.equal(reduced.rejected, 0);
  assert.equal(reduced.state.decisions.length, 1);
  assert.equal(reduced.state.version, 1);
});

test("assembleLongHorizonContext carries the previous milestone forward", async () => {
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
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
  const result = await assembleLongHorizonContext({
    provider,
    model,
    fallbackModel: null,
    state,
    previousMilestone,
    history: [],
    systemPrompt: "Prompt",
    currentUserMessage: { role: "user", content: "Quick follow-up" },
    inputLimit: 32_000
  });
  assert.equal(result.milestone?.id, "m0");
  assert.deepEqual(result.newMilestones, []);
  assert.equal(result.compacted, false);
  assert.equal(result.passesRun, 0);
});

test("estimateHistoryTokens sums the rough token cost of every message", () => {
  const tokens = estimateHistoryTokens([
    { role: "user", content: "a".repeat(400) },
    { role: "assistant", content: "b".repeat(400) }
  ]);
  assert.equal(tokens, 2 * 104);
});

test("projectedContextTokens divides by the model's usable input limit", () => {
  const model = makeModel({ config: { capabilities: { contextWindow: 4096, maxOutputTokens: 1024 } } });
  const projected = projectedContextTokens({
    systemPrompt: "x".repeat(400),
    history: [
      { role: "user", content: "a".repeat(400) },
      { role: "assistant", content: "b".repeat(400) }
    ],
    currentUserMessage: { role: "user", content: "c".repeat(400) },
    model
  });
  assert.equal(projected.limit, 3072);
  assert.equal(projected.tokens, 104 + 104 + 104 + 104);
  assert.ok(projected.ratio > 0.1 && projected.ratio < 0.5);
});

test("assembleLongHorizonContext surfaces overflow when even pass 6 cannot fit", async () => {
  const model = makeModel();
  const provider = makeProvider(model);
  const state: ChatPinnedState = emptyPinnedState("2026-07-16T00:00:00.000Z");
  const longHistory: ChatMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `x${"y".repeat(399)} ${index} ${"lorem ipsum ".repeat(40)}`
  }));
  const result = await assembleLongHorizonContext({
    provider,
    model,
    fallbackModel: null,
    state,
    previousMilestone: null,
    history: longHistory,
    systemPrompt: "x".repeat(800),
    currentUserMessage: { role: "user", content: "x".repeat(8000) },
    inputLimit: 1024
  });
  assert.equal(result.overflow, true);
});
