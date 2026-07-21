#!/usr/bin/env bash
# Detect this machine's LAN IPv4 and upsert AUTH_API_BASE_URL / API_BASE_URL
# into each Flutter app's gitignored config/local.dart-defines.json.
#
# Used by the VS Code / Cursor preLaunchTask "update-local-dart-defines"
# before physical-device local launches.
#
# Usage (from repo root):
#   ./scripts/update-local-dart-defines.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

detect_lan_ip() {
  local ip=""

  # Prefer the interface used for the default route (macOS / Linux).
  if command -v route >/dev/null 2>&1; then
    local iface
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)"
    if [[ -n "$iface" ]] && command -v ipconfig >/dev/null 2>&1; then
      ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
    fi
  fi

  # Common macOS Wi-Fi / Ethernet interfaces.
  if [[ -z "$ip" ]] && command -v ipconfig >/dev/null 2>&1; then
    local candidate
    for candidate in en0 en1 en2; do
      ip="$(ipconfig getifaddr "$candidate" 2>/dev/null || true)"
      [[ -n "$ip" ]] && break
    done
  fi

  # Portable fallback: UDP connect trick (does not send packets).
  if [[ -z "$ip" ]] && command -v python3 >/dev/null 2>&1; then
    ip="$(
      python3 - <<'PY' 2>/dev/null || true
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    s.connect(("8.8.8.8", 80))
    print(s.getsockname()[0])
finally:
    s.close()
PY
    )"
  fi

  # Linux: hostname -I
  if [[ -z "$ip" ]] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi

  if [[ -z "$ip" || "$ip" == "127.0.0.1" ]]; then
    cat >&2 <<EOF
Could not detect a non-loopback LAN IPv4 address.

Ensure you are connected to Wi-Fi/Ethernet, then retry.
EOF
    exit 1
  fi

  printf '%s\n' "$ip"
}

upsert_local_defines() {
  local dest="$1"
  local example="$2"
  local auth_url="$3"
  local api_url="$4"

  mkdir -p "$(dirname "$dest")"

  if [[ ! -f "$dest" ]]; then
    if [[ -f "$example" ]]; then
      cp "$example" "$dest"
    else
      echo '{}' >"$dest"
    fi
  fi

  python3 - "$dest" "$auth_url" "$api_url" <<'PY'
import json
import sys

path, auth_url, api_url = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    data = json.load(f)
if not isinstance(data, dict):
    data = {}
data["AUTH_API_BASE_URL"] = auth_url
data["API_BASE_URL"] = api_url
with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
}

LAN_IP="$(detect_lan_ip)"
AUTH_URL="http://${LAN_IP}:3001"
TM_API_URL="http://${LAN_IP}:3000"
SM_API_URL="http://${LAN_IP}:3002"

upsert_local_defines \
  "$REPO_ROOT/apps/timemanager/config/local.dart-defines.json" \
  "$REPO_ROOT/apps/timemanager/config/local.dart-defines.json.example" \
  "$AUTH_URL" \
  "$TM_API_URL"

upsert_local_defines \
  "$REPO_ROOT/apps/spendmanager/config/local.dart-defines.json" \
  "$REPO_ROOT/apps/spendmanager/config/local.dart-defines.json.example" \
  "$AUTH_URL" \
  "$SM_API_URL"

cat <<EOF
Updated local dart-defines with LAN IP ${LAN_IP}:
  AUTH_API_BASE_URL=${AUTH_URL}
  timemanager API_BASE_URL=${TM_API_URL}
  spendmanager API_BASE_URL=${SM_API_URL}
EOF
