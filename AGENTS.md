# AGENTS.md — Time Management Monorepo

Entrypoint for AI agents and humans. This is an **Nx + pnpm monorepo** with a mixed stack: a Flutter client, a Deno/Pylon GraphQL API, a React/Vite web app, an Express API, and dockerized infrastructure.

> Deeper reference docs live in [`.ai/`](.ai/). Runtime- and app-specific rules are auto-attached from [`.cursor/rules/`](.cursor/rules/).

## Monorepo map

| Path | Stack | Runtime | Port | Nx tags |
|------|-------|---------|------|---------|
| `apps/timemanager` | Flutter (Dart) client | flutter | — | `scope:timemanager, type:app, runtime:flutter` |
| `apps/timemanager-api` | Pylon GraphQL + Kysely + Postgres | deno | `:3000` | `scope:timemanager, type:api, runtime:deno` |
| `apps/spendmanager` | Flutter (Dart) spending tracker | flutter | — | `scope:spendmanager, type:app, runtime:flutter` |
| `apps/spendmanager-api` | Pylon GraphQL + Kysely + Postgres | deno | `:3002` | `scope:spendmanager, type:api, runtime:deno` |
| `apps/mailbox-api` | Pylon GraphQL + Kysely + Postgres (email ingest) | deno | `:3003` | `scope:mailbox, type:api, runtime:deno` |
| `apps/mailbox-worker` | Email poll / extract worker | deno | — | `scope:mailbox, type:api, runtime:deno` |
| `apps/ai-api` | Internal AI gateway (REST use cases) | deno | `:3004` | `scope:shared, type:api, runtime:deno` |
| `apps/user-manager-web` | React + Vite + SuperTokens | node | — | `scope:user-manager, type:app, runtime:node` |
| `apps/user-manager-api` | Express + SuperTokens | node | `:3001` | `scope:user-manager, type:api, runtime:node` |
| `infra/timemanager-db` | Postgres + pgAdmin (docker-compose) | docker | `:5432` / `:8080` | `type:infra` |
| `infra/authentik` | Authentik auth (docker-compose) | docker | — | `type:infra` |
| `libs/design_system` | Shared Flutter Material 3 design system | flutter | — | `scope:shared, type:lib, runtime:flutter` |
| `libs/app_core` | Shared Flutter auth / GraphQL / prefs infra | flutter | — | `scope:shared, type:lib, runtime:flutter` |
| `libs/local_notifications` | Shared local OS / in-session browser notifications | flutter | — | `scope:shared, type:lib, runtime:flutter` |
| `libs/push_notifications` | Provider-agnostic push (Firebase FCM impl) | flutter | — | `scope:shared, type:lib, runtime:flutter` |
| `libs/deno_api_kit` | Shared Deno Pylon/Kysely API infra | deno | — | `scope:shared, type:lib, runtime:deno` |
| `libs/mailbox_kit` | Shared Deno email provider / extract pipeline | deno | — | `scope:shared, type:lib, runtime:deno` |
| `libs/ai_kit` | Shared Deno AI provider abstraction (Gemini / OpenAI-compatible) | deno | — | `scope:shared, type:lib, runtime:deno` |
| `libs/` | reserved for additional shared packages | — | — | — |

Data flow: Flutter apps authenticate via SuperTokens (`user-manager-api` `:3001`), then call their GraphQL APIs with a Bearer JWT. `timemanager-api` (`:3000`, DB `timemanager`), `spendmanager-api` (`:3002`, DB `spendmanager`), and `mailbox-api` (`:3003`, DB `mailbox`) share the same Postgres instance and JWKS verification. `user-manager-web` also uses the same SuperTokens API. See [`.ai/architecture.md`](.ai/architecture.md).

## Golden rules

- **Run everything through Nx from the repo root** (`nx ...` / the `pnpm` convenience scripts below), not by cd-ing into apps ad hoc.
- **Each app owns its runtime and package manager** — do not cross them:
  - Node apps (`user-manager-web`, `user-manager-api`): **pnpm** (workspace). Node version is pinned in `.nvmrc` (20).
  - Deno APIs (`timemanager-api`, `spendmanager-api`, `mailbox-api`, `mailbox-worker`, `ai-api`): **Deno** via `deno.json` tasks. Not Node, not Bun, not npm/pnpm.
  - Flutter apps (`timemanager`, `spendmanager`): **Flutter/Dart** via `pubspec.yaml`.
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
pnpm spendmanager     # spendmanager GraphQL + auth + DB; launch Flutter via IDE (spendmanager)
pnpm mailbox          # mailbox GraphQL :3003 + poll worker + auth + DB
pnpm ai               # ai-api REST gateway :3004 (backends only; service key)
pnpm user-manager     # nx run-many -t serve -p user-manager-web,user-manager-api
pnpm db:up            # start Postgres + pgAdmin, then run timemanager migrations
pnpm db:down          # stop the DB stack
```

`timemanager-api:serve` depends on `migrate` (DB) and `user-manager-api:serve` (auth). Flutter is launched from `.vscode/launch.json`, not from `pnpm timemanager`. More detail in [`.ai/workflows.md`](.ai/workflows.md).

## Reference docs

- [`.ai/architecture.md`](.ai/architecture.md) — system + data-flow diagram, how the apps relate
- [`.ai/conventions.md`](.ai/conventions.md) — package managers, Nx tags, code style, testing, migrations
- [`.ai/new-product-app.md`](.ai/new-product-app.md) — checklist for scaffolding another Flutter + Deno product
- [`.ai/mailbox.md`](.ai/mailbox.md) — email ingest product (mailbox-api / worker / mailbox_kit)
- [`.ai/ai-api.md`](.ai/ai-api.md) — internal AI gateway (ai-api / ai_kit)
- [`.ai/local-setup.md`](.ai/local-setup.md) — new-machine scripts, tool inventory, first run
- [`.ai/workflows.md`](.ai/workflows.md) — run/build/seed/migrate + smoke checks
- [`.ai/deploy-aws.md`](.ai/deploy-aws.md) — AWS Terraform, deploy scripts, CI/CD contract
- [`.ai/aws-architecture.md`](.ai/aws-architecture.md) — full vs simplified AWS layouts, comparison, cost notes
- [`.ai/aws-concepts.md`](.ai/aws-concepts.md) — Route 53, ALB, ECS/Fargate, IAM vs SuperTokens, and related glossary
- [`.ai/decisions.md`](.ai/decisions.md) — origin, locked-in decisions, out-of-scope/future work
