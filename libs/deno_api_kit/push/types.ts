/** Domain-agnostic push payload and sender contract. */

export type PushPlatform = 'ios' | 'android' | 'web'

export interface PushPayload {
  title: string
  body: string
  /** Opaque string key/value data delivered to the client. */
  data?: Record<string, string>
}

export interface SendToTokensResult {
  successCount: number
  /** Tokens FCM reported as permanently invalid (safe to delete). */
  invalidTokens: string[]
}

/** Provider-agnostic push sender (Firebase Admin, etc.). */
export interface PushSender {
  sendToTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<SendToTokensResult>
}
