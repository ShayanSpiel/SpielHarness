import assert from "node:assert/strict";
import test from "node:test";
import { capabilitiesForModel, type Model } from "@spielos/core";
import { chooseRecentMessages } from "@spielos/providers";

const baseModel: Model = {
  id: "model",
  orgId: "org",
  name: "Test model",
  provider: "openai",
  model: "test",
  baseUrl: null,
  secretEnvKey: null,
  config: {},
  enabled: true
};

test("model context limits come from the persisted capability profile", () => {
  const capabilities = capabilitiesForModel({
    ...baseModel,
    config: {
      capabilities: {
        contextWindow: 131_072,
        maxOutputTokens: 8_192,
        compactionThreshold: 0.75,
        tokenCounter: "tiktoken",
        parallelToolCalling: true
      }
    }
  });

  assert.equal(capabilities.contextWindow, 131_072);
  assert.equal(capabilities.maxOutputTokens, 8_192);
  assert.equal(capabilities.compactionThreshold, 0.75);
  assert.equal(capabilities.tokenCounter, "tiktoken");
  assert.equal(capabilities.parallelToolCalling, true);
});

test("context trimming preserves the newest complete messages", () => {
  const messages = [
    { role: "user" as const, content: "old ".repeat(40) },
    { role: "assistant" as const, content: "middle ".repeat(20) },
    { role: "user" as const, content: "latest" }
  ];

  const result = chooseRecentMessages(messages, 45);

  assert.deepEqual(result.kept.map((message) => message.content), [messages[1].content, "latest"]);
  assert.deepEqual(result.removed.map((message) => message.content), [messages[0].content]);
});

test("context trimming always keeps the latest message even when it alone exceeds the budget", () => {
  const latest = { role: "user" as const, content: "required input ".repeat(100) };
  const result = chooseRecentMessages([latest], 8);

  assert.deepEqual(result.kept, [latest]);
  assert.deepEqual(result.removed, []);
});
