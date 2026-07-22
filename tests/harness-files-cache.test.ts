import assert from "node:assert/strict";
import test from "node:test";
import {
  getOrchestratorPrompt,
  invalidateHarnessFilesCache,
  listHarnessFiles,
  type FileRow,
  type Sql,
} from "@spielos/db";

function harnessRow(id: string): FileRow {
  return {
    id,
    org_id: "org-cache-test",
    folder_id: null,
    file_type: "prompt",
    status: "active",
    lifecycle: "published",
    enabled: true,
    validation_diagnostics: [],
    title: "Orchestrator",
    body: "Coordinate the workspace.",
    content_format: "markdown",
    metadata: { systemRole: "orchestrator" },
    current_version: 1,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

test("harness reads coalesce and prime the Direct-mode orchestrator lookup", async () => {
  const orgId = "org-cache-test";
  invalidateHarnessFilesCache(orgId);
  const rows = [harnessRow("prompt-1")];
  let queries = 0;
  const sql = ((..._args: unknown[]) => {
    queries += 1;
    return Promise.resolve(rows);
  }) as unknown as Sql;

  const [first, concurrent] = await Promise.all([
    listHarnessFiles(sql, orgId),
    listHarnessFiles(sql, orgId),
  ]);
  const cached = await listHarnessFiles(sql, orgId);
  const orchestrator = await getOrchestratorPrompt(sql, orgId);

  assert.equal(queries, 1);
  assert.equal(first, concurrent);
  assert.equal(first, cached);
  assert.equal(orchestrator?.id, "prompt-1");

  invalidateHarnessFilesCache(orgId);
  await listHarnessFiles(sql, orgId);
  assert.equal(queries, 2);
});
