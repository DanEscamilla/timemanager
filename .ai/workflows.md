# Workflows

All commands run from the repo root unless noted. Prefer Nx targets and the root `package.json` convenience scripts.

## New machine

Install local-dev tools (Node 20, pnpm, Deno, Flutter, Docker, Android; plus Xcode/CocoaPods on macOS) with:

```bash
./scripts/setup-macos.sh    # or ./scripts/setup-linux.sh
```

Full inventory, manual steps, and how to keep the scripts in sync: [local-setup.md](local-setup.md).

## Run the apps

```bash
# timemanager APIs (GraphQL + auth; also starts DB via migrate)
pnpm timemanager            # nx serve timemanager-api

# spendmanager APIs (GraphQL :3002 + auth; also starts DB via migrate)
pnpm spendmanager           # nx serve spendmanager-api

# Flutter clients — Run and Debug in the IDE
# timemanager → Chrome :4444; spendmanager → Chrome :4445

# user-manager stack (React web + Express API)
pnpm user-manager           # nx run-many -t serve -p user-manager-web,user-manager-api

# individual projects
nx serve timemanager        # flutter run -d chrome --web-port=4444 (also starts user-manager-api)
nx serve spendmanager       # flutter run -d chrome --web-port=4445 (also starts user-manager-api)
nx serve timemanager-api    # deno task dev on :3000 (migrate → DB + user-manager-api)
nx serve spendmanager-api   # deno task dev on :3002 (migrate → DB + user-manager-api)
nx serve user-manager-web   # vite dev server
nx serve user-manager-api   # express server
```

`pnpm timemanager` starts GraphQL on `:3000`, SuperTokens on `:3001`, and Postgres. `pnpm spendmanager` starts GraphQL on `:3002` (same auth + DB stack). Launch Flutter from the IDE (**spendmanager** / **timemanager**).

## Database

```bash
pnpm db:up                  # start Postgres + pgAdmin, then run timemanager migrations
pnpm db:down                # stop the DB stack
nx run timemanager-api:migrate
nx run spendmanager-api:migrate  # also CREATE DATABASE spendmanager if missing
nx run timemanager-api:seed
nx run spendmanager-api:seed
```

pgAdmin: `http://localhost:8080` (default creds in `infra/timemanager-db/docker-compose.yml`). Databases on the same instance: `timemanager`, `spendmanager`.

## Migrations

1. Add a timestamped migration file under the API's `src/db/migrations/` following `YYYY-MM-DDThh:mm:ss_name.ts`.
2. Run `nx run <api>:migrate` (`deno task migrate`). Pending migrations also run automatically before `serve`.
3. Update `src/db/types/schema.ts` to match, and re-seed if needed.

## Build

```bash
nx build timemanager-api    # deno task build
nx build user-manager-web   # vite build
nx build user-manager-api   # tsc
nx run timemanager:analyze  # flutter analyze
```

### Flutter against cloud (staging/production APIs)

`ApiConfig` defaults to localhost. Override with `--dart-define` (or a defines file) so builds point at `auth.<domain>` / `api.<domain>`.

Optional: `IDLE_SESSION_TIMEOUT_MINUTES` (default `30`) controls client-side idle logout; set to `0` to disable.

```bash
# one-time: copy and edit (or rely on DOMAIN below)
cp apps/timemanager/config/cloud.dart-defines.json.example \
   apps/timemanager/config/cloud.dart-defines.json

# release builds baked with cloud URLs
DOMAIN=example.com nx run timemanager:build-web
DOMAIN=example.com nx run timemanager:build-macos
DOMAIN=example.com nx run timemanager:build-ios        # .app (needs Xcode signing for device)
DOMAIN=example.com nx run timemanager:build-ipa        # App Store / TestFlight archive
DOMAIN=example.com nx run timemanager:build-apk        # Android sideload
DOMAIN=example.com nx run timemanager:build-appbundle  # Play Store
DOMAIN=example.com nx run timemanager:build-linux
DOMAIN=example.com nx run timemanager:build-windows

# run against cloud APIs (no local API stack needed)
DOMAIN=example.com nx run timemanager:serve-cloud
DOMAIN=example.com nx run timemanager:serve-cloud-macos
```

Resolution order for `with-cloud-apis.sh` / those targets: `AUTH_API_BASE_URL`+`API_BASE_URL` env → `config/cloud.dart-defines.json` → `DOMAIN`.

IDE: **Run and Debug → timemanager (cloud)** / **(macos, cloud)** / **(ios, cloud)** / **(android, cloud)** (requires `config/cloud.dart-defines.json`). Auth CORS already allows `localhost` / `127.0.0.1`; native clients are not subject to browser CORS.

## Smoke checks (after structural changes)

Adapted from the migration plan's verification phase:

```bash
pnpm install                # Node workspace deps
cd apps/timemanager && flutter pub get && cd -
cd apps/spendmanager && flutter pub get && cd -
nx run timemanager-db:up
nx serve timemanager-api    # confirm GraphQL responds on :3000 (requires Bearer JWT)
nx serve spendmanager-api   # confirm GraphQL responds on :3002 (requires Bearer JWT)
nx serve user-manager-api   # :3001 SuperTokens SSO
nx serve timemanager        # Flutter login → GraphQL with Authorization header
nx serve spendmanager       # Chrome :4445 → categories/expenses CRUD
nx serve user-manager-web   # React cookie auth still works
nx run authentik:up         # optional, independent stack
```

### Auth smoke (Flutter apps)

1. Sign up or sign in in Flutter against `:3001` (email/password or OAuth).
2. GraphQL without `Authorization` → `401`.
3. With a valid Bearer access token → data scoped to the mapped local user.
4. Sign out clears tokens and returns to the login screen.

## AWS cloud deploy

See [`.ai/deploy-aws.md`](deploy-aws.md) for Terraform bootstrap, API/web deploy scripts, auth hostnames, OAuth callbacks, smoke checks, and the CI/CD job mapping.

Quick path (after `infra/aws` is configured):

```bash
cd infra/aws && terraform apply
./infra/aws/scripts/deploy-apis.sh
./infra/aws/scripts/deploy-web.sh          # DOMAIN via infra/aws/.local.env
./infra/aws/scripts/check-health.sh        # or: nx run timemanager-aws:health
./infra/aws/scripts/ecs-shell.sh           # or: nx run timemanager-aws:ecs-shell
nx run timemanager-aws:down               # hibernate (cut NAT/ALB/Fargate burn)
nx run timemanager-aws:up                 # wake + redeploy APIs/web
```
