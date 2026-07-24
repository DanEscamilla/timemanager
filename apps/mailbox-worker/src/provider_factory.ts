import type { Mailbox } from 'mailbox_api/db/types/schema.ts'
import {
  FixtureMailboxProvider,
  GmailMailboxProvider,
  type GmailOAuthTokens,
  type MailboxProvider,
} from 'mailbox_kit/mod.ts'
import { db } from 'mailbox_api/db/database.ts'

export function createProviderForMailbox(mailbox: Mailbox): MailboxProvider {
  if (mailbox.provider === 'fixture') {
    return new FixtureMailboxProvider()
  }
  if (mailbox.provider === 'gmail') {
    const tokens = parseTokens(mailbox.oauth_tokens_json)
    if (!tokens?.accessToken) {
      throw new Error(`mailbox ${mailbox.id}: missing Gmail OAuth tokens`)
    }
    return new GmailMailboxProvider({
      tokens,
      onTokensUpdated: async (next) => {
        await db
          .updateTable('mailboxes')
          .set({
            oauth_tokens_json: JSON.stringify(next),
            updated_at: new Date().toISOString(),
          })
          .where('id', '=', mailbox.id)
          .execute()
      },
    })
  }
  throw new Error(`unsupported provider: ${mailbox.provider}`)
}

function parseTokens(json: string | null): GmailOAuthTokens | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as GmailOAuthTokens
    if (typeof parsed.accessToken !== 'string') return null
    return parsed
  } catch {
    return null
  }
}
