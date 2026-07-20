-- Validate previously NOT VALID same-workspace foreign keys.
-- All legacy rows are confirmed clean (0 orphans), so validation is safe.

do $$
declare
  rec record;
begin
  for rec in
    select conname, conrelid::regclass::text as tbl
    from pg_constraint
    where convalidated = false
      and conname like '%same_org%'
      and connamespace = (select oid from pg_namespace where nspname = 'public')
  loop
    execute format('alter table %I validate constraint %I', rec.tbl, rec.conname);
    raise notice 'validated % on %', rec.conname, rec.tbl;
  end loop;
end
$$;

-- Verify all are now validated
do $$
declare
  remaining int;
begin
  select count(*) into remaining
  from pg_constraint
  where convalidated = false
    and conname like '%same_org%'
    and connamespace = (select oid from pg_namespace where nspname = 'public');
  if remaining > 0 then
    raise exception '% same-workspace foreign key(s) remain unvalidated.', remaining;
  end if;
end
$$;
