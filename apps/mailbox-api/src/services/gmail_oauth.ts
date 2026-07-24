/** Gmail OAuth authorization-code helpers (start + callback). */

import { env as readEnv } from 'deno_api_kit/db/env.ts'

export const GMAIL_READONLY_SCOPE =
  'https://www.googleapis.com/auth/gmail.readonly'

export const GOOGLE_AUTHORIZE_URL =
  'https://accounts.google.com/o/oauth2/v2/auth'

export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

const STATE_TTL_SECONDS = 10 * 60

export interface GmailOAuthConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
  returnToAllowlist: string[]
}

export interface GmailOAuthStatePayload {
  userId: number
  mailboxId: number
  returnTo: string
  exp: number
}

export interface GmailTokenResult {
  accessToken: string
  refreshToken: string | null
  expiresAtMs: number | null
}

export class GmailOAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GmailOAuthError'
  }
}

/** Load Gmail OAuth settings (omit `env` to read process/Deno via deno_api_kit). */
export function loadGmailOAuthConfig(
  env?: Record<string, string | undefined>,
): GmailOAuthConfig {
  const source = env ?? {
    GMAIL_OAUTH_CLIENT_ID: readEnv('GMAIL_OAUTH_CLIENT_ID'),
    GMAIL_OAUTH_CLIENT_SECRET: readEnv('GMAIL_OAUTH_CLIENT_SECRET'),
    GMAIL_OAUTH_REDIRECT_URI: readEnv('GMAIL_OAUTH_REDIRECT_URI'),
    GMAIL_OAUTH_RETURN_TO_ALLOWLIST: readEnv('GMAIL_OAUTH_RETURN_TO_ALLOWLIST'),
  }
  const clientId = source.GMAIL_OAUTH_CLIENT_ID?.trim() ?? ''
  const clientSecret = source.GMAIL_OAUTH_CLIENT_SECRET?.trim() ?? ''
  const redirectUri = (source.GMAIL_OAUTH_REDIRECT_URI?.trim() ||
    'http://localhost:3003/oauth/gmail/callback')
  const allowRaw = source.GMAIL_OAUTH_RETURN_TO_ALLOWLIST?.trim() ||
    'http://localhost:4445,spendmanager://settings/email-import'
  const returnToAllowlist = allowRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  if (!clientId || !clientSecret) {
    throw new GmailOAuthError(
      'GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET are required',
    )
  }
  if (returnToAllowlist.length === 0) {
    throw new GmailOAuthError('GMAIL_OAUTH_RETURN_TO_ALLOWLIST is empty')
  }

  return { clientId, clientSecret, redirectUri, returnToAllowlist }
}

/** True when `returnTo` origin (or scheme prefix) matches an allowlist entry. */
export function isReturnToAllowed(
  returnTo: string,
  allowlist: string[],
): boolean {
  let url: URL
  try {
    url = new URL(returnTo)
  } catch {
    return false
  }

  if (url.username || url.password) return false
  if (url.hash) return false

  for (const entry of allowlist) {
    if (!entry) continue
    try {
      const allowed = new URL(entry)
      if (url.protocol === allowed.protocol && url.host === allowed.host) {
        // Allow exact origin or any path under that origin.
        if (!allowed.pathname || allowed.pathname === '/') return true
        const prefix = allowed.pathname.endsWith('/')
          ? allowed.pathname
          : `${allowed.pathname}/`
        if (
          url.pathname === allowed.pathname ||
          url.pathname.startsWith(prefix)
        ) {
          return true
        }
      }
    } catch {
      // Custom schemes without authority, e.g. spendmanager://settings/...
      if (returnTo === entry || returnTo.startsWith(`${entry}`)) {
        return true
      }
    }
  }
  return false
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((s.length + 3) % 4)
  const bin = atob(padded)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
}

export async function signOAuthState(
  payload: Omit<GmailOAuthStatePayload, 'exp'> & { exp?: number },
  clientSecret: string,
  nowMs: number = Date.now(),
): Promise<string> {
  const body: GmailOAuthStatePayload = {
    userId: payload.userId,
    mailboxId: payload.mailboxId,
    returnTo: payload.returnTo,
    exp: payload.exp ?? Math.floor(nowMs / 1000) + STATE_TTL_SECONDS,
  }
  const payloadB64 = bytesToBase64Url(
    new TextEncoder().encode(JSON.stringify(body)),
  )
  const key = await hmacKey(clientSecret)
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(payloadB64),
  )
  return `${payloadB64}.${bytesToBase64Url(new Uint8Array(sig))}`
}

export async function verifyOAuthState(
  state: string,
  clientSecret: string,
  nowMs: number = Date.now(),
): Promise<GmailOAuthStatePayload> {
  const parts = state.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GmailOAuthError('invalid OAuth state')
  }
  const [payloadB64, sigB64] = parts
  const key = await hmacKey(clientSecret)
  const ok = await crypto.subtle.verify(
    'HMAC',
    key,
    base64UrlToBytes(sigB64) as BufferSource,
    new TextEncoder().encode(payloadB64),
  )
  if (!ok) throw new GmailOAuthError('invalid OAuth state signature')

  let body: GmailOAuthStatePayload
  try {
    body = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(payloadB64)),
    ) as GmailOAuthStatePayload
  } catch {
    throw new GmailOAuthError('invalid OAuth state payload')
  }

  if (
    typeof body.userId !== 'number' ||
    typeof body.mailboxId !== 'number' ||
    typeof body.returnTo !== 'string' ||
    typeof body.exp !== 'number'
  ) {
    throw new GmailOAuthError('invalid OAuth state fields')
  }
  if (body.exp < Math.floor(nowMs / 1000)) {
    throw new GmailOAuthError('OAuth state expired')
  }
  return body
}

export function buildGoogleAuthorizeUrl(options: {
  clientId: string
  redirectUri: string
  state: string
  scope?: string
}): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scope ?? GMAIL_READONLY_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: options.state,
  })
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`
}

export async function exchangeAuthorizationCode(options: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
  fetchImpl?: typeof fetch
  tokenUrl?: string
}): Promise<GmailTokenResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const res = await fetchImpl(options.tokenUrl ?? GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: options.code,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GmailOAuthError(
      `token exchange failed (${res.status}): ${text.slice(0, 200)}`,
    )
  }
  const json = await res.json() as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) {
    throw new GmailOAuthError('token exchange missing access_token')
  }
  const expiresAtMs = typeof json.expires_in === 'number'
    ? Date.now() + json.expires_in * 1000
    : null
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAtMs,
  }
}

const GMAIL_PROFILE_URL =
  'https://gmail.googleapis.com/gmail/v1/users/me/profile'

/** Best-effort Gmail address for mailbox label; null when unavailable. */
export async function fetchGmailEmailAddress(options: {
  accessToken: string
  fetchImpl?: typeof fetch
  profileUrl?: string
}): Promise<string | null> {
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const res = await fetchImpl(options.profileUrl ?? GMAIL_PROFILE_URL, {
      headers: { Authorization: `Bearer ${options.accessToken}` },
    })
    if (!res.ok) return null
    const json = await res.json() as { emailAddress?: unknown }
    if (typeof json.emailAddress !== 'string') return null
    const email = json.emailAddress.trim()
    return email.length > 0 && email.length <= 255 ? email : null
  } catch {
    return null
  }
}

/** Append gmail=connected|error query params to returnTo. */
export function buildReturnRedirect(
  returnTo: string,
  result: { ok: true } | { ok: false; error: string },
): string {
  const url = new URL(returnTo)
  if (result.ok) {
    url.searchParams.set('gmail', 'connected')
    url.searchParams.delete('error')
  } else {
    url.searchParams.set('gmail', 'error')
    url.searchParams.set('error', result.error.slice(0, 200))
  }
  return url.toString()
}
