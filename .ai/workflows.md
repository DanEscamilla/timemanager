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

# mailbox email ingest (GraphQL :3003 + poll worker + auth + DB)
pnpm mailbox                # nx run-many -t serve -p mailbox-api,mailbox-worker

# internal AI gateway (REST :3004; backends only)
pnpm ai                     # nx serve ai-api

# Flutter clients — Run and Debug in the IDE
# timemanager → Chrome :4444; spendmanager → Chrome :4445

# user-manager stack (React web + Express API)
pnpm user-manager           # nx run-many -t serve -p user-manager-web,user-manager-api

# individual projects
nx serve timemanager        # flutter run -d chrome --web-port=4444 (also starts user-manager-api)
nx serve spendmanager       # flutter run -d chrome --web-port=4445 (also starts user-manager-api)
nx serve timemanager-api    # deno task dev on :3000 (migrate → DB + user-manager-api)
nx serve spendmanager-api   # deno task dev on :3002 (migrate → DB + user-manager-api)
nx serve mailbox-api        # deno task dev on :3003 (migrate → DB + user-manager-api)
nx serve mailbox-worker     # poll / extract loop (depends on mailbox-api:migrate)
nx serve ai-api             # deno task dev on :3004 (service key; no auth/DB deps)
nx serve user-manager-web   # vite dev server
nx serve user-manager-api   # express server
```

`pnpm timemanager` starts GraphQL on `:3000`, SuperTokens on `:3001`, and Postgres. `pnpm spendmanager` starts GraphQL on `:3002` (same auth + DB stack). `pnpm mailbox` starts GraphQL on `:3003` plus the poll worker. `pnpm ai` starts the AI gateway on `:3004`. Launch Flutter from the IDE (**spendmanager** / **timemanager**).

## Database

```bash
pnpm db:up                  # start Postgres + pgAdmin, then run timemanager migrations
pnpm db:down                # stop the DB stack
nx run timemanager-api:migrate
nx run spendmanager-api:migrate  # also CREATE DATABASE spendmanager if missing
nx run mailbox-api:migrate       # also CREATE DATABASE mailbox if missing
nx run timemanager-api:seed
nx run spendmanager-api:seed
nx run mailbox-api:seed
```

pgAdmin: `http://localhost:8080` (default creds in `infra/timemanager-db/docker-compose.yml`). Databases on the same instance: `timemanager`, `spendmanager`, `mailbox`.

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

### Spendmanager push notifications (optional FCM)

Without Firebase credentials on the API, sends are a no-op (client falls back to local budget alerts when no FCM token). To enable server push:

1. Create a Firebase project and download a **service account** JSON (Cloud Messaging enabled).
2. In `apps/spendmanager-api/.env`, set either:
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` (gitignored), or
   - `FIREBASE_SERVICE_ACCOUNT_JSON={...}` (raw JSON string).
3. Client config comes from FlutterFire (`apps/spendmanager/lib/firebase_options.dart` + platform `google-services.json` / `GoogleService-Info.plist`). Re-run when apps change:

```bash
cd apps/spendmanager
flutterfire configure --project=<firebase-project-id>
```

4. **Web (Chrome :4445):** keep `apps/spendmanager/web/firebase-messaging-sw.js` in sync with the web `FirebaseOptions` (and the JS SDK version in `firebase_core_web`). Create a **Web Push certificate** in Firebase Console → Project settings → Cloud Messaging, then put the public key in the local dart-defines file:

```bash
cp apps/spendmanager/config/local.dart-defines.json.example \
   apps/spendmanager/config/local.dart-defines.json
# edit FCM_VAPID_KEY=...
```

IDE launches (**spendmanager** / **spendmanager (macos)**) load that file via `--dart-define-from-file`. CLI:

```bash
flutter run -d chrome --web-port=4445 \
  --dart-define-from-file=config/local.dart-defines.json
```

If you previously blocked notifications for `localhost:4445`, Chrome will not prompt again until you reset the site permission (lock icon → Site settings → Notifications → Allow / Reset).

On sign-in the app registers an FCM token via `registerDeviceToken`. Expense/budget writes that newly cross `alert_percent` send a push (deduped per budget + period in `budget_alert_sends`).

### Timemanager push notifications (optional FCM)

Same credential + FlutterFire pattern as spendmanager, but **activity reminders stay local** (`ActivityNotificationScheduler`) until a server scheduler exists. FCM today is device registration plumbing so tokens are ready for future server sends.

1. Service account in `apps/timemanager-api/.env`:
   - `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` (gitignored `*-firebase-adminsdk-*.json`), or
   - `FIREBASE_SERVICE_ACCOUNT_JSON={...}`.
2. Client: `apps/timemanager/lib/firebase_options.dart` + platform Google service files from FlutterFire:

```bash
cd apps/timemanager
flutterfire configure --project=<firebase-project-id>
```

3. **Web (Chrome :4444):** keep `apps/timemanager/web/firebase-messaging-sw.js` in sync with web `FirebaseOptions`. Set the Web Push public key:

```bash
cp apps/timemanager/config/local.dart-defines.json.example \
   apps/timemanager/config/local.dart-defines.json
# edit FCM_VAPID_KEY=...
```

On sign-in the app registers via `registerDeviceToken` / unregisters on sign-out. Without API credentials, the push sender is a no-op; without a registered token, only local reminders fire.

Cloud Flutter builds/runs:

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

IDE: **Run and Debug → timemanager (cloud)** / **(macos, cloud)** / **(ios, cloud)** / **(android, cloud)** / **(device, cloud)** (requires `config/cloud.dart-defines.json`). Auth CORS already allows `localhost` / `127.0.0.1`; native clients are not subject to browser CORS.

### Flutter on a physical device (local APIs)

Emulator defaults (`10.0.2.2` / `localhost`) do not reach your machine from a phone. Use:

- **timemanager (device, local)** / **spendmanager (device, local)** — `preLaunchTask` runs [`scripts/update-local-dart-defines.sh`](../scripts/update-local-dart-defines.sh), which writes `AUTH_API_BASE_URL` / `API_BASE_URL` into each app’s gitignored `config/local.dart-defines.json` using the Mac’s current LAN IP (preserves other keys such as `FCM_VAPID_KEY`).
- **timemanager (device, cloud)** / **spendmanager (device, cloud)** — same as other cloud launches; load `config/cloud.dart-defines.json` (no IP refresh).

Prerequisites: APIs running (`pnpm timemanager` / `pnpm spendmanager`), phone and Mac on the same Wi‑Fi, allow any macOS firewall prompts for the API processes.

## Smoke checks (after structural changes)

Adapted from the migration plan's verification phase:

```bash
pnpm install                # Node workspace deps
cd apps/timemanager && flutter pub get && cd -
cd apps/spendmanager && flutter pub get && cd -
nx run timemanager-db:up
nx serve timemanager-api    # confirm GraphQL responds on :3000 (requires Bearer JWT)
nx serve spendmanager-api   # confirm GraphQL responds on :3002 (requires Bearer JWT)
nx serve mailbox-api        # confirm GraphQL responds on :3003 (requires Bearer JWT)
nx serve mailbox-worker     # confirm poll loop logs sync for fixture mailbox after seed
nx serve ai-api             # confirm GET /health on :3004 (service key for /v1/*)
nx test ai_kit && nx test ai-api
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

See [`.ai/deploy-aws.md`](deploy-aws.md) for Terraform bootstrap, API/web deploy scripts, auth hostnames, OAuth callbacks, smoke checks, and CI/CD (including the `staging` branch GitHub Actions deploy).

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
