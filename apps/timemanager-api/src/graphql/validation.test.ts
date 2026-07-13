import { assertEquals, assertThrows } from 'jsr:@std/assert@^1.0.0'
import {
  InvalidActivityScheduleError,
  InvalidGroupError,
  validateActivitySchedule,
  validateGroupColor,
  validateGroupName,
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
