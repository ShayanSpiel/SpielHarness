import { capabilitiesForModel, type Model, type ModelProvider } from "@spielos/core";
import { chat, countInputTokens } from "./registry.ts";
import type { ChatMessage, ChatUsage } from "./types.ts";

export type ConversationCompaction = {
  summary: string;
  compactedMessageCount: number;
  createdAt: string;
};

export type ContextAssembly = {
  messages: ChatMessage[];
  inputTokens: number;
  inputLimit: number;
  tokenCountSource: "provider" | "tiktoken" | "estimate";
  compacted: boolean;
  compaction: ConversationCompaction | null;
  removedMessages: number;
};

export class ContextBudgetError extends Error {}

function roughTokens(message: ChatMessage): number {
  return Math.ceil(message.content.length / 4) + 4;
}

export function chooseRecentMessages(messages: ChatMessage[], budget: number): { kept: ChatMessage[]; removed: ChatMessage[] } {
  const kept: ChatMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const cost = roughTokens(message);
    if (kept.length > 0 && used + cost > budget) break;
    kept.unshift(message);
    used += cost;
  }
  return { kept, removed: messages.slice(0, messages.length - kept.length) };
}

function compactionPrompt(previous: string | null, messages: ChatMessage[]): ChatMessage[] {
  const transcript = messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: [
        "Compact conversation history into durable working context.",
        "Preserve explicit goals, constraints, success criteria, user preferences, decisions and their rationale, completed progress, unresolved issues, and next actions.",
        "Do not invent facts or completion. Separate confirmed facts from uncertainty. Omit stale prose and raw tool output after recording its useful result and provenance.",
        "This summary is conversation context only; never claim it is the canonical run checkpoint or workspace configuration.",
        "Return concise Markdown with the headings Goal, Constraints, Decisions, Progress, Unresolved, Next actions, Preferences, and Provenance."
      ].join("\n")
    },
    {
      role: "user",
      content: `${previous ? `Previous compaction:\n${previous}\n\n` : ""}Messages to compact:\n${transcript}`
    }
  ];
}

export async function assembleConversationContext(args: {
  provider: ModelProvider;
  model: Model;
  system: string;
  history: ChatMessage[];
  previousCompaction?: ConversationCompaction | null;
  onUsage?: (usage: ChatUsage) => void;
  signal?: AbortSignal;
}): Promise<ContextAssembly> {
  const capabilities = capabilitiesForModel(args.model);
  const inputLimit = Math.max(1024, capabilities.contextWindow - capabilities.maxOutputTokens);
  const priorCount = args.previousCompaction?.compactedMessageCount ?? 0;
  const uncompactedHistory = args.history.slice(Math.min(priorCount, args.history.length));
  const prefix: ChatMessage[] = [
    { role: "system", content: args.system },
    ...(args.previousCompaction?.summary
      ? [{ role: "system" as const, content: `# Conversation compaction\n\n${args.previousCompaction.summary}` }]
      : [])
  ];
  const initial = [...prefix, ...uncompactedHistory];

  // First turn (no prior history worth compacting) returns before any token
  // count call. The runtime never blocks the first token on a token-count
  // round-trip when there is nothing to compact.
  if (uncompactedHistory.length <= 1) {
    const estimate = uncompactedHistory.reduce((sum, message) => sum + roughTokens(message), 0) + prefix.reduce((sum, message) => sum + roughTokens(message), 0);
    return {
      messages: initial,
      inputTokens: estimate,
      inputLimit,
      tokenCountSource: "estimate",
      compacted: false,
      compaction: args.previousCompaction ?? null,
      removedMessages: 0
    };
  }

  const initialCount = await countInputTokens({
    provider: args.provider,
    model: args.model,
    messages: initial,
    signal: args.signal
  });
  if (initialCount.count <= inputLimit * capabilities.compactionThreshold) {
    return {
      messages: initial,
      inputTokens: initialCount.count,
      inputLimit,
      tokenCountSource: initialCount.source,
      compacted: false,
      compaction: args.previousCompaction ?? null,
      removedMessages: 0
    };
  }

  const prefixCost = prefix.reduce((sum, message) => sum + roughTokens(message), 0);
  const recentBudget = Math.max(512, Math.floor(inputLimit * 0.45) - prefixCost);
  const { kept, removed } = chooseRecentMessages(uncompactedHistory, recentBudget);
  if (removed.length === 0) {
    throw new ContextBudgetError("Selected instructions and context exceed this model's configured input budget. Remove context or choose a larger model.");
  }

  const compacted = await chat(
    args.provider,
    args.model,
    compactionPrompt(args.previousCompaction?.summary ?? null, removed),
    {
      maxTokens: Math.min(2048, capabilities.maxOutputTokens),
      signal: args.signal,
      onUsage: args.onUsage
    }
  );
  const compaction: ConversationCompaction = {
    summary: compacted.content,
    compactedMessageCount: priorCount + removed.length,
    createdAt: new Date().toISOString()
  };
  const messages: ChatMessage[] = [
    { role: "system", content: args.system },
    { role: "system", content: `# Conversation compaction\n\n${compaction.summary}` },
    ...kept
  ];
  const finalCount = await countInputTokens({
    provider: args.provider,
    model: args.model,
    messages,
    signal: args.signal
  });
  if (finalCount.count > inputLimit) {
    throw new ContextBudgetError("Compacted context still exceeds this model's configured input budget. Remove attached context or choose a larger model.");
  }
  return {
    messages,
    inputTokens: finalCount.count,
    inputLimit,
    tokenCountSource: finalCount.source,
    compacted: true,
    compaction,
    removedMessages: removed.length
  };
}
