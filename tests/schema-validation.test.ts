import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { safeParseRole, safeParseSkill, safeParseWorkflow, safeParseEval, validateHarnessEntities } from "@spielos/core";
import type { FileRecord } from "@spielos/core";

function makeFile(overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id: "test-id",
    orgId: "org-id",
    folderId: null,
    fileType: "harness_role",
    status: "active",
    lifecycle: "published",
    enabled: true,
    validationDiagnostics: [],
    title: "Test Role",
    body: "You are a test role.",
    contentFormat: "markdown",
    metadata: {},
    currentVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("safeParseRole", () => {
  it("parses a valid role", () => {
    const result = safeParseRole(makeFile());
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.name, "Test Role");
      assert.equal(result.value.status, "active");
    }
  });

  it("returns diagnostics for invalid status", () => {
    // @ts-expect-error: testing invalid status
    const result = safeParseRole(makeFile({ status: "invalid" }));
    assert.ok(!result.ok);
    if (!result.ok) {
      assert.ok(result.diagnostics.length > 0);
      assert.equal(result.diagnostics[0].field, "status");
    }
  });

  it("extracts skillIds from metadata", () => {
    const result = safeParseRole(makeFile({
      metadata: { skillIds: ["skill-1", "skill-2"] }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.value.skillIds, ["skill-1", "skill-2"]);
    }
  });

  it("falls back to skills key", () => {
    const result = safeParseRole(makeFile({
      metadata: { skills: ["skill-3"] }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.deepEqual(result.value.skillIds, ["skill-3"]);
    }
  });

  it("returns diagnostics for invalid skillIds type", () => {
    const result = safeParseRole(makeFile({
      metadata: { skillIds: "not-an-array" }
    }));
    assert.ok(!result.ok);
  });
});

describe("safeParseSkill", () => {
  it("parses a valid skill", () => {
    const result = safeParseSkill(makeFile({
      fileType: "harness_skill",
      title: "Test Skill",
      metadata: { kind: "llm_call", slug: "test-skill" }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.name, "Test Skill");
      assert.equal(result.value.kind, "llm_call");
      assert.equal(result.value.slug, "test-skill");
    }
  });

  it("returns diagnostics for invalid bindings", () => {
    const result = safeParseSkill(makeFile({
      fileType: "harness_skill",
      metadata: { bindings: "invalid" }
    }));
    assert.ok(!result.ok);
  });
});

describe("safeParseWorkflow", () => {
  it("parses a valid workflow", () => {
    const result = safeParseWorkflow(makeFile({
      fileType: "harness_workflow",
      title: "Test Workflow",
      metadata: {
        nodes: [{ id: "n1", title: "Step 1", roleId: "role-1", skillIds: ["s1"] }],
        edges: [{ id: "e1", source: "n1", target: "n2" }],
        topology: "dag"
      }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.name, "Test Workflow");
      assert.equal(result.value.nodes.length, 1);
      assert.equal(result.value.topology, "dag");
    }
  });

  it("returns diagnostics for invalid nodes", () => {
    const result = safeParseWorkflow(makeFile({
      fileType: "harness_workflow",
      metadata: { nodes: "not-an-array" }
    }));
    assert.ok(!result.ok);
  });
});

describe("safeParseEval", () => {
  it("parses a valid eval", () => {
    const result = safeParseEval(makeFile({
      fileType: "harness_eval",
      title: "Test Eval",
      metadata: {
        rules: [{ id: "r1", label: "Check content", type: "contains", value: "hello" }]
      }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.name, "Test Eval");
      assert.equal(result.value.rules.length, 1);
    }
  });

  it("falls back to evalRules key", () => {
    const result = safeParseEval(makeFile({
      fileType: "harness_eval",
      metadata: {
        evalRules: [{ id: "r1", label: "Check", type: "contains", value: "world" }]
      }
    }));
    assert.ok(result.ok);
    if (result.ok) {
      assert.equal(result.value.rules.length, 1);
    }
  });
});

describe("validateHarnessEntities", () => {
  it("validates a mix of entity types", () => {
    const files: FileRecord[] = [
      makeFile({ id: "role-1", fileType: "harness_role", title: "Role 1", metadata: { skillIds: ["skill-1"] } }),
      makeFile({ id: "skill-1", fileType: "harness_skill", title: "Skill 1", metadata: { kind: "llm_call" } }),
      makeFile({ id: "wf-1", fileType: "harness_workflow", title: "WF 1", metadata: { nodes: [], edges: [] } }),
      makeFile({ id: "eval-1", fileType: "harness_eval", title: "Eval 1", metadata: { rules: [] } }),
    ];

    const result = validateHarnessEntities(files);
    assert.ok(Object.keys(result.roles).includes("role-1"));
    assert.ok(Object.keys(result.skills).includes("skill-1"));
    assert.ok(Object.keys(result.workflows).includes("wf-1"));
    assert.ok(Object.keys(result.evals).includes("eval-1"));
    assert.equal(result.diagnostics.length, 0);
  });

  it("collects diagnostics for invalid entities", () => {
    const files: FileRecord[] = [
      makeFile({ id: "bad-role", fileType: "harness_role", status: "invalid" as any }),
    ];

    const result = validateHarnessEntities(files);
    assert.equal(Object.keys(result.roles).length, 0);
    assert.ok(result.diagnostics.length > 0);
  });
});
