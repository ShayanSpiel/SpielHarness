-- Supabase SQL Editor migration: keep hosted Supabase in sync with the
-- packages/db/migrations/00XX_*.sql sequence. Run in the Supabase SQL editor
-- whenever the canonical migration tree changes.
--
-- Append-only: never edit or remove prior steps. Add a new step at the bottom.
--
-- Step 1: Add harness_workstream to the file_type enum if not present
do $$
begin
  if not exists (
    select 1 from pg_enum
    join pg_type on pg_enum.enumtypid = pg_type.oid
    where pg_type.typname = 'file_type'
      and pg_enum.enumlabel = 'harness_workstream'
  ) then
    alter type file_type add value 'harness_workstream';
  end if;
end
$$;

-- Recompute file relations by touching metadata. Updating only updated_at does
-- not fire the UPDATE OF metadata trigger.
create or replace function refresh_harness_file_relations(target_org_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update files set metadata = metadata, updated_at = now()
  where org_id = target_org_id
    and file_type in ('harness_role', 'harness_workflow', 'harness_workstream');
$$;

-- Step 2: Backfill existing files that may have been inserted with a text cast
-- (no-op for now; will be used if legacy data needs migration)

-- Step 3: Per-run metrics table (matches packages/db/migrations/0013_run_metrics.sql)
create table if not exists run_metrics (
  run_id uuid primary key references runs(id) on delete cascade,
  org_id uuid not null references orgs(id) on delete cascade,
  type text not null,
  status text not null,
  auth_ms double precision not null default 0,
  harness_resolution_ms double precision not null default 0,
  run_creation_ms double precision not null default 0,
  file_load_ms double precision not null default 0,
  file_parse_ms double precision not null default 0,
  compaction_ms double precision not null default 0,
  provider_ttft_ms double precision not null default 0,
  first_byte_to_client_ms double precision not null default 0,
  event_persist_ms double precision not null default 0,
  run_finalize_ms double precision not null default 0,
  total_ms double precision not null default 0,
  db_query_count integer not null default 0,
  db_total_ms double precision not null default 0,
  hidden_pre_stream_calls integer not null default 0,
  input_tokens_estimate integer not null default 0,
  system_prompt_tokens_estimate integer not null default 0,
  provider_name text,
  model_name text,
  created_at timestamptz not null default now()
);

create index if not exists run_metrics_org_idx on run_metrics (org_id, created_at desc);

-- Step 4: Atomic per-run event sequence + graph version
-- (matches packages/db/migrations/0014_event_sequence_atomic.sql)
alter table runs add column if not exists next_event_sequence bigint not null default 0;
alter table runs add column if not exists graph_version text;

update runs r
set next_event_sequence = greatest(
  r.next_event_sequence,
  coalesce((select max(re.sequence) from run_events re where re.run_id = r.id), 0)
)
where r.next_event_sequence < coalesce(
  (select max(re.sequence) from run_events re where re.run_id = r.id),
  0
);

-- Lock in event_key uniqueness. The unique index from 0009_event_sequence.sql
-- is the enforcement mechanism; this DO block is a no-op when it already
-- exists.
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

-- Step 5: Atomic checkpoint version (matches packages/db/migrations/0016_atomic_checkpoint.sql)
alter table runs add column if not exists checkpoint_version bigint not null default 0;

create index if not exists runs_checkpoint_version_idx
  on runs (org_id, checkpoint_version)
  where checkpoint_version > 0;

-- Step 6: Drop profiles.email UNIQUE (matches packages/db/migrations/0017_drop_profiles_email_unique.sql)
-- Each BetterAuth user is keyed by its own id. The same email signing
-- in via a second method creates a fresh `user` row, which needs a
-- fresh profile row.
alter table profiles drop constraint if exists profiles_email_key;
create index if not exists profiles_email_idx on profiles (lower(email::text));
