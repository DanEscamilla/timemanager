import type { PushPayload, PushSender, SendToTokensResult } from './types.ts'

/** No-op sender used when Firebase credentials are not configured. */
export class NoOpPushSender implements PushSender {
  async sendToTokens(
    _tokens: string[],
    _payload: PushPayload,
  ): Promise<SendToTokensResult> {
    return { successCount: 0, invalidTokens: [] }
  }
}
