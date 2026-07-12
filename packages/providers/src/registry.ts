import type { Model, ModelProvider } from "@spielos/core";
import { mistralAdapter } from "./mistral.ts";
import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";

const REGISTRY: Record<string, ChatAdapter> = {
  mistral: mistralAdapter,
  openai: mistralAdapter,
  "openai-compatible": mistralAdapter
};

export function adapterForProvider(provider: ModelProvider): ChatAdapter {
  const adapter = REGISTRY[provider.kind.toLowerCase()];
  if (!adapter) throw new Error(`No chat adapter is registered for provider kind "${provider.kind}".`);
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
    return yield* adapter.stream({
      provider,
      model,
      messages,
      ...opts
    });
  }
  const response = await adapter.chat({
    provider,
    model,
    messages,
    ...opts
  });
  yield response.content;
  return response;
}
