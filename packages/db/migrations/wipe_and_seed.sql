-- SpielOS: wipe everything, recreate schema, seed demo org.
-- WARNING: This is DESTRUCTIVE. Drops ALL existing objects and data.
-- Run this when you want a completely fresh database.

-- ── Step 1: Drop triggers ────────────────────────────────────

drop trigger if exists files_search_vector_trigger on files;
drop trigger if exists files_version_insert on files;
drop trigger if exists files_version_update on files;
drop trigger if exists files_set_updated_at on files;
drop trigger if exists folders_set_updated_at on folders;
drop trigger if exists orgs_set_updated_at on orgs;
drop trigger if exists profiles_set_updated_at on profiles;
drop trigger if exists files_refresh_relations on files;
drop trigger if exists models_set_updated_at on models;
drop trigger if exists connections_set_updated_at on connections;
drop trigger if exists workspace_variables_set_updated_at on workspace_variables;
drop trigger if exists chats_set_updated_at on chats;
drop trigger if exists runs_set_updated_at on runs;

-- ── Step 2: Drop functions ───────────────────────────────────

drop function if exists files_set_search_vector() cascade;
drop function if exists files_version_snapshot() cascade;
drop function if exists set_updated_at() cascade;
drop function if exists files_refresh_relations() cascade;
drop function if exists refresh_harness_file_relations(uuid) cascade;

-- ── Step 3: Drop tables (reverse dependency order) ──────────

drop table if exists audit_log cascade;
drop table if exists usage_ledger cascade;
drop table if exists run_output_files cascade;
drop table if exists run_input_files cascade;
drop table if exists run_events cascade;
drop table if exists runs cascade;
drop table if exists chat_messages cascade;
drop table if exists chats cascade;
drop table if exists workspace_variables cascade;
drop table if exists connections cascade;
drop table if exists models cascade;
drop table if exists file_relations cascade;
drop table if exists file_versions cascade;
drop table if exists files cascade;
drop table if exists folders cascade;
drop table if exists org_memberships cascade;
drop table if exists profiles cascade;
drop table if exists orgs cascade;

-- Legacy / pre-migration tables (clean slate)
drop table if exists file_chunks cascade;
drop table if exists file_lineage cascade;
drop table if exists generated_files cascade;
drop table if exists chat_context_files cascade;
drop table if exists eval_reports cascade;
drop table if exists role_skills cascade;
drop table if exists role_tools cascade;
drop table if exists tools cascade;
drop table if exists graph_template_versions cascade;
drop table if exists graph_templates cascade;
drop table if exists roles cascade;
drop table if exists model_providers cascade;

-- ── Step 4: Drop types (enums) ───────────────────────────────

drop type if exists event_type cascade;
drop type if exists run_status cascade;
drop type if exists chat_role cascade;
drop type if exists variable_kind cascade;
drop type if exists connection_status cascade;
drop type if exists connection_kind cascade;
drop type if exists file_status cascade;
drop type if exists file_type cascade;
drop type if exists membership_role cascade;

-- ═══════════════════════════════════════════════════════════════
-- SCHEMA (mirrors 0001_init.sql)
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ── Tenancy ──────────────────────────────────────────────────

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug citext not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type membership_role as enum ('owner', 'admin', 'editor', 'viewer');

create table org_memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);

-- ── Folders ─────────────────────────────────────────────────

create table folders (
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

create index folders_org_idx on folders (org_id, sort_order) where deleted_at is null;

-- ── Files ───────────────────────────────────────────────────

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

create type file_status as enum ('draft', 'active', 'archived', 'deleted');

create table files (
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

create index files_org_type_status_idx on files (org_id, file_type, status) where deleted_at is null;
create index files_org_updated_idx on files (org_id, updated_at desc) where deleted_at is null;
create index files_search_idx on files using gin (search_vector);
create index files_metadata_idx on files using gin (metadata jsonb_path_ops);

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

create trigger files_search_vector_trigger
before insert or update of title, body on files
for each row execute function files_set_search_vector();

-- ── File versions ───────────────────────────────────────────

create table file_versions (
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

create index file_versions_file_version_idx on file_versions (file_id, version desc);

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

create trigger files_version_insert
after insert on files
for each row execute function files_version_snapshot();

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

create trigger files_set_updated_at
before update on files
for each row execute function set_updated_at();

create trigger folders_set_updated_at
before update on folders
for each row execute function set_updated_at();

create trigger orgs_set_updated_at
before update on orgs
for each row execute function set_updated_at();

create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

-- ── File relations ──────────────────────────────────────────

create table file_relations (
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

create index file_relations_source_idx on file_relations (source_file_id, relation_type, position);
create index file_relations_target_idx on file_relations (target_file_id, relation_type);

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

create trigger files_refresh_relations
after insert or update of metadata, file_type, status, deleted_at on files
for each row execute function files_refresh_relations();

-- ── Models ──────────────────────────────────────────────────

create table models (
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

create trigger models_set_updated_at
before update on models
for each row execute function set_updated_at();

-- ── Connections ─────────────────────────────────────────────

create type connection_kind as enum ('oauth', 'mcp', 'api', 'builtin');
create type connection_status as enum ('configured', 'needs_secret', 'disabled');

create table connections (
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

create trigger connections_set_updated_at
before update on connections
for each row execute function set_updated_at();

-- ── Workspace variables ─────────────────────────────────────

create type variable_kind as enum ('variable', 'secret_ref');

create table workspace_variables (
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

create trigger workspace_variables_set_updated_at
before update on workspace_variables
for each row execute function set_updated_at();

-- ── Chats ───────────────────────────────────────────────────

create table chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null default 'New chat',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index chats_org_updated_idx on chats (org_id, updated_at desc) where archived_at is null;

create trigger chats_set_updated_at
before update on chats
for each row execute function set_updated_at();

create type chat_role as enum ('user', 'assistant', 'system', 'tool');

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  role chat_role not null,
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_created_idx on chat_messages (chat_id, created_at);

-- ── Runs ────────────────────────────────────────────────────

create type run_status as enum ('running', 'waiting_human', 'completed', 'failed', 'cancelled');

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

create table runs (
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

create index runs_org_status_idx on runs (org_id, status, created_at desc);
create index runs_org_chat_idx on runs (org_id, chat_id, created_at desc) where chat_id is not null;
create unique index runs_org_idempotency_unique_idx on runs (org_id, idempotency_key) where idempotency_key is not null;

create trigger runs_set_updated_at
before update on runs
for each row execute function set_updated_at();

create table run_events (
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

create index run_events_run_seq_idx on run_events (run_id, sequence);
create index run_events_org_node_idx on run_events (org_id, node_id) where node_id is not null;

create table run_input_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'context',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

create table run_output_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'output',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

-- ── Usage ledger ────────────────────────────────────────────

create table usage_ledger (
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

create index usage_ledger_org_idx on usage_ledger (org_id, created_at desc);
create index usage_ledger_run_idx on usage_ledger (run_id);

-- ── Audit log ───────────────────────────────────────────────

create table audit_log (
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

create index audit_log_org_idx on audit_log (org_id, created_at desc);

-- ═══════════════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════════════

-- Demo org
insert into orgs (id, name, slug) values
  ('00000000-0000-0000-0000-000000000001', 'Demo Org', 'demo')
  on conflict (id) do nothing;

-- ── Seed content files ───────────────────────────────────────
-- After running this SQL, call the seed API to populate the rest:
--   curl -X POST http://localhost:3000/api/harness/seed
--
-- This reads supabase/seed/ (agents, skills, workflows, templates, system)
-- and creates corresponding rows in the files table.
