// One-off re-seed for the user's org. Reads supabase/seed/ and inserts
// files/folders directly via postgres-js with the corrected jsonb typing
// (no double-serialization). Mirrors apps/web/app/api/harness/seed/route.ts
// but skips auth and uses the live DATABASE_URL.

import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const ORG_ID = process.env.SEED_ORG_ID ?? "2f611988-3cfa-4040-bbfb-573d0a904613";
const SEED_ROOT = path.resolve("supabase/seed");
const MANIFEST_PATH = path.join(SEED_ROOT, "harness-manifest.json");

const FOLDER_BY_SEED_DIR = {
  agents: "Roles",
  skills: "Skills",
  workflows: "Workflows",
  evals: "Evals",
  templates: "Templates"
};
const FOLDER_ORDER = {
  Roles: 10,
  Skills: 20,
  Evals: 30,
  Workflows: 40,
  Templates: 50,
  Strategy: 60,
  Prompts: 70,
  Library: 80,
  Outputs: 90
};

type ManifestEntry = {
  fileType?: string;
  slug?: string;
  kind?: string;
  systemRole?: string;
  skillSlugs?: string[];
  contextSlugs?: string[];
  auth?: "none" | "api_key" | "oauth";
  sideEffect?: "none" | "read" | "write" | "external";
  folder?: string;
  workspaceConfig?: boolean;
  harnessAction?: "create" | "update";
  inputSchema?: Record<string, unknown>;
};
type Manifest = Record<string, ManifestEntry>;

function titleFromFile(fileName: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return fileName
    .replace(/\.[^.]+$/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function descriptionFromMarkdown(body: string): string {
  const lines = body.split(/\r?\n/);
  const parts: string[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("```") || line.startsWith("---")) {
      if (parts.length > 0) break;
      continue;
    }
    if (/^[-*+]\s/.test(line) || /^\d+[.)]\s/.test(line)) {
      if (parts.length > 0) break;
      continue;
    }
    parts.push(line);
    if (parts.join(" ").length >= 220) break;
  }
  return parts.join(" ").slice(0, 280);
}

function folderNameFor(relPath: string, fileType: string, manifest: Manifest): string {
  const relPosix = relPath.replaceAll(path.sep, "/");
  const entry = manifest[relPosix];
  if (entry?.folder) return entry.folder;
  const folderKey = relPath.split(path.sep)[0] ?? "";
  return (
    FOLDER_BY_SEED_DIR[folderKey] ??
    (fileType === "prompt" ? "Prompts" : fileType === "strategy" ? "Strategy" : "Library")
  );
}

function classify(relPath: string, manifest: Manifest): { fileType: string; metadata: Record<string, unknown> } {
  const folder = relPath.split(path.sep)[0] ?? "";
  const base = (relPath.split(path.sep).pop() ?? "").replace(/\.[^.]+$/, "");
  const relPosix = relPath.replaceAll(path.sep, "/");
  const entry = manifest[relPosix];

  let fileType: string;
  if (entry?.fileType) fileType = entry.fileType;
  else if (entry?.kind === "eval") fileType = "harness_eval";
  else if (folder === "agents") fileType = "harness_role";
  else if (folder === "skills") fileType = "harness_skill";
  else if (folder === "workflows") fileType = "harness_workflow";
  else if (folder === "templates") fileType = "harness_template";
  else if (folder === "system") fileType = "prompt";
  else if (folder === "evals") fileType = "harness_eval";
  else fileType = "knowledge";

  const slug = entry?.slug ?? base;
  const metadata: Record<string, unknown> = { slug };
  if (fileType === "harness_role") metadata.role = true;
  if (fileType === "harness_skill") metadata.skill = true;
  if (fileType === "harness_workflow") metadata.workstream = true;
  if (fileType === "harness_template") metadata.template = true;
  if (fileType === "harness_eval") metadata.eval = true;
  if (fileType === "prompt") metadata.prompt = true;
  if (fileType === "strategy") metadata.strategy = true;
  if (fileType === "knowledge") metadata.knowledge = true;
  if (entry?.kind) metadata.kind = entry.kind;
  if (entry?.systemRole) metadata.systemRole = entry.systemRole;
  if (entry?.auth) metadata.auth = entry.auth;
  if (entry?.sideEffect) metadata.sideEffect = entry.sideEffect;
  if (entry?.contextSlugs) metadata.contextSlugs = entry.contextSlugs;
  if (entry?.workspaceConfig) metadata.workspaceConfig = true;
  if (entry?.harnessAction) metadata.harnessAction = entry.harnessAction;
  if (entry?.inputSchema) metadata.inputSchema = entry.inputSchema;
  if (entry?.skillSlugs) metadata.skillSlugs = entry.skillSlugs;
  return { fileType, metadata };
}

type SeedFile = {
  path: string;
  title: string;
  body: string;
  fileType: string;
  folderName: string;
  metadata: Record<string, unknown>;
};

async function walk(dir: string, base: string, out: SeedFile[], manifest: Manifest): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (!base && (entry.name === "integrations" || entry.name === "harness-manifest.json")) continue;
      await walk(full, rel, out, manifest);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (/^(harness-manifest\.json|billing-providers\.json)$/.test(rel.replaceAll(path.sep, "/"))) continue;
    if (!/\.(md|markdown|json|yaml|yml)$/i.test(entry.name)) continue;
    const body = await readFile(full, "utf8");
    const { fileType, metadata: baseMeta } = classify(rel, manifest);
    const folderName = folderNameFor(rel, fileType, manifest);
    let title = titleFromFile(entry.name, body);
    let finalFileType = fileType;
    let finalMetadata: Record<string, unknown> = {
      ...baseMeta,
      description: descriptionFromMarkdown(body) || undefined,
      seed: true,
      seedPath: rel,
      seedFolder: folderName
    };
    let finalBody = body;
    if (fileType === "harness_eval" && entry.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        title = parsed.name ?? entry.name.replace(/\.[^.]+$/, "");
        finalMetadata = { ...finalMetadata, description: parsed.description, rules: parsed.rules ?? parsed.rubrics, overallThreshold: parsed.overallThreshold, loopConfig: parsed.loopConfig };
      } catch {}
    } else if (fileType === "harness_workflow" && entry.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        title = parsed.title ?? parsed.name ?? entry.name.replace(/\.[^.]+$/, "");
        finalMetadata = { ...finalMetadata, nodes: parsed.nodes ?? [], edges: parsed.edges ?? [] };
        finalBody = parsed.description ?? "";
      } catch {}
    }
    out.push({ path: rel, title, body: finalBody, fileType: finalFileType, folderName, metadata: finalMetadata });
  }
}

async function main() {
  const sql = postgres(DATABASE_URL, {
    max: 1,
    prepare: false,
    ssl: { rejectUnauthorized: false },
    keep_alive: 30,
    connect_timeout: 10
  });
  let manifest: Manifest = {};
  try {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as Manifest;
  } catch {}

  // 1. Ensure folders
  const allFolders = new Set<string>(Object.values(FOLDER_BY_SEED_DIR));
  for (const entry of Object.values(manifest)) if (entry?.folder) allFolders.add(entry.folder);
  const folderMap = new Map<string, string>();
  for (const name of allFolders) {
    const existing = await sql`select id from folders where org_id = ${ORG_ID} and name = ${name} and deleted_at is null limit 1`;
    if (existing[0]) {
      folderMap.set(name, existing[0].id);
    } else {
      const inserted = await sql`insert into folders (org_id, name, sort_order) values (${ORG_ID}, ${name}, ${FOLDER_ORDER[name] ?? 100}) returning id`;
      folderMap.set(name, inserted[0].id);
      console.log(`+ folder ${name}`);
    }
  }

  // 2. Walk seed
  const seed: SeedFile[] = [];
  await walk(SEED_ROOT, "", seed, manifest);
  console.log(`Discovered ${seed.length} seed files`);

  // 3. Pre-load existing files by seedPath
  const existing = await sql<{ id: string; metadata: Record<string, unknown> }[]>`
    select id, metadata from files
    where org_id = ${ORG_ID} and deleted_at is null and metadata->>'seedPath' is not null
  `;
  const bySeedPath = new Map<string, { id: string }>();
  for (const row of existing) {
    const sp = row.metadata?.seedPath;
    if (typeof sp === "string") bySeedPath.set(sp, { id: row.id });
  }

  let inserted = 0;
  let skipped = 0;
  for (const file of seed) {
    if (bySeedPath.has(file.path)) {
      skipped += 1;
      continue;
    }
    const folderId = folderMap.get(file.folderName) ?? null;
    await sql`
      insert into files (org_id, folder_id, file_type, status, title, body, content_format, metadata)
      values (
        ${ORG_ID},
        ${folderId},
        ${file.fileType},
        'active',
        ${file.title},
        ${file.body},
        'markdown',
        ${sql.json(file.metadata)}
      )
    `;
    inserted += 1;
  }
  console.log(`Inserted ${inserted} files, skipped ${skipped} existing`);

  // 4. Seed connections from integration catalog
  const catalogPath = path.join(SEED_ROOT, "integrations", "catalog.json");
  let catalogCount = 0;
  try {
    const catalogRaw = await readFile(catalogPath, "utf8");
    const catalog = JSON.parse(catalogRaw) as Array<{
      id: string; name: string; description: string; kind: string;
      icon: string; logo?: string; baseUrl?: string; secretEnvKey?: string;
      operations: Array<Record<string, unknown>>;
    }>;
    for (const entry of catalog) {
      const status = entry.kind === "builtin" ? "configured"
        : entry.kind === "oauth" ? "configured"
        : entry.kind === "mcp" ? "needs_secret"
        : entry.secretEnvKey ? "needs_secret" : "configured";
      await sql`
        insert into connections (org_id, name, kind, status, base_url, secret_env_key, config, operations, enabled)
        values (
          ${ORG_ID}, ${entry.name}, ${entry.kind}, ${status},
          ${entry.baseUrl ?? null}, ${entry.secretEnvKey ?? null},
          ${sql.json({ icon: entry.icon, logo: entry.logo, description: entry.description })},
          ${sql.json(entry.operations)}, true
        )
        on conflict (org_id, name) do update set
          kind = excluded.kind, status = excluded.status,
          base_url = excluded.base_url, secret_env_key = excluded.secret_env_key,
          config = excluded.config, operations = excluded.operations, enabled = excluded.enabled,
          deleted_at = null
      `;
      catalogCount += 1;
    }
    console.log(`Seeded ${catalogCount} connections`);
  } catch (e) {
    console.log(`Skipped connection seeding: ${e instanceof Error ? e.message : e}`);
  }

  // 5. Seed billing providers
  const billingPath = path.join(SEED_ROOT, "billing-providers.json");
  let billingCount = 0;
  try {
    const billingRaw = await readFile(billingPath, "utf8");
    const providers = JSON.parse(billingRaw) as Array<{
      id: string; name: string; enabled: boolean; config: Record<string, unknown>;
    }>;
    for (const bp of providers) {
      await sql`
        insert into billing_providers (id, name, enabled, config)
        values (${bp.id}, ${bp.name}, ${bp.enabled}, ${sql.json(bp.config)})
        on conflict (id) do update set
          name = excluded.name, enabled = excluded.enabled, config = excluded.config
      `;
      billingCount += 1;
    }
    console.log(`Seeded ${billingCount} billing providers`);
  } catch (e) {
    console.log(`Skipped billing provider seeding: ${e instanceof Error ? e.message : e}`);
  }

  // 6. Verify
  const verify = await sql`select file_type, count(*) as n from files where org_id = ${ORG_ID} group by file_type order by file_type`;
  for (const r of verify) console.log(`  ${r.file_type}: ${r.n}`);
  const sample = await sql`select metadata, jsonb_typeof(metadata) as t from files where org_id = ${ORG_ID} and title = 'Editor' limit 1`;
  console.log(`Sample metadata typeof: ${sample[0].t}`);

  await sql.end();
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
