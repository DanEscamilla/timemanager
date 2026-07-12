import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

// Main Database interface that describes all tables
export interface Database {
  users: UsersTable
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

// Activities table interface
export interface ActivitiesTable {
  id: Generated<number>
  user_id: number
  title: string
  description: string | null
  start_time: string // Time of day in HH:mm format
  end_time: string // Time of day in HH:mm format
  is_recurring: boolean
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

// Recurrence patterns table interface
export interface RecurrencePatternsTable {
  id: Generated<number>
  activity_id: number
  // Type of recurrence: daily, weekly, monthly, custom
  recurrence_type: 'daily' | 'weekly' | 'monthly' | 'custom'
  // JSON configuration for the recurrence
  config: ColumnType<{
    // For daily: every X days
    days_interval?: number
    // For weekly: array of days (0-6, where 0 is Sunday)
    days_of_week?: number[]
    // For monthly: day of month or 'last' for last day
    days_of_month?: (number | 'last')[]
    // For monthly: which months (1-12)
    months?: number[]
    // For custom: interval in days
    custom_interval?: number
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

export type Activity = Selectable<ActivitiesTable>
export type NewActivity = Insertable<ActivitiesTable>
export type ActivityUpdate = Updateable<ActivitiesTable>

export type RecurrencePattern = Selectable<RecurrencePatternsTable>
export type NewRecurrencePattern = Insertable<RecurrencePatternsTable>
export type RecurrencePatternUpdate = Updateable<RecurrencePatternsTable>

export type ActivityCompletion = Selectable<ActivityCompletionsTable>
export type NewActivityCompletion = Insertable<ActivityCompletionsTable>
export type ActivityCompletionUpdate = Updateable<ActivityCompletionsTable>  