import type { ChatUsage } from "@spielos/providers";

/**
 * Exactly-once usage folding for the Director runtime.
 *
 * The parent Director run records usage once; the deepagents v3
 * values stream surfaces one final `usage_metadata` record for each
 * native AI message. The mapper de-duplicates by message id, while this
 * tracker adds distinct model and subagent calls and emits one billing fold.
 *
 * Subagent usage is folded into the parent once the subagent
 * completes (Phase 3 wires subagent.usage into the same tracker
 * with `mergeFromSubagent`). Workflow child runs record their
 * own usage on the child `runs` row; the parent displays a
 * rolled-up total but the billing ledger is not double-written.
 */

export class DirectorUsageTracker {
  private input = 0;
  private output = 0;
  private folded = false;
  private readonly onFold: (usage: ChatUsage) => void;

  constructor(onFold: (usage: ChatUsage) => void) {
    this.onFold = onFold;
  }

  record(snapshot: { input_tokens?: number; output_tokens?: number } | undefined | null): void {
    if (!snapshot) return;
    if (typeof snapshot.input_tokens === "number") this.input += snapshot.input_tokens;
    if (typeof snapshot.output_tokens === "number") this.output += snapshot.output_tokens;
  }

  /**
   * Merge usage from a completed subagent. The subagent's usage
   * was already counted against the parent's streaming fold, so
   * we do NOT emit a new fold here — we only track it for
   * reporting. The deepagents runtime emits the parent usage
   * exactly once at run completion; the child's `runs` row gets
   * its own `recordUsage` call.
   */
  mergeFromSubagent(snapshot: { input_tokens?: number; output_tokens?: number } | undefined | null): void {
    // No-op for billing. Reserved for future roll-up display.
    void snapshot;
  }

  foldOnce(): ChatUsage {
    if (this.folded) return { input: this.input, output: this.output };
    this.folded = true;
    const usage: ChatUsage = { input: this.input, output: this.output };
    this.onFold(usage);
    return usage;
  }

  snapshot(): ChatUsage {
    return { input: this.input, output: this.output };
  }
}
