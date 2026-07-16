import assert from "node:assert/strict";
import test from "node:test";
import type { Model } from "@spielos/core";
import { isCheapModel, pickModelForRole, resolveModelRoster } from "@spielos/providers";

function makeModel(overrides: Partial<Model> = {}): Model {
  return {
    id: "m",
    orgId: "o",
    name: "n",
    provider: "openai-compatible",
    model: "test-model",
    baseUrl: null,
    secretEnvKey: null,
    config: {},
    enabled: true,
    ...overrides
  };
}

test("isCheapModel flags explicit capability tiers and known model-name hints", () => {
  assert.equal(isCheapModel(makeModel({ id: "tier", config: { capabilities: { tier: "cheap" } } })), true);
  assert.equal(isCheapModel(makeModel({ model: "gpt-4o-mini" })), true);
  assert.equal(isCheapModel(makeModel({ model: "claude-haiku-4" })), true);
  assert.equal(isCheapModel(makeModel({ model: "mistral-small-latest" })), true);
  assert.equal(isCheapModel(makeModel({ model: "llama-8b" })), true);
  assert.equal(isCheapModel(makeModel({ model: "gpt-4o" })), false);
});

test("pickModelForRole honors the override and falls back to primary", () => {
  const primary = makeModel({ id: "primary" });
  const compactor = makeModel({ id: "compactor" });
  assert.equal(pickModelForRole({ primary, compactor, extractor: null, fallback: null, role: "compactor" }).model.id, "compactor");
  assert.equal(pickModelForRole({ primary, compactor: null, extractor: null, fallback: null, role: "compactor" }).model.id, "primary");
});

test("pickModelForRole returns the fallback only when the role is fallback", () => {
  const primary = makeModel({ id: "primary" });
  const fallback = makeModel({ id: "fallback" });
  assert.equal(pickModelForRole({ primary, compactor: null, extractor: null, fallback, role: "primary" }).model.id, "primary");
  assert.equal(pickModelForRole({ primary, compactor: null, extractor: null, fallback, role: "fallback" }).model.id, "fallback");
});

test("resolveModelRoster returns a primary / compactor / extractor / fallback tuple", () => {
  const primary = makeModel({ id: "primary" });
  const compactor = makeModel({ id: "compactor" });
  const extractor = makeModel({ id: "extractor" });
  const fallback = makeModel({ id: "fallback" });
  const roster = resolveModelRoster({ primary, compactor, extractor, fallback });
  assert.equal(roster.primary.id, "primary");
  assert.equal(roster.compactor.id, "compactor");
  assert.equal(roster.extractor.id, "extractor");
  assert.equal(roster.fallback?.id, "fallback");
});

test("resolveModelRoster falls back to the primary when overrides are absent", () => {
  const primary = makeModel({ id: "primary" });
  const roster = resolveModelRoster({ primary });
  assert.equal(roster.compactor.id, "primary");
  assert.equal(roster.extractor.id, "primary");
  assert.equal(roster.fallback, null);
});
