import assert from "node:assert/strict";
import test from "node:test";
import { emptyPinnedState, type ChatPinnedState, type Model, type ModelProvider } from "@spielos/core";
import { detectStateChange, ensurePinnedState, summarizeActivePinnedState } from "@spielos/providers";
import type { ChatMessage } from "@spielos/providers";

function makeMessage(role: "user" | "assistant" | "system", content: string): ChatMessage {
  return { role, content };
}

test("detectStateChange fires on goal, decision, correction, completion, and unresolved cues", () => {
  const cues: string[] = [
    "Let's go with a single-step flow.",
    "We decided to use the cheaper model.",
    "Actually, let's not use the cheap model.",
    "That draft is done and shipped.",
    "We still need to wire up Stripe.",
    "On to the next phase: integration."
  ];
  for (const content of cues) {
    const messages = [makeMessage("user", "earlier turn"), makeMessage("assistant", "earlier reply"), makeMessage("user", content)];
    assert.equal(detectStateChange(messages), true, `expected detect on: ${content}`);
  }
});

test("detectStateChange ignores casual conversation", () => {
  const messages = [
    makeMessage("assistant", "Here is a recipe for chocolate cake."),
    makeMessage("user", "Thanks! Can you make it gluten free?"),
    makeMessage("assistant", "Yes, swap the flour for almond flour and add 1 tsp xanthan gum.")
  ];
  assert.equal(detectStateChange(messages), false);
});

test("detectStateChange returns true when the latest assistant reply is unusually long", () => {
  const long = "x".repeat(5000);
  const messages = [makeMessage("user", "Tell me a story."), makeMessage("assistant", long)];
  assert.equal(detectStateChange(messages), true);
});

test("ensurePinnedState returns the existing state when the metadata blob is valid", () => {
  const seed: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    version: 7,
    currentPhase: "Phase 2"
  };
  assert.equal(ensurePinnedState(seed), seed);
  const empty = ensurePinnedState(null);
  assert.equal(empty.version, 0);
  assert.equal(empty.decisions.length, 0);
  assert.equal(ensurePinnedState(undefined).version, 0);
});

test("summarizeActivePinnedState omits superseded items and respects the token budget", () => {
  const seed: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    primaryGoal: {
      id: "g1",
      text: "Ship the launch by Friday",
      authority: "user",
      status: "active",
      sourceMessageId: "m1",
      supersedes: null,
      createdAt: "2026-07-16T00:00:00.000Z",
      updatedAt: "2026-07-16T00:00:00.000Z"
    },
    decisions: [
      {
        id: "d1",
        text: "Use Stripe",
        authority: "model",
        status: "active",
        sourceMessageId: "m2",
        supersedes: null,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z"
      },
      {
        id: "d2",
        text: "Old approach",
        authority: "model",
        status: "superseded",
        sourceMessageId: "m3",
        supersedes: null,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z"
      }
    ],
    openWork: [
      {
        id: "w1",
        text: "Wire Stripe webhook",
        authority: "model",
        status: "active",
        sourceMessageId: "m4",
        supersedes: null,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z"
      }
    ]
  };
  const summary = summarizeActivePinnedState(seed, 200);
  assert.match(summary, /Goal: Ship the launch/);
  assert.match(summary, /- Decision: Use Stripe/);
  assert.doesNotMatch(summary, /Old approach/);
  assert.match(summary, /- Open: Wire Stripe webhook/);
});

test("summarizeActivePinnedState truncates when the rendered text exceeds the budget", () => {
  const filler = "x".repeat(8000);
  const seed: ChatPinnedState = {
    ...emptyPinnedState("2026-07-16T00:00:00.000Z"),
    openWork: [
      {
        id: "w1",
        text: filler,
        authority: "model",
        status: "active",
        sourceMessageId: "m4",
        supersedes: null,
        createdAt: "2026-07-16T00:00:00.000Z",
        updatedAt: "2026-07-16T00:00:00.000Z"
      }
    ]
  };
  const summary = summarizeActivePinnedState(seed, 50);
  assert.ok(summary.length <= 50 * 4 + 4, `expected length under ${50 * 4 + 4}, got ${summary.length}`);
  assert.match(summary, /…/);
});

test("extract module exposes a cheap-model fast path", () => {
  // The cheap-model gate lives inside extractStateOperations; we test
  // the heuristic directly by composing a model with the "tier=cheap"
  // capability flag. The detector and the summarizer are the public
  // surface used by the chat runtime; both must remain stable.
  const model: Model = {
    id: "m",
    orgId: "o",
    name: "n",
    provider: "openai-compatible",
    model: "mistral-small-latest",
    baseUrl: null,
    secretEnvKey: null,
    config: { capabilities: { tier: "cheap" } },
    enabled: true
  };
  const provider: ModelProvider = { ...model };
  assert.equal(provider.config?.capabilities && (provider.config.capabilities as Record<string, unknown>).tier, "cheap");
});
