# spendmanager

Flutter spending tracker (categories, expenses, budgets). GraphQL API on `:3002`.

## Email import

Settings → **Email import** talks to mailbox-api (`:3003`) for per-user mailbox setup, wildcard domain filters, AI parsing templates, and spending candidate review. Accept publishes into spendmanager via mailbox-api.

Local services:

```bash
pnpm spendmanager   # GraphQL :3002
pnpm mailbox        # GraphQL :3003 + worker
pnpm ai             # template generation :3004
```

Optional dart-define: `MAILBOX_API_BASE_URL` (default `http://localhost:3003`).

See [`.ai/mailbox.md`](../../.ai/mailbox.md).
