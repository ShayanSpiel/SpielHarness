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

for f in $(ls "$MIGRATIONS_DIR"/[0-9]*.sql | sort); do
  echo "  → $(basename "$f")"
  psql "$DATABASE_URL" -f "$f" -q -v ON_ERROR_STOP=1
done

echo "✓ Migrations applied."
