import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { errorResponse, getOrg, requireOrgRole, requireSupabase } from "../../../../lib/server";

const SEED_ROOT = path.join(process.cwd(), "..", "..", "supabase", "seed");

type SeedFile = {
  path: string;
  title: string;
  body: string;
  fileType: string;
  status?: "active" | "draft" | "archived";
  folder: string;
  metadata: Record<string, unknown>;
};

type ExistingFile = {
  id: string;
  title: string;
  body: string;
  file_type: string;
  status: string;
  folder_id: string | null;
  metadata: Record<string, unknown>;
  content_format: string;
};

type FolderRow = {
  id: string;
  name: string;
};

const FOLDER_BY_SEED_DIR: Record<string, string> = {
  agents: "Roles",
  skills: "Skills",
  workflows: "Workflows",
  workstreams: "Workflows",
  evals: "Evals",
  templates: "Templates",
  system: "Prompts"
};

function titleFromFile(fileName: string, body: string) {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return fileName
    .replace(/\.[^.]+$/, "")
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (entry !== undefined) out[key] = withoutUndefined(entry);
    }
    return out;
  }
  return value;
}

function classify(relPath: string): { fileType: string; metadata: Record<string, unknown> } {
  const parts = relPath.split(path.sep);
  const folder = parts[0] ?? "";
  const fileName = parts[parts.length - 1] ?? "";
  const base = fileName.replace(/\.[^.]+$/, "");

  if (folder === "agents") {
    return {
      fileType: "harness_role",
      metadata: { role: true, slug: base }
    };
  }
  if (folder === "skills") {
    return {
      fileType: "harness_skill",
      metadata: { skill: true, slug: base, kind: "llm_call" }
    };
  }
  if (folder === "workflows" || folder === "workstreams") {
    return {
      fileType: "harness_workstream",
      metadata: { workstream: true, slug: base }
    };
  }
  if (folder === "templates") {
    return {
      fileType: "harness_template",
      metadata: { template: true, slug: base }
    };
  }
  if (folder === "system") {
    return {
      fileType: "strategy",
      metadata: { system: true, slug: base }
    };
  }
  if (folder === "evals") {
    return {
      fileType: "harness_eval",
      metadata: { eval: true, slug: base }
    };
  }
  return { fileType: "knowledge", metadata: {} };
}

async function walk(dir: string, base: string, out: SeedFile[], manifest: Record<string, Record<string, unknown>>): Promise<void> {
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
      if (!base && entry.name === "integrations") continue;
      await walk(full, rel, out, manifest);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (rel.replaceAll(path.sep, "/") === "harness-manifest.json") continue;
    if (!/\.(md|markdown|json|yaml|yml)$/i.test(entry.name)) continue;
    const fileName = entry.name;
    const body = await readFile(full, "utf8");
    const { fileType: classifiedFileType, metadata: classifiedMetadata } = classify(rel);
    const { fileType: configuredFileType, status: configuredStatus, ...manifestMetadata } = manifest[rel.replaceAll(path.sep, "/")] ?? {};
    const fileType = typeof configuredFileType === "string" ? configuredFileType : classifiedFileType;
    const status = ["active", "draft", "archived"].includes(String(configuredStatus))
      ? configuredStatus as SeedFile["status"]
      : "active";
    const folderName = FOLDER_BY_SEED_DIR[rel.split(path.sep)[0] ?? ""] ?? "Knowledge";
    const metadata = withoutUndefined({
      ...classifiedMetadata,
      ...manifestMetadata,
      seed: true,
      seedPath: rel,
      seedFolder: folderName
    }) as Record<string, unknown>;
    if (fileType === "harness_eval" && entry.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        const seedTitle = parsed.name ?? fileName.replace(/\.[^.]+$/, "");
        out.push({
          path: rel,
          title: seedTitle,
          body: body,
          fileType,
          status,
          folder: folderName,
          metadata: withoutUndefined({
            ...metadata,
            eval: true,
            targetType: parsed.targetType,
            overallThreshold: parsed.overallThreshold,
            rubrics: parsed.rubrics,
            loopConfig: parsed.loopConfig
          }) as Record<string, unknown>
        });
        continue;
      } catch {
        // fall through to text mode
      }
    }
    if (fileType === "harness_workstream" && entry.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        out.push({
          path: rel,
          title: parsed.title ?? parsed.name ?? fileName.replace(/\.[^.]+$/, ""),
          body: parsed.description ?? "",
          fileType,
          status,
          folder: folderName,
          metadata: withoutUndefined({
            ...metadata,
            workstream: true,
            nodes: parsed.nodes ?? [],
            edges: parsed.edges ?? []
          }) as Record<string, unknown>
        });
        continue;
      } catch {
        // fall through to text mode
      }
    }
    const title = titleFromFile(fileName, body);
    out.push({ path: rel, title, body, fileType, status, folder: folderName, metadata });
  }
}

async function loadSeed(): Promise<SeedFile[]> {
  const out: SeedFile[] = [];
  let manifest: Record<string, Record<string, unknown>> = {};
  try {
    manifest = JSON.parse(await readFile(path.join(SEED_ROOT, "harness-manifest.json"), "utf8"));
  } catch {
    // The manifest is optional for user-created seed directories.
  }
  await walk(SEED_ROOT, "", out, manifest);
  return out;
}

export async function GET() {
  try {
    const org = await getOrg();
    const supabase = requireSupabase(org);
    const { count, error } = await supabase
      .from("files")
      .select("*", { count: "exact", head: true })
      .eq("org_id", org.orgId);
    if (error) throw error;
    return Response.json({ status: "ok", fileCount: count ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST() {
  try {
    const org = await getOrg();
    requireOrgRole(org, ["owner", "admin"]);
    const supabase = requireSupabase(org);
    const seed = await loadSeed();
    const folderNames = Array.from(new Set(seed.map((file) => file.folder)));
    const { data: existingFolders, error: folderReadError } = await supabase
      .from("folders")
      .select("id,name")
      .eq("org_id", org.orgId)
      .is("parent_id", null)
      .is("deleted_at", null);
    if (folderReadError) throw folderReadError;

    const folderByName = new Map((existingFolders ?? [] as FolderRow[]).map((folder) => [folder.name, folder.id]));
    for (const name of folderNames) {
      if (folderByName.has(name)) continue;
      const { data, error } = await supabase
        .from("folders")
        .insert({ org_id: org.orgId, name, sort_order: 100 })
        .select("id,name")
        .single();
      if (error) throw error;
      folderByName.set(data.name, data.id);
    }

    const { data: existingRows, error: fileReadError } = await supabase
      .from("files")
      .select("id,title,body,file_type,status,folder_id,metadata,content_format")
      .eq("org_id", org.orgId);
    if (fileReadError) throw fileReadError;

    const existing = (existingRows ?? []) as ExistingFile[];
    const bySeedPath = new Map<string, ExistingFile>();
    const bySlugAndType = new Map<string, ExistingFile>();
    for (const row of existing) {
      const seedPath = row.metadata?.seedPath;
      const slug = row.metadata?.slug;
      if (typeof seedPath === "string") bySeedPath.set(seedPath, row);
      if (typeof slug === "string") bySlugAndType.set(`${row.file_type}:${slug}`, row);
    }

    let seeded = 0;
    let updated = 0;
    for (const file of seed) {
        const folderId = folderByName.get(file.folder) ?? null;
        const existingFile =
          bySeedPath.get(file.path) ??
          bySlugAndType.get(`${file.fileType}:${file.metadata.slug as string}`);
        const payload = {
          org_id: org.orgId,
          title: file.title,
          body: file.body,
          file_type: file.fileType,
          status: file.status ?? "active",
          folder_id: folderId,
          metadata: withoutUndefined(file.metadata) as Record<string, unknown>,
          content_format: "markdown"
        };
        if (existingFile) {
          const changed =
            existingFile.title !== payload.title ||
            existingFile.body !== payload.body ||
            existingFile.file_type !== payload.file_type ||
            existingFile.status !== payload.status ||
            existingFile.folder_id !== payload.folder_id ||
            existingFile.content_format !== payload.content_format ||
            stableJson(existingFile.metadata ?? {}) !== stableJson(payload.metadata);
          if (changed) {
            const { error } = await supabase.from("files").update(payload).eq("id", existingFile.id).eq("org_id", org.orgId);
            if (error) throw error;
            updated++;
          }
        } else {
          const { error } = await supabase.from("files").insert(payload);
          if (error) throw error;
          seeded++;
        }
    }
    const { error: relationError } = await supabase.rpc("rebuild_harness_file_relations", { target_org_id: org.orgId });
    if (relationError) throw relationError;
    return Response.json({
      message: `Seed sync complete. Inserted ${seeded}, updated ${updated}.`,
      seeded,
      updated
    });
  } catch (err) {
    return errorResponse(err);
  }
}
