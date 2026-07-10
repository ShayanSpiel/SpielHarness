import type {
  Artifact,
  HumanInputRequest,
  HumanInputQuestion,
  Model,
  ModelProvider,
  Role,
  RunEvent,
  Skill
} from "@spielos/core";
import { streamChat } from "@spielos/providers";
import { evaluateRules } from "@spielos/evals";
import { Annotation, END, getWriter, interrupt, START, StateGraph } from "@langchain/langgraph";

// ── Streamable protocol ───────────────────────────────────────
export type RunYield =
  | { kind: "event"; event: RunEvent }
  | { kind: "artifact"; artifact: Artifact }
  | { kind: "human_input"; request: HumanInputRequest }
  | { kind: "status"; status: RunStatusChunk }
  | { kind: "text"; text: string }
  | { kind: "values"; state: RunState };

type RunStatusChunk =
  | {
      phase: "node_started" | "node_completed" | "skill_started" | "skill_completed" | "generating" | "thinking";
      nodeTitle?: string;
      roleName?: string;
      skillName?: string;
      message: string;
    };

type GraphCustomChunk =
  | { kind: "text_delta"; text: string }
  | { kind: "status"; status: RunStatusChunk };

export type RunState = {
  orgId: string;
  runId: string;
  prompt: string;
  status: string;
  humanInputs: Record<string, Record<string, unknown>>;
  artifacts: Artifact[];
  events: RunEvent[];
  humanInputRequest: HumanInputRequest | null;
  // pass-through execution context
  workstreamId: string | null;
  rolesById: Record<string, Role>;
  skills: Skill[];
  role: Role | null;
  skill: Skill | null;
  node: { id: string; title: string; roleId: string; promptOverride?: string; skillIds: string[]; fileIds?: string[] } | null;
  provider: ModelProvider | null;
  model: Model | null;
  knowledgeFiles: Array<{
    id: string;
    title: string;
    body: string;
    fileType: string;
    metadata: Record<string, unknown>;
  }>;
  // accumulated text from the active llm_call skill
  output: string;
  // list of nodes to execute (single node is the common case)
  nodes: Array<{ id: string; title: string; roleId: string; promptOverride?: string; skillIds: string[]; fileIds?: string[] }>;
  cursor: number;
};

const RunStateAnnotation = Annotation.Root({
  orgId: Annotation<string>,
  runId: Annotation<string>,
  prompt: Annotation<string>,
  status: Annotation<string>,
  humanInputs: Annotation<Record<string, Record<string, unknown>>>(
    {
      reducer: (current, update: Record<string, Record<string, unknown>>) => ({ ...current, ...update }),
      default: () => ({})
    }
  ),
  artifacts: Annotation<Artifact[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  events: Annotation<RunEvent[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => []
  }),
  humanInputRequest: Annotation<HumanInputRequest | null>,
  workstreamId: Annotation<string | null>,
  rolesById: Annotation<Record<string, Role>>({
    reducer: (_current, update: Record<string, Role>) => update,
    default: () => ({})
  }),
  skills: Annotation<Skill[]>({
    reducer: (_current, update: Skill[]) => update,
    default: () => []
  }),
  role: Annotation<Role | null>,
  skill: Annotation<Skill | null>,
  node: Annotation<RunState["node"]>,
  provider: Annotation<ModelProvider | null>,
  model: Annotation<Model | null>,
  knowledgeFiles: Annotation<RunState["knowledgeFiles"]>({
    reducer: (_current, update: RunState["knowledgeFiles"]) => update,
    default: () => []
  }),
  output: Annotation<string>({
    reducer: (_current, update: string) => update,
    default: () => ""
  }),
  nodes: Annotation<RunState["nodes"]>,
  cursor: Annotation<number>({
    reducer: (_current, update: number) => update,
    default: () => 0
  })
});

// ── LangGraph graph definition ────────────────────────────────
// Three nodes only — execution is data-driven, not hardcoded to "Editor".
//   resolve → set role/skill/node from cursor
//   execute → run the active skill (llm_call, eval, human_input, code, http, mcp_call, knowledge_search)
//   advance → move cursor forward
// Routing: execute → advance → (resolve if more nodes | END)
const graph = new StateGraph(RunStateAnnotation)
  .addNode("resolve", async (state) => {
    if (state.cursor >= state.nodes.length) {
      return { status: "completed" };
    }
    const node = state.nodes[state.cursor];
    // The first skill is the active one; the rest are companion skills.
    const skill = state.skills.find(
      (s) => s.id === (node.skillIds[0] ?? null)
    ) ?? null;
    const role = state.rolesById[node.roleId] ?? state.role;
    getWriter()?.({
      kind: "status",
      status: {
        phase: "node_started",
        nodeTitle: node.title,
        roleName: role?.name,
        skillName: skill?.name,
        message: `${node.title} started.`
      }
    } satisfies GraphCustomChunk);
    return {
      node,
      role,
      skill,
      status: "running",
      events: [
        event(
          { orgId: state.orgId, runId: state.runId },
          "node_started",
          `${node.title} started.`,
          {
            node: node.title,
            skill: skill?.name,
            payload: { nodeId: node.id, roleId: node.roleId, roleName: role?.name, skillId: skill?.id, skillName: skill?.name }
          }
        )
      ]
    };
  })
  .addNode("execute", async (state) => {
    if (!state.role || !state.skill || !state.node) return {};
    const node = state.node;
    const skill = state.skill;
    const role = state.role;
    const systemPrompt = node.promptOverride || role.prompt;
    const composed = `${systemPrompt}\n\n---\n\nUser request:\n${state.prompt}`;
    const writer = getWriter();
    const started = event(
      { orgId: state.orgId, runId: state.runId },
      "skill_started",
      `${skill.name || skill.slug} started.`,
      {
        node: node.title,
        skill: skill.name || skill.slug,
        payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
      }
    );
    writer?.({
      kind: "status",
      status: {
        phase: "skill_started",
        nodeTitle: node.title,
        roleName: role.name,
        skillName: skill.name || skill.slug,
        message: `${skill.name || skill.slug} started.`
      }
    } satisfies GraphCustomChunk);

    // HUMAN INPUT
    if (skill.kind === "human_input") {
      const questions: HumanInputQuestion[] =
        skill.humanQuestions && skill.humanQuestions.length > 0
          ? skill.humanQuestions
          : [
              {
                id: "default",
                kind: "none",
                question: `${node.title}: please review the work so far.`,
                allowCustom: true
              }
            ];
      const request: HumanInputRequest = {
        id: `hi_${crypto.randomUUID()}`,
        nodeId: node.id,
        skillId: skill.id,
        questions,
        header: node.title,
        createdAt: new Date().toISOString()
      };
      return {
        humanInputRequest: request,
        status: "waiting_human",
        events: [started]
      };
    }

    // EVAL
    if (skill.kind === "eval") {
      const rules = (skill.evalRubrics ?? []).map((r) => ({
        label: r.label,
        type: r.type,
        value: r.value,
        weight: r.weight
      }));
      const result = evaluateRules(state.output || state.prompt, rules);
      const artifact: Artifact = {
        id: `art_${crypto.randomUUID()}`,
        orgId: state.orgId,
        runId: state.runId,
        type: "eval_report",
        title: `${node.title} — ${result.overall}/100`,
        body: [
          `Score: ${result.overall}/100`,
          `Threshold: ${skill.overallThreshold ?? 75}`,
          `Status: ${result.overall >= (skill.overallThreshold ?? 75) ? "PASSED" : "FAILED"}`,
          "",
          "Findings:",
          ...result.findings.map((f) => `- ${f.label}: ${f.score} (${f.notes})`)
        ].join("\n"),
        parentArtifactIds: [],
        metadata: { result, skillId: skill.id, nodeId: node.id }
      };
      const passed = result.overall >= (skill.overallThreshold ?? 75);
      return {
        artifacts: [artifact],
        status: "running",
        events: [
          started,
          event(
            { orgId: state.orgId, runId: state.runId },
            "eval_score_updated",
            `Eval try 1: ${passed ? "Passed" : "Failed"} at ${result.overall}/100.`,
            {
              node: node.title,
              skill: skill.name || skill.slug,
              payload: {
                nodeTitle: node.title,
                roleName: role.name,
                skillName: skill.name || skill.slug,
                score: result.overall,
                threshold: skill.overallThreshold ?? 75,
                passed,
                attempt: 1
              }
            }
          ),
          event(
            { orgId: state.orgId, runId: state.runId },
            "skill_completed",
            `${skill.name || skill.slug} completed.`,
            {
              node: node.title,
              skill: skill.name || skill.slug,
              payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
            }
          )
        ]
      };
    }

    // LLM CALL
    if (skill.kind === "llm_call") {
      if (!state.provider || !state.model) {
        return {
          output: "[ERROR] LLM is not connected. Set MODEL_PROVIDER, MODEL_PROVIDER_KIND, and MODEL_NAME environment variables (or configure a provider in Settings).",
          events: [
            started,
            event(
              { orgId: state.orgId, runId: state.runId },
              "skill_completed",
              `${skill.name || skill.slug} completed with configuration error.`,
              {
                node: node.title,
                skill: skill.name || skill.slug,
                payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
              }
            )
          ]
        };
      }
      writer?.({
        kind: "status",
        status: {
          phase: "generating",
          nodeTitle: node.title,
          roleName: role.name,
          skillName: skill.name || skill.slug,
          message: `${role.name} is generating.`
        }
      } satisfies GraphCustomChunk);
      let output = "";
      const response = await streamChat(state.provider, state.model, [
        { role: "system", content: composed },
        { role: "user", content: state.prompt }
      ]);
      for await (const delta of response) {
        output += delta;
        writer?.({ kind: "text_delta", text: delta } satisfies GraphCustomChunk);
      }
      return {
        output,
        events: [
          started,
          event(
            { orgId: state.orgId, runId: state.runId },
            "skill_completed",
            `${skill.name || skill.slug} completed.`,
            {
              node: node.title,
              skill: skill.name || skill.slug,
              payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
            }
          )
        ]
      };
    }

    // HTTP / CODE / MCP / KNOWLEDGE_SEARCH — placeholders for now.
    if (skill.kind === "knowledge_search") {
      const terms = state.prompt
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2);
      if (skill.slug === "rag.file.read") {
        const requestedIds = node.fileIds ?? [];
        const matches = requestedIds.length
          ? state.knowledgeFiles.filter((file) => requestedIds.includes(file.id))
          : state.knowledgeFiles
              .filter((file) => terms.some((term) => file.title.toLowerCase().includes(term)))
              .slice(0, 3);
        return {
          output: matches.length
            ? matches.map((file) => `# ${file.title}\n\n${file.body}`).join("\n\n---\n\n")
            : "No matching file was found for RAG File Read.",
          events: [
            started,
            event(
              { orgId: state.orgId, runId: state.runId },
              "skill_completed",
              `${skill.name || skill.slug} completed.`,
              {
                node: node.title,
                skill: skill.name || skill.slug,
                payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
              }
            )
          ]
        };
      }
      const scored = state.knowledgeFiles
        .map((file) => {
          const haystack = `${file.title}\n${file.body}`.toLowerCase();
          const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
          return { file, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);
      return {
        output: scored.length
          ? scored
              .map(({ file }) => `- ${file.title} (${file.fileType}, ${file.id}): ${file.body.slice(0, 500)}`)
              .join("\n")
          : "No matching harness files found.",
        events: [
          started,
          event(
            { orgId: state.orgId, runId: state.runId },
            "skill_completed",
            `${skill.name || skill.slug} completed.`,
            {
              node: node.title,
              skill: skill.name || skill.slug,
              payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
            }
          )
        ]
      };
    }

    // HTTP / CODE / MCP — placeholders for now.
    // Each kind should be implemented as a small adapter in packages/providers
    // or by the user via the skills catalog.
    return {
      output: `[skill:${skill.kind}] ${skill.name || skill.slug} ran with input: ${state.prompt.slice(0, 200)}`,
      events: [
        started,
        event(
          { orgId: state.orgId, runId: state.runId },
          "skill_completed",
          `${skill.name || skill.slug} completed.`,
          {
            node: node.title,
            skill: skill.name || skill.slug,
            payload: { nodeId: node.id, roleId: role.id, roleName: role.name, skillId: skill.id, skillName: skill.name || skill.slug }
          }
        )
      ]
    };
  })
  .addNode("advance", async (state) => {
    if (state.humanInputRequest) {
      // The graph pauses here. LangGraph `interrupt` halts execution and
      // returns the request to the caller; the caller resumes by calling
      // `command({ resume: answers })` later.
      const answers = interrupt(state.humanInputRequest);
      const updated = {
        ...state.humanInputs,
        [state.humanInputRequest.id]: answers
      };
      return {
        humanInputs: updated,
        humanInputRequest: null,
        status: "running",
        cursor: state.cursor + 1
      };
    }
    return {
      cursor: state.cursor + 1,
      events: state.node
        ? [
            event(
              { orgId: state.orgId, runId: state.runId },
              "node_completed",
              `${state.node.title} completed.`,
              {
                node: state.node.title,
                skill: state.skill?.name || state.skill?.slug,
                payload: {
                  nodeId: state.node.id,
                  roleId: state.role?.id,
                  roleName: state.role?.name,
                  skillId: state.skill?.id,
                  skillName: state.skill?.name || state.skill?.slug
                }
              }
            )
          ]
        : []
    };
  })
  .addEdge(START, "resolve")
  .addConditionalEdges("resolve", (state) => {
    if (state.cursor >= state.nodes.length) return END;
    return "execute";
  })
  .addEdge("execute", "advance")
  .addConditionalEdges("advance", (state) => {
    if (state.status === "completed") return END;
    if (state.status === "failed") return END;
    return "resolve";
  })
  .compile();

// ── Public executor ───────────────────────────────────────────
export type RunRequest = {
  orgId: string;
  runId: string;
  prompt: string;
  nodes: RunState["nodes"];
  skills: Skill[];
  roles: Record<string, Role>;
  provider: ModelProvider | null;
  model: Model | null;
  knowledgeFiles?: RunState["knowledgeFiles"];
  workstreamId: string | null;
  // For resumes (human-in-the-loop)
  resume?: Record<string, unknown>;
};

function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function event(
  state: { orgId: string; runId: string },
  type: RunEvent["type"],
  message: string,
  extras: Partial<RunEvent> = {}
): RunEvent {
  return {
    id: id("evt"),
    orgId: state.orgId,
    runId: state.runId,
    type,
    message,
    payload: {},
    createdAt: new Date().toISOString(),
    ...extras
  };
}

function buildInitialState(req: RunRequest): RunState {
  const first = req.nodes[0];
  const firstSkill = first ? req.skills.find((s) => s.id === first.skillIds[0]) ?? null : null;
  const firstRole = first ? req.roles[first.roleId] ?? null : null;
  const base: RunState = {
    orgId: req.orgId,
    runId: req.runId,
    prompt: req.prompt,
    status: "running",
    humanInputs: req.resume ? ({ [req.runId]: req.resume as Record<string, unknown> }) : {},
    artifacts: [],
    events: [],
    humanInputRequest: null,
    workstreamId: req.workstreamId,
    rolesById: req.roles,
    skills: req.skills,
    role: firstRole,
    skill: firstSkill,
    node: first ?? null,
    provider: req.provider,
    model: req.model,
    knowledgeFiles: req.knowledgeFiles ?? [],
    output: "",
    nodes: req.nodes,
    cursor: req.resume ? 1 : 0
  };
  return base;
}

export async function* streamRun(
  req: RunRequest,
  signal?: AbortSignal
): AsyncGenerator<RunYield, void, void> {
  const initial = buildInitialState(req);

  // Resume mode: when `req.resume` is present we call the graph with
  // a Command to inject the human answers and continue.
  const stream = await graph.stream(
    req.resume
      ? ({ resume: req.resume } as unknown as typeof initial)
      : initial,
    { streamMode: ["custom", "values"], signal }
  );

  let lastHumanRequest: HumanInputRequest | null = null;
  let lastText = "";
  const yieldedEvents = new Set<string>();
  const yieldedArtifacts = new Set<string>();

  for await (const graphChunk of stream) {
    const [mode, chunk] = graphChunk as ["custom" | "values", GraphCustomChunk | RunState];
    if (mode === "custom") {
      const custom = chunk as GraphCustomChunk;
      if (custom.kind === "text_delta") {
        lastText += custom.text;
        yield { kind: "text", text: custom.text };
      } else if (custom.kind === "status") {
        yield { kind: "status", status: custom.status };
      }
      continue;
    }
    const state = chunk as RunState;
    // Surface events that the reducer accumulated this tick
    for (const evt of state.events) {
      if (yieldedEvents.has(evt.id)) continue;
      yieldedEvents.add(evt.id);
      yield { kind: "event", event: evt };
    }
    for (const art of state.artifacts) {
      if (yieldedArtifacts.has(art.id)) continue;
      yieldedArtifacts.add(art.id);
      yield { kind: "artifact", artifact: art };
    }
    // Stream text output changes (LLM response, knowledge search results, etc.)
    if (state.output && state.output !== lastText) {
      const delta = state.output.slice(lastText.length);
      if (delta) yield { kind: "text", text: delta };
      lastText = state.output;
    }
    if (state.humanInputRequest && state.humanInputRequest !== lastHumanRequest) {
      lastHumanRequest = state.humanInputRequest;
      yield {
        kind: "event",
        event: event(
          { orgId: state.orgId, runId: state.runId },
          "human_input_requested",
          `Awaiting human input: ${state.humanInputRequest.header ?? "question"}`,
          { node: state.node?.title, skill: state.skill?.name || state.skill?.slug }
        )
      };
      yield { kind: "human_input", request: state.humanInputRequest };
    }
    yield { kind: "values", state };
  }

  yield {
    kind: "event",
    event: event({ orgId: req.orgId, runId: req.runId }, "run_completed", "Run completed.")
  };
}

// ── Convenience: a single-node run ────────────────────────────
export async function* streamSingleNodeRun(
  req: Omit<RunRequest, "nodes"> & { role: Role; skill: Skill; nodeId: string; nodeTitle: string }
): AsyncGenerator<RunYield, void, void> {
  yield* streamRun({
    ...req,
    nodes: [
      {
        id: req.nodeId,
        roleId: req.role.id,
        title: req.nodeTitle,
        skillIds: [req.skill.id]
      }
    ]
  });
}
