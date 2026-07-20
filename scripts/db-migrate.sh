#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../packages/db/migrations" && pwd)"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required."
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql is required. Install it via: brew install postgresql"
  exit 1
fi

echo "→ Applying migrations in order..."

# Ensure the migration ledger table exists first
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
create table if not exists _migration_ledger (
  filename text primary key,
  checksum text not null,
  applied_at timestamptz not null default now()
);
" >/dev/null 2>&1 || true

applied=0
skipped=0
failed=0

for f in "$MIGRATIONS_DIR"/*.sql; do
  [ -f "$f" ] || continue
  filename=$(basename "$f")

  # skip wipe_and_seed — it's not a numbered migration
  [[ "$filename" == wipe_and_seed.sql ]] && continue

  if command -v md5 >/dev/null 2>&1; then
    checksum=$(md5 -q "$f" 2>/dev/null)
  else
    checksum=$(md5sum "$f" | awk '{print $1}')
  fi

  # Check if already applied
  existing=$(psql "$DATABASE_URL" -t -c \
    "select checksum from _migration_ledger where filename='$filename';" 2>/dev/null | tr -d ' ')

  if [ -n "$existing" ]; then
    if [ "$existing" = "$checksum" ]; then
      echo "  ✓ $filename (already applied, checksum matches)"
      skipped=$((skipped + 1))
      continue
    else
      echo "  ✗ $filename has a different checksum than when it was applied!"
      echo "    Expected: $existing"
      echo "    Actual:   $checksum"
      echo "    Re-run with --force to ignore checksum mismatch."
      failed=$((failed + 1))
      continue
    fi
  fi

  echo "  → $filename"
  if psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1; then
    psql "$DATABASE_URL" -c \
      "insert into _migration_ledger (filename, checksum) values ('$filename', '$checksum')
       on conflict (filename) do update set checksum=excluded.checksum, applied_at=now();" \
      >/dev/null 2>&1
    applied=$((applied + 1))
  else
    echo "  ✗ $filename failed!"
    failed=$((failed + 1))
  fi
done

echo ""
echo "  Applied: $applied  Skipped: $skipped  Failed: $failed"

if [ "$failed" -gt 0 ]; then
  exit 1
fi
