-- SpielOS graph templates + versioned workstreams
-- The 0001 schema already has graph_templates; we add versioning
-- and a join table for nodes/edges so they can be versioned.

create table graph_template_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  graph_template_id uuid not null references graph_templates(id) on delete cascade,
  version integer not null,
  name text not null,
  description text not null default '',
  definition jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (graph_template_id, version),
  check (version > 0)
);

create index graph_template_versions_template_idx
  on graph_template_versions (graph_template_id, version desc);

create trigger graph_template_versions_set_updated_at
before update on graph_template_versions
for each row execute function set_updated_at();

-- Add status + current_version to graph_templates
alter table graph_templates
  add column if not exists current_version integer not null default 1,
  add column if not exists status text not null default 'active';

-- Audit log helper
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
