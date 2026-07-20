import { z } from "zod";
import {
  fileTypeSchema,
  fileStatusSchema,
  connectionKindSchema,
  connectionStatusSchema,
  roleSchema,
  skillSchema,
  workflowFileSchema,
  evalFileSchema,
  skillBindingSchema,
  humanInputQuestionSchema,
  evalRuleSchema,
  workflowNodeSchema,
  workflowEdgeSchema,
  loopConfigWithDelaySchema,
  inferWorkflowTopology,
  type FileRecord,
  type Role,
  type Skill,
  type WorkflowFile,
  type EvalFile,
} from "./index.ts";

export type EntityDiagnostic = {
  entityId: string;
  entityType: "role" | "skill" | "workflow" | "eval";
  field: string;
  message: string;
  value?: unknown;
};

export type EntityResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostics: EntityDiagnostic[] };

function diagnostic(
  entityId: string,
  entityType: EntityDiagnostic["entityType"],
  field: string,
  message: string,
  value?: unknown
): EntityDiagnostic {
  return { entityId, entityType, field, message, value };
}

export function safeParseRole(data: FileRecord): EntityResult<Role> {
  const m = data.metadata ?? {};
  const diagnostics: EntityDiagnostic[] = [];

  const statusResult = fileStatusSchema.safeParse(data.status);
  if (!statusResult.success) {
    diagnostics.push(diagnostic(data.id, "role", "status", statusResult.error.message, data.status));
  }

  let skillIds: string[] = [];
  const rawSkillIds = m.skillIds ?? m.skills ?? [];
  const idsResult = z.array(z.string()).safeParse(rawSkillIds);
  if (idsResult.success) {
    skillIds = idsResult.data;
  } else {
    diagnostics.push(diagnostic(data.id, "role", "skillIds", idsResult.error.message, rawSkillIds));
  }

  const modelId = z.string().nullable().default(null).safeParse(m.modelId ?? null);
  if (!modelId.success) {
    diagnostics.push(diagnostic(data.id, "role", "modelId", modelId.error.message, m.modelId));
  }

  const role = {
    id: data.id,
    orgId: data.orgId,
    name: data.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? ""),
    prompt: data.body,
    modelId: modelId.success ? modelId.data : null,
    inputContract: m.inputContract as Role["inputContract"] ?? { name: "Input", format: "markdown" as const, body: "", required: true, multiple: false },
    outputContract: m.outputContract as Role["outputContract"] ?? { name: "Output", format: "markdown" as const, body: "", required: true, multiple: false },
    skillIds,
    status: statusResult.success ? statusResult.data : "draft",
    metadata: m,
  };

  const parsed = roleSchema.safeParse(role);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push(diagnostic(data.id, "role", issue.path.join("."), issue.message, role));
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: parsed.data! };
}

export function safeParseSkill(data: FileRecord): EntityResult<Skill> {
  const m = data.metadata ?? {};
  const diagnostics: EntityDiagnostic[] = [];

  const kindResult = skillSchema.shape.kind.safeParse(m.kind ?? "llm_call");
  if (!kindResult.success) {
    diagnostics.push(diagnostic(data.id, "skill", "kind", kindResult.error.message, m.kind));
  }

  const bindingsResult = z.array(skillBindingSchema).safeParse(m.bindings ?? []);
  if (!bindingsResult.success) {
    diagnostics.push(diagnostic(data.id, "skill", "bindings", bindingsResult.error.message, m.bindings));
  }

  if (m.humanQuestions !== undefined) {
    const hqResult = z.array(humanInputQuestionSchema).safeParse(m.humanQuestions);
    if (!hqResult.success) {
      diagnostics.push(diagnostic(data.id, "skill", "humanQuestions", hqResult.error.message, m.humanQuestions));
    }
  }

  if (m.evalRules !== undefined) {
    const erResult = z.array(evalRuleSchema).safeParse(m.evalRules ?? m.evalRubrics ?? []);
    if (!erResult.success) {
      diagnostics.push(diagnostic(data.id, "skill", "evalRules", erResult.error.message, m.evalRules));
    }
  }

  const skill = {
    id: data.id,
    orgId: data.orgId,
    name: data.title.replace(/\.\w+$/, ""),
    slug: String(m.slug ?? data.id),
    description: String(m.description ?? ""),
    kind: kindResult.success ? kindResult.data : "llm_call",
    status: data.status === "active" ? "active" : data.status === "archived" ? "archived" : "draft",
    auth: String(m.auth ?? "none") as Skill["auth"],
    sideEffect: String(m.sideEffect ?? "none") as Skill["sideEffect"],
    inputSchema: typeof m.inputSchema === "string" ? m.inputSchema : JSON.stringify(m.inputSchema ?? {}),
    outputSchema: typeof m.outputSchema === "string" ? m.outputSchema : JSON.stringify(m.outputSchema ?? {}),
    implementation: String(m.implementation ?? data.body),
    bindings: bindingsResult.success ? bindingsResult.data : [],
    humanQuestions: m.humanQuestions as Skill["humanQuestions"],
    evalRules: (m.evalRules ?? m.evalRubrics) as Skill["evalRules"],
    overallThreshold: m.overallThreshold as number | undefined,
    metadata: m,
  };

  const parsed = skillSchema.safeParse(skill);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push(diagnostic(data.id, "skill", issue.path.join("."), issue.message, skill));
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: parsed.data! };
}

export function safeParseWorkflow(data: FileRecord): EntityResult<WorkflowFile> {
  const m = data.metadata ?? {};
  const diagnostics: EntityDiagnostic[] = [];

  const nodesResult = z.array(workflowNodeSchema).safeParse(m.nodes ?? []);
  if (!nodesResult.success) {
    diagnostics.push(diagnostic(data.id, "workflow", "nodes", nodesResult.error.message, m.nodes));
  }

  const edgesResult = z.array(workflowEdgeSchema).safeParse(m.edges ?? []);
  if (!edgesResult.success) {
    diagnostics.push(diagnostic(data.id, "workflow", "edges", edgesResult.error.message, m.edges));
  }

  const rawTopology = m.topology;
  const wf = {
    id: data.id,
    orgId: data.orgId,
    name: data.title.replace(/\.\w+$/, ""),
    description: data.body,
    nodes: nodesResult.success ? nodesResult.data : [],
    edges: edgesResult.success ? edgesResult.data : [],
    topology: typeof rawTopology === "string" && (rawTopology === "dag" || rawTopology === "sequential") ? rawTopology : inferWorkflowTopology({ id: data.id, orgId: data.orgId, name: "", description: "", nodes: nodesResult.success ? nodesResult.data : [], edges: edgesResult.success ? edgesResult.data : [], status: "draft", metadata: {} }),
    status: data.status === "active" ? "active" : data.status === "archived" ? "archived" : "draft",
    metadata: m,
  };

  const parsed = workflowFileSchema.safeParse(wf);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push(diagnostic(data.id, "workflow", issue.path.join("."), issue.message, wf));
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: parsed.data! };
}

export function safeParseEval(data: FileRecord): EntityResult<EvalFile> {
  const m = data.metadata ?? {};
  const diagnostics: EntityDiagnostic[] = [];

  const rulesRaw: unknown = m.rules ?? m.evalRules ?? m.rubrics ?? [];
  const rulesResult = z.array(evalRuleSchema).safeParse(rulesRaw);
  if (!rulesResult.success) {
    diagnostics.push(diagnostic(data.id, "eval", "rules", rulesResult.error.message, rulesRaw));
  }

  const loopResult = loopConfigWithDelaySchema.safeParse(
    m.loopConfig ?? { enabled: false, maxAttempts: 3, breakCondition: "on_pass", retryDelayMs: 0 }
  );
  if (!loopResult.success) {
    diagnostics.push(diagnostic(data.id, "eval", "loopConfig", loopResult.error.message, m.loopConfig));
  }

  const evalFile = {
    id: data.id,
    orgId: data.orgId,
    name: data.title.replace(/\.\w+$/, ""),
    description: String(m.description ?? data.body ?? ""),
    rules: rulesResult.success ? rulesResult.data : [],
    overallThreshold: Number(m.overallThreshold ?? 75),
    loopConfig: loopResult.success ? loopResult.data : { enabled: false, maxAttempts: 3, breakCondition: "on_pass" as const, retryDelayMs: 0, evalId: null },
    status: data.status === "active" ? "active" : data.status === "archived" ? "archived" : "draft",
    metadata: m,
  };

  const parsed = evalFileSchema.safeParse(evalFile);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      diagnostics.push(diagnostic(data.id, "eval", issue.path.join("."), issue.message, evalFile));
    }
  }

  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: parsed.data! };
}

export type HarnessEntities = {
  roles: Record<string, Role>;
  skills: Record<string, Skill>;
  workflows: Record<string, WorkflowFile>;
  evals: Record<string, EvalFile>;
};

export function validateHarnessEntities(files: FileRecord[]): {
  roles: Record<string, Role>;
  skills: Record<string, Skill>;
  workflows: Record<string, WorkflowFile>;
  evals: Record<string, EvalFile>;
  diagnostics: EntityDiagnostic[];
} {
  const roles: Record<string, Role> = {};
  const skills: Record<string, Skill> = {};
  const workflows: Record<string, WorkflowFile> = {};
  const evals: Record<string, EvalFile> = {};
  const diagnostics: EntityDiagnostic[] = [];

  for (const file of files) {
    switch (file.fileType) {
      case "harness_role": {
        const result = safeParseRole(file);
        if (result.ok) {
          roles[result.value.id] = result.value;
        } else {
          diagnostics.push(...result.diagnostics);
        }
        break;
      }
      case "harness_skill": {
        const result = safeParseSkill(file);
        if (result.ok) {
          skills[result.value.id] = result.value;
        } else {
          diagnostics.push(...result.diagnostics);
        }
        break;
      }
      case "harness_workflow":
      case "harness_workstream": {
        const result = safeParseWorkflow(file);
        if (result.ok) {
          workflows[result.value.id] = result.value;
        } else {
          diagnostics.push(...result.diagnostics);
        }
        break;
      }
      case "harness_eval": {
        const result = safeParseEval(file);
        if (result.ok) {
          evals[result.value.id] = result.value;
        } else {
          diagnostics.push(...result.diagnostics);
        }
        break;
      }
    }
  }

  return { roles, skills, workflows, evals, diagnostics };
}
