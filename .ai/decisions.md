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

- GraphQL codegen into `libs/`.
- Wiring Authentik into SuperTokens or Flutter auth (the Authentik stack currently stands alone; SuperTokens covers multi-app SSO without it).
- Broader CI (PR test gates, infra apply from CI, path filters) / Nx Cloud. Staging **app** deploy via GitHub Actions + OIDC is shipped (`.github/workflows/deploy-staging.yml`); see [deploy-aws.md](deploy-aws.md).
- Renaming the workspace folder away from `flutter`.
- Self-hosting SuperTokens Core (currently `try.supertokens.com` for local/dev and first AWS staging; cloud hosts use env `SUPERTOKENS_CONNECTION_URI`).
- Web/CSS token mirror of `libs/design_system` for React apps.

## Shared libraries

- **`libs/design_system`** — Flutter Material 3 tokens, themes, UI kit. Apps depend via `path:` in `pubspec.yaml`, not pnpm. Tags: `scope:shared`, `type:lib`, `runtime:flutter`.
- **`libs/app_core`** — Flutter product-app infrastructure (SuperTokens FDI auth, token stores, GraphQL client, idle session, locale/theme prefs, `AppEndpoints`). Path dep; apps keep thin `ApiConfig` + l10n exception mappers.
- **`libs/local_notifications`** — Shared local OS notifications (`flutter_local_notifications`) and in-session browser notifications. Apps pass a `LocalNotificationConfig` (channel + cache key) and schedule/show domain-agnostic payloads; activity planning and budget alert policy stay in each app.
- **`libs/push_notifications`** — Provider-agnostic push registration and message streams (`PushProvider` + `FirebasePushProvider`). Apps own when to register tokens with their product API. Full-stack use: spendmanager budget-threshold FCM via `device_tokens` + `budget_alert_sends` (server send; local alerts remain a fallback when no FCM token); timemanager registers `device_tokens` the same way while activity reminders stay local until a server scheduler exists.
- **`libs/deno_api_kit`** — Deno Pylon/Kysely API infrastructure (JWKS + CORS, SSL helpers, Kysely factory, `resolveLocalUser`, migrate/ensure DB, health + GraphQL auth middleware, optional `push/` Firebase Admin sender). Consumed via Deno import map `"deno_api_kit/": "../../libs/deno_api_kit/"` and matching `tsconfig.json` `paths` (Pylon serves with Bun).

## Cloud (AWS)

Settled for the first cloud environment (see [`.ai/deploy-aws.md`](deploy-aws.md)):

- **AWS** with ECS Fargate (APIs), RDS Postgres 15, S3 + CloudFront (Flutter web + `user-manager-web`), ALB host routing, Terraform under `infra/aws/`.
- Hostnames: `auth.` / `api.` / `app.` / `account.` under a single apex domain.
- Deploy scripts under `infra/aws/scripts/` are the contract for CI; staging pushes run them via GitHub Actions + OIDC (no long-lived AWS keys in GitHub).