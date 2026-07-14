import type {
  RewardRule,
  RewardRuleConfig,
  RewardRuleMode,
} from '../../db/types/schema.ts'

export interface GrantContext {
  userId: number
  sourceType: string
  sourceId: number
  triggerKey: string
  activityId?: number | null
  goalId?: number | null
  completionId?: number | null
  cycleId?: number | null
  /** Prior earn count for this rule (for once / max_grants). */
  priorEarnCount: number
  /** ISO timestamp of last earn for this rule, if any. */
  lastEarnAt: string | null
  now?: Date
  /** RNG for probability / random_pool (injectable for tests). */
  random?: () => number
}

export interface GrantInstruction {
  ruleId: number | null
  definitionId: number
  quantity: number
  triggerKey: string
  sourceType: string
  sourceId: number
  activityId?: number | null
  goalId?: number | null
  completionId?: number | null
  cycleId?: number | null
}

function parseConfig(config: RewardRule['config']): RewardRuleConfig {
  if (config == null) return {}
  if (typeof config === 'string') {
    try {
      return JSON.parse(config) as RewardRuleConfig
    } catch {
      return {}
    }
  }
  return config as RewardRuleConfig
}

/**
 * Evaluate a single reward rule against a grant context.
 * Returns null when the rule should not grant.
 */
export function evaluateRule(
  rule: RewardRule,
  ctx: GrantContext,
): GrantInstruction | null {
  if (!rule.enabled) return null

  const config = parseConfig(rule.config)
  const now = ctx.now ?? new Date()
  const random = ctx.random ?? Math.random

  if (config.once && ctx.priorEarnCount > 0) return null

  if (
    typeof config.max_grants_total === 'number' &&
    ctx.priorEarnCount >= config.max_grants_total
  ) {
    return null
  }

  if (
    typeof config.cooldown_hours === 'number' &&
    config.cooldown_hours > 0 &&
    ctx.lastEarnAt
  ) {
    const last = new Date(ctx.lastEarnAt).getTime()
    const cooldownMs = config.cooldown_hours * 60 * 60 * 1000
    if (now.getTime() - last < cooldownMs) return null
  }

  if (
    typeof config.max_grants_per_period === 'number' &&
    typeof config.period_hours === 'number' &&
    config.period_hours > 0 &&
    ctx.lastEarnAt
  ) {
    // Lightweight period check: if last earn is within period and we've
    // already hit the cap via priorEarnCount approximation, skip.
    // Full period counting is handled by callers that set priorEarnCount
    // to the count within the period window when period_hours is set.
    const periodMs = config.period_hours * 60 * 60 * 1000
    const last = new Date(ctx.lastEarnAt).getTime()
    if (
      now.getTime() - last < periodMs &&
      ctx.priorEarnCount >= config.max_grants_per_period
    ) {
      return null
    }
  }

  const mode = rule.mode as RewardRuleMode

  if (mode === 'probability') {
    const p =
      typeof config.probability === 'number' ? config.probability : 1
    if (random() > p) return null
    return baseInstruction(rule, ctx, rule.reward_definition_id, rule.quantity)
  }

  if (mode === 'random_pool') {
    const pool = config.pool
    if (!pool || pool.length === 0) return null
    const totalWeight = pool.reduce((s, e) => s + (e.weight ?? 1), 0)
    if (totalWeight <= 0) return null
    let roll = random() * totalWeight
    for (const entry of pool) {
      roll -= entry.weight ?? 1
      if (roll <= 0) {
        return baseInstruction(
          rule,
          ctx,
          entry.definition_id,
          entry.quantity ?? rule.quantity,
        )
      }
    }
    const last = pool[pool.length - 1]
    return baseInstruction(
      rule,
      ctx,
      last.definition_id,
      last.quantity ?? rule.quantity,
    )
  }

  // fixed (default)
  return baseInstruction(
    rule,
    ctx,
    rule.reward_definition_id,
    rule.quantity,
  )
}

function baseInstruction(
  rule: RewardRule,
  ctx: GrantContext,
  definitionId: number,
  quantity: number,
): GrantInstruction {
  return {
    ruleId: rule.id,
    definitionId,
    quantity: Math.max(1, Math.floor(quantity)),
    triggerKey: ctx.triggerKey,
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    activityId: ctx.activityId ?? null,
    goalId: ctx.goalId ?? null,
    completionId: ctx.completionId ?? null,
    cycleId: ctx.cycleId ?? null,
  }
}
