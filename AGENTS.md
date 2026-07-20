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
| `libs/design_system` | Shared Flutter Material 3 design system | flutter | — | `scope:shared, type:lib, runtime:flutter` |
| `libs/` | reserved for future shared code | — | — | — |

Data flow: Flutter authenticates via SuperTokens (`user-manager-api` `:3001`), then calls GraphQL (`timemanager-api` `:3000`) with a Bearer JWT; the API verifies JWKS and scopes data per user. `user-manager-web` also uses the same SuperTokens API. See [`.ai/architecture.md`](.ai/architecture.md).

## Golden rules

- **Run everything through Nx from the repo root** (`nx ...` / the `pnpm` convenience scripts below), not by cd-ing into apps ad hoc.
- **Each app owns its runtime and package manager** — do not cross them:
  - Node apps (`user-manager-web`, `user-manager-api`): **pnpm** (workspace). Node version is pinned in `.nvmrc` (20).
  - `timemanager-api`: **Deno** via `deno.json` tasks. Not Node, not Bun, not npm/pnpm.
  - `timemanager`: **Flutter/Dart** via `pubspec.yaml`.
- **Never hand-edit generated/vendored output**: `dist/`, `.nx/cache/`, Flutter `build/`, `.dart_tool/`, `node_modules/`, docker `data/` volumes.
- **Secrets stay out of git**: `.env` files are gitignored; keep `.env.example` current.
- **Respect settled decisions and scope** — see [`.ai/decisions.md`](.ai/decisions.md) before proposing structural changes.
- **New local runtime/CLI → update setup scripts** — keep [`.ai/local-setup.md`](.ai/local-setup.md) and `scripts/setup-*.sh` in sync (see that doc’s maintenance checklist).

## New machine

```bash
./scripts/setup-macos.sh    # macOS: APIs + Flutter web/iOS/Android tooling
./scripts/setup-linux.sh    # Linux: APIs + Flutter web/Android tooling
```

Details: [`.ai/local-setup.md`](.ai/local-setup.md).

## Common commands

```bash
pnpm timemanager      # GraphQL API + auth + DB; launch Flutter via IDE (Run and Debug → timemanager)
pnpm user-manager     # nx run-many -t serve -p user-manager-web,user-manager-api
pnpm db:up            # start Postgres + pgAdmin, then run migrations
pnpm db:down          # stop the DB stack
```

`timemanager-api:serve` depends on `migrate` (DB) and `user-manager-api:serve` (auth). Flutter is launched from `.vscode/launch.json`, not from `pnpm timemanager`. More detail in [`.ai/workflows.md`](.ai/workflows.md).

## Reference docs

- [`.ai/architecture.md`](.ai/architecture.md) — system + data-flow diagram, how the apps relate
- [`.ai/conventions.md`](.ai/conventions.md) — package managers, Nx tags, code style, testing, migrations
- [`.ai/local-setup.md`](.ai/local-setup.md) — new-machine scripts, tool inventory, first run
- [`.ai/workflows.md`](.ai/workflows.md) — run/build/seed/migrate + smoke checks
- [`.ai/deploy-aws.md`](.ai/deploy-aws.md) — AWS Terraform, deploy scripts, CI/CD contract
- [`.ai/aws-architecture.md`](.ai/aws-architecture.md) — full vs simplified AWS layouts, comparison, cost notes
- [`.ai/aws-concepts.md`](.ai/aws-concepts.md) — Route 53, ALB, ECS/Fargate, IAM vs SuperTokens, and related glossary
- [`.ai/decisions.md`](.ai/decisions.md) — origin, locked-in decisions, out-of-scope/future work
