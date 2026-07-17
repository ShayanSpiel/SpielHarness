import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultInputContract,
  defaultOutputContract,
  type Model,
  type Role,
  type Skill,
  type WorkflowFile
} from "@spielos/core";
import { compileDirector } from "@spielos/graph/director/compile";
import { buildRoleSubagents } from "@spielos/graph/director/compile";
import { noopToolContext } from "@spielos/graph/director/tools";

const orgId = "00000000-0000-0000-0000-000000000001";

function fakeModel(): Model {
  return {
    id: "model-phase3",
    orgId,
    name: "Phase 3 test model",
    provider: "openai-compatible",
    model: "test-phase3-model",
    baseUrl: "https://provider.invalid/v1",
    secretEnvKey: "SPIELOS_TEST_LLM_KEY",
    config: { capabilities: { contextWindow: 4096, maxOutputTokens: 1024 } },
    enabled: true
  };
}

function roleWith(id: string, name: string, systemRole: "orchestrator" | "specialist" = "specialist", status: "active" | "archived" = "active"): Role {
  return {
    id,
    orgId,
    name,
    description: `${name} description`,
    prompt: `You are the ${name}.`,
    modelId: null,
    inputContract: defaultInputContract(),
    outputContract: defaultOutputContract(),
    skillIds: [],
    status,
    metadata: systemRole === "orchestrator" ? { systemRole } : {}
  };
}

function skillWith(id: string, slug: string, kind: Skill["kind"] = "knowledge_search"): Skill {
  return {
    id,
    orgId,
    name: id,
    slug,
    description: "",
    kind,
    status: "active",
    auth: "none",
    sideEffect: "none",
    inputSchema: "{}",
    outputSchema: "{}",
    implementation: "",
    bindings: [],
    metadata: {}
  };
}

test("buildRoleSubagents excludes the orchestrator and inactive roles", () => {
  const orchestrator = roleWith("role-orch", "Orchestrator", "orchestrator");
  const researcher = roleWith("role-researcher", "Researcher");
  const writer = roleWith("role-writer", "Writer");
  const archived = roleWith("role-archived", "Archived", "specialist", "archived");
  const subagents = buildRoleSubagents(
    { [orchestrator.id]: orchestrator, [researcher.id]: researcher, [writer.id]: writer, [archived.id]: archived },
    {},
    orchestrator.id
  );
  const names = subagents.map((s) => s.name);
  assert.deepEqual(names.sort(), ["role_role-researcher", "role_role-writer"]);
  const orch = subagents.find((s) => s.name.includes("orch"));
  assert.equal(orch, undefined);
});

test("compileDirector with no active roles and no workflows returns a bare agent", () => {
  const model = fakeModel();
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: roleWith("role-orch", "Orchestrator", "orchestrator"),
    roles: {},
    skills: {},
    workflows: {},
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  assert.ok(compiled.agent);
  assert.equal(compiled.subagents.length, 0);
  assert.equal(compiled.tools.length, 0);
});

test("compileDirector builds one execute_workflow tool when an active workflow is present", () => {
  const model = fakeModel();
  const workflow: WorkflowFile = {
    id: "wf-1",
    orgId,
    name: "Test workflow",
    description: "",
    status: "active",
    metadata: {},
    nodes: [
      {
        id: "node-1",
        title: "Step",
        roleId: "role-1",
        skillIds: ["skill-search"],
        fileIds: [],
        inputContract: "any",
        outputContract: "any",
        position: { x: 0, y: 0 }
      }
    ],
    edges: []
  };
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: roleWith("role-orch", "Orchestrator", "orchestrator"),
    roles: { "role-1": roleWith("role-1", "Step role") },
    skills: { "skill-search": skillWith("skill-search", "search", "knowledge_search") },
    workflows: { "wf-1": workflow },
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  const workflowTool = compiled.tools.find((t) => t.name === "execute_workflow");
  assert.ok(workflowTool, "execute_workflow tool should be present");
});

test("compileDirector builds one tool per active non-LLM skill", () => {
  const model = fakeModel();
  const skills = {
    search: skillWith("skill-search", "search", "knowledge_search"),
    rag: skillWith("skill-rag", "rag.file.read", "knowledge_search"),
    ask: skillWith("skill-ask", "ask-the-user", "human_input"),
    archived: skillWith("skill-archived", "archived", "knowledge_search")
  };
  skills.archived.status = "archived";
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: roleWith("role-orch", "Orchestrator", "orchestrator"),
    roles: {},
    skills,
    workflows: {},
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  const toolNames = compiled.tools.map((t) => t.name);
  assert.ok(toolNames.includes("execute_skill_search"));
  assert.ok(toolNames.includes("execute_skill_rag_file_read"));
  assert.ok(toolNames.includes("execute_skill_ask_the_user"));
  assert.ok(!toolNames.includes("execute_skill_archived"));
});

test("compileDirector skips LLM and artifact_create skills (they belong to roles)", () => {
  const model = fakeModel();
  const skills = {
    llm: skillWith("skill-llm", "llm.generate", "llm_call"),
    artifact: skillWith("skill-artifact", "artifact.create", "artifact_create")
  };
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: roleWith("role-orch", "Orchestrator", "orchestrator"),
    roles: {},
    skills,
    workflows: {},
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  const toolNames = compiled.tools.map((t) => t.name);
  assert.ok(!toolNames.includes("execute_skill_llm"));
  assert.ok(!toolNames.includes("execute_skill_artifact"));
});

test("compileDirector builds one tool per active eval", () => {
  const model = fakeModel();
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: roleWith("role-orch", "Orchestrator", "orchestrator"),
    roles: {},
    skills: {},
    workflows: {},
    evals: {
      "eval-1": {
        id: "eval-1",
        orgId,
        name: "Gate",
        description: "Gate eval",
        rules: [],
        overallThreshold: 75,
        loopConfig: { enabled: false, maxAttempts: 3, breakCondition: "on_pass", retryDelayMs: 0 },
        status: "active",
        metadata: {}
      }
    },
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  const toolNames = compiled.tools.map((t) => t.name);
  assert.ok(toolNames.includes("execute_eval_gate"));
});

test("compileDirector builds a subagent for every active specialist role", () => {
  const model = fakeModel();
  const orchestrator = roleWith("role-orch", "Orchestrator", "orchestrator");
  const researcher = roleWith("role-researcher", "Researcher");
  const writer = roleWith("role-writer", "Writer");
  const compiled = compileDirector({
    orgId,
    runId: "run-1",
    directorRole: orchestrator,
    roles: { [orchestrator.id]: orchestrator, [researcher.id]: researcher, [writer.id]: writer },
    skills: {},
    workflows: {},
    evals: {},
    provider: { ...model },
    model,
    suggestedHarnessRefs: [],
    toolContext: noopToolContext()
  });
  const subNames = compiled.subagents.map((s) => s.name).sort();
  assert.deepEqual(subNames, ["role_role-researcher", "role_role-writer"]);
});
