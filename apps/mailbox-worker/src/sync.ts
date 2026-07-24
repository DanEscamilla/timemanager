import { db } from 'mailbox_api/db/database.ts'
import type { Mailbox } from 'mailbox_api/db/types/schema.ts'
import {
  autoTemplateFromMessage,
  createKyselyAutoTemplateStore,
  templateRowToMatchSets,
} from 'mailbox_api/services/auto_template_from_message.ts'
import {
  extractSpendingCandidates,
  filterMessagesByDomain,
  messageMatchesAnyTemplate,
  parseSpendTemplateExtractors,
  resolveTextBody,
  type EmailMessage,
  type ExtractionArtifact,
  type MailboxProvider,
  type SpendParsingTemplate,
  type SyncCursor,
  type TemplateMatchSpec,
} from 'mailbox_kit/mod.ts'
import { createProviderForMailbox } from './provider_factory.ts'

export type MailboxTemplateSets = {
  rejectTemplates: TemplateMatchSpec[]
  approveTemplates: SpendParsingTemplate[]
}

/** True when no enabled reject/approve template matches (needs AI classify). */
export function messageNeedsAutoTemplate(
  message: EmailMessage,
  templates: MailboxTemplateSets,
): boolean {
  return !(
    messageMatchesAnyTemplate(message, templates.rejectTemplates) ||
    messageMatchesAnyTemplate(message, templates.approveTemplates)
  )
}

/** Error when a mailbox has no domain allowlist rows. */
export const DOMAIN_FILTERS_REQUIRED =
  'domain filters are required before sync'

/**
 * Returns the abort message when patterns are empty; otherwise null.
 * Exported for unit tests (full syncMailbox needs Postgres).
 */
export function missingDomainFiltersError(
  patterns: readonly string[],
): string | null {
  return patterns.length === 0 ? DOMAIN_FILTERS_REQUIRED : null
}

export interface SyncMailboxResult {
  fetched: number
  extracted: number
  error: string | null
}

function toDateOrUndefined(
  value: Date | string | null | undefined,
): Date | undefined {
  if (value == null) return undefined
  const d = value instanceof Date ? value : new Date(value)
  return Number.isFinite(d.getTime()) ? d : undefined
}

function hasMoreBackfillPages(nextCursor: SyncCursor): boolean {
  return nextCursor != null && nextCursor !== ''
}

export async function syncMailbox(
  mailbox: Mailbox,
  options?: {
    provider?: MailboxProvider
    /** Override template sets used for extraction (tests). */
    templates?: MailboxTemplateSets
  },
): Promise<SyncMailboxResult> {
  const run = await db
    .insertInto('sync_runs')
    .values({
      mailbox_id: mailbox.id,
      fetched_count: 0,
      extracted_count: 0,
      error_text: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  let fetched = 0
  let extracted = 0
  let errorText: string | null = null

  try {
    const patterns = (
      await db
        .selectFrom('domain_filters')
        .select('pattern')
        .where('mailbox_id', '=', mailbox.id)
        .execute()
    ).map((r) => r.pattern)

    const missingFilters = missingDomainFiltersError(patterns)
    if (missingFilters) {
      errorText = missingFilters
      const now = new Date().toISOString()
      await db
        .updateTable('mailboxes')
        .set({
          sync_requested: false,
          sync_since: null,
          sync_until: null,
          sync_backfill_cursor: null,
          // Avoid due-mailbox re-pick via last_synced_at IS NULL every poll.
          last_synced_at: now,
          updated_at: now,
        })
        .where('id', '=', mailbox.id)
        .execute()
    } else {
      const provider = options?.provider ?? createProviderForMailbox(mailbox)
      let templates = options?.templates ??
        (await loadTemplateSetsForMailbox(mailbox.id))

      const since = toDateOrUndefined(mailbox.sync_since)
      const until = toDateOrUndefined(mailbox.sync_until)
      const backfillMode = since != null || until != null

      // One page per poll tick keeps runs bounded; triggerSync / next interval continues.
      const page = await provider.listMessages({
        cursor: backfillMode
          ? mailbox.sync_backfill_cursor
          : mailbox.sync_cursor,
        limit: 50,
        since,
        until,
      })
      const filtered = filterMessagesByDomain(page.messages, patterns)
      fetched = filtered.length

      for (const msg of filtered) {
        const existing = await db
          .selectFrom('messages')
          .select('id')
          .where('mailbox_id', '=', mailbox.id)
          .where('rfc_message_id', '=', msg.rfcMessageId)
          .executeTakeFirst()

        if (existing) continue

        // Same resolved plain text for DB + extractors so source:"text"
        // matches the viewer body (HTML-only / HTML-in-text MIME parts).
        const forExtract = messageForExtraction(msg)
        const textBody = forExtract.textBody
        const bodyHash = await hashBody(textBody ?? '')
        const inserted = await db
          .insertInto('messages')
          .values({
            mailbox_id: mailbox.id,
            provider_message_id: msg.id,
            rfc_message_id: msg.rfcMessageId,
            from_address: msg.from,
            subject: msg.subject,
            received_at: msg.receivedAt.toISOString(),
            body_hash: bodyHash,
            text_body: textBody,
            html_body: null,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        let workingTemplates = templates
        if (messageNeedsAutoTemplate(forExtract, workingTemplates)) {
          try {
            const created = await autoTemplateFromMessage(
              {
                id: inserted.id,
                mailbox_id: mailbox.id,
                user_id: mailbox.user_id,
                from_address: inserted.from_address,
                subject: inserted.subject,
                text_body: inserted.text_body,
              },
              { store: createKyselyAutoTemplateStore(db) },
            )
            const sets = templateRowToMatchSets(created.template)
            if (sets.reject) {
              workingTemplates = {
                ...workingTemplates,
                rejectTemplates: [
                  ...workingTemplates.rejectTemplates,
                  sets.reject,
                ],
              }
            }
            if (sets.approve) {
              workingTemplates = {
                ...workingTemplates,
                approveTemplates: [
                  ...workingTemplates.approveTemplates,
                  sets.approve,
                ],
              }
            }
            // Keep page-local sets so later messages reuse the new template.
            templates = workingTemplates
            console.log(
              `[mailbox-worker] auto-template mailbox=${mailbox.id} message=${inserted.id} useful=${created.useful} template=${created.template.id}`,
            )
          } catch (err) {
            console.error(
              `[mailbox-worker] auto-template failed mailbox=${mailbox.id} message=${inserted.id}:`,
              err instanceof Error ? err.message : String(err),
            )
          }
        }

        const artifacts = extractSpendingCandidates(
          forExtract,
          workingTemplates,
        )
        for (const art of artifacts) {
          await insertArtifact(inserted.id, art)
          extracted += 1
        }
      }

      const now = new Date().toISOString()
      if (backfillMode) {
        const more = hasMoreBackfillPages(page.nextCursor)
        await db
          .updateTable('mailboxes')
          .set(
            more
              ? {
                sync_backfill_cursor: page.nextCursor,
                sync_requested: true,
                last_synced_at: now,
                updated_at: now,
              }
              : {
                sync_since: null,
                sync_until: null,
                sync_backfill_cursor: null,
                sync_requested: false,
                last_synced_at: now,
                updated_at: now,
              },
          )
          .where('id', '=', mailbox.id)
          .execute()
      } else {
        await db
          .updateTable('mailboxes')
          .set({
            sync_cursor: page.nextCursor,
            sync_requested: false,
            last_synced_at: now,
            updated_at: now,
          })
          .where('id', '=', mailbox.id)
          .execute()
      }
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err)
  }

  await db
    .updateTable('sync_runs')
    .set({
      finished_at: new Date().toISOString(),
      fetched_count: fetched,
      extracted_count: extracted,
      error_text: errorText,
    })
    .where('id', '=', run.id)
    .execute()

  return { fetched, extracted, error: errorText }
}

/** Load reject + approve template sets for a mailbox (exported for tests). */
export async function loadTemplateSetsForMailbox(
  mailboxId: number,
): Promise<MailboxTemplateSets> {
  const rows = await db
    .selectFrom('parsing_templates')
    .selectAll()
    .where('mailbox_id', '=', mailboxId)
    .where('enabled', '=', true)
    .orderBy('id', 'asc')
    .execute()

  const rejectTemplates: TemplateMatchSpec[] = []
  const approveTemplates: SpendParsingTemplate[] = []

  for (const row of rows) {
    const match: TemplateMatchSpec = {
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      enabled: row.enabled,
    }
    if (row.kind === 'reject') {
      rejectTemplates.push(match)
      continue
    }
    const extractors = parseSpendTemplateExtractors(row.extractors)
    if (!extractors) continue
    approveTemplates.push({
      id: row.id,
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      extractors,
      enabled: row.enabled,
    })
  }

  return { rejectTemplates, approveTemplates }
}

async function insertArtifact(
  messageId: number,
  art: ExtractionArtifact,
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .insertInto('extraction_artifacts')
    .values({
      message_id: messageId,
      kind: art.kind,
      payload: art.payload,
      confidence: art.confidence,
      status: 'pending',
      published_expense_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute()
}

function truncateBody(body: string | null): string | null {
  if (!body) return null
  const max = 50_000
  return body.length > max ? body.slice(0, max) : body
}

/** Resolve + truncate for unit tests (full insert needs Postgres). */
export function resolvedStoredTextBody(
  textBody: string | null | undefined,
  htmlBody: string | null | undefined,
): string | null {
  return truncateBody(resolveTextBody(textBody, htmlBody))
}

/**
 * Message passed to extractors: textBody is the same resolved plain text
 * we persist (and show in the source-email viewer). Keeps provider htmlBody
 * so source:"html_text" still works at sync time.
 */
export function messageForExtraction(msg: EmailMessage): EmailMessage {
  return {
    ...msg,
    textBody: resolvedStoredTextBody(msg.textBody, msg.htmlBody),
  }
}

async function hashBody(body: string): Promise<string> {
  const data = new TextEncoder().encode(body)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function syncDueMailboxes(options?: {
  now?: Date
  pollIntervalMs?: number
}): Promise<number> {
  const pollIntervalMs = options?.pollIntervalMs ??
    Number(Deno.env.get('POLL_INTERVAL_MS') ?? 300_000)
  const now = options?.now ?? new Date()
  const cutoff = new Date(now.getTime() - pollIntervalMs)

  const due = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('enabled', '=', true)
    .where((eb) =>
      eb.or([
        eb('sync_requested', '=', true),
        eb('last_synced_at', 'is', null),
        eb('last_synced_at', '<', cutoff),
      ])
    )
    .execute()

  for (const mailbox of due) {
    const result = await syncMailbox(mailbox)
    console.log(
      `[mailbox-worker] mailbox=${mailbox.id} fetched=${result.fetched} extracted=${result.extracted}` +
        (result.error ? ` error=${result.error}` : ''),
    )
  }
  return due.length
}
