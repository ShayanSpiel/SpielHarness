# LangGraph runtime

`packages/graph` builds a LangGraph `StateGraph` from a file-backed workflow. Roots are derived from incoming edges, fan-out edges run independently, and nodes with multiple incoming edges are joined. Single role, skill, and eval targets are represented as one-node graphs.

The runtime emits typed `RunYield` frames:

- `event`: run, node, skill, tool, human-input, eval, and terminal lifecycle events.
- `text`: user-visible model or terminal output deltas.
- `artifact`: structured generated output such as an eval report.
- `human_input`: a request that pauses execution.
- `checkpoint`: serializable graph state for durable resume.
- `status`: optional transient compatibility activity.
- `done`: authoritative terminal or waiting status.

## State and event semantics

The graph state uses `running`, `waiting_human`, `completed`, `failed`, and `cancelled`. Parallel state merges prioritize failure/cancellation and human waits over ordinary running updates. When a human reply is supplied, the restored checkpoint re-enters as `running`.

Node executors publish `node_started`, `skill_started`, and tool/eval events through LangGraph's custom stream at the moment the operation occurs. The same event ids are retained in graph state; the stream de-duplicates the later state snapshot. This provides live UI activity without losing checkpoint history.

The runtime, not the model, owns progress narration. Role prompts return task output and must not synthesize lifecycle lines such as “running workflow” or “tool completed.”

Human question schemas are resolved from the workflow node first and the skill second. File-backed `humanQuestions` are the canonical contract and should be authored for production workflows. For legacy files, the graph boundary converts prompt-authored `Suggest: (A)…` choices and `Also ask…` follow-ups into the same typed single-choice, multi-choice, and wizard contract before emitting a `human_input` frame. Clients render that contract and never parse prompt prose. On resume, the checkpoint's already-answered request id is treated as yielded so it cannot reopen the UI. A genuinely new downstream human-input node emits a new request id and transitions back to `waiting_human`.

Human-input resume is database-backed: the API persists the latest checkpoint in `runs.state`; `/api/runs/[id]/reply` reloads it, supplies the answer, and re-enters the graph. Completed nodes are skipped except for an explicit eval retry source. This does not depend on process memory.

Node skills execute sequentially. Workflow roots come from saved edges, fan-out branches execute independently, joins wait for their declared inputs, and terminal eval gates can route back to their retry source until `maxAttempts`. `llm_call`, `knowledge_search`, `eval`, `human_input`, and safe read-only generic HTTP operations are executable. External-state HTTP operations require a confirmed provider adapter. MCP execution is intentionally rejected until a real server adapter is configured; it is never simulated as success.

Seeded roles may declare stable `contextSlugs`. Execution resolves those slugs to current file ids and combines them with user-selected context for each applicable node. Prompt components and harness templates are rendered as file-backed instructions; strategy, knowledge, and user source files are rendered as context. The graph never loads Google Drive files unless the user explicitly imports or selects them through the Files tab.

Known runtime boundary: execution still lives inside a Next.js request. Production needs a durable worker and event transport so a deploy, timeout, or disconnected client cannot own run liveness.
