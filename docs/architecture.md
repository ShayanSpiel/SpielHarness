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
2. `execution-service.ts` loads file-backed definitions for the workspace, resolves ids/slugs, validates graph references, creates runtime-only roles for role-less skill nodes, and converts file-backed evals to executable eval skills.
3. The API creates a `runs` row and returns an SSE stream.
4. Plain chat streams through the provider adapter and works without a selected harness target. Database model rows are preferred; an environment-configured Mistral model is the fallback.
5. Other targets execute a LangGraph state graph. Node, skill, tool, eval, artifact, human-input, and terminal events stream when they occur. Events and the latest checkpoint are persisted when the request pauses or terminates. Artifacts are persisted as files and linked through `run_output_files`.
6. Human answers are posted to `/api/runs/[id]/reply`, which reloads the checkpoint and resumes without replaying completed nodes.

Durable statuses are `running`, `waiting_human`, `completed`, `failed`, and `cancelled`. Client `idle` is not persisted.

## Trust boundaries

All database access is server-side. API queries are explicitly scoped by `org_id`, and `0002_tenant_integrity.sql` prevents new cross-workspace references. Application authentication is not implemented: `getOrg()` currently returns the demo workspace. Do not expose this build publicly until request identity and membership checks replace that fallback.

The schema is plain PostgreSQL and can run on Supabase, Neon, RDS, or self-hosted Postgres. Supabase-specific auth or RLS is not used. `supabase/manual_harness_merge.sql` supports SQL-editor updates for an existing Supabase database; canonical fresh-install migrations live in `packages/db/migrations`.

## Production topology still required

Long-running graph work must move out of the Next.js request into a durable worker with leases, heartbeats, retry policy, continuous event persistence, and cancellation. Billing enforcement must reserve credits before execution and settle from provider-reported usage. These are release blockers, not capabilities supplied by the current web process.
