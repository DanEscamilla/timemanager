#!/usr/bin/env bash
# Hibernate AWS staging: SSM flag → terraform destroy edge (NAT/ALB/CF/DNS) →
# ECS desired 0 → stop RDS.
#
# Usage (from repo root):
#   ./infra/aws/scripts/infra-down.sh
#   nx run timemanager-aws:down
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
CLUSTER="$(terraform output -raw ecs_cluster_name)"
popd >/dev/null

echo "==> Setting hibernating=true (${PARAM})"
aws ssm put-parameter \
  --region "${AWS_REGION}" \
  --name "${PARAM}" \
  --value "true" \
  --type String \
  --overwrite >/dev/null

echo "==> terraform apply (destroy NAT/ALB/CloudFront/DNS, ECS desired 0)"
pushd infra/aws >/dev/null
terraform apply -auto-approve
popd >/dev/null

echo "==> Ensuring ECS services desired count = 0"
for SVC in user-manager-api timemanager-api; do
  aws ecs update-service \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --service "${SVC}" \
    --desired-count 0 >/dev/null || true
done

echo "==> Stopping RDS ${RDS_ID}"
STATUS="$(aws rds describe-db-instances \
  --region "${AWS_REGION}" \
  --db-instance-identifier "${RDS_ID}" \
  --query 'DBInstances[0].DBInstanceStatus' \
  --output text)"
if [[ "${STATUS}" == "available" ]]; then
  aws rds stop-db-instance \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${RDS_ID}" >/dev/null
  echo "RDS stop initiated (status was available)."
elif [[ "${STATUS}" == "stopped" || "${STATUS}" == "stopping" ]]; then
  echo "RDS already ${STATUS}; skipping stop."
else
  echo "RDS status is ${STATUS}; attempting stop anyway..."
  aws rds stop-db-instance \
    --region "${AWS_REGION}" \
    --db-instance-identifier "${RDS_ID}" >/dev/null || true
fi

echo "==> Infra down complete (hibernating)."
echo "Note: AWS may auto-restart a stopped RDS instance after ~7 days; re-run down if needed."
