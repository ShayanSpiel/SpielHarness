# AGENTS.md

## Project Rules

- The harness is file-backed. Do not hardcode roles, skills, evals, workflows, prompts, or templates in app code.
- Prefer editable seed files under `supabase/seed` for starter content.
- File-backed harness IDs are executable. Run APIs resolve from `files` as well as legacy `roles`/`tools` tables.
- `/api/harness/files` returns camelCase client rows.
- Do not reintroduce a `/harness` page. Resources are managed through Roles, Skills, Workstreams, Evals, Strategy, and Files.
- Strategy and prompts are one Strategy workspace, organized by folders. Never split into peer page tabs.
- Files has two tabs: Library (local content) and Files (Google Drive). Do not add other tabs.
- Seed folders describe real content groupings: `Strategy`, `Prompts`, `Library`, `Outputs`.
- Role `contextSlugs` are the source of default context. Keep every slug resolvable from seed files.
- Google Drive records are external read-only context. Never modify Drive files from local operations.

## Verification

```bash
npm run typecheck
npm run lint
```

Use `npm run build` before shipping larger changes.

## UI System

- Use `.agents/skills/spielos-ui/SKILL.md` for UI work.
- `docs/design-system.md` and `docs/interaction-design.md` are sources of truth.
- Put repeated decisions in `packages/design-system` before app code.
- Run `npm run check:ui` after UI changes.

## Database

Update `supabase/manual_harness_merge.sql` with migrations when schema drift is suspected.

## Run Lifecycle

- Durable statuses: `running`, `waiting_human`, `completed`, `failed`, `cancelled`. `idle` is client-only.
- Terminal events and SSE `done.status` are authoritative. Do not infer liveness from events.
- Plain chat works without a selected harness item. Do not present it as workflow execution.
- Execution activity is inline and compact in chat. Complete history is in Events inspector.

## Director

- The Director is the orchestrator role (`metadata.systemRole: "orchestrator"`). Seed: `supabase/seed/agents/orchestrator.md`.
- Model priority: user-selected → orchestrator role's `modelId` → workflow model → workspace default.
- `streamDirectorRun` uses `streamMode: ["values"]`. Track per-message content length (`yieldedTextLen` Map) for delta yielding.
- `ChatRuntimeProvider key` must be pathname-based to prevent remount during runs.
