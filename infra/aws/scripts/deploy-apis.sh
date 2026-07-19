#!/usr/bin/env bash
# Build, push API images to ECR, run migrations, force new ECS deployments.
#
# Usage (from repo root):
#   ./infra/aws/scripts/deploy-apis.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"

AWS_REGION="${AWS_REGION:-us-east-1}"
AUTH_TAG="${AUTH_TAG:-latest}"
API_TAG="${API_TAG:-latest}"

pushd infra/aws >/dev/null
ECR_AUTH="$(terraform output -raw ecr_auth_repository_url)"
ECR_API="$(terraform output -raw ecr_api_repository_url)"
CLUSTER="$(terraform output -raw ecs_cluster_name)"
MIGRATE_FAMILY="$(terraform output -raw migrate_task_definition)"
SUBNETS="$(terraform output -json private_subnet_ids | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)))')"
SG="$(terraform output -raw ecs_security_group_id)"
popd >/dev/null

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
aws ecr get-login-password --region "${AWS_REGION}" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "==> Building user-manager-api"
docker build -f apps/user-manager-api/Dockerfile -t "${ECR_AUTH}:${AUTH_TAG}" .
docker push "${ECR_AUTH}:${AUTH_TAG}"

echo "==> Building timemanager-api"
docker build -f apps/timemanager-api/Dockerfile -t "${ECR_API}:${API_TAG}" .
docker push "${ECR_API}:${API_TAG}"

echo "==> Running migrations"
TASK_ARN="$(aws ecs run-task \
  --region "${AWS_REGION}" \
  --cluster "${CLUSTER}" \
  --launch-type FARGATE \
  --task-definition "${MIGRATE_FAMILY}" \
  --network-configuration "awsvpcConfiguration={subnets=[${SUBNETS}],securityGroups=[${SG}],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' \
  --output text)"

echo "Waiting for migrate task ${TASK_ARN}..."
aws ecs wait tasks-stopped --region "${AWS_REGION}" --cluster "${CLUSTER}" --tasks "${TASK_ARN}"
EXIT_CODE="$(aws ecs describe-tasks \
  --region "${AWS_REGION}" \
  --cluster "${CLUSTER}" \
  --tasks "${TASK_ARN}" \
  --query 'tasks[0].containers[0].exitCode' \
  --output text)"
if [[ "${EXIT_CODE}" != "0" ]]; then
  echo "Migration failed with exit code ${EXIT_CODE}" >&2
  echo "Recent migrate logs:" >&2
  aws logs filter-log-events \
    --region "${AWS_REGION}" \
    --log-group-name "/ecs/${CLUSTER}/timemanager-api" \
    --log-stream-name-prefix migrate \
    --limit 40 \
    --query 'events[*].message' \
    --output text >&2 || true
  exit 1
fi

echo "==> Ensuring services desired count >= 1 and forcing new deployment"
for SVC in user-manager-api timemanager-api; do
  aws ecs update-service --region "${AWS_REGION}" --cluster "${CLUSTER}" \
    --service "${SVC}" --desired-count 1 --force-new-deployment >/dev/null
done

echo "API deploy started. Watch ECS services until stable."
