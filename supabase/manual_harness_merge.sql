-- Supabase SQL Editor migration: add harness_workstream to file_type enum.
-- This file is the single source of truth for SQL-level schema drift.
-- Run in Supabase SQL editor when the migration needs merging.
-- Then apply packages/db/migrations/0002_tenant_integrity.sql to enforce
-- same-workspace foreign keys on existing installations.

-- Step 1: Add harness_workstream to the file_type enum if not present
do $$
begin
  if not exists (
    select 1 from pg_enum
    join pg_type on pg_enum.enumtypid = pg_type.oid
    where pg_type.typname = 'file_type'
      and pg_enum.enumlabel = 'harness_workstream'
  ) then
    alter type file_type add value 'harness_workstream';
  end if;
end
$$;

-- Recompute file relations by touching metadata. Updating only updated_at does
-- not fire the UPDATE OF metadata trigger.
create or replace function refresh_harness_file_relations(target_org_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update files set metadata = metadata, updated_at = now()
  where org_id = target_org_id
    and file_type in ('harness_role', 'harness_workflow', 'harness_workstream');
$$;

-- Step 2: Backfill existing files that may have been inserted with a text cast
-- (no-op for now; will be used if legacy data needs migration)
