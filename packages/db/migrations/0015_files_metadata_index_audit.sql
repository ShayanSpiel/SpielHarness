-- Phase 2: evidence-based audit of files_metadata_idx.
--
-- The `files_metadata_idx` GIN on `(metadata jsonb_path_ops)` from
-- 0001_init.sql is on the write path of every files row update. The plan
-- required inspecting pg_stat_user_indexes before deciding to drop it.
--
-- This migration inspects the index live and drops it only when ALL of the
-- following hold for the lifetime of the index in pg_stat_user_indexes:
--   * idx_scan = 0  (no read has ever used the index)
--   * idx_tup_read = 0 and idx_tup_fetch = 0
-- If the index has been used even once, the migration is a no-op.
--
-- Inspection query (for manual review before applying):
--   select indexrelname, idx_scan, idx_tup_read, idx_tup_fetch
--   from pg_stat_user_indexes
--   where indexrelname = 'files_metadata_idx';
--
-- If you prefer to keep the index unconditionally, comment out the DO block
-- below before applying.

do $$
declare
  v_scans bigint;
  v_tup_read bigint;
  v_tup_fetch bigint;
begin
  select coalesce(max(idx_scan), 0),
         coalesce(max(idx_tup_read), 0),
         coalesce(max(idx_tup_fetch), 0)
    into v_scans, v_tup_read, v_tup_fetch
  from pg_stat_user_indexes
  where indexrelname = 'files_metadata_idx';

  if v_scans = 0 and v_tup_read = 0 and v_tup_fetch = 0 then
    raise notice 'files_metadata_idx has never been read; dropping it.';
    execute 'drop index if exists files_metadata_idx';
  else
    raise notice 'files_metadata_idx has % scans; keeping it.', v_scans;
  end if;
end
$$;
