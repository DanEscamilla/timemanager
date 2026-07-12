# Conventions

## Package managers by runtime

Each app owns its runtime and package manager. **Do not mix them.**

| App | Runtime | Package manager | Manifest |
|-----|---------|-----------------|----------|
| `apps/user-manager-web` | Node | **pnpm** (workspace) | `package.json` |
| `apps/user-manager-api` | Node | **pnpm** (workspace) | `package.json` |
| `apps/timemanager-api` | **Deno** | Deno | `deno.json` / `deno.lock` |
| `apps/timemanager` | **Flutter** | Flutter/Dart | `pubspec.yaml` / `pubspec.lock` |

- pnpm is configured at the root (`pnpm-workspace.yaml`) for **Node apps only**. Node version is pinned in `.nvmrc` (20).
- `timemanager-api` is Deno: declare deps in `deno.json` `imports`; never introduce npm/pnpm/Bun tooling there.
- Run tasks through Nx from the repo root rather than invoking package managers directly where possible.

## Nx tag taxonomy

Every `project.json` carries tags used for filtering and scope reasoning:

- `scope:*` — product area: `scope:timemanager`, `scope:user-manager`
- `type:*` — role: `type:app`, `type:api`, `type:infra`
- `runtime:*` — runtime: `runtime:flutter`, `runtime:deno`, `runtime:node`

## Nx targets

- App/API projects expose `serve` / `build` (and `lint` / `test` where applicable).
- Deno and Flutter targets are `nx:run-commands` wrappers around the native CLI (`deno task`, `flutter`) — the `@nx/deno` plugin is intentionally not used.
- `timemanager-api:migrate` declares `dependsOn: ["timemanager-db:up"]`; `serve` and `seed` depend on `migrate` so the DB is up and schema is applied first.
- `timemanager:serve` declares `dependsOn: ["user-manager-api:serve"]` with both targets marked `continuous: true`, so the SuperTokens SSO API starts alongside the Flutter client.
- Infra projects expose `up` / `down` / `logs` wrapping `docker compose`.

## Auth (SuperTokens SSO)

- `user-manager-api` is the shared auth hub. Flutter uses header-based session tokens; React uses cookies.
- `timemanager-api` verifies Bearer JWTs via SuperTokens JWKS and maps `users.auth_user_id` → local numeric ids. Never trust a client-supplied user id.
## Code style

- **TypeScript (Node apps):** follow each app's `eslint.config.*`; build with `tsc` where configured.
- **Deno:** rely on `deno.json` `compilerOptions` (`strict: true`); prefer `deno lint`/`deno fmt` conventions.
- **Dart/Flutter:** lints from `flutter_lints` via `analysis_options.yaml`; check with `nx run timemanager:analyze`.

## Database & migrations (`timemanager-api`)

- Schema types in `src/db/types/schema.ts`; connection/pool in `src/db/database.ts`.
- Migrations are timestamped files in `src/db/migrations/` run via `migration.ts` (`deno task migrate` / `nx run timemanager-api:migrate`). `pnpm db:up` runs migrate after starting Postgres.
- Seed data via `src/db/seed.ts` (`deno task seed` / `nx run timemanager-api:seed`).
- Local Postgres comes from `infra/timemanager-db`; do not migrate volume data between machines — re-seed instead.

## Secrets

- `.env` files are gitignored; commit `.env.example` with the required keys instead (e.g. Authentik's `PG_PASS`, `AUTHENTIK_SECRET_KEY`).
