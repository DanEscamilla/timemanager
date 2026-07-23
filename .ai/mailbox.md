# Mailbox email ingest

Standalone product for polling mailboxes, filtering by sender domain (with wildcards), and running pluggable extractors. Spending candidates are reviewed in spendmanager Flutter, then published to spendmanager on accept.

## Projects

| Path | Role |
|------|------|
| [`libs/mailbox_kit`](../libs/mailbox_kit) | Providers, domain filter, template + heuristic extractors, `ExpenseSink` interface |
| [`apps/mailbox-api`](../apps/mailbox-api) | GraphQL on `:3003`, DB `mailbox`; AI template generation; accept → spendmanager sink |
| [`apps/mailbox-worker`](../apps/mailbox-worker) | Poll loop (templates first, heuristic fallback; no AI on poll) |

## Local run

```bash
nx run mailbox-api:migrate
nx run mailbox-api:seed
pnpm services      # auth + ai + mailbox API + worker
pnpm spendmanager  # ensures services; needed for accept → createExpense
# or ensure + mailbox only:
pnpm mailbox
# or one sync without the long-running worker:
cd apps/mailbox-worker && deno task sync-once
```

Seed creates a `fixture` mailbox with domain filters `amazon.com` and `uber.com`. The fixture provider returns canned receipts; after sync you should see two `spending.candidate` artifacts in status `pending`.

Env on mailbox-api (see `.env.example`): `AI_API_BASE_URL`, `AI_SERVICE_KEY`, `SPENDMANAGER_API_BASE_URL`.

## Domain allowlist patterns

| Pattern | Behavior |
|---------|----------|
| `user@shop.com` | exact address |
| `shop.com` | apex + subdomains |
| `*.shop.com` | subdomains only |
| `*@shop.com` | any local-part at apex |
| `*@*.shop.com` | any local-part at a subdomain |

Empty filter list = process all senders.

## Parsing templates

Per-user templates live in `parsing_templates`. AI generates them once via `generateParsingTemplate` (calls ai-api `generate_email_spend_template`); the worker applies them deterministically thereafter. Users can edit match patterns and extractors JSON.

Pipeline order: enabled templates for the mailbox (first match wins), then heuristic `SpendingExtractor`.

## GraphQL (authenticated)

- Mutations: `createMailbox`, `updateMailbox`, `deleteMailbox`, `setDomainFilters`, `triggerSync`, `updateArtifactStatus`, `connectGmail`, `startGmailOAuth`, `createParsingTemplate`, `updateParsingTemplate`, `deleteParsingTemplate`, `generateParsingTemplate`
- Queries: `mailboxes`, `domainFilters`, `messages`, `message`, `sourceMessageForExpense`, `extractionArtifacts`, `syncRuns`, `parsingTemplates`

Accept spending candidates with `updateArtifactStatus` (`accepted` + `categoryId`). mailbox-api forwards the caller's Bearer JWT to spendmanager `createExpense` and stores `published_expense_id` for idempotency. Reject stays mailbox-only.

## Spendmanager Flutter UI

Settings → **Email import**: connect fixture/Gmail, edit domain filters, sync, generate/edit templates, review pending candidates. Review and expense edit can open the **source email** (mailbox `message` / `sourceMessageForExpense`) to validate extracted fields.

Local mailbox GraphQL: `MAILBOX_API_BASE_URL` (default `http://localhost:3003`).

## Gmail OAuth

1. Google Cloud Console → enable Gmail API → create a **Web** OAuth client.
2. Authorized redirect URI: `http://localhost:3003/oauth/gmail/callback` (or your deployed mailbox-api callback).
3. Scope: `https://www.googleapis.com/auth/gmail.readonly`.
4. Set on **mailbox-api** and **mailbox-worker**:
   - `GMAIL_OAUTH_CLIENT_ID` / `GMAIL_OAUTH_CLIENT_SECRET` (code exchange + token refresh)
   - `GMAIL_OAUTH_REDIRECT_URI` (must match the Google console redirect)
   - `GMAIL_OAUTH_RETURN_TO_ALLOWLIST` (default `http://localhost:4445,spendmanager://settings/email-import`)
5. In spendmanager: Settings → **Email import** → **Connect Gmail** → Google consent → return to Email import (`?gmail=connected`). mailbox-api stores tokens, sets the mailbox label to the Gmail address when available, and sets `sync_requested`.

Flow: Flutter `createMailbox(provider: gmail)` → `startGmailOAuth` → browser consent → `GET /oauth/gmail/callback` exchanges the code and persists tokens. This is separate from SuperTokens Google login.

Fixture provider needs no Google credentials.
