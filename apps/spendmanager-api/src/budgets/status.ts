import { sql } from 'kysely'
import { db } from '../db/database.ts'
import { currentPeriod, type IntervalUnit } from './period.ts'

export interface BudgetStatusRow {
  budget_id: number
  budget_name: string
  category_id: number | null
  currency: string
  amount_cents: number
  spent_cents: number
  percent_used: number
  alert_percent: number
  alert_triggered: boolean
  period_start: string | null
  period_end_exclusive: string | null
}

/** pg returns bigint as string; normalize for GraphQL clients. */
function asNumber(value: number | string): number {
  if (typeof value === 'number') return value
  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error('invalid amount')
  }
  return n
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

/** Compute budget statuses for a user as of a calendar day (YYYY-MM-DD). */
export async function computeBudgetStatuses(
  userId: number,
  asOf: string,
): Promise<BudgetStatusRow[]> {
  const budgets = await db
    .selectFrom('budgets')
    .where('user_id', '=', userId)
    .where('archived_at', 'is', null)
    .orderBy('name', 'asc')
    .selectAll()
    .execute()

  const statuses: BudgetStatusRow[] = []
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
}
