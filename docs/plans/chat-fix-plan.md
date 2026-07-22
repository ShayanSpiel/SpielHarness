# Chat Infrastructure Repair Plan

Tracked: 2026-07-21  
Each phase is independently verifiable. Update status when done.

---

## Phase 1 — Fix `activeRunId` never updating from `pending:xxx` (THE ROOT BUG)

**Status:** ✅ Done  
**Files:** `apps/web/lib/sse-stream-consumer.ts`

### Problem
- `submission_started` sets `activeRunId = "pending:xxx"` 
- When the `run` SSE frame arrives, only `stream_opened` is dispatched — which does NOT update `activeRunId`
- `activeRunId` stays `"pending:xxx"` for the ENTIRE stream
- The restore effect keeps trying to restore `pending:xxx` → 500
- The adapter sees `activeRunId = "pending:xxx"` as the active run
- The real run entry is never created in the store

### Fix
- In the `run` frame SSE handler, dispatch `run_bound` BEFORE `stream_opened`
- `run_bound` migrates the pending entry to the real run ID and sets `activeRunId`

## Phase 1b — Fix optimistic message duplication ("2 hellos")

**Status:** ✅ Done  
**Files:** `apps/web/lib/external-store-adapter.ts`

### Problem
- Optimistic user message (`opt:user:xxx`) is stored alongside the persisted user message
- The adapter filter only hides `transient` messages, not `optimistic` ones
- Result: 2 user messages appear in the UI (the optimistic one + the persisted one)

### Fix
- Added `optimistic` filter identical to the `transient` filter: hide optimistic message once a real persisted message exists for the same role

## Phase 1c — Fix restore effect firing on `pending:` runs + excessive re-firing

**Status:** ✅ Done  
**Files:** `apps/web/components/chat/chat-thread.tsx`

### Problem
- Restore effect fires immediately after `submission_started` because `activeRunId` changed
- `restorableRunId` is `"pending:xxx"` → fetch to `/api/runs/pending:xxx` returns 500
- Effect dependency array was too broad (`chats`, `runStatus`, `checkpointVersion`, `isDedicatedRunPage`) causing 7+ re-fires during one stream

### Fix
1. Added early return: `if (restorableRunId.startsWith("pending:")) return;`
2. Narrowed dependency array to `[activeChatId, pathname, storeActiveRunId]`

### Verification in UI
1. `npm run dev` (restart if already running)
2. Open http://localhost:3000, open browser DevTools → Console tab
3. Type a message and press Enter or click Send
4. **Expected in Console:**
   - `[ADAPTER] onNew` fires exactly once
   - `[SSE] run_bound` fires once
   - No `[RESTORE] activating` with `restorableRunId: 'pending:...'`
   - `[SSE] stream_end` with a proper terminal status (not `null`)
5. **Expected in UI:**
   - Exactly 1 user message bubble + 1 assistant response
   - No duplicate "hello" messages
6. After stream completes, send a second message
7. **Expected:** Works normally, second send completes without errors
8. Refresh the page
9. **Expected:** Previous conversation visible with correct messages

---

## Phase 2 — Fix restore effect (500 error + checkpoint lock)

**Status:** ✅ Done (_incorporated into Phase 1c_)  
**Files:** `apps/web/components/chat/chat-thread.tsx`

### Problem
- `submission_started` sets `activeRunId = "pending:xxx"` 
- The restore effect fires, fetches `/api/runs/pending:xxx` — returns 500
- 500 + subsequent re-triggers break the send flow for subsequent messages

### Fix
1. Skip restore when `restorableRunId` starts with `"pending:"`
2. Only restore for real, durable run IDs that exist in `store.runs` with non-pending status
3. Narrow the effect dependency array to prevent re-triggers

### Verified
- Restore effect on line 1370: `if (restorableRunId.startsWith("pending:")) return;`
- Deps narrowed to `[activeChatId, pathname, storeActiveRunId]` (line 1449)

---

## Phase 3 — Stabilize `onNew` callback (double-send fix)

**Status:** ✅ Done  
**Files:** `apps/web/lib/external-store-adapter.ts`

### Problem
- `onNew` captures `activeChatId`, `models`, `threadMessages` in its closure
- Change to any of these re-creates the callback → assistant-ui may re-evaluate submission
- This can cause double-submission

### Fix
1. Read `activeChatId` from `getState()` inside the callback body, not from the closure dependency
2. Made `onNew` and `onReload` referentially stable with `[]` deps (never recreated)
3. `models` read via `modelsRef.current`, `threadMessages` replaced by `getHistoryMessages(chatId)` helper

### Files changed
- Added `useRef` import
- Added `modelsRef = useRef(models)` synced in render
- Added `getHistoryMessages(chatId)` helper function
- `onNew` deps: `[activeChatId, models, threadMessages]` → `[]`
- `onReload` deps: `[models, threadMessages]` → `[]`

---

## Phase 3b — Fix server-side `done` frame never arriving + missing frames

**Status:** ✅ Done  
**Files:** `apps/web/app/api/runs/execute/route.ts`, `apps/web/app/api/runs/[id]/reply/route.ts`, `apps/web/lib/sse-stream-consumer.ts`, `apps/web/components/chat/chat-thread.tsx`

### Problems identified from user testing
1. Only initial SSE frames (`run_bound`, `status`, `run_state`) reach client — streaming frames (`text`, `event`, `message_persisted`, `usage`) silently lost during provider execution
2. `done` frame never arrives → `terminalStatus: null` on every stream
3. "No data on inspector" — restore effect fires 3× mid-stream but never after completion

### Root causes
- **Next.js dev proxy buffering**: Initial chunks flush through but subsequent `controller.enqueue()` calls during the provider `for await` loop accumulate in the framework buffer
- **done frame lost**: `controller.close()` finalizes before enqueued done-frame byte is delivered to the consumer
- **Inspector empty**: `stream_closed` does NOT change `activeRunId`, so the restore effect (deps `[activeChatId, pathname, storeActiveRunId]`) never re-fires after completion — final events/artifacts are never loaded

### Fixes

**Server-side (execute + reply routes)**
- Increased close delay from 50ms → 200ms: `await new Promise((r) => setTimeout(r, 200))`
- Added `":flush\n\n"` SSE comment after initial frames to force Next.js to flush the chunk
- Added `X-Accel-Buffering: no` + `X-Content-Type-Options: nosniff` response headers

**Client-side (chat-thread.tsx)**
- Added `transportStatus` to restore effect dependency array
- Effect now fires one final time when `transportStatus` transitions to `"closed"`
- Final restore fetch loads all completed events, artifacts, and messages into the inspector

**Client-side (sse-stream-consumer.ts)**
- Restructured reconciliation fallback to avoid double-dispatch of `stream_closed`

---

## Phase 3c — Fix empty answer flash, stuck status, and pre-stream_closed RESTORE

**Status:** ✅ Done  
**Files:** `apps/web/lib/external-store-adapter.ts`, `apps/web/lib/realtime-hub.ts`, `apps/web/lib/realtime.ts`, `apps/web/app/api/runs/execute/route.ts`, `apps/web/components/chat/chat-thread.tsx`

### Problems identified from user testing
1. **Empty answer flash**: Transient empty assistant message (`body: ""`) appears before restore loads the real messages → user sees a blank bubble that later populates
2. **"Thinking…" stuck**: Only the initial "Thinking…" status shows because SSE status frames are buffered by the dev proxy; "Generating…", "Running tools…" never appear
3. **Pre-stream_closed RESTORE fires**: The restore effect fires 1 extra time before `stream_closed` because the `transportStatus` dep triggers before the stream consumer's reconciliation completes

### Fixes

**Server-side (execute/route.ts)**
- Added `publishDomainEvent({ type: "run.status.message", message: "..." })` alongside every `send({ kind: "status", message })` call — status text is broadcast via realtime, reaching the client even when SSE is buffered

**Client-side (realtime-hub.ts)**
- Added handler for `run.status.message` events: calls `store.setActivity(msg)` to update the status display text, even during an active SSE stream (not gated by the `hasActiveStream` check)

**Client-side (realtime.ts)**
- Added `"run.status.message"` variant to the `DomainEvent` type union

**Client-side (external-store-adapter.ts)**
- Added `if (!msg.body?.trim()) return false` guard in `threadMessages` filter — hides empty transient assistant messages to prevent the blank-bubble flash

**Client-side (chat-thread.tsx)**
- Restore guard now also checks `storeState.activeStreams.has(restorableRunId)` — prevents the effect from firing during an active SSE stream even when `transportStatus` hasn't yet transitioned

### Resolution
- Development was falling back to the memory-heavy SWC compiler because the repository hardcoded the wrong platform package. The platform pin was removed; Next now installs its own correct optional compiler.
- The versioned SSE envelope, ordered consumer, durable restore, and production build are the transport verification targets. Realtime is no longer required for correctness.

---

## Phase 4 — Backend idempotency

**Status:** ✅ Done  
**Files:** `packages/db/src/index.ts`, `supabase/manual_harness_merge.sql`

### Problem
- No unique constraint on `(org_id, idempotency_key)` in the runs table
- Duplicate submissions can create duplicate runs/chats/messages
- The client sends `idempotencyKey` but the server doesn't enforce uniqueness

### Fix
1. Add DB migration for unique constraint on `(org_id, idempotency_key)` 
2. Update `createInitialTurn` to use `ON CONFLICT` and return existing run
3. Return existing run on idempotent re-submission

### Verification in UI
1. Open browser devtools → Network tab
2. Rapidly click Send twice
3. **Expected:** Both clicks may POST, but only one run/chat/message exists
4. Refresh page
5. **Expected:** No duplicate messages

---

## Phase 5 — Consolidate state authorities

**Status:** ✅ Done  
**Files:** `run-context.tsx`, `chat-thread.tsx`, `runtime-store.ts`

### Problem
- State is mutated through multiple paths: `dispatch()`, inline `setRunStatus()`, `clearEvents()`, `setDurableState()`, etc.
- The restore effect manually calls 6+ setters instead of dispatching one action
- `RunContextProvider` proxies store values, creating a second path

### Fix
1. Replace manual setter chains in restore effect with a single `dispatch({ type: "restore_loaded", ... })`
2. Update the reducer to handle `restore_loaded` properly
3. Remove `RunContextProvider` proxy (or convert to read-only)

### Verification in UI
1. Full regression: send messages, refresh, send again, cancel, human-input
2. All should work without state corruption

---

## Phase 6 — Tests

**Status:** ✅ Done  
**Files:** `tests/chat-regression.test.ts` (or new file)

### Tests to add
1. SSE consumer: `chat_created` with fake activeChatId is reconciled to real ID
2. Reducer: `pending:` run IDs don't leak into restore
3. Reducer: `restore_loaded` doesn't overwrite active SSE state
4. Adapter: `onNew` reads from `getState()` not closure
5. Integration: Full submit → SSE → reconcile → second submit cycle

### Run
```bash
npm run typecheck
npm run test
```
