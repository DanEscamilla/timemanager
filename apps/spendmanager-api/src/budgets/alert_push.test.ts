import type { PushPayload, PushSender, SendToTokensResult } from 'deno_api_kit/push/mod.ts'
import {
  maybeSendBudgetAlertPushesWithDeps,
  type AlertPushDeps,
} from './alert_push.ts'
import type { BudgetStatusRow } from './status.ts'

function status(overrides: Partial<BudgetStatusRow> = {}): BudgetStatusRow {
  return {
    budget_id: 1,
    budget_name: 'Groceries',
    category_id: 2,
    currency: 'USD',
    amount_cents: 10000,
    spent_cents: 8000,
    percent_used: 80,
    alert_percent: 80,
    alert_triggered: true,
    period_start: '2026-07-01',
    period_end_exclusive: '2026-08-01',
    ...overrides,
  }
}

Deno.test('maybeSendBudgetAlertPushes skips when not triggered', async () => {
  const sent: PushPayload[] = []
  const deps: AlertPushDeps = {
    computeStatuses: async () => [status({ alert_triggered: false })],
    tryClaimSend: async () => {
      throw new Error('should not claim')
    },
    listTokens: async () => ['tok'],
    deleteTokens: async () => {},
    sender: {
      async sendToTokens(_tokens, payload) {
        sent.push(payload)
        return { successCount: 1, invalidTokens: [] }
      },
    },
  }

  const count = await maybeSendBudgetAlertPushesWithDeps(1, '2026-07-20', deps)
  if (count !== 0 || sent.length !== 0) {
    throw new Error('expected no send when not triggered')
  }
})

Deno.test('maybeSendBudgetAlertPushes skips when no tokens (does not claim)', async () => {
  let claimed = false
  const deps: AlertPushDeps = {
    computeStatuses: async () => [status()],
    tryClaimSend: async () => {
      claimed = true
      return true
    },
    listTokens: async () => [],
    deleteTokens: async () => {},
    sender: {
      async sendToTokens() {
        throw new Error('should not send')
      },
    },
  }

  const count = await maybeSendBudgetAlertPushesWithDeps(1, '2026-07-20', deps)
  if (count !== 0 || claimed) {
    throw new Error('expected no claim/send without tokens')
  }
})

Deno.test('maybeSendBudgetAlertPushes sends once when claim succeeds', async () => {
  const payloads: PushPayload[] = []
  const deps: AlertPushDeps = {
    computeStatuses: async () => [status()],
    tryClaimSend: async () => true,
    listTokens: async () => ['tok-a', 'tok-b'],
    deleteTokens: async () => {},
    sender: {
      async sendToTokens(tokens, payload): Promise<SendToTokensResult> {
        if (tokens.length !== 2) throw new Error('expected 2 tokens')
        payloads.push(payload)
        return { successCount: 2, invalidTokens: [] }
      },
    },
  }

  const count = await maybeSendBudgetAlertPushesWithDeps(1, '2026-07-20', deps)
  if (count !== 2 || payloads.length !== 1) {
    throw new Error(`unexpected send: count=${count} payloads=${payloads.length}`)
  }
  if (payloads[0]!.title !== 'Groceries' || payloads[0]!.data?.type !== 'budget_alert') {
    throw new Error(`bad payload: ${JSON.stringify(payloads[0])}`)
  }
})

Deno.test('maybeSendBudgetAlertPushes skips send when already claimed', async () => {
  let sendCalls = 0
  const deps: AlertPushDeps = {
    computeStatuses: async () => [status()],
    tryClaimSend: async () => false,
    listTokens: async () => ['tok'],
    deleteTokens: async () => {},
    sender: {
      async sendToTokens() {
        sendCalls++
        return { successCount: 1, invalidTokens: [] }
      },
    },
  }

  const count = await maybeSendBudgetAlertPushesWithDeps(1, '2026-07-20', deps)
  if (count !== 0 || sendCalls !== 0) {
    throw new Error('expected no send when already claimed')
  }
})

Deno.test('maybeSendBudgetAlertPushes prunes invalid tokens', async () => {
  const deleted: string[] = []
  const deps: AlertPushDeps = {
    computeStatuses: async () => [status()],
    tryClaimSend: async () => true,
    listTokens: async () => ['good', 'bad'],
    deleteTokens: async (tokens) => {
      deleted.push(...tokens)
    },
    sender: {
      async sendToTokens(): Promise<SendToTokensResult> {
        return { successCount: 1, invalidTokens: ['bad'] }
      },
    } satisfies PushSender,
  }

  await maybeSendBudgetAlertPushesWithDeps(1, '2026-07-20', deps)
  if (deleted.length !== 1 || deleted[0] !== 'bad') {
    throw new Error(`expected to delete bad token, got ${JSON.stringify(deleted)}`)
  }
})
