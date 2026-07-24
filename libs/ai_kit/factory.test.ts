import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import { AiProviderError } from './errors.ts'
import { createAiProvider } from './factory.ts'

Deno.test('createAiProvider defaults to gemini', () => {
  const provider = createAiProvider({
    env: { GEMINI_API_KEY: 'secret' },
  })
  assertEquals(provider.name, 'gemini')
})

Deno.test('createAiProvider selects openai_compatible', () => {
  const provider = createAiProvider({
    env: {
      AI_PROVIDER: 'openai_compatible',
      AI_BASE_URL: 'http://localhost:11434/v1',
    },
  })
  assertEquals(provider.name, 'openai_compatible')
})

Deno.test('createAiProvider requires GEMINI_API_KEY', () => {
  assertThrows(
    () => createAiProvider({ env: { AI_PROVIDER: 'gemini' } }),
    AiProviderError,
  )
})

Deno.test('createAiProvider rejects unknown kind', () => {
  assertThrows(
    () => createAiProvider({ env: { AI_PROVIDER: 'bedrock' } }),
    AiProviderError,
  )
})
