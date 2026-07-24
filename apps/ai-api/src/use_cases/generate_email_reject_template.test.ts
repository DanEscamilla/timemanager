import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { AiProvider, CompletionResult } from 'ai_kit/mod.ts'
import { generateEmailRejectTemplateUseCase } from './generate_email_reject_template.ts'
import { UseCaseInputError } from './types.ts'

const sampleInput = {
  from: 'Santander <promos@santander.com.mx>',
  subject: 'Aprovecha esta oferta exclusiva',
  textBody: 'Ofertas de la semana… no es un cargo.',
}

Deno.test('generate_email_reject_template parseInput requires body', () => {
  assertThrows(
    () =>
      generateEmailRejectTemplateUseCase.parseInput({
        from: 'a@b.com',
        subject: 'x',
      }),
    UseCaseInputError,
  )
  assertEquals(
    generateEmailRejectTemplateUseCase.parseInput(sampleInput).from,
    'Santander <promos@santander.com.mx>',
  )
})

Deno.test('generate_email_reject_template run parses model JSON', async () => {
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: () =>
      Promise.resolve({
        text: JSON.stringify({
          matchFromPattern: 'santander.com.mx',
          matchSubjectRegex: 'oferta|promoci[oó]n',
          nameSuggestion: 'Santander marketing',
        }),
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await generateEmailRejectTemplateUseCase.run(
    sampleInput,
    provider,
  )
  assertEquals(out.matchFromPattern, 'santander.com.mx')
  assertEquals(out.matchSubjectRegex, 'oferta|promoci[oó]n')
  assertEquals(out.nameSuggestion, 'Santander marketing')
})

Deno.test('generate_email_reject_template ignores extractors in output', async () => {
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: () =>
      Promise.resolve({
        text: JSON.stringify({
          matchFromPattern: 'x.com',
          matchSubjectRegex: null,
          nameSuggestion: 'X',
          extractors: { amount: { source: 'text', regex: '(\\d+)', group: 1 } },
        }),
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await generateEmailRejectTemplateUseCase.run(
    sampleInput,
    provider,
  )
  assertEquals(out.matchFromPattern, 'x.com')
  assertEquals(out.nameSuggestion, 'X')
})
