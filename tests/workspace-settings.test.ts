import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  workspaceSettingsSchema,
  executionModeSchema,
  resolveDirectorRunBudget,
  type DirectorRuntimePolicy,
} from "@spielos/core";

const directorPolicy: DirectorRuntimePolicy = {
  maxOutputTokens: 8192,
  maxDurationMs: 900000,
  maxToolCalls: 18,
  maxChildRuns: 6,
  maxParallelChildRuns: 2,
  maxCallsPerCapability: 2,
  maxChildInputTokens: 24000,
};

describe("workspaceSettingsSchema", () => {
  it("parses with defaults when given empty object", () => {
    const result = workspaceSettingsSchema.parse({});
    assert.equal(result.defaultExecutionMode, "director");
    assert.equal(result.defaultModelId, null);
    assert.equal(result.contextLimits.maxInputTokens, 100000);
    assert.equal(result.approvalPolicy.requireApprovalForSideEffects, true);
  });

  it("parses explicit values", () => {
    const result = workspaceSettingsSchema.parse({
      defaultExecutionMode: "direct",
      defaultModelId: "00000000-0000-0000-0000-000000000001",
      contextLimits: { maxInputTokens: 50000, maxOutputTokens: 200000 },
      retrievalPolicy: { knowledgeSearchLimit: 5, memoryRetrievalLimit: 3 },
      directorRuntimePolicy: {
        maxOutputTokens: 200000, maxDurationMs: 600000,
        maxToolCalls: 100, maxChildRuns: 10, maxParallelChildRuns: 3,
        maxCallsPerCapability: 20, maxChildInputTokens: 50000,
      },
      approvalPolicy: { requireApprovalForSideEffects: false },
    });
    assert.equal(result.defaultExecutionMode, "direct");
    assert.equal(result.defaultModelId, "00000000-0000-0000-0000-000000000001");
    assert.equal(result.contextLimits.maxInputTokens, 50000);
    assert.equal(result.retrievalPolicy.knowledgeSearchLimit, 5);
    assert.equal(result.approvalPolicy.requireApprovalForSideEffects, false);
  });

  it("rejects invalid execution mode", () => {
    const result = workspaceSettingsSchema.safeParse({
      defaultExecutionMode: "invalid",
    });
    assert.ok(!result.success);
  });

  it("rejects non-uuid defaultModelId", () => {
    const result = workspaceSettingsSchema.safeParse({
      defaultModelId: "not-a-uuid",
    });
    assert.ok(!result.success);
  });

  it("rejects negative maxInputTokens", () => {
    const result = workspaceSettingsSchema.safeParse({
      contextLimits: { maxInputTokens: -1 },
    });
    assert.ok(!result.success);
  });
});

describe("executionModeSchema", () => {
  it("accepts 'director'", () => {
    assert.ok(executionModeSchema.safeParse("director").success);
  });

  it("accepts 'direct'", () => {
    assert.ok(executionModeSchema.safeParse("direct").success);
  });

  it("rejects unknown modes", () => {
    assert.ok(!executionModeSchema.safeParse("hybrid").success);
  });
});

describe("resolveDirectorRunBudget", () => {
  it("does not impose a cumulative input ceiling by default", () => {
    const budget = resolveDirectorRunBudget(undefined, directorPolicy);
    assert.equal(budget.maxInputTokens, null);
  });

  it("honors an explicitly lower user budget", () => {
    const budget = resolveDirectorRunBudget({ maxInputTokens: 20000 }, directorPolicy);
    assert.equal(budget.maxInputTokens, 20000);
  });

  it("continues to cap the other run resources at workspace policy", () => {
    const budget = resolveDirectorRunBudget({ maxOutputTokens: 99999, maxToolCalls: 999 }, directorPolicy);
    assert.equal(budget.maxOutputTokens, 8192);
    assert.equal(budget.maxToolCalls, 18);
  });
});
