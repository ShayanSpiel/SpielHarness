import { createDeepAgent, type SubAgent } from "deepagents";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Role, Model, ModelProvider, SuggestedHarnessRef } from "@spielos/core";
import { SpielOSChatModel } from "./chat-model.ts";

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
  provider: ModelProvider | null;
  model: Model | null;
  suggestedHarnessRefs: SuggestedHarnessRef[];
  signal?: AbortSignal;
};

export type DirectorCompileOutput = {
  agent: ReturnType<typeof createDeepAgent>;
  systemPrompt: string;
  model: SpielOSChatModel | null;
};

export function buildDirectorSystemPrompt(role: Role | null, fallback: string): string {
  if (!role) return fallback;
  const sections: string[] = [];
  if (role.prompt) sections.push(role.prompt);
  if (role.inputContract?.body) sections.push(`# Input contract (${role.inputContract.name})\n\n${role.inputContract.body}`);
  if (role.outputContract?.body) sections.push(`# Output contract (${role.outputContract.name})\n\n${role.outputContract.body}`);
  return sections.length > 0 ? sections.join("\n\n") : fallback;
}

export function compileDirector(input: DirectorCompileInput): DirectorCompileOutput {
  if (!input.provider || !input.model) {
    throw new Error("Director runtime requires a configured provider and model.");
  }
  const model = new SpielOSChatModel({ provider: input.provider, model: input.model });
  const systemPrompt = buildDirectorSystemPrompt(input.directorRole, "You are the SpielOS Director.");
  const subagents: SubAgent[] = [];
  // Phase 3 will populate this with file-backed Role subagents
  // and the orchestrator. For Phase 2 the general-purpose
  // subagent is the only delegate, and it inherits the parent's
  // tools (none yet in Phase 2).
  void input.suggestedHarnessRefs;
  const agent = createDeepAgent({
    model,
    systemPrompt,
    subagents
    // No checkpointer here — the durable checkpointer ships in
    // Phase 4 (PostgresSaver wired into this constructor).
  });
  return { agent, systemPrompt, model };
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
