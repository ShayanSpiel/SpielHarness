-- Phase 2: durable, race-free event sequence + execution-snapshot version.
--
-- Replaces the read-then-write `coalesce(max(sequence) + 1, 1)` pattern in
-- `appendRunEvents` with a single atomic reservation against
-- `runs.next_event_sequence`. Each `appendRunEvents` call now reads-and-
-- increments the counter in one statement, so two concurrent event batches
-- can never produce overlapping sequence numbers.
--
-- Adds `runs.graph_version` for future execution-snapshot verification
-- (Phase 5) — workers can refuse to resume a run whose definition_snapshot
-- was generated against a different workspace revision.

-- ── Per-run atomic sequence counter ──────────────────────────
alter table runs add column if not exists next_event_sequence bigint not null default 0;
alter table runs add column if not exists graph_version text;

-- Backfill next_event_sequence for runs that already have events. Safe to
-- run repeatedly: coalesce keeps the existing counter when it is already
-- ahead of the materialized events.
update runs r
set next_event_sequence = greatest(
  r.next_event_sequence,
  coalesce((select max(re.sequence) from run_events re where re.run_id = r.id), 0)
)
where r.next_event_sequence < coalesce(
  (select max(re.sequence) from run_events re where re.run_id = r.id),
  0
);

-- ── Lock in event_key uniqueness ────────────────────────────
-- The unique index from 0009_event_sequence.sql is the enforcement
-- mechanism. It is functionally equivalent to a unique constraint
-- (Postgres unique indexes enforce uniqueness the same way) and the
-- `where event_key is not null` predicate lets multiple rows share
-- the same (run_id, NULL) tuple, which is what we want for events
-- that don't carry an idempotency key. This migration is a no-op
-- when the index already exists; it is kept here as the canonical
-- "Phase 2 lock-in" statement so future readers can see the intent.
do $$
begin
  if not exists (
    select 1 from pg_indexes where indexname = 'run_events_run_event_key_idx'
  ) then
    create unique index run_events_run_event_key_idx
      on run_events (run_id, event_key)
      where event_key is not null;
  end if;
end
$$;
