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
- **SuperTokens is the shared SSO layer:** `user-manager-api` authenticates Flutter, React, and future apps. Session JWTs are verified by `timemanager-api` via JWKS; local `users.auth_user_id` maps SuperTokens identity to Postgres rows.

## Out of scope (do not build unless asked)

These were explicitly deferred in the migration. Treat as future direction, not current work:

- Extracting shared libs / GraphQL codegen into `libs/`.
- Wiring Authentik into SuperTokens or Flutter auth (the Authentik stack currently stands alone; SuperTokens covers multi-app SSO without it).
- Implementing CI pipelines / Nx Cloud (infra and deploy scripts are CI-ready; workflows not shipped yet).
- Renaming the workspace folder away from `flutter`.
- Self-hosting SuperTokens Core (currently `try.supertokens.com` for local/dev and first AWS staging; cloud hosts use env `SUPERTOKENS_CONNECTION_URI`).

## Cloud (AWS)

Settled for the first cloud environment (see [`.ai/deploy-aws.md`](deploy-aws.md)):

- **AWS** with ECS Fargate (APIs), RDS Postgres 15, S3 + CloudFront (Flutter web + `user-manager-web`), ALB host routing, Terraform under `infra/aws/`.
- Hostnames: `auth.` / `api.` / `app.` / `account.` under a single apex domain.
- Deploy scripts under `infra/aws/scripts/` are the contract for a future GitHub Actions + OIDC pipeline.