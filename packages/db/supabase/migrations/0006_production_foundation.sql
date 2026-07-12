-- Production foundation: reconcile legacy schema, enforce tenancy, and add
-- durable usage/billing primitives. File-backed harness resources remain the
-- canonical editable definitions.

alter table roles add column if not exists status file_status not null default 'active';
update roles set status = case when enabled then 'active'::file_status else 'archived'::file_status end;
create index if not exists roles_org_status_idx on roles (org_id, status, updated_at desc);
create index if not exists files_org_updated_idx on files (org_id, updated_at desc) where status <> 'deleted';
create index if not exists chat_messages_org_chat_created_idx on chat_messages (org_id, chat_id, created_at);

-- Composite identity keys prevent a child row from carrying one tenant's
-- org_id while referencing another tenant's parent id.
create unique index if not exists files_id_org_unique_idx on files (id, org_id);
create unique index if not exists chats_id_org_unique_idx on chats (id, org_id);
create unique index if not exists runs_id_org_unique_idx on runs (id, org_id);
create unique index if not exists roles_id_org_unique_idx on roles (id, org_id);
create unique index if not exists tools_id_org_unique_idx on tools (id, org_id);

alter table chat_messages drop constraint if exists chat_messages_chat_org_fk;
alter table chat_messages add constraint chat_messages_chat_org_fk
  foreign key (chat_id, org_id) references chats(id, org_id) on delete cascade not valid;
alter table run_events drop constraint if exists run_events_run_org_fk;
alter table run_events add constraint run_events_run_org_fk
  foreign key (run_id, org_id) references runs(id, org_id) on delete cascade not valid;
alter table generated_files drop constraint if exists generated_files_run_org_fk;
alter table generated_files add constraint generated_files_run_org_fk
  foreign key (run_id, org_id) references runs(id, org_id) on delete cascade not valid;
alter table generated_files drop constraint if exists generated_files_file_org_fk;
alter table generated_files add constraint generated_files_file_org_fk
  foreign key (file_id, org_id) references files(id, org_id) on delete cascade not valid;
alter table run_input_files drop constraint if exists run_input_files_run_org_fk;
alter table run_input_files add constraint run_input_files_run_org_fk
  foreign key (run_id, org_id) references runs(id, org_id) on delete cascade not valid;
alter table run_input_files drop constraint if exists run_input_files_file_org_fk;
alter table run_input_files add constraint run_input_files_file_org_fk
  foreign key (file_id, org_id) references files(id, org_id) on delete cascade not valid;

-- Explicit, queryable relations replace opaque ids embedded only in metadata.
-- Metadata remains a portable representation; this table is the integrity and
-- lookup layer used by runtime compilation.
create table if not exists file_relations (
  org_id uuid not null references orgs(id) on delete cascade,
  source_file_id uuid not null references files(id) on delete cascade,
  target_file_id uuid not null references files(id) on delete cascade,
  relation_type text not null,
  position integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (source_file_id, target_file_id, relation_type),
  check (source_file_id <> target_file_id)
);
create index if not exists file_relations_org_source_idx
  on file_relations (org_id, source_file_id, relation_type, position);
create index if not exists file_relations_org_target_idx
  on file_relations (org_id, target_file_id, relation_type);

create or replace function resolve_harness_file_ref(target_org_id uuid, raw_ref text)
returns uuid
language sql
stable
as $$
  select id from files
  where org_id = target_org_id and status <> 'deleted'
    and (id::text = raw_ref or metadata ->> 'slug' = raw_ref)
  order by (id::text = raw_ref) desc
  limit 1;
$$;

create or replace function refresh_harness_file_relations()
returns trigger
language plpgsql
as $$
declare
  raw_id text;
  node jsonb;
  relation text;
begin
  delete from file_relations where source_file_id = new.id;
  if new.status <> 'active' then return new; end if;

  if new.file_type = 'harness_role' then
    for raw_id in select jsonb_array_elements_text(coalesce(new.metadata -> 'skillIds', new.metadata -> 'skillSlugs', '[]'::jsonb)) loop
      insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
      select new.org_id, new.id, f.id, 'role_skill' from files f
      where f.id = resolve_harness_file_ref(new.org_id, raw_id)
      on conflict do nothing;
    end loop;
  elsif new.file_type = 'harness_workstream' then
    for node in select value from jsonb_array_elements(coalesce(new.metadata -> 'nodes', '[]'::jsonb)) loop
      foreach relation in array array['roleId', 'fileIds', 'skillIds'] loop
        if relation = 'roleId' then
          raw_id := coalesce(node ->> 'roleId', node ->> 'roleSlug');
          if raw_id is not null then
            insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
            select new.org_id, new.id, f.id, 'workflow_role' from files f
            where f.id = resolve_harness_file_ref(new.org_id, raw_id) on conflict do nothing;
          end if;
        else
          for raw_id in select jsonb_array_elements_text(coalesce(
            node -> relation,
            case relation when 'skillIds' then node -> 'skillSlugs' else '[]'::jsonb end,
            '[]'::jsonb
          )) loop
              insert into file_relations (org_id, source_file_id, target_file_id, relation_type)
              select new.org_id, new.id, f.id,
                case relation when 'skillIds' then 'workflow_skill' else 'workflow_input' end
              from files f where f.id = resolve_harness_file_ref(new.org_id, raw_id) on conflict do nothing;
          end loop;
        end if;
      end loop;
    end loop;
  end if;
  return new;
end;
$$;
drop trigger if exists files_refresh_harness_relations on files;
create trigger files_refresh_harness_relations
after insert or update of metadata, file_type, status on files
for each row execute function refresh_harness_file_relations();

create or replace function rebuild_harness_file_relations(target_org_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update files set metadata = metadata
  where org_id = target_org_id and file_type in ('harness_role', 'harness_workstream');
$$;
revoke all on function rebuild_harness_file_relations(uuid) from public, anon, authenticated;
grant execute on function rebuild_harness_file_relations(uuid) to service_role;

-- Every file is a versioned marketing object. The body is the portable human-
-- editable representation; structuredData/objectType in metadata are optional.
create or replace view marketing_objects with (security_invoker = true) as
select
  f.id, f.org_id, f.folder_id,
  coalesce(nullif(f.metadata ->> 'objectType', ''), f.file_type::text) as object_type,
  f.file_type, f.status, f.title, f.body,
  coalesce(f.metadata -> 'structuredData', '{}'::jsonb) as structured_data,
  f.current_version, f.metadata, f.created_at, f.updated_at
from files f
where f.status <> 'deleted';

create or replace view harness_files with (security_invoker = true) as
select f.id, f.org_id, f.folder_id, f.file_type, f.status, f.title, f.body,
       f.metadata, f.created_at, f.updated_at
from files f
where f.file_type in (
  'knowledge','strategy','prompt','artifact','draft','evidence','asset',
  'eval_report','publish_package','harness_role','harness_eval','harness_skill',
  'harness_workstream','harness_template','harness_chat_message'
) and f.status <> 'deleted';

create or replace function version_marketing_object()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    insert into file_versions (org_id, file_id, version, title, body, content_format, metadata, created_by)
    values (new.org_id, new.id, new.current_version, new.title, new.body, new.content_format, new.metadata, new.created_by)
    on conflict (file_id, version) do nothing;
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
drop trigger if exists files_version_marketing_object_insert on files;
create trigger files_version_marketing_object_insert
after insert on files for each row execute function version_marketing_object();
drop trigger if exists files_version_marketing_object_update on files;
create trigger files_version_marketing_object_update
before update of title, body, content_format, metadata on files
for each row execute function version_marketing_object();

insert into file_versions (org_id, file_id, version, title, body, content_format, metadata, created_by)
select f.org_id, f.id, f.current_version, f.title, f.body, f.content_format, f.metadata, f.created_by
from files f
on conflict (file_id, version) do nothing;

-- Immutable execution definition snapshot and idempotency are prerequisites
-- for reproducible runs, retries, usage attribution, and credit settlement.
alter table runs
  add column if not exists definition_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists idempotency_key text,
  add column if not exists requested_by uuid references profiles(id) on delete set null;
create unique index if not exists runs_org_idempotency_unique_idx
  on runs (org_id, idempotency_key) where idempotency_key is not null;

create table if not exists usage_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  provider text not null,
  model text not null,
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists usage_ledger_org_created_idx on usage_ledger (org_id, created_at desc);
create index if not exists usage_ledger_run_idx on usage_ledger (run_id, created_at);

create table if not exists credit_ledger (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  run_id uuid references runs(id) on delete set null,
  amount_micros bigint not null,
  entry_type text not null check (entry_type in ('grant', 'purchase', 'reserve', 'release', 'charge', 'refund', 'adjustment')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, idempotency_key)
);
create index if not exists credit_ledger_org_created_idx on credit_ledger (org_id, created_at desc);

create or replace function credit_balance_micros(target_org_id uuid)
returns bigint
language sql
stable
security invoker
as $$
  select coalesce(sum(amount_micros), 0)::bigint from credit_ledger where org_id = target_org_id;
$$;

create or replace function reserve_credits(
  target_org_id uuid,
  target_run_id uuid,
  amount bigint,
  request_key text
) returns bigint
language plpgsql
security definer set search_path = public
as $$
declare
  balance bigint;
begin
  if amount <= 0 then raise exception 'reservation amount must be positive'; end if;
  if auth.uid() is not null and not public.is_org_member(target_org_id) then
    raise exception 'workspace access denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org_id::text, 0));
  select credit_balance_micros(target_org_id) into balance;
  if balance < amount then raise exception 'insufficient credits'; end if;
  insert into credit_ledger (org_id, run_id, amount_micros, entry_type, idempotency_key)
  values (target_org_id, target_run_id, -amount, 'reserve', request_key)
  on conflict (org_id, idempotency_key) do nothing;
  return credit_balance_micros(target_org_id);
end;
$$;

create or replace function settle_credits(
  target_org_id uuid,
  target_run_id uuid,
  reserved_amount bigint,
  charged_amount bigint,
  request_key text
) returns bigint
language plpgsql
security definer set search_path = public
as $$
begin
  if reserved_amount < 0 or charged_amount < 0 then raise exception 'amounts cannot be negative'; end if;
  if auth.uid() is not null and not public.is_org_member(target_org_id) then
    raise exception 'workspace access denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(target_org_id::text, 0));
  insert into credit_ledger (org_id, run_id, amount_micros, entry_type, idempotency_key)
  values
    (target_org_id, target_run_id, reserved_amount, 'release', request_key || ':release'),
    (target_org_id, target_run_id, -charged_amount, 'charge', request_key || ':charge')
  on conflict (org_id, idempotency_key) do nothing;
  return credit_balance_micros(target_org_id);
end;
$$;
revoke all on function reserve_credits(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function settle_credits(uuid, uuid, bigint, bigint, text) from public, anon, authenticated;
grant execute on function reserve_credits(uuid, uuid, bigint, text) to service_role;
grant execute on function settle_credits(uuid, uuid, bigint, bigint, text) to service_role;

create table if not exists billing_customers (
  org_id uuid primary key references orgs(id) on delete cascade,
  provider text not null,
  external_customer_id text not null,
  subscription_status text not null default 'inactive',
  plan_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, external_customer_id)
);
drop trigger if exists billing_customers_set_updated_at on billing_customers;
create trigger billing_customers_set_updated_at
before update on billing_customers
for each row execute function set_updated_at();

-- Supabase Auth users and application profiles share an id.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.email, new.id::text || '@users.invalid'),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = coalesce(excluded.display_name, profiles.display_name),
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url);
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_org_member(target_org_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from org_memberships
    where org_id = target_org_id and profile_id = auth.uid()
  );
$$;

-- Defense in depth. Server routes still scope every privileged query by org_id.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'orgs','profiles','org_memberships','folders','files','file_versions','file_chunks',
    'model_providers','models','tools','roles','role_tools','role_skills',
    'graph_templates','graph_template_versions','chats','chat_messages',
    'chat_context_files','chat_context_roles','runs','run_roles','run_input_files',
    'run_events','generated_files','file_lineage','file_relations','eval_reports',
    'publish_targets','publish_jobs','audit_log','connections','workspace_variables',
    'usage_ledger','credit_ledger','billing_customers'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I enable row level security', table_name);
    end if;
  end loop;
end $$;

-- Tables with org_id share one membership policy. Service-role maintenance is
-- unaffected because it bypasses RLS.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'org_memberships','folders','files','file_versions','file_chunks',
    'model_providers','models','tools','roles','role_tools','role_skills',
    'graph_templates','graph_template_versions','chats','chat_messages',
    'chat_context_files','chat_context_roles','runs','run_roles','run_input_files',
    'run_events','generated_files','file_lineage','file_relations','eval_reports',
    'publish_targets','publish_jobs','audit_log','connections','workspace_variables',
    'usage_ledger','credit_ledger','billing_customers'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('drop policy if exists org_member_access on public.%I', table_name);
      execute format(
        'create policy org_member_access on public.%I for all using (public.is_org_member(org_id)) with check (public.is_org_member(org_id))',
        table_name
      );
    end if;
  end loop;
end $$;

drop policy if exists org_member_access on orgs;
create policy org_member_access on orgs
for all using (public.is_org_member(id)) with check (public.is_org_member(id));

drop policy if exists profile_self_access on profiles;
create policy profile_self_access on profiles
for all using (id = auth.uid()) with check (id = auth.uid());
