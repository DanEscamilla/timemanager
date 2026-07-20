import { getContext } from '@getcronit/pylon'
import { sql } from 'kysely'
import { currentPeriod, type IntervalUnit } from '../../budgets/period.ts'
import { db } from '../../db/database.ts'
import type { NewBudget, NewCategory, NewExpense } from '../../db/types/schema.ts'
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

async function fetchOwnedBudget(budgetId: number, userId: number) {
  return await db
    .selectFrom('budgets')
    .where('id', '=', budgetId)
    .where('user_id', '=', userId)
    .selectAll()
    .executeTakeFirst()
}

async function sumExpensesInPeriod(args: {
  userId: number
  categoryId: number | null
  currency: string
  fromDate: string
  toDateExclusive: string
}): Promise<number> {
  let query = db
    .selectFrom('expenses')
    .where('user_id', '=', args.userId)
    .where('currency', '=', args.currency)
    .where('spent_on', '>=', args.fromDate)
    .where('spent_on', '<', args.toDateExclusive)
    .select(sql<string>`coalesce(sum(amount_cents), 0)`.as('total_cents'))

  if (args.categoryId != null) {
    query = query.where('category_id', '=', args.categoryId)
  }

  const row = await query.executeTakeFirstOrThrow()
  return asNumber(row.total_cents)
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

  budgets: async (args?: { includeArchived?: boolean }) => {
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

  budget: async (args: { id: number }) => {
    const userId = requireUserId()
    const row = await fetchOwnedBudget(args.id, userId)
    return row ? mapBudget(row) : null
  },

  budgetStatuses: async (args?: { asOf?: string }) => {
    const userId = requireUserId()
    const asOf = args?.asOf != null ? validateSpentOn(args.asOf) : todayUtc()

    const budgets = await db
      .selectFrom('budgets')
      .where('user_id', '=', userId)
      .where('archived_at', 'is', null)
      .orderBy('name', 'asc')
      .selectAll()
      .execute()

    const statuses = []
    for (const budget of budgets) {
      const amountCents = asNumber(budget.amount_cents)
      const period = currentPeriod({
        anchorDate: budget.anchor_date,
        intervalUnit: budget.interval_unit as IntervalUnit,
        intervalCount: budget.interval_count,
        asOf,
      })

      if (!period) {
        statuses.push({
          budget_id: budget.id,
          budget_name: budget.name,
          category_id: budget.category_id,
          currency: budget.currency,
          amount_cents: amountCents,
          spent_cents: 0,
          percent_used: 0,
          alert_percent: budget.alert_percent,
          alert_triggered: false,
          period_start: null,
          period_end_exclusive: null,
        })
        continue
      }

      const spentCents = await sumExpensesInPeriod({
        userId,
        categoryId: budget.category_id,
        currency: budget.currency,
        fromDate: period.start,
        toDateExclusive: period.endExclusive,
      })
      const percentUsed = amountCents > 0
        ? Math.floor((spentCents * 100) / amountCents)
        : 0
      const alertTriggered = percentUsed >= budget.alert_percent

      statuses.push({
        budget_id: budget.id,
        budget_name: budget.name,
        category_id: budget.category_id,
        currency: budget.currency,
        amount_cents: amountCents,
        spent_cents: spentCents,
        percent_used: percentUsed,
        alert_percent: budget.alert_percent,
        alert_triggered: alertTriggered,
        period_start: period.start,
        period_end_exclusive: period.endExclusive,
      })
    }

    return statuses
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
}

export const resolvers = {
  Query,
  Mutation,
}
