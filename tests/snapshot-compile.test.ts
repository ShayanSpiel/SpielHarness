import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { buildResolvedRelations, buildContentHashes, invalidateSnapshotCache } from "@spielos/graph/compile";
import type { FileRecord } from "@spielos/core";

function role(id: string, name: string, skillIds: string[] = []) {
  return { id, name, status: "active", skillIds, systemRole: null, metadata: {}, inputContract: null, outputContract: null };
}

function skill(id: string, name: string) {
  return { id, name, kind: "llm_call" as const, status: "active" as const, slug: name, description: "", input: null, output: null, metadata: {}, bindings: [], config: {} };
}

function wfNode(idx: number, roleId: string, skillIds: string[] = []) {
  return { id: `n${idx}`, title: `Node ${idx}`, roleId, skillIds };
}

function workflow(id: string, nodes: ReturnType<typeof wfNode>[]) {
  return { id, name: id, nodes, edges: [], topology: "sequential" as const };
}

function makeFile(id: string, overrides: Partial<FileRecord> = {}): FileRecord {
  return {
    id, orgId: "org", folderId: null, fileType: "harness_role", status: "active",
    lifecycle: "published", enabled: true, validationDiagnostics: [],
    title: id, body: "content", contentFormat: "markdown", metadata: {},
    currentVersion: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01",
    ...overrides,
  };
}

describe("buildContentHashes", () => {
  it("produces deterministc hashes for same input", () => {
    const a = buildContentHashes([makeFile("f1"), makeFile("f2")]);
    const b = buildContentHashes([makeFile("f1"), makeFile("f2")]);
    assert.deepEqual(a, b);
  });

  it("changes hash when content changes", () => {
    const a = buildContentHashes([makeFile("f1")]);
    const b = buildContentHashes([makeFile("f1", { title: "Different" })]);
    assert.notEqual(a["f1"], b["f1"]);
  });

  it("includes all files", () => {
    const result = buildContentHashes([makeFile("f1"), makeFile("f2"), makeFile("f3")]);
    assert.ok(result["f1"]);
    assert.ok(result["f2"]);
    assert.ok(result["f3"]);
    assert.equal(Object.keys(result).length, 3);
  });
});

describe("buildResolvedRelations", () => {
  it("maps roleSkills from skillIds", () => {
    const roles = { "r1": role("r1", "Role 1", ["s1", "s2"]), "r2": role("r2", "Role 2", ["s3"]) };
    const skills = { "s1": skill("s1", "Skill 1"), "s2": skill("s2", "Skill 2"), "s3": skill("s3", "Skill 3") };
    const rel = buildResolvedRelations(roles, {}, skills);
    const r1Skills = rel.roleSkills.get("r1");
    assert.ok(r1Skills);
    assert.deepEqual([...r1Skills!], ["s1", "s2"]);
  });

  it("filters unresolved skillIds", () => {
    const roles = { "r1": role("r1", "Role 1", ["s1", "s_ghost"]) };
    const skills = { "s1": skill("s1", "Skill 1") };
    const rel = buildResolvedRelations(roles, {}, skills);
    const r1Skills = rel.roleSkills.get("r1");
    assert.deepEqual([...r1Skills!], ["s1"]);
  });

  it("maps workflow node roles", () => {
    const roles = { "r1": role("r1", "Role 1"), "r2": role("r2", "Role 2") };
    const wfs = { "wf1": workflow("wf1", [wfNode(0, "r1"), wfNode(1, "r2")]) };
    const rel = buildResolvedRelations(roles, wfs, {});
    const wfRoles = rel.workflowRoles.get("wf1");
    assert.ok(wfRoles);
    assert.equal(wfRoles!.get(0), "r1");
    assert.equal(wfRoles!.get(1), "r2");
  });

  it("maps workflow node skills", () => {
    const roles = { "r1": role("r1", "Role 1") };
    const skills = { "s1": skill("s1", "Skill 1"), "s2": skill("s2", "Skill 2") };
    const wfs = { "wf1": workflow("wf1", [wfNode(0, "r1", ["s1", "s2"])]) };
    const rel = buildResolvedRelations(roles, wfs, skills);
    const wfSkills = rel.workflowSkills.get("wf1");
    assert.ok(wfSkills);
    assert.deepEqual([...wfSkills!.get(0)!], ["s1", "s2"]);
  });
});

describe("invalidateSnapshotCache", () => {
  it("clears all entries when no orgId given", () => {
    invalidateSnapshotCache();
  });

  it("clears specific org entry", () => {
    invalidateSnapshotCache("test-org");
  });
});
