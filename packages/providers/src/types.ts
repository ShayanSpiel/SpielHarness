import type { Model, ModelProvider } from "@spielos/core";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
};

export type ChatRequest = {
  model: Model;
  provider: ModelProvider;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatResponse = {
  content: string;
  usage?: { input: number; output: number };
  raw?: unknown;
};

export interface ChatAdapter {
  chat(req: ChatRequest): Promise<ChatResponse>;
  stream?(req: ChatRequest): AsyncGenerator<string, ChatResponse, void>;
}
