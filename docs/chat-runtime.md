# Chat runtime architecture

The chat UI has one client authority: `apps/web/lib/runtime-store.ts`. Assistant UI is a projection of that store; it does not own durable chat or run state.

## Execution engines

- **Director mode** runs the file-backed Orchestrator through DeepAgents. DeepAgents owns its planning loop, subagents, filesystem, native summarization, LangGraph interrupts, and checkpoint state.
- **Direct mode** runs the deterministic LangGraph path. A selected role or workflow is represented as graph nodes; plain Direct chat uses the lightweight chat path.

The engines remain distinct. They share only the durable turn and transport contract described below.

## Authoritative lifecycle

1. The client creates one generation id and one idempotency key, inserts an optimistic user projection, and dispatches `submission_started`.
2. `/api/runs/execute` resolves the file-backed execution snapshot and atomically creates the chat, run, turn, and user message.
3. Every server frame is wrapped in `spielos-sse-v1` with one `streamId`, a monotonic `streamSequence`, and the latest `checkpointVersion`.
4. The first `run` frame binds the pending generation to its durable `chatId`, `runId`, and `turnId`. Only a foreground generation may change the active chat or URL.
5. `message_persisted` is the authority for committed messages. Optimistic and transient projections are reconciled by generation id and durable primary key.
6. Events and artifacts update the per-run projection. Complete history remains available in the Events inspector.
7. Finalization atomically persists the checkpoint, terminal status, assistant turn anchor, chat metadata, and queued events. A finalization failure is durably marked `failed` before `done`.
8. `done` is emitted once after durable finalization. The client detaches the stream and restores the run checkpoint once.

## Recovery rules

- SSE owns a run while its stream is attached. Realtime and route restoration cannot overwrite that projection.
- Checkpoint versions only move forward. Older restore results are discarded.
- Realtime is a latency hint, not a correctness dependency. A visible durable run without an attached SSE reader polls its checkpoint until terminal.
- Opening `/` or selecting **New Run** clears the active projection. A late frame from the previous run may persist in the background but cannot reclaim focus or navigation.
- Opening `/runs/:id` selects that run and restores its chat, events, artifacts, usage, human-input request, and messages from durable storage.
- Replaying the same idempotency key returns the existing durable turn and never starts Direct LangGraph or DeepAgents twice.

## Performance boundaries

- Environment-backed models use stale-while-revalidate caching.
- File-backed harness reads coalesce per workspace and cache for 30 seconds. Every local file mutation invalidates the cache.
- The repository relies on Next's platform-specific optional compiler. Do not hardcode an Intel- or ARM-only SWC package in the root dependencies.
- Development compilation is not a valid chat-latency benchmark. Use an optimized build for send-to-first-frame and streaming verification.

## Verification

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run check:ui
npm run build
```

Browser verification must cover a Direct role/workflow run, a Director run, a second-turn context check, reload restoration, New Run while idle and while a run is pending, the Events inspector, an artifact output, and a native compaction event.
