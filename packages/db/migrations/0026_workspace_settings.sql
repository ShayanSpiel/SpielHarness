-- Phase F: One Workspace Settings Authority
--
-- Creates a canonical workspace_settings table that replaces file-based
-- runtime policy and scattered defaults.

create table if not exists workspace_settings (
  org_id uuid primary key references orgs(id) on delete cascade,
  default_execution_mode text not null default 'director',
  default_model_id uuid references models(id) on delete set null,
  context_limits jsonb not null default '{"maxInputTokens": 100000, "maxOutputTokens": 100000}'::jsonb,
  retrieval_policy jsonb not null default '{"knowledgeSearchLimit": 10, "memoryRetrievalLimit": 8}'::jsonb,
  director_runtime_policy jsonb not null default '{}'::jsonb,
  approval_policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill from legacy runtime policy files
do $$
declare
  policy_file record;
  policy_json jsonb;
begin
  for policy_file in
    select f.org_id, f.body
    from files f
    where f.file_type = 'prompt'
      and f.metadata ->> 'runtimePolicy' = 'true'
      and f.deleted_at is null
  loop
    begin
      policy_json := policy_file.body::jsonb;
    exception when others then
      policy_json := '{}'::jsonb;
    end;
    insert into workspace_settings (org_id, director_runtime_policy)
    values (policy_file.org_id, policy_json)
    on conflict (org_id) do update set
      director_runtime_policy = excluded.director_runtime_policy;
  end loop;
end;
$$;
