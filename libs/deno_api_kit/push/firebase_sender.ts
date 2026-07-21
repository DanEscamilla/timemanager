import { env } from '../db/env.ts'
import { NoOpPushSender } from './noop_sender.ts'
import type { PushPayload, PushSender, SendToTokensResult } from './types.ts'

async function readTextFile(path: string): Promise<string> {
  if (typeof Deno !== 'undefined' && typeof Deno.readTextFile === 'function') {
    return await Deno.readTextFile(path)
  }
  const { readFile } = await import('node:fs/promises')
  return await readFile(path, 'utf8')
}

type ServiceAccount = {
  project_id: string
  client_email: string
  private_key: string
  [key: string]: unknown
}

type Messaging = {
  sendEachForMulticast: (message: {
    tokens: string[]
    notification: { title: string; body: string }
    data?: Record<string, string>
  }) => Promise<{
    successCount: number
    responses: Array<{ success: boolean; error?: { code?: string } }>
  }>
}

type FirebaseAdminModule = {
  apps: unknown[]
  initializeApp: (options: {
    credential: unknown
  }) => unknown
  credential: {
    cert: (serviceAccount: ServiceAccount) => unknown
  }
  messaging: () => Messaging
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
])

/**
 * Firebase Cloud Messaging sender via firebase-admin.
 *
 * Prefer constructing through {@link createPushSenderFromEnv} so missing
 * credentials degrade to a no-op instead of crashing the API.
 */
export class FirebasePushSender implements PushSender {
  constructor(private readonly messaging: Messaging) {}

  async sendToTokens(
    tokens: string[],
    payload: PushPayload,
  ): Promise<SendToTokensResult> {
    if (tokens.length === 0) {
      return { successCount: 0, invalidTokens: [] }
    }

    const invalidTokens: string[] = []
    let successCount = 0

    // FCM multicast supports up to 500 tokens per request.
    const chunkSize = 500
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize)
      const result = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data: payload.data,
      })
      successCount += result.successCount
      result.responses.forEach((response, index) => {
        if (response.success) return
        const code = response.error?.code
        if (code && INVALID_TOKEN_CODES.has(code)) {
          invalidTokens.push(chunk[index]!)
        }
      })
    }

    return { successCount, invalidTokens }
  }
}

function parseServiceAccountJson(raw: string): ServiceAccount {
  const parsed = JSON.parse(raw) as ServiceAccount
  if (
    typeof parsed.project_id !== 'string' ||
    typeof parsed.client_email !== 'string' ||
    typeof parsed.private_key !== 'string'
  ) {
    throw new Error(
      'Firebase service account JSON must include project_id, client_email, private_key',
    )
  }
  // Private keys in env vars often have escaped newlines.
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n')
  return parsed
}

async function loadServiceAccount(): Promise<ServiceAccount | null> {
  const json = env('FIREBASE_SERVICE_ACCOUNT_JSON')
  if (json && json.trim().length > 0) {
    return parseServiceAccountJson(json)
  }

  const path = env('FIREBASE_SERVICE_ACCOUNT_PATH')
  if (path && path.trim().length > 0) {
    const text = await readTextFile(path)
    return parseServiceAccountJson(text)
  }

  return null
}

async function loadFirebaseAdmin(): Promise<FirebaseAdminModule> {
  // Dynamic import keeps the kit importable in unit tests without resolving
  // firebase-admin unless a real sender is constructed.
  // Bun/Node CJS interop often exposes the SDK on `default`.
  const mod = await import('firebase-admin') as {
    default?: FirebaseAdminModule
  } & FirebaseAdminModule
  return mod.default ?? mod
}

/**
 * Builds a {@link PushSender} from env.
 *
 * - `FIREBASE_SERVICE_ACCOUNT_JSON` — raw service-account JSON string
 * - `FIREBASE_SERVICE_ACCOUNT_PATH` — path to a service-account JSON file
 *
 * When neither is set (or init fails), returns {@link NoOpPushSender}.
 */
export async function createPushSenderFromEnv(): Promise<PushSender> {
  try {
    const account = await loadServiceAccount()
    if (!account) {
      console.info(
        '[push] FIREBASE_SERVICE_ACCOUNT_JSON/PATH unset; using no-op sender',
      )
      return new NoOpPushSender()
    }

    const admin = await loadFirebaseAdmin()
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(account),
      })
    }

    return new FirebasePushSender(admin.messaging())
  } catch (err) {
    console.error('[push] failed to init Firebase sender; using no-op', err)
    return new NoOpPushSender()
  }
}
