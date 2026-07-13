import { gql } from 'graphql-tag'

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
    # Set when isRecurring is false; null when isRecurring is true.
    date: String
    groupId: ID
    group: Group
    recurrencePattern: RecurrencePattern
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
    # Required when isRecurring is false; ignored when isRecurring is true.
    date: String
    # Required when isRecurring is true; ignored when isRecurring is false.
    recurrencePattern: CreateRecurrencePatternInput
    groupId: ID
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
    # Pass null to clear the group assignment.
    groupId: ID
  }

  input UpdateRecurrencePatternInput {
    recurrenceType: RecurrenceType
    config: RecurrenceConfigInput
  }

  type Query {
    groups: [Group!]!
    group(id: ID!): Group
    activities: [Activity!]!
    activity(id: ID!): Activity
  }

  type Mutation {
    createGroup(input: CreateGroupInput!): Group!
    updateGroup(id: ID!, input: UpdateGroupInput!): Group!
    deleteGroup(id: ID!): Boolean!
    createActivity(input: CreateActivityInput!): Activity!
    updateActivity(id: ID!, input: UpdateActivityInput!): Activity!
    deleteActivity(id: ID!): Boolean!
  }
`
