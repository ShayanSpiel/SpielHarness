-- Track applied migrations by filename and checksum.
-- The corresponding db-migrate.sh records every file it applies here,
-- and refuses to reapply a previously-applied migration unless the
-- checksum matches (indicating a legitimate update to the migration).

create table if not exists _migration_ledger (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
