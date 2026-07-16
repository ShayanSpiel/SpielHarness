import {
  defaultInputContract,
  defaultOutputContract,
  parseEvalFile,
  parseRoleFile,
  parseSkillFile,
  parseWorkflowFile,
  type Model,
  type ModelCapabilities,
  type ModelProvider,
  type EvalFile,
  type Role,
  type RunBudget,
  type RunGoal,
  type RunType,
  type Skill,
  type WorkflowFile,
  type WorkflowNode
} from "@spielos/core";
import type { OrgContext } from "./server";
import { HttpError } from "./server";
import {
  audit,
  createFile,
  getFile,
  getOrchestratorPrompt,
  listConnections,
  listHarnessFiles,
  updateFileIfVersion
} from "@spielos/db";
import type { Connection, FileRecord } from "@spielos/core";
import type { RunRequest, AttachedFile } from "@spielos/graph";
import type { ConversationCompaction } from "@spielos/providers";
import type { FileRow } from "@spielos/db";
import { createHash } from "node:crypto";
import { environmentModelDefaults, listModelsWithEnvironmentDefaults } from "./default-models";

function stableUuid(value: string): string {
  const chars = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

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
  modelId?: string;
  reasoningEffort?: ModelCapabilities["reasoningEffort"];
  goal?: RunGoal;
  budget?: Partial<Pick<RunBudget, "maxInputTokens" | "maxOutputTokens" | "maxDurationMs" | "maxToolCalls">>;
  previousCompaction?: ConversationCompaction | null;
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

  const targetType: RunType = body.type ?? "chat";
  const contextFileIds = dedupe(body.contextFileIds ?? []);
  const isChat = targetType === "chat";
  // Plain chat = no target, no workflow, no attached context, and no legacy
  // direct-node payload. The orchestrator prompt and an env-defined model
  // are enough; skip the full harness enumeration and connection load.
  const isPlainChat = isChat
    && !body.targetId
    && !body.workflowId
    && contextFileIds.length === 0
    && !(body.nodes && body.nodes.length > 0);

  const toRecord = (f: FileRow) => fileRowToRecord(f);

  // For plain chat, only the orchestrator prompt and an env-defined model
  // are required. Skip listHarnessFiles, listConnections, and the
  // listModels+createModel round-trip.
  let files: FileRow[];
  let modelRows: Awaited<ReturnType<typeof listModelsWithEnvironmentDefaults>>;
  let connections: Awaited<ReturnType<typeof listConnections>> = [];
  if (isPlainChat) {
    const orchestrator = await getOrchestratorPrompt(org.sql, org.orgId);
    files = orchestrator ? [orchestrator] : [];
    modelRows = environmentModelDefaults().map((model) => ({
      id: `runtime.env.${model.provider}.${model.model}`,
      org_id: org.orgId,
      name: model.name,
      provider: model.provider,
      model: model.model,
      base_url: model.baseUrl,
      secret_env_key: model.secretEnvKey,
      config: { source: "environment", capabilities: model.capabilities },
      enabled: true
    }));
  } else {
    const [loadedFiles, loadedModels] = await Promise.all([
      listHarnessFiles(org.sql, org.orgId),
      listModelsWithEnvironmentDefaults(org.sql, org.orgId)
    ]);
    files = loadedFiles;
    modelRows = loadedModels;
    if (!isChat) {
      connections = await listConnections(org.sql, org.orgId);
    }
  }

  let roles: Record<string, Role> = {};
  let skills: Record<string, Skill> = {};
  let evals: Record<string, EvalFile> = {};
  let workflows: Record<string, WorkflowFile> = {};
  const roleBySlug = new Map<string, string>();
  const skillBySlug = new Map<string, string>();
  const fileReferenceIds = new Map<string, string>();

  if (!isChat) {
    roles = indexBy(
      files.filter((f) => f.file_type === "harness_role").map(toRecord).map(parseRoleFile),
      (r) => r.id
    );
    skills = indexBy(
      files.filter((f) => f.file_type === "harness_skill").map(toRecord).map(parseSkillFile),
      (s) => s.id
    );
    evals = indexBy(
      files.filter((f) => f.file_type === "harness_eval").map(toRecord).map(parseEvalFile),
      (e) => e.id
    );
    workflows = indexBy(
      files.filter((f) => f.file_type === "harness_workflow" || f.file_type === "harness_workstream").map(toRecord).map(parseWorkflowFile),
      (w) => w.id
    );

    for (const role of Object.values(roles)) {
      const slug = role.metadata?.slug;
      if (typeof slug === "string") roleBySlug.set(slug, role.id);
    }
    for (const skill of Object.values(skills)) {
      const slug = skill.metadata?.slug;
      if (typeof slug === "string") skillBySlug.set(slug, skill.id);
    }
    for (const role of Object.values(roles)) {
      role.skillIds = role.skillIds.map((idOrSlug) => skillBySlug.get(idOrSlug) ?? idOrSlug);
    }
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
  }

  // Resolve target
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
  const workspaceInstructions: AttachedFile[] = files
    .filter((file) => file.status === "active" && file.metadata?.workspaceConfig === true)
    .map(toAttached);
  const memories: AttachedFile[] = retrieveMemories(files, body.prompt, targetType, targetId, org.userId).map(toAttached);

  // Resolve model
  const preferredModelId = body.modelId ?? (workflow
    ? Object.values(roles).find((r) => workflow!.nodes.some((n) => n.roleId === r.id))?.modelId ?? null
    : singleNode?.role?.modelId ?? null);
  let model = resolveModel(modelRows, preferredModelId, org.orgId);
  const allowedEffort = ["auto", "low", "medium", "high", "xhigh", "max"] as const;
  if (model && body.reasoningEffort && allowedEffort.includes(body.reasoningEffort)) {
    const withEffort = (value: Model): Model => ({
      ...value,
      config: {
        ...value.config,
        capabilities: {
          ...(typeof value.config.capabilities === "object" && value.config.capabilities ? value.config.capabilities : {}),
          reasoningEffort: body.reasoningEffort
        }
      }
    });
    model = { provider: withEffort(model.provider), model: withEffort(model.model) };
  }

  // Resolve connections (only for harness runs — chat doesn't execute skills)
  const connectionsById: Record<string, Connection> = {};
  if (!isChat) {
    const connectionIds = new Set<string>();
    const operationIds = new Set<string>();
    for (const skill of Object.values(skills)) {
      operationIds.add(skill.slug);
      for (const binding of skill.bindings) {
        if (binding.connectionId) connectionIds.add(binding.connectionId);
      }
    }
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
  }

  // Resolve director prompt
  const directorPrompt = resolveDirectorPrompt(files, isPlainChat);
  const harnessFileAction: NonNullable<RunRequest["harnessFileAction"]> = async (action, params, context) => {
    const allowedTypes = new Set(["harness_role", "harness_skill", "harness_workflow", "harness_eval", "harness_template"]);
    if (action === "create") {
      const title = typeof params.title === "string" ? params.title.trim() : "";
      const fileType = typeof params.fileType === "string" ? params.fileType : "";
      const content = typeof params.body === "string" ? params.body : "";
      if (!title || !allowedTypes.has(fileType)) throw new Error("Harness creation requires a title and valid harness fileType.");
      const suppliedMetadata = params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)
        ? params.metadata as Record<string, unknown>
        : {};
      const row = await createFile(org.sql, org.orgId, {
        title,
        body: content,
        fileType,
        status: "draft",
        metadata: {
          ...suppliedMetadata,
          agentProposed: true,
          proposedByRun: context.runId,
          proposedByNode: context.nodeId
        }
      });
      await audit(org.sql, org.orgId, {
        actorId: org.userId,
        action: "agent_propose_create",
        entityType: "file",
        entityId: row.id,
        after: { title: row.title, fileType: row.file_type, status: row.status, runId: context.runId }
      });
      return { id: row.id, title: row.title, fileType: row.file_type, status: row.status, version: row.current_version };
    }

    const id = typeof params.id === "string" ? params.id : "";
    const expectedVersion = typeof params.expectedVersion === "number" ? params.expectedVersion : NaN;
    if (!id || !Number.isInteger(expectedVersion)) throw new Error("Harness update requires id and expectedVersion.");
    const before = await getFile(org.sql, org.orgId, id);
    if (!before || !allowedTypes.has(before.file_type)) throw new Error("Harness draft was not found.");
    if (before.status !== "draft" || before.metadata?.agentProposed !== true) {
      throw new Error("Agents may only update agent-proposed drafts; active harness files require explicit user editing.");
    }
    const suppliedMetadata = params.metadata && typeof params.metadata === "object" && !Array.isArray(params.metadata)
      ? params.metadata as Record<string, unknown>
      : null;
    const row = await updateFileIfVersion(org.sql, org.orgId, id, expectedVersion, {
      title: typeof params.title === "string" ? params.title.trim() : undefined,
      body: typeof params.body === "string" ? params.body : undefined,
      metadata: suppliedMetadata ? { ...before.metadata, ...suppliedMetadata, lastProposedByRun: context.runId } : undefined
    });
    if (!row) throw new Error("Harness draft changed concurrently. Reload it and retry with the latest version.");
    await audit(org.sql, org.orgId, {
      actorId: org.userId,
      action: "agent_propose_update",
      entityType: "file",
      entityId: row.id,
      before: { version: before.current_version, title: before.title },
      after: { version: row.current_version, title: row.title, runId: context.runId }
    });
    return { id: row.id, title: row.title, fileType: row.file_type, status: row.status, version: row.current_version };
  };
  const memoryProposalAction: NonNullable<RunRequest["memoryProposalAction"]> = async (params, context) => {
    const title = typeof params.title === "string" ? params.title.trim() : "";
    const content = typeof params.body === "string" ? params.body.trim() : "";
    if (!title || !content) throw new Error("Memory proposals require title and body.");
    const requestedScope = typeof params.scope === "string" ? params.scope : "workspace";
    const scope = ["workspace", "user", "role", "workflow"].includes(requestedScope) ? requestedScope : "workspace";
    const scopeId = scope === "user"
      ? org.userId
      : scope === "role" && targetType === "role"
        ? targetId
        : scope === "workflow" && targetType === "workflow"
          ? targetId
          : typeof params.scopeId === "string" ? params.scopeId : null;
    if ((scope === "role" || scope === "workflow") && !scopeId) throw new Error(`${scope} memory requires a resolvable scope id.`);
    const comparable = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
    const latestFiles = await listHarnessFiles(org.sql, org.orgId);
    const existingMemories = latestFiles.filter((file) => file.metadata?.memoryRecord === true && file.status !== "deleted");
    const duplicate = existingMemories.find((file) => comparable(file.body) === comparable(content) && file.metadata.memoryScope === scope && (file.metadata.scopeId ?? null) === scopeId);
    const conflicts = existingMemories.filter((file) => comparable(file.title) === comparable(title) && comparable(file.body) !== comparable(content) && file.metadata.memoryScope === scope && (file.metadata.scopeId ?? null) === scopeId);
    if (duplicate) {
      return { id: duplicate.id, title: duplicate.title, status: String(duplicate.metadata.memoryStatus ?? "proposed"), duplicateOf: duplicate.id, conflictIds: conflicts.map((file) => file.id) };
    }
    const confidence = typeof params.confidence === "number" ? Math.min(1, Math.max(0, params.confidence)) : 0.7;
    const row = await createFile(org.sql, org.orgId, {
      id: stableUuid(`${org.orgId}:${scope}:${scopeId ?? ""}:${comparable(content)}`),
      title,
      body: content,
      fileType: "knowledge",
      status: "active",
      metadata: {
        memoryRecord: true,
        memoryKind: params.kind === "episodic" ? "episodic" : "semantic",
        memoryScope: scope,
        scopeId,
        sourceType: "run",
        sourceId: context.runId,
        reason: typeof params.reason === "string" && params.reason.trim() ? params.reason.trim() : "Proposed from a runtime result for user review.",
        confidence,
        authority: "learned",
        memoryStatus: "proposed",
        pinned: false,
        proposedByNode: context.nodeId,
        potentialConflictIds: conflicts.map((file) => file.id),
        supersedesId: typeof params.supersedesId === "string" ? params.supersedesId : null
      }
    });
    await audit(org.sql, org.orgId, {
      actorId: org.userId,
      action: "agent_propose_memory",
      entityType: "file",
      entityId: row.id,
      after: { title: row.title, scope, scopeId, runId: context.runId, conflictIds: conflicts.map((file) => file.id) }
    });
    return { id: row.id, title: row.title, status: "proposed", duplicateOf: null, conflictIds: conflicts.map((file) => file.id) };
  };

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
      workspaceInstructions,
      memories,
      connections: connectionsById,
      provider: model?.provider ?? null,
      model: model?.model ?? null,
      goal: body.goal,
      budget: body.budget,
      previousCompaction: body.previousCompaction ?? null,
      harnessFileAction,
      memoryProposalAction
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
  rows: Awaited<ReturnType<typeof listModelsWithEnvironmentDefaults>>,
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
      provider: "openai-compatible",
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
  isPlainChat: boolean
): string {
  const orchestrator = files.find(
    (f) => f.file_type === "prompt" && f.metadata?.systemRole === "orchestrator" && f.status === "active"
  );
  const base = [
    "You are the SpielOS assistant. Converse naturally and answer the user's question directly. You can explain the product and its workspace.",
    "Never claim that you searched, executed a tool, ran a workflow, or read a file unless the runtime actually supplied that context or execution.",
    orchestrator?.body ? `Workspace-authored assistant instructions:\n${orchestrator.body}` : ""
  ];
  if (isPlainChat) {
    base.push("No harness tools, role, skill, eval, workflow, or attached file is selected for this turn. Answer from the system prompt and the conversation alone.");
  }
  return base.filter(Boolean).join("\n\n");
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

function retrieveMemories(
  files: FileRow[],
  prompt: string,
  targetType: RunType,
  targetId: string | null,
  userId: string | null
): FileRow[] {
  const terms = new Set(prompt.toLowerCase().split(/[^a-z0-9]+/).filter((term) => term.length > 2));
  return files
    .filter((file) => {
      const metadata = file.metadata ?? {};
      if (file.status !== "active" || metadata.memoryRecord !== true || metadata.memoryStatus !== "approved") return false;
      const scope = String(metadata.memoryScope ?? "workspace");
      if (scope === "workspace") return true;
      if (scope === "user") return Boolean(userId) && metadata.scopeId === userId;
      if (scope === "role") return targetType === "role" && metadata.scopeId === targetId;
      if (scope === "workflow") return targetType === "workflow" && metadata.scopeId === targetId;
      return false;
    })
    .map((file) => {
      const haystack = `${file.title}\n${file.body}`.toLowerCase();
      const relevance = [...terms].reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
      const pinned = file.metadata?.pinned === true ? 1000 : 0;
      return { file, score: pinned + relevance };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)
    .map((entry) => entry.file);
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
