import type { EvalFile, SkillDefinition, WorkspaceItem, WorkstreamDefinition } from "./workspace-data";
import type { Role } from "@spielos/core";

export type ObjectReferenceKind = "file" | "prompt" | "role" | "skill" | "eval" | "workflow";

export type ObjectReference = {
  id: string;
  kind: ObjectReferenceKind;
  title: string;
  subtitle: string;
};

export function mentionText(ref: ObjectReference): string {
  const label = ref.title.replace(/[\[\]\n\r]/g, " ").trim() || ref.id;
  return `@[${label}](spielos://${ref.kind}/${ref.id})`;
}

export function buildObjectReferences(input: {
  items: WorkspaceItem[];
  roles: Role[];
  skills: SkillDefinition[];
  evalFiles: EvalFile[];
  workstreams: WorkstreamDefinition[];
}): ObjectReference[] {
  const itemRefs = input.items
    .filter((item) => item.status !== "archived")
    .map((item): ObjectReference => ({
      id: item.id,
      kind: item.kind === "prompts" ? "prompt" : "file",
      title: item.title,
      subtitle: item.folder ?? item.kind
    }));
  return [
    ...input.roles
      .filter((role) => role.status === "active")
      .map((role): ObjectReference => ({ id: role.id, kind: "role", title: role.name, subtitle: role.description })),
    ...input.skills
      .filter((skill) => skill.status === "active")
      .map((skill): ObjectReference => ({ id: skill.id, kind: "skill", title: skill.name, subtitle: skill.slug })),
    ...input.evalFiles
      .filter((evalFile) => evalFile.status === "active")
      .map((evalFile): ObjectReference => ({ id: evalFile.id, kind: "eval", title: evalFile.name, subtitle: `${evalFile.rubrics.length} criteria` })),
    ...input.workstreams
      .filter((workstream) => workstream.status === "active")
      .map((workstream): ObjectReference => ({ id: workstream.id, kind: "workflow", title: workstream.title, subtitle: `${workstream.nodes.length} steps` })),
    ...itemRefs
  ].sort((a, b) => a.title.localeCompare(b.title));
}
