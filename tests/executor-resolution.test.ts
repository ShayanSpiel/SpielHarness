import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { resolveExplicitExecutor } from "@spielos/core";

function makeRole(id: string, name: string, opts: { systemRole?: string; skillIds?: string[]; status?: string } = {}) {
  return {
    id,
    name,
    status: opts.status ?? "active",
    skillIds: opts.skillIds ?? [],
    metadata: opts.systemRole ? { systemRole: opts.systemRole } as Record<string, unknown> : {} as Record<string, unknown>,
    inputContract: null as unknown,
    outputContract: null as unknown,
  };
}

describe("resolveExplicitExecutor", () => {
  it("resolves via explicit binding", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A"),
      "role-b": makeRole("role-b", "Role B"),
    };
    const result = resolveExplicitExecutor(roles, "skill-1", [
      { skillId: "skill-1", roleId: "role-b" },
    ]);
    assert.ok(result);
    assert.equal(result!.role.id, "role-b");
    assert.equal(result!.ambiguous, undefined);
  });

  it("returns null when explicit binding points to inactive role", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A", { status: "archived" }),
    };
    const result = resolveExplicitExecutor(roles, "skill-1", [
      { skillId: "skill-1", roleId: "role-a" },
    ]);
    assert.equal(result, null);
  });

  it("falls back to skillIds matching", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A", { skillIds: ["skill-1"] }),
    };
    const result = resolveExplicitExecutor(roles, "skill-1");
    assert.ok(result);
    assert.equal(result!.role.id, "role-a");
  });

  it("marks ambiguous when multiple roles claim same skill", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A", { skillIds: ["skill-1"] }),
      "role-b": makeRole("role-b", "Role B", { skillIds: ["skill-1"] }),
    };
    const result = resolveExplicitExecutor(roles, "skill-1");
    assert.ok(result);
    assert.equal(result!.ambiguous, true);
  });

  it("falls back to orchestrator when no role claims the skill", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A", { skillIds: ["skill-2"] }),
      "orch": makeRole("orch", "Orchestrator", { systemRole: "orchestrator" }),
    };
    const result = resolveExplicitExecutor(roles, "skill-1");
    assert.ok(result);
    assert.equal(result!.role.id, "orch");
  });

  it("returns null when no role claims and no orchestrator exists", () => {
    const roles: Record<string, ReturnType<typeof makeRole>> = {
      "role-a": makeRole("role-a", "Role A", { skillIds: ["skill-2"] }),
    };
    const result = resolveExplicitExecutor(roles, "skill-1");
    assert.equal(result, null);
  });
});
