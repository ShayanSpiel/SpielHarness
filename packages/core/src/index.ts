import { z } from "zod";

// ── Execution mode (top-level switch for chat) ──────────────────
//
// `direct` keeps the existing deterministic single-node / workflow
// execution path unchanged. `director` is the file-backed role with
// `metadata.systemRole === "orchestrator"`, displayed in the UI as
// **Director**, compiled with `createDeepAgent()`. The Director
// runtime (planning loop, write_todos, subagent delegation, interrupts)
// is owned by Deep Agents. The mode is the only top-level switch —
// the harness does not maintain a second flag like `deepMode`.
//
// Mode is resolved server-side per turn from chat metadata, the
// request body, and workspace configuration. The client may
// suggest a mode but never authors the run topology.
export const executionModeSchema = z.enum(["director", "direct"]);
export type ExecutionMode = z.infer<typeof executionModeSchema>;

export const DEFAULT_EXECUTION_MODE: ExecutionMode = "director";

export interface SuggestedHarnessRef {
  type: "role" | "skill" | "workflow" | "eval";
  id: string;
  slug?: string;
  title?: string;
}

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
  "artifact_create",
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
  importance: z.number().default(10)
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
  "status",
  "compaction_started",
  "pinned_state_updated",
  "milestone_created",
  "context_overflow",
  "compaction_pass_escalated"
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

export const artifactFileSchema = z.object({
  path: z.string().min(1),
  mimeType: z.string().min(1),
  content: z.string().default(""),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
  role: z.enum(["entry", "style", "script", "asset", "document", "data", "other"]).default("other"),
  sourcePath: z.string().optional()
});
export type ArtifactFile = z.infer<typeof artifactFileSchema>;

export const artifactProjectSchema = z.object({
  kind: z.literal("project"),
  version: z.literal(1).default(1),
  name: z.string().min(1),
  root: z.string().default("/"),
  entrypoint: z.string().min(1),
  files: z.array(artifactFileSchema).min(1),
  integrations: z.array(z.object({
    id: z.string().min(1),
    purpose: z.string().min(1),
    status: z.enum(["configured", "requires_connection", "placeholder"]).default("placeholder"),
    receipt: z.record(z.unknown()).optional()
  })).default([]),
  metadata: z.record(z.unknown()).default({})
});
export type ArtifactProject = z.infer<typeof artifactProjectSchema>;

export function parseArtifactProject(body: string): ArtifactProject | null {
  const trimmed = body.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? trimmed;
  try {
    const parsed = artifactProjectSchema.safeParse(JSON.parse(fenced));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

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
  "mistral",
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
  outputTokenParameter: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  toolCallMetadata: z.enum(["normalized", "provider_raw"]).default("normalized")
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
  archivedAt: z.string().nullable().default(null),
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

export function chatRowToChat(row: {
  id: string; org_id: string; title: string;
  metadata: Record<string, unknown>;
  created_at: string; updated_at: string; archived_at: string | null;
}): Chat {
  return {
    id: row.id, orgId: row.org_id, title: row.title,
    metadata: row.metadata ?? {},
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export function messageRowToChatMessage(row: {
  id: string; org_id: string; chat_id: string;
  role: string; body: string; metadata: Record<string, unknown>;
  created_at: string;
}): ChatMessage {
  return {
    id: row.id, orgId: row.org_id, chatId: row.chat_id,
    role: row.role as "user" | "assistant" | "system" | "tool",
    body: row.body, metadata: row.metadata ?? {},
    createdAt: row.created_at
  };
}

export function upsertMessage<T extends { id: string }>(
  msgs: T[],
  msg: T
): T[] {
  const idx = msgs.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const copy = [...msgs];
    copy[idx] = msg;
    return copy;
  }
  return [...msgs, msg];
}

export function mergeMessages<T extends { id: string; createdAt: string }>(
  existing: T[],
  incoming: T[]
): T[] {
  const existingIds = new Set(existing.map((m) => m.id));
  const merged = [
    ...existing,
    ...incoming.filter((m) => !existingIds.has(m.id))
  ];
  merged.sort((a, b) => {
    const c = a.createdAt.localeCompare(b.createdAt);
    return c !== 0 ? c : a.id.localeCompare(b.id);
  });
  return merged;
}

export function reconcileChats<T extends { id: string; archivedAt: string | null }>(
  current: T[],
  incoming: T[],
  mutatedIds: Set<string>
): T[] {
  const incomingMap = new Map(incoming.map((c) => [c.id, c]));
  const seen = new Set<string>();
  const result: T[] = [];

  for (const c of current) {
    seen.add(c.id);
    if (mutatedIds.has(c.id)) {
      result.push(c);
    } else if (incomingMap.has(c.id)) {
      const inc = incomingMap.get(c.id)!;
      if (!inc.archivedAt) {
        result.push(inc);
      }
    }
  }

  for (const c of incoming) {
    if (!seen.has(c.id) && !mutatedIds.has(c.id) && !c.archivedAt) {
      result.push(c);
      seen.add(c.id);
    }
  }

  return result;
}

// ── Project sessions and orchestration ─────────────────────────
//
// A project is durable mutable application state associated with a chat. The
// harness itself remains file-backed; this schema only owns project identity,
// revision lineage, and the bounded execution plan that references harness
// resources by id.

export const projectSessionStatusSchema = z.enum([
  "active",
  "awaiting_input",
  "review",
  "completed",
  "archived"
]);
export type ProjectSessionStatus = z.infer<typeof projectSessionStatusSchema>;

export const projectSessionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  chatId: z.string(),
  title: z.string().min(1),
  status: projectSessionStatusSchema.default("active"),
  workflowId: z.string().nullable().default(null),
  activeRevisionId: z.string().nullable().default(null),
  activeArtifactId: z.string().nullable().default(null),
  workingState: z.record(z.unknown()).default({}),
  summary: z.string().default(""),
  summaryVersion: z.number().int().nonnegative().default(0),
  version: z.number().int().nonnegative().default(0),
  createdAt: z.string(),
  updatedAt: z.string(),
  archivedAt: z.string().nullable().default(null)
});
export type ProjectSession = z.infer<typeof projectSessionSchema>;

export const projectRevisionSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string(),
  parentRevisionId: z.string().nullable().default(null),
  runId: z.string().nullable().default(null),
  turnId: z.string().nullable().default(null),
  sequence: z.number().int().positive(),
  instruction: z.string().default(""),
  changeSet: z.record(z.unknown()).default({}),
  artifactIds: z.array(z.string()).default([]),
  sourceHashes: z.record(z.string()).default({}),
  evaluation: z.record(z.unknown()).default({}),
  receipts: z.array(z.record(z.unknown())).default([]),
  author: z.enum(["user", "orchestrator", "role", "workflow", "system"]),
  createdAt: z.string()
});
export type ProjectRevision = z.infer<typeof projectRevisionSchema>;

export const executionKindSchema = z.enum([
  "orchestrator",
  "workflow",
  "tool",
  "delegation",
  "revision"
]);
export type ExecutionKind = z.infer<typeof executionKindSchema>;

export const chatTurnKindSchema = z.enum([
  "user_request",
  "assistant_reply",
  "execution_anchor",
  "human_gate",
  "system_notice"
]);
export type ChatTurnKind = z.infer<typeof chatTurnKindSchema>;

export const chatTurnEnvelopeSchema = z.object({
  turnId: z.string(),
  kind: chatTurnKindSchema,
  projectId: z.string().optional(),
  runId: z.string().optional(),
  parentRunId: z.string().optional(),
  revisionId: z.string().optional()
});
export type ChatTurnEnvelope = z.infer<typeof chatTurnEnvelopeSchema>;

export const orchestrationIntentSchema = z.enum([
  "answer",
  "tool",
  "delegate",
  "workflow",
  "revise_project",
  "author_harness"
]);
export type OrchestrationIntent = z.infer<typeof orchestrationIntentSchema>;

export const orchestrationStepSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["answer", "tool", "role", "workflow", "eval", "human_gate"]),
  targetId: z.string().optional(),
  input: z.record(z.unknown()).default({}),
  dependsOn: z.array(z.string()).default([]),
  writeScope: z.enum(["none", "internal", "external"]),
  confirmation: z.enum(["none", "required"])
});
export type OrchestrationStep = z.infer<typeof orchestrationStepSchema>;

export const orchestrationPlanSchema = z.object({
  intent: orchestrationIntentSchema,
  project: z.enum(["none", "create", "continue", "new"]),
  rationale: z.string(),
  steps: z.array(orchestrationStepSchema).min(1),
  expectedArtifacts: z.array(z.object({ kind: z.string(), name: z.string() })).default([])
});
export type OrchestrationPlan = z.infer<typeof orchestrationPlanSchema>;

// ── Long-horizon chat state (Phase 2) ──────────────────────────
//
// Pinned working state and milestone history are kept in `chat.metadata`.
// The schema below is the canonical shape. Models propose typed
// operations; deterministic reducer code applies them. State items are
// attributable so a cheap model cannot supersede a user-authored item.

export const stateItemAuthoritySchema = z.enum(["user", "workflow", "system", "model"]);
export type StateItemAuthority = z.infer<typeof stateItemAuthoritySchema>;

export const stateItemStatusSchema = z.enum(["active", "completed", "rejected", "superseded"]);
export type StateItemStatus = z.infer<typeof stateItemStatusSchema>;

export const stateItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  authority: stateItemAuthoritySchema,
  status: stateItemStatusSchema,
  sourceMessageId: z.string().nullable(),
  supersedes: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});
export type StateItem = z.infer<typeof stateItemSchema>;

export const chatPinnedReferenceSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.enum(["chat", "file", "memory", "tool_result"]),
  ref: z.string()
});
export type ChatPinnedReference = z.infer<typeof chatPinnedReferenceSchema>;

export const chatPinnedStateSchema = z.object({
  version: z.number().int().nonnegative(),
  primaryGoal: stateItemSchema.nullable(),
  currentPhase: z.string().nullable(),
  decisions: z.array(stateItemSchema).default([]),
  constraints: z.array(stateItemSchema).default([]),
  openWork: z.array(stateItemSchema).default([]),
  successCriteria: z.array(stateItemSchema).default([]),
  importantReferences: z.array(chatPinnedReferenceSchema).default([]),
  updatedAt: z.string()
});
export type ChatPinnedState = z.infer<typeof chatPinnedStateSchema>;

export const milestoneSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  decisionsMade: z.array(z.string()).default([]),
  workCompleted: z.array(z.string()).default([]),
  unresolvedItems: z.array(z.string()).default([]),
  sourceMessageIds: z.array(z.string()).default([]),
  createdAt: z.string()
});
export type MilestoneSummary = z.infer<typeof milestoneSummarySchema>;

// Bounded operations a model may propose against pinned state. The
// reducer in `state-reducer.ts` validates and applies them.
export const stateOperationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("set_goal"), text: z.string(), sourceMessageId: z.string() }),
  z.object({ op: z.literal("add_decision"), text: z.string(), sourceMessageId: z.string() }),
  z.object({ op: z.literal("supersede_decision"), targetId: z.string(), text: z.string(), sourceMessageId: z.string() }),
  z.object({ op: z.literal("add_constraint"), text: z.string(), sourceMessageId: z.string() }),
  z.object({ op: z.literal("add_open_work"), text: z.string(), sourceMessageId: z.string() }),
  z.object({ op: z.literal("complete_work"), targetId: z.string(), sourceMessageId: z.string() })
]);
export type StateOperation = z.infer<typeof stateOperationSchema>;

export const compactionOperationSchema = z.object({
  stateOperations: z.array(stateOperationSchema).default([]),
  milestone: milestoneSummarySchema
});
export type CompactionOperation = z.infer<typeof compactionOperationSchema>;

// ── Reducer for typed state operations (Phase 2) ────────────────
//
// The model never replaces canonical state. It returns bounded
// `StateOperation` items; the deterministic reducer below validates
// each one against the current `ChatPinnedState` and applies it.
//
// Authority rules:
//   * A model may supersede a model-authored decision.
//   * A model may not supersede a user-authored or workflow-authored
//     decision. The reducer rejects those operations and counts them
//     as `rejected` so callers can surface a metric.
//   * Anyone may supersede a system-authored item (status updates).
//
// Optimistic concurrency: callers pass an `expectedVersion`. If the
// state's `version` does not match, the reducer throws
// `StateVersionMismatch` and the caller re-reads the state, replays
// the operations, and tries again.

export class StateVersionMismatch extends Error {
  readonly expected: number;
  readonly actual: number;
  constructor(expected: number, actual: number) {
    super(`State version mismatch (expected ${expected}, found ${actual}). Re-read and retry.`);
    this.name = "StateVersionMismatch";
    this.expected = expected;
    this.actual = actual;
  }
}

export class StateOperationRejected extends Error {
  readonly op: StateOperation;
  readonly reason: string;
  constructor(op: StateOperation, reason: string) {
    super(`State operation rejected: ${reason}`);
    this.name = "StateOperationRejected";
    this.op = op;
    this.reason = reason;
  }
}

function compareItems(left: StateItem, right: StateItem): boolean {
  return left.text.trim().toLowerCase() === right.text.trim().toLowerCase();
}

function mergeDedupe(existing: StateItem[], candidate: StateItem): StateItem[] {
  if (existing.some((item) => compareItems(item, candidate))) return existing;
  return [...existing, candidate];
}

function applySetGoal(state: ChatPinnedState, op: Extract<StateOperation, { op: "set_goal" }>, now: string): ChatPinnedState {
  if (state.primaryGoal && compareItems(state.primaryGoal, { id: "synthetic", text: op.text, authority: "model", status: "active", sourceMessageId: op.sourceMessageId, supersedes: null, createdAt: now, updatedAt: now })) {
    return state;
  }
  if (state.primaryGoal && state.primaryGoal.authority === "user") {
    return { ...state, primaryGoal: { ...state.primaryGoal, status: "superseded", updatedAt: now }, currentPhase: state.currentPhase };
  }
  return {
    ...state,
    primaryGoal: {
      id: crypto.randomUUID(),
      text: op.text,
      authority: "model",
      status: "active",
      sourceMessageId: op.sourceMessageId,
      supersedes: state.primaryGoal?.id ?? null,
      createdAt: now,
      updatedAt: now
    }
  };
}

function applyAddDecision(state: ChatPinnedState, op: Extract<StateOperation, { op: "add_decision" }>, now: string): ChatPinnedState {
  const candidate: StateItem = {
    id: crypto.randomUUID(),
    text: op.text,
    authority: "model",
    status: "active",
    sourceMessageId: op.sourceMessageId,
    supersedes: null,
    createdAt: now,
    updatedAt: now
  };
  return { ...state, decisions: mergeDedupe(state.decisions, candidate) };
}

function applySupersedeDecision(state: ChatPinnedState, op: Extract<StateOperation, { op: "supersede_decision" }>, now: string): ChatPinnedState {
  const target = state.decisions.find((decision) => decision.id === op.targetId);
  if (!target) throw new StateOperationRejected(op, "decision not found");
  if (target.authority === "user" || target.authority === "workflow") {
    throw new StateOperationRejected(op, `cannot supersede ${target.authority}-authored decision`);
  }
  const nextDecisions = state.decisions
    .map((decision) =>
      decision.id === op.targetId
        ? { ...decision, status: "superseded" as const, updatedAt: now }
        : decision
    )
    .concat([
      {
        id: crypto.randomUUID(),
        text: op.text,
        authority: "model",
        status: "active",
        sourceMessageId: op.sourceMessageId,
        supersedes: op.targetId,
        createdAt: now,
        updatedAt: now
      }
    ]);
  return { ...state, decisions: nextDecisions };
}

function applyAddConstraint(state: ChatPinnedState, op: Extract<StateOperation, { op: "add_constraint" }>, now: string): ChatPinnedState {
  const candidate: StateItem = {
    id: crypto.randomUUID(),
    text: op.text,
    authority: "model",
    status: "active",
    sourceMessageId: op.sourceMessageId,
    supersedes: null,
    createdAt: now,
    updatedAt: now
  };
  return { ...state, constraints: mergeDedupe(state.constraints, candidate) };
}

function applyAddOpenWork(state: ChatPinnedState, op: Extract<StateOperation, { op: "add_open_work" }>, now: string): ChatPinnedState {
  const candidate: StateItem = {
    id: crypto.randomUUID(),
    text: op.text,
    authority: "model",
    status: "active",
    sourceMessageId: op.sourceMessageId,
    supersedes: null,
    createdAt: now,
    updatedAt: now
  };
  return { ...state, openWork: mergeDedupe(state.openWork, candidate) };
}

function applyCompleteWork(state: ChatPinnedState, op: Extract<StateOperation, { op: "complete_work" }>, now: string): ChatPinnedState {
  const target = state.openWork.find((work) => work.id === op.targetId);
  if (!target) throw new StateOperationRejected(op, "open work item not found");
  if (target.authority === "user") {
    throw new StateOperationRejected(op, "cannot mark user-authored open work as complete");
  }
  return {
    ...state,
    openWork: state.openWork.map((work) =>
      work.id === op.targetId
        ? { ...work, status: "completed" as const, updatedAt: now }
        : work
    )
  };
}

export type ReducerResult = {
  state: ChatPinnedState;
  applied: StateOperation[];
  rejected: Array<{ op: StateOperation; reason: string }>;
};

export function reduceState(
  state: ChatPinnedState,
  operations: StateOperation[],
  options: { expectedVersion?: number; now?: string } = {}
): ReducerResult {
  if (options.expectedVersion !== undefined && state.version !== options.expectedVersion) {
    throw new StateVersionMismatch(options.expectedVersion, state.version);
  }
  let next: ChatPinnedState = state;
  const applied: StateOperation[] = [];
  const rejected: ReducerResult["rejected"] = [];
  const now = options.now ?? new Date().toISOString();
  for (const op of operations) {
    try {
      switch (op.op) {
        case "set_goal":
          next = applySetGoal(next, op, now);
          break;
        case "add_decision":
          next = applyAddDecision(next, op, now);
          break;
        case "supersede_decision":
          next = applySupersedeDecision(next, op, now);
          break;
        case "add_constraint":
          next = applyAddConstraint(next, op, now);
          break;
        case "add_open_work":
          next = applyAddOpenWork(next, op, now);
          break;
        case "complete_work":
          next = applyCompleteWork(next, op, now);
          break;
        default: {
          const _exhaustive: never = op;
          throw new StateOperationRejected(_exhaustive, "unknown operation");
        }
      }
      applied.push(op);
    } catch (err) {
      if (err instanceof StateOperationRejected) {
        rejected.push({ op, reason: err.reason });
      } else {
        throw err;
      }
    }
  }
  return {
    state: { ...next, version: next.version + 1, updatedAt: now },
    applied,
    rejected
  };
}

export function emptyPinnedState(now: string = new Date().toISOString()): ChatPinnedState {
  return {
    version: 0,
    primaryGoal: null,
    currentPhase: null,
    decisions: [],
    constraints: [],
    openWork: [],
    successCriteria: [],
    importantReferences: [],
    updatedAt: now
  };
}

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
  deadlineAt: z.string().nullable().default(null),
  // Additive new fields — legacy inputTokens/outputTokens kept for backward compat
  contextInputTokens: z.number().int().nonnegative().optional(),
  contextOutputTokens: z.number().int().nonnegative().optional(),
  totalInputTokens: z.number().int().nonnegative().optional(),
  totalOutputTokens: z.number().int().nonnegative().optional(),
  contextModelId: z.string().nullable().optional()
});
export type RunBudget = z.infer<typeof runBudgetSchema>;

export type ModelUsageUpdate = {
  inputTokens: number;
  outputTokens: number;
  modelId: string;
  scope: "root" | "subagent" | "internal";
  updatesContext: boolean;
};

export type NormalizedBudget = {
  contextInputTokens: number;
  contextOutputTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolCalls: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
  maxToolCalls: number | null;
  maxDurationMs: number | null;
  startedAt: string;
  deadlineAt: string | null;
  contextModelId: string | null;
};

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  const parsed = typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function normalizeBudget(raw: unknown): NormalizedBudget {
  const b = (raw ?? {}) as Record<string, unknown>;
  const legacyInput = toInt(b.inputTokens) ?? 0;
  const legacyOutput = toInt(b.outputTokens) ?? 0;
  return {
    contextInputTokens: toInt(b.contextInputTokens) ?? legacyInput,
    contextOutputTokens: toInt(b.contextOutputTokens) ?? legacyOutput,
    totalInputTokens: toInt(b.totalInputTokens) ?? legacyInput,
    totalOutputTokens: toInt(b.totalOutputTokens) ?? legacyOutput,
    toolCalls: toInt(b.toolCalls) ?? 0,
    maxInputTokens: toInt(b.maxInputTokens) ?? null,
    maxOutputTokens: toInt(b.maxOutputTokens) ?? null,
    maxToolCalls: toInt(b.maxToolCalls) ?? null,
    maxDurationMs: toInt(b.maxDurationMs) ?? null,
    startedAt: str(b.startedAt) ?? "",
    deadlineAt: str(b.deadlineAt) ?? null,
    contextModelId: str(b.contextModelId) ?? null,
  };
}

/**
 * Workspace-owned safety envelope for autonomous Director runs. The values
 * live in an active file-backed configuration record; application code only
 * owns this typed contract and enforcement.
 */
export const directorRuntimePolicySchema = z.object({
  maxInputTokens: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive(),
  maxDurationMs: z.number().int().positive(),
  maxToolCalls: z.number().int().positive(),
  maxChildRuns: z.number().int().positive(),
  maxParallelChildRuns: z.number().int().positive(),
  maxCallsPerCapability: z.number().int().positive(),
  maxChildInputTokens: z.number().int().positive()
}).superRefine((policy, context) => {
  if (policy.maxParallelChildRuns > policy.maxChildRuns) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["maxParallelChildRuns"],
      message: "maxParallelChildRuns cannot exceed maxChildRuns."
    });
  }
});
export type DirectorRuntimePolicy = z.infer<typeof directorRuntimePolicySchema>;

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

export const runStateFrameSchema = z.object({
  goal: runGoalSchema.optional(),
  budget: runBudgetSchema.optional(),
  progress: runProgressSchema.optional(),
  verification: runVerificationSchema.optional()
});
export type RunStateFrame = z.infer<typeof runStateFrameSchema>;

export const usageFrameSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  toolCalls: z.number()
});
export type UsageFrame = z.infer<typeof usageFrameSchema>;

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
  z.object({ kind: z.literal("chat_created"), chatId: z.string(), chat: chatSchema }),
  z.object({ kind: z.literal("message_persisted"), chatId: z.string(), message: chatMessageSchema, runId: z.string() }),
  z.object({ kind: z.literal("event"), event: runEventSchema }),
  z.object({ kind: z.literal("artifact"), artifact: artifactSchema }),
  z.object({ kind: z.literal("text"), text: z.string() }),
  z.object({ kind: z.literal("status"), message: z.string() }),
  z.object({ kind: z.literal("run_state"), state: runStateFrameSchema }),
  z.object({ kind: z.literal("usage"), usage: usageFrameSchema }),
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
