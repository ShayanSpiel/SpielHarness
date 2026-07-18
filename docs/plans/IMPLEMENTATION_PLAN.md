# SpielOS Upgraded Implementation Plan

> **Execution order:** Run this plan second, only after the Backend Optimization Plan passes verification. This remains the original repo-grounded SpielOS implementation plan. Phase 1 preserves the current UI; Phase 2 adds persistent long-horizon context for cheaper models. Sections 1.2, 1.6, 1.7, and 1.8 are verification gates for backend work completed by Plan 1: inspect first, do not replace a passing implementation, and apply only missing repo-specific details.

---

## Context and non-negotiables

The audit found two distinct bodies of work:

1. **Phase 1:** fix concrete chat, artifact, streaming, cancellation, database, and latency bugs while preserving the current UI and interaction model.
2. **Phase 2:** replace one-shot prose compaction with a long-horizon context system that can compact and continue inside one persistent chat.

The user has explicitly rejected:

- Renaming the **Output budget** meter or changing the sidebar layout.
- Adding a `CompactSearchSummary` primitive or “View in Events tab” button.
- Replacing the streaming animation, spinner, or loading text with skeletons.
- Adding a `MarkdownPart` split or streaming caret.
- Using a `human_input` wizard as the normal context-overflow recovery.

Design-system rules remain authoritative:

- Model text is the assistant answer; runtime events are compact activity rows, not cards pretending to be prose.
- Runtime messages, reasoning, workflow steps, and progress must come from real provider or LangGraph events.
- Loading has one owner: the durable runtime lifecycle.
- Use shared primitives, semantic tokens, and the `Icon` registry.
- Check design skill for UI implementations
- Streaming deltas must not repeatedly trigger `aria-live` announcements.
  > **Implementation note:** “No UI changes” means no layout or visual redesign. Minimal semantic additions using existing primitives are allowed only where Phase 2 must expose compaction or recovery state.

---

## Phase 1 — Streaming, artifacts, backend latency

> Scope: fix defects and remove avoidable latency. Preserve the visible chat, activity, loading, artifact, and sidebar experience.

### 1.1 Artifact leak — suppress tool evidence from Generated files

**Bug:** `packages/graph/src/index.ts:1486-1503` creates a `fileType: "artifact"` row for every terminal node with non-empty output. Search or knowledge tools return structured JSON, which is incorrectly persisted and rendered as a generated file.

**Primary fix:** introduce an explicit output disposition instead of inferring persistence from text shape:

```ts
type NodeOutputDisposition =
  | { kind: "assistant_text" }
  | { kind: "tool_evidence"; persist: false }
  | { kind: "artifact"; artifactType: string }
  | { kind: "harness_file"; fileType: HarnessFileType }
  | { kind: "eval_report" };
```

- Tool executors declare their disposition.
- Terminal artifact persistence runs only for `kind: "artifact"`.
- Search and knowledge outputs use `kind: "tool_evidence"` and remain visible in Events.
- `harness_file`, `eval_report`, and `memory_write` retain their current dedicated persistence paths.

**Compatibility guard during migration:** retain the current checks for empty output, `## Runtime Tool Evidence`, tool-call events, and known structured search JSON until every executor declares a disposition. Remove the heuristic after coverage is complete.

Also remove the `## Runtime Tool Evidence` ledger block at `packages/graph/src/index.ts:842-846`. Tool evidence belongs in events, not assistant output.

**Result:** searches create no artifact rows; real files still appear in Generated files; no UI changes.

### 1.2 Backend — skip harness listing for plain chat *(verify Plan 1; implement only missing details)*

In `apps/web/lib/execution-service.ts:103-169`:

- When `isChat && contextFileIds.length === 0 && !targetId`, skip `listHarnessFiles`.
- Read only workspace instructions through `listWorkspaceInstructions(sql, orgId)` using one indexed query.
- Cache `listModelsWithEnvironmentDefaults` results in a module-local 60-second TTL map.
- Treat that cache as an optional per-instance optimization, not globally coherent state; database reads remain the source of truth.
- Replace the hard-coded director prompt with `getOrchestratorPrompt(sql, orgId)` reading the active system-role prompt.

Seed `supabase/seed/system/orchestrator.md`:

> You are the SpielOS assistant. Converse naturally and answer the user directly. You can explain the workspace. Do not require a selected role, skill, file, eval, or workflow for ordinary conversation. Never claim that you searched, executed a tool, ran a workflow, or read a file unless the runtime supplied that context or execution.

**Target:** no more than four database queries before the provider for plain chat.

### 1.3 Streaming plumbing — coalesce without changing the visual

In `apps/web/lib/chat-adapter.ts`:

- Replace per-frame `yield yieldCurrent()` with a `requestAnimationFrame` flush.
- Queue side effects and apply them inside the rAF callback.
- Move `inFlightMessages` to a module-level `WeakMap<ChatModelAdapter, Set<string>>`.
- Remove the final `void store.reload()` that causes the post-send flash.
- Flush queued work on stream completion and cleanup so the final delta cannot be stranded.

In `packages/providers/src/context.ts` and `packages/graph/src/index.ts`:

- Keep the first-turn short-circuit.
- Remove the redundant prefix-cost walk when no compaction occurred.
- Assemble the immutable base conversation context once before ReAct iteration zero.
- On later ReAct iterations, reuse that base and append only iteration-local assistant, tool-call, and observation messages.
- Do not rerun retrieval or full context assembly on every iteration.
- Use provider streaming usage as authoritative when available; fall back to local estimates only when required.
- Stream ReAct `text_delta` frames during generation rather than flushing all terminal text at the end.
- Never append runtime tool evidence to assistant text.

### 1.4 Run context — remove O(n²) work and double mirroring

In `apps/web/lib/run-context.tsx:137-173`:

- Append events directly and deduplicate by event ID.
- Move `orderRunEvents` and `compactRunEvents` into `useMemo` at render consumers.
- Derive `activeActor` and `activeActors` from events with `useMemo` instead of mirroring them in state.
- Stop setting general activity text on every start event when the timeline already owns that presentation.

### 1.5 Chat restoration — abort and debounce

In `chat-thread.tsx` and `app/runs/[id]/page.tsx`:

- Create one `AbortController` per restoration effect.
- Abort on cleanup and pass its signal to fetch.
- Add a 200 ms debounce to home-page run restoration.
- Ignore abort errors and prevent stale responses from replacing newer state.

### 1.6 Event identity and batched checkpoint writes *(verify Plan 1; implement only missing details)*

Do **not** create one PostgreSQL sequence per run.

Add `runs.next_event_sequence bigint not null default 0`. Allocate a sequence range atomically:

```sql
UPDATE runs
SET next_event_sequence = next_event_sequence + $event_count
WHERE id = $run_id
RETURNING next_event_sequence;
```

Assign the returned range to the event batch and remove `max(sequence) + 1` logic.

In `apps/web/app/api/runs/execute/route.ts`:

- Buffer checkpoint state inside the active execution request, not a process-global timer relied upon for durability.
- Flush at most every 250 ms, on important transitions, and unconditionally in `finally`.
- Add a monotonic checkpoint version and reject stale writes.
- Keep SSE state immediate; only database persistence is coalesced.
- Replace fake `_timings` instrumentation with a real request span counting query count and total database time.
- Remove duplicate `updateRun` calls and duplicate final `run_state` frames.

### 1.7 Cancel and pause — abort the actual runtime *(verify Plan 1; implement only missing details)*

Add top-level `runs.cancel_requested_at` and `runs.pause_requested_at` columns in both the migration and `supabase/manual_harness_merge.sql`.

Use three layers:

1. A local `AbortController` reaches provider streams and tool executors immediately on the executing instance.
2. Durable database flags remain the cross-instance source of truth and recovery fallback.
3. Supabase Realtime, Postgres notification, or the existing runtime channel signals the executing instance when another tab or instance requests cancellation.

At each ReAct boundary, check the indexed durable flags as a fallback. Cancellation throws a typed abort; pause lands in `waiting_human` through the existing runtime contract.

The old one-second poll may remain temporarily for cross-tab observability, but it is not the primary cancellation mechanism and should be removed once realtime signaling is verified.

### 1.8 Connection mode — explicit configuration and capability probe *(verify Plan 1; implement only missing details)*

Do not use `pg_is_in_recovery()` to infer pooling mode.

Add:

```env
DATABASE_CONNECTION_MODE=session
```

- Accepted values: `direct`, `session`, `transaction`.
- Set `prepare` behavior from explicit configuration.
- At boot, probe the actual capability required by the chosen mode, such as prepared-statement reuse or session-bound behavior.
- Warn or fail clearly when declared mode and observed behavior disagree.
- Document direct or Supavisor session mode for the long-lived application and transaction mode for serverless-only paths.
- Add `AUTH_POOL_MAX`, default `2`, for BetterAuth.

### 1.9 Code health

- Register a real `mistral` provider adapter or throw a typed unsupported-provider error; do not silently coerce it.
- Move duplicate `compactTokens` formatting into the design-system formatter.
- Remove the empty `apps/web/app/api/runs/[id]/stream/` directory.
- Keep all visible UI behavior unchanged.

### 1.10 Phase 1 verification

```bash
npm run typecheck
npm run lint
npm run check:ui
npm run build
npm test
```

Manual and integration checks:

- Cold plain chat reaches first visible byte within the target budget.
- Search creates zero generic artifact rows but retains full tool evidence in Events.
- `harness_file.create`, `memory_write`, and `eval_report` still persist their intended outputs.
- Multi-call cancellation aborts an active provider stream or tool, not only the next loop iteration.
- Concurrent event batches receive unique ordered sequence numbers.
- Forced request cleanup flushes the final checkpoint.
- `preProviderMs < 500` and `dbQueryCount <= 4` for the optimized plain-chat path.

---

## Phase 2 — Long-horizon context for cheaper models

> Scope: keep one persistent chat, automatically compact and continue, preserve exact history, and prevent weaker models from rewriting canonical state.

### 2.1 Context layers

```text
STATIC PREFIX          system rules, tools, workspace invariants
PINNED WORKING STATE   active goal, constraints, decisions, open work
MILESTONE HISTORY      compact summaries of completed phases
RETRIEVED EVIDENCE     relevant files, memories, old messages, tool results
RECENT RAW WINDOW      recent turns verbatim
CURRENT USER MESSAGE   never compacted away
```

Under every layer sits an **immutable event log** containing all messages, tool results, file references, state operations, and compaction versions. The rendered prompt is disposable; the event log is the historical source of truth.

### 2.2 Pinned working state

Use typed, attributable items instead of arrays of anonymous strings:

```ts
const stateItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  authority: z.enum(["user", "workflow", "system", "model"]),
  status: z.enum(["active", "completed", "rejected", "superseded"]),
  sourceMessageId: z.string().nullable(),
  supersedes: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string()
});

const chatPinnedStateSchema = z.object({
  version: z.number().int().nonnegative(),
  primaryGoal: stateItemSchema.nullable(),
  currentPhase: z.string().nullable(),
  decisions: z.array(stateItemSchema).default([]),
  constraints: z.array(stateItemSchema).default([]),
  openWork: z.array(stateItemSchema).default([]),
  successCriteria: z.array(stateItemSchema).default([]),
  importantReferences: z.array(z.object({
    id: z.string(),
    title: z.string(),
    source: z.enum(["chat", "file", "memory", "tool_result"]),
    ref: z.string()
  })).default([]),
  updatedAt: z.string()
});
```

- Store it in `chat.metadata.pinnedState` initially.
- Render only active, relevant items, normally under 800–1,200 tokens.
- Move completed work and obsolete detail into milestone history.
- Compute token estimates at render time; do not persist stale estimates.

### 2.3 Milestone history remains separate

Compacted history must not be absorbed into pinned state.

```ts
type MilestoneSummary = {
  id: string;
  title: string;
  summary: string;
  decisionsMade: string[];
  workCompleted: string[];
  unresolvedItems: string[];
  sourceMessageIds: string[];
  createdAt: string;
};
```

Store summaries append-only in chat metadata for MVP or a dedicated table when querying and volume justify it. Retrieve only milestones relevant to the current request.

### 2.4 Models propose state operations; code applies them

The model must never replace the full canonical state. It returns bounded operations:

```ts
type StateOperation =
  | { op: "set_goal"; text: string; sourceMessageId: string }
  | { op: "add_decision"; text: string; sourceMessageId: string }
  | { op: "supersede_decision"; targetId: string; text: string; sourceMessageId: string }
  | { op: "add_constraint"; text: string; sourceMessageId: string }
  | { op: "add_open_work"; text: string; sourceMessageId: string }
  | { op: "complete_work"; targetId: string; sourceMessageId: string };
```

A deterministic reducer:

- validates source-message ownership and authority;
- prevents model-authored text from superseding user-authored decisions;
- deduplicates equivalent items;
- applies operations only against the expected state version;
- appends every accepted or rejected operation to the immutable event log.

### 2.5 State-update and compaction triggers

Do not update canonical state blindly every five turns.

Run a cheap state-change detector after messages likely to contain:

- a new or changed goal;
- an accepted or rejected approach;
- a user correction;
- completed work;
- a new unresolved task;
- a workflow milestone.

Only when `hasStateChange` is true, run structured operation extraction. Add a low-frequency safety consolidation every ten meaningful turns or at explicit phase boundaries.

State extraction must not block the main response unless the current turn requires compaction to fit. Use optimistic concurrency: operations target a state version and rebase or rerun if that version changed.

### 2.6 Compactor output

The compactor receives the previous state, messages being removed, and source IDs. It returns:

```ts
type CompactionResult = {
  stateOperations: StateOperation[];
  milestoneSummary: MilestoneSummary;
};
```

Rules:

- Preserve user- and workflow-authoritative state unless a newer user message explicitly supersedes it.
- Keep chronology and source IDs.
- Move finished detail into the milestone summary rather than bloating pinned state.
- Produce no unsupported decisions or completion claims.
- Validate JSON and operation authority before persistence.

Use a medium reliable model for compaction when available. The cheapest model may classify and extract candidates, but it should not own unrestricted consolidation.

### 2.7 Context budgeting and multi-pass compaction

Use hysteresis:

- Trigger compaction around 75–80% of the usable input window.
- Compact toward 50–60%, not merely one token below the limit.
- Reserve 10–15% for the current turn, tools, and estimation error.

Large attached files normally enter as metadata, short ingestion summaries, and retrieved chunks. Full bodies are included only when explicitly needed and budget allows.

Pass ladder:


| Pass | Action                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | Assemble normally; no compaction when under threshold.                                                                                                 |
| 1    | Keep roughly 45% recent raw context; summarize removed messages into one milestone plus state operations.                                              |
| 2    | Keep roughly 25% recent raw context; retrieve fewer old milestones and evidence chunks.                                                                |
| 3    | Keep roughly 10% recent raw context; retain active state and highest-authority evidence.                                                               |
| 4    | Compress older milestone summaries into a higher-level phase summary; keep the latest two turns verbatim.                                              |
| 5    | Replace oversized file bodies with short references and retrieval pointers.                                                                            |
| 6    | Keep static prefix, minimal pinned state, current user message, and only indispensable evidence. Return recoverable overflow if that still cannot fit. |


After every pass: rebuild, remeasure, and continue until the target budget is reached or pass 6 is exhausted. Never `break` merely because one compactor call returned valid JSON.

The chat identity always persists. A run may return recoverable overflow when the current message or mandatory evidence alone exceeds the model window.

### 2.8 Events and minimal UI additions

Add runtime events:

- `compaction_started`
- `pinned_state_updated`
- `milestone_created`
- `context_overflow`
- `compaction_pass_escalated` for telemetry only

User-facing behavior:

- Existing activity row shows **Optimizing conversation context…** then **Working state updated**.
- Do not expose pass numbers in normal UI.
- A closed `<details>` block may show the current working state using existing tokens and primitives.
- The existing Compaction cell may display working-state information without changing layout.
- Recoverable overflow uses the existing `<Notice>` and context picker; it does not end or replace the chat.

### 2.9 Migration

- Keep old `chat.metadata.compaction` blobs readable.
- Lazily import old prose as a legacy milestone summary, not `currentPhase` or canonical truth.
- On the next eligible milestone, extract attributable operations from raw source messages when available.
- Deprecate the old blob only after successful migration; do not delete it during rollout.

### 2.10 Model routing

- **Cheap model:** normal chat, state-change classification, candidate extraction, simple summaries.
- **Medium reliable model:** compaction, milestone creation, contradiction detection, operation generation.
- **Strong model:** major architecture decisions, conflict recovery, periodic long-horizon audits.

Fallback safely when only a cheap model is configured: keep operations narrower, preserve more raw evidence, and reject uncertain mutations rather than inventing state.

### 2.11 Verification and long-horizon evals

Run the normal quality suite plus deterministic transcript tests covering:

- goal and constraint retention;
- user correction superseding an older decision;
- rejected approaches remaining rejected;
- completed work leaving active pinned state;
- exact recovery from raw history;
- malformed compactor output leaving state unchanged;
- concurrent state updates not overwriting one another;
- cheap models being unable to alter user-authoritative decisions;
- context reaching the target range after compaction;
- attached files not dominating unrelated future turns;
- 200-turn continuity with multiple goals and phase changes.

Track by model:

- state precision and recall;
- decision-corruption rate;
- retrieval accuracy;
- tokens and cost per turn;
- compaction frequency and latency;
- first-token latency;
- unnecessary state-update rate.

---

## Locked decisions

- Phase 1 fixes defects and performance without redesigning the UI.
- Foreground compaction is used when required to fit the current request; nonessential state extraction may complete asynchronously and apply to the next turn.
- Compact-and-continue remains the long-horizon behavior.
- The chat never needs a replacement chat or handoff summary merely because older context was compacted.
- Canonical state, milestone history, recent raw context, retrieved evidence, and immutable history remain separate.
- Models propose state changes; deterministic application code validates and applies them.
- Existing design-system primitives remain the only UI building blocks.

## Implementation order

1. Complete and verify Phase 1 before introducing new context behavior.
2. Add immutable state-operation events and typed pinned state.
3. Add milestone summaries and migration support.
4. Implement state-change detection and deterministic reduction.
5. Replace one-shot compaction with the measured pass ladder.
6. Add minimal activity and overflow presentation.
7. Run long-horizon evals against the cheapest supported model before enabling by default.

## Key file pointers

- `apps/web/lib/chat-adapter.ts` — rAF coalescing and stream cleanup.
- `apps/web/lib/execution-service.ts` — plain-chat fast path and orchestrator prompt.
- `apps/web/lib/run-context.tsx` — event append and derived actors.
- `apps/web/app/api/runs/execute/route.ts` — checkpoint batching and instrumentation.
- `apps/web/components/chat/chat-thread.tsx` — existing activity row and minimal context notices.
- `apps/web/components/chat/run-drawer.tsx` — existing runtime-capacity surface.
- `packages/graph/src/index.ts` — ReAct base context, deltas, cancellation, and output disposition.
- `packages/providers/src/context.ts` — context assembly, budgeting, retrieval, and compaction ladder.
- `packages/core/src/index.ts` — state, operation, milestone, and event schemas.
- `packages/db/src/index.ts` — event sequence allocation and workspace-instruction query.
