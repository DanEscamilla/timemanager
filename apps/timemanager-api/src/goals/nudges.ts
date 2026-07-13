import type { Goal, GoalCycle, GoalDeadlineConfig } from '../db/types/schema.ts'
import { deadlineState } from './cycles.ts'

export type GoalNudgeKind =
  | 'deadline_approaching'
  | 'deadline_overdue'
  | 'behind_pace'
  | 'cycle_complete'
  | 'dependency_unlocked'
  | 'goal_starting_soon'

export interface GoalNudge {
  kind: GoalNudgeKind
  goalId: number
  title: string
  message: string
  severity: 'info' | 'warning' | 'success'
}

function parseDeadline(value: unknown): GoalDeadlineConfig | null {
  if (value == null) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as GoalDeadlineConfig
    } catch {
      return null
    }
  }
  return value as GoalDeadlineConfig
}

const STARTING_SOON_DAYS = 3

/**
 * Build in-app nudges for dashboard / notifications surface.
 * Pure function — no I/O.
 * Skips deadline/behind_pace for goals that have not started yet.
 */
export function buildGoalNudges(
  goals: Array<{ goal: Goal; cycle: GoalCycle | null }>,
  now: Date = new Date(),
): GoalNudge[] {
  const nudges: GoalNudge[] = []

  for (const { goal, cycle } of goals) {
    if (!cycle || goal.status !== 'active') continue

    const startsAt = new Date(goal.starts_at)
    if (startsAt > now) {
      const msUntil = startsAt.getTime() - now.getTime()
      const daysUntil = msUntil / (24 * 60 * 60 * 1000)
      if (daysUntil <= STARTING_SOON_DAYS) {
        const daysLabel = Math.max(1, Math.ceil(daysUntil))
        nudges.push({
          kind: 'goal_starting_soon',
          goalId: goal.id,
          title: goal.title,
          message: `“${goal.title}” starts in ${daysLabel} day${
            daysLabel === 1 ? '' : 's'
          }.`,
          severity: 'info',
        })
      }
      continue
    }

    const targetMet =
      cycle.status === 'succeeded' ||
      (Number(cycle.target_value) > 0 &&
        Number(cycle.current_value) >= Number(cycle.target_value))
    if (targetMet) {
      nudges.push({
        kind: 'cycle_complete',
        goalId: goal.id,
        title: goal.title,
        message: `You completed “${goal.title}” for this cycle.`,
        severity: 'success',
      })
      continue
    }

    const deadline = parseDeadline(goal.deadline)
    const state = deadlineState(cycle, deadline, now)
    if (state === 'approaching') {
      nudges.push({
        kind: 'deadline_approaching',
        goalId: goal.id,
        title: goal.title,
        message: `Deadline for “${goal.title}” is approaching.`,
        severity: 'warning',
      })
    } else if (state === 'overdue') {
      nudges.push({
        kind: 'deadline_overdue',
        goalId: goal.id,
        title: goal.title,
        message: `“${goal.title}” is past its deadline.`,
        severity: 'warning',
      })
    }

    // Behind-pace for recurring cycles with a known end.
    if (cycle.ends_at && Number(cycle.target_value) > 0) {
      const start = new Date(cycle.starts_at).getTime()
      const end = new Date(cycle.ends_at).getTime()
      const span = Math.max(1, end - start)
      const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / span))
      const expected = elapsed * Number(cycle.target_value)
      const actual = Number(cycle.current_value)
      if (elapsed >= 0.35 && actual < expected * 0.7) {
        nudges.push({
          kind: 'behind_pace',
          goalId: goal.id,
          title: goal.title,
          message: `“${goal.title}” is behind pace this cycle.`,
          severity: 'info',
        })
      }
    }
  }

  return nudges
}
