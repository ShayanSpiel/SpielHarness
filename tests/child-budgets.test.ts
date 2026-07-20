import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import type { Sql } from "@spielos/db";

type MockRow = Record<string, unknown>;
type SqlCallback = (sql: string, params: unknown[]) => MockRow[] | null;

function buildMockSql(cb: SqlCallback): Sql {
  const fn = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    const result = cb(sql, values);
    return Promise.resolve(result ?? []);
  }) as unknown as Sql;
  (fn as unknown as { json: (v: unknown) => unknown }).json = (v: unknown) => v;
  return fn;
}

describe("child run budget SQL patterns", () => {
  let captured: { sql: string; params: unknown[] };

  function makeSqlWithCapture(returnRows: MockRow[] | ((sql: string) => MockRow[])) {
    captured = { sql: "", params: [] };
    return buildMockSql((sql, params) => {
      captured = { sql, params };
      if (typeof returnRows === "function") return (returnRows as (s: string) => MockRow[])(sql);
      return returnRows;
    });
  }

  it("ensureChildRunBudget inserts on conflict do nothing", async () => {
    const sql = makeSqlWithCapture([]);
    const { ensureChildRunBudget } = await import("@spielos/db");
    await ensureChildRunBudget(sql, "run-1");
    assert.match(captured.sql, /insert into child_run_budgets/i);
    assert.match(captured.sql, /on conflict.*do nothing/i);
    assert.equal(captured.params[0], "run-1");
  });

  it("reserveChildRunSlot returns true when update succeeds", async () => {
    const { reserveChildRunSlot } = await import("@spielos/db");
    const sql = makeSqlWithCapture([{ child_run_count: 1, active_child_runs: 1 }]);
    const result = await reserveChildRunSlot(sql, "run-1", 5, 3);
    assert.ok(result);
    assert.match(captured.sql, /update child_run_budgets/i);
    assert.match(captured.sql, /child_run_count < /i);
    assert.match(captured.sql, /active_child_runs < /i);
  });

  it("reserveChildRunSlot returns false when update fails (no rows)", async () => {
    const { reserveChildRunSlot } = await import("@spielos/db");
    const sql = makeSqlWithCapture([]);
    const result = await reserveChildRunSlot(sql, "run-1", 5, 3);
    assert.ok(!result);
  });

  it("releaseChildRunSlot decrements active_child_runs", async () => {
    const { releaseChildRunSlot } = await import("@spielos/db");
    const sql = makeSqlWithCapture([]);
    await releaseChildRunSlot(sql, "run-1");
    assert.match(captured.sql, /active_child_runs = greatest/i);
  });

  it("releaseChildRunSlot passes input tokens", async () => {
    const { releaseChildRunSlot } = await import("@spielos/db");
    const sql = makeSqlWithCapture([]);
    await releaseChildRunSlot(sql, "run-1", 500);
    assert.match(captured.sql, /child_input_tokens = child_input_tokens \+ \?/i);
  });

  it("incrementCapabilityCall returns true when under limit", async () => {
    const { incrementCapabilityCall } = await import("@spielos/db");
    const sql = makeSqlWithCapture([{ capability_call_count: 1 }]);
    const result = await incrementCapabilityCall(sql, "run-1", "web_search", 10);
    assert.ok(result);
  });

  it("incrementCapabilityCall returns false when over limit", async () => {
    const { incrementCapabilityCall } = await import("@spielos/db");
    const sql = makeSqlWithCapture([]);
    const result = await incrementCapabilityCall(sql, "run-1", "web_search", 10);
    assert.ok(!result);
  });

  it("getChildRunBudget returns row when found", async () => {
    const { getChildRunBudget } = await import("@spielos/db");
    const sql = makeSqlWithCapture([{ parent_run_id: "run-1", child_run_count: 3, active_child_runs: 1 }]);
    const result = await getChildRunBudget(sql, "run-1");
    assert.ok(result);
    assert.equal(result!.parent_run_id, "run-1");
  });

  it("getChildRunBudget returns null when not found", async () => {
    const { getChildRunBudget } = await import("@spielos/db");
    const sql = makeSqlWithCapture([]);
    const result = await getChildRunBudget(sql, "run-1");
    assert.equal(result, null);
  });
});
