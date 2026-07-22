import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatGenerationChunk, ChatResult } from "@langchain/core/outputs";
import { ChatOpenAI } from "@langchain/openai";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatAnthropic } from "@langchain/anthropic";
import { capabilitiesForModel, type Model, type ModelProvider } from "@spielos/core";
import { envBaseFor, readSecret } from "@spielos/providers";

/** Director uses official LangChain adapters while sharing the canonical
 * provider credential and base-URL resolution policy with Direct mode. */
function baseUrlForProvider(provider: ModelProvider): string | undefined {
  if (provider.baseUrl) return provider.baseUrl.replace(/\/$/, "");
  return envBaseFor(provider.provider) ?? undefined;
}

/**
 * Map a SpielOS provider identifier to the provider-specific
 * key of the official LangChain adapter class.
 */
type LangChainProviderKey = "openai" | "anthropic" | "mistral";
type OutputTokenParameter = "max_tokens" | "max_completion_tokens";

function providerKey(provider: ModelProvider): LangChainProviderKey {
  switch (provider.provider) {
    case "openai-compatible":
    case "custom":
      return "openai";
    case "anthropic":
      return "anthropic";
    case "mistral":
      return "mistral";
    default:
      throw new Error(`Unsupported Director provider: "${provider.provider}".`);
  }
}

/**
 * Some OpenAI-compatible providers attach mandatory opaque metadata to raw
 * function calls. LangChain keeps that payload in `additional_kwargs`, but its
 * normalized tool-call serializer otherwise takes precedence on the next
 * request. This official-adapter subclass selects the raw representation only
 * at the provider boundary; the agent still consumes normalized native calls.
 */
class ConfiguredTokenChatOpenAI extends ChatOpenAI {
  private readonly outputTokenParameter: OutputTokenParameter;

  constructor(
    fields: ConstructorParameters<typeof ChatOpenAI>[0],
    outputTokenParameter: OutputTokenParameter
  ) {
    super(fields);
    this.outputTokenParameter = outputTokenParameter;
  }

  override invocationParams(options?: this["ParsedCallOptions"]): ReturnType<ChatOpenAI["invocationParams"]> {
    const params = super.invocationParams(options);
    const configured = params as typeof params & Record<string, unknown>;
    delete configured.max_tokens;
    delete configured.max_completion_tokens;
    configured[this.outputTokenParameter] = this.maxTokens === -1 ? undefined : this.maxTokens;
    return params;
  }
}

class ProviderMetadataChatOpenAI extends ConfiguredTokenChatOpenAI {
  override async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): Promise<ChatResult> {
    return super._generate(requestMessagesWithProviderToolMetadata(messages), options, runManager);
  }

  override async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const requestMessages = requestMessagesWithProviderToolMetadata(messages);
    yield* super._streamResponseChunks(requestMessages, options, runManager);
  }
}

export function requestMessagesWithProviderToolMetadata(messages: BaseMessage[]): BaseMessage[] {
  return messages.map((message) => {
    if (!AIMessage.isInstance(message) || !message.tool_calls?.length || !message.additional_kwargs.tool_calls) {
      return message;
    }
    return new AIMessage({
      content: message.content,
      additional_kwargs: {
        ...message.additional_kwargs,
        tool_calls: (message.additional_kwargs.tool_calls as Array<Record<string, unknown>>).map((toolCall) => {
          // `index` belongs to streamed deltas, not persisted assistant history.
          // Preserve every opaque provider field (for example Gemini thought
          // signatures) while removing the one transport-only property.
          const { index: _streamIndex, ...persistedToolCall } = toolCall;
          return persistedToolCall;
        }) as typeof message.additional_kwargs.tool_calls
      },
      response_metadata: message.response_metadata,
      id: message.id,
      name: message.name,
      tool_calls: []
    });
  });
}

/**
 * Create an official LangChain chat model from SpielOS provider
 * configuration. The returned instance handles tool calling,
 * streaming, and message formatting natively — no custom bridge
 * code is needed.
 *
 * Throws if the selected model lacks verified tool-calling support,
 * because Director mode requires native function calling.
 */
export function createDirectorModel(provider: ModelProvider, model: Model): BaseChatModel {
  const caps = capabilitiesForModel(model);
  if (!caps.toolCalling) {
    throw new Error(
      `Director mode requires a model with native tool-calling support. ` +
      `"${model.name}" (${model.model}) has toolCalling=false. ` +
      `Enable tool calling in the model's capabilities config or select a different model.`
    );
  }

  const apiKey = readSecret({ provider, model, messages: [] });
  if (!apiKey) {
    throw new Error(
      `No API key found for Director provider "${provider.name}". ` +
      `Set the provider's secretEnvKey or the provider-specific environment variable.`
    );
  }

  const baseUrl = baseUrlForProvider(provider);
  const maxTokens = caps.maxOutputTokens;
  const temperature = typeof model.config?.temperature === "number"
    ? model.config.temperature
    : undefined;

  switch (providerKey(provider)) {
    case "openai": {
      const modelKwargs: Record<string, unknown> = {
        parallel_tool_calls: caps.parallelToolCalling
      };
      if (caps.reasoningEffort !== "auto") modelKwargs.reasoning_effort = caps.reasoningEffort;
      const fields: ConstructorParameters<typeof ChatOpenAI>[0] = {
        model: model.model,
        apiKey,
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens,
        // Provider-opaque tool metadata must be captured as one authoritative
        // response object. Streaming can fragment encrypted signatures across
        // deltas before LangChain persists the assistant tool-call history.
        // The surrounding DeepAgents values stream remains live (status,
        // tools, checkpoints); only this provider boundary is atomic.
        streaming: caps.toolCallMetadata !== "provider_raw",
        streamUsage: true,
        modelKwargs,
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {})
      };
      return (caps.toolCallMetadata === "provider_raw"
        ? new ProviderMetadataChatOpenAI(fields, caps.outputTokenParameter)
        : new ConfiguredTokenChatOpenAI(fields, caps.outputTokenParameter)) as BaseChatModel;
    }
    case "mistral": {
      return new ChatMistralAI({
        model: model.model,
        apiKey,
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens,
        streaming: true,
        streamUsage: true,
        ...(baseUrl ? { serverURL: baseUrl } : {})
      }) as BaseChatModel;
    }
    case "anthropic": {
      return new ChatAnthropic({
        model: model.model,
        apiKey,
        ...(temperature !== undefined ? { temperature } : {}),
        maxTokens,
        streamUsage: true,
        ...(baseUrl ? { anthropicApiUrl: baseUrl } : {})
      }) as BaseChatModel;
    }
  }
}
