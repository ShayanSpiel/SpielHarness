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

echo "→ Seeding demo org..."
psql "$DATABASE_URL" -f "packages/db/migrations/wipe_and_seed.sql" -q 1>/dev/null

echo "→ Calling /api/harness/seed to populate file-backed content..."
if command -v curl &>/dev/null; then
  curl -s -X POST "http://localhost:3000/api/harness/seed" \
    -H "Content-Type: application/json" \
    -H "Cookie: $(cat .env.local 2>/dev/null | grep -o 'better-auth[^;]*' || true)" \
    1>/dev/null 2>&1 || echo "  ⚠ Seed API call failed (expected if server not running). Run manually: curl -X POST http://localhost:3000/api/harness/seed"
fi

echo "✓ Seed complete."
