#!/usr/bin/env bash
set -euo pipefail

echo "→ Wiping data and reapplying migrations..."
bash "$(dirname "$0")/db-migrate.sh"

echo ""
echo "→ Seeding..."
bash "$(dirname "$0")/db-seed.sh"

echo ""
echo "✓ Reset complete. Start the server and run: curl -X POST http://localhost:3000/api/harness/seed"
