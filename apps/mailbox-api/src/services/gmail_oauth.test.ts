import {
  assertEquals,
  assertRejects,
  assertThrows,
} from 'jsr:@std/assert@1'
import {
  GmailOAuthError,
  buildGoogleAuthorizeUrl,
  buildReturnRedirect,
  exchangeAuthorizationCode,
  fetchGmailEmailAddress,
  isReturnToAllowed,
  loadGmailOAuthConfig,
  signOAuthState,
  verifyOAuthState,
} from './gmail_oauth.ts'

Deno.test('loadGmailOAuthConfig requires client credentials', () => {
  assertThrows(
    () => loadGmailOAuthConfig({}),
    GmailOAuthError,
  )
  const cfg = loadGmailOAuthConfig({
    GMAIL_OAUTH_CLIENT_ID: 'cid',
    GMAIL_OAUTH_CLIENT_SECRET: 'secret',
  })
  assertEquals(cfg.clientId, 'cid')
  assertEquals(cfg.redirectUri, 'http://localhost:3003/oauth/gmail/callback')
  assertEquals(cfg.returnToAllowlist, [
    'http://localhost:4445',
    'spendmanager://settings/email-import',
  ])
})

Deno.test('isReturnToAllowed matches origin allowlist', () => {
  const allow = ['http://localhost:4445']
  assertEquals(
    isReturnToAllowed('http://localhost:4445/settings/email-import', allow),
    true,
  )
  assertEquals(
    isReturnToAllowed('http://localhost:4445/settings/email-import?x=1', allow),
    true,
  )
  assertEquals(
    isReturnToAllowed('http://127.0.0.1:4445/settings/email-import', allow),
    false,
  )
  assertEquals(
    isReturnToAllowed('https://evil.example/phish', allow),
    false,
  )
  assertEquals(isReturnToAllowed('not a url', allow), false)
})

Deno.test('isReturnToAllowed supports custom scheme prefix', () => {
  const allow = ['spendmanager://settings/email-import']
  assertEquals(
    isReturnToAllowed('spendmanager://settings/email-import', allow),
    true,
  )
  assertEquals(
    isReturnToAllowed('spendmanager://settings/other', allow),
    false,
  )
})

Deno.test('sign and verify OAuth state round-trip', async () => {
  const secret = 'test-secret'
  const now = 1_700_000_000_000
  const state = await signOAuthState(
    {
      userId: 7,
      mailboxId: 3,
      returnTo: 'http://localhost:4445/settings/email-import',
    },
    secret,
    now,
  )
  const payload = await verifyOAuthState(state, secret, now)
  assertEquals(payload.userId, 7)
  assertEquals(payload.mailboxId, 3)
  assertEquals(payload.returnTo, 'http://localhost:4445/settings/email-import')
})

Deno.test('verifyOAuthState rejects bad signature and expiry', async () => {
  const secret = 'test-secret'
  const now = 1_700_000_000_000
  const state = await signOAuthState(
    {
      userId: 1,
      mailboxId: 2,
      returnTo: 'http://localhost:4445/settings/email-import',
      exp: Math.floor(now / 1000) - 1,
    },
    secret,
    now,
  )
  await assertRejects(
    () => verifyOAuthState(state, secret, now),
    GmailOAuthError,
  )

  const good = await signOAuthState(
    {
      userId: 1,
      mailboxId: 2,
      returnTo: 'http://localhost:4445/settings/email-import',
    },
    secret,
    now,
  )
  await assertRejects(
    () => verifyOAuthState(good + 'x', secret, now),
    GmailOAuthError,
  )
  await assertRejects(
    () => verifyOAuthState(good, 'other-secret', now),
    GmailOAuthError,
  )
})

Deno.test('buildGoogleAuthorizeUrl includes offline consent params', () => {
  const url = new URL(
    buildGoogleAuthorizeUrl({
      clientId: 'cid',
      redirectUri: 'http://localhost:3003/oauth/gmail/callback',
      state: 'abc',
    }),
  )
  assertEquals(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
  assertEquals(url.searchParams.get('client_id'), 'cid')
  assertEquals(url.searchParams.get('access_type'), 'offline')
  assertEquals(url.searchParams.get('prompt'), 'consent')
  assertEquals(url.searchParams.get('response_type'), 'code')
  assertEquals(
    url.searchParams.get('scope'),
    'https://www.googleapis.com/auth/gmail.readonly',
  )
  assertEquals(url.searchParams.get('state'), 'abc')
})

Deno.test('exchangeAuthorizationCode maps token response', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: 'at',
        refresh_token: 'rt',
        expires_in: 3600,
      }),
      { status: 200 },
    )
  const before = Date.now()
  const tokens = await exchangeAuthorizationCode({
    code: 'code',
    clientId: 'cid',
    clientSecret: 'sec',
    redirectUri: 'http://localhost:3003/oauth/gmail/callback',
    fetchImpl,
  })
  assertEquals(tokens.accessToken, 'at')
  assertEquals(tokens.refreshToken, 'rt')
  assertEquals(typeof tokens.expiresAtMs, 'number')
  assertEquals((tokens.expiresAtMs ?? 0) >= before + 3600_000 - 1000, true)
})

Deno.test('buildReturnRedirect sets gmail query', () => {
  assertEquals(
    buildReturnRedirect('http://localhost:4445/settings/email-import', {
      ok: true,
    }),
    'http://localhost:4445/settings/email-import?gmail=connected',
  )
  const err = buildReturnRedirect(
    'http://localhost:4445/settings/email-import',
    { ok: false, error: 'denied' },
  )
  const url = new URL(err)
  assertEquals(url.searchParams.get('gmail'), 'error')
  assertEquals(url.searchParams.get('error'), 'denied')
})

Deno.test('fetchGmailEmailAddress reads profile email', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    assertEquals(
      String(input),
      'https://gmail.googleapis.com/gmail/v1/users/me/profile',
    )
    return new Response(
      JSON.stringify({ emailAddress: ' user@gmail.com ' }),
      { status: 200 },
    )
  }
  assertEquals(
    await fetchGmailEmailAddress({ accessToken: 'tok', fetchImpl }),
    'user@gmail.com',
  )
})

Deno.test('fetchGmailEmailAddress returns null on failure', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('nope', { status: 401 })
  assertEquals(
    await fetchGmailEmailAddress({ accessToken: 'tok', fetchImpl }),
    null,
  )
})
