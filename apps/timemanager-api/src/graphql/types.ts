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
