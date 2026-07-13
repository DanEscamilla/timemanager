import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.0'
import {
  InvalidActivityScheduleError,
  InvalidGoalError,
  InvalidGroupError,
  validateActivitySchedule,
  validateCreateGoalInput,
  validateGroupColor,
  validateGroupName,
  wouldCreateDependencyCycle,
} from './validation.ts'

Deno.test('non-recurring activity requires a date', () => {
  assertThrows(
    () => validateActivitySchedule({ isRecurring: false, date: null }),
    InvalidActivityScheduleError,
    'date is required',
  )
})

Deno.test('non-recurring activity with a date is valid', () => {
  assertEquals(
    validateActivitySchedule({ isRecurring: false, date: '2026-07-20' }),
    undefined,
  )
})

Deno.test('recurring activity requires a recurrence pattern', () => {
  assertThrows(
    () => validateActivitySchedule({ isRecurring: true, recurrencePattern: null }),
    InvalidActivityScheduleError,
    'recurrencePattern is required',
  )
})

Deno.test('weekly recurrence requires days_of_week', () => {
  assertThrows(
    () =>
      validateActivitySchedule({
        isRecurring: true,
        recurrencePattern: {
          recurrenceType: 'weekly',
          config: { start_date: '2026-07-20', days_of_week: [] },
        },
      }),
    InvalidActivityScheduleError,
    'days_of_week is required',
  )
})

Deno.test('weekly recurrence rejects out-of-range days', () => {
  assertThrows(
    () =>
      validateActivitySchedule({
        isRecurring: true,
        recurrencePattern: {
          recurrenceType: 'weekly',
          config: { start_date: '2026-07-20', days_of_week: [1, 7] },
        },
      }),
    InvalidActivityScheduleError,
    'between 0',
  )
})

Deno.test('weekly recurrence with valid days_of_week is valid', () => {
  assertEquals(
    validateActivitySchedule({
      isRecurring: true,
      recurrencePattern: {
        recurrenceType: 'weekly',
        config: { start_date: '2026-07-20', days_of_week: [1, 3, 5] },
      },
    }),
    undefined,
  )
})

Deno.test('monthly recurrence rejects an out-of-range day', () => {
  assertThrows(
    () =>
      validateActivitySchedule({
        isRecurring: true,
        recurrencePattern: {
          recurrenceType: 'monthly',
          config: { start_date: '2026-07-20', days_of_month: [32] },
        },
      }),
    InvalidActivityScheduleError,
    'between 1 and 31',
  )
})

Deno.test('monthly recurrence requires days_of_month or is_last_day_of_month', () => {
  assertThrows(
    () =>
      validateActivitySchedule({
        isRecurring: true,
        recurrencePattern: {
          recurrenceType: 'monthly',
          config: { start_date: '2026-07-20' },
        },
      }),
    InvalidActivityScheduleError,
    'is_last_day_of_month is required',
  )
})

Deno.test('monthly recurrence accepts is_last_day_of_month with no days_of_month', () => {
  assertEquals(
    validateActivitySchedule({
      isRecurring: true,
      recurrencePattern: {
        recurrenceType: 'monthly',
        config: { start_date: '2026-07-20', is_last_day_of_month: true },
      },
    }),
    undefined,
  )
})

Deno.test('monthly recurrence accepts days_of_month combined with is_last_day_of_month', () => {
  assertEquals(
    validateActivitySchedule({
      isRecurring: true,
      recurrencePattern: {
        recurrenceType: 'monthly',
        config: { start_date: '2026-07-20', days_of_month: [1, 15], is_last_day_of_month: true },
      },
    }),
    undefined,
  )
})

Deno.test('every_x_days rejects an interval below 1', () => {
  assertThrows(
    () =>
      validateActivitySchedule({
        isRecurring: true,
        recurrencePattern: {
          recurrenceType: 'every_x_days',
          config: { start_date: '2026-07-20', interval_days: 0 },
        },
      }),
    InvalidActivityScheduleError,
    'interval_days must be an integer >= 1',
  )
})

Deno.test('every_x_days with a valid interval is valid', () => {
  assertEquals(
    validateActivitySchedule({
      isRecurring: true,
      recurrencePattern: {
        recurrenceType: 'every_x_days',
        config: { start_date: '2026-07-20', interval_days: 3 },
      },
    }),
    undefined,
  )
})

Deno.test('group color rejects non-hex values', () => {
  assertThrows(
    () => validateGroupColor('teal'),
    InvalidGroupError,
    'group palette',
  )
})

Deno.test('group color rejects hex values outside the palette', () => {
  assertThrows(
    () => validateGroupColor('#FFFFFF'),
    InvalidGroupError,
    'group palette',
  )
})

Deno.test('group color accepts a palette color (case-insensitive)', () => {
  assertEquals(validateGroupColor('#0f766e'), '#0F766E')
})

Deno.test('group name rejects blank strings', () => {
  assertThrows(
    () => validateGroupName('   '),
    InvalidGroupError,
    'name is required',
  )
})

Deno.test('group name trims whitespace', () => {
  assertEquals(validateGroupName('  Work  '), 'Work')
})

Deno.test('validateCreateGoalInput requires links for non-composite', () => {
  assertThrows(
    () =>
      validateCreateGoalInput({
        title: 'Read',
        color: '#0F766E',
        ruleType: 'activity_count',
        metric: 'count',
        targetValue: 10,
        links: [],
      }),
    InvalidGoalError,
    'at least one link',
  )
})

Deno.test('validateCreateGoalInput accepts a valid count goal', () => {
  const result = validateCreateGoalInput({
    title: 'Workout 50x',
    color: '#0F766E',
    ruleType: 'activity_count',
    metric: 'count',
    targetValue: 50,
    links: [{ linkType: 'activity', activityId: 1 }],
  })
  assertEquals(result.ruleType, 'activity_count')
  assertEquals(result.links.length, 1)
})

Deno.test('validateCreateGoalInput defaults startsAt to now when omitted', () => {
  const now = new Date('2026-03-01T12:00:00Z')
  const result = validateCreateGoalInput(
    {
      title: 'Workout',
      color: '#0F766E',
      ruleType: 'activity_count',
      metric: 'count',
      targetValue: 10,
      links: [{ linkType: 'activity', activityId: 1 }],
    },
    now,
  )
  assertEquals(result.startsAt.toISOString(), now.toISOString())
})

Deno.test('validateCreateGoalInput accepts future startsAt', () => {
  const now = new Date('2026-03-01T12:00:00Z')
  const result = validateCreateGoalInput(
    {
      title: 'Workout',
      color: '#0F766E',
      ruleType: 'activity_count',
      metric: 'count',
      targetValue: 10,
      links: [{ linkType: 'activity', activityId: 1 }],
      startsAt: '2026-04-01T00:00:00.000Z',
    },
    now,
  )
  assertEquals(result.startsAt.toISOString(), '2026-04-01T00:00:00.000Z')
})

Deno.test('validateCreateGoalInput rejects deadline before start', () => {
  assertThrows(
    () =>
      validateCreateGoalInput(
        {
          title: 'Workout',
          color: '#0F766E',
          ruleType: 'activity_count',
          metric: 'count',
          targetValue: 10,
          links: [{ linkType: 'activity', activityId: 1 }],
          startsAt: '2026-04-01T00:00:00.000Z',
          deadline: { kind: 'absolute', date: '2026-03-01' },
        },
        new Date('2026-01-01T00:00:00Z'),
      ),
    InvalidGoalError,
    'deadline must be on or after the goal start',
  )
})

Deno.test('validateCreateGoalInput rejects invalid startsAt', () => {
  assertThrows(
    () =>
      validateCreateGoalInput({
        title: 'Workout',
        color: '#0F766E',
        ruleType: 'activity_count',
        metric: 'count',
        targetValue: 10,
        links: [{ linkType: 'activity', activityId: 1 }],
        startsAt: 'not-a-date',
      }),
    InvalidGoalError,
    'startsAt must be a valid ISO-8601 datetime',
  )
})

Deno.test('wouldCreateDependencyCycle detects a loop', () => {
  const edges = new Map<number, number[]>([
    [1, [2]],
    [2, [3]],
    [3, [1]],
  ])
  assertEquals(wouldCreateDependencyCycle(edges, 1), true)
})

Deno.test('wouldCreateDependencyCycle allows a DAG', () => {
  const edges = new Map<number, number[]>([
    [1, [2]],
    [2, [3]],
    [3, []],
  ])
  assertEquals(wouldCreateDependencyCycle(edges, 1), false)
})
