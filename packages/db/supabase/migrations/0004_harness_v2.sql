-- SpielOS harness extension v2
-- Adds: human_input skill kind, prompt statuses, line-source fields,
-- run.human_inputs and run.inputs columns, broader file_type values.

-- Add more file_type values for harness resources
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

-- files: nullable to remove the requirement that every file has body
alter table files alter column body set default '';

-- run inputs / outputs / human_inputs as proper jsonb columns
alter table runs
  add column if not exists inputs jsonb not null default '{}'::jsonb,
  add column if not exists outputs jsonb not null default '{}'::jsonb,
  add column if not exists human_inputs jsonb not null default '{}'::jsonb,
  add column if not exists workstream_id uuid references graph_templates(id) on delete set null;

create index if not exists runs_org_status_idx on runs (org_id, status, created_at desc);

-- run_events: add skill column for skill-scoped events
alter table run_events
  add column if not exists skill text,
  add column if not exists node text;

create index if not exists run_events_run_skill_idx on run_events (run_id, skill, created_at);

-- workstream checkpoints column (for human_input resume)
alter table runs
  add column if not exists checkpoint jsonb not null default '{}'::jsonb;

-- role ↔ skill join table for the new role.skillIds array
create table if not exists role_skills (
  org_id uuid not null references orgs(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  skill_id uuid not null references tools(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, skill_id)
);
