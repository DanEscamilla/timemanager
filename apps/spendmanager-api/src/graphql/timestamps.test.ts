import { asIsoTimestamp } from './timestamps.ts'

Deno.test('asIsoTimestamp converts Date to ISO', () => {
  const iso = asIsoTimestamp(new Date('2026-07-20T12:00:00.000Z'))
  if (iso !== '2026-07-20T12:00:00.000Z') {
    throw new Error(`expected ISO, got ${iso}`)
  }
})

Deno.test('asIsoTimestamp converts millis digit strings to ISO', () => {
  const iso = asIsoTimestamp('1784612431777')
  if (iso !== new Date(1784612431777).toISOString()) {
    throw new Error(`expected millis→ISO, got ${iso}`)
  }
})

Deno.test('asIsoTimestamp leaves ISO strings unchanged', () => {
  const input = '2026-07-20T12:00:00.000Z'
  if (asIsoTimestamp(input) !== input) {
    throw new Error('ISO string should pass through')
  }
})
