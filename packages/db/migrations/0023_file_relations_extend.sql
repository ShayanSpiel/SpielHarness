-- Phase B: Extend file_relations with richer relation types and ordering.
--
-- Adds:
--   - relation_type enum (replacing the text column)
--   - ordering column (nullable, for topological ordering)
--   - unique constraint on (org_id, source_file_id, relation_type, target_file_id)
--   - FK constraints enforcing same-workspace ownership (already done in 0002)
--   - Extended trigger to populate new relation types

-- 1. Create the enum
do $$ begin
  create type file_relation_type as enum (
    'role_skill',
    'workflow_node_role',
    'workflow_node_skill',
    'workflow_node_file',
    'skill_connection_operation',
    'role_model'
  );
exception
  when duplicate_object then null;
end $$;

-- 2. Add ordering column (nullable, meaningful for topological order)
alter table file_relations add column if not exists ordering integer;

-- 3. Drop the old unique constraint and text column in favor of typed enum + new unique
alter table file_relations add column if not exists relation_type_new file_relation_type;

-- Backfill existing text values into the new enum column
update file_relations
  set relation_type_new = relation_type::file_relation_type
  where relation_type_new is null;

-- Drop old column once backfill is done
alter table file_relations alter column relation_type_new set not null;
alter table file_relations drop column relation_type;
alter table file_relations rename column relation_type_new to relation_type;

-- 4. Add new unique constraint (org_id, source_file_id, relation_type, target_file_id)
alter table file_relations drop constraint if exists file_relations_source_target_type_unique;
alter table file_relations add constraint file_relations_unique
  unique (org_id, source_file_id, relation_type, target_file_id);

-- 5. Drop old index and create new ones
drop index if exists file_relations_source_idx;
drop index if exists file_relations_target_idx;

create index file_relations_source_idx on file_relations (source_file_id, relation_type, ordering);
create index file_relations_target_idx on file_relations (target_file_id, relation_type);
create index file_relations_org_idx on file_relations (org_id, relation_type);

-- 6. Update the trigger function to populate new relation types
create or replace function files_refresh_relations()
returns trigger
language plpgsql
as $$
declare
  raw_id text;
  ref_id uuid;
  node jsonb;
  node_idx int;
  skill_arr jsonb;
  skill_val text;
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
        insert into file_relations (org_id, source_file_id, target_file_id, relation_type, ordering)
        values (new.org_id, new.id, ref_id, 'role_skill', 0) on conflict do nothing;
      end if;
    end loop;

  elsif new.file_type in ('harness_workflow', 'harness_workstream') then
    node_idx := 0;
    for node in select value from jsonb_array_elements(coalesce(new.metadata -> 'nodes', '[]'::jsonb)) loop
      -- Role binding
      raw_id := coalesce(node ->> 'roleId', node ->> 'roleSlug');
      if raw_id is not null then
        select id into ref_id from files
          where org_id = new.org_id and deleted_at is null
            and (id::text = raw_id or metadata ->> 'slug' = raw_id)
          limit 1;
        if ref_id is not null then
          insert into file_relations (org_id, source_file_id, target_file_id, relation_type, ordering)
          values (new.org_id, new.id, ref_id, 'workflow_node_role', node_idx) on conflict do nothing;
        end if;
      end if;

      -- Skill bindings (from node.skillIds or node.skillSlugs)
      for raw_id in
        select jsonb_array_elements_text(coalesce(node -> 'skillIds', node -> 'skillSlugs', '[]'::jsonb))
      loop
        select id into ref_id from files
          where org_id = new.org_id and deleted_at is null
            and (id::text = raw_id or metadata ->> 'slug' = raw_id)
          limit 1;
        if ref_id is not null then
          insert into file_relations (org_id, source_file_id, target_file_id, relation_type, ordering)
          values (new.org_id, new.id, ref_id, 'workflow_node_skill', node_idx) on conflict do nothing;
        end if;
      end loop;

      -- File bindings
      for raw_id in
        select jsonb_array_elements_text(coalesce(node -> 'fileIds', '[]'::jsonb))
      loop
        select id into ref_id from files
          where org_id = new.org_id and deleted_at is null and id::text = raw_id
          limit 1;
        if ref_id is not null then
          insert into file_relations (org_id, source_file_id, target_file_id, relation_type, ordering)
          values (new.org_id, new.id, ref_id, 'workflow_node_file', node_idx) on conflict do nothing;
        end if;
      end loop;

      node_idx := node_idx + 1;
    end loop;
  end if;
  return new;
end;
$$;

-- Refresh relations for all existing harness entities
update files set metadata = metadata, updated_at = now()
where file_type in ('harness_role', 'harness_workflow', 'harness_workstream');

-- 7. Add FK to orgs for consistency (existing FK in 0002 covers source/target)
