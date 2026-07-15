# Backend Optimization Plan

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
6. `apps/web/.env.local:4` — switch the connection string to port 5432 with the **direct** or **session-mode** Supavisor host. Verify with a one-line `select pg_is_in_recovery();` probe that prepared statements work. Set `prepare: true` in `packages/db/src/index.ts:62` once verified.
7. `packages/db/src/index.ts:60` and `apps/web/lib/auth.ts:7` — `max: 5` (app) and `max: 2` (auth) defaults. Make both env-controlled.

### Phase 2: Database Efficiency

1. `packages/db/src/index.ts:535-605` — replace `nextRunEventSequence` + bulk insert with one of:
   - A Postgres `sequence` per run (allocated at `createRun` time), or
   - `id bigint generated always as identity` with `unique(run_id, event_key)` and a `row_number()` over the inserted batch for `sequence`.
   The replay cursor becomes the global event `id`; clients request `events?after=<eventId>`.
2. `packages/db/src/index.ts` — fold the `sanitizeJsonString` char-by-char walk into a single regex pass, or remove it if the codebase never produces unpaired surrogates in JSON.
3. `packages/db/migrations/wipe_and_seed.sql:176` — inspect `pg_stat_user_indexes` for `files_metadata_idx`; drop in a forward migration only if the index is unused and writes are measurably slowed by it.
4. Resolve the schema duplication: keep `packages/db/migrations/0001_init.sql` as the canonical source, and convert `wipe_and_seed.sql` into a script that runs the migrations plus seed inserts. Do not have two parallel schema definitions.
5. Add `db:migrate`, `db:seed`, `db:reset`, `db:verify` scripts that work against any Postgres (Supabase hosted, self-hosted, local). Verify required extensions (`pgcrypto`, `citext`).

### Phase 3: Durable Control Without Polling

This is the upgrade that prepares us for cross-client cancel without paying the polling cost.

1. Add `runs.cancel_requested_at` and `runs.pause_requested_at` columns.
2. `apps/web/app/api/runs/execute/route.ts:161-178, :196-206` — remove the 350-500ms `getRun` poll. Replace with:
   - A single in-memory abort when the API receives a cancel (via a server-side event listener).
   - A graph-boundary check inside `reactLoop` and `streamChatRun` that consults the latest control flags.
3. Use a server-side pub/sub (Supabase Realtime private channel `run:<runId>`) so any process holding the run can receive cancel/pause commands in real time.
4. Pause and human-input transitions follow the same pattern.

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

## Out of Scope (Explicitly)

- Replacing BetterAuth's `pg` driver with `postgres.js`. Documented as MVP cost.
- The POST-returns-runId + worker model. Real architecture, but a big rewrite. Plan it in Phase 5 if/when we add serverless.
- Cache manifest by `harness_revision`. Premature for 2 users.
- Async compaction after response. Over-engineered.
- Service-role key in the browser. Forbidden; the server is the only one that holds it.

## Open Questions

1. **Supabase Realtime subscription targets**: OK to limit the browser to `org:<orgId>` and `run:<runId>` channels that publish only the named domain events? Anything else specific (memory ledger updates, audit log, billing)?
2. **BestAuth-to-Realtime bridge**: do you want short-lived Realtime-compatible user JWTs minted server-side, or server-authorized private channels (recommended), or an authenticated server-side SSE relay? The relay is the simplest for MVP.
3. **Connection mode verification**: do you want me to add a one-time probe (a `select pg_is_in_recovery();` + `prepare: true` round trip) at boot that asserts the configured mode, so a misconfigured `DATABASE_URL` fails loudly?

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
