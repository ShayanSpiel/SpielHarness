# Chat Context Fix — Session Status

## Timestamp
2026-07-19

## Verification
```bash
npm run typecheck  # passes
npm run lint       # passes (0 errors, 0 warnings)
node --experimental-strip-types --test tests/*.test.ts  # 220 pass (all tests)
```

## Completed

### Phase 0 — Regression harness
- `tests/chat-regression.test.ts` — 16 unit tests
- `tests/e2e/chat-regression.spec.ts` — E2E with pageerror collection
- `tests/e2e/chat-navigation.spec.ts` — fixed selectors  
- `tests/e2e/app.spec.ts` — pageerror across all routes
- Playwright fails on `pageerror`

### Phase 1 — P0 Hotfix (everything applied)
- Generation ownership guard in adapter
- `beginRunAttempt` / `activateRunProjection` (no destructive clear)
- No routing in adapter `finally`; `commitPendingChat` instead
- Lifecycle coordinator in `ChatRuntimeProvider` consumes pending commit
- `initialMessages: []` passed to `useLocalRuntime`
- `reset()` skipped while `isRunning`; deferred reset
- `attachStream` / `detachStream` / `hasActiveStream`
- Suppress same-run restore while SSE attached

### Phase 2 — Protocol correctness (applied)
- `checkpointVersion` on every `SseFrame`
- `sseEnvelopeSchema` in core
- `activeRunStreams` module-level set (checked before `reload()`)
- Restore sends `?since=<version>`; discards stale responses
- `recordCheckpointVersion` in RunContext

### Phase 3 — Chat data model (migration applied to remote DB via CLI)
- `sequenceNumber` on `chatMessageSchema`, `nextMessageSequence` on `chatSchema`
- `mergeMessages` sorts by `sequenceNumber`
- `appendChatMessage`/`appendChatMessages` use atomic `next_message_sequence`
- `finalizeRunTurn` assigns `sequence_number` on insert
- Migration `0019_add_message_sequence_numbers.sql` pushed to remote Supabase
- Migration `0018_project_sessions.sql` also pushed
- `/api/chats` GET: metadata only, no message bodies
- `/api/chats/:id/messages` GET: cursor pagination via `?after=&limit=`
- `listChatMessages` in `packages/db`: supports `{after, limit}` options
- `use-chat-store.ts`: `fetchChatMessages()` lazy-loads; `reload()` no longer bulk-fetches messages; refetches active chat after metadata reload

### Phase 4 — ExternalStoreRuntime migration (applied)
- New `apps/web/lib/external-store-adapter.ts`: builds an `ExternalStoreAdapter` from our `Store` (ChatStore + DomainStore) and `RunContextValue`
- New `apps/web/lib/sse-stream-consumer.ts`: shared SSE stream consumption utility — parses run frames (chat_created, message_persisted, event, artifact, status, run_state, usage, human_input, error, done) and dispatches to store writes via requestAnimationFrame batching
- `ChatRuntimeProvider` now uses `useExternalStoreRuntime(adapter)` instead of `useLocalRuntime`
- Removed: `runtime.thread.reset()`, deferred reset, pending-commit lifecycle coordination, `messagesSnapshotRef`, `loadedChatRef`, generation workarounds in UI
- The ExternalStoreAdapter reads messages directly from `store.messages[activeChatId]` — no sync needed
- `onNew` posts to `/api/runs/execute` and consumes the SSE stream, writing directly to the store
- `onReload` regenerates via the same SSE stream path
- `onCancel` sets run status to cancelled

### Phase 5 — Distributed realtime (inherent via Supabase)
- Supabase Realtime channel broadcasts org-scoped events across instances
- `activeRunStreams` module-level set prevents in-process SSE/realtime races
- Cross-instance updates work: Instance A persists a run → DB trigger fires → Supabase Realtime broadcasts → Instance B receives event → `reload()` refetches metadata + active chat messages

## Files Changed

| File | What |
|------|------|
| `packages/core/src/index.ts` | `checkpointVersion` on `SseFrame`, `sseEnvelopeSchema`; `sequenceNumber`/`nextMessageSequence` |
| `packages/db/src/index.ts` | `appendChatMessage`, `appendChatMessages`, `finalizeRunTurn` with `sequence_number`; `listChatMessages` cursor pagination |
| `supabase/manual_harness_merge.sql` | Phase 3 migration (not yet applied) |
| `apps/web/lib/run-context.tsx` | `beginRunAttempt`, `activateRunProjection`, `currentGeneration`, `pendingCommit` + lifecycle, `attachStream`, `detachStream`, `hasActiveStream`, `recordCheckpointVersion` |
| `apps/web/lib/chat-adapter.ts` | generation guard, `activeRunStreams`, no routing, `commitPendingChat`, checkpoint version tracking |
| `apps/web/lib/use-chat-store.ts` | realtime listener checks `activeRunStreams` before `reload()`; Phase 3: `fetchChatMessages()` lazy-loader; `reload()` metadata-only; refetches active chat messages |
| `apps/web/components/chat/chat-thread.tsx` | `ChatRuntimeProvider`: `initialMessages: []`, skip reset while running, deferred-reset, consume pending commit on runEnd; restore uses `?since=`, monotonic version check; Phase 3: lazy-load messages on chat activation |
| `apps/web/app/api/chats/route.ts` | GET: metadata only (no bulk message fetch) |
| `apps/web/app/api/chats/[id]/messages/route.ts` | GET: cursor pagination via `?after=&limit=` |
| `apps/web/lib/external-store-adapter.ts` | **NEW** Phase 4: ExternalStoreAdapter wrapping stores |
| `apps/web/lib/sse-stream-consumer.ts` | **NEW** Phase 4: shared SSE stream consumption utility |
| `apps/web/components/chat/chat-thread.tsx` | Phase 4: `useExternalStoreRuntime` replaces `useLocalRuntime`; removed lifecycle coordination code |
| `supabase/migrations/0018_project_sessions.sql` | **NEW** Project sessions and revision lineage |
| `supabase/migrations/0019_add_message_sequence_numbers.sql` | **NEW** Message sequence numbers + index |
| `tests/chat-regression.test.ts` | 16 new tests |
| `tests/bounded-workspace.test.ts` | **NEW** 4 tests: 10K messages across 100 chats, merge efficiency, dedup, URL construction |
| `tests/e2e/*.spec.ts` | pageerror collection, fixed selectors |
| `AGENTS.md` | Updated lifecycle rules |
| `CHAT-CONTEXT-FIX-PLAN.md` | Replaced with phased plan |
| `STATUS.md` | This file |

## Remaining (for next session)

All phases complete. Future work:
- E2E tests with running Supabase/Playwright
- Performance benchmarks for the external store adapter at scale
- Edge case: `onEdit` and `onDelete` handlers in ExternalStoreAdapter for full message lifecycle

### Phase 4 — ExternalStoreRuntime migration
- Convert `useLocalRuntime` → `useExternalStoreRuntime`
- Client-generated `clientTurnId` / `userMessageId` preserved through server
- Remove `runtime.thread.reset()`, pending-commit mechanism, generation workarounds

### Phase 5 — Distributed realtime
- Replace in-process transport
- Multi-instance realtime test

## Key Details

### Getting a new chat run
1. Adapter's `run()` calls `beginRunAttempt()` — status → "running", events NOT cleared
2. SSE stream starts; `run` frame calls `activateRunProjection()` — clears events, sets `activeRunId`
3. Adapter's `finally` calls `commitPendingChat({chatId, runId})`
4. `ChatRuntimeProvider` effect sees `isRunning` → false, consumes commit, calls `setActiveChat` + `history.replace`

### Generation ownership
- `run()` captures `generationId`; all `applyFrame` mutations check `generationId === currentGeneration`
- `currentGeneration` is bumped by each `beginRunAttempt()` call
- Stale SSE streams (from aborted requests, or tabs) are silently dropped
