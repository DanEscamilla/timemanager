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

Deno.test('GmailMailboxProvider range mode uses after/before and ignores done watermark', async () => {
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
              { name: 'Subject', value: 'Receipt' },
              { name: 'Message-ID', value: '<m1@shop.example>' },
            ],
            body: { data: btoa('ok') },
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
  const since = new Date('2026-06-01T00:00:00.000Z')
  const until = new Date('2026-06-30T23:59:59.000Z')
  const result = await provider.listMessages({
    cursor: 'done:1700000000',
    limit: 10,
    since,
    until,
  })
  assertEquals(result.messages.length, 1)
  assertEquals(result.nextCursor, null)
  const listUrl = decodeURIComponent(calls.find((u) => u.includes('/messages?'))!)
  assertEquals(listUrl.includes('after:'), true)
  assertEquals(listUrl.includes('before:'), true)
  assertEquals(listUrl.includes('1700000000'), false)
})

Deno.test('GmailMailboxProvider range mode paginates with page token only', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/messages?')) {
      return new Response(
        JSON.stringify({
          messages: [{ id: 'm1' }],
          nextPageToken: 'tok2',
        }),
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
              { name: 'From', value: 'a@b.com' },
              { name: 'Subject', value: 'x' },
              { name: 'Message-ID', value: '<m1>' },
            ],
            body: { data: btoa('ok') },
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
  const result = await provider.listMessages({
    cursor: null,
    since: new Date('2026-01-01T00:00:00.000Z'),
  })
  assertEquals(result.nextCursor, 'page:tok2')
})

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

Deno.test('single-part text/html sets htmlBody only (not textBody)', async () => {
  const html = '<html><body><p>Total $12</p></body></html>'
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/messages/m1')) {
      return new Response(
        JSON.stringify({
          id: 'm1',
          internalDate: '1720000000000',
          payload: {
            mimeType: 'text/html',
            headers: [
              { name: 'From', value: 'a@b.com' },
              { name: 'Subject', value: 'Receipt' },
              { name: 'Message-ID', value: '<m1>' },
            ],
            body: { data: b64url(html) },
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
  const msg = await provider.getMessage('m1')
  assertEquals(msg?.htmlBody, html)
  assertEquals(msg?.textBody, null)
})

Deno.test('multipart/alternative maps plain and html separately', async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('/messages/m1')) {
      return new Response(
        JSON.stringify({
          id: 'm1',
          internalDate: '1720000000000',
          payload: {
            mimeType: 'multipart/alternative',
            headers: [
              { name: 'From', value: 'a@b.com' },
              { name: 'Subject', value: 'Receipt' },
              { name: 'Message-ID', value: '<m1>' },
            ],
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: b64url('Plain total $12') },
              },
              {
                mimeType: 'text/html',
                body: { data: b64url('<b>HTML total $12</b>') },
              },
            ],
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
  const msg = await provider.getMessage('m1')
  assertEquals(msg?.textBody, 'Plain total $12')
  assertEquals(msg?.htmlBody, '<b>HTML total $12</b>')
})
