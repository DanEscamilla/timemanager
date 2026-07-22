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

1. Create a Google Cloud OAuth client (Desktop or Web).
2. Set `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` in `.env` (used by the worker for token refresh).
3. Create a mailbox with `provider: "gmail"`, then call `connectGmail` with access/refresh tokens (scopes: `https://www.googleapis.com/auth/gmail.readonly`).

Fixture provider needs no OAuth — use `provider: "fixture"` for local demos.
