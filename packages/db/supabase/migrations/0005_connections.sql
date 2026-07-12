-- User-configurable external connections and workspace variables.
-- Secret values remain in the deployment environment; only their variable names are stored.
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

create trigger connections_set_updated_at
before update on connections
for each row execute function set_updated_at();

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

create trigger workspace_variables_set_updated_at
before update on workspace_variables
for each row execute function set_updated_at();
