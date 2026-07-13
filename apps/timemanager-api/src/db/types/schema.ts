import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

// Main Database interface that describes all tables
export interface Database {
  users: UsersTable
  groups: GroupsTable
  activities: ActivitiesTable
  recurrence_patterns: RecurrencePatternsTable
  activity_completions: ActivityCompletionsTable
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

// Activity completions table interface
export interface ActivityCompletionsTable {
  id: Generated<number>
  activity_id: number
  completed_at: ColumnType<Date, string, never>
  // Store any additional data about the completion
  metadata: ColumnType<{
    title: string
    notes?: string
    duration?: number // actual duration in minutes
    trigger_events?: string[] // array of event identifiers that were triggered
  } | null, string | null, string | null>
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