import {
  capabilitiesForModel,
  reduceState,
  type ChatPinnedState,
  type MilestoneSummary,
  type StateOperation
} from "@spielos/core";
import { extractStateOperations, summarizeActivePinnedState, ensurePinnedState } from "./state-extract.ts";
import { runCompactionLadder, pickCompactionModel } from "./compaction-ladder.ts";
import type { ChatMessage, ChatRequest } from "./types.ts";
import type { Model, ModelProvider } from "@spielos/core";

export type LongHorizonInput = {
  provider: ModelProvider;
  model: Model;
  fallbackModel: Model | null;
  state: ChatPinnedState;
  previousMilestone: MilestoneSummary | null;
  history: ChatMessage[];
  systemPrompt: string;
  currentUserMessage: ChatMessage;
  inputLimit: number;
  signal?: AbortSignal;
  onUsage?: (usage: { input: number; output: number }) => void;
  onCompactionStart?: (pass: number) => void;
  onPinnedStateUpdated?: (state: ChatPinnedState) => void;
  onMilestoneCreated?: (milestone: MilestoneSummary) => void;
  onOverflow?: (info: { finalTokens: number; inputLimit: number }) => void;
};

export type LongHorizonResult = {
  system: string;
  history: ChatMessage[];
  state: ChatPinnedState;
  milestone: MilestoneSummary | null;
  newMilestones: MilestoneSummary[];
  compacted: boolean;
  passesRun: number;
  appliedOperations: number;
  rejectedOperations: number;
  overflow: boolean;
  initialTokens: number;
  finalTokens: number;
  stateChangeDetected: boolean;
  extractionAttempted: boolean;
};

/**
 * Long-horizon context assembly. The runtime calls this once per
 * turn, after the run is created and before the model streams.
 *
 * The function performs three things in order:
 * 1. Cheap state-change detection + (when warranted) structured
 *    operation extraction. Extracted operations are applied via the
 *    deterministic reducer in `@spielos/core`. Model authority cannot
 *    supersede user- or workflow-authoritative items.
 * 2. Pinned state is summarized and prepended to the system prompt
 *    when the budget allows. Token estimates are computed at render
 *    time; we do not persist stale estimates.
 * 3. If the assembled history still exceeds the trigger ratio, the
 *    multi-pass compaction ladder walks passes 1..6 and returns the
 *    trimmed history plus the latest milestone.
 *
 * The function never blocks the model call when the current turn
 * already fits; passes only run when `shouldCompact` is true.
 */
export async function assembleLongHorizonContext(args: LongHorizonInput): Promise<LongHorizonResult> {
  const initialState = ensurePinnedState(args.state);
  const systemPromptTokens = Math.ceil(args.systemPrompt.length / 4) + 4;

  const extraction = await extractStateOperations({
    provider: args.provider,
    model: args.model,
    state: initialState,
    recent: args.history.slice(-6).concat([args.currentUserMessage]),
    signal: args.signal,
    onUsage: args.onUsage
  });

  let workingState: ChatPinnedState = initialState;
  let appliedOperations = 0;
  let rejectedOperations = 0;
  if (extraction.applied && extraction.operations.length > 0) {
    try {
      const reduced = reduceState(workingState, extraction.operations, { expectedVersion: initialState.version });
      workingState = reduced.state;
      appliedOperations = reduced.applied.length;
      rejectedOperations = reduced.rejected.length;
      args.onPinnedStateUpdated?.(workingState);
    } catch {
      // The reducer threw StateVersionMismatch; leave the state alone
      // and let the next turn re-try.
    }
  }

  const compacted = await runCompactionLadder({
    provider: args.provider,
    model: pickCompactionModel({ primary: args.model, fallback: args.fallbackModel }).model,
    state: workingState,
    messages: args.history,
    previousMilestone: args.previousMilestone,
    inputLimit: args.inputLimit,
    systemPromptTokens,
    currentUserMessage: args.currentUserMessage,
    signal: args.signal,
    onUsage: args.onUsage,
    onPassEscalated: (pass) => args.onCompactionStart?.(pass)
  });

  if (compacted.state !== workingState) {
    args.onPinnedStateUpdated?.(compacted.state);
  }
  const newMilestones = compacted.milestones.slice(args.previousMilestone ? 1 : 0);
  for (const milestone of newMilestones) {
    args.onMilestoneCreated?.(milestone);
  }
  if (compacted.overflow) {
    args.onOverflow?.({ finalTokens: compacted.finalTokens, inputLimit: args.inputLimit });
  }
  appliedOperations += compacted.stateOperationsApplied;
  rejectedOperations += compacted.stateOperationsRejected;

  const pinnedSummary = summarizeActivePinnedState(compacted.state, 600);
  const system = pinnedSummary
    ? `${args.systemPrompt}\n\n# Working state (application-owned; never replace)\n\n${pinnedSummary}`
    : args.systemPrompt;

  return {
    system,
    history: compacted.finalMessages,
    state: compacted.state,
    milestone: compacted.milestones.at(-1) ?? null,
    newMilestones,
    compacted: compacted.passesRun > 0,
    passesRun: compacted.passesRun,
    appliedOperations,
    rejectedOperations,
    overflow: compacted.overflow,
    initialTokens: compacted.initialTokens,
    finalTokens: compacted.finalTokens,
    stateChangeDetected: extraction.reason !== "no_state_change",
    extractionAttempted: extraction.applied
  };
}

export function estimateHistoryTokens(history: ChatMessage[]): number {
  return history.reduce((sum, message) => sum + Math.ceil(message.content.length / 4) + 4, 0);
}

export type ModelCapabilitiesView = ReturnType<typeof capabilitiesForModel>;

export function projectedContextTokens(args: {
  systemPrompt: string;
  history: ChatMessage[];
  currentUserMessage: ChatMessage;
  model: Model;
}): { tokens: number; limit: number; ratio: number } {
  const capabilities = capabilitiesForModel(args.model);
  const limit = Math.max(1024, capabilities.contextWindow - capabilities.maxOutputTokens);
  const systemTokens = Math.ceil(args.systemPrompt.length / 4) + 4;
  const historyTokens = estimateHistoryTokens(args.history);
  const currentTokens = Math.ceil(args.currentUserMessage.content.length / 4) + 4;
  const tokens = systemTokens + historyTokens + currentTokens;
  return { tokens, limit, ratio: tokens / limit };
}

export function applyOperationsToState(args: {
  state: ChatPinnedState;
  operations: StateOperation[];
}): { state: ChatPinnedState; applied: number; rejected: number } {
  if (args.operations.length === 0) return { state: args.state, applied: 0, rejected: 0 };
  const result = reduceState(args.state, args.operations);
  return { state: result.state, applied: result.applied.length, rejected: result.rejected.length };
}

export type AssembledChatRequest = ChatRequest;
