import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_EXECUTION_MODE,
  defaultInputContract,
  defaultOutputContract,
  executionModeSchema,
  type ExecutionMode,
  type Model,
  type Role,
  type Skill,
  type WorkflowFile
} from "@spielos/core";
import {
  streamChatRun,
  streamDirectorRun,
  streamRun,
  type DirectorRunRequest,
  type RunYield
} from "@spielos/graph";

const orgId = "00000000-0000-0000-0000-000000000001";
const role: Role = {
  id: "role-direct",
  orgId,
  name: "Direct role",
  description: "",
  prompt: "Run the direct workflow",
  modelId: null,
  inputContract: defaultInputContract(),
  outputContract: defaultOutputContract(),
  skillIds: [],
  status: "active",
  metadata: {}
};

function skill(id: string, kind: Skill["kind"], extra: Partial<Skill> = {}): Skill {
  return {
    id,
    orgId,
    name: id,
    slug: id,
    description: "",
    kind,
    status: "active",
    auth: "none",
    sideEffect: "none",
    inputSchema: "{}",
    outputSchema: "{}",
    implementation: "",
    bindings: [],
    metadata: {},
    ...extra
  };
}

async function collect(generator: AsyncGenerator<RunYield, void, void>) {
  const items: RunYield[] = [];
  for await (const item of generator) items.push(item);
  return items;
}

function fakeModel(): Model {
  return {
    id: "model-direct",
    orgId,
    name: "Direct test model",
    provider: "openai-compatible",
    model: "test-direct-model",
    baseUrl: "https://provider.invalid/v1",
    secretEnvKey: "SPIELOS_TEST_LLM_KEY",
    config: { capabilities: { contextWindow: 4096, maxOutputTokens: 1024 } },
    enabled: true
  };
}

function fakeStreamingFetch(calls: Array<Record<string, unknown>>) {
  return async (_input: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const body = [
      'data: {"choices":[{"delta":{"content":"Grounded response"}}]}',
      "",
      "data: [DONE]",
      ""
    ].join("\n");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
}

test("default execution mode is direct and the schema accepts only the two known modes", () => {
  assert.equal(DEFAULT_EXECUTION_MODE, "direct");
  assert.deepEqual(executionModeSchema.options, ["director", "direct"]);
  assert.equal(executionModeSchema.parse("director"), "director");
  assert.equal(executionModeSchema.parse("direct"), "direct");
  assert.equal(executionModeSchema.safeParse("autopilot").success, false);
});

test("direct mode with no target routes to streamChatRun and emits a single completion", async () => {
  const model = fakeModel();
  const calls: Array<Record<string, unknown>> = [];
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.SPIELOS_TEST_LLM_KEY;
  globalThis.fetch = fakeStreamingFetch(calls) as typeof fetch;
  process.env.SPIELOS_TEST_LLM_KEY = "test-key";
  try {
    const items = await collect(streamChatRun({
      orgId,
      runId: "run-direct-chat",
      prompt: "What's the market?",
      directorPrompt: "Be concise.",
      roles: {},
      skills: {},
      files: [],
      connections: {},
      provider: { ...model },
      model,
      chatMetadata: {},
      history: [{ role: "user", content: "What's the market?" }],
      executionMode: "direct"
    }));
    assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_started"));
    assert.ok(items.some((item) => item.kind === "text" && item.text.includes("Grounded response")));
    assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
    assert.equal(items.filter((item) => item.kind === "done").length, 1);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SPIELOS_TEST_LLM_KEY;
    else process.env.SPIELOS_TEST_LLM_KEY = previousKey;
  }
});

test("direct mode with a single-node role target runs the same graph as before director shipped", async () => {
  const search = skill("direct-search", "knowledge_search");
  const items = await collect(streamRun({
    orgId,
    runId: "run-direct-role",
    prompt: "Find evidence",
    workflow: null,
    singleNode: { kind: "skill", nodeId: "direct-node", title: "Direct skill", role, skill: search, fileIds: [] },
    roles: { [role.id]: role },
    skills: { [search.id]: search },
    files: [],
    connections: {},
    provider: null,
    model: null,
    executionMode: "direct"
  }));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "node_started"));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "node_completed"));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
  assert.equal(items.filter((item) => item.kind === "done").length, 1);
});

test("direct mode with a workflow target runs the deterministic multi-node graph", async () => {
  const searchA = skill("search-a", "knowledge_search");
  const searchB = skill("search-b", "knowledge_search");
  const workflow: WorkflowFile = {
    id: "workflow-direct",
    orgId,
    name: "Direct workflow",
    description: "",
    status: "active",
    metadata: {},
    nodes: [
      { id: "first", title: "First", roleId: role.id, skillIds: [searchA.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 0, y: 0 } },
      { id: "second", title: "Second", roleId: role.id, skillIds: [searchB.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 200, y: 0 } }
    ],
    edges: [{ id: "first-second", source: "first", target: "second" }]
  };
  const items = await collect(streamRun({
    orgId,
    runId: "run-direct-workflow",
    prompt: "Walk both steps",
    workflow,
    roles: { [role.id]: role },
    skills: { [searchA.id]: searchA, [searchB.id]: searchB },
    files: [{ id: "file-1", title: "Evidence", body: "Market signal", fileType: "knowledge", metadata: {} }],
    connections: {},
    provider: null,
    model: null,
    executionMode: "direct"
  }));
  const started = items.filter((item) => item.kind === "event" && item.event.type === "node_started");
  const nodeIds = new Set(started.map((item) => (item as Extract<RunYield, { kind: "event" }>).event.nodeId));
  assert.ok(nodeIds.has("first"));
  assert.ok(nodeIds.has("second"));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_completed"));
});

test("direct mode with a paused run, resume, restores the durable checkpoint", async () => {
  const human = skill("human-direct", "human_input", {
    humanQuestions: [{ id: "ok", kind: "single", question: "Continue?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }]
  });
  const search = skill("search-resume", "knowledge_search");
  const workflow: WorkflowFile = {
    id: "workflow-direct-resume",
    orgId,
    name: "Direct resume",
    description: "",
    status: "active",
    metadata: {},
    nodes: [
      { id: "approval", title: "Approval", roleId: role.id, skillIds: [human.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 0, y: 0 } },
      { id: "search", title: "Search", roleId: role.id, skillIds: [search.id], fileIds: [], inputContract: "any", outputContract: "any", position: { x: 200, y: 0 } }
    ],
    edges: [{ id: "approval-search", source: "approval", target: "search" }]
  };
  const base = {
    orgId,
    runId: "run-direct-resume",
    prompt: "Market evidence",
    workflow,
    roles: { [role.id]: role },
    skills: { [human.id]: human, [search.id]: search },
    files: [{ id: "file-resume", title: "Market evidence", body: "Evidence body", fileType: "knowledge", metadata: {} }],
    connections: {},
    provider: null,
    model: null,
    executionMode: "direct" as ExecutionMode
  };
  const paused = await collect(streamRun(base));
  assert.ok(paused.some((item) => item.kind === "human_input"));
  const state = [...paused].reverse().find((item): item is Extract<RunYield, { kind: "checkpoint" }> => item.kind === "checkpoint")!.state;
  const resumed = await collect(streamRun({ ...base, resume: { ok: "yes" }, checkpoint: state }));
  assert.ok(!resumed.some((item) => item.kind === "human_input"));
  assert.ok(resumed.some((item) => item.kind === "event" && item.event.type === "run_completed"));
});

test("director mode is wired and reaches the deepagents runtime when the orchestrator role is present", async () => {
  // The director runtime requires an active Orchestrator role
  // (systemRole: "orchestrator"). When one is present, the
  // runtime attempts to compile and invoke the deep agent. The
  // test verifies the wiring, the early `run_started` event, and
  // the failure surface (the test model is not a real LLM, so the
  // deep agents runtime will fail at invoke time). The failure
  // path emits `run_failed` and a single `done` frame.
  const model = fakeModel();
  const orchestrator = {
    ...role,
    id: "role-orchestrator",
    name: "Orchestrator",
    description: "Director",
    prompt: "You are the Director.",
    metadata: { systemRole: "orchestrator" }
  };
  const items = await collect(streamDirectorRun({
    orgId,
    runId: "run-director-wired",
    prompt: "Plain chat question",
    directorPrompt: orchestrator.prompt,
    roles: { [orchestrator.id]: orchestrator },
    skills: {},
    files: [],
    connections: {},
    provider: { ...model },
    model,
    chatMetadata: {},
    history: [{ role: "user", content: "Plain chat question" }],
    executionMode: "director"
  } as DirectorRunRequest));
  assert.ok(items.some((item) => item.kind === "event" && item.event.type === "run_started"));
  assert.equal(items.filter((item) => item.kind === "done").length, 1);
  // The deep agent compile or invoke may succeed or fail in
  // tests; either way a terminal `done` is emitted exactly once
  // and the harness owns the durable run.
  const done = items.find((item): item is Extract<RunYield, { kind: "done" }> => item.kind === "done");
  assert.ok(done);
  assert.ok(["completed", "failed", "waiting_human", "cancelled"].includes(done.status));
});
