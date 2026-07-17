-- Persistent project sessions, revision lineage, and parent/child run links.
-- Harness definitions remain files. These rows only own mutable project state,
-- ordering, and durable provenance across chat turns and reloads.

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

alter table project_sessions
  add constraint project_sessions_active_revision_fk
  foreign key (active_revision_id) references project_revisions(id) on delete set null;

create index if not exists project_revisions_project_sequence_idx
  on project_revisions (project_id, sequence desc);
create index if not exists project_revisions_org_turn_idx
  on project_revisions (org_id, turn_id, created_at desc)
  where turn_id is not null;

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
