import type { PushSender } from 'deno_api_kit/push/mod.ts'
import { NoOpPushSender } from 'deno_api_kit/push/mod.ts'
import { db } from '../db/database.ts'
import {
  computeBudgetStatuses,
  type BudgetStatusRow,
} from './status.ts'

let pushSender: PushSender = new NoOpPushSender()

/** Wire the process-wide sender (from index or tests). */
export function setPushSender(sender: PushSender): void {
  pushSender = sender
}

export function getPushSender(): PushSender {
  return pushSender
}

export interface AlertPushDeps {
  computeStatuses: (
    userId: number,
    asOf: string,
  ) => Promise<BudgetStatusRow[]>
  tryClaimSend: (
    budgetId: number,
    periodStart: string,
  ) => Promise<boolean>
  listTokens: (userId: number) => Promise<string[]>
  deleteTokens: (tokens: string[]) => Promise<void>
  sender: PushSender
  formatBody?: (status: BudgetStatusRow) => string
}

function defaultBody(status: BudgetStatusRow): string {
  return `${status.percent_used}% of budget used`
}

/**
 * Pure-ish orchestration: for each newly triggered budget+period, claim
 * dedupe row then send. Injectable for unit tests.
 */
export async function maybeSendBudgetAlertPushesWithDeps(
  userId: number,
  asOf: string,
  deps: AlertPushDeps,
): Promise<number> {
  const statuses = await deps.computeStatuses(userId, asOf)
  const triggered = statuses.filter(
    (s) => s.alert_triggered && s.period_start != null,
  )
  if (triggered.length === 0) return 0

  const tokens = await deps.listTokens(userId)
  if (tokens.length === 0) {
    // Still claim sends so we don't spam once a token appears mid-period
    // after the user already saw / would have seen the alert via another path.
    // Actually: if no tokens, we should NOT claim — so when they register later
    // in the same period we can still push. Plan: only claim on successful
    // insert attempt before send; if no tokens, skip claim.
    return 0
  }

  let sent = 0
  for (const status of triggered) {
    const periodStart = status.period_start!
    const claimed = await deps.tryClaimSend(status.budget_id, periodStart)
    if (!claimed) continue

    const result = await deps.sender.sendToTokens(tokens, {
      title: status.budget_name,
      body: (deps.formatBody ?? defaultBody)(status),
      data: {
        type: 'budget_alert',
        budget_id: String(status.budget_id),
        period_start: periodStart,
        percent_used: String(status.percent_used),
      },
    })
    sent += result.successCount
    if (result.invalidTokens.length > 0) {
      await deps.deleteTokens(result.invalidTokens)
    }
  }
  return sent
}

async function tryClaimSend(
  budgetId: number,
  periodStart: string,
): Promise<boolean> {
  try {
    await db
      .insertInto('budget_alert_sends')
      .values({
        budget_id: budgetId,
        period_start: periodStart,
        sent_at: new Date().toISOString(),
      })
      .execute()
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Unique violation → already sent this period.
    if (
      message.includes('budget_alert_sends_pkey') ||
      message.includes('duplicate key') ||
      message.includes('unique')
    ) {
      return false
    }
    throw err
  }
}

async function listTokens(userId: number): Promise<string[]> {
  const rows = await db
    .selectFrom('device_tokens')
    .where('user_id', '=', userId)
    .select('token')
    .execute()
  return rows.map((r) => r.token)
}

async function deleteTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return
  await db
    .deleteFrom('device_tokens')
    .where('token', 'in', tokens)
    .execute()
}

/** After expense/budget writes: push for newly crossed thresholds. */
export async function maybeSendBudgetAlertPushes(
  userId: number,
  asOf: string,
): Promise<void> {
  try {
    await maybeSendBudgetAlertPushesWithDeps(userId, asOf, {
      computeStatuses: computeBudgetStatuses,
      tryClaimSend,
      listTokens,
      deleteTokens,
      sender: pushSender,
    })
  } catch (err) {
    // Best-effort: never fail the GraphQL mutation because of push.
    console.error('[push] budget alert send failed', err)
  }
}
