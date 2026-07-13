# SpielOS

SpielOS is a file-backed AI assistant and workflow harness. Roles, skills, evals, templates, workflows, prompts, strategy, and knowledge are stored as rows in the `files` table and loaded into the Next.js app as editable harness items. The bundled starter content targets marketing operations, but the runtime is domain-independent.

## Structure

- `apps/web` - Next.js app, chat workbench, roles, skills, workstreams, evals, strategy, knowledge, settings.
- `packages/core` - shared schemas and runtime types.
- `packages/graph` - LangGraph executor for role-bound workflow nodes.
- `packages/evals` - mechanical rubric evaluation.
- `packages/providers` - model provider adapters.
- `packages/db` - Supabase schema and DB client helpers.
- `supabase/seed` - starter harness files.
- `supabase/manual_harness_merge.sql` - SQL merge script for manually syncing an existing Postgres/Supabase backend.

## Backend Sync

For an existing Supabase project, run `supabase/manual_harness_merge.sql` in the SQL editor. Then reseed from the app with `POST /api/harness/seed` or use the automatic seed bootstrap on a clean database.

The merge adds the harness enum values, run/event columns needed by orchestration, the `harness_files` view, and missing event/status enum values used by the app.

## Development

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
```

Set `MISTRAL_API_KEY` for the environment-backed plain-chat fallback and optionally `MISTRAL_MODEL` to override its model id. Enabled database model records take precedence. Plain chat does not require a selected workflow, role, skill, eval, or context file.

## Starter Harness

The seed corpus includes editable marketing roles, skills, workflows, eval rubrics, templates, and strategy prompts. Each item is isolated as its own seed file and becomes its own harness `files` row.

## Runtime lifecycle

Durable run statuses are `running`, `waiting_human`, `completed`, `failed`, and `cancelled`; `idle` is client-only. Runtime events are the source of truth for execution activity. The chat renders concise inline activity while the Events inspector retains the complete ordered timeline.

This repository is buildable but is not ready for public multi-tenant deployment. Application authentication and authorization, durable worker execution, transactional credit enforcement, and server-owned integration credentials remain release blockers. See `docs/production-readiness-audit.md` for the current assessment.
