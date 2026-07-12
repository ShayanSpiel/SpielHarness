import type { Role } from "@spielos/core";
import type {
  EvalFile,
  SkillDefinition,
  WorkspaceItem,
  WorkspaceState,
  WorkstreamDefinition
} from "./workspace-data";
import { initialWorkspaceState } from "./workspace-data";

export type HarnessFileResponse = {
  id: string;
  orgId: string;
  folderId: string | null;
  fileType: string;
  status: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

function parseEvalFromHarnessFile(file: HarnessFileResponse): EvalFile | null {
  const meta = file.metadata;
  if (!meta.eval) return null;
  let bodyJson: Partial<EvalFile> | null = null;
  try {
    bodyJson = JSON.parse(file.body) as Partial<EvalFile>;
  } catch {
    bodyJson = null;
  }
  const description =
    (meta.description as string | undefined) ??
    bodyJson?.description ??
    (bodyJson ? "" : file.body);

  return {
    id: file.id,
    name: file.title,
    description,
    targetType: (meta.targetType as EvalFile["targetType"]) ?? "draft",
    targetId: (meta.targetId as string) ?? "",
    rubrics: (meta.rubrics as EvalFile["rubrics"]) ?? [],
    overallThreshold: (meta.overallThreshold as number) ?? 75,
    loopConfig: (meta.loopConfig as EvalFile["loopConfig"]) ?? {
      enabled: false,
      maxAttempts: 3,
      breakCondition: "on_pass",
      retryDelayMs: 0
    },
    status: (file.status as EvalFile["status"]) ?? "active",
    results: [],
    updatedAt: file.updatedAt
  };
}

function parseRoleFromHarnessFile(file: HarnessFileResponse): Role | null {
  const meta = file.metadata;
  if (!meta.role) return null;
  const firstTextLine = file.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  const skillSlugs = ((meta.skillIds as string[] | undefined) ?? (meta.skillSlugs as string[] | undefined)) ?? [];
  return {
    id: file.id,
    orgId: file.orgId,
    name: file.title.replace(/\.\w+$/, ""),
    description: (meta.description as string) ?? firstTextLine ?? "",
    prompt: file.body,
    skillIds: skillSlugs,
    memoryPolicy: (meta.memoryPolicy as string[]) ?? [],
    inputArtifactTypes: (meta.inputTypes as Role["inputArtifactTypes"]) ?? [],
    outputArtifactTypes: (meta.outputTypes as Role["outputArtifactTypes"]) ?? [],
    modelId: ((meta.modelId as string | undefined) ?? null) as string | null,
    status: file.status === "active" ? "active" : file.status === "archived" ? "archived" : "draft",
    metadata: {
      contracts: meta.contracts
    }
  };
}

function parseSkillFromHarnessFile(file: HarnessFileResponse): SkillDefinition | null {
  const meta = file.metadata;
  if (!meta.skill) return null;
  const kind = (meta.kind as SkillDefinition["kind"] | undefined) ?? "llm_call";
  const firstTextLine = file.body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  return {
    id: file.id,
    name: file.title.replace(/\.\w+$/, ""),
    slug: (meta.slug as string) ?? file.title.toLowerCase().replace(/\s+/g, "."),
    description: (meta.description as string) ?? firstTextLine ?? "",
    kind,
    status: file.status === "active" ? "active" : file.status === "archived" ? "archived" : "draft",
    auth: (meta.auth as SkillDefinition["auth"]) ?? "none",
    sideEffect: (meta.sideEffect as SkillDefinition["sideEffect"]) ?? "none",
    inputSchema: JSON.stringify(meta.inputSchema ?? { input: "string" }, null, 2),
    outputSchema: JSON.stringify(meta.outputSchema ?? { result: "string" }, null, 2),
    implementation: file.body,
    bindings: (meta.bindings as SkillDefinition["bindings"] | undefined) ?? [],
    evalRubrics: (meta.evalRubrics as SkillDefinition["evalRubrics"]) ?? undefined,
    overallThreshold: (meta.overallThreshold as number | undefined) ?? undefined,
    updatedAt: file.updatedAt
  };
}

function parseItemFromHarnessFile(file: HarnessFileResponse): WorkspaceItem | null {
  const typeToKind: Record<string, string> = {
    strategy: "strategy",
    prompt: "prompts",
    artifact: "library",
    draft: "library",
    evidence: "library",
    asset: "library",
    publish_package: "library",
    eval_report: "library",
    knowledge: "knowledge",
    harness_template: "library"
  };
  // Skip harness-type files — they belong to roles/skills/workstreams pages, not generic items
  if (file.fileType.startsWith("harness_") && file.fileType !== "harness_template" && file.fileType !== "harness_chat_message") {
    return null;
  }
  const kind = typeToKind[file.fileType];
  if (!kind) return null;
  const folder = (file.metadata.seedFolder as string | undefined) ?? file.folderId ?? undefined;
  return {
    id: file.id,
    kind: kind as WorkspaceItem["kind"],
    title: file.title,
    body: file.body,
    folder,
    status: (file.status === "deleted" ? "archived" : file.status) as WorkspaceItem["status"],
    metadata: file.metadata as Record<string, string>,
    updatedAt: file.updatedAt
  };
}

function parseWorkstreamFromHarnessFile(
  file: HarnessFileResponse,
  idsBySlug: Map<string, string>
): WorkstreamDefinition | null {
  const meta = file.metadata;
  if (!meta.workstream) return null;
  const rawNodes = (meta.nodes as Array<Record<string, unknown>>) ?? [];
  return {
    id: file.id,
    title: file.title,
    description: file.body,
    status: (file.status as WorkstreamDefinition["status"]) ?? "draft",
    nodes: rawNodes.map((node, index) => ({
      id: String(node.id ?? `node-${index + 1}`),
      nodeType: node.nodeType === "eval" ? "eval" : "role",
      roleId: idsBySlug.get(String(node.roleSlug ?? node.roleId ?? "")) ?? String(node.roleId ?? ""),
      title: String(node.title ?? `Step ${index + 1}`),
      x: Number(node.x ?? 120 + index * 260),
      y: Number(node.y ?? 160),
      prompt: String(node.prompt ?? node.promptOverride ?? ""),
      skillIds: ((node.skillSlugs as string[] | undefined) ?? (node.skillIds as string[] | undefined) ?? [])
        .map((id) => idsBySlug.get(id) ?? id),
      fileIds: (node.fileIds as string[] | undefined) ?? [],
      input: String(node.input ?? node.inputType ?? "role_input"),
      output: String(node.output ?? node.outputType ?? "role_output"),
      evalInput: node.evalInput as WorkstreamDefinition["nodes"][number]["evalInput"]
    })),
    edges: (meta.edges as WorkstreamDefinition["edges"]) ?? [],
    updatedAt: file.updatedAt
  };
}

function roleContractName(role: Role | undefined, direction: "inputs" | "outputs", fallback: string) {
  const contracts = role?.metadata?.contracts as
    | { inputs?: Array<{ name?: unknown }>; outputs?: Array<{ name?: unknown }> }
    | undefined;
  const name = contracts?.[direction]?.[0]?.name;
  return typeof name === "string" && name.trim() ? name : fallback;
}

export async function loadWorkspaceFromDb(): Promise<WorkspaceState> {
  const [res, chatsRes, modelsRes] = await Promise.all([
    fetch("/api/harness/files", { cache: "no-store" }),
    fetch("/api/chats", { cache: "no-store" }),
    fetch("/api/models", { cache: "no-store" })
  ]);
  if (!res.ok) {
    console.warn("Failed to load harness files, using defaults");
    return initialWorkspaceState;
  }
  const data = (await res.json()) as { files: HarnessFileResponse[] };
  const files = data.files ?? [];
  const chatPayload = chatsRes.ok ? await chatsRes.json() as {
    chats?: Array<{
      id: string;
      title: string;
      created_at: string;
      updated_at: string;
      chat_messages?: Array<{ id: string; role: string; body: string; metadata?: Record<string, unknown>; created_at: string }>;
    }>;
  } : { chats: [] };
  const chats = (chatPayload.chats ?? []).map((chat) => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
    messageIds: (chat.chat_messages ?? []).map((message) => message.id),
    artifactIds: [],
    activeRoleIds: [],
    toolId: null
  }));
  const messages = Object.fromEntries((chatPayload.chats ?? []).map((chat) => [
    chat.id,
    (chat.chat_messages ?? []).filter((message) => ["user", "assistant", "system"].includes(message.role)).map((message) => ({
      id: message.id,
      chatId: chat.id,
      role: message.role as "user" | "assistant" | "system",
      body: message.body,
      createdAt: message.created_at,
      artifactRefs: (message.metadata?.artifactRefs as string[] | undefined) ?? []
    }))
  ]));
  const modelPayload = modelsRes.ok ? await modelsRes.json() as { models?: WorkspaceState["models"] } : { models: [] };

  const roles: Role[] = [];
  const skills: SkillDefinition[] = [];
  const evalFiles: EvalFile[] = [];
  const items: WorkspaceItem[] = [];
  const workstreams: WorkstreamDefinition[] = [];
  const folderNames = new Set<string>();
  const idsBySlug = new Map<string, string>();

  for (const file of files) {
    const slug = file.metadata.slug;
    if (typeof slug === "string") idsBySlug.set(slug, file.id);
  }

  for (const file of files) {
    const item = parseItemFromHarnessFile(file);
    if (item) {
      items.push(item);
      const folder = file.metadata.seedFolder;
      if (typeof folder === "string" && ["knowledge", "library"].includes(item.kind)) {
        folderNames.add(folder);
      }
    }

    const role = parseRoleFromHarnessFile(file);
    if (role) roles.push(role);

    const skill = parseSkillFromHarnessFile(file);
    if (skill) skills.push(skill);

    const parsedEval = parseEvalFromHarnessFile(file);
    if (parsedEval) evalFiles.push(parsedEval);

    const ws = parseWorkstreamFromHarnessFile(file, idsBySlug);
    if (ws) workstreams.push(ws);
  }

  const resolvedRoles = roles.map((role) => ({
    ...role,
    skillIds: role.skillIds.map((slug) => idsBySlug.get(slug) ?? slug)
  }));
  const rolesById = new Map(resolvedRoles.map((role) => [role.id, role]));
  const normalizedWorkstreams = workstreams.map((workstream) => ({
    ...workstream,
    nodes: workstream.nodes.map((node) => {
      if (node.nodeType === "eval") {
        return { ...node, output: "Eval report" };
      }
      const role = rolesById.get(node.roleId);
      return {
        ...node,
        input: roleContractName(role, "inputs", node.input || "Role input"),
        output: roleContractName(role, "outputs", node.output || "Role output")
      };
    })
  }));

  return {
    ...initialWorkspaceState,
    items,
    roles: resolvedRoles,
    skills,
    evalFiles,
    workstreams: normalizedWorkstreams,
    libraryFolders: Array.from(folderNames),
    chats,
    messages,
    models: modelPayload.models ?? [],
    activeChatId: chats[0]?.id ?? null
  };
}

export async function saveItemToDb(item: Partial<WorkspaceItem> & { id: string }) {
  const res = await fetch("/api/harness/files", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: item.id,
      title: item.title,
      body: item.body,
      status: item.status
    })
  });
  if (!res.ok) throw new Error("Failed to save item");
  return res.json();
}

export function workspaceKindToFileType(kind: WorkspaceItem["kind"]): string {
  if (kind === "prompts") return "prompt";
  if (kind === "strategy") return "strategy";
  if (kind === "knowledge") return "knowledge";
  return "draft";
}

export async function deleteItemFromDb(id: string) {
  const res = await fetch(`/api/harness/files?id=${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete item");
}

export type HarnessSavePayload = {
  id?: string;
  create?: boolean;
  title: string;
  body: string;
  fileType: string;
  status?: string;
  metadata?: Record<string, unknown>;
};

export async function saveHarnessFile(payload: HarnessSavePayload) {
  const method = payload.create || !payload.id ? "POST" : "PUT";
  const res = await fetch("/api/harness/files", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`Failed to save harness file: ${res.status}`);
  return res.json() as Promise<{ file: HarnessFileResponse }>;
}
