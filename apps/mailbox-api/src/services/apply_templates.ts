import type { Kysely } from 'kysely'
import {
  SPENDING_CANDIDATE_KIND,
  extractSpendingCandidates,
  messageMatchesAnyTemplate,
  parseSpendTemplateExtractors,
  resolveTextBody,
  type EmailMessage,
  type ExtractionArtifact,
  type SpendParsingTemplate,
  type TemplateMatchSpec,
} from 'mailbox_kit/mod.ts'
import type { Database } from '../db/types/schema.ts'

export type ApplyTemplatesStore = {
  listEnabledTemplates(mailboxId: number): Promise<
    Array<{
      id: number
      kind: string
      enabled: boolean
      match_from_pattern: string
      match_subject_regex: string | null
      extractors: unknown
    }>
  >
  listMessages(mailboxId: number): Promise<
    Array<{
      id: number
      provider_message_id: string
      rfc_message_id: string
      from_address: string
      subject: string
      received_at: Date | string
      text_body: string | null
      html_body: string | null
    }>
  >
  listArtifactStatuses(messageIds: number[]): Promise<
    Array<{ message_id: number; status: string }>
  >
  rejectPendingForMessages(
    messageIds: number[],
    updatedAt: string,
  ): Promise<number>
  insertArtifact(
    messageId: number,
    art: ExtractionArtifact,
    now: string,
  ): Promise<void>
}

export function createKyselyApplyTemplatesStore(
  db: Kysely<Database>,
): ApplyTemplatesStore {
  return {
    async listEnabledTemplates(mailboxId) {
      return await db
        .selectFrom('parsing_templates')
        .select([
          'id',
          'kind',
          'enabled',
          'match_from_pattern',
          'match_subject_regex',
          'extractors',
        ])
        .where('mailbox_id', '=', mailboxId)
        .where('enabled', '=', true)
        .orderBy('id', 'asc')
        .execute()
    },
    async listMessages(mailboxId) {
      return await db
        .selectFrom('messages')
        .select([
          'id',
          'provider_message_id',
          'rfc_message_id',
          'from_address',
          'subject',
          'received_at',
          'text_body',
          'html_body',
        ])
        .where('mailbox_id', '=', mailboxId)
        .execute()
    },
    async listArtifactStatuses(messageIds) {
      if (messageIds.length === 0) return []
      return await db
        .selectFrom('extraction_artifacts')
        .select(['message_id', 'status'])
        .where('message_id', 'in', messageIds)
        .where('kind', '=', SPENDING_CANDIDATE_KIND)
        .execute()
    },
    async rejectPendingForMessages(messageIds, updatedAt) {
      if (messageIds.length === 0) return 0
      const result = await db
        .updateTable('extraction_artifacts')
        .set({ status: 'rejected', updated_at: updatedAt })
        .where('status', '=', 'pending')
        .where('kind', '=', SPENDING_CANDIDATE_KIND)
        .where('message_id', 'in', messageIds)
        .executeTakeFirst()
      return Number(result.numUpdatedRows ?? 0)
    },
    async insertArtifact(messageId, art, now) {
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
    },
  }
}

export type ApplyTemplatesResult = {
  rejectedPending: number
  insertedArtifacts: number
}

/**
 * Re-apply enabled templates to all stored messages in a mailbox.
 * Reject matches drop pending candidates; approve matches insert pending
 * candidates when the message has no pending/accepted spending artifact yet.
 */
export async function applyTemplatesToMailbox(
  store: ApplyTemplatesStore,
  mailboxId: number,
  now: string = new Date().toISOString(),
): Promise<ApplyTemplatesResult> {
  const rows = await store.listEnabledTemplates(mailboxId)
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

  const messages = await store.listMessages(mailboxId)
  if (messages.length === 0) {
    return { rejectedPending: 0, insertedArtifacts: 0 }
  }

  const statuses = await store.listArtifactStatuses(messages.map((m) => m.id))
  const statusByMessage = new Map<number, Set<string>>()
  for (const s of statuses) {
    let set = statusByMessage.get(s.message_id)
    if (!set) {
      set = new Set()
      statusByMessage.set(s.message_id, set)
    }
    set.add(s.status)
  }

  const rejectMessageIds: number[] = []
  let insertedArtifacts = 0

  for (const row of messages) {
    const email = rowToEmailMessage(row)
    if (messageMatchesAnyTemplate(email, rejectTemplates)) {
      rejectMessageIds.push(row.id)
      continue
    }

    const existing = statusByMessage.get(row.id)
    if (existing?.has('pending') || existing?.has('accepted')) continue

    const arts = extractSpendingCandidates(email, {
      rejectTemplates: [],
      approveTemplates,
    })
    for (const art of arts) {
      await store.insertArtifact(row.id, art, now)
      insertedArtifacts += 1
    }
  }

  const rejectedPending = await store.rejectPendingForMessages(
    rejectMessageIds,
    now,
  )

  return { rejectedPending, insertedArtifacts }
}

function rowToEmailMessage(row: {
  id: number
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
  const textBody = resolveTextBody(row.text_body, row.html_body)
  return {
    id: row.provider_message_id,
    rfcMessageId: row.rfc_message_id,
    from: row.from_address,
    subject: row.subject,
    receivedAt,
    textBody,
    htmlBody: row.html_body,
  }
}
