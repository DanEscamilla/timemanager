import { gql } from 'graphql-tag'

/**
 * Documentation schema for the GraphQL API.
 * Pylon derives the runtime schema from resolver exports; keep this in sync
 * as a human-readable reference.
 */
export const typeDefs = gql`
  type Category {
    id: ID!
    user_id: ID!
    name: String!
    color: String!
    archived_at: String
    created_at: String!
    updated_at: String!
  }

  type Expense {
    id: ID!
    user_id: ID!
    category_id: ID!
    amount_cents: Int!
    currency: String!
    spent_on: String!
    note: String
    created_at: String!
    updated_at: String!
  }

  type ExpenseTotal {
    category_id: ID!
    category_name: String!
    category_color: String!
    currency: String!
    total_cents: Int!
  }

  input CreateCategoryInput {
    name: String!
    color: String!
  }

  input UpdateCategoryInput {
    name: String
    color: String
  }

  input CreateExpenseInput {
    categoryId: Int!
    amountCents: Int!
    spentOn: String!
    currency: String
    note: String
  }

  input UpdateExpenseInput {
    categoryId: Int
    amountCents: Int
    spentOn: String
    currency: String
    note: String
  }

  type Query {
    categories(includeArchived: Boolean): [Category!]!
    category(id: Int!): Category
    expenses(fromDate: String, toDate: String, categoryId: Int): [Expense!]!
    expense(id: Int!): Expense
    expenseTotals(fromDate: String!, toDate: String!): [ExpenseTotal!]!
  }

  type Mutation {
    createCategory(input: CreateCategoryInput!): Category!
    updateCategory(id: Int!, input: UpdateCategoryInput!): Category!
    archiveCategory(id: Int!): Category!
    createExpense(input: CreateExpenseInput!): Expense!
    updateExpense(id: Int!, input: UpdateExpenseInput!): Expense!
    deleteExpense(id: Int!): Boolean!
  }
`
