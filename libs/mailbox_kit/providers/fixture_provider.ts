import type { MailboxProvider } from '../provider.ts'
import type { EmailMessage, ListMessagesResult, SyncCursor } from '../types.ts'

const FIXTURES: EmailMessage[] = [
  {
    id: 'fixture-1',
    rfcMessageId: '<receipt-1@amazon.com>',
    from: 'Amazon <noreply@amazon.com>',
    subject: 'Your Amazon.com order receipt',
    receivedAt: new Date('2026-07-01T14:00:00.000Z'),
    textBody:
      'Thanks for your purchase.\nOrder total: $42.99 USD\nDate: 2026-07-01\n',
    htmlBody: null,
  },
  {
    id: 'fixture-2',
    rfcMessageId: '<receipt-2@uber.com>',
    from: 'Uber Receipts <noreply@receipts.uber.com>',
    subject: 'Trip receipt — Payment charged',
    receivedAt: new Date('2026-07-02T09:30:00.000Z'),
    textBody:
      'You paid $18.50 for your trip on July 2, 2026.\nTotal: $18.50 USD\n',
    htmlBody: null,
  },
  {
    id: 'fixture-3',
    rfcMessageId: '<newsletter-3@news.example>',
    from: 'Weekly News <hello@news.example>',
    subject: 'This week in tech',
    receivedAt: new Date('2026-07-03T12:00:00.000Z'),
    textBody: 'Here are stories you might like. Enjoy the weekend.',
    htmlBody: null,
  },
]

/**
 * Deterministic mailbox for local demos and tests (no network).
 * Cursor is the index of the next unread fixture (as a decimal string).
 */
export class FixtureMailboxProvider implements MailboxProvider {
  readonly name = 'fixture'

  constructor(private readonly messages: readonly EmailMessage[] = FIXTURES) {}

  async listMessages(options: {
    cursor: SyncCursor
    limit?: number
  }): Promise<ListMessagesResult> {
    const start = parseCursor(options.cursor)
    const limit = options.limit ?? 50
    const slice = this.messages.slice(start, start + limit)
    const nextIndex = start + slice.length
    const nextCursor =
      nextIndex >= this.messages.length ? String(this.messages.length) : String(nextIndex)
    return { messages: slice.map(cloneMessage), nextCursor }
  }

  async getMessage(id: string): Promise<EmailMessage | null> {
    const found = this.messages.find((m) => m.id === id)
    return found ? cloneMessage(found) : null
  }
}

function parseCursor(cursor: SyncCursor): number {
  if (cursor === null || cursor === undefined || cursor === '') return 0
  const n = Number(cursor)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
}

function cloneMessage(m: EmailMessage): EmailMessage {
  return {
    ...m,
    receivedAt: new Date(m.receivedAt.getTime()),
  }
}

export const FIXTURE_RECEIPT_MESSAGES = FIXTURES
