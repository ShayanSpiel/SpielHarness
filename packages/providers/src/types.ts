import { createDecipheriv, createHash } from "node:crypto";
import { capabilitiesForModel, type Model, type ModelProvider } from "@spielos/core";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type ToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
};

export type ChatRequest = {
  provider: ModelProvider;
  model: Model;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onUsage?: (usage: ChatUsage) => void;
  tools?: ToolSchema[];
};

export type ChatUsage = { input: number; output: number };

export type ChatResponse = {
  content: string;
  usage?: ChatUsage;
  toolCalls?: Array<{ name: string; args: string; id: string }>;
  raw?: unknown;
};

// ── Streaming chunks ────────────────────────────────────────────
export type TextDeltaChunk = { type: "text_delta"; text: string };
export type ToolCallDeltaChunk = {
  type: "tool_call_delta";
  index: number;
  id?: string;
  name?: string;
  argsDelta?: string;
};
export type ToolCallChunk = {
  type: "tool_call";
  index: number;
  id: string;
  name: string;
  args: string;
};
export type UsageChunk = { type: "usage"; usage: ChatUsage };
export type FinishChunk = { type: "finish"; reason?: string };

export type ChatStreamChunk =
  | TextDeltaChunk
  | ToolCallDeltaChunk
  | ToolCallChunk
  | UsageChunk
  | FinishChunk;

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

/**
 * Strip JSON-Schema meta-fields that some providers reject.
 * Mistral returns 400 when `$schema` or `additionalProperties` appear
 * in tool parameter schemas. OpenAI tolerates them; this helper is safe
 * for all providers since those fields are informational only.
 */
export function cleanToolSchema(tool: ToolSchema): ToolSchema {
  const params = tool.function.parameters as Record<string, unknown> | undefined;
  if (!params || typeof params !== "object") return tool;
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "$schema" || k === "additionalProperties") continue;
    cleaned[k] = v;
  }
  return { ...tool, function: { ...tool.function, parameters: cleaned } };
}

function tryDecryptCredential(config: Record<string, unknown>): string | null {
  const encrypted = config.encryptedCredential as string | undefined;
  if (!encrypted) return null;
  try {
    const source =
      process.env.CONNECTION_ENCRYPTION_KEY ||
      (process.env.NODE_ENV !== "production"
        ? process.env.DATABASE_URL || "spielos-dev-fallback"
        : "");
    const key = createHash("sha256").update(source).digest();
    const [iv, tag, ciphertext] = encrypted.split(".");
    if (!iv || !tag || !ciphertext) throw new Error("Invalid encrypted credential");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    const decrypted = JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(ciphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8")
    ) as Record<string, unknown>;
    return (decrypted.apiKey as string | undefined) ?? null;
  } catch {
    return null;
  }
}

export function readSecret(req: ChatRequest): string {
  const config = req.model.config ?? {};
  const fromEncrypted = tryDecryptCredential(config);
  if (fromEncrypted) return fromEncrypted;

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
    case "openai-compatible":
      return "OPENAI_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "mistral":
      return "MISTRAL_API_KEY";
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
  if (req.provider.provider === "custom") {
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
  if (provider === "openai-compatible") {
    return env.OPENAI_BASE_URL?.replace(/\/$/, "") ?? null;
  }
  if (provider === "anthropic") return env.ANTHROPIC_BASE_URL?.replace(/\/$/, "") ?? null;
  if (provider === "mistral") return env.MISTRAL_BASE_URL?.replace(/\/$/, "") ?? null;
  return null;
}
