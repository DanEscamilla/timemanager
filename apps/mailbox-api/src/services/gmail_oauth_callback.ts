import type { Kysely } from 'kysely'
import type { Database } from '../db/types/schema.ts'
import {
  GmailOAuthError,
  buildReturnRedirect,
  exchangeAuthorizationCode,
  fetchGmailEmailAddress,
  isReturnToAllowed,
  loadGmailOAuthConfig,
  verifyOAuthState,
  type GmailOAuthConfig,
} from './gmail_oauth.ts'

export interface GmailOAuthCallbackDeps {
  db: Kysely<Database>
  fetchImpl?: typeof fetch
  nowMs?: number
  loadConfig?: () => GmailOAuthConfig
}

/**
 * Handle Google OAuth redirect: verify state, exchange code, persist tokens.
 * Returns a 302 Location toward the Flutter returnTo URL.
 */
export async function handleGmailOAuthCallback(
  requestUrl: URL,
  deps: GmailOAuthCallbackDeps,
): Promise<Response> {
  const code = requestUrl.searchParams.get('code')
  const state = requestUrl.searchParams.get('state')
  const oauthError = requestUrl.searchParams.get('error')

  let config: GmailOAuthConfig
  try {
    config = (deps.loadConfig ?? loadGmailOAuthConfig)()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'oauth_config_error'
    return new Response(`Gmail OAuth misconfigured: ${message}`, {
      status: 500,
    })
  }

  // Best-effort decode of returnTo from state for error redirects.
  let returnToFallback: string | null = null
  if (state) {
    try {
      const payload = await verifyOAuthState(
        state,
        config.clientSecret,
        deps.nowMs,
      )
      returnToFallback = payload.returnTo
    } catch {
      // ignore — handled below
    }
  }

  const redirectError = (error: string, returnTo: string | null) => {
    if (returnTo && isReturnToAllowed(returnTo, config.returnToAllowlist)) {
      return Response.redirect(
        buildReturnRedirect(returnTo, { ok: false, error }),
        302,
      )
    }
    return new Response(`Gmail OAuth failed: ${error}`, { status: 400 })
  }

  if (oauthError) {
    return redirectError(oauthError, returnToFallback)
  }
  if (!code || !state) {
    return redirectError('missing_code_or_state', returnToFallback)
  }

  let payload
  try {
    payload = await verifyOAuthState(state, config.clientSecret, deps.nowMs)
  } catch (err) {
    const message = err instanceof GmailOAuthError
      ? err.message
      : 'invalid_state'
    return redirectError(message, returnToFallback)
  }

  if (!isReturnToAllowed(payload.returnTo, config.returnToAllowlist)) {
    return new Response('Gmail OAuth failed: returnTo is not allowed', {
      status: 400,
    })
  }

  try {
    const tokens = await exchangeAuthorizationCode({
      code,
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      redirectUri: config.redirectUri,
      fetchImpl: deps.fetchImpl,
    })

    const mailbox = await deps.db
      .selectFrom('mailboxes')
      .select(['id', 'user_id', 'provider'])
      .where('id', '=', payload.mailboxId)
      .executeTakeFirst()

    if (!mailbox || mailbox.user_id !== payload.userId) {
      return redirectError('mailbox_not_found', payload.returnTo)
    }
    if (mailbox.provider !== 'gmail') {
      return redirectError('mailbox_not_gmail', payload.returnTo)
    }

    const now = new Date(
      deps.nowMs ?? Date.now(),
    ).toISOString()
    const email = await fetchGmailEmailAddress({
      accessToken: tokens.accessToken,
      fetchImpl: deps.fetchImpl,
    })
    await deps.db
      .updateTable('mailboxes')
      .set({
        oauth_tokens_json: JSON.stringify({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAtMs: tokens.expiresAtMs,
        }),
        ...(email ? { label: email } : {}),
        sync_requested: true,
        updated_at: now,
      })
      .where('id', '=', mailbox.id)
      .execute()

    return Response.redirect(
      buildReturnRedirect(payload.returnTo, { ok: true }),
      302,
    )
  } catch (err) {
    const message = err instanceof GmailOAuthError
      ? err.message
      : 'token_exchange_failed'
    return redirectError(message, payload.returnTo)
  }
}
