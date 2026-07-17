#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCAN_PATHS=(
  "$ROOT/apps/web"
  "$ROOT/packages/design-system/src/components"
  "$ROOT/packages/design-system/src/styles"
)

violations=0

check_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2

  local matches
  if matches=$(rg -n --pcre2 "$pattern" "${SCAN_PATHS[@]}" "$@" --glob '!**/email.ts' 2>/dev/null); then
    echo "$label"
    echo "$matches"
    echo
    violations=$((violations + 1))
  fi
}

check_app_pattern() {
  local label="$1"
  local pattern="$2"
  shift 2

  local matches
  if matches=$(rg -n --pcre2 "$pattern" "$ROOT/apps/web" "$@" --glob '!**/email.ts' 2>/dev/null); then
    echo "$label"
    echo "$matches"
    echo
    violations=$((violations + 1))
  fi
}

check_pattern "Arbitrary pixel typography must use a named type token:" \
  'text-\[[0-9.]+px\]' --glob '*.tsx' --glob '*.ts' --glob '*.css'

check_pattern "Arbitrary radii must use the radius scale:" \
  'rounded-\[[^]]+\]|border-radius:\s*[0-9.]' --glob '*.tsx' --glob '*.ts' --glob '*.css'

check_pattern "Motion must use shared duration and easing tokens:" \
  'duration-[0-9]+|duration-\[[0-9]+ms\]|ease-\[cubic-bezier' --glob '*.tsx' --glob '*.ts' --glob '*.css'

check_app_pattern "Application code must use the shared icon registry:" \
  "from\\s+['\\\"](@boxicons|lucide-react|react-icons)" --glob '*.tsx' --glob '*.ts'

check_pattern "Arbitrary shadows must use a named shadow token:" \
  'shadow-\[(?!var\()' --glob '*.tsx' --glob '*.ts' --glob '*.css'

if [[ $violations -gt 0 ]]; then
  echo "ui-contracts: $violations contract category failure(s)."
  exit 1
fi

echo "ui-contracts: clean."
