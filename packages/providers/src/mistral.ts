import type { ChatAdapter, ChatRequest, ChatResponse, ToolSchema } from "./types.ts";
import { readSecret, baseUrlFor, reasoningConfig, textFromProviderContent, cleanToolSchema } from "./types.ts";

type MistralToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type MistralDeltaToolCall = { index: number; id?: string; type?: string; function?: { name?: string; arguments?: string } };

export const mistralAdapter: ChatAdapter = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.mistral.ai/v1")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model.model,
      temperature: req.temperature ?? 0.4,
      messages: req.messages,
      ...reasoningConfig(req),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
    };
    if (req.tools?.length) {
      body.tools = req.tools.map(cleanToolSchema);
      body.tool_choice = "auto";
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal
    });
    if (!response.ok) {
      throw new Error(`Mistral request failed: ${response.status} ${await response.text()}`);
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown; tool_calls?: MistralToolCall[] } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage = data.usage
      ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
      : undefined;
    if (usage) req.onUsage?.(usage);
    const msg = data.choices?.[0]?.message;
    const toolCalls = msg?.tool_calls?.length
      ? msg.tool_calls.map((tc) => ({ name: tc.function.name, args: tc.function.arguments, id: tc.id }))
      : undefined;
    return {
      content: textFromProviderContent(msg?.content).trim(),
      usage,
      toolCalls,
      raw: data
    };
  },

  async *stream(req: ChatRequest): AsyncGenerator<string, ChatResponse, void> {
    const apiKey = readSecret(req);
    if (!apiKey) throw new Error(`Provider "${req.provider.name}" has no API key.`);
    const url = `${baseUrlFor(req, "https://api.mistral.ai/v1")}/chat/completions`;
    const body: Record<string, unknown> = {
      model: req.model.model,
      temperature: req.temperature ?? 0.4,
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...reasoningConfig(req),
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
    };
    if (req.tools?.length) {
      body.tools = req.tools.map(cleanToolSchema);
      body.tool_choice = "auto";
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: req.signal
    });
    if (!response.ok || !response.body) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Mistral stream failed: ${response.status} ${errBody}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    const toolCallsByName = new Map<number, MistralDeltaToolCall>();
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
              choices?: Array<{ delta?: { content?: unknown; tool_calls?: MistralDeltaToolCall[] } }>;
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
      .filter((tc): tc is MistralDeltaToolCall & { function: { name: string; arguments: string } } => Boolean(tc.function?.name))
      .map((tc) => ({ name: tc.function.name, args: tc.function.arguments, id: tc.id || `call_${tc.index}` }));
    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined
    };
  }
};
