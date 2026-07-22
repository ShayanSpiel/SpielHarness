-- Supabase SQL Editor migration: keep hosted Supabase in sync with the
-- packages/db/migrations/00XX_*.sql sequence. Run in the Supabase SQL editor
-- whenever the canonical migration tree changes.
--
-- Append-only: never edit or remove prior steps. Add a new step at the bottom.
--
-- NOTE: Steps 1-7 and Phase 3 are now proper Supabase migrations:
--   0018_project_sessions.sql  (Step 7)
--   0019_add_message_sequence_numbers.sql  (Phase 3)
-- This file is preserved for reference only.
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

-- Step 7: Persistent project sessions and revision lineage
-- (matches packages/db/migrations/0018_project_sessions.sql)
create table if not exists project_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  title text not null default 'New project',
  status text not null default 'active'
    check (status in ('active', 'awaiting_input', 'review', 'completed', 'archived')),
  workflow_id uuid references files(id) on delete set null,
  active_revision_id uuid,
  active_artifact_id uuid references files(id) on delete set null,
  working_state jsonb not null default '{}'::jsonb,
  summary text not null default '',
  summary_version bigint not null default 0 check (summary_version >= 0),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists project_sessions_org_chat_idx
  on project_sessions (org_id, chat_id, updated_at desc)
  where archived_at is null;

create table if not exists project_revisions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  project_id uuid not null references project_sessions(id) on delete cascade,
  parent_revision_id uuid references project_revisions(id) on delete set null,
  run_id uuid references runs(id) on delete set null,
  turn_id uuid,
  sequence bigint not null check (sequence > 0),
  instruction text not null default '',
  change_set jsonb not null default '{}'::jsonb,
  artifact_ids jsonb not null default '[]'::jsonb,
  source_hashes jsonb not null default '{}'::jsonb,
  evaluation jsonb not null default '{}'::jsonb,
  receipts jsonb not null default '[]'::jsonb,
  author text not null check (author in ('user', 'orchestrator', 'role', 'workflow', 'system')),
  created_at timestamptz not null default now(),
  unique (project_id, sequence)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_sessions_active_revision_fk'
  ) then
    alter table project_sessions
      add constraint project_sessions_active_revision_fk
      foreign key (active_revision_id) references project_revisions(id) on delete set null;
  end if;
end
$$;

create index if not exists project_revisions_project_sequence_idx
  on project_revisions (project_id, sequence desc);
create index if not exists project_revisions_org_turn_idx
  on project_revisions (org_id, turn_id, created_at desc)
  where turn_id is not null;

drop trigger if exists project_sessions_set_updated_at on project_sessions;
create trigger project_sessions_set_updated_at
before update on project_sessions
for each row execute function set_updated_at();

alter table runs add column if not exists parent_run_id uuid references runs(id) on delete set null;
alter table runs add column if not exists project_id uuid references project_sessions(id) on delete set null;
alter table runs add column if not exists turn_id uuid;
alter table runs add column if not exists execution_kind text;

create index if not exists runs_org_project_created_idx
  on runs (org_id, project_id, created_at desc)
  where project_id is not null;
create index if not exists runs_org_turn_created_idx
  on runs (org_id, turn_id, created_at desc)
  where turn_id is not null;
create index if not exists runs_parent_created_idx
  on runs (parent_run_id, created_at asc)
  where parent_run_id is not null;
create index if not exists chat_messages_turn_idx
  on chat_messages (chat_id, (metadata ->> 'turnId'), created_at asc)
  where metadata ? 'turnId';

-- Phase 3: message sequence numbers for deterministic ordering
alter table chat_messages add column if not exists sequence_number bigint;

do $$ begin
  if exists (
    select 1 from chat_messages where sequence_number is null limit 1
  ) then
    with numbered as (
      select id, chat_id, row_number() over (partition by chat_id order by created_at, id) as seq
      from chat_messages
      where sequence_number is null
    )
    update chat_messages m
    set sequence_number = n.seq
    from numbered n
    where m.id = n.id;
  end if;
end $$;

alter table chat_messages alter column sequence_number set not null;
create unique index if not exists runs_org_idempotency_unique
  on runs (org_id, idempotency_key)
  where idempotency_key is not null;
drop index if exists chat_messages_chat_seq_idx;
create unique index chat_messages_chat_seq_idx on chat_messages (org_id, chat_id, sequence_number);
alter table chats add column if not exists next_message_sequence bigint not null default 0;

do $$ begin
  with max_seq as (
    select chat_id, coalesce(max(sequence_number), 0) as max_s
    from chat_messages
    group by chat_id
  )
  update chats c
  set next_message_sequence = m.max_s + 1
  from max_seq m
  where c.id = m.chat_id
    and c.next_message_sequence < m.max_s + 1;
end $$;
