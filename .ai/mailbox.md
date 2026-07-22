# Mailbox email ingest

Standalone product for polling mailboxes, optionally filtering by sender domain, and running pluggable extractors. Spending candidates are one extractor kind — not coupled to spendmanager until an `ExpenseSink` adapter is added later.

## Projects

| Path | Role |
|------|------|
| [`libs/mailbox_kit`](../libs/mailbox_kit) | Providers, domain filter, extractors, `ExpenseSink` |
| [`apps/mailbox-api`](../apps/mailbox-api) | GraphQL on `:3003`, DB `mailbox` |
| [`apps/mailbox-worker`](../apps/mailbox-worker) | Poll loop |

## Local run

```bash
nx run mailbox-api:migrate
nx run mailbox-api:seed
pnpm mailbox   # API + worker
# or one sync without the long-running worker:
cd apps/mailbox-worker && deno task sync-once
```

Seed creates a `fixture` mailbox with domain filters `amazon.com` and `uber.com`. The fixture provider returns canned receipts; after sync you should see two `spending.candidate` artifacts in status `pending`.

## GraphQL (authenticated)

- Mutations: `createMailbox`, `deleteMailbox`, `setDomainFilters`, `triggerSync`, `updateArtifactStatus`, `connectGmail`
- Queries: `mailboxes`, `domainFilters`, `messages`, `extractionArtifacts`, `syncRuns`

Accept/reject spending candidates with `updateArtifactStatus` (`accepted` | `rejected`). Accepted rows stay in the mailbox DB — they are not written to spendmanager.

## Gmail OAuth

1. Google Cloud Console → OAuth client; enable Gmail API.
2. Scopes: `https://www.googleapis.com/auth/gmail.readonly`.
3. Set `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` on API and worker (token refresh).
4. `createMailbox(provider: "gmail", …)` then `connectGmail` with access/refresh tokens.

Fixture provider needs no Google credentials.

## Future spendmanager bridge

`libs/mailbox_kit` exports `ExpenseSink`. Implement an adapter that maps accepted `spending.candidate` payloads to spendmanager `createExpense` — do not import spendmanager types into `mailbox_kit`.
