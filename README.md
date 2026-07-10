# SpielOS

SpielOS is a file-backed AI marketing team harness. Roles, skills, evals, templates, workflows, prompts, strategy, and knowledge are stored as rows in the `files` table and loaded into the Next.js app as editable harness items.

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

Set `MISTRAL_API_KEY` to enable the Director chat model. Without it, the app should fail clearly instead of pretending an LLM run happened.

## Starter Harness

The seed corpus includes basic marketing roles, free/basic skills, two workflows, eval rubrics, templates, and strategy prompts. Each item is isolated as its own seed file and becomes its own harness `files` row.
