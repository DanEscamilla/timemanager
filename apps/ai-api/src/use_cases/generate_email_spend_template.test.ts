import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { AiProvider, CompletionResult } from 'ai_kit/mod.ts'
import { generateEmailSpendTemplateUseCase } from './generate_email_spend_template.ts'
import { UseCaseInputError } from './types.ts'

const sampleInput = {
  from: 'Amazon <noreply@amazon.com>',
  subject: 'Your Amazon.com order receipt',
  textBody: 'Order total: $42.99 USD\nDate: 2026-07-01\n',
}

Deno.test('generate_email_spend_template parseInput requires body', () => {
  assertThrows(
    () =>
      generateEmailSpendTemplateUseCase.parseInput({
        from: 'a@b.com',
        subject: 'x',
      }),
    UseCaseInputError,
  )
  assertEquals(
    generateEmailSpendTemplateUseCase.parseInput(sampleInput).from,
    'Amazon <noreply@amazon.com>',
  )
})

Deno.test('generate_email_spend_template run parses model JSON', async () => {
  const provider: AiProvider = {
    name: 'fake',
    complete: () =>
      Promise.resolve({
        text: JSON.stringify({
          matchFromPattern: 'amazon.com',
          matchSubjectRegex: 'receipt',
          nameSuggestion: 'Amazon receipts',
          extractors: {
            amount: {
              source: 'text',
              regex: 'Order total:\\s*\\$?([0-9.]+)',
              group: 1,
            },
            currency: { source: 'constant', value: 'USD' },
            spentOn: null,
            merchant: { source: 'from_domain' },
            note: null,
          },
        }),
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await generateEmailSpendTemplateUseCase.run(sampleInput, provider)
  assertEquals(out.matchFromPattern, 'amazon.com')
  assertEquals(out.nameSuggestion, 'Amazon receipts')
  assertEquals(
    (out.extractors.amount as { source: string }).source,
    'text',
  )
})
