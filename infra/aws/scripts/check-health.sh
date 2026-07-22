#!/usr/bin/env bash
# Check health of AWS-deployed APIs, static sites, and (when AWS CLI works) ECS/ALB.
#
# Usage (from repo root):
#   ./infra/aws/scripts/check-health.sh
#   ./infra/aws/scripts/check-health.sh --http-only
#   ./infra/aws/scripts/check-health.sh --aws-only
#
# Set DOMAIN (and optional AWS_REGION / ECS_CLUSTER) in infra/aws/.local.env
# (see .local.env.example). Inline env vars still override the file.
#
# Exit 0 only when every enabled check passes.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
# shellcheck source=load-local-env.sh
source "${ROOT}/infra/aws/scripts/load-local-env.sh"
_aws_scripts_load_local_env "${ROOT}"

AWS_REGION="${AWS_REGION:-us-east-1}"
HTTP_ONLY=0
AWS_ONLY=0
TIMEOUT="${TIMEOUT:-10}"

for arg in "$@"; do
  case "$arg" in
    --http-only) HTTP_ONLY=1 ;;
    --aws-only) AWS_ONLY=1 ;;
    -h|--help)
      sed -n '2,12p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

PASS=0
FAIL=0
SKIP=0

ok() {
  PASS=$((PASS + 1))
  printf '  OK   %s\n' "$1"
}

fail() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
}

skip() {
  SKIP=$((SKIP + 1))
  printf '  SKIP %s\n' "$1"
}

resolve_domain() {
  if [[ -n "${DOMAIN:-}" ]]; then
    echo "${DOMAIN}"
    return
  fi

  if [[ -d infra/aws ]] && command -v terraform >/dev/null 2>&1; then
    local host
    host="$(
      cd infra/aws
      terraform output -json hostnames 2>/dev/null \
        | python3 -c 'import json,sys; print(json.load(sys.stdin)["auth"])' 2>/dev/null \
        || true
    )"
    if [[ -n "${host}" && "${host}" == auth.* ]]; then
      echo "${host#auth.}"
      return
    fi
  fi

  echo ""
}

http_expect() {
  local label="$1"
  local url="$2"
  local expect_code="$3"
  local expect_body="${4:-}" # substring match; empty = ignore body

  local body_file status
  body_file="$(mktemp)"
  status="$(curl -sS -o "${body_file}" -w '%{http_code}' -m "${TIMEOUT}" \
    -H 'accept: */*' \
    "${url}" 2>/dev/null || echo "000")"

  if [[ "${status}" != "${expect_code}" ]]; then
    fail "${label} (HTTP ${status}, expected ${expect_code}) — ${url}"
    rm -f "${body_file}"
    return
  fi

  if [[ -n "${expect_body}" ]] && ! grep -qF "${expect_body}" "${body_file}"; then
    fail "${label} (body missing '${expect_body}') — ${url}"
    rm -f "${body_file}"
    return
  fi

  ok "${label} (HTTP ${status}) — ${url}"
  rm -f "${body_file}"
}

http_post_expect() {
  local label="$1"
  local url="$2"
  local data="$3"
  local expect_code="$4"

  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' -m "${TIMEOUT}" \
    -X POST \
    -H 'content-type: application/json' \
    -d "${data}" \
    "${url}" 2>/dev/null || echo "000")"

  if [[ "${status}" != "${expect_code}" ]]; then
    fail "${label} (HTTP ${status}, expected ${expect_code}) — ${url}"
    return
  fi
  ok "${label} (HTTP ${status}) — ${url}"
}

check_http() {
  local domain="$1"
  local auth="https://auth.${domain}"
  local api="https://api.${domain}"
  local app="https://app.${domain}"
  local spend="https://spend.${domain}"
  local account="https://account.${domain}"

  echo "==> HTTP endpoints (${domain})"
  http_expect "auth /hello" "${auth}/hello" "200" "hello"
  http_expect "auth JWKS" "${auth}/auth/jwt/jwks.json" "200" "keys"
  http_expect "api /health" "${api}/health" "200" '"ok"'
  http_post_expect "api GraphQL (unauth → 401)" "${api}/graphql" \
    '{"query":"{__typename}"}' "401"
  http_expect "app (timemanager web)" "${app}/" "200"
  http_expect "spend (spendmanager web)" "${spend}/" "200"
  http_expect "account (user-manager-web)" "${account}/" "200"
}

aws_available() {
  command -v aws >/dev/null 2>&1 && aws sts get-caller-identity --region "${AWS_REGION}" >/dev/null 2>&1
}

check_aws() {
  echo "==> AWS / ECS (${AWS_REGION})"

  if ! aws_available; then
    skip "AWS CLI not authenticated — skipping ECS/ALB checks"
    return
  fi

  local cluster
  cluster="${ECS_CLUSTER:-}"
  if [[ -z "${cluster}" ]]; then
    cluster="$(cd infra/aws && terraform output -raw ecs_cluster_name 2>/dev/null || true)"
  fi
  if [[ -z "${cluster}" ]]; then
    # Fall back to the only cluster matching the project name.
    cluster="$(aws ecs list-clusters --region "${AWS_REGION}" \
      --query 'clusterArns[?contains(@, `timemanager`)] | [0]' --output text 2>/dev/null || true)"
    cluster="${cluster##*/}"
  fi

  if [[ -z "${cluster}" || "${cluster}" == "None" ]]; then
    fail "could not resolve ECS cluster (set ECS_CLUSTER=...)"
    return
  fi

  ok "cluster ${cluster}"

  local svc desired running pending
  for svc in user-manager-api timemanager-api; do
    read -r desired running pending <<<"$(aws ecs describe-services \
      --region "${AWS_REGION}" --cluster "${cluster}" --services "${svc}" \
      --query 'services[0].[desiredCount,runningCount,pendingCount]' --output text 2>/dev/null \
      || echo "err err err")"

    if [[ "${desired}" == "err" ]]; then
      fail "ECS ${svc} (describe failed)"
      continue
    fi

    if [[ "${desired}" -lt 1 ]]; then
      fail "ECS ${svc} desired=${desired} running=${running} pending=${pending} (scaled to zero)"
    elif [[ "${running}" -lt 1 ]]; then
      fail "ECS ${svc} desired=${desired} running=${running} pending=${pending}"
    else
      ok "ECS ${svc} desired=${desired} running=${running} pending=${pending}"
    fi
  done

  local tg_name tg_arn healthy unhealthy
  for tg_name in "${cluster}-auth" "${cluster}-api"; do
    tg_arn="$(aws elbv2 describe-target-groups --region "${AWS_REGION}" --names "${tg_name}" \
      --query 'TargetGroups[0].TargetGroupArn' --output text 2>/dev/null || echo "")"
    if [[ -z "${tg_arn}" || "${tg_arn}" == "None" ]]; then
      fail "target group ${tg_name} not found"
      continue
    fi

    # Count healthy vs actively bad. Ignore draining (normal during rollouts).
    healthy="$(aws elbv2 describe-target-health --region "${AWS_REGION}" \
      --target-group-arn "${tg_arn}" \
      --query 'length(TargetHealthDescriptions[?TargetHealth.State==`healthy`])' --output text)"
    unhealthy="$(aws elbv2 describe-target-health --region "${AWS_REGION}" \
      --target-group-arn "${tg_arn}" \
      --query 'length(TargetHealthDescriptions[?TargetHealth.State==`unhealthy` || TargetHealth.State==`unused`])' --output text)"

    if [[ "${healthy}" -eq 0 ]]; then
      fail "ALB ${tg_name}: 0 healthy targets"
      aws elbv2 describe-target-health --region "${AWS_REGION}" \
        --target-group-arn "${tg_arn}" \
        --query 'TargetHealthDescriptions[*].{id:Target.Id,state:TargetHealth.State,reason:TargetHealth.Reason}' \
        --output table || true
    elif [[ "${unhealthy}" -gt 0 ]]; then
      fail "ALB ${tg_name}: ${healthy} healthy, ${unhealthy} unhealthy"
      aws elbv2 describe-target-health --region "${AWS_REGION}" \
        --target-group-arn "${tg_arn}" \
        --query 'TargetHealthDescriptions[*].{id:Target.Id,state:TargetHealth.State,reason:TargetHealth.Reason}' \
        --output table || true
    else
      ok "ALB ${tg_name}: ${healthy} healthy"
    fi
  done
}

DOMAIN="$(resolve_domain)"
if [[ "${AWS_ONLY}" -eq 0 && -z "${DOMAIN}" ]]; then
  echo "Set DOMAIN in infra/aws/.local.env (see .local.env.example), export DOMAIN=…, or ensure terraform hostnames output is available." >&2
  exit 2
fi

if [[ "${AWS_ONLY}" -eq 0 ]]; then
  check_http "${DOMAIN}"
fi

if [[ "${HTTP_ONLY}" -eq 0 ]]; then
  check_aws
fi

echo ""
echo "Summary: ${PASS} passed, ${FAIL} failed, ${SKIP} skipped"
if [[ "${FAIL}" -gt 0 ]]; then
  exit 1
fi
