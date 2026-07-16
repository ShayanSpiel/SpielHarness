import { createHash } from "node:crypto";
import { createModel, listModels, type ModelRow, type Sql } from "@spielos/db";
import type { ModelCapabilities, ModelProvider } from "@spielos/core";

type EnvironmentModel = {
  provider: ModelProvider["provider"];
  name: string;
  model: string;
  secretEnvKey: string;
  baseUrl: string | null;
  capabilities: ModelCapabilities;
};

function numberFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function stableUuid(value: string): string {
  const chars = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function reasoningFromEnv(prefix: string, fallback: ModelCapabilities["reasoningEffort"]): ModelCapabilities["reasoningEffort"] {
  const configured = process.env[`${prefix}_REASONING_EFFORT`]?.trim().toLowerCase();
  return configured && ["auto", "low", "medium", "high", "xhigh", "max"].includes(configured)
    ? configured as ModelCapabilities["reasoningEffort"]
    : fallback;
}

function capabilities(
  prefix: string,
  contextWindow: number,
  maxOutputTokens: number,
  reasoningEffort: ModelCapabilities["reasoningEffort"] = "auto"
): ModelCapabilities {
  return {
    contextWindow: numberFromEnv(`${prefix}_CONTEXT_WINDOW`, contextWindow),
    maxOutputTokens: numberFromEnv(`${prefix}_MAX_OUTPUT_TOKENS`, maxOutputTokens),
    compactionThreshold: 0.8,
    tokenCounter: "provider",
    toolCalling: true,
    parallelToolCalling: true,
    reasoningSummaries: false,
    providerCompaction: false,
    reasoningEffort: reasoningFromEnv(prefix, reasoningEffort),
    outputTokenParameter: prefix === "OPENAI" ? "max_completion_tokens" : "max_tokens"
  };
}

export function environmentModelDefaults(): EnvironmentModel[] {
  const defaults: EnvironmentModel[] = [];
  if (process.env.MISTRAL_API_KEY) {
    defaults.push({
      provider: "openai-compatible",
      name: process.env.MISTRAL_MODEL_NAME?.trim() || "Mistral",
      model: process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest",
      secretEnvKey: "MISTRAL_API_KEY",
      baseUrl: process.env.MISTRAL_BASE_URL?.trim() || null,
      capabilities: capabilities("MISTRAL", 128_000, 8_192)
    });
    defaults.push({
      provider: "openai-compatible",
      name: process.env.MISTRAL_MEDIUM_MODEL_NAME?.trim() || "Mistral Medium 3.5",
      model: process.env.MISTRAL_MEDIUM_MODEL?.trim() || "mistral-medium-3-5",
      secretEnvKey: "MISTRAL_API_KEY",
      baseUrl: process.env.MISTRAL_BASE_URL?.trim() || null,
      capabilities: capabilities("MISTRAL_MEDIUM", 256_000, 32_768, "high")
    });
  }
  if (process.env.OPENAI_API_KEY) {
    defaults.push({
      provider: "openai-compatible",
      name: process.env.OPENAI_MODEL_NAME?.trim() || "OpenAI",
      model: process.env.OPENAI_MODEL?.trim() || "gpt-5.1",
      secretEnvKey: "OPENAI_API_KEY",
      baseUrl: process.env.OPENAI_BASE_URL?.trim() || null,
      capabilities: capabilities("OPENAI", 400_000, 32_768)
    });
  }
  if (process.env.ANTHROPIC_API_KEY) {
    defaults.push({
      provider: "anthropic",
      name: process.env.ANTHROPIC_MODEL_NAME?.trim() || "Claude",
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5",
      secretEnvKey: "ANTHROPIC_API_KEY",
      baseUrl: process.env.ANTHROPIC_BASE_URL?.trim() || null,
      capabilities: capabilities("ANTHROPIC", 200_000, 64_000)
    });
  }
  return defaults;
}

export async function listModelsWithEnvironmentDefaults(sql: Sql, orgId: string): Promise<ModelRow[]> {
  const rows = await listModels(sql, orgId);
  const defaults = environmentModelDefaults();
  for (const model of defaults) {
    if (rows.some((row) => row.provider === model.provider && row.model === model.model)) continue;
    const created = await createModel(sql, orgId, {
      id: stableUuid(`${orgId}:environment-model:${model.provider}:${model.model}`),
      name: model.name,
      provider: model.provider,
      model: model.model,
      baseUrl: model.baseUrl,
      secretEnvKey: model.secretEnvKey,
      config: { source: "environment", capabilities: model.capabilities },
      enabled: true
    });
    rows.push(created);
  }
  return rows;
}
