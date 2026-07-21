import { NoOpPushSender } from './noop_sender.ts'
import { FirebasePushSender } from './firebase_sender.ts'
import type { PushPayload, PushSender, SendToTokensResult } from './types.ts'

Deno.test('NoOpPushSender returns empty result', async () => {
  const sender = new NoOpPushSender()
  const result = await sender.sendToTokens(['tok'], {
    title: 't',
    body: 'b',
  })
  if (result.successCount !== 0 || result.invalidTokens.length !== 0) {
    throw new Error(`unexpected: ${JSON.stringify(result)}`)
  }
})

Deno.test('FirebasePushSender aggregates multicast chunks and invalid tokens', async () => {
  const calls: Array<{ tokens: string[] }> = []
  const messaging = {
    sendEachForMulticast: async (message: {
      tokens: string[]
      notification: { title: string; body: string }
      data?: Record<string, string>
    }) => {
      calls.push({ tokens: message.tokens })
      return {
        successCount: message.tokens.length - 1,
        responses: message.tokens.map((token, i) =>
          i === 0
            ? {
              success: false,
              error: { code: 'messaging/registration-token-not-registered' },
            }
            : { success: true }
        ),
      }
    },
  }

  const sender = new FirebasePushSender(messaging)
  const tokens = Array.from({ length: 3 }, (_, i) => `t${i}`)
  const result = await sender.sendToTokens(tokens, {
    title: 'Budget alert',
    body: '80% used',
    data: { budget_id: '1' },
  })

  if (calls.length !== 1) throw new Error(`expected 1 call, got ${calls.length}`)
  if (result.successCount !== 2) {
    throw new Error(`expected successCount 2, got ${result.successCount}`)
  }
  if (result.invalidTokens.length !== 1 || result.invalidTokens[0] !== 't0') {
    throw new Error(`unexpected invalidTokens: ${JSON.stringify(result.invalidTokens)}`)
  }
})

Deno.test('PushSender contract can be mocked for product APIs', async () => {
  const sent: Array<{ tokens: string[]; payload: PushPayload }> = []
  const mock: PushSender = {
    async sendToTokens(tokens, payload): Promise<SendToTokensResult> {
      sent.push({ tokens, payload })
      return { successCount: tokens.length, invalidTokens: [] }
    },
  }

  const result = await mock.sendToTokens(['a'], { title: 'T', body: 'B' })
  if (result.successCount !== 1 || sent.length !== 1) {
    throw new Error('mock sender failed')
  }
})
