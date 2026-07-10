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
