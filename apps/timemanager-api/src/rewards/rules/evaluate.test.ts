import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { evaluateRule, type GrantContext } from './evaluate.ts'
import type { RewardRule } from '../../db/types/schema.ts'

function makeRule(overrides: Partial<RewardRule> = {}): RewardRule {
  return {
    id: 1,
    user_id: 1,
    source_type: 'activity',
    source_id: 10,
    reward_definition_id: 100,
    quantity: 2,
    mode: 'fixed',
    config: {},
    enabled: true,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  } as RewardRule
}

function makeCtx(overrides: Partial<GrantContext> = {}): GrantContext {
  return {
    userId: 1,
    sourceType: 'activity',
    sourceId: 10,
    triggerKey: 'completion:1',
    priorEarnCount: 0,
    lastEarnAt: null,
    now: new Date('2026-07-14T12:00:00Z'),
    ...overrides,
  }
}

Deno.test('evaluateRule grants fixed reward', () => {
  const result = evaluateRule(makeRule(), makeCtx())
  assertEquals(result?.definitionId, 100)
  assertEquals(result?.quantity, 2)
  assertEquals(result?.ruleId, 1)
})

Deno.test('evaluateRule skips disabled', () => {
  assertEquals(evaluateRule(makeRule({ enabled: false }), makeCtx()), null)
})

Deno.test('evaluateRule respects once', () => {
  const rule = makeRule({ config: { once: true } })
  assertEquals(
    evaluateRule(rule, makeCtx({ priorEarnCount: 1 })),
    null,
  )
  assertEquals(evaluateRule(rule, makeCtx({ priorEarnCount: 0 }))?.quantity, 2)
})

Deno.test('evaluateRule respects cooldown', () => {
  const rule = makeRule({ config: { cooldown_hours: 24 } })
  const result = evaluateRule(
    rule,
    makeCtx({
      lastEarnAt: '2026-07-14T10:00:00Z',
      now: new Date('2026-07-14T12:00:00Z'),
    }),
  )
  assertEquals(result, null)

  const after = evaluateRule(
    rule,
    makeCtx({
      lastEarnAt: '2026-07-13T10:00:00Z',
      now: new Date('2026-07-14T12:00:00Z'),
    }),
  )
  assertEquals(after?.quantity, 2)
})

Deno.test('evaluateRule probability mode', () => {
  const rule = makeRule({
    mode: 'probability',
    config: { probability: 0.5 },
  })
  assertEquals(
    evaluateRule(rule, makeCtx({ random: () => 0.6 })),
    null,
  )
  assertEquals(
    evaluateRule(rule, makeCtx({ random: () => 0.4 }))?.definitionId,
    100,
  )
})

Deno.test('evaluateRule random_pool mode', () => {
  const rule = makeRule({
    mode: 'random_pool',
    config: {
      pool: [
        { definition_id: 1, weight: 1 },
        { definition_id: 2, weight: 1 },
      ],
    },
  })
  // random 0.0 → first entry
  assertEquals(
    evaluateRule(rule, makeCtx({ random: () => 0.0 }))?.definitionId,
    1,
  )
  // random near 1 → second entry
  assertEquals(
    evaluateRule(rule, makeCtx({ random: () => 0.99 }))?.definitionId,
    2,
  )
})

Deno.test('evaluateRule max_grants_total', () => {
  const rule = makeRule({ config: { max_grants_total: 2 } })
  assertEquals(
    evaluateRule(rule, makeCtx({ priorEarnCount: 2 })),
    null,
  )
  assertEquals(
    evaluateRule(rule, makeCtx({ priorEarnCount: 1 }))?.quantity,
    2,
  )
})
