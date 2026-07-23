# mailbox-api

Deno + Pylon GraphQL API for email ingest (mailboxes, domain filters, extraction artifacts). Serves on `:3003`.

Independent from spendmanager; spending candidates are stored as `extraction_artifacts` with kind `spending.candidate`.

## Stack

- Pylon GraphQL
- Kysely + Postgres (`mailbox` database on shared `infra/timemanager-db`)
- SuperTokens JWKS auth via `user-manager-api` `:3001`
- Shared pipeline types in `libs/mailbox_kit`

## Commands

```bash
nx serve mailbox-api
nx run mailbox-api:migrate
nx run mailbox-api:seed
nx run mailbox-api:test
nx serve mailbox-worker   # poll / sync loop
```

Copy `.env.example` → `.env` for local defaults.

## Gmail OAuth

1. Create a Google Cloud **Web** OAuth client; enable Gmail API.
2. Authorized redirect URI: `http://localhost:3003/oauth/gmail/callback`.
3. Set `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` / `GMAIL_OAUTH_REDIRECT_URI` in `.env` (API exchanges the auth code; worker refreshes tokens). Optional: `GMAIL_OAUTH_RETURN_TO_ALLOWLIST`.
4. From spendmanager Email import, use **Connect Gmail** (GraphQL `startGmailOAuth` → browser consent → `GET /oauth/gmail/callback`). Scope: `https://www.googleapis.com/auth/gmail.readonly`.

Fixture provider needs no OAuth — use `provider: "fixture"` for local demos.
