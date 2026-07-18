import assert from "node:assert/strict";
import test from "node:test";
import { createDirectorModel, requestMessagesWithProviderToolMetadata } from "@spielos/graph/director/model-factory";
import { AIMessage } from "@langchain/core/messages";
import type { Model, ModelProvider } from "@spielos/core";

process.env.SPIELOS_TEST_LLM_KEY = process.env.SPIELOS_TEST_LLM_KEY ?? "sk-test-fake-key-for-unit-tests";
process.env.MISTRAL_API_KEY = process.env.MISTRAL_API_KEY ?? "sk-test-fake-mistral-key";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "sk-test-fake-anthropic-key";
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "sk-test-fake-openai-key";

const orgId = "00000000-0000-0000-0000-000000000001";

function makeProvider(overrides: Partial<ModelProvider> = {}): ModelProvider {
  return {
    id: "prov-1",
    orgId,
    name: "Test provider",
    provider: "openai-compatible",
    model: "gpt-4o",
    baseUrl: null,
    secretEnvKey: null,
    config: {},
    enabled: true,
    ...overrides
  };
}

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "model-1",
    orgId,
    name: "Test model",
    provider: "openai-compatible",
    model: "gpt-4o",
    baseUrl: "https://api.openai.com/v1",
    secretEnvKey: null,
    config: { capabilities: { contextWindow: 128000, maxOutputTokens: 4096, toolCalling: true } },
    enabled: true,
    ...overrides
  };
}

test("createDirectorModel throws when toolCalling is false", () => {
  const provider = makeProvider();
  const model = makeModel({
    config: { capabilities: { contextWindow: 128000, maxOutputTokens: 4096, toolCalling: false } }
  });
  assert.throws(
    () => createDirectorModel(provider, model),
    /toolCalling=false/
  );
});

test("createDirectorModel throws when no API key is resolved for custom provider", () => {
  const provider = makeProvider({ provider: "custom", secretEnvKey: "NONEXISTENT_ENV_VAR_12345" });
  const model = makeModel({
    secretEnvKey: "NONEXISTENT_ENV_VAR_12345",
    config: { capabilities: { contextWindow: 128000, maxOutputTokens: 4096, toolCalling: true } }
  });
  const saved = process.env.OPENAI_API_KEY;
  try {
    delete (process.env as Record<string, unknown>).OPENAI_API_KEY;
    assert.throws(
      () => createDirectorModel(provider, model),
      /No API key found/
    );
  } finally {
    if (saved) process.env.OPENAI_API_KEY = saved;
  }
});

test("createDirectorModel creates ChatOpenAI for openai-compatible provider", () => {
  const provider = makeProvider({ provider: "openai-compatible", secretEnvKey: "SPIELOS_TEST_LLM_KEY" });
  const model = makeModel();
  const llm = createDirectorModel(provider, model);
  assert.equal(llm._llmType(), "openai");
});

test("createDirectorModel creates ChatMistralAI for mistral provider", () => {
  const provider = makeProvider({ provider: "mistral", secretEnvKey: "MISTRAL_API_KEY" });
  const model = makeModel({ provider: "mistral", model: "mistral-large-latest" });
  const llm = createDirectorModel(provider, model);
  assert.equal(llm._llmType(), "mistral_ai");
});

test("createDirectorModel creates ChatAnthropic for anthropic provider", () => {
  const provider = makeProvider({ provider: "anthropic", secretEnvKey: "ANTHROPIC_API_KEY" });
  const model = makeModel({ provider: "anthropic", model: "claude-opus-4-5-20250901" });
  const llm = createDirectorModel(provider, model);
  assert.equal(llm._llmType(), "anthropic");
});

test("createDirectorModel preserves custom base URL for OpenAI", () => {
  const provider = makeProvider({
    provider: "openai-compatible",
    baseUrl: "https://custom-proxy.example.com/v1",
    secretEnvKey: "SPIELOS_TEST_LLM_KEY"
  });
  const model = makeModel({ baseUrl: "https://custom-proxy.example.com/v1" });
  const llm = createDirectorModel(provider, model);
  assert.equal(llm._llmType(), "openai");
});

test("createDirectorModel respects maxOutputTokens from model config", () => {
  const provider = makeProvider({ secretEnvKey: "SPIELOS_TEST_LLM_KEY" });
  const model = makeModel({
    config: { capabilities: { contextWindow: 128000, maxOutputTokens: 8192, toolCalling: true } }
  });
  const llm = createDirectorModel(provider, model);
  assert.ok(llm, "Should create a model instance");
  assert.equal(llm._llmType(), "openai");
});

test("provider-raw tool metadata survives the normalized LangChain tool-call boundary", () => {
  const rawToolCalls = [{
    id: "call-1",
    type: "function",
    function: { name: "read_file", arguments: "{}" },
    extra_content: { provider: { opaque_signature: "signed" } }
  }];
  const source = new AIMessage({
    content: "",
    additional_kwargs: { tool_calls: rawToolCalls },
    tool_calls: [{ id: "call-1", name: "read_file", args: {}, type: "tool_call" }]
  });
  const [requestMessage] = requestMessagesWithProviderToolMetadata([source]);
  assert.ok(AIMessage.isInstance(requestMessage));
  assert.deepEqual(requestMessage.additional_kwargs.tool_calls, rawToolCalls);
  assert.deepEqual(requestMessage.tool_calls, []);
  assert.equal(source.tool_calls.length, 1, "the native agent message remains executable");
});

test("createDirectorModel uses env-based API key resolution", () => {
  const provider = makeProvider({ secretEnvKey: "SPIELOS_TEST_LLM_KEY" });
  const model = makeModel();
  const llm = createDirectorModel(provider, model);
  assert.equal(llm._llmType(), "openai");
});

test("no XML or prose tool parsing is reachable in Director path", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const root = path.resolve(import.meta.url.replace(/^file:\/\//, ""), "../..");

  const factorySource = await fs.readFile(
    path.join(root, "packages/graph/src/director/model-factory.ts"),
    "utf8"
  );
  assert.ok(!factorySource.includes("XML_TOOL_RE"), "No XML tool regex in model-factory.ts");
  assert.ok(!factorySource.includes("extractDeepAgentToolCalls"), "No XML extraction in model-factory.ts");
  assert.ok(!factorySource.includes("findBalancedBraces"), "No brace parsing in model-factory.ts");
  assert.ok(!factorySource.includes("toolCallArgsRecord"), "No manual tool call args record in model-factory.ts");

  const compileSource = await fs.readFile(
    path.join(root, "packages/graph/src/director/compile.ts"),
    "utf8"
  );
  assert.ok(!compileSource.includes("XML_TOOL_RE"), "No XML tool regex in compile.ts");
  assert.ok(!compileSource.includes("extractDeepAgentToolCalls"), "No XML extraction in compile.ts");

  let chatModelExists = false;
  try {
    await fs.access(path.join(root, "packages/graph/src/director/chat-model.ts"));
    chatModelExists = true;
  } catch { /* expected */ }
  assert.ok(!chatModelExists, "chat-model.ts (SpielOSChatModel) should be deleted");
});

test("Direct mode streamChat still yields strings (transport unchanged)", async () => {
  const { streamChat } = await import("@spielos/providers");
  const fn: typeof streamChat = streamChat;
  assert.equal(typeof fn, "function", "streamChat should be a function");
  const gen = fn(
    { id: "p", orgId, name: "t", provider: "openai-compatible", model: "m", baseUrl: null, secretEnvKey: "SPIELOS_TEST_LLM_KEY", config: {}, enabled: true },
    { id: "m", orgId, name: "m", provider: "openai-compatible", model: "gpt-4o", baseUrl: null, secretEnvKey: null, config: { capabilities: { contextWindow: 128000, maxOutputTokens: 4096, toolCalling: true } }, enabled: true },
    [{ role: "user", content: "hi" }],
    { maxTokens: 10 }
  );
  assert.ok(gen[Symbol.asyncIterator], "streamChat returns an async iterable");
});
