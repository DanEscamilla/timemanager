import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { buildRewardNudges } from './nudges.ts'

Deno.test('buildRewardNudges empty inventory', () => {
  assertEquals(
    buildRewardNudges({ inventory: [], recentEarns: [] }),
    [],
  )
})

Deno.test('buildRewardNudges inventory available', () => {
  const nudges = buildRewardNudges({
    inventory: [
      { id: 1, quantity: 3, reward_definition_id: 10, name: 'Coffee' },
    ],
    recentEarns: [],
  })
  assertEquals(nudges.some((n) => n.kind === 'inventory_available'), true)
  assertEquals(nudges.some((n) => n.kind === 'unconsumed_stack'), false)
})

Deno.test('buildRewardNudges stack and recent earn', () => {
  const now = new Date('2026-07-14T12:00:00Z')
  const nudges = buildRewardNudges({
    inventory: [
      { id: 1, quantity: 5, reward_definition_id: 10, name: 'Coffee' },
    ],
    recentEarns: [
      {
        id: 9,
        definition_name: 'Coffee',
        quantity: 1,
        created_at: new Date('2026-07-14T10:00:00Z') as unknown as Date,
        reward_definition_id: 10,
      },
    ],
    now,
  })
  assertEquals(nudges.some((n) => n.kind === 'unconsumed_stack'), true)
  assertEquals(nudges.some((n) => n.kind === 'recently_earned'), true)
})
