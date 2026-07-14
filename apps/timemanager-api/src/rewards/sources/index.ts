import type { Kysely, Transaction } from 'kysely'
import type { Database, RewardRule } from '../../db/types/schema.ts'
import type { GrantInstruction } from '../rules/evaluate.ts'
import { evaluateRule, type GrantContext } from '../rules/evaluate.ts'

type DbLike = Kysely<Database> | Transaction<Database>

export interface RewardSourceAdapter {
  sourceType: string
  collectGrants(
    db: DbLike,
    ctx: Omit<GrantContext, 'priorEarnCount' | 'lastEarnAt'>,
  ): Promise<GrantInstruction[]>
}

async function loadRules(
  db: DbLike,
  userId: number,
  sourceType: string,
  sourceId: number,
): Promise<RewardRule[]> {
  return await db
    .selectFrom('reward_rules')
    .where('user_id', '=', userId)
    .where('source_type', '=', sourceType)
    .where('source_id', '=', sourceId)
    .where('enabled', '=', true)
    .selectAll()
    .execute()
}

async function enrichAndEvaluate(
  db: DbLike,
  rules: RewardRule[],
  base: Omit<GrantContext, 'priorEarnCount' | 'lastEarnAt'>,
): Promise<GrantInstruction[]> {
  const out: GrantInstruction[] = []
  for (const rule of rules) {
    const last = await db
      .selectFrom('reward_transactions')
      .where('user_id', '=', base.userId)
      .where('type', '=', 'earn')
      .where('rule_id', '=', rule.id)
      .orderBy('created_at', 'desc')
      .selectAll()
      .execute()

    const instruction = evaluateRule(rule, {
      ...base,
      priorEarnCount: last.length,
      lastEarnAt:
        last[0] != null
          ? typeof last[0].created_at === 'string'
            ? last[0].created_at
            : new Date(last[0].created_at).toISOString()
          : null,
    })
    if (instruction) out.push(instruction)
  }
  return out
}

export const activityRewardSource: RewardSourceAdapter = {
  sourceType: 'activity',
  async collectGrants(db, ctx) {
    const rules = await loadRules(db, ctx.userId, 'activity', ctx.sourceId)
    return enrichAndEvaluate(db, rules, ctx)
  },
}

export const goalRewardSource: RewardSourceAdapter = {
  sourceType: 'goal',
  async collectGrants(db, ctx) {
    const rules = await loadRules(db, ctx.userId, 'goal', ctx.sourceId)
    return enrichAndEvaluate(db, rules, ctx)
  },
}

/** Future: streak-based grants (Phase 3 stub — register when streak events exist). */
export const streakRewardSource: RewardSourceAdapter = {
  sourceType: 'streak',
  async collectGrants(db, ctx) {
    const rules = await loadRules(db, ctx.userId, 'streak', ctx.sourceId)
    return enrichAndEvaluate(db, rules, ctx)
  },
}

/** Future: daily completion grants. */
export const dailyCompletionRewardSource: RewardSourceAdapter = {
  sourceType: 'daily_completion',
  async collectGrants(db, ctx) {
    const rules = await loadRules(
      db,
      ctx.userId,
      'daily_completion',
      ctx.sourceId,
    )
    return enrichAndEvaluate(db, rules, ctx)
  },
}

/** Future: weekly completion grants. */
export const weeklyCompletionRewardSource: RewardSourceAdapter = {
  sourceType: 'weekly_completion',
  async collectGrants(db, ctx) {
    const rules = await loadRules(
      db,
      ctx.userId,
      'weekly_completion',
      ctx.sourceId,
    )
    return enrichAndEvaluate(db, rules, ctx)
  },
}

export const REWARD_SOURCE_ADAPTERS: RewardSourceAdapter[] = [
  activityRewardSource,
  goalRewardSource,
  streakRewardSource,
  dailyCompletionRewardSource,
  weeklyCompletionRewardSource,
]

export function getRewardSourceAdapter(
  sourceType: string,
): RewardSourceAdapter | null {
  return (
    REWARD_SOURCE_ADAPTERS.find((a) => a.sourceType === sourceType) ?? null
  )
}
