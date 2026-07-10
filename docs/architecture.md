# SpielOS Implementation Architecture

SpielOS is a TypeScript monorepo. The harness is file-first: every role, skill, eval, template, prompt, strategy, and workstream is a row in the `files` table, with the type encoded as `file_type`. No agent, skill, eval, or workflow is hardcoded in the application.

## Packages

- `apps/web` — Next.js 15 App Router. Pages for Runs, Knowledge, Strategy, Roles, Workstreams, Evals, Skills, and Settings. All UI components consume the API; starter harness content comes from seed files.
- `packages/core` — Zod schemas + product types. The single source of truth for `Role`, `Skill`, `Workstream`, `EvalFile`, `Run`, `RunEvent`, `HumanInputRequest`.
- `packages/providers` — Model provider abstraction. Each provider is a `ChatAdapter`. The registry is keyed by `provider.kind` (e.g. `mistral`). Add a new provider by writing one file.
- `packages/graph` — LangGraph runtime. A generic executor that takes a list of role-bound nodes and a list of skills and streams `node_started`, `skill_started`, `human_input_requested`, `artifact_created`, `node_completed`, `run_completed`.
- `packages/evals` — Mechanical eval engine. Rubrics are data (`contains`, `missing`, `min_words`, `max_words`, `regex`, `llm_judge`).
- `packages/db` — Supabase migrations + a thin client. Tables for `files`, `folders`, `roles`, `tools`, `role_skills`, `graph_templates`, `graph_template_versions`, `runs`, `run_events`, `eval_reports`, `model_providers`, `models`, `audit_log`.

## Run lifecycle

1. The UI posts a typed execution request to `/api/runs/execute`: prompt, optional target, selected context references, optional workflow nodes, and optional parent run id.
2. `apps/web/lib/execution-service.ts` infers or validates the target, applies chat compatibility rules, resolves file-backed roles/skills/evals/workflows, and records selected context in `runs.inputs`.
3. The server creates or updates a run row and emits the run id as the first SSE frame.
4. Plain chat runs answer through the shared run API without selected library injection. Role, skill, eval, and workflow runs call `streamRun`, which drives a `StateGraph`:
   - `resolve` → pick the next node by `cursor`
   - `execute` → run the active skill (LLM call, human input, eval, …)
   - `advance` → if a human input was requested, pause via LangGraph `interrupt`; else increment `cursor`
5. Events stream back as SSE frames. Artifacts are persisted as `files` rows and added to `generated_files`.
6. When a `human_input` skill runs, the run pauses. The user answers in chat. Their reply hits `/api/runs/[id]/reply`, which reconstructs the persisted execution request and resumes the graph.

## File-first model

Strategy files, knowledge notes, prompt files, library artifacts, and all harness resources share the same `files` table. The `file_type` enum is:

```
knowledge, strategy, prompt, artifact, draft, evidence, asset,
eval_report, publish_package,
harness_role, harness_skill, harness_workstream, harness_eval,
harness_template, harness_chat_message
```

Folders are stored in `folders` and referenced by `files.folder_id`. There is no separate "strategy", "library", or "knowledge" table — they are all the same thing with different `file_type` and folder layout.

## Reset

- UI: harness resources are managed through the focused catalog pages. Admin reset routes operate on the same file-backed resources.
- Script: `npx tsx scripts/reset.ts [files|prompts|all|nuke|seed]`.
- API: `POST /api/admin/reset { mode, confirm: "RESET" }`.

## Supabase

`packages/db/supabase/migrations/0001_*.sql` is the foundation. `0002_*.sql` adds the seed folders/files. `0003_*.sql` adds `graph_template_versions` and an audit RPC. `0004_*.sql` adds the harness file types and `role_skills`. `supabase/manual_harness_merge.sql` is the SQL-editor merge script for existing backends.

`apps/web/lib/server.ts` resolves the org per request from a `spielos.org` cookie (falls back to the demo org).

## Chat target rules

- Empty context is valid and is stored as `explicit_context = []`.
- A workflow is exclusive with role, skill, and eval targets.
- A role may be combined with one direct skill.
- A direct skill or eval can run independently.
- Files, prompts, and library records are context, not targets.

## Adding a new provider

1. Add a row in `model_providers` with `kind = "your_kind"`.
2. Create `packages/providers/src/your-kind.ts` exporting a `ChatAdapter`.
3. Register it in `packages/providers/src/registry.ts`.
4. The rest of the system picks it up automatically.

## Adding a new skill kind

1. Add the kind to `skillKindSchema` in `packages/core/src/index.ts`.
2. Add a branch in the `execute` node of `packages/graph/src/index.ts`.
3. The kind is available everywhere — UI forms will include it; agents and workstreams can attach it.
