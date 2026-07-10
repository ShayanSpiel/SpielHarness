-- SpielOS foundation schema
-- File-first backend: strategy, prompts, artifacts, knowledge, drafts, and evidence
-- are all rows in files with a semantic file_type.

create extension if not exists pgcrypto;
create extension if not exists citext;

create type membership_role as enum ('owner', 'admin', 'editor', 'viewer');
create type file_type as enum (
  'knowledge',
  'strategy',
  'prompt',
  'artifact',
  'draft',
  'evidence',
  'asset',
  'eval_report',
  'publish_package'
);
create type file_status as enum ('draft', 'active', 'archived', 'deleted');
create type run_type as enum ('eval', 'content', 'ads', 'research', 'strategy', 'custom');
create type run_status as enum ('draft', 'running', 'waiting', 'completed', 'failed', 'cancelled');
create type event_type as enum (
  'node_started',
  'node_status',
  'tool_call_started',
  'tool_call_result',
  'artifact_created',
  'eval_score_updated',
  'human_approval_requested',
  'node_completed',
  'run_completed',
  'run_failed'
);
create type chat_message_role as enum ('system', 'user', 'assistant', 'tool');
create type tool_side_effect as enum ('none', 'read', 'write', 'external');
create type publish_status as enum ('queued', 'published', 'failed', 'cancelled');

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger orgs_set_updated_at
before update on orgs
for each row execute function set_updated_at();

create table profiles (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique,
  display_name text,
  avatar_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on profiles
for each row execute function set_updated_at();

create table org_memberships (
  org_id uuid not null references orgs(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  role membership_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (org_id, profile_id)
);

create table folders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  parent_id uuid references folders(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index folders_org_parent_idx on folders (org_id, parent_id, sort_order, name);
create unique index folders_org_parent_name_unique_idx
on folders (org_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name))
where deleted_at is null;

create trigger folders_set_updated_at
before update on folders
for each row execute function set_updated_at();

create table files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  folder_id uuid references folders(id) on delete set null,
  file_type file_type not null default 'knowledge',
  status file_status not null default 'draft',
  title text not null,
  body text not null default '',
  content_format text not null default 'html',
  storage_path text,
  source_url text,
  current_version integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  updated_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check (current_version > 0)
);

create index files_org_folder_idx on files (org_id, folder_id, updated_at desc);
create index files_org_type_idx on files (org_id, file_type, status);
create index files_search_idx on files using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, ''))
);

create trigger files_set_updated_at
before update on files
for each row execute function set_updated_at();

create table file_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  version integer not null,
  title text not null,
  body text not null default '',
  content_format text not null default 'html',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (file_id, version),
  check (version > 0)
);

create index file_versions_file_version_idx on file_versions (file_id, version desc);

create table file_chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  version integer not null,
  chunk_index integer not null,
  body text not null,
  token_count integer,
  metadata jsonb not null default '{}'::jsonb,
  embedding double precision[],
  created_at timestamptz not null default now(),
  unique (file_id, version, chunk_index),
  check (embedding is null or cardinality(embedding) = 1536)
);

create index file_chunks_file_idx on file_chunks (file_id, version, chunk_index);

create table model_providers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  base_url text,
  secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create trigger model_providers_set_updated_at
before update on model_providers
for each row execute function set_updated_at();

create table models (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  provider_id uuid not null references model_providers(id) on delete cascade,
  label text not null,
  model text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, provider_id, model)
);

create trigger models_set_updated_at
before update on models
for each row execute function set_updated_at();

create table tools (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text not null default '',
  input_schema jsonb not null default '{}'::jsonb,
  output_schema jsonb not null default '{}'::jsonb,
  side_effect tool_side_effect not null default 'none',
  provider_config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);

create trigger tools_set_updated_at
before update on tools
for each row execute function set_updated_at();

create table roles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  description text not null default '',
  prompt text not null default '',
  model_id uuid references models(id) on delete set null,
  memory_policy text[] not null default '{}',
  input_file_types file_type[] not null default '{}',
  output_file_types file_type[] not null default '{}',
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);

create trigger roles_set_updated_at
before update on roles
for each row execute function set_updated_at();

create table role_tools (
  org_id uuid not null references orgs(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  tool_id uuid not null references tools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, tool_id)
);

create table graph_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  run_type run_type not null default 'custom',
  definition jsonb not null default '{}'::jsonb,
  editable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);

create trigger graph_templates_set_updated_at
before update on graph_templates
for each row execute function set_updated_at();

create table chats (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  title text not null default 'New chat',
  created_by uuid references profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create index chats_org_updated_idx on chats (org_id, updated_at desc);

create trigger chats_set_updated_at
before update on chats
for each row execute function set_updated_at();

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  role chat_message_role not null,
  body text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index chat_messages_chat_created_idx on chat_messages (chat_id, created_at);

create table chat_context_files (
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, file_id)
);

create table chat_context_roles (
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid not null references chats(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (chat_id, role_id)
);

create table runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  chat_id uuid references chats(id) on delete set null,
  graph_template_id uuid references graph_templates(id) on delete set null,
  run_type run_type not null default 'custom',
  prompt text not null default '',
  status run_status not null default 'draft',
  selected_scope jsonb not null default '{}'::jsonb,
  checkpoint jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index runs_org_created_idx on runs (org_id, created_at desc);
create index runs_chat_created_idx on runs (chat_id, created_at desc);

create trigger runs_set_updated_at
before update on runs
for each row execute function set_updated_at();

create table run_roles (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_id, role_id)
);

create table run_input_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'input',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

create table run_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  event_type event_type not null,
  node text,
  message text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index run_events_run_created_idx on run_events (run_id, created_at);

create table generated_files (
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  relationship text not null default 'output',
  created_at timestamptz not null default now(),
  primary key (run_id, file_id, relationship)
);

create table file_lineage (
  org_id uuid not null references orgs(id) on delete cascade,
  child_file_id uuid not null references files(id) on delete cascade,
  parent_file_id uuid not null references files(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (child_file_id, parent_file_id),
  check (child_file_id <> parent_file_id)
);

create table eval_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  file_id uuid references files(id) on delete set null,
  score integer not null check (score between 0 and 100),
  findings jsonb not null default '[]'::jsonb,
  recommendations jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index eval_reports_org_created_idx on eval_reports (org_id, created_at desc);

create table publish_targets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  provider text not null,
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);

create trigger publish_targets_set_updated_at
before update on publish_targets
for each row execute function set_updated_at();

create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  target_id uuid not null references publish_targets(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  status publish_status not null default 'queued',
  scheduled_at timestamptz,
  published_at timestamptz,
  external_id text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index publish_jobs_org_status_idx on publish_jobs (org_id, status, scheduled_at);

create trigger publish_jobs_set_updated_at
before update on publish_jobs
for each row execute function set_updated_at();

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references orgs(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_org_created_idx on audit_log (org_id, created_at desc);

-- Seed a demo org so local development works immediately.
insert into orgs (id, name, slug)
values ('00000000-0000-0000-0000-000000000001', 'Demo Org', 'demo')
on conflict (id) do nothing;

insert into folders (id, org_id, name, sort_order)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Sessions', 10),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Notes', 20),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Evidence', 30),
  ('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Drafts', 40),
  ('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', 'Assets', 50)
on conflict (id) do nothing;

insert into files (id, org_id, folder_id, file_type, status, title, body, metadata)
values
  (
    '20000000-0000-0000-0000-000000000001',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'strategy',
    'draft',
    'Brand Strategy',
    'Positioning, category narrative, proof, and differentiation.',
    '{"seed": true}'::jsonb
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'prompt',
    'active',
    'Editor Prompt',
    'Score the draft for clarity, grounding, proof, voice fit, and publish readiness.',
    '{"seed": true}'::jsonb
  )
on conflict (id) do nothing;
