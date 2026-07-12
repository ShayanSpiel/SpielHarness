-- Manual SpielOS Postgres merge for file-backed harness integration.
-- Run this in the Supabase SQL editor before reseeding.

create extension if not exists pgcrypto;
create extension if not exists citext;

alter type file_type add value if not exists 'harness_role';
alter type file_type add value if not exists 'harness_skill';
alter type file_type add value if not exists 'harness_workstream';
alter type file_type add value if not exists 'harness_eval';
alter type file_type add value if not exists 'harness_template';
alter type file_type add value if not exists 'harness_chat_message';

alter type run_status add value if not exists 'waiting_human';

alter type event_type add value if not exists 'skill_started';
alter type event_type add value if not exists 'skill_completed';
alter type event_type add value if not exists 'human_input_requested';
alter type event_type add value if not exists 'human_input_received';
alter type event_type add value if not exists 'run_cancelled';

alter table files alter column body set default '';
alter table files alter column content_format set default 'markdown';

alter table runs
  add column if not exists inputs jsonb not null default '{}'::jsonb,
  add column if not exists outputs jsonb not null default '{}'::jsonb,
  add column if not exists human_inputs jsonb not null default '{}'::jsonb,
  add column if not exists workstream_id uuid references graph_templates(id) on delete set null,
  add column if not exists checkpoint jsonb not null default '{}'::jsonb;

create index if not exists runs_org_status_idx on runs (org_id, status, created_at desc);

alter table run_events
  add column if not exists skill text,
  add column if not exists node text;

create index if not exists run_events_run_skill_idx on run_events (run_id, skill, created_at);

create table if not exists role_skills (
  org_id uuid not null references orgs(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  skill_id uuid not null references tools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, skill_id)
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('oauth', 'mcp', 'api', 'builtin')),
  status text not null default 'configured' check (status in ('configured', 'needs_secret', 'disabled')),
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

create table if not exists workspace_variables (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  value text,
  kind text not null default 'variable' check (kind in ('variable', 'secret_ref')),
  description text not null default '',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

drop view if exists harness_files;
create view harness_files as
select
  f.id,
  f.org_id,
  f.folder_id,
  f.file_type,
  f.status,
  f.title,
  f.body,
  f.metadata,
  f.created_at,
  f.updated_at
from files f
where f.file_type in (
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
  'harness_workstream',
  'harness_eval',
  'harness_template',
  'harness_chat_message'
)
and f.status <> 'deleted';

create or replace function write_audit(
  p_org_id uuid,
  p_actor_id uuid,
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before jsonb,
  p_after jsonb
) returns void
language plpgsql
as $$
begin
  insert into audit_log (org_id, actor_id, action, entity_type, entity_id, before, after)
  values (p_org_id, p_actor_id, p_action, p_entity_type, p_entity_id, p_before, p_after);
end;
$$;

-- Production reconciliation (mirrors migration 0006 essentials).
alter table roles add column if not exists status file_status not null default 'active';
update roles set status = case when enabled then 'active'::file_status else 'archived'::file_status end;

alter table runs
  add column if not exists definition_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists idempotency_key text,
  add column if not exists requested_by uuid references profiles(id) on delete set null;

create unique index if not exists runs_org_idempotency_unique_idx
  on runs (org_id, idempotency_key) where idempotency_key is not null;

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete set null, provider text not null, model text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(), org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete set null, amount_micros bigint not null,
  entry_type text not null check (entry_type in ('grant','purchase','reserve','release','charge','refund','adjustment')),
  idempotency_key text not null, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), unique (org_id, idempotency_key)
);

create table if not exists billing_customers (
  org_id uuid primary key references orgs(id) on delete cascade, provider text not null,
  external_customer_id text not null, subscription_status text not null default 'inactive',
  plan_key text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (provider, external_customer_id)
);

create table if not exists file_relations (
  org_id uuid not null references orgs(id) on delete cascade,
  source_file_id uuid not null references files(id) on delete cascade,
  target_file_id uuid not null references files(id) on delete cascade,
  relation_type text not null, position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  primary key (source_file_id, target_file_id, relation_type), check (source_file_id <> target_file_id)
);

-- Run packages/db/supabase/migrations/0006_production_foundation.sql in full
-- to install relation-refresh triggers, Supabase Auth profile sync, RLS policies,
-- and all production indexes. Those security statements are intentionally kept
-- in the versioned migration as the authoritative deployment source.
