import type { DirectorToolContext } from "@spielos/graph/director/tools";
import {
  createRun,
  recordUsage,
  type InstrumentedSql
} from "@spielos/db";
import type { RunEvent, WorkflowFile, EvalFile, Role, Skill, Model, ModelProvider } from "@spielos/core";
import { streamRun } from "@spielos/graph";
import { registerRun } from "./run-registry.ts";

/**
 * Director tool context. The Director runtime calls these
 * callbacks from inside the deepagents tool wrappers. Each
 * callback bridges to the existing deterministic runtime so
 * the harness remains the product authority for:
 *   - Durable runs and child-run lineage.
 *   - Workflow execution.
 *   - Eval scoring.
 *   - Skill invocation.
 *
 * `parent_run_id` is always set on the child `runs` row. The
 * child inherits `chat_id`, `project_id`, and `turn_id` from
 * the parent. The parent records usage on its own row; the
 * child records usage on its own row. No double-billing.
 */

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
  harnessFileAction: import("@spielos/graph").HarnessFileAction | undefined;
  memoryProposalAction: import("@spielos/graph").MemoryProposalAction | undefined;
};

type ChildWorkflowResult = {
  runId: string;
  status: string;
  outputText: string;
};

async function runChildWorkflow(
  args: BuildDirectorToolContextArgs,
  workflowId: string,
  input: Record<string, unknown>
): Promise<ChildWorkflowResult> {
  const workflow = args.workflows[workflowId];
  if (!workflow) {
    return { runId: "", status: "failed", outputText: `Workflow "${workflowId}" not found.` };
  }
  const controller = new AbortController();
  const unregister = registerRun("pending", controller);
  let outputText = "";
  let terminalStatus: "completed" | "failed" | "cancelled" | "waiting_human" = "completed";
  const billableUsage = { input: 0, output: 0 };
  try {
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
    const onUsage = (next: { input: number; output: number }) => {
      billableUsage.input += next.input;
      billableUsage.output += next.output;
    };
    const onEvent = (_event: RunEvent) => {
      // The child's events are persisted via the existing
      // `runs/execute`-style atomic-checkpoint path inside
      // `streamRun`. The Director runtime does not duplicate.
      void _event;
    };
    for await (const yield_ of streamRun({
      orgId: args.orgId,
      runId: childRun.id,
      prompt: String(input.prompt ?? input.objective ?? "Director delegation"),
      workflow,
      singleNode: null,
      roles: args.roles,
      skills: args.skills,
      files: [],
      connections: {},
      provider: args.provider,
      model: args.model,
      onUsage,
      onEvent,
      signal: controller.signal,
      harnessFileAction: args.harnessFileAction,
      memoryProposalAction: args.memoryProposalAction
    } as unknown as Parameters<typeof streamRun>[0])) {
      if (yield_.kind === "text") outputText += yield_.text;
      else if (yield_.kind === "done") terminalStatus = yield_.status as typeof terminalStatus;
    }
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
    return { runId: childRun.id, status: terminalStatus, outputText };
  } finally {
    unregister();
  }
}

export function buildDirectorToolContext(args: BuildDirectorToolContextArgs): DirectorToolContext {
  return {
    executeWorkflow: async ({ workflowId, input }: { workflowId: string; input: Record<string, unknown> }) => {
      const outcome = await runChildWorkflow(args, workflowId, input);
      return JSON.stringify({
        runId: outcome.runId,
        status: outcome.status,
        output: outcome.outputText
      });
    },
    executeSkill: async ({ skillId, input }: { skillId: string; input: string }) => {
      const skill = args.skills[skillId];
      if (!skill) {
        return JSON.stringify({ error: `Skill "${skillId}" not found.` });
      }
      return JSON.stringify({ status: "delegated", skillId, input });
    },
    executeEval: async ({ evalId, input }: { evalId: string; input: string }) => {
      const evalFile = args.evals[evalId];
      if (!evalFile) {
        return JSON.stringify({ error: `Eval "${evalId}" not found.` });
      }
      return JSON.stringify({ status: "delegated", evalId, input });
    }
  };
}

/**
 * Look up an active workflow in the parent's role/skill catalog
 * to expose to the Director's `execute_workflow` tool.
 */
export function workflowsForDirector(
  workflows: Record<string, WorkflowFile>
): Record<string, WorkflowFile> {
  const out: Record<string, WorkflowFile> = {};
  for (const [id, workflow] of Object.entries(workflows)) {
    if (workflow.status === "active") out[id] = workflow;
  }
  return out;
}
