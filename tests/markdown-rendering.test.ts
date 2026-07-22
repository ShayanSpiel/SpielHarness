import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMarkdown } from "../apps/web/lib/markdown.ts";

test("dedents a provider-indented Markdown document instead of rendering one code block", () => {
  const input = "    ---\n    title: report\n    ---\n\n    # Report\n\n    | Source | Status |\n    | --- | --- |\n    | Drive | Ready |";
  const output = normalizeMarkdown(input);
  assert.ok(output.startsWith("---\ntitle: report\n---\n\n# Report"));
  assert.ok(output.includes("| Drive | Ready |"));
});

test("preserves nested indentation when the document itself is not globally indented", () => {
  const input = "# Report\n\n- Item\n    - Nested\n\n```ts\nconst value = 1;\n```";
  assert.equal(normalizeMarkdown(input), input);
});

test("unwraps a provider-fenced complete Markdown report", () => {
  const input = "```markdown\n---\ntitle: report\n---\n\n# Report\n\nUseful evidence.\n```";
  assert.equal(normalizeMarkdown(input), "---\ntitle: report\n---\n\n# Report\n\nUseful evidence.");
});

test("keeps an ordinary fenced source sample intact", () => {
  const input = "```ts\nconst value = 1;\n```";
  assert.equal(normalizeMarkdown(input), input);
});
