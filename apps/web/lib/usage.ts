import type { SupabaseClient } from "@supabase/supabase-js";
import type { Model, ModelProvider } from "@spielos/core";

function estimatedTokens(text: string) {
  return Math.max(0, Math.ceil(text.length / 4));
}

export async function recordRunUsage(args: {
  supabase: SupabaseClient;
  orgId: string;
  runId: string;
  provider: ModelProvider | null;
  model: Model | null;
  input: string;
  output: string;
}) {
  if (!args.provider || !args.model) return;
  const inputTokens = estimatedTokens(args.input);
  const outputTokens = estimatedTokens(args.output);
  const inputRate = Number(args.model.config.inputCostMicrosPerMillion ?? 0);
  const outputRate = Number(args.model.config.outputCostMicrosPerMillion ?? 0);
  const costMicros = Math.ceil((inputTokens * inputRate + outputTokens * outputRate) / 1_000_000);
  const { error } = await args.supabase.from("usage_ledger").insert({
    org_id: args.orgId,
    run_id: args.runId,
    provider: args.provider.name,
    model: args.model.model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_micros: costMicros,
    metadata: { estimated: true }
  });
  if (error) throw error;
}
