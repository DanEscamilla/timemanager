#!/usr/bin/env bash
# Build and sync static web apps to S3 + invalidate CloudFront.
# Requires: aws CLI, flutter, pnpm/nx, terraform outputs (or env overrides).
#
# Usage (from repo root):
#   ./infra/aws/scripts/deploy-web.sh
#
# Set DOMAIN in infra/aws/.local.env (see .local.env.example), or export it.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
# shellcheck source=load-local-env.sh
source "${ROOT}/infra/aws/scripts/load-local-env.sh"
_aws_scripts_load_local_env "${ROOT}"

DOMAIN="${DOMAIN:?Set DOMAIN in infra/aws/.local.env (see .local.env.example) or export DOMAIN=example.com}"
AUTH_API_BASE_URL="${AUTH_API_BASE_URL:-https://auth.${DOMAIN}}"
API_BASE_URL="${API_BASE_URL:-https://api.${DOMAIN}}"
# spendmanager GraphQL host (API not in the ECS stack yet; reserved hostname).
SPENDMANAGER_API_BASE_URL="${SPENDMANAGER_API_BASE_URL:-https://spend-api.${DOMAIN}}"
VITE_API_DOMAIN="${VITE_API_DOMAIN:-https://auth.${DOMAIN}}"
VITE_WEBSITE_DOMAIN="${VITE_WEBSITE_DOMAIN:-https://account.${DOMAIN}}"

if [[ -z "${FLUTTER_WEB_BUCKET:-}" || -z "${SPENDMANAGER_WEB_BUCKET:-}" || -z "${USER_MANAGER_WEB_BUCKET:-}" ]]; then
  echo "Reading S3/CloudFront outputs from terraform..."
  pushd infra/aws >/dev/null
  FLUTTER_WEB_BUCKET="${FLUTTER_WEB_BUCKET:-$(terraform output -raw flutter_web_bucket)}"
  SPENDMANAGER_WEB_BUCKET="${SPENDMANAGER_WEB_BUCKET:-$(terraform output -raw spendmanager_web_bucket)}"
  USER_MANAGER_WEB_BUCKET="${USER_MANAGER_WEB_BUCKET:-$(terraform output -raw user_manager_web_bucket)}"
  FLUTTER_WEB_DISTRIBUTION_ID="${FLUTTER_WEB_DISTRIBUTION_ID:-$(terraform output -raw flutter_web_distribution_id)}"
  SPENDMANAGER_WEB_DISTRIBUTION_ID="${SPENDMANAGER_WEB_DISTRIBUTION_ID:-$(terraform output -raw spendmanager_web_distribution_id)}"
  USER_MANAGER_WEB_DISTRIBUTION_ID="${USER_MANAGER_WEB_DISTRIBUTION_ID:-$(terraform output -raw user_manager_web_distribution_id)}"
  popd >/dev/null
fi

flutter_dart_defines=(
  --dart-define="AUTH_API_BASE_URL=${AUTH_API_BASE_URL}"
  --dart-define="API_BASE_URL=${API_BASE_URL}"
)
if [[ -n "${FCM_VAPID_KEY:-}" ]]; then
  flutter_dart_defines+=(--dart-define="FCM_VAPID_KEY=${FCM_VAPID_KEY}")
fi

spendmanager_dart_defines=(
  --dart-define="AUTH_API_BASE_URL=${AUTH_API_BASE_URL}"
  --dart-define="API_BASE_URL=${SPENDMANAGER_API_BASE_URL}"
)
if [[ -n "${SPENDMANAGER_FCM_VAPID_KEY:-${FCM_VAPID_KEY:-}}" ]]; then
  spendmanager_dart_defines+=(--dart-define="FCM_VAPID_KEY=${SPENDMANAGER_FCM_VAPID_KEY:-${FCM_VAPID_KEY}}")
fi

echo "==> Building timemanager Flutter web"
(
  cd apps/timemanager
  flutter build web --release "${flutter_dart_defines[@]}"
)

echo "==> Syncing timemanager web -> s3://${FLUTTER_WEB_BUCKET}"
aws s3 sync apps/timemanager/build/web "s3://${FLUTTER_WEB_BUCKET}" --delete

echo "==> Building spendmanager Flutter web"
(
  cd apps/spendmanager
  flutter build web --release "${spendmanager_dart_defines[@]}"
)

echo "==> Syncing spendmanager web -> s3://${SPENDMANAGER_WEB_BUCKET}"
aws s3 sync apps/spendmanager/build/web "s3://${SPENDMANAGER_WEB_BUCKET}" --delete

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
  echo "==> Invalidating timemanager CloudFront ${FLUTTER_WEB_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${FLUTTER_WEB_DISTRIBUTION_ID}" \
    --paths "/*" >/dev/null
fi

if [[ -n "${SPENDMANAGER_WEB_DISTRIBUTION_ID:-}" ]]; then
  echo "==> Invalidating spendmanager CloudFront ${SPENDMANAGER_WEB_DISTRIBUTION_ID}"
  aws cloudfront create-invalidation \
    --distribution-id "${SPENDMANAGER_WEB_DISTRIBUTION_ID}" \
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
echo "  spend:   https://spend.${DOMAIN}"
echo "  account: https://account.${DOMAIN}"
