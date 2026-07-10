import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { errorResponse, getOrg, requireSupabase } from "../../../../lib/server";

const SEED_ROOT = path.join(process.cwd(), "..", "..", "supabase", "seed");

type SeedFile = {
  path: string;
  title: string;
  body: string;
  fileType: string;
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

const EVAL_SKILL_CONFIG: Record<string, Pick<SeedFile, "metadata">["metadata"]> = {
  "pipeline-gate-evaluator": {
    kind: "eval",
    overallThreshold: 75,
    evalRubrics: [
      { id: "rubric-em-dash", label: "No Em Dashes", type: "missing", value: "—", weight: 15, passThreshold: 100 },
      { id: "rubric-banned-phrases", label: "No Banned Phrases", type: "missing", value: "Like if you agree,Share if this resonates,Follow for more,TOFU,MOFU,BOFU", weight: 25, passThreshold: 100 },
      { id: "rubric-frontmatter", label: "Required Frontmatter", type: "contains", value: "title,platform,reader,pain,belief,point,meaning,proof,status,source", weight: 35, passThreshold: 80 },
      { id: "rubric-char-count", label: "Char Count Limit", type: "max_words", value: "280", weight: 25, passThreshold: 90 }
    ]
  },
  "grounding-evaluator": {
    kind: "eval",
    overallThreshold: 75,
    evalRubrics: [
      { id: "rubric-icp-markers", label: "ICP Markers Present", type: "contains", value: "session,traffic,engagement,attention,distribution,placement", weight: 30, passThreshold: 70 },
      { id: "rubric-no-buildlog", label: "No Build-Log Language", type: "missing", value: "test,adapter,shim,IDE,git,doctor,pipeline,vault", weight: 25, passThreshold: 100 },
      { id: "rubric-point-contradicts", label: "Point Contradicts Belief", type: "contains", value: "engineered,placed,not", weight: 25, passThreshold: 75 },
      { id: "rubric-meaning-voice", label: "Meaning in ICP Voice", type: "contains", value: "I", weight: 20, passThreshold: 80 }
    ]
  }
};

function classify(relPath: string): { fileType: string; metadata: Record<string, unknown> } {
  const parts = relPath.split(path.sep);
  const folder = parts[0] ?? "";
  const fileName = parts[parts.length - 1] ?? "";
  const base = fileName.replace(/\.[^.]+$/, "");

  if (folder === "agents") {
    const roleSkills: Record<string, string[]> = {
      strategist: ["llm.generate", "knowledge.search", "icp-world-simulator"],
      writer: ["llm.generate", "template.apply", "rag.file.read"],
      editor: ["llm.generate", "pipeline-gate-evaluator", "grounding-evaluator", "rag.file.read"],
      publisher: ["ask-the-user", "publish-package-builder"],
      researcher: ["web.search", "knowledge.search", "rag.file.read"],
      "ads-planner": ["llm.generate", "web.search"]
    };
    return {
      fileType: "harness_role",
      metadata: { role: true, slug: base, skillSlugs: roleSkills[base] ?? ["llm.generate"] }
    };
  }
  if (folder === "skills") {
    const skillKinds: Record<string, string> = {
      "ask-the-user": "human_input",
      "grounding-evaluator": "eval",
      "pipeline-gate-evaluator": "eval",
      "knowledge-search": "knowledge_search",
      "rag-file-read": "knowledge_search",
      "web-search": "http"
    };
    const skillSlugs: Record<string, string> = {
      "ask-the-user": "ask-the-user",
      "icp-world-simulator": "icp-world-simulator",
      "grounding-evaluator": "grounding-evaluator",
      "pipeline-gate-evaluator": "pipeline-gate-evaluator",
      "knowledge-search": "knowledge.search",
      "rag-file-read": "rag.file.read",
      "web-search": "web.search",
      "llm-generate": "llm.generate",
      "template-apply": "template.apply",
      "publish-package-builder": "publish-package-builder"
    };
    return {
      fileType: "harness_skill",
      metadata: { skill: true, slug: skillSlugs[base] ?? base, kind: skillKinds[base] ?? "llm_call" }
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
    const promptFiles = new Set(["orchestrator-prompt", "strategy-brief-prompt", "post-command"]);
    return {
      fileType: promptFiles.has(base) ? "prompt" : "strategy",
      metadata: { system: true, prompt: promptFiles.has(base), slug: base }
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

async function walk(dir: string, base: string, out: SeedFile[]): Promise<void> {
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
      await walk(full, rel, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    if (!/\.(md|markdown|json|yaml|yml)$/i.test(entry.name)) continue;
    const fileName = entry.name;
    const body = await readFile(full, "utf8");
    const { fileType, metadata: classifiedMetadata } = classify(rel);
    const folderName = FOLDER_BY_SEED_DIR[rel.split(path.sep)[0] ?? ""] ?? "Knowledge";
    const metadata = {
      ...classifiedMetadata,
      ...(EVAL_SKILL_CONFIG[classifiedMetadata.slug as string] ?? {}),
      seed: true,
      seedPath: rel,
      seedFolder: folderName
    };
    if (fileType === "harness_eval" && entry.name.endsWith(".json")) {
      try {
        const parsed = JSON.parse(body);
        const seedTitle = parsed.name ?? fileName.replace(/\.[^.]+$/, "");
        out.push({
          path: rel,
          title: seedTitle,
          body: body,
          fileType,
          folder: folderName,
          metadata: {
            ...metadata,
            eval: true,
            targetType: parsed.targetType,
            overallThreshold: parsed.overallThreshold,
            rubrics: parsed.rubrics
          }
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
          folder: folderName,
          metadata: {
            ...metadata,
            workstream: true,
            nodes: parsed.nodes ?? [],
            edges: parsed.edges ?? []
          }
        });
        continue;
      } catch {
        // fall through to text mode
      }
    }
    const title = titleFromFile(fileName, body);
    out.push({ path: rel, title, body, fileType, folder: folderName, metadata });
  }
}

async function loadSeed(): Promise<SeedFile[]> {
  const out: SeedFile[] = [];
  await walk(SEED_ROOT, "", out);
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
      try {
        const folderId = folderByName.get(file.folder) ?? null;
        const existingFile =
          bySeedPath.get(file.path) ??
          bySlugAndType.get(`${file.fileType}:${file.metadata.slug as string}`);
        const payload = {
          org_id: org.orgId,
          title: file.title,
          body: file.body,
          file_type: file.fileType,
          status: "active",
          folder_id: folderId,
          metadata: file.metadata,
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
            const { error } = await supabase.from("files").update(payload).eq("id", existingFile.id);
            if (error) throw error;
            updated++;
          }
        } else {
          const { error } = await supabase.from("files").insert(payload);
          if (error) throw error;
          seeded++;
        }
      } catch (err) {
        console.warn(`[seed] failed to insert ${file.path}:`, err);
      }
    }
    return Response.json({
      message: `Seed sync complete. Inserted ${seeded}, updated ${updated}.`,
      seeded,
      updated
    });
  } catch (err) {
    return errorResponse(err);
  }
}
