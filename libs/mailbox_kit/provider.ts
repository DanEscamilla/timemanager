import type { EmailMessage, ListMessagesResult, SyncCursor } from './types.ts'

export interface ListMessagesOptions {
  cursor: SyncCursor
  /** Max messages to return this page. */
  limit?: number
  /** Inclusive lower bound for receivedAt (one-shot backfill). */
  since?: Date
  /** Inclusive upper bound for receivedAt (one-shot backfill). */
  until?: Date
}

/**
 * Abstract mailbox fetch. Poll and push both end here after obtaining message ids.
 */
export interface MailboxProvider {
  readonly name: string
  listMessages(options: ListMessagesOptions): Promise<ListMessagesResult>
  getMessage(id: string): Promise<EmailMessage | null>
}
