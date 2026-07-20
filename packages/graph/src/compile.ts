import type { Sql } from "@spielos/db";
import { listHarnessFiles, listModels, getWorkspaceSettings } from "@spielos/db";
import {
  validateHarnessEntities,
  workspaceSettingsSchema,
  modelProviderObjectSchema,
  type FileRecord,
  type Role,
  type Skill,
  type WorkflowFile,
  type EvalFile,
  type EntityDiagnostic,
  type WorkspaceSettings,
  type ModelProvider,
} from "@spielos/core";

export type ResolvedRelations = {
  roleSkills: Map<string, string[]>;       // roleId → skillIds
  workflowRoles: Map<string, Map<number, string>>;  // workflowId → nodeIdx → roleId
  workflowSkills: Map<string, Map<number, string[]>>; // workflowId → nodeIdx → skillIds
};

export type WorkspaceSnapshot = {
  version: number;
  revision: string;
  settings: WorkspaceSettings;
  roles: Record<string, Role>;
  skills: Record<string, Skill>;
  workflows: Record<string, WorkflowFile>;
  evals: Record<string, EvalFile>;
  relations: ResolvedRelations;
  diagnostics: EntityDiagnostic[];
  modelRoster: ModelProvider[];
  contentHashes: Record<string, string>;
  compiledAt: string;
};

const snapshotCache = new Map<string, { snapshot: WorkspaceSnapshot; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

function computeRevision(
  settings: WorkspaceSettings,
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  workflows: Record<string, WorkflowFile>,
  evals: Record<string, EvalFile>,
  modelRoster: ModelProvider[]
): string {
  const material = [
    JSON.stringify(settings),
    Object.keys(roles).sort().map((id) => `${id}:${roles[id].updatedAt ?? ""}`).join("|"),
    Object.keys(skills).sort().map((id) => `${id}:${skills[id].updatedAt ?? ""}`).join("|"),
    Object.keys(workflows).sort().map((id) => `${id}:${workflows[id].updatedAt ?? ""}`).join("|"),
    Object.keys(evals).sort().map((id) => `${id}:${evals[id].updatedAt ?? ""}`).join("|"),
    modelRoster.map((m) => `${m.id}:${m.model}`).join("|"),
  ].join("::");

  let hash = 0;
  for (let i = 0; i < material.length; i++) {
    const char = material.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

export function buildContentHashes(files: FileRecord[]): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const file of files) {
    let hash = 0;
    const material = `${file.title}|${file.body}|${JSON.stringify(file.metadata)}|${file.currentVersion}`;
    for (let i = 0; i < material.length; i++) {
      const char = material.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    hashes[file.id] = Math.abs(hash).toString(36).padStart(8, "0");
  }
  return hashes;
}

export function buildResolvedRelations(
  roles: Record<string, Role>,
  workflows: Record<string, WorkflowFile>,
  skills: Record<string, Skill>
): ResolvedRelations {
  const roleSkills = new Map<string, string[]>();
  for (const [id, role] of Object.entries(roles)) {
    roleSkills.set(id, role.skillIds.filter((sid) => skills[sid] !== undefined));
  }

  const workflowRoles = new Map<string, Map<number, string>>();
  const workflowSkills = new Map<string, Map<number, string[]>>();
  for (const [id, wf] of Object.entries(workflows)) {
    const nodeRoles = new Map<number, string>();
    const nodeSkills = new Map<number, string[]>();
    wf.nodes.forEach((node, idx) => {
      if (node.roleId && roles[node.roleId]) nodeRoles.set(idx, node.roleId);
      nodeSkills.set(idx, node.skillIds.filter((sid) => skills[sid] !== undefined));
    });
    workflowRoles.set(id, nodeRoles);
    workflowSkills.set(id, nodeSkills);
  }

  return { roleSkills, workflowRoles, workflowSkills };
}

export async function compileSnapshot(
  sql: Sql,
  orgId: string,
  options?: { skipCache?: boolean }
): Promise<WorkspaceSnapshot> {
  const now = Date.now();
  const cacheKey = `snapshot:${orgId}`;

  if (!options?.skipCache) {
    const cached = snapshotCache.get(cacheKey);
    if (cached && (now - cached.cachedAt) < CACHE_TTL_MS) {
      return cached.snapshot;
    }
  }

  const [fileRows, modelRows, settingsRow] = await Promise.all([
    listHarnessFiles(sql, orgId),
    listModels(sql, orgId),
    getWorkspaceSettings(sql, orgId),
  ]);

  const toRecord = (f: typeof fileRows[0]): FileRecord => ({
    id: f.id,
    orgId: f.org_id,
    folderId: f.folder_id,
    fileType: f.file_type as FileRecord["fileType"],
    status: f.status as FileRecord["status"],
    lifecycle: (f.lifecycle ?? "published") as "draft" | "published" | "archived",
    enabled: f.enabled ?? true,
    validationDiagnostics: (f.validation_diagnostics ?? []) as [],
    title: f.title,
    body: f.body,
    contentFormat: f.content_format,
    metadata: f.metadata as Record<string, unknown>,
    currentVersion: f.current_version,
    createdAt: f.created_at,
    updatedAt: f.updated_at,
  });

  const records = fileRows.map(toRecord);
  const validated = validateHarnessEntities(records);

  const settings = workspaceSettingsSchema.parse({
    defaultExecutionMode: settingsRow?.default_execution_mode ?? "director",
    defaultModelId: settingsRow?.default_model_id ?? null,
    contextLimits: settingsRow?.context_limits ?? {},
    retrievalPolicy: settingsRow?.retrieval_policy ?? {},
    directorRuntimePolicy: settingsRow?.director_runtime_policy ?? undefined,
    approvalPolicy: settingsRow?.approval_policy ?? {},
  });

  const modelRoster: ModelProvider[] = modelRows
    .filter((r) => r.enabled)
    .map((r) => {
      const parsed = modelProviderObjectSchema.safeParse({
        id: r.id,
        orgId: r.org_id,
        name: r.name,
        provider: r.provider,
        model: r.model,
        baseUrl: r.base_url,
        secretEnvKey: r.secret_env_key,
        config: r.config ?? {},
        enabled: r.enabled,
      });
      return parsed.success ? parsed.data : null;
    })
    .filter((m): m is ModelProvider => m !== null);

  const relations = buildResolvedRelations(validated.roles, validated.workflows, validated.skills);
  const contentHashes = buildContentHashes(records);
  const revision = computeRevision(settings, validated.roles, validated.skills, validated.workflows, validated.evals, modelRoster);

  const snapshot: WorkspaceSnapshot = {
    version: 1,
    revision,
    settings,
    roles: validated.roles,
    skills: validated.skills,
    workflows: validated.workflows,
    evals: validated.evals,
    relations,
    diagnostics: validated.diagnostics,
    modelRoster,
    contentHashes,
    compiledAt: new Date().toISOString(),
  };

  snapshotCache.set(cacheKey, { snapshot, cachedAt: now });
  return snapshot;
}

export function invalidateSnapshotCache(orgId?: string) {
  if (orgId) {
    snapshotCache.delete(`snapshot:${orgId}`);
  } else {
    snapshotCache.clear();
  }
}
