import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { AiProvider, CompletionResult } from 'ai_kit/mod.ts'
import { classifyEmailSpendRelevanceUseCase } from './classify_email_spend_relevance.ts'
import { UseCaseInputError } from './types.ts'

const sampleInput = {
  from: 'Santander <alertas@santander.com.mx>',
  subject: 'Compra con tu tarjeta',
  textBody: 'Realizaste una compra por $250.00 MXN en AMAZON.',
}

Deno.test('classify_email_spend_relevance parseInput requires body', () => {
  assertThrows(
    () =>
      classifyEmailSpendRelevanceUseCase.parseInput({
        from: 'a@b.com',
        subject: 'x',
      }),
    UseCaseInputError,
  )
  assertEquals(
    classifyEmailSpendRelevanceUseCase.parseInput(sampleInput).from,
    'Santander <alertas@santander.com.mx>',
  )
})

Deno.test('classify_email_spend_relevance run parses useful=true', async () => {
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: () =>
      Promise.resolve({
        text: JSON.stringify({
          useful: true,
          reason: 'Card purchase receipt with amount',
        }),
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await classifyEmailSpendRelevanceUseCase.run(
    sampleInput,
    provider,
  )
  assertEquals(out.useful, true)
  assertEquals(out.reason, 'Card purchase receipt with amount')
})

Deno.test('classify_email_spend_relevance run parses useful=false', async () => {
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: () =>
      Promise.resolve({
        text: JSON.stringify({
          useful: false,
          reason: 'Marketing promotion',
        }),
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await classifyEmailSpendRelevanceUseCase.run(
    {
      from: 'promos@bank.com',
      subject: 'Oferta exclusiva',
      textBody: 'Aprovecha 20% de descuento',
    },
    provider,
  )
  assertEquals(out.useful, false)
  assertEquals(out.reason, 'Marketing promotion')
})
