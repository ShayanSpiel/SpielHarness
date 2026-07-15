import assert from "node:assert/strict";
import test from "node:test";
import { json } from "@spielos/db";

test("database JSON boundary preserves valid emoji and replaces lone surrogates", () => {
  const input = { valid: "⚡ 😀", malformed: `before ${String.fromCharCode(0xd83d)} after` };
  const serialized = JSON.stringify(json(input));

  assert.match(serialized, /⚡ 😀/);
  assert.match(serialized, /before � after/);
  assert.doesNotMatch(serialized, /\\ud83d/);
});
