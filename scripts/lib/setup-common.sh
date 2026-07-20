#!/usr/bin/env bash
# Shared helpers for scripts/setup-macos.sh and scripts/setup-linux.sh.
# Source this file; do not execute it directly.
#
# Inventory of machine-level tools lives in .ai/local-setup.md — keep this
# file and the OS scripts in sync when adding a new local-dev dependency.

set -euo pipefail

# --- defaults (overridable before sourcing or via flags) ---
SETUP_CHECK_ONLY="${SETUP_CHECK_ONLY:-0}"
SETUP_SKIP_ANDROID="${SETUP_SKIP_ANDROID:-0}"
SETUP_SKIP_IOS="${SETUP_SKIP_IOS:-0}"
SETUP_OS="${SETUP_OS:-}"

NODE_MAJOR="${NODE_MAJOR:-20}"
FLUTTER_HOME="${FLUTTER_HOME:-$HOME/development/flutter}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-$ANDROID_HOME}"

# Repo root: scripts/lib -> scripts -> repo
_SETUP_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$_SETUP_LIB_DIR/../.." && pwd)"

# Checklist results: name|status|detail  (status: ok|missing|warn)
SETUP_RESULTS=()

# --- logging ---

setup_log()  { printf '==> %s\n' "$*"; }
setup_ok()   { printf '    [ok] %s\n' "$*"; }
setup_warn() { printf '    [warn] %s\n' "$*" >&2; }
setup_err()  { printf '    [error] %s\n' "$*" >&2; }
setup_info() { printf '    %s\n' "$*"; }

setup_record() {
  # setup_record <name> <ok|missing|warn> [detail]
  SETUP_RESULTS+=("$1|$2|${3:-}")
}

# --- safety / shell ---

setup_refuse_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    setup_err "Do not run this script as root. Use a normal user; the script will sudo when needed."
    exit 1
  fi
}

setup_login_shell() {
  local login_shell="${SHELL:-}"
  if [[ -z "$login_shell" ]] && setup_have dscl; then
    login_shell="$(dscl . -read "/Users/$USER" UserShell 2>/dev/null | awk '{print $2}' || true)"
  elif [[ -z "$login_shell" && -r /etc/passwd ]]; then
    login_shell="$(awk -F: -v u="$USER" '$1==u {print $7}' /etc/passwd 2>/dev/null || true)"
  fi
  echo "$login_shell"
}

setup_detect_shell_rc() {
  # Prefer the user's login shell from $SHELL/passwd, not the bash running this script.
  local login_shell
  login_shell="$(setup_login_shell)"
  if [[ "$login_shell" == *fish* ]]; then
    mkdir -p "$HOME/.config/fish"
    echo "$HOME/.config/fish/config.fish"
  elif [[ "$login_shell" == *zsh* ]]; then
    echo "$HOME/.zshrc"
  elif [[ "$login_shell" == *bash* ]]; then
    if [[ -f "$HOME/.bashrc" ]]; then
      echo "$HOME/.bashrc"
    else
      echo "$HOME/.bash_profile"
    fi
  elif [[ -f "$HOME/.zshrc" ]]; then
    echo "$HOME/.zshrc"
  else
    echo "$HOME/.bashrc"
  fi
}

setup_to_fish_path_block() {
  # Convert bash export/PATH blocks we emit into fish set -gx / fish_add_path.
  local block="$1"
  local out="" line name val prepend
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" == \#* ]] && continue
    if [[ "$line" =~ ^export[[:space:]]+NVM_DIR= ]]; then
      out+='set -gx NVM_DIR $HOME/.nvm'$'\n'
      out+='# Node via nvm: install a fish nvm plugin, or: bass source $NVM_DIR/nvm.sh'$'\n'
      continue
    fi
    if [[ "$line" =~ ^export[[:space:]]+([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      name="${BASH_REMATCH[1]}"
      val="${BASH_REMATCH[2]}"
      val="${val%\"}"
      val="${val#\"}"
      if [[ "$name" == "PATH" ]]; then
        prepend="${val%%:\$PATH*}"
        prepend="${prepend%%:\$\{PATH\}*}"
        # Expand common $HOME / $ANDROID_HOME prefixes for fish_add_path
        prepend="${prepend//\$HOME/\$HOME}"
        prepend="${prepend//\$ANDROID_HOME/\$ANDROID_HOME}"
        if [[ -n "$prepend" && "$prepend" != "$val" ]]; then
          # Multiple prepended segments separated by :
          local part
          IFS=':' read -ra _parts <<<"$prepend"
          for part in "${_parts[@]}"; do
            [[ -n "$part" ]] || continue
            out+="fish_add_path $part"$'\n'
          done
        fi
      else
        # Quote-strip already done; keep $HOME for fish
        val="${val//\$HOME/\$HOME}"
        out+="set -gx $name $val"$'\n'
      fi
    fi
  done <<<"$block"
  printf '%s' "$out"
}

setup_append_rc() {
  # setup_append_rc <marker> <bash-block>
  local marker="$1"
  local block="$2"
  local rc login_shell
  rc="$(setup_detect_shell_rc)"
  login_shell="$(setup_login_shell)"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  if grep -Fq "$marker" "$rc" 2>/dev/null; then
    return 0
  fi
  setup_log "Appending PATH config to $rc ($marker)"
  if [[ "$login_shell" == *fish* ]]; then
    {
      printf '\n# %s\n' "$marker"
      setup_to_fish_path_block "$block"
    } >>"$rc"
  else
    {
      printf '\n# %s\n' "$marker"
      printf '%s\n' "$block"
    } >>"$rc"
  fi
}

setup_have() {
  command -v "$1" >/dev/null 2>&1
}

setup_node_major() {
  if ! setup_have node; then
    echo ""
    return
  fi
  node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo ""
}

# --- parse shared flags ---

setup_parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --check) SETUP_CHECK_ONLY=1 ;;
      --skip-android) SETUP_SKIP_ANDROID=1 ;;
      --skip-ios) SETUP_SKIP_IOS=1 ;;
      -h|--help)
        cat <<'EOF'
Usage: setup-<os>.sh [--check] [--skip-android] [--skip-ios]

  --check          Verify tools only; do not install
  --skip-android   Skip Android SDK / JDK setup
  --skip-ios       Skip Xcode / CocoaPods (macOS only; ignored on Linux)
  -h, --help       Show this help
EOF
        exit 0
        ;;
      *)
        setup_err "Unknown flag: $1"
        exit 1
        ;;
    esac
    shift
  done
}

# --- ensure_* helpers (install-if-missing; no-op under --check except recording) ---

ensure_git() {
  if setup_have git; then
    setup_record "git" "ok" "$(git --version 2>/dev/null | head -1)"
    setup_ok "git present"
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "git" "missing" "git not found"
    return 1
  fi
  setup_log "Installing git..."
  if [[ "$SETUP_OS" == "macos" ]]; then
    # Xcode CLT provides git; brew as fallback
    if setup_have brew; then
      brew install git
    else
      xcode-select --install 2>/dev/null || true
      setup_warn "Install Xcode Command Line Tools (includes git), then re-run."
      setup_record "git" "missing" "needs Xcode CLT or brew"
      return 1
    fi
  else
    if setup_have apt-get; then
      sudo apt-get update -y
      sudo apt-get install -y git
    else
      setup_warn "Install git with your package manager, then re-run."
      setup_record "git" "missing" "no apt-get"
      return 1
    fi
  fi
  if setup_have git; then
    setup_record "git" "ok" "$(git --version 2>/dev/null | head -1)"
    setup_ok "git installed"
    return 0
  fi
  setup_record "git" "missing" "install failed"
  return 1
}

ensure_nvm_and_node() {
  local major
  major="$(setup_node_major)"
  if [[ "$major" == "$NODE_MAJOR" ]]; then
    setup_record "node" "ok" "v$(node -v 2>/dev/null | tr -d v) (major $NODE_MAJOR)"
    setup_ok "Node.js $NODE_MAJOR present"
    _ensure_pnpm
    return 0
  fi

  # Load nvm if installed but not in PATH yet
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
    major="$(setup_node_major)"
    if [[ "$major" == "$NODE_MAJOR" ]]; then
      setup_record "node" "ok" "v$(node -v 2>/dev/null | tr -d v) via nvm"
      setup_ok "Node.js $NODE_MAJOR present (nvm)"
      _ensure_pnpm
      return 0
    fi
  fi

  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    if [[ -n "$major" ]]; then
      setup_record "node" "missing" "found major $major, need $NODE_MAJOR"
    else
      setup_record "node" "missing" "node not found"
    fi
    setup_record "pnpm" "missing" "requires node"
    return 1
  fi

  setup_log "Installing nvm + Node.js $NODE_MAJOR..."
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  fi
  # shellcheck disable=SC1090
  . "$NVM_DIR/nvm.sh"
  nvm install "$NODE_MAJOR"
  nvm alias default "$NODE_MAJOR"
  setup_append_rc "timemanager-setup:nvm" \
'export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"'

  major="$(setup_node_major)"
  if [[ "$major" == "$NODE_MAJOR" ]]; then
    setup_record "node" "ok" "v$(node -v 2>/dev/null | tr -d v)"
    setup_ok "Node.js $NODE_MAJOR installed"
    _ensure_pnpm
    return 0
  fi
  setup_record "node" "missing" "nvm install failed"
  return 1
}

_ensure_pnpm() {
  # Prefer corepack (ships with Node 20+)
  if setup_have corepack; then
    if [[ "$SETUP_CHECK_ONLY" -eq 0 ]]; then
      corepack enable >/dev/null 2>&1 || true
      corepack prepare pnpm@latest --activate >/dev/null 2>&1 || true
    fi
  fi
  if setup_have pnpm; then
    setup_record "pnpm" "ok" "$(pnpm --version 2>/dev/null)"
    setup_ok "pnpm present"
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "pnpm" "missing" "pnpm not found"
    return 1
  fi
  if setup_have npm; then
    npm install -g pnpm
  fi
  if setup_have pnpm; then
    setup_record "pnpm" "ok" "$(pnpm --version 2>/dev/null)"
    setup_ok "pnpm installed"
    return 0
  fi
  setup_record "pnpm" "missing" "install failed"
  return 1
}

ensure_deno() {
  if setup_have deno; then
    setup_record "deno" "ok" "$(deno --version 2>/dev/null | head -1)"
    setup_ok "Deno present"
    return 0
  fi
  # Official installer puts deno in ~/.deno/bin
  if [[ -x "$HOME/.deno/bin/deno" ]]; then
    export PATH="$HOME/.deno/bin:$PATH"
  fi
  if setup_have deno; then
    setup_record "deno" "ok" "$(deno --version 2>/dev/null | head -1)"
    setup_ok "Deno present"
    setup_append_rc "timemanager-setup:deno" 'export PATH="$HOME/.deno/bin:$PATH"'
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "deno" "missing" "deno not found"
    return 1
  fi
  setup_log "Installing Deno..."
  curl -fsSL https://deno.land/install.sh | sh
  export PATH="$HOME/.deno/bin:$PATH"
  setup_append_rc "timemanager-setup:deno" 'export PATH="$HOME/.deno/bin:$PATH"'
  if setup_have deno; then
    setup_record "deno" "ok" "$(deno --version 2>/dev/null | head -1)"
    setup_ok "Deno installed"
    return 0
  fi
  setup_record "deno" "missing" "install failed"
  return 1
}

ensure_flutter() {
  if setup_have flutter; then
    setup_record "flutter" "ok" "$(flutter --version 2>/dev/null | head -1)"
    setup_ok "Flutter present"
    return 0
  fi
  if [[ -x "$FLUTTER_HOME/bin/flutter" ]]; then
    export PATH="$FLUTTER_HOME/bin:$PATH"
  fi
  if setup_have flutter; then
    setup_record "flutter" "ok" "$(flutter --version 2>/dev/null | head -1)"
    setup_ok "Flutter present"
    setup_append_rc "timemanager-setup:flutter" "export PATH=\"$FLUTTER_HOME/bin:\$PATH\""
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "flutter" "missing" "flutter not found"
    return 1
  fi
  setup_log "Installing Flutter stable into $FLUTTER_HOME..."
  mkdir -p "$(dirname "$FLUTTER_HOME")"
  if [[ ! -d "$FLUTTER_HOME/.git" ]]; then
    git clone https://github.com/flutter/flutter.git -b stable "$FLUTTER_HOME"
  fi
  export PATH="$FLUTTER_HOME/bin:$PATH"
  setup_append_rc "timemanager-setup:flutter" "export PATH=\"$FLUTTER_HOME/bin:\$PATH\""
  flutter precache
  if setup_have flutter; then
    setup_record "flutter" "ok" "$(flutter --version 2>/dev/null | head -1)"
    setup_ok "Flutter installed"
    return 0
  fi
  setup_record "flutter" "missing" "install failed"
  return 1
}

ensure_docker() {
  if setup_have docker; then
    if docker info >/dev/null 2>&1; then
      setup_record "docker" "ok" "$(docker --version 2>/dev/null)"
      setup_ok "Docker present and running"
      return 0
    fi
    setup_record "docker" "warn" "installed but daemon not running"
    setup_warn "Docker is installed but the daemon is not running. Start Docker Desktop or the docker service."
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "docker" "missing" "docker not found"
    return 1
  fi
  # OS scripts provide install_docker_os
  if declare -F install_docker_os >/dev/null; then
    install_docker_os
  else
    setup_err "install_docker_os not defined for this platform"
    setup_record "docker" "missing" "no installer"
    return 1
  fi
  if setup_have docker; then
    if docker info >/dev/null 2>&1; then
      setup_record "docker" "ok" "$(docker --version 2>/dev/null)"
      setup_ok "Docker installed"
    else
      setup_record "docker" "warn" "installed; start the daemon"
      setup_warn "Docker installed; start the daemon / Docker Desktop, then re-run --check."
    fi
    return 0
  fi
  setup_record "docker" "missing" "install failed"
  return 1
}

ensure_chrome() {
  if setup_have google-chrome || setup_have google-chrome-stable || setup_have chromium || setup_have chromium-browser; then
    setup_record "chrome" "ok" "browser found"
    setup_ok "Chrome/Chromium present"
    return 0
  fi
  # macOS app bundle
  if [[ "$SETUP_OS" == "macos" && -d "/Applications/Google Chrome.app" ]]; then
    setup_record "chrome" "ok" "Google Chrome.app"
    setup_ok "Chrome present"
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "chrome" "missing" "Chrome/Chromium not found"
    return 1
  fi
  if declare -F install_chrome_os >/dev/null; then
    install_chrome_os
  else
    setup_warn "Install Google Chrome or Chromium manually for Flutter web."
    setup_record "chrome" "missing" "no installer"
    return 1
  fi
  if setup_have google-chrome || setup_have google-chrome-stable || setup_have chromium || setup_have chromium-browser \
    || [[ -d "/Applications/Google Chrome.app" ]]; then
    setup_record "chrome" "ok" "installed"
    setup_ok "Chrome/Chromium installed"
    return 0
  fi
  setup_record "chrome" "missing" "install failed"
  return 1
}

ensure_java() {
  if [[ "$SETUP_SKIP_ANDROID" -eq 1 ]]; then
    setup_record "java" "ok" "skipped (--skip-android)"
    return 0
  fi
  local ver=""
  if setup_have java; then
    ver="$(java -version 2>&1 | head -1 || true)"
    # Accept 11+
    if java -version 2>&1 | grep -Eq 'version "(1[1-9]|[2-9][0-9])'; then
      setup_record "java" "ok" "$ver"
      setup_ok "JDK present ($ver)"
      return 0
    fi
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "java" "missing" "need JDK 11+ (found: ${ver:-none})"
    return 1
  fi
  if declare -F install_java_os >/dev/null; then
    install_java_os
  else
    setup_record "java" "missing" "no installer"
    return 1
  fi
  if setup_have java && java -version 2>&1 | grep -Eq 'version "(1[1-9]|[2-9][0-9])'; then
    setup_record "java" "ok" "$(java -version 2>&1 | head -1)"
    setup_ok "JDK installed"
    return 0
  fi
  setup_record "java" "missing" "install failed"
  return 1
}

_android_sdkmanager() {
  local sm
  for sm in \
    "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
    "$ANDROID_HOME/cmdline-tools/bin/sdkmanager" \
    "$ANDROID_HOME/tools/bin/sdkmanager"; do
    if [[ -x "$sm" ]]; then
      echo "$sm"
      return 0
    fi
  done
  if setup_have sdkmanager; then
    command -v sdkmanager
    return 0
  fi
  return 1
}

ensure_android_sdk() {
  if [[ "$SETUP_SKIP_ANDROID" -eq 1 ]]; then
    setup_record "android-sdk" "ok" "skipped (--skip-android)"
    return 0
  fi

  export ANDROID_HOME ANDROID_SDK_ROOT
  local sm=""
  sm="$(_android_sdkmanager || true)"

  if [[ -n "$sm" && -d "$ANDROID_HOME/platform-tools" ]]; then
    setup_append_rc "timemanager-setup:android" \
"export ANDROID_HOME=\"$ANDROID_HOME\"
export ANDROID_SDK_ROOT=\"\$ANDROID_HOME\"
export PATH=\"\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH\""
    setup_record "android-sdk" "ok" "$ANDROID_HOME"
    setup_ok "Android SDK present ($ANDROID_HOME)"
    return 0
  fi

  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "android-sdk" "missing" "ANDROID_HOME=$ANDROID_HOME"
    return 1
  fi

  setup_log "Installing Android SDK cmdline-tools into $ANDROID_HOME..."
  mkdir -p "$ANDROID_HOME/cmdline-tools"

  local zip_url zip_path tmp_dir
  # Pin a recent cmdline-tools zip; update when Google retires the build.
  if [[ "$SETUP_OS" == "macos" ]]; then
    zip_url="https://dl.google.com/android/repository/commandlinetools-mac-11076708_latest.zip"
  else
    zip_url="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
  fi
  zip_path="$(mktemp /tmp/android-cmdline-tools.XXXXXX.zip)"
  tmp_dir="$(mktemp -d /tmp/android-cmdline-tools.XXXXXX)"
  curl -fsSL "$zip_url" -o "$zip_path"
  unzip -q "$zip_path" -d "$tmp_dir"
  rm -rf "$ANDROID_HOME/cmdline-tools/latest"
  mkdir -p "$ANDROID_HOME/cmdline-tools/latest"
  # Zip contains a "cmdline-tools" directory
  if [[ -d "$tmp_dir/cmdline-tools" ]]; then
    mv "$tmp_dir/cmdline-tools"/* "$ANDROID_HOME/cmdline-tools/latest/"
  else
    mv "$tmp_dir"/* "$ANDROID_HOME/cmdline-tools/latest/"
  fi
  rm -rf "$tmp_dir" "$zip_path"

  export PATH="$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"
  sm="$(_android_sdkmanager)"
  yes | "$sm" --sdk_root="$ANDROID_HOME" --licenses >/dev/null || true
  "$sm" --sdk_root="$ANDROID_HOME" \
    "platform-tools" \
    "platforms;android-35" \
    "build-tools;35.0.0" \
    "cmdline-tools;latest"

  setup_append_rc "timemanager-setup:android" \
"export ANDROID_HOME=\"$ANDROID_HOME\"
export ANDROID_SDK_ROOT=\"\$ANDROID_HOME\"
export PATH=\"\$ANDROID_HOME/cmdline-tools/latest/bin:\$ANDROID_HOME/platform-tools:\$PATH\""

  if [[ -d "$ANDROID_HOME/platform-tools" ]]; then
    setup_record "android-sdk" "ok" "$ANDROID_HOME"
    setup_ok "Android SDK installed"
    return 0
  fi
  setup_record "android-sdk" "missing" "install incomplete"
  return 1
}

# --- repo bootstrap ---

bootstrap_env_files() {
  local pairs=(
    "apps/user-manager-api/.env.example:apps/user-manager-api/.env"
    "apps/timemanager-api/.env.example:apps/timemanager-api/.env"
    "apps/spendmanager-api/.env.example:apps/spendmanager-api/.env"
    "apps/user-manager-web/.env.example:apps/user-manager-web/.env"
  )
  local pair src dest
  for pair in "${pairs[@]}"; do
    src="$REPO_ROOT/${pair%%:*}"
    dest="$REPO_ROOT/${pair##*:}"
    if [[ ! -f "$src" ]]; then
      continue
    fi
    if [[ -f "$dest" ]]; then
      setup_info "keep existing ${pair##*:}"
    else
      if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
        setup_warn "missing ${pair##*:} (would copy from .env.example)"
      else
        cp "$src" "$dest"
        setup_ok "created ${pair##*:} from .env.example"
      fi
    fi
  done
}

bootstrap_workspace() {
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_log "Skipping pnpm install / flutter pub get (--check)"
    return 0
  fi
  setup_log "Installing Node workspace deps (pnpm install)..."
  (cd "$REPO_ROOT" && pnpm install)

  if setup_have flutter; then
    setup_log "Fetching Flutter packages..."
    local flutter_pkgs=(
      "libs/design_system"
      "libs/app_core"
      "apps/timemanager"
      "apps/spendmanager"
    )
    local pkg
    for pkg in "${flutter_pkgs[@]}"; do
      (cd "$REPO_ROOT/$pkg" && flutter pub get)
    done
  else
    setup_warn "flutter not on PATH; skip flutter pub get"
  fi
}

# --- verification / summary ---

print_tool_summary() {
  setup_log "Tool summary"
  local row name status detail
  local failed=0
  for row in "${SETUP_RESULTS[@]+"${SETUP_RESULTS[@]}"}"; do
    IFS='|' read -r name status detail <<<"$row"
    case "$status" in
      ok) printf '  %-14s OK   %s\n' "$name" "$detail" ;;
      warn) printf '  %-14s WARN %s\n' "$name" "$detail"; ;;
      missing)
        printf '  %-14s MISSING %s\n' "$name" "$detail"
        failed=1
        ;;
    esac
  done
  return "$failed"
}

run_flutter_doctor() {
  if ! setup_have flutter; then
    return 0
  fi
  setup_log "flutter doctor"
  # Prefer non-interactive; doctor may still print issues
  flutter doctor -v || true
}

print_next_steps() {
  local rc reload_hint
  rc="$(setup_detect_shell_rc)"
  if [[ "$(setup_login_shell)" == *fish* ]]; then
    reload_hint="exec fish  (or: source $rc)"
  else
    reload_hint="source $rc"
  fi
  cat <<EOF

Next steps
----------
1. Restart your shell (or: $reload_hint) so PATH updates apply.
2. Start APIs + DB from the repo root:
     pnpm timemanager
3. Launch Flutter (IDE Run and Debug → timemanager, or):
     nx serve timemanager                  # Chrome :4444
     flutter run -d ios                    # macOS / Xcode
     flutter run -d android                # emulator or device
4. Android emulator hosts: use 10.0.2.2 for localhost APIs (already handled in app config).
5. Re-verify anytime:  ./scripts/setup-${SETUP_OS}.sh --check

See .ai/local-setup.md for manual steps (Xcode, Docker daemon, Android AVD) and
how to update these scripts when adding a new local-dev tool.
EOF
}

# Shared install sequence (OS scripts define install_*_os hooks first).
# Call run_shared_installs, then any OS-specific ensures, then finalize_setup.
run_shared_installs() {
  setup_refuse_root
  cd "$REPO_ROOT"

  # Load nvm early if present so node/pnpm checks work
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    . "$NVM_DIR/nvm.sh"
  fi
  export PATH="$HOME/.deno/bin:$FLUTTER_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

  ensure_git || true
  ensure_nvm_and_node || true
  ensure_deno || true
  ensure_flutter || true
  ensure_docker || true
  ensure_chrome || true
  ensure_java || true
  ensure_android_sdk || true
}

finalize_setup() {
  bootstrap_env_files
  bootstrap_workspace

  if setup_have flutter && [[ "$SETUP_CHECK_ONLY" -eq 0 ]]; then
    run_flutter_doctor
  fi

  echo
  if print_tool_summary; then
    setup_log "All required tools look good."
  else
    setup_warn "Some tools are missing. Fix the MISSING rows (or re-run without --check), then run --check again."
  fi
  print_next_steps
}
