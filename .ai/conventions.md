# Conventions

## Package managers by runtime

Each app owns its runtime and package manager. **Do not mix them.**

| App | Runtime | Package manager | Manifest |
|-----|---------|-----------------|----------|
| `apps/user-manager-web` | Node | **pnpm** (workspace) | `package.json` |
| `apps/user-manager-api` | Node | **pnpm** (workspace) | `package.json` |
| `apps/timemanager-api` | **Deno** | Deno | `deno.json` / `deno.lock` |
| `apps/spendmanager-api` | **Deno** | Deno | `deno.json` / `deno.lock` |
| `apps/mailbox-api` | **Deno** | Deno | `deno.json` / `deno.lock` |
| `apps/mailbox-worker` | **Deno** | Deno | `deno.json` / `deno.lock` |
| `apps/timemanager` | **Flutter** | Flutter/Dart | `pubspec.yaml` / `pubspec.lock` |
| `apps/spendmanager` | **Flutter** | Flutter/Dart | `pubspec.yaml` / `pubspec.lock` |
| `libs/design_system` | **Flutter** | Flutter/Dart (path dep) | `pubspec.yaml` |
| `libs/app_core` | **Flutter** | Flutter/Dart (path dep) | `pubspec.yaml` |
| `libs/deno_api_kit` | **Deno** | Deno (import map) | `deno.json` |
| `libs/mailbox_kit` | **Deno** | Deno (import map) | `deno.json` |
| `libs/ai_kit` | **Deno** | Deno (import map) | `deno.json` |

- pnpm is configured at the root (`pnpm-workspace.yaml`) for **Node apps only**. Node version is pinned in `.nvmrc` (20).
- Deno APIs declare deps in `deno.json` `imports`; never introduce npm/pnpm/Bun tooling there.
- Flutter libs under `libs/` use their own `pubspec.yaml` and are consumed via `path:` dependencies — **not** pnpm.
- Run tasks through Nx from the repo root rather than invoking package managers directly where possible.
- **Machine-level tools** (runtimes, Docker, Android SDK, Xcode, etc.) are installed by `scripts/setup-*.sh`. If you add or change a required local-dev tool, update [local-setup.md](local-setup.md) and those scripts in the same change — see the maintenance checklist in that doc.

## Nx tag taxonomy

Every `project.json` carries tags used for filtering and scope reasoning:

- `scope:*` — product area: `scope:timemanager`, `scope:spendmanager`, `scope:mailbox`, `scope:user-manager`, `scope:shared`
- `type:*` — role: `type:app`, `type:api`, `type:infra`, `type:lib`
- `runtime:*` — runtime: `runtime:flutter`, `runtime:deno`, `runtime:node`

## Nx targets

- App/API projects expose `serve` / `build` (and `lint` / `test` where applicable).
- Deno and Flutter targets are `nx:run-commands` wrappers around the native CLI (`deno task`, `flutter`) — the `@nx/deno` plugin is intentionally not used.
- `timemanager-api:migrate`, `spendmanager-api:migrate`, and `mailbox-api:migrate` declare `dependsOn: ["timemanager-db:up"]`; `serve` and `seed` depend on `migrate` so the DB is up and schema is applied first.
- Flutter `serve` targets declare `dependsOn: ["user-manager-api:serve"]` with both targets marked `continuous: true`, so the SuperTokens SSO API starts alongside the client.
- Infra projects expose `up` / `down` / `logs` wrapping `docker compose`.

## Auth (SuperTokens SSO)

- `user-manager-api` is the shared auth hub. Flutter uses header-based session tokens; React uses cookies.
- Product GraphQL APIs verify Bearer JWTs via SuperTokens JWKS and map `users.auth_user_id` → local numeric ids. Never trust a client-supplied user id.
## Code style

- **TypeScript (Node apps):** follow each app's `eslint.config.*`; build with `tsc` where configured.
- **Deno:** rely on `deno.json` `compilerOptions` (`strict: true`); prefer `deno lint`/`deno fmt` conventions.
- **Dart/Flutter:** lints from `flutter_lints` via `analysis_options.yaml`; check with `nx run <app>:analyze`.

## Database & migrations

- Schema types in each API's `src/db/types/schema.ts`; connection/pool in `src/db/database.ts`.
- Migrations are timestamped files in `src/db/migrations/` run via `migration.ts` (`deno task migrate` / `nx run <api>:migrate`).
- Local Postgres comes from `infra/timemanager-db`. Databases: `timemanager` (default), `spendmanager`, and `mailbox` (created by init script / migrate bootstrap). Do not migrate volume data between machines — re-seed instead.

## Secrets

- `.env` files are gitignored; commit `.env.example` with the required keys instead (e.g. Authentik's `PG_PASS`, `AUTHENTIK_SECRET_KEY`).
