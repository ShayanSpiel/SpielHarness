import assert from "node:assert/strict";
import test from "node:test";
import type { Role, Skill } from "@spielos/core";
import { streamRun, type RunYield } from "@spielos/graph";

const orgId = "00000000-0000-0000-0000-000000000001";
const role: Role = {
  id: "role-1", orgId, name: "Researcher", description: "", prompt: "Research",
  modelId: null, memoryPolicy: [], inputArtifactTypes: [], outputArtifactTypes: [],
  skillIds: [], status: "active", metadata: {}
};

function skill(id: string, kind: Skill["kind"], extra: Partial<Skill> = {}): Skill {
  return {
    id, orgId, name: id, slug: id, description: "", kind, status: "active", auth: "none",
    sideEffect: "none", inputSchema: "{}", outputSchema: "{}", implementation: "",
    bindings: [], metadata: {}, enabled: true, ...extra
  };
}

async function collect(generator: AsyncGenerator<RunYield, void, void>) {
  const items: RunYield[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

test("human input creates a resumable durable checkpoint without a false completion", async () => {
  const human = skill("human", "human_input", {
    humanQuestions: [{ id: "approval", kind: "single", question: "Continue?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }]
  });
  const search = skill("search", "knowledge_search");
  const base = {
    orgId, runId: "run-1", prompt: "market evidence", roles: { [role.id]: role },
    skills: [human, search], provider: null, model: null, workstreamId: null,
    knowledgeFiles: [{ id: "file-1", title: "Market evidence", body: "Evidence body", fileType: "knowledge", metadata: {} }],
    nodes: [
      { id: "human-node", title: "Approval", roleId: role.id, skillIds: [human.id], inputNodeIds: [] },
      { id: "search-node", title: "Search", roleId: role.id, skillIds: [search.id], inputNodeIds: ["human-node"] }
    ]
  };
  const paused = await collect(streamRun(base));
  assert.ok(paused.some((item) => item.kind === "human_input"));
  assert.ok(!paused.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  const state = [...paused].reverse().find((item): item is Extract<RunYield, { kind: "values" }> => item.kind === "values")!.state;

  const resumed = await collect(streamRun({
    ...base,
    resume: { approval: "yes" },
    checkpoint: {
      cursor: state.cursor,
      humanInputs: state.humanInputs,
      humanInputRequest: state.humanInputRequest,
      outputsByNode: state.outputsByNode,
      evalAttempts: state.evalAttempts,
      output: state.output
    }
  }));
  assert.ok(resumed.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  assert.ok(resumed.some((item) => item.kind === "text" && item.text.includes("Market evidence")));
});

test("unregistered executable skill kinds fail instead of simulating success", async () => {
  const code = skill("unsafe-code", "code");
  const items = await collect(streamRun({
    orgId, runId: "run-2", prompt: "execute", roles: { [role.id]: role }, skills: [code],
    provider: null, model: null, workstreamId: null,
    nodes: [{ id: "code-node", title: "Code", roleId: role.id, skillIds: [code.id] }]
  }));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_failed"));
  assert.ok(items.some((item) => item.kind === "text" && item.text.includes("no executable adapter")));
});
