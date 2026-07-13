import type { Model, ModelProvider } from "@spielos/core";
import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";
import { mistralAdapter } from "./mistral.ts";
import { openaiAdapter } from "./openai.ts";
import { anthropicAdapter } from "./anthropic.ts";

const REGISTRY: Record<string, ChatAdapter> = {
  mistral: mistralAdapter,
  openai: openaiAdapter,
  "openai-compatible": openaiAdapter,
  anthropic: anthropicAdapter
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
