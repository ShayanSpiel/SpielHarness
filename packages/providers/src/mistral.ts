import type { ChatAdapter, ChatRequest, ChatResponse } from "./types.ts";

function readSecret(envVar: string, secretRef?: string | null): string {
  if (secretRef) {
    const fromEnv = process.env[secretRef];
    if (fromEnv) return fromEnv;
  }
  return envVar;
}

export const mistralAdapter: ChatAdapter = {
  async chat(req: ChatRequest): Promise<ChatResponse> {
    const apiKey = readSecret(
      process.env.MISTRAL_API_KEY ?? "",
      req.provider.secretRef
    );
    if (!apiKey) {
      throw new Error(
        `Provider "${req.provider.name}" is not configured. Set the MISTRAL_API_KEY environment variable or wire a secretRef.`
      );
    }
    const baseUrl =
      req.provider.baseUrl ??
      process.env.MISTRAL_BASE_URL ??
      "https://api.mistral.ai/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: req.model.model,
        temperature: req.temperature ?? 0.4,
        messages: req.messages,
        ...(req.maxTokens ? { max_tokens: req.maxTokens } : {})
      }),
      signal: req.signal
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `Provider "${req.provider.name}" request failed: ${response.status} ${text}`
      );
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
    const apiKey = readSecret(
      process.env.MISTRAL_API_KEY ?? "",
      req.provider.secretRef
    );
    if (!apiKey) {
      throw new Error(
        `Provider "${req.provider.name}" is not configured. Set the MISTRAL_API_KEY environment variable or wire a secretRef.`
      );
    }
    const baseUrl =
      req.provider.baseUrl ??
      process.env.MISTRAL_BASE_URL ??
      "https://api.mistral.ai/v1";
    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
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
      const text = await response.text().catch(() => "");
      throw new Error(
        `Provider "${req.provider.name}" stream failed: ${response.status} ${text}`
      );
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
        const lines = frame
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line.startsWith("data:"));
        for (const line of lines) {
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const data = JSON.parse(raw) as {
              choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }>;
            };
            const delta = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? "";
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
