import {
  addInterval,
  addMonthsUtc,
  currentPeriod,
} from './period.ts'

Deno.test('addMonthsUtc clamps end-of-month', () => {
  const jan31 = new Date('2024-01-31T00:00:00Z')
  const feb = addMonthsUtc(jan31, 1)
  if (feb.toISOString().slice(0, 10) !== '2024-02-29') {
    throw new Error(`expected 2024-02-29, got ${feb.toISOString()}`)
  }
  const mar = addMonthsUtc(jan31, 2)
  if (mar.toISOString().slice(0, 10) !== '2024-03-31') {
    throw new Error(`expected 2024-03-31, got ${mar.toISOString()}`)
  }
})

Deno.test('addInterval day/week/month', () => {
  if (addInterval('2024-01-15', 'day', 10) !== '2024-01-25') {
    throw new Error('day interval')
  }
  if (addInterval('2024-01-15', 'week', 2) !== '2024-01-29') {
    throw new Error('week interval')
  }
  if (addInterval('2024-01-15', 'month', 1) !== '2024-02-15') {
    throw new Error('month interval')
  }
})

Deno.test('currentPeriod returns null before anchor', () => {
  const period = currentPeriod({
    anchorDate: '2024-01-15',
    intervalUnit: 'month',
    intervalCount: 1,
    asOf: '2024-01-14',
  })
  if (period !== null) throw new Error('expected null before anchor')
})

Deno.test('currentPeriod rolling months from mid-month anchor', () => {
  const p0 = currentPeriod({
    anchorDate: '2024-01-15',
    intervalUnit: 'month',
    intervalCount: 1,
    asOf: '2024-01-20',
  })
  if (!p0 || p0.start !== '2024-01-15' || p0.endExclusive !== '2024-02-15') {
    throw new Error(`unexpected p0: ${JSON.stringify(p0)}`)
  }

  const p1 = currentPeriod({
    anchorDate: '2024-01-15',
    intervalUnit: 'month',
    intervalCount: 1,
    asOf: '2024-02-15',
  })
  if (!p1 || p1.start !== '2024-02-15' || p1.endExclusive !== '2024-03-15') {
    throw new Error(`unexpected p1: ${JSON.stringify(p1)}`)
  }
})

Deno.test('currentPeriod rolling days', () => {
  const period = currentPeriod({
    anchorDate: '2024-01-01',
    intervalUnit: 'day',
    intervalCount: 7,
    asOf: '2024-01-10',
  })
  // periods: [1-8), [8-15) → asOf day 10 is in [8-15)
  if (!period || period.start !== '2024-01-08' || period.endExclusive !== '2024-01-15') {
    throw new Error(`unexpected: ${JSON.stringify(period)}`)
  }
})

Deno.test('currentPeriod rolling weeks', () => {
  const period = currentPeriod({
    anchorDate: '2024-01-01',
    intervalUnit: 'week',
    intervalCount: 1,
    asOf: '2024-01-10',
  })
  // [Jan1-8), [Jan8-15)
  if (!period || period.start !== '2024-01-08' || period.endExclusive !== '2024-01-15') {
    throw new Error(`unexpected: ${JSON.stringify(period)}`)
  }
})
