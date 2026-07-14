import { InvalidActivityScheduleError } from './validation.ts'

/** Minutes before activity start; 0 = at start. Max lookback = 7 days. */
export const MAX_NOTIFICATION_OFFSET_MINUTES = 10080
export const MAX_NOTIFICATION_OFFSETS = 8

/**
 * Normalizes reminder offsets: coerce to ints, reject out-of-range,
 * dedupe, sort ascending. Empty/null → [].
 */
export function normalizeNotificationOffsets(
  offsets: number[] | null | undefined,
): number[] {
  if (offsets == null) return []

  if (offsets.length > MAX_NOTIFICATION_OFFSETS) {
    throw new InvalidActivityScheduleError(
      `notificationOffsets must have at most ${MAX_NOTIFICATION_OFFSETS} values`,
    )
  }

  const seen = new Set<number>()
  const result: number[] = []

  for (const raw of offsets) {
    if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new InvalidActivityScheduleError(
        'notificationOffsets must be integers',
      )
    }
    if (raw < 0 || raw > MAX_NOTIFICATION_OFFSET_MINUTES) {
      throw new InvalidActivityScheduleError(
        `notificationOffsets must be between 0 and ${MAX_NOTIFICATION_OFFSET_MINUTES}`,
      )
    }
    if (seen.has(raw)) continue
    seen.add(raw)
    result.push(raw)
  }

  result.sort((a, b) => a - b)
  return result
}
