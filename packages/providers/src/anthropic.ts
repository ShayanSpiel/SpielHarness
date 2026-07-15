import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";
import { readSecret, baseUrlFor, reasoningConfig } from "./types.ts";

// Anthropic Messages API.
export const anthropicAdapter: ChatAdapter = {
  async countTokens(req: ChatRequest): Promise<number> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const { system, messages } = splitSystem(req.messages);
    const response = await fetch(`${baseUrlFor(req, "https://api.anthropic.com/v1")}/messages/count_tokens`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ model: req.model.model, system, messages }),
      signal: req.signal
    });
    if (!response.ok) throw new Error(`Anthropic token count failed: ${response.status}`);
    const data = await response.json() as { input_tokens?: number };
    return data.input_tokens ?? 0;
  },
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.anthropic.com/v1")}/messages`;
    const { system, messages } = splitSystem(req.messages);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: req.model.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.4,
        system,
        messages,
        ...reasoningConfig(req)
      }),
      signal: req.signal
    });
    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    const usage = data.usage
      ? { input: data.usage.input_tokens ?? 0, output: data.usage.output_tokens ?? 0 }
      : undefined;
    if (usage) req.onUsage?.(usage);
    return {
      content: text.trim(),
      usage,
      raw: data
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse, void> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.anthropic.com/v1")}/messages`;
    const { system, messages } = splitSystem(req.messages);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: req.model.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.4,
        system,
        messages,
        ...reasoningConfig(req),
        stream: true
      }),
      signal: req.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`Anthropic stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw) as {
            type?: string;
            delta?: { type?: string; text?: string };
            message?: { usage?: { input_tokens?: number; output_tokens?: number } };
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          const usage = data.message?.usage ?? data.usage;
          if (usage && (usage.input_tokens !== undefined || usage.output_tokens !== undefined)) {
            req.onUsage?.({ input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0 });
          }
          if (data.type === "content_block_delta" && data.delta?.text) {
            content += data.delta.text;
            yield data.delta.text;
          }
        } catch {
          continue;
        }
      }
    }
    return { content };
  }
};

function splitSystem(messages: ChatRequest["messages"]): { system: string; messages: Array<{ role: "user" | "assistant"; content: string }> } {
  const systemParts: string[] = [];
  const other: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else if (m.role === "user" || m.role === "assistant") {
      other.push({ role: m.role, content: m.content });
    }
  }
  return { system: systemParts.join("\n\n"), messages: other };
}
