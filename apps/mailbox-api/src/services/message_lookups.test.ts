import { assertEquals } from 'jsr:@std/assert@1'
import {
  findOwnedMessage,
  findSourceMessageForExpense,
  mapOwnedMessage,
  type MessageJoinRow,
  type MessageLookupStore,
} from './message_lookups.ts'

const sampleRow: MessageJoinRow = {
  id: 7,
  mailbox_id: 2,
  provider_message_id: 'g-1',
  rfc_message_id: '<a@b>',
  from_address: 'receipts@shop.com',
  subject: 'Your order',
  received_at: '2026-07-22T12:00:00.000Z',
  text_body: 'Total $12.99',
  html_body: '<p>Total $12.99</p>',
  created_at: '2026-07-22T12:01:00.000Z',
}

function fakeStore(opts: {
  owned?: MessageJoinRow | undefined
  source?: MessageJoinRow | undefined
  seenOwned?: { userId: number; messageId: number }[]
  seenSource?: { userId: number; expenseId: number }[]
}): MessageLookupStore {
  return {
    async findOwnedMessageRow(userId, messageId) {
      opts.seenOwned?.push({ userId, messageId })
      return opts.owned
    },
    async findSourceMessageRow(userId, expenseId) {
      opts.seenSource?.push({ userId, expenseId })
      return opts.source
    },
  }
}

Deno.test('mapOwnedMessage normalizes null bodies and ISO timestamps', () => {
  const mapped = mapOwnedMessage({
    ...sampleRow,
    text_body: null,
    html_body: '<p>Hi</p>',
  })

  assertEquals(mapped.id, 7)
  assertEquals(mapped.text_body, null)
  assertEquals(mapped.html_body, '<p>Hi</p>')
  assertEquals(mapped.received_at, '2026-07-22T12:00:00.000Z')
})

Deno.test('findOwnedMessage returns mapped row for owner', async () => {
  const seenOwned: { userId: number; messageId: number }[] = []
  const result = await findOwnedMessage(
    fakeStore({ owned: sampleRow, seenOwned }),
    9,
    7,
  )
  assertEquals(result?.subject, 'Your order')
  assertEquals(result?.text_body, 'Total $12.99')
  assertEquals(seenOwned, [{ userId: 9, messageId: 7 }])
})

Deno.test('findOwnedMessage returns null when missing or not owned', async () => {
  const result = await findOwnedMessage(
    fakeStore({ owned: undefined }),
    9,
    99,
  )
  assertEquals(result, null)
})

Deno.test('findSourceMessageForExpense returns message for accepted publish', async () => {
  const seenSource: { userId: number; expenseId: number }[] = []
  const result = await findSourceMessageForExpense(
    fakeStore({ source: sampleRow, seenSource }),
    3,
    42,
  )
  assertEquals(result?.id, 7)
  assertEquals(seenSource, [{ userId: 3, expenseId: 42 }])
})

Deno.test('findSourceMessageForExpense returns null when no artifact', async () => {
  const result = await findSourceMessageForExpense(
    fakeStore({ source: undefined }),
    3,
    99,
  )
  assertEquals(result, null)
})
