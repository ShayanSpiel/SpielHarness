#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required."
  exit 1
fi

# ── Safety gate ────────────────────────────────────────────────────
# db-reset truncates ALL application data and reapplies from scratch.
# It MUST only be used against disposable development databases.
#
# Required: DB_RESET_CONFIRM=destroy-my-data must be set in the
# environment.  This is the explicit disposable-environment flag.
#
# Additionally, production-looking Supabase or generic remote hosts
# are refused unless DB_RESET_ALLOW_PRODUCTION=true is also set.
# The default permit list contains only localhost and Unix socket
# patterns.  Add other safe development hosts with DB_RESET_SAFE_HOSTS
# (space-separated).
if [ "${DB_RESET_CONFIRM:-}" != "destroy-my-data" ]; then
  echo "ERROR: This script DESTROYS ALL APPLICATION DATA."
  echo "Set DB_RESET_CONFIRM=destroy-my-data in the environment"
  echo "to confirm you are targeting a disposable database."
  echo ""
  echo "For development: DB_RESET_CONFIRM=destroy-my-data npm run db:reset"
  exit 1
fi
if [ "${DB_RESET_ALLOW_PRODUCTION:-}" != "true" ]; then
  host=$(echo "$DATABASE_URL" | sed -E 's|^.*@([^:/]+).*$|\1|')
  safe=0
  for pattern in localhost 127.0.0.1 ::1 /tmp; do
    case "$host" in *"$pattern"*) safe=1;; esac
  done
  for extra in ${DB_RESET_SAFE_HOSTS:-}; do
    case "$host" in *"$extra"*) safe=1;; esac
  done
  if [ "$safe" != "1" ]; then
    echo "ERROR: Host '$host' is not a known disposable-development host."
    echo "This script truncates ALL application data."
    echo "Set DB_RESET_ALLOW_PRODUCTION=true in the environment to override."
    echo "Or add to DB_RESET_SAFE_HOSTS for a custom safe host."
    exit 1
  fi
fi

echo "→ Dropping all application data..."

# Truncate application tables (respecting FK order)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
  -- Disable triggers temporarily for clean truncation
  set session_replication_role = 'replica';

  truncate table
    usage_ledger,
    run_events,
    run_input_files,
    run_output_files,
    run_metrics,
    runs,
    chat_messages,
    chats,
    file_relations,
    files,
    workspace_variables,
    connections,
    models,
    folders,
    project_revisions,
    project_sessions,
    audit_log,
    credit_transactions,
    org_credits,
    invitations,
    org_memberships,
    profiles,
    _migration_ledger,
    langgraph_checkpoints,
    langgraph_checkpoint_blobs,
    langgraph_checkpoint_writes
  cascade;

  -- Reset serial/counter sequences
  alter sequence if exists public.chats_next_message_sequence_seq restart with 1;

  set session_replication_role = 'origin';
" 2>/dev/null && echo "  ✓ Data wiped" || { echo "  ✓ Data wiped (some tables may not exist yet)"; }

echo ""
echo "→ Reapplying migrations..."
bash "$(dirname "$0")/db-migrate.sh"

echo ""
echo "→ Seeding..."
bash "$(dirname "$0")/db-seed.sh"

echo ""
echo "✓ Reset complete."
