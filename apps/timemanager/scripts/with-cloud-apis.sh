#!/usr/bin/env bash
# Resolve cloud API URLs and run flutter with --dart-define overrides.
#
# Resolution order:
#   1. AUTH_API_BASE_URL / API_BASE_URL if both are set
#   2. config/cloud.dart-defines.json (AUTH_API_BASE_URL + API_BASE_URL keys)
#   3. DOMAIN → https://auth.$DOMAIN and https://api.$DOMAIN
#
# Usage (from apps/timemanager or via Nx):
#   DOMAIN=example.com ./scripts/with-cloud-apis.sh build web --release
#   DOMAIN=example.com ./scripts/with-cloud-apis.sh run -d chrome --web-port=4444
set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFINES_FILE="${CLOUD_DART_DEFINES_FILE:-$APP_DIR/config/cloud.dart-defines.json}"

auth=""
api=""

if [[ -n "${AUTH_API_BASE_URL:-}" && -n "${API_BASE_URL:-}" ]]; then
  auth="$AUTH_API_BASE_URL"
  api="$API_BASE_URL"
elif [[ -f "$DEFINES_FILE" ]]; then
  # Prefer jq when present; fall back to python for portability.
  if command -v jq >/dev/null 2>&1; then
    auth="$(jq -r '.AUTH_API_BASE_URL // empty' "$DEFINES_FILE")"
    api="$(jq -r '.API_BASE_URL // empty' "$DEFINES_FILE")"
  else
    read -r auth api < <(python3 - "$DEFINES_FILE" <<'PY'
import json, sys
with open(sys.argv[1]) as f:
    data = json.load(f)
print(data.get("AUTH_API_BASE_URL", ""), data.get("API_BASE_URL", ""))
PY
)
  fi
elif [[ -n "${DOMAIN:-}" ]]; then
  auth="https://auth.${DOMAIN}"
  api="https://api.${DOMAIN}"
fi

if [[ -z "$auth" || -z "$api" ]]; then
  cat >&2 <<EOF
Cloud API URLs are not configured.

Set one of:
  export DOMAIN=example.com
  export AUTH_API_BASE_URL=https://auth.example.com API_BASE_URL=https://api.example.com
  cp config/cloud.dart-defines.json.example config/cloud.dart-defines.json  # then edit
EOF
  exit 1
fi

echo "Flutter cloud APIs:"
echo "  AUTH_API_BASE_URL=$auth"
echo "  API_BASE_URL=$api"

cd "$APP_DIR"
exec flutter "$@" \
  --dart-define="AUTH_API_BASE_URL=$auth" \
  --dart-define="API_BASE_URL=$api"
