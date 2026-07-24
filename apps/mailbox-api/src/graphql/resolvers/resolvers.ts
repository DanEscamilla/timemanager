import { getContext } from '@getcronit/pylon'
import {
  SPENDING_CANDIDATE_KIND,
  messageMatchesAnyTemplate,
  parseSpendTemplateExtractors,
  type SpendingCandidatePayload,
} from 'mailbox_kit/mod.ts'
import { db } from '../../db/database.ts'
import type { NewMailbox } from '../../db/types/schema.ts'
import {
  AiClientError,
  generateEmailRejectTemplate,
  generateEmailSpendTemplate,
} from '../../services/ai_client.ts'
import {
  applyTemplatesToMailbox,
  createKyselyApplyTemplatesStore,
} from '../../services/apply_templates.ts'
import {
  clearInboxData,
  createKyselyInboxOpsStore,
  rejectAllPendingArtifacts as rejectAllPendingArtifactsOp,
} from '../../services/inbox_ops.ts'
import {
  createKyselyTemplateReevaluateStore,
  reevaluatePendingWithTemplate,
} from '../../services/template_reevaluate.ts'
import {
  createKyselyMessageLookupStore,
  findOwnedMessage,
  findSourceMessageForExpense,
} from '../../services/message_lookups.ts'
import {
  SpendmanagerSinkError,
  publishExpenseToSpendmanager,
} from '../../services/spendmanager_expense_sink.ts'
import {
  GmailOAuthError,
  buildGoogleAuthorizeUrl,
  fetchGmailEmailAddress,
  isReturnToAllowed,
  loadGmailOAuthConfig,
  signOAuthState,
} from '../../services/gmail_oauth.ts'
import { asIsoTimestamp, asIsoTimestampOrNull } from '../timestamps.ts'
import type {
  ConnectGmailInput,
  CreateMailboxInput,
  CreateParsingTemplateInput,
  GenerateParsingTemplateInput,
  SetDomainFiltersInput,
  StartGmailOAuthInput,
  UpdateArtifactStatusInput,
  UpdateMailboxInput,
  UpdateParsingTemplateInput,
} from '../types.ts'
import {
  InvalidMailboxError,
  clampArtifactPage,
  validateArtifactStatus,
  validateCategoryId,
  validateDomainPatterns,
  validateLabel,
  validateMatchFromPattern,
  validateOptionalSyncDate,
  validateProvider,
  validateSubjectRegex,
  validateSyncDateRange,
  validateTemplateKind,
  validateTemplateName,
} from '../validation.ts'

function requireUserId(): number {
  const userId = getContext().get('userId')
  if (typeof userId !== 'number') {
    throw new Error('Unauthenticated')
  }
  return userId
}

function requireAuthorizationHeader(): string {
  const ctx = getContext()
  const header = ctx.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    throw new InvalidMailboxError('missing Authorization bearer token')
  }
  return header
}

/** Named return shapes so Pylon emits GraphQL object types (not `Any!`). */
export interface Mailbox {
  id: number
  user_id: number
  provider: string
  label: string
  enabled: boolean
  sync_cursor: string | null
  sync_requested: boolean
  sync_since: string | null
  sync_until: string | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export interface DomainFilter {
  id: number
  mailbox_id: number
  pattern: string
  created_at: string
}

export interface Message {
  id: number
  mailbox_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: string
  text_body: string | null
  html_body: string | null
  created_at: string
}

export interface ExtractionArtifact {
  id: number
  message_id: number
  kind: string
  payload: string
  confidence: number
  status: string
  published_expense_id: number | null
  created_at: string
  updated_at: string
}

export interface ExtractionArtifactPage {
  items: ExtractionArtifact[]
  totalCount: number
  page: number
  pageSize: number
}

export interface SyncRun {
  id: number
  mailbox_id: number
  started_at: string
  finished_at: string | null
  fetched_count: number
  extracted_count: number
  error_text: string | null
}

export interface ParsingTemplate {
  id: number
  mailbox_id: number
  user_id: number
  name: string
  kind: string
  enabled: boolean
  match_from_pattern: string
  match_subject_regex: string | null
  extractors: string | null
  source_message_id: number | null
  version: number
  created_at: string
  updated_at: string
}

export interface StartGmailOAuthPayload {
  authorizationUrl: string
}

export interface GenerateParsingTemplatePayload {
  template: ParsingTemplate
  reevaluatedCount: number
}

function mapMailbox(row: {
  id: number
  user_id: number
  provider: string
  label: string
  enabled: boolean
  sync_cursor: string | null
  sync_requested: boolean
  sync_since?: Date | string | null
  sync_until?: Date | string | null
  last_synced_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}): Mailbox {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    label: row.label,
    enabled: row.enabled,
    sync_cursor: row.sync_cursor,
    sync_requested: row.sync_requested,
    sync_since: asIsoTimestampOrNull(row.sync_since ?? null),
    sync_until: asIsoTimestampOrNull(row.sync_until ?? null),
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
}): DomainFilter {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    pattern: row.pattern,
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
  text_body?: string | null
  html_body?: string | null
  created_at: Date | string
}): Message {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    provider_message_id: row.provider_message_id,
    rfc_message_id: row.rfc_message_id,
    from_address: row.from_address,
    subject: row.subject,
    received_at: asIsoTimestamp(row.received_at),
    text_body: row.text_body ?? null,
    html_body: row.html_body ?? null,
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
  published_expense_id?: number | null
  created_at: Date | string
  updated_at: Date | string
}): ExtractionArtifact {
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
    published_expense_id: row.published_expense_id ?? null,
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
}): SyncRun {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    started_at: asIsoTimestamp(row.started_at),
    finished_at: asIsoTimestampOrNull(row.finished_at),
    fetched_count: row.fetched_count,
    extracted_count: row.extracted_count,
    error_text: row.error_text,
  }
}

function mapParsingTemplate(row: {
  id: number
  mailbox_id: number
  user_id: number
  name: string
  kind: string
  enabled: boolean
  match_from_pattern: string
  match_subject_regex: string | null
  extractors: unknown
  source_message_id: number | null
  version: number
  created_at: Date | string
  updated_at: Date | string
}): ParsingTemplate {
  let extractors: string | null = null
  if (row.extractors != null) {
    extractors = typeof row.extractors === 'string'
      ? row.extractors
      : JSON.stringify(row.extractors)
  }
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    user_id: row.user_id,
    name: row.name,
    kind: row.kind,
    enabled: row.enabled,
    match_from_pattern: row.match_from_pattern,
    match_subject_regex: row.match_subject_regex,
    extractors,
    source_message_id: row.source_message_id,
    version: row.version,
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
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

function parseExtractorsJson(raw: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new InvalidMailboxError('extractorsJson must be valid JSON')
  }
  const extractors = parseSpendTemplateExtractors(parsed)
  if (!extractors) {
    throw new InvalidMailboxError('extractorsJson has invalid shape')
  }
  return extractors
}

function asSpendingPayload(payload: unknown): SpendingCandidatePayload | null {
  const obj = typeof payload === 'string'
    ? (() => {
      try {
        return JSON.parse(payload)
      } catch {
        return null
      }
    })()
    : payload
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null
  const p = obj as Record<string, unknown>
  if (typeof p.amountCents !== 'number' || typeof p.spentOn !== 'string') {
    return null
  }
  return {
    amountCents: p.amountCents,
    currency: typeof p.currency === 'string' ? p.currency : 'USD',
    spentOn: p.spentOn,
    merchant: typeof p.merchant === 'string' ? p.merchant : null,
    note: typeof p.note === 'string' ? p.note : null,
    sourceSubject: typeof p.sourceSubject === 'string' ? p.sourceSubject : '',
    sourceFrom: typeof p.sourceFrom === 'string' ? p.sourceFrom : '',
    publishedExpenseId:
      typeof p.publishedExpenseId === 'number' ? p.publishedExpenseId : null,
    templateId: typeof p.templateId === 'number' ? p.templateId : null,
  }
}

const Query = {
  async mailboxes(): Promise<Mailbox[]> {
    const userId = requireUserId()
    const rows = await db
      .selectFrom('mailboxes')
      .selectAll()
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map(mapMailbox)
  },

  async domainFilters(mailboxId: number): Promise<DomainFilter[]> {
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

  async messages(
    mailboxId: number,
    excludeMatchingTemplates?: boolean,
  ): Promise<Message[]> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const rows = await db
      .selectFrom('messages')
      .selectAll()
      .where('mailbox_id', '=', mailboxId)
      .orderBy('received_at', 'desc')
      .execute()
    const mapped = rows.map(mapMessage)
    if (!excludeMatchingTemplates) return mapped

    const templates = await db
      .selectFrom('parsing_templates')
      .select(['match_from_pattern', 'match_subject_regex', 'enabled'])
      .where('mailbox_id', '=', mailboxId)
      .where('enabled', '=', true)
      .execute()
    const specs = templates.map((t) => ({
      matchFromPattern: t.match_from_pattern,
      matchSubjectRegex: t.match_subject_regex,
      enabled: t.enabled,
    }))
    return mapped.filter(
      (m) =>
        !messageMatchesAnyTemplate(
          { from: m.from_address, subject: m.subject },
          specs,
        ),
    )
  },

  async message(id: number): Promise<Message | null> {
    const userId = requireUserId()
    return await findOwnedMessage(createKyselyMessageLookupStore(db), userId, id)
  },

  async sourceMessageForExpense(expenseId: number): Promise<Message | null> {
    const userId = requireUserId()
    return await findSourceMessageForExpense(
      createKyselyMessageLookupStore(db),
      userId,
      expenseId,
    )
  },

  async extractionArtifacts(
    mailboxId?: number | null,
    status?: string | null,
    page?: number | null,
    pageSize?: number | null,
  ): Promise<ExtractionArtifactPage> {
    const userId = requireUserId()
    const { page: safePage, pageSize: safeSize, offset } = clampArtifactPage(
      page,
      pageSize,
    )
    const statusFilter =
      status != null && status !== ''
        ? validateArtifactStatus(status)
        : null

    let countQ = db
      .selectFrom('extraction_artifacts')
      .innerJoin('messages', 'messages.id', 'extraction_artifacts.message_id')
      .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('mailboxes.user_id', '=', userId)
    if (mailboxId != null) {
      countQ = countQ.where('messages.mailbox_id', '=', mailboxId)
    }
    if (statusFilter != null) {
      countQ = countQ.where('extraction_artifacts.status', '=', statusFilter)
    }
    const countRow = await countQ.executeTakeFirstOrThrow()
    const totalCount = Number(countRow.count)

    let listQ = db
      .selectFrom('extraction_artifacts')
      .innerJoin('messages', 'messages.id', 'extraction_artifacts.message_id')
      .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
      .selectAll('extraction_artifacts')
      .where('mailboxes.user_id', '=', userId)
    if (mailboxId != null) {
      listQ = listQ.where('messages.mailbox_id', '=', mailboxId)
    }
    if (statusFilter != null) {
      listQ = listQ.where('extraction_artifacts.status', '=', statusFilter)
    }
    const rows = await listQ
      .orderBy('extraction_artifacts.id', 'desc')
      .limit(safeSize)
      .offset(offset)
      .execute()

    return {
      items: rows.map(mapArtifact),
      totalCount,
      page: safePage,
      pageSize: safeSize,
    }
  },

  async syncRuns(mailboxId: number): Promise<SyncRun[]> {
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

  async parsingTemplates(mailboxId: number): Promise<ParsingTemplate[]> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const rows = await db
      .selectFrom('parsing_templates')
      .selectAll()
      .where('mailbox_id', '=', mailboxId)
      .where('user_id', '=', userId)
      .orderBy('id', 'asc')
      .execute()
    return rows.map(mapParsingTemplate)
  },
}

const Mutation = {
  async createMailbox(input: CreateMailboxInput): Promise<Mailbox> {
    const userId = requireUserId()
    const provider = validateProvider(input.provider)
    const label = validateLabel(input.label)
    // Empty allowed at create (e.g. Gmail OAuth); sync requires filters later.
    const rawFilters = input.domainFilters ?? []
    const patterns = rawFilters.length === 0
      ? []
      : validateDomainPatterns(rawFilters)
    const now = new Date().toISOString()

    const values: NewMailbox = {
      user_id: userId,
      provider,
      label,
      enabled: input.enabled ?? true,
      sync_cursor: null,
      sync_requested: patterns.length > 0,
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

  async updateMailbox(input: UpdateMailboxInput): Promise<Mailbox> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, input.id)
    const label = validateLabel(input.label)
    const now = new Date().toISOString()
    const row = await db
      .updateTable('mailboxes')
      .set({ label, updated_at: now })
      .where('id', '=', input.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapMailbox(row)
  },

  async deleteMailbox(id: number): Promise<boolean> {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('mailboxes')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return Number(result.numDeletedRows ?? 0) > 0
  },

  async clearInbox(mailboxId: number): Promise<Mailbox> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const row = await clearInboxData(
      createKyselyInboxOpsStore(db),
      mailboxId,
    )
    return mapMailbox(row)
  },

  async setDomainFilters(input: SetDomainFiltersInput): Promise<DomainFilter[]> {
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

  async triggerSync(
    mailboxId: number,
    since?: string | null,
    until?: string | null,
  ): Promise<Mailbox> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    const filterCount = await db
      .selectFrom('domain_filters')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('mailbox_id', '=', mailboxId)
      .executeTakeFirstOrThrow()
    if (Number(filterCount.count) < 1) {
      throw new InvalidMailboxError(
        'domain filters are required before sync',
      )
    }
    const range = validateSyncDateRange(
      validateOptionalSyncDate(since, 'since'),
      validateOptionalSyncDate(until, 'until'),
    )
    const now = new Date().toISOString()
    const row = await db
      .updateTable('mailboxes')
      .set({
        sync_requested: true,
        sync_since: range.since,
        sync_until: range.until,
        sync_backfill_cursor: null,
        updated_at: now,
      })
      .where('id', '=', mailboxId)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapMailbox(row)
  },

  async rejectAllPendingArtifacts(mailboxId: number): Promise<number> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, mailboxId)
    return await rejectAllPendingArtifactsOp(
      createKyselyInboxOpsStore(db),
      mailboxId,
    )
  },

  async updateArtifactStatus(
    input: UpdateArtifactStatusInput,
  ): Promise<ExtractionArtifact> {
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

    if (status === 'rejected') {
      const row = await db
        .updateTable('extraction_artifacts')
        .set({ status, updated_at: now })
        .where('id', '=', input.artifactId)
        .returningAll()
        .executeTakeFirstOrThrow()
      return mapArtifact(row)
    }

    if (status === 'accepted') {
      if (owned.kind === SPENDING_CANDIDATE_KIND) {
        if (owned.published_expense_id != null) {
          const row = await db
            .updateTable('extraction_artifacts')
            .set({ status: 'accepted', updated_at: now })
            .where('id', '=', input.artifactId)
            .returningAll()
            .executeTakeFirstOrThrow()
          return mapArtifact(row)
        }

        const categoryId = validateCategoryId(input.categoryId)
        const candidate = asSpendingPayload(owned.payload)
        if (!candidate) {
          throw new InvalidMailboxError('artifact payload is not a spending candidate')
        }

        try {
          const published = await publishExpenseToSpendmanager(
            candidate,
            categoryId,
            requireAuthorizationHeader(),
          )
          const nextPayload = {
            ...candidate,
            publishedExpenseId: published.expenseId,
          }
          const row = await db
            .updateTable('extraction_artifacts')
            .set({
              status: 'accepted',
              published_expense_id: published.expenseId,
              payload: nextPayload,
              updated_at: now,
            })
            .where('id', '=', input.artifactId)
            .returningAll()
            .executeTakeFirstOrThrow()
          return mapArtifact(row)
        } catch (err) {
          if (err instanceof SpendmanagerSinkError) {
            throw new InvalidMailboxError(
              `failed to publish expense: ${err.message}`,
            )
          }
          throw err
        }
      }

      const row = await db
        .updateTable('extraction_artifacts')
        .set({ status: 'accepted', updated_at: now })
        .where('id', '=', input.artifactId)
        .returningAll()
        .executeTakeFirstOrThrow()
      return mapArtifact(row)
    }

    // pending / other
    const row = await db
      .updateTable('extraction_artifacts')
      .set({ status, updated_at: now })
      .where('id', '=', input.artifactId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapArtifact(row)
  },

  async connectGmail(input: ConnectGmailInput): Promise<Mailbox> {
    const userId = requireUserId()
    const mailbox = await requireOwnedMailbox(userId, input.mailboxId)
    if (mailbox.provider !== 'gmail') {
      throw new InvalidMailboxError('mailbox provider is not gmail')
    }
    if (!input.accessToken.trim()) {
      throw new InvalidMailboxError('accessToken is required')
    }

    const accessToken = input.accessToken.trim()
    const tokens = {
      accessToken,
      refreshToken: input.refreshToken ?? null,
      expiresAtMs: input.expiresAtMs ?? null,
    }
    const email = await fetchGmailEmailAddress({ accessToken })
    const now = new Date().toISOString()
    const row = await db
      .updateTable('mailboxes')
      .set({
        oauth_tokens_json: JSON.stringify(tokens),
        ...(email ? { label: email } : {}),
        sync_requested: true,
        updated_at: now,
      })
      .where('id', '=', mailbox.id)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapMailbox(row)
  },

  async startGmailOAuth(
    input: StartGmailOAuthInput,
  ): Promise<StartGmailOAuthPayload> {
    const userId = requireUserId()
    const mailbox = await requireOwnedMailbox(userId, input.mailboxId)
    if (mailbox.provider !== 'gmail') {
      throw new InvalidMailboxError('mailbox provider is not gmail')
    }

    const returnTo = input.returnTo?.trim() ?? ''
    if (!returnTo) {
      throw new InvalidMailboxError('returnTo is required')
    }

    let config
    try {
      config = loadGmailOAuthConfig()
    } catch (err) {
      if (err instanceof GmailOAuthError) {
        throw new InvalidMailboxError(err.message)
      }
      throw err
    }

    if (!isReturnToAllowed(returnTo, config.returnToAllowlist)) {
      throw new InvalidMailboxError('returnTo is not allowed')
    }

    const state = await signOAuthState(
      { userId, mailboxId: mailbox.id, returnTo },
      config.clientSecret,
    )
    const authorizationUrl = buildGoogleAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      state,
    })
    return { authorizationUrl }
  },

  async createParsingTemplate(
    input: CreateParsingTemplateInput,
  ): Promise<ParsingTemplate> {
    const userId = requireUserId()
    await requireOwnedMailbox(userId, input.mailboxId)
    const kind = validateTemplateKind(input.kind ?? 'approve')
    const name = validateTemplateName(input.name)
    const matchFromPattern = validateMatchFromPattern(input.matchFromPattern)
    const matchSubjectRegex = validateSubjectRegex(input.matchSubjectRegex)
    let extractors: ReturnType<typeof parseExtractorsJson> | null = null
    if (kind === 'approve') {
      if (input.extractorsJson == null || !input.extractorsJson.trim()) {
        throw new InvalidMailboxError(
          'extractorsJson is required for approve templates',
        )
      }
      extractors = parseExtractorsJson(input.extractorsJson)
    }
    const now = new Date().toISOString()

    if (input.sourceMessageId != null) {
      const msg = await db
        .selectFrom('messages')
        .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
        .select('messages.id')
        .where('messages.id', '=', input.sourceMessageId)
        .where('mailboxes.user_id', '=', userId)
        .where('messages.mailbox_id', '=', input.mailboxId)
        .executeTakeFirst()
      if (!msg) throw new InvalidMailboxError('source message not found')
    }

    const row = await db
      .insertInto('parsing_templates')
      .values({
        mailbox_id: input.mailboxId,
        user_id: userId,
        name,
        kind,
        enabled: input.enabled ?? true,
        match_from_pattern: matchFromPattern,
        match_subject_regex: matchSubjectRegex,
        extractors,
        source_message_id: input.sourceMessageId ?? null,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      input.mailboxId,
      now,
    )
    return mapParsingTemplate(row)
  },

  async updateParsingTemplate(
    input: UpdateParsingTemplateInput,
  ): Promise<ParsingTemplate> {
    const userId = requireUserId()
    const existing = await db
      .selectFrom('parsing_templates')
      .selectAll()
      .where('id', '=', input.id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!existing) throw new InvalidMailboxError('template not found')

    const now = new Date().toISOString()
    const patch: {
      name?: string
      match_from_pattern?: string
      match_subject_regex?: string | null
      extractors?: ReturnType<typeof parseExtractorsJson> | null
      enabled?: boolean
      version: number
      updated_at: string
    } = {
      version: existing.version + 1,
      updated_at: now,
    }

    if (input.name != null) patch.name = validateTemplateName(input.name)
    if (input.matchFromPattern != null) {
      patch.match_from_pattern = validateMatchFromPattern(input.matchFromPattern)
    }
    if (input.matchSubjectRegex !== undefined) {
      patch.match_subject_regex = validateSubjectRegex(input.matchSubjectRegex)
    }
    if (input.extractorsJson != null) {
      if (existing.kind === 'reject') {
        throw new InvalidMailboxError(
          'reject templates cannot have extractors',
        )
      }
      patch.extractors = parseExtractorsJson(input.extractorsJson)
    }
    if (input.enabled != null) patch.enabled = input.enabled

    const row = await db
      .updateTable('parsing_templates')
      .set(patch)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirstOrThrow()

    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      existing.mailbox_id,
      now,
    )
    return mapParsingTemplate(row)
  },

  async deleteParsingTemplate(id: number): Promise<boolean> {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('parsing_templates')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    return Number(result.numDeletedRows ?? 0) > 0
  },

  async generateParsingTemplate(
    input: GenerateParsingTemplateInput,
  ): Promise<GenerateParsingTemplatePayload> {
    const userId = requireUserId()
    const decision = validateTemplateKind(input.decision)
    const message = await db
      .selectFrom('messages')
      .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
      .select([
        'messages.id',
        'messages.mailbox_id',
        'messages.from_address',
        'messages.subject',
        'messages.text_body',
      ])
      .where('messages.id', '=', input.messageId)
      .where('mailboxes.user_id', '=', userId)
      .executeTakeFirst()

    if (!message) throw new InvalidMailboxError('message not found')
    if (!message.text_body?.trim()) {
      throw new InvalidMailboxError(
        'message has no stored body; re-sync after upgrading mailbox',
      )
    }

    const genericFailMessage = 'Template generation failed. Please try again.'
    const failTemplateGeneration = (reason: string, details?: unknown): never => {
      console.error(
        '[mailbox-api] template generation failed:',
        reason,
        details ?? '',
      )
      throw new InvalidMailboxError(genericFailMessage)
    }

    const aiInput = {
      from: message.from_address,
      subject: message.subject,
      textBody: message.text_body,
      hints: input.hints,
    }

    let matchFromPattern: string
    let matchSubjectRegex: string | null
    let extractors:
      | NonNullable<ReturnType<typeof parseSpendTemplateExtractors>>
      | null = null
    let nameSuggestion: string

    try {
      if (decision === 'reject') {
        const aiOut = await generateEmailRejectTemplate(aiInput)
        matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern)
        matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex)
        nameSuggestion = aiOut.nameSuggestion || 'Ignored email type'
      } else {
        const aiOut = await generateEmailSpendTemplate(aiInput)
        matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern)
        matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex)
        const parsed = parseSpendTemplateExtractors(aiOut.extractors)
        if (!parsed) {
          failTemplateGeneration('AI returned invalid extractors', {
            messageId: message.id,
            extractors: aiOut.extractors,
          })
        }
        extractors = parsed
        nameSuggestion = aiOut.nameSuggestion || 'Spending template'
      }
    } catch (err) {
      if (
        err instanceof InvalidMailboxError &&
        err.message === genericFailMessage
      ) {
        throw err
      }
      if (err instanceof AiClientError || err instanceof InvalidMailboxError) {
        failTemplateGeneration(err.message, { messageId: message.id })
      }
      throw err
    }

    const name = validateTemplateName(
      input.name?.trim() || nameSuggestion,
    )
    const now = new Date().toISOString()

    const row = await db
      .insertInto('parsing_templates')
      .values({
        mailbox_id: message.mailbox_id,
        user_id: userId,
        name,
        kind: decision,
        enabled: true,
        match_from_pattern: matchFromPattern,
        match_subject_regex: matchSubjectRegex,
        extractors,
        source_message_id: message.id,
        version: 1,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow()

    await applyTemplatesToMailbox(
      createKyselyApplyTemplatesStore(db),
      message.mailbox_id,
      now,
    )

    const reevaluatedCount = await reevaluatePendingWithTemplate(
      createKyselyTemplateReevaluateStore(db),
      {
        id: row.id,
        mailbox_id: row.mailbox_id,
        kind: row.kind,
        enabled: row.enabled,
        match_from_pattern: row.match_from_pattern,
        match_subject_regex: row.match_subject_regex,
        extractors: row.extractors,
      },
      now,
    )

    return {
      template: mapParsingTemplate(row),
      reevaluatedCount,
    }
  },
}

export const resolvers = { Query, Mutation }
