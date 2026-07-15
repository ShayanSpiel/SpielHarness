-- Durable run control: request-based cancel/pause that survives disconnection.

alter table runs add column if not exists cancel_requested_at timestamptz;
alter table runs add column if not exists pause_requested_at timestamptz;
alter table runs add column if not exists resumed_at timestamptz;

create index if not exists runs_cancel_requested_idx on runs (cancel_requested_at)
  where cancel_requested_at is not null and status = 'running';
