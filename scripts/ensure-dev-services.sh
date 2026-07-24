#!/usr/bin/env bash
# Ensure shared local-dev services are up, then serve any extra Nx projects.
# Skips services that already respond on their health endpoints so a second
# terminal can reuse `pnpm services` without EADDRINUSE.
#
# Usage:
#   scripts/ensure-dev-services.sh [nx-project ...]
# Examples:
#   scripts/ensure-dev-services.sh timemanager-api timemanager
#   scripts/ensure-dev-services.sh spendmanager-api spendmanager
#   scripts/ensure-dev-services.sh mailbox-api mailbox-worker

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

healthy() {
  local url="$1"
  curl -sf --max-time 1 "$url" >/dev/null 2>&1
}

list_contains() {
  local needle="$1"
  shift
  local item
  for item in "$@"; do
    if [[ "$item" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

missing=()
skipped=()

if healthy "http://localhost:3001/hello"; then
  skipped+=("user-manager-api")
  echo "skip  user-manager-api (:3001 already healthy)"
else
  missing+=("user-manager-api")
  echo "start user-manager-api (:3001)"
fi

if healthy "http://localhost:3004/health"; then
  skipped+=("ai-api")
  echo "skip  ai-api (:3004 already healthy)"
else
  missing+=("ai-api")
  echo "start ai-api (:3004)"
fi

# Mailbox API + worker are a unit: worker has no HTTP port; avoid double pollers.
if healthy "http://localhost:3003/health"; then
  skipped+=("mailbox-api" "mailbox-worker")
  echo "skip  mailbox-api + mailbox-worker (:3003 already healthy)"
else
  missing+=("mailbox-api" "mailbox-worker")
  echo "start mailbox-api + mailbox-worker (:3003)"
fi

products=()
for project in "$@"; do
  if list_contains "$project" "${skipped[@]+"${skipped[@]}"}"; then
    echo "skip  ${project} (already covered by healthy shared service)"
    continue
  fi
  if list_contains "$project" "${missing[@]+"${missing[@]}"}"; then
    continue
  fi
  if list_contains "$project" "${products[@]+"${products[@]}"}"; then
    continue
  fi
  products+=("$project")
  echo "start ${project}"
done

to_start=("${missing[@]+"${missing[@]}"}" "${products[@]+"${products[@]}"}")

if [[ ${#to_start[@]} -eq 0 ]]; then
  echo "All requested shared services are already up; nothing to start."
  exit 0
fi

if [[ ${#to_start[@]} -eq 1 ]]; then
  exec nx serve "${to_start[0]}"
fi

joined="$(IFS=,; echo "${to_start[*]}")"
exec nx run-many -t serve -p "$joined"
