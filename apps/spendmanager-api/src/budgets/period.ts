/** Rolling budget period helpers (anchor-based). */

export type IntervalUnit = 'day' | 'week' | 'month'

export interface PeriodWindow {
  /** Inclusive start date (YYYY-MM-DD). */
  start: string
  /** Exclusive end date (YYYY-MM-DD). */
  endExclusive: string
}

function parseDateOnly(value: string): Date {
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`invalid date: ${value}`)
  }
  return d
}

function formatDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function daysBetweenUtc(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

/** Add calendar months, clamping to the last day of the target month. */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const target = new Date(Date.UTC(year, month + months, 1))
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target
}

export function addInterval(
  dateOnly: string,
  unit: IntervalUnit,
  count: number,
): string {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('interval count must be a positive integer')
  }
  const d = parseDateOnly(dateOnly)
  if (unit === 'day') {
    d.setUTCDate(d.getUTCDate() + count)
    return formatDateOnly(d)
  }
  if (unit === 'week') {
    d.setUTCDate(d.getUTCDate() + count * 7)
    return formatDateOnly(d)
  }
  return formatDateOnly(addMonthsUtc(d, count))
}

/**
 * Returns the rolling period containing [asOf], or null when [asOf] is before
 * the anchor (no spend counted before the budget starts).
 */
export function currentPeriod(args: {
  anchorDate: string
  intervalUnit: IntervalUnit
  intervalCount: number
  asOf: string
}): PeriodWindow | null {
  const { anchorDate, intervalUnit, intervalCount, asOf } = args
  if (asOf < anchorDate) return null

  if (intervalUnit === 'day' || intervalUnit === 'week') {
    const periodDays =
      intervalUnit === 'day' ? intervalCount : intervalCount * 7
    const anchor = parseDateOnly(anchorDate)
    const asOfDate = parseDateOnly(asOf)
    const elapsed = daysBetweenUtc(anchor, asOfDate)
    const index = Math.floor(elapsed / periodDays)
    const startDate = new Date(anchor)
    startDate.setUTCDate(startDate.getUTCDate() + index * periodDays)
    const endDate = new Date(startDate)
    endDate.setUTCDate(endDate.getUTCDate() + periodDays)
    return {
      start: formatDateOnly(startDate),
      endExclusive: formatDateOnly(endDate),
    }
  }

  // Months: walk forward from anchor until asOf falls in [start, end).
  let start = anchorDate
  let endExclusive = addInterval(start, 'month', intervalCount)
  // Cap iterations for safety (e.g. ~100 years of monthly periods).
  for (let i = 0; i < 2000; i++) {
    if (asOf >= start && asOf < endExclusive) {
      return { start, endExclusive }
    }
    start = endExclusive
    endExclusive = addInterval(start, 'month', intervalCount)
  }
  throw new Error('failed to resolve monthly period')
}
