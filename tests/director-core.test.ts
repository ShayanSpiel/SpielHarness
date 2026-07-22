import assert from "node:assert/strict";
import test from "node:test";
import { defaultInputContract, defaultOutputContract, type Model, type Role, type HumanInputRequest } from "@spielos/core";
import {
  buildDirectorSystemPrompt,
  compileDirector,
  directorCompactionConfig,
  directorCompactionTrigger,
  historyToMessages
} from "@spielos/graph/director/compile";
import {
  mapDirectorInterrupts
} from "@spielos/graph/director/events";
import { mapDirectorValues } from "@spielos/graph/director/values";
import { DirectorUsageTracker } from "@spielos/graph/director/usage";
import { commandFromReply, resumePayloadFromReply } from "@spielos/graph/director/interrupt";
import { Command } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";

process.env.SPIELOS_TEST_LLM_KEY = process.env.SPIELOS_TEST_LLM_KEY ?? "sk-test-fake-key-for-unit-tests";

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
    config: { capabilities: { contextWindow: 4096, maxOutputTokens: 1024, toolCalling: true } },
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

test("director compaction follows the resolved context limit instead of the model maximum", () => {
  const model = fakeModel();
  assert.equal(directorCompactionTrigger({ model, maxInputTokens: 48_000 }), 38_400);
  assert.equal(directorCompactionTrigger({ model, maxInputTokens: null }), 3_276);
  assert.deepEqual(directorCompactionConfig({ model, maxInputTokens: 32_768 }), {
    inputLimit: 32_768,
    triggerTokens: 26_214,
    keepMessages: 2,
    summarySourceTokens: 131_072,
  });
});

test("director cleanup does not collapse when output cap equals context window", () => {
  const model: Model = {
    ...fakeModel(),
    config: {
      capabilities: {
        contextWindow: 32_768,
        maxOutputTokens: 32_768,
        compactionThreshold: 0.6,
        toolCalling: true,
      },
    },
  };
  assert.deepEqual(directorCompactionConfig({ model, maxInputTokens: null }), {
    inputLimit: 32_768,
    triggerTokens: 19_660,
    keepMessages: 2,
    summarySourceTokens: 131_072,
  });
});

test("historyToMessages converts user/system/assistant/tool into LangChain messages", () => {
  const messages = historyToMessages([
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi!" },
    { role: "tool", content: "result", name: "call_123" }
  ]);
  assert.equal(messages.length, 4);
  assert.equal(messages[0].getType(), "system");
  assert.equal(messages[1].getType(), "human");
  assert.equal(messages[2].getType(), "ai");
  assert.equal(messages[3].getType(), "tool");
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

test("mapDirectorValues yields per-message deltas and native tool activity without duplication", async () => {
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
  const first = new AIMessage({
    id: "message-1",
    content: "Hello",
    tool_calls: [{ id: "call-1", name: "read_file", args: { path: "/context/a.md" }, type: "tool_call" }]
  });
  const second = new AIMessage({
    id: "message-1",
    content: "Hello world",
    tool_calls: [{ id: "call-1", name: "read_file", args: { path: "/context/a.md" }, type: "tool_call" }],
    usage_metadata: { input_tokens: 3, output_tokens: 4, total_tokens: 7 }
  });
  const result = new ToolMessage({ id: "tool-1", content: "evidence", tool_call_id: "call-1" });
  const child = new AIMessage({ id: "child-message", content: "private child synthesis" });
  const tracker = new DirectorUsageTracker(() => {});
  const source = (async function* () {
    yield ["values", { messages: [first], todos: [{ content: "Read evidence", status: "in_progress" }] }];
    yield [["task:child"], "values", { messages: [child], todos: [{ content: "Independent check", status: "in_progress" }] }];
    yield ["values", { messages: [second, result], todos: [{ content: "Read evidence", status: "completed" }] }];
    const summary = new HumanMessage({
      id: "summary-1",
      content: "You are in the middle of a conversation that has been summarized.\n<summary>Evidence was read and the durable decision was preserved.</summary>",
      additional_kwargs: { lc_source: "summarization" }
    });
    yield ["values", {
      messages: [first, second, result],
      todos: [{ content: "Read evidence", status: "completed" }],
      _summarizationSessionId: "session-1",
      _summarizationEvent: { cutoffIndex: 2, summaryMessage: summary, filePath: "/conversation_history/session-1.md" }
    }];
  })();
  for await (const yield_ of mapDirectorValues(targetWithCollect, source, tracker, () => null)) {
    if (yield_.kind === "text") collected.push(yield_.text);
  }
  assert.deepEqual(collected, ["Hello", " world"]);
  assert.equal(emitted.filter((event) => event.type === "tool_call_started").length, 1);
  assert.equal(emitted.filter((event) => event.type === "tool_call_result").length, 1);
  assert.ok(emitted.some((event) => event.type === "status" && event.payload?.category === "planning"));
  const cleanup = emitted.find((event) => event.type === "status" && event.payload?.category === "compaction");
  assert.equal(cleanup?.message, "Context cleaned up.");
  assert.equal(cleanup?.payload?.summary, "Evidence was read and the durable decision was preserved.");
  assert.ok(!collected.join("").includes("private child synthesis"));
  assert.deepEqual(tracker.snapshot(), { input: 3, output: 4 });
});

test("mapDirectorValues does not mistake a shorter values snapshot for compaction", async () => {
  const emitted: import("@spielos/core").RunEvent[] = [];
  const tracker = new DirectorUsageTracker(() => {});
  const buildCheckpoint = (state: import("@spielos/graph/director/events").DirectorStateSnapshot) => ({
    completedNodes: [], outputs: {}, artifacts: [], events: [], evalAttempts: {},
    pendingHumanInput: null, status: "running" as const, failed: false,
    failedNode: null, error: null, retryNodeId: null,
    longHorizon: state.longHorizon, goal: state.goal, budget: state.budget,
    progress: state.progress, verification: state.verification
  });
  const source = (async function* () {
    yield ["values", { messages: [new HumanMessage("one"), new AIMessage("two")] }];
    yield ["values", { messages: [new AIMessage("two")] }];
  })();
  for await (const _ of mapDirectorValues({
    orgId,
    runId: "run-no-false-compaction",
    emitEvent: (event) => {
      emitted.push(event);
      return event;
    },
    buildCheckpoint
  }, source, tracker, () => null)) {
    // Drain native values.
  }
  assert.equal(emitted.filter((event) => event.payload?.category === "compaction").length, 0);
});

test("mapDirectorValues presents delegated file-backed roles by their saved names", async () => {
  const emitted: import("@spielos/core").RunEvent[] = [];
  const target = {
    orgId,
    runId: "run-1",
    emitEvent: (event: import("@spielos/core").RunEvent) => {
      emitted.push(event);
      return event;
    },
    buildCheckpoint: () => { throw new Error("not used"); }
  };
  const task = new AIMessage({
    id: "delegate-1",
    content: "",
    tool_calls: [{
      id: "task-1",
      name: "task",
      args: { subagent_type: "role_notion_admin_a4e1da28", description: "Inspect the workspace" },
      type: "tool_call"
    }]
  });
  const source = (async function* () {
    yield ["values", { messages: [task] }];
  })();
  const tracker = new DirectorUsageTracker();
  for await (const _ of mapDirectorValues(
    target,
    source,
    tracker,
    () => null,
    0,
    {},
    undefined,
    undefined,
    { role_notion_admin_a4e1da28: { roleId: "a4e1da28-dc76-45f5-984a-12c129f98ef6", roleName: "Notion Admin" } }
  )) { /* collect emitted events */ }
  const delegation = emitted.find((entry) => entry.type === "tool_call_started");
  assert.equal(delegation?.payload?.roleId, "a4e1da28-dc76-45f5-984a-12c129f98ef6");
  assert.equal(delegation?.payload?.roleName, "Notion Admin");
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

test("mapDirectorInterrupts preserves native LangChain approval actions", () => {
  const target = {
    orgId,
    runId: "run-approval",
    emitEvent: (event: import("@spielos/core").RunEvent) => event,
    buildCheckpoint: () => { throw new Error("not used"); }
  };
  const request = mapDirectorInterrupts(target, [{
    id: "approval-1",
    value: {
      actionRequests: [{ name: "execute_skill_send", args: { input: "send" }, description: "Send the message?" }],
      reviewConfigs: [{ actionName: "execute_skill_send", allowedDecisions: ["approve", "reject"] }]
    }
  }]);
  assert.ok(request);
  assert.equal(request.id, "approval-1");
  assert.equal(request.questions[0].question, "Send the message?");
  assert.deepEqual(request.questions[0].options?.map((option) => option.id), ["approve", "reject"]);
  assert.equal(request.metadata?.nativeType, "langgraph_hitl");
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

test("DirectorUsageTracker is a pure accumulator (no callback, no foldOnce)", () => {
  const tracker = new DirectorUsageTracker();
  tracker.record({ input_tokens: 5, output_tokens: 3 });
  tracker.record({ input_tokens: 4, output_tokens: 9 });
  assert.deepEqual(tracker.snapshot(), { input: 9, output: 12 });
});

test("DirectorUsageTracker.mergeFromSubagent is a billing no-op", () => {
  const tracker = new DirectorUsageTracker();
  tracker.mergeFromSubagent({ input_tokens: 7, output_tokens: 2 });
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
