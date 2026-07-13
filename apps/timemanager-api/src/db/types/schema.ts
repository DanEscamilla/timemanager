import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

// Main Database interface that describes all tables
export interface Database {
  users: UsersTable
  groups: GroupsTable
  activities: ActivitiesTable
  recurrence_patterns: RecurrencePatternsTable
  activity_completions: ActivityCompletionsTable
  goal_events: GoalEventsTable
  goals: GoalsTable
  goal_links: GoalLinksTable
  goal_cycles: GoalCyclesTable
  goal_dependencies: GoalDependenciesTable
  goal_progress_snapshots: GoalProgressSnapshotsTable
}

// Users table interface
export interface UsersTable {
  id: Generated<number>
  email: string
  password_hash: string | null
  /** SuperTokens user id — links SSO identity to local rows. */
  auth_user_id: string | null
  name: string
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

// Groups table interface — user-scoped activity taxonomy with display color.
export interface GroupsTable {
  id: Generated<number>
  user_id: number
  name: string
  // Hex color from the shared preset palette, e.g. "#0F766E"
  color: string
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

// Activities table interface
export interface ActivitiesTable {
  id: Generated<number>
  user_id: number
  // Optional group assignment. Null when ungrouped; cleared if the group
  // is deleted (ON DELETE SET NULL).
  group_id: number | null
  title: string
  description: string | null
  start_time: string // Time of day in HH:mm format
  end_time: string // Time of day in HH:mm format
  is_recurring: boolean
  // Calendar date the activity occurs on. Required when is_recurring is
  // false; null when is_recurring is true (dates live in the recurrence
  // pattern's config instead).
  date: string | null
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

// Recurrence patterns table interface
export interface RecurrencePatternsTable {
  id: Generated<number>
  activity_id: number
  // Type of recurrence: weekly, monthly, or every X days
  recurrence_type: 'weekly' | 'monthly' | 'every_x_days'
  // JSON configuration for the recurrence
  config: ColumnType<{
    // For weekly: array of days (0-6, where 0 is Sunday)
    days_of_week?: number[]
    // For monthly: days of the month (1-31)
    days_of_month?: number[]
    // For monthly: also repeat on the last day of the month. Kept as its
    // own boolean (rather than a 'last' sentinel in days_of_month) because
    // Pylon/GraphQL input types can't represent a number|string union.
    is_last_day_of_month?: boolean
    // For every_x_days: repeat every N days (>= 1)
    interval_days?: number
    // Start date of the recurrence
    start_date: string
    // End date of the recurrence (optional)
    end_date?: string | null
  }, string, string>
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

// Activity completions — one row per (activity, occurrence_date)
export interface ActivityCompletionsTable {
  id: Generated<number>
  activity_id: number
  user_id: number
  occurrence_date: string
  duration_minutes: number | null
  completed_at: ColumnType<Date, string, never>
  // Store any additional data about the completion
  metadata: ColumnType<{
    title?: string
    notes?: string
    trigger_events?: string[]
  } | null, string | null, string | null>
}

export type GoalEventSourceType = 'completion' | 'time_log' | 'manual'
export type GoalEventMetric = 'count' | 'duration'

export interface GoalEventsTable {
  id: Generated<number>
  user_id: number
  source_type: GoalEventSourceType
  activity_id: number | null
  group_id: number | null
  completion_id: number | null
  occurred_at: ColumnType<Date, string, never>
  occurrence_date: string | null
  metric: GoalEventMetric
  amount: number
  metadata: ColumnType<Record<string, unknown> | null, string | null, string | null>
  created_at: ColumnType<Date, string | undefined, never>
}

export type GoalStatus = 'active' | 'paused' | 'completed' | 'archived' | 'failed'
export type GoalMetric = 'count' | 'duration'

export interface GoalRecurrenceConfig {
  period: 'weekly' | 'monthly' | 'quarterly' | 'every_x_days'
  interval?: number
  anchor?: string
  carry_over?: 'none' | 'overflow'
  reset?: 'hard'
}

export interface GoalDeadlineConfig {
  kind: 'absolute' | 'relative'
  date?: string
  days_after_cycle_start?: number
  grace_days?: number
  warn_days?: number
}

export interface GoalConfig {
  composite_mode?: 'all' | 'any' | 'weighted'
  count_required?: number
  before_time?: string
  after_time?: string
  block_until_unlocked?: boolean
  [key: string]: unknown
}

export interface GoalsTable {
  id: Generated<number>
  user_id: number
  title: string
  description: string | null
  color: string
  icon: string | null
  rule_type: string
  metric: GoalMetric
  target_value: number
  config: ColumnType<GoalConfig, string | GoalConfig, string | GoalConfig>
  status: GoalStatus
  recurrence: ColumnType<
    GoalRecurrenceConfig | null,
    string | GoalRecurrenceConfig | null,
    string | GoalRecurrenceConfig | null
  >
  deadline: ColumnType<
    GoalDeadlineConfig | null,
    string | GoalDeadlineConfig | null,
    string | GoalDeadlineConfig | null
  >
  priority: number
  sort_order: number
  /** Effective start of the goal (seeds cycle 0). Always set. */
  starts_at: ColumnType<Date, string, string>
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export type GoalLinkType = 'activity' | 'group'

export interface GoalLinksTable {
  id: Generated<number>
  goal_id: number
  link_type: GoalLinkType
  activity_id: number | null
  group_id: number | null
  weight: number
  created_at: ColumnType<Date, string | undefined, never>
}

export type GoalCycleStatus = 'active' | 'succeeded' | 'failed' | 'missed'

export interface GoalCyclesTable {
  id: Generated<number>
  goal_id: number
  cycle_index: number
  starts_at: ColumnType<Date, string, string>
  ends_at: ColumnType<Date | null, string | null, string | null>
  deadline_at: ColumnType<Date | null, string | null, string | null>
  target_value: number
  current_value: number
  status: GoalCycleStatus
  carry_over: number
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export type GoalDependencyRequirement = 'complete' | 'progress'

export interface GoalDependenciesTable {
  id: Generated<number>
  goal_id: number
  depends_on_goal_id: number
  requirement: GoalDependencyRequirement
  threshold: number | null
  weight: number
  created_at: ColumnType<Date, string | undefined, never>
}

export interface GoalProgressSnapshotsTable {
  id: Generated<number>
  goal_cycle_id: number
  as_of: string
  value: number
  created_at: ColumnType<Date, string | undefined, never>
}

// Export convenience types for each table
export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>

export type Group = Selectable<GroupsTable>
export type NewGroup = Insertable<GroupsTable>
export type GroupUpdate = Updateable<GroupsTable>

export type Activity = Selectable<ActivitiesTable>
export type NewActivity = Insertable<ActivitiesTable>
export type ActivityUpdate = Updateable<ActivitiesTable>

export type RecurrencePattern = Selectable<RecurrencePatternsTable>
export type NewRecurrencePattern = Insertable<RecurrencePatternsTable>
export type RecurrencePatternUpdate = Updateable<RecurrencePatternsTable>

export type ActivityCompletion = Selectable<ActivityCompletionsTable>
export type NewActivityCompletion = Insertable<ActivityCompletionsTable>
export type ActivityCompletionUpdate = Updateable<ActivityCompletionsTable>

export type GoalEvent = Selectable<GoalEventsTable>
export type NewGoalEvent = Insertable<GoalEventsTable>
export type GoalEventUpdate = Updateable<GoalEventsTable>

export type Goal = Selectable<GoalsTable>
export type NewGoal = Insertable<GoalsTable>
export type GoalUpdate = Updateable<GoalsTable>

export type GoalLink = Selectable<GoalLinksTable>
export type NewGoalLink = Insertable<GoalLinksTable>
export type GoalLinkUpdate = Updateable<GoalLinksTable>

export type GoalCycle = Selectable<GoalCyclesTable>
export type NewGoalCycle = Insertable<GoalCyclesTable>
export type GoalCycleUpdate = Updateable<GoalCyclesTable>

export type GoalDependency = Selectable<GoalDependenciesTable>
export type NewGoalDependency = Insertable<GoalDependenciesTable>
export type GoalDependencyUpdate = Updateable<GoalDependenciesTable>

export type GoalProgressSnapshot = Selectable<GoalProgressSnapshotsTable>
export type NewGoalProgressSnapshot = Insertable<GoalProgressSnapshotsTable>
export type GoalProgressSnapshotUpdate = Updateable<GoalProgressSnapshotsTable>
