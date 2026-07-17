import {
  emptyPinnedState,
  stateOperationSchema,
  type ChatPinnedState,
  type StateItem,
  type StateOperation
} from "@spielos/core";
import { chat } from "./registry.ts";
import type { ChatMessage, ChatRequest } from "./types.ts";
import type { Model, ModelProvider } from "@spielos/core";

const STATE_CHANGE_PATTERNS: RegExp[] = [
  // Goal-setting cues
  /\b(let'?s|let us|please|i want to|i need to|i'?d like to|the goal is|our goal is|our objective is|new goal|new objective)\b/i,
  // Decision cues
  /\b(we'?ll use|we will use|we decided|let'?s use|let'?s go with|i'?ll go with|approach:|decision:|decided to|chose|chosen|picking|picked)\b/i,
  // Correction cues
  /\b(no,|actually,|instead,|rather,|on second thought,|let'?s not|don'?t use|stop using|revert|revert back|change (?:that|this) to)\b/i,
  // Completion cues
  /\b(done|finished|completed|shipped|merged|published|deployed|wrote|wrote up|wrapped up|wrapped (?:it|that)|that'?s done)\b/i,
  // Unresolved-task cues
  /\b(todo|to-do|still need to|need to|need a|we still|open question|unresolved|follow up|follow-up|task:|action item)\b/i,
  // Workflow milestone cues
  /\b(milestone|phase|stage|kickoff|next step|moving to|switching to|on to)\b/i
];

/**
 * Cheap state-change detector. Returns true if the latest messages
 * contain heuristics consistent with a goal, decision, correction,
 * completion, unresolved task, or workflow milestone. The check is
 * deliberately lightweight: the goal is to skip the structured
 * extraction call on turns that obviously carry no durable change.
 */
export function detectStateChange(messages: ChatMessage[]): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = message.content;
    if (content.length > 4000) return true; // long assistant answer: re-extract
    for (const pattern of STATE_CHANGE_PATTERNS) {
      if (pattern.test(content)) return true;
    }
    // Limit how far we look back per call.
    if (messages.length - index > 4) return false;
  }
  return false;
}

const EXTRACTION_SYSTEM_PROMPT = `You are a state extractor for a long-running chat. You receive:
1. The current pinned state (a typed, attributable record of goals, decisions, constraints, open work, and references).
2. The recent conversation messages that may contain a state change.

Return ONLY a JSON object matching the schema below. Never invent new fields.

{
  "operations": [
    { "op": "set_goal", "text": "...", "sourceMessageId": "..." },
    { "op": "add_decision", "text": "...", "sourceMessageId": "..." },
    { "op": "supersede_decision", "targetId": "...", "text": "...", "sourceMessageId": "..." },
    { "op": "add_constraint", "text": "...", "sourceMessageId": "..." },
    { "op": "add_open_work", "text": "...", "sourceMessageId": "..." },
    { "op": "complete_work", "targetId": "...", "sourceMessageId": "..." }
  ]
}

Rules:
- Every "text" must be grounded in the recent messages; do not invent.
- Do not supersede user- or workflow-authored decisions; the reducer rejects those.
- Only supersede a model-authored decision when the user clearly changed course.
- Skip "operations" entirely if the recent messages do not change the state.
- "sourceMessageId" must be the id of the user or assistant message that introduced the item.
- Return strict JSON, no Markdown, no commentary.`;

const EXTRACTION_USER_PROMPT = (state: ChatPinnedState, recent: ChatMessage[]): string => {
  const stateJson = JSON.stringify(state, null, 2);
  const recentJson = recent
    .map((message) => `### ${message.role}${message.name ? ` (${message.name})` : ""}\n${message.content}`)
    .join("\n\n");
  return `Current pinned state:\n\`\`\`json\n${stateJson}\n\`\`\`\n\nRecent messages:\n${recentJson}\n\nReturn the operations JSON only.`;
};

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

function findMessageId(content: string, recent: ChatMessage[]): string | null {
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const message = recent[index];
    if (message && message.content === content) {
      return `extract-${index}`;
    }
  }
  return null;
}

export type ExtractionOutcome = {
  operations: StateOperation[];
  rejected: Array<{ op: StateOperation; reason: string }>;
  applied: boolean;
  reason: "extracted" | "no_state_change" | "parse_error" | "api_error";
};

export type ExtractArgs = {
  provider: ModelProvider;
  model: Model;
  state: ChatPinnedState;
  recent: ChatMessage[];
  signal?: AbortSignal;
  onUsage?: (usage: { input: number; output: number }) => void;
};

/**
 * Run the cheap lexical detector first, then structured extraction only
 * when the detector fires. Model tier alone must never disable durable
 * state: the reducer is the authority boundary, and routing extraction
 * to another model requires an explicitly evaluated roster. The
 * extraction model receives the current state and the recent messages
 * and returns bounded operations. The reducer applies them with
 * authority checks; we surface the rejected set so callers can count
 * decision-corruption metrics.
 */
export async function extractStateOperations(args: ExtractArgs): Promise<ExtractionOutcome> {
  if (!detectStateChange(args.recent)) {
    return { operations: [], rejected: [], applied: false, reason: "no_state_change" };
  }
  const messages: ChatRequest["messages"] = [
    { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
    { role: "user", content: EXTRACTION_USER_PROMPT(args.state, args.recent) }
  ];
  let raw: string;
  try {
    const response = await chat(args.provider, args.model, messages, { signal: args.signal, onUsage: args.onUsage });
    raw = response.content;
  } catch {
    return { operations: [], rejected: [], applied: false, reason: "api_error" };
  }
  const payload = extractJsonPayload(raw);
  if (!payload) return { operations: [], rejected: [], applied: false, reason: "parse_error" };
  let parsed: { operations?: unknown };
  try {
    parsed = JSON.parse(payload) as { operations?: unknown };
  } catch {
    return { operations: [], rejected: [], applied: false, reason: "parse_error" };
  }
  const operationsRaw = Array.isArray(parsed.operations) ? parsed.operations : [];
  const operations: StateOperation[] = [];
  for (const candidate of operationsRaw) {
    const result = stateOperationSchema.safeParse(candidate);
    if (result.success) {
      operations.push(result.data);
    }
  }
  // Backfill sourceMessageId for any operation that referenced content
  // we can find in the recent messages.
  for (const op of operations) {
    if ("text" in op && (op.sourceMessageId === "" || op.sourceMessageId === null)) {
      const matched = findMessageId(op.text, args.recent);
      if (matched) op.sourceMessageId = matched;
    }
  }
  return { operations, rejected: [], applied: true, reason: "extracted" };
}

export function summarizeActivePinnedState(state: ChatPinnedState, maxTokens: number = 900): string {
  const lines: string[] = [];
  if (state.primaryGoal) {
    lines.push(`Goal: ${state.primaryGoal.text}`);
  }
  if (state.currentPhase) lines.push(`Current phase: ${state.currentPhase}`);
  for (const constraint of state.constraints.filter((item) => item.status === "active")) {
    lines.push(`- Constraint: ${constraint.text}`);
  }
  for (const decision of state.decisions.filter((item) => item.status === "active")) {
    lines.push(`- Decision: ${decision.text}`);
  }
  for (const work of state.openWork.filter((item) => item.status === "active")) {
    lines.push(`- Open: ${work.text}`);
  }
  for (const criterion of state.successCriteria.filter((item) => item.status === "active")) {
    lines.push(`- Success: ${criterion.text}`);
  }
  const text = lines.join("\n");
  return truncateByTokens(text, maxTokens);
}

function truncateByTokens(text: string, maxTokens: number): string {
  const approxCharBudget = maxTokens * 4;
  if (text.length <= approxCharBudget) return text;
  return `${text.slice(0, approxCharBudget)}\n…`;
}

export function isUserAuthored(item: StateItem): boolean {
  return item.authority === "user";
}

export function ensurePinnedState(value: unknown): ChatPinnedState {
  if (value && typeof value === "object" && "version" in value) {
    return value as ChatPinnedState;
  }
  return emptyPinnedState(new Date(0).toISOString());
}
