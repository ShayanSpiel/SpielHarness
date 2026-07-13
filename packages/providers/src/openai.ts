import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";
import { readSecret, baseUrlFor } from "./types.ts";

// OpenAI Chat Completions API. Also used for openai-compatible endpoints.
export const openaiAdapter: ChatAdapter = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.openai.com/v1")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model.model,
        temperature: req.temperature ?? 0.4,
        messages: req.messages,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
      }),
      signal: req.signal
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content?.trim() ?? "",
      usage: data.usage
        ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
        : undefined,
      raw: data
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse, void> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.openai.com/v1")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: req.model.model,
        temperature: req.temperature ?? 0.4,
        messages: req.messages,
        stream: true,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
      }),
      signal: req.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`OpenAI stream failed: ${response.status}`);
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
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = data.choices?.[0]?.delta?.content ?? "";
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
