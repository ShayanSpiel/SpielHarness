-- Phase 2.5: Atomic Checkpoint Persistence.
--
-- Bundles event flush + state update + version increment into a single
-- Postgres transaction via `db.atomicCheckpoint()`. Replaces the
-- read-then-write race where a crash between `flushQueuedEvents` and
-- `updateRun` could lose events.
--
-- `runs.checkpoint_version` is an optimistic-lock counter. Each successful
-- atomic checkpoint increments it. Callers that hold a stale version get
-- a `CheckpointVersionMismatch` error and can re-read the run.

alter table runs add column if not exists checkpoint_version bigint not null default 0;

create index if not exists runs_checkpoint_version_idx
  on runs (org_id, checkpoint_version)
  where checkpoint_version > 0;
