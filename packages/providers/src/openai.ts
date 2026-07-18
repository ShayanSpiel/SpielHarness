import type { ChatAdapter, ChatRequest, ChatResponse, ToolSchema } from "./types.ts";
import { readSecret, baseUrlFor, outputTokenConfig, reasoningConfig, textFromProviderContent } from "./types.ts";

type OpenAIToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type OpenAIDeltaToolCall = { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };

function parseToolCalls(toolCalls: OpenAIToolCall[] | undefined): Array<{ name: string; args: string; id: string }> {
  if (!toolCalls?.length) return [];
  return toolCalls.map((tc) => ({ name: tc.function.name, args: tc.function.arguments, id: tc.id }));
}

// OpenAI Chat Completions API. Also used for openai-compatible endpoints.
export const openaiAdapter: ChatAdapter = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.openai.com/v1")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model.model,
      temperature: req.temperature ?? 0.4,
      messages: req.messages,
      ...outputTokenConfig(req),
      ...reasoningConfig(req)
    };
    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = "auto";
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal
    });
    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: OpenAIToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined;
    if (usage) req.onUsage?.(usage);
    const msg = data.choices?.[0]?.message;
    const toolCalls = parseToolCalls(msg?.tool_calls);
    return {
      content: textFromProviderContent(msg?.content).trim(),
      usage,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      raw: data
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse, void> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.openai.com/v1")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model.model,
      temperature: req.temperature ?? 0.4,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...outputTokenConfig(req),
      ...reasoningConfig(req)
    };
    if (req.tools?.length) {
      body.tools = req.tools;
      body.tool_choice = "auto";
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`OpenAI stream failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCallsByName = new Map<number, OpenAIDeltaToolCall>();
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
              choices?: Array<{ delta?: { content?: unknown; tool_calls?: OpenAIDeltaToolCall[] } }>;
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };
            if (data.usage) {
              req.onUsage?.({ input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 });
            }
            const delta = data.choices?.[0]?.delta;
            const deltaContent = textFromProviderContent(delta?.content);
            if (deltaContent) {
              content += deltaContent;
              yield deltaContent;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const existing = toolCallsByName.get(tc.index);
                if (existing?.function) {
                  if (tc.id) existing.id = tc.id;
                  if (tc.type) existing.type = tc.type as "function";
                  if (tc.function?.name) existing.function.name = tc.function.name;
                  if (tc.function?.arguments) existing.function.arguments = (existing.function.arguments ?? "") + tc.function.arguments;
                } else {
                  toolCallsByName.set(tc.index, {
                    index: tc.index,
                    id: tc.id ?? "",
                    type: "function",
                    function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "" }
                  });
                }
              }
            }
          } catch {
            continue;
          }
        }
      }
    }
    const toolCalls = Array.from(toolCallsByName.values())
      .filter((tc): tc is OpenAIDeltaToolCall & { function: { name: string; arguments: string } } => Boolean(tc.function?.name))
      .map((tc) => ({ name: tc.function.name, args: tc.function.arguments, id: tc.id || `call_${tc.index}` }));
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }
};
