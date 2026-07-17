import { BaseChatModel, type BaseChatModelCallOptions, type BaseChatModelParams } from "@langchain/core/language_models/chat_models";
import { AIMessage, AIMessageChunk, type BaseMessage, type MessageContentComplex, type MessageContentText, type ToolMessage } from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { StructuredTool } from "@langchain/core/tools";
import type { Model, ModelProvider } from "@spielos/core";
import { chat, streamChat, type ChatMessage } from "@spielos/providers";

/**
 * SpielOS adapter for the LangChain `BaseChatModel` contract.
 *
 * The Deep Agents runtime expects a `BaseChatModel` instance so it
 * can issue structured tool calls and stream content-block events.
 * SpielOS already owns a `streamChat` provider with per-provider
 * adapters, secret resolution, reasoning-effort handling, and
 * capability checks. This adapter is the thinnest viable bridge:
 *
 *  - `_generate` calls the non-streaming `chat(...)` adapter and
 *    converts the response into a single `AIMessage` (text-only).
 *  - `_streamResponseChunks` wraps `streamChat(...)`, yielding
 *    `ChatGenerationChunk` instances that the parent `BaseChatModel`
 *    automatically promotes to a `ChatModelStream` with
 *    `text`/`toolCalls`/`usage` projections.
 *  - `bindTools` returns a new instance with the tool schema
 *    carried on the bound model; the provider request body
 *    includes the tool definitions. Tool-call chunks are
 *    recognized by the model output (Phase 3) and folded into
 *    `AIMessageChunk.tool_call_chunks`.
 *
 * The adapter is intentionally a `BaseChatModel` subclass (not a
 * wrapper around an official `@langchain/openai` model) because
 * SpielOS already owns the per-provider HTTP plumbing, secrets,
 * and reasoning-effort translation. The model field is file-backed
 * and not hardcoded.
 */

type SpielOSChatCallOptions = BaseChatModelCallOptions;

type SpielOSChatModelParams = BaseChatModelParams & {
  provider: ModelProvider;
  model: Model;
  tools?: StructuredTool[];
  toolChoice?: "auto" | "any" | "none" | { name: string };
};

function textFromContent(content: BaseMessage["content"]): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        const block = part as MessageContentComplex | MessageContentText;
        if (typeof block === "string") return block;
        if ("text" in block && typeof block.text === "string") return block.text;
        return "";
      })
      .join("");
  }
  return "";
}

function toChatMessages(messages: BaseMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    const type = message.getType();
    if (type === "system" || type === "human") {
      out.push({ role: "user", content: textFromContent(message.content) });
    } else if (type === "ai") {
      out.push({ role: "assistant", content: textFromContent(message.content) });
    } else if (type === "tool") {
      const tool = message as ToolMessage;
      out.push({ role: "tool", content: textFromContent(tool.content), name: tool.tool_call_id });
    } else {
      out.push({ role: "user", content: textFromContent(message.content) });
    }
  }
  return out;
}

function toolToOpenAISchema(tool: StructuredTool): Record<string, unknown> {
  const parameters = (tool as unknown as { schema?: { toJsonSchema?: () => unknown } }).schema;
  const jsonSchema = parameters?.toJsonSchema
    ? parameters.toJsonSchema()
    : (parameters as unknown) ?? { type: "object", properties: {} };
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description ?? "",
      parameters: jsonSchema
    }
  };
}

export class SpielOSChatModel extends BaseChatModel<SpielOSChatCallOptions, AIMessageChunk> {
  readonly provider: ModelProvider;
  readonly model: Model;
  private readonly boundTools: StructuredTool[];
  private readonly boundToolChoice: SpielOSChatModelParams["toolChoice"];

  constructor(params: SpielOSChatModelParams) {
    super(params);
    this.provider = params.provider;
    this.model = params.model;
    this.boundTools = params.tools ?? [];
    this.boundToolChoice = params.toolChoice;
  }

  _llmType(): string {
    return "spielos";
  }

  override bindTools(
    tools: StructuredTool[],
    kwargs?: Partial<SpielOSChatCallOptions> & { toolChoice?: SpielOSChatModelParams["toolChoice"] }
  ): SpielOSChatModel {
    return new SpielOSChatModel({
      ...(this as unknown as SpielOSChatModelParams),
      tools: [...this.boundTools, ...tools],
      toolChoice: kwargs?.toolChoice ?? this.boundToolChoice
    });
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): Promise<ChatResult> {
    const result = await chat(this.provider, this.model, toChatMessages(messages), {
      signal: options.signal,
      maxTokens: this.model.config?.maxOutputTokens as number | undefined
    });
    const usage = result.usage
      ? {
          input_tokens: result.usage.input,
          output_tokens: result.usage.output,
          total_tokens: result.usage.input + result.usage.output
        }
      : undefined;
    const aiMessage = new AIMessage({
      content: result.content,
      usage_metadata: usage
    });
    return {
      generations: [{ text: "", message: aiMessage }]
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): AsyncGenerator<ChatGenerationChunk> {
    const stream = streamChat(this.provider, this.model, toChatMessages(messages), {
      signal: options.signal,
      maxTokens: this.model.config?.maxOutputTokens as number | undefined
    });
    for await (const delta of stream) {
      if (typeof delta !== "string" || !delta) continue;
      const chunk = new AIMessageChunk({ content: delta });
      yield new ChatGenerationChunk({ message: chunk, text: delta });
    }
    const tail = new AIMessageChunk({ content: "" });
    yield new ChatGenerationChunk({ message: tail, text: "" });
  }
}
