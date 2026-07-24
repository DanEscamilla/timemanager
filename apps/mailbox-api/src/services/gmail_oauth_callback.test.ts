import { assertEquals } from 'jsr:@std/assert@1'
import {
  buildReturnRedirect,
  signOAuthState,
  type GmailOAuthConfig,
} from './gmail_oauth.ts'
import { handleGmailOAuthCallback } from './gmail_oauth_callback.ts'

function mockConfig(): GmailOAuthConfig {
  return {
    clientId: 'cid',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:3003/oauth/gmail/callback',
    returnToAllowlist: ['http://localhost:4445'],
  }
}

type MailboxRow = {
  id: number
  user_id: number
  provider: string
}

function mockDb(mailbox: MailboxRow | null, onUpdate?: (set: unknown) => void) {
  return {
    selectFrom(_table: string) {
      return {
        select(_cols: string[]) {
          return {
            where(_col: string, _op: string, _val: unknown) {
              return {
                async executeTakeFirst() {
                  return mailbox
                },
              }
            },
          }
        },
      }
    },
    updateTable(_table: string) {
      return {
        set(values: unknown) {
          onUpdate?.(values)
          return {
            where(_col: string, _op: string, _val: unknown) {
              return {
                async execute() {
                  return { numUpdatedRows: 1n }
                },
              }
            },
          }
        },
      }
    },
  }
}

Deno.test('handleGmailOAuthCallback exchanges code and redirects', async () => {
  const now = 1_700_000_000_000
  const returnTo = 'http://localhost:4445/settings/email-import'
  const state = await signOAuthState(
    { userId: 1, mailboxId: 9, returnTo },
    'secret',
    now,
  )
  let updated: unknown
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)
    if (url.includes('/users/me/profile')) {
      return new Response(
        JSON.stringify({ emailAddress: 'me@example.com' }),
        { status: 200 },
      )
    }
    const body = String(init?.body ?? '')
    assertEquals(body.includes('code=auth-code'), true)
    return new Response(
      JSON.stringify({
        access_token: 'access',
        refresh_token: 'refresh',
        expires_in: 3600,
      }),
      { status: 200 },
    )
  }

  const res = await handleGmailOAuthCallback(
    new URL(
      `http://localhost:3003/oauth/gmail/callback?code=auth-code&state=${
        encodeURIComponent(state)
      }`,
    ),
    {
      // deno-lint-ignore no-explicit-any
      db: mockDb({ id: 9, user_id: 1, provider: 'gmail' }, (v) => {
        updated = v
      }) as any,
      fetchImpl,
      nowMs: now,
      loadConfig: mockConfig,
    },
  )

  assertEquals(res.status, 302)
  assertEquals(
    res.headers.get('Location'),
    buildReturnRedirect(returnTo, { ok: true }),
  )
  const set = updated as {
    oauth_tokens_json: string
    sync_requested: boolean
    label?: string
  }
  assertEquals(set.sync_requested, true)
  assertEquals(set.label, 'me@example.com')
  const tokens = JSON.parse(set.oauth_tokens_json) as {
    accessToken: string
    refreshToken: string
  }
  assertEquals(tokens.accessToken, 'access')
  assertEquals(tokens.refreshToken, 'refresh')
})

Deno.test('handleGmailOAuthCallback redirects error on Google denial', async () => {
  const now = 1_700_000_000_000
  const returnTo = 'http://localhost:4445/settings/email-import'
  const state = await signOAuthState(
    { userId: 1, mailboxId: 9, returnTo },
    'secret',
    now,
  )
  const res = await handleGmailOAuthCallback(
    new URL(
      `http://localhost:3003/oauth/gmail/callback?error=access_denied&state=${
        encodeURIComponent(state)
      }`,
    ),
    {
      // deno-lint-ignore no-explicit-any
      db: mockDb(null) as any,
      nowMs: now,
      loadConfig: mockConfig,
    },
  )
  assertEquals(res.status, 302)
  const loc = res.headers.get('Location')!
  const url = new URL(loc)
  assertEquals(url.searchParams.get('gmail'), 'error')
  assertEquals(url.searchParams.get('error'), 'access_denied')
})
