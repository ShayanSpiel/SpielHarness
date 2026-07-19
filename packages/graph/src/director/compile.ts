import { createDeepAgent, createSummarizationMiddleware, StateBackend, type SubAgent } from "deepagents";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type ToolMessageFields } from "@langchain/core/messages";
import { tool, type StructuredTool } from "@langchain/core/tools";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { interrupt } from "@langchain/langgraph";
import { z } from "zod";
import { capabilitiesForModel } from "@spielos/core";
import type {
  EvalFile,
  Model,
  ModelProvider,
  Role,
  Skill,
  SuggestedHarnessRef,
  WorkflowFile
} from "@spielos/core";
import { createDirectorModel } from "./model-factory.ts";
import { noopToolContext, type DirectorToolContext } from "./tools.ts";

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
  fallbackPrompt?: string;
  toolContext: DirectorToolContext;
  /**
   * Phase 4: durable checkpointer. When provided, the
   * deep agents runtime writes its state to Postgres and
   * resumes from `runs.checkpoint` on retry. The runtime
   * uses the Director's `runId` as the LangGraph
   * `thread_id` so chat hydration and resume both work.
   */
  checkpointer?: BaseCheckpointSaver | null;
  signal?: AbortSignal;
  maxInputTokens?: number | null;
};

export type DirectorCompileOutput = {
  agent: ReturnType<typeof createDeepAgent>;
  systemPrompt: string;
  model: BaseChatModel | null;
  tools: StructuredTool[];
  subagents: SubAgent[];
};

export function directorCompactionTrigger(input: Pick<DirectorCompileInput, "model" | "maxInputTokens">): number {
  if (!input.model) return 0;
  const capabilities = capabilitiesForModel(input.model);
  const inputLimit = input.maxInputTokens && input.maxInputTokens > 0
    ? input.maxInputTokens
    : capabilities.contextWindow - capabilities.maxOutputTokens;
  return Math.max(1, Math.floor(inputLimit * capabilities.compactionThreshold));
}

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
  directorRoleId: string | null,
  availableTools: StructuredTool[] = []
): SubAgent[] {
  const out: SubAgent[] = [];
  for (const role of Object.values(roles)) {
    if (!role) continue;
    if (role.status !== "active") continue;
    if (role.id === directorRoleId) continue;
    if (role.metadata?.systemRole === "orchestrator") continue;
    const activeSkillIds = role.skillIds.filter((id) => skills[id]?.status === "active");
    const roleTools = availableTools.filter((candidate) =>
      activeSkillIds.some((skillId) => candidate.name === directorSkillToolName(skills[skillId]))
    );
    const interruptOn = Object.fromEntries(
      activeSkillIds
        .map((skillId) => skills[skillId])
        .filter((skill) => skill.sideEffect === "write" || skill.sideEffect === "external")
        .map((skill) => [directorSkillToolName(skill), { allowedDecisions: ["approve", "reject"] as ("approve" | "reject")[] }])
    );
    out.push({
      name: `role_${role.id}`,
      description: role.description?.trim() || role.name,
      systemPrompt: buildDirectorSystemPrompt(role, ""),
      tools: roleTools,
      ...(Object.keys(interruptOn).length > 0 ? { interruptOn } : {})
    });
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
  const names = new Set<string>();

  // execute_workflow (one dynamic tool): iterate active workflows
  // and emit a tool that takes `{ workflowId, input }`. The tool
  // wrapper calls `streamRun` with `parent_run_id` set on the
  // child `runs` row. The tool does NOT write a new `runs` row.
  const activeWorkflows = Object.values(workflows).filter((w) => w.status === "active");
  if (activeWorkflows.length > 0) {
    names.add("execute_workflow");
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
            input: input ?? {}
          });
        },
        {
          name: "execute_workflow",
          description: "Run a saved workflow as a durable child run with parent_run_id lineage.",
          schema: z.object({
            workflowId: z.string().min(1),
            input: z.record(z.string(), z.unknown()).optional().default({})
          })
        }
      )
    );
  }

  // execute_skill (one per active skill).
  for (const skill of Object.values(skills)) {
    if (skill.status !== "active") continue;
    if (skill.kind === "llm_call" || skill.kind === "artifact_create") continue;
    const toolName = directorSkillToolName(skill);
    if (names.has(toolName)) throw new Error(`Director tool name collision: "${toolName}".`);
    names.add(toolName);
    if (skill.kind === "human_input") {
      tools.push(
        tool(
          async ({ input }) => {
            const request = {
              id: `human_${crypto.randomUUID()}`,
              nodeId: "director",
              skillId: skill.id,
              questions: input.questions,
              ...(input.header ? { header: input.header } : {}),
              metadata: { nativeType: "langgraph_interrupt" },
              createdAt: new Date().toISOString()
            };
            const answers = interrupt(request);
            return JSON.stringify({
              status: "completed",
              answers,
              answeredQuestionIds: input.questions.map((question: { id: string }) => question.id),
              instruction: "Human input was received. Continue from these answers and do not ask the same questions again."
            });
          },
          {
            name: toolName,
            description: skill.description?.trim() || skill.name,
            schema: z.object({
              input: z.object({
                header: z.string().min(1).optional(),
                questions: z.array(z.object({
                  id: z.string().min(1),
                  kind: z.enum(["single", "multi", "text", "none"]),
                  question: z.string().min(1),
                  options: z.array(z.object({
                    id: z.string().min(1),
                    label: z.string().min(1),
                    description: z.string().optional()
                  })).optional(),
                  placeholder: z.string().optional(),
                  allowCustom: z.boolean().default(true)
                })).min(1)
              })
            })
          }
        )
      );
      continue;
    }
    const inputSchema = skill.kind === "knowledge_search"
      ? z.object({ query: z.string().min(1) })
      : z.unknown();
    tools.push(
      tool(
        async (params) => {
          return context.executeSkill({
            skillId: skill.id,
            input: params.input
          });
        },
        {
          name: toolName,
          description: skill.description?.trim() || skill.name,
          schema: z.object({ input: inputSchema })
        }
      )
    );
  }

  // execute_eval (one per active eval).
  for (const evalFile of Object.values(evals)) {
    if (evalFile.status !== "active") continue;
    const toolName = directorEvalToolName(evalFile);
    if (names.has(toolName)) throw new Error(`Director tool name collision: "${toolName}".`);
    names.add(toolName);
    tools.push(
      tool(
        async (params) => {
          return context.executeEval({
            evalId: evalFile.id,
            input: params.input
          });
        },
        {
          name: toolName,
          description: `Run the "${evalFile.name}" evaluation.`,
          schema: z.object({ input: z.unknown() })
        }
      )
    );
  }

  return tools;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

export function directorSkillToolName(skill: Skill | undefined): string {
  if (!skill) return "";
  return `execute_skill_${slugify(skill.slug || skill.id)}`;
}

export function directorEvalToolName(evalFile: EvalFile): string {
  return `execute_eval_${slugify(evalFile.name)}`;
}

function suggestedCapabilityPrompt(
  refs: SuggestedHarnessRef[],
  roles: Record<string, Role>,
  skills: Record<string, Skill>,
  workflows: Record<string, WorkflowFile>,
  evals: Record<string, EvalFile>
): string {
  const lines = refs.flatMap((ref) => {
    const item = ref.type === "role" ? roles[ref.id]
      : ref.type === "skill" ? skills[ref.id]
        : ref.type === "workflow" ? workflows[ref.id]
          : evals[ref.id];
    return item ? [`- ${ref.type}: ${"name" in item ? item.name : ref.title ?? ref.id} (${ref.id})`] : [];
  });
  return lines.length > 0
    ? `# Suggested capabilities for this turn\n\nTreat these as user hints, not mandatory topology:\n${lines.join("\n")}`
    : "";
}

export function compileDirector(input: DirectorCompileInput): DirectorCompileOutput {
  if (!input.provider || !input.model) {
    throw new Error("Director runtime requires a configured provider and model.");
  }
  const model = createDirectorModel(input.provider, input.model);
  const compactionTrigger = directorCompactionTrigger(input);
  const basePrompt = buildDirectorSystemPrompt(input.directorRole, input.fallbackPrompt ?? "");
  const suggestionPrompt = suggestedCapabilityPrompt(input.suggestedHarnessRefs, input.roles, input.skills, input.workflows, input.evals);
  const systemPrompt = [basePrompt, suggestionPrompt].filter(Boolean).join("\n\n");
  const availableTools = buildDirectorTools(input.workflows, input.skills, input.evals, input.toolContext ?? noopToolContext());
  const subagents = buildRoleSubagents(input.roles, input.skills, input.directorRole?.id ?? null, availableTools);

  // Keep the Director's provider-facing tool schema intentionally narrow.
  // The file-backed orchestrator role owns its default skills, while explicit
  // turn suggestions opt additional skills/evals into this invocation. Role
  // subagents retain their own file-backed skill sets from `availableTools`.
  // Workflows share one generic runtime tool, so exposing it does not inject a
  // workflow-specific schema for every saved graph.
  const directorToolNames = new Set<string>();
  if (Object.values(input.workflows).some((workflow) => workflow.status === "active")) {
    directorToolNames.add("execute_workflow");
  }
  for (const skillId of input.directorRole?.skillIds ?? []) {
    const skill = input.skills[skillId];
    if (skill?.status === "active") directorToolNames.add(directorSkillToolName(skill));
  }
  for (const ref of input.suggestedHarnessRefs) {
    if (ref.type === "skill") {
      const skill = input.skills[ref.id];
      if (skill?.status === "active") directorToolNames.add(directorSkillToolName(skill));
    } else if (ref.type === "eval") {
      const evalFile = input.evals[ref.id];
      if (evalFile?.status === "active") directorToolNames.add(directorEvalToolName(evalFile));
    }
  }
  const tools = availableTools.filter((candidate) => directorToolNames.has(candidate.name));
  const boundToolNames = new Set(tools.map((candidate) => candidate.name));
  const interruptOn: Record<string, { allowedDecisions: ("approve" | "reject")[]; description: (toolCall: { name: string; args: Record<string, unknown> }) => string }> = {};
  for (const skill of Object.values(input.skills)) {
    if (
      skill.status === "active" &&
      boundToolNames.has(directorSkillToolName(skill)) &&
      (skill.sideEffect === "write" || skill.sideEffect === "external")
    ) {
      const skillName = skill.name;
      interruptOn[directorSkillToolName(skill)] = {
        allowedDecisions: ["approve", "reject"],
        description: () => `Allow "${skillName}"?`
      };
    }
  }
  for (const workflow of Object.values(input.workflows)) {
    const needsApproval = workflow.nodes.some((node) => node.skillIds.some((id) => {
      const skill = input.skills[id];
      return skill?.sideEffect === "write" || skill?.sideEffect === "external";
    }));
    if (needsApproval && boundToolNames.has("execute_workflow")) {
      interruptOn.execute_workflow = {
        allowedDecisions: ["approve", "reject"],
        description: () => "Allow running this workflow?"
      };
    }
  }
  const agent = createDeepAgent({
    model,
    systemPrompt,
    subagents,
    tools,
    ...(Object.keys(interruptOn).length > 0 ? { interruptOn } : {}),
    permissions: [
      { operations: ["write"], paths: ["/artifacts/**"], mode: "allow" },
      { operations: ["write"], paths: ["/workspace/**"], mode: "allow" },
      { operations: ["write"], paths: ["/**"], mode: "deny" }
    ],
    checkpointer: input.checkpointer ?? undefined,
    middleware: [createSummarizationMiddleware({
      model,
      backend: new StateBackend(),
      trigger: { type: "tokens", value: compactionTrigger }
    })]
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
export function historyToMessages(history: Array<{ role: "user" | "assistant" | "system" | "tool"; content: string; name?: string }>) {
  return history.map((message) => {
    if (message.role === "system") return new SystemMessage(message.content);
    if (message.role === "assistant") return new AIMessage(message.content);
    if (message.role === "tool") {
      const toolMsg = new ToolMessage({ content: message.content, tool_call_id: message.name ?? "" } as ToolMessageFields);
      return toolMsg;
    }
    return new HumanMessage(message.content);
  });
}
