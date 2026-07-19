#!/usr/bin/env bash
# Install / verify local-dev dependencies on macOS for this monorepo.
# See .ai/local-setup.md (inventory + how to keep this script in sync).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/setup-common.sh
source "$SCRIPT_DIR/lib/setup-common.sh"

SETUP_OS="macos"
setup_parse_args "$@"

# --- OS-specific installers (hooks for setup-common) ---

ensure_homebrew() {
  if setup_have brew; then
    setup_record "homebrew" "ok" "$(brew --version 2>/dev/null | head -1)"
    setup_ok "Homebrew present"
    return 0
  fi
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "homebrew" "missing" "brew not found"
    return 1
  fi
  setup_log "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    export PATH="/opt/homebrew/bin:$PATH"
    setup_append_rc "timemanager-setup:homebrew" 'export PATH="/opt/homebrew/bin:$PATH"'
  elif [[ -x /usr/local/bin/brew ]]; then
    export PATH="/usr/local/bin:$PATH"
    setup_append_rc "timemanager-setup:homebrew" 'export PATH="/usr/local/bin:$PATH"'
  fi
  if setup_have brew; then
    setup_record "homebrew" "ok" "$(brew --version 2>/dev/null | head -1)"
    setup_ok "Homebrew installed"
    return 0
  fi
  setup_record "homebrew" "missing" "install failed"
  return 1
}

install_docker_os() {
  ensure_homebrew || true
  if ! setup_have brew; then
    setup_err "Homebrew required to install Docker Desktop"
    return 1
  fi
  setup_log "Installing Docker Desktop via Homebrew cask..."
  brew install --cask docker || true
  setup_warn "Open Docker Desktop once from Applications to finish setup, then re-run --check."
}

install_chrome_os() {
  ensure_homebrew || true
  if ! setup_have brew; then
    setup_err "Homebrew required to install Chrome"
    return 1
  fi
  setup_log "Installing Google Chrome via Homebrew cask..."
  brew install --cask google-chrome
}

install_java_os() {
  ensure_homebrew || true
  if ! setup_have brew; then
    setup_err "Homebrew required to install OpenJDK 11"
    return 1
  fi
  setup_log "Installing OpenJDK 11 via Homebrew..."
  brew install openjdk@11
  local brew_prefix
  brew_prefix="$(brew --prefix openjdk@11)"
  if [[ -d "$brew_prefix" ]]; then
    sudo ln -sfn "$brew_prefix/libexec/openjdk.jdk" /Library/Java/JavaVirtualMachines/openjdk-11.jdk 2>/dev/null || true
    export PATH="$brew_prefix/bin:$PATH"
    setup_append_rc "timemanager-setup:java" "export PATH=\"$(brew --prefix openjdk@11)/bin:\$PATH\""
  fi
}

ensure_xcode() {
  if [[ "$SETUP_SKIP_IOS" -eq 1 ]]; then
    setup_record "xcode" "ok" "skipped (--skip-ios)"
    return 0
  fi

  if xcodebuild -version >/dev/null 2>&1; then
    local ver
    ver="$(xcodebuild -version 2>/dev/null | head -1 || echo xcodebuild)"
    setup_record "xcode" "ok" "$ver"
    setup_ok "Xcode present ($ver)"
    if [[ "$SETUP_CHECK_ONLY" -eq 0 ]]; then
      sudo xcodebuild -license accept 2>/dev/null || true
      sudo xcode-select -s /Applications/Xcode.app/Contents/Developer 2>/dev/null || true
    fi
    return 0
  fi

  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "xcode" "missing" "Install Xcode from the App Store"
    return 1
  fi

  setup_log "Xcode is required for iOS builds and cannot be fully automated."
  setup_info "1. Install Xcode from the Mac App Store"
  setup_info "2. Open Xcode once to finish installing components"
  setup_info "3. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer"
  if ! xcode-select -p >/dev/null 2>&1; then
    xcode-select --install 2>/dev/null || true
  fi
  open "macappstore://itunes.apple.com/app/id497799835" 2>/dev/null || true
  setup_record "xcode" "warn" "install from App Store if missing, then re-run"
  return 0
}

ensure_cocoapods() {
  if [[ "$SETUP_SKIP_IOS" -eq 1 ]]; then
    setup_record "cocoapods" "ok" "skipped (--skip-ios)"
    return 0
  fi

  if setup_have pod; then
    setup_record "cocoapods" "ok" "$(pod --version 2>/dev/null)"
    setup_ok "CocoaPods present"
    return 0
  fi

  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    setup_record "cocoapods" "missing" "pod not found"
    return 1
  fi

  ensure_homebrew || true
  setup_log "Installing CocoaPods..."
  if setup_have brew; then
    brew install cocoapods
  else
    sudo gem install cocoapods
  fi

  if setup_have pod; then
    setup_record "cocoapods" "ok" "$(pod --version 2>/dev/null)"
    setup_ok "CocoaPods installed"
    return 0
  fi
  setup_record "cocoapods" "missing" "install failed"
  return 1
}

ios_pod_install() {
  if [[ "$SETUP_SKIP_IOS" -eq 1 || "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    return 0
  fi
  if ! setup_have pod || ! setup_have flutter; then
    return 0
  fi
  local ios_dir="$REPO_ROOT/apps/timemanager/ios"
  if [[ ! -f "$ios_dir/Podfile" ]]; then
    return 0
  fi
  setup_log "Running pod install in apps/timemanager/ios..."
  (cd "$ios_dir" && pod install) || setup_warn "pod install failed; run manually after Xcode is ready"
}

# --- main ---

setup_log "Time Manager local setup (macOS)"
if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
  setup_info "Mode: check only"
fi

ensure_homebrew || true

# Load brew into this bash process. Prefer a simple PATH prefix over full
# `brew shellenv` (which may emit zsh-only lines or nested path_helper evals).
_load_brew_env() {
  local brew_bin="" prefix=""
  if [[ -x /opt/homebrew/bin/brew ]]; then
    brew_bin=/opt/homebrew/bin/brew
  elif [[ -x /usr/local/bin/brew ]]; then
    brew_bin=/usr/local/bin/brew
  elif setup_have brew; then
    brew_bin="$(command -v brew)"
  else
    return 0
  fi
  prefix="$("$brew_bin" --prefix 2>/dev/null || true)"
  if [[ -z "$prefix" ]]; then
    prefix="$(dirname "$(dirname "$brew_bin")")"
  fi
  if [[ -d "$prefix/bin" ]]; then
    export HOMEBREW_PREFIX="$prefix"
    export PATH="$prefix/bin:$PATH"
  fi
}
_load_brew_env

run_shared_installs
ensure_xcode || true
ensure_cocoapods || true
ios_pod_install
finalize_setup
