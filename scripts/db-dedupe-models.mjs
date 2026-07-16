// One-off cleanup. Removes the duplicate system-default models
// that the previous `openai-compatible`-shaped ensureEnvironmentModels
// call left behind. We migrated the default back to provider="mistral"
// so future upserts hit the (org_id, provider, model) UNIQUE on the
// user's existing custom rows; the leftover openai-compatible rows
// would otherwise show up as duplicates in the settings UI.

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (!DATABASE_URL) { console.error("ERROR: DATABASE_URL is required."); process.exit(1); }

const sql = postgres(DATABASE_URL, { max: 1, prepare: false, ssl: { rejectUnauthorized: false } });

try {
  // Delete the openai-compatible Mistral rows the previous defaults
  // wrote. These have config.source = "environment".
  const deleted = await sql`
    delete from models
    where provider = 'openai-compatible'
      and model in ('mistral-small-latest', 'mistral-medium-3-5')
      and config ->> 'source' = 'environment'
    returning id, name, model
  `;
  console.log(`Deleted ${deleted.length} duplicate system-default Mistral row(s):`);
  for (const d of deleted) console.log(`  ${d.id} ${d.name} (${d.model})`);

  // Also clean up the test row from earlier debugging.
  const testDeleted = await sql`
    delete from models where provider = 'test' and model = 'test' returning id
  `;
  console.log(`Deleted ${testDeleted.length} test row(s).`);

  // Verify what's left.
  const remaining = await sql`
    select id, name, provider, model, base_url, secret_env_key, enabled
    from models
    where model like 'mistral%' or model = 'gemini%'
    order by name asc
  `;
  console.log("\nRemaining Mistral + Gemini rows:");
  for (const r of remaining) console.log(" ", r);

  console.log("✓ Done.");
} finally {
  await sql.end({ timeout: 5 });
}
