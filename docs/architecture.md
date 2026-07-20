# SpielOS architecture

SpielOS is a TypeScript monorepo with a file-backed harness and a portable PostgreSQL schema.

## Packages

- `apps/web`: Next.js App Router UI and server routes.
- `packages/core`: Zod schemas and shared product/runtime types.
- `packages/design-system`: tokens, icons, and reusable UI primitives.
- `packages/providers`: streaming adapters for configured model providers.
- `packages/graph`: LangGraph workflow construction and execution.
- `packages/evals`: deterministic rubric evaluation.
- `packages/db`: direct PostgreSQL access and portable migrations.

Starter roles, skills, workflows, evals, prompts, and templates are editable seed files under `supabase/seed`. Runtime APIs resolve harness rows from `files`; app code does not define the production harness catalog.

## Execution path

1. A client posts the typed target, prompt, chat history, and explicit file ids to `/api/runs/execute`.
2. `resolveExecution` in `execution-service.ts` loads file-backed definitions for the workspace, resolves ids/slugs, validates graph references, creates runtime-only roles for role-less skill nodes, and converts file-backed evals to executable eval skills. Executor resolution delegates to `resolveExplicitExecutor` from `@spielos/core` for deterministic role-to-skill binding.
3. Workspace settings (`workspace_settings` table) supply default model, execution mode, runtime policy, limits, and approval policy with fallback to legacy file-based runtime policy. The settings authority is a single Zod schema (`workspaceSettingsSchema`).
4. The API creates a `runs` row and returns an SSE stream.
5. `compileSnapshot` from `@spielos/graph/compile` can produce a validated `WorkspaceSnapshot` with resolved relations, content hashes, model roster, and entity diagnostics — used for pre-flight validation and cache-coherent compilation.
6. Plain chat streams through the provider adapter and works without a selected harness target. Database model rows are preferred; an environment-configured Mistral model is the fallback.
7. Other targets execute a LangGraph state graph. Node, skill, tool, eval, artifact, human-input, and terminal events stream when they occur. Events and the latest checkpoint are persisted when the request pauses or terminates. Artifacts are persisted as files and linked through `run_output_files`.
8. Human answers are posted to `/api/runs/[id]/reply`, which reloads the checkpoint and resumes without replaying completed nodes.
9. Child run budgets (`child_run_budgets` table) enforce slot limits and capability call quotas. Tool invocations (`tool_invocations` table) provide idempotent deduplication with concurrent-claim protection.
10. Director verification evaluates completion criteria (`requiredToolCalls`, `requiredEvalThresholds`, `requiredArtifacts`, `requiredWorkflows`) against collected evidence after each run.

Durable statuses are `running`, `waiting_human`, `completed`, `failed`, and `cancelled`. Client `idle` is not persisted.

## Architecture audit phases (completed)

The following phases have been implemented to close the gap between ad-hoc file access and a validated, deterministic runtime:

- **Phase A — Schema Validation:** `safeParseRole`, `safeParseSkill`, `safeParseWorkflow`, `safeParseEval`, `validateHarnessEntities` in `@spielos/core`. `fileRowToRecord` and related infrastructure use Zod for casting.
- **Phase B — Normalize Relationships:** `listRoleSkills`, `listWorkflowNodeRoles`, `listWorkflowNodeSkills`, `listWorkflowNodeFiles`, `listSkillConnectionOps` in `packages/db/src/relations.ts`. `file_relation_type` enum and `ordering` column.
- **Phase C — Explicit Workflow Topology:** `inferWorkflowTopology`, `validateWorkflowDAG` in core. Workflow metadata carries an explicit `topology` field; DAG-mode workflows require edges.
- **Phase D — Deterministic Executor Resolution:** `resolveExplicitExecutor` in core. Shared between execution-service and director-tools.
- **Phase E — Separate Lifecycle from Enablement:** `lifecycle` (draft/published/archived), `enabled` (boolean), and `validation_diagnostics` columns on files. `fileRecordSchema` includes these fields.
- **Phase F — One Workspace Settings Authority:** `workspace_settings` table with backfill from legacy runtime policy files. All consumers read from the same `getWorkspaceSettings` / `upsertWorkspaceSettings` pair.
- **Phase G — One Validated Capability Snapshot:** `compileSnapshot`, `buildResolvedRelations`, `buildContentHashes` in `packages/graph/src/compile.ts`. 30-second in-memory cache by revision hash.
- **Phase H — Director Verification:** `completionCriteriaSchema`, `collectEvidence`, `evaluateCompletion` in core and graph director.
- **Phase I — Durable Child Budgets:** `child_run_budgets` table with slot reservation, release, and capability call counting.
- **Phase J — Idempotent Tool Invocation:** `tool_invocations` table with `invocation_status` enum, concurrent-claim protection via unique constraint.

## Trust boundaries

All database access is server-side. API queries are explicitly scoped by `org_id`, and `0002_tenant_integrity.sql` prevents new cross-workspace references. Application authentication is not implemented: `getOrg()` currently returns the demo workspace. Do not expose this build publicly until request identity and membership checks replace that fallback.

The schema is plain PostgreSQL and can run on Supabase, Neon, RDS, or self-hosted Postgres. Supabase-specific auth or RLS is not used. `supabase/manual_harness_merge.sql` supports SQL-editor updates for an existing Supabase database; canonical fresh-install migrations live in `packages/db/migrations`.

## Production topology still required

Long-running graph work must move out of the Next.js request into a durable worker with leases, heartbeats, retry policy, continuous event persistence, and cancellation. Billing enforcement must reserve credits before execution and settle from provider-reported usage. These are release blockers, not capabilities supplied by the current web process.
