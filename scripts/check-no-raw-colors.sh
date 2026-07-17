#!/usr/bin/env bash
# SpielOS no-raw-colors guard.
#
# Scans apps/web and packages/*/src for color usage that should come from
# design tokens. Run via `npm run check:colors` from apps/web.
#
# Allowed exceptions:
#   - packages/design-system/src/tokens/** (where tokens live)
#   - this script
#   - node_modules, .next, build output

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_WEB="$ROOT/apps/web"

if [[ ! -d "$APP_WEB" ]]; then
  echo "no-raw-colors: apps/web not found at $APP_WEB" >&2
  exit 1
fi

SCAN_PATHS=(
  "$APP_WEB/app"
  "$APP_WEB/components"
  "$APP_WEB/lib"
  "$APP_WEB/hooks"
  "$ROOT/packages/core/src"
  "$ROOT/packages/graph/src"
  "$ROOT/packages/evals/src"
)

# We do NOT scan the design-system tokens folder; that is where raw colors live.
EXCLUDE_PATHS=(
  "$ROOT/packages/design-system/src/tokens"
)

EXCLUDES=()
for path in "${EXCLUDE_PATHS[@]}"; do
  EXCLUDES+=(--exclude-dir="$(basename "$path")")
done

violations=0
patterns=(
  'text-(red|green|blue|yellow|orange|purple|pink|slate|gray|zinc|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose|lime)-[0-9]+'
  'bg-(red|green|blue|yellow|orange|purple|pink|slate|gray|zinc|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose|lime)-[0-9]+'
  'border-(red|green|blue|yellow|orange|purple|pink|slate|gray|zinc|neutral|stone|amber|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose|lime)-[0-9]+'
  'ring-(red|green|blue|yellow|orange|purple|pink|slate|gray|zinc|neutral|stone)-[0-9]+'
  '#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?\b'
  'rgba?\('
  'hsla?\('
)

for pattern in "${patterns[@]}"; do
  # shellcheck disable=SC2086
  if matches=$(grep -RInE --include="*.ts" --include="*.tsx" --include="*.css" "${EXCLUDES[@]}" "$pattern" "${SCAN_PATHS[@]}" 2>/dev/null); then
    while IFS= read -r line; do
      # Skip allowed exceptions: design-system tokens folder & base styles
      if echo "$line" | grep -qE "(design-system/src/tokens|design-system/src/styles/base.css|check-no-raw-colors.sh|apps/web/lib/email.ts)"; then
        # Transactional email clients require inline CSS and cannot consume
        # the application token variables. Keep this exception server-only.
        continue
      fi
      # Skip false positives: hex-like patterns inside strings like "gruvbox-dark" word
      if echo "$line" | grep -qE "(gruvbox-dark|gruvbox-light|monochrome-dark|monochrome-light)"; then
        continue
      fi
      echo "  $line"
      violations=$((violations + 1))
    done <<< "$matches"
  fi
done

if [[ $violations -gt 0 ]]; then
  echo
  echo "no-raw-colors: $violations hardcoded color(s) found."
  echo "Move them to packages/design-system/src/tokens and reference via semantic tokens."
  exit 1
fi

echo "no-raw-colors: clean."
