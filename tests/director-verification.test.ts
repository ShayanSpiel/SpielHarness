import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import {
  completionCriteriaSchema,
  requiredToolCallSchema,
  requiredEvalThresholdSchema,
} from "@spielos/core";

describe("completionCriteriaSchema", () => {
  it("parses a valid criteria with all fields", () => {
    const result = completionCriteriaSchema.safeParse({
      requiredArtifacts: ["report.pdf"],
      requiredWorkflows: ["research"],
      requiredToolCalls: [
        { capability: "web_search", minCount: 1 },
      ],
      requiredEvalThresholds: [
        { evalId: "eval-1", minScore: 80 },
      ],
    });
    assert.ok(result.success);
  });

  it("parses a minimal criteria with no required items", () => {
    const result = completionCriteriaSchema.safeParse({});
    assert.ok(result.success);
  });

  it("rejects invalid minCount (zero)", () => {
    const result = completionCriteriaSchema.safeParse({
      requiredToolCalls: [{ capability: "web_search", minCount: 0 }],
    });
    assert.ok(!result.success);
  });

  it("rejects negative minScore (on 0-100 scale)", () => {
    const result = completionCriteriaSchema.safeParse({
      requiredEvalThresholds: [{ evalId: "eval-1", minScore: -1 }],
    });
    assert.ok(!result.success);
  });

  it("rejects minScore above 100", () => {
    const result = completionCriteriaSchema.safeParse({
      requiredEvalThresholds: [{ evalId: "eval-1", minScore: 150 }],
    });
    assert.ok(!result.success);
  });
});

describe("requiredToolCallSchema", () => {
  it("parses valid tool call criteria", () => {
    const result = requiredToolCallSchema.safeParse({
      capability: "web_search",
      minCount: 1,
    });
    assert.ok(result.success);
  });

  it("rejects non-string capability", () => {
    const result = requiredToolCallSchema.safeParse({
      capability: null,
      minCount: 1,
    });
    assert.ok(!result.success);
  });
});

describe("requiredEvalThresholdSchema", () => {
  it("parses valid eval threshold", () => {
    const result = requiredEvalThresholdSchema.safeParse({
      evalId: "eval-1",
      minScore: 85,
    });
    assert.ok(result.success);
  });

  it("rejects non-string evalId", () => {
    const result = requiredEvalThresholdSchema.safeParse({
      evalId: null,
      minScore: 50,
    });
    assert.ok(!result.success);
  });
});
