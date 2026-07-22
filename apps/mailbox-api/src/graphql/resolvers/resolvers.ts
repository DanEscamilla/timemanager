import { getContext } from '@getcronit/pylon'
import { db } from '../../db/database.ts'
import type { NewMailbox } from '../../db/types/schema.ts'
import { asIsoTimestamp, asIsoTimestampOrNull } from '../timestamps.ts'
import type {
  ConnectGmailInput,
  CreateMailboxInput,
  SetDomainFiltersInput,
  UpdateArtifactStatusInput,
} from '../types.ts'
import {
  InvalidMailboxError,
  validateArtifactStatus,
  validateDomainPatterns,
  validateLabel,
  validateProvider,
} from '../validation.ts'

function requireUserId(): number {
  const userId = getContext().get('userId')
  if (typeof userId !== 'number') {
    throw new Error('Unauthenticated')
  }
  return userId
}

function mapMailbox(row: {
  id: number
  user_id: number
  provider: string
  label: string
  enabled: boolean
  sync_cursor: string | null
  sync_requested: boolean
  last_synced_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}) {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled,
    sync_cursor: row.sync_cursor,
    sync_requested: row.sync_requested,
    last_synced_at: asIsoTimestampOrNull(row.last_synced_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
  }
}

function mapDomainFilter(row: {
  id: number
  mailbox_id: number
  pattern: string
  created_at: Date | string
}) {
  return {
    ...row,
    created_at: asIsoTimestamp(row.created_at),
  }
}

function mapMessage(row: {
  id: number
  mailbox_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: Date | string
  created_at: Date | string
}) {
  return {
    ...row,
    received_at: asIsoTimestamp(row.received_at),
    created_at: asIsoTimestamp(row.created_at),
  }
}

function mapArtifact(row: {
  id: number
  message_id: number
  kind: string
  payload: unknown
  confidence: number
  status: string
  created_at: Date | string
  updated_at: Date | string
}) {
  return {
    id: row.id,
    message_id: row.message_id,
    kind: row.kind,
    payload:
      typeof row.payload === 'string'
        ? row.payload
        : JSON.stringify(row.payload ?? {}),
    confidence: row.confidence,
    status: row.status,
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
  }
}

function mapSyncRun(row: {
  id: number
  mailbox_id: number
  started_at: Date | string
  finished_at: Date | string | null
  fetched_count: number
  extracted_count: number
  error_text: string | null
}) {
  return {
    ...row,
    started_at: asIsoTimestamp(row.started_at),
    finished_at: asIsoTimestampOrNull(row.finished_at),
  }
}

async function requireOwnedMailbox(userId: number, mailboxId: number) {
  const row = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', mailboxId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  if (!row) throw new InvalidMailboxError('mailbox not found')
  return row
}

const Query = {
  async mailboxes() {
    const userId = requireUserId()
    const rows = await db
      .selectFrom('mailboxes')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map(mapMailbox)
  },

  async domainFilters(mailboxId: number) {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const rows = await db
      .selectFrom('domain_filters')
      .selectAll()
      .where('mailbox_id', '=', mailboxId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map(mapDomainFilter)
  },

  async messages(mailboxId: number) {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const rows = await db
      .selectFrom('messages')
      .selectAll()
      .where('mailbox_id', '=', mailboxId)
      .orderBy('received_at', 'desc')
      .execute()
    return rows.map(mapMessage)
  },

  async extractionArtifacts(mailboxId?: number | null, status?: string | null) {
    const userId = requireUserId()
    let q = db
      .selectFrom('extraction_artifacts')
      .innerJoin('messages', 'messages.id', 'extraction_artifacts.message_id')
      .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
      .selectAll('extraction_artifacts')
      .where('mailboxes.user_id', '=', userId)

    if (mailboxId != null) {
      q = q.where('messages.mailbox_id', '=', mailboxId)
    }
    if (status != null && status !== '') {
      q = q.where('extraction_artifacts.status', '=', validateArtifactStatus(status))
    }

    const rows = await q.orderBy('extraction_artifacts.id', 'desc').execute()
    return rows.map(mapArtifact)
  },

  async syncRuns(mailboxId: number) {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const rows = await db
      .selectFrom('sync_runs')
      .selectAll()
      .where('mailbox_id', '=', mailboxId)
      .orderBy('id', 'desc')
      .limit(50)
      .execute()
    return rows.map(mapSyncRun)
  },
}

const Mutation = {
  async createMailbox(input: CreateMailboxInput) {
    const userId = requireUserId()
    const provider = validateProvider(input.provider)
    const label = validateLabel(input.label)
    const patterns = validateDomainPatterns(input.domainFilters ?? [])
    const now = new Date().toISOString()

    if (provider === 'gmail' && !input.oauthTokensJson) {
      // Allow create without tokens; connectGmail fills them later.
    }

    const values: NewMailbox = {
      user_id: userId,
      provider,
      label,
      enabled: input.enabled ?? true,
      sync_cursor: null,
      sync_requested: true,
      oauth_tokens_json: input.oauthTokensJson ?? null,
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    }

    const mailbox = await db
      .insertInto('mailboxes')
      .values(values)
      .returningAll()
      .executeTakeFirstOrThrow()

    if (patterns.length > 0) {
      await db
        .insertInto('domain_filters')
        .values(
          patterns.map((pattern) => ({
            mailbox_id: mailbox.id,
            pattern,
            created_at: now,
          })),
        )
        .execute()
    }

    return mapMailbox(mailbox)
  },

  async deleteMailbox(id: number) {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('mailboxes')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return Number(result.numDeletedRows ?? 0) > 0
  },

  async setDomainFilters(input: SetDomainFiltersInput) {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, input.mailboxId)
    const patterns = validateDomainPatterns(input.patterns)
    const now = new Date().toISOString()

    await db
      .deleteFrom('domain_filters')
      .where('mailbox_id', '=', input.mailboxId)
      .execute()

    if (patterns.length > 0) {
      await db
        .insertInto('domain_filters')
        .values(
          patterns.map((pattern) => ({
            mailbox_id: input.mailboxId,
            pattern,
            created_at: now,
          })),
        )
        .execute()
    }

    const rows = await db
      .selectFrom('domain_filters')
      .selectAll()
      .where('mailbox_id', '=', input.mailboxId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map(mapDomainFilter)
  },

  async triggerSync(mailboxId: number) {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const now = new Date().toISOString()
    const row = await db
      .updateTable('mailboxes')
      .set({ sync_requested: true, updated_at: now })
      .where('id', '=', mailboxId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapMailbox(row)
  },

  async updateArtifactStatus(input: UpdateArtifactStatusInput) {
    const userId = requireUserId()
    const status = validateArtifactStatus(input.status)
    const owned = await db
      .selectFrom('extraction_artifacts')
      .innerJoin('messages', 'messages.id', 'extraction_artifacts.message_id')
      .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
      .selectAll('extraction_artifacts')
      .where('extraction_artifacts.id', '=', input.artifactId)
      .where('mailboxes.user_id', '=', userId)
      .executeTakeFirst()

    if (!owned) throw new InvalidMailboxError('artifact not found')

    const now = new Date().toISOString()
    const row = await db
      .updateTable('extraction_artifacts')
      .set({ status, updated_at: now })
      .where('id', '=', input.artifactId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapArtifact(row)
  },

  async connectGmail(input: ConnectGmailInput) {
    const userId = requireUserId()
    const mailbox = await requireOwnedMailbox(userId, input.mailboxId)
    if (mailbox.provider !== 'gmail') {
      throw new InvalidMailboxError('mailbox provider is not gmail')
    }
    if (!input.accessToken.trim()) {
      throw new InvalidMailboxError('accessToken is required')
    }

    const tokens = {
      accessToken: input.accessToken.trim(),
      refreshToken: input.refreshToken ?? null,
      expiresAtMs: input.expiresAtMs ?? null,
    }
    const now = new Date().toISOString()
    const row = await db
      .updateTable('mailboxes')
      .set({
        oauth_tokens_json: JSON.stringify(tokens),
        sync_requested: true,
        updated_at: now,
      })
      .where('id', '=', mailbox.id)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapMailbox(row)
  },
}

export const resolvers = { Query, Mutation }
