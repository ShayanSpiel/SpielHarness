import assert from "node:assert/strict";
import test from "node:test";
import { defaultInputContract, defaultOutputContract, type Role, type Skill, type WorkflowFile } from "@spielos/core";
import { deriveHumanQuestions, streamRun, type RunYield } from "@spielos/graph";

const orgId = "00000000-0000-0000-0000-000000000001";
const role: Role = {
  id: "role-1", orgId, name: "Researcher", description: "", prompt: "Research",
  modelId: null, inputContract: defaultInputContract(), outputContract: defaultOutputContract(),
  skillIds: [], status: "active", metadata: {}
};

function skill(id: string, kind: Skill["kind"], extra: Partial<Skill> = {}): Skill {
  return {
    id, orgId, name: id, slug: id, description: "", kind, status: "active", auth: "none",
    sideEffect: "none", inputSchema: "{}", outputSchema: "{}", implementation: "",
    bindings: [], metadata: {}, ...extra
  };
}

async function collect(generator: AsyncGenerator<RunYield, void, void>) {
  const items: RunYield[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

test("prompt-authored human choices become a typed radio question with a custom-answer path", () => {
  const questions = deriveHumanQuestions(
    "Show the extracted ideas. Ask the user: which formats should we repurpose into? Suggest: (A) X Thread + LinkedIn Post, (B) X Thread only, (C) LinkedIn Post only, (D) Newsletter, (E) All formats.",
    "Choose Output Formats"
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0].kind, "single");
  assert.equal(questions[0].question, "Which formats should we repurpose into?");
  assert.deepEqual(questions[0].options?.map((option) => option.label), [
    "X Thread + LinkedIn Post",
    "X Thread only",
    "LinkedIn Post only",
    "Newsletter",
    "All formats"
  ]);
  assert.equal(questions[0].allowCustom, true);
});

test("prompt-authored follow-ups become a multi-step human-input wizard", () => {
  const questions = deriveHumanQuestions(
    "Ask the user: what are this week's content goals? Suggest: (A) Promote an offer, (B) Build authority, (C) Engage a trend, (D) Mix of all. Also ask how many posts per platform.",
    "Weekly Goals"
  );
  assert.equal(questions.length, 2);
  assert.equal(questions[0].kind, "single");
  assert.equal(questions[1].kind, "text");
  assert.equal(questions[1].question, "How many posts per platform");
});

test("prompt-authored multiple choice becomes a typed multi-select question", () => {
  const questions = deriveHumanQuestions(
    "Ask the user which content formats to generate. Suggest: (A) X Post, (B) LinkedIn Post, (C) Blog Post. Let them choose multiple or write their own.",
    "Choose Formats"
  );
  assert.equal(questions.length, 1);
  assert.equal(questions[0].kind, "multi");
  assert.equal(questions[0].allowCustom, true);
});

test("human input creates a resumable durable checkpoint without a false completion", async () => {
  const human = skill("human", "human_input", {
    humanQuestions: [{ id: "approval", kind: "single", question: "Continue?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }]
  });
  const search = skill("search", "knowledge_search");
  const workflow: WorkflowFile = {
    id: "workflow-1", orgId, name: "Research approval", description: "", status: "active", metadata: {},
    nodes: [
      { id: "human-node", title: "Approval", roleId: role.id, skillIds: [human.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 0, y: 0 } },
      { id: "search-node", title: "Search", roleId: role.id, skillIds: [search.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 200, y: 0 } }
    ],
    edges: [{ id: "human-search", source: "human-node", target: "search-node" }]
  };
  const base = {
    orgId, runId: "run-1", prompt: "market evidence", workflow,
    roles: { [role.id]: role }, skills: { [human.id]: human, [search.id]: search },
    provider: null, model: null, connections: {},
    files: [{ id: "file-1", title: "Market evidence", body: "Evidence body", fileType: "knowledge", metadata: {} }]
  };
  const paused = await collect(streamRun(base));
  assert.ok(paused.some((item) => item.kind === "human_input"));
  assert.ok(!paused.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  const state = [...paused].reverse().find((item): item is Extract<RunYield, { kind: "checkpoint" }> => item.kind === "checkpoint")!.state;

  const resumed = await collect(streamRun({
    ...base,
    resume: { approval: "yes" },
    checkpoint: state
  }));
  assert.ok(!resumed.some((item) => item.kind === "human_input"));
  assert.ok(resumed.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  assert.ok(resumed.some((item) => item.kind === "text" && item.text.includes("Market evidence")));
});

test("unregistered executable skill kinds fail instead of simulating success", async () => {
  const code = skill("unsafe-code", "code");
  const items = await collect(streamRun({
    orgId, runId: "run-2", prompt: "execute", workflow: null,
    singleNode: { kind: "skill", nodeId: "code-node", title: "Code", role, skill: code, fileIds: [] },
    roles: { [role.id]: role }, skills: { [code.id]: code }, files: [], connections: {},
    provider: null, model: null
  }));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_failed"));
  assert.ok(items.some((item) =>
    item.kind === "event" &&
    item.event.type === "node_failed" &&
    item.event.message.includes("no executable adapter")
  ));
  assert.ok(!items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
});

test("harness mutation skills call the application-owned draft adapter", async () => {
  const createDraft = skill("harness-create", "harness_file", {
    metadata: { harnessAction: "create" }
  });
  let received: Record<string, unknown> | null = null;
  const items = await collect(streamRun({
    orgId,
    runId: "run-harness-draft",
    prompt: JSON.stringify({ title: "Proposed researcher", fileType: "harness_role", body: "Draft role" }),
    workflow: null,
    singleNode: { kind: "skill", nodeId: "harness-node", title: "Create harness draft", role, skill: createDraft, fileIds: [] },
    roles: { [role.id]: role },
    skills: { [createDraft.id]: createDraft },
    files: [],
    connections: {},
    provider: null,
    model: null,
    harnessFileAction: async (action, params, context) => {
      received = { action, params, context };
      return { id: "draft-id", title: String(params.title), fileType: String(params.fileType), status: "draft", version: 1 };
    }
  }));

  assert.equal(received?.action, "create");
  assert.equal((received?.params as Record<string, unknown>).title, "Proposed researcher");
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  assert.ok(items.some((item) => item.kind === "text" && item.text.includes("draft-id")));
});

test("workflow fan-out joins once and executes every declared skill", async () => {
  const searchA = skill("search-a", "knowledge_search");
  const searchB = skill("search-b", "knowledge_search");
  const searchC = skill("search-c", "knowledge_search");
  const workflow: WorkflowFile = {
    id: "workflow-fanout", orgId, name: "Fan out", description: "", status: "active", metadata: {},
    nodes: [
      { id: "root", title: "Root", roleId: role.id, skillIds: [searchA.id, searchB.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 0, y: 0 } },
      { id: "left", title: "Left", roleId: role.id, skillIds: [searchA.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 200, y: -100 } },
      { id: "right", title: "Right", roleId: role.id, skillIds: [searchB.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 200, y: 100 } },
      { id: "join", title: "Join", roleId: role.id, skillIds: [searchC.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 400, y: 0 } }
    ],
    edges: [
      { id: "root-left", source: "root", target: "left" },
      { id: "root-right", source: "root", target: "right" },
      { id: "left-join", source: "left", target: "join" },
      { id: "right-join", source: "right", target: "join" }
    ]
  };
  const items = await collect(streamRun({
    orgId, runId: "run-fanout", prompt: "market evidence", workflow,
    roles: { [role.id]: role },
    skills: { [searchA.id]: searchA, [searchB.id]: searchB, [searchC.id]: searchC },
    files: [{ id: "file-1", title: "Market evidence", body: "Evidence body", fileType: "knowledge", metadata: {} }],
    connections: {}, provider: null, model: null
  }));
  const completedNodes = items.filter((item): item is Extract<RunYield, { kind: "event" }> => item.kind === "event" && item.event.type === "node_completed");
  assert.deepEqual(new Set(completedNodes.map((item) => item.event.nodeId)), new Set(["root", "left", "right", "join"]));
  assert.equal(completedNodes.filter((item) => item.event.nodeId === "join").length, 1);
  const rootSkillStarts = items.filter((item) => item.kind === "event" && item.event.type === "skill_started" && item.event.nodeId === "root");
  assert.equal(rootSkillStarts.length, 2);
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
});

test("a terminal eval gate retries its source and stops at max attempts", async () => {
  const search = skill("retry-search", "knowledge_search");
  const gate = skill("retry-gate", "eval", {
    evalRules: [{ label: "Impossible requirement", type: "contains", value: "never-present", weight: 10 }],
    overallThreshold: 90
  });
  const workflow: WorkflowFile = {
    id: "workflow-retry", orgId, name: "Retry gate", description: "", status: "active", metadata: {},
    nodes: [
      { id: "draft", title: "Draft", roleId: role.id, skillIds: [search.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 0, y: 0 } },
      {
        id: "gate",
        title: "Gate",
        roleId: role.id,
        skillIds: [gate.id],
        fileIds: [],
        inputContract: "any",
        outputContract: "any",
        position: { x: 200, y: 0 },
        loopConfig: { enabled: true, maxAttempts: 2, breakCondition: "on_pass", evalId: null },
        evalInput: { type: "previous_output" }
      }
    ],
    edges: [{ id: "draft-gate", source: "draft", target: "gate" }]
  };
  const items = await collect(streamRun({
    orgId, runId: "run-retry", prompt: "draft", workflow,
    roles: { [role.id]: role },
    skills: { [search.id]: search, [gate.id]: gate },
    files: [], connections: {}, provider: null, model: null
  }));
  const events = items.filter((item): item is Extract<RunYield, { kind: "event" }> => item.kind === "event");
  assert.equal(events.filter((item) => item.event.type === "node_started" && item.event.nodeId === "draft").length, 2);
  assert.equal(events.filter((item) => item.event.type === "eval_score_updated").length, 2);
  assert.ok(events.some((item) => item.event.type === "run_failed"));
});
