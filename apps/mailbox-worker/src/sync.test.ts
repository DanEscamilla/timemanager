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
  messageForExtraction,
  messageNeedsAutoTemplate,
  missingDomainFiltersError,
  resolvedStoredTextBody,
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
