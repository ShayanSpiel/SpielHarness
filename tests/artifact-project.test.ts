import assert from "node:assert/strict";
import test from "node:test";
import { parseArtifactProject } from "@spielos/core";
import { normalizeArtifactProject, renderProjectPdfBase64 } from "@spielos/graph";

const project = {
  kind: "project" as const,
  version: 1 as const,
  name: "Premium launch",
  root: "/",
  entrypoint: "index.html",
  files: [
    { path: "index.html", mimeType: "text/html", content: "<!doctype html><html><body><main><h1>Premium launch</h1><form aria-label=\"Lead form\"></form></main></body></html>", encoding: "utf8" as const, role: "entry" as const },
    { path: "Assets/styles.css", mimeType: "text/css", content: "body{font-family:sans-serif}", encoding: "utf8" as const, role: "style" as const }
  ],
  integrations: [],
  metadata: {}
};

test("artifact project normalization creates a distinct valid PDF file", () => {
  const normalized = normalizeArtifactProject(JSON.stringify(project));
  const pdf = normalized.files.find((file) => file.mimeType === "application/pdf");
  assert.ok(pdf);
  assert.equal(pdf.encoding, "base64");
  assert.match(Buffer.from(pdf.content, "base64").subarray(0, 8).toString("latin1"), /^%PDF-1\./);
  assert.equal(normalized.entrypoint, "index.html");
  assert.equal(parseArtifactProject(JSON.stringify(normalized))?.files.length, 3);
});

test("artifact project normalization rejects traversal and duplicate paths", () => {
  assert.throws(() => normalizeArtifactProject(JSON.stringify({
    ...project,
    entrypoint: "../index.html",
    files: [{ ...project.files[0], path: "../index.html" }]
  })), /unsafe path/);
  assert.throws(() => normalizeArtifactProject(JSON.stringify({
    ...project,
    files: [project.files[0], { ...project.files[0] }]
  })), /duplicate path/);
});

test("artifact project normalization accepts an unescaped multi-file bundle", () => {
  const normalized = normalizeArtifactProject(`===PROJECT===
name: Aster Signal
entrypoint: index.html
===FILE index.html | text/html | entry===
<!doctype html>
<html><body><h1>Revenue signals, reconciled.</h1><script src="Assets/app.js"></script></body></html>
===END FILE===
===FILE Assets/app.js | text/javascript | script===
document.querySelector("h1")?.setAttribute("data-ready", "true");
===END FILE===`);
  assert.equal(normalized.name, "Aster Signal");
  assert.equal(normalized.entrypoint, "index.html");
  assert.equal(normalized.files.find((file) => file.path === "Assets/app.js")?.content.includes('"h1"'), true);
  assert.ok(normalized.files.some((file) => file.mimeType === "application/pdf"));
  assert.equal(normalized.metadata.transport, "file_bundle");
});

test("PDF renderer produces a standalone document rather than HTML bytes", () => {
  const content = renderProjectPdfBase64("Launch", "<h1>Launch</h1><p>Readable business document.</p>");
  const bytes = Buffer.from(content, "base64");
  assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal(bytes.includes(Buffer.from("<h1>")), false);
  assert.ok(bytes.length > 500);
});
