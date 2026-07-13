# Workflows

All commands run from the repo root unless noted. Prefer Nx targets and the root `package.json` convenience scripts.

## Run the apps

```bash
# timemanager APIs (GraphQL + auth; also starts DB via migrate)
pnpm timemanager            # nx serve timemanager-api

# Flutter client — Run and Debug in the IDE (launch config: "timemanager")
# Chrome on :4444 by default; use "timemanager (macos)" for native hot reload

# user-manager stack (React web + Express API)
pnpm user-manager           # nx run-many -t serve -p user-manager-web,user-manager-api

# individual projects
nx serve timemanager        # flutter run -d chrome --web-port=4444 (also starts user-manager-api; override: -- -d macos|ios|…)
nx serve timemanager-api    # deno task dev (also runs migrate → DB + user-manager-api)
nx serve user-manager-web   # vite dev server
nx serve user-manager-api   # express server
```

`pnpm timemanager` / `nx serve timemanager-api` starts the GraphQL API on `:3000`, SuperTokens auth on `:3001`, and Postgres. Launch the Flutter app from the IDE with **Run and Debug → timemanager** (debug mode, hot reload on save).

## Database

```bash
pnpm db:up                  # start Postgres + pgAdmin, then run migrations
pnpm db:down                # stop the DB stack
nx run timemanager-api:migrate # apply pending migrations (also starts DB)
nx run timemanager-api:seed # seed the database (also migrates)
```

pgAdmin: `http://localhost:8080` (default creds in `infra/timemanager-db/docker-compose.yml`).

## Migrations (`timemanager-api`)

1. Add a timestamped migration file under `apps/timemanager-api/src/db/migrations/` following the existing `YYYY-MM-DDThh:mm:ss_name.ts` pattern.
2. Run `pnpm db:up` or `nx run timemanager-api:migrate` (`deno task migrate`). Pending migrations also run automatically before `timemanager-api:serve`.
3. Update `src/db/types/schema.ts` to match the new schema, and re-seed if needed.

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
nx serve timemanager-api    # confirm GraphQL responds on :3000 (requires Bearer JWT)
nx serve user-manager-api   # :3001 SuperTokens SSO
nx serve timemanager        # Flutter login → GraphQL with Authorization header
nx serve user-manager-web   # React cookie auth still works
nx run authentik:up         # optional, independent stack
```

### Auth smoke (timemanager)

1. Sign up or sign in in Flutter against `:3001` (email/password or OAuth).
2. GraphQL without `Authorization` → `401`.
3. With a valid Bearer access token → activities scoped to the mapped local user.
4. Sign out clears tokens and returns to the login screen.
