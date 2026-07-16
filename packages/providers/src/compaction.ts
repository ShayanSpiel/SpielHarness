import {
  compactionOperationSchema,
  emptyPinnedState,
  type ChatPinnedState,
  type CompactionOperation,
  type MilestoneSummary,
  type StateOperation
} from "@spielos/core";
import { chat } from "./registry.ts";
import type { ChatMessage, ChatRequest } from "./types.ts";
import type { Model, ModelProvider } from "@spielos/core";
export { isCheapModel } from "./model-routing.ts";

export type CompactionPass = 0 | 1 | 2 | 3 | 4 | 5 | 6;

const COMPACTION_SYSTEM_PROMPT = `You are a compaction agent for a long-running chat. You receive:
1. The current pinned state (typed goals, decisions, constraints, open work, success criteria, references).
2. Recent messages that are about to be removed from the active context.
3. The prior milestone summary, if any, so you can chain to it.

Return ONLY a JSON object matching the schema:

{
  "stateOperations": [
    { "op": "set_goal", "text": "...", "sourceMessageId": "..." },
    { "op": "add_decision", "text": "...", "sourceMessageId": "..." },
    { "op": "supersede_decision", "targetId": "...", "text": "...", "sourceMessageId": "..." },
    { "op": "add_constraint", "text": "...", "sourceMessageId": "..." },
    { "op": "add_open_work", "text": "...", "sourceMessageId": "..." },
    { "op": "complete_work", "targetId": "...", "sourceMessageId": "..." }
  ],
  "milestone": {
    "id": "...",
    "title": "...",
    "summary": "...",
    "decisionsMade": ["..."],
    "workCompleted": ["..."],
    "unresolvedItems": ["..."],
    "sourceMessageIds": ["..."],
    "createdAt": "..."
  }
}

Rules:
- Only emit operations you can ground in the supplied messages.
- Never supersede user- or workflow-authored items; the reducer rejects them.
- "summary" must be a concise narrative; do not paste raw tool output.
- Return strict JSON. No Markdown, no commentary.`;

function compactionUserPrompt(args: {
  state: ChatPinnedState;
  recent: ChatMessage[];
  previousMilestone: MilestoneSummary | null;
  pass: CompactionPass;
}): string {
  const parts: string[] = [];
  parts.push(`Pass ${args.pass}. Current pinned state:`);
  parts.push("```json");
  parts.push(JSON.stringify(args.state, null, 2));
  parts.push("```");
  if (args.previousMilestone) {
    parts.push("Prior milestone summary (do not duplicate verbatim, but you may chain to it):");
    parts.push("```json");
    parts.push(JSON.stringify(args.previousMilestone, null, 2));
    parts.push("```");
  }
  parts.push("Recent messages being compacted away:");
  for (const message of args.recent) {
    parts.push(`### ${message.role}${message.name ? ` (${message.name})` : ""}\n${message.content}`);
  }
  parts.push("Return the operations + milestone JSON only.");
  return parts.join("\n\n");
}

function extractJsonPayload(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    let depth = 0;
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) return trimmed.slice(0, index + 1);
      }
    }
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return extractJsonPayload(fenced[1]);
  return null;
}

export type CompactionPassOutcome = {
  pass: CompactionPass;
  operation: CompactionOperation | null;
  rawTokens: number;
  reason?: "api_error" | "parse_error" | "validation_error" | "empty_response";
};

function roughTokens(message: ChatMessage): number {
  return Math.ceil(message.content.length / 4) + 4;
}

function summarizeMessages(messages: ChatMessage[], maxTokens: number): string {
  const lines = messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");
  const charBudget = maxTokens * 4;
  if (lines.length <= charBudget) return lines;
  return `${lines.slice(0, charBudget)}\n…`;
}

function roughTotalTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + roughTokens(message), 0);
}

export async function runCompactionPass(args: {
  provider: ModelProvider;
  model: Model;
  state: ChatPinnedState;
  recent: ChatMessage[];
  previousMilestone: MilestoneSummary | null;
  pass: CompactionPass;
  signal?: AbortSignal;
  onUsage?: (usage: { input: number; output: number }) => void;
}): Promise<CompactionPassOutcome> {
  const rawTokens = roughTotalTokens(args.recent);
  if (args.recent.length === 0) {
    return { pass: args.pass, operation: null, rawTokens, reason: "empty_response" };
  }
  // At later passes we summarize the messages first to keep the
  // extraction prompt itself within budget; the compactor receives the
  // summary plus the typed state.
  const maxPromptTokens = Math.max(512, Math.floor(args.pass >= 3 ? 1024 : 1536));
  const summary = summarizeMessages(args.recent, maxPromptTokens);
  const messages: ChatRequest["messages"] = [
    { role: "system", content: COMPACTION_SYSTEM_PROMPT },
    {
      role: "user",
      content: compactionUserPrompt({
        state: args.state,
        recent: [{ role: "user", content: summary }],
        previousMilestone: args.previousMilestone,
        pass: args.pass
      })
    }
  ];
  let raw: string;
  try {
    const response = await chat(args.provider, args.model, messages, { signal: args.signal, onUsage: args.onUsage });
    raw = response.content;
  } catch {
    return { pass: args.pass, operation: null, rawTokens, reason: "api_error" };
  }
  const payload = extractJsonPayload(raw);
  if (!payload) return { pass: args.pass, operation: null, rawTokens, reason: "parse_error" };
  let parsed: { operations?: unknown; milestone?: unknown; stateOperations?: unknown };
  try {
    parsed = JSON.parse(payload) as { operations?: unknown; milestone?: unknown; stateOperations?: unknown };
  } catch {
    return { pass: args.pass, operation: null, rawTokens, reason: "parse_error" };
  }
  const candidate = {
    stateOperations: Array.isArray(parsed.stateOperations)
      ? parsed.stateOperations
      : Array.isArray(parsed.operations)
        ? parsed.operations
        : [],
    milestone: parsed.milestone
  };
  const result = compactionOperationSchema.safeParse(candidate);
  if (!result.success) {
    return { pass: args.pass, operation: null, rawTokens, reason: "validation_error" };
  }
  return { pass: args.pass, operation: result.data, rawTokens };
}

export function emptyMilestoneState(): { state: ChatPinnedState; milestone: MilestoneSummary | null } {
  return { state: emptyPinnedState(), milestone: null };
}
