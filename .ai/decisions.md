# Decisions & History

Settled decisions and context so agents don't re-litigate choices or attempt out-of-scope work. Sourced from the executed migration plan (`.cursor/plans/nx_monorepo_migration_4a2c1740.plan.md`).

## Origin

This repo was created by migrating three sibling projects into a single flat, app-centric Nx monorepo:

- `timemanager/` -> `apps/timemanager` (Flutter client)
- `timemanager-be/` -> `apps/timemanager-api` (Deno GraphQL) + `infra/timemanager-db` + `infra/authentik`
- `user-manager/frontend` -> `apps/user-manager-web`; `user-manager/backend` -> `apps/user-manager-api`

Git was initialized fresh at the workspace root; nested repos and local-only histories were dropped in the move.

## Locked-in decisions

- **Nx app-centric layout:** `apps/`, `libs/`, `infra/` at the root; a flat structure (no deep nesting by product area).
- **pnpm for Node apps only:** the pnpm workspace covers `user-manager-web` and `user-manager-api`. Deno and Flutter manage their own deps.
- **Deno stays Deno:** `timemanager-api` uses `deno.json`/`deno.lock`. No npm/pnpm/Bun there.
- **Flutter stays Flutter:** `timemanager` uses `pubspec.yaml`.
- **`nx:run-commands` wrappers** for Deno (`deno task`) and Flutter (`flutter` CLI) — the deprecated `@nx/deno` plugin and third-party Flutter Nx plugins are intentionally avoided.
- **Fresh local DB:** existing Docker volume data was not migrated; re-seed via `nx run timemanager-api:seed`.
- **Docker volumes** live under each infra project's `./data/` and are gitignored.

## Out of scope (do not build unless asked)

These were explicitly deferred in the migration. Treat as future direction, not current work:

- Extracting shared libs / GraphQL codegen into `libs/`.
- Wiring Authentik into SuperTokens or Flutter auth (the Authentik stack currently stands alone).
- CI pipelines / Nx Cloud.
- Renaming the workspace folder away from `flutter`.
