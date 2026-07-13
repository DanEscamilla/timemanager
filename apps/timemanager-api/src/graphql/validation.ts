import { RecurrenceConfig, RecurrencePatternInput } from './types.ts'
import { isAllowedGroupColor, normalizeGroupColor } from './group_palette.ts'
import { GOAL_RULE_TYPES } from '../goals/evaluators/index.ts'
import type {
  CreateGoalInput,
  GoalDeadlineInput,
  GoalDependencyInput,
  GoalLinkInput,
  GoalRecurrenceInput,
  UpdateGoalInput,
} from './types.ts'

export class InvalidActivityScheduleError extends Error {}
export class InvalidGroupError extends Error {}
export class InvalidCompletionError extends Error {}
export class InvalidGoalError extends Error {}

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^\d{2}:\d{2}$/

export function validateOccurrenceDate(date: string): string {
  if (!DATE_RE.test(date)) {
    throw new InvalidCompletionError('occurrenceDate must be YYYY-MM-DD')
  }
  return date
}

export function validateDurationMinutes(value: number | null | undefined): number | null {
  if (value === undefined || value === null) return null
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new InvalidCompletionError('durationMinutes must be a non-negative integer')
  }
  return value
}

export function validatePositiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new InvalidCompletionError('durationMinutes must be a positive integer')
  }
  return value
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

export function validateGoalTitle(title: string): string {
  const trimmed = title.trim()
  if (!trimmed) throw new InvalidGoalError('title is required')
  if (trimmed.length > 255) throw new InvalidGoalError('title must be at most 255 characters')
  return trimmed
}

export function validateGoalColor(color: string): string {
  return validateGroupColor(color)
}

export function validateRuleType(ruleType: string): string {
  if (!GOAL_RULE_TYPES.includes(ruleType)) {
    throw new InvalidGoalError(
      `ruleType must be one of: ${GOAL_RULE_TYPES.join(', ')}`,
    )
  }
  return ruleType
}

export function validateTargetValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidGoalError('targetValue must be a positive number')
  }
  return value
}

export function validateGoalLinks(
  links: GoalLinkInput[] | undefined,
  ruleType: string,
): GoalLinkInput[] {
  const list = links ?? []
  if (ruleType === 'composite') {
    if (list.length > 0) {
      throw new InvalidGoalError('composite goals must not have activity/group links')
    }
    return []
  }
  if (list.length === 0) {
    throw new InvalidGoalError('at least one link is required')
  }
  for (const link of list) {
    if (link.linkType === 'activity') {
      if (link.activityId == null) {
        throw new InvalidGoalError('activity links require activityId')
      }
      if (link.groupId != null) {
        throw new InvalidGoalError('activity links must not set groupId')
      }
    } else if (link.linkType === 'group') {
      if (link.groupId == null) {
        throw new InvalidGoalError('group links require groupId')
      }
      if (link.activityId != null) {
        throw new InvalidGoalError('group links must not set activityId')
      }
    } else {
      throw new InvalidGoalError('linkType must be activity or group')
    }
    if (link.weight != null && (!Number.isFinite(link.weight) || link.weight <= 0)) {
      throw new InvalidGoalError('link weight must be a positive number')
    }
  }
  return list
}

export function validateGoalDependencies(
  deps: GoalDependencyInput[] | undefined,
  ruleType: string,
): GoalDependencyInput[] {
  const list = deps ?? []
  if (ruleType === 'composite' && list.length === 0) {
    throw new InvalidGoalError('composite goals require at least one dependency')
  }
  for (const dep of list) {
    if (!Number.isInteger(dep.dependsOnGoalId) || dep.dependsOnGoalId <= 0) {
      throw new InvalidGoalError('dependsOnGoalId must be a positive integer')
    }
    if (
      dep.requirement != null &&
      dep.requirement !== 'complete' &&
      dep.requirement !== 'progress'
    ) {
      throw new InvalidGoalError('requirement must be complete or progress')
    }
  }
  return list
}

export function validateGoalRecurrence(
  recurrence: GoalRecurrenceInput | null | undefined,
): GoalRecurrenceInput | null {
  if (recurrence == null) return null
  const periods = ['weekly', 'monthly', 'quarterly', 'every_x_days']
  if (!periods.includes(recurrence.period)) {
    throw new InvalidGoalError(`unsupported recurrence period: ${recurrence.period}`)
  }
  if (
    recurrence.interval != null &&
    (!Number.isInteger(recurrence.interval) || recurrence.interval < 1)
  ) {
    throw new InvalidGoalError('recurrence.interval must be an integer >= 1')
  }
  if (
    recurrence.carryOver != null &&
    recurrence.carryOver !== 'none' &&
    recurrence.carryOver !== 'overflow'
  ) {
    throw new InvalidGoalError('carryOver must be none or overflow')
  }
  return recurrence
}

export function validateGoalDeadline(
  deadline: GoalDeadlineInput | null | undefined,
): GoalDeadlineInput | null {
  if (deadline == null) return null
  if (deadline.kind === 'absolute') {
    if (!deadline.date || !DATE_RE.test(deadline.date)) {
      throw new InvalidGoalError('absolute deadline requires date YYYY-MM-DD')
    }
  } else if (deadline.kind === 'relative') {
    if (
      deadline.daysAfterCycleStart == null ||
      !Number.isInteger(deadline.daysAfterCycleStart) ||
      deadline.daysAfterCycleStart < 0
    ) {
      throw new InvalidGoalError(
        'relative deadline requires daysAfterCycleStart >= 0',
      )
    }
  } else {
    throw new InvalidGoalError('deadline.kind must be absolute or relative')
  }
  return deadline
}

const MAX_START_YEARS_AHEAD = 5

/** Parse and validate an optional ISO-8601 startsAt. Returns null if omitted. */
export function validateStartsAt(
  startsAt: string | null | undefined,
  now: Date = new Date(),
): Date | null {
  if (startsAt == null || startsAt === '') return null
  const parsed = new Date(startsAt)
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidGoalError('startsAt must be a valid ISO-8601 datetime')
  }
  const max = new Date(now)
  max.setUTCFullYear(max.getUTCFullYear() + MAX_START_YEARS_AHEAD)
  if (parsed > max) {
    throw new InvalidGoalError(
      `startsAt must be within ${MAX_START_YEARS_AHEAD} years from now`,
    )
  }
  return parsed
}

/** Reject absolute deadlines that end before the goal starts. */
export function assertDeadlineAfterStart(
  startsAt: Date,
  deadline: GoalDeadlineInput | null | undefined,
): void {
  if (!deadline || deadline.kind !== 'absolute' || !deadline.date) return
  const deadlineAt = new Date(deadline.date + 'T23:59:59.999Z')
  if (deadlineAt < startsAt) {
    throw new InvalidGoalError('deadline must be on or after the goal start')
  }
}

export function validateCreateGoalInput(
  input: CreateGoalInput,
  now: Date = new Date(),
) {
  const title = validateGoalTitle(input.title)
  const color = validateGoalColor(input.color)
  const ruleType = validateRuleType(input.ruleType)
  const targetValue = validateTargetValue(input.targetValue)
  if (input.metric !== 'count' && input.metric !== 'duration') {
    throw new InvalidGoalError('metric must be count or duration')
  }
  const links = validateGoalLinks(input.links, ruleType)
  const dependencies = validateGoalDependencies(input.dependencies, ruleType)
  const recurrence = validateGoalRecurrence(input.recurrence)
  const deadline = validateGoalDeadline(input.deadline)
  const startsAt = validateStartsAt(input.startsAt, now) ?? now
  assertDeadlineAfterStart(startsAt, deadline)

  if (input.config?.beforeTime && !TIME_RE.test(input.config.beforeTime)) {
    throw new InvalidGoalError('beforeTime must be HH:mm')
  }
  if (input.config?.afterTime && !TIME_RE.test(input.config.afterTime)) {
    throw new InvalidGoalError('afterTime must be HH:mm')
  }

  return {
    title,
    color,
    ruleType,
    targetValue,
    links,
    dependencies,
    recurrence,
    deadline,
    startsAt,
  }
}

export function validateUpdateGoalInput(
  input: UpdateGoalInput,
  existingRuleType: string,
  now: Date = new Date(),
) {
  const ruleType = input.ruleType != null
    ? validateRuleType(input.ruleType)
    : existingRuleType

  if (input.title != null) validateGoalTitle(input.title)
  if (input.color != null) validateGoalColor(input.color)
  if (input.targetValue != null) validateTargetValue(input.targetValue)
  if (input.metric != null && input.metric !== 'count' && input.metric !== 'duration') {
    throw new InvalidGoalError('metric must be count or duration')
  }
  if (input.status != null) {
    const allowed = ['active', 'paused', 'completed', 'archived', 'failed']
    if (!allowed.includes(input.status)) {
      throw new InvalidGoalError(`invalid status: ${input.status}`)
    }
  }

  const links = input.links !== undefined
    ? validateGoalLinks(input.links, ruleType)
    : undefined
  const dependencies = input.dependencies !== undefined
    ? validateGoalDependencies(input.dependencies, ruleType)
    : undefined
  const recurrence = input.recurrence !== undefined
    ? validateGoalRecurrence(input.recurrence)
    : undefined
  const deadline = input.deadline !== undefined
    ? validateGoalDeadline(input.deadline)
    : undefined
  const startsAt = input.startsAt !== undefined
    ? validateStartsAt(input.startsAt, now)
    : undefined

  return { ruleType, links, dependencies, recurrence, deadline, startsAt }
}

/**
 * Detects whether adding edges would create a cycle in the dependency DAG.
 * `edges` is the full adjacency list after the proposed change (goalId -> deps).
 */
export function wouldCreateDependencyCycle(
  edges: Map<number, number[]>,
  startId: number,
): boolean {
  const visiting = new Set<number>()
  const visited = new Set<number>()

  function dfs(node: number): boolean {
    if (visiting.has(node)) return true
    if (visited.has(node)) return false
    visiting.add(node)
    for (const next of edges.get(node) ?? []) {
      if (dfs(next)) return true
    }
    visiting.delete(node)
    visited.add(node)
    return false
  }

  return dfs(startId)
}
