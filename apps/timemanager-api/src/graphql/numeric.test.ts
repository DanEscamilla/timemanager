import { assertEquals } from 'jsr:@std/assert@1'
import { asNumber, asNumberOrNull } from './numeric.ts'

Deno.test('asNumber coerces Postgres numeric strings to JS numbers', () => {
  assertEquals(asNumber('1'), 1)
  assertEquals(asNumber('10.5'), 10.5)
  assertEquals(asNumber(3), 3)
  assertEquals(typeof asNumber('1'), 'number')
})

Deno.test('asNumber falls back for non-finite values', () => {
  assertEquals(asNumber('nope'), 0)
  assertEquals(asNumber(undefined), 0)
  assertEquals(asNumber(null, 7), 7)
})

Deno.test('asNumberOrNull preserves null', () => {
  assertEquals(asNumberOrNull(null), null)
  assertEquals(asNumberOrNull(undefined), null)
  assertEquals(asNumberOrNull('2.5'), 2.5)
})
