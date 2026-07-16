import assert from "node:assert/strict";
import test from "node:test";
import {
  CheckpointVersionMismatch,
  atomicCheckpoint,
  type RunEventInput,
  type Sql
} from "@spielos/db";

/**
 * Build a mock Sql that resolves each tagged-template call based on the
 * SQL text. Used to exercise the atomicCheckpoint transaction in tests
 * without a real Postgres instance.
 *
 * Sub-template fragments (e.g. `sql\`DEFAULT\`` or `sql\`state\`` used to
 * reference an existing column) are filtered out — they never reach the
 * wire in real Postgres, only the outer query does. Tracking them in
 * `calls` would conflate fragments with statements.
 */
function buildMockSql(handlers: Array<{ match: RegExp; rows: unknown[] }>): { sql: Sql; calls: string[] } {
  const calls: string[] = [];
  const respond = (strings: TemplateStringsArray, params: unknown[]) => {
    // Sub-templates have exactly one string and no real params.
    const isFragment = strings.length === 1 && params.length === 0;
    if (isFragment) return [];
    const text = strings.join("?");
    calls.push(text);
    for (const handler of handlers) {
      if (handler.match.test(text)) return handler.rows;
    }
    return [];
  };
  const sql = ((strings: TemplateStringsArray, ...params: unknown[]) => {
    return Promise.resolve(respond(strings, params));
  }) as unknown as Sql;
  (sql as unknown as { begin: (cb: (tx: Sql) => Promise<unknown>) => Promise<unknown> }).begin = async (cb) => {
    return cb(sql);
  };
  // The atomic checkpoint uses `${tx.json(values)}` to send the event
  // batch as a real jsonb parameter. The mock doesn't need to do
  // anything with the value, but it must expose `.json` so the call
  // type-checks and runs without throwing.
  (sql as unknown as { json: (v: unknown) => unknown }).json = (v) => v;
  return { sql, calls };
}

test("atomicCheckpoint performs lock, reserve, insert, and update as a single transaction", async () => {
  const { sql, calls } = buildMockSql([
    { match: /for update/, rows: [{ next_event_sequence: 0, checkpoint_version: 0 }] },
    { match: /next_event_sequence\s*=\s*next_event_sequence\s*\+/, rows: [{ base: 0, next: 1 }] },
    { match: /insert into run_events/, rows: [{
      id: "event-1",
      org_id: "org-x",
      run_id: "run-x",
      event_type: "node_started",
      sequence: 1,
      node_id: "n1",
      node_title: "First",
      skill_id: null,
      skill_name: null,
      message: "Node started",
      payload: {},
      created_at: new Date().toISOString()
    }] },
    { match: /checkpoint_version\s*=\s*\$\{/, rows: [] }
  ]);

  const result = await atomicCheckpoint(sql, "org-x", "run-x", {
    events: [{
      event_type: "node_started",
      node_id: "n1",
      node_title: "First",
      skill_id: null,
      skill_name: null,
      message: "Node started",
      payload: {}
    } satisfies RunEventInput],
    state: { status: "running" },
    expectedCheckpointVersion: 0
  });

  assert.equal(result.checkpointVersion, 1, "checkpoint_version advances by 1");
  assert.equal(result.insertedEvents.length, 1, "the batch is inserted");
  assert.equal(calls.length, 4, "lock + reserve + insert + update fire in order");
  assert.match(calls[0], /for update/);
  assert.match(calls[1], /next_event_sequence/);
  assert.match(calls[2], /insert into run_events/);
  assert.match(calls[3], /checkpoint_version/);
});

test("CheckpointVersionMismatch carries expected and actual versions", () => {
  const err = new CheckpointVersionMismatch(3, 7);
  assert.equal(err.expected, 3);
  assert.equal(err.actual, 7);
  assert.match(err.message, /expected 3, found 7/);
});

test("atomicCheckpoint throws CheckpointVersionMismatch when expected version is stale", async () => {
  const { sql } = buildMockSql([
    { match: /for update/, rows: [{ next_event_sequence: 0, checkpoint_version: 7 }] }
  ]);

  await assert.rejects(
    () => atomicCheckpoint(sql, "org-x", "run-x", {
      state: { status: "running" },
      expectedCheckpointVersion: 5
    }),
    CheckpointVersionMismatch
  );
});

test("atomicCheckpoint no-ops (except version increment) when there are no events and no state", async () => {
  const { sql, calls } = buildMockSql([
    { match: /for update/, rows: [{ next_event_sequence: 0, checkpoint_version: 0 }] },
    { match: /checkpoint_version\s*=\s*\$\{/, rows: [] }
  ]);

  const result = await atomicCheckpoint(sql, "org-x", "run-x", {});
  assert.equal(result.checkpointVersion, 1);
  assert.equal(result.insertedEvents.length, 0);
  assert.equal(calls.length, 2, "lock + version bump, no reserve or insert");
});
