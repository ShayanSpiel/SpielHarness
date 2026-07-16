import assert from "node:assert/strict";
import test from "node:test";
import { environmentModelDefaults } from "../apps/web/lib/default-models.ts";

test("a Mistral environment key exposes small and medium defaults", () => {
  const names = [
    "MISTRAL_API_KEY",
    "MISTRAL_MODEL",
    "MISTRAL_MEDIUM_MODEL",
    "MISTRAL_MEDIUM_CONTEXT_WINDOW",
    "MISTRAL_MEDIUM_MAX_OUTPUT_TOKENS",
    "MISTRAL_MEDIUM_REASONING_EFFORT",
  ] as const;
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));

  try {
    process.env.MISTRAL_API_KEY = "test-key";
    for (const name of names.slice(1)) delete process.env[name];

    const mistral = environmentModelDefaults().filter((model) => model.provider === "mistral");
    assert.deepEqual(mistral.map((model) => model.model), ["mistral-small-latest", "mistral-medium-3-5"]);

    const medium = mistral[1];
    assert.equal(medium.capabilities.contextWindow, 256_000);
    assert.equal(medium.capabilities.maxOutputTokens, 32_768);
    assert.equal(medium.capabilities.reasoningEffort, "high");
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
