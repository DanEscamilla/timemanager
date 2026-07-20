#!/usr/bin/env bash
# Wake AWS staging: start RDS → clear hibernating flag → terraform apply →
# deploy APIs + web.
#
# Usage (from repo root):
#   ./infra/aws/scripts/infra-up.sh
#   nx run timemanager-aws:up
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
# shellcheck source=load-local-env.sh
source "${ROOT}/infra/aws/scripts/load-local-env.sh"
_aws_scripts_load_local_env "${ROOT}"

AWS_REGION="${AWS_REGION:-us-east-1}"

pushd infra/aws >/dev/null
PARAM="$(terraform output -raw hibernating_parameter_name)"
RDS_ID="$(terraform output -raw rds_identifier)"
popd >/dev/null

echo "==> Starting RDS ${RDS_ID}"
STATUS="$(aws rds describe-db-instances \
  --region "${AWS_REGION}" \
  --db-instance-identifier "${RDS_ID}" \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text)"
if [[ "${STATUS}" == "stopped" ]]; then
  aws rds start-db-instance \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${RDS_ID}" >/dev/null
elif [[ "${STATUS}" == "available" || "${STATUS}" == "starting" ]]; then
  echo "RDS already ${STATUS}."
else
  echo "RDS status is ${STATUS}; attempting start..."
  aws rds start-db-instance \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${RDS_ID}" >/dev/null || true
fi

echo "==> Waiting for RDS available..."
aws rds wait db-instance-available \
  --region "${AWS_REGION}" \
  --db-instance-identifier "${RDS_ID}"

echo "==> Setting hibernating=false (${PARAM})"
aws ssm put-parameter \
  --region "${AWS_REGION}" \
  --name "${PARAM}" \
  --value "false" \
  --type String \
  --overwrite >/dev/null

echo "==> terraform apply (recreate NAT/ALB/CloudFront/DNS)"
pushd infra/aws >/dev/null
terraform apply -auto-approve
popd >/dev/null

echo "==> Deploying APIs"
"${ROOT}/infra/aws/scripts/deploy-apis.sh"

echo "==> Deploying web"
"${ROOT}/infra/aws/scripts/deploy-web.sh"

echo "==> Infra up complete."
