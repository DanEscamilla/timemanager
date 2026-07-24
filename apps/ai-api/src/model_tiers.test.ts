import { assertEquals } from 'jsr:@std/assert@1'
import { resolveModelForTier } from './model_tiers.ts'

Deno.test('resolveModelForTier prefers AI_MODEL_LOW', () => {
  assertEquals(
    resolveModelForTier('low', {
      AI_MODEL_LOW: 'flash-lite',
      AI_MODEL_HIGH: 'pro',
      GEMINI_MODEL: 'legacy',
    }),
    'flash-lite',
  )
})

Deno.test('resolveModelForTier prefers AI_MODEL_HIGH', () => {
  assertEquals(
    resolveModelForTier('high', {
      AI_MODEL_LOW: 'flash-lite',
      AI_MODEL_HIGH: 'pro',
      GEMINI_MODEL: 'legacy',
    }),
    'pro',
  )
})

Deno.test('resolveModelForTier falls back to GEMINI_MODEL for gemini', () => {
  assertEquals(
    resolveModelForTier('low', {
      AI_PROVIDER: 'gemini',
      GEMINI_MODEL: 'gemini-2.0-flash',
    }),
    'gemini-2.0-flash',
  )
  assertEquals(
    resolveModelForTier('high', {
      GEMINI_MODEL: 'gemini-2.0-flash',
    }),
    'gemini-2.0-flash',
  )
})

Deno.test('resolveModelForTier falls back to AI_MODEL for openai_compatible', () => {
  assertEquals(
    resolveModelForTier('high', {
      AI_PROVIDER: 'openai_compatible',
      AI_MODEL: 'llama3.2',
      GEMINI_MODEL: 'ignored',
    }),
    'llama3.2',
  )
})

Deno.test('resolveModelForTier trims whitespace', () => {
  assertEquals(
    resolveModelForTier('low', { AI_MODEL_LOW: '  flash  ' }),
    'flash',
  )
})

Deno.test('resolveModelForTier returns undefined when nothing set', () => {
  assertEquals(resolveModelForTier('low', {}), undefined)
  assertEquals(
    resolveModelForTier('high', { AI_PROVIDER: 'openai_compatible' }),
    undefined,
  )
})

Deno.test('resolveModelForTier ignores blank tier env and uses legacy', () => {
  assertEquals(
    resolveModelForTier('low', {
      AI_MODEL_LOW: '   ',
      GEMINI_MODEL: 'gemini-2.0-flash',
    }),
    'gemini-2.0-flash',
  )
})
