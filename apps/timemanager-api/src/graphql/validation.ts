import { RecurrenceConfig, RecurrencePatternInput } from './types.ts'
import { isAllowedGroupColor, normalizeGroupColor } from './group_palette.ts'

export class InvalidActivityScheduleError extends Error {}
export class InvalidGroupError extends Error {}

interface ActivitySchedule {
  isRecurring: boolean
  date?: string | null
  recurrencePattern?: RecurrencePatternInput | null
}

/**
 * Validates that an activity's schedule is internally consistent:
 * - Non-recurring activities must have a `date` and no recurrence pattern.
 * - Recurring activities must have a recurrence pattern (and no `date`),
 *   with config fields matching the chosen recurrence type.
 */
export function validateActivitySchedule(input: ActivitySchedule): void {
  if (!input.isRecurring) {
    if (!input.date) {
      throw new InvalidActivityScheduleError(
        'date is required when isRecurring is false',
      )
    }
    return
  }

  if (!input.recurrencePattern) {
    throw new InvalidActivityScheduleError(
      'recurrencePattern is required when isRecurring is true',
    )
  }

  const { recurrenceType, config } = input.recurrencePattern
  if (!config || !config.start_date) {
    throw new InvalidActivityScheduleError(
      'recurrencePattern.config.start_date is required',
    )
  }

  switch (recurrenceType) {
    case 'weekly':
      validateDaysOfWeek(config.days_of_week)
      break
    case 'monthly':
      validateDaysOfMonth(config.days_of_month, config.is_last_day_of_month)
      break
    case 'every_x_days':
      validateIntervalDays(config.interval_days)
      break
    default:
      throw new InvalidActivityScheduleError(
        `Unsupported recurrenceType: ${recurrenceType}`,
      )
  }
}

/**
 * Validates a group color against the shared hex allowlist.
 * Returns the canonical palette value (e.g. `#0F766E`).
 */
export function validateGroupColor(color: string): string {
  if (!isAllowedGroupColor(color)) {
    throw new InvalidGroupError(
      'color must be a hex value from the group palette (e.g. #0F766E)',
    )
  }
  return normalizeGroupColor(color)
}

/**
 * Validates group name is non-empty after trim.
 */
export function validateGroupName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) {
    throw new InvalidGroupError('name is required')
  }
  if (trimmed.length > 255) {
    throw new InvalidGroupError('name must be at most 255 characters')
  }
  return trimmed
}

function validateDaysOfWeek(daysOfWeek: RecurrenceConfig['days_of_week']): void {
  if (!daysOfWeek || daysOfWeek.length === 0) {
    throw new InvalidActivityScheduleError(
      'config.days_of_week is required for weekly recurrence',
    )
  }
  if (daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InvalidActivityScheduleError(
      'config.days_of_week must contain integers between 0 (Sunday) and 6 (Saturday)',
    )
  }
}

function validateDaysOfMonth(
  daysOfMonth: RecurrenceConfig['days_of_month'],
  isLastDayOfMonth: RecurrenceConfig['is_last_day_of_month'],
): void {
  const hasDaysOfMonth = !!daysOfMonth && daysOfMonth.length > 0
  if (!hasDaysOfMonth && !isLastDayOfMonth) {
    throw new InvalidActivityScheduleError(
      'config.days_of_month or config.is_last_day_of_month is required for monthly recurrence',
    )
  }
  if (
    hasDaysOfMonth &&
    daysOfMonth!.some((day) => !Number.isInteger(day) || day < 1 || day > 31)
  ) {
    throw new InvalidActivityScheduleError(
      'config.days_of_month must contain integers between 1 and 31',
    )
  }
}

function validateIntervalDays(intervalDays: RecurrenceConfig['interval_days']): void {
  if (
    intervalDays === undefined ||
    intervalDays === null ||
    !Number.isInteger(intervalDays) ||
    intervalDays < 1
  ) {
    throw new InvalidActivityScheduleError(
      'config.interval_days must be an integer >= 1 for every_x_days recurrence',
    )
  }
}
