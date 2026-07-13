import type { Transaction } from 'kysely'
import { getContext } from '@getcronit/pylon'
import { db } from '../../db/database.ts'
import type {
  Database,
  Goal as GoalRow,
  GoalConfig,
  GoalCycle as GoalCycleRow,
  GoalDeadlineConfig,
  GoalDependency as GoalDependencyRow,
  GoalLink as GoalLinkRow,
  GoalProgressSnapshot as GoalSnapshotRow,
  GoalRecurrenceConfig,
  NewGoal,
  NewGoalDependency,
  NewGoalLink,
} from '../../db/types/schema.ts'
import { createInitialCycle, deadlineState, lifecyclePhase, rescheduleActiveCycle, rollOverIfNeeded, rollOverUserGoals } from '../../goals/cycles.ts'
import { buildGoalNudges } from '../../goals/nudges.ts'
import { recomputeAllActiveCycles, recomputeCycle } from '../../goals/progress.ts'
import type {
  CreateGoalInput,
  GoalDependencyInput,
  GoalLinkInput,
  UpdateGoalInput,
} from '../types.ts'
import {
  assertDeadlineAfterStart,
  InvalidGoalError,
  validateCreateGoalInput,
  validateGoalColor,
  validateGoalTitle,
  validateUpdateGoalInput,
  wouldCreateDependencyCycle,
} from '../validation.ts'
import { asNumber, asNumberOrNull } from '../numeric.ts'

function requireUserId(): number {
  const userId = getContext().get('userId')
  if (typeof userId !== 'number') {
    throw new Error('Unauthenticated')
  }
  return userId
}

function parseJson<T>(value: unknown): T | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return null
    }
  }
  return value as T
}

/** Postgres `numeric` arrives as string via `pg`; GraphQL Number requires JS number. */
function mapCycleScalars<T extends GoalCycleRow>(cycle: T) {
  return {
    ...cycle,
    target_value: asNumber(cycle.target_value),
    current_value: asNumber(cycle.current_value),
    carry_over: asNumber(cycle.carry_over),
  }
}

function mapLinkScalars(link: GoalLinkRow) {
  return {
    ...link,
    weight: asNumber(link.weight, 1),
  }
}

function mapDependencyScalars(dep: GoalDependencyRow) {
  return {
    ...dep,
    threshold: asNumberOrNull(dep.threshold),
    weight: asNumber(dep.weight, 1),
  }
}

function mapSnapshotScalars(snapshot: GoalSnapshotRow) {
  return {
    ...snapshot,
    value: asNumber(snapshot.value),
  }
}

function toRecurrenceJson(
  input: CreateGoalInput['recurrence'] | UpdateGoalInput['recurrence'],
): GoalRecurrenceConfig | null {
  if (input == null) return null
  return {
    period: input.period,
    interval: input.interval,
    anchor: input.anchor,
    carry_over: input.carryOver,
    reset: input.reset,
  }
}

function toDeadlineJson(
  input: CreateGoalInput['deadline'] | UpdateGoalInput['deadline'],
): GoalDeadlineConfig | null {
  if (input == null) return null
  return {
    kind: input.kind,
    date: input.date,
    days_after_cycle_start: input.daysAfterCycleStart,
    grace_days: input.graceDays,
    warn_days: input.warnDays,
  }
}

function toConfigJson(
  input: CreateGoalInput['config'] | UpdateGoalInput['config'],
): GoalConfig {
  if (!input) return {}
  return {
    composite_mode: input.compositeMode,
    count_required: input.countRequired,
    before_time: input.beforeTime,
    after_time: input.afterTime,
    block_until_unlocked: input.blockUntilUnlocked,
  }
}

async function assertOwnedActivities(
  trx: Transaction<Database>,
  userId: number,
  activityIds: number[],
) {
  if (activityIds.length === 0) return
  const rows = await trx
    .selectFrom('activities')
    .where('user_id', '=', userId)
    .where('id', 'in', activityIds)
    .select('id')
    .execute()
  if (rows.length !== activityIds.length) {
    throw new InvalidGoalError('one or more activities not found')
  }
}

async function assertOwnedGroups(
  trx: Transaction<Database>,
  userId: number,
  groupIds: number[],
) {
  if (groupIds.length === 0) return
  const rows = await trx
    .selectFrom('groups')
    .where('user_id', '=', userId)
    .where('id', 'in', groupIds)
    .select('id')
    .execute()
  if (rows.length !== groupIds.length) {
    throw new InvalidGoalError('one or more groups not found')
  }
}

async function assertOwnedGoals(
  trx: Transaction<Database>,
  userId: number,
  goalIds: number[],
) {
  if (goalIds.length === 0) return
  const rows = await trx
    .selectFrom('goals')
    .where('user_id', '=', userId)
    .where('id', 'in', goalIds)
    .select('id')
    .execute()
  if (rows.length !== goalIds.length) {
    throw new InvalidGoalError('one or more dependency goals not found')
  }
}

async function replaceLinks(
  trx: Transaction<Database>,
  goalId: number,
  userId: number,
  links: GoalLinkInput[],
) {
  await trx.deleteFrom('goal_links').where('goal_id', '=', goalId).execute()
  const activityIds = links
    .filter((l) => l.linkType === 'activity' && l.activityId != null)
    .map((l) => l.activityId!)
  const groupIds = links
    .filter((l) => l.linkType === 'group' && l.groupId != null)
    .map((l) => l.groupId!)
  await assertOwnedActivities(trx, userId, activityIds)
  await assertOwnedGroups(trx, userId, groupIds)

  for (const link of links) {
    await trx
      .insertInto('goal_links')
      .values({
        goal_id: goalId,
        link_type: link.linkType,
        activity_id: link.linkType === 'activity' ? link.activityId ?? null : null,
        group_id: link.linkType === 'group' ? link.groupId ?? null : null,
        weight: link.weight ?? 1,
      } as NewGoalLink)
      .execute()
  }
}

async function replaceDependencies(
  trx: Transaction<Database>,
  goalId: number,
  userId: number,
  deps: GoalDependencyInput[],
) {
  const depIds = deps.map((d) => d.dependsOnGoalId)
  if (depIds.includes(goalId)) {
    throw new InvalidGoalError('a goal cannot depend on itself')
  }
  await assertOwnedGoals(trx, userId, depIds)

  // Build adjacency from all existing deps for this user, replacing this goal's edges.
  const allGoals = await trx
    .selectFrom('goals')
    .where('user_id', '=', userId)
    .select('id')
    .execute()
  const existing = await trx
    .selectFrom('goal_dependencies')
    .innerJoin('goals', 'goals.id', 'goal_dependencies.goal_id')
    .where('goals.user_id', '=', userId)
    .select([
      'goal_dependencies.goal_id',
      'goal_dependencies.depends_on_goal_id',
    ])
    .execute()

  const edges = new Map<number, number[]>()
  for (const g of allGoals) edges.set(g.id, [])
  for (const e of existing) {
    if (e.goal_id === goalId) continue
    edges.get(e.goal_id)?.push(e.depends_on_goal_id)
  }
  edges.set(goalId, depIds)

  if (wouldCreateDependencyCycle(edges, goalId)) {
    throw new InvalidGoalError('dependency cycle detected')
  }

  await trx.deleteFrom('goal_dependencies').where('goal_id', '=', goalId).execute()
  for (const dep of deps) {
    await trx
      .insertInto('goal_dependencies')
      .values({
        goal_id: goalId,
        depends_on_goal_id: dep.dependsOnGoalId,
        requirement: dep.requirement ?? 'complete',
        threshold: dep.threshold ?? null,
        weight: dep.weight ?? 1,
      } as NewGoalDependency)
      .execute()
  }
}

async function dependenciesMet(
  goalId: number,
  userId: number,
): Promise<boolean> {
  const deps = await db
    .selectFrom('goal_dependencies')
    .where('goal_id', '=', goalId)
    .selectAll()
    .execute()
  if (deps.length === 0) return true

  for (const dep of deps) {
    const childGoal = await db
      .selectFrom('goals')
      .where('id', '=', dep.depends_on_goal_id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    if (!childGoal) return false

    const cycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', dep.depends_on_goal_id)
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst()
    if (!cycle) return false

    if (dep.requirement === 'complete') {
      const targetMet =
        Number(cycle.target_value) > 0 &&
        Number(cycle.current_value) >= Number(cycle.target_value)
      if (
        cycle.status !== 'succeeded' &&
        childGoal.status !== 'completed' &&
        !targetMet
      ) {
        return false
      }
    } else {
      const threshold = dep.threshold ?? Number(cycle.target_value)
      if (Number(cycle.current_value) < Number(threshold)) return false
    }
  }
  return true
}

function withGoalRelations(goal: GoalRow) {
  const config = parseJson<GoalConfig>(goal.config) ?? {}
  const recurrence = parseJson<GoalRecurrenceConfig>(goal.recurrence)
  const deadline = parseJson<GoalDeadlineConfig>(goal.deadline)
  const now = new Date()

  return {
    ...goal,
    target_value: asNumber(goal.target_value),
    startsAt: new Date(goal.starts_at).toISOString(),
    lifecyclePhase: lifecyclePhase(goal, now),
    config,
    recurrence,
    deadline,
    links: async () => {
      const rows = await db
        .selectFrom('goal_links')
        .where('goal_id', '=', goal.id)
        .selectAll()
        .execute()
      return rows.map((link) => ({
        ...mapLinkScalars(link),
        activity: async () => {
          if (link.activity_id == null) return null
          return await db
            .selectFrom('activities')
            .where('id', '=', link.activity_id)
            .selectAll()
            .executeTakeFirst() ?? null
        },
        group: async () => {
          if (link.group_id == null) return null
          return await db
            .selectFrom('groups')
            .where('id', '=', link.group_id)
            .selectAll()
            .executeTakeFirst() ?? null
        },
      }))
    },
    activeCycle: async () => {
      let cycle = await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', goal.id)
        .where('status', '=', 'active')
        .orderBy('cycle_index', 'desc')
        .selectAll()
        .executeTakeFirst()
      if (cycle && goal.status === 'active') {
        cycle = await rollOverIfNeeded(db, goal, cycle)
      }
      // Fall back to latest cycle so completed / mid-window succeeded cycles
      // still expose progress. Also repair recurring cycles that were closed
      // early (before ends_at) so they remain the active window.
      if (!cycle) {
        const latest = await db
          .selectFrom('goal_cycles')
          .where('goal_id', '=', goal.id)
          .orderBy('cycle_index', 'desc')
          .selectAll()
          .executeTakeFirst()
        if (
          latest &&
          goal.status === 'active' &&
          goal.recurrence != null &&
          latest.status === 'succeeded' &&
          (!latest.ends_at || now < new Date(latest.ends_at))
        ) {
          cycle = await db
            .updateTable('goal_cycles')
            .set({ status: 'active', updated_at: now.toISOString() })
            .where('id', '=', latest.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        } else {
          cycle = latest
        }
      }
      if (!cycle) return null
      const state = deadlineState(cycle, deadline)
      const target = asNumber(cycle.target_value)
      const current = asNumber(cycle.current_value)
      return {
        ...mapCycleScalars(cycle),
        deadlineState: state,
        percentComplete: target > 0 ? Math.min(1, current / target) : 0,
        remaining: Math.max(0, target - current),
      }
    },
    cycles: async () => {
      const rows = await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', goal.id)
        .orderBy('cycle_index', 'asc')
        .selectAll()
        .execute()
      return rows.map(mapCycleScalars)
    },
    dependencies: async () => {
      const rows = await db
        .selectFrom('goal_dependencies')
        .where('goal_id', '=', goal.id)
        .selectAll()
        .execute()
      return rows.map((dep) => ({
        ...mapDependencyScalars(dep),
        dependsOn: async () => {
          const g = await db
            .selectFrom('goals')
            .where('id', '=', dep.depends_on_goal_id)
            .selectAll()
            .executeTakeFirst()
          return g ? withGoalRelations(g) : null
        },
      }))
    },
    snapshots: async () => {
      const cycle = await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', goal.id)
        .where('status', '=', 'active')
        .orderBy('cycle_index', 'desc')
        .selectAll()
        .executeTakeFirst()
      if (!cycle) return []
      const rows = await db
        .selectFrom('goal_progress_snapshots')
        .where('goal_cycle_id', '=', cycle.id)
        .orderBy('as_of', 'asc')
        .selectAll()
        .execute()
      return rows.map(mapSnapshotScalars)
    },
    isLocked: async () => {
      if (!config.block_until_unlocked) return false
      return !(await dependenciesMet(goal.id, goal.user_id))
    },
  }
}

export const GoalQuery = {
  goals: async (args?: { status?: string }) => {
    const userId = requireUserId()
    await rollOverUserGoals(db, userId)

    let query = db
      .selectFrom('goals')
      .where('user_id', '=', userId)
      .orderBy('priority', 'desc')
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'desc')
      .selectAll()

    if (args?.status) {
      query = query.where('status', '=', args.status as GoalRow['status'])
    }

    const rows = await query.execute()
    return rows.map(withGoalRelations)
  },

  goal: async (args: { id: number }) => {
    const userId = requireUserId()
    await rollOverUserGoals(db, userId)
    const row = await db
      .selectFrom('goals')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? withGoalRelations(row) : null
  },

  goalNudges: async (args?: Record<string, never>) => {
    void args
    const userId = requireUserId()
    await rollOverUserGoals(db, userId)
    const goals = await db
      .selectFrom('goals')
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .selectAll()
      .execute()

    const pairs = []
    for (const goal of goals) {
      const cycle = await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', goal.id)
        .where('status', '=', 'active')
        .orderBy('cycle_index', 'desc')
        .selectAll()
        .executeTakeFirst()
      pairs.push({ goal, cycle: cycle ?? null })
    }
    return buildGoalNudges(pairs)
  },

  dailyProgress: async (args?: { date?: string }) => {
    const userId = requireUserId()
    const date = args?.date ?? new Date().toISOString().slice(0, 10)

    const completions = await db
      .selectFrom('activity_completions')
      .where('user_id', '=', userId)
      .where('occurrence_date', '=', date)
      .selectAll()
      .execute()

    const timeEvents = await db
      .selectFrom('goal_events')
      .where('user_id', '=', userId)
      .where('metric', '=', 'duration')
      .where('occurrence_date', '=', date)
      .selectAll()
      .execute()

    const minutesToday = timeEvents.reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    )

    // Streak: consecutive days ending today with >= 1 completion.
    let streak = 0
    const cursor = new Date(date + 'T00:00:00Z')
    for (let i = 0; i < 365; i++) {
      const day = cursor.toISOString().slice(0, 10)
      const row = await db
        .selectFrom('activity_completions')
        .where('user_id', '=', userId)
        .where('occurrence_date', '=', day)
        .select('id')
        .executeTakeFirst()
      if (!row) break
      streak++
      cursor.setUTCDate(cursor.getUTCDate() - 1)
    }

    return {
      date,
      completedCount: completions.length,
      minutesToday,
      streakDays: streak,
      completions,
    }
  },
}

export const GoalMutation = {
  createGoal: async (args: { input: CreateGoalInput }) => {
    const userId = requireUserId()
    const input = args.input
    const now = new Date()
    const validated = validateCreateGoalInput(input, now)

    const goal = await db.transaction().execute(async (trx) => {
      const created = await trx
        .insertInto('goals')
        .values({
          user_id: userId,
          title: validated.title,
          description: input.description ?? null,
          color: validated.color,
          icon: input.icon ?? null,
          rule_type: validated.ruleType,
          metric: input.metric,
          target_value: validated.targetValue,
          config: JSON.stringify(toConfigJson(input.config)),
          status: 'active',
          recurrence: validated.recurrence
            ? JSON.stringify(toRecurrenceJson(validated.recurrence))
            : null,
          deadline: validated.deadline
            ? JSON.stringify(toDeadlineJson(validated.deadline))
            : null,
          priority: input.priority ?? 0,
          sort_order: input.sortOrder ?? 0,
          starts_at: validated.startsAt.toISOString(),
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        } as NewGoal)
        .returningAll()
        .executeTakeFirstOrThrow()

      await replaceLinks(trx, created.id, userId, validated.links)
      await replaceDependencies(trx, created.id, userId, validated.dependencies)
      await createInitialCycle(trx, created, now)
      return created
    })

    await recomputeCycle(
      db,
      goal,
      (await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', goal.id)
        .selectAll()
        .executeTakeFirstOrThrow()),
      now,
    )

    return withGoalRelations(
      await db
        .selectFrom('goals')
        .where('id', '=', goal.id)
        .selectAll()
        .executeTakeFirstOrThrow(),
    )
  },

  updateGoal: async (args: { id: number; input: UpdateGoalInput }) => {
    const userId = requireUserId()
    const existing = await db
      .selectFrom('goals')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirstOrThrow()

    const nowDate = new Date()
    const validated = validateUpdateGoalInput(
      args.input,
      existing.rule_type,
      nowDate,
    )
    const input = args.input
    const now = nowDate.toISOString()

    const activeCycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', existing.id)
      .where('status', '=', 'active')
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst()

    let nextStartsAt: Date | undefined
    if (validated.startsAt !== undefined) {
      if (existing.status === 'completed' || existing.status === 'failed') {
        throw new InvalidGoalError(
          'cannot change startsAt on a completed or failed goal',
        )
      }
      if (validated.startsAt == null) {
        throw new InvalidGoalError('startsAt cannot be cleared; omit to leave unchanged')
      }
      nextStartsAt = validated.startsAt

      const closedCycles = await db
        .selectFrom('goal_cycles')
        .where('goal_id', '=', existing.id)
        .where('status', '!=', 'active')
        .select('id')
        .executeTakeFirst()

      // After cycle 0 has closed, start is frozen.
      if (closedCycles != null) {
        throw new InvalidGoalError(
          'cannot change startsAt after the first cycle has closed',
        )
      }

      const progressBegun =
        activeCycle != null && Number(activeCycle.current_value) > 0

      if (
        progressBegun &&
        nextStartsAt.getTime() > new Date(existing.starts_at).getTime()
      ) {
        if (!input.confirmStartsAtChange) {
          throw new InvalidGoalError(
            'moving startsAt later after progress requires confirmStartsAtChange',
          )
        }
      }
    }

    const effectiveStartsAt = nextStartsAt ?? new Date(existing.starts_at)
    const effectiveDeadline = validated.deadline !== undefined
      ? validated.deadline
      : (() => {
        const d = parseJson<GoalDeadlineConfig>(existing.deadline)
        if (!d) return null
        return {
          kind: d.kind,
          date: d.date,
          daysAfterCycleStart: d.days_after_cycle_start,
          graceDays: d.grace_days,
          warnDays: d.warn_days,
        }
      })()
    assertDeadlineAfterStart(effectiveStartsAt, effectiveDeadline)

    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable('goals')
        .set({
          ...(input.title != null
            ? { title: validateGoalTitle(input.title) }
            : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.color != null
            ? { color: validateGoalColor(input.color) }
            : {}),
          ...(input.icon !== undefined ? { icon: input.icon } : {}),
          ...(input.ruleType != null ? { rule_type: validated.ruleType } : {}),
          ...(input.metric != null ? { metric: input.metric } : {}),
          ...(input.targetValue != null
            ? { target_value: input.targetValue }
            : {}),
          ...(input.config !== undefined
            ? { config: JSON.stringify(toConfigJson(input.config)) }
            : {}),
          ...(input.status != null ? { status: input.status } : {}),
          ...(validated.recurrence !== undefined
            ? {
              recurrence: validated.recurrence
                ? JSON.stringify(toRecurrenceJson(validated.recurrence))
                : null,
            }
            : {}),
          ...(validated.deadline !== undefined
            ? {
              deadline: validated.deadline
                ? JSON.stringify(toDeadlineJson(validated.deadline))
                : null,
            }
            : {}),
          ...(nextStartsAt != null
            ? { starts_at: nextStartsAt.toISOString() }
            : {}),
          ...(input.priority != null ? { priority: input.priority } : {}),
          ...(input.sortOrder != null ? { sort_order: input.sortOrder } : {}),
          updated_at: now,
        })
        .where('id', '=', args.id)
        .where('user_id', '=', userId)
        .execute()

      if (validated.links) {
        await replaceLinks(trx, args.id, userId, validated.links)
      }
      if (validated.dependencies) {
        await replaceDependencies(trx, args.id, userId, validated.dependencies)
      }

      const goalAfter = await trx
        .selectFrom('goals')
        .where('id', '=', args.id)
        .selectAll()
        .executeTakeFirstOrThrow()

      const cycle = await trx
        .selectFrom('goal_cycles')
        .where('goal_id', '=', args.id)
        .where('status', '=', 'active')
        .orderBy('cycle_index', 'desc')
        .selectAll()
        .executeTakeFirst()

      if (cycle && nextStartsAt != null) {
        await rescheduleActiveCycle(trx, goalAfter, cycle, nextStartsAt, nowDate)
      } else if (cycle && input.targetValue != null) {
        await trx
          .updateTable('goal_cycles')
          .set({
            target_value: input.targetValue,
            updated_at: now,
          })
          .where('id', '=', cycle.id)
          .execute()
      } else if (
        cycle &&
        (validated.deadline !== undefined || validated.recurrence !== undefined) &&
        Number(cycle.current_value) === 0 &&
        cycle.cycle_index === 0
      ) {
        // Refresh bounds on unstarted cycle 0 when deadline/recurrence change.
        await rescheduleActiveCycle(
          trx,
          goalAfter,
          cycle,
          new Date(goalAfter.starts_at),
          nowDate,
        )
      }
    })

    const goal = await db
      .selectFrom('goals')
      .where('id', '=', args.id)
      .selectAll()
      .executeTakeFirstOrThrow()
    const cycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', goal.id)
      .where('status', '=', 'active')
      .selectAll()
      .executeTakeFirst()
    if (cycle) await recomputeCycle(db, goal, cycle, nowDate)

    return withGoalRelations(goal)
  },

  pauseGoal: async (args: { id: number }) => {
    const userId = requireUserId()
    const goal = await db
      .updateTable('goals')
      .set({ status: 'paused', updated_at: new Date().toISOString() })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .where('status', '=', 'active')
      .returningAll()
      .executeTakeFirstOrThrow()
    return withGoalRelations(goal)
  },

  resumeGoal: async (args: { id: number }) => {
    const userId = requireUserId()
    const goal = await db
      .updateTable('goals')
      .set({ status: 'active', updated_at: new Date().toISOString() })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .where('status', '=', 'paused')
      .returningAll()
      .executeTakeFirstOrThrow()
    return withGoalRelations(goal)
  },

  archiveGoal: async (args: { id: number }) => {
    const userId = requireUserId()
    const goal = await db
      .updateTable('goals')
      .set({ status: 'archived', updated_at: new Date().toISOString() })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return withGoalRelations(goal)
  },

  deleteGoal: async (args: { id: number }) => {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('goals')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .execute()
    return result.length > 0
  },

  recomputeGoalProgress: async (args?: Record<string, never>) => {
    void args
    const userId = requireUserId()
    const count = await recomputeAllActiveCycles(db, userId)
    return { recomputed: count }
  },
}
