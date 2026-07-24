import { assertEquals } from 'jsr:@std/assert@1'
import { computeSyncProgressPercent } from './sync_progress.ts'

const since = new Date('2026-01-01T00:00:00.000Z')
const until = new Date('2026-01-11T00:00:00.000Z') // 10-day window

Deno.test('inactive sync returns null percent', () => {
  assertEquals(
    computeSyncProgressPercent({
      active: false,
      syncSince: since,
      syncUntil: until,
      oldestSyncedAt: since,
    }),
    null,
  )
})

Deno.test('no messages yet → ~0%', () => {
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: since,
      syncUntil: until,
      oldestSyncedAt: null,
    }),
    0,
  )
})

Deno.test('frontier at since → 100%', () => {
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: since,
      syncUntil: until,
      oldestSyncedAt: since,
    }),
    100,
  )
})

Deno.test('mid-window frontier → 50%', () => {
  const mid = new Date('2026-01-06T00:00:00.000Z')
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: since,
      syncUntil: until,
      oldestSyncedAt: mid,
    }),
    50,
  )
})

Deno.test('missing date range → null percent', () => {
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: null,
      syncUntil: null,
      oldestSyncedAt: null,
    }),
    null,
  )
})

Deno.test('only since uses now as window end', () => {
  const now = new Date('2026-01-11T00:00:00.000Z')
  const mid = new Date('2026-01-06T00:00:00.000Z')
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: since,
      syncUntil: null,
      oldestSyncedAt: mid,
      now,
    }),
    50,
  )
})

Deno.test('only until needs oldestSyncedAt as window start', () => {
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: null,
      syncUntil: until,
      oldestSyncedAt: null,
    }),
    null,
  )
  assertEquals(
    computeSyncProgressPercent({
      active: true,
      syncSince: null,
      syncUntil: until,
      oldestSyncedAt: since,
    }),
    100,
  )
})
