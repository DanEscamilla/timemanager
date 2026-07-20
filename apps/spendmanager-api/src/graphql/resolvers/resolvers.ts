import { getContext } from '@getcronit/pylon'
import { sql } from 'kysely'
import { db } from '../../db/database.ts'
import type { NewCategory, NewExpense } from '../../db/types/schema.ts'
import {
  CreateCategoryInput,
  CreateExpenseInput,
  UpdateCategoryInput,
  UpdateExpenseInput,
} from '../types.ts'
import {
  InvalidCategoryError,
  InvalidExpenseError,
  validateAmountCents,
  validateCategoryColor,
  validateCategoryName,
  validateCurrency,
  validateNote,
  validateSpentOn,
} from '../validation.ts'

function requireUserId(): number {
  const userId = getContext().get('userId')
  if (typeof userId !== 'number') {
    throw new Error('Unauthenticated')
  }
  return userId
}

/** pg returns bigint as string; normalize for GraphQL clients. */
function asNumber(value: number | string): number {
  if (typeof value === 'number') return value
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new InvalidExpenseError('invalid amount')
  }
  return n
}

function mapExpense(row: {
  id: number
  user_id: number
  category_id: number
  amount_cents: number | string
  currency: string
  spent_on: string
  note: string | null
  created_at: Date | string
  updated_at: Date | string
}) {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents),
  }
}

async function fetchOwnedCategory(categoryId: number, userId: number) {
  return await db
    .selectFrom('categories')
    .where('id', '=', categoryId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()
}

export const Query = {
  categories: async (args?: { includeArchived?: boolean }) => {
    const userId = requireUserId()
    let query = db
      .selectFrom('categories')
      .where('user_id', '=', userId)
      .orderBy('name', 'asc')
      .selectAll()

    if (!args?.includeArchived) {
      query = query.where('archived_at', 'is', null)
    }

    return await query.execute()
  },

  category: async (args: { id: number }) => {
    const userId = requireUserId()
    return (
      await db
        .selectFrom('categories')
        .where('id', '=', args.id)
        .where('user_id', '=', userId)
        .selectAll()
        .executeTakeFirst()
    ) ?? null
  },

  expenses: async (args?: {
    fromDate?: string
    toDate?: string
    categoryId?: number
  }) => {
    const userId = requireUserId()
    let query = db
      .selectFrom('expenses')
      .where('user_id', '=', userId)
      .orderBy('spent_on', 'desc')
      .orderBy('id', 'desc')
      .selectAll()

    if (args?.fromDate) {
      query = query.where('spent_on', '>=', validateSpentOn(args.fromDate))
    }
    if (args?.toDate) {
      query = query.where('spent_on', '<=', validateSpentOn(args.toDate))
    }
    if (args?.categoryId != null) {
      query = query.where('category_id', '=', args.categoryId)
    }

    const rows = await query.execute()
    return rows.map(mapExpense)
  },

  expense: async (args: { id: number }) => {
    const userId = requireUserId()
    const row = await db
      .selectFrom('expenses')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? mapExpense(row) : null
  },

  expenseTotals: async (args: { fromDate: string; toDate: string }) => {
    const userId = requireUserId()
    const fromDate = validateSpentOn(args.fromDate)
    const toDate = validateSpentOn(args.toDate)

    const rows = await db
      .selectFrom('expenses')
      .innerJoin('categories', 'categories.id', 'expenses.category_id')
      .where('expenses.user_id', '=', userId)
      .where('expenses.spent_on', '>=', fromDate)
      .where('expenses.spent_on', '<=', toDate)
      .select([
        'expenses.category_id',
        'categories.name as category_name',
        'categories.color as category_color',
        'expenses.currency',
        sql<string>`sum(expenses.amount_cents)`.as('total_cents'),
      ])
      .groupBy([
        'expenses.category_id',
        'categories.name',
        'categories.color',
        'expenses.currency',
      ])
      .orderBy('total_cents', 'desc')
      .execute()

    return rows.map((row) => ({
      category_id: row.category_id,
      category_name: row.category_name,
      category_color: row.category_color,
      currency: row.currency,
      total_cents: asNumber(row.total_cents),
    }))
  },
}

export const Mutation = {
  createCategory: async (args: { input: CreateCategoryInput }) => {
    const userId = requireUserId()
    const name = validateCategoryName(args.input.name)
    const color = validateCategoryColor(args.input.color)
    const now = new Date().toISOString()

    try {
      return await db
        .insertInto('categories')
        .values({
          user_id: userId,
          name,
          color,
          archived_at: null,
          created_at: now,
          updated_at: now,
        } as NewCategory)
        .returningAll()
        .executeTakeFirstOrThrow()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('categories_user_id_lower_name_active_unique')) {
        throw new InvalidCategoryError('a category with this name already exists')
      }
      throw err
    }
  },

  updateCategory: async (args: { id: number; input: UpdateCategoryInput }) => {
    const userId = requireUserId()
    const existing = await fetchOwnedCategory(args.id, userId)
    if (!existing) {
      throw new InvalidCategoryError('category not found')
    }
    if (existing.archived_at != null) {
      throw new InvalidCategoryError('cannot update an archived category')
    }

    const name = args.input.name !== undefined
      ? validateCategoryName(args.input.name)
      : existing.name
    const color = args.input.color !== undefined
      ? validateCategoryColor(args.input.color)
      : existing.color

    try {
      return await db
        .updateTable('categories')
        .set({
          name,
          color,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', args.id)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirstOrThrow()
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      if (message.includes('categories_user_id_lower_name_active_unique')) {
        throw new InvalidCategoryError('a category with this name already exists')
      }
      throw err
    }
  },

  archiveCategory: async (args: { id: number }) => {
    const userId = requireUserId()
    const existing = await fetchOwnedCategory(args.id, userId)
    if (!existing) {
      throw new InvalidCategoryError('category not found')
    }
    if (existing.archived_at != null) {
      return existing
    }

    return await db
      .updateTable('categories')
      .set({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
  },

  createExpense: async (args: { input: CreateExpenseInput }) => {
    const userId = requireUserId()
    const category = await fetchOwnedCategory(args.input.categoryId, userId)
    if (!category || category.archived_at != null) {
      throw new InvalidExpenseError('category not found')
    }

    const amountCents = validateAmountCents(args.input.amountCents)
    const spentOn = validateSpentOn(args.input.spentOn)
    const currency = validateCurrency(args.input.currency ?? 'USD')
    const note = validateNote(args.input.note)
    const now = new Date().toISOString()

    const row = await db
      .insertInto('expenses')
      .values({
        user_id: userId,
        category_id: category.id,
        amount_cents: amountCents,
        currency,
        spent_on: spentOn,
        note,
        created_at: now,
        updated_at: now,
      } as NewExpense)
      .returningAll()
      .executeTakeFirstOrThrow()

    return mapExpense(row)
  },

  updateExpense: async (args: { id: number; input: UpdateExpenseInput }) => {
    const userId = requireUserId()
    const existing = await db
      .selectFrom('expenses')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()

    if (!existing) {
      throw new InvalidExpenseError('expense not found')
    }

    let categoryId = existing.category_id
    if (args.input.categoryId !== undefined) {
      const category = await fetchOwnedCategory(args.input.categoryId, userId)
      if (!category || category.archived_at != null) {
        throw new InvalidExpenseError('category not found')
      }
      categoryId = category.id
    }

    const amountCents = args.input.amountCents !== undefined
      ? validateAmountCents(args.input.amountCents)
      : asNumber(existing.amount_cents)
    const spentOn = args.input.spentOn !== undefined
      ? validateSpentOn(args.input.spentOn)
      : existing.spent_on
    const currency = args.input.currency !== undefined
      ? validateCurrency(args.input.currency)
      : existing.currency
    const note = args.input.note !== undefined
      ? validateNote(args.input.note)
      : existing.note

    const row = await db
      .updateTable('expenses')
      .set({
        category_id: categoryId,
        amount_cents: amountCents,
        currency,
        spent_on: spentOn,
        note,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()

    return mapExpense(row)
  },

  deleteExpense: async (args: { id: number }) => {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('expenses')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .execute()

    return result.length > 0 && Number(result[0]?.numDeletedRows ?? 0) > 0
  },
}

export const resolvers = {
  Query,
  Mutation,
}
