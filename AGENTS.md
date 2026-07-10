# AGENTS.md — Time Management Monorepo

Entrypoint for AI agents and humans. This is an **Nx + pnpm monorepo** with a mixed stack: a Flutter client, a Deno/Pylon GraphQL API, a React/Vite web app, an Express API, and dockerized infrastructure.

> Deeper reference docs live in [`.ai/`](.ai/). Runtime- and app-specific rules are auto-attached from [`.cursor/rules/`](.cursor/rules/).

## Monorepo map

| Path | Stack | Runtime | Port | Nx tags |
|------|-------|---------|------|---------|
| `apps/timemanager` | Flutter (Dart) client | flutter | — | `scope:timemanager, type:app, runtime:flutter` |
| `apps/timemanager-api` | Pylon GraphQL + Kysely + Postgres | deno | `:3000` | `scope:timemanager, type:api, runtime:deno` |
| `apps/user-manager-web` | React + Vite + SuperTokens | node | — | `scope:user-manager, type:app, runtime:node` |
| `apps/user-manager-api` | Express + SuperTokens | node | `:3001` | `scope:user-manager, type:api, runtime:node` |
| `infra/timemanager-db` | Postgres + pgAdmin (docker-compose) | docker | `:5432` / `:8080` | `type:infra` |
| `infra/authentik` | Authentik auth (docker-compose) | docker | — | `type:infra` |
| `libs/` | reserved for future shared code | — | — | — |

Data flow: Flutter -> GraphQL (`timemanager-api` `:3000`) -> Postgres (`timemanager-db` `:5432`); `user-manager-web` -> `user-manager-api` (`:3001`). See [`.ai/architecture.md`](.ai/architecture.md).

## Golden rules

- **Run everything through Nx from the repo root** (`nx ...` / the `pnpm` convenience scripts below), not by cd-ing into apps ad hoc.
- **Each app owns its runtime and package manager** — do not cross them:
  - Node apps (`user-manager-web`, `user-manager-api`): **pnpm** (workspace). Node version is pinned in `.nvmrc` (20).
  - `timemanager-api`: **Deno** via `deno.json` tasks. Not Node, not Bun, not npm/pnpm.
  - `timemanager`: **Flutter/Dart** via `pubspec.yaml`.
- **Never hand-edit generated/vendored output**: `dist/`, `.nx/cache/`, Flutter `build/`, `.dart_tool/`, `node_modules/`, docker `data/` volumes.
- **Secrets stay out of git**: `.env` files are gitignored; keep `.env.example` current.
- **Respect settled decisions and scope** — see [`.ai/decisions.md`](.ai/decisions.md) before proposing structural changes.

## Common commands

```bash
pnpm timemanager      # nx run-many -t serve -p timemanager,timemanager-api
pnpm user-manager     # nx run-many -t serve -p user-manager-web,user-manager-api
pnpm db:up            # start Postgres + pgAdmin (nx run timemanager-db:up)
pnpm db:down          # stop the DB stack
```

More detail in [`.ai/workflows.md`](.ai/workflows.md).

## Reference docs

- [`.ai/architecture.md`](.ai/architecture.md) — system + data-flow diagram, how the apps relate
- [`.ai/conventions.md`](.ai/conventions.md) — package managers, Nx tags, code style, testing, migrations
- [`.ai/workflows.md`](.ai/workflows.md) — run/build/seed/migrate + smoke checks
- [`.ai/decisions.md`](.ai/decisions.md) — origin, locked-in decisions, out-of-scope/future work
