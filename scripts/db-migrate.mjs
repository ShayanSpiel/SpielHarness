// One-off migration runner. Applies every packages/db/migrations/[0-9]*.sql
// file in order. Skips 0001 because the hosted DB already has the schema;
// 0001 uses `create table` without `if not exists` and would fail.
// Every other migration uses `if not exists` / `add column if not exists`.

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = resolve("packages/db/migrations");
const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

try {
  const entries = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    .sort();
  for (const file of entries) {
    if (file === "0001_init.sql" || file === "0001_init_merge.sql") {
      console.log(`  → ${file} (skipping; schema already present)`);
      continue;
    }
    process.stdout.write(`  → ${file}\n`);
    const body = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await sql.unsafe(body);
    } catch (e) {
      console.error(`  ✗ ${file} failed: ${e.message}`);
      process.exit(1);
    }
  }
  process.stdout.write("✓ Migrations applied.\n");
} finally {
  await sql.end({ timeout: 5 });
}
