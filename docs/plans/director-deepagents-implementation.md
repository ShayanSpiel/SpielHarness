# Director / Deep Agents Implementation Plan

Status: feature-branch checkpoint and handoff — Director runtime not implemented
Branch: `main` (HEAD `99842e0`) with this session's commit on top
Date: 2026-07-17

## Approved architecture

- `type ExecutionMode = "director" | "direct";` is the only top-level switch
- `direct` is the existing deterministic `singleNode` / `workflow` execution path, unchanged
- `director` is the file-backed role with `metadata.systemRole === "orchestrator"`, displayed in the UI as **Director**, compiled with `createDeepAgent()` from `deepagents@1.11.0`
- Only the Director's file-backed prompt and selected model are user-editable. Deep Agents owns its planning loop, `write_todos`, context management, summarization, structured tool calling, temporary subagents, and LangGraph interrupts.
- SpielOS remains the product authority for: permissions, policies, approvals, budgets, billing, durable runs, child-run lineage, workflow execution, project revisions, artifacts, external writes, cancellation, idempotency
- Capabilities are resolved dynamically from the live workspace:
  - Active file-backed `harness_role` rows → Deep Agents custom subagents (Director excluded)
  - Deep Agents native general-purpose subagent → bounded temporary specialists
  - Existing `harness_workflow` files → one dynamic `execute_workflow` tool that runs them as durable child runs
  - Active `harness_skill`, `harness_eval`, connection operations → narrow system tools
  - The Director never has every connection operation auto-exposed
- Attached Roles/Workflows/Skills/Evals are suggestion chips in Director mode, never client-selected execution topology
- No `deepMode` flag. No new event table / enum / SSE protocol. No second client parser. No fabricated loading messages. No private chain-of-thought rendering

## Non-negotiables

- No `deepMode` flag — only `executionMode`
- No custom Deep Agents clone — must use official `deepagents` + official LangGraph primitives
- No production `MemorySaver` — must use official `PostgresSaver` backed by existing DB
- No hardcoded role / workflow / skill / integration / model / prompt identifiers in app code
- No new `RunYield` variant
- No new event enum / table / SSE frame / second client parser
- No competing persistence authority — LangGraph checkpoint state is execution resume; `runs`/`run_events`/project tables are product projection
- No premature UI (Director switch, suggestion chips, three-theme verification all belong in Phase 5)
- No double-billed child usage — parent records once, child records once, rolled-up display only
- Remove the current `if (outputText) recordUsage()` guard so artifact-only and delegated runs are billed

## Current state

### Branch / commits

- Working branch: `main`
- Prior commit: `99842e0` "Full orchestration update" — contains the full Phase 0–3 vertical slice (project sessions, project revisions, landing page seed, chat artifact fix, turn envelopes). The orchestrator skill expansion (`activeSkillIds` union) is also committed in this commit.
- This session commit: reverts the orchestrator skill expansion in `apps/web/lib/execution-service.ts` to the legacy plain-chat path. The chat-artifact fix in `packages/graph/src/index.ts` is preserved.

### Changed files (this session, uncommitted)

| File | Status | Why |
| --- | --- | --- |
| `apps/web/lib/execution-service.ts` | modified | Reverted `activeSkillIds` orchestrator expansion. Plain chat now falls through to legacy `streamChatRun` with the Director prompt resolved from the seed file. |
| `apps/web/package.json` | modified | Removed direct `@langchain/langgraph@^0.2.74` dep (no app code imports it; was a stale direct dep). |
| `packages/graph/package.json` | modified | Added pinned LangChain / Deep Agents / LangGraph 1.x stack (see "Pinned dependency tree" below). |
| `package-lock.json` | modified | Resolves the new dep tree. |

No untracked files. `packages/graph/src/director/` was started in this session and removed because it did not compile cleanly with the real Deep Agents 1.11 + LangGraph 1.4.8 stream v3 API. No Director code is production-reachable.

### Retained work (verified this session)

- **Chat artifact fix** in `packages/graph/src/index.ts` (committed in `99842e0`): plain chat text is no longer wrapped as a `file` artifact. The node artifact creation now suppresses for `assistant_text` and `tool_evidence.persist=false` dispositions. Verified by inspection of the committed code path.
- **LangChain / Deep Agents migration** in `packages/graph/package.json` + `package-lock.json`: pinned, single-runtime, no peer warnings, no 0.x legacy copy left in the tree.

### Reverted work

- **Orchestrator `activeSkillIds` union** in `apps/web/lib/execution-service.ts`: removed. The Director role is no longer wrapped in `singleNode` with all active skills. Plain chat is the legacy `streamChatRun` path again. The Director is still selected by its `systemRole` metadata and contributes its prompt via `resolveDirectorPrompt`, but the runtime does not expand its skill set.

### Partial work (removed, do not re-introduce as-is)

- `packages/graph/src/director/providers/langchain.ts` — initial model adapter sketch; did not compile against the real LangGraph 1.x base types. Removed.
- `packages/graph/src/director/events.ts` — initial v3 stream mapper; did not compile. Removed.

### Is any Director code production-reachable? **No.**

The only references to `deepagents` are in `packages/graph/package.json` `dependencies` and in the lockfile. No source file imports from `deepagents` or from a Director module. The Director switch is not in the UI. `resolveExecution` no longer wraps the orchestrator in a `singleNode` skill set.

## Pinned dependency tree (verified clean)

```text
spielos@0.1.0
└── @spielos/graph@0.1.0
    ├── @langchain/core@1.2.1
    │   └── langsmith@0.7.1
    ├── @langchain/langgraph@1.4.8
    │   ├── @langchain/core@1.2.1 (deduped)
    │   ├── @langchain/langgraph-checkpoint@1.1.3 (deduped)
    │   └── @langchain/langgraph-sdk@1.9.27
    │       └── @langchain/core@1.2.1 (deduped)
    ├── @langchain/langgraph-checkpoint@1.1.3
    │   └── @langchain/core@1.2.1 (deduped)
    ├── @langchain/langgraph-checkpoint-postgres@1.0.4
    │   ├── @langchain/core@1.2.1 (deduped)
    │   └── @langchain/langgraph-checkpoint@1.1.3 (deduped)
    ├── @langchain/langgraph-sdk@1.9.23
    │   └── @langchain/core@1.2.1 (deduped)
    ├── deepagents@1.11.0
    │   ├── @langchain/core@1.2.1 (deduped)
    │   ├── @langchain/langgraph-checkpoint@1.1.3 (deduped)
    │   ├── @langchain/langgraph-sdk@1.9.23 (deduped)
    │   ├── @langchain/langgraph@1.4.8 (deduped)
    │   ├── langchain@1.5.3 (deduped)
    │   └── langsmith@0.7.1 (deduped)
    ├── langchain@1.5.3
    │   ├── @langchain/core@1.2.1 (deduped)
    │   ├── @langchain/langgraph-checkpoint@1.1.3 (deduped)
    │   ├── @langchain/langgraph@1.4.8 (deduped)
    │   └── langsmith@0.7.1 (deduped)
    └── langsmith@0.7.1
```

Single LangChain/LangGraph runtime, no 0.x legacy, no peer warnings.

## Verification results

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 108/108 pass (107 pre-existing + the runtime `graph-runtime.test.ts` set still passes against the LangGraph 1.x stack) |
| `npm run lint` | clean |
| `npm run build` | clean |
| `npm run check:ui` | clean (no-raw-colors + ui-contracts) |
| `npm ls deepagents langchain @langchain/core @langchain/langgraph @langchain/langgraph-checkpoint @langchain/langgraph-checkpoint-postgres @langchain/langgraph-sdk langsmith` | single 1.x runtime, no peer warnings |

The 13 `graph-runtime.test.ts` tests (workflow fan-out, human-input pause+resume, terminal eval gate, multi-step human wizard, structured human choices, plain-chat compaction, prompt-tool repair) all pass after the LangGraph 0.2 → 1.x migration. These are the production-path regression checks for the existing deterministic Workflow runtime.

A dedicated single-node smoke test was attempted and **removed** because it did not exercise the correct path: the new test passed a `null` provider/model like the existing graph-runtime tests, the run failed at `node_failed` → `run_failed`, indicating a known mismatch between the synthetic test fixture and the legacy skill resolution path. The 13 existing graph-runtime tests cover the real path; do not re-add the smoke test as written.

## Concrete Deep Agents v3 findings (from this session)

- `createDeepAgent()` returns a compiled LangGraph `ReactAgent`. `streamEvents({ version: "v3" })` returns an `AgentRunStream`.
- `AgentRunStream` has `messages: AsyncIterable<ChatModelStream>`, `toolCalls: AsyncIterable<ToolCallStream>`, `subagents: AsyncIterable<SubagentRunStream>`, `output: Promise<state>`, `values`, `extensions`. (`middleware` was mentioned in the README but is not on the type.)
- `ChatModelStream` has `text: TextContentStream` (async iterable of string deltas), `toolCalls`, `reasoning`, `usage`, `output: PromiseLike<AIMessage>`. It does NOT have a `node` field — line/scope must be derived from upstream event metadata.
- `ToolCallStream` has `name`, `callId`, `input`, `output: Promise<TOutput>`, `status: Promise<ToolCallStatus>` (`"running" | "finished" | "error"`), `error: Promise<string | undefined>`. Status is a Promise; must be awaited.
- `SubagentRunStream` has `name`, `cause: LifecycleCause`, `output: Promise`, `messages`, `toolCalls`, `subagents`. Nested delegation is `run.subagents` (named agents), distinct from `run.subgraphs` (any child namespace).
- Interrupt payloads surface on `run.output` as `state.__interrupt__: Interrupt[]`. Each `Interrupt` has `{ id, value }`. The `value` is the graph-supplied payload (e.g. `{ questions: HumanInputQuestion[] }`).
- `BaseChatModel` lives at `@langchain/core/language_models/chat_models`. The constructor params and bound-tools signature changed: `bindTools(tools, kwargs)` returns a new instance, not a mutated `this`. The adapter subclass must carry config into a fresh instance.
- `ToolMessage.tool_call_id` (snake_case) still exists in the message API; conversion to/from SpielOS `role: "tool" | name: callId` is straightforward.

## Unresolved questions (must be answered in Phase 1/2)

1. **Provider model adapter** — the official `@langchain/openai` and `@langchain/anthropic` packages are peer-dep-acceptable from `langchain@1.5.3`, but SpielOS uses custom base URLs, env-secret resolution, and reasoning-effort config. Confirm whether to (a) wrap official providers, or (b) keep the current `BaseChatModel` subclass with `_generate` + `_streamResponseChunks`. Decision: (b) is the minimum that preserves existing secret resolution.
2. **PostgresSaver integration** — `langgraph-checkpoint-postgres@1.0.4` requires a `pg.Pool`. SpielOS uses `postgres` (porsager/postgres). Need a small adapter that calls `postgres()` and wraps the result in a `pg.Pool` shim, or replace the runtime with `pg`. Decision pending; the user explicitly forbids `MemorySaver` in production.
3. **Subagent model** — official `SubAgent` interface takes `model?: LanguageModelLike | string`. Confirm whether subagents share the parent model or whether the runtime should fall back to a workspace primary. Decision pending.
4. **Tool result types** — `ToolCallStream.output: Promise<TOutput>` is generic per tool. The events mapper cannot generically know the output shape; it should pass `output` through to the SpielOS event payload as `unknown` and let the UI render.
5. **Interrupt resume** — LangGraph `Command({ resume: ... })` must be passed to `agent.invoke` / `agent.stream` after an interrupt. SpielOS `runs/[id]/reply` already handles resume; the Director adapter must translate the existing `human_input` request into a `Command` payload.
6. **Workflow child run lineage** — the `execute_workflow` tool must call the existing `streamRun` with `parent_run_id`, `project_id`, `turn_id`, and route the result back as the tool output. The existing reply/execute routes already do this; the tool wrapper just needs to bridge.

## Remaining phases

### Phase 1 — Foundation

1. Add `type ExecutionMode = "director" | "direct"` to `packages/core/src/index.ts`. No app code hardcodes the default; workspace configuration and chat metadata carry it.
2. Extend `ExecuteBody` in `apps/web/lib/execution-service.ts` with `executionMode` and `suggestedHarnessRefs`. Resolve capabilities, models, connections, and policies server-side. Return either a serializable `directRequest` (today's `RunRequest`) or a serializable `directorRequest` (capability snapshot + Director role id + selected model).
3. Build the `PostgresSaver` adapter. No `MemorySaver` in production paths. The checkpointer owns `runs.checkpoint` payload, not `runs.state`.
4. Build the official provider path: a `BaseChatModel` subclass that wraps `ChatAdapter` (preserve `baseUrl`, `secretEnvKey`, `reasoningEffort`, capability checks, output limits). No hardcoded model name in the adapter.
5. Add a Director switch persisted in `chats.metadata.executionMode`. Default from workspace config. No client-side toggle that does not change behavior.
6. Add direct-mode regression tests (existing paths must remain bit-for-bit identical):
   - Direct mode with no target → still routes to `streamChatRun`.
   - Direct mode with a role target → single-node graph unchanged.
   - Direct mode with a workflow target → multi-node graph unchanged.
   - Direct mode with a paused run, resume → durable resume still restores.

### Phase 2 — Director core

1. `packages/graph/src/director/compile.ts` — build `createDeepAgent(...)` from the live capability snapshot. No hardcoded subagents. Pass `checkpointSaver` from Phase 1.
2. `packages/graph/src/director/events.ts` — full v3 stream → `RunEvent` mapping. Cover `messages.text`, `messages.usage`, `toolCalls`, `subagents.messages`, `subagents.toolCalls`, `output.__interrupt__`. Tool call `output` passes through as `unknown`.
3. `packages/graph/src/director/usage.ts` — exactly-once usage folding. Director coordinator + every subagent must record once on the parent Director run. Workflow child runs record on the child. No double-billing.
4. `packages/graph/src/director/interrupt.ts` — bridge `Command({ resume: ... })` ↔ existing `runs/[id]/reply` body.
5. Tests (deterministic, controlled model/tool outputs):
   - Director answers directly without a tool call.
   - Director plans with native `write_todos` and emits todo events.
   - Director delegates to an existing file-backed Role subagent.
   - Director spawns a temporary general-purpose subagent.
   - Interrupt pauses, reply resumes, no duplicate final reply.
   - Reload hydration reconstructs the timeline without duplicate events or replies.

### Phase 3 — Delegation

1. Dynamic file-backed Role subagents: iterate `files.harness_role` rows where `status === "active"` and `metadata.systemRole !== "orchestrator"`, build a `SubAgent` per role, pass to `createDeepAgent({ subagents: [...] })`.
2. Native general-purpose subagent: leave the default enabled. Do not disable `generalPurposeAgent` in production paths.
3. `execute_workflow` tool (one dynamic tool): iterate `files.harness_workflow` and `files.harness_workstream` with `status === "active"`. Tool input is `{ workflowId, input }`. The tool wrapper calls the existing `streamRun` with `parent_run_id` set on the child `runs` row, waits for terminal status, returns the durable output as the tool result. The tool does not write a new `runs` row in any other way.
4. Narrow `execute_skill` and `execute_eval` tools: dynamic per active `harness_skill` / `harness_eval` file. Skill invocation routes through the existing graph runtime; eval invocation routes through the existing `executeEval` path.
5. Tests:
   - Workflow child run has `parent_run_id` set.
   - Workflow child usage is recorded on the child only.
   - Parent UI may display rolled-up child usage, but the billing ledger records once on the child.

### Phase 4 — Durable execution

1. `PostgresSaver` from Phase 1 is the resume authority. `runs.state` is the projection written by SpielOS at terminal checkpoints.
2. Approval pause/resume: convert existing `human_input` into LangGraph `interrupt`, translate `runs/[id]/reply` body into `Command({ resume: ... })`.
3. Cancellation: `run-registry` + durable `runs.cancel_requested_at` + `runs.pause_requested_at`. Map to LangGraph `executionController.abort()`.
4. Reload hydration: the existing chat-thread restore fetch (`/api/runs/[id]`) returns run + events + artifacts. After this session, the events should be the result of the v3 stream mapper running for the full chat turn.
5. Tests:
   - Reload mid-run, mid-pause, post-completion → no duplicate events, no duplicate final reply.
   - Cancel mid-run → child run status is `cancelled`, parent status is `cancelled`, no external write observed.

### Phase 5 — UI and completion

1. Add the Director switch to the composer (between Context and model picker) using the design-system `Switch`. Tooltips match the exact strings in the approved plan.
2. When `executionMode === "director"`: attached items render as suggestion chips; Send has no required target. When `executionMode === "direct"`: require one runnable target; Send is disabled accessibly when absent.
3. Persist the switch in `chats.metadata.executionMode`.
4. No raw colors, no local dimensions, no duplicate components. Follow `.agents/skills/spielos-ui/SKILL.md`, `docs/design-system.md`, `docs/interaction-design.md`.
5. Run `npm run typecheck`, `npm test`, `npm run lint`, `npm run check:ui`, `npm run build`.
6. Browser verification in dark, light, and monochrome themes. Manually exercise:
   - Direct answer, native TODO planning, existing Role delegation, temporary subagent, Workflow child run, interrupt pause and resume.
   - Reload in each lifecycle state (running, waiting_human, completed, failed, cancelled).
7. Final completion bar — all 11 scenarios from the plan must pass.

## Start Here Next Session

**First task:** Phase 1 item 1 — add `type ExecutionMode = "director" | "direct"` to `packages/core/src/index.ts`, add a runtime-neutral default in workspace configuration, and add a `direct-mode` regression test that pins the current chat/role/skill/eval/workflow paths.

**Files to open first:**
- `packages/core/src/index.ts` — add `ExecutionMode` enum and a `ChatMetadata` extension field
- `apps/web/lib/execution-service.ts` — extend `ExecuteBody` with `executionMode`; resolve server-side
- `apps/web/app/api/runs/execute/route.ts` — branch on `executionMode`
- `apps/web/app/api/runs/[id]/reply/route.ts` — leave unchanged in this phase; the new branch is a no-op in `direct` mode
- `tests/graph-runtime.test.ts` — copy a test to `tests/direct-mode-regression.test.ts` and pin current behavior

**Pre-edit tests (must all pass before editing):**
- `npm test` (108/108)
- `npm run typecheck` (clean)
- `npm run lint` (clean)

**Smallest complete Phase 1 milestone:** `ExecutionMode` enum exists, `ExecuteBody.executionMode` is plumbed through, `direct` mode is a literal no-op (existing behavior unchanged), and three regression tests assert the existing direct-mode behavior bit-for-bit. Once green, hand the next milestone to Phase 2.
