import type { MailboxProvider } from '../provider.ts'
import type { EmailMessage, ListMessagesResult, SyncCursor } from '../types.ts'

export interface GmailOAuthTokens {
  accessToken: string
  refreshToken?: string | null
  /** Epoch ms when accessToken expires; optional. */
  expiresAtMs?: number | null
}

export interface GmailMailboxProviderOptions {
  tokens: GmailOAuthTokens
  /** Called when tokens are refreshed so the caller can persist them. */
  onTokensUpdated?: (tokens: GmailOAuthTokens) => Promise<void> | void
  clientId?: string
  clientSecret?: string
  /** Injected fetch for tests. */
  fetchImpl?: typeof fetch
  gmailBaseUrl?: string
  oauthTokenUrl?: string
}

interface GmailListResponse {
  messages?: Array<{ id: string }>
  nextPageToken?: string
  resultSizeEstimate?: number
}

interface GmailMessageResponse {
  id: string
  internalDate?: string
  payload?: {
    mimeType?: string
    headers?: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: Array<{
      mimeType?: string
      body?: { data?: string }
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>
    }>
  }
}

/**
 * Gmail API mailbox provider (OAuth access token).
 * Cursor format: `page:<pageToken>` or empty/null for the first page of recent mail.
 * After exhausting pages, cursor becomes `done:<isoTimestamp>` so subsequent polls
 * only fetch messages newer than that watermark via `q=after:`.
 */
export class GmailMailboxProvider implements MailboxProvider {
  readonly name = 'gmail'

  private tokens: GmailOAuthTokens
  private readonly fetchImpl: typeof fetch
  private readonly gmailBaseUrl: string
  private readonly oauthTokenUrl: string
  private readonly clientId: string | undefined
  private readonly clientSecret: string | undefined
  private readonly onTokensUpdated:
    | ((tokens: GmailOAuthTokens) => Promise<void> | void)
    | undefined

  constructor(options: GmailMailboxProviderOptions) {
    this.tokens = { ...options.tokens }
    this.fetchImpl = options.fetchImpl ?? fetch
    this.gmailBaseUrl =
      options.gmailBaseUrl ?? 'https://gmail.googleapis.com/gmail/v1'
    this.oauthTokenUrl =
      options.oauthTokenUrl ?? 'https://oauth2.googleapis.com/token'
    this.clientId = options.clientId ?? Deno.env.get('GMAIL_OAUTH_CLIENT_ID')
    this.clientSecret =
      options.clientSecret ?? Deno.env.get('GMAIL_OAUTH_CLIENT_SECRET')
    this.onTokensUpdated = options.onTokensUpdated
  }

  async listMessages(options: {
    cursor: SyncCursor
    limit?: number
    since?: Date
    until?: Date
    fromPatterns?: string[]
  }): Promise<ListMessagesResult> {
    const limit = Math.min(options.limit ?? 25, 100)
    const rangeMode = options.since != null || options.until != null
    const parsed = parseGmailCursor(options.cursor)

    const params = new URLSearchParams()
    params.set('maxResults', String(limit))
    if (parsed.pageToken) params.set('pageToken', parsed.pageToken)

    const qParts: string[] = []
    if (rangeMode) {
      // Range backfill ignores incremental done:<unix> watermark.
      if (options.since) {
        qParts.push(`after:${Math.floor(options.since.getTime() / 1000) - 1}`)
      }
      if (options.until) {
        // before: is exclusive in Gmail; +1s keeps until inclusive.
        qParts.push(`before:${Math.floor(options.until.getTime() / 1000) + 1}`)
      }
    } else if (parsed.afterUnix) {
      qParts.push(`after:${parsed.afterUnix}`)
    }
    const fromClause = buildGmailFromPatternsQuery(options.fromPatterns)
    if (fromClause) qParts.push(fromClause)
    if (qParts.length > 0) {
      params.set('q', qParts.join(' '))
    }

    console.log(
      `[gmail] listMessages maxResults=${limit} pageToken=${parsed.pageToken ?? '(none)'} ` +
        `q=${params.get('q') ?? '(none)'} rangeMode=${rangeMode}`,
    )

    const list = await this.gmailFetch<GmailListResponse>(
      `/users/me/messages?${params.toString()}`,
    )

    const ids = (list.messages ?? []).map((m) => m.id)
    console.log(
      `[gmail] listMessages result ids=${ids.length} nextPageToken=${list.nextPageToken ? 'yes' : 'no'} ` +
        `estimate=${list.resultSizeEstimate ?? '-'}`,
    )
    const messages: EmailMessage[] = []
    for (const id of ids) {
      const full = await this.getMessage(id)
      if (full) messages.push(full)
    }

    let nextCursor: SyncCursor
    if (list.nextPageToken) {
      if (rangeMode) {
        nextCursor = serializeGmailCursor({ pageToken: list.nextPageToken })
      } else {
        nextCursor = serializeGmailCursor({
          pageToken: list.nextPageToken,
          afterUnix: parsed.afterUnix,
        })
      }
    } else if (rangeMode) {
      nextCursor = null
    } else {
      const newest = messages.reduce(
        (max, m) => Math.max(max, m.receivedAt.getTime()),
        parsed.afterUnix ? parsed.afterUnix * 1000 : 0,
      )
      const watermarkSec = Math.floor((newest || Date.now()) / 1000)
      nextCursor = serializeGmailCursor({ afterUnix: watermarkSec })
    }

    return { messages, nextCursor }
  }

  async getMessage(id: string): Promise<EmailMessage | null> {
    const raw = await this.gmailFetch<GmailMessageResponse>(
      `/users/me/messages/${encodeURIComponent(id)}?format=full`,
    )
    return mapGmailMessage(raw)
  }

  private async gmailFetch<T>(path: string): Promise<T> {
    await this.ensureAccessToken()
    const url = `${this.gmailBaseUrl}${path}`
    let res = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
    })
    if (res.status === 401 && this.tokens.refreshToken) {
      await this.refreshAccessToken()
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.tokens.accessToken}` },
      })
    }
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Gmail API ${res.status}: ${body.slice(0, 300)}`)
    }
    return (await res.json()) as T
  }

  private async ensureAccessToken(): Promise<void> {
    const expires = this.tokens.expiresAtMs
    if (
      expires &&
      expires > Date.now() + 60_000 &&
      this.tokens.accessToken
    ) {
      return
    }
    if (this.tokens.refreshToken) {
      await this.refreshAccessToken()
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.tokens.refreshToken) {
      throw new Error('Gmail access token expired and no refresh token')
    }
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'GMAIL_OAUTH_CLIENT_ID and GMAIL_OAUTH_CLIENT_SECRET required to refresh',
      )
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: this.tokens.refreshToken,
      grant_type: 'refresh_token',
    })
    const res = await this.fetchImpl(this.oauthTokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Gmail token refresh failed: ${text.slice(0, 300)}`)
    }
    const json = (await res.json()) as {
      access_token: string
      expires_in?: number
      refresh_token?: string
    }
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? this.tokens.refreshToken,
      expiresAtMs: json.expires_in
        ? Date.now() + json.expires_in * 1000
        : null,
    }
    await this.onTokensUpdated?.(this.tokens)
  }
}

/**
 * Build a Gmail `q` fragment for sender allowlist patterns.
 * Returns null when patterns are empty/absent.
 */
export function buildGmailFromPatternsQuery(
  patterns: readonly string[] | undefined,
): string | null {
  if (patterns == null || patterns.length === 0) return null
  const parts: string[] = []
  const seen = new Set<string>()
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase()
    if (!p || seen.has(p)) continue
    seen.add(p)
    // Quote addresses so @ is not misparsed; bare domains stay unquoted.
    parts.push(p.includes('@') ? `from:"${p}"` : `from:${p}`)
  }
  if (parts.length === 0) return null
  if (parts.length === 1) return parts[0]!
  return `(${parts.join(' OR ')})`
}

export function parseGmailCursor(cursor: SyncCursor): {
  pageToken?: string
  afterUnix?: number
} {
  if (!cursor) return {}
  if (cursor.startsWith('page:')) {
    const rest = cursor.slice('page:'.length)
    const [pageToken, after] = rest.split('|')
    return {
      pageToken: pageToken || undefined,
      afterUnix: after ? Number(after) : undefined,
    }
  }
  if (cursor.startsWith('done:')) {
    const afterUnix = Number(cursor.slice('done:'.length))
    return Number.isFinite(afterUnix) ? { afterUnix } : {}
  }
  // Legacy / raw page token
  return { pageToken: cursor }
}

export function serializeGmailCursor(parts: {
  pageToken?: string
  afterUnix?: number
}): string {
  if (parts.pageToken) {
    return parts.afterUnix
      ? `page:${parts.pageToken}|${parts.afterUnix}`
      : `page:${parts.pageToken}`
  }
  if (parts.afterUnix !== undefined) {
    return `done:${parts.afterUnix}`
  }
  return ''
}

function mapGmailMessage(raw: GmailMessageResponse): EmailMessage {
  const headers = raw.payload?.headers ?? []
  const header = (name: string) =>
    headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
    ''

  const { textBody, htmlBody } = extractBodies(raw.payload)
  const internalMs = raw.internalDate ? Number(raw.internalDate) : Date.now()

  return {
    id: raw.id,
    rfcMessageId: header('Message-ID') || `<gmail-${raw.id}@gmail.local>`,
    from: header('From') || 'unknown@unknown',
    subject: header('Subject') || '(no subject)',
    receivedAt: new Date(internalMs),
    textBody,
    htmlBody,
  }
}

function extractBodies(
  payload: GmailMessageResponse['payload'],
): { textBody: string | null; htmlBody: string | null } {
  if (!payload) return { textBody: null, htmlBody: null }

  let textBody: string | null = null
  let htmlBody: string | null = null

  const visit = (part: {
    mimeType?: string
    body?: { data?: string }
    parts?: Array<{
      mimeType?: string
      body?: { data?: string }
      parts?: Array<{ mimeType?: string; body?: { data?: string } }>
    }>
  }) => {
    if (part.body?.data) {
      const decoded = decodeBase64Url(part.body.data)
      if (part.mimeType === 'text/plain' && !textBody) textBody = decoded
      if (part.mimeType === 'text/html' && !htmlBody) htmlBody = decoded
    }
    for (const child of part.parts ?? []) visit(child)
  }

  visit(payload)
  // Single-part messages: assign by mimeType. Do not copy HTML into textBody.
  if (payload.body?.data && !payload.parts) {
    const mime = (payload.mimeType ?? '').toLowerCase()
    const decoded = decodeBase64Url(payload.body.data)
    if (mime === 'text/html') {
      if (!htmlBody) htmlBody = decoded
    } else if (!textBody) {
      textBody = decoded
    }
  }
  return { textBody, htmlBody }
}

function decodeBase64Url(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
