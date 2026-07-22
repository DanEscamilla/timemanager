import { db } from 'mailbox_api/db/database.ts'
import type { Mailbox } from 'mailbox_api/db/types/schema.ts'
import {
  ExtractorPipeline,
  SpendingExtractor,
  TemplateSpendingExtractor,
  filterMessagesByDomain,
  parseSpendTemplateExtractors,
  type ExtractionArtifact,
  type MailboxProvider,
  type SpendParsingTemplate,
} from 'mailbox_kit/mod.ts'
import { createProviderForMailbox } from './provider_factory.ts'

const HEURISTIC = new SpendingExtractor()

export interface SyncMailboxResult {
  fetched: number
  extracted: number
  error: string | null
}

export async function syncMailbox(
  mailbox: Mailbox,
  options?: {
    provider?: MailboxProvider
    pipeline?: ExtractorPipeline
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
    const provider = options?.provider ?? createProviderForMailbox(mailbox)
    const pipeline = options?.pipeline ??
      (await buildPipelineForMailbox(mailbox.id))

    const patterns = (
      await db
        .selectFrom('domain_filters')
        .select('pattern')
        .where('mailbox_id', '=', mailbox.id)
        .execute()
    ).map((r) => r.pattern)

    let cursor = mailbox.sync_cursor
    // One page per poll tick keeps runs bounded; triggerSync / next interval continues.
    const page = await provider.listMessages({ cursor, limit: 50 })
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

      const bodyHash = await hashBody(msg.textBody ?? msg.htmlBody ?? '')
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
          text_body: truncateBody(msg.textBody),
          html_body: truncateBody(msg.htmlBody),
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      const artifacts = pipeline.run(msg)
      for (const art of artifacts) {
        await insertArtifact(inserted.id, art)
        extracted += 1
      }
    }

    cursor = page.nextCursor
    const now = new Date().toISOString()
    await db
      .updateTable('mailboxes')
      .set({
        sync_cursor: cursor,
        sync_requested: false,
        last_synced_at: now,
        updated_at: now,
      })
      .where('id', '=', mailbox.id)
      .execute()
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

async function buildPipelineForMailbox(
  mailboxId: number,
): Promise<ExtractorPipeline> {
  const rows = await db
    .selectFrom('parsing_templates')
    .selectAll()
    .where('mailbox_id', '=', mailboxId)
    .where('enabled', '=', true)
    .orderBy('id', 'asc')
    .execute()

  const templateExtractors: TemplateSpendingExtractor[] = []
  for (const row of rows) {
    const extractors = parseSpendTemplateExtractors(row.extractors)
    if (!extractors) continue
    const template: SpendParsingTemplate = {
      id: row.id,
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      extractors,
      enabled: row.enabled,
    }
    templateExtractors.push(new TemplateSpendingExtractor(template))
  }

  return new ExtractorPipeline([...templateExtractors, HEURISTIC], {
    firstMatchOnly: true,
  })
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
  const cutoff = new Date(now.getTime() - pollIntervalMs).toISOString()

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
