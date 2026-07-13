-- SpielOS: idempotent schema merge.
-- Safe to run on any Postgres 14+ database, even if objects already exist.
-- Use this in place of 0001_init.sql when applying to an existing database.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ── Tenancy ──────────────────────────────────────────────────

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$ begin
  create type membership_role as enum ('owner', 'admin', 'editor', 'viewer');
exception when duplicate_object then null;
end $$;

create table if not exists org_memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);

-- ── Folders ─────────────────────────────────────────────────

create table if not exists folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, parent_id, name)
);

create index if not exists folders_org_idx on folders (org_id, sort_order) where deleted_at is null;

-- ── Files ───────────────────────────────────────────────────

do $$ begin
  create type file_type as enum (
    'knowledge',
    'strategy',
    'prompt',
    'artifact',
    'draft',
    'evidence',
    'asset',
    'eval_report',
    'publish_package',
    'harness_role',
    'harness_skill',
    'harness_workflow',
    'harness_workstream',
    'harness_eval',
    'harness_template',
    'harness_chat_message'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_enum e join pg_type t on e.enumtypid = t.oid
    where t.typname = 'file_type' and e.enumlabel = 'harness_workstream'
  ) then
    alter type file_type add value 'harness_workstream';
  end if;
end $$;

do $$ begin
  create type file_status as enum ('draft', 'active', 'archived', 'deleted');
exception when duplicate_object then null;
end $$;

create table if not exists files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  file_type file_type not null,
  status file_status not null default 'draft',
  title text not null,
  body text not null default '',
  content_format text not null default 'markdown',
  metadata jsonb not null default '{}'::jsonb,
  search_vector tsvector,
  current_version integer not null default 1,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists files_org_type_status_idx on files (org_id, file_type, status) where deleted_at is null;
create index if not exists files_org_updated_idx on files (org_id, updated_at desc) where deleted_at is null;
create index if not exists files_search_idx on files using gin (search_vector);
create index if not exists files_metadata_idx on files using gin (metadata jsonb_path_ops);

create or replace function files_set_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.body, '')), 'B');
  return new;
end;
$$;

drop trigger if exists files_search_vector_trigger on files;
create trigger files_search_vector_trigger
before insert or update of title, body on files
for each row execute function files_set_search_vector();

-- ── File versions ───────────────────────────────────────────

create table if not exists file_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null,
  content_format text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, version)
);

create index if not exists file_versions_file_version_idx on file_versions (file_id, version desc);

create or replace function files_version_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into file_versions (org_id, file_id, version, title, body, content_format, metadata, created_by)
    values (new.org_id, new.id, new.current_version, new.title, new.body, new.content_format, new.metadata, new.created_by);
    return new;
  end if;
  if (new.title, new.body, new.content_format, new.metadata)
     is distinct from (old.title, old.body, old.content_format, old.metadata) then
    new.current_version := old.current_version + 1;
    insert into file_versions (org_id, file_id, version, title, body, content_format, metadata, created_by)
    values (new.org_id, new.id, new.current_version, new.title, new.body, new.content_format, new.metadata, new.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists files_version_insert on files;
create trigger files_version_insert
after insert on files
for each row execute function files_version_snapshot();

drop trigger if exists files_version_update on files;
create trigger files_version_update
before update of title, body, content_format, metadata on files
for each row execute function files_version_snapshot();

-- ── Updated_at triggers ─────────────────────────────────────

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists files_set_updated_at on files;
create trigger files_set_updated_at
before update on files
for each row execute function set_updated_at();

drop trigger if exists folders_set_updated_at on folders;
create trigger folders_set_updated_at
before update on folders
for each row execute function set_updated_at();

drop trigger if exists orgs_set_updated_at on orgs;
create trigger orgs_set_updated_at
before update on orgs
for each row execute function set_updated_at();

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

-- ── File relations ──────────────────────────────────────────

create table if not exists file_relations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  source_file_id uuid not null references files(id) on delete cascade,
  target_file_id uuid not null references files(id) on delete cascade,
  relation_type text not null,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (source_file_id, target_file_id, relation_type),
  check (source_file_id <> target_file_id)
);

create index if not exists file_relations_source_idx on file_relations (source_file_id, relation_type, position);
create index if not exists file_relations_target_idx on file_relations (target_file_id, relation_type);

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

create or replace function files_refresh_relations()
returns trigger
language plpgsql
as $$
declare
  raw_id text;
  ref_id uuid;
  node jsonb;
  relation text;
begin
  delete from file_relations where source_file_id = new.id;
  if new.status = 'deleted' or new.deleted_at is not null then
    return new;
  end if;
  if new.file_type = 'harness_role' then
    for raw_id in
      select jsonb_array_elements_text(coalesce(new.metadata -> 'skillIds', new.metadata -> 'skillSlugs', '[]'::jsonb))
    loop
      select id into ref_id from files
        where org_id = new.org_id and deleted_at is null
          and (id::text = raw_id or metadata ->> 'slug' = raw_id)
        limit 1;
      if ref_id is not null then
        insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
        values (new.org_id, new.id, ref_id, 'role_skill') on conflict do nothing;
      end if;
    end loop;
  elsif new.file_type in ('harness_workflow', 'harness_workstream') then
    for node in select value from jsonb_array_elements(coalesce(new.metadata -> 'nodes', '[]'::jsonb)) loop
      raw_id := coalesce(node ->> 'roleId', node ->> 'roleSlug');
      if raw_id is not null then
        select id into ref_id from files
          where org_id = new.org_id and deleted_at is null
            and (id::text = raw_id or metadata ->> 'slug' = raw_id)
          limit 1;
        if ref_id is not null then
          insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
          values (new.org_id, new.id, ref_id, 'workflow_role') on conflict do nothing;
        end if;
      end if;
      for raw_id in
        select jsonb_array_elements_text(coalesce(node -> 'fileIds', '[]'::jsonb))
      loop
        select id into ref_id from files
          where org_id = new.org_id and deleted_at is null and id::text = raw_id
          limit 1;
        if ref_id is not null then
          insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
          values (new.org_id, new.id, ref_id, 'workflow_input') on conflict do nothing;
        end if;
      end loop;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists files_refresh_relations on files;
create trigger files_refresh_relations
after insert or update of metadata, file_type, status, deleted_at on files
for each row execute function files_refresh_relations();

-- ── Models ──────────────────────────────────────────────────

create table if not exists models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  provider text not null,
  model text not null,
  base_url text,
  secret_env_key text,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider, model)
);

drop trigger if exists models_set_updated_at on models;
create trigger models_set_updated_at
before update on models
for each row execute function set_updated_at();

-- ── Connections ─────────────────────────────────────────────

do $$ begin
  create type connection_kind as enum ('oauth', 'mcp', 'api', 'builtin');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type connection_status as enum ('configured', 'needs_secret', 'disabled');
exception when duplicate_object then null;
end $$;

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind connection_kind not null,
  status connection_status not null default 'configured',
  base_url text,
  secret_env_key text,
  config jsonb not null default '{}'::jsonb,
  operations jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);

drop trigger if exists connections_set_updated_at on connections;
create trigger connections_set_updated_at
before update on connections
for each row execute function set_updated_at();

-- ── Workspace variables ─────────────────────────────────────

do $$ begin
  create type variable_kind as enum ('variable', 'secret_ref');
exception when duplicate_object then null;
end $$;

create table if not exists workspace_variables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind variable_kind not null default 'variable',
  value text,
  description text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

drop trigger if exists workspace_variables_set_updated_at on workspace_variables;
create trigger workspace_variables_set_updated_at
before update on workspace_variables
for each row execute function set_updated_at();

-- ── Chats ───────────────────────────────────────────────────

create table if not exists chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null default 'New chat',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index if not exists chats_org_updated_idx on chats (org_id, updated_at desc) where archived_at is null;

drop trigger if exists chats_set_updated_at on chats;
create trigger chats_set_updated_at
before update on chats
for each row execute function set_updated_at();

do $$ begin
  create type chat_role as enum ('user', 'assistant', 'system', 'tool');
exception when duplicate_object then null;
end $$;

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  role chat_role not null,
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_chat_created_idx on chat_messages (chat_id, created_at);

-- ── Runs ────────────────────────────────────────────────────

do $$ begin
  create type run_status as enum ('running', 'waiting_human', 'completed', 'failed', 'cancelled');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type event_type as enum (
    'run_started',
    'run_completed',
    'run_failed',
    'run_cancelled',
    'node_started',
    'node_completed',
    'node_failed',
    'node_skipped',
    'node_retrying',
    'skill_started',
    'skill_completed',
    'human_input_requested',
    'human_input_received',
    'tool_call_started',
    'tool_call_result',
    'artifact_created',
    'eval_score_updated',
    'text_delta',
    'status'
  );
exception when duplicate_object then null;
end $$;

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid references chats(id) on delete set null,
  workflow_id uuid references files(id) on delete set null,
  type text not null default 'custom',
  prompt text not null,
  status run_status not null default 'running',
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb not null default '{}'::jsonb,
  human_inputs jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  definition_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text,
  error text,
  requested_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists runs_org_status_idx on runs (org_id, status, created_at desc);
create index if not exists runs_org_chat_idx on runs (org_id, chat_id, created_at desc) where chat_id is not null;
create unique index if not exists runs_org_idempotency_unique_idx on runs (org_id, idempotency_key) where idempotency_key is not null;

drop trigger if exists runs_set_updated_at on runs;
create trigger runs_set_updated_at
before update on runs
for each row execute function set_updated_at();

create table if not exists run_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  event_type event_type not null,
  sequence bigint not null,
  node_id text,
  node_title text,
  skill_id text,
  skill_name text,
  message text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists run_events_run_seq_idx on run_events (run_id, sequence);
create index if not exists run_events_org_node_idx on run_events (org_id, node_id) where node_id is not null;

create table if not exists run_input_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'context',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

create table if not exists run_output_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'output',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

-- ── Usage ledger ────────────────────────────────────────────

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete cascade,
  node_id text,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_ledger_org_idx on usage_ledger (org_id, created_at desc);
create index if not exists usage_ledger_run_idx on usage_ledger (run_id);

-- ── Audit log ───────────────────────────────────────────────

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_idx on audit_log (org_id, created_at desc);

-- ── Seed demo org ───────────────────────────────────────────

insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Org', 'demo')
  on conflict (id) do nothing;
