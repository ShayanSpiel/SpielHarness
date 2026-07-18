import {
  DEFAULT_EXECUTION_MODE,
  directorRuntimePolicySchema,
  executionModeSchema,
  parseEvalFile,
  parseRoleFile,
  parseSkillFile,
  parseWorkflowFile,
  type ExecutionMode,
  type DirectorRuntimePolicy,
  type Model,
  type ModelCapabilities,
  type ModelProvider,
  type EvalFile,
  type Role,
  type RunBudget,
  type RunGoal,
  type RunType,
  type Skill,
  type SuggestedHarnessRef,
  type WorkflowFile,
  type WorkflowNode
} from "@spielos/core";
import type { OrgContext } from "./server";
import { HttpError } from "./server";
import {
  audit,
  createFile,
  getFile,
  listConnections,
  listHarnessFiles,
  updateFileIfVersion
} from "@spielos/db";
import type { Connection, FileRecord } from "@spielos/core";
import type { RunRequest, AttachedFile } from "@spielos/graph";
import type { ConversationCompaction } from "@spielos/providers";
import type { FileRow } from "@spielos/db";
import { createHash } from "node:crypto";
import { listModelsWithEnvironmentDefaults } from "./default-models";

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
  chatContextItems?: Array<{ id: string; kind: string; title: string }>;
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
  projectId?: string;
  goal?: RunGoal;
  budget?: Partial<Pick<RunBudget, "maxInputTokens" | "maxOutputTokens" | "maxDurationMs" | "maxToolCalls">>;
  previousCompaction?: ConversationCompaction | null;
  // Execution mode: the only top-level switch. Server resolves from
  // this hint, the chat's persisted `metadata.executionMode`, and
  // workspace configuration. The client may suggest but never
  // authors the run topology. Defaults to DEFAULT_EXECUTION_MODE.
  executionMode?: ExecutionMode;
  // Director mode suggestion chips. The client attaches roles,
  // workflows, skills, or evals as suggestions; the server still
  // resolves the live file-backed capability snapshot and never
  // trusts client-supplied ids to drive execution topology.
  suggestedHarnessRefs?: SuggestedHarnessRef[];
};

// ── Resolved execution ────────────────────────────────────────
export type ResolvedExecution = {
  runRequest: RunRequest;
  type: RunType;
  target: { type: RunType; id: string | null };
  contextFileIds: string[];
  directorPrompt: string;
  assistantPrompt: string;
  executionMode: ExecutionMode;
  suggestedHarnessRefs: SuggestedHarnessRef[];
  evals: Record<string, EvalFile>;
  workflows: Record<string, WorkflowFile>;
  directorSearchFiles: AttachedFile[];
  directorRuntimePolicy: DirectorRuntimePolicy | null;
};

function restrictBudgetToPolicy(
  requested: ExecuteBody["budget"],
  policy: DirectorRuntimePolicy
): ExecuteBody["budget"] {
  const capped = (value: number | undefined, maximum: number) =>
    typeof value === "number" ? Math.min(value, maximum) : maximum;
  return {
    maxInputTokens: capped(requested?.maxInputTokens ?? undefined, policy.maxInputTokens),
    maxOutputTokens: capped(requested?.maxOutputTokens ?? undefined, policy.maxOutputTokens),
    maxDurationMs: capped(requested?.maxDurationMs ?? undefined, policy.maxDurationMs),
    maxToolCalls: capped(requested?.maxToolCalls ?? undefined, policy.maxToolCalls)
  };
}

// ── Main resolver ─────────────────────────────────────────────
export async function resolveExecution(
  org: OrgContext,
  body: ExecuteBody
): Promise<ResolvedExecution> {
  if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

  // Resolve the explicit request mode against the shared schema. The client
  // persists the chat preference; the core default applies when it is absent.
  const requestedMode = body.executionMode;
  if (requestedMode !== undefined) {
    const parsed = executionModeSchema.safeParse(requestedMode);
    if (!parsed.success) {
      throw new HttpError(400, `Unsupported executionMode: ${String(requestedMode)}`);
    }
  }
  const executionMode: ExecutionMode = requestedMode ?? DEFAULT_EXECUTION_MODE;
  const suggestedHarnessRefs = normalizeSuggestedHarnessRefs(body.suggestedHarnessRefs);

  const targetType: RunType = body.type ?? "chat";
  const contextFileIds = dedupe(body.contextFileIds ?? []);
  const isChat = targetType === "chat";
  // Plain chat is a first-class assistant path, now mediated by the
  // file-backed Orchestrator role. The role receives only its declared safe
  // capabilities; it does not grant arbitrary integration access.
  const toRecord = (f: FileRow) => fileRowToRecord(f);

  // Resolve the active harness for every chat turn so the default orchestrator
  // remains file-backed and capability-gated like selected workflows.
  let connections: Awaited<ReturnType<typeof listConnections>> = [];
  const [files, modelRows] = await Promise.all([
    listHarnessFiles(org.sql, org.orgId),
    listModelsWithEnvironmentDefaults(org.sql, org.orgId)
  ]);
  if (!isChat || executionMode === "director") {
    connections = await listConnections(org.sql, org.orgId);
  }

  let roles: Record<string, Role> = {};
  let skills: Record<string, Skill> = {};
  let evals: Record<string, EvalFile> = {};
  let workflows: Record<string, WorkflowFile> = {};
  const roleBySlug = new Map<string, string>();
  const skillBySlug = new Map<string, string>();
  const fileReferenceIds = new Map<string, string>();

  {
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

  const directorWorkflows: Record<string, WorkflowFile> = {};
  if (executionMode === "director") {
    for (const candidate of Object.values(workflows)) {
      if (candidate.status !== "active") continue;
      try {
        directorWorkflows[candidate.id] = normalizeWorkflow(
          candidate,
          roles,
          skills,
          roleBySlug,
          skillBySlug,
          fileReferenceIds
        );
      } catch (error) {
        // A malformed unrelated workflow must not take down plain Director
        // chat. Explicit Direct workflow execution still validates and returns
        // the configuration error through the target branch below.
        console.warn(`[execution-service] excluding invalid Director workflow "${candidate.name}":`, error);
      }
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
    workflow = directorWorkflows[wf.id]
      ?? normalizeWorkflow(wf, roles, skills, roleBySlug, skillBySlug, fileReferenceIds);
    targetId = wf.id;
  } else if (targetType === "role") {
    if (!body.targetId) throw new HttpError(400, "targetId is required for role runs.");
    const role = roles[body.targetId] ?? roles[roleBySlug.get(body.targetId) ?? ""];
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
    const chatRole = resolveDirectExecutorRole(roles, skill.id);
    if (!chatRole) throw new HttpError(400, `Skill "${skill.name}" has no active file-backed execution role.`);
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
    const evalRole = resolveDirectExecutorRole(roles, evalSkill.id);
    if (!evalRole) throw new HttpError(400, `Evaluation "${evalFile.name}" has no active file-backed execution role.`);
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
    // Plain chat is routed by executionMode in the execute route.
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
  const orchestratorRole = Object.values(roles).find(
    (role) => role.status === "active" && role.metadata?.systemRole === "orchestrator"
  );
  const orchestratorContextSlugs = new Set(
    Array.isArray(orchestratorRole?.metadata?.contextSlugs)
      ? orchestratorRole.metadata.contextSlugs.filter((value): value is string => typeof value === "string")
      : []
  );
  const assistantPromptFile = files.find(
    (file) => file.status === "active" &&
      file.file_type === "prompt" &&
      file.metadata?.systemRole === "orchestrator"
  );
  const workspaceInstructions: AttachedFile[] = files
    .filter((file) => {
      if (file.status !== "active" || file.id === assistantPromptFile?.id) return false;
      const slug = typeof file.metadata?.slug === "string" ? file.metadata.slug : "";
      return file.metadata?.workspaceConfig === true || orchestratorContextSlugs.has(slug);
    })
    .map(toAttached);
  const runtimePolicyFile = files.find((file) =>
    file.status === "active" && file.metadata?.runtimePolicy === true
  );
  let directorRuntimePolicy: DirectorRuntimePolicy | null = null;
  if (executionMode === "director") {
    if (!runtimePolicyFile) {
      throw new HttpError(409, "Director requires an active file-backed runtime policy.");
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(runtimePolicyFile.body);
    } catch {
      throw new HttpError(409, `Director runtime policy "${runtimePolicyFile.title}" is not valid JSON.`);
    }
    const parsedPolicy = directorRuntimePolicySchema.safeParse(parsedBody);
    if (!parsedPolicy.success) {
      throw new HttpError(409, `Director runtime policy "${runtimePolicyFile.title}" is invalid: ${parsedPolicy.error.issues[0]?.message ?? "unknown error"}`);
    }
    directorRuntimePolicy = parsedPolicy.data;
  }
  const memories: AttachedFile[] = retrieveMemories(files, body.prompt, targetType, targetId, org.userId).map(toAttached);
  const directorSearchFiles: AttachedFile[] = executionMode === "director"
    ? files.filter((file) => file.status !== "deleted").map(toAttached)
    : [];

  // Resolve model — prefer explicit user choice, then the orchestrator
  // role's modelId (so the Director has its own model), then fallback.
  const orchestratorModelId = Object.values(roles).find(
    (r) => r.metadata?.systemRole === "orchestrator"
  )?.modelId ?? null;
  const preferredModelId = body.modelId ?? orchestratorModelId ?? (workflow
    ? Object.values(roles).find((r) => workflow!.nodes.some((n) => n.roleId === r.id))?.modelId ?? null
    : singleNode?.role?.modelId ?? null);
  let model = resolveModel(modelRows, preferredModelId);
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
  if (!isChat || executionMode === "director") {
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
  // Existing workspaces can keep using the legacy direct-chat path until they
  // sync the new file-backed role. Once present, the Orchestrator owns the
  // turn and this fallback instruction is intentionally omitted.
  const directorPrompt = resolveDirectorPrompt(files, roles);
  const assistantPrompt = assistantPromptFile?.body ?? "";
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
      budget: directorRuntimePolicy ? restrictBudgetToPolicy(body.budget, directorRuntimePolicy) : body.budget,
      previousCompaction: body.previousCompaction ?? null,
      harnessFileAction,
      memoryProposalAction,
      // The execution mode is carried on the request so the runtime
      // can branch on it without re-reading the request body. The
      // director branch reads it in Phase 2; the direct branch is a
      // no-op and ignores it.
      executionMode,
      suggestedHarnessRefs
    },
    type: targetType,
    target: { type: targetType, id: targetId },
    contextFileIds,
    directorPrompt,
    assistantPrompt,
    executionMode,
    suggestedHarnessRefs,
    evals,
    workflows: directorWorkflows,
    directorSearchFiles,
    directorRuntimePolicy
  };
}

// ── Model resolution ──────────────────────────────────────────
type ResolvedModel = { provider: ModelProvider; model: Model } | null;

function resolveModel(
  rows: Awaited<ReturnType<typeof listModelsWithEnvironmentDefaults>>,
  preferredModelId: string | null
): ResolvedModel {
  const enabled = rows.filter((row) => row.enabled);
  const row = (preferredModelId ? enabled.find((candidate) => candidate.id === preferredModelId) : null) ?? enabled[0];
  if (!row) return null;
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
  roles: Record<string, Role>
): string {
  const role = Object.values(roles).find(
    (candidate) => candidate.status === "active" && candidate.metadata?.systemRole === "orchestrator"
  );
  if (role) {
    return [
      role.prompt,
      role.inputContract?.body ? `# Input contract (${role.inputContract.name})\n\n${role.inputContract.body}` : "",
      role.outputContract?.body ? `# Output contract (${role.outputContract.name})\n\n${role.outputContract.body}` : ""
    ].filter(Boolean).join("\n\n");
  }
  const prompt = files.find(
    (f) => f.file_type === "prompt" && f.metadata?.systemRole === "orchestrator" && f.status === "active"
  );
  return prompt?.body ?? "";
}

// ── Workflow normalization: resolve role/skill slugs, attach files ─
function normalizeWorkflow(
  wf: WorkflowFile,
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  roleBySlug: Map<string, string>,
  skillBySlug: Map<string, string>,
  fileReferenceIds: Map<string, string>
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
    let role: Role | null = roles[roleId] ?? null;
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
      role = resolveDirectExecutorRole(roles, effectiveSkillIds[0]);
      if (!role) throw new HttpError(400, `Workflow node "${node.title}" has no active file-backed execution role.`);
      roleId = role.id;
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
  for (const item of items) out[key(item)] = out[key(item)] ?? item;
  return out;
}

function normalizeSuggestedHarnessRefs(input: SuggestedHarnessRef[] | undefined): SuggestedHarnessRef[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: SuggestedHarnessRef[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const type = raw.type;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) continue;
    if (type !== "role" && type !== "skill" && type !== "workflow" && type !== "eval") continue;
    const dedupeKey = `${type}:${id}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      type,
      id,
      slug: typeof raw.slug === "string" ? raw.slug : undefined,
      title: typeof raw.title === "string" ? raw.title : undefined
    });
  }
  return out;
}

function resolveDirectExecutorRole(roles: Record<string, Role>, skillId: string): Role | null {
  const active = Object.values(roles).filter((role) => role.status === "active");
  return active.find((role) => role.skillIds.includes(skillId))
    ?? active.find((role) => role.metadata?.systemRole === "orchestrator")
    ?? null;
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
