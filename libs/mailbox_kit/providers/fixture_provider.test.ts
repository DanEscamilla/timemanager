import { assertEquals } from 'jsr:@std/assert@1'
import { FixtureMailboxProvider } from './fixture_provider.ts'

Deno.test('FixtureMailboxProvider paginates with cursor', async () => {
  const provider = new FixtureMailboxProvider()
  const page1 = await provider.listMessages({ cursor: null, limit: 2 })
  assertEquals(page1.messages.length, 2)
  assertEquals(page1.nextCursor, '2')

  const page2 = await provider.listMessages({ cursor: page1.nextCursor, limit: 2 })
  assertEquals(page2.messages.length, 1)
  assertEquals(page2.nextCursor, '3')

  const page3 = await provider.listMessages({ cursor: page2.nextCursor, limit: 2 })
  assertEquals(page3.messages.length, 0)
  assertEquals(page3.nextCursor, '3')
})

Deno.test('FixtureMailboxProvider getMessage', async () => {
  const provider = new FixtureMailboxProvider()
  const msg = await provider.getMessage('fixture-1')
  assertEquals(msg?.subject.includes('Amazon'), true)
  assertEquals(await provider.getMessage('missing'), null)
})

Deno.test('FixtureMailboxProvider filters by fromPatterns', async () => {
  const provider = new FixtureMailboxProvider()
  const page = await provider.listMessages({
    cursor: null,
    limit: 50,
    fromPatterns: ['uber.com'],
  })
  assertEquals(page.messages.length, 1)
  assertEquals(page.messages[0]!.id, 'fixture-2')
})

Deno.test('FixtureMailboxProvider fromPatterns + date range', async () => {
  const provider = new FixtureMailboxProvider()
  const page = await provider.listMessages({
    cursor: null,
    limit: 50,
    since: new Date('2026-07-01T00:00:00.000Z'),
    until: new Date('2026-07-03T23:59:59.999Z'),
    fromPatterns: ['amazon.com'],
  })
  assertEquals(page.messages.length, 1)
  assertEquals(page.messages[0]!.id, 'fixture-1')
  assertEquals(page.nextCursor, null)
})
