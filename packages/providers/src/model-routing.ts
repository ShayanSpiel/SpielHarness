import type { Model } from "@spielos/core";

export type ModelRole = "primary" | "compactor" | "extractor" | "fallback";

export type ModelResolution = {
  role: ModelRole;
  model: Model;
  tier: "cheap" | "small" | "primary";
};

export type ResolvedModels = {
  primary: Model;
  compactor: Model;
  extractor: Model;
  fallback: Model | null;
};

const CHEAP_MODEL_HINTS = ["mini", "nano", "haiku", "small", "8b", "flash", "lite"];

export function isCheapModel(model: Model): boolean {
  const capabilities = (model.config?.capabilities as Record<string, unknown> | undefined) ?? {};
  const tier = typeof capabilities.tier === "string" ? capabilities.tier : null;
  if (tier === "cheap" || tier === "small") return true;
  const modelLower = (model.model ?? "").toLowerCase();
  if (CHEAP_MODEL_HINTS.some((hint) => modelLower.includes(hint))) return true;
  return false;
}

export function pickModelForRole(args: {
  primary: Model;
  compactor: Model | null;
  extractor: Model | null;
  fallback: Model | null;
  role: ModelRole;
}): ModelResolution {
  // Resolution order per role:
  // 1. Caller-supplied override (compactor, extractor).
  // 2. Primary model — trusted for normal chat.
  // 3. Fallback model — only if explicitly provided.
  //
  // The "compactor" and "extractor" roles defer to the primary when
  // no override is configured. This keeps the MVP simple; deployments
  // that want a medium-reliable compactor or cheap extractor must
  // pass them in.
  const fallback: ModelResolution | null = args.fallback
    ? { role: "fallback", model: args.fallback, tier: isCheapModel(args.fallback) ? "cheap" : "small" }
    : null;
  const override = args.role === "compactor"
    ? args.compactor
    : args.role === "extractor"
      ? args.extractor
      : null;
  if (override) {
    return {
      role: args.role,
      model: override,
      tier: isCheapModel(override) ? "cheap" : "small"
    };
  }
  if (args.role === "fallback" && fallback) return fallback;
  const tier = isCheapModel(args.primary) ? "cheap" : "primary";
  return { role: args.role, model: args.primary, tier };
}

export function resolveModelRoster(args: { primary: Model; compactor?: Model | null; extractor?: Model | null; fallback?: Model | null }): ResolvedModels {
  return {
    primary: pickModelForRole({ primary: args.primary, compactor: args.compactor ?? null, extractor: args.extractor ?? null, fallback: args.fallback ?? null, role: "primary" }).model,
    compactor: pickModelForRole({ primary: args.primary, compactor: args.compactor ?? null, extractor: args.extractor ?? null, fallback: args.fallback ?? null, role: "compactor" }).model,
    extractor: pickModelForRole({ primary: args.primary, compactor: args.compactor ?? null, extractor: args.extractor ?? null, fallback: args.fallback ?? null, role: "extractor" }).model,
    fallback: args.fallback ?? null
  };
}
