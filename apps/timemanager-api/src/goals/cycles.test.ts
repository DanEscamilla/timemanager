import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import type { Goal, GoalCycle } from '../db/types/schema.ts'
import {
  computeCycleEnd,
  computeDeadlineAt,
  deadlineState,
} from './cycles.ts'
import { buildGoalNudges } from './nudges.ts'

Deno.test('computeCycleEnd weekly advances 7 days', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const end = computeCycleEnd(start, { period: 'weekly', interval: 1 })
  assertEquals(end?.toISOString(), '2026-01-08T00:00:00.000Z')
})

Deno.test('computeDeadlineAt relative uses days_after_cycle_start', () => {
  const start = new Date('2026-01-01T00:00:00Z')
  const deadline = computeDeadlineAt(start, {
    kind: 'relative',
    days_after_cycle_start: 5,
  })
  assertEquals(deadline?.toISOString(), '2026-01-06T00:00:00.000Z')
})

Deno.test('deadlineState returns approaching within warn window', () => {
  const cycle: GoalCycle = {
    id: 1,
    goal_id: 1,
    cycle_index: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    ends_at: new Date('2026-02-01T00:00:00Z'),
    deadline_at: new Date('2026-01-10T00:00:00Z'),
    target_value: 10,
    current_value: 1,
    status: 'active',
    carry_over: 0,
    created_at: new Date(),
    updated_at: new Date(),
  }
  const state = deadlineState(
    cycle,
    { kind: 'absolute', date: '2026-01-10', warn_days: 3 },
    new Date('2026-01-08T00:00:00Z'),
  )
  assertEquals(state, 'approaching')
})

Deno.test('buildGoalNudges emits behind_pace', () => {
  const goal = {
    id: 1,
    user_id: 1,
    title: 'Read',
    description: null,
    color: '#0F766E',
    icon: null,
    rule_type: 'activity_duration',
    metric: 'duration' as const,
    target_value: 100,
    config: {},
    status: 'active' as const,
    recurrence: { period: 'weekly' as const },
    deadline: null,
    priority: 0,
    sort_order: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date(),
    updated_at: new Date(),
  } satisfies Goal

  const cycle: GoalCycle = {
    id: 1,
    goal_id: 1,
    cycle_index: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    ends_at: new Date('2026-01-08T00:00:00Z'),
    deadline_at: null,
    target_value: 100,
    current_value: 5,
    status: 'active',
    carry_over: 0,
    created_at: new Date(),
    updated_at: new Date(),
  }

  const nudges = buildGoalNudges(
    [{ goal, cycle }],
    new Date('2026-01-05T00:00:00Z'),
  )
  assertEquals(nudges.some((n) => n.kind === 'behind_pace'), true)
})
