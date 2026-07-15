#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required."
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql is required. Install it via: brew install postgresql"
  exit 1
fi

echo "→ Verifying database setup..."

issues=0

check_ext() {
  local ext="$1"
  local result
  result=$(psql "$DATABASE_URL" -t -c "select count(*) from pg_extension where extname='$ext';" 2>/dev/null | tr -d ' ')
  if [ "$result" = "0" ]; then
    echo "  ✗ Extension '$ext' is missing."
    issues=$((issues + 1))
  else
    echo "  ✓ Extension '$ext' found."
  fi
}

table_exists() {
  local result
  result=$(psql "$DATABASE_URL" -t -c "select count(*) from information_schema.tables where table_name='$1' and table_schema='public';" 2>/dev/null | tr -d ' ')
  [ "$result" != "0" ]
}

check_ext "pgcrypto"
check_ext "citext"

echo ""
echo "→ Required tables:"
for tbl in orgs profiles files runs run_events chats chat_messages models; do
  if table_exists "$tbl"; then
    echo "  ✓ $tbl"
  else
    echo "  ✗ $tbl is missing."
    issues=$((issues + 1))
  fi
done

echo ""
if [ "$issues" -eq 0 ]; then
  echo "✓ All checks passed."
else
  echo "✗ $issues issue(s) found. Run npm run db:migrate to apply missing migrations."
  exit 1
fi
