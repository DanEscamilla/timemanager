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

Deno.test('parseSpendTemplateExtractors validates shape', () => {
  const parsed = parseSpendTemplateExtractors({
    amount: { source: 'text', regex: 'Total:\\s*(\\d+\\.\\d{2})', group: 1 },
    merchant: { source: 'from_domain' },
  })
  assertEquals(parsed?.amount.source, 'text')
  assertEquals(parsed?.merchant?.source, 'from_domain')
  assertEquals(parseSpendTemplateExtractors({}), null)
})
