import { assertEquals } from 'jsr:@std/assert@1'
import {
  GmailMailboxProvider,
  parseGmailCursor,
  serializeGmailCursor,
} from './gmail_provider.ts'

Deno.test('gmail cursor serialize/parse', () => {
  assertEquals(parseGmailCursor(null), {})
  assertEquals(parseGmailCursor('done:1700000000'), { afterUnix: 1700000000 })
  const page = serializeGmailCursor({ pageToken: 'abc', afterUnix: 1 })
  assertEquals(page, 'page:abc|1')
  assertEquals(parseGmailCursor(page), { pageToken: 'abc', afterUnix: 1 })
})

Deno.test('GmailMailboxProvider listMessages maps headers', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    calls.push(url)
    if (url.includes('/messages?')) {
      return new Response(
        JSON.stringify({ messages: [{ id: 'm1' }] }),
        { status: 200 },
      )
    }
    if (url.includes('/messages/m1')) {
      return new Response(
        JSON.stringify({
          id: 'm1',
          internalDate: '1720000000000',
          payload: {
            headers: [
              { name: 'From', value: 'Shop <orders@shop.example>' },
              { name: 'Subject', value: 'Receipt $12.00' },
              { name: 'Message-ID', value: '<m1@shop.example>' },
            ],
            body: {
              data: btoa('Total: $12.00 USD'),
            },
            mimeType: 'text/plain',
          },
        }),
        { status: 200 },
      )
    }
    return new Response('not found', { status: 404 })
  }

  const provider = new GmailMailboxProvider({
    tokens: { accessToken: 'tok' },
    fetchImpl,
  })
  const result = await provider.listMessages({ cursor: null, limit: 10 })
  assertEquals(result.messages.length, 1)
  assertEquals(result.messages[0]!.from, 'Shop <orders@shop.example>')
  assertEquals(result.messages[0]!.rfcMessageId, '<m1@shop.example>')
  assertEquals(result.nextCursor?.startsWith('done:'), true)
  assertEquals(calls.length >= 2, true)
})
