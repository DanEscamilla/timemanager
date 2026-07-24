import { assertEquals, assertStringIncludes } from 'jsr:@std/assert@1'
import {
  FixtureMailboxProvider,
  extractSpendingCandidates,
  filterMessagesByDomain,
  type EmailMessage,
  type SpendParsingTemplate,
} from 'mailbox_kit/mod.ts'
import {
  DOMAIN_FILTERS_REQUIRED,
  computeUncoveredFetchRanges,
  dbCoverageForGapWalk,
  extendSoftCoverageForGap,
  formatCursor,
  mergeCoverage,
  messageForExtraction,
  messageNeedsAutoTemplate,
  missingDomainFiltersError,
  parseBackfillCursorState,
  resolvedStoredTextBody,
  selectMessagesNeedingAutoTemplate,
  serializeBackfillCursorState,
  summarizeDroppedSenders,
} from './sync.ts'

/**
 * Unit-level sync pipeline test without Postgres: provider → domain filter → templates.
 * Full DB integration is covered by seed + manual worker run.
 */
Deno.test('fixture sync with no approve templates yields no artifacts', async () => {
  const provider = new FixtureMailboxProvider()
  const page = await provider.listMessages({ cursor: null, limit: 50 })
  const filtered = filterMessagesByDomain(page.messages, [
    'amazon.com',
    'uber.com',
  ])
  assertEquals(filtered.length, 2)

  const artifacts = filtered.flatMap((m) =>
    extractSpendingCandidates(m, {
      rejectTemplates: [],
      approveTemplates: [],
    })
  )
  assertEquals(artifacts.length, 0)
})

Deno.test('empty domain filters abort sync without fetching', () => {
  assertEquals(missingDomainFiltersError([]), DOMAIN_FILTERS_REQUIRED)
  assertEquals(missingDomainFiltersError(['amazon.com']), null)
  // Defense in depth: kit also drops everything when patterns are empty.
  assertEquals(
    filterMessagesByDomain([{ from: 'a@amazon.com' }], []),
    [],
  )
})

Deno.test('fixture backfill range ignores messages outside window', async () => {
  const provider = new FixtureMailboxProvider()
  const page = await provider.listMessages({
    cursor: null,
    limit: 50,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-01T23:59:59.999Z'),
  })
  assertEquals(page.messages.length, 1)
  assertEquals(page.messages[0]!.id, 'fixture-1')
  assertEquals(page.nextCursor, null)
})

Deno.test('fixture backfill paginates within range and signals completion', async () => {
  const provider = new FixtureMailboxProvider()
  const page1 = await provider.listMessages({
    cursor: null,
    limit: 1,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-03T23:59:59.999Z'),
  })
  assertEquals(page1.messages.length, 1)
  assertEquals(page1.nextCursor, '1')

  const page2 = await provider.listMessages({
    cursor: page1.nextCursor,
    limit: 1,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-03T23:59:59.999Z'),
  })
  assertEquals(page2.messages.length, 1)
  assertEquals(page2.nextCursor, '2')

  const page3 = await provider.listMessages({
    cursor: page2.nextCursor,
    limit: 1,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-03T23:59:59.999Z'),
  })
  assertEquals(page3.messages.length, 1)
  assertEquals(page3.nextCursor, null)
})

Deno.test('resolvedStoredTextBody extracts HTML and prefers plain', () => {
  assertEquals(
    resolvedStoredTextBody('Plain total $12', '<b>HTML $99</b>'),
    'Plain total $12',
  )
  const fromHtml = resolvedStoredTextBody(
    null,
    '<p>Total <b>$12.50</b> MXN<br>tarjeta de d&eacute;bito</p>',
  )
  assertStringIncludes(fromHtml ?? '', 'Total $12.50 MXN')
  assertStringIncludes(fromHtml ?? '', 'tarjeta de débito')

  const htmlDup =
    '<!DOCTYPE html><html><body><p>Monto: $518.81</p></body></html>'
  assertStringIncludes(
    resolvedStoredTextBody(htmlDup, htmlDup) ?? '',
    'Monto: $518.81',
  )
})

Deno.test('messageForExtraction aligns source:text with stored/viewer body', () => {
  const htmlOnly: EmailMessage = {
    id: 'html-1',
    rfcMessageId: '<r@bank.example>',
    from: 'alerts@santander.com.mx',
    subject: 'Compra con tarjeta',
    receivedAt: new Date('2026-07-11T19:52:40.000Z'),
    textBody: null,
    htmlBody:
      '<p>Monto:<br>$358.01 MXN<br>Otro cargo $1,200.00<br>Comercio:<br>SAMS</p>',
  }

  const forExtract = messageForExtraction(htmlOnly)
  assertEquals(forExtract.textBody, resolvedStoredTextBody(null, htmlOnly.htmlBody))
  assertStringIncludes(forExtract.textBody ?? '', 'Monto:')
  assertStringIncludes(forExtract.textBody ?? '', '$358.01')
  // Provider HTML kept for source:"html_text"
  assertEquals(forExtract.htmlBody, htmlOnly.htmlBody)

  const template: SpendParsingTemplate = {
    id: 1,
    matchFromPattern: 'santander.com.mx',
    matchSubjectRegex: null,
    extractors: {
      amount: {
        source: 'text',
        regex: 'Monto:\\s*\\n*\\s*\\$([0-9,]+\\.[0-9]{2})',
        group: 1,
      },
      currency: {
        source: 'text',
        regex: 'Monto:\\s*\\n*\\s*\\$[0-9,]+\\.[0-9]{2}\\s*([A-Z]{3})',
        group: 1,
      },
      merchant: {
        source: 'text',
        regex: 'Comercio:\\s*\\n*\\s*(.+)',
        group: 1,
      },
    },
    enabled: true,
  }

  // Approve-only: no heuristic fallback when template misses.
  const arts = extractSpendingCandidates(forExtract, {
    rejectTemplates: [],
    approveTemplates: [template],
  })
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 35801)
  assertEquals(arts[0]!.payload.currency, 'MXN')
  assertEquals(arts[0]!.payload.templateId, 1)
  assertEquals(arts[0]!.payload.merchant, 'SAMS')
})

Deno.test('reject template short-circuits approve extraction on sync path', () => {
  const msg: EmailMessage = {
    id: '1',
    rfcMessageId: '<1@x>',
    from: 'noreply@amazon.com',
    subject: 'Your Amazon.com order receipt',
    receivedAt: new Date('2026-07-01T12:00:00.000Z'),
    textBody: 'Order total: $42.99 USD',
    htmlBody: null,
  }
  const approve: SpendParsingTemplate = {
    id: 10,
    matchFromPattern: 'amazon.com',
    matchSubjectRegex: 'receipt',
    extractors: {
      amount: {
        source: 'text',
        regex: 'Order total:\\s*\\$?([0-9.]+)',
        group: 1,
      },
      currency: { source: 'constant', value: 'USD' },
    },
    enabled: true,
  }
  const arts = extractSpendingCandidates(msg, {
    rejectTemplates: [{
      matchFromPattern: 'amazon.com',
      matchSubjectRegex: 'receipt',
      enabled: true,
    }],
    approveTemplates: [approve],
  })
  assertEquals(arts.length, 0)
})

Deno.test('messageNeedsAutoTemplate when no templates match', () => {
  const msg: EmailMessage = {
    id: '1',
    rfcMessageId: '<1@x>',
    from: 'a@shop.com',
    subject: 'Hello',
    receivedAt: new Date('2026-07-01T00:00:00.000Z'),
    textBody: 'Hi',
    htmlBody: null,
  }
  assertEquals(
    messageNeedsAutoTemplate(msg, {
      rejectTemplates: [],
      approveTemplates: [],
    }),
    true,
  )
  assertEquals(
    messageNeedsAutoTemplate(msg, {
      rejectTemplates: [{
        matchFromPattern: 'shop.com',
        matchSubjectRegex: null,
        enabled: true,
      }],
      approveTemplates: [],
    }),
    false,
  )
})

Deno.test('formatCursor truncates long values', () => {
  assertEquals(formatCursor(null), '(none)')
  assertEquals(formatCursor(''), '(none)')
  assertEquals(formatCursor('done:1700000000'), 'done:1700000000')
  const long = `page:${'x'.repeat(80)}`
  const formatted = formatCursor(long)
  assertEquals(formatted.endsWith('…'), true)
  assertEquals(formatted.length <= 49, true)
})

Deno.test('summarizeDroppedSenders lists unique non-matching Froms', () => {
  const summary = summarizeDroppedSenders(
    [
      { from: 'a@amazon.com' },
      { from: 'news@other.com' },
      { from: 'News <news@other.com>' },
      { from: 'promo@spam.com' },
    ],
    ['amazon.com'],
  )
  assertStringIncludes(summary, 'news@other.com')
  assertStringIncludes(summary, 'promo@spam.com')
  assertEquals(summary.includes('amazon.com'), false)
})

Deno.test('computeUncoveredFetchRanges returns full window when no coverage', () => {
  const since = new Date('2026-07-01T00:00:00.000Z')
  const until = new Date('2026-07-31T23:59:59.999Z')
  const gaps = computeUncoveredFetchRanges(since, until, undefined, undefined)
  assertEquals(gaps.length, 1)
  assertEquals(gaps[0]!.since, since)
  assertEquals(gaps[0]!.until, until)
})

Deno.test('computeUncoveredFetchRanges empty when fully covered', () => {
  const since = new Date('2026-07-01T00:00:00.000Z')
  const until = new Date('2026-07-31T23:59:59.999Z')
  const gaps = computeUncoveredFetchRanges(since, until, since, until)
  assertEquals(gaps.length, 0)
})

Deno.test('dbCoverageForGapWalk clears coverage in expansion mode', () => {
  const since = new Date('2026-07-01T00:00:00.000Z')
  const until = new Date('2026-07-31T23:59:59.999Z')
  const dbCov = { min: since, max: until }
  assertEquals(dbCoverageForGapWalk(false, dbCov), dbCov)
  assertEquals(dbCoverageForGapWalk(true, dbCov), {})
  const gaps = computeUncoveredFetchRanges(
    since,
    until,
    dbCoverageForGapWalk(true, dbCov).min,
    dbCoverageForGapWalk(true, dbCov).max,
  )
  assertEquals(gaps.length, 1)
  assertEquals(gaps[0]!.since, since)
  assertEquals(gaps[0]!.until, until)
})

Deno.test('expansion fromPatterns fetches only new domain; existing skipped by id', async () => {
  const provider = new FixtureMailboxProvider()
  // Simulate prior sync that already stored amazon; expansion fetches uber only.
  const page = await provider.listMessages({
    cursor: null,
    limit: 50,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-03T23:59:59.999Z'),
    fromPatterns: ['uber.com'],
  })
  assertEquals(page.messages.map((m) => m.id), ['fixture-2'])
  const alreadyStored = new Set(['<receipt-1@amazon.com>'])
  const toInsert = page.messages.filter(
    (m) => !alreadyStored.has(m.rfcMessageId),
  )
  assertEquals(toInsert.length, 1)
  assertEquals(toInsert[0]!.id, 'fixture-2')
})

Deno.test('computeUncoveredFetchRanges returns newer then older gaps', () => {
  const since = new Date('2026-07-01T00:00:00.000Z')
  const until = new Date('2026-07-31T23:59:59.999Z')
  const coveredMin = new Date('2026-07-10T00:00:00.000Z')
  const coveredMax = new Date('2026-07-20T00:00:00.000Z')
  const gaps = computeUncoveredFetchRanges(
    since,
    until,
    coveredMin,
    coveredMax,
  )
  assertEquals(gaps.length, 2)
  // Newest gap first
  assertEquals(gaps[0]!.since!.getTime(), coveredMax.getTime() + 1)
  assertEquals(gaps[0]!.until, until)
  assertEquals(gaps[1]!.since, since)
  assertEquals(gaps[1]!.until!.getTime(), coveredMin.getTime() - 1)
})

Deno.test('computeUncoveredFetchRanges supports open-ended bounds', () => {
  const coveredMin = new Date('2026-07-10T00:00:00.000Z')
  const coveredMax = new Date('2026-07-20T00:00:00.000Z')
  const sinceOnly = computeUncoveredFetchRanges(
    new Date('2026-07-01T00:00:00.000Z'),
    undefined,
    coveredMin,
    coveredMax,
  )
  assertEquals(sinceOnly.length, 2)
  assertEquals(sinceOnly[0]!.until, undefined)
  assertEquals(sinceOnly[1]!.since!.toISOString(), '2026-07-01T00:00:00.000Z')

  const untilOnly = computeUncoveredFetchRanges(
    undefined,
    new Date('2026-07-31T00:00:00.000Z'),
    coveredMin,
    coveredMax,
  )
  assertEquals(untilOnly.length, 2)
  assertEquals(untilOnly[0]!.until!.toISOString(), '2026-07-31T00:00:00.000Z')
  assertEquals(untilOnly[1]!.since, undefined)
})

Deno.test('mergeCoverage combines DB and soft spans', () => {
  const merged = mergeCoverage(
    new Date('2026-07-10T00:00:00.000Z'),
    new Date('2026-07-20T00:00:00.000Z'),
    new Date('2026-07-01T00:00:00.000Z'),
    new Date('2026-07-31T00:00:00.000Z'),
  )
  assertEquals(merged.min!.toISOString(), '2026-07-01T00:00:00.000Z')
  assertEquals(merged.max!.toISOString(), '2026-07-31T00:00:00.000Z')
})

Deno.test('backfill cursor soft + page round-trips', () => {
  const encoded = serializeBackfillCursorState({
    softMinMs: 1000,
    softMaxMs: 2000,
    pageToken: 'page:abc',
  })
  assertEquals(encoded, 'c:1000:2000:page:abc')
  assertEquals(parseBackfillCursorState(encoded), {
    softMinMs: 1000,
    softMaxMs: 2000,
    pageToken: 'page:abc',
  })
  // Legacy provider cursor passthrough
  assertEquals(parseBackfillCursorState('page:xyz'), {
    softMinMs: null,
    softMaxMs: null,
    pageToken: 'page:xyz',
  })
  assertEquals(
    serializeBackfillCursorState({
      softMinMs: null,
      softMaxMs: null,
      pageToken: '1',
    }),
    '1',
  )
})

Deno.test('extendSoftCoverageForGap marks empty edge done', () => {
  const gap = {
    since: new Date('2026-07-20T00:00:00.001Z'),
    until: new Date('2026-07-31T23:59:59.999Z'),
  }
  const next = extendSoftCoverageForGap(
    { softMinMs: null, softMaxMs: null, pageToken: 'page:x' },
    gap,
  )
  assertEquals(next.pageToken, null)
  assertEquals(next.softMinMs, gap.since.getTime())
  assertEquals(next.softMaxMs, gap.until.getTime())
})

Deno.test('selectMessagesNeedingAutoTemplate picks unmatched only', () => {
  const rows = [
    {
      id: 1,
      provider_message_id: 'p1',
      rfc_message_id: '<1@x>',
      from_address: 'a@shop.com',
      subject: 'Receipt',
      received_at: '2026-07-02T00:00:00.000Z',
      text_body: 'hi',
      html_body: null,
    },
    {
      id: 2,
      provider_message_id: 'p2',
      rfc_message_id: '<2@x>',
      from_address: 'b@other.com',
      subject: 'Hello',
      received_at: '2026-07-01T00:00:00.000Z',
      text_body: 'yo',
      html_body: null,
    },
  ]
  const needing = selectMessagesNeedingAutoTemplate(
    rows,
    {
      rejectTemplates: [],
      approveTemplates: [{
        id: 1,
        matchFromPattern: 'shop.com',
        matchSubjectRegex: null,
        extractors: {
          amount: {
            source: 'text',
            regex: '\\$([0-9.]+)',
            group: 1,
          },
          currency: { source: 'constant', value: 'USD' },
        },
        enabled: true,
      }],
    },
    50,
  )
  assertEquals(needing.length, 1)
  assertEquals(needing[0]!.id, 2)
})
