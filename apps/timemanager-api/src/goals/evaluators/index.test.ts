import { assertEquals } from 'jsr:@std/assert@^1.0.0'
import type {
  Goal,
  GoalCycle,
  GoalEvent,
  GoalLink,
} from '../../db/types/schema.ts'
import {
  activityCountEvaluator,
  activityDurationEvaluator,
  compositeEvaluator,
  dedupeEvents,
  evaluateGoal,
  streakEvaluator,
} from './index.ts'

function makeGoal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 1,
    user_id: 1,
    title: 'Test',
    description: null,
    color: '#0F766E',
    icon: null,
    rule_type: 'activity_count',
    metric: 'count',
    target_value: 10,
    config: {},
    status: 'active',
    recurrence: null,
    deadline: null,
    priority: 0,
    sort_order: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

function makeCycle(overrides: Partial<GoalCycle> = {}): GoalCycle {
  return {
    id: 1,
    goal_id: 1,
    cycle_index: 0,
    starts_at: new Date('2026-01-01T00:00:00Z'),
    ends_at: new Date('2026-02-01T00:00:00Z'),
    deadline_at: null,
    target_value: 10,
    current_value: 0,
    status: 'active',
    carry_over: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  }
}

function makeLink(overrides: Partial<GoalLink> = {}): GoalLink {
  return {
    id: 1,
    goal_id: 1,
    link_type: 'activity',
    activity_id: 5,
    group_id: null,
    weight: 1,
    created_at: new Date(),
    ...overrides,
  }
}

function makeEvent(overrides: Partial<GoalEvent> = {}): GoalEvent {
  return {
    id: 1,
    user_id: 1,
    source_type: 'completion',
    activity_id: 5,
    group_id: null,
    completion_id: 1,
    occurred_at: new Date('2026-01-05T12:00:00Z'),
    occurrence_date: '2026-01-05',
    metric: 'count',
    amount: 1,
    metadata: null,
    created_at: new Date(),
    ...overrides,
  }
}

Deno.test('dedupeEvents keeps one event per activity+occurrence+metric', () => {
  const events = [
    makeEvent({ id: 1, occurrence_date: '2026-01-05' }),
    makeEvent({ id: 2, occurrence_date: '2026-01-05' }),
    makeEvent({ id: 3, occurrence_date: '2026-01-06' }),
  ]
  assertEquals(dedupeEvents(events).length, 2)
})

Deno.test('activity_count sums matching count events', () => {
  const result = activityCountEvaluator.evaluate({
    goal: makeGoal(),
    cycle: makeCycle({ target_value: 3 }),
    links: [makeLink()],
    events: [
      makeEvent({ id: 1, occurrence_date: '2026-01-01' }),
      makeEvent({ id: 2, occurrence_date: '2026-01-02' }),
      makeEvent({ id: 3, occurrence_date: '2026-01-03', activity_id: 99 }),
    ],
  })
  assertEquals(result.currentValue, 2)
  assertEquals(result.done, false)
})

Deno.test('activity_duration sums minutes with weight', () => {
  const result = activityDurationEvaluator.evaluate({
    goal: makeGoal({ rule_type: 'activity_duration', metric: 'duration' }),
    cycle: makeCycle({ target_value: 120 }),
    links: [makeLink({ weight: 2 })],
    events: [
      makeEvent({
        id: 1,
        metric: 'duration',
        amount: 30,
        source_type: 'time_log',
      }),
    ],
  })
  assertEquals(result.currentValue, 60)
  assertEquals(result.done, false)
})

Deno.test('activity_count respects carry_over', () => {
  const result = activityCountEvaluator.evaluate({
    goal: makeGoal(),
    cycle: makeCycle({ target_value: 5, carry_over: 3 }),
    links: [makeLink()],
    events: [makeEvent()],
  })
  assertEquals(result.currentValue, 4)
})

Deno.test('streak counts consecutive days', () => {
  const result = streakEvaluator.evaluate({
    goal: makeGoal({ rule_type: 'streak' }),
    cycle: makeCycle({ target_value: 3 }),
    links: [makeLink()],
    events: [
      makeEvent({ id: 1, occurrence_date: '2026-01-01', occurred_at: new Date('2026-01-01T10:00:00Z') }),
      makeEvent({ id: 2, occurrence_date: '2026-01-02', occurred_at: new Date('2026-01-02T10:00:00Z') }),
      makeEvent({ id: 3, occurrence_date: '2026-01-04', occurred_at: new Date('2026-01-04T10:00:00Z') }),
    ],
  })
  assertEquals(result.currentValue, 2)
  assertEquals(result.done, false)
})

Deno.test('composite all mode requires every child', () => {
  const children = new Map<number, GoalCycle>([
    [2, makeCycle({ goal_id: 2, status: 'succeeded', current_value: 10, target_value: 10 })],
    [3, makeCycle({ goal_id: 3, status: 'active', current_value: 5, target_value: 10 })],
  ])
  const result = compositeEvaluator.evaluate({
    goal: makeGoal({ rule_type: 'composite', config: { composite_mode: 'all' } }),
    cycle: makeCycle({ target_value: 2 }),
    links: [],
    events: [],
    childCycles: children,
  })
  assertEquals(result.currentValue, 1)
  assertEquals(result.done, false)
})

Deno.test('evaluateGoal dispatches by rule_type', () => {
  const result = evaluateGoal({
    goal: makeGoal({ rule_type: 'activity_count' }),
    cycle: makeCycle({ target_value: 1 }),
    links: [makeLink()],
    events: [makeEvent()],
  })
  assertEquals(result.done, true)
  assertEquals(result.currentValue, 1)
})
