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
  "harness_workstream",
  "harness_eval",
  "harness_template",
  "harness_chat_message"
]);
export type FileType = z.infer<typeof fileTypeSchema>;

// ── Run / event primitives ─────────────────────────────────────
export const runTypeSchema = z.enum([
  "eval",
  "content",
  "ads",
  "research",
  "strategy",
  "custom"
]);

export const runStatusSchema = z.enum([
  "draft",
  "running",
  "waiting_human",
  "completed",
  "failed",
  "cancelled"
]);

export const eventTypeSchema = z.enum([
  "node_started",
  "node_status",
  "skill_started",
  "skill_completed",
  "human_input_requested",
  "human_input_received",
  "tool_call_started",
  "tool_call_result",
  "artifact_created",
  "eval_score_updated",
  "node_completed",
  "run_completed",
  "run_failed",
  "run_cancelled"
]);
export type EventType = z.infer<typeof eventTypeSchema>;

// ── Skill kinds ────────────────────────────────────────────────
export const skillKindSchema = z.enum([
  "llm_call",
  "human_input",
  "eval",
  "code",
  "http",
  "mcp_call",
  "knowledge_search"
]);
export type SkillKind = z.infer<typeof skillKindSchema>;

// ── Human input question (Claude-Code / Codex style) ───────────
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

// ── Skill definition ──────────────────────────────────────────
export const skillSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().default(""),
  kind: skillKindSchema,
  status: z.enum(["active", "draft", "archived"]).default("active"),
  auth: z.enum(["none", "api_key", "oauth"]).default("none"),
  sideEffect: z.enum(["none", "read", "write", "external"]).default("none"),
  inputSchema: z.string().default("{}"),
  outputSchema: z.string().default("{}"),
  implementation: z.string().default(""),
  bindings: z.array(z.object({
    connectionId: z.string(),
    operation: z.string(),
    enabled: z.boolean().default(true),
    confirmation: z.enum(["never", "on_write", "always"]).default("on_write")
  })).default([]),
  // For human_input skills
  humanQuestions: z.array(humanInputQuestionSchema).optional(),
  // For eval skills
  evalRubrics: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(["contains", "missing", "min_words", "max_words", "regex", "llm_judge"]),
        value: z.string(),
        weight: z.number().default(10),
        passThreshold: z.number().default(75)
      })
    )
    .optional(),
  overallThreshold: z.number().optional(),
  metadata: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Skill = z.infer<typeof skillSchema>;

// ── Role (agent) ───────────────────────────────────────────────
export const artifactTypeSchema = z.enum([
  "uploaded_file",
  "url_snapshot",
  "meeting_note",
  "session_log",
  "research_report",
  "evidence_table",
  "strategy_file",
  "knowledge_chunk",
  "brief",
  "draft",
  "ad_concept",
  "eval_report",
  "asset",
  "publish_package",
  "published_post"
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

export const roleSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  prompt: z.string().min(1),
  modelId: z.string().nullable().default(null),
  memoryPolicy: z.array(z.string()).default([]),
  inputArtifactTypes: z.array(artifactTypeSchema).default([]),
  outputArtifactTypes: z.array(artifactTypeSchema).default([]),
  skillIds: z.array(z.string()).default([]),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Role = z.infer<typeof roleSchema>;

// ── Workstream (graph) ─────────────────────────────────────────
export const workstreamNodeSchema = z.object({
  id: z.string(),
  nodeType: z.enum(["role", "eval"]).default("role"),
  roleId: z.string(),
  title: z.string(),
  x: z.number().default(0),
  y: z.number().default(0),
  promptOverride: z.string().optional(),
  skillIds: z.array(z.string()).default([]),
  fileIds: z.array(z.string()).default([]),
  inputType: z.string().default("any"),
  outputType: z.string().default("any"),
  loopConfig: z.object({
    enabled: z.boolean().default(false),
    maxAttempts: z.number().default(3),
    breakCondition: z.enum(["on_pass", "on_fail"]).default("on_pass"),
    evalId: z.string().nullable().default(null),
    retryDelayMs: z.number().default(0)
  }).optional(),
  evalInput: z.object({
    type: z.enum(["previous_output", "workflow_input", "node_output"]).default("previous_output"),
    nodeId: z.string().optional()
  }).optional()
});

export const workstreamEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string()
});

export const workstreamSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  status: z.enum(["active", "draft", "archived"]).default("active"),
  nodes: z.array(workstreamNodeSchema).default([]),
  edges: z.array(workstreamEdgeSchema).default([]),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Workstream = z.infer<typeof workstreamSchema>;

// ── Run + events + artifacts ───────────────────────────────────
export const artifactSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  runId: z.string().optional(),
  type: artifactTypeSchema,
  title: z.string(),
  body: z.string(),
  parentArtifactIds: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({})
});
export type Artifact = z.infer<typeof artifactSchema>;

export const runEventSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  runId: z.string(),
  type: eventTypeSchema,
  node: z.string().optional(),
  skill: z.string().optional(),
  message: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});
export type RunEvent = z.infer<typeof runEventSchema>;

export const runSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  workstreamId: z.string().nullable(),
  type: runTypeSchema,
  prompt: z.string(),
  status: runStatusSchema,
  inputs: z.record(z.unknown()).default({}),
  outputs: z.record(z.unknown()).default({}),
  humanInputs: z.record(z.unknown()).default({}),
  metadata: z.record(z.unknown()).default({}),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  completedAt: z.string().nullable().optional()
});
export type Run = z.infer<typeof runSchema>;

// ── Providers / models ─────────────────────────────────────────
export const modelProviderSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  kind: z.string(),
  baseUrl: z.string().nullable().default(null),
  secretRef: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  providerId: z.string(),
  label: z.string(),
  model: z.string(),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional()
});
export type Model = z.infer<typeof modelSchema>;
