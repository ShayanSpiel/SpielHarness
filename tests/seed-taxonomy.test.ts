import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const seedRoot = path.join(process.cwd(), "supabase", "seed");
const manifest = JSON.parse(
  readFileSync(path.join(seedRoot, "harness-manifest.json"), "utf8")
) as Record<string, {
  fileType?: string;
  slug?: string;
  folder?: string;
  skillSlugs?: string[];
  contextSlugs?: string[];
}>;

function baseSlugs(directory: string) {
  return readdirSync(path.join(seedRoot, directory))
    .filter((name) => /\.(md|json)$/.test(name))
    .map((name) => name.replace(/\.(md|json)$/, ""));
}

test("seed manifest paths exist and content files are non-empty", () => {
  for (const relativePath of Object.keys(manifest)) {
    const absolutePath = path.join(seedRoot, relativePath);
    assert.ok(existsSync(absolutePath), `Missing seed file: ${relativePath}`);
    assert.ok(readFileSync(absolutePath, "utf8").trim().length > 0, `Empty seed file: ${relativePath}`);
  }
});

test("strategy workspace and local library use the canonical folder boundary", () => {
  const allowedFolders: Record<string, Set<string>> = {
    strategy: new Set(["Strategy"]),
    prompt: new Set(["Prompts"]),
    knowledge: new Set(["Library"])
  };
  for (const [relativePath, entry] of Object.entries(manifest)) {
    if (!entry.fileType || !allowedFolders[entry.fileType]) continue;
    assert.ok(
      entry.folder && allowedFolders[entry.fileType].has(entry.folder),
      `${relativePath} has invalid ${entry.fileType} folder: ${entry.folder ?? "<none>"}`
    );
  }
});

test("role skill and context references resolve to seeded resources", () => {
  const skillSlugs = new Set(
    Object.entries(manifest)
      .filter(([relativePath]) => relativePath.startsWith("skills/") || relativePath.startsWith("evals/"))
      .map(([relativePath, entry]) => entry.slug ?? path.basename(relativePath).replace(/\.(md|json)$/, ""))
  );
  const contextSlugs = new Set([
    ...Object.values(manifest).map((entry) => entry.slug).filter((slug): slug is string => Boolean(slug)),
    ...baseSlugs("templates")
  ]);
  for (const [relativePath, entry] of Object.entries(manifest)) {
    if (!relativePath.startsWith("agents/")) continue;
    for (const slug of entry.skillSlugs ?? []) {
      assert.ok(skillSlugs.has(slug), `${relativePath} references missing skill ${slug}`);
    }
    for (const slug of entry.contextSlugs ?? []) {
      assert.ok(contextSlugs.has(slug), `${relativePath} references missing context ${slug}`);
    }
  }
});

test("workflow role and skill references resolve to seeded definitions", () => {
  const roles = new Set(baseSlugs("agents"));
  const skills = new Set([
    ...Object.entries(manifest)
      .filter(([relativePath]) => relativePath.startsWith("skills/") || relativePath.startsWith("evals/"))
      .map(([relativePath, entry]) => entry.slug ?? path.basename(relativePath).replace(/\.(md|json)$/, ""))
  ]);
  for (const fileName of readdirSync(path.join(seedRoot, "workflows")).filter((name) => name.endsWith(".json"))) {
    const workflow = JSON.parse(readFileSync(path.join(seedRoot, "workflows", fileName), "utf8")) as {
      nodes?: Array<{ roleSlug?: string; skillSlugs?: string[] }>;
    };
    for (const node of workflow.nodes ?? []) {
      if (node.roleSlug) assert.ok(roles.has(node.roleSlug), `${fileName} references missing role ${node.roleSlug}`);
      for (const slug of node.skillSlugs ?? []) {
        assert.ok(skills.has(slug), `${fileName} references missing skill ${slug}`);
      }
    }
  }
});
