import assert from "node:assert/strict";
import test from "node:test";
import {
  chatTurnEnvelopeSchema,
  orchestrationPlanSchema,
  projectRevisionSchema,
  projectSessionSchema
} from "@spielos/core";

test("project session contracts distinguish project lifecycle from run lifecycle", () => {
  const project = projectSessionSchema.parse({
    id: "project-1",
    orgId: "org-1",
    chatId: "chat-1",
    title: "Aster landing page",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z"
  });

  assert.equal(project.status, "active");
  assert.equal(project.version, 0);
  assert.equal(project.activeArtifactId, null);
  assert.equal(projectSessionSchema.safeParse({ ...project, status: "running" }).success, false);
});

test("revision provenance is immutable and references artifacts rather than embedding source", () => {
  const revision = projectRevisionSchema.parse({
    id: "revision-2",
    orgId: "org-1",
    projectId: "project-1",
    sequence: 2,
    instruction: "Change the hero headline.",
    artifactIds: ["artifact-2"],
    sourceHashes: { "index.html": "sha256:abc" },
    author: "orchestrator",
    createdAt: "2026-07-17T00:00:00.000Z"
  });

  assert.equal(revision.sequence, 2);
  assert.deepEqual(revision.artifactIds, ["artifact-2"]);
  assert.deepEqual(revision.sourceHashes, { "index.html": "sha256:abc" });
});

test("turn envelopes anchor execution to a durable chat turn", () => {
  const envelope = chatTurnEnvelopeSchema.parse({
    turnId: "turn-1",
    kind: "execution_anchor",
    projectId: "project-1",
    runId: "run-1"
  });
  assert.equal(envelope.kind, "execution_anchor");
  assert.equal(envelope.projectId, "project-1");
});

test("orchestration plans reject untyped or unsafe control flow", () => {
  const plan = orchestrationPlanSchema.parse({
    intent: "revise_project",
    project: "continue",
    rationale: "The chat has an active landing artifact.",
    steps: [{
      id: "revise",
      kind: "role",
      targetId: "landing-page-editor",
      input: { artifactId: "artifact-1" },
      dependsOn: [],
      writeScope: "internal",
      confirmation: "none"
    }]
  });
  assert.equal(plan.steps[0]?.writeScope, "internal");
  assert.equal(orchestrationPlanSchema.safeParse({ ...plan, steps: [] }).success, false);
  assert.equal(orchestrationPlanSchema.safeParse({
    ...plan,
    steps: [{ ...plan.steps[0], writeScope: "database" }]
  }).success, false);
});
