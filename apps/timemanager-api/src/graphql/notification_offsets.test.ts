import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  MAX_NOTIFICATION_OFFSET_MINUTES,
  MAX_NOTIFICATION_OFFSETS,
  normalizeNotificationOffsets,
} from './notification_offsets.ts'
import { InvalidActivityScheduleError } from './validation.ts'

Deno.test('normalizeNotificationOffsets: null/undefined → empty', () => {
  assertEquals(normalizeNotificationOffsets(null), [])
  assertEquals(normalizeNotificationOffsets(undefined), [])
})

Deno.test('normalizeNotificationOffsets: sorts and dedupes', () => {
  assertEquals(
    normalizeNotificationOffsets([15, 0, 15, 60]),
    [0, 15, 60],
  )
})

Deno.test('normalizeNotificationOffsets: accepts 0 and max', () => {
  assertEquals(
    normalizeNotificationOffsets([0, MAX_NOTIFICATION_OFFSET_MINUTES]),
    [0, MAX_NOTIFICATION_OFFSET_MINUTES],
  )
})

Deno.test('normalizeNotificationOffsets: rejects negative', () => {
  assertThrows(
    () => normalizeNotificationOffsets([-1]),
    InvalidActivityScheduleError,
  )
})

Deno.test('normalizeNotificationOffsets: rejects above max minutes', () => {
  assertThrows(
    () => normalizeNotificationOffsets([MAX_NOTIFICATION_OFFSET_MINUTES + 1]),
    InvalidActivityScheduleError,
  )
})

Deno.test('normalizeNotificationOffsets: rejects non-integers', () => {
  assertThrows(
    () => normalizeNotificationOffsets([15.5]),
    InvalidActivityScheduleError,
  )
})

Deno.test('normalizeNotificationOffsets: rejects too many offsets', () => {
  const tooMany = Array.from(
    { length: MAX_NOTIFICATION_OFFSETS + 1 },
    (_, i) => i,
  )
  assertThrows(
    () => normalizeNotificationOffsets(tooMany),
    InvalidActivityScheduleError,
  )
})

Deno.test('normalizeNotificationOffsets: allows max count', () => {
  const ok = Array.from({ length: MAX_NOTIFICATION_OFFSETS }, (_, i) => i)
  assertEquals(normalizeNotificationOffsets(ok), ok)
})
