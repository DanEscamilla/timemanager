import { getContext } from '@getcronit/pylon'
import { sql } from 'kysely'
import { maybeSendBudgetAlertPushes } from '../../budgets/alert_push.ts'
import { computeBudgetStatuses } from '../../budgets/status.ts'
import { db } from '../../db/database.ts'
import type {
  NewBudget,
  NewCategory,
  NewDeviceToken,
  NewExpense,
} from '../../db/types/schema.ts'
import { asIsoTimestamp, asIsoTimestampOrNull } from '../timestamps.ts'
import {
  CreateBudgetInput,
  CreateCategoryInput,
  CreateExpenseInput,
  UpdateBudgetInput,
  UpdateCategoryInput,
  UpdateExpenseInput,
} from '../types.ts'
import {
  InvalidBudgetError,
  InvalidCategoryError,
  InvalidExpenseError,
  validateAlertPercent,
  validateAmountCents,
  validateAnchorDate,
  validateBudgetAmountCents,
  validateBudgetName,
  validateCategoryColor,
  validateCategoryName,
  validateCurrency,
  validateIntervalCount,
  validateIntervalUnit,
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

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Named return shapes so Pylon can emit GraphQL object types (not `Any!`). */
export interface Category {
  id: number
  user_id: number
  name: string
  color: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Expense {
  id: number
  user_id: number
  category_id: number
  amount_cents: number
  currency: string
  spent_on: string
  note: string | null
  created_at: string
  updated_at: string
}

export interface Budget {
  id: number
  user_id: number
  name: string
  category_id: number | null
  amount_cents: number
  currency: string
  interval_unit: string
  interval_count: number
  anchor_date: string
  alert_percent: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface ExpenseTotal {
  category_id: number
  category_name: string
  category_color: string
  currency: string
  total_cents: number
}

function mapCategory(row: {
  id: number
  user_id: number
  name: string
  color: string
  archived_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}): Category {
  return {
    ...row,
    archived_at: asIsoTimestampOrNull(row.archived_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
  }
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
}): Expense {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
  }
}

function mapBudget(row: {
  id: number
  user_id: number
  name: string
  category_id: number | null
  amount_cents: number | string
  currency: string
  interval_unit: string
  interval_count: number
  anchor_date: string
  alert_percent: number
  archived_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}): Budget {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents),
    archived_at: asIsoTimestampOrNull(row.archived_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at),
  }
}

const DEVICE_PLATFORMS = new Set(['ios', 'android', 'web'])

function validateDevicePlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase()
  if (!DEVICE_PLATFORMS.has(normalized)) {
    throw new Error('platform must be ios, android, or web')
  }
  return normalized
}

function validateDeviceToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length < 8 || trimmed.length > 4096) {
    throw new Error('invalid device token')
  }
  return trimmed
}

async function fetchOwnedCategory(categoryId: number, userId: number) {
  return await db
    .selectFrom('categories')
    .where('id', '=', categoryId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()
}

async function fetchOwnedBudget(budgetId: number, userId: number) {
  return await db
    .selectFrom('budgets')
    .where('id', '=', budgetId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()
}

export const Query = {
  categories: async (args?: {
    includeArchived?: boolean
  }): Promise<Category[]> => {
    const userId = requireUserId()
    let query = db
      .selectFrom('categories')
      .where('user_id', '=', userId)
      .orderBy('name', 'asc')
      .selectAll()

    if (!args?.includeArchived) {
      query = query.where('archived_at', 'is', null)
    }

    const rows = await query.execute()
    return rows.map(mapCategory)
  },

  category: async (args: { id: number }): Promise<Category | null> => {
    const userId = requireUserId()
    const row = await db
      .selectFrom('categories')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? mapCategory(row) : null
  },

  expenses: async (args?: {
    fromDate?: string
    toDate?: string
    categoryId?: number
  }): Promise<Expense[]> => {
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

  expense: async (args: { id: number }): Promise<Expense | null> => {
    const userId = requireUserId()
    const row = await db
      .selectFrom('expenses')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? mapExpense(row) : null
  },

  expenseTotals: async (args: {
    fromDate: string
    toDate: string
  }): Promise<ExpenseTotal[]> => {
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

    return rows.map((row): ExpenseTotal => ({
      category_id: row.category_id,
      category_name: row.category_name,
      category_color: row.category_color,
      currency: row.currency,
      total_cents: asNumber(row.total_cents),
    }))
  },

  budgets: async (args?: {
    includeArchived?: boolean
  }): Promise<Budget[]> => {
    const userId = requireUserId()
    let query = db
      .selectFrom('budgets')
      .where('user_id', '=', userId)
      .orderBy('name', 'asc')
      .selectAll()

    if (!args?.includeArchived) {
      query = query.where('archived_at', 'is', null)
    }

    const rows = await query.execute()
    return rows.map(mapBudget)
  },

  budget: async (args: { id: number }): Promise<Budget | null> => {
    const userId = requireUserId()
    const row = await fetchOwnedBudget(args.id, userId)
    return row ? mapBudget(row) : null
  },

  budgetStatuses: async (args?: { asOf?: string }) => {
    const userId = requireUserId()
    const asOf = args?.asOf != null ? validateSpentOn(args.asOf) : todayUtc()
    return await computeBudgetStatuses(userId, asOf)
  },
}

export const Mutation = {
  createCategory: async (args: { input: CreateCategoryInput }) => {
    const userId = requireUserId()
    const name = validateCategoryName(args.input.name)
    const color = validateCategoryColor(args.input.color)
    const now = new Date().toISOString()

    try {
      const row = await db
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
      return mapCategory(row)
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
      const row = await db
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
      return mapCategory(row)
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
      return mapCategory(existing)
    }

    const row = await db
      .updateTable('categories')
      .set({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()
    return mapCategory(row)
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

    await maybeSendBudgetAlertPushes(userId, todayUtc())
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

    await maybeSendBudgetAlertPushes(userId, todayUtc())
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

  createBudget: async (args: { input: CreateBudgetInput }) => {
    const userId = requireUserId()
    const name = validateBudgetName(args.input.name)
    const amountCents = validateBudgetAmountCents(args.input.amountCents)
    const intervalUnit = validateIntervalUnit(args.input.intervalUnit)
    const intervalCount = validateIntervalCount(args.input.intervalCount)
    const anchorDate = validateAnchorDate(args.input.anchorDate)
    const alertPercent = validateAlertPercent(args.input.alertPercent)
    const currency = validateCurrency(args.input.currency ?? 'USD')

    let categoryId: number | null = null
    if (args.input.categoryId != null) {
      const category = await fetchOwnedCategory(args.input.categoryId, userId)
      if (!category || category.archived_at != null) {
        throw new InvalidBudgetError('category not found')
      }
      categoryId = category.id
    }

    const now = new Date().toISOString()
    const row = await db
      .insertInto('budgets')
      .values({
        user_id: userId,
        name,
        category_id: categoryId,
        amount_cents: amountCents,
        currency,
        interval_unit: intervalUnit,
        interval_count: intervalCount,
        anchor_date: anchorDate,
        alert_percent: alertPercent,
        archived_at: null,
        created_at: now,
        updated_at: now,
      } as NewBudget)
      .returningAll()
      .executeTakeFirstOrThrow()

    await maybeSendBudgetAlertPushes(userId, todayUtc())
    return mapBudget(row)
  },

  updateBudget: async (args: { id: number; input: UpdateBudgetInput }) => {
    const userId = requireUserId()
    const existing = await fetchOwnedBudget(args.id, userId)
    if (!existing) {
      throw new InvalidBudgetError('budget not found')
    }
    if (existing.archived_at != null) {
      throw new InvalidBudgetError('cannot update an archived budget')
    }

    const name = args.input.name !== undefined
      ? validateBudgetName(args.input.name)
      : existing.name
    const amountCents = args.input.amountCents !== undefined
      ? validateBudgetAmountCents(args.input.amountCents)
      : asNumber(existing.amount_cents)
    const intervalUnit = args.input.intervalUnit !== undefined
      ? validateIntervalUnit(args.input.intervalUnit)
      : validateIntervalUnit(existing.interval_unit)
    const intervalCount = args.input.intervalCount !== undefined
      ? validateIntervalCount(args.input.intervalCount)
      : existing.interval_count
    const anchorDate = args.input.anchorDate !== undefined
      ? validateAnchorDate(args.input.anchorDate)
      : existing.anchor_date
    const alertPercent = args.input.alertPercent !== undefined
      ? validateAlertPercent(args.input.alertPercent)
      : existing.alert_percent
    const currency = args.input.currency !== undefined
      ? validateCurrency(args.input.currency)
      : existing.currency

    let categoryId = existing.category_id
    if (args.input.categoryId !== undefined) {
      if (args.input.categoryId == null) {
        categoryId = null
      } else {
        const category = await fetchOwnedCategory(args.input.categoryId, userId)
        if (!category || category.archived_at != null) {
          throw new InvalidBudgetError('category not found')
        }
        categoryId = category.id
      }
    }

    const row = await db
      .updateTable('budgets')
      .set({
        name,
        category_id: categoryId,
        amount_cents: amountCents,
        currency,
        interval_unit: intervalUnit,
        interval_count: intervalCount,
        anchor_date: anchorDate,
        alert_percent: alertPercent,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()

    await maybeSendBudgetAlertPushes(userId, todayUtc())
    return mapBudget(row)
  },

  archiveBudget: async (args: { id: number }) => {
    const userId = requireUserId()
    const existing = await fetchOwnedBudget(args.id, userId)
    if (!existing) {
      throw new InvalidBudgetError('budget not found')
    }
    if (existing.archived_at != null) {
      return mapBudget(existing)
    }

    const row = await db
      .updateTable('budgets')
      .set({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()

    return mapBudget(row)
  },

  registerDeviceToken: async (args: { token: string; platform: string }) => {
    const userId = requireUserId()
    const token = validateDeviceToken(args.token)
    const platform = validateDevicePlatform(args.platform)
    const now = new Date().toISOString()

    await db
      .insertInto('device_tokens')
      .values({
        user_id: userId,
        token,
        platform,
        updated_at: now,
      } as NewDeviceToken)
      .onConflict((oc) =>
        oc.column('token').doUpdateSet({
          user_id: userId,
          platform,
          updated_at: now,
        })
      )
      .execute()

    return true
  },

  unregisterDeviceToken: async (args: { token: string }) => {
    const userId = requireUserId()
    const token = validateDeviceToken(args.token)
    const result = await db
      .deleteFrom('device_tokens')
      .where('user_id', '=', userId)
      .where('token', '=', token)
      .execute()

    return result.length > 0 && Number(result[0]?.numDeletedRows ?? 0) > 0
  },
}

export const resolvers = {
  Query,
  Mutation,
}
