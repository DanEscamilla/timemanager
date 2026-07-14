import type { Kysely, Transaction } from 'kysely'
import type { Database } from '../db/types/schema.ts'
import { rewardGrantService } from './grant_service.ts'
import { getRewardSourceAdapter } from './sources/index.ts'
import type { GrantResult } from './grant_service.ts'

type DbLike = Kysely<Database> | Transaction<Database>

/** Grant rewards for an activity completion (idempotent per completion+rule). */
export async function grantRewardsForActivityCompletion(
  db: DbLike,
  opts: {
    userId: number
    activityId: number
    completionId: number
  },
): Promise<GrantResult[]> {
  const adapter = getRewardSourceAdapter('activity')
  if (!adapter) return []

  const triggerKey = `completion:${opts.completionId}`
  const instructions = await adapter.collectGrants(db, {
    userId: opts.userId,
    sourceType: 'activity',
    sourceId: opts.activityId,
    triggerKey,
    activityId: opts.activityId,
    completionId: opts.completionId,
  })

  return await rewardGrantService.grant(db, opts.userId, instructions)
}

/** Grant rewards when a goal cycle transitions to succeeded (edge-triggered). */
export async function grantRewardsForGoalCycleSuccess(
  db: DbLike,
  opts: {
    userId: number
    goalId: number
    cycleId: number
  },
): Promise<GrantResult[]> {
  const adapter = getRewardSourceAdapter('goal')
  if (!adapter) return []

  const triggerKey = `cycle:${opts.cycleId}:succeeded`
  const instructions = await adapter.collectGrants(db, {
    userId: opts.userId,
    sourceType: 'goal',
    sourceId: opts.goalId,
    triggerKey,
    goalId: opts.goalId,
    cycleId: opts.cycleId,
  })

  return await rewardGrantService.grant(db, opts.userId, instructions)
}
