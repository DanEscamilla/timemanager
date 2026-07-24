import type { Kysely } from 'kysely'
import type { Database } from '../db/types/schema.ts'
import { asIsoTimestamp } from '../graphql/timestamps.ts'

/** GraphQL Message shape (ISO timestamps as strings). */
export type OwnedMessage = {
  id: number
  mailbox_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: string
  text_body: string | null
  html_body: string | null
  created_at: string
}

export type MessageJoinRow = {
  id: number
  mailbox_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: Date | string
  text_body: string | null
  html_body: string | null
  created_at: Date | string
}

/** Minimal store so ownership / missing paths can be unit-tested without Postgres. */
export type MessageLookupStore = {
  findOwnedMessageRow(
    userId: number,
    messageId: number,
  ): Promise<MessageJoinRow | undefined>
  findSourceMessageRow(
    userId: number,
    expenseId: number,
  ): Promise<MessageJoinRow | undefined>
}

export function mapOwnedMessage(row: MessageJoinRow): OwnedMessage {
  return {
    id: row.id,
    mailbox_id: row.mailbox_id,
    provider_message_id: row.provider_message_id,
    rfc_message_id: row.rfc_message_id,
    from_address: row.from_address,
    subject: row.subject,
    received_at: asIsoTimestamp(row.received_at),
    text_body: row.text_body ?? null,
    html_body: row.html_body ?? null,
    created_at: asIsoTimestamp(row.created_at),
  }
}

export function createKyselyMessageLookupStore(
  db: Kysely<Database>,
): MessageLookupStore {
  return {
    async findOwnedMessageRow(userId, messageId) {
      return await db
        .selectFrom('messages')
        .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
        .selectAll('messages')
        .where('messages.id', '=', messageId)
        .where('mailboxes.user_id', '=', userId)
        .executeTakeFirst()
    },
    async findSourceMessageRow(userId, expenseId) {
      return await db
        .selectFrom('extraction_artifacts')
        .innerJoin(
          'messages',
          'messages.id',
          'extraction_artifacts.message_id',
        )
        .innerJoin('mailboxes', 'mailboxes.id', 'messages.mailbox_id')
        .selectAll('messages')
        .where('extraction_artifacts.published_expense_id', '=', expenseId)
        .where('extraction_artifacts.status', '=', 'accepted')
        .where('mailboxes.user_id', '=', userId)
        .orderBy('extraction_artifacts.id', 'desc')
        .executeTakeFirst()
    },
  }
}

/** User-scoped message by id. Returns null when missing or not owned. */
export async function findOwnedMessage(
  store: MessageLookupStore,
  userId: number,
  messageId: number,
): Promise<OwnedMessage | null> {
  const row = await store.findOwnedMessageRow(userId, messageId)
  return row ? mapOwnedMessage(row) : null
}

/**
 * Reverse lookup: accepted artifact with published_expense_id → source message.
 * Returns null when no matching accepted publish exists for this user.
 */
export async function findSourceMessageForExpense(
  store: MessageLookupStore,
  userId: number,
  expenseId: number,
): Promise<OwnedMessage | null> {
  const row = await store.findSourceMessageRow(userId, expenseId)
  return row ? mapOwnedMessage(row) : null
}
