-- Add event_key for idempotent event insertion and future replay cursor.

alter table run_events add column if not exists event_key text;

-- Unique per-run event key prevents duplicate insertion on retry.
create unique index if not exists run_events_run_event_key_idx
  on run_events (run_id, event_key)
  where event_key is not null;
