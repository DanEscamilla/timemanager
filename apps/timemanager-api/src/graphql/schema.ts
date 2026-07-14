import { gql } from 'graphql-tag'

/**
 * Documentation schema for the GraphQL API.
 * Pylon derives the runtime schema from resolver exports; keep this in sync
 * as a human-readable reference.
 */
export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
  }

  type Group {
    id: ID!
    userId: ID!
    name: String!
    color: String!
    createdAt: String!
    updatedAt: String!
  }

  type Activity {
    id: ID!
    userId: ID!
    title: String!
    description: String
    startTime: String!
    endTime: String!
    isRecurring: Boolean!
    date: String
    groupId: ID
    group: Group
    recurrencePattern: RecurrencePattern
    notificationOffsets: [Int!]!
    createdAt: String!
    updatedAt: String!
  }

  type RecurrencePattern {
    id: ID!
    activityId: ID!
    recurrenceType: RecurrenceType!
    config: RecurrenceConfig!
    createdAt: String!
    updatedAt: String!
  }

  enum RecurrenceType {
    weekly
    monthly
    every_x_days
  }

  type ActivityCompletion {
    id: ID!
    activityId: ID!
    userId: ID!
    occurrenceDate: String!
    durationMinutes: Int
    completedAt: String!
  }

  type GoalEvent {
    id: ID!
    userId: ID!
    sourceType: String!
    activityId: ID
    groupId: ID
    occurredAt: String!
    occurrenceDate: String
    metric: String!
    amount: Float!
  }

  type Goal {
    id: ID!
    userId: ID!
    title: String!
    description: String
    color: String!
    icon: String
    ruleType: String!
    metric: String!
    targetValue: Float!
    status: String!
    startsAt: String!
    lifecyclePhase: String!
    priority: Int!
    sortOrder: Int!
    createdAt: String!
    updatedAt: String!
    isLocked: Boolean
    activeCycle: GoalCycle
    links: [GoalLink!]
    dependencies: [GoalDependency!]
    snapshots: [GoalProgressSnapshot!]
    cycles: [GoalCycle!]
  }

  type GoalCycle {
    id: ID!
    goalId: ID!
    cycleIndex: Int!
    startsAt: String!
    endsAt: String
    deadlineAt: String
    targetValue: Float!
    currentValue: Float!
    status: String!
    carryOver: Float!
    deadlineState: String
    percentComplete: Float
    remaining: Float
  }

  type GoalLink {
    id: ID!
    goalId: ID!
    linkType: String!
    activityId: ID
    groupId: ID
    weight: Float!
    activity: Activity
    group: Group
  }

  type GoalDependency {
    id: ID!
    goalId: ID!
    dependsOnGoalId: ID!
    requirement: String!
    threshold: Float
    weight: Float!
    dependsOn: Goal
  }

  type GoalProgressSnapshot {
    id: ID!
    goalCycleId: ID!
    asOf: String!
    value: Float!
  }

  type GoalNudge {
    kind: String!
    goalId: ID!
    title: String!
    message: String!
    severity: String!
  }

  type DailyProgress {
    date: String!
    completedCount: Int!
    minutesToday: Float!
    streakDays: Int!
  }

  type Query {
    groups: [Group!]!
    group(id: ID!): Group
    activities: [Activity!]!
    activity(id: ID!): Activity
    activityCompletions(activityId: ID, fromDate: String, toDate: String): [ActivityCompletion!]!
    goals(status: String): [Goal!]!
    goal(id: ID!): Goal
    goalNudges: [GoalNudge!]!
    dailyProgress(date: String): DailyProgress!
  }

  type Mutation {
    createGroup(input: CreateGroupInput!): Group!
    updateGroup(id: ID!, input: UpdateGroupInput!): Group!
    deleteGroup(id: ID!): Boolean!
    createActivity(input: CreateActivityInput!): Activity!
    updateActivity(id: ID!, input: UpdateActivityInput!): Activity!
    deleteActivity(id: ID!): Boolean!
    completeActivity(input: CompleteActivityInput!): ActivityCompletion!
    undoCompletion(id: ID!): Boolean!
    logTime(input: LogTimeInput!): GoalEvent!
    createGoal(input: CreateGoalInput!): Goal!
    updateGoal(id: ID!, input: UpdateGoalInput!): Goal!
    pauseGoal(id: ID!): Goal!
    resumeGoal(id: ID!): Goal!
    archiveGoal(id: ID!): Goal!
    deleteGoal(id: ID!): Boolean!
    recomputeGoalProgress: RecomputeResult!
  }

  type RecomputeResult {
    recomputed: Int!
  }

  input CompleteActivityInput {
    activityId: ID!
    occurrenceDate: String!
    durationMinutes: Int
    notes: String
  }

  input LogTimeInput {
    activityId: ID!
    durationMinutes: Int!
    occurrenceDate: String
    notes: String
  }

  input CreateGoalInput {
    title: String!
    description: String
    color: String!
    icon: String
    ruleType: String!
    metric: String!
    targetValue: Float!
    links: [GoalLinkInput!]
    dependencies: [GoalDependencyInput!]
    recurrence: GoalRecurrenceInput
    deadline: GoalDeadlineInput
    startsAt: String
    priority: Int
    sortOrder: Int
  }

  input UpdateGoalInput {
    title: String
    description: String
    color: String
    icon: String
    ruleType: String
    metric: String
    targetValue: Float
    links: [GoalLinkInput!]
    dependencies: [GoalDependencyInput!]
    recurrence: GoalRecurrenceInput
    deadline: GoalDeadlineInput
    startsAt: String
    confirmStartsAtChange: Boolean
    status: String
    priority: Int
    sortOrder: Int
  }

  input GoalLinkInput {
    linkType: String!
    activityId: ID
    groupId: ID
    weight: Float
  }

  input GoalDependencyInput {
    dependsOnGoalId: ID!
    requirement: String
    threshold: Float
    weight: Float
  }

  input GoalRecurrenceInput {
    period: String!
    interval: Int
    anchor: String
    carryOver: String
    reset: String
  }

  input GoalDeadlineInput {
    kind: String!
    date: String
    daysAfterCycleStart: Int
    graceDays: Int
    warnDays: Int
  }

  input CreateGroupInput {
    name: String!
    color: String!
  }

  input UpdateGroupInput {
    name: String
    color: String
  }

  input CreateActivityInput {
    title: String!
    description: String
    startTime: String!
    endTime: String!
    isRecurring: Boolean!
    date: String
    recurrencePattern: CreateRecurrencePatternInput
    groupId: ID
    notificationOffsets: [Int!]
  }

  input CreateRecurrencePatternInput {
    recurrenceType: RecurrenceType!
    config: RecurrenceConfigInput!
  }

  input UpdateActivityInput {
    title: String
    description: String
    startTime: String
    endTime: String
    isRecurring: Boolean
    date: String
    recurrencePattern: UpdateRecurrencePatternInput
    groupId: ID
    notificationOffsets: [Int!]
  }

  input UpdateRecurrencePatternInput {
    recurrenceType: RecurrenceType
    config: RecurrenceConfigInput
  }

  input RecurrenceConfigInput {
    daysOfWeek: [Int]
    daysOfMonth: [Int]
    isLastDayOfMonth: Boolean
    intervalDays: Int
    startDate: String!
    endDate: String
  }

  type RecurrenceConfig {
    daysOfWeek: [Int]
    daysOfMonth: [Int]
    isLastDayOfMonth: Boolean
    intervalDays: Int
    startDate: String!
    endDate: String
  }
`
