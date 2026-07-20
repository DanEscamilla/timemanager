import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

export interface Database {
  users: UsersTable
  categories: CategoriesTable
  expenses: ExpensesTable
}

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

export interface CategoriesTable {
  id: Generated<number>
  user_id: number
  name: string
  /** Hex color from a shared palette, e.g. "#0F766E". */
  color: string
  /** Soft-archive timestamp; null when active. */
  archived_at: ColumnType<Date | null, string | null | undefined, string | null>
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export interface ExpensesTable {
  id: Generated<number>
  user_id: number
  category_id: number
  /** Amount in minor currency units (e.g. cents). */
  amount_cents: number
  /** ISO 4217 currency code. */
  currency: string
  /** Calendar day of the spend (YYYY-MM-DD). */
  spent_on: string
  note: string | null
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export type User = Selectable<UsersTable>
export type NewUser = Insertable<UsersTable>
export type UserUpdate = Updateable<UsersTable>

export type Category = Selectable<CategoriesTable>
export type NewCategory = Insertable<CategoriesTable>
export type CategoryUpdate = Updateable<CategoriesTable>

export type Expense = Selectable<ExpensesTable>
export type NewExpense = Insertable<ExpensesTable>
export type ExpenseUpdate = Updateable<ExpensesTable>
