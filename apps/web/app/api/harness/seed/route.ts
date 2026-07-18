import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  createFile,
  createFolder,
  deleteEmptyPlaceholderFiles,
  deleteLegacySeedDuplicates,
  deleteEmptyFolders,
  findFolderByName,
  listHarnessFiles,
  organizeUnfolderedGeneratedFiles,
  updateFile,
  upsertBillingProvider,
  upsertConnection,
  audit
} from "@spielos/db";
import { errorResponse, getOrg, requireAdmin } from "../../../../lib/server";
import { SEED_ROOT } from "../../../../lib/repo-paths";

const MANIFEST_PATH = path.join(SEED_ROOT, "harness-manifest.json");

type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  kind: "builtin" | "oauth" | "mcp" | "api";
  icon: string;
  logo?: string;
  baseUrl?: string;
  secretEnvKey?: string;
  operations: Array<{
    id: string;
    label: string;
    effect: "read" | "write" | "send";
    method?: string;
    inputParam?: string;
  }>;
};

type BillingProviderEntry = {
  id: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
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
  runtimePolicy?: boolean;
  harnessAction?: "create" | "update";
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

type Manifest = Record<string, ManifestEntry>;

type SeedFile = {
  path: string;
  title: string;
  body: string;
  fileType: string;
  status: "active" | "draft" | "archived";
  folderName: string;
  metadata: Record<string, unknown>;
};

const FOLDER_BY_SEED_DIR: Record<string, string> = {
  agents: "Roles",
  skills: "Skills",
  workflows: "Workflows",
  evals: "Evals",
  templates: "Templates"
};

const FOLDER_ORDER: Record<string, number> = {
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

function folderNameFor(
  relPath: string,
  fileType: string,
  manifest: Manifest
): string {
  const relPosix = relPath.replaceAll(path.sep, "/");
  const entry = manifest[relPosix];
  if (entry?.folder) return entry.folder;

  const folderKey = relPath.split(path.sep)[0] ?? "";
  return FOLDER_BY_SEED_DIR[folderKey] ?? (fileType === "prompt" ? "Prompts" : fileType === "strategy" ? "Strategy" : "Library");
}

function titleFromFile(fileName: string, body: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return fileName
    .replace(/\.[^.]+$/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
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

function classify(
  relPath: string,
  manifest: Manifest
): { fileType: string; metadata: Record<string, unknown> } {
  const folder = relPath.split(path.sep)[0] ?? "";
  const base = (relPath.split(path.sep).pop() ?? "").replace(/\.[^.]+$/, "");

  const relPosix = relPath.replaceAll(path.sep, "/");
  const entry = manifest[relPosix];

  let fileType: string;
  if (entry?.fileType) {
    fileType = entry.fileType;
  } else if (entry?.kind === "eval") {
    fileType = "harness_eval";
  } else if (folder === "agents") {
    fileType = "harness_role";
  } else if (folder === "skills") {
    fileType = "harness_skill";
  } else if (folder === "workflows") {
    fileType = "harness_workflow";
  } else if (folder === "templates") {
    fileType = "harness_template";
  } else if (folder === "system") {
    fileType = "prompt";
  } else if (folder === "evals") {
    fileType = "harness_eval";
  } else {
    fileType = "knowledge";
  }

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
  if (entry?.runtimePolicy) metadata.runtimePolicy = true;
  if (entry?.harnessAction) metadata.harnessAction = entry.harnessAction;
  if (entry?.inputSchema) metadata.inputSchema = entry.inputSchema;
  if (entry?.outputSchema) metadata.outputSchema = entry.outputSchema;

  return { fileType, metadata };
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = withoutUndefined(v);
    }
    return out;
  }
  return value;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return {};
  }
}

async function ensureFolders(
  sql: import("@spielos/db").Sql,
  orgId: string,
  manifest: Manifest
): Promise<Map<string, string>> {
  const allFolders = new Set<string>();
  for (const n of Object.values(FOLDER_BY_SEED_DIR)) allFolders.add(n);
  for (const entry of Object.values(manifest)) {
    if (entry?.folder) allFolders.add(entry.folder);
  }

  const folderMap = new Map<string, string>();
  for (const name of allFolders) {
    let folder = await findFolderByName(sql, orgId, name);
    if (!folder) {
      folder = await createFolder(sql, orgId, name, FOLDER_ORDER[name] ?? 100);
    }
    folderMap.set(name, folder.id);
  }
  return folderMap;
}

async function walk(
  dir: string,
  base: string,
  out: SeedFile[],
  manifest: Manifest
): Promise<void> {
  let entries: import("node:fs").Dirent[];
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
    const { fileType: classifiedFileType, metadata: classifiedMetadata } = classify(rel, manifest);
    const fileName = entry.name;
    const folderName = folderNameFor(rel, classifiedFileType, manifest);

    const metadata = withoutUndefined({
      ...classifiedMetadata,
      description: descriptionFromMarkdown(body) || undefined,
      seed: true,
      seedPath: rel,
      seedFolder: folderName
    }) as Record<string, unknown>;

    let title = titleFromFile(fileName, body);
    const finalFileType = classifiedFileType;
    let finalMetadata = metadata;

    if (classifiedFileType === "harness_eval" && fileName.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        title = parsed.name ?? fileName.replace(/\.[^.]+$/, "");
        finalMetadata = withoutUndefined({
          ...metadata,
          description: parsed.description,
          rules: parsed.rules ?? parsed.rubrics,
          overallThreshold: parsed.overallThreshold,
          loopConfig: parsed.loopConfig
        }) as Record<string, unknown>;
      } catch {
        // fall through
      }
    } else if (classifiedFileType === "harness_workflow" && fileName.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        title = parsed.title ?? parsed.name ?? fileName.replace(/\.[^.]+$/, "");
        finalMetadata = withoutUndefined({
          ...metadata,
          nodes: parsed.nodes ?? [],
          edges: parsed.edges ?? []
        }) as Record<string, unknown>;
        out.push({
          path: rel,
          title,
          body: parsed.description ?? "",
          fileType: classifiedFileType,
          status: "active",
          folderName,
          metadata: finalMetadata
        });
        continue;
      } catch {
        // fall through
      }
    }

    out.push({
      path: rel,
      title,
      body,
      fileType: finalFileType,
      status: "active",
      folderName,
      metadata: finalMetadata
    });
  }
}

async function loadSeed(manifest: Manifest): Promise<SeedFile[]> {
  const out: SeedFile[] = [];
  await walk(SEED_ROOT, "", out, manifest);
  return out;
}

function applyManifestToRole(
  file: SeedFile,
  manifest: Manifest
): SeedFile {
  const relPosix = file.path.replaceAll(path.sep, "/");
  const entry = manifest[relPosix];
  if (file.fileType === "harness_role" && entry?.skillSlugs) {
    return {
      ...file,
      metadata: {
        ...file.metadata,
        skillSlugs: entry.skillSlugs,
        contextSlugs: entry.contextSlugs ?? []
      }
    };
  }
  return file;
}

const CATALOG_PATH = path.join(SEED_ROOT, "integrations", "catalog.json");
const BILLING_PROVIDERS_PATH = path.join(SEED_ROOT, "billing-providers.json");

async function seedConnections(sql: import("@spielos/db").Sql, orgId: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(CATALOG_PATH, "utf8");
  } catch {
    return 0;
  }
  const catalog: CatalogEntry[] = JSON.parse(raw);
  let count = 0;
  for (const entry of catalog) {
    const status = entry.kind === "builtin" ? "configured"
      : entry.kind === "oauth" ? "configured"
      : entry.kind === "mcp" ? "needs_secret"
      : entry.secretEnvKey ? "needs_secret"
      : "configured";
    await upsertConnection(sql, orgId, {
      name: entry.name,
      kind: entry.kind,
      status,
      baseUrl: entry.baseUrl ?? null,
      secretEnvKey: entry.secretEnvKey ?? null,
      config: { icon: entry.icon, logo: entry.logo, description: entry.description },
      operations: entry.operations,
      enabled: true
    });
    count += 1;
  }
  return count;
}

async function seedBillingProviders(sql: import("@spielos/db").Sql): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(BILLING_PROVIDERS_PATH, "utf8");
  } catch {
    return 0;
  }
  const providers: BillingProviderEntry[] = JSON.parse(raw);
  let count = 0;
  for (const bp of providers) {
    await upsertBillingProvider(sql, {
      id: bp.id,
      name: bp.name,
      enabled: bp.enabled,
      config: bp.config
    });
    count += 1;
  }
  return count;
}

export async function GET() {
  try {
    const org = await getOrg();
    const files = await listHarnessFiles(org.sql, org.orgId);
    return Response.json({ status: "ok", fileCount: files.length });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const org = await getOrg();
    requireAdmin(org);

    const manifest = await loadManifest();
    const seed = await loadSeed(manifest);
    const folderMap = await ensureFolders(org.sql, org.orgId, manifest);

    const existing = await listHarnessFiles(org.sql, org.orgId);
    const bySeedPath = new Map<string, (typeof existing)[number]>();
    for (const row of existing) {
      const seedPath = row.metadata?.seedPath;
      if (typeof seedPath === "string") bySeedPath.set(seedPath, row);
    }

    let seeded = 0;
    let updated = 0;
    const preparedSeed = seed.map((file) => applyManifestToRole(file, manifest));
    const batchSize = 8;
    for (let index = 0; index < preparedSeed.length; index += batchSize) {
      await Promise.all(preparedSeed.slice(index, index + batchSize).map(async (file) => {
        const folderId = folderMap.get(file.folderName) ?? null;
        const current = bySeedPath.get(file.path);
        if (current) {
          const changed =
            current.title !== file.title ||
            current.body !== file.body ||
            current.file_type !== file.fileType ||
            current.status !== file.status ||
            current.folder_id !== folderId ||
            stableJson(current.metadata ?? {}) !== stableJson(file.metadata);
          if (changed) {
            await updateFile(org.sql, org.orgId, current.id, {
              title: file.title,
              body: file.body,
              fileType: file.fileType,
              status: file.status,
              folderId,
              metadata: file.metadata
            });
            await audit(org.sql, org.orgId, {
              action: "seed-update",
              entityType: "file",
              entityId: current.id
            });
            updated += 1;
          }
          return;
        }
        await createFile(org.sql, org.orgId, {
          title: file.title,
          body: file.body,
          fileType: file.fileType,
          status: file.status,
          folderId,
          metadata: file.metadata
        });
        seeded += 1;
      }));
    }

    const seededConnections = await seedConnections(org.sql, org.orgId);
    const seededBillingProviders = await seedBillingProviders(org.sql);

    const removedPlaceholders = await deleteEmptyPlaceholderFiles(org.sql, org.orgId);
    const removedLegacyDuplicates = await deleteLegacySeedDuplicates(org.sql, org.orgId);
    const organizedGeneratedFiles = await organizeUnfolderedGeneratedFiles(org.sql, org.orgId);
    const removedEmptyFolders = await deleteEmptyFolders(org.sql, org.orgId);

    return Response.json({
      message: `Seed sync complete. Inserted ${seeded}, updated ${updated}, seeded ${seededConnections} connections and ${seededBillingProviders} billing providers, organized ${organizedGeneratedFiles} outputs, removed ${removedPlaceholders} empty placeholders, ${removedLegacyDuplicates} legacy duplicates, and ${removedEmptyFolders} empty folders.`,
      discovered: seed.length,
      seeded,
      updated,
      seededConnections,
      seededBillingProviders,
      organizedGeneratedFiles,
      removedPlaceholders,
      removedLegacyDuplicates,
      removedEmptyFolders
    });
  } catch (err) {
    return errorResponse(err);
  }
}
