import assert from "node:assert/strict";
import test from "node:test";
import { defaultInputContract, defaultOutputContract, type Model, type Role, type HumanInputRequest } from "@spielos/core";
import {
  buildDirectorSystemPrompt,
  compileDirector,
  historyToMessages
} from "@spielos/graph/director/compile";
import {
  mapDirectorInterrupts,
  mapDirectorMessages,
  mapDirectorSubagents,
  mapDirectorToolCalls
} from "@spielos/graph/director/events";
import { DirectorUsageTracker } from "@spielos/graph/director/usage";
import { commandFromReply, resumePayloadFromReply } from "@spielos/graph/director/interrupt";
import { Command } from "@langchain/langgraph";

const orgId = "00000000-0000-0000-0000-000000000001";
const role: Role = {
  id: "role-director",
  orgId,
  name: "Director",
  description: "",
  prompt: "Be the SpielOS Director.",
  modelId: null,
  inputContract: defaultInputContract(),
  outputContract: defaultOutputContract(),
  skillIds: [],
  status: "active",
  metadata: { systemRole: "orchestrator" }
};

function fakeModel(): Model {
  return {
    id: "model-director",
    orgId,
    name: "Director test model",
    provider: "openai-compatible",
    model: "test-director-model",
    baseUrl: "https://provider.invalid/v1",
    secretEnvKey: "SPIELOS_TEST_LLM_KEY",
    config: { capabilities: { contextWindow: 4096, maxOutputTokens: 1024 } },
    enabled: true
  };
}

test("buildDirectorSystemPrompt prefers the role prompt and folds the contracts", () => {
  const prompt = buildDirectorSystemPrompt(role, "fallback");
  assert.ok(prompt.includes("Be the SpielOS Director"));
  assert.ok(prompt.includes("Input contract"));
  assert.ok(prompt.includes("Output contract"));
});

test("buildDirectorSystemPrompt falls back when no role is provided", () => {
  assert.equal(buildDirectorSystemPrompt(null, "fallback"), "fallback");
});

test("historyToMessages converts user/system/assistant into LangChain messages", () => {
  const messages = historyToMessages([
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi!" }
  ]);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].getType(), "system");
  assert.equal(messages[1].getType(), "human");
  assert.equal(messages[2].getType(), "human");
});

test("compileDirector requires a configured provider and model", () => {
  assert.throws(() => compileDirector({
    orgId,
    runId: "run-1",
    directorRole: role,
    roles: {},
    skills: {},
    workflows: {},
    evals: {},
    provider: null,
    model: null,
    suggestedHarnessRefs: [],
    toolContext: { executeWorkflow: async () => "{}", executeSkill: async () => "{}", executeEval: async () => "{}" }
  }), /configured provider/);
});

test("compileDirector produces a deep agent with a system prompt and bound model", () => {
  const model = fakeModel();
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: role,
    roles: {},
    skills: {},
    workflows: {},
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: { executeWorkflow: async () => "{}", executeSkill: async () => "{}", executeEval: async () => "{}" }
  });
  assert.ok(compiled.agent);
  assert.ok(compiled.systemPrompt.includes("Be the SpielOS Director"));
  assert.ok(compiled.model);
});

test("mapDirectorMessages yields text and emits usage events for the chat model stream", async () => {
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => event,
    buildCheckpoint: (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "running" as const,
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null,
      longHorizon: state.longHorizon,
      goal: state.goal,
      budget: state.budget,
      progress: state.progress,
      verification: state.verification
    })
  };
  const collected: string[] = [];
  const emitted: import("@spielos/core").RunEvent[] = [];
  const targetWithCollect = {
    ...target,
    emitEvent: (event: import("@spielos/core").RunEvent) => {
      emitted.push(event);
      return event;
    }
  };
  const handle = {
    node: "agent",
    namespace: ["agent"],
    text: (async function* () {
      yield "Hello ";
      yield "world.";
    })(),
    usage: (async function* () {
      yield { input_tokens: 3, output_tokens: 4, total_tokens: 7 };
    })()
  };
  for await (const yield_ of mapDirectorMessages(targetWithCollect, (async function* () { yield handle; })())) {
    if (yield_.kind === "text") collected.push(yield_.text);
  }
  assert.deepEqual(collected, ["Hello ", "world."]);
  assert.ok(emitted.some((event) => event.type === "status" && event.payload?.category === "usage"));
});

test("mapDirectorInterrupts converts a LangGraph interrupt payload into a HumanInputRequest", () => {
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => event,
    buildCheckpoint: (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "running" as const,
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null,
      longHorizon: state.longHorizon,
      goal: state.goal,
      budget: state.budget,
      progress: state.progress,
      verification: state.verification
    })
  };
  const interrupt = {
    id: "interrupt-1",
    value: {
      questions: [
        { id: "approve", kind: "single", question: "Approve?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }
      ]
    }
  };
  const request = mapDirectorInterrupts(target, [interrupt]);
  assert.ok(request);
  assert.equal(request.questions.length, 1);
  assert.equal(request.questions[0].id, "approve");
  assert.equal(request.nodeId, "director");
});

test("mapDirectorInterrupts returns null when the payload is empty or malformed", () => {
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => event,
    buildCheckpoint: (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "running" as const,
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null,
      longHorizon: state.longHorizon,
      goal: state.goal,
      budget: state.budget,
      progress: state.progress,
      verification: state.verification
    })
  };
  assert.equal(mapDirectorInterrupts(target, []), null);
  assert.equal(mapDirectorInterrupts(target, [{ value: { questions: [] } }]), null);
  assert.equal(mapDirectorInterrupts(target, [{ value: "not a question" }]), null);
});

test("mapDirectorToolCalls emits a tool_call_started event for every call", async () => {
  const emitted: import("@spielos/core").RunEvent[] = [];
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => {
      emitted.push(event);
      return event;
    },
    buildCheckpoint: (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "running" as const,
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null,
      longHorizon: state.longHorizon,
      goal: state.goal,
      budget: state.budget,
      progress: state.progress,
      verification: state.verification
    })
  };
  const calls: AsyncIterable<{
    name: string;
    callId: string;
    input: unknown;
    output: Promise<unknown>;
    status: Promise<"running" | "finished" | "error">;
    error: Promise<string | undefined>;
  }> = (async function* () {
    yield {
      name: "knowledge.search",
      callId: "call-1",
      input: { q: "What is a Director?" },
      output: Promise.resolve("A Director orchestrates."),
      status: Promise.resolve("finished"),
      error: Promise.resolve(undefined)
    };
  })();
  for await (const _yield_ of mapDirectorToolCalls(target, calls)) {
    void _yield_;
  }
  assert.ok(emitted.some((event) => event.type === "tool_call_started" && event.payload?.operation === "knowledge.search"));
  assert.ok(emitted.some((event) => event.type === "tool_call_result" && event.payload?.success === true));
});

test("mapDirectorSubagents recurses through nested delegation", async () => {
  const emitted: import("@spielos/core").RunEvent[] = [];
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => {
      emitted.push(event);
      return event;
    },
    buildCheckpoint: (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
      completedNodes: [],
      outputs: {},
      artifacts: [],
      events: [],
      evalAttempts: {},
      pendingHumanInput: null,
      status: "running" as const,
      failed: false,
      failedNode: null,
      error: null,
      retryNodeId: null,
      longHorizon: state.longHorizon,
      goal: state.goal,
      budget: state.budget,
      progress: state.progress,
      verification: state.verification
    })
  };
  const source = (async function* () {
    yield {
      name: "general-purpose",
      cause: undefined,
      output: Promise.resolve({}),
      messages: (async function* () { yield { node: "child-agent", namespace: ["child-agent"], text: (async function* () { yield "child response"; })(), usage: (async function* () {})() }; })(),
      toolCalls: (async function* () {})(),
      subagents: (async function* () {})()
    };
  })();
  for await (const _yield_ of mapDirectorSubagents(target, source)) {
    void _yield_;
  }
  assert.ok(emitted.some((event) => event.type === "status" && event.payload?.category === "subagent_entered"));
  assert.ok(emitted.some((event) => event.type === "status" && event.payload?.category === "subagent_exited"));
});

test("DirectorUsageTracker folds once and ignores later folds", () => {
  let calls = 0;
  const tracker = new DirectorUsageTracker(() => { calls += 1; });
  tracker.record({ input_tokens: 5, output_tokens: 3 });
  tracker.record({ input_tokens: 4, output_tokens: 9 });
  const first = tracker.foldOnce();
  const second = tracker.foldOnce();
  assert.deepEqual(first, { input: 5, output: 9 });
  assert.deepEqual(second, { input: 5, output: 9 });
  assert.equal(calls, 1);
});

test("DirectorUsageTracker.mergeFromSubagent is a billing no-op", () => {
  let calls = 0;
  const tracker = new DirectorUsageTracker(() => { calls += 1; });
  tracker.mergeFromSubagent({ input_tokens: 7, output_tokens: 2 });
  tracker.foldOnce();
  assert.equal(calls, 1);
  assert.deepEqual(tracker.snapshot(), { input: 0, output: 0 });
});

test("commandFromReply translates answers into a LangGraph Command with a resume payload", () => {
  const request: HumanInputRequest = {
    id: "interrupt-1",
    nodeId: "director",
    skillId: "director",
    questions: [
      { id: "approve", kind: "single", question: "Approve?", options: [{ id: "yes", label: "Yes" }], allowCustom: false }
    ],
    createdAt: new Date().toISOString()
  };
  const body = { requestId: "interrupt-1", answers: { approve: "yes" } };
  const command = commandFromReply(request, body);
  assert.ok(command instanceof Command);
  const resume = commandFromReply(request, body);
  assert.ok(resume);
});

test("resumePayloadFromReply returns an empty object for non-object answers", () => {
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: null as unknown as Record<string, unknown> }), {});
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: "string" as unknown as Record<string, unknown> }), {});
  assert.deepEqual(resumePayloadFromReply({ requestId: "x", answers: { a: 1, b: "two" } }), { a: 1, b: "two" });
});
