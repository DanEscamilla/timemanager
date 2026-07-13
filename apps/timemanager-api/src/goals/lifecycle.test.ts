import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import type { Goal, GoalCycle } from '../db/types/schema.ts'
import { lifecyclePhase, cycleHasStarted } from './lifecycle.ts'
import { buildGoalNudges } from './nudges.ts'

function baseGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    user_id: 1,
    title: 'Read',
    description: null,
    color: '#0F766E',
    icon: null,
    rule_type: 'activity_duration',
    metric: 'duration',
    target_value: 100,
    config: {},
    status: 'active',
    recurrence: { period: 'weekly' },
    deadline: null,
    priority: 0,
    sort_order: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

function baseCycle(overrides: Partial<GoalCycle> = {}): GoalCycle {
  return {
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
    ...overrides,
  }
}

Deno.test('lifecyclePhase is scheduled when starts_at is in the future', () => {
  const goal = baseGoal({ starts_at: new Date('2026-06-01T00:00:00Z') })
  assertEquals(
    lifecyclePhase(goal, new Date('2026-01-01T00:00:00Z')),
    'scheduled',
  )
})

Deno.test('lifecyclePhase is active when starts_at has passed', () => {
  const goal = baseGoal({ starts_at: new Date('2026-01-01T00:00:00Z') })
  assertEquals(
    lifecyclePhase(goal, new Date('2026-01-02T00:00:00Z')),
    'active',
  )
})

Deno.test('lifecyclePhase mirrors paused/completed/archived/failed', () => {
  const now = new Date('2026-01-02T00:00:00Z')
  assertEquals(
    lifecyclePhase(baseGoal({ status: 'paused' }), now),
    'paused',
  )
  assertEquals(
    lifecyclePhase(baseGoal({ status: 'completed' }), now),
    'completed',
  )
  assertEquals(
    lifecyclePhase(baseGoal({ status: 'archived' }), now),
    'archived',
  )
  assertEquals(
    lifecyclePhase(baseGoal({ status: 'failed' }), now),
    'failed',
  )
})

Deno.test('cycleHasStarted is false before starts_at', () => {
  assertEquals(
    cycleHasStarted(
      baseCycle({ starts_at: new Date('2026-06-01T00:00:00Z') }),
      new Date('2026-01-01T00:00:00Z'),
    ),
    false,
  )
})

Deno.test('buildGoalNudges skips deadline/pace for scheduled goals', () => {
  const goal = baseGoal({
    starts_at: new Date('2026-06-01T00:00:00Z'),
    deadline: { kind: 'absolute', date: '2026-06-10', warn_days: 3 },
  })
  const cycle = baseCycle({
    starts_at: new Date('2026-06-01T00:00:00Z'),
    ends_at: new Date('2026-06-08T00:00:00Z'),
    deadline_at: new Date('2026-06-10T00:00:00Z'),
    current_value: 0,
  })
  const nudges = buildGoalNudges(
    [{ goal, cycle }],
    new Date('2026-01-01T00:00:00Z'),
  )
  assertEquals(nudges.some((n) => n.kind === 'behind_pace'), false)
  assertEquals(nudges.some((n) => n.kind === 'deadline_approaching'), false)
})

Deno.test('buildGoalNudges emits goal_starting_soon within 3 days', () => {
  const goal = baseGoal({
    starts_at: new Date('2026-01-03T00:00:00Z'),
  })
  const cycle = baseCycle({
    starts_at: new Date('2026-01-03T00:00:00Z'),
    current_value: 0,
  })
  const nudges = buildGoalNudges(
    [{ goal, cycle }],
    new Date('2026-01-01T12:00:00Z'),
  )
  assertEquals(nudges.some((n) => n.kind === 'goal_starting_soon'), true)
})

Deno.test('buildGoalNudges does not emit starting_soon more than 3 days out', () => {
  const goal = baseGoal({
    starts_at: new Date('2026-01-10T00:00:00Z'),
  })
  const cycle = baseCycle({
    starts_at: new Date('2026-01-10T00:00:00Z'),
    current_value: 0,
  })
  const nudges = buildGoalNudges(
    [{ goal, cycle }],
    new Date('2026-01-01T00:00:00Z'),
  )
  assertEquals(nudges.length, 0)
})

Deno.test('buildGoalNudges emits cycle_complete when target met while still active', () => {
  const goal = baseGoal()
  const cycle = baseCycle({
    current_value: 100,
    target_value: 100,
    status: 'active',
  })
  const nudges = buildGoalNudges(
    [{ goal, cycle }],
    new Date('2026-01-02T00:00:00Z'),
  )
  assertEquals(nudges.some((n) => n.kind === 'cycle_complete'), true)
})
