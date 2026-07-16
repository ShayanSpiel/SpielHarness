import { capabilitiesForModel, type Model, type ModelProvider } from "@spielos/core";
import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";
import { getEncoding, encodingForModel } from "js-tiktoken";
import { openaiAdapter } from "./openai.ts";
import { anthropicAdapter } from "./anthropic.ts";

const REGISTRY: Record<string, ChatAdapter> = {
  "openai-compatible": openaiAdapter,
  anthropic: anthropicAdapter,
  custom: openaiAdapter
};

export function adapterForProvider(provider: ModelProvider | { provider: string }): ChatAdapter {
  const key = ("provider" in provider ? provider.provider : (provider as ModelProvider).provider).toLowerCase();
  const adapter = REGISTRY[key];
  if (!adapter) throw new Error(`No chat adapter is registered for provider "${key}".`);
  return adapter;
}

export async function chat(
  provider: ModelProvider,
  model: Model,
  messages: ChatRequest["messages"],
  opts: Partial<ChatRequest> = {}
): Promise<ChatResponse> {
  return adapterForProvider(provider).chat({
    provider,
    model,
    messages,
    ...opts
  });
}

export async function countInputTokens(req: ChatRequest): Promise<{ count: number; source: "provider" | "tiktoken" | "estimate" }> {
  const adapter = adapterForProvider(req.provider);
  const strategy = capabilitiesForModel(req.model).tokenCounter;
  if (strategy === "provider" && adapter.countTokens) {
    try {
      return { count: await adapter.countTokens(req), source: "provider" };
    } catch {
      // A provider count endpoint may be unavailable for compatible gateways.
    }
  }
  if (strategy !== "estimate") {
    try {
      const encoding = req.provider.provider === "openai-compatible" || req.provider.provider === "custom"
        ? encodingForModel(req.model.model as Parameters<typeof encodingForModel>[0])
        : getEncoding("cl100k_base");
      const count = req.messages.reduce((total, message) => total + 4 + encoding.encode(message.content).length, 2);
      return { count, source: "tiktoken" };
    } catch {
      // Fall through to the conservative estimate.
    }
  }
  const chars = req.messages.reduce((total, message) => total + message.content.length, 0);
  return { count: Math.ceil(chars / 4) + req.messages.length * 4, source: "estimate" };
}

export async function* streamChat(
  provider: ModelProvider,
  model: Model,
  messages: ChatRequest["messages"],
  opts: Partial<ChatRequest> = {}
): AsyncGenerator<string, ChatResponse, void> {
  const adapter = adapterForProvider(provider);
  if (adapter.stream) {
    return yield* adapter.stream({ provider, model, messages, ...opts });
  }
  const response = await adapter.chat({ provider, model, messages, ...opts });
  yield response.content;
  return response;
}
