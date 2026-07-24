# Mailbox email ingest

Standalone product for polling mailboxes, filtering by required sender allowlist (domains or full email addresses), and running pluggable extractors. Spending candidates are reviewed in spendmanager Flutter, then published to spendmanager on accept.

## Projects

| Path | Role |
|------|------|
| [`libs/mailbox_kit`](../libs/mailbox_kit) | Providers, domain filter, approve/reject template matching, template extractors, `ExpenseSink` interface |
| [`apps/mailbox-api`](../apps/mailbox-api) | GraphQL on `:3003`, DB `mailbox`; AI template generation; accept → spendmanager sink |
| [`apps/mailbox-worker`](../apps/mailbox-worker) | Poll loop: for unmatched mail, AI classify + generate approve/reject template; then reject short-circuit → approve extract (no heuristic) |

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

Seed creates a `fixture` mailbox with domain filters `amazon.com` and `uber.com`, plus **approve** parsing templates for those senders. The fixture provider returns canned receipts; after sync you should see two `spending.candidate` artifacts in status `pending`.

Env on mailbox-api (see `.env.example`): `AI_API_BASE_URL`, `AI_SERVICE_KEY`, `SPENDMANAGER_API_BASE_URL`.

Env on mailbox-worker (see `.env.example`): same DB vars, plus `AI_API_BASE_URL` / `AI_SERVICE_KEY` for auto-classify of unmatched emails.

## Sender allowlist patterns

At least one filter is required before sync (`setDomainFilters`, `triggerSync`, and the worker). Empty allowlists no longer process all senders.

| Pattern | Behavior |
|---------|----------|
| `user@shop.com` | exact address (use when only one sender on a domain is relevant) |
| `shop.com` | apex + subdomains |

Wildcards (`*.shop.com`, `*@shop.com`, etc.) are not allowed on domain filters. Parsing-template `matchFromPattern` still supports the wider wildcard grammar.

## Parsing templates (approve / reject)

Per-mailbox templates live in `parsing_templates` with `kind`:

| Kind | Purpose | Extractors |
|------|---------|------------|
| `approve` | Parse matching mail into spending candidates | Required JSON (`amount`, optional `direction`, …) |
| `reject` | Ignore matching mail forever | `null` (match-only) |

Users can still call `generateParsingTemplate(decision: approve|reject)` via GraphQL (AI). On sync, the **worker** auto-classifies unmatched emails via ai-api `classify_email_spend_relevance`, then generates an approve (`generate_email_spend_template`) or reject (`generate_email_reject_template`) template and continues extraction. Approve templates include optional `direction` so inbound money is skipped. Reject templates are match patterns only.

After create/update/generate (GraphQL), mailbox-api **immediately reprocesses** stored messages for that mailbox: reject matches drop pending candidates; approve matches insert pending candidates when the message has none pending/accepted yet. `generateParsingTemplate` also **reevaluates** existing pending review artifacts whose messages match the new approve template (updates payload/confidence/`templateId` in place) and returns `reevaluatedCount` on `GenerateParsingTemplatePayload`.

Pipeline order on sync / apply:

1. If the message matches no enabled template → AI classify + create approve or reject template (worker only; failures are logged and the message is skipped)
2. Enabled **reject** templates → short-circuit (no artifact)
3. Enabled **approve** templates (first match wins) → extract spending candidates
4. No heuristic fallback — only approve templates produce Review items

Templates are not edited in the Flutter UI; Review lives under Expenses.

## GraphQL (authenticated)

- Mutations: `createMailbox`, `updateMailbox`, `deleteMailbox`, `clearInbox`, `setDomainFilters`, `triggerSync`, `updateArtifactStatus`, `rejectAllPendingArtifacts`, `connectGmail`, `startGmailOAuth`, `createParsingTemplate`, `updateParsingTemplate`, `deleteParsingTemplate`, `generateParsingTemplate`
- Queries: `mailboxes`, `domainFilters`, `messages` (optional `excludeMatchingTemplates`), `message`, `sourceMessageForExpense`, `extractionArtifacts`, `syncRuns`, `parsingTemplates`

`generateParsingTemplate` requires `decision: "approve" | "reject"` and returns `{ template, reevaluatedCount }`. Accept spending candidates with `updateArtifactStatus` (`accepted` + `categoryId`). mailbox-api forwards the caller's Bearer JWT to spendmanager `createExpense` and stores `published_expense_id` for idempotency. Reject stays mailbox-only. `rejectAllPendingArtifacts` bulk-rejects all pending artifacts for a mailbox. `clearInbox` deletes synced messages (artifacts cascade) and sync runs, and resets sync cursors — filters/templates stay; published spendmanager expenses are not deleted.

## Message bodies

Worker sync stores **plain text only** in `messages.text_body` (HTML is converted via `mailbox_kit` `htmlToPlainText` / `resolveTextBody`). `html_body` is kept nullable for schema compatibility but is no longer written. Before extraction, the worker sets `message.textBody` to that same resolved plain text (provider `htmlBody` remains available at sync time). Template `source: "text"` therefore matches the source-email viewer; `html_text` still prefers live HTML and falls back to plain text when HTML is absent.

## Spendmanager Flutter UI

Settings → **Email import**: two-step wizard — (1) connect fixture/Gmail mailbox, (2) sender allowlist + optional date-range sync / clear inbox.

Expenses → **History** | **Review**: History is the expense list; Review shows pending spending candidates (accept / reject / reject all / source email / pagination). If no mailbox or no sender filters, Review links to the setup wizard.

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
