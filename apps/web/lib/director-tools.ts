import type { DirectorToolContext } from "@spielos/graph/director/tools";
import {
  atomicCheckpoint,
  createFile,
  createRun,
  linkRunOutputFile,
  recordUsage,
  type InstrumentedSql
} from "@spielos/db";
import type { WorkflowFile, EvalFile, Role, Skill, Model, ModelProvider, Connection, RunEvent, DirectorRuntimePolicy } from "@spielos/core";
import { searchAttachedFiles, streamRun, type AttachedFile, type RunCheckpoint, type RunRequest } from "@spielos/graph";
import { registerRun } from "./run-registry.ts";
import { generatedFileFolder } from "./workspace-data.ts";

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

export type BuildDirectorToolContextArgs = {
  sql: InstrumentedSql;
  orgId: string;
  userId: string | null;
  chatId: string | null;
  turnId: string | null;
  parentRunId: string;
  projectId: string | null;
  roles: Record<string, Role>;
  skills: Record<string, Skill>;
  workflows: Record<string, WorkflowFile>;
  evals: Record<string, EvalFile>;
  provider: ModelProvider | null;
  model: Model | null;
  files: AttachedFile[];
  searchableFiles: AttachedFile[];
  workspaceInstructions: AttachedFile[];
  memories: AttachedFile[];
  connections: Record<string, Connection>;
  harnessFileAction: import("@spielos/graph").HarnessFileAction | undefined;
  memoryProposalAction: import("@spielos/graph").MemoryProposalAction | undefined;
  runtimePolicy: DirectorRuntimePolicy | null;
  signal?: AbortSignal;
};

type ChildRunResult = {
  runId: string;
  status: string;
  outputText: string;
  inputTokens?: number;
};

async function runChildStream(
  args: BuildDirectorToolContextArgs,
  childRun: { id: string; checkpoint_version?: number | null },
  config: {
    prompt: string;
    workflow?: WorkflowFile | null;
    singleNode?: RunRequest["singleNode"];
    roles: Record<string, Role>;
    skills: Record<string, Skill>;
    files?: AttachedFile[];
    maxInputTokens?: number;
  }
): Promise<ChildRunResult> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort("parent_cancelled");
  args.signal?.addEventListener("abort", abortFromParent, { once: true });
  if (args.signal?.aborted) abortFromParent();
  const unregister = registerRun(childRun.id, controller);
  let outputText = "";
  let terminalStatus: "completed" | "failed" | "cancelled" | "waiting_human" = "completed";
  const billableUsage = { input: 0, output: 0 };
  const events: Array<{
    event_type: RunEvent["type"];
    node_id: string | null;
    node_title: string | null;
    skill_id: string | null;
    skill_name: string | null;
    message: string;
    payload: Record<string, unknown>;
  }> = [];
  const eventIds = new Set<string>();
  let checkpoint: RunCheckpoint | null = null;
  try {
    const onModelUsage = (update: import("@spielos/core").ModelUsageUpdate) => {
      billableUsage.input += update.inputTokens;
      billableUsage.output += update.outputTokens;
    };
    for await (const yield_ of streamRun({
      orgId: args.orgId,
      runId: childRun.id,
      prompt: config.prompt,
      workflow: config.workflow ?? null,
      singleNode: config.singleNode ?? null,
      roles: config.roles,
      skills: config.skills,
      files: config.files ?? args.files,
      workspaceInstructions: args.workspaceInstructions,
      memories: args.memories,
      connections: args.connections,
      provider: args.provider,
      model: args.model,
      onModelUsage,
      signal: controller.signal,
      harnessFileAction: args.harnessFileAction,
      memoryProposalAction: args.memoryProposalAction,
      budget: config.maxInputTokens ? { maxInputTokens: config.maxInputTokens } : undefined
    } as RunRequest)) {
      if (yield_.kind === "text") outputText += yield_.text;
      else if (yield_.kind === "event" && !eventIds.has(yield_.event.id)) {
        eventIds.add(yield_.event.id);
        events.push({
          event_type: yield_.event.type,
          node_id: yield_.event.nodeId ?? null,
          node_title: yield_.event.nodeTitle ?? null,
          skill_id: yield_.event.skillId ?? null,
          skill_name: yield_.event.skillName ?? null,
          message: yield_.event.message,
          payload: yield_.event.payload ?? {}
        });
      } else if (yield_.kind === "checkpoint") checkpoint = yield_.state;
      else if (yield_.kind === "artifact") {
        const file = await createFile(args.sql, args.orgId, {
          title: yield_.artifact.title,
          body: yield_.artifact.body,
          fileType: yield_.artifact.type === "artifact" ? "artifact" : yield_.artifact.type,
          status: "active",
          metadata: {
            ...yield_.artifact.metadata,
            runId: childRun.id,
            runtimeArtifactId: yield_.artifact.id,
            seedFolder: generatedFileFolder()
          }
        });
        await linkRunOutputFile(args.sql, args.orgId, childRun.id, file.id);
      }
      else if (yield_.kind === "done") terminalStatus = yield_.status as typeof terminalStatus;
    }
    await atomicCheckpoint(args.sql, args.orgId, childRun.id, {
      events,
      state: checkpoint ?? undefined,
      outputs: { text: outputText },
      status: terminalStatus,
      completedAt: (terminalStatus as string) === "waiting_human" ? null : new Date().toISOString(),
      expectedCheckpointVersion: Number(childRun.checkpoint_version ?? 0)
    });
    if (args.provider && args.model && (billableUsage.input > 0 || billableUsage.output > 0)) {
      try {
        await recordUsage(args.sql, args.orgId, {
          runId: childRun.id,
          provider: args.provider.name,
          model: args.model.model,
          inputTokens: billableUsage.input,
          outputTokens: billableUsage.output,
          costMicros: 0
        });
      } catch {
        // Best-effort: child billing failure is non-fatal.
      }
    }
    return { runId: childRun.id, status: terminalStatus, outputText, inputTokens: billableUsage.input };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Child run failed.";
    terminalStatus = controller.signal.aborted ? "cancelled" : "failed";
    outputText = outputText || message;
    events.push({
      event_type: terminalStatus === "cancelled" ? "run_cancelled" : "run_failed",
      node_id: null,
      node_title: null,
      skill_id: null,
      skill_name: null,
      message,
      payload: { delegatedBy: "director" }
    });
    try {
      await atomicCheckpoint(args.sql, args.orgId, childRun.id, {
        events,
        state: checkpoint ?? undefined,
        outputs: { text: outputText },
        status: terminalStatus,
        error: message,
        completedAt: new Date().toISOString(),
        expectedCheckpointVersion: Number(childRun.checkpoint_version ?? 0)
      });
    } catch {
      // The parent tool result still reports failure; the existing child row
      // remains the durable diagnostic record if checkpoint persistence failed.
    }
    return { runId: childRun.id, status: terminalStatus, outputText, inputTokens: billableUsage.input };
  } finally {
    args.signal?.removeEventListener("abort", abortFromParent);
    unregister();
  }
}

async function runChildWorkflow(
  args: BuildDirectorToolContextArgs,
  workflowId: string,
  input: Record<string, unknown>,
  maxInputTokens: number
): Promise<ChildRunResult> {
  const workflow = args.workflows[workflowId];
  if (!workflow) {
    return { runId: "", status: "failed", outputText: `Workflow "${workflowId}" not found.` };
  }
  const childRun = await createRun(args.sql, args.orgId, {
    chatId: args.chatId,
    workflowId: workflow.id,
    parentRunId: args.parentRunId,
    projectId: args.projectId,
    turnId: args.turnId,
    executionKind: "workflow",
    type: "workflow",
    prompt: String(input.prompt ?? input.objective ?? "Director delegation"),
    inputs: {
      target: { type: "workflow" as const, id: workflow.id },
      delegatedBy: "director",
      parentRunId: args.parentRunId
    },
    definitionSnapshot: {
      workflow,
      roles: args.roles,
      skills: args.skills
    }
  });
  return runChildStream(args, childRun, {
    prompt: String(input.prompt ?? input.objective ?? "Director delegation"),
    workflow,
    roles: args.roles,
    skills: args.skills,
    maxInputTokens
  });
}

async function runChildSkill(
  args: BuildDirectorToolContextArgs,
  skill: Skill,
  input: string,
  maxInputTokens: number
): Promise<ChildRunResult> {
  if (skill.kind === "knowledge_search") {
    const childRun = await createRun(args.sql, args.orgId, {
      chatId: args.chatId,
      parentRunId: args.parentRunId,
      projectId: args.projectId,
      turnId: args.turnId,
      executionKind: "skill",
      type: "skill",
      prompt: input,
      inputs: {
        target: { type: "skill" as const, id: skill.id },
        delegatedBy: "director",
        parentRunId: args.parentRunId
      },
      definitionSnapshot: { skill, files: args.searchableFiles }
    });
    const outputText = searchAttachedFiles(args.searchableFiles, input);
    const now = new Date().toISOString();
    await atomicCheckpoint(args.sql, args.orgId, childRun.id, {
      events: [
        { event_type: "run_started", node_id: null, node_title: null, skill_id: skill.id, skill_name: skill.name, message: `${skill.name} started.`, payload: { delegatedBy: "director" } },
        { event_type: "tool_call_started", node_id: null, node_title: null, skill_id: skill.id, skill_name: skill.name, message: `${skill.name} searched the file snapshot.`, payload: { operation: skill.slug } },
        { event_type: "tool_call_result", node_id: null, node_title: null, skill_id: skill.id, skill_name: skill.name, message: `${skill.name} returned results.`, payload: { success: true } },
        { event_type: "run_completed", node_id: null, node_title: null, skill_id: skill.id, skill_name: skill.name, message: `${skill.name} completed.`, payload: { delegatedBy: "director" } }
      ],
      outputs: { text: outputText },
      status: "completed",
      completedAt: now,
      expectedCheckpointVersion: Number(childRun.checkpoint_version ?? 0)
    });
    return { runId: childRun.id, status: "completed", outputText };
  }
  const chatRole = resolveExecutionRole(args.roles, skill.id);
  if (!chatRole) return { runId: "", status: "failed", outputText: `Skill "${skill.name}" has no active file-backed execution role.` };
  const roles = args.roles;
  const skills = { ...args.skills, [skill.id]: skill };
  const childRun = await createRun(args.sql, args.orgId, {
    chatId: args.chatId,
    parentRunId: args.parentRunId,
    projectId: args.projectId,
    turnId: args.turnId,
    executionKind: "skill",
    type: "skill",
    prompt: input,
    inputs: {
      target: { type: "skill" as const, id: skill.id },
      delegatedBy: "director",
      parentRunId: args.parentRunId
    },
    definitionSnapshot: {
      roles,
      skills
    }
  });
  return runChildStream(args, childRun, {
    prompt: input,
    singleNode: {
      kind: "skill",
      nodeId: `node_${crypto.randomUUID()}`,
      title: skill.name,
      role: chatRole,
      skill,
      evalFile: null,
      fileIds: args.files.map((file) => file.id)
    },
    roles,
    skills,
    maxInputTokens
  });
}

async function runChildEval(
  args: BuildDirectorToolContextArgs,
  evalFile: EvalFile,
  input: string,
  maxInputTokens: number
): Promise<ChildRunResult> {
  const evalSkill = evalFileToSkill(evalFile, args.orgId);
  const evalRole = resolveExecutionRole(args.roles, evalSkill.id);
  if (!evalRole) return { runId: "", status: "failed", outputText: `Evaluation "${evalFile.name}" has no active file-backed execution role.` };
  const roles = args.roles;
  const skills = { ...args.skills, [evalSkill.id]: evalSkill };
  const childRun = await createRun(args.sql, args.orgId, {
    chatId: args.chatId,
    parentRunId: args.parentRunId,
    projectId: args.projectId,
    turnId: args.turnId,
    executionKind: "eval",
    type: "eval",
    prompt: input,
    inputs: {
      target: { type: "eval" as const, id: evalFile.id },
      delegatedBy: "director",
      parentRunId: args.parentRunId
    },
    definitionSnapshot: {
      roles,
      skills
    }
  });
  return runChildStream(args, childRun, {
    prompt: input,
    singleNode: {
      kind: "eval",
      nodeId: `node_${crypto.randomUUID()}`,
      title: evalFile.name,
      role: evalRole,
      skill: evalSkill,
      evalFile,
      fileIds: args.files.map((file) => file.id)
    },
    roles,
    skills,
    maxInputTokens
  });
}

export function buildDirectorToolContext(args: BuildDirectorToolContextArgs): DirectorToolContext {
  let childRuns = 0;
  let activeChildRuns = 0;
  let childInputTokens = 0;
  const capabilityCalls = new Map<string, number>();

  const guarded = async (
    capability: string,
    execute: (remainingInputTokens: number) => Promise<ChildRunResult>
  ): Promise<string> => {
    const policy = args.runtimePolicy;
    if (!policy) return JSON.stringify({ error: "Director runtime policy is unavailable.", code: "runtime_policy_missing" });
    const calls = capabilityCalls.get(capability) ?? 0;
    if (calls >= policy.maxCallsPerCapability) {
      return JSON.stringify({ error: `Capability call limit reached for "${capability}". Use existing results or finish the response.`, code: "capability_budget_exceeded" });
    }
    if (childRuns >= policy.maxChildRuns) {
      return JSON.stringify({ error: "Child-run limit reached. Use existing results or finish the response.", code: "child_run_budget_exceeded" });
    }
    if (activeChildRuns >= policy.maxParallelChildRuns) {
      return JSON.stringify({ error: "Child-run concurrency limit reached. Wait for active work before delegating again.", code: "child_run_concurrency_exceeded" });
    }
    const remainingInputTokens = policy.maxChildInputTokens - childInputTokens;
    if (remainingInputTokens <= 0) {
      return JSON.stringify({ error: "Child-run token limit reached. Use existing results or finish the response.", code: "child_token_budget_exceeded" });
    }
    capabilityCalls.set(capability, calls + 1);
    childRuns += 1;
    activeChildRuns += 1;
    try {
      const outcome = await execute(remainingInputTokens);
      childInputTokens += outcome.inputTokens ?? 0;
      return JSON.stringify({ runId: outcome.runId, status: outcome.status, output: outcome.outputText });
    } finally {
      activeChildRuns -= 1;
    }
  };

  return {
    executeWorkflow: async ({ workflowId, input }) => {
      return guarded(`workflow:${workflowId}`, (remaining) => runChildWorkflow(args, workflowId, input, remaining));
    },
    executeSkill: async ({ skillId, input }) => {
      const skill = args.skills[skillId];
      if (!skill) {
        return JSON.stringify({ error: `Skill "${skillId}" not found.` });
      }
      return guarded(`skill:${skillId}`, (remaining) => runChildSkill(args, skill, toolInputText(input), remaining));
    },
    executeEval: async ({ evalId, input }) => {
      const evalFile = args.evals[evalId];
      if (!evalFile) {
        return JSON.stringify({ error: `Eval "${evalId}" not found.` });
      }
      return guarded(`eval:${evalId}`, (remaining) => runChildEval(args, evalFile, toolInputText(input), remaining));
    }
  };
}

export function workflowsForDirector(
  workflows: Record<string, WorkflowFile>
): Record<string, WorkflowFile> {
  const out: Record<string, WorkflowFile> = {};
  for (const [id, workflow] of Object.entries(workflows)) {
    if (workflow.status === "active") out[id] = workflow;
  }
  return out;
}

function toolInputText(input: unknown): string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (typeof record.query === "string") return record.query;
    if (typeof record.q === "string") return record.q;
  }
  try {
    return JSON.stringify(input);
  } catch {
    return String(input ?? "");
  }
}

function resolveExecutionRole(roles: Record<string, Role>, skillId: string): Role | null {
  const active = Object.values(roles).filter((role) => role.status === "active");
  return active.find((role) => role.skillIds.includes(skillId))
    ?? active.find((role) => role.metadata?.systemRole === "orchestrator")
    ?? null;
}
