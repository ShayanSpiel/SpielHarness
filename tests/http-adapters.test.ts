import assert from "node:assert/strict";
import test from "node:test";
import { driveAdapter, encryptConnectionSecret, normalizeGmailMessage, parseDuckDuckGoHtml } from "@spielos/providers";
import type { Connection, Skill } from "@spielos/core";

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

test("Google Drive folder writes use the registered OAuth adapter and return a receipt", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.CONNECTION_ENCRYPTION_KEY;
  process.env.CONNECTION_ENCRYPTION_KEY = "adapter-test-key";
  const calls: Array<{ url: string; method: string; body: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: String(init?.method), body: String(init?.body) });
    return new Response(JSON.stringify({ id: "folder-1", name: "Premium launch", mimeType: "application/vnd.google-apps.folder", webViewLink: "https://drive.google.com/folder-1" }), { status: 200 });
  }) as typeof fetch;
  const connection: Connection = {
    id: "drive-connection",
    orgId: "org-1",
    name: "Google Drive",
    kind: "oauth",
    status: "configured",
    baseUrl: null,
    secretEnvKey: null,
    config: { oauthCredential: encryptConnectionSecret({ accessToken: "token", expiresAt: Date.now() + 3_600_000 }) },
    operations: [{ id: "drive.createFolder", effect: "write" }],
    enabled: true
  };
  const skill: Skill = {
    id: "drive-folder-skill",
    orgId: "org-1",
    name: "Drive Create Folder",
    slug: "drive.createFolder",
    description: "",
    kind: "http",
    status: "active",
    auth: "oauth",
    sideEffect: "write",
    inputSchema: "{}",
    outputSchema: "{}",
    implementation: "",
    bindings: [],
    metadata: {}
  };
  try {
    const result = await driveAdapter.execute({ operation: connection.operations[0], connection, skill, input: JSON.stringify({ name: "Premium launch", parentId: "root-1" }) });
    assert.match(result.output, /drive_write_receipt/);
    assert.match(result.output, /folder-1/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, "POST");
    assert.match(calls[0].url, /googleapis\.com\/drive\/v3\/files/);
    assert.match(calls[0].body, /root-1/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.CONNECTION_ENCRYPTION_KEY;
    else process.env.CONNECTION_ENCRYPTION_KEY = previousKey;
  }
});
