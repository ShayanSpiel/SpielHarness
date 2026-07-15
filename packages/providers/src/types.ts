import { capabilitiesForModel, type Model, type ModelProvider } from "@spielos/core";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type ChatRequest = {
  provider: ModelProvider;
  model: Model;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: ChatUsage) => void;
};

export type ChatUsage = { input: number; output: number };

export type ChatResponse = {
  content: string;
  usage?: ChatUsage;
  raw?: unknown;
};

/**
 * Extract only user-visible text from provider-native content blocks.
 * Providers may return a string, a text block, or an array of blocks. Private
 * reasoning and unknown structured payloads must never be coerced into UI text.
 */
export function textFromProviderContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromProviderContent).join("");
  if (!value || typeof value !== "object") return "";

  const block = value as Record<string, unknown>;
  const type = typeof block.type === "string" ? block.type.toLowerCase() : null;
  const visibleTextType = type === null || type === "text" || type === "output_text";
  if (visibleTextType && typeof block.text === "string") return block.text;
  if (visibleTextType && "content" in block) return textFromProviderContent(block.content);
  return "";
}

export interface ChatAdapter {
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncGenerator<string, ChatResponse, void>;
  countTokens?(req: ChatRequest): Promise<number>;
}

export function readSecret(req: ChatRequest): string {
  const ref = req.provider.secretEnvKey;
  if (ref) {
    const value = process.env[ref];
    if (value) return value;
  }
  const envKey = envKeyFor(req.provider.provider);
  if (envKey) {
    const value = process.env[envKey];
    if (value) return value;
  }
  return "";
}

export function envKeyFor(provider: string): string | null {
  switch (provider) {
    case "mistral":
      return "MISTRAL_API_KEY";
    case "openai":
    case "openai-compatible":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    default:
      return null;
  }
}

export function baseUrlFor(req: ChatRequest, fallback: string): string {
  if (req.provider.baseUrl) return req.provider.baseUrl.replace(/\/$/, "");
  const envBase = envBaseFor(req.provider.provider);
  if (envBase) return envBase;
  return fallback;
}

export function reasoningConfig(req: ChatRequest): Record<string, unknown> {
  const effort = capabilitiesForModel(req.model).reasoningEffort;
  if (effort === "auto") return {};
  if (req.provider.provider === "anthropic") {
    return { output_config: { effort } };
  }
  if (req.provider.provider === "mistral") {
    return { reasoning_effort: effort === "low" ? "none" : "high" };
  }
  return { reasoning_effort: effort === "max" ? "xhigh" : effort };
}

export function outputTokenConfig(req: ChatRequest): Record<string, number> {
  if (!req.maxTokens) return {};
  const parameter = capabilitiesForModel(req.model).outputTokenParameter;
  return { [parameter]: req.maxTokens };
}

export function envBaseFor(provider: string): string | null {
  const env = process.env;
  if (provider === "mistral") return env.MISTRAL_BASE_URL?.replace(/\/$/, "") ?? null;
  if (provider === "openai" || provider === "openai-compatible") {
    return env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? null;
  }
  if (provider === "anthropic") return env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") ?? null;
  return null;
}
