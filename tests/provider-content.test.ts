import assert from "node:assert/strict";
import test from "node:test";
import { textFromProviderContent } from "../packages/providers/src/types.ts";

test("provider content normalization preserves strings and visible text blocks", () => {
  assert.equal(textFromProviderContent("hello"), "hello");
  assert.equal(
    textFromProviderContent([
      { type: "text", text: "hello " },
      { type: "output_text", text: "world" }
    ]),
    "hello world"
  );
  assert.equal(textFromProviderContent({ content: [{ type: "text", text: "nested" }] }), "nested");
});

test("provider content normalization never leaks reasoning or unknown objects", () => {
  assert.equal(textFromProviderContent({ type: "thinking", text: "private chain of thought" }), "");
  assert.equal(textFromProviderContent({ reasoning: "private", value: 42 }), "");
  assert.equal(textFromProviderContent([{ type: "thinking", text: "private" }, { type: "text", text: "answer" }]), "answer");
});
