import { assertEquals } from 'jsr:@std/assert@1'
import { filterMessagesByDomain, matchesDomainFilter } from './domain_filter.ts'

Deno.test('matchesDomainFilter: empty patterns accept all', () => {
  assertEquals(matchesDomainFilter('a@b.com', []), true)
  assertEquals(matchesDomainFilter('a@b.com', null), true)
})

Deno.test('matchesDomainFilter: exact email', () => {
  assertEquals(
    matchesDomainFilter('Amazon <noreply@amazon.com>', ['noreply@amazon.com']),
    true,
  )
  assertEquals(
    matchesDomainFilter('Amazon <noreply@amazon.com>', ['other@amazon.com']),
    false,
  )
})

Deno.test('matchesDomainFilter: domain and subdomain', () => {
  assertEquals(
    matchesDomainFilter('x@receipts.uber.com', ['uber.com']),
    true,
  )
  assertEquals(
    matchesDomainFilter('x@receipts.uber.com', ['receipts.uber.com']),
    true,
  )
  assertEquals(matchesDomainFilter('x@evil.com', ['uber.com']), false)
})

Deno.test('filterMessagesByDomain filters list', () => {
  const msgs = [
    { from: 'a@amazon.com' },
    { from: 'b@news.example' },
  ]
  const filtered = filterMessagesByDomain(msgs, ['amazon.com'])
  assertEquals(filtered.length, 1)
  assertEquals(filtered[0]!.from, 'a@amazon.com')
})
