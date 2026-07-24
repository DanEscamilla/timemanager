import { assertEquals } from 'jsr:@std/assert@1'
import { extractSpendingCandidates } from './template_extract.ts'
import type { EmailMessage, SpendParsingTemplate } from './types.ts'

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

Deno.test('extractSpendingCandidates extracts via approve template', () => {
  const arts = extractSpendingCandidates(msg, {
    rejectTemplates: [],
    approveTemplates: [approve],
  })
  assertEquals(arts.length, 1)
  assertEquals(arts[0]!.payload.amountCents, 4299)
  assertEquals(arts[0]!.payload.templateId, 10)
})

Deno.test('extractSpendingCandidates reject short-circuits before approve', () => {
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

Deno.test('extractSpendingCandidates returns empty without approve templates', () => {
  const arts = extractSpendingCandidates(msg, {
    rejectTemplates: [],
    approveTemplates: [],
  })
  assertEquals(arts.length, 0)
})
