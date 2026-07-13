import type { Goal, GoalCycle } from '../db/types/schema.ts'

export type GoalLifecyclePhase =
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'archived'
  | 'failed'

/** Derived UI/API phase — scheduled is not a stored status. */
export function lifecyclePhase(
  goal: Pick<Goal, 'status' | 'starts_at'>,
  now: Date = new Date(),
): GoalLifecyclePhase {
  if (goal.status === 'paused') return 'paused'
  if (goal.status === 'completed') return 'completed'
  if (goal.status === 'archived') return 'archived'
  if (goal.status === 'failed') return 'failed'
  if (goal.status === 'active' && new Date(goal.starts_at) > now) {
    return 'scheduled'
  }
  return 'active'
}

/** True when the cycle evaluation window has begun. */
export function cycleHasStarted(
  cycle: Pick<GoalCycle, 'starts_at'>,
  now: Date = new Date(),
): boolean {
  return now >= new Date(cycle.starts_at)
}
