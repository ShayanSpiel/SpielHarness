import assert from "node:assert/strict";
import test from "node:test";
import { parseArtifactProject } from "@spielos/core";
import { artifactsFromDirectorFiles } from "@spielos/graph/director/values";

test("Director bundles a multi-file artifact directory into one previewable project", () => {
  const now = new Date().toISOString();
  const artifacts = artifactsFromDirectorFiles({
    "/artifacts/launch/index.html": { content: "<!doctype html><link rel=\"stylesheet\" href=\"styles.css\"><h1>Launch</h1>", mimeType: "text/html", created_at: now, modified_at: now },
    "/artifacts/launch/styles.css": { content: "h1{color:rebeccapurple}", mimeType: "text/css", created_at: now, modified_at: now },
    "/artifacts/launch/app.js": { content: "document.body.dataset.ready='true'", mimeType: "text/javascript", created_at: now, modified_at: now }
  }, {}, "org-1", "run-1");

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].type, "artifact");
  assert.equal(artifacts[0].metadata.renderer, "project");
  const project = parseArtifactProject(artifacts[0].body);
  assert.ok(project);
  assert.equal(project.entrypoint, "index.html");
  assert.deepEqual(project.files.map((file) => file.path), ["index.html", "styles.css", "app.js"]);
});

test("Director keeps a standalone artifact file as a source artifact", () => {
  const now = new Date().toISOString();
  const artifacts = artifactsFromDirectorFiles({
    "/artifacts/notes.md": { content: "Verified notes", mimeType: "text/markdown", created_at: now, modified_at: now }
  }, {}, "org-1", "run-1");

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].type, "draft");
  assert.equal(artifacts[0].title, "notes.md");
});
