#!/usr/bin/env -S npx tsx
// SpielOS reset script
//
// Usage:
//   npx tsx scripts/reset.ts files     # wipe all files
//   npx tsx scripts/reset.ts prompts   # wipe prompt-shaped files
//   npx tsx scripts/reset.ts all       # wipe everything (files, runs, roles, skills, evals, templates)
//   npx tsx scripts/reset.ts nuke      # everything above + roles/skills/templates (orgs left alone)
//   npx tsx scripts/reset.ts seed      # run the seed endpoint after reset
//
// Reads:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SECRET_KEY  (falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY)

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}
const supabase = createClient(url, key);
const orgId = process.env.SPIELOS_ORG_ID ?? "00000000-0000-0000-0000-000000000001";

const PROMPT_FILE_TYPES = [
  "prompt",
  "harness_role",
  "harness_skill",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
];

const ALL_FILE_TYPES = [
  ...PROMPT_FILE_TYPES,
  "knowledge",
  "strategy",
  "artifact",
  "eval_report"
];

async function listFileIds(filter?: string[]) {
  let q = supabase.from("files").select("id").eq("org_id", orgId);
  if (filter) q = q.in("file_type", filter);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((r) => r.id as string);
}

async function wipeFiles(filter?: string[]) {
  const ids = await listFileIds(filter);
  if (ids.length === 0) {
    console.log("No files to wipe.");
    return;
  }
  console.log(`Wiping ${ids.length} files…`);
  await supabase.from("file_chunks").delete().in("file_id", ids);
  await supabase.from("file_versions").delete().in("file_id", ids);
  await supabase
    .from("file_lineage")
    .delete()
    .or(`child_file_id.in.(${ids.join(",")}),parent_file_id.in.(${ids.join(",")})`);
  await supabase.from("generated_files").delete().in("file_id", ids);
  await supabase.from("run_input_files").delete().in("file_id", ids);
  await supabase.from("chat_context_files").delete().in("file_id", ids);
  await supabase.from("files").delete().in("id", ids);
}

async function resetAll() {
  await wipeFiles(ALL_FILE_TYPES);
  await supabase.from("run_events").delete().eq("org_id", orgId);
  await supabase.from("runs").delete().eq("org_id", orgId);
  await supabase.from("eval_reports").delete().eq("org_id", orgId);
  await supabase.from("role_skills").delete().eq("org_id", orgId);
  await supabase.from("role_tools").delete().eq("org_id", orgId);
  await supabase.from("tools").delete().eq("org_id", orgId);
  await supabase.from("graph_template_versions").delete().eq("org_id", orgId);
  await supabase.from("graph_templates").delete().eq("org_id", orgId);
  await supabase.from("chats").delete().eq("org_id", orgId);
  await supabase.from("chat_messages").delete().eq("org_id", orgId);
  await supabase.from("models").delete().eq("org_id", orgId);
  await supabase.from("model_providers").delete().eq("org_id", orgId);
  await supabase.from("folders").delete().eq("org_id", orgId);
  await supabase.from("roles").delete().eq("org_id", orgId);
  console.log("Reset complete.");
}

async function nuke() {
  await resetAll();
  console.log("Org preserved. All data wiped.");
}

async function seed() {
  const base = process.env.SPIELOS_API_URL ?? "http://localhost:3000";
  const res = await fetch(`${base}/api/harness/seed`, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  console.log("Seed:", data);
}

const cmd = process.argv[2];
if (cmd === "files") await wipeFiles(ALL_FILE_TYPES);
else if (cmd === "prompts") await wipeFiles(PROMPT_FILE_TYPES);
else if (cmd === "all") await resetAll();
else if (cmd === "nuke") await nuke();
else if (cmd === "seed") await seed();
else {
  console.error("Usage: npx tsx scripts/reset.ts [files|prompts|all|nuke|seed]");
  process.exit(1);
}
