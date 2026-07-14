import {
  defaultInputContract,
  defaultOutputContract,
  parseEvalFile,
  parseRoleFile,
  parseSkillFile,
  parseWorkflowFile,
  type Model,
  type ModelProvider,
  type EvalFile,
  type Role,
  type RunType,
  type Skill,
  type WorkflowFile,
  type WorkflowNode
} from "@spielos/core";
import type { OrgContext } from "./server";
import { HttpError } from "./server";
import {
  listModels,
  listConnections,
  listHarnessFiles
} from "@spielos/db";
import type { Connection, FileRecord } from "@spielos/core";
import type { RunRequest, AttachedFile } from "@spielos/graph";
import type { FileRow } from "@spielos/db";

function fileRowToRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    folderId: row.folder_id,
    fileType: row.file_type as FileRecord["fileType"],
    status: row.status as FileRecord["status"],
    title: row.title,
    body: row.body,
    contentFormat: row.content_format,
    metadata: row.metadata,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── API request body ──────────────────────────────────────────
export type ExecuteBody = {
  runId?: string;
  chatId?: string;
  prompt: string;
  type?: RunType;
  // For role/skill/eval targets
  targetId?: string;
  // For workflow targets
  workflowId?: string;
  // Generic context: anything user attached to the chat.
  contextFileIds?: string[];
  // Direct nodes (legacy)
  nodes?: Array<{
    id: string;
    roleId: string;
    title: string;
    promptOverride?: string;
    skillIds?: string[];
    fileIds?: string[];
  }>;
  // History (for plain chat)
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  idempotencyKey?: string;
};

// ── Resolved execution ────────────────────────────────────────
export type ResolvedExecution = {
  runRequest: RunRequest;
  type: RunType;
  target: { type: RunType; id: string | null };
  contextFileIds: string[];
  directorPrompt: string;
};

// ── Main resolver ─────────────────────────────────────────────
export async function resolveExecution(
  org: OrgContext,
  body: ExecuteBody
): Promise<ResolvedExecution> {
  if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

  // Load the entire harness: all files + all connections.
  const [files, connections, modelRows] = await Promise.all([
    listHarnessFiles(org.sql, org.orgId),
    listConnections(org.sql, org.orgId),
    listModels(org.sql, org.orgId)
  ]);

  const toRecord = (f: FileRow) => fileRowToRecord(f);
  const roles = indexBy(
    files.filter((f) => f.file_type === "harness_role").map(toRecord).map(parseRoleFile),
    (r) => r.id
  );
  const skills = indexBy(
    files
      .filter((f) => f.file_type === "harness_skill")
      .map(toRecord)
      .map(parseSkillFile),
    (s) => s.id
  );
  const evals = indexBy(
    files.filter((f) => f.file_type === "harness_eval").map(toRecord).map(parseEvalFile),
    (e) => e.id
  );
  const workflows = indexBy(
    files.filter((f) => f.file_type === "harness_workflow" || f.file_type === "harness_workstream").map(toRecord).map(parseWorkflowFile),
    (w) => w.id
  );

  // Slug indexes for role/skill reference resolution
  const roleBySlug = new Map<string, string>();
  for (const role of Object.values(roles)) {
    const slug = role.metadata?.slug;
    if (typeof slug === "string") roleBySlug.set(slug, role.id);
  }
  const skillBySlug = new Map<string, string>();
  for (const skill of Object.values(skills)) {
    const slug = skill.metadata?.slug;
    if (typeof slug === "string") skillBySlug.set(slug, skill.id);
  }
  for (const role of Object.values(roles)) {
    role.skillIds = role.skillIds.map((idOrSlug) => skillBySlug.get(idOrSlug) ?? idOrSlug);
  }
  const fileReferenceIds = new Map<string, string>();
  for (const file of files) {
    fileReferenceIds.set(file.id, file.id);
    const slug = file.metadata?.slug;
    if (typeof slug === "string") fileReferenceIds.set(slug, file.id);
  }
  for (const evalFile of Object.values(evals)) {
    const evalSkill = evalFileToSkill(evalFile, org.orgId);
    skills[evalSkill.id] = evalSkill;
    skillBySlug.set(evalFile.id, evalSkill.id);
    skillBySlug.set(evalSkill.slug, evalSkill.id);
  }

  // Resolve context files (the user's attached files)
  const contextFileIds = dedupe(body.contextFileIds ?? []);
  // Resolve target
  const targetType: RunType = body.type ?? "chat";
  let targetId: string | null = null;
  let workflow: WorkflowFile | null = null;
  let singleNode: RunRequest["singleNode"] = null;

  if (targetType === "workflow") {
    const workflowId = body.workflowId ?? body.targetId;
    if (!workflowId) throw new HttpError(400, "workflowId is required for workflow runs.");
    const wf = workflows[workflowId];
    if (!wf) throw new HttpError(404, "Workflow not found.");
    if (wf.status !== "active") {
      throw new HttpError(400, `Workflow "${wf.name}" is disabled.`);
    }
    workflow = normalizeWorkflow(wf, roles, skills, roleBySlug, skillBySlug, fileReferenceIds, org.orgId);
    targetId = wf.id;
  } else if (targetType === "role") {
    if (!body.targetId) throw new HttpError(400, "targetId is required for role runs.");
    const role = roles[body.targetId];
    if (!role) throw new HttpError(404, "Role not found.");
    if (role.status !== "active") {
      throw new HttpError(400, `Role "${role.name}" is disabled.`);
    }
    const skillIds = role.skillIds.filter((id) => skills[id]?.status === "active");
    if (skillIds.length === 0) {
      throw new HttpError(400, `Role "${role.name}" has no active skills.`);
    }
    const virtualNode: WorkflowNode = {
      id: `node_${crypto.randomUUID()}`,
      title: role.name,
      roleId: role.id,
      skillIds,
      fileIds: contextFileIds,
      inputContract: role.inputContract?.name ?? "any",
      outputContract: role.outputContract?.name ?? "any",
      position: { x: 0, y: 0 }
    };
    workflow = { id: "_single", orgId: org.orgId, name: role.name, description: "", nodes: [virtualNode], edges: [], status: "active", metadata: {} };
    targetId = role.id;
  } else if (targetType === "skill") {
    if (!body.targetId) throw new HttpError(400, "targetId is required for skill runs.");
    const skill = skills[body.targetId];
    if (!skill) throw new HttpError(404, "Skill not found.");
    if (skill.status !== "active") {
      throw new HttpError(400, `Skill "${skill.name}" is disabled.`);
    }
    const chatRole: Role = {
      id: "runtime.chat",
      orgId: org.orgId,
      name: "Chat",
      description: "Direct skill execution.",
      prompt: "Run the selected skill against the request and selected context.",
      modelId: null,
      inputContract: defaultInputContract(),
      outputContract: defaultOutputContract(),
      skillIds: [skill.id],
      status: "active",
      metadata: {}
    };
    roles["runtime.chat"] = chatRole;
    singleNode = {
      kind: "skill",
      nodeId: `node_${crypto.randomUUID()}`,
      title: skill.name,
      role: chatRole,
      skill,
      evalFile: null,
      fileIds: contextFileIds
    };
    targetId = skill.id;
  } else if (targetType === "eval") {
    if (!body.targetId) throw new HttpError(400, "targetId is required for eval runs.");
    const evalFile = evals[body.targetId];
    if (!evalFile) throw new HttpError(404, "Evaluation not found.");
    if (evalFile.status !== "active") {
      throw new HttpError(400, `Evaluation "${evalFile.name}" is disabled.`);
    }
    // Build a synthetic eval skill
    const evalSkill = evalFileToSkill(evalFile, org.orgId);
    skills[evalSkill.id] = evalSkill;
    const evalRole: Role = {
      id: "runtime.eval",
      orgId: org.orgId,
      name: "Evaluation Runner",
      description: "Runs a reusable evaluation definition.",
      prompt: "Evaluate the supplied input against the selected rubric.",
      modelId: null,
      inputContract: defaultInputContract(),
      outputContract: { ...defaultOutputContract(), name: "Eval report" },
      skillIds: [evalSkill.id],
      status: "active",
      metadata: {}
    };
    roles["runtime.eval"] = evalRole;
    singleNode = {
      kind: "eval",
      nodeId: `node_${crypto.randomUUID()}`,
      title: evalFile.name,
      role: evalRole,
      skill: evalSkill,
      evalFile,
      fileIds: contextFileIds
    };
    targetId = evalFile.id;
  } else if (targetType === "chat") {
    // No workflow, no single node. The runtime will use streamChatRun.
  } else {
    throw new HttpError(400, `Unknown run type: ${body.type}`);
  }

  if (workflow) {
    workflow = {
      ...workflow,
      nodes: workflow.nodes.map((node) => ({
        ...node,
        fileIds: dedupe([...node.fileIds, ...contextFileIds])
      }))
    };
  }
  const configuredFileIds = workflow?.nodes.flatMap((node) => node.fileIds) ?? singleNode?.fileIds ?? [];
  const runFileIds = dedupe([...contextFileIds, ...configuredFileIds]);
  const attached: AttachedFile[] = files
    .filter((file) => runFileIds.includes(file.id) && file.status !== "deleted")
    .map(toAttached);

  // Resolve model
  const preferredModelId = workflow
    ? Object.values(roles).find((r) => workflow!.nodes.some((n) => n.roleId === r.id))?.modelId ?? null
    : singleNode?.role?.modelId ?? null;
  const model = resolveModel(modelRows, preferredModelId, org.orgId);

  // Resolve connections
  const connectionIds = new Set<string>();
  const operationIds = new Set<string>();
  for (const skill of Object.values(skills)) {
    operationIds.add(skill.slug);
    for (const binding of skill.bindings) {
      if (binding.connectionId) connectionIds.add(binding.connectionId);
    }
  }
  const connectionsById: Record<string, Connection> = {};
  for (const c of connections) {
    const exposesSkillOperation = (c.operations ?? []).some((operation) => operationIds.has(String(operation.id)));
    if (connectionIds.has(c.id) || exposesSkillOperation) {
      connectionsById[c.id] = {
        id: c.id,
        orgId: c.org_id,
        name: c.name,
        kind: c.kind as Connection["kind"],
        status: c.status as Connection["status"],
        baseUrl: c.base_url,
        secretEnvKey: c.secret_env_key,
        config: c.config ?? {},
        operations: (c.operations ?? []).map((o) => ({
          id: String(o.id),
          label: o.label as string | undefined,
          effect: (o.effect as "read" | "write" | "send" | "destructive" | undefined) ?? "read",
          method: o.method as string | undefined,
          path: o.path as string | undefined,
          inputParam: o.inputParam as string | undefined
        })),
        enabled: c.enabled
      };
    }
  }

  // Resolve director prompt for chat runs
  const directorPrompt = resolveDirectorPrompt(files, roles, skills, evals, workflows);

  return {
    runRequest: {
      orgId: org.orgId,
      runId: body.runId ?? "",
      prompt: body.prompt,
      workflow,
      singleNode,
      roles,
      skills,
      files: attached,
      connections: connectionsById,
      provider: model?.provider ?? null,
      model: model?.model ?? null
    },
    type: targetType,
    target: { type: targetType, id: targetId },
    contextFileIds,
    directorPrompt
  };
}

// ── Model resolution ──────────────────────────────────────────
type ResolvedModel = { provider: ModelProvider; model: Model } | null;

function resolveModel(
  rows: Awaited<ReturnType<typeof listModels>>,
  preferredModelId: string | null,
  orgId: string
): ResolvedModel {
  const enabled = rows.filter((row) => row.enabled);
  const row = (preferredModelId ? enabled.find((candidate) => candidate.id === preferredModelId) : null) ?? enabled[0];
  if (!row) {
    if (!process.env.MISTRAL_API_KEY) return null;
    const modelId = process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest";
    const runtimeModel: Model = {
      id: "runtime.env.mistral",
      orgId,
      name: "Mistral",
      provider: "mistral",
      model: modelId,
      baseUrl: process.env.MISTRAL_BASE_URL?.trim() || null,
      secretEnvKey: "MISTRAL_API_KEY",
      config: { source: "environment" },
      enabled: true
    };
    return {
      provider: { ...runtimeModel },
      model: runtimeModel
    };
  }
  const provider: ModelProvider = {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    provider: row.provider as ModelProvider["provider"],
    model: row.model,
    baseUrl: row.base_url,
    secretEnvKey: row.secret_env_key,
    config: row.config ?? {},
    enabled: row.enabled
  };
  const model: Model = {
    id: row.id,
    orgId: row.org_id,
    name: row.name,
    provider: row.provider as ModelProvider["provider"],
    model: row.model,
    baseUrl: row.base_url,
    secretEnvKey: row.secret_env_key,
    config: row.config ?? {},
    enabled: row.enabled
  };
  return { provider, model };
}

// ── Director prompt (orchestrator) ────────────────────────────
function resolveDirectorPrompt(
  files: FileRow[],
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  evals: Record<string, EvalFile>,
  workflows: Record<string, WorkflowFile>
): string {
  const orchestrator = files.find(
    (f) => f.file_type === "prompt" && f.metadata?.systemRole === "orchestrator" && f.status === "active"
  );
  const catalog = [
    "Workspace catalog (awareness only; an item is executable context only when the user selects it):",
    `Roles: ${Object.values(roles).filter((item) => item.status === "active").map((item) => item.name).join(", ") || "none"}`,
    `Skills: ${Object.values(skills).filter((item) => item.status === "active" && !item.id.startsWith("runtime.eval.skill.")).map((item) => item.name).join(", ") || "none"}`,
    `Workflows: ${Object.values(workflows).filter((item) => item.status === "active").map((item) => item.name).join(", ") || "none"}`,
    `Evals: ${Object.values(evals).filter((item) => item.status === "active").map((item) => item.name).join(", ") || "none"}`,
    `Available strategy and library files: ${files.filter((item) => ["knowledge", "strategy", "library", "prompt"].includes(item.file_type) && item.status === "active").map((item) => item.title).join(", ") || "none"}`
  ].join("\n");
  return [
    "You are the SpielOS assistant. Converse naturally and answer the user's question directly. You can explain the product, its workspace, and the available harness catalog. Do not require a selected role, skill, file, eval, or workflow for ordinary conversation.",
    "Never claim that you searched, executed a tool, ran a workflow, or read a file unless the runtime actually supplied that context or execution.",
    orchestrator?.body ? `Workspace-authored assistant instructions:\n${orchestrator.body}` : "",
    catalog
  ].filter(Boolean).join("\n\n");
}

// ── Workflow normalization: resolve role/skill slugs, attach files ─
function normalizeWorkflow(
  wf: WorkflowFile,
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  roleBySlug: Map<string, string>,
  skillBySlug: Map<string, string>,
  fileReferenceIds: Map<string, string>,
  orgId: string
): WorkflowFile {
  if (wf.nodes.length === 0) throw new HttpError(400, `Workflow "${wf.name}" has no steps.`);
  const seenNodeIds = new Set<string>();
  const nodes: WorkflowNode[] = wf.nodes.map((node, i) => {
    let roleId = node.roleId;
    if (!roles[roleId]) {
      const resolved = roleBySlug.get(roleId);
      if (resolved) roleId = resolved;
    }
    const skillIds = node.skillIds.map((id) => skillBySlug.get(id) ?? id);
    // Ensure role has a valid skill list (or fall back to role's default)
    const role = roles[roleId];
    let effectiveSkillIds = skillIds;
    if (effectiveSkillIds.length === 0 && role) {
      effectiveSkillIds = role.skillIds.filter((id) => skills[id]?.status === "active");
    }
    if (effectiveSkillIds.length === 0 && role) {
      throw new HttpError(400, `Workflow node "${node.title}" has no active skill.`);
    }
    if (effectiveSkillIds.length === 0) {
      throw new HttpError(400, `Workflow node "${node.title}" has no resolvable skill.`);
    }
    for (const skillId of effectiveSkillIds) {
      const resolvedSkill = skills[skillId];
      if (!resolvedSkill) {
        throw new HttpError(400, `Workflow node "${node.title}" references an unknown skill "${skillId}".`);
      }
      if (resolvedSkill.status !== "active") {
        throw new HttpError(400, `Workflow node "${node.title}" references disabled skill "${resolvedSkill.name}".`);
      }
    }
    if (!role) {
      roleId = `runtime.workflow.${wf.id}.${node.id || i + 1}`;
      roles[roleId] = {
        id: roleId,
        orgId,
        name: node.title,
        description: "Workflow-owned execution role.",
        prompt: node.promptOverride ?? `Execute the ${node.title} workflow step.`,
        modelId: null,
        inputContract: defaultInputContract(),
        outputContract: defaultOutputContract(),
        skillIds: effectiveSkillIds,
        status: "active",
        metadata: { runtime: true, workflowId: wf.id, nodeId: node.id }
      };
    }
    const n = node as WorkflowNode;
    const roleContextSlugs = role && Array.isArray(role.metadata?.contextSlugs)
      ? role.metadata.contextSlugs.filter((value): value is string => typeof value === "string")
      : [];
    const fileIds = dedupe([...roleContextSlugs, ...n.fileIds])
      .map((idOrSlug) => fileReferenceIds.get(idOrSlug) ?? idOrSlug);
    const nodeId = n.id || `node-${i + 1}`;
    if (seenNodeIds.has(nodeId)) throw new HttpError(400, `Workflow contains duplicate node id "${nodeId}".`);
    seenNodeIds.add(nodeId);
    return {
      ...n,
      id: nodeId,
      roleId,
      skillIds: effectiveSkillIds,
      fileIds,
      position: n.position ?? { x: 120 + i * 260, y: 160 }
    };
  });
  // Build edges if missing — link consecutive nodes
  let edges = wf.edges;
  if (edges.length === 0 && nodes.length > 1) {
    edges = nodes.slice(0, -1).map((node, i) => ({
      id: `edge-${node.id}-${nodes[i + 1].id}`,
      source: node.id,
      target: nodes[i + 1].id
    }));
  }
  // Validate edges
  for (const edge of edges) {
    if (!nodes.find((n) => n.id === edge.source)) {
      throw new HttpError(400, `Workflow edge "${edge.id}" references missing source.`);
    }
    if (!nodes.find((n) => n.id === edge.target)) {
      throw new HttpError(400, `Workflow edge "${edge.id}" references missing target.`);
    }
  }
  // Verify no cycles using simple DFS
  if (hasCycle(nodes, edges)) {
    throw new HttpError(400, "Workflow contains a cycle.");
  }
  return { ...wf, nodes, edges };
}

function evalFileToSkill(evalFile: EvalFile, orgId: string): Skill {
  return {
    id: `runtime.eval.skill.${evalFile.id}`,
    orgId,
    name: evalFile.name,
    slug: (typeof evalFile.metadata?.slug === "string" ? evalFile.metadata.slug : "") || `eval.${evalFile.id}`,
    description: evalFile.description,
    kind: "eval",
    status: "active",
    auth: "none",
    sideEffect: "none",
    inputSchema: JSON.stringify({ input: "string" }),
    outputSchema: JSON.stringify({ score: "number", passed: "boolean" }),
    implementation: evalFile.description,
    bindings: [],
    evalRules: evalFile.rules,
    overallThreshold: evalFile.overallThreshold,
    metadata: { ...evalFile.metadata, evalId: evalFile.id, loopConfig: evalFile.loopConfig }
  };
}

function hasCycle(nodes: WorkflowNode[], edges: WorkflowFile["edges"]): boolean {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.source)?.push(e.target);
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(id: string): boolean {
    if (stack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    stack.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    stack.delete(id);
    return false;
  }
  for (const n of nodes) {
    if (dfs(n.id)) return true;
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────
function indexBy<T>(items: T[], key: (item: T) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[key(item)] = item;
  return out;
}

function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toAttached(file: FileRow): AttachedFile {
  return {
    id: file.id,
    title: file.title,
    body: file.body,
    fileType: file.file_type,
    metadata: file.metadata ?? {}
  };
}
