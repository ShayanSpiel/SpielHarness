import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGmailMessage, parseDuckDuckGoHtml } from "@spielos/providers";

test("DuckDuckGo HTML results are normalized into provenance records", () => {
  const html = `
    <div class="result">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpaper">Durable &amp; controlled agents</a>
      <a class="result__snippet">A primary-source &lt;summary&gt;.</a>
    </div>`;
  assert.deepEqual(parseDuckDuckGoHtml(html, 3), [{
    title: "Durable & controlled agents",
    url: "https://example.com/paper",
    snippet: "A primary-source <summary>."
  }]);
});

test("Gmail read normalization omits attachment blobs and keeps readable provenance", () => {
  const output = normalizeGmailMessage(JSON.stringify({
    id: "message-1",
    threadId: "thread-1",
    snippet: "Fallback snippet",
    payload: {
      headers: [
        { name: "Subject", value: "Long-horizon update" },
        { name: "From", value: "research@example.com" }
      ],
      parts: [
        { mimeType: "text/plain", body: { data: Buffer.from("Readable body").toString("base64url") } },
        { mimeType: "application/pdf", body: { attachmentId: "large-attachment", data: "A".repeat(200_000) } }
      ]
    }
  }));

  assert.match(output, /Long-horizon update/);
  assert.match(output, /Readable body/);
  assert.doesNotMatch(output, /large-attachment|AAAAAA/);
});
