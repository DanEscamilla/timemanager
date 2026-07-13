import type { Kysely, Transaction } from 'kysely';
import type {
  Database,
  Goal,
  GoalCycle,
  GoalEvent,
  GoalLink,
} from '../db/types/schema.ts';
import { cycleHasStarted } from './lifecycle.ts';
import { evaluateGoal } from './evaluators/index.ts';

type DbLike = Kysely<Database> | Transaction<Database>;

function parseJson<T>(value: unknown): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
  return (value ?? {}) as T;
}

export async function fetchGoalLinks(
  db: DbLike,
  goalId: number,
): Promise<GoalLink[]> {
  return await db
    .selectFrom('goal_links')
    .where('goal_id', '=', goalId)
    .selectAll()
    .execute();
}

export async function fetchEventsForUser(
  db: DbLike,
  userId: number,
  from?: Date | string,
  to?: Date | string,
): Promise<GoalEvent[]> {
  let query = db
    .selectFrom('goal_events')
    .where('user_id', '=', userId)
    .selectAll();

  if (from) {
    const fromDate = typeof from === 'string' ? new Date(from) : from;
    query = query.where('occurred_at', '>=', fromDate as never);
  }
  if (to) {
    const toDate = typeof to === 'string' ? new Date(to) : to;
    query = query.where('occurred_at', '<', toDate as never);
  }

  return await query.execute();
}

async function groupActivityIdsForLinks(
  db: DbLike,
  links: GoalLink[],
  userId: number,
): Promise<number[]> {
  const groupIds = links
    .filter((l) => l.link_type === 'group' && l.group_id != null)
    .map((l) => l.group_id!);
  if (groupIds.length === 0) return [];

  const rows = await db
    .selectFrom('activities')
    .where('user_id', '=', userId)
    .where('group_id', 'in', groupIds)
    .select('id')
    .execute();
  return rows.map((r) => r.id);
}

async function fetchChildCycles(
  db: DbLike,
  goalId: number,
): Promise<{ cycles: Map<number, GoalCycle>; weights: Map<number, number> }> {
  const deps = await db
    .selectFrom('goal_dependencies')
    .where('goal_id', '=', goalId)
    .selectAll()
    .execute();

  const cycles = new Map<number, GoalCycle>();
  const weights = new Map<number, number>();

  for (const dep of deps) {
    weights.set(dep.depends_on_goal_id, Number(dep.weight));
    const cycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', dep.depends_on_goal_id)
      .where('status', '=', 'active')
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst();

    if (cycle) {
      cycles.set(dep.depends_on_goal_id, cycle);
      continue;
    }

    const latest = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', dep.depends_on_goal_id)
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst();
    if (latest) cycles.set(dep.depends_on_goal_id, latest);
  }

  return { cycles, weights };
}

/**
 * Whether hitting the target should close the cycle immediately.
 * Recurring cycles stay `active` until roll-over at ends_at so the UI keeps
 * an activeCycle (and progress) for the rest of the window.
 */
export function shouldCloseCycleOnTarget(
  goal: Pick<Goal, 'recurrence'>,
): boolean {
  return goal.recurrence == null;
}

/**
 * Recompute and persist current_value for a single cycle.
 * Returns the updated cycle.
 * Skips accrual while the cycle has not started (keeps current_value at 0,
 * never auto-succeeds) — covers composite parents completing early via children.
 */
export async function recomputeCycle(
  db: DbLike,
  goal: Goal,
  cycle: GoalCycle,
  now: Date = new Date(),
): Promise<GoalCycle> {
  if (cycle.status === 'active' && !cycleHasStarted(cycle, now)) {
    if (Number(cycle.current_value) === 0) return cycle;
    const stamped = now.toISOString();
    return await db
      .updateTable('goal_cycles')
      .set({ current_value: 0, updated_at: stamped })
      .where('id', '=', cycle.id)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  const links = await fetchGoalLinks(db, goal.id);
  const events = await fetchEventsForUser(
    db,
    goal.user_id,
    cycle.starts_at,
    cycle.ends_at ?? undefined,
  );
  const groupActivityIds = await groupActivityIdsForLinks(
    db,
    links,
    goal.user_id,
  );
  const { cycles: childCycles, weights: childWeights } =
    goal.rule_type === 'composite'
      ? await fetchChildCycles(db, goal.id)
      : {
          cycles: new Map<number, GoalCycle>(),
          weights: new Map<number, number>(),
        };

  const { currentValue, done } = evaluateGoal({
    goal: {
      ...goal,
      config: parseJson(goal.config),
    },
    cycle,
    links,
    events,
    childCycles,
    childWeights,
    groupActivityIds,
  });

  const nowIso = now.toISOString();
  let status = cycle.status;
  // One-time goals close as soon as the target is met. Recurring cycles stay
  // active until rollOverIfNeeded closes them at ends_at — otherwise
  // activeCycle goes null mid-window and the client shows 0% progress.
  if (
    cycle.status === 'active' &&
    done &&
    shouldCloseCycleOnTarget(goal)
  ) {
    status = 'succeeded';
  }

  const updated = await db
    .updateTable('goal_cycles')
    .set({
      current_value: currentValue,
      status,
      updated_at: nowIso,
    })
    .where('id', '=', cycle.id)
    .returningAll()
    .executeTakeFirstOrThrow();

  // Daily snapshot for history charts (upsert by as_of date).
  const asOf = nowIso.slice(0, 10);
  await db
    .insertInto('goal_progress_snapshots')
    .values({
      goal_cycle_id: updated.id,
      as_of: asOf,
      value: currentValue,
    })
    .onConflict((oc) =>
      oc.columns(['goal_cycle_id', 'as_of']).doUpdateSet({
        value: currentValue,
      }),
    )
    .execute();

  // Mark parent goal completed when a one-time cycle succeeds.
  if (status === 'succeeded' && !goal.recurrence && goal.status === 'active') {
    await db
      .updateTable('goals')
      .set({ status: 'completed', updated_at: nowIso })
      .where('id', '=', goal.id)
      .execute();
  }

  return updated;
}

/** Recompute all active cycles linked to an activity or group via goal_links. */
export async function recomputeAffectedCycles(
  db: DbLike,
  userId: number,
  opts: { activityId?: number | null; groupId?: number | null },
): Promise<void> {
  const goalIds = new Set<number>();

  if (opts.activityId != null) {
    const rows = await db
      .selectFrom('goal_links')
      .innerJoin('goals', 'goals.id', 'goal_links.goal_id')
      .where('goals.user_id', '=', userId)
      .where('goal_links.activity_id', '=', opts.activityId)
      .select('goal_links.goal_id')
      .execute();
    for (const r of rows) goalIds.add(r.goal_id);
  }

  if (opts.groupId != null) {
    const rows = await db
      .selectFrom('goal_links')
      .innerJoin('goals', 'goals.id', 'goal_links.goal_id')
      .where('goals.user_id', '=', userId)
      .where('goal_links.group_id', '=', opts.groupId)
      .select('goal_links.goal_id')
      .execute();
    for (const r of rows) goalIds.add(r.goal_id);
  }

  // Also recompute composites that depend on affected goals.
  if (goalIds.size > 0) {
    const deps = await db
      .selectFrom('goal_dependencies')
      .where('depends_on_goal_id', 'in', [...goalIds])
      .select('goal_id')
      .execute();
    for (const d of deps) goalIds.add(d.goal_id);
  }

  for (const goalId of goalIds) {
    const goal = await db
      .selectFrom('goals')
      .where('id', '=', goalId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst();
    if (!goal || goal.status === 'paused' || goal.status === 'archived')
      continue;

    const cycle = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', goalId)
      .where('status', '=', 'active')
      .orderBy('cycle_index', 'desc')
      .selectAll()
      .executeTakeFirst();
    if (!cycle) continue;

    await recomputeCycle(db, goal, cycle);
  }
}

/** Full recompute of every active cycle for a user (repair path). */
export async function recomputeAllActiveCycles(
  db: DbLike,
  userId: number,
): Promise<number> {
  const goals = await db
    .selectFrom('goals')
    .where('user_id', '=', userId)
    .where('status', 'in', ['active', 'completed', 'failed'])
    .selectAll()
    .execute();

  let count = 0;
  for (const goal of goals) {
    const cycles = await db
      .selectFrom('goal_cycles')
      .where('goal_id', '=', goal.id)
      .where('status', '=', 'active')
      .selectAll()
      .execute();
    for (const cycle of cycles) {
      await recomputeCycle(db, goal, cycle);
      count++;
    }
  }
  return count;
}
