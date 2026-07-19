# Chat Context Fix — Implementation Plan (Revised)

## Problem

1. **"Parent message not found"** — assistant-ui `MessageRepository` error caused by `useLocalRuntime` re-initializing mid-stream when `store.messages` changes.
2. **Events inspector resets to 0** — `startRun()` clears events/artifacts eagerly before the SSE stream begins.
3. **Fragile state management** — three independent layers (RunContext, WorkspaceStore, assistant-ui runtime) manage overlapping data with no single source of truth. Realtime-triggered `reload()` races with SSE frame updates.

## Phased approach

### Phase 0 — Regression harness (applied)
- `tests/chat-regression.test.ts`: 16 unit tests covering generation ownership, pending-commit, restore monotonicity, realtime-suppression, and deferred-run-projection.
- `tests/e2e/chat-regression.spec.ts`: E2E tests with pageerror collection.
- `tests/e2e/chat-navigation.spec.ts`: Updated with working selectors.
- `tests/e2e/app.spec.ts`: Pageerror collection across all routes.
- Playwright E2E tests fail on `pageerror`.

### Phase 1 — P0 Hotfix (applied)
- `SpielosChatAdapter.run()` captures a `generationId` on every call. All SSE-frame mutations check `generationId === ctx.currentGeneration` before applying; stale generators are silently dropped.
- `beginRunAttempt()` sets status for immediate UI but does **not** clear events/artifacts. `activateRunProjection(runId)` clears them when the first `run` SSE frame arrives — eliminates the flash-to-zero in the Events inspector.
- The adapter's `finally` block no longer calls `setActiveChat()` or `router.replace()`. Navigation is deferred to a lifecycle coordinator via `commitPendingChat()`.
- `commitPendingChat({chatId, runId})` stores a pending commitment. A `useEffect` in `ChatRuntimeProvider` consumes it after `runtime.thread.isRunning` transitions `true → false`.
- `ChatRuntimeProvider` passes `initialMessages: []` to `useLocalRuntime` — the `initialMessages` dep was causing `MessageRepository` re-initialization mid-stream (fixes "Parent message not found").
- `runtime.thread.reset()` is skipped while `isRunning`, preventing destruction of the in-progress message tree. A deferred-reset flag applies the reset after the run completes.
- `attachStream(runId)` / `detachStream(runId)` track per-run stream ownership.
- `hasActiveStream(runId)` is checked by the restore effect in `ChatThreadInner` — realtime-triggered restoration is suppressed while the SSE stream owns the run.

### Phase 2 — Protocol correctness (applied)
- `checkpointVersion` added as an optional field to every `SseFrame` variant.
- `sseEnvelopeSchema` wraps frames with protocol version and checkpoint version.
- `activeRunStreams` (module-level `Set`) is checked by the realtime listener in `use-chat-store.ts` before calling `reload()`, preventing races between `reload()` and streaming SSE frames.
- Restore function in `ChatThreadInner` sends `?since=<version>` and discards responses whose `checkpointVersion ≤ highestCheckpointVersion`.

### Phase 3 — Chat data model (pending)
- Add concurrency-safe message sequence numbers.
- Backfill existing messages.
- Split chat metadata and message APIs.
- Add cursor pagination.
- Hydrate only the selected chat.
- Add bounded large-workspace tests.

### Phase 4 — ExternalStoreRuntime migration (pending)
- `useExternalStoreRuntime` with store-owned message identity.
- Client-generated `clientTurnId` / `userMessageId` preserved through server.
- Remove `runtime.thread.reset()`, pending-commit mechanism, LocalRuntime workarounds.

### Phase 5 — Distributed realtime (pending)
- Replace in-process realtime transport.
- Enable multi-instance realtime test.

## Files Modified

- `packages/core/src/index.ts` — `chatMessageSchema` with `sequenceNumber`, `checkpointVersion` on `SseFrame`, `sseEnvelopeSchema`
- `apps/web/lib/run-context.tsx` — `beginRunAttempt`, `activateRunProjection`, `currentGeneration`, `pendingCommit`, `commitPendingChat`, `consumePendingCommit`, `attachStream`, `detachStream`, `hasActiveStream`, `recordCheckpointVersion`
- `apps/web/lib/chat-adapter.ts` — generation guard, `activeRunStreams` export, no navigation, `commitPendingChat`, checkpoint version tracking
- `apps/web/lib/use-chat-store.ts` — realtime listener checks `activeRunStreams` before `reload()`
- `apps/web/components/chat/chat-thread.tsx` — `ChatRuntimeProvider` uses `initialMessages: []`, skips reset while running, deferred-reset, consumes pending commit on runEnd; restore uses `?since=` and monotonic version check
- `tests/chat-regression.test.ts` — 16 new unit tests
- `tests/e2e/chat-regression.spec.ts` — E2E regression tests with pageerror collection
- `tests/e2e/chat-navigation.spec.ts` — fixed selectors, pageerror collector
- `tests/e2e/app.spec.ts` — pageerror collection across all routes
- `AGENTS.md` — updated lifecycle rules
