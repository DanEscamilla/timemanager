import { gql } from 'graphql-tag'

export const typeDefs = gql`
  type User {
    id: ID!
    email: String!
    name: String!
  }

  type Activity {
    id: ID!
    userId: ID!
    title: String!
    description: String
    startTime: String!
    endTime: String!
    isRecurring: Boolean!
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
    daily
    weekly
    monthly
    custom
  }

  input RecurrenceConfigInput {
    daysInterval: Int
    daysOfWeek: [Int]
    daysOfMonth: [String]
    months: [Int]
    customInterval: Int
    startDate: String!
    endDate: String
  }

  type RecurrenceConfig {
    daysInterval: Int
    daysOfWeek: [Int]
    daysOfMonth: [String]
    months: [Int]
    customInterval: Int
    startDate: String!
    endDate: String
  }

  input CreateActivityInput {
    title: String!
    description: String
    startTime: String!
    endTime: String!
    isRecurring: Boolean!
    recurrencePattern: CreateRecurrencePatternInput
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
    recurrencePattern: UpdateRecurrencePatternInput
  }

  input UpdateRecurrencePatternInput {
    recurrenceType: RecurrenceType
    config: RecurrenceConfigInput
  }

  type Query {
    activities: [Activity!]!
    activity(id: ID!): Activity
  }

  type Mutation {
    createActivity(input: CreateActivityInput!): Activity!
    updateActivity(id: ID!, input: UpdateActivityInput!): Activity!
    deleteActivity(id: ID!): Boolean!
  }
`
