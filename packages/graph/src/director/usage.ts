/**
 * Pure accumulator for Director runtime usage.
 *
 * Records per-AI-message input/output token deltas. The caller invokes
 * `onModelUsage` directly per deduplicated AI message — this class has
 * no cumulative reporting side effect.
 *
 * Subagent usage is folded into the same record() call (scope is a
 * property of the onModelUsage callback, not of this tracker).
 * Durable child workflow runs retain their own usage_ledger rows and
 * must not also be folded into parent billing.
 */

export class DirectorUsageTracker {
  private input = 0;
  private output = 0;

  seed(totals: { input: number; output: number }): void {
    this.input = totals.input;
    this.output = totals.output;
  }

  record(snapshot: { input_tokens?: number; output_tokens?: number } | undefined | null): void {
    if (!snapshot) return;
    if (typeof snapshot.input_tokens === "number") this.input += snapshot.input_tokens;
    if (typeof snapshot.output_tokens === "number") this.output += snapshot.output_tokens;
  }

  mergeFromSubagent(_snapshot: { input_tokens?: number; output_tokens?: number } | undefined | null): void {
    // No-op for billing. Reserved for future roll-up display.
  }

  snapshot(): { input: number; output: number } {
    return { input: this.input, output: this.output };
  }
}
