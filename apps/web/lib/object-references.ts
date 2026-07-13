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
  const seen = new Set<string>();
  const result: ObjectReference[] = [];

  // typed entries first — they have richer kind info
  for (const role of input.roles) {
    if (role.status !== "active" || seen.has(role.id)) continue;
    seen.add(role.id);
    result.push({ id: role.id, kind: "role", title: role.name, subtitle: role.description });
  }
  for (const skill of input.skills) {
    if (skill.status !== "active" || seen.has(skill.id)) continue;
    seen.add(skill.id);
    result.push({ id: skill.id, kind: "skill", title: skill.name, subtitle: skill.description });
  }
  for (const evalFile of input.evalFiles) {
    if (evalFile.status !== "active" || seen.has(evalFile.id)) continue;
    seen.add(evalFile.id);
    result.push({ id: evalFile.id, kind: "eval", title: evalFile.name, subtitle: `${evalFile.rules.length} criteria` });
  }
  for (const workstream of input.workstreams) {
    if (workstream.status !== "active" || seen.has(workstream.id)) continue;
    seen.add(workstream.id);
    result.push({ id: workstream.id, kind: "workflow", title: workstream.name, subtitle: `${workstream.nodes.length} steps` });
  }
  for (const item of input.items) {
    if (item.status === "archived" || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({
      id: item.id,
      kind: item.kind === "prompt" ? "prompt" : "file",
      title: item.title,
      subtitle: item.folder ?? item.kind
    });
  }

  return result.sort((a, b) => a.title.localeCompare(b.title));
}
