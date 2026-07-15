import type {
  EvalFile as CoreEvalFile,
  FileRecord,
  Model,
  ModelCapabilities,
  Role as CoreRole,
  Skill as CoreSkill,
  WorkflowFile as CoreWorkflowFile,
  WorkflowNode as CoreWorkflowNode
} from "@spielos/core";

export type { CoreEvalFile as EvalFile, CoreRole as Role, CoreSkill as Skill, CoreWorkflowFile as WorkstreamDefinition, FileRecord, Model };

export type ProviderModel = {
  id: string;
  provider: string;
  label: string;
  model: string;
  baseUrl: string;
  secretEnvKey: string | null;
  enabled: boolean;
  capabilities: ModelCapabilities;
};

export type RoleContract = CoreRole["inputContract"];

export type RoleContractFormat = "markdown" | "json" | "file";

export type RoleContractDefinition = {
  name: string;
  format: RoleContractFormat;
  body: string;
  required: boolean;
  multiple: boolean;
};

export type SkillDefinition = CoreSkill;

export type WorkstreamNode = CoreWorkflowNode;

export type WorkspaceItemKind =
  | "strategy"
  | "knowledge"
  | "library"
  | "prompt"
  | "roles"
  | "skills"
  | "workstreams"
  | "evals";

export type WorkspaceItem = {
  id: string;
  kind: WorkspaceItemKind;
  title: string;
  body: string;
  folder?: string;
  status: "draft" | "active" | "archived";
  updatedAt: string;
};

const TYPE_TO_KIND: Record<string, WorkspaceItemKind> = {
  knowledge: "knowledge",
  strategy: "strategy",
  prompt: "prompt",
  draft: "library",
  artifact: "library",
  evidence: "library",
  asset: "library",
  eval_report: "library",
  publish_package: "library",
  harness_template: "library",
  harness_role: "roles",
  harness_skill: "skills",
  harness_workflow: "workstreams",
  harness_workstream: "workstreams",
  harness_eval: "evals"
};

export function fileRecordToItem(file: FileRecord): WorkspaceItem | null {
  if (file.metadata?.memoryRecord === true) return null;
  const kind = TYPE_TO_KIND[file.fileType];
  if (!kind) return null;
  const folder = (file.metadata?.seedFolder as string | undefined) ?? undefined;
  return {
    id: file.id,
    kind,
    title: file.title,
    body: file.body,
    folder,
    status: file.status === "deleted" ? "archived" : file.status,
    updatedAt: file.updatedAt
  };
}

export function generatedFileFolder(): string {
  return "Outputs";
}
