#!/usr/bin/env bash
# Shared helper: load KEY=VALUE pairs from an uncommitted .local.env into the
# environment. Already-set variables (inline exports) win over the file.
#
# Search order (first existing file wins):
#   1. $LOCAL_ENV_FILE (if set)
#   2. infra/aws/.local.env
#   3. <repo-root>/.local.env
#
# Sourced by deploy-apis.sh, deploy-web.sh, check-health.sh, ecs-shell.sh — not run directly.

_aws_scripts_load_local_env() {
  local root="${1:?repo root required}"
  local candidates=()
  local file line key val

  if [[ -n "${LOCAL_ENV_FILE:-}" ]]; then
    candidates+=("${LOCAL_ENV_FILE}")
  fi
  candidates+=("${root}/infra/aws/.local.env" "${root}/.local.env")

  file=""
  for candidate in "${candidates[@]}"; do
    if [[ -f "${candidate}" ]]; then
      file="${candidate}"
      break
    fi
  done

  if [[ -z "${file}" ]]; then
    return 0
  fi

  echo "Loading env from ${file#"${root}/"}"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    # Strip CR (Windows line endings) and trim leading whitespace for comments.
    line="${line%$'\r'}"
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    if [[ "${line}" =~ ^[[:space:]]*export[[:space:]]+ ]]; then
      line="${line#*export }"
      line="${line#"${line%%[![:space:]]*}"}"
    fi

    if [[ ! "${line}" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]]; then
      echo "  warn: skipping invalid line in ${file}: ${line}" >&2
      continue
    fi

    key="${line%%=*}"
    val="${line#*=}"

    # Do not override vars already present in the environment.
    if [[ -n "${!key+x}" ]]; then
      continue
    fi

    # Strip matching single/double quotes around the value.
    if [[ "${val}" =~ ^\"(.*)\"$ ]]; then
      val="${BASH_REMATCH[1]}"
    elif [[ "${val}" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi

    export "${key}=${val}"
  done <"${file}"
}
