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
  result=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_extension where extname='$ext';" 2>/dev/null | tr -d ' ')
  if [ "$result" = "0" ]; then
    echo "  ✗ Extension '$ext' is missing."
    issues=$((issues + 1))
  else
    echo "  ✓ Extension '$ext' found."
  fi
}

table_exists() {
  local result
  result=$(psql "$DATABASE_URL" -At -c "select to_regclass('public.$1') is not null;" 2>/dev/null | tr -d ' ')
  [ "$result" = "t" ]
}

column_exists() {
  local result
  result=$(psql "$DATABASE_URL" -At -c "select count(*) from information_schema.columns where table_name='$1' and column_name='$2' and table_schema='public';" 2>/dev/null | tr -d ' ')
  [ "$result" != "0" ]
}

index_exists() {
  local result
  result=$(psql "$DATABASE_URL" -At -c "select count(*) from pg_indexes where indexname='$1';" 2>/dev/null | tr -d ' ')
  [ "$result" != "0" ]
}

check_ext "pgcrypto"
check_ext "citext"

echo ""
echo "→ Required tables:"
for tbl in orgs profiles files runs run_events run_metrics chats chat_messages models invitations org_credits; do
  if table_exists "$tbl"; then
    echo "  ✓ $tbl"
  else
    echo "  ✗ $tbl is missing."
    issues=$((issues + 1))
  fi
done

echo ""
echo "→ LangGraph checkpoint tables:"
for tbl in langgraph_checkpoints langgraph_checkpoint_blobs langgraph_checkpoint_writes; do
  if table_exists "$tbl"; then
    echo "  ✓ $tbl"
  else
    echo "  ✗ $tbl is missing (apply 0020_checkpoint_tables.sql)."
    issues=$((issues + 1))
  fi
done

echo ""
echo "→ Phase 2 columns:"
if column_exists runs next_event_sequence; then
  echo "  ✓ runs.next_event_sequence"
else
  echo "  ✗ runs.next_event_sequence is missing (apply 0014_event_sequence_atomic.sql)."
  issues=$((issues + 1))
fi
if column_exists runs graph_version; then
  echo "  ✓ runs.graph_version"
else
  echo "  ✗ runs.graph_version is missing (apply 0014_event_sequence_atomic.sql)."
  issues=$((issues + 1))
fi
if column_exists runs checkpoint_version; then
  echo "  ✓ runs.checkpoint_version"
else
  echo "  ✗ runs.checkpoint_version is missing (apply 0016_atomic_checkpoint.sql)."
  issues=$((issues + 1))
fi
if column_exists runs cancel_requested_at; then
  echo "  ✓ runs.cancel_requested_at"
else
  echo "  ✗ runs.cancel_requested_at is missing (apply 0010_durable_control.sql)."
  issues=$((issues + 1))
fi

echo ""
echo "→ Phase 2 event-key uniqueness:"
if index_exists run_events_run_event_key_idx; then
  echo "  ✓ run_events_run_event_key_idx"
else
  echo "  ✗ run_events_run_event_key_idx is missing (apply 0009_event_sequence.sql)."
  issues=$((issues + 1))
fi

echo ""
echo "→ Phase 4 schema:"
if psql "$DATABASE_URL" -At -c "select count(*) from pg_indexes where indexname='profiles_email_idx';" 2>/dev/null | tr -d ' ' | grep -q '^1$'; then
  echo "  ✓ profiles_email_idx"
else
  echo "  ✗ profiles_email_idx is missing (apply 0017_drop_profiles_email_unique.sql)."
  issues=$((issues + 1))
fi

echo ""
echo "→ Tenant constraint validation:"
unvalidated=$(psql "$DATABASE_URL" -At -c "
  select count(*) from pg_constraint
  where convalidated = false
    and conname like '%same_org%'
    and connamespace = (select oid from pg_namespace where nspname = 'public');
" 2>/dev/null | tr -d ' ')
if [ "$unvalidated" = "0" ]; then
  echo "  ✓ All same-workspace foreign keys are validated."
else
  echo "  ✗ $unvalidated same-workspace foreign key(s) remain NOT VALID."
  echo "    Run: select conname from pg_constraint where convalidated=false and conname like '%same_org%';"
  issues=$((issues + 1))
fi

echo ""
echo "→ Migration ledger:"
ledger_result=$(psql "$DATABASE_URL" -t -c "select to_regclass('public._migration_ledger') is not null;" 2>/dev/null | tr -d ' ')
if [ "$ledger_result" = "t" ]; then
  count=$(psql "$DATABASE_URL" -At -c "select count(*) from _migration_ledger;" 2>/dev/null | tr -d ' ')
  echo "  ✓ _migration_ledger exists ($count migrations recorded)"
else
  echo "  ✗ _migration_ledger is missing (apply 0021_migration_ledger.sql)."
  issues=$((issues + 1))
fi

echo ""
echo "→ Basic connection/query health:"
if PGOPTIONS="-c statement_timeout=10000" psql "$DATABASE_URL" -At -c "select 1;" >/dev/null 2>&1; then
  echo "  ✓ Connection and query OK"
else
  echo "  ✗ Cannot execute basic query (timeout or connection error)."
  issues=$((issues + 1))
fi

echo ""
if [ "$issues" -eq 0 ]; then
  echo "✓ All checks passed."
else
  echo "✗ $issues issue(s) found. Run npm run db:migrate to apply missing migrations."
  exit 1
fi
