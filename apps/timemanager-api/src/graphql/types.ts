export type RecurrenceType = 'weekly' | 'monthly' | 'every_x_days'

export interface RecurrenceConfig {
  // weekly: 0-6, Sunday is 0
  days_of_week?: number[]
  // monthly: days of the month, 1-31
  days_of_month?: number[]
  // monthly: also repeat on the last day of the month. Kept as its own
  // boolean (rather than a 'last' sentinel in days_of_month) because
  // Pylon/GraphQL input types can't represent a number|string union.
  is_last_day_of_month?: boolean
  // every_x_days: repeat every N days (>= 1)
  interval_days?: number
  start_date: string
  end_date?: string | null
}

export interface RecurrencePatternInput {
  recurrenceType: RecurrenceType
  config: RecurrenceConfig
}

export interface CreateGroupInput {
  name: string
  color: string
}

export interface UpdateGroupInput {
  name?: string
  color?: string
}

export interface CreateActivityInput {
  title: string
  description?: string | null
  startTime: string
  endTime: string
  isRecurring: boolean
  // Required when isRecurring is false; ignored when isRecurring is true.
  date?: string | null
  // Required when isRecurring is true; ignored when isRecurring is false.
  recurrencePattern?: RecurrencePatternInput | null
  // Optional group assignment (must belong to the same user).
  groupId?: number | null
}

export interface UpdateActivityInput {
  title?: string
  description?: string | null
  startTime?: string
  endTime?: string
  isRecurring?: boolean
  date?: string | null
  recurrencePattern?: RecurrencePatternInput | null
  // Pass null to clear the group assignment.
  groupId?: number | null
}

export interface CompleteActivityInput {
  activityId: number
  /** YYYY-MM-DD of the occurrence being completed. */
  occurrenceDate: string
  /** Optional actual duration in minutes. */
  durationMinutes?: number | null
  notes?: string | null
}

export interface LogTimeInput {
  activityId: number
  durationMinutes: number
  /** Optional YYYY-MM-DD; defaults to today (UTC). */
  occurrenceDate?: string | null
  notes?: string | null
}

export interface GoalLinkInput {
  linkType: 'activity' | 'group'
  activityId?: number | null
  groupId?: number | null
  weight?: number
}

export interface GoalDependencyInput {
  dependsOnGoalId: number
  requirement?: 'complete' | 'progress'
  threshold?: number | null
  weight?: number
}

export interface GoalRecurrenceInput {
  period: 'weekly' | 'monthly' | 'quarterly' | 'every_x_days'
  interval?: number
  anchor?: string
  carryOver?: 'none' | 'overflow'
  reset?: 'hard'
}

export interface GoalDeadlineInput {
  kind: 'absolute' | 'relative'
  date?: string
  daysAfterCycleStart?: number
  graceDays?: number
  warnDays?: number
}

export interface GoalConfigInput {
  compositeMode?: 'all' | 'any' | 'weighted'
  countRequired?: number
  beforeTime?: string
  afterTime?: string
  blockUntilUnlocked?: boolean
}

export interface CreateGoalInput {
  title: string
  description?: string | null
  color: string
  icon?: string | null
  ruleType: string
  metric: 'count' | 'duration'
  targetValue: number
  config?: GoalConfigInput | null
  links?: GoalLinkInput[]
  dependencies?: GoalDependencyInput[]
  recurrence?: GoalRecurrenceInput | null
  deadline?: GoalDeadlineInput | null
  /** ISO-8601; omit/null → server now. */
  startsAt?: string | null
  priority?: number
  sortOrder?: number
}

export interface UpdateGoalInput {
  title?: string
  description?: string | null
  color?: string
  icon?: string | null
  ruleType?: string
  metric?: 'count' | 'duration'
  targetValue?: number
  config?: GoalConfigInput | null
  links?: GoalLinkInput[]
  dependencies?: GoalDependencyInput[]
  recurrence?: GoalRecurrenceInput | null
  deadline?: GoalDeadlineInput | null
  /** ISO-8601 start timestamp. */
  startsAt?: string | null
  /** Required when moving start later after progress has begun. */
  confirmStartsAtChange?: boolean | null
  status?: 'active' | 'paused' | 'completed' | 'archived' | 'failed'
  priority?: number
  sortOrder?: number
}
