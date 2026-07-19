# Local setup (new machine)

Bootstrap a macOS or Linux machine so you can run the timemanager full stack locally: Postgres (Docker), SuperTokens auth (`:3001`), GraphQL (`:3000`), and the Flutter client (web, plus native targets below).

AWS/Terraform, Authentik, and self-hosted SuperTokens Core are **not** part of this setup — see [deploy-aws.md](deploy-aws.md) and [workflows.md](workflows.md).

## Prerequisites inventory

This table is the **source of truth** for machine-level tools. [`scripts/setup-macos.sh`](../scripts/setup-macos.sh), [`scripts/setup-linux.sh`](../scripts/setup-linux.sh), and [`scripts/lib/setup-common.sh`](../scripts/lib/setup-common.sh) must implement the same list.

| Tool | Pin / notes | Why | Platforms |
|------|-------------|-----|-----------|
| Git | any recent | clone + Flutter install | macOS, Linux |
| Node.js | **20** ([`.nvmrc`](../.nvmrc)) via nvm | `user-manager-*`, Nx/pnpm | macOS, Linux |
| pnpm | via Corepack | Node workspace | macOS, Linux |
| Deno | current stable (official installer) | `timemanager-api` | macOS, Linux |
| Flutter | **stable** channel; Dart SDK `^3.7.2` ([`pubspec.yaml`](../apps/timemanager/pubspec.yaml)) | `timemanager` client | macOS, Linux |
| Docker + Compose | Engine or Docker Desktop | Postgres 15 in `infra/timemanager-db` | macOS, Linux |
| Chrome / Chromium | any recent | default Flutter web target `:4444` | macOS, Linux |
| JDK | **11+** (Gradle `JavaVersion.VERSION_11`) | Android builds | macOS, Linux |
| Android SDK | cmdline-tools + platform-tools + platform/build-tools | Android | macOS, Linux |
| Homebrew | latest | macOS package installs | macOS |
| Xcode | App Store (full IDE, not CLT-only) | iOS | macOS |
| CocoaPods | via Homebrew or gem | iOS pods under `apps/timemanager/ios` | macOS |

App library deps are **not** listed here — `pnpm install`, `flutter pub get`, and Deno’s lockfile cover those.

## Run the setup script

From the **repo root**:

```bash
# macOS (APIs + web + iOS + Android tooling)
./scripts/setup-macos.sh

# Linux (APIs + web + Android only)
./scripts/setup-linux.sh
```

Useful flags:

```bash
./scripts/setup-macos.sh --check          # verify only; no installs
./scripts/setup-linux.sh --check
./scripts/setup-macos.sh --skip-ios       # skip Xcode / CocoaPods
./scripts/setup-*.sh --skip-android       # skip JDK + Android SDK
```

The scripts are idempotent: they install only what is missing, copy `.env` files when absent, run `pnpm install` and `flutter pub get`, then print a tool summary and next steps.

PATH updates are appended to your login shell rc (`~/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`). Restart the shell after the first run. Fish users may need a [nvm fish plugin](https://github.com/jorgebucaran/nvm.fish) (or `bass`) to load nvm; Deno/Flutter/Android paths use `fish_add_path`.

## Manual steps the scripts cannot finish

| Step | Who | Notes |
|------|-----|--------|
| Install **Xcode** from the Mac App Store | macOS | Open Xcode once; `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer` |
| Start **Docker Desktop** (or the docker service) | both | Script may install Docker; daemon must be running for `pnpm db:up` / `pnpm timemanager` |
| Linux **docker group** | Linux | After install: log out/in or `newgrp docker` so `docker` works without sudo |
| Create an **Android AVD** (or use a device) | both | cmdline-tools alone do not create an emulator image UI; use Android Studio Device Manager or `avdmanager` |
| Accept remaining **flutter doctor** prompts | both | Re-run `flutter doctor` after Xcode / licenses |
| OAuth provider secrets | optional | Edit `apps/user-manager-api/.env` — email/password works with defaults + SuperTokens playground |

## Env files

Created from examples when missing:

| File | Required for local? |
|------|---------------------|
| `apps/user-manager-api/.env` | Recommended (defaults work for email/password) |
| `apps/timemanager-api/.env` | Optional (code defaults match Docker Postgres) |
| `apps/user-manager-web/.env` | Optional (Vite defaults to localhost) |

Never commit `.env` files.

## First run

```bash
# 1. APIs + Postgres (from repo root)
pnpm timemanager

# 2. Flutter — pick one:
# IDE: Run and Debug → timemanager (Chrome :4444)
nx serve timemanager                 # Chrome
flutter run -d ios                   # macOS + Xcode
flutter run -d android               # emulator or device
```

- GraphQL: `http://localhost:3000` — Auth: `http://localhost:3001` — Flutter web: `:4444`
- Android emulator: host loopback is `10.0.2.2` (already handled in app config)
- Do not run `pnpm user-manager` and `pnpm timemanager` together without changing ports — both default web/GraphQL surfaces use `:3000`

More detail: [workflows.md](workflows.md).

## Optional stacks

- `pnpm user-manager` — React + auth only
- Authentik — unwired; not required for SuperTokens SSO
- AWS — [deploy-aws.md](deploy-aws.md)

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Docker commands fail / DB won’t start | Start Docker Desktop or `sudo systemctl start docker`; on Linux re-login for docker group |
| `flutter doctor` Android licenses | `flutter doctor --android-licenses` |
| CocoaPods / iOS build errors | `cd apps/timemanager/ios && pod install`; ensure full Xcode is selected |
| Node wrong version | `nvm install 20 && nvm use 20` (scripts install nvm) |
| Port `:3000` already in use | Stop Vite (`user-manager-web`) or GraphQL; don’t run both product stacks on defaults |
| Chrome missing for Flutter web | Install Chrome/Chromium; re-run setup or `--check` |

## Maintaining these scripts

When a change **adds or changes a machine-level local-dev tool**, update the following in the **same PR**:

1. This prerequisites table (name, pin, why, platforms)
2. Install + `--check` logic in `scripts/lib/setup-common.sh` and/or the OS script (`ensure_*` function + checklist record)
3. Any new `.env.example` → `.env` copy in `bootstrap_env_files`
4. Version pin sources (`.nvmrc`, Dart SDK in `pubspec.yaml`, JDK in Gradle, etc.)

**Counts as a tool update:** new runtime/package manager, required CLI, mandatory system package for native builds, required env file before first run.

**Does not:** npm/pub/Deno library deps; optional AWS/Authentik unless this doc’s scope expands.

Script structure: one `ensure_<tool>` function and one summary row per tool so additions stay small.
