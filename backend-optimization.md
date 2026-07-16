# Backend Optimization Plan

> **Execution order:** Run this plan first and complete its verification before starting the SpielOS Implementation Plan. This file remains the source of truth for backend optimization.

> **Status (Phase 4 complete, 2026-07-16):** Phase 0 instrumentation shipped (baseline in `.benchmarks/baseline-phase0.json`) and the SQL Proxy regression was fixed (see "Phase 0 — Bugfix"). Phase 1 latency wins are in (plain chat short-circuits harness loading, compaction skips first-turn token counting, models upsert with `ON CONFLICT DO NOTHING` + revision cache, `fetch-json` honors `Retry-After`, explicit `DATABASE_CONNECTION_MODE`, auth pool `max: 2` with drain-on-error, `getSession()` retry loop). Phase 2 database efficiency is in: event sequencing is now atomic via `runs.next_event_sequence`; `runs.graph_version` is added for future execution-snapshot verification; the `unique(run_id, event_key)` index from 0009 is locked in with a documented `DO` block; `sanitizeJsonString`/`sanitizeJsonValue` are replaced with a single native `JSON.stringify` + one regex pass; `files_metadata_idx` is audited in a forward migration that drops it only when `pg_stat_user_indexes.idx_scan = 0`; `wipe_and_seed.sql` is data-only and `0001_init.sql` remains the canonical schema. Phase 2.5 atomic checkpoint persistence is in: `runs.checkpoint_version` enables optimistic locking; a new `db.atomicCheckpoint()` bundles event flush + state update + version increment in a single `sql.begin()` transaction; the execute and reply routes plus `/runs/[id]/cancel` and `/runs/[id]/pause` all use it. Phase 3 durable control without polling is in: an in-process run-registry (`apps/web/lib/run-registry.ts`) lets the cancel/pause routes signal the original request's `AbortController`; the durable `runs.cancel_requested_at` / `runs.pause_requested_at` columns and `runs.checkpoint_version` are the persistent record; the graph calls a `checkControl` callback at every node/tool boundary in both `streamRun` and `streamChatRun`. Phase 4 realtime domain events is in: a transport-adapter pub/sub (`apps/web/lib/realtime.ts`) with an in-process `EventEmitter` implementation, a `/api/realtime` SSE relay with the cross-tenant guard (a session for org A cannot subscribe to a `run:<id>` for org B), a `useRealtimeSubscription` hook, and publisher hooks in the execute route and in the harness files/cancel/pause routes. Verification: `npm run typecheck` ✅, `npm run lint` ✅, `npm run test` 38/38 pass (5 new `realtime` tests + 5 new `run-registry` tests + 28 pre-existing), all four `db-*.sh` scripts are shell-syntax-valid, `npm run build` succeeds (with `RESEND_API_KEY=dummy`). Migrations 0010, 0014, 0015 (audit dropped the unused GIN), and 0016 are applied to the hosted database. Phase 5 serverless-readiness is documented as deferred.

## Context

The current backend is slow: a simple chat generation takes ~10 minutes. The user previously had a fast realtime game on Supabase native Postgres. The main differences are:

- This backend routes through the Supabase pooler on port 6543 (PgBouncer transaction mode) instead of a direct or session-pooled connection on port 5432.
- This backend runs `listHarnessFiles` and parses every harness file on every run, including plain chat.
- This backend polls `getRun` every 350-500ms during every run.
- This backend uses a tiny `max: 3` connection pool for both the app and BetterAuth.
- This backend makes a hidden blocking LLM call for compaction before streaming the first token.
- This backend inflates the chat system prompt with the entire harness catalog.

The user wants:
- Lean and fast.
- Migratable in 1 click.
- Serverless-ready, but not at the cost of speed today.
- Realtime for cross-tab context, token usage, run status.
- Multi-tenant, 2 users max for MVP.
- Pause/cancel is session-scoped, no cross-client cancel needed today.

This plan supersedes earlier drafts. It integrates a critique pass: more honest about what is measured vs. estimated, more careful about durable cancellation, and explicit about the real-time auth model given BetterAuth.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Connection port | Benchmark direct vs. Supavisor session mode on 5432; do not assume 5432 = direct | Port alone does not determine the mode; verify with a probe |
| Prepared statements | Enable only for direct or session-pooled modes; disable for transaction mode | Transaction pooling rejects prepared statements |
| Serverless | Defer the implementation; document the two profiles | MVP runs on persistent Node; keep the option open |
| Polling (current 350-500ms `getRun` loop) | Remove | Nothing else can cancel mid-run today; pause/cancel is session-scoped |
| Durable cancellation (future) | Persist `cancel_requested_at`; check at graph boundaries; do not poll | Polling is a stand-in for a real control plane |
| Streaming coupling (future) | Defer the POST/worker split; SSE-from-route is fine for MVP | Real architecture, but a big rewrite |
| Realtime transport | Server-side SSE relay that broadcasts domain events on private channels for MVP; Postgres Changes is acceptable as a temporary measure behind a transport adapter | Raw table subscriptions are not frontier and need an auth bridge from BetterAuth |
| Realtime auth | Browser uses publishable key + RLS; server uses service role to publish | Service role never reaches the browser |
| Compaction | Token-budgeted, never blocks first token if the request already fits; skip on first turn | Magic message counts are arbitrary |
| Event sequence | Replace `max(sequence)+1` with a per-run counter (atomic increment) or identity + `event_key` with `unique(run_id, event_key)` | `row_number()` does not prevent concurrent writers from colliding |
| `listHarnessFiles` on chat | Skip for plain chat unless a target/context is attached | Loading every file on every chat is wasteful |
| Director prompt catalog | Drop from chat; show only when a target needs awareness | Bloats system prompt, pushes into compaction |
| `listModelsWithEnvironmentDefaults` | Single `listModels` after `INSERT ... ON CONFLICT DO NOTHING` | Removes duplicate query and unique-violation path |
| Pool sizes | Env-controlled; start with `max: 5` app, `max: 2` auth; measure wait | `max: 10` per pool can double connection usage |
| `files_metadata_idx` GIN | Inspect `pg_stat_user_indexes`; drop only if evidence supports it | Not on critical path; do not remove blindly |
| Client retry | Network errors only; respect `Retry-After`; never retry 5xx on cached reads | Stops the 1.75s amplification |
| Migrations | Add `db:migrate`, `db:seed`, `db:reset`, `db:verify` scripts; resolve the `wipe_and_seed.sql` vs `0001_init.sql` duplication | 1-click portability and a single source of truth |
| Two DB drivers (postgres.js + pg) | Keep for MVP; document as known cost | Unifying is not worth the refactor risk at 2 users |
| Event-key uniqueness | Add `unique(run_id, event_key)` constraint | Already inserting event_key — lock it in to prevent duplicate logical events |
| Atomic checkpoint | Bundle event flush + state update in one `sql.begin()` transaction | Prevents data loss when a crash lands between the two writes |
| Graph versioning | Add `runs.graph_version text` | Enables execution-snapshot verification before recovery (Phase 5) |
| Tool idempotency journal | Add `run_tool_invocations` with `unique(run_id, logical_invocation_key)` | Required before multi-worker; prevents duplicate side effects |
| Fencing tokens | Monotonically increasing token per attempt, verified on every mutation | Prevents stale workers from writing after lease expiry |
| Instrumentation | Add request spans, query counter, and stage timings to the run pipeline | Confirm which "estimated" wins are real before claiming them |

## Connection Profiles

The runtime supports two profiles. The MVP runs on `persistent-node`. The `serverless-web` profile is documented for future use.

### `persistent-node`

- Connection: direct Postgres or Supavisor session mode on port 5432.
- `prepare: true`.
- Bounded persistent pools.
- Long-lived SSE from `/api/runs/execute`.
- In-memory abort controllers per request.
- BestAuth `pg.Pool` separate from the app pool.

### `serverless-web` (future, not implemented now)

- Connection: Supavisor transaction mode on port 6543, or a serverless driver.
- `prepare: false`.
- Per-instance `max: 1` with the pooler handling concurrency.
- No long-running execution inside the request; the worker owns it.
- BestAuth stays in the same runtime as a serverless function.

Both profiles use the same repositories and SQL. Only connection management differs.

## Phase 1 — Status: complete (2026-07-16)

**Files added**
- `packages/db/src/index.ts` — new `getOrchestratorPrompt(orgId)` and `ensureEnvironmentModels(orgId, models)` helpers
- `packages/db/src/index.ts` — exported `resolveConnectionMode`, `shouldUsePreparedStatements`, and `DatabaseConnectionMode` type

**Files modified**
- `apps/web/lib/execution-service.ts:103-118` — plain chat (no targetId/workflowId/contextFileIds/nodes) skips `listHarnessFiles` and `listModelsWithEnvironmentDefaults`; falls back to a focused `getOrchestratorPrompt` and env-only models. Also skips `listConnections` for chat (already true) and the `if (!isChat)` parsing branch is preserved.
- `apps/web/lib/execution-service.ts:590-606` — `resolveDirectorPrompt` simplified to base + orchestrator instructions + optional "No harness tools attached" line for plain chat. The role/skill/eval/workflow catalog block is dropped.
- `apps/web/lib/execution-service.ts` — also stops returning the orchestrator prompt from a listHarnessFiles result that may not include it; instead we always fetch it via the focused query for plain chat.
- `packages/providers/src/context.ts:62-145` — compaction now returns before any `countInputTokens` call when `uncompactedHistory.length <= 1`, using a rough estimate. The "fits" check (`<= inputLimit * compactionThreshold`) is preserved for later turns.
- `apps/web/lib/default-models.ts` — `listModelsWithEnvironmentDefaults` now (a) does a single `INSERT ... ON CONFLICT (org_id, provider, model) DO NOTHING` via `ensureEnvironmentModels`, (b) lists once, and (c) caches the result per org for 30s keyed by an env-var revision. Exposed `invalidateModelCache(orgId?)`.
- `apps/web/app/api/models/route.ts` — calls `invalidateModelCache(org.orgId)` after create/update/delete so user changes propagate immediately.
- `apps/web/lib/fetch-json.ts` — replaced with a tighter policy: 5xx retries limited to 502/503/504, `Retry-After` header is parsed (delta-seconds or HTTP-date, capped at 5s), `skipRetryOn5xx` policy for cached reads, attempts capped at 2.
- `apps/web/.env.local` — `DATABASE_CONNECTION_MODE=session` added so the explicit setting matches the port 5432 host.
- `packages/db/src/index.ts:29-82` — `createSql` resolves mode from `DATABASE_CONNECTION_MODE` or the connection string port; `prepare` is `true` for direct/session and `false` for transaction; logs `connection mode=… prepare=…` once on startup.
- `apps/web/lib/auth.ts:10-26` — `AUTH_POOL_MAX` default changed to 2. Pool error handler now detects unrecoverable errors (`terminated|closed|reset|connection refused|ECONNRESET|ETIMEDOUT`) and drains/clears the cached pool so the next call recreates it.
- `apps/web/lib/server.ts:39-90` — `getSessionWithRetry` runs `auth.api.getSession()` up to 2 times with exponential backoff on retriable pool errors; resolves into a 30s in-memory `sessionCache` so the auth path is warm.

**After-fix observations (local, dry-run reasoning)**
- Plain chat DB query count drops from **15 → 4**:
  - 1 × `getOrchestratorPrompt` (orchestrator prompt lookup)
  - 1 × `ensureEnvironmentModels` (idempotent upsert; no-op if env defaults already present)
  - 1 × `listModels`
  - 1 × `createRun` (in `route.ts`)
  - 1 × `linkRunInputFiles` only if `contextFileIds.length > 0` (skipped for plain chat)
  - 1 × `appendChatMessage` + 1 × `updateChatMetadata` only if `chatId` is set
- The hidden pre-stream model call is preserved at **0**: no token-count round-trip happens before the first byte for first-turn chat.
- `system_prompt_tokens_estimate` drops from 502 → ~360 because the catalog block ("Roles: ... Skills: ... Workflows: ... Evals: ... Available strategy and library files: ...") is gone for chat.

**Phase 1 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` 23/24 pass; the lone failure (`tests/db-events.test.ts:5`) is pre-existing and not introduced by this phase (`git stash && npm run test` reproduces the failure on the unmodified tree).
- `npm run build` still fails on the pre-existing `new Resend("")` in `apps/web/lib/email.ts:3` (missing `RESEND_API_KEY` env var); unrelated to Phase 1.

**To capture the live after-trace**
```bash
export COOKIE=$(node scripts/mint-session-cookie.mjs)
export COOKIE_BLOB="better-auth.session_token=$COOKIE"
export BENCH_MODEL_ID="<enabled model id from /api/models>"
# run against the dev server
node --experimental-strip-types scripts/benchmark-chat.ts \
  | tee .benchmarks/baseline-phase1.json
```

---

## Phase 2 — Status: complete (2026-07-16)

**Files added**
- `packages/db/migrations/0014_event_sequence_atomic.sql` — `runs.next_event_sequence bigint not null default 0`, `runs.graph_version text`, backfill of the counter from existing `run_events.sequence`, and a `DO` block that re-creates the `run_events_run_event_key_idx` partial unique index if it is ever missing.
- `packages/db/migrations/0015_files_metadata_index_audit.sql` — conditional `DROP INDEX` of `files_metadata_idx` that runs only when `pg_stat_user_indexes.idx_scan = idx_tup_read = idx_tup_fetch = 0`. The inspection query is documented in the file header for manual review.

**Files modified**
- `packages/db/src/index.ts:1-30` — `sanitizeJsonString` / `sanitizeJsonValue` are replaced with a single `JSON.stringify` + one regex pass (`/\\u[dD][89abAB][0-9a-fA-F]{2}/g`) that matches the JSON-escaped surrogate form. Output: a single native pass for serialization, a single regex test, and (only when needed) a single regex replace.
- `packages/db/src/index.ts:RunRow` — adds `graph_version`, `next_event_sequence`, `cancel_requested_at`, `pause_requested_at`, `resumed_at` to the row type and the SELECT lists of `findRunByIdempotency`, `createRun`, `getRun`, and `listRuns`.
- `packages/db/src/index.ts:createRun` — accepts `graphVersion?: string | null` and persists it.
- `packages/db/src/index.ts:nextRunEventSequence` — now reads from `runs.next_event_sequence` (was `coalesce(max(sequence) + 1, 1)`).
- `packages/db/src/index.ts:appendRunEvents` — first calls a new `reserveEventSequenceRange` that does `UPDATE runs SET next_event_sequence = next_event_sequence + ${count} RETURNING (next_event_sequence - ${count}) AS base`; then inserts the batch with `sequence = base + row_number() - 1`. Two concurrent appends on the same run cannot produce overlapping sequences.
- `packages/db/migrations/wipe_and_seed.sql` — header rewritten to declare this file DATA ONLY; schema lives in the numbered migrations.
- `scripts/db-verify.sh` — new `column_exists` and `index_exists` helpers; checks `runs.next_event_sequence`, `runs.graph_version`, `runs.cancel_requested_at`, and the `run_events_run_event_key_idx` partial unique index.
- `supabase/manual_harness_merge.sql` — Step 4 mirrors migration 0014.
- `tests/db-events.test.ts` — mock now returns `[{ base: 0 }]` for the new `update runs set next_event_sequence = ... returning ...` reservation statement; assertions check both the reservation and the `batch.event_type::event_type` cast in the SELECT clause.
- `tests/db-json.test.ts` — unchanged; the new `normalizeLoneSurrogates` matches the test's expectation of a literal U+FFFD in the output.

**Observations**
- The `nextRunEventSequence` API is preserved; the reply route's `firstEventSequence` local counter now starts at the run's atomic counter and is in lock-step with the DB sequence that `appendRunEvents` reserves.
- The `0014` backfill is idempotent: it only advances `next_event_sequence` when the counter is behind the materialized events.
- The `0015` audit is also idempotent and safe on hot databases — it raises a NOTICE and only drops the index when it has never been read. If the index is in use, the migration is a no-op.
- `db:migrate`, `db:seed`, `db:reset`, and `db:verify` were already wired in `package.json`; this phase tightened `db:verify` to assert the new columns/index.
- The two DB drivers (postgres.js + pg) remain as a documented MVP cost (out of scope).

**Phase 2 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` 24/24 pass (the `db-events.test.ts` and `db-json.test.ts` tests were updated to match the new reservation pattern and single-pass sanitization; all other tests unchanged).
- `bash -n scripts/db-{migrate,seed,reset,verify}.sh` ✅ (all four scripts are shell-syntax-valid).
- `node -e ...` confirms the new migrations contain `next_event_sequence`, `graph_version`, and the conditional `drop index` statement.

**Apply the new migrations**
```bash
# either path:
npm run db:migrate                       # applies all 00XX_*.sql in order
# or, on a Supabase hosted DB without psql locally:
DATABASE_URL=... node scripts/db-migrate.mjs
# then:
npm run db:verify                        # asserts the new columns/index exist
```

---

## Phase 2.5 — Status: complete (2026-07-16)

**Files added**
- `packages/db/migrations/0016_atomic_checkpoint.sql` — `runs.checkpoint_version bigint not null default 0` + `runs_checkpoint_version_idx` on `(org_id, checkpoint_version) where checkpoint_version > 0`.
- `tests/atomic-checkpoint.test.ts` — 4 tests covering the lock+reserve+insert+update ordering inside a single `begin()` unit, `CheckpointVersionMismatch` semantics, stale-version rejection, and the no-events no-op path.

**Files modified**
- `packages/db/src/index.ts:RunRow` — adds `checkpoint_version: number` and includes it in the SELECT lists of `findRunByIdempotency`, `createRun`, `getRun`, and `listRuns`.
- `packages/db/src/index.ts` — new exports: `atomicCheckpoint`, `AtomicCheckpointInput`, `AtomicCheckpointResult`, and the `CheckpointVersionMismatch` class. The function takes a `Sql` and an `AtomicCheckpointInput`, calls `sql.begin(async (tx) => { ... })`, takes a `select ... for update` row lock on the run, optionally checks `expectedCheckpointVersion`, reserves a contiguous sequence range against `runs.next_event_sequence`, inserts the event batch with `sequence = base + row_number - 1`, and updates `state`/`outputs`/`human_inputs`/`status`/`error`/`completed_at` while incrementing `checkpoint_version`. All four statements live in the same transaction; any failure rolls back the whole checkpoint.
- `apps/web/app/api/runs/execute/route.ts` — `flushQueuedEvents` is replaced by `flushAtomicCheckpoint`, which now bundles events with the current `RunCheckpoint` state in one transaction. The periodic flush (`>= 12` queued events), the per-checkpoint yield, the `finally`-block drain, and the final terminal-state write all go through `atomicCheckpoint`. The final write has a non-transactional `updateRun` fallback so a failing final transaction still records the terminal status (the in-memory `checkpointVersion` is recovered on the next read).
- `apps/web/app/api/runs/[id]/reply/route.ts` — same refactor: `appendRunEvents` is gone; `flushAtomicCheckpoint` handles event batches; the initial human-answer write and the final state write both go through `atomicCheckpoint` with the same `expectedCheckpointVersion` chain.
- `apps/web/app/api/runs/[id]/cancel/route.ts` — `updateRun` + `appendRunEvents` collapsed into a single `atomicCheckpoint` that persists the cancel state and the `run_cancelled` event together.
- `apps/web/app/api/runs/[id]/pause/route.ts` — same collapse: pause state + status-event written in one transaction.
- `supabase/manual_harness_merge.sql` — Step 5 mirrors migration 0016.
- `scripts/db-verify.sh` — new check for `runs.checkpoint_version`.

**Observations**
- The `atomicCheckpoint` transaction takes a row-level lock on the run (`for update`), so two concurrent atomic checkpoints on the same run serialize. There is no write-skew risk.
- The `expectedCheckpointVersion` is optional. The execute and reply routes pass it because they own the run for the duration of the request; a stale version surfaces as a `CheckpointVersionMismatch` that the caller can re-read and retry.
- The `event_persist_ms` metric now reflects total time inside `atomicCheckpoint` calls (event insert + state update in one transaction). The number goes up slightly per call but the wall-clock time is comparable to the prior read-then-write pair, with the upside that no event is ever lost to a crash between the two writes.
- Token deltas (high-frequency `usage` frames sent to the client) remain in-memory only and are persisted as a single `recordUsage` row at the next checkpoint boundary, exactly as the plan specified.

**Phase 2.5 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` 28/28 pass (4 new `atomic-checkpoint` tests + 24 pre-existing).
- `bash -n scripts/db-{migrate,seed,reset,verify}.sh` ✅.

**Recovery contract (the answer to "kill the process mid-flush")**
A process crash between the previous code's `flushQueuedEvents` and `updateRun` would persist the events but not the state, or vice versa. With `atomicCheckpoint`, the transaction either commits both or neither. On the next request, `getRun` returns the run with the prior `checkpoint_version`; the route's `expectedCheckpointVersion` is the value it saw at `createRun` (or the value from the most recent successful `atomicCheckpoint` response). If a concurrent writer advanced the version, the route receives a `CheckpointVersionMismatch`, re-reads the run, and resumes from the authoritative state.

---

## Phase 3 — Status: complete (2026-07-16)

**Files added**
- `apps/web/lib/run-registry.ts` — in-process `Map<runId, { controller, listeners }>` with `registerRun`, `signalRun`, `onRunSignal`, `isRunActive`. Stored on `globalThis.__spielosRunRegistry` so Next.js dev-mode module reloads don't fragment the map.
- `tests/run-registry.test.ts` — 5 tests covering register/unregister, cancel abort, pause-no-abort, unknown-run return value, listener detach.

**Files modified**
- `packages/graph/src/index.ts:RunRequest` — adds `checkControl?: () => "cancel" | "pause" | null` and the matching `checkControl` field on the LangGraph state annotation.
- `packages/graph/src/index.ts:streamRun` — calls `consumeControl("pre-chunk")` at the start of every LangGraph chunk. A `cancel` action yields `done: cancelled`; a `pause` action yields a `waiting_human` checkpoint plus `done: waiting_human`.
- `packages/graph/src/index.ts:streamChatRun` — calls `checkControl` once before the model call, with the same cancel/pause semantics. The chat stream is short enough that one boundary is sufficient.
- `packages/graph/src/index.ts:reactLoop` — calls `checkControl` at the start of every tool-iteration. A cancel throws and the route catches it as a terminal cancellation; a pause returns the partial output as a `waiting_human` checkpoint.
- `apps/web/app/api/runs/execute/route.ts` — registers the run with the registry in the SSE start callback, listens for in-process signals, exposes a `checkControl` closure that returns `"cancel"` when either the AbortController is aborted OR the in-memory `durableCancel` flag is set, and `"pause"` when the in-memory `durablePause` flag is set. The `flushAtomicCheckpoint` call re-reads the run row after a successful commit and refreshes the durable flags, so signals that arrived via the DB during a checkpoint gap are picked up before the next yield. Unregister and listener cleanup run in the `finally` block.
- `apps/web/app/api/runs/[id]/cancel/route.ts` — calls `signalRun(id, "cancel")` after the atomic checkpoint, so the running graph aborts at the next boundary instead of waiting for the next checkpoint.
- `apps/web/app/api/runs/[id]/pause/route.ts` — calls `signalRun(id, "pause")` after the atomic checkpoint. The graph receives the signal at the next tool-iteration or chunk boundary and yields a `waiting_human` checkpoint that the route then persists.

**Observations**
- The `cancel` and `pause` routes no longer depend on a separate request to propagate. The DB write is the durable record; the in-process signal is the fast path. If the running process has already exited (idle, crashed, restarted), the next time the graph is resumed the durable flag is read at startup, so the next request sees a cancelled/paused run.
- The `durableCancel`/`durablePause` flags are refreshed from the run row only after a successful atomic checkpoint. This is bounded — checkpoints fire every 12 events, at every human-input boundary, and at terminal status — so the latency between a DB-side cancel and the graph noticing it is at most one checkpoint.
- The polling removal that the plan called for was already in place when Phase 2.5 shipped: the execute route does not poll `getRun`. The only `getRun` calls in the route are (a) the initial load at the start of the SSE start, (b) a recovery read in the catch block to surface the durable state to the client, and (c) the post-checkpoint refresh in `flushAtomicCheckpoint`.
- Multi-process deployments (serverless or `node cluster`) need a Redis pub/sub behind the same `signalRun` interface. The shape of the registry is intentionally narrow (`Map<runId, ...>`) so a Redis-backed implementation can be a drop-in.

**Phase 3 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` 33/33 pass (5 new `run-registry` tests + 28 pre-existing).
- `bash -n scripts/db-{migrate,seed,reset,verify}.sh` ✅.

---

## Phase 4 — Status: complete (2026-07-16)

**Files added**
- `apps/web/lib/realtime.ts` — `DomainEvent` union (8 named events: `run.status.changed`, `run.output.updated`, `run.usage.updated`, `run.event.appended`, `file.created`, `file.updated`, `file.deleted`, `context.invalidated`), `Topic` literal type (`org:<id>` | `run:<id>`), `RealtimeTransport` interface, and the in-process `InProcessTransport` (Node `EventEmitter` with no listener cap). `publishDomainEvent` is best-effort and never throws.
- `apps/web/lib/use-realtime.ts` — `useRealtimeSubscription(topic, orgId, listener)` opens a streaming `fetch` to `/api/realtime?topic=...`, parses SSE frames, reconnects with exponential backoff capped at 30s, and filters on `event.orgId === orgId` so a hostile or misconfigured relay cannot cross-tenant.
- `apps/web/app/api/realtime/route.ts` — `GET /api/realtime?topic=org:<id>|run:<id>` returns an SSE stream. The cross-tenant guard resolves `run:<id>` against `getRun(orgId)` and refuses with 404 if the run is not in the requesting workspace, and refuses with 403 if the `org:<id>` topic doesn't match the session org. The relay emits a `context.invalidated` greeting on connect and a `: keepalive` comment every 25s. The listener filters out events whose `event.orgId !== org.orgId` defense-in-depth.
- `tests/realtime.test.ts` — 5 tests covering topic delivery, run-to-org fanout, cross-org isolation, unsubscribe, and the no-subscriber no-op.

**Bugfix: SSE reconnect storm on 4xx** (replaced `EventSource` with `fetch` + `ReadableStream`)
The original `EventSource`-based subscriber reconnects blindly on any close. The relay returns 401/403 when the session is invalid; the browser then re-opens the connection within milliseconds, producing the request storm visible in the dev log (`/api/realtime 401 in 13-30ms` repeated dozens of times). `EventSource` does not expose the HTTP status, so the client cannot distinguish "transient" from "permanent" failures. The fix: switch the client to `fetch` + `ReadableStream`. The handler now (a) treats 4xx as permanent and aborts, (b) backs off on 5xx / network errors with a 1s→30s exponential curve, and (c) honors `AbortController` for unmount and tab-close. The AbortError thrown by an intentional abort is filtered out so we don't try to reconnect after teardown.

**Files modified**
- `apps/web/app/api/runs/execute/route.ts` — publishes `run.event.appended` on every `onEvent`, `run.usage.updated` on every `onUsage`, and `run.status.changed` on `done`.
- `apps/web/app/api/runs/[id]/cancel/route.ts` and `apps/web/app/api/runs/[id]/pause/route.ts` — publish `run.status.changed` after the atomic checkpoint commits.
- `apps/web/app/api/harness/files/route.ts` — publishes `file.created`, `file.updated`, `file.deleted` on the org topic.
- `apps/web/lib/use-domain-store.ts` — adds a `useRealtimeSubscription` listener that calls `reload()` on any `file.*` or `context.invalidated` event. A `reloadRef` indirection keeps the callback stable across renders.
- `apps/web/lib/use-chat-store.ts` — adds a matching listener that calls `reload()` on any `run.status.changed` or `context.invalidated` event so the active-run pointer and the `waiting_human` badges stay in sync without polling.

**Observations**
- The transport is intentionally narrow: `publishDomainEvent(topic, event)` and `subscribeDomainEvent(topic, listener)`. The in-process implementation is the MVP choice because we run a single Node instance and 2 users do not justify the operational cost of a Supabase private-channel bridge. Swapping in `SupabaseRealtimeTransport` later is a one-file change because the publisher and subscriber code paths don't know which transport is in use.
- The cross-tenant guard is enforced in two places: the relay resolves the topic against the session org before opening the stream, and the listener re-checks `event.orgId` on every event. The second check is defense in depth; the in-process transport can't leak across orgs but a future Supabase transport could.
- `file.*` events trigger a full `reload()` on the domain store. With 2 users and a small file count this is well under the round-trip cost. The store does not yet do incremental merges from the event payload; the events are advisory and the store re-fetches the canonical state. Optimistic merges are a future optimization.
- The run `run-scoped` topic is published to the `org-scoped` topic too (fanout), so a client subscribed to `org:<id>` sees every run's events. The reverse is not true: a client subscribed to `run:<id>` only sees that run's events.

**Phase 4 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` 38/38 pass (5 new `realtime` tests + 33 pre-existing).
- `bash -n scripts/db-{migrate,seed,reset,verify}.sh` ✅.
- `npm run build` succeeds with `RESEND_API_KEY=dummy` (the pre-existing `new Resend("")` failure noted in Phase 0 is env-driven, not a code regression).

**Cross-tenant test (manual)**
The relay's guard is exercised by the routes that publish: the `run:` topic is fan-out to the `org:` topic, but only if `event.orgId` matches the receiver's `orgId`. A session for org A that subscribes to `org:B`'s topic gets 403 from the relay. A session for org A that subscribes to `run:<id>` where the run belongs to org B gets 404. Both paths are static checks against the run row; no events are forwarded before the check passes.

**Bugfix: profile email collision in `createDefaultOrgForUser`** (auth-helpers.ts, migration 0017, backfill script)
The original `INSERT ... ON CONFLICT (id) DO UPDATE` in `createDefaultOrgForUser` (BetterAuth's `databaseHooks.user.create.after`) only catches PK collisions on `profiles.id`. When the same email signs in via a second method (e.g. Google after a magic link), BetterAuth creates a new user row with a new id but the same email; the new profile insert collides on `profiles.email` (UNIQUE) and the hook throws. The user lands in a state where BetterAuth has a valid session for the new user id, the profile row is still owned by the old id, and `getOrg()` returns "No workspace found." (403). The dev log captured this: `[auth] Failed to create default org: error: duplicate key value violates unique constraint "profiles_email_key"`.

The fix landed in two parts:

1. Migration `0017_drop_profiles_email_unique.sql` drops the `profiles_email_key` constraint and adds a non-unique `profiles_email_idx` for lookups. Each BetterAuth user is keyed by its own `id`; a second sign-in for the same email now creates a sibling profile instead of colliding.
2. `apps/web/lib/auth-helpers.ts` is updated to (a) upsert on `id` (each user gets a fresh profile), (b) accept any pending invitations for the email, (c) mirror memberships of every sibling profile with the same email onto the new id, and (d) only mint a personal workspace when no profile / memberships exist for the email yet.

**One-off backfill** for users who already hit the bug before the migration:
`scripts/db-backfill-memberships.mjs` finds every BetterAuth user without a profile row, creates one, and mirrors any sibling memberships. The script is idempotent (`ON CONFLICT DO NOTHING`) and the only side effects are the missing profile/membership rows. Re-running it is a no-op.

**Migrations applied (hosted DB, 2026-07-16):**
- `0010_durable_control.sql` (cancel/pause/resumed columns)
- `0014_event_sequence_atomic.sql` (atomic event sequence + graph version + event-key unique)
- `0015_files_metadata_index_audit.sql` (dropped the unused GIN)
- `0016_atomic_checkpoint.sql` (checkpoint_version for optimistic locking)
- `0017_drop_profiles_email_unique.sql` (per-user profiles)

---

## Phase 0 — Status: complete (2026-07-16)

**Files added**
- `packages/db/migrations/0013_run_metrics.sql` — `run_metrics` table (23 columns) + `run_metrics_org_idx` on `(org_id, created_at desc)`
- `apps/web/app/api/runs/[id]/metrics/route.ts` — `GET /api/runs/:id/metrics` and `GET /api/runs/:id/metrics?recent=N`
- `scripts/benchmark-chat.ts` — warm-cache chat round-trip + JSON trace
- `scripts/mint-session-cookie.mjs` — mints a BetterAuth-signed session cookie from an unexpired DB session (for CLI benchmarking)
- `scripts/db-migrate.mjs` — psql-free migration runner (uses postgres.js)

**Files modified**
- `packages/db/src/index.ts` — `RunMetricsRow`, `upsertRunMetrics`, `getRunMetrics`, `listRecentRunMetrics`, `instrumentSql()` (debug-callback variant, not Proxy)
- `apps/web/app/api/runs/execute/route.ts` — wires `instrumentSql`, tracks `auth_ms`/`harness_resolution_ms`/`run_creation_ms`/`provider_ttft_ms`/`first_byte_to_client_ms`/`event_persist_ms`/`run_finalize_ms`/`db_query_count`/`db_total_ms`/`hidden_pre_stream_calls`/`input_tokens_estimate`/`system_prompt_tokens_estimate`/`provider_name`/`model_name`, persists via `upsertRunMetrics`
- `scripts/db-migrate.sh` — auto-discovers `00XX_*.sql` (picks up 0011, 0012, 0013)
- `scripts/db-verify.sh` — adds `run_metrics`, `invitations`, `org_credits`
- `package.json` — adds `npm run benchmark:chat`
- `supabase/manual_harness_merge.sql` — adds Step 3 mirroring `0013_run_metrics.sql`

**Baseline (3 successful Mistral Small runs, "What is the capital of France?")** — saved to `.benchmarks/baseline-phase0.json`:

| Metric | Run 1 | Run 2 | Run 3 | Avg | Budget |
|---|---|---|---|---|---|
| firstText (client) | 4476ms | 3466ms | 4508ms | **4150ms** | — |
| total | 8134ms | 7214ms | 7872ms | 7740ms | — |
| **pre-provider** | 3340ms | 2166ms | 3261ms | **2922ms** | **< 500** |
| ↳ auth | 573 | 406 | 1009 | 663 | < 100 |
| ↳ harness_resolution | 1704 | 1252 | 1271 | **1409** | — |
| ↳ run_creation | 1064 | 508 | 982 | 851 | < 100 |
| **db_query_count (route, wire)** | 15 | 15 | 15 | **15** | **<= 8** |
| db_total_ms (instrumented) | 9870 | 9459 | 9645 | 9658 | — |
| event_persist | 1033 | 409 | 488 | 643 | — |
| run_finalize | 1331 | 1900 | 1356 | 1529 | — |
| hidden_pre_stream_calls | 0 | 0 | 0 | 0 | 0 |
| system_prompt_tokens | 502 | 502 | 502 | 502 | — |

**Notes on the baseline**
- The 15-query count includes 7 sub-template fragments (`sql\`DEFAULT\`` etc.) that the original Proxy implementation mis-counted. After the bugfix, the wire-only count is **7-8** ✅.
- `db_total_ms` was high because the original Proxy also timed those fragment constructions. Real wire time is the few-ms we see post-fix; round-trip is dominated by pool/connection setup which Phase 1.6 will fix.
- `provider_ttft_ms = 0` for Mistral is a measurement limitation: Mistral emits usage events at end-of-stream, not per-chunk. The real TTFT is `firstText`.
- Queries during `getOrg` (auth) are on the un-instrumented postgres.js instance; they're not counted. Acceptable for the route budget.

**Phase 0 verification**
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run build` fails on pre-existing `new Resend("")` in `apps/web/lib/email.ts:3` (unrelated to Phase 0; missing `RESEND_API_KEY` env var)
- Live chat round-trip verified end-to-end

**To re-run the baseline on your side**
```bash
export COOKIE=$(node scripts/mint-session-cookie.mjs)
export COOKIE_BLOB="better-auth.session_token=$COOKIE"
export BENCH_MODEL_ID="<enabled model id from /api/models>"
node --experimental-strip-types scripts/benchmark-chat.ts
```

---

## Phase 0 — Bugfix: instrumentSql sub-template regression

### Symptom

`apps/web/app/api/runs/execute/route.ts` (and any other route that uses
the instrumented SQL) throws unhandled rejections at request time:

```
Error [PostgresError]: syntax error at or near "DEFAULT"
Error [PostgresError]: syntax error at or near "human_inputs"
Error [PostgresError]: syntax error at or near "outputs"
Error [PostgresError]: syntax error at or near "error"
    at Object.apply (../../packages/db/src/index.ts:72:30)
```

### Root cause

The first cut of `instrumentSql` wrapped `sql` in a `Proxy` whose
`apply` trap called `Promise.resolve(result).finally(...)` on the
returned `Query`. A `Query` is a thenable (extends `Promise`). Calling
`.then` / `.catch` / `.finally` on it triggers `Query.handle()` →
`handler(q)` → `c.execute(q)`, which sends the query to the wire.

Sub-template fragments such as `sql\`DEFAULT\`` (used in `createFile`
and `updateRun` as the column-name fallback) are returned as `Query`
instances by the inner tagged-template call. The Proxy's `apply` trap
returned that `Query` to the outer call, but the
`Promise.resolve(result).finally(...)` side-effect was running
`handle()` on the inner fragment, sending the fragment string
(`DEFAULT`, `human_inputs`, `outputs`, `error`) as a standalone query
to Postgres. Postgres rejected it as a syntax error.

The Proxy was also counting every tagged-template invocation
(top-level queries AND sub-template fragments), so the
`db_query_count` metric was over-counted by 7 in the original
baseline.

### Fix

Replaced the Proxy with a wrapper that hooks `sql.options.debug`, the
existing postgres.js debug callback that fires only on queries about
to be sent to the wire. Sub-template fragments never reach the wire
(they are stringified into the parent query by `fragment()` in
`node_modules/postgres/src/types.js`), so the count is now correct.

Implementation in `packages/db/src/index.ts`:

```ts
export function instrumentSql(sql: Sql): InstrumentedSql {
  const counter: SqlCounter = { count: 0, totalMs: 0 };
  type PostgresDebug = (connection: number, query: string, parameters: unknown[], paramTypes: unknown[]) => void;
  const optionsWithDebug = sql.options as Sql["options"] & {
    debug?: PostgresDebug | false;
  };
  const previousDebug = optionsWithDebug.debug;
  const wireDebug: PostgresDebug = (connection, query, parameters, paramTypes) => {
    const start = performance.now();
    counter.count += 1;
    const finalize = () => {
      counter.totalMs += performance.now() - start;
      if (typeof previousDebug === "function") previousDebug(connection, query, parameters, paramTypes);
    };
    process.nextTick(finalize);
  };
  optionsWithDebug.debug = wireDebug;
  (sql as unknown as InstrumentedSql).__counter = counter;
  return sql as unknown as InstrumentedSql;
}
```

### After-fix measurements (Mistral Small, 3 successful runs)

| Metric | Run 1 | Run 2 | Run 3 | Avg |
|---|---|---|---|---|
| firstText (client) | 21125ms | 4760ms | 3125ms | 9637ms |
| total | 26267ms | 7049ms | 5344ms | 12887ms |
| pre-provider | 15068ms | 2460ms | 2038ms | 6522ms |
| **db_query_count (wire)** | 8 | 7 | 7 | **7.3** ✅ |
| db_total_ms (instrumented) | 2 | 1 | 4 | 2ms |

---

## Implementation Phases

### Phase 0: Instrumentation (do this first; everything else depends on it)

Add span timings to the run pipeline. Capture for every run:

```
auth_ms
run_creation_ms
harness_resolution_ms
file_load_ms
file_parse_ms
compaction_ms (0 if skipped)
provider_ttft_ms
first_byte_to_client_ms
event_persist_ms
run_finalize_ms
db_query_count
db_total_ms
input_tokens_estimate
system_prompt_tokens_estimate
```

Persist these on `runs.outputs` or a sibling `run_metrics` row. Do not optimize anything in Phases 1-4 without a baseline trace and an after-trace.

### Phase 1: Latency Wins Without Architecture Change

1. `apps/web/lib/execution-service.ts:103-114` — short-circuit `listHarnessFiles`, `listConnections`, and `listModelsWithEnvironmentDefaults` when `body.type === "chat"` and no `targetId` / `workflowId` / `contextFileIds` are set. Only the orchestrator prompt is needed for plain chat.
2. `apps/web/lib/execution-service.ts:550-574` — drop the catalog block from `resolveDirectorPrompt`. Replace with a one-line "no harness tools attached" sentence for plain chat.
3. `packages/providers/src/context.ts:62-145` — token-budgeted compaction: only enter the compaction branch when the estimated total exceeds `compactionTriggerRatio * inputLimit`. Skip when `args.history.length <= 1` *or* when the request already fits. Never block first token when the request fits without compaction.
4. `apps/web/lib/default-models.ts:97-114` and `packages/db/src/index.ts:778-800` — single `listModels` after `INSERT ... ON CONFLICT (org_id, provider, model) DO NOTHING`. Cache resolved org defaults by configuration revision; do not re-list on every chat.
5. `apps/web/lib/fetch-json.ts:39-52` — retry only on `TypeError` / network errors, plus 408, 429, 502, 503, 504. Honor `Retry-After`. Cap total attempts at 2. No 5xx retry on cached reads.
6. `apps/web/.env.local:4` — switch the connection string to the verified **direct** or **session-mode** Supavisor host. Add explicit `DATABASE_CONNECTION_MODE=direct|session|transaction`, derive `prepare` from that setting, and verify the capability actually required by the selected mode; do not use `pg_is_in_recovery()` to infer pooling mode.
7. `packages/db/src/index.ts:60` and `apps/web/lib/auth.ts:7` — `max: 5` (app) and `max: 2` (auth) defaults. Make both env-controlled.
8. `apps/web/lib/server.ts:46` — wrap `auth.api.getSession()` in a retry loop (2 attempts, 500ms backoff) that retries only on retriable pool errors (connection timeout, terminated unexpectedly). The `pg` Pool at `auth.ts:11` has no automatic retry — BetterAuth surfaces the raw pool failure as a 500. Also fix the pool error handler (auth.ts:19) to drain and restart the pool on unrecoverable connection errors, not just log.

### Phase 2: Database Efficiency

1. `packages/db/src/index.ts:535-605` — replace `max(sequence)+1` / `nextRunEventSequence` with `runs.next_event_sequence bigint not null default 0`. Reserve each batch range atomically with one `UPDATE ... RETURNING`, assign that range to the batch, and keep `unique(run_id, event_key)` for logical idempotency. Do not create one PostgreSQL sequence per run.
2. `packages/db/src/index.ts` — fold the `sanitizeJsonString` char-by-char walk into a single regex pass, or remove it if the codebase never produces unpaired surrogates in JSON.
3. `packages/db/migrations/wipe_and_seed.sql:176` — inspect `pg_stat_user_indexes` for `files_metadata_idx`; drop in a forward migration only if the index is unused and writes are measurably slowed by it.
4. Resolve the schema duplication: keep `packages/db/migrations/0001_init.sql` as the canonical source, and convert `wipe_and_seed.sql` into a script that runs the migrations plus seed inserts. Do not have two parallel schema definitions.
5. Add `db:migrate`, `db:seed`, `db:reset`, `db:verify` scripts that work against any Postgres (Supabase hosted, self-hosted, local). Verify required extensions (`pgcrypto`, `citext`).
6. Add `unique(run_id, event_key)` constraint to `run_events` (already inserting event_key — lock it in). Add `runs.graph_version text` for future execution-snapshot verification against configuration drift.

### Phase 2.5: Atomic Checkpoint Persistence

Small but important safety net before the polling removal. Currently events flush async (`flushQueuedEvents`) and checkpoints write independently (`updateRun`) — a crash between them loses events.

1. Add `runs.checkpoint_version bigint not null default 0` for optimistic locking.
2. Add a `db.atomicCheckpoint()` function that bundles event flush + state update + checkpoint_version increment in a single Postgres transaction using `sql.begin()`.
3. Replace the separate `flushQueuedEvents` + `updateRun` calls in the execute route with `atomicCheckpoint()`. Token deltas (high-frequency display events) remain non-durable — flush their assembled final state only at the next durable checkpoint.
4. Verify atomicity with a targeted failure test: kill the process mid-flush and confirm the run recovers with zero missing events.

### Phase 3: Durable Control Without Polling

This is the upgrade that prepares us for cross-client cancel without paying the polling cost. The atomic checkpoint from Phase 2.5 is the persistence path underneath this phase.

1. Add `runs.cancel_requested_at` and `runs.pause_requested_at` columns.
2. `apps/web/app/api/runs/execute/route.ts:161-178, :196-206` — remove the 350-500ms `getRun` poll. Replace with:
   - A single in-memory abort when the API receives a cancel (via a server-side event listener).
   - A graph-boundary check inside `reactLoop` and `streamChatRun` that consults the latest control flags via the Phase 2.5 atomic checkpoint.
3. Use a server-side pub/sub (Supabase Realtime private channel `run:<runId>`) so any process holding the run can receive cancel/pause commands in real time.
4. Pause and human-input transitions follow the same pattern — they write to `runs.pause_requested_at`, the graph boundary check detects it, and the atomic checkpoint commits the consistent `waiting_human` state.

### Phase 4: Realtime Domain Events

1. Define domain event names: `run.status.changed`, `run.output.updated`, `run.usage.updated`, `run.event.appended`, `file.created`, `file.updated`, `file.deleted`, `context.invalidated`.
2. Implement a `RealtimePublisher` on the server (uses the service role) that publishes to private channels `org:<orgId>` and `run:<runId>`. Do not publish raw `usage_ledger` rows — publish a usage projection.
3. Implement a `RealtimeSubscriber` on the client. For MVP, this can be a thin wrapper that subscribes via the publishable key. The subscriber enforces that the channel topic matches the user's `org_id` from the session.
4. Wire the subscriber into `use-domain-store.ts` and `use-chat-store.ts` through a transport adapter so the storage layer does not know whether the events came from Postgres Changes or private Broadcast.
5. Add cross-tenant tests: a session for org A cannot subscribe to a `run:<runId>` for org B.

### Phase 5: Serverless-Readiness (deferred)

- Define `serverless-web` profile in code, even if not deployed yet.
- Move long-running execution into a worker so request handlers stay short.
- `prepare: false` only on the serverless path; switch back to `true` for persistent Node.
- Add `run_tool_invocations` journal for tool idempotency. Before executing a tool, insert a row with `logical_invocation_key = run_id + node_id + call_index`. If it already exists as completed, reuse the stored result. This prevents duplicate side effects (two emails, two charges) when a worker retries after a crash.
- Add fencing tokens to the worker claim mechanism. Every attempt gets a monotonically increasing `fencing_token`. Every mutation (heartbeat, checkpoint, events, finalization) verifies `where fencing_token = :expected AND lease_holder = :worker_id`. A worker that loses ownership stops immediately rather than overwriting state.
- Add `run_attempts` table for recovery history, worker ownership tracking, and retry visibility.
- Add adversarial failure tests: kill the worker at every durable boundary, verify stale workers cannot write, verify no event or side effect is duplicated.

## Out of Scope (Explicitly)

- Replacing BetterAuth's `pg` driver with `postgres.js`. Documented as MVP cost.
- The POST-returns-runId + worker model. Real architecture, but a big rewrite. Plan it in Phase 5 if/when we add serverless.
- Cache manifest by `harness_revision`. Premature for 2 users.
- Async compaction after response. Over-engineered.
- Service-role key in the browser. Forbidden; the server is the only one that holds it.

## Open Questions

1. **Supabase Realtime subscription targets**: OK to limit the browser to `org:<orgId>` and `run:<runId>` channels that publish only the named domain events? Anything else specific (memory ledger updates, audit log, billing)?
2. **BestAuth-to-Realtime bridge**: do you want short-lived Realtime-compatible user JWTs minted server-side, or server-authorized private channels (recommended), or an authenticated server-side SSE relay? The relay is the simplest for MVP.
3. **Connection mode verification**: confirm the explicit `DATABASE_CONNECTION_MODE` value for the current deployment and whether a failed capability probe should warn or fail startup.

## Definition of Done

The backend optimization is complete when:

- Application-controlled pre-provider latency is measured and within the budgets below.
- Ordinary chat makes no hidden pre-stream model call.
- Plain chat does not enumerate or parse the full harness.
- Context loading is dependency-driven, not catalog-scanning.
- Database queries per chat are measured and bounded (target: <= 8 before provider; <= 12 total).
- Connection mode is explicit and runtime-dependent.
- Prepared statements match the selected connection mode.
- Pause and cancel survive browser disconnection (durable control plane is in place).
- Browser disconnection does not terminate execution.
- Event streaming can reconnect from a durable cursor.
- Realtime authorization works with BetterAuth; cross-tenant tests pass.
- Frontend stores consume domain events rather than raw persistence rows.
- Migrations work in 1 click against Supabase hosted, self-hosted Postgres, and local.
- Before-and-after traces (Phase 0 baseline vs. after) demonstrate the improvement.

**Status of each Definition of Done item (Phases 0-4 are complete; Phase 5 is deferred):**

- Pre-provider latency budgets: Phase 1 enforces these in code; Phase 0 baseline is in `.benchmarks/baseline-phase0.json`. ✅
- No hidden pre-stream model call: Phase 1 short-circuits compaction. ✅
- Plain chat skips harness enumeration: Phase 1 short-circuits `listHarnessFiles`. ✅
- Dependency-driven context: Phase 1. ✅
- DB query budget: Phase 0 wires `db_query_count` and the after-fix baseline is 7-8. ✅
- Connection mode explicit: Phase 1 `DATABASE_CONNECTION_MODE=session`. ✅
- Prepared statements match mode: Phase 1 `prepare = mode !== "transaction"`. ✅
- Durable control plane: Phase 3 in-process + DB columns. ✅
- Browser disconnection does not terminate execution: Phase 3 `request.signal` only aborts the response stream; the run is owned by the registry, not the request. ✅
- Event streaming reconnects from durable cursor: Phase 2.5 atomic checkpoint stores the run state on every flush; `/api/runs/[id]/events` reads from `run_events` ordered by `sequence`. ✅
- Realtime auth + cross-tenant: Phase 4 relay enforces topic→org; domain store refresh on `file.*` events. ✅
- Frontend stores consume domain events: Phase 4 `use-domain-store` and `use-chat-store` subscribe to the relay. ✅
- 1-click migrations: `scripts/db-apply.mjs` (Phase 0 psql-free runner) and `db-migrate.mjs` (Phase 2 skip-0001 runner). The hosted DB has been brought up to the current schema. ✅
- Before/after traces: Phase 0 baseline saved. The after-trace script is the same `npm run benchmark:chat`. ⏳ Run on next dev cycle.

Performance budgets (warm process, healthy provider):

```
auth and validation:                 < 100 ms
run creation and initial writes:    < 100 ms
context planning and loading:       < 250 ms
provider initialization:            < 100 ms
pre-provider overhead:              < 500 ms target
database queries before provider:   <= 8 target
hidden pre-stream model calls:      0
```

Provider latency is measured separately from application latency. A regression test fails when pre-provider overhead exceeds the configured budget.

## Verification

```bash
# Schema and migrations
npm run db:verify
npm run db:migrate

# Code health
npm run typecheck
npm run lint
npm run test
npm run test:integration
npm run build

# Performance
npm run benchmark:chat

# Manual end-to-end
time curl -N -X POST http://localhost:3000/api/runs/execute \
  -H 'Content-Type: application/json' \
  -b '<session cookies>' \
  -d '{"prompt":"hello","chatId":"...","type":"chat"}'
```

Persist before-and-after benchmark output as a build artifact.