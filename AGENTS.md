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
- SSE `message_persisted` frames are the authoritative source for committed chat messages. The store reconciles by primary key: `upsertMessage` replaces by ID, `reload()` merges by ID and sorts deterministically by `createdAt` + ID.
- The `done` SSE frame is emitted exactly once after all durable persistence (checkpoint, metadata, chat message) and realtime publication succeed.
- Assistant-message persistence is mandatory for successful finalization. If the append fails, the terminal status becomes `failed`.

## Director

- The Director is the orchestrator role (`metadata.systemRole: "orchestrator"`). Seed: `supabase/seed/agents/orchestrator.md`.
- Model priority: user-selected → orchestrator role's `modelId` → workflow model → workspace default.
- `streamDirectorRun` uses `streamMode: ["values"]`. Track per-message content length (`yieldedTextLen` Map) for delta yielding.

## Chat State

- `ChatRuntimeProvider` is hoisted into `AppProviders` and survives all navigation. Chat switching uses `runtime.thread.reset()` driven by `activeChatId`. No pathname-derived key is used.
- `store.messages` reconciles by primary key: `upsertMessage` replaces by ID, `reload()` merges by ID (never overwrites locally-upserted messages) and sorts deterministically.
- New chats are seeded via `chat_created` + `message_persisted` SSE frames. The `finally` block in `chat-adapter.ts` only calls `setActiveChat`; local placeholder messages are never created.
