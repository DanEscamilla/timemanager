#!/usr/bin/env bash
# Build and sync static web apps to S3 + invalidate CloudFront.
# Requires: aws CLI, flutter, pnpm/nx, terraform outputs (or env overrides).
#
# Usage (from repo root):
#   export DOMAIN=example.com
#   ./infra/aws/scripts/deploy-web.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

DOMAIN="${DOMAIN:?Set DOMAIN=example.com}"
AUTH_API_BASE_URL="${AUTH_API_BASE_URL:-https://auth.${DOMAIN}}"
API_BASE_URL="${API_BASE_URL:-https://api.${DOMAIN}}"
VITE_API_DOMAIN="${VITE_API_DOMAIN:-https://auth.${DOMAIN}}"
VITE_WEBSITE_DOMAIN="${VITE_WEBSITE_DOMAIN:-https://account.${DOMAIN}}"

if [[ -z "${FLUTTER_WEB_BUCKET:-}" || -z "${USER_MANAGER_WEB_BUCKET:-}" ]]; then
  echo "Reading S3/CloudFront outputs from terraform..."
  pushd infra/aws >/dev/null
  FLUTTER_WEB_BUCKET="${FLUTTER_WEB_BUCKET:-$(terraform output -raw flutter_web_bucket)}"
  USER_MANAGER_WEB_BUCKET="${USER_MANAGER_WEB_BUCKET:-$(terraform output -raw user_manager_web_bucket)}"
  FLUTTER_WEB_DISTRIBUTION_ID="${FLUTTER_WEB_DISTRIBUTION_ID:-$(terraform output -raw flutter_web_distribution_id)}"
  USER_MANAGER_WEB_DISTRIBUTION_ID="${USER_MANAGER_WEB_DISTRIBUTION_ID:-$(terraform output -raw user_manager_web_distribution_id)}"
  popd >/dev/null
fi

echo "==> Building Flutter web"
(
  cd apps/timemanager
  flutter build web --release \
    --dart-define=AUTH_API_BASE_URL="${AUTH_API_BASE_URL}" \
    --dart-define=API_BASE_URL="${API_BASE_URL}"
)

echo "==> Syncing Flutter web -> s3://${FLUTTER_WEB_BUCKET}"
aws s3 sync apps/timemanager/build/web "s3://${FLUTTER_WEB_BUCKET}" --delete

echo "==> Building user-manager-web"
(
  cd apps/user-manager-web
  VITE_API_DOMAIN="${VITE_API_DOMAIN}" \
  VITE_WEBSITE_DOMAIN="${VITE_WEBSITE_DOMAIN}" \
    pnpm exec tsc -b && \
  VITE_API_DOMAIN="${VITE_API_DOMAIN}" \
  VITE_WEBSITE_DOMAIN="${VITE_WEBSITE_DOMAIN}" \
    pnpm exec vite build
)

echo "==> Syncing user-manager-web -> s3://${USER_MANAGER_WEB_BUCKET}"
aws s3 sync apps/user-manager-web/dist "s3://${USER_MANAGER_WEB_BUCKET}" --delete

if [[ -n "${FLUTTER_WEB_DISTRIBUTION_ID:-}" ]]; then
  echo "==> Invalidating Flutter CloudFront ${FLUTTER_WEB_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${FLUTTER_WEB_DISTRIBUTION_ID}" \
    --paths "/*" >/dev/null
fi

if [[ -n "${USER_MANAGER_WEB_DISTRIBUTION_ID:-}" ]]; then
  echo "==> Invalidating user-manager CloudFront ${USER_MANAGER_WEB_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${USER_MANAGER_WEB_DISTRIBUTION_ID}" \
    --paths "/*" >/dev/null
fi

echo "Done."
echo "  app:     https://app.${DOMAIN}"
echo "  account: https://account.${DOMAIN}"
