#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="packages/db/migrations"
DATABASE_URL="${DATABASE_URL:-}"

if [ -z "$DATABASE_URL" ]; then
  echo "ERROR: DATABASE_URL environment variable is required."
  exit 1
fi

if ! command -v psql &>/dev/null; then
  echo "ERROR: psql is required. Install it via: brew install postgresql"
  exit 1
fi

echo "→ Applying migrations in order..."

for f in "$MIGRATIONS_DIR"/0001_init.sql \
          "$MIGRATIONS_DIR"/0002_tenant_integrity.sql \
          "$MIGRATIONS_DIR"/0005_auth_and_credits.sql \
          "$MIGRATIONS_DIR"/0006_betterauth_tables.sql \
          "$MIGRATIONS_DIR"/0007_fix_profiles_to_text.sql \
          "$MIGRATIONS_DIR"/0008_simplify_roles.sql \
          "$MIGRATIONS_DIR"/0009_event_sequence.sql \
          "$MIGRATIONS_DIR"/0010_durable_control.sql; do
  if [ -f "$f" ]; then
    echo "  → $(basename "$f")"
    psql "$DATABASE_URL" -f "$f" -q 1>/dev/null
  fi
done

echo "✓ Migrations applied."
