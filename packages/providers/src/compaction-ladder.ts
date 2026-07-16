import {
  reduceState,
  type ChatPinnedState,
  type CompactionOperation,
  type MilestoneSummary,
  type StateOperation
} from "@spielos/core";
import { runCompactionPass, type CompactionPass, type CompactionPassOutcome } from "./compaction.ts";
import type { ChatMessage } from "./types.ts";
import type { Model, ModelProvider } from "@spielos/core";
import { capabilitiesForModel } from "@spielos/core";

export type CompactTarget = {
  triggerRatio: number;     // 0.75 — 0.80
  finalRatio: number;       // 0.50 — 0.60
  reservedRatio: number;    // 0.10 — 0.15
};

const DEFAULT_TARGET: CompactTarget = {
  triggerRatio: 0.78,
  finalRatio: 0.55,
  reservedRatio: 0.12
};

export type CompactionLadderResult = {
  state: ChatPinnedState;
  milestones: MilestoneSummary[];
  history: CompactionPassOutcome[];
  initialTokens: number;
  finalTokens: number;
  finalMessages: ChatMessage[];
  overflow: boolean;
  passesRun: number;
  stateOperationsApplied: number;
  stateOperationsRejected: number;
};

function roughTokens(message: ChatMessage): number {
  return Math.ceil(message.content.length / 4) + 4;
}

function tokenCount(messages: ChatMessage[]): number {
  return messages.reduce((sum, message) => sum + roughTokens(message), 0);
}

function passesFor(initialRatio: number, target: CompactTarget): CompactionPass[] {
  if (initialRatio <= target.finalRatio) return [];
  if (initialRatio <= 0.62) return [1];
  if (initialRatio <= 0.78) return [1, 2];
  if (initialRatio <= 0.9) return [1, 2, 3];
  return [1, 2, 3, 4, 5, 6];
}

function keepRecentRatio(pass: CompactionPass): number {
  if (pass === 0) return 1;
  if (pass === 1) return 0.45;
  if (pass === 2) return 0.25;
  if (pass === 3) return 0.1;
  return 0.05;
}

function trimMessages(messages: ChatMessage[], keepRatio: number): ChatMessage[] {
  if (keepRatio >= 1) return messages;
  const keepCount = Math.max(2, Math.floor(messages.length * keepRatio));
  return messages.slice(-keepCount);
}

function applyOperationToState(
  state: ChatPinnedState,
  operations: StateOperation[]
): { state: ChatPinnedState; applied: number; rejected: number } {
  if (operations.length === 0) return { state, applied: 0, rejected: 0 };
  const result = reduceState(state, operations);
  return { state: result.state, applied: result.applied.length, rejected: result.rejected.length };
}

export async function runCompactionLadder(args: {
  provider: ModelProvider;
  model: Model;
  state: ChatPinnedState;
  messages: ChatMessage[];
  previousMilestone: MilestoneSummary | null;
  inputLimit: number;
  systemPromptTokens: number;
  currentUserMessage: ChatMessage;
  target?: Partial<CompactTarget>;
  signal?: AbortSignal;
  onUsage?: (usage: { input: number; output: number }) => void;
  onPassEscalated?: (pass: CompactionPass) => void;
}): Promise<CompactionLadderResult> {
  const target: CompactTarget = { ...DEFAULT_TARGET, ...(args.target ?? {}) };
  const usableInput = Math.max(1024, args.inputLimit - Math.ceil(args.inputLimit * target.reservedRatio));
  const initialMessages = args.messages;
  const initialTokens = tokenCount(initialMessages) + args.systemPromptTokens + roughTokens(args.currentUserMessage);
  const initialRatio = initialTokens / args.inputLimit;
  const usableRatio = usableInput / args.inputLimit;
  const passList = passesFor(initialRatio, target);
  const milestones: MilestoneSummary[] = args.previousMilestone ? [args.previousMilestone] : [];
  const history: CompactionPassOutcome[] = [];
  let workingState = args.state;
  let workingMessages: ChatMessage[] = initialMessages;

  if (initialRatio <= target.triggerRatio) {
    return {
      state: workingState,
      milestones,
      history,
      initialTokens,
      finalTokens: initialTokens,
      finalMessages: workingMessages,
      overflow: false,
      passesRun: 0,
      stateOperationsApplied: 0,
      stateOperationsRejected: 0
    };
  }

  let applied = 0;
  let rejected = 0;
  let overflow = false;

  for (const pass of passList) {
    args.onPassEscalated?.(pass);
    const keepRatio = keepRecentRatio(pass);
    const trimmable = trimMessages(workingMessages, keepRatio);
    const outcome = await runCompactionPass({
      provider: args.provider,
      model: args.model,
      state: workingState,
      recent: trimmable.length === workingMessages.length ? workingMessages.slice(0, -2) : trimmable,
      previousMilestone: milestones.at(-1) ?? null,
      pass,
      signal: args.signal,
      onUsage: args.onUsage
    });
    history.push(outcome);
    if (outcome.operation) {
      const reduced = applyOperationToState(workingState, outcome.operation.stateOperations);
      workingState = reduced.state;
      applied += reduced.applied;
      rejected += reduced.rejected;
      milestones.push(outcome.operation.milestone);
    }
    workingMessages = trimmable;
    const projectedTokens = tokenCount(workingMessages) + args.systemPromptTokens + roughTokens(args.currentUserMessage);
    if (projectedTokens <= args.inputLimit * usableRatio) {
      break;
    }
  }

  const finalTokens = tokenCount(workingMessages) + args.systemPromptTokens + roughTokens(args.currentUserMessage);
  // If we still overflow at pass 6, surface a recoverable overflow
  // signal so the runtime can ask the user to remove context.
  if (finalTokens > args.inputLimit) {
    overflow = true;
  }
  const inputLimit = args.inputLimit;
  void inputLimit;
  void capabilitiesForModel;
  return {
    state: workingState,
    milestones,
    history,
    initialTokens,
    finalTokens,
    finalMessages: workingMessages,
    overflow,
    passesRun: history.length,
    stateOperationsApplied: applied,
    stateOperationsRejected: rejected
  };
}

export function shouldCompact(args: {
  messages: ChatMessage[];
  inputLimit: number;
  systemPromptTokens: number;
  currentUserMessage: ChatMessage;
  target?: Partial<CompactTarget>;
}): boolean {
  const target: CompactTarget = { ...DEFAULT_TARGET, ...(args.target ?? {}) };
  const total = tokenCount(args.messages) + args.systemPromptTokens + roughTokens(args.currentUserMessage);
  return total > args.inputLimit * target.triggerRatio;
}

export function pickCompactionModel(args: { primary: Model; fallback: Model | null }): { model: Model; tier: "primary" | "fallback" | "cheap" } {
  // The plan calls for a medium reliable model for compaction, a strong
  // model for major architecture decisions, and a cheap model for
  // candidate extraction. For MVP, prefer the primary model. If the
  // primary is flagged cheap, allow the user-supplied fallback (if any)
  // so weaker deployments do not have to invent state.
  const capabilities = (args.primary.config?.capabilities as Record<string, unknown> | undefined) ?? {};
  const tier = typeof capabilities.tier === "string" ? capabilities.tier : null;
  if (tier === "cheap" || tier === "small") {
    if (args.fallback) return { model: args.fallback, tier: "fallback" };
    return { model: args.primary, tier: "cheap" };
  }
  return { model: args.primary, tier: "primary" };
}
