export interface Context {
  userId: number
}

export interface RecurrenceConfig {
  days_interval?: number
  days_of_week?: number[]
  days_of_month?: number[]
  is_last_day_of_month?: boolean
  months?: number[]
  custom_interval?: number
  start_date: string
  end_date?: string | null
}

export interface CreateActivityInput {
  title: string
  description?: string | null
  startTime: string
  endTime: string
  isRecurring: boolean
  recurrencePattern?: {
    recurrenceType: 'daily' | 'weekly' | 'monthly' | 'custom'
    config: RecurrenceConfig
  }
}

export interface UpdateActivityInput {
  title?: string
  description?: string | null
  startTime?: string
  endTime?: string
  isRecurring?: boolean
  recurrencePattern?: {
    recurrenceType: 'daily' | 'weekly' | 'monthly' | 'custom'
    config: RecurrenceConfig
  }
} 