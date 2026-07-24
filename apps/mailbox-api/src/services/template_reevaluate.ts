import type { Kysely } from 'kysely'
import {
  SPENDING_CANDIDATE_KIND,
  TemplateSpendingExtractor,
  parseSpendTemplateExtractors,
  resolveTextBody,
  type EmailMessage,
  type SpendParsingTemplate,
  type SpendTemplateExtractors,
} from 'mailbox_kit/mod.ts'
import type { Database } from '../db/types/schema.ts'

/** Template fields needed to re-extract pending review artifacts. */
export type ReevaluateTemplateInput = {
  id: number
  mailbox_id: number
  kind: string
  enabled: boolean
  match_from_pattern: string
  match_subject_regex: string | null
  extractors: unknown
}

export type PendingArtifactRow = {
  artifact_id: number
  message_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: Date | string
  text_body: string | null
  html_body: string | null
}

export type TemplateReevaluateStore = {
  listPendingArtifacts(mailboxId: number): Promise<PendingArtifactRow[]>
  updateArtifact(
    artifactId: number,
    payload: unknown,
    confidence: number,
    updatedAt: string,
  ): Promise<void>
}

export function createKyselyTemplateReevaluateStore(
  db: Kysely<Database>,
): TemplateReevaluateStore {
  return {
    async listPendingArtifacts(mailboxId) {
      return await db
        .selectFrom('extraction_artifacts')
        .innerJoin(
          'messages',
          'messages.id',
          'extraction_artifacts.message_id',
        )
        .select([
          'extraction_artifacts.id as artifact_id',
          'messages.id as message_id',
          'messages.provider_message_id',
          'messages.rfc_message_id',
          'messages.from_address',
          'messages.subject',
          'messages.received_at',
          'messages.text_body',
          'messages.html_body',
        ])
        .where('messages.mailbox_id', '=', mailboxId)
        .where('extraction_artifacts.status', '=', 'pending')
        .where('extraction_artifacts.kind', '=', SPENDING_CANDIDATE_KIND)
        .execute()
    },
    async updateArtifact(artifactId, payload, confidence, updatedAt) {
      await db
        .updateTable('extraction_artifacts')
        .set({
          payload,
          confidence,
          updated_at: updatedAt,
        })
        .where('id', '=', artifactId)
        .execute()
    },
  }
}

/**
 * Re-run an approve template against pending spending candidates in its
 * mailbox. Matching messages that extract successfully have their pending
 * artifact payload/confidence updated in place. Extract misses are left alone.
 */
export async function reevaluatePendingWithTemplate(
  store: TemplateReevaluateStore,
  template: ReevaluateTemplateInput,
  now: string = new Date().toISOString(),
): Promise<number> {
  if (template.kind !== 'approve' || !template.enabled) return 0

  const spendTemplate = toSpendParsingTemplate(template)
  if (!spendTemplate) return 0

  const extractor = new TemplateSpendingExtractor(spendTemplate)
  const pending = await store.listPendingArtifacts(template.mailbox_id)
  let updated = 0

  for (const row of pending) {
    const email = rowToEmailMessage(row)
    if (!extractor.canHandle(email)) continue
    const arts = extractor.extract(email)
    const art = arts[0]
    if (!art) continue

    await store.updateArtifact(
      row.artifact_id,
      art.payload,
      art.confidence,
      now,
    )
    updated += 1
  }

  return updated
}

export function toSpendParsingTemplate(
  template: ReevaluateTemplateInput,
): SpendParsingTemplate | null {
  const extractors = parseSpendTemplateExtractors(template.extractors)
  if (!extractors) return null
  return {
    id: template.id,
    matchFromPattern: template.match_from_pattern,
    matchSubjectRegex: template.match_subject_regex,
    extractors: extractors as SpendTemplateExtractors,
    enabled: template.enabled,
  }
}

function rowToEmailMessage(row: {
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: Date | string
  text_body: string | null
  html_body: string | null
}): EmailMessage {
  const receivedAt = row.received_at instanceof Date
    ? row.received_at
    : new Date(row.received_at)
  return {
    id: row.provider_message_id,
    rfcMessageId: row.rfc_message_id,
    from: row.from_address,
    subject: row.subject,
    receivedAt,
    textBody: resolveTextBody(row.text_body, row.html_body),
    htmlBody: row.html_body,
  }
}
