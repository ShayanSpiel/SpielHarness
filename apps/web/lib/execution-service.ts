import type { SupabaseClient } from "@supabase/supabase-js";
import type { Model, ModelProvider, Role, Skill } from "@spielos/core";
import { streamChat } from "@spielos/providers";
import { HttpError } from "./server";

export type ContextRefKind =
  | "role"
  | "skill"
  | "tool"
  | "eval"
  | "workflow"
  | "workstream"
  | "knowledge"
  | "library"
  | "strategy";

export type ContextRef = {
  id: string;
  kind: ContextRefKind;
};

export type ExecutionTarget =
  | { type: "chat"; id?: undefined }
  | { type: "role"; id: string }
  | { type: "skill"; id: string }
  | { type: "eval"; id: string }
  | { type: "workflow"; id: string };

export type ExecuteBody = {
  prompt: string;
  target?: ExecutionTarget;
  contextRefs?: ContextRef[];
  fileIds?: string[];
  runId?: string;
  nodes?: Array<{
    id: string;
    roleId: string;
    title: string;
    promptOverride?: string;
    skillIds?: string[];
    fileIds?: string[];
  }>;
};

export type FileRow = {
  id: string;
  org_id: string;
  file_type: string;
  status: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
};

export type RuntimeNode = {
  id: string;
  title: string;
  roleId: string;
  promptOverride?: string;
  skillIds: string[];
  fileIds?: string[];
};

export type ResolvedExecution = {
  target: ExecutionTarget;
  targetSummary: string;
  contextRefs: ContextRef[];
  selectedContext: Array<{
    id: string;
    kind: ContextRefKind;
    fileType: string;
    title: string;
  }>;
  nodes: RuntimeNode[];
  rolesById: Record<string, Role>;
  skills: Skill[];
  knowledgeFiles: Array<{
    id: string;
    title: string;
    body: string;
    fileType: string;
    metadata: Record<string, unknown>;
  }>;
  workstreamId: string | null;
};

const CONTENT_FILE_TYPES = new Set([
  "knowledge",
  "strategy",
  "prompt",
  "artifact",
  "draft",
  "evidence",
  "asset",
  "harness_template"
]);

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function normalizeKind(kind: string): ContextRefKind {
  if (kind === "tool") return "skill";
  if (kind === "workstream") return "workflow";
  if (kind === "library") return "knowledge";
  return kind as ContextRefKind;
}

export function normalizeContextRefs(body: ExecuteBody): ContextRef[] {
  if (Array.isArray(body.contextRefs)) {
    return body.contextRefs
      .filter((ref) => ref.id && ref.kind)
      .map((ref) => ({ id: ref.id, kind: normalizeKind(ref.kind) }));
  }
  return (body.fileIds ?? []).filter(Boolean).map((id) => ({ id, kind: "knowledge" }));
}

function fileToRole(row: FileRow, slugToId: Map<string, string>): Role {
  const meta = row.metadata ?? {};
  const skillIds = ((meta.skillIds as string[] | undefined) ?? (meta.skillSlugs as string[] | undefined) ?? [])
    .map((id) => slugToId.get(id) ?? id);
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.title.replace(/\.\w+$/, ""),
    description: String(meta.description ?? ""),
    prompt: row.body,
    modelId: ((meta.modelId as string | undefined) ?? (meta.model as string | undefined) ?? null) as string | null,
    memoryPolicy: (meta.memoryPolicy as string[] | undefined) ?? [],
    inputArtifactTypes: (meta.inputTypes as Role["inputArtifactTypes"] | undefined) ?? [],
    outputArtifactTypes: (meta.outputTypes as Role["outputArtifactTypes"] | undefined) ?? [],
    skillIds,
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    metadata: meta
  };
}

function fileToSkill(row: FileRow): Skill {
  const meta = row.metadata ?? {};
  const inputSchema = typeof meta.inputSchema === "string" ? meta.inputSchema : JSON.stringify(meta.inputSchema ?? {});
  const outputSchema = typeof meta.outputSchema === "string" ? meta.outputSchema : JSON.stringify(meta.outputSchema ?? {});
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.title.replace(/\.\w+$/, ""),
    slug: String(meta.slug ?? row.id),
    description: String(meta.description ?? ""),
    kind: (meta.kind as Skill["kind"]) ?? "llm_call",
    status: row.status === "active" ? "active" : row.status === "archived" ? "archived" : "draft",
    auth: (meta.auth as Skill["auth"]) ?? "none",
    sideEffect: (meta.sideEffect as Skill["sideEffect"]) ?? "none",
    inputSchema,
    outputSchema,
    implementation: String(meta.implementation ?? row.body),
    humanQuestions: (meta.humanQuestions as Skill["humanQuestions"]) ?? undefined,
    evalRubrics: ((meta.evalRubrics as Skill["evalRubrics"]) ?? (meta.rubrics as Skill["evalRubrics"])) ?? undefined,
    overallThreshold: (meta.overallThreshold as number | undefined) ?? undefined,
    metadata: meta,
    enabled: row.status === "active"
  };
}

function evalFileToSkill(row: FileRow): Skill {
  const meta = row.metadata ?? {};
  return {
    id: row.id,
    orgId: row.org_id,
    name: row.title.replace(/\.\w+$/, ""),
    slug: String(meta.slug ?? `eval.${row.id}`),
    description: String(meta.description ?? row.body ?? ""),
    kind: "eval",
    status: row.status === "active" ? "active" : "draft",
    auth: "none",
    sideEffect: "none",
    inputSchema: JSON.stringify({ input: "string" }),
    outputSchema: JSON.stringify({ score: "number", passed: "boolean" }),
    implementation: row.body,
    evalRubrics: (meta.rubrics as Skill["evalRubrics"]) ?? [],
    overallThreshold: (meta.overallThreshold as number | undefined) ?? 75,
    metadata: meta,
    enabled: row.status === "active"
  };
}

function validateCompatibility(target: ExecutionTarget, refs: ContextRef[]) {
  const roles = refs.filter((ref) => normalizeKind(ref.kind) === "role");
  const skills = refs.filter((ref) => normalizeKind(ref.kind) === "skill");
  const evals = refs.filter((ref) => normalizeKind(ref.kind) === "eval");
  const workflows = refs.filter((ref) => normalizeKind(ref.kind) === "workflow");

  if (workflows.length > 1) throw new HttpError(400, "Select only one workflow for a chat run.");
  if (roles.length > 1) throw new HttpError(400, "Select only one role for a chat run.");
  if (skills.length > 1) throw new HttpError(400, "Select only one direct skill for a chat run.");
  if (evals.length > 1) throw new HttpError(400, "Select only one evaluation for a chat run.");

  if (workflows.length > 0 && (roles.length > 0 || skills.length > 0 || evals.length > 0)) {
    throw new HttpError(400, "A workflow controls its own roles and skills. Remove other executable targets.");
  }
  if (evals.length > 0 && (roles.length > 0 || skills.length > 0 || workflows.length > 0)) {
    throw new HttpError(400, "Run an evaluation separately or use it as a workflow gate.");
  }
  if (target.type === "workflow" && (roles.length > 0 || skills.length > 0 || evals.length > 0)) {
    throw new HttpError(400, "A workflow cannot be combined with a role, skill, or evaluation target.");
  }
}

function inferTarget(explicit: ExecutionTarget | undefined, refs: ContextRef[]): ExecutionTarget {
  if (explicit) return explicit;
  const workflow = refs.find((ref) => normalizeKind(ref.kind) === "workflow");
  if (workflow) return { type: "workflow", id: workflow.id };
  const role = refs.find((ref) => normalizeKind(ref.kind) === "role");
  if (role) return { type: "role", id: role.id };
  const evalRef = refs.find((ref) => normalizeKind(ref.kind) === "eval");
  if (evalRef) return { type: "eval", id: evalRef.id };
  const skill = refs.find((ref) => normalizeKind(ref.kind) === "skill");
  if (skill) return { type: "skill", id: skill.id };
  return { type: "chat" };
}

function fallbackLlmSkill(orgId: string): Skill {
  return {
    id: "runtime.llm",
    orgId,
    name: "Default LLM",
    slug: "runtime.llm",
    description: "Default model call for role execution.",
    kind: "llm_call",
    status: "active",
    auth: "none",
    sideEffect: "none",
    inputSchema: "{}",
    outputSchema: "{}",
    implementation: "",
    metadata: {},
    enabled: true
  };
}

export function envModelProvider(orgId: string): { provider: ModelProvider | null; model: Model | null } {
  const modelName = process.env.MODEL_NAME ?? process.env.MISTRAL_MODEL ?? "mistral-large-latest";
  if (!process.env.MODEL_PROVIDER && !process.env.MODEL_NAME && !process.env.MISTRAL_API_KEY) {
    return { provider: null, model: null };
  }
  return {
    provider: {
      id: "env",
      orgId,
      name: process.env.MODEL_PROVIDER ?? "Mistral",
      kind: process.env.MODEL_PROVIDER_KIND ?? "mistral",
      baseUrl: process.env.MODEL_PROVIDER_BASE_URL ?? process.env.MISTRAL_BASE_URL ?? null,
      secretRef: process.env.MODEL_PROVIDER_SECRET ?? "MISTRAL_API_KEY",
      enabled: true
    },
    model: {
      id: "env",
      orgId,
      providerId: "env",
      label: modelName,
      model: modelName,
      config: {},
      enabled: true
    }
  };
}

export async function resolveExecution(
  supabase: SupabaseClient,
  orgId: string,
  body: ExecuteBody
): Promise<ResolvedExecution> {
  if (!body.prompt?.trim()) throw new HttpError(400, "prompt is required");

  const refs = normalizeContextRefs(body);
  const target = inferTarget(body.target, refs);
  validateCompatibility(target, refs);

  const requestedIds = unique([
    ...refs.map((ref) => ref.id),
    ...(target.id ? [target.id] : []),
    ...(body.nodes ?? []).flatMap((node) => [node.roleId, ...(node.skillIds ?? []), ...(node.fileIds ?? [])])
  ].filter(Boolean));

  const filesById = new Map<string, FileRow>();
  if (requestedIds.length > 0) {
    const { data, error } = await supabase
      .from("files")
      .select("id, org_id, file_type, status, title, body, metadata")
      .eq("org_id", orgId)
      .in("id", requestedIds)
      .neq("status", "deleted");
    if (error) throw error;
    for (const row of (data ?? []) as FileRow[]) filesById.set(row.id, row);
  }

  const { data: catalogRows, error: catalogError } = await supabase
    .from("files")
    .select("id, org_id, file_type, status, title, body, metadata")
    .eq("org_id", orgId)
    .in("file_type", ["harness_role", "harness_skill", "harness_eval", "harness_workstream"])
    .neq("status", "deleted");
  if (catalogError) throw catalogError;
  for (const row of (catalogRows ?? []) as FileRow[]) filesById.set(row.id, row);

  const slugToId = new Map<string, string>();
  for (const row of filesById.values()) {
    const slug = row.metadata?.slug;
    if (typeof slug === "string") slugToId.set(slug, row.id);
  }

  const rolesById: Record<string, Role> = {};
  const skillsById = new Map<string, Skill>();
  for (const row of filesById.values()) {
    if (row.file_type === "harness_role") rolesById[row.id] = fileToRole(row, slugToId);
    if (row.file_type === "harness_skill") skillsById.set(row.id, fileToSkill(row));
    if (row.file_type === "harness_eval") skillsById.set(row.id, evalFileToSkill(row));
  }

  const selectedContext = refs.map((ref) => {
    const row = filesById.get(ref.id);
    return {
      id: ref.id,
      kind: normalizeKind(ref.kind),
      fileType: row?.file_type ?? "unknown",
      title: row?.title ?? ref.id
    };
  });

  const knowledgeFiles = Array.from(filesById.values())
    .filter((row) => CONTENT_FILE_TYPES.has(row.file_type))
    .map((row) => ({
      id: row.id,
      title: row.title,
      body: row.body,
      fileType: row.file_type,
      metadata: row.metadata ?? {}
    }));

  let nodes: RuntimeNode[] = [];
  let workstreamId: string | null = null;

  if (body.nodes && body.nodes.length > 0) {
    nodes = body.nodes.map((node) => ({
      id: node.id,
      roleId: node.roleId,
      title: node.title,
      promptOverride: node.promptOverride?.trim() ? node.promptOverride : undefined,
      skillIds: (node.skillIds ?? []).map((id) => slugToId.get(id) ?? id),
      fileIds: node.fileIds ?? []
    }));
  } else if (target.type === "workflow") {
    const workflow = filesById.get(target.id);
    if (!workflow || workflow.file_type !== "harness_workstream") {
      throw new HttpError(400, "Selected workflow was not found.");
    }
    workstreamId = workflow.id;
    const rawNodes = (workflow.metadata?.nodes as Array<Record<string, unknown>> | undefined) ?? [];
    nodes = rawNodes.map((node, index) => ({
      id: String(node.id ?? `node-${index + 1}`),
      roleId: slugToId.get(String(node.roleSlug ?? node.roleId ?? "")) ?? String(node.roleId ?? ""),
      title: String(node.title ?? `Step ${index + 1}`),
      promptOverride: String(node.promptOverride ?? "").trim() ? String(node.promptOverride) : undefined,
      skillIds: ((node.skillSlugs as string[] | undefined) ?? (node.skillIds as string[] | undefined) ?? [])
        .map((id) => slugToId.get(id) ?? id),
      fileIds: (node.fileIds as string[] | undefined) ?? []
    }));
  } else if (target.type === "role") {
    const role = rolesById[target.id];
    if (!role) throw new HttpError(400, "Selected role was not found.");
    const selectedSkill = refs.find((ref) => normalizeKind(ref.kind) === "skill");
    const skillIds = selectedSkill ? [selectedSkill.id] : role.skillIds;
    nodes = [{
      id: `node_${crypto.randomUUID()}`,
      roleId: role.id,
      title: role.name,
      skillIds,
      fileIds: knowledgeFiles.map((file) => file.id)
    }];
  } else if (target.type === "skill") {
    const skill = skillsById.get(target.id);
    if (!skill) throw new HttpError(400, "Selected skill was not found.");
    const runtimeRole: Role = {
      id: "runtime.chat",
      orgId,
      name: "Chat",
      description: "Direct skill execution wrapper.",
      prompt: "Run the selected skill against the user's request and selected context.",
      modelId: null,
      memoryPolicy: ["run"],
      inputArtifactTypes: [],
      outputArtifactTypes: [],
      skillIds: [skill.id],
      status: "active",
      metadata: {}
    };
    rolesById[runtimeRole.id] = runtimeRole;
    nodes = [{
      id: `node_${crypto.randomUUID()}`,
      roleId: runtimeRole.id,
      title: skill.name,
      skillIds: [skill.id],
      fileIds: knowledgeFiles.map((file) => file.id)
    }];
  } else if (target.type === "eval") {
    const evalSkill = skillsById.get(target.id);
    if (!evalSkill) throw new HttpError(400, "Selected evaluation was not found.");
    const runtimeRole: Role = {
      id: "runtime.eval",
      orgId,
      name: "Evaluation Runner",
      description: "Runs a reusable evaluation definition.",
      prompt: "Evaluate the supplied input against the selected rubric.",
      modelId: null,
      memoryPolicy: ["run"],
      inputArtifactTypes: [],
      outputArtifactTypes: ["eval_report"],
      skillIds: [evalSkill.id],
      status: "active",
      metadata: {}
    };
    rolesById[runtimeRole.id] = runtimeRole;
    nodes = [{
      id: `node_${crypto.randomUUID()}`,
      roleId: runtimeRole.id,
      title: evalSkill.name,
      skillIds: [evalSkill.id],
      fileIds: knowledgeFiles.map((file) => file.id)
    }];
  }

  for (const node of nodes) {
    const role = rolesById[node.roleId];
    if (!role) throw new HttpError(400, `Workflow node "${node.title}" references a missing role.`);
    if (node.skillIds.length === 0) node.skillIds = role.skillIds;
    if (node.skillIds.length === 0) {
      const fallback = fallbackLlmSkill(orgId);
      skillsById.set(fallback.id, fallback);
      node.skillIds = [fallback.id];
    }
    for (const skillId of node.skillIds) {
      if (!skillsById.has(skillId)) {
        const roleSkill = role.skillIds.find((id) => id === skillId);
        if (roleSkill) continue;
        throw new HttpError(400, `Node "${node.title}" references a missing skill.`);
      }
    }
  }

  const skills = Array.from(skillsById.values());
  return {
    target,
    targetSummary: target.type === "chat" ? "Normal chat" : `${target.type}:${target.id}`,
    contextRefs: refs,
    selectedContext,
    nodes,
    rolesById,
    skills,
    knowledgeFiles,
    workstreamId
  };
}

export async function runPlainChat(
  orgId: string,
  prompt: string,
  selectedContext: ResolvedExecution["selectedContext"],
  signal?: AbortSignal
) {
  const { provider, model } = envModelProvider(orgId);
  const system = [
    "You are the SpielOS Director for a customizable marketing team platform.",
    "Explain available platform concepts accurately: roles, skills, evaluations, workflows, integrations, library content, prompts, and runs.",
    "The user selected no executable target unless selected context says otherwise.",
    selectedContext.length
      ? `Selected context references: ${selectedContext.map((item) => `${item.kind}:${item.title}`).join(", ")}`
      : "Selected explicit context: none.",
    "Do not assume the full library was attached."
  ].join("\n");

  if (!provider || !model) {
    return [
      "I can help from the workspace context, but no model provider is connected.",
      "",
      selectedContext.length
        ? `Selected context: ${selectedContext.map((item) => item.title).join(", ")}.`
        : "No explicit context was selected. Add a role, skill, evaluation, workflow, or library item when you want a targeted run.",
      "",
      `Your request: ${prompt}`
    ].join("\n");
  }

  const response = await streamChat(
    provider,
    model,
    [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    { signal }
  );
  let content = "";
  for await (const delta of response) content += delta;
  return content;
}

export async function* streamPlainChat(
  orgId: string,
  prompt: string,
  selectedContext: ResolvedExecution["selectedContext"],
  signal?: AbortSignal
): AsyncGenerator<string, string, void> {
  const { provider, model } = envModelProvider(orgId);
  const system = [
    "You are the SpielOS Director for a customizable marketing team platform.",
    "Explain available platform concepts accurately: roles, skills, evaluations, workflows, integrations, library content, prompts, and runs.",
    "The user selected no executable target unless selected context says otherwise.",
    selectedContext.length
      ? `Selected context references: ${selectedContext.map((item) => `${item.kind}:${item.title}`).join(", ")}`
      : "Selected explicit context: none.",
    "Do not assume the full library was attached."
  ].join("\n");

  if (!provider || !model) {
    const fallback = [
      "I can help from the workspace context, but no model provider is connected.",
      "",
      selectedContext.length
        ? `Selected context: ${selectedContext.map((item) => item.title).join(", ")}.`
        : "No explicit context was selected. Add a role, skill, evaluation, workflow, or library item when you want a targeted run.",
      "",
      `Your request: ${prompt}`
    ].join("\n");
    yield fallback;
    return fallback;
  }

  let content = "";
  const response = streamChat(
    provider,
    model,
    [
      { role: "system", content: system },
      { role: "user", content: prompt }
    ],
    { signal }
  );
  for await (const delta of response) {
    content += delta;
    yield delta;
  }
  return content;
}
