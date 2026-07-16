// One-off state check. Used to find which migrations are missing on
// the hosted database. Safe to re-run.

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

async function tableExists(name) {
  const rows = await sql`
    select count(*)::int as c
    from information_schema.tables
    where table_schema='public' and table_name=${name}
  `;
  return rows[0].c > 0;
}

async function columnExists(table, column) {
  const rows = await sql`
    select count(*)::int as c
    from information_schema.columns
    where table_schema='public' and table_name=${table} and column_name=${column}
  `;
  return rows[0].c > 0;
}

async function indexExists(name) {
  const rows = await sql`
    select count(*)::int as c
    from pg_indexes where schemaname='public' and indexname=${name}
  `;
  return rows[0].c > 0;
}

const tables = [
  "orgs","profiles","files","folders","runs","run_events","run_metrics",
  "chats","chat_messages","models","connections","invitations",
  "org_credits","credit_transactions","usage_ledger","audit_log",
  "run_input_files","run_output_files","file_relations","org_memberships",
  "file_versions","workspace_variables"
];
const columns = {
  runs: ["next_event_sequence","graph_version","checkpoint_version",
         "cancel_requested_at","pause_requested_at","resumed_at","idempotency_key"],
  run_events: ["sequence","event_key"],
  files: ["deleted_at","metadata","current_version"]
};
const indexes = [
  "run_events_run_event_key_idx","files_metadata_idx",
  "runs_cancel_requested_idx","runs_checkpoint_version_idx",
  "run_metrics_org_idx"
];

console.log("=== TABLES ===");
for (const t of tables) console.log(`  ${(await tableExists(t)) ? "OK  " : "MISS"} ${t}`);

console.log("\n=== COLUMNS ===");
for (const [t, cols] of Object.entries(columns)) {
  for (const c of cols) console.log(`  ${(await columnExists(t, c)) ? "OK  " : "MISS"} ${t}.${c}`);
}

console.log("\n=== INDEXES ===");
for (const i of indexes) console.log(`  ${(await indexExists(i)) ? "OK  " : "MISS"} ${i}`);

await sql.end({ timeout: 5 });
