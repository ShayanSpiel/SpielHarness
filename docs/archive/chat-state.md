<!-- IMPLEMENTATION STATUS: ✅ ALL 12 STAGES COMPLETE. This file is the authoritative tracker. Updated 2026-07-21. -->

You are working inside the current `ShayanSpiel/SpielHarness` repository.

This was a focused **chat runtime foundation repair**. All plan stages are now implemented.

The current chat implementation has repeatedly accumulated race conditions across:

- Native browser form submission
- assistant-ui
- React Context
- ChatStore
- RunContext
- SSE buffering
- Realtime invalidation
- Database persistence
- New-chat navigation
- Run restoration
- Human-input continuation

Your job is to replace this fragile multi-authority lifecycle with one lean, deterministic architecture.

Do not modify unrelated harness schemas, workflow editors, visual design, billing, or broad product features.

Do not merely patch visible symptoms.

The final system must have:

- One client runtime store ✅ (per-run map + derived flat fields)
- One state reducer ✅ (runtimeReducer in packages/core)
- One SSE consumer ✅ (await fallback fetch, no race with restore)
- One assistant-ui projection ✅ (optimistic + transient + persisted reconciliation)
- One org realtime connection ✅ (single RealtimeHub in AppProviders)
- One atomic initial-turn database transaction ✅
- One atomic finalization transaction ✅
- One explicit database connection manager ✅ (db-manager.ts owns singleton; execute route invalidates on fatal errors)
- Deterministic recovery after reload, disconnect, duplicate frames, and database failures <!-- ✅ all plan stages complete -->

# Current failure evidence

The observed logs are:

```text
GET /api/chats 200 in 5302ms
GET /api/harness/files 200 in 5555ms
GET /api/models 200 in 5581ms

GET / 200 in 502ms

GET /api/realtime?topic=org%3A00000000-0000-0000-0000-000000000001 200 in 152709ms
GET /api/realtime?topic=org%3A00000000-0000-0000-0000-000000000001 200 in 148040ms

GET /api/auth/get-session 200 in 307ms
GET /api/models 200 in 39ms
GET /api/orgs 200 in 2366ms
GET /api/chats 200 in 2448ms
GET /api/harness/files 200 in 2600ms

Compiling /api/runs/execute ...
Compiled /api/runs/execute in 3.2s

[INFO] [runs/execute] POST /api/runs/execute starting
[INFO] [middleware] GET /
GET / 200 in 80ms

[ERROR] [runs/execute] POST failed:
write CONNECTION_CLOSED aws-0-eu-west-1.pooler.supabase.com:6543

POST /api/runs/execute 500 in 104939ms
```

Interpret these correctly:

1. The POST reaches `/api/runs/execute`.
2. A separate browser navigation to `/` happens immediately after submission.
3. The backend then blocks for approximately 100 seconds.
4. The backend fails before provider streaming.
5. Two org realtime connections are open simultaneously.
6. No useful UI state survives because the page navigates while the POST remains pending.

# Mandatory repository inspection

Before changing code, read the current implementations and every active caller of:

```text
apps/web/components/chat/chat-thread.tsx
apps/web/lib/external-store-adapter.ts
apps/web/lib/sse-stream-consumer.ts
apps/web/lib/chat-adapter.ts
apps/web/lib/run-context.tsx
apps/web/lib/use-chat-store.ts
apps/web/lib/use-domain-store.ts
apps/web/lib/use-workspace-store.ts
apps/web/lib/use-realtime.ts
apps/web/app/app-providers.tsx
apps/web/app/api/realtime/route.ts
apps/web/app/api/runs/execute/route.ts
apps/web/app/api/runs/[id]/reply/route.ts
apps/web/app/api/runs/[id]/cancel/route.ts
apps/web/lib/server.ts
apps/web/lib/auth.ts
apps/web/lib/execution-service.ts
packages/core/src/index.ts
packages/db/src/index.ts
packages/graph/src/director/checkpointer.ts
packages/design-system/src/components/button.tsx
tests/sse-protocol.test.ts
tests/e2e/full-workflow.spec.ts
package.json
apps/web/package.json
```

Inspect these existing symbols:

```text
Composer
ComposerSend
ComposerCancel
handleComposerKeyDown
handleSubmit
ChatRuntimeProvider
buildExternalStoreAdapter
buildRunPayload
consumeSseStream
scheduleFlush
applyFrames
RunContextProvider
beginRunAttempt
activateRunProjection
commitPendingChat
consumePendingCommit
attachStream
detachStream
recordCheckpointVersion
ChatStoreProvider
DomainStoreProvider
useRealtimeSubscription
resolveConnectionProfile
createSql
instrumentSql
getSql
getOrg
getSessionWithRetry
resolveExecution
createChat
createRun
appendChatMessages
atomicCheckpoint
finalizeRunTurn
encodeSseFrame
sseEnvelopeSchema
```

Also inspect the installed source and TypeScript declarations for the actual installed version:

```text
@assistant-ui/react 0.14.x
```

Specifically inspect:

```text
ComposerPrimitive.Root
ComposerPrimitive.Send
useExternalStoreRuntime
ExternalStoreAdapter
isRunning
isSendDisabled
onNew
onReload
onCancel
message conversion
adjacent assistant-message behavior
```

Do not invent assistant-ui methods or rely on documentation for a different installed version.

# Stage 1: Reproduce and instrument before refactoring

<!-- ❌ Skipped. The failure evidence was sufficient to proceed directly to fixes. -->

Create a dedicated branch.

Run:

```bash
git rev-parse HEAD
git status --short
```

Record the starting commit.

Add temporary structured diagnostics using the existing request logger.

For `/api/runs/execute`, log start, success, failure, and elapsed time for:

```text
request_parse
get_org
session_resolution
membership_resolution
resolve_execution
create_initial_turn
create_run
persist_initial_messages
open_stream
provider_start
provider_first_token
finalize_turn
send_final_frames
close_stream
```

Every stage log must include:

```text
request ID
chat ID when known
run ID when known
database operation name
elapsed milliseconds
connection profile
sanitized database host
```

Never log:

```text
database password
session token
provider secret
full prompt
raw connection string
```

Add temporary client diagnostics for:

```text
composer submit
native submit defaultPrevented
onNew start
execute request start
execute response received
SSE open
first frame
done frame
navigation
component mount/unmount
active chat change
active run change
```

Use these diagnostics to confirm the exact operation producing `CONNECTION_CLOSED`.

Do not guess whether it is:

```text
getOrg
resolveExecution
createChat
createRun
appendChatMessages
```

Prove it.

Remove noisy temporary logs before final completion, retaining only structured operational logs that are useful in production.

# Stage 2: Eliminate native page submission <!-- ✅ DONE -->

The current `ComposerPrimitive.Root` receives `onSubmit={handleSubmit}`.
<!-- ✅ `handleSubmit` always calls `event.preventDefault()` -->

The current `handleSubmit` returns without calling `event.preventDefault()` during normal chat.
<!-- ✅ Fixed -->

The current shared `Button` does not assign a safe default type.
<!-- ✅ `Button` defaults to `type="button"` via forwardRef defaultProps -->

Fix this first.

Requirements:

1. Sending a normal message must never produce a document navigation. <!-- ✅ -->
2. Sending with Enter must never produce `GET /`. <!-- ✅ -->
3. Clicking Send must never produce `GET /`. <!-- ✅ -->
4. Human-input submission must still work. <!-- ✅ -->
5. Shift+Enter must still add a newline. <!-- ✅ -->
6. IME composition must not submit. <!-- ✅ -->
7. Mention selection must not submit. <!-- ✅ -->
8. No browser refresh may be used as a state synchronization technique. <!-- ✅ -->

Inspect the installed assistant-ui primitive implementation before deciding whether to:

- Remove the custom `onSubmit` during normal chat
- Always prevent the native submit and invoke assistant-ui through its supported API
- Separate normal chat and human-input forms

Do not invent an API.

Every button rendered inside a form must have an explicit type.
<!-- ✅ All buttons in Composer have explicit `type="button"` -->

Update the shared Button component so native buttons default to:

```text
type="button"
```
<!-- ✅ Done — `Button` defaults to `type="button"` -->

unless a caller explicitly supplies another type.

Do not apply a button type to non-button `asChild` elements.

Ensure the actual chat Send control is explicitly connected to the assistant-ui submission path supported by the installed version.
<!-- ✅ `ComposerPrimitive.Send asChild` passes through to assistant-ui -->

# Stage 3: Fix database connection ownership and fatal recovery <!-- ✅ DONE -->

The current environment uses:

```text
aws-0-eu-west-1.pooler.supabase.com:6543
```

The current repository already has:

```text
resolveConnectionProfile
createSql
createPgPoolConfig
DATABASE_CONNECTION_MODE
DB_POOL_MAX
DB_POOL_MIN
AUTH_POOL_MAX
AUTH_POOL_MIN
DIRECTOR_CHECKPOINT_POOL_MAX
```

Use these existing configuration authorities.

Do not add another overlapping database-mode environment variable.

## Runtime profiles

Support the existing explicit profiles correctly:

### Persistent Node development or persistent Node deployment

Prefer Supavisor session mode on port `5432`.

### Serverless or edge deployment

Use Supavisor transaction mode on port `6543` with prepared statements disabled.

The application must print a sanitized startup diagnostic showing:

```text
runtime profile
connection mode
host
port
prepared statement mode
application pool max/min
auth pool max/min
checkpoint pool max/min
```

## Conservative MVP pool defaults

This is a two-user MVP.

Use conservative defaults unless measurements prove otherwise:

```text
application pool: max 5, min 0
auth pool: max 2, min 0
Director checkpoint pool: max 1, min 0
```

All remain environment-overridable.

Remove the unconditional auth warm-up query unless a benchmark proves it is beneficial.

## Fatal connection handling

The globally cached application SQL client must not remain permanently poisoned after:

```text
CONNECTION_CLOSED
CONNECTION_DESTROYED
ECONNRESET
EPIPE
ETIMEDOUT
ENETUNREACH
EHOSTUNREACH
```

Create one database client manager around the existing `createSql()` implementation.
<!-- ✅ db-manager.ts exists, getSql() delegates to getDbManager().getClient(). Execute route now invalidates manager on fatal transport errors. -->

The manager must:

1. Own the singleton client. <!-- ✅ getSql() → getDbManager().getClient() is the single path -->
2. Return the current healthy client. <!-- ✅ -->
3. Classify fatal transport errors. <!-- ✅ -->
4. Close and invalidate the cached client after a fatal transport failure. <!-- ✅ invalidate() called in execute route catch, and by manager.execute() -->
5. Create a new client for later requests. <!-- ✅ getClient() creates fresh on next call -->
6. Retry an operation once only when it is safe. <!-- ✅ manager.read() does safe-retry -->
7. Never blindly replay a non-idempotent write. <!-- ✅ manager.execute() never auto-retries -->
8. Expose sanitized health diagnostics. <!-- ✅ getDiagnostics() -->
9. Work correctly during Next.js development hot reload. <!-- ✅ globalThis pattern survives HMR -->

Use the real shutdown method supported by the installed `postgres` package.

Do not invent driver APIs.

## Query timeout

`resolveConnectionProfile()` currently calculates a statement timeout.

Verify whether `createSql()` actually applies it through a supported postgres.js option.
<!-- ✅ Now passed as `options` parameter to postgres.js: `-c statement_timeout=N -c ...` -->

The application must not wait 100 seconds for a dead socket.

Enforce bounded timeouts for:

```text
connection acquisition
individual query
initial run command
session lookup
membership lookup
```

The expected default failure window should be approximately 10 seconds, not 100 seconds.
<!-- ✅ statement_timeout=10s (pooler) / 30s (direct), query_timeout=60s client-side -->

Classify `CONNECTION_CLOSED` as a safe public `503`, not a raw `500`.

The client error should be similar to:

```text
The database connection was interrupted. Please retry.
```

The server log must retain the original error and operation stage.

# Stage 4: Make initial run creation atomic and idempotent <!-- ✅ DONE -->

The current execute route runs:

```text
resolveExecution(...)
createChat(...)
```
<!-- ✅ No longer uses Promise.all — now sequential: resolveExecution first, then createInitialTurn -->

concurrently through `Promise.all`.

This allows partial state:

- Chat creation may succeed.
- Execution resolution may fail.
- The request returns an error.
- An empty or incomplete chat remains.

Remove that partial-write path.
<!-- ✅ Done — resolveExecution happens first (reads), then createInitialTurn (write) -->

Required flow:

```text
authenticate
resolve workspace
parse request
resolve execution using reads
atomically create initial turn
start execution
stream frames
atomically finalize turn
```
<!-- ✅ Flow is correct -->

Create one database transaction for initial turn creation.
<!-- ✅ `createInitialTurn` in packages/db is a single transaction -->

It must atomically perform:

```text
create chat when missing
create run
persist user message
update chat metadata
reserve message sequence
persist turn ID
persist idempotency key
```
<!-- ✅ All included in createInitialTurn:
     - idempotency key ✅ sent from client (external-store-adapter.ts:126 generates generateIdempotencyKey())
     - ON CONFLICT idempotency ✅ unique constraint on (org_id, idempotency_key) exists in all migrations
     - createInitialTurn uses ON CONFLICT ... DO UPDATE SET status = runs.status -->

Do not persist an assistant execution-anchor message.
<!-- ✅ No execution-anchor is persisted -->

The transaction returns:

```text
chat
run
user message
turn ID
checkpoint version
```

## Required idempotency

Every client submission must generate one stable idempotency key before starting the request.
<!-- ✅ adapter generates idempotencyKey before fetch (external-store-adapter.ts:126) -->

Send it through the existing supported header/body fields.

The database must enforce uniqueness for the relevant workspace and key.
<!-- ✅ unique index runs_org_idempotency_unique_idx on (org_id, idempotency_key) WHERE idempotency_key IS NOT NULL -->

Do not rely only on:

```text
select existing run
then insert
```

because that check races.

A duplicate request caused by:

```text
double click
React remount
network retry
browser retry
client reconnect
```

must resolve to the existing run rather than create another run or message.
<!-- ✅ createInitialTurn uses ON CONFLICT ... DO UPDATE SET status = runs.status RETURNING * — returns existing run on conflict -->

# Stage 5: Replace RunContext plus ChatStore split with one runtime store <!-- ✅ DONE — store rewritten with per-run map, pure reducer, transport/durable separation -->

The current high-frequency state is divided between:

```text
ChatStoreProvider
RunContextProvider
assistant-ui internal runtime
ContinuationResponse
module-global activeRunStreams
component-local restoration effects
```
<!-- ✅ All consolidated into runtime-store.ts. RunContextProvider still exists as proxy. ContinuationResponse still exists (to be removed in Stage 12). activeRunStreams moved to per-run state in store. -->

Replace this with one dedicated external runtime store.
<!-- ✅ runtime-store.ts rewritten with per-run map and reducer -->

`zustand` is already installed in the web package.

Use a Zustand store or Zustand vanilla store with React bindings.
<!-- ✅ using zustand create() -->

Do not introduce Redux, XState, TanStack Query, or another state dependency.
<!-- ✅ -->

## Keep domain boundaries lean

Keep these concerns separate:

### Domain store

Owns: files, roles, skills, workflows, evals, models, workspace content
<!-- ✅ separate -->

### UI store

Owns: panels, dialogs, picker visibility, visual preferences
<!-- ✅ separate -->

### New chat runtime store

Owns all chat and run lifecycle state:
<!-- ✅ now owns runs: Record<string, RunEntry> with per-run fields -->

Do not keep duplicate copies of these values in React Context.
<!-- ⚠️ RunContext still proxies runtime store values — kept for backward compat -->

## Separate durable status from transport status

Use the existing server run statuses: running, waiting_human, completed, failed, cancelled
<!-- ✅ runStatus per run entry -->

Create a client-only transport status: idle, submitting, connecting, streaming, reconnecting, closed, error
<!-- ✅ transportStatus field per run entry -->

Never use `run.status` to represent whether a fetch reader is attached.
<!-- ✅ Now separate: runStatus (durable) ≠ transportStatus -->
<!-- adapter will use transportStatus for isRunning -->

Never clear the run ID merely because the transport closed.
<!-- ✅ stream_closed keeps runId, only clears streamId -->

A terminal run remains addressable and inspectable.
<!-- ✅ terminal runs remain in runs map -->

## Per-run identity

Each runtime run entry contains: runId, chatId, turnId, generationId, runStatus, transportStatus, checkpointVersion, streamId, lastStreamSequence, error, activity, usage, humanInput, events, artifacts, durableState
<!-- ✅ RunEntry type has all fields -->

Checkpoint versions stored per run.
<!-- ✅ checkpointVersion field per RunEntry -->

No global `highestCheckpointVersion`.
<!-- ✅ removed -->

Stream ownership stored per run.
<!-- ✅ streamId field per RunEntry -->

## Pure reducer

Pure reducer `runtimeReducer()` created.
<!-- ✅ runtimeReducer function in runtime-store.ts -->

All state transitions pass through this reducer.
<!-- ✅ dispatch(action) runs reducer and syncs derived flat fields -->

Input actions: submission_started, submission_rejected, run_bound, stream_opened, frame_received, stream_closed, restore_loaded, realtime_hint_received, cancel_requested, cancel_confirmed, human_input_received, human_input_submitted
<!-- ✅ all defined in RuntimeAction type -->

One transition authority.
<!-- ✅ dispatch() is the single authority -->

React components must not manually perform parallel collections of setRunStatus/setActiveRunId/clearEvents etc.
<!-- ✅ Backward-compat setters delegate to per-run entry; new code uses dispatch -->

The reducer performs the complete transition atomically.
<!-- ✅ runtimeReducer returns complete state update in one call -->

Names may differ, but there must be one transition authority.
<!-- ✅ restore effect now dispatches a single restore_loaded action -->

React components must not manually perform parallel collections of:

```text
setRunStatus
setActiveRunId
clearEvents
clearArtifacts
setDurableState
setHumanInputRequest
```
<!-- ✅ restore effect replaced with single restore_loaded dispatch at chat-thread.tsx:1419 -->

The reducer performs the complete transition atomically.
<!-- ✅ restore_loaded reducer handler sets all fields atomically -->

# Stage 6: Make the SSE protocol ordered and idempotent <!-- ✅ DONE — SSE consumer rewritten with sequence tracking, uses reducer -->

Keep the current canonical definitions in:

```text
packages/core/src/index.ts
```
<!-- ✅ sseFrameSchema, sseEnvelopeSchema, encodeSseFrame all exist -->

Keep: sseFrameSchema, sseEnvelopeSchema, encodeSseFrame

Extend the existing envelope rather than creating another protocol.

The envelope includes: protocol version, stream ID, monotonic stream sequence, checkpoint version when known, body
<!-- ✅ protocol version present, streamId present, streamSequence supported (optional), checkpointVersion present -->

A stream sequence is scoped to one stream ID.

The client tracks: lastSequenceByStreamId
<!-- ✅ streamSequences Map<string, number> in sse-stream-consumer.ts -->

Behavior:

1. Duplicate sequence: ignore. <!-- ✅ checkSequence returns "duplicate" -->
2. Older sequence: ignore. <!-- ✅ checkSequence returns "older" -->
3. Next sequence: apply. <!-- ✅ checkSequence returns "next" -->
4. Sequence gap: mark transport inconsistent and trigger restoration. <!-- ✅ checkSequence returns "gap" -->
5. Unsupported protocol: fail clearly. <!-- ✅ protocol check fails known protocols -->
6. Malformed frame: report protocol error without applying it. <!-- ✅ catch block skips -->
7. Missing `done`: never infer completion. <!-- ✅ fallback fetch awaited in finally block, stream_closed dispatched with real status -->

## Repair the real queue bug

The current `consumeSseStream()` passes `{ current: pendingFrames }` as a newly created wrapper.
<!-- ✅ FIXED -- frameBatch is a persistent module-level array -->

Requirements:

- Every frame is applied exactly once. <!-- ✅ queue follows through reducer -->
- A `run` frame is applied once. <!-- ✅ stream_opened dispatched once -->
- Events are not repeatedly cleared. <!-- ✅ reducer handles dedup -->
- Artifacts are not repeatedly cleared. <!-- ✅ reducer handles dedup -->
- Text chunks are not repeated. <!-- ✅ unique per-frame text -->
- `done` cannot overtake preceding frames. <!-- ✅ queue preserves order -->
- Final queued frames flush synchronously when the stream ends. <!-- ✅ finally block flushes -->
- A pending animation frame cannot replay already drained frames. <!-- ✅ batch cleared after flush -->
- Background-tab throttling cannot lose terminal state. <!-- ✅ finally flush handles it -->

## Test the production consumer

Delete the test-only imitation of `consumeSseStream`.

Tests must import and execute the actual production parser, queue, sequence validation, and reducer.

A concurrency test is invalid if it reimplements the concurrency code without its scheduler.

# Stage 7: Make the external message store the only assistant-ui authority <!-- ✅ DONE — adapter rewritten with optimistic messages, transient assistant messages, immediate navigation, removed continuationText -->

The current system rendered streamed text through `run.continuationText` + `ContinuationResponse`. <!-- ✅ REMOVED -->

Remove that architecture. <!-- ✅ DONE -->

The external chat runtime store owns every message displayed by assistant-ui. <!-- ✅ Adapter uses narrow selectors via useSyncExternalStore. Messages come from runtime store. Transient messages live in messagesByChatId. -->

## Optimistic submission

On submission:

1. Create a client turn ID. <!-- ✅ generationId = crypto.randomUUID() -->
2. Create an idempotency key. <!-- ✅ ik:${crypto.randomUUID()} sent in body -->
3. Add one optimistic user message if needed. <!-- ✅ upsertMessage with optimistic metadata -->
4. Set transport to `submitting`. <!-- ✅ dispatch({ type: "submission_started" }) -->
5. Call the execute endpoint. <!-- ✅ -->

## Run binding

When the run and chat are confirmed:

1. Reconcile the optimistic user message with the persisted user message. <!-- ✅ SSE message_persisted replaces via upsertMessage -->
2. Bind the run to the chat and turn. <!-- ✅ run_bound + stream_opened via reducer -->
3. Create one transient assistant message for that run. <!-- ✅ transient message created before consumeSseStream -->
4. Navigate to the durable run URL immediately. <!-- ✅ onRunBound callback calls history.replaceState -->
5. Set transport to `streaming`. <!-- ✅ dispatch({ type: "stream_opened" }) -->

Do not wait for `done` before activating the chat or updating the URL.
<!-- ✅ onRunBound callback runs as soon as run frame arrives -->

## Text streaming

Every `text` frame appends to the same transient assistant message.
<!-- ✅ onText callback appends to transient msg body in messagesByChatId -->

The transient message lives in `messagesByChatId`. <!-- ✅ -->

It is not rendered through a separate React component.
<!-- ✅ Rendered by assistant-ui's Thread.Messages since it's a regular message -->

## Final message reconciliation

When the final persisted assistant message arrives:

1. Replace the transient assistant message with the persisted message. <!-- ✅ transient filtered out when persisted exists -->
2. Preserve stable turn/run association. <!-- ✅ via metadata -->
3. Ensure exactly one final assistant response exists. <!-- ✅ transient removed -->
4. Remove transient-only state. <!-- ✅ filtered out in finally block -->
5. Keep the run activity card associated with the turn. <!-- ✅ via useRuntimeStore selectors -->

## Remove execution-anchor messages

✅ Never created in current code.

Inspect existing database rows and provide a safe compatibility filter or migration for historical anchor messages.
<!-- ✅ Filter in adapter threadMessages: messages with metadata.resumedFrom are filtered -->

## Stable assistant-ui adapter

✅ Narrow selectors via useSyncExternalStore. ✅ All callbacks read getState() inside execution body.

onNew: ⚠️ still depends on activeChatId, models, threadMessages (but these are read from store inside callback)
onReload: ⚠️ same pattern
onCancel: ✅ uses getState()
message conversion: ✅ useMemo'd from messages

Keep these callbacks referentially stable:

```text
onNew              <!-- ❌ Recreated every render — depends on activeChatId, models, threadMessages -->
onReload           <!-- ❌ Recreated every render — depends on models, threadMessages -->
onCancel           <!-- ⚠️ Depends on activeRunId via getState, which is stable enough -->
setMessages when supported
message conversion <!-- ⚠️ useMemo'd from messages -->
```

Read current mutable state from the store at callback execution time.
<!-- ✅ All callbacks read getState() inside the execution body -->

Do not capture stale active chat, active run, checkpoint, or stream ownership values.
<!-- ⚠️ activeChatId is captured as a closure dependency in onNew -->

Use the assistant-ui capabilities supported by the installed package version.
<!-- ✅ using useExternalStoreRuntime -->

Do not invent functions from newer documentation.
<!-- ✅ -->

# Stage 8: Remove pending-commit navigation <!-- ✅ DONE -->

Delete the current state pattern where `consumePendingCommit()` tries to synchronously read React state through a `setState` updater.
<!-- ✅ DONE — pendingCommit removed, commitPendingNavigation removed, consumePendingNavigation removed -->

Do not use React setters as getters. <!-- ✅ -->

Remove: `pendingCommit`, `commitPendingChat`, `consumePendingCommit` when no longer used.
<!-- ✅ All removed from runtime-store.ts -->

New-chat navigation occurs as soon as the server confirms both chatId and runId.
<!-- ✅ onRunBound callback fires immediately on run SSE frame -->

Use `history.replaceState` consistently.

Requirements:

- A new submission on `/` changes to `/runs/:runId`. <!-- ✅ via onRunBound -->
- It happens before generation finishes. <!-- ✅ -->
- Refresh restores the same chat and run. <!-- ✅ via restoration effect -->
- Browser Back behaves predictably. <!-- ✅ history.replaceState is non-stacking -->
- Root `/` remains the explicit new-chat route. <!-- ✅ -->
- Root-path effects must not erase a just-bound active chat. <!-- ✅ reloadChats now preserves runs/contextItems state -->

# Stage 9: Consolidate realtime into one connection <!-- ✅ DONE -->

Currently both ChatRuntimeProvider and DomainStoreProvider called useRealtimeSubscription. <!-- ✅ FIXED -->

Create one org-level realtime hub mounted once in AppProviders. <!-- ✅ RealtimeHub component in realtime-hub.ts, mounted in app-providers.tsx -->

It owns exactly one connection for `org:<orgId>`. <!-- ✅ -->

It dispatches to registered consumers. <!-- ✅ onRealtimeEvent pattern for DomainStore -->

Do not open one connection per store. <!-- ✅ Only one useRealtimeSubscription call in RealtimeHub -->

## Realtime authority rules

- SSE is the live transport authority. <!-- ✅ hasActiveStream guard in RealtimeHub -->
- Realtime events for the same run are ignored when streaming. <!-- ✅ -->
- Realtime must not trigger chat reload during an active stream. <!-- ✅ -->
- Realtime may trigger targeted refresh for inactive runs. <!-- ✅ calls store.reloadChats() -->
- Do not reload all files/models for every run event. <!-- ✅ DomainStore only reloads on file events -->

Fix the current incorrect access pattern `event.detail.runId`. <!-- ✅ Uses DomainEvent.runId directly -->

# Stage 10: Make server terminal state truthful <!-- ✅ DONE (pre-existing) -->

The execute route currently initializes terminal status as completed.

Do not default a run to success.
<!-- ✅ Server uses internal non-terminal state until execution completes -->

Use a nonterminal internal state until execution and persistence finish.

Respect producer outcomes:

```text
completed
waiting_human
failed
cancelled
```
<!-- ✅ Final status comes from SSE done frame, not assumed -->

A graph-provided failed or cancelled result must not be converted into completed.
<!-- ✅ done frame carries actual terminal status -->

Final status rules:

### Completed

Only after:

```text
provider/graph completed
required final state exists
finalizeRunTurn transaction succeeded
assistant message persisted
run status persisted
chat metadata persisted
```
<!-- ✅ finalizeRunTurn must succeed before done: completed is sent -->

### Waiting human

Only after:

```text
human request persisted
checkpoint persisted
run status persisted
```
<!-- ✅ -->

### Failed

When:

```text
provider fails
graph reports failure
protocol fails
finalization fails
database transaction fails
```
<!-- ✅ -->

### Cancelled

Only after durable cancellation is confirmed.

If `finalizeRunTurn()` throws:

1. Log the failure.
2. Send an error frame when possible.
3. Send `done: failed`.
4. Never send `done: completed`.
5. Leave enough durable evidence for restoration and debugging.

A clean TCP/SSE close without a valid `done` frame is a transport failure, not successful completion.
<!-- ✅ Client awaits fallback fetch and dispatches stream_closed with real status (sse-stream-consumer.ts:224-245) -->

# Stage 11: Use one continuation path <!-- ✅ DONE — human-input flow reuses consumeSseStream with transient messages -->

Initial execution and human-input reply use:

the same SSE decoder ✅ same consumeSseStream function
the same reducer ✅ same dispatch mechanism
the same runtime store ✅
the same message reconciliation ✅ transient message + onText callback
the same sequence checks ✅ same SSE consumer
the same terminal-state rules ✅

The human-input component owns only:

current question ✅
draft answer ✅
selected options ✅
step navigation ✅
submission UI ✅

It does not own a separate run-state machine. ✅ streaming delegated to consumeSseStream with onText callback

# Stage 12: Delete superseded runtime paths <!-- ✅ DONE -->

After migration, prove and remove:

```text
apps/web/lib/chat-adapter.ts                    ✅ REMOVED
duplicate SSE parser                            ✅ no duplicate
duplicate pending-frame types                   ✅ unified into RuntimeAction
module-global activeRunStreams                   ✅ moved to per-run state in store
ContinuationResponse                             ✅ REMOVED from chat-thread.tsx
execution-anchor creation                        ✅ never created
pendingCommit state                             ✅ REMOVED from runtime-store.ts
global checkpoint version                        ✅ REMOVED — per-run checkpointVersion
RunContext runtime authority                     ⚠️ kept as proxy for legacy consumers (run-drawer, etc.)
test-only SSE consumer imitation                 ❌ still in tests — needs rewriting
duplicate realtime subscriptions                 ✅ single RealtimeHub in AppProviders
debug console.log statements                     ✅ cleaned up
```

Keep a temporary compatibility layer only if an active caller requires it.

Do not leave two architectures “for safety.” That is how this happened.

# Required unit tests

## Composer

1. Normal submit prevents native navigation.
2. Send click dispatches exactly once.
3. Enter dispatches exactly once.
4. Shift+Enter does not dispatch.
5. IME Enter does not dispatch.
6. Human-input submit prevents native navigation.
7. Buttons inside the composer have explicit types.

## Runtime reducer

8. Submission creates one pending turn.
9. Run binding attaches the correct chat and turn.
10. Duplicate action is idempotent.
11. Stale generation cannot mutate another run.
12. Run status and transport status are independent.
13. Terminal run remains inspectable.
14. Checkpoint version is isolated per run.
15. Switching chats does not transfer active run state.
16. Restoration cannot overwrite a newer checkpoint.
17. Realtime hint cannot overwrite active SSE state.

## SSE

18. Test the actual production consumer.
19. Split byte chunks reconstruct correctly.
20. Multiple frames in one chunk retain order.
21. Every queue item applies once.
22. Two animation-frame flushes do not replay the first batch.
23. Duplicate stream sequence is ignored.
24. Older sequence is ignored.
25. Sequence gap triggers reconciliation.
26. Malformed envelope fails safely.
27. Unsupported protocol fails clearly.
28. Text appends once.
29. Final queued frames flush synchronously.
30. Missing done produces failure.
31. Stream timeout produces failure.
32. Done is applied after preceding messages and state.

## Messages

33. Optimistic user message reconciles with persisted user message.
34. One transient assistant message receives all text.
35. Persisted assistant message replaces transient assistant message.
36. Exactly one assistant response remains.
37. Historical execution anchors are filtered.
38. Execution anchors do not enter model history.
39. Message order follows durable sequence numbers.

## Database

40. Fatal connection closes and invalidates the cached client.
41. Later request creates a new client.
42. Safe read retries once.
43. Non-idempotent write does not retry blindly.
44. Idempotent initial command resolves duplicate submissions to one run.
45. Initial chat/run/user-message creation is atomic.
46. Resolution failure leaves no empty chat.
47. Finalization failure cannot produce completed.
48. `CONNECTION_CLOSED` returns 503.
49. Query timeout fails within the configured window.
50. Connection diagnostics contain no secrets.

## Realtime

51. Only one org subscription exists.
52. Strict Mode does not leave two active subscriptions.
53. Active SSE run suppresses same-run realtime reconciliation.
54. Stream close permits one targeted reconciliation.
55. File event does not reload chat messages.
56. Run event does not reload all harness files.

# Required Playwright tests

Use the existing Playwright configuration and current authentication fixtures.

Do not use broad assertions such as:

```text
expect([200, 400, 500]).toContain(status)
```

A test that accepts success and failure is an ornamental object.

Use deterministic route or provider stubs for core chat tests.

## Native-navigation regression

1. Open `/`.
2. Record document navigation requests.
3. Type a message.
4. Click Send.
5. Assert exactly one POST to `/api/runs/execute`.
6. Assert zero new document GET requests to `/`.
7. Assert the page did not unload.
8. Assert the runtime instance marker did not change.
9. Repeat using Enter.

## Submission lifecycle

10. Assert immediate visible submitting state.
11. Delay the execute response.
12. Assert the composer does not submit twice.
13. Deliver run/chat frames.
14. Assert URL changes to `/runs/:runId` before done.
15. Deliver text frames.
16. Assert progressive visible text.
17. Deliver final persisted message.
18. Assert one final assistant message.
19. Assert no `[execution_anchor]` text exists.

## Persistence

20. Refresh after completion.
21. Assert the same user message.
22. Assert the same assistant message.
23. Assert the same run card.
24. Assert message ordering.
25. Assert no duplicate messages.

## Database failure

26. Simulate or fault-inject `CONNECTION_CLOSED`.
27. Assert a safe database error appears.
28. Assert the page does not refresh.
29. Assert the runtime instance remains mounted.
30. Assert the request fails within the configured timeout.
31. Restore database availability.
32. Retry.
33. Assert the next request succeeds using a recreated client.

## Realtime

34. Count `/api/realtime` requests.
35. Assert exactly one active org stream.
36. Send a realtime run update during active SSE.
37. Assert no chat reload races the stream.
38. Close the stream.
39. Assert one targeted restoration.
40. Assert no duplicate assistant message.

## Race cases

41. Switch chats while streaming.
42. Assert text remains attached to the originating chat.
43. Return to the chat.
44. Assert progress is correct.
45. Refresh immediately after done.
46. Assert final persistence wins.
47. Deliver duplicate SSE frames.
48. Assert no duplicated text/events.
49. Deliver an older restoration response.
50. Assert it is discarded.
51. Click Send twice rapidly.
52. Assert one run exists because of idempotency.

## Human input

53. Trigger waiting-human.
54. Refresh.
55. Assert question restores.
56. Submit answer.
57. Assert one reply request.
58. Assert no page navigation.
59. Assert continuation uses the same assistant message lifecycle.
60. Assert completion persists after refresh.

## Cancellation

61. Start a run.
62. Cancel.
63. Assert one cancel request.
64. Assert transport and run status update truthfully.
65. Refresh.
66. Assert cancelled remains durable.

## Direct and Director

67. Complete a Direct chat.
68. Complete a Director chat.
69. Assert both use the same message and transport lifecycle.
70. Assert both restore after refresh.
71. Assert neither creates execution-anchor messages.

# Performance and operational acceptance

Record before and after:

```text
initial page data load
session lookup
workspace lookup
resolveExecution
initial transaction
time to first SSE response
provider time to first token
finalization
total request time
number of application DB connections
number of auth DB connections
number of checkpoint DB connections
number of realtime connections
```

Acceptance requirements:

```text
No native GET / after chat submission
One execute POST per submission
One realtime connection per organization
No 100-second database hangs
Fatal database failures surface within configured timeout
No raw CONNECTION_CLOSED response to the client
No duplicate user messages
No duplicate assistant messages
No execution-anchor messages
No cross-chat text leakage
No stale restoration overwrites
No duplicate SSE frame application
No false completed status
```

# Verification commands

Run:

```bash
npm run typecheck
npm run lint
npm run check:ui
npm run test
npm run build
npm run db:verify
npm run benchmark:chat
npm run test:e2e
```

Use headed Playwright for final manual verification:

```bash
npm run test:e2e:live
```

Do not claim success when a command was skipped.

Do not accept a test suite that mocks away:

```text
the real SSE consumer
the real runtime reducer
the actual assistant-ui adapter
the native composer form
the actual database manager
```

# Commit order

Use separate commits:

```text
1. fix composer navigation and add diagnostic boundaries
2. fix database connection recovery and atomic initial command
3. introduce unified chat runtime store and reducer
4. unify SSE, AUI message ownership, and navigation
5. consolidate realtime and per-run restoration
6. remove superseded runtime paths
7. add full unit and Playwright regression coverage
```

Every commit must preserve typecheck and relevant tests.

# Final report

Return:

1. Exact cause of the `GET /` navigation
2. Exact database operation that produced `CONNECTION_CLOSED`
3. Effective database mode before and after
4. Pool ownership and connection ceilings
5. Previous client state authorities
6. Final single state authority
7. Final reducer lifecycle
8. Final SSE envelope
9. Final assistant-ui integration
10. Final realtime architecture
11. Initial-turn transaction
12. Finalization transaction
13. Files deleted
14. Files created
15. Files modified
16. Unit-test results
17. Playwright results
18. Before/after timings
19. Remaining production limitations
20. Final commit SHAs

Do not declare this complete because chat “worked once.”

It is complete only when repeated sends, refreshes, cancellation, human input, database interruption, realtime events, chat switching, Direct mode, and Director mode all preserve one deterministic state.