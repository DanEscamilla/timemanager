#!/usr/bin/env bash
# Install / verify local-dev dependencies on Linux for this monorepo.
# Ubuntu/Debian use apt where helpful; Node/Deno/Flutter/Docker use portable
# official installers so other distros work with fewer changes.
# See .ai/local-setup.md (inventory + how to keep this script in sync).
#
# Native Flutter targets: Android only (no iOS).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/setup-common.sh
source "$SCRIPT_DIR/lib/setup-common.sh"

SETUP_OS="linux"
# iOS is not supported on Linux; ignore --skip-ios quietly
setup_parse_args "$@"
SETUP_SKIP_IOS=1

HAVE_APT=0
if setup_have apt-get; then
  HAVE_APT=1
fi

# --- OS-specific helpers ---

ensure_linux_base_packages() {
  if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
    local missing=()
    for cmd in curl unzip; do
      setup_have "$cmd" || missing+=("$cmd")
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
      setup_record "base-packages" "ok" "curl unzip present"
    else
      setup_record "base-packages" "missing" "need: ${missing[*]}"
    fi
    return 0
  fi

  if [[ "$HAVE_APT" -eq 1 ]]; then
    setup_log "Installing base packages via apt..."
    sudo apt-get update -y
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
      ca-certificates \
      curl \
      git \
      unzip \
      xz-utils \
      zip \
      libglu1-mesa \
      clang \
      cmake \
      ninja-build \
      pkg-config \
      libgtk-3-dev \
      wget \
      gnupg \
      lsb-release \
      software-properties-common \
      apt-transport-https
    setup_record "base-packages" "ok" "apt packages installed"
    setup_ok "Base apt packages ready"
    return 0
  fi

  setup_warn "No apt-get. Ensure curl, git, unzip, xz-utils (and Chrome/Chromium deps) are installed via your package manager."
  local missing=()
  for cmd in curl git unzip; do
    setup_have "$cmd" || missing+=("$cmd")
  done
  if [[ ${#missing[@]} -gt 0 ]]; then
    setup_record "base-packages" "missing" "install: ${missing[*]}"
    return 1
  fi
  setup_record "base-packages" "ok" "minimal tools present"
  return 0
}

install_docker_os() {
  if setup_have docker; then
    return 0
  fi

  setup_log "Installing Docker Engine (official convenience script)..."
  # Official get.docker.com works across common distros
  curl -fsSL https://get.docker.com | sudo sh

  if setup_have getent && getent group docker >/dev/null 2>&1; then
    sudo usermod -aG docker "$USER" || true
    setup_warn "Added $USER to the docker group. Log out and back in (or: newgrp docker) before using docker without sudo."
  fi

  if setup_have systemctl; then
    sudo systemctl enable --now docker 2>/dev/null || true
  fi
}

install_chrome_os() {
  if [[ "$HAVE_APT" -eq 1 ]]; then
    setup_log "Installing Google Chrome (apt)..."
    local deb
    deb="$(mktemp /tmp/google-chrome.XXXXXX.deb)"
    curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o "$deb"
    if sudo dpkg -i "$deb"; then
      sudo apt-get install -f -y || true
    else
      setup_warn "Chrome .deb install failed; trying chromium package..."
      sudo apt-get install -y chromium-browser 2>/dev/null || sudo apt-get install -y chromium || true
    fi
    rm -f "$deb"
    return 0
  fi

  setup_warn "Install Google Chrome or Chromium with your package manager (needed for Flutter web)."
}

install_java_os() {
  if [[ "$HAVE_APT" -eq 1 ]]; then
    setup_log "Installing OpenJDK 11 via apt..."
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y openjdk-11-jdk
    return 0
  fi
  setup_warn "Install a JDK 11+ package (e.g. openjdk-11-jdk) with your package manager."
}

note_kvm() {
  if [[ "$SETUP_SKIP_ANDROID" -eq 1 ]]; then
    return 0
  fi
  if setup_have kvm-ok; then
    if kvm-ok >/dev/null 2>&1; then
      setup_info "KVM looks available for Android emulators."
    else
      setup_warn "KVM may be unavailable; Android emulator performance will suffer. Install cpu-checker and enable virtualization."
    fi
  elif [[ "$HAVE_APT" -eq 1 && "$SETUP_CHECK_ONLY" -eq 0 ]]; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y cpu-checker 2>/dev/null || true
    if setup_have kvm-ok && ! kvm-ok >/dev/null 2>&1; then
      setup_warn "KVM may be unavailable for Android emulators."
    fi
  fi
}

# --- main ---

setup_log "Time Manager local setup (Linux)"
if [[ "$SETUP_CHECK_ONLY" -eq 1 ]]; then
  setup_info "Mode: check only"
fi
setup_info "Native Flutter target on Linux: Android only (no iOS)."

ensure_linux_base_packages || true
run_shared_installs
note_kvm
finalize_setup
