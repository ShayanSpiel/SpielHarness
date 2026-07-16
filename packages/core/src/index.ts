import { z } from "zod";

// ── File types (DB enum) ────────────────────────────────────────
export const fileTypeSchema = z.enum([
  "knowledge",
  "strategy",
  "prompt",
  "artifact",
  "draft",
  "evidence",
  "asset",
  "eval_report",
  "publish_package",
  "harness_role",
  "harness_skill",
  "harness_workflow",
  "harness_workstream",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
]);
export type FileType = z.infer<typeof fileTypeSchema>;

export const fileStatusSchema = z.enum(["draft", "active", "archived", "deleted"]);
export type FileStatus = z.infer<typeof fileStatusSchema>;

// ── Skill kinds ────────────────────────────────────────────────
export const skillKindSchema = z.enum([
  "llm_call",
  "human_input",
  "eval",
  "http",
  "mcp_call",
  "knowledge_search",
  "harness_file",
  "memory_write"
]);
export type SkillKind = z.infer<typeof skillKindSchema>;

// ── Human input question ───────────────────────────────────────
export const humanInputOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional()
});
export type HumanInputOption = z.infer<typeof humanInputOptionSchema>;

export const humanInputQuestionSchema = z.object({
  id: z.string(),
  kind: z.enum(["single", "multi", "text", "none"]),
  question: z.string(),
  options: z.array(humanInputOptionSchema).optional(),
  placeholder: z.string().optional(),
  allowCustom: z.boolean().default(true)
});
export type HumanInputQuestion = z.infer<typeof humanInputQuestionSchema>;

export const humanInputRequestSchema = z.object({
  id: z.string(),
  nodeId: z.string(),
  skillId: z.string(),
  questions: z.array(humanInputQuestionSchema),
  header: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string()
});
export type HumanInputRequest = z.infer<typeof humanInputRequestSchema>;

// ── Eval rubric (the file-backed canonical schema) ─────────────
export const evalRuleSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["contains", "missing", "min_words", "max_words", "regex", "llm_judge"]),
  value: z.string(),
  weight: z.number().default(10)
});
export type EvalRule = z.infer<typeof evalRuleSchema>;

// ── Skill binding to a connection operation ────────────────────
export const skillBindingSchema = z.object({
  connectionId: z.string(),
  operation: z.string(),
  enabled: z.boolean().default(true),
  confirmation: z.enum(["never", "on_write", "always"]).default("on_write")
});
export type SkillBinding = z.infer<typeof skillBindingSchema>;

// ── Skill ──────────────────────────────────────────────────────
export const skillSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(""),
  kind: skillKindSchema,
  status: fileStatusSchema.default("active"),
  auth: z.enum(["none", "api_key", "oauth"]).default("none"),
  sideEffect: z.enum(["none", "read", "write", "external"]).default("none"),
  inputSchema: z.string().default("{}"),
  outputSchema: z.string().default("{}"),
  implementation: z.string().default(""),
  bindings: z.array(skillBindingSchema).default([]),
  humanQuestions: z.array(humanInputQuestionSchema).optional(),
  evalRules: z.array(evalRuleSchema).optional(),
  overallThreshold: z.number().optional(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Skill = z.infer<typeof skillSchema>;

// ── Role contract (single contract per direction, role-owned) ──
export const contractFormatSchema = z.enum(["markdown", "json"]);
export type ContractFormat = z.infer<typeof contractFormatSchema>;

export const roleContractSchema = z.object({
  name: z.string().min(1),
  format: contractFormatSchema.default("markdown"),
  body: z.string().default(""),
  required: z.boolean().default(true),
  multiple: z.boolean().default(false)
});
export type RoleContract = z.infer<typeof roleContractSchema>;

// ── Role ───────────────────────────────────────────────────────
export const roleSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  prompt: z.string().min(1),
  modelId: z.string().nullable().default(null),
  inputContract: roleContractSchema,
  outputContract: roleContractSchema,
  skillIds: z.array(z.string()).default([]),
  status: fileStatusSchema.default("active"),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Role = z.infer<typeof roleSchema>;

// ── Workflow node (canonical shape used in runtime) ────────────
export const loopConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxAttempts: z.number().default(3),
  breakCondition: z.enum(["on_pass", "on_fail"]).default("on_pass"),
  evalId: z.string().nullable().default(null)
});
export type LoopConfig = z.infer<typeof loopConfigSchema>;

export const evalInputSourceSchema = z.object({
  type: z.enum(["previous_output", "workflow_input", "node_output"]),
  nodeId: z.string().optional()
});
export type EvalInputSource = z.infer<typeof evalInputSourceSchema>;

export const workflowNodeSchema = z.object({
  id: z.string(),
  title: z.string(),
  roleId: z.string(),
  promptOverride: z.string().optional(),
  humanQuestions: z.array(humanInputQuestionSchema).optional(),
  skillIds: z.array(z.string()).default([]),
  fileIds: z.array(z.string()).default([]),
  toolCallLimits: z.record(z.number().int().positive()).optional(),
  requiredToolCalls: z.array(z.string()).optional(),
  inputContract: z.string().default("any"),
  outputContract: z.string().default("any"),
  position: z.object({ x: z.number().default(0), y: z.number().default(0) }).default({ x: 0, y: 0 }),
  loopConfig: loopConfigSchema.optional(),
  evalInput: evalInputSourceSchema.optional()
});
export type WorkflowNode = z.infer<typeof workflowNodeSchema>;

export const workflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string()
});
export type WorkflowEdge = z.infer<typeof workflowEdgeSchema>;

// ── Eval file (rubric definition, also runnable as workflow gate) ─
export const loopConfigWithDelaySchema = loopConfigSchema.extend({
  retryDelayMs: z.number().default(0)
});
export type LoopConfigWithDelay = z.infer<typeof loopConfigWithDelaySchema>;

export const evalFileSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  rules: z.array(evalRuleSchema).default([]),
  overallThreshold: z.number().default(75),
  loopConfig: loopConfigWithDelaySchema.default({
    enabled: false,
    maxAttempts: 3,
    breakCondition: "on_pass",
    retryDelayMs: 0
  }),
  status: fileStatusSchema.default("active"),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type EvalFile = z.infer<typeof evalFileSchema>;

// ── Workflow file (the saved DAG) ──────────────────────────────
export const workflowFileSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  nodes: z.array(workflowNodeSchema).default([]),
  edges: z.array(workflowEdgeSchema).default([]),
  status: fileStatusSchema.default("active"),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type WorkflowFile = z.infer<typeof workflowFileSchema>;

// ── Run primitives ─────────────────────────────────────────────
export const runTypeSchema = z.enum([
  "chat",
  "role",
  "skill",
  "eval",
  "workflow"
]);
export type RunType = z.infer<typeof runTypeSchema>;

export const runStatusSchema = z.enum([
  "running",
  "waiting_human",
  "completed",
  "failed",
  "cancelled"
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const eventTypeSchema = z.enum([
  "run_started",
  "run_completed",
  "run_failed",
  "run_cancelled",
  "node_started",
  "node_completed",
  "node_failed",
  "node_skipped",
  "node_retrying",
  "skill_started",
  "skill_completed",
  "human_input_requested",
  "human_input_received",
  "tool_call_started",
  "tool_call_result",
  "artifact_created",
  "eval_score_updated",
  "text_delta",
  "status"
]);
export type EventType = z.infer<typeof eventTypeSchema>;

export const runEventSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  runId: z.string(),
  type: eventTypeSchema,
  sequence: z.number(),
  nodeId: z.string().optional(),
  nodeTitle: z.string().optional(),
  skillId: z.string().optional(),
  skillName: z.string().optional(),
  message: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type RunEvent = z.infer<typeof runEventSchema>;

// ── Artifacts ──────────────────────────────────────────────────
export const artifactTypeSchema = z.enum([
  "draft",
  "asset",
  "evidence",
  "eval_report",
  "publish_package",
  "artifact"
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const artifactSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  runId: z.string().optional(),
  type: artifactTypeSchema,
  title: z.string(),
  body: z.string(),
  metadata: z.record(z.unknown()).default({})
});
export type Artifact = z.infer<typeof artifactSchema>;

// ── Models (LLM provider configurations) ───────────────────────
export const modelProviderSchema = z.enum([
  "openai-compatible",
  "anthropic",
  "custom"
]);
export type ModelProviderName = z.infer<typeof modelProviderSchema>;

export const modelProviderObjectSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  provider: modelProviderSchema,
  model: z.string(),
  baseUrl: z.string().nullable().default(null),
  secretEnvKey: z.string().nullable().default(null),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true)
});
export type ModelProvider = z.infer<typeof modelProviderObjectSchema>;

export const modelCapabilitiesSchema = z.object({
  contextWindow: z.number().int().positive().default(32768),
  maxOutputTokens: z.number().int().positive().default(4096),
  compactionThreshold: z.number().min(0.5).max(0.95).default(0.8),
  tokenCounter: z.enum(["provider", "tiktoken", "estimate"]).default("provider"),
  toolCalling: z.boolean().default(false),
  parallelToolCalling: z.boolean().default(false),
  reasoningSummaries: z.boolean().default(false),
  providerCompaction: z.boolean().default(false),
  reasoningEffort: z.enum(["auto", "low", "medium", "high", "xhigh", "max"]).default("auto"),
  outputTokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens")
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;

export const DEFAULT_MODEL_CAPABILITIES: ModelCapabilities = modelCapabilitiesSchema.parse({});

export function capabilitiesForModel(model: ModelProvider): ModelCapabilities {
  const configured = model.config?.capabilities;
  const parsed = modelCapabilitiesSchema.safeParse(configured);
  return parsed.success ? parsed.data : DEFAULT_MODEL_CAPABILITIES;
}

export const modelSchema = modelProviderObjectSchema;
export type Model = z.infer<typeof modelSchema>;

// ── Connections (external integrations) ────────────────────────
export const connectionKindSchema = z.enum(["oauth", "mcp", "api", "builtin"]);
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

export const connectionStatusSchema = z.enum(["configured", "needs_secret", "disabled"]);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const connectionOperationSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  effect: z.enum(["read", "write", "send", "destructive"]).default("read"),
  method: z.string().optional(),
  path: z.string().optional(),
  inputParam: z.string().optional()
});
export type ConnectionOperation = z.infer<typeof connectionOperationSchema>;

export const connectionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  kind: connectionKindSchema,
  status: connectionStatusSchema,
  baseUrl: z.string().nullable().default(null),
  secretEnvKey: z.string().nullable().default(null),
  config: z.record(z.unknown()).default({}),
  operations: z.array(connectionOperationSchema).default([]),
  enabled: z.boolean().default(true)
});
export type Connection = z.infer<typeof connectionSchema>;

// ── Chats ──────────────────────────────────────────────────────
export const chatRoleSchema = z.enum(["user", "assistant", "system", "tool"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  title: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type Chat = z.infer<typeof chatSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  chatId: z.string(),
  role: chatRoleSchema,
  body: z.string(),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type ChatMessage = z.infer<typeof chatMessageSchema>;

// ── Durable execution state ───────────────────────────────────
export const runGoalSchema = z.object({
  objective: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([])
});
export type RunGoal = z.infer<typeof runGoalSchema>;

export const runBudgetSchema = z.object({
  maxInputTokens: z.number().int().positive().nullable().default(null),
  maxOutputTokens: z.number().int().positive().nullable().default(null),
  maxDurationMs: z.number().int().positive().nullable().default(null),
  maxToolCalls: z.number().int().positive().nullable().default(null),
  inputTokens: z.number().int().nonnegative().default(0),
  outputTokens: z.number().int().nonnegative().default(0),
  toolCalls: z.number().int().nonnegative().default(0),
  startedAt: z.string(),
  deadlineAt: z.string().nullable().default(null)
});
export type RunBudget = z.infer<typeof runBudgetSchema>;

export const runProgressSchema = z.object({
  milestone: z.string().nullable().default(null),
  completedActions: z.array(z.string()).default([]),
  nextActions: z.array(z.string()).default([]),
  unresolvedIssues: z.array(z.string()).default([])
});
export type RunProgress = z.infer<typeof runProgressSchema>;

export const runVerificationSchema = z.object({
  required: z.boolean().default(true),
  status: z.enum(["pending", "passed", "failed", "skipped"]).default("pending"),
  evidence: z.array(z.string()).default([]),
  checkedAt: z.string().nullable().default(null)
});
export type RunVerification = z.infer<typeof runVerificationSchema>;

// ── Controlled, file-backed learned memory ───────────────────
export const memoryKindSchema = z.enum(["semantic", "episodic"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

export const memoryScopeSchema = z.enum(["workspace", "user", "role", "workflow"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

export const memoryRecordSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  body: z.string().min(1),
  kind: memoryKindSchema,
  scope: memoryScopeSchema,
  scopeId: z.string().nullable().default(null),
  provenance: z.object({
    sourceType: z.enum(["user", "run", "file", "system"]),
    sourceId: z.string().nullable().default(null),
    reason: z.string().min(1)
  }),
  confidence: z.number().min(0).max(1).default(1),
  authority: z.enum(["learned", "user_confirmed", "workspace_config"]).default("learned"),
  status: z.enum(["proposed", "approved", "superseded", "forgotten"]).default("proposed"),
  pinned: z.boolean().default(false),
  supersedesId: z.string().nullable().default(null),
  conflictIds: z.array(z.string()).default([]),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

// ── File record (DB row, camelCase) ────────────────────────────
export const fileRecordSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  folderId: z.string().nullable(),
  fileType: fileTypeSchema,
  status: fileStatusSchema,
  title: z.string(),
  body: z.string(),
  contentFormat: z.string(),
  metadata: z.record(z.unknown()),
  currentVersion: z.number(),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type FileRecord = z.infer<typeof fileRecordSchema>;

// ── SSE frame shapes (the streaming protocol) ─────────────────
export const sseFrameSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("run"), runId: z.string(), type: z.string() }),
  z.object({ kind: z.literal("event"), event: runEventSchema }),
  z.object({ kind: z.literal("artifact"), artifact: artifactSchema }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("status"), message: z.string() }),
  z.object({ kind: z.literal("human_input"), request: humanInputRequestSchema }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("done"), runId: z.string(), status: runStatusSchema })
]);
export type SseFrame = z.infer<typeof sseFrameSchema>;

// ── Parse a file row into a typed object based on file_type ────
export function parseRoleFile(row: FileRecord): Role {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? ""),
    prompt: row.body,
    modelId: (m.modelId as string | null) ?? null,
    inputContract: m.inputContract as Role["inputContract"] ?? defaultInputContract(),
    outputContract: m.outputContract as Role["outputContract"] ?? defaultOutputContract(),
    skillIds: (m.skillIds as string[]) ?? (m.skillSlugs as string[]) ?? [],
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

export function parseSkillFile(row: FileRecord): Skill {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    slug: String(m.slug ?? row.id),
    description: String(m.description ?? ""),
    kind: (m.kind as Skill["kind"]) ?? "llm_call",
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    auth: (m.auth as Skill["auth"]) ?? "none",
    sideEffect: (m.sideEffect as Skill["sideEffect"]) ?? "none",
    inputSchema: typeof m.inputSchema === "string" ? m.inputSchema : JSON.stringify(m.inputSchema ?? {}),
    outputSchema: typeof m.outputSchema === "string" ? m.outputSchema : JSON.stringify(m.outputSchema ?? {}),
    implementation: String(m.implementation ?? row.body),
    bindings: (m.bindings as Skill["bindings"]) ?? [],
    humanQuestions: (m.humanQuestions as Skill["humanQuestions"]) ?? undefined,
    evalRules: (m.evalRules as Skill["evalRules"]) ?? (m.evalRubrics as Skill["evalRules"]) ?? undefined,
    overallThreshold: (m.overallThreshold as number | undefined) ?? undefined,
    metadata: m
  };
}

export function parseEvalFile(row: FileRecord): EvalFile {
  const m = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? row.body ?? ""),
    rules: (m.rules as EvalFile["rules"]) ?? (m.evalRules as EvalFile["rules"]) ?? (m.rubrics as EvalFile["rules"]) ?? [],
    overallThreshold: Number(m.overallThreshold ?? 75),
    loopConfig: (m.loopConfig as EvalFile["loopConfig"]) ?? {
      enabled: false,
      maxAttempts: 3,
      breakCondition: "on_pass",
      retryDelayMs: 0
    },
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

export function parseWorkflowFile(row: FileRecord): WorkflowFile {
  const m = row.metadata ?? {};
  const rawNodes = (m.nodes as Array<Record<string, unknown>>) ?? [];
  const rawEdges = (m.edges as Array<Record<string, unknown>>) ?? [];
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.title.replace(/\.\w+$/, ""),
    description: row.body,
    nodes: rawNodes.map((n, i) => ({
      id: String(n.id ?? `node-${i + 1}`),
      title: String(n.title ?? `Step ${i + 1}`),
      roleId: String(n.roleId ?? n.roleSlug ?? ""),
      promptOverride: n.promptOverride || n.prompt ? String(n.promptOverride ?? n.prompt) : undefined,
      humanQuestions: n.humanQuestions as WorkflowNode["humanQuestions"],
      skillIds: (n.skillIds as string[]) ?? (n.skillSlugs as string[]) ?? [],
      fileIds: (n.fileIds as string[]) ?? (n.fileSlugs as string[]) ?? [],
      toolCallLimits: n.toolCallLimits as WorkflowNode["toolCallLimits"],
      requiredToolCalls: n.requiredToolCalls as WorkflowNode["requiredToolCalls"],
      inputContract: String(n.inputContract ?? n.input ?? "any"),
      outputContract: String(n.outputContract ?? n.output ?? "any"),
      position: (n.position as { x: number; y: number }) ?? {
        x: typeof n.x === "number" ? n.x : 120 + i * 260,
        y: typeof n.y === "number" ? n.y : 160
      },
      loopConfig: n.loopConfig as WorkflowNode["loopConfig"],
      evalInput: n.evalInput as WorkflowNode["evalInput"]
    })),
    edges: rawEdges.map((e, i) => ({
      id: String(e.id ?? `edge-${i + 1}`),
      source: String(e.source),
      target: String(e.target)
    })),
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: m
  };
}

export function defaultInputContract(): RoleContract {
  return {
    name: "Input",
    format: "markdown",
    body: "Describe the request, context, constraints, source material, and success criteria this role needs before it starts.",
    required: true,
    multiple: false
  };
}

export function defaultOutputContract(): RoleContract {
  return {
    name: "Output",
    format: "markdown",
    body: "Describe the exact deliverable this role must return, including structure, tone, required sections, and quality bar.",
    required: true,
    multiple: false
  };
}
