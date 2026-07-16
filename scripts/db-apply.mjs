// One-off runner. Applies only the migrations still needed to bring a
// drifted database up to the current schema. Idempotent everywhere.

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: node scripts/db-apply.mjs <migration-file> [more...]");
  process.exit(1);
}

try {
  for (const f of files) {
    process.stdout.write(`  → ${f}\n`);
    const body = await readFile(resolve("packages/db/migrations", f), "utf8");
    await sql.unsafe(body);
  }
  process.stdout.write("✓ Done.\n");
} finally {
  await sql.end({ timeout: 5 });
}
