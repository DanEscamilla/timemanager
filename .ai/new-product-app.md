# New product app checklist

How to add a third (or later) Flutter + Deno GraphQL product that follows the same pairing as timemanager / spendmanager.

Do **not** copy auth, JWKS, GraphQL client, or Kysely bootstrap from an existing app. Depend on the shared libs below.

## Shared building blocks

| Lib | Runtime | Use for |
|-----|---------|---------|
| [`libs/design_system`](../libs/design_system) | Flutter | Themes, tokens, `LoginView`, list empty/error/loading |
| [`libs/app_core`](../libs/app_core) | Flutter | AuthService, GraphQL client, idle monitor, locale/theme prefs, `AppEndpoints` |
| [`libs/deno_api_kit`](../libs/deno_api_kit) | Deno | JWKS verify, CORS, Kysely factory, `resolveLocalUser`, migrate + ensure DB, GraphQL auth middleware |

GraphQL codegen into `libs/` remains deferred — see [decisions.md](decisions.md).

## Checklist

1. **Database** on shared Postgres ([`infra/timemanager-db`](../infra/timemanager-db)):
   - Add an init SQL script under `infra/timemanager-db/init/` for fresh volumes (`CREATE DATABASE <name>;`).
   - Migrate bootstrap should call `ensureDatabase` (via `deno_api_kit`) so existing volumes get the DB too.
2. **API** `apps/<name>-api` (Deno + Pylon + Kysely):
   - Import map: `"deno_api_kit/": "../../libs/deno_api_kit/"`.
   - Thin `database.ts` via `createKysely`, thin `users.ts` wrapping kit `resolveLocalUser`, thin `index.ts` with `cors` + `health` + `createGraphQLAuthMiddleware`.
   - Own schema types, migrations, seed, GraphQL resolvers/validation.
   - Pick a free port (avoid `:3000` / `:3001` / `:3002`).
   - `.env.example` with `PGDATABASE=<name>`, `AUTH_API_DOMAIN`, `PORT`.
3. **Flutter** `apps/<name>`:
   - Path-dep `design_system` + `app_core`.
   - Thin `ApiConfig` = `AppEndpoints.local(apiPort: …, oauthNativeScheme: '<name>')` + `ApiConfig.ensureConfigured()` in `main`.
   - Re-export or import `app_core` services; map `AuthException` / `GraphQLException` with a small `exception_localizations.dart` extension over app ARB keys.
   - Domain: models, repos, screens, shell routes, `AuthController` wiring.
   - Web port (e.g. `:4445+`) and OAuth deep-link scheme.
4. **Auth / origins**:
   - Register the Flutter web origin in `user-manager-api` `ALLOWED_ORIGINS`.
5. **Monorepo glue**:
   - `project.json` tags: `scope:<name>`, `type:app|api`, `runtime:flutter|deno`.
   - Root `package.json` convenience script (e.g. `pnpm <name>` → `nx serve <name>-api`).
   - `.vscode/launch.json` Flutter config.
   - Update [AGENTS.md](../AGENTS.md), [architecture.md](architecture.md), [workflows.md](workflows.md), setup `bootstrap_env_files` / `flutter pub get` lists.
6. **Smoke**:
   - `nx run <name>-api:migrate` → `serve` (pulls auth + DB) → login → CRUD.

## Ports (current)

| Service | Port |
|---------|------|
| timemanager GraphQL | `:3000` |
| user-manager (SuperTokens) | `:3001` |
| spendmanager GraphQL | `:3002` |
| timemanager Flutter web | `:4444` |
| spendmanager Flutter web | `:4445` |

## Stay app-local

Domain models, repositories, GraphQL schema/resolvers, migrations, seed data, shell tabs, and product ARB strings. Do not extract full `AuthController` or go_router trees into shared libs.
