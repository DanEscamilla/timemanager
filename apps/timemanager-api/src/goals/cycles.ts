import type { Kysely, Transaction } from 'kysely'
import type {
  Database,
  Goal,
  GoalCycle,
  GoalDeadlineConfig,
  GoalRecurrenceConfig,
  NewGoalCycle,
} from '../db/types/schema.ts'
import { recomputeCycle } from './progress.ts'

type DbLike = Kysely<Database> | Transaction<Database>

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

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setUTCDate(d.getUTCDate() + days)
  return d
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export function computeCycleEnd(
  startsAt: Date,
  recurrence: GoalRecurrenceConfig | null,
): Date | null {
  if (!recurrence) return null
  const interval = Math.max(1, recurrence.interval ?? 1)
  switch (recurrence.period) {
    case 'weekly':
      return addDays(startsAt, 7 * interval)
    case 'monthly':
      return addMonths(startsAt, interval)
    case 'quarterly':
      return addMonths(startsAt, 3 * interval)
    case 'every_x_days':
      return addDays(startsAt, interval)
    default:
      return null
  }
}

export function computeDeadlineAt(
  startsAt: Date,
  deadline: GoalDeadlineConfig | null,
): Date | null {
  if (!deadline) return null
  if (deadline.kind === 'absolute' && deadline.date) {
    return new Date(deadline.date + 'T23:59:59.999Z')
  }
  if (deadline.kind === 'relative' && deadline.days_after_cycle_start != null) {
    return addDays(startsAt, deadline.days_after_cycle_start)
  }
  return null
}

export type DeadlineState = 'on_track' | 'approaching' | 'overdue' | 'failed'

export function deadlineState(
  cycle: GoalCycle,
  deadline: GoalDeadlineConfig | null,
  now: Date = new Date(),
): DeadlineState {
  if (!cycle.deadline_at) return 'on_track'
  const deadlineAt = new Date(cycle.deadline_at)
  const grace = deadline?.grace_days ?? 0
  const warn = deadline?.warn_days ?? 3
  const graceEnd = addDays(deadlineAt, grace)

  if (Number(cycle.current_value) >= Number(cycle.target_value)) {
    return 'on_track'
  }
  if (now > graceEnd) return 'failed'
  if (now > deadlineAt) return 'overdue'
  const warnStart = addDays(deadlineAt, -warn)
  if (now >= warnStart) return 'approaching'
  return 'on_track'
}

function dateOnlyIso(date: Date): string {
  return date.toISOString().slice(0, 10)
}

async function writeSnapshot(
  db: DbLike,
  cycle: GoalCycle,
  asOf: Date,
): Promise<void> {
  const asOfStr = dateOnlyIso(asOf)
  await db
    .insertInto('goal_progress_snapshots')
    .values({
      goal_cycle_id: cycle.id,
      as_of: asOfStr,
      value: Number(cycle.current_value),
    })
    .onConflict((oc) =>
      oc.columns(['goal_cycle_id', 'as_of']).doUpdateSet({
        value: Number(cycle.current_value),
      })
    )
    .execute()
}

/**
 * Create the first cycle for a newly created goal.
 */
export async function createInitialCycle(
  db: DbLike,
  goal: Goal,
  now: Date = new Date(),
): Promise<GoalCycle> {
  const recurrence = parseJson<GoalRecurrenceConfig>(goal.recurrence)
  const deadline = parseJson<GoalDeadlineConfig>(goal.deadline)
  const startsAt = now
  const endsAt = computeCycleEnd(startsAt, recurrence)
  const deadlineAt = computeDeadlineAt(startsAt, deadline)

  return await db
    .insertInto('goal_cycles')
    .values({
      goal_id: goal.id,
      cycle_index: 0,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      deadline_at: deadlineAt ? deadlineAt.toISOString() : null,
      target_value: Number(goal.target_value),
      current_value: 0,
      status: 'active',
      carry_over: 0,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    } as NewGoalCycle)
    .returningAll()
    .executeTakeFirstOrThrow()
}

/**
 * Close an active cycle and open the next one when recurrence applies.
 * Uses lazy-on-read: call before returning goals to the client.
 */
export async function rollOverIfNeeded(
  db: DbLike,
  goal: Goal,
  cycle: GoalCycle,
  now: Date = new Date(),
): Promise<GoalCycle> {
  const recurrence = parseJson<GoalRecurrenceConfig>(goal.recurrence)
  if (!recurrence || !cycle.ends_at) {
    // One-time: maybe fail on deadline grace.
    const deadline = parseJson<GoalDeadlineConfig>(goal.deadline)
    const state = deadlineState(cycle, deadline, now)
    if (cycle.status === 'active' && state === 'failed') {
      const updated = await db
        .updateTable('goal_cycles')
        .set({
          status: 'failed',
          updated_at: now.toISOString(),
        })
        .where('id', '=', cycle.id)
        .returningAll()
        .executeTakeFirstOrThrow()
      await db
        .updateTable('goals')
        .set({ status: 'failed', updated_at: now.toISOString() })
        .where('id', '=', goal.id)
        .execute()
      await writeSnapshot(db, updated, now)
      return updated
    }
    return cycle
  }

  if (cycle.status !== 'active') return cycle
  if (now < new Date(cycle.ends_at)) return cycle

  // Recompute one last time before closing.
  let closed = await recomputeCycle(db, goal, cycle)
  const met = Number(closed.current_value) >= Number(closed.target_value)
  const deadline = parseJson<GoalDeadlineConfig>(goal.deadline)
  const state = deadlineState(closed, deadline, new Date(cycle.ends_at))

  let closeStatus: GoalCycle['status'] = met
    ? 'succeeded'
    : state === 'failed' || state === 'overdue'
    ? 'failed'
    : 'missed'

  // Back-fill missed intermediate cycles if we skipped multiple windows.
  let cursorStart = new Date(cycle.starts_at)
  let cursorEnd = new Date(cycle.ends_at)
  let cycleIndex = cycle.cycle_index
  let carry = 0

  if (
    recurrence.carry_over === 'overflow' &&
    Number(closed.current_value) > Number(closed.target_value)
  ) {
    carry = Number(closed.current_value) - Number(closed.target_value)
  }

  closed = await db
    .updateTable('goal_cycles')
    .set({
      status: closeStatus,
      updated_at: now.toISOString(),
    })
    .where('id', '=', closed.id)
    .returningAll()
    .executeTakeFirstOrThrow()
  await writeSnapshot(db, closed, cursorEnd)

  // Fill gaps until we reach a cycle that contains `now`.
  while (cursorEnd <= now) {
    const nextStart = cursorEnd
    const nextEnd = computeCycleEnd(nextStart, recurrence)
    if (!nextEnd) break

    cycleIndex += 1

    // If this intermediate window is already fully in the past, mark missed.
    if (nextEnd <= now) {
      const missedDeadline = computeDeadlineAt(nextStart, deadline)
      const missed = await db
        .insertInto('goal_cycles')
        .values({
          goal_id: goal.id,
          cycle_index: cycleIndex,
          starts_at: nextStart.toISOString(),
          ends_at: nextEnd.toISOString(),
          deadline_at: missedDeadline ? missedDeadline.toISOString() : null,
          target_value: Number(goal.target_value),
          current_value: 0,
          status: 'missed',
          carry_over: 0,
          created_at: now.toISOString(),
          updated_at: now.toISOString(),
        } as NewGoalCycle)
        .returningAll()
        .executeTakeFirstOrThrow()
      await writeSnapshot(db, missed, nextEnd)
      cursorStart = nextStart
      cursorEnd = nextEnd
      carry = 0
      continue
    }

    // Active next cycle.
    const nextDeadline = computeDeadlineAt(nextStart, deadline)
    const next = await db
      .insertInto('goal_cycles')
      .values({
        goal_id: goal.id,
        cycle_index: cycleIndex,
        starts_at: nextStart.toISOString(),
        ends_at: nextEnd.toISOString(),
        deadline_at: nextDeadline ? nextDeadline.toISOString() : null,
        target_value: Number(goal.target_value),
        current_value: 0,
        status: 'active',
        carry_over: carry,
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      } as NewGoalCycle)
      .returningAll()
      .executeTakeFirstOrThrow()

    return await recomputeCycle(db, goal, next)
  }

  return closed
}

/** Roll over all active cycles for a user (lazy batch). */
export async function rollOverUserGoals(
  db: DbLike,
  userId: number,
  now: Date = new Date(),
): Promise<void> {
  const goals = await db
    .selectFrom('goals')
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'paused'])
    .selectAll()
    .execute()

  for (const goal of goals) {
    if (goal.status === 'paused') continue
    const cycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', goal.id)
      .where('status', '=', 'active')
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst()
    if (!cycle) continue
    await rollOverIfNeeded(db, goal, cycle, now)
  }
}
