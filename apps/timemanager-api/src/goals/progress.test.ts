import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import { shouldCloseCycleOnTarget } from './progress.ts'

Deno.test('shouldCloseCycleOnTarget is true for one-time goals', () => {
  assertEquals(shouldCloseCycleOnTarget({ recurrence: null }), true)
})

Deno.test('shouldCloseCycleOnTarget is false for recurring goals', () => {
  assertEquals(
    shouldCloseCycleOnTarget({
      recurrence: { period: 'weekly', interval: 1, carry_over: 'none' },
    }),
    false,
  )
})
