import type { Model, ModelProvider } from "@spielos/core";

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
};

export type ChatUsage = { input: number; output: number };

export type ChatResponse = {
  content: string;
  usage?: ChatUsage;
  raw?: unknown;
};

export interface ChatAdapter {
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncGenerator<string, ChatResponse, void>;
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

export function envBaseFor(provider: string): string | null {
  const env = process.env;
  if (provider === "mistral") return env.MISTRAL_BASE_URL?.replace(/\/$/, "") ?? null;
  if (provider === "openai" || provider === "openai-compatible") {
    return env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? null;
  }
  if (provider === "anthropic") return env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") ?? null;
  return null;
}
