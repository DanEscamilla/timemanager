import type {
  Goal,
  GoalCycle,
  GoalEvent,
  GoalLink,
} from '../../db/types/schema.ts'

export interface EvaluateResult {
  currentValue: number
  done: boolean
}

export interface EvaluateContext {
  goal: Goal
  cycle: GoalCycle
  links: GoalLink[]
  events: GoalEvent[]
  /** Active (or latest) child cycles keyed by child goal id, for composites. */
  childCycles?: Map<number, GoalCycle>
  /** Child dependency weights keyed by child goal id. */
  childWeights?: Map<number, number>
  /** For group_all_complete: activity ids that belong to linked groups. */
  groupActivityIds?: number[]
}

export interface GoalEvaluator {
  ruleType: string
  evaluate(ctx: EvaluateContext): EvaluateResult
}

/** Deduplicate events by (activity_id, occurrence_date), preferring first. */
export function dedupeEvents(events: GoalEvent[]): GoalEvent[] {
  const seen = new Set<string>()
  const out: GoalEvent[] = []
  for (const event of events) {
    const key = event.activity_id != null && event.occurrence_date
      ? `${event.activity_id}:${event.occurrence_date}:${event.metric}`
      : `id:${event.id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(event)
  }
  return out
}

function eventsInWindow(events: GoalEvent[], cycle: GoalCycle): GoalEvent[] {
  const start = new Date(cycle.starts_at).getTime()
  const end = cycle.ends_at ? new Date(cycle.ends_at).getTime() : Number.POSITIVE_INFINITY
  return events.filter((e) => {
    const t = new Date(e.occurred_at).getTime()
    return t >= start && t < end
  })
}

function linkedActivityIds(links: GoalLink[]): Set<number> {
  return new Set(
    links
      .filter((l) => l.link_type === 'activity' && l.activity_id != null)
      .map((l) => l.activity_id!),
  )
}

function linkedGroupIds(links: GoalLink[]): Set<number> {
  return new Set(
    links
      .filter((l) => l.link_type === 'group' && l.group_id != null)
      .map((l) => l.group_id!),
  )
}

function weightForEvent(event: GoalEvent, links: GoalLink[]): number {
  for (const link of links) {
    if (
      link.link_type === 'activity' &&
      link.activity_id != null &&
      event.activity_id === link.activity_id
    ) {
      return Number(link.weight)
    }
    if (
      link.link_type === 'group' &&
      link.group_id != null &&
      event.group_id === link.group_id
    ) {
      return Number(link.weight)
    }
  }
  return 1
}

function matchesLinks(event: GoalEvent, links: GoalLink[]): boolean {
  const activities = linkedActivityIds(links)
  const groups = linkedGroupIds(links)
  if (activities.size === 0 && groups.size === 0) return false
  if (event.activity_id != null && activities.has(event.activity_id)) return true
  if (event.group_id != null && groups.has(event.group_id)) return true
  return false
}

function sumWeighted(
  events: GoalEvent[],
  links: GoalLink[],
  metric: 'count' | 'duration',
): number {
  let total = 0
  for (const event of dedupeEvents(events)) {
    if (event.metric !== metric) continue
    if (!matchesLinks(event, links)) continue
    total += Number(event.amount) * weightForEvent(event, links)
  }
  return total
}

function withCarryOver(value: number, cycle: GoalCycle): number {
  return Math.max(0, value + Number(cycle.carry_over || 0))
}

function result(value: number, target: number): EvaluateResult {
  const currentValue = Math.max(0, value)
  return {
    currentValue,
    done: target > 0 ? currentValue >= target : currentValue > 0,
  }
}

export const activityCountEvaluator: GoalEvaluator = {
  ruleType: 'activity_count',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, 'count'),
      ctx.cycle,
    )
    return result(value, Number(ctx.cycle.target_value))
  },
}

export const activityDurationEvaluator: GoalEvaluator = {
  ruleType: 'activity_duration',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, 'duration'),
      ctx.cycle,
    )
    return result(value, Number(ctx.cycle.target_value))
  },
}

export const groupDurationEvaluator: GoalEvaluator = {
  ruleType: 'group_duration',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, 'duration'),
      ctx.cycle,
    )
    return result(value, Number(ctx.cycle.target_value))
  },
}

export const groupCountEvaluator: GoalEvaluator = {
  ruleType: 'group_count',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, 'count'),
      ctx.cycle,
    )
    return result(value, Number(ctx.cycle.target_value))
  },
}

/** Count completions of any activity in linked groups. */
export const groupAnyCountEvaluator: GoalEvaluator = {
  ruleType: 'group_any_count',
  evaluate(ctx) {
    return groupCountEvaluator.evaluate(ctx)
  },
}

/**
 * Progress = number of distinct linked-group activities completed at least
 * once in the cycle. Target is typically the size of the group.
 */
export const groupAllCompleteEvaluator: GoalEvaluator = {
  ruleType: 'group_all_complete',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const activityIds = new Set(ctx.groupActivityIds ?? [])
    const completed = new Set<number>()
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== 'count') continue
      if (event.activity_id == null) continue
      if (activityIds.size > 0 && !activityIds.has(event.activity_id)) continue
      if (!matchesLinks(event, ctx.links) && activityIds.size === 0) continue
      if (activityIds.size > 0 || matchesLinks(event, ctx.links)) {
        completed.add(event.activity_id)
      }
    }
    // Prefer counting only activities that belong to the group.
    const value = withCarryOver(
      activityIds.size > 0
        ? [...completed].filter((id) => activityIds.has(id)).length
        : completed.size,
      ctx.cycle,
    )
    return result(value, Number(ctx.cycle.target_value))
  },
}

export const multiActivityDurationEvaluator: GoalEvaluator = {
  ruleType: 'multi_activity_duration',
  evaluate(ctx) {
    return activityDurationEvaluator.evaluate(ctx)
  },
}

/** Consecutive calendar days with at least one matching count event. */
export const streakEvaluator: GoalEvaluator = {
  ruleType: 'streak',
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    const days = new Set<string>()
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== 'count') continue
      if (!matchesLinks(event, ctx.links)) continue
      const day = event.occurrence_date ??
        new Date(event.occurred_at).toISOString().slice(0, 10)
      days.add(day)
    }
    const sorted = [...days].sort()
    let best = 0
    let run = 0
    let prev: string | null = null
    for (const day of sorted) {
      if (prev) {
        const prevDate = new Date(prev + 'T00:00:00Z')
        const curDate = new Date(day + 'T00:00:00Z')
        const diff = (curDate.getTime() - prevDate.getTime()) / 86_400_000
        run = diff === 1 ? run + 1 : 1
      } else {
        run = 1
      }
      best = Math.max(best, run)
      prev = day
    }
    const value = withCarryOver(best, ctx.cycle)
    return result(value, Number(ctx.cycle.target_value))
  },
}

/** Count completions whose occurrence local time is before config.before_time. */
export const timeOfDayCountEvaluator: GoalEvaluator = {
  ruleType: 'time_of_day_count',
  evaluate(ctx) {
    const config = typeof ctx.goal.config === 'string'
      ? JSON.parse(ctx.goal.config)
      : (ctx.goal.config ?? {})
    const before = typeof config.before_time === 'string' ? config.before_time : null
    const after = typeof config.after_time === 'string' ? config.after_time : null
    const windowed = eventsInWindow(ctx.events, ctx.cycle)
    let total = 0
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== 'count') continue
      if (!matchesLinks(event, ctx.links)) continue
      const hhmm = new Date(event.occurred_at).toISOString().slice(11, 16)
      if (before && hhmm >= before) continue
      if (after && hhmm < after) continue
      total += Number(event.amount) * weightForEvent(event, ctx.links)
    }
    return result(withCarryOver(total, ctx.cycle), Number(ctx.cycle.target_value))
  },
}

export const compositeEvaluator: GoalEvaluator = {
  ruleType: 'composite',
  evaluate(ctx) {
    const config = typeof ctx.goal.config === 'string'
      ? JSON.parse(ctx.goal.config)
      : (ctx.goal.config ?? {})
    const mode = config.composite_mode ?? 'all'
    const children = ctx.childCycles
    if (!children || children.size === 0) {
      return result(0, Number(ctx.cycle.target_value))
    }

    const entries = [...children.entries()]
    if (mode === 'weighted') {
      let weightedSum = 0
      let weightTotal = 0
      for (const [childId, cycle] of entries) {
        const w = Number(ctx.childWeights?.get(childId) ?? 1)
        const progress = Number(cycle.target_value) > 0
          ? Math.min(1, Number(cycle.current_value) / Number(cycle.target_value))
          : (cycle.status === 'succeeded' ? 1 : 0)
        weightedSum += progress * w
        weightTotal += w
      }
      const pct = weightTotal > 0 ? weightedSum / weightTotal : 0
      // Represent as 0–100 percent of target.
      const value = pct * Number(ctx.cycle.target_value)
      return result(value, Number(ctx.cycle.target_value))
    }

    const completed = entries.filter(([, c]) =>
      c.status === 'succeeded' ||
      (Number(c.target_value) > 0 && Number(c.current_value) >= Number(c.target_value))
    ).length

    if (mode === 'any') {
      const needed = Math.max(1, Number(config.count_required ?? 1))
      return result(completed, needed)
    }

    // all
    return result(completed, entries.length)
  },
}

const EVALUATORS: GoalEvaluator[] = [
  activityCountEvaluator,
  activityDurationEvaluator,
  groupDurationEvaluator,
  groupCountEvaluator,
  groupAnyCountEvaluator,
  groupAllCompleteEvaluator,
  multiActivityDurationEvaluator,
  streakEvaluator,
  timeOfDayCountEvaluator,
  compositeEvaluator,
]

const REGISTRY = new Map(EVALUATORS.map((e) => [e.ruleType, e]))

export const GOAL_RULE_TYPES = EVALUATORS.map((e) => e.ruleType)

export function getEvaluator(ruleType: string): GoalEvaluator {
  const evaluator = REGISTRY.get(ruleType)
  if (!evaluator) {
    throw new Error(`Unknown goal rule_type: ${ruleType}`)
  }
  return evaluator
}

export function evaluateGoal(ctx: EvaluateContext): EvaluateResult {
  return getEvaluator(ctx.goal.rule_type).evaluate(ctx)
}
