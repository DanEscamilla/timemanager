import { assertEquals } from 'jsr:@std/assert@1'
import type { EmailMessage, SpendParsingTemplate } from '../types.ts'
import {
  TemplateSpendingExtractor,
  parseSpendTemplateExtractors,
} from './template_spending_extractor.ts'

const amazonMsg: EmailMessage = {
  id: '1',
  rfcMessageId: '<r@amazon.com>',
  from: 'Amazon <noreply@amazon.com>',
  subject: 'Your Amazon.com order receipt',
  receivedAt: new Date('2026-07-01T14:00:00.000Z'),
  textBody: 'Thanks for your purchase.\nOrder total: $42.99 USD\nDate: 2026-07-01\n',
  htmlBody: null,
}

function amazonTemplate(
  overrides?: Partial<SpendParsingTemplate>,
): SpendParsingTemplate {
  return {
    id: 7,
    matchFromPattern: 'amazon.com',
    matchSubjectRegex: 'receipt',
    extractors: {
      amount: {
        source: 'text',
        regex: 'Order total:\\s*\\$?([0-9]+\\.[0-9]{2})',
        group: 1,
      },
      currency: { source: 'constant', value: 'USD' },
      spentOn: {
        source: 'text',
        regex: 'Date:\\s*(20\\d{2}-\\d{2}-\\d{2})',
        group: 1,
      },
      merchant: { source: 'from_domain' },
      note: { source: 'subject', regex: '^(.*)$', group: 1 },
    },
    enabled: true,
    ...overrides,
  }
}

Deno.test('TemplateSpendingExtractor extracts from matching email', () => {
  const ext = new TemplateSpendingExtractor(amazonTemplate())
  assertEquals(ext.canHandle(amazonMsg), true)
  const arts = ext.extract(amazonMsg)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 4299)
  assertEquals(arts[0]!.payload.currency, 'USD')
  assertEquals(arts[0]!.payload.spentOn, '2026-07-01')
  assertEquals(arts[0]!.payload.merchant, 'Amazon')
  assertEquals(arts[0]!.payload.templateId, 7)
  assertEquals(arts[0]!.confidence, 0.9)
})

Deno.test('TemplateSpendingExtractor rejects non-matching from', () => {
  const ext = new TemplateSpendingExtractor(amazonTemplate())
  assertEquals(
    ext.canHandle({ ...amazonMsg, from: 'x@uber.com' }),
    false,
  )
})

Deno.test('TemplateSpendingExtractor rejects subject mismatch', () => {
  const ext = new TemplateSpendingExtractor(amazonTemplate())
  assertEquals(
    ext.canHandle({ ...amazonMsg, subject: 'Shipping update' }),
    false,
  )
})

Deno.test('TemplateSpendingExtractor source:text uses HTML when MIME plain missing', () => {
  const htmlOnly: EmailMessage = {
    ...amazonMsg,
    textBody: null,
    htmlBody:
      '<p>Thanks for your purchase.<br>Order total: $42.99 USD<br>Date: 2026-07-01</p>',
  }
  const ext = new TemplateSpendingExtractor(amazonTemplate())
  const arts = ext.extract(htmlOnly)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 4299)
})

Deno.test('TemplateSpendingExtractor source:text strips HTML duplicated into textBody', () => {
  const html =
    '<!DOCTYPE html><html><body><p>Order total: $18.50 USD<br>Date: 2026-07-02</p></body></html>'
  const dup: EmailMessage = {
    ...amazonMsg,
    textBody: html,
    htmlBody: html,
  }
  const ext = new TemplateSpendingExtractor(
    amazonTemplate({
      extractors: {
        amount: {
          source: 'text',
          regex: 'Order total:\\s*\\$?([0-9]+\\.[0-9]{2})',
          group: 1,
        },
        currency: { source: 'constant', value: 'USD' },
        spentOn: {
          source: 'text',
          regex: 'Date:\\s*(20\\d{2}-\\d{2}-\\d{2})',
          group: 1,
        },
        merchant: { source: 'from_domain' },
        note: null,
      },
    }),
  )
  const arts = ext.extract(dup)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 1850)
  assertEquals(arts[0]!.payload.spentOn, '2026-07-02')
})

Deno.test('parseSpendTemplateExtractors validates shape', () => {
  const parsed = parseSpendTemplateExtractors({
    amount: { source: 'text', regex: 'Total:\\s*(\\d+\\.\\d{2})', group: 1 },
    merchant: { source: 'from_domain' },
  })
  assertEquals(parsed?.amount.source, 'text')
  assertEquals(parsed?.merchant?.source, 'from_domain')
  assertEquals(parseSpendTemplateExtractors({}), null)
})

Deno.test('parseSpendTemplateExtractors accepts date parts and direction', () => {
  const parsed = parseSpendTemplateExtractors({
    amount: { source: 'text', regex: 'monto de \\$([0-9.]+)', group: 1 },
    spentOn: {
      source: 'text',
      regex: 'El\\s+(\\d{1,2})/(\\d{1,2})/(20\\d{2})',
      dayGroup: 1,
      monthGroup: 2,
      yearGroup: 3,
    },
    direction: {
      source: 'text',
      regex: '\\b(compra|abono|cargo)\\b',
      group: 1,
      inboundMatches: ['abono'],
      outboundMatches: ['compra', 'cargo'],
    },
  })
  assertEquals(parsed?.spentOn && 'yearGroup' in parsed.spentOn, true)
  assertEquals(parsed?.direction?.inboundMatches, ['abono'])
})

Deno.test('parseSpendTemplateExtractors rejects invalid direction', () => {
  assertEquals(
    parseSpendTemplateExtractors({
      amount: { source: 'text', regex: '(\\d+)', group: 1 },
      direction: {
        source: 'text',
        regex: '(compra)',
        group: 1,
        inboundMatches: [],
        outboundMatches: [],
      },
    }),
    null,
  )
})

const santanderCompra: EmailMessage = {
  id: 'compra-1',
  rfcMessageId: '<compra@santander.com.mx>',
  from: 'Santander <alertas@santander.com.mx>',
  subject: 'Compra con tu tarjeta',
  receivedAt: new Date('2026-07-12T00:00:00.000Z'),
  textBody:
    'Te informamos que se ha realizado una compra en el comercio SAMS ' +
    'por un monto de $358.01 MXN. El 11/07/2026 a las 19:52:40 hrs.',
  htmlBody: null,
}

const santanderSpei: EmailMessage = {
  id: 'spei-1',
  rfcMessageId: '<spei@santander.com.mx>',
  from: 'Santander <alertas@santander.com.mx>',
  subject: 'ABONO vía SPEI',
  receivedAt: new Date('2026-07-20T00:00:00.000Z'),
  textBody:
    'estimado cliente, recibiste vía SPEI un abono por $2,500.00 MXN. ' +
    'Fecha: 19/07/2026 Hora: 19:45 hrs',
  htmlBody: null,
}

function santanderTemplate(
  overrides?: Partial<SpendParsingTemplate>,
): SpendParsingTemplate {
  return {
    id: 42,
    matchFromPattern: 'santander.com.mx',
    matchSubjectRegex: null,
    extractors: {
      amount: {
        source: 'text',
        regex: '(?:monto de|abono por)\\s*\\$?([0-9,.]+)',
        group: 1,
      },
      currency: { source: 'constant', value: 'MXN' },
      spentOn: {
        source: 'text',
        regex: '(?:El\\s+|Fecha:\\s*)(\\d{1,2})/(\\d{1,2})/(20\\d{2})',
        dayGroup: 1,
        monthGroup: 2,
        yearGroup: 3,
      },
      merchant: { source: 'from_domain' },
      note: null,
      direction: {
        source: 'text',
        regex: '\\b(compra|abono|cargo|dep[oó]sito|recibiste)\\b',
        group: 1,
        inboundMatches: ['abono', 'depósito', 'deposito', 'recibiste'],
        outboundMatches: ['compra', 'cargo'],
      },
    },
    enabled: true,
    ...overrides,
  }
}

Deno.test('TemplateSpendingExtractor date parts compose DD/MM/YYYY', () => {
  const ext = new TemplateSpendingExtractor(santanderTemplate())
  const arts = ext.extract(santanderCompra)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 35801)
  assertEquals(arts[0]!.payload.spentOn, '2026-07-11')
  assertEquals(arts[0]!.payload.currency, 'MXN')
})

Deno.test('TemplateSpendingExtractor skips inbound money', () => {
  const ext = new TemplateSpendingExtractor(santanderTemplate())
  assertEquals(ext.canHandle(santanderSpei), true)
  assertEquals(ext.extract(santanderSpei), [])
})

Deno.test('TemplateSpendingExtractor extracts outbound with direction', () => {
  const ext = new TemplateSpendingExtractor(santanderTemplate())
  const arts = ext.extract(santanderCompra)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 35801)
})

Deno.test('TemplateSpendingExtractor missing direction still extracts', () => {
  const ext = new TemplateSpendingExtractor(
    santanderTemplate({
      extractors: {
        ...santanderTemplate().extractors,
        direction: null,
      },
    }),
  )
  const arts = ext.extract(santanderSpei)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 250000)
  assertEquals(arts[0]!.payload.spentOn, '2026-07-19')
})

Deno.test('TemplateSpendingExtractor invalid date parts fall back to receivedAt', () => {
  const ext = new TemplateSpendingExtractor(
    santanderTemplate({
      extractors: {
        ...santanderTemplate().extractors,
        spentOn: {
          source: 'text',
          regex: 'El\\s+(\\d{1,2})/(\\d{1,2})/(20\\d{2})',
          dayGroup: 1,
          monthGroup: 2,
          yearGroup: 3,
        },
        direction: null,
      },
    }),
  )
  const badDate: EmailMessage = {
    ...santanderCompra,
    textBody:
      'una compra por un monto de $10.00 MXN. El 31/02/2026 a las 12:00 hrs.',
    receivedAt: new Date('2026-03-01T00:00:00.000Z'),
  }
  const arts = ext.extract(badDate)
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.spentOn, '2026-03-01')
})
