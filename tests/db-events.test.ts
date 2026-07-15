import assert from "node:assert/strict";
import test from "node:test";
import { appendRunEvents, type Sql } from "@spielos/db";

test("batched run events cast text records to the database event enum", async () => {
  const statements: string[] = [];
  const sql = (async (strings: TemplateStringsArray) => {
    const statement = strings.join("?");
    statements.push(statement);
    return statement.includes("max(sequence)") ? [{ next: 1 }] : [];
  }) as unknown as Sql;

  await appendRunEvents(sql, "00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002", [{
    event_type: "run_started",
    node_id: null,
    node_title: null,
    skill_id: null,
    skill_name: null,
    message: "Run started",
    payload: {}
  }]);

  assert.match(statements[1] ?? "", /record\.event_type::event_type/);
});
