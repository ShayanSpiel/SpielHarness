# SpielOS

File-backed AI assistant and workflow harness for marketing operations. Every role, skill, eval, template, and workflow is editable data — not hardcoded. The runtime is domain-independent.

## Structure

| Package | Purpose |
|---------|---------|
| `apps/web` | Next.js app — chat, roles, skills, workstreams, evals, strategy, files, settings |
| `packages/core` | Zod schemas and shared runtime types |
| `packages/graph` | LangGraph executor for workflow nodes |
| `packages/evals` | Deterministic rubric evaluation |
| `packages/providers` | Model provider adapters |
| `packages/db` | PostgreSQL schema and DB helpers |
| `packages/design-system` | Tokens, icons, and UI primitives |
| `supabase/seed` | Starter harness files |

## Quick Start

```bash
npm install
npm run dev
npm run typecheck
npm run lint
```

Set `MISTRAL_API_KEY` for the default model. Use `MISTRAL_MODEL` or `MISTRAL_MEDIUM_MODEL` to override model IDs. Plain chat works without a selected harness target.

## Backend Sync

For existing Supabase projects, run `supabase/manual_harness_merge.sql` in the SQL editor. Then reseed with `POST /api/harness/seed` or use automatic seed bootstrap on a clean database.

## Docs

- `docs/architecture.md` — system overview
- `docs/harness-model.md` — harness domain model
- `docs/data-model.md` — database schema
- `docs/design-system.md` — visual source of truth
- `docs/interaction-design.md` — behavioral source of truth
- `docs/langgraph-runtime.md` — graph runtime semantics
- `docs/positioning.md` — product positioning and competitive landscape
- `docs/plans/` — implementation plans and architecture audits
- `docs/archive/` — completed or superseded plans
