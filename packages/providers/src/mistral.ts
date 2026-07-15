import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";
import { readSecret, baseUrlFor, reasoningConfig, textFromProviderContent } from "./types.ts";

export const mistralAdapter: ChatAdapter = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.mistral.ai/v1")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model.model,
        temperature: req.temperature ?? 0.4,
        messages: req.messages,
        ...reasoningConfig(req),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
      }),
      signal: req.signal
    });
    if (!response.ok) {
      throw new Error(`Mistral request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined;
    if (usage) req.onUsage?.(usage);
    return {
      content: textFromProviderContent(data.choices?.[0]?.message?.content).trim(),
      usage,
      raw: data
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse, void> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.mistral.ai/v1")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model.model,
        temperature: req.temperature ?? 0.4,
        messages: req.messages,
        stream: true,
        stream_options: { include_usage: true },
        ...reasoningConfig(req),
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
      }),
      signal: req.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`Mistral stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        for (const line of frame.split("\n")) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const data = JSON.parse(raw) as {
              choices?: Array<{ delta?: { content?: unknown } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (data.usage) {
              req.onUsage?.({ input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 });
            }
            const delta = textFromProviderContent(data.choices?.[0]?.delta?.content);
            if (!delta) continue;
            content += delta;
            yield delta;
          } catch {
            continue;
          }
        }
      }
    }
    return { content };
  }
};
