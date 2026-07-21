#!/usr/bin/env bash
# Pick an active ECS service, then either open an interactive shell (ECS Exec)
# or tail live CloudWatch logs.
#
# Usage (from repo root):
#   ./infra/aws/scripts/ecs-shell.sh
#   ./infra/aws/scripts/ecs-shell.sh --logs
#   ./infra/aws/scripts/ecs-shell.sh --shell --service timemanager-api
#   ./infra/aws/scripts/ecs-shell.sh --logs --service user-manager-api
#   ./infra/aws/scripts/ecs-shell.sh --shell --command /bin/bash
#
# Shell mode requires the Session Manager plugin and ECS Exec on the service
# (enable_execute_command + task-role ssmmessages in infra/aws/ecs.tf).
# After enabling Exec in Terraform, force a new deployment so tasks pick it up.
#
# Optional env (infra/aws/.local.env): AWS_REGION, ECS_CLUSTER
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
# shellcheck source=load-local-env.sh
source "${ROOT}/infra/aws/scripts/load-local-env.sh"
_aws_scripts_load_local_env "${ROOT}"

AWS_REGION="${AWS_REGION:-us-east-1}"
COMMAND="${ECS_SHELL_COMMAND:-/bin/sh}"
SERVICE_ARG=""
MODE="" # shell | logs (empty = prompt)

usage() {
  sed -n '2,16p' "$0"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --shell)
      MODE="shell"
      shift
      ;;
    --logs|--log|--tail)
      MODE="logs"
      shift
      ;;
    --command=*)
      COMMAND="${1#--command=}"
      shift
      ;;
    --command)
      [[ $# -ge 2 ]] || { echo "Missing value for --command" >&2; exit 2; }
      COMMAND="$2"
      shift 2
      ;;
    --service=*)
      SERVICE_ARG="${1#--service=}"
      shift
      ;;
    --service)
      [[ $# -ge 2 ]] || { echo "Missing value for --service" >&2; exit 2; }
      SERVICE_ARG="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

resolve_cluster() {
  local cluster
  cluster="${ECS_CLUSTER:-}"
  if [[ -z "${cluster}" ]]; then
    cluster="$(cd infra/aws && terraform output -raw ecs_cluster_name 2>/dev/null || true)"
  fi
  if [[ -z "${cluster}" ]]; then
    cluster="$(aws ecs list-clusters --region "${AWS_REGION}" \
      --query 'clusterArns[?contains(@, `timemanager`)] | [0]' --output text 2>/dev/null || true)"
    cluster="${cluster##*/}"
  fi
  if [[ -z "${cluster}" || "${cluster}" == "None" ]]; then
    echo "Could not resolve ECS cluster (set ECS_CLUSTER=... or apply Terraform)." >&2
    exit 1
  fi
  echo "${cluster}"
}

prompt_choice() {
  local prompt="$1"
  local max="$2"
  local choice
  while true; do
    printf '%s' "${prompt}" >&2
    read -r choice
    if [[ "${choice}" =~ ^[0-9]+$ ]] && ((choice >= 1 && choice <= max)); then
      echo "${choice}"
      return
    fi
    echo "Enter a number between 1 and ${max}." >&2
  done
}

pick_task() {
  # Sets SELECTED_TASK from TASK_ARNS (global).
  if [[ "${#TASK_ARNS[@]}" -eq 1 ]]; then
    SELECTED_TASK="${TASK_ARNS[0]}"
    return
  fi

  # Bash 3.2 (macOS default) has no mapfile; read lines into the array.
  local task_rows=() i idx task_arn last_status started_at container_name line
  while IFS= read -r line || [[ -n "${line}" ]]; do
    task_rows+=("${line}")
  done < <(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${TASK_ARNS[@]}" \
    --query 'tasks[*].[taskArn,lastStatus,startedAt,containers[0].name]' \
    --output text)
  echo ""
  echo "Running tasks:"
  for i in "${!task_rows[@]}"; do
    read -r task_arn last_status started_at container_name <<<"${task_rows[$i]}"
    printf '  %d) %s  status=%s  started=%s  container=%s\n' \
      "$((i + 1))" "${task_arn##*/}" "${last_status}" "${started_at}" "${container_name}"
  done
  idx="$(prompt_choice "Choose task [1-${#task_rows[@]}]: " "${#task_rows[@]}")"
  read -r SELECTED_TASK _ <<<"${task_rows[$((idx - 1))]}"
}

resolve_log_group() {
  # Prefer logConfiguration from the running task definition; fall back to
  # the conventional /ecs/<cluster>/<service> name used in terraform.
  local task_def log_group
  task_def="$(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${1}" \
    --query 'tasks[0].taskDefinitionArn' \
    --output text)"
  log_group="$(aws ecs describe-task-definition \
    --region "${AWS_REGION}" \
    --task-definition "${task_def}" \
    --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' \
    --output text 2>/dev/null || true)"
  if [[ -z "${log_group}" || "${log_group}" == "None" ]]; then
    log_group="/ecs/${CLUSTER}/${SELECTED_SERVICE}"
  fi
  echo "${log_group}"
}

open_shell() {
  local container enable_exec agent_status

  if ! command -v session-manager-plugin >/dev/null 2>&1; then
    echo "session-manager-plugin is required for ECS Exec." >&2
    echo "Install: https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" >&2
    exit 1
  fi

  pick_task

  container="$(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${SELECTED_TASK}" \
    --query 'tasks[0].containers[0].name' \
    --output text)"

  enable_exec="$(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${SELECTED_TASK}" \
    --query 'tasks[0].enableExecuteCommand' \
    --output text)"

  if [[ "${enable_exec}" != "True" && "${enable_exec}" != "true" ]]; then
    echo "Task ${SELECTED_TASK##*/} does not have ECS Exec enabled." >&2
    echo "Apply Terraform (enable_execute_command + task IAM), then force a new deployment:" >&2
    echo "  aws ecs update-service --region ${AWS_REGION} --cluster ${CLUSTER} --service ${SELECTED_SERVICE} --force-new-deployment" >&2
    exit 1
  fi

  agent_status="$(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${SELECTED_TASK}" \
    --query 'tasks[0].containers[0].managedAgents[?name==`ExecuteCommandAgent`].lastStatus | [0]' \
    --output text)"

  if [[ -n "${agent_status}" && "${agent_status}" != "None" && "${agent_status}" != "RUNNING" ]]; then
    echo "ExecuteCommandAgent status is ${agent_status} (want RUNNING). Wait for the task to finish starting, or redeploy." >&2
    exit 1
  fi

  echo "Opening shell on ${SELECTED_SERVICE} / ${container} (${SELECTED_TASK##*/})"
  echo "Command: ${COMMAND}"
  exec aws ecs execute-command \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --task "${SELECTED_TASK}" \
    --container "${container}" \
    --interactive \
    --command "${COMMAND}"
}

tail_logs() {
  local log_group scope_idx filter_pattern stream_prefix container task_id

  echo ""
  echo "Log scope:"
  echo "  1) All tasks for ${SELECTED_SERVICE}"
  echo "  2) One task only"
  scope_idx="$(prompt_choice "Choose [1-2]: " 2)"

  if [[ "${scope_idx}" -eq 1 ]]; then
    # Any running task is enough to discover the log group name.
    SELECTED_TASK="${TASK_ARNS[0]}"
    log_group="$(resolve_log_group "${SELECTED_TASK}")"
    echo "Tailing ${log_group} (Ctrl+C to stop)"
    exec aws logs tail "${log_group}" \
      --region "${AWS_REGION}" \
      --follow \
      --format short
  fi

  pick_task
  log_group="$(resolve_log_group "${SELECTED_TASK}")"
  container="$(aws ecs describe-tasks \
    --region "${AWS_REGION}" \
    --cluster "${CLUSTER}" \
    --tasks "${SELECTED_TASK}" \
    --query 'tasks[0].containers[0].name' \
    --output text)"
  task_id="${SELECTED_TASK##*/}"

  # Stream names are typically: <prefix>/<container>/<task-id>
  stream_prefix="$(aws ecs describe-task-definition \
    --region "${AWS_REGION}" \
    --task-definition "$(aws ecs describe-tasks \
      --region "${AWS_REGION}" \
      --cluster "${CLUSTER}" \
      --tasks "${SELECTED_TASK}" \
      --query 'tasks[0].taskDefinitionArn' \
      --output text)" \
    --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' \
    --output text 2>/dev/null || true)"
  if [[ -z "${stream_prefix}" || "${stream_prefix}" == "None" ]]; then
    stream_prefix="ecs"
  fi

  filter_pattern="${stream_prefix}/${container}/${task_id}"
  echo "Tailing ${log_group} stream ${filter_pattern} (Ctrl+C to stop)"
  exec aws logs tail "${log_group}" \
    --region "${AWS_REGION}" \
    --follow \
    --format short \
    --log-stream-names "${filter_pattern}"
}

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  echo "AWS CLI is not authenticated." >&2
  exit 1
fi

CLUSTER="$(resolve_cluster)"
echo "Cluster: ${CLUSTER} (${AWS_REGION})"

SERVICE_ARNS=()
while IFS= read -r line || [[ -n "${line}" ]]; do
  SERVICE_ARNS+=("${line}")
done < <(aws ecs list-services \
  --region "${AWS_REGION}" \
  --cluster "${CLUSTER}" \
  --query 'serviceArns[]' \
  --output text | tr '\t' '\n' | sed '/^$/d' | sort)

if [[ "${#SERVICE_ARNS[@]}" -eq 0 ]]; then
  echo "No ECS services in cluster ${CLUSTER}." >&2
  exit 1
fi

SERVICE_NAMES=()
for arn in "${SERVICE_ARNS[@]}"; do
  SERVICE_NAMES+=("${arn##*/}")
done

SERVICE_ROWS=()
while IFS= read -r line || [[ -n "${line}" ]]; do
  SERVICE_ROWS+=("${line}")
done < <(aws ecs describe-services \
  --region "${AWS_REGION}" \
  --cluster "${CLUSTER}" \
  --services "${SERVICE_NAMES[@]}" \
  --query 'services[*].[serviceName,status,desiredCount,runningCount,enableExecuteCommand]' \
  --output text)

ACTIVE_NAMES=()
ACTIVE_META=()
for row in "${SERVICE_ROWS[@]}"; do
  # row: name status desired running enableExecuteCommand
  read -r name status desired running enable_exec <<<"${row}"
  [[ "${status}" == "ACTIVE" ]] || continue
  ((running > 0)) || continue
  ACTIVE_NAMES+=("${name}")
  ACTIVE_META+=("${desired} ${running} ${enable_exec}")
done

if [[ "${#ACTIVE_NAMES[@]}" -eq 0 ]]; then
  echo "No ACTIVE services with running tasks in ${CLUSTER}." >&2
  echo "Current services:" >&2
  printf '  %s\n' "${SERVICE_ROWS[@]}" >&2
  exit 1
fi

SELECTED_SERVICE="${SERVICE_ARG}"
if [[ -n "${SELECTED_SERVICE}" ]]; then
  found=0
  for name in "${ACTIVE_NAMES[@]}"; do
    if [[ "${name}" == "${SELECTED_SERVICE}" ]]; then
      found=1
      break
    fi
  done
  if [[ "${found}" -eq 0 ]]; then
    echo "Service '${SELECTED_SERVICE}' is not ACTIVE with running tasks." >&2
    echo "Available:" >&2
    printf '  %s\n' "${ACTIVE_NAMES[@]}" >&2
    exit 1
  fi
else
  echo ""
  echo "Active services (running > 0):"
  for i in "${!ACTIVE_NAMES[@]}"; do
    read -r desired running enable_exec <<<"${ACTIVE_META[$i]}"
    exec_label="exec=off"
    if [[ "${enable_exec}" == "True" || "${enable_exec}" == "true" ]]; then
      exec_label="exec=on"
    fi
    printf '  %d) %-22s desired=%s running=%s %s\n' \
      "$((i + 1))" "${ACTIVE_NAMES[$i]}" "${desired}" "${running}" "${exec_label}"
  done
  idx="$(prompt_choice "Choose service [1-${#ACTIVE_NAMES[@]}]: " "${#ACTIVE_NAMES[@]}")"
  SELECTED_SERVICE="${ACTIVE_NAMES[$((idx - 1))]}"
fi

echo "Service: ${SELECTED_SERVICE}"

if [[ -z "${MODE}" ]]; then
  echo ""
  echo "What do you want to do?"
  echo "  1) Interactive shell (ECS Exec)"
  echo "  2) Live logs (CloudWatch)"
  mode_idx="$(prompt_choice "Choose [1-2]: " 2)"
  case "${mode_idx}" in
    1) MODE="shell" ;;
    2) MODE="logs" ;;
  esac
fi

TASK_ARNS=()
while IFS= read -r line || [[ -n "${line}" ]]; do
  TASK_ARNS+=("${line}")
done < <(aws ecs list-tasks \
  --region "${AWS_REGION}" \
  --cluster "${CLUSTER}" \
  --service-name "${SELECTED_SERVICE}" \
  --desired-status RUNNING \
  --query 'taskArns[]' \
  --output text | tr '\t' '\n' | sed '/^$/d')

if [[ "${#TASK_ARNS[@]}" -eq 0 ]]; then
  echo "No RUNNING tasks for ${SELECTED_SERVICE}." >&2
  exit 1
fi

SELECTED_TASK=""
case "${MODE}" in
  shell) open_shell ;;
  logs) tail_logs ;;
  *)
    echo "Unknown mode: ${MODE}" >&2
    exit 2
    ;;
esac
