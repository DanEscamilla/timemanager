# spendmanager-api

Deno + Pylon GraphQL API for the spending tracker. Serves on `:3002`.

## Stack

- Pylon (`@getcronit/pylon`) GraphQL
- Kysely + Postgres (`spendmanager` database on shared `infra/timemanager-db`)
- SuperTokens JWKS auth via `user-manager-api` `:3001`

## Commands

```bash
nx serve spendmanager-api    # migrate + auth + dev server
nx run spendmanager-api:migrate
nx run spendmanager-api:seed
nx run spendmanager-api:test
```

Copy `.env.example` → `.env` for local defaults.
