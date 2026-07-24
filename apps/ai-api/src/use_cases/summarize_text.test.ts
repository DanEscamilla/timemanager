import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import type { AiProvider, CompletionResult } from 'ai_kit/mod.ts'
import { summarizeTextUseCase } from './summarize_text.ts'
import { UseCaseInputError } from './types.ts'

Deno.test('summarize_text exposes guided inputFields', () => {
  assertEquals(summarizeTextUseCase.inputFields[0]?.name, 'text')
  assertEquals(summarizeTextUseCase.inputFields[0]?.required, true)
  assertEquals(summarizeTextUseCase.inputFields[1]?.name, 'maxSentences')
  assertEquals(summarizeTextUseCase.inputFields[1]?.default, 2)
})

Deno.test('summarize_text parseInput accepts text + maxSentences', () => {
  assertEquals(
    summarizeTextUseCase.parseInput({ text: 'Hello', maxSentences: 2 }),
    { text: 'Hello', maxSentences: 2 },
  )
})

Deno.test('summarize_text parseInput rejects empty text', () => {
  assertThrows(
    () => summarizeTextUseCase.parseInput({ text: '   ' }),
    UseCaseInputError,
  )
})

Deno.test('summarize_text run uses provider completion', async () => {
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: () =>
      Promise.resolve({
        text: '  Done.  ',
        model: 'fake',
      } satisfies CompletionResult),
  }
  const out = await summarizeTextUseCase.run({ text: 'Article' }, provider)
  assertEquals(out, { summary: 'Done.' })
})

Deno.test('summarize_text run forwards model override', async () => {
  let seenModel: string | undefined
  const provider: AiProvider = {
    name: 'fake',
    listModels: () => Promise.resolve([]),
    complete: (req) => {
      seenModel = req.model
      return Promise.resolve({
        text: 'Done.',
        model: req.model ?? 'fake',
      } satisfies CompletionResult)
    },
  }
  await summarizeTextUseCase.run({ text: 'Article' }, provider, {
    model: 'custom-model',
  })
  assertEquals(seenModel, 'custom-model')
})
