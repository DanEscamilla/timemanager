# Workflows

All commands run from the repo root unless noted. Prefer Nx targets and the root `package.json` convenience scripts.

## Run the apps

```bash
# timemanager stack (Flutter client + Deno GraphQL API; API auto-starts the DB)
pnpm timemanager            # nx run-many -t serve -p timemanager,timemanager-api

# user-manager stack (React web + Express API)
pnpm user-manager           # nx run-many -t serve -p user-manager-web,user-manager-api

# individual projects
nx serve timemanager        # flutter run
nx serve timemanager-api    # deno task dev (also runs timemanager-db:up)
nx serve user-manager-web   # vite dev server
nx serve user-manager-api   # express server
```

## Database

```bash
pnpm db:up                  # start Postgres :5432 + pgAdmin :8080
pnpm db:down                # stop the DB stack
nx run timemanager-api:seed # seed the database
```

pgAdmin: `http://localhost:8080` (default creds in `infra/timemanager-db/docker-compose.yml`).

## Migrations (`timemanager-api`)

1. Add a timestamped migration file under `apps/timemanager-api/src/db/migrations/` following the existing `YYYY-MM-DDThh:mm:ss_name.ts` pattern.
2. Ensure the DB is up (`pnpm db:up`).
3. Run the migration via the `migration.ts` runner (`deno task` in `apps/timemanager-api`).
4. Update `src/db/types/schema.ts` to match the new schema, and re-seed if needed.

## Build

```bash
nx build timemanager-api    # deno task build
nx build user-manager-web   # vite build
nx build user-manager-api   # tsc
nx run timemanager:analyze  # flutter analyze
```

## Smoke checks (after structural changes)

Adapted from the migration plan's verification phase:

```bash
pnpm install                # Node workspace deps
cd apps/timemanager && flutter pub get && cd -
nx run timemanager-db:up
nx serve timemanager-api    # confirm GraphQL responds on :3000
nx serve timemanager        # confirm Flutter hits :3000 (lib/config/api_config.dart)
nx serve user-manager-api   # :3001
nx serve user-manager-web
nx run authentik:up         # optional, independent stack
```
