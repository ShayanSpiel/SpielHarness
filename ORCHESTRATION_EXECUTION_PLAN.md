# Persistent Orchestrator and Project Sessions — Execution Plan

Status: active implementation — Phases 0–1 complete; Phase 2 in progress; Phase 3 vertical-slice foundations in progress  
Date: 2026-07-17  
Owner: SpielOS product/runtime

## Decision

SpielOS chat becomes a persistent, project-aware orchestrator by default.

- A chat is a durable conversation and can own one active project session.
- The orchestrator is the entry point for every user turn. It may answer
  directly, use an available tool, delegate bounded work to roles/skills, or
  launch a selected workflow as a child run.
- A workflow is a reusable recipe, not the conversation itself. Selecting one
  asks the orchestrator to execute it for the active project; it does **not**
  replace the chat's memory or force all later messages through the recipe.
- A follow-up such as “edit the landing” continues the active project and
  revises its existing artifact. It does not collect the original wizard again
  or start the landing workflow from scratch.
- “Run again” and “Start new project” are explicit user actions. The latter
  creates a new chat/project by default. Scheduled work is a later trigger,
  not an overloaded repeat-chat behavior.

The project session is durable application state, while the behavior that the
orchestrator can use remains file-backed. The database owns identity,
concurrency, ordering, checkpoints, and revision lineage; files own editable
roles, prompts, skills, workflows, evaluators, templates, and generated
project source. This is not a database-first harness.

## What exists today

- The file-backed orchestrator prompt already exists at
  `supabase/seed/system/orchestrator-prompt.md` and is seeded with
  `systemRole: orchestrator`.
- Chats, messages, runs, durable checkpoints, artifacts, and event logs are
  already persisted. `runs.chat_id` and message metadata can identify the
  initiating turn.
- The current resolver intentionally treats plain chat as “no harness tools,
  role, skill, eval, workflow, or attached file.” That makes ordinary
  conversation work, but prevents default orchestration.
- The current UI has one global current-run activity/artifact area. It loses
  the visual relationship between the assistant turn and the run that it
  started, especially after reload.

Therefore this is an extension of the current runtime, not a rewrite of the
graph engine or a second chat system.

## Do we need sub-graphs or sub-agents?

Yes to **sub-graphs**; no to a permanently running swarm of autonomous agents.

Use sub-graphs as typed, checkpointable execution units:

```text
chat turn
  -> orchestrator decision graph
      -> direct-answer branch
      -> tool branch
      -> project-revision sub-graph
      -> selected-workflow sub-graph
      -> harness-authoring sub-graph
      -> approval / human-gate branch
  -> one turn result + durable project update
```

Each branch has typed input/output, a budget, permissions, artifacts, event
provenance, and a durable checkpoint. A selected workflow is simply a child
sub-graph with its own definition snapshot and run record.

“Sub-agents” should be a product term for file-backed role delegations, not
separate uncontrolled processes. The orchestrator can delegate a research,
design, builder, QA, or publishing step in parallel only when the plan says
their inputs and writes are independent. It must join and evaluate them before
it advances the project. This preserves the useful roles/workflows model
without inventing a hidden agent swarm.

Sub-graphs improve reuse, recoverability, observability, and safe fan-out.
They do not solve worker durability by themselves. The durable worker/lease
work in the frontier audit remains required for long-lived background runs.

## UX contract

### First request in a chat

1. The user asks for work, optionally attaching a workflow, role, skill, or
   files.
2. The orchestrator creates or resumes the chat's project session when the
   request produces a durable deliverable or needs multi-turn state.
3. It chooses one of four visible modes: direct answer, tool task, delegated
   project task, or selected workflow. The assistant turn shows the selected
   mode in compact natural language and exposes a compact activity card.
4. If a workflow needs information, its structured human gate renders a
   numbered wizard under that same assistant turn.

### Follow-up in the same chat

- “Edit/refine/add/change the landing” means `continue_project` and includes
  the current project brief, accepted decisions, artifact revision, eval
  results, connected resource references, and relevant message summary.
- “Use the landing workflow again” means an explicit new child workflow run
  against the same project only after the orchestrator explains what will be
  rerun and what source will be preserved.
- “Start over/new landing/new project” makes a new project session. The UI
  offers a new-chat default and a deliberately labelled “new project in this
  chat” exception.

### Reload, reconnect, and inspector

- Every user message that starts or continues work receives a durable
  `turnId`/message id before the run starts.
- Every run, event, human gate, artifact, evaluator result, and final
  assistant message carries that `turnId` and optional `projectId`.
- On reload, chat history queries these records and reconstructs the same run
  card beneath its owning assistant turn. It does not render a global current
  run transcript at the bottom of the chat.
- The Events inspector remains the complete event history and links back to
  the originating chat turn and project revision. The chat card is intentionally
  compact, status-authoritative, and never fabricates model progress.

## Durable data model

Add a migration and matching `supabase/manual_harness_merge.sql` section.
Do not overload unstructured `chats.metadata` as the source of truth.

### `project_sessions`

| Field | Purpose |
| --- | --- |
| `id`, `org_id`, `chat_id` | identity and tenancy |
| `title`, `status` | user-facing project identity and lifecycle |
| `active_revision_id`, `active_artifact_id` | current deliverable pointers |
| `workflow_id` | original workflow only when one was selected |
| `working_state` | validated brief, constraints, accepted decisions, open tasks, resource references |
| `summary`, `summary_version` | compaction-safe project summary |
| `version`, timestamps | optimistic concurrency and auditing |

Statuses are project-specific (`active`, `awaiting_input`, `review`,
`completed`, `archived`). They must not be confused with durable run statuses
(`running`, `waiting_human`, `completed`, `failed`, `cancelled`).

### `project_revisions`

Immutable revision lineage for each material project change:

- `project_id`, `parent_revision_id`, `run_id`, `turn_id`;
- input instruction and a normalized change set;
- artifact id(s), source-file content hash(es), evaluator result(s), and
  external receipts;
- author (`user`, `orchestrator`, or delegated role), sequence, timestamp.

The typed project artifact remains the canonical source tree. A revision only
points to it and records provenance; it does not duplicate all HTML/CSS/JS in
row JSON.

### Existing records to extend

- `chat_messages.metadata`: add a validated envelope containing `turnId`,
  `projectId`, `runId`, and `kind` (`user_request`, `assistant_reply`,
  `execution_anchor`, `human_gate`, `system_notice`).
- `runs`: add `parent_run_id`, `project_id`, `turn_id`, `execution_kind`
  (`orchestrator`, `workflow`, `tool`, `delegation`, `revision`), and a
  definition/catalog snapshot. Child runs retain their own event sequences.
- `run_events` and artifacts: include `turnId`, `projectId`,
  `projectRevisionId`, and `parentRunId` in validated payload/provenance.
- Add indexes for `(org_id, chat_id, created_at)`, `(project_id, sequence)`,
  and `(turn_id, sequence)` to make rehydration one bounded query.

## Runtime architecture

### 1. Capability registry and file-backed policy

At the start of an orchestrator run, resolve a capability snapshot from active
file-backed resources and executable adapter introspection:

- roles, skills, workflows, evaluators, templates, prompts, strategy, and
  context files;
- integration connection state and allowed operations;
- artifact/project types and current project references;
- policies for read, internal write, external write, confirmation, and budget.

The snapshot must contain stable ids, versions/hashes, schemas, side effect
classification, and availability reasons. The model never chooses arbitrary
code or raw database access. It selects only typed actions from this registry.

Move generic text in the current resolver into a small immutable platform
policy. Keep product intent, delegation rules, and workspace-specific behavior
in `supabase/seed/system/orchestrator-prompt.md` and related seeded files.

### 2. Typed orchestration plan

The first model step returns a schema-validated plan, not prose that is parsed
as control flow:

```ts
type OrchestrationPlan = {
  intent: "answer" | "tool" | "delegate" | "workflow" | "revise_project" | "author_harness";
  project: "none" | "create" | "continue" | "new";
  rationale: string;
  steps: Array<{
    id: string;
    kind: "answer" | "tool" | "role" | "workflow" | "eval" | "human_gate";
    targetId?: string;
    input: Record<string, unknown>;
    dependsOn: string[];
    writeScope: "none" | "internal" | "external";
    confirmation: "none" | "required";
  }>;
  expectedArtifacts: Array<{ kind: string; name: string }>;
};
```

Validation rejects nonexistent resources, unavailable integrations, invalid
schemas, cycles, an external write without confirmation, or a revision that
does not name an active project artifact. The user sees a short clarification
only when the plan genuinely lacks required information.

### 3. Execution sub-graphs

Implement these graph entry points in `packages/graph`; all share the existing
event/checkpoint contracts.

| Sub-graph | Responsibility |
| --- | --- |
| `orchestrate_turn` | Load session state, capability snapshot, plan and route work. |
| `direct_answer` | Answer with project/conversation context, no side effects. |
| `execute_tool` | Validate schema, permission, confirmation, idempotency, receipt. |
| `delegate_role` | Execute a bounded role+skill unit with explicit inputs/outputs. |
| `execute_workflow` | Run the selected file-backed workflow as a child run. |
| `revise_project` | Read the active typed artifact, make a new revision, build/eval it. |
| `author_harness` | Draft or update harness files through existing typed harness-file skills; require review before activation when behavior/policy changes. |
| `merge_and_evaluate` | Join delegations, run required evals, update project state. |
| `human_gate` | Persist structured request and resume the exact child graph. |

Only independent read-only or isolated-draft child steps may fan out. Any step
writing the active project revision runs under a project revision lock. External
operations use the existing/future invocation journal and remain confirmation
gated.

### 4. Project continuation

`revise_project` receives the current artifact tree and project state as
typed context. For a landing page it runs a focused sequence:

```text
change request -> planner -> landing editor/builder -> typed project revision
               -> landing evaluator -> review / next action
```

It reuses the established brief, style decisions, approved claims, form
configuration, and prior QA. It does not rerun discovery, initial wizard, or
publish steps unless the user explicitly asks.

### 5. Harness authoring from chat

When a requested capability has no existing workflow, the orchestrator can
answer directly with available tools. If the user asks to create repeatable
automation, it uses the `author_harness` sub-graph to draft roles, skills,
workflow, eval, and template files under the file-backed harness.

Activation is not automatic for a capability that can write externally. The
system must show the generated definition, adapter availability, required
connections/scopes, eval result, and requested confirmation. A workflow file
cannot claim an operation that the capability registry marks unavailable.

## Implementation sequence

### Phase 0 — contracts and migration (foundation)

Completed 2026-07-17:

- Added core schemas for project sessions, immutable revisions, turn envelopes,
  execution kinds, and schema-validated orchestration plans.
- Added migration `0018_project_sessions.sql` and the matching manual Supabase
  merge step for project lineage, run hierarchy, and turn indexes.
- Added organization-scoped DB helpers with optimistic project updates and an
  atomic revision append that locks the project before assigning its sequence.
- Verified with `npm run typecheck` and the full test suite (107 passing),
  including project contract coverage.

1. Define core Zod/TypeScript contracts for project sessions, revisions, turn
   envelopes, orchestration plans, capability snapshots, and child-run lineage.
2. Add `project_sessions` and `project_revisions`, plus the run/message lineage
   fields and indexes, to a new database migration and
   `supabase/manual_harness_merge.sql`.
3. Add DB accessors with org-scoped authorization, optimistic project version
   updates, revision append, and one projection query for a chat's turns/runs.
4. Add a file-backed project-session template and expand the seeded
   orchestrator prompt to use the new typed plan. No role/workflow/skill name
   belongs in app code.

Exit test: a database test creates a project, appends two revisions, rejects a
stale revision write, and proves cross-org reads/writes fail.

### Phase 1 — turn anchoring and reload correctness

Completed 2026-07-17:

- Every new run now receives a durable turn id. The API persists a user request
  and an assistant `execution_anchor` before execution, then attaches the run
  and final assistant reply to that same turn.
- Runs now retain `turn_id` and `execution_kind`; resume replies preserve the
  original turn envelope.
- Chat activity and artifacts no longer render as one global block at the
  bottom of the thread. Restored anchors fetch their own durable run/events/
  artifacts and render directly below their owning assistant turn.
- The shared timeline recognizes default-orchestrator node/skill/tool events
  while keeping ordinary direct chat quiet.
- The new schema migration was applied to the configured Supabase database.
  A real authenticated chat reload preserved the existing durable human-input
  wizard and event count without a render/runtime failure. A fresh anchored-run
  test is included in the Phase 3 live certification because the open chat's
  pending landing wizard was intentionally not disrupted.
- Hydration now normalizes both legacy empty anchors and newly persisted
  renderer-owned anchors. This prevents assistant-ui from dropping the turn
  that owns the execution card after a page refresh.

1. Create and persist the user-message/turn envelope before creating a run.
2. Persist an assistant execution-anchor message even when a run produces no
   narrative text (for example, a wizard or artifact-only output).
3. Save final assistant text, artifacts, human gates, and run status against
   the same turn. Never use a module-local set as correctness state.
4. Replace the global current-run placement in `chat-thread.tsx` with compact
   `RunActivityCard`/artifact cards rendered below their owning assistant turn.
5. On chat load, fetch the turn projection and hydrate cards, status, pending
   input, artifacts, and events from durable state. Keep Events inspector as
   the detailed view.

Exit test: start a workflow, reload while running, reload while waiting for a
human answer, reply, reload after completion, and verify exactly one anchored
card with no raw JSON or duplicated events.

### Phase 2 — default orchestrator path

In progress 2026-07-17:

- Added the file-backed `agents/orchestrator.md` seed and manifest entry.
  Its initial safe capability set is local knowledge/file reading plus
  draft-only harness authoring; it deliberately cannot make an external write.
- Plain chat now resolves active harness resources and, once that seed is
  synced, runs through the Orchestrator role as a single bounded graph node.
  Existing workspaces fall back to legacy direct chat until their seed sync,
  avoiding a breaking rollout.
- Added the composer project chip with explicit revision mode, workflow rerun,
  and new-project actions. Follow-up project messages route to the file-backed
  revision role with the current project artifact as context.

1. Change chat resolution from “plain chat has no capability context” to
   `orchestrate_turn` with the compact capability snapshot and active project
   session. Preserve a fast direct-answer path when no action is needed.
2. Implement plan schema validation and a deterministic policy gate before
   every execution step.
3. Add the user-facing composer project chip: current project name/status,
   active artifact, and explicit actions “Start new project” and “Run workflow
   again.” Do not add a confusing workflow-vs-chat mode toggle.
4. Selected harness context becomes a request to the orchestrator, not a
   bypass of it. The workflow executes as a recorded child run.

Exit test: direct answer, tool use, selected workflow, unavailable capability,
and ambiguous external write each produce the correct plan/action/notice.

### Phase 3 — project revisions and landing-page vertical slice

In progress 2026-07-17:

- Added the file-backed Landing Page Editor seed, workflow revision-role
  reference, project-session creation, immutable artifact-revision writes, and
  active-project metadata updates for both initial execution and resumed human
  workflow replies. A completed post-brief landing artifact can now become the
  durable project revision that the next chat turn addresses.
- Live certification remains open: it needs an authenticated landing run,
  completion of its structured brief, reload checks at each lifecycle state,
  then a real follow-up revision. It must also cover the forced-compaction
  portion of the frontier audit before Phase 3 can be marked complete.

1. Add `revise_project` for typed multi-file project artifacts and a generic
   project revision skill contract.
2. Seed a file-backed Landing Page Editor role and a revision workflow that
   uses the existing strategist/builder/evaluator assets without restarting
   briefing.
3. Require landing eval rules for declared files, allowed claims, form
   contract, analytics contract, accessibility, and project-source validity.
4. Add a clear “Revision N” and provenance/history view to the artifact
   workbench. Preserve Preview/Source/Files and the full-screen contract.
5. Make Drive/Notion/GitHub write stages opt-in, capability-checked, confirmed,
   idempotent, and receipt-backed. Do not enable live publishing in this phase
   unless the relevant adapter certification is complete.

Exit test: run the landing workflow once, approve its brief, say “change the
headline and use a Notion-backed form,” and verify a new artifact revision is
created using the original project state. It must not replay the initial wizard
or rebuild an unrelated project.

### Phase 4 — harness authoring and governance

1. Implement `author_harness` using typed file drafts/updates and server-side
   validation of every reference.
2. Add a review surface that diffs proposed prompt/role/skill/workflow/eval
   files and explains unavailable integrations or missing policy requirements.
3. Require eval and human approval before activating a newly authored workflow
   with external side effects.
4. Audit every change and make the generated harness reusable by any future
   project session.

Exit test: ask for a simple repeatable internal workflow, review and activate
its generated files, then run it from a fresh chat through the orchestrator.

### Phase 5 — long-horizon durable execution

1. Move request-owned execution to enqueue/worker lease/fence as defined in
   `docs/frontier-automation-audit-plan.md`.
2. Give parent/child runs durable scheduling, idempotency invocation journals,
   cancellation propagation, bounded parallelism, and replayable fan-out.
3. Run the required forced-compaction, model-switch, conflicting-instruction,
   human-pause, process-restart, and 200+ turn tests against one project
   session.

Exit test: a worker restart during a child workflow leaves one recoverable
project revision, no duplicate external write, and a complete reloaded turn
timeline.

## Files expected to change

The exact list will be adjusted after Phase 0 inspection, but implementation
is expected to touch:

- `packages/core` — contracts and schemas;
- `packages/db/src/index.ts`, `packages/db/migrations/*`, and
  `supabase/manual_harness_merge.sql` — persistence and projections;
- `packages/graph/src/index.ts` — parent/child orchestration graphs;
- `apps/web/lib/execution-service.ts` and run/chat API routes — resolver,
  policy, durable envelopes, replay;
- `apps/web/lib/chat-adapter.ts`, `run-context.tsx`, and chat components —
  turn-owned UI state and reload hydration;
- `apps/web/components/chat/artifact-workbench.tsx` — revision/provenance UI;
- `supabase/seed/system/orchestrator-prompt.md`, manifest, roles, workflows,
  skills, templates, and evaluators — editable behavior only.

Any UI changes follow the repository's `spielos-ui` skill and its existing
design/interaction contracts. Repeated UI primitives belong in the design
system rather than page-local markup.

## Acceptance matrix

| Scenario | Required outcome |
| --- | --- |
| Ordinary question | Orchestrator answers directly; no fake run/tool status. |
| Existing workflow attached | Orchestrator launches one visible child workflow run. |
| “Edit the landing” after completion | Uses active project/revision; no initial wizard replay. |
| User says “run again” | Explicit new run, clear retained/replaced inputs. |
| User says “start over” | New project/new-chat default, prior project intact. |
| No workflow exists | Direct available-tool work or reviewed harness draft; no invented capability. |
| Reload during run/gate/completion | Same turn-anchored card, status, artifacts, events, and human input restore. |
| Failed child run | Parent shows actionable failure and can safely retry only idempotent work. |
| External write | Consent, invocation id, receipt, provenance, no duplicate on retry. |
| Long session/compaction | Project objectives/constraints/decisions survive compaction and worker restart. |

## Verification and release gates

At each phase run the smallest relevant tests, then before release run:

```bash
npm test
npm run typecheck
npm run lint
npm run check:ui
npm run build
```

Add API/database tests for tenant isolation, lineage, replay, policy gates,
and idempotency. Add graph tests for plan validation, sub-graph joins, human
resume, revision locking, and cancellation propagation. Add browser tests in
dark, light, and monochrome themes for anchored run cards, wizard restoration,
project controls, artifact revision history, and full-screen preview.

The live certification is a real business landing-page task with no external
write authority initially. Only after it passes artifact quality, reload,
forced-compaction, and worker-restart gates should a connected Drive, Notion,
or deployment write be enabled with explicit user approval.

## Non-goals for the first implementation slice

- No autonomous cron scheduling yet.
- No hidden background swarm or unrestricted shell/database access for models.
- No automatic external publish/send/write.
- No separate “workflow chat” that fragments conversation memory.
- No claim that a provider/integration is available without an executable,
  schema-validated adapter and a tested receipt path.
