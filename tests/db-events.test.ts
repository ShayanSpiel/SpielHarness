import assert from "node:assert/strict";
import test from "node:test";
import { appendRunEvents, type Sql } from "@spielos/db";

test("batched run events cast text records to the database event enum", async () => {
  const statements: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    if (statement.includes("update runs") && statement.includes("next_event_sequence")) {
      return [{ base: 0 }];
    }
    return [];
  }) as unknown as Sql;
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v) => v;

  await appendRunEvents(sql, "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", [{
    event_type: "run_started",
    node_id: null,
    node_title: null,
    skill_id: null,
    skill_name: null,
    message: "Run started",
    payload: {}
  }]);

  // Phase 2: appendRunEvents now reserves a sequence range against
  // `runs.next_event_sequence` and then casts `event_type::event_type` in
  // the SELECT clause. The reservation runs first, so statements[0] is
  // the UPDATE and statements[1] is the INSERT.
  assert.match(statements[0] ?? "", /update runs\s+set next_event_sequence/);
  assert.match(statements[1] ?? "", /batch\.event_type::event_type/);
});

// Regression: ensure jsonb_to_recordset is given a real jsonb array
// parameter (sql.json), not a text parameter cast via `${...}::jsonb`.
// A text parameter cast as jsonb in postgres produces a jsonb STRING
// of the JSON literal, not the parsed array, so jsonb_to_recordset
// fails with "cannot call jsonb_to_recordset on a non-array".
test("appendRunEvents forwards values as a jsonb parameter (sql.json), not a text cast", async () => {
  const calls: Array<{ query: string; params: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    const query = strings.reduce((acc, chunk, i) => acc + chunk + (i < params.length ? `$${i + 1}` : ""), "");
    calls.push({ query, params });
    if (query.includes("jsonb_to_recordset")) return [];
    return [{ base: 0 }];
  }) as unknown as Sql;
  // Mirror postgres.js: sql.json(v) returns a wrapper that has a
  // toJSON method so JSON.stringify encodes it and postgres sends it
  // as a jsonb parameter rather than a text parameter.
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v) => ({
    toJSON: () => v
  });

  await appendRunEvents(sql, "00000000-0000-0000-0000-000000000003", "00000000-0000-0000-0000-000000000004", [{
    event_type: "status",
    node_id: null,
    node_title: null,
    skill_id: null,
    skill_name: null,
    message: "checkpoint",
    payload: { ok: true }
  }]);

  const insertCall = calls.find((c) => c.query.includes("jsonb_to_recordset"));
  assert.ok(insertCall, "expected a jsonb_to_recordset call");
  const hasJsonParam = insertCall.params.some((p) => p && typeof p === "object" && "toJSON" in (p as Record<string, unknown>));
  assert.ok(hasJsonParam, "jsonb_to_recordset must be given a sql.json() value, not a JSON string cast");
});
