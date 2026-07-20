import { createHash } from "node:crypto";
import { ensureEnvironmentModels, listModels, type ModelRow, type Sql } from "@spielos/db";
import { stableUuid } from "@spielos/core/node";
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
    outputTokenParameter: prefix === "OPENAI" ? "max_completion_tokens" : "max_tokens",
    toolCallMetadata: "normalized"
  };
}

export function environmentModelDefaults(): EnvironmentModel[] {
  const defaults: EnvironmentModel[] = [];
  if (process.env.MISTRAL_API_KEY) {
    defaults.push({
      provider: "mistral",
      name: process.env.MISTRAL_MODEL_NAME?.trim() || "Mistral",
      model: process.env.MISTRAL_MODEL?.trim() || "mistral-small-latest",
      secretEnvKey: "MISTRAL_API_KEY",
      baseUrl: process.env.MISTRAL_BASE_URL?.trim() || null,
      capabilities: capabilities("MISTRAL", 128_000, 8_192)
    });
    defaults.push({
      provider: "mistral",
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

const modelCache = new Map<string, {
  revision: string;
  rows: ModelRow[];
  refreshedAt: number;
  stale: boolean;
  refreshInFlight: boolean;
}>();
const MODEL_CACHE_FRESH_MS = 30_000;
const MODEL_CACHE_HARD_MS = 5 * 60 * 1000;
const modelCacheTimers = new Map<string, NodeJS.Timeout>();

function environmentRevision(defaults: EnvironmentModel[]): string {
  const material = defaults.map((model) => `${model.provider}:${model.model}:${model.secretEnvKey}:${model.baseUrl ?? ""}`).join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function clearModelCacheTimer(orgId: string) {
  const timer = modelCacheTimers.get(orgId);
  if (timer) {
    clearTimeout(timer);
    modelCacheTimers.delete(orgId);
  }
}

function scheduleHardExpire(orgId: string) {
  clearModelCacheTimer(orgId);
  modelCacheTimers.set(
    orgId,
    setTimeout(() => {
      modelCache.delete(orgId);
      modelCacheTimers.delete(orgId);
    }, MODEL_CACHE_HARD_MS)
  );
}

async function refreshModelCache(sql: Sql, orgId: string): Promise<void> {
  const entry = modelCache.get(orgId);
  if (!entry || entry.refreshInFlight) return;
  entry.refreshInFlight = true;
  try {
    const defaults = environmentModelDefaults();
    const revision = environmentRevision(defaults);
    await ensureEnvironmentModels(
      sql,
      orgId,
      defaults.map((model) => ({
        id: stableUuid(`${orgId}:environment-model:${model.provider}:${model.model}`),
        name: model.name,
        provider: model.provider,
        model: model.model,
        baseUrl: model.baseUrl,
        secretEnvKey: model.secretEnvKey,
        config: { source: "environment", capabilities: model.capabilities },
        enabled: true
      }))
    );
    const rows = await listModels(sql, orgId);
    modelCache.set(orgId, {
      revision,
      rows,
      refreshedAt: Date.now(),
      stale: false,
      refreshInFlight: false
    });
    scheduleHardExpire(orgId);
  } catch (err) {
    const current = modelCache.get(orgId);
    if (current) {
      current.refreshInFlight = false;
      current.stale = true;
    }
    console.warn(`[models] background refresh failed for org ${orgId}:`, err instanceof Error ? err.message : err);
  }
}

export function invalidateModelCache(orgId?: string) {
  if (orgId) {
    modelCache.delete(orgId);
    clearModelCacheTimer(orgId);
  } else {
    modelCache.clear();
    for (const id of [...modelCacheTimers.keys()]) clearModelCacheTimer(id);
  }
}

export async function listModelsWithEnvironmentDefaults(sql: Sql, orgId: string): Promise<ModelRow[]> {
  const defaults = environmentModelDefaults();
  const revision = environmentRevision(defaults);
  const now = Date.now();
  const cached = modelCache.get(orgId);

  if (cached && cached.revision === revision) {
    const age = now - cached.refreshedAt;
    if (!cached.stale) {
      if (age >= MODEL_CACHE_FRESH_MS) {
        cached.stale = true;
        void refreshModelCache(sql, orgId);
      }
      return cached.rows;
    }
    // Stale: serve the previous value, kick a background refresh, do not await.
    void refreshModelCache(sql, orgId);
    return cached.rows;
  }

  // Cold load: no entry or env revision changed.
  await ensureEnvironmentModels(
    sql,
    orgId,
    defaults.map((model) => ({
      id: stableUuid(`${orgId}:environment-model:${model.provider}:${model.model}`),
      name: model.name,
      provider: model.provider,
      model: model.model,
      baseUrl: model.baseUrl,
      secretEnvKey: model.secretEnvKey,
      config: { source: "environment", capabilities: model.capabilities },
      enabled: true
    }))
  );
  const rows = await listModels(sql, orgId);
  modelCache.set(orgId, {
    revision,
    rows,
    refreshedAt: now,
    stale: false,
    refreshInFlight: false
  });
  scheduleHardExpire(orgId);
  return rows;
}
