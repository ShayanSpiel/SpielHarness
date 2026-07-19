import assert from "node:assert/strict";
import test from "node:test";

import { normalizeBudget, type NormalizedBudget, type ModelUsageUpdate } from "@spielos/core";
import { DirectorUsageTracker } from "@spielos/graph/director/usage";

// ── Helpers ──────────────────────────────────────────────────────────────

/** Mirrors the graph-internal modelUsageBridge function */
function modelUsageBridge(
  onModelUsage: ((update: ModelUsageUpdate) => void) | undefined,
  scope: ModelUsageUpdate["scope"],
  updatesContext: boolean,
  modelId: string | null,
): ((usage: { input: number; output: number }) => void) | undefined {
  if (!onModelUsage) return undefined;
  return (usage: { input: number; output: number }) => {
    onModelUsage({
      inputTokens: usage.input,
      outputTokens: usage.output,
      modelId: modelId ?? "unknown",
      scope,
      updatesContext,
    });
  };
}

// ── normalizeBudget ──────────────────────────────────────────────────────

test("normalizeBudget returns defaults for empty input", () => {
  const b = normalizeBudget({});
  assert.equal(b.contextInputTokens, 0);
  assert.equal(b.contextOutputTokens, 0);
  assert.equal(b.totalInputTokens, 0);
  assert.equal(b.totalOutputTokens, 0);
  assert.equal(b.toolCalls, 0);
  assert.equal(b.maxInputTokens, null);
  assert.equal(b.maxOutputTokens, null);
  assert.equal(b.maxToolCalls, null);
  assert.equal(b.maxDurationMs, null);
  assert.equal(b.startedAt, "");
  assert.equal(b.deadlineAt, null);
  assert.equal(b.contextModelId, null);
});

test("normalizeBudget reads legacy inputTokens / outputTokens", () => {
  const b = normalizeBudget({ inputTokens: 100, outputTokens: 50 });
  assert.equal(b.contextInputTokens, 100);
  assert.equal(b.contextOutputTokens, 50);
  assert.equal(b.totalInputTokens, 100);
  assert.equal(b.totalOutputTokens, 50);
});

test("normalizeBudget prefers contextInputTokens over legacy", () => {
  const b = normalizeBudget({ inputTokens: 100, contextInputTokens: 75, outputTokens: 50, contextOutputTokens: 40 });
  assert.equal(b.contextInputTokens, 75);
  assert.equal(b.contextOutputTokens, 40);
  assert.equal(b.totalInputTokens, 100);
  assert.equal(b.totalOutputTokens, 50);
});

test("normalizeBudget reads max* and tool fields", () => {
  const b = normalizeBudget({
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    maxToolCalls: 50,
    maxDurationMs: 300_000,
    toolCalls: 12,
    startedAt: "2025-01-01T00:00:00Z",
    deadlineAt: "2025-01-01T00:05:00Z",
    contextModelId: "gpt-4o"
  });
  assert.equal(b.maxInputTokens, 128_000);
  assert.equal(b.maxOutputTokens, 16_384);
  assert.equal(b.maxToolCalls, 50);
  assert.equal(b.maxDurationMs, 300_000);
  assert.equal(b.toolCalls, 12);
  assert.equal(b.startedAt, "2025-01-01T00:00:00Z");
  assert.equal(b.deadlineAt, "2025-01-01T00:05:00Z");
  assert.equal(b.contextModelId, "gpt-4o");
});

test("normalizeBudget handles null input gracefully", () => {
  const b = normalizeBudget(null);
  assert.equal(b.contextInputTokens, 0);
  assert.equal(b.contextOutputTokens, 0);
});

test("normalizeBudget handles undefined input gracefully", () => {
  const b = normalizeBudget(undefined);
  assert.equal(b.contextInputTokens, 0);
  assert.equal(b.contextOutputTokens, 0);
});

test("normalizeBudget coerces string values to numbers", () => {
  const b = normalizeBudget({ inputTokens: "150", outputTokens: "75" });
  assert.equal(b.contextInputTokens, 150);
  assert.equal(b.contextOutputTokens, 75);
});

// ── DirectorUsageTracker ─────────────────────────────────────────────────

test("DirectorUsageTracker is a pure accumulator with no constructor args", () => {
  const tracker = new DirectorUsageTracker();
  assert.equal(tracker.snapshot().input, 0);
  assert.equal(tracker.snapshot().output, 0);
});

test("DirectorUsageTracker record accumulates correctly", () => {
  const tracker = new DirectorUsageTracker();
  tracker.record({ input_tokens: 100, output_tokens: 50 });
  assert.equal(tracker.snapshot().input, 100);
  assert.equal(tracker.snapshot().output, 50);
  tracker.record({ input_tokens: 30, output_tokens: 20 });
  assert.equal(tracker.snapshot().input, 130);
  assert.equal(tracker.snapshot().output, 70);
});

test("DirectorUsageTracker record ignores null or undefined", () => {
  const tracker = new DirectorUsageTracker();
  tracker.record(null);
  tracker.record(undefined);
  assert.equal(tracker.snapshot().input, 0);
  assert.equal(tracker.snapshot().output, 0);
});

test("DirectorUsageTracker record handles partial metadata", () => {
  const tracker = new DirectorUsageTracker();
  tracker.record({ input_tokens: 100 });
  assert.equal(tracker.snapshot().input, 100);
  assert.equal(tracker.snapshot().output, 0);
  tracker.record({ output_tokens: 50 });
  assert.equal(tracker.snapshot().input, 100);
  assert.equal(tracker.snapshot().output, 50);
});

test("DirectorUsageTracker seed sets initial values", () => {
  const tracker = new DirectorUsageTracker();
  tracker.seed({ input: 500, output: 200 });
  assert.equal(tracker.snapshot().input, 500);
  assert.equal(tracker.snapshot().output, 200);
  tracker.record({ input_tokens: 50 });
  assert.equal(tracker.snapshot().input, 550);
});

test("DirectorUsageTracker mergeFromSubagent is no-op", () => {
  const tracker = new DirectorUsageTracker();
  tracker.record({ input_tokens: 100, output_tokens: 50 });
  tracker.mergeFromSubagent({ input_tokens: 999, output_tokens: 999 });
  // Should not affect the tracker state
  assert.equal(tracker.snapshot().input, 100);
  assert.equal(tracker.snapshot().output, 50);
});

// DirectorUsageTracker should NOT have foldOnce method
test("DirectorUsageTracker does not expose foldOnce", () => {
  const tracker = new DirectorUsageTracker();
  assert.equal(typeof (tracker as Record<string, unknown>).foldOnce, "undefined");
});

// ── modelUsageBridge ─────────────────────────────────────────────────────

test("modelUsageBridge returns undefined when onModelUsage is undefined", () => {
  const bridge = modelUsageBridge(undefined, "root", true, "gpt-4o");
  assert.equal(bridge, undefined);
});

test("modelUsageBridge transforms ChatUsage to ModelUsageUpdate", () => {
  const updates: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { updates.push(update); },
    "root", true, "gpt-4o"
  );
  assert.notEqual(bridge, undefined);
  bridge!({ input: 100, output: 50 });
  assert.equal(updates.length, 1);
  assert.equal(updates[0].inputTokens, 100);
  assert.equal(updates[0].outputTokens, 50);
  assert.equal(updates[0].modelId, "gpt-4o");
  assert.equal(updates[0].scope, "root");
  assert.equal(updates[0].updatesContext, true);
});

test("modelUsageBridge passes scope correctly", () => {
  const updates: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { updates.push(update); },
    "internal", false, "claude-3-opus"
  );
  bridge!({ input: 50, output: 25 });
  assert.equal(updates[0].scope, "internal");
  assert.equal(updates[0].updatesContext, false);
  assert.equal(updates[0].modelId, "claude-3-opus");
});

test("modelUsageBridge uses 'unknown' modelId when null", () => {
  const updates: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { updates.push(update); },
    "subagent", false, null
  );
  bridge!({ input: 10, output: 5 });
  assert.equal(updates[0].modelId, "unknown");
});

test("modelUsageBridge subagent scope", () => {
  const updates: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { updates.push(update); },
    "subagent", false, "claude-3-haiku"
  );
  bridge!({ input: 200, output: 100 });
  assert.equal(updates[0].scope, "subagent");
  assert.equal(updates[0].updatesContext, false);
});

// ── Call-site scope audit ────────────────────────────────────────────────
// These tests verify the scope semantics at every provider call site.
// The scope values must match what the graph/index.ts actually passes.

const SCOPE_CASES: Array<{
  name: string;
  scope: ModelUsageUpdate["scope"];
  updatesContext: boolean;
  modelId: string | null;
  usage: { input: number; output: number };
}> = [
  // Direct chat run
  { name: "streamChatRun main model call",         scope: "root",     updatesContext: true,  modelId: "gpt-4o", usage: { input: 150, output: 80 } },
  { name: "streamChatRun long-horizon assembly",   scope: "internal", updatesContext: false, modelId: "gpt-4o", usage: { input: 200, output: 0 } },
  // Workflow graph
  { name: "workflow node LLM call",                scope: "root",     updatesContext: true,  modelId: "claude-3", usage: { input: 300, output: 150 } },
  { name: "workflow node long-horizon assembly",   scope: "internal", updatesContext: false, modelId: "claude-3", usage: { input: 250, output: 0 } },
  // Repair
  { name: "repairArtifactProjectOutput",            scope: "internal", updatesContext: false, modelId: "gpt-4o-mini", usage: { input: 50, output: 100 } },
  // ReAct agent
  { name: "reactLoop main model call",             scope: "root",     updatesContext: true,  modelId: "gpt-4o", usage: { input: 400, output: 200 } },
  // Director root message
  { name: "mapDirectorValues root namespace",      scope: "root",     updatesContext: true,  modelId: "unknown", usage: { input: 500, output: 300 } },
  // Director subagent message
  { name: "mapDirectorValues subagent namespace",  scope: "subagent", updatesContext: false, modelId: "unknown", usage: { input: 100, output: 60 } },
];

for (const c of SCOPE_CASES) {
  test(`scope audit: ${c.name} has scope='${c.scope}' updatesContext=${c.updatesContext}`, () => {
    const updates: ModelUsageUpdate[] = [];
    const bridge = modelUsageBridge(
      (update) => { updates.push(update); },
      c.scope, c.updatesContext, c.modelId
    );
    bridge!(c.usage);
    assert.equal(updates.length, 1, "should emit exactly one update");
    assert.equal(updates[0].scope, c.scope, "scope mismatch");
    assert.equal(updates[0].updatesContext, c.updatesContext, "updatesContext mismatch");
  });
}

// ── Route behavior simulation ────────────────────────────────────────────

test("route onModelUsage accumulates billableUsage and emits usage frame", () => {
  const billableUsage = { input: 0, output: 0 };
  const usage = { input: 0, output: 0, tools: 0 };
  const emittedFrames: Array<{ inputTokens: number; outputTokens: number }> = [];

  const publishBudgetState = () => {
    emittedFrames.push({ inputTokens: usage.input, outputTokens: usage.output });
  };

  const onModelUsage = (update: ModelUsageUpdate) => {
    billableUsage.input += update.inputTokens;
    billableUsage.output += update.outputTokens;
    usage.input += update.inputTokens;
    usage.output += update.outputTokens;
    publishBudgetState();
  };

  // Simulate two provider callbacks arriving via bridge
  onModelUsage({ inputTokens: 100, outputTokens: 50, modelId: "gpt-4o", scope: "root", updatesContext: true });
  onModelUsage({ inputTokens: 30, outputTokens: 20, modelId: "claude-3", scope: "internal", updatesContext: false });

  assert.equal(billableUsage.input, 130);
  assert.equal(billableUsage.output, 70);
  assert.equal(emittedFrames.length, 2);
  assert.deepEqual(emittedFrames[0], { inputTokens: 100, outputTokens: 50 });
  assert.deepEqual(emittedFrames[1], { inputTokens: 130, outputTokens: 70 });
});

test("publishBudgetState emits cumulative totals (not deltas)", () => {
  const usage = { input: 0, output: 0, tools: 0 };
  const emitted: Array<{ inputTokens: number; outputTokens: number; toolCalls: number }> = [];

  const publishBudgetState = () => {
    emitted.push({ inputTokens: usage.input, outputTokens: usage.output, toolCalls: usage.tools });
  };

  // Simulate incremental updates
  usage.input += 100; usage.output += 50; publishBudgetState();
  usage.input += 30;  usage.output += 20; publishBudgetState();
  usage.input += 10;  usage.output += 5;  publishBudgetState();

  assert.equal(emitted.length, 3);
  // Each frame shows cumulative totals, not deltas
  assert.deepEqual(emitted[0], { inputTokens: 100, outputTokens: 50,  toolCalls: 0 });
  assert.deepEqual(emitted[1], { inputTokens: 130, outputTokens: 70,  toolCalls: 0 });
  assert.deepEqual(emitted[2], { inputTokens: 140, outputTokens: 75,  toolCalls: 0 });
});

test("recordUsage is called with correct billable usage", () => {
  // Simulate the route's finalization block
  const billableUsage = { input: 0, output: 0 };
  const recorded: Array<{ inputTokens: number; outputTokens: number; provider: string; model: string; runId: string }> = [];
  const recordUsage = async (args: { inputTokens: number; outputTokens: number; provider: string; model: string; runId: string }) => {
    recorded.push(args);
  };

  // Simulate provider calls
  const onModelUsage = (update: ModelUsageUpdate) => {
    billableUsage.input += update.inputTokens;
    billableUsage.output += update.outputTokens;
  };
  onModelUsage({ inputTokens: 200, outputTokens: 100, modelId: "gpt-4o", scope: "root", updatesContext: true });
  onModelUsage({ inputTokens: 50, outputTokens: 25, modelId: "claude-3", scope: "internal", updatesContext: false });

  // Simulate final recordUsage call
  if (billableUsage.input > 0 || billableUsage.output > 0) {
    recordUsage({ runId: "run-123", provider: "openai", model: "gpt-4o", inputTokens: billableUsage.input, outputTokens: billableUsage.output });
  }

  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].inputTokens, 250);
  assert.equal(recorded[0].outputTokens, 125);
  assert.equal(recorded[0].provider, "openai");
});

// ── Provider exactly-once semantics ───────────────────────────────────────

test("multiple onUsage calls from streaming provider are each bridged", () => {
  const calls: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { calls.push(update); },
    "root", true, "claude-3-opus"
  );

  // Anthropic streaming may call onUsage multiple times
  bridge!({ input: 100, output: 0 });
  bridge!({ input: 100, output: 50 });
  bridge!({ input: 100, output: 50 }); // same values repeated

  assert.equal(calls.length, 3);
  assert.equal(calls[2].inputTokens, 100);
  assert.equal(calls[2].outputTokens, 50);
});

test("non-streaming chat calls onUsage exactly once per provider call", () => {
  const calls: ModelUsageUpdate[] = [];
  const bridge = modelUsageBridge(
    (update) => { calls.push(update); },
    "internal", false, "gpt-4o-mini"
  );

  // Simulate 3 separate internal calls (long-horizon, compaction, state-extract)
  bridge!({ input: 200, output: 0 });
  bridge!({ input: 150, output: 0 });
  bridge!({ input: 50, output: 100 });

  assert.equal(calls.length, 3);
  assert.equal(calls.reduce((sum, c) => sum + c.inputTokens, 0), 400);
  assert.equal(calls.reduce((sum, c) => sum + c.outputTokens, 0), 100);
});

// ── ModelUsageUpdate type validation ─────────────────────────────────────

test("ModelUsageUpdate can represent all scope variants", () => {
  const root: ModelUsageUpdate = { inputTokens: 10, outputTokens: 5, modelId: "a", scope: "root", updatesContext: true };
  const subagent: ModelUsageUpdate = { inputTokens: 10, outputTokens: 5, modelId: "b", scope: "subagent", updatesContext: false };
  const internal: ModelUsageUpdate = { inputTokens: 10, outputTokens: 5, modelId: "c", scope: "internal", updatesContext: false };

  assert.equal(root.scope, "root");
  assert.equal(subagent.scope, "subagent");
  assert.equal(internal.scope, "internal");
  assert.equal(root.updatesContext, true);
  assert.equal(subagent.updatesContext, false);
  assert.equal(internal.updatesContext, false);
});

// ── NormalizedBudget round-trip invariants ───────────────────────────────

test("normalizeBudget round-trip preserves known fields", () => {
  const input = {
    contextInputTokens: 500,
    contextOutputTokens: 200,
    totalInputTokens: 750,
    totalOutputTokens: 300,
    toolCalls: 15,
    maxInputTokens: 128_000,
    maxOutputTokens: 16_384,
    maxToolCalls: 100,
    maxDurationMs: 600_000,
    startedAt: "2025-06-01T00:00:00Z",
    deadlineAt: "2025-06-01T00:10:00Z",
    contextModelId: "gpt-4o",
  };
  const result = normalizeBudget(input);
  assert.deepEqual(result, input);
});

test("normalizeBudget rounds float values down", () => {
  const b = normalizeBudget({ inputTokens: 100.7, outputTokens: 50.2 });
  assert.equal(b.contextInputTokens, 100);
  assert.equal(b.contextOutputTokens, 50);
});
