import { db } from 'mailbox_api/db/database.ts'
import type { Mailbox } from 'mailbox_api/db/types/schema.ts'
import {
  autoTemplateFromMessage,
  createKyselyAutoTemplateStore,
  templateRowToMatchSets,
} from 'mailbox_api/services/auto_template_from_message.ts'
import {
  mergeSyncedDomainPatterns,
  parseDomainPatternsJson,
  serializeDomainPatternsJson,
} from 'mailbox_api/services/domain_filter_sync.ts'
import {
  extractSpendingCandidates,
  filterMessagesByDomain,
  matchesDomainFilter,
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

/** Messages processed for AI/extract per sync tick. */
export const SYNC_PAGE_SIZE = 50

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

export type FetchRange = {
  since?: Date
  until?: Date
}

/**
 * Date gaps in the requested window that are outside already-stored coverage.
 * Newest gap first so backfill stays newest→oldest for progress UX.
 * When coverage is missing, returns the full requested window as one range.
 */
export function computeUncoveredFetchRanges(
  since: Date | undefined,
  until: Date | undefined,
  coveredMin: Date | undefined,
  coveredMax: Date | undefined,
): FetchRange[] {
  if (coveredMin == null || coveredMax == null) {
    return [{ since, until }]
  }

  const ranges: FetchRange[] = []
  const coveredMaxMs = coveredMax.getTime()
  const coveredMinMs = coveredMin.getTime()

  // Newer gap: (coveredMax, until]
  if (until == null || until.getTime() > coveredMaxMs) {
    const gapSince = new Date(coveredMaxMs + 1)
    if (until == null || gapSince.getTime() <= until.getTime()) {
      ranges.push({ since: gapSince, until })
    }
  }

  // Older gap: [since, coveredMin)
  if (since == null || since.getTime() < coveredMinMs) {
    const gapUntil = new Date(coveredMinMs - 1)
    if (since == null || since.getTime() <= gapUntil.getTime()) {
      ranges.push({ since, until: gapUntil })
    }
  }

  return ranges
}

/**
 * Message DB coverage for gap walks. Expansion mode ignores stored messages
 * so the full window is re-fetched for newly added sender patterns.
 */
export function dbCoverageForGapWalk(
  expansionMode: boolean,
  coverage: { min?: Date; max?: Date },
): { min?: Date; max?: Date } {
  return expansionMode ? {} : coverage
}

/** Merge DB and soft (empty-gap) coverage into one [min, max] span. */
export function mergeCoverage(
  dbMin: Date | undefined,
  dbMax: Date | undefined,
  softMin: Date | undefined,
  softMax: Date | undefined,
): { min?: Date; max?: Date } {
  const mins = [dbMin, softMin].filter((d): d is Date => d != null)
  const maxs = [dbMax, softMax].filter((d): d is Date => d != null)
  if (mins.length === 0 || maxs.length === 0) {
    if (softMin != null && softMax != null) {
      return { min: softMin, max: softMax }
    }
    if (dbMin != null && dbMax != null) return { min: dbMin, max: dbMax }
    return {}
  }
  return {
    min: new Date(Math.min(...mins.map((d) => d.getTime()))),
    max: new Date(Math.max(...maxs.map((d) => d.getTime()))),
  }
}

export type BackfillCursorState = {
  softMinMs: number | null
  softMaxMs: number | null
  /** Opaque provider page cursor (passed through to listMessages). */
  pageToken: SyncCursor
}

/**
 * Backfill cursor encoding: `c:<softMin|- >:<softMax|- >:<providerPage>`.
 * Legacy cursors (no `c:` prefix) are treated as provider page tokens only.
 */
export function parseBackfillCursorState(
  cursor: SyncCursor,
): BackfillCursorState {
  if (cursor == null || cursor === '') {
    return { softMinMs: null, softMaxMs: null, pageToken: null }
  }
  if (!cursor.startsWith('c:')) {
    return { softMinMs: null, softMaxMs: null, pageToken: cursor }
  }
  const rest = cursor.slice(2)
  const m = rest.match(/^([^:]*):([^:]*):(.*)$/)
  if (!m) {
    return { softMinMs: null, softMaxMs: null, pageToken: null }
  }
  const softMinRaw = m[1]!
  const softMaxRaw = m[2]!
  const pageRaw = m[3]!
  return {
    softMinMs: softMinRaw && softMinRaw !== '-'
      ? Number(softMinRaw)
      : null,
    softMaxMs: softMaxRaw && softMaxRaw !== '-'
      ? Number(softMaxRaw)
      : null,
    pageToken: pageRaw === '' ? null : pageRaw,
  }
}

export function serializeBackfillCursorState(
  state: BackfillCursorState,
): SyncCursor {
  const hasSoft = state.softMinMs != null || state.softMaxMs != null
  const page = state.pageToken ?? ''
  if (!hasSoft && (page === '' || page == null)) return null
  if (!hasSoft) return state.pageToken
  const min = state.softMinMs != null ? String(state.softMinMs) : '-'
  const max = state.softMaxMs != null ? String(state.softMaxMs) : '-'
  return `c:${min}:${max}:${page}`
}

/** Extend soft coverage to include a fully fetched gap (incl. empty). */
export function extendSoftCoverageForGap(
  state: BackfillCursorState,
  gap: FetchRange,
): BackfillCursorState {
  const gapStart = gap.since?.getTime() ?? state.softMinMs
  const gapEnd = gap.until?.getTime() ?? state.softMaxMs
  let softMinMs = state.softMinMs
  let softMaxMs = state.softMaxMs
  if (gapStart != null) {
    softMinMs = softMinMs == null
      ? gapStart
      : Math.min(softMinMs, gapStart)
  }
  if (gapEnd != null) {
    softMaxMs = softMaxMs == null ? gapEnd : Math.max(softMaxMs, gapEnd)
  }
  // Open-ended gap: if only one bound, still record the other from existing soft/db via caller.
  if (softMinMs != null && softMaxMs == null) softMaxMs = softMinMs
  if (softMaxMs != null && softMinMs == null) softMinMs = softMaxMs
  return { softMinMs, softMaxMs, pageToken: null }
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

/** Truncate opaque cursors for logs (no secrets; keep prefix readable). */
export function formatCursor(cursor: SyncCursor): string {
  if (cursor == null || cursor === '') return '(none)'
  return cursor.length > 48 ? `${cursor.slice(0, 48)}…` : cursor
}

function dueReason(
  mailbox: Mailbox,
  cutoff: Date,
): 'sync_requested' | 'never_synced' | 'stale' {
  if (mailbox.sync_requested) return 'sync_requested'
  if (mailbox.last_synced_at == null) return 'never_synced'
  const last = toDateOrUndefined(mailbox.last_synced_at)
  if (last == null || last < cutoff) return 'stale'
  return 'stale'
}

/** Unique dropped From addresses (capped) for domain-filter diagnostics. */
export function summarizeDroppedSenders(
  messages: readonly { from: string }[],
  patterns: readonly string[],
  maxUnique = 8,
): string {
  const dropped = messages.filter((m) => !matchesDomainFilter(m.from, patterns))
  const unique: string[] = []
  const seen = new Set<string>()
  for (const m of dropped) {
    const key = m.from.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(m.from)
    if (unique.length >= maxUnique) break
  }
  const extra = seen.size - unique.length
  return extra > 0
    ? `${unique.join(' | ')} (+${extra} more)`
    : unique.join(' | ') || '(none)'
}

type StoredMessageRow = {
  id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: Date | string
  text_body: string | null
  html_body: string | null
}

/** Build EmailMessage from a stored messages row. */
export function emailMessageFromStoredRow(row: StoredMessageRow): EmailMessage {
  const receivedAt = toDateOrUndefined(row.received_at) ?? new Date(0)
  return {
    id: row.provider_message_id,
    rfcMessageId: row.rfc_message_id,
    from: row.from_address,
    subject: row.subject,
    receivedAt,
    textBody: resolvedStoredTextBody(row.text_body, row.html_body),
    htmlBody: row.html_body,
  }
}

/**
 * Select stored messages that still need AI (no matching template).
 * Exported for unit tests.
 */
export function selectMessagesNeedingAutoTemplate(
  rows: readonly StoredMessageRow[],
  templates: MailboxTemplateSets,
  limit: number,
): StoredMessageRow[] {
  const needing: StoredMessageRow[] = []
  for (const row of rows) {
    const msg = emailMessageFromStoredRow(row)
    if (!messageNeedsAutoTemplate(msg, templates)) continue
    needing.push(row)
    if (needing.length >= limit) break
  }
  return needing
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

    const since = toDateOrUndefined(mailbox.sync_since)
    const until = toDateOrUndefined(mailbox.sync_until)
    const backfillMode = since != null || until != null
    // Non-null sync_fetch_patterns_json means allowlist expansion: fetch only
    // those patterns and ignore DB message coverage for the window.
    const expansionFetchPatterns = parseDomainPatternsJson(
      mailbox.sync_fetch_patterns_json,
    )
    const expansionMode = mailbox.sync_fetch_patterns_json != null &&
      expansionFetchPatterns.length > 0
    const fetchPatterns = expansionMode ? expansionFetchPatterns : patterns

    console.log(
      `[mailbox-worker] sync start mailbox=${mailbox.id} provider=${mailbox.provider} label=${JSON.stringify(mailbox.label)} ` +
        `enabled=${mailbox.enabled} sync_requested=${mailbox.sync_requested} ` +
        `cursor=${formatCursor(mailbox.sync_backfill_cursor ?? mailbox.sync_cursor)} backfill=${backfillMode} ` +
        `expansion=${expansionMode} ` +
        `since=${since?.toISOString() ?? '-'} until=${until?.toISOString() ?? '-'} ` +
        `patterns=${patterns.length ? patterns.join(',') : '(none)'} ` +
        `fetch=${fetchPatterns.length ? fetchPatterns.join(',') : '(none)'}`,
    )

    const missingFilters = missingDomainFiltersError(patterns)
    if (missingFilters) {
      errorText = missingFilters
      console.warn(
        `[mailbox-worker] sync abort mailbox=${mailbox.id}: ${missingFilters}`,
      )
      const now = new Date().toISOString()
      await db
        .updateTable('mailboxes')
        .set({
          sync_requested: false,
          sync_since: null,
          sync_until: null,
          sync_backfill_cursor: null,
          sync_fetch_patterns_json: null,
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

      console.log(
        `[mailbox-worker] templates mailbox=${mailbox.id} reject=${templates.rejectTemplates.length} approve=${templates.approveTemplates.length}`,
      )

      // ── Phase A: retry AI on stored unmatched messages ─────────────────
      const reeval = await reevaluateStoredUnmatched({
        mailbox,
        templates,
        since: backfillMode ? since : undefined,
        until: backfillMode ? until : undefined,
      })
      templates = reeval.templates
      extracted += reeval.extracted
      const moreReeval = reeval.moreRemaining

      console.log(
        `[mailbox-worker] reeval mailbox=${mailbox.id} attempted=${reeval.attempted} ` +
          `templated=${reeval.templated} extracted=${reeval.extracted} more=${moreReeval}`,
      )

      // ── Phase B: provider fetch (gap-aware in backfill mode) ───────────
      let backfillState = backfillMode
        ? parseBackfillCursorState(mailbox.sync_backfill_cursor)
        : { softMinMs: null, softMaxMs: null, pageToken: null as SyncCursor }
      let moreFetchWork = false
      let listNextCursor: SyncCursor = null

      if (backfillMode) {
        // Expansion: ignore DB coverage so the full window is re-walked for
        // newly added sender patterns only.
        const loadedCoverage = await loadMessageReceivedAtCoverage(
          mailbox.id,
          since,
          until,
        )
        const coverage = dbCoverageForGapWalk(expansionMode, loadedCoverage)
        const softMin = backfillState.softMinMs != null
          ? new Date(backfillState.softMinMs)
          : undefined
        const softMax = backfillState.softMaxMs != null
          ? new Date(backfillState.softMaxMs)
          : undefined
        const merged = mergeCoverage(
          coverage.min,
          coverage.max,
          softMin,
          softMax,
        )
        const gaps = computeUncoveredFetchRanges(
          since,
          until,
          merged.min,
          merged.max,
        )

        console.log(
          `[mailbox-worker] fetch gaps mailbox=${mailbox.id} count=${gaps.length} ` +
            `covered=${merged.min?.toISOString() ?? '-'}..${merged.max?.toISOString() ?? '-'} ` +
            `soft=${softMin?.toISOString() ?? '-'}..${softMax?.toISOString() ?? '-'} ` +
            `expansion=${expansionMode}`,
        )

        if (gaps.length === 0) {
          moreFetchWork = false
          backfillState = {
            softMinMs: backfillState.softMinMs,
            softMaxMs: backfillState.softMaxMs,
            pageToken: null,
          }
        } else {
          const gap = gaps[0]!
          const page = await provider.listMessages({
            cursor: backfillState.pageToken,
            limit: SYNC_PAGE_SIZE,
            since: gap.since,
            until: gap.until,
            fromPatterns: fetchPatterns,
          })
          listNextCursor = page.nextCursor

          const processResult = await processFetchedPage({
            mailbox,
            messages: page.messages,
            patterns: fetchPatterns,
            templates,
          })
          templates = processResult.templates
          fetched = processResult.fetched
          extracted += processResult.extracted

          if (hasMoreBackfillPages(page.nextCursor)) {
            moreFetchWork = true
            backfillState = {
              ...backfillState,
              pageToken: page.nextCursor,
            }
          } else {
            // Gap exhausted (possibly empty) — extend soft coverage so we
            // do not re-query the same empty edge forever.
            backfillState = extendSoftCoverageForGap(backfillState, gap)
            const softMin2 = backfillState.softMinMs != null
              ? new Date(backfillState.softMinMs)
              : undefined
            const softMax2 = backfillState.softMaxMs != null
              ? new Date(backfillState.softMaxMs)
              : undefined
            // Re-read DB coverage after inserts for accurate remaining gaps
            // (skipped in expansion — only soft coverage drives the walk).
            const loadedCoverage2 = await loadMessageReceivedAtCoverage(
              mailbox.id,
              since,
              until,
            )
            const coverage2 = dbCoverageForGapWalk(
              expansionMode,
              loadedCoverage2,
            )
            const merged2 = mergeCoverage(
              coverage2.min,
              coverage2.max,
              softMin2,
              softMax2,
            )
            const gapsLeft = computeUncoveredFetchRanges(
              since,
              until,
              merged2.min,
              merged2.max,
            )
            moreFetchWork = gapsLeft.length > 0
            console.log(
              `[mailbox-worker] gap done mailbox=${mailbox.id} gaps_left=${gapsLeft.length}`,
            )
          }
        }
      } else {
        // Incremental: existing sync_cursor watermark.
        const page = await provider.listMessages({
          cursor: mailbox.sync_cursor,
          limit: SYNC_PAGE_SIZE,
          since,
          until,
          fromPatterns: fetchPatterns,
        })
        listNextCursor = page.nextCursor
        const processResult = await processFetchedPage({
          mailbox,
          messages: page.messages,
          patterns: fetchPatterns,
          templates,
        })
        templates = processResult.templates
        fetched = processResult.fetched
        extracted += processResult.extracted
      }

      const now = new Date().toISOString()
      if (backfillMode) {
        const keepGoing = moreFetchWork || moreReeval
        console.log(
          `[mailbox-worker] backfill mailbox=${mailbox.id} more_fetch=${moreFetchWork} more_reeval=${moreReeval}`,
        )
        if (keepGoing) {
          await db
            .updateTable('mailboxes')
            .set({
              sync_backfill_cursor: serializeBackfillCursorState(
                backfillState,
              ),
              sync_requested: true,
              last_synced_at: now,
              updated_at: now,
            })
            .where('id', '=', mailbox.id)
            .execute()
        } else {
          const syncedMerged = mergeSyncedDomainPatterns(
            parseDomainPatternsJson(mailbox.synced_domain_filters_json),
            patterns,
            fetchPatterns,
          )
          await db
            .updateTable('mailboxes')
            .set({
              sync_since: null,
              sync_until: null,
              sync_backfill_cursor: null,
              sync_fetch_patterns_json: null,
              synced_domain_filters_json: serializeDomainPatternsJson(
                syncedMerged,
              ),
              sync_requested: false,
              last_synced_at: now,
              updated_at: now,
            })
            .where('id', '=', mailbox.id)
            .execute()
        }
      } else {
        const syncedUpdate: {
          sync_cursor: SyncCursor
          sync_requested: boolean
          last_synced_at: string
          updated_at: string
          sync_fetch_patterns_json?: string | null
          synced_domain_filters_json?: string
        } = {
          sync_cursor: listNextCursor,
          // Keep requested while unmatched stored mail still needs AI.
          sync_requested: moreReeval,
          last_synced_at: now,
          updated_at: now,
        }
        // If expansion was requested without a date window, still clear the
        // fetch snapshot; do not mark patterns synced (no historical walk).
        if (expansionMode && !moreReeval) {
          syncedUpdate.sync_fetch_patterns_json = null
        }
        await db
          .updateTable('mailboxes')
          .set(syncedUpdate)
          .where('id', '=', mailbox.id)
          .execute()
      }
    }
  } catch (err) {
    errorText = err instanceof Error ? err.message : String(err)
    console.error(
      `[mailbox-worker] sync threw mailbox=${mailbox.id}:`,
      errorText,
      err,
    )
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

async function loadMessageReceivedAtCoverage(
  mailboxId: number,
  since: Date | undefined,
  until: Date | undefined,
): Promise<{ min?: Date; max?: Date }> {
  let q = db
    .selectFrom('messages')
    .select((eb) => [
      eb.fn.min('received_at').as('min_received'),
      eb.fn.max('received_at').as('max_received'),
    ])
    .where('mailbox_id', '=', mailboxId)

  if (since != null) {
    q = q.where('received_at', '>=', since)
  }
  if (until != null) {
    q = q.where('received_at', '<=', until)
  }

  const row = await q.executeTakeFirst()
  const min = toDateOrUndefined(
    row?.min_received as Date | string | null | undefined,
  )
  const max = toDateOrUndefined(
    row?.max_received as Date | string | null | undefined,
  )
  if (min == null || max == null) return {}
  return { min, max }
}

async function reevaluateStoredUnmatched(input: {
  mailbox: Mailbox
  templates: MailboxTemplateSets
  since?: Date
  until?: Date
}): Promise<{
  templates: MailboxTemplateSets
  attempted: number
  templated: number
  extracted: number
  moreRemaining: boolean
}> {
  // Metadata only — template match uses from/subject; bodies loaded for the batch.
  let q = db
    .selectFrom('messages')
    .select([
      'id',
      'provider_message_id',
      'rfc_message_id',
      'from_address',
      'subject',
      'received_at',
    ])
    .where('mailbox_id', '=', input.mailbox.id)
    .orderBy('received_at', 'desc')

  if (input.since != null) {
    q = q.where('received_at', '>=', input.since)
  }
  if (input.until != null) {
    q = q.where('received_at', '<=', input.until)
  }

  const metaRows = await q.execute()
  const needingMeta = metaRows.filter((row) =>
    messageNeedsAutoTemplate(
      emailMessageFromStoredRow({
        ...row,
        text_body: null,
        html_body: null,
      }),
      input.templates,
    )
  )
  const batchMeta = needingMeta.slice(0, SYNC_PAGE_SIZE)
  const moreRemaining = needingMeta.length > SYNC_PAGE_SIZE

  let templates = input.templates
  let extracted = 0
  let templated = 0

  if (batchMeta.length > 0) {
    const ids = batchMeta.map((r) => r.id)
    const bodyRows = await db
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
      .where('id', 'in', ids)
      .execute()
    const byId = new Map(bodyRows.map((r) => [r.id, r]))

    for (const meta of batchMeta) {
      const row = byId.get(meta.id)
      if (!row) continue
      const forExtract = emailMessageFromStoredRow(row)
      const result = await evaluateAndExtractMessage({
        mailbox: input.mailbox,
        messageId: row.id,
        forExtract,
        templates,
      })
      templates = result.templates
      extracted += result.extracted
      if (result.templated) templated += 1
    }
  }

  return {
    templates,
    attempted: batchMeta.length,
    templated,
    extracted,
    moreRemaining,
  }
}
async function processFetchedPage(input: {
  mailbox: Mailbox
  messages: EmailMessage[]
  patterns: string[]
  templates: MailboxTemplateSets
}): Promise<{
  templates: MailboxTemplateSets
  fetched: number
  extracted: number
}> {
  const filtered = filterMessagesByDomain(input.messages, input.patterns)
  const dropped = input.messages.length - filtered.length

  console.log(
    `[mailbox-worker] listMessages mailbox=${input.mailbox.id} raw=${input.messages.length} ` +
      `filtered=${filtered.length} dropped_by_domain=${dropped}`,
  )
  if (dropped > 0) {
    console.log(
      `[mailbox-worker] domain-filter drops mailbox=${input.mailbox.id} ` +
        `senders=${summarizeDroppedSenders(input.messages, input.patterns)}`,
    )
  }
  if (input.messages.length === 0) {
    console.log(
      `[mailbox-worker] provider returned 0 messages mailbox=${input.mailbox.id} ` +
        `(check cursor watermark / date range / Gmail query)`,
    )
  }

  let templates = input.templates
  let inserted = 0
  let skippedExisting = 0
  let extracted = 0

  for (const msg of filtered) {
    const existing = await db
      .selectFrom('messages')
      .select('id')
      .where('mailbox_id', '=', input.mailbox.id)
      .where('rfc_message_id', '=', msg.rfcMessageId)
      .executeTakeFirst()

    if (existing) {
      skippedExisting += 1
      continue
    }

    const forExtract = messageForExtraction(msg)
    const textBody = forExtract.textBody
    const bodyHash = await hashBody(textBody ?? '')
    const row = await db
      .insertInto('messages')
      .values({
        mailbox_id: input.mailbox.id,
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
    inserted += 1

    const result = await evaluateAndExtractMessage({
      mailbox: input.mailbox,
      messageId: row.id,
      forExtract: {
        ...forExtract,
        textBody: row.text_body,
      },
      templates,
    })
    templates = result.templates
    extracted += result.extracted
  }

  console.log(
    `[mailbox-worker] process mailbox=${input.mailbox.id} inserted=${inserted} ` +
      `skipped_existing=${skippedExisting} extracted=${extracted}`,
  )

  return { templates, fetched: filtered.length, extracted }
}

async function evaluateAndExtractMessage(input: {
  mailbox: Mailbox
  messageId: number
  forExtract: EmailMessage
  templates: MailboxTemplateSets
}): Promise<{
  templates: MailboxTemplateSets
  extracted: number
  templated: boolean
}> {
  let workingTemplates = input.templates
  let templated = false

  if (messageNeedsAutoTemplate(input.forExtract, workingTemplates)) {
    try {
      const created = await autoTemplateFromMessage(
        {
          id: input.messageId,
          mailbox_id: input.mailbox.id,
          user_id: input.mailbox.user_id,
          from_address: input.forExtract.from,
          subject: input.forExtract.subject,
          text_body: input.forExtract.textBody,
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
      templated = true
      console.log(
        `[mailbox-worker] auto-template mailbox=${input.mailbox.id} message=${input.messageId} useful=${created.useful} template=${created.template.id}`,
      )
    } catch (err) {
      console.error(
        `[mailbox-worker] auto-template failed mailbox=${input.mailbox.id} message=${input.messageId}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  const artifacts = extractSpendingCandidates(
    input.forExtract,
    workingTemplates,
  )
  let extracted = 0
  for (const art of artifacts) {
    await insertArtifact(input.messageId, art)
    extracted += 1
  }

  return { templates: workingTemplates, extracted, templated }
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

  if (due.length === 0) {
    console.log(
      `[mailbox-worker] poll: 0 due mailboxes (cutoff=${cutoff.toISOString()} intervalMs=${pollIntervalMs})`,
    )
    return 0
  }

  console.log(
    `[mailbox-worker] poll: ${due.length} due mailbox(es) ` +
      due
        .map((m) => `#${m.id}:${m.provider}:${dueReason(m, cutoff)}`)
        .join(', '),
  )

  for (const mailbox of due) {
    const result = await syncMailbox(mailbox)
    console.log(
      `[mailbox-worker] sync done mailbox=${mailbox.id} fetched=${result.fetched} extracted=${result.extracted}` +
        (result.error ? ` error=${result.error}` : ''),
    )
  }
  return due.length
}
