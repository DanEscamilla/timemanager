import { assertEquals } from 'jsr:@std/assert@1'
import {
  filterMessagesByDomain,
  matchesDomainFilter,
  matchesFromPattern,
} from './domain_filter.ts'

Deno.test('matchesDomainFilter: empty patterns reject all', () => {
  assertEquals(matchesDomainFilter('a@b.com', []), false)
  assertEquals(matchesDomainFilter('a@b.com', null), false)
  assertEquals(filterMessagesByDomain([{ from: 'a@b.com' }], []), [])
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

Deno.test('matchesDomainFilter: *.shop.com matches subdomains only', () => {
  assertEquals(
    matchesDomainFilter('a@mail.shop.com', ['*.shop.com']),
    true,
  )
  assertEquals(matchesDomainFilter('a@shop.com', ['*.shop.com']), false)
  assertEquals(matchesDomainFilter('a@evil.com', ['*.shop.com']), false)
})

Deno.test('matchesDomainFilter: *@shop.com any local-part at apex', () => {
  assertEquals(
    matchesDomainFilter('noreply@shop.com', ['*@shop.com']),
    true,
  )
  assertEquals(
    matchesDomainFilter('billing@shop.com', ['*@shop.com']),
    true,
  )
  assertEquals(
    matchesDomainFilter('a@mail.shop.com', ['*@shop.com']),
    false,
  )
})

Deno.test('matchesDomainFilter: *@*.shop.com any local at subdomain', () => {
  assertEquals(
    matchesDomainFilter('x@mail.shop.com', ['*@*.shop.com']),
    true,
  )
  assertEquals(matchesDomainFilter('x@shop.com', ['*@*.shop.com']), false)
})

Deno.test('matchesFromPattern mirrors single-pattern rules', () => {
  assertEquals(matchesFromPattern('a@b.shop.com', '*.shop.com'), true)
  assertEquals(matchesFromPattern('a@shop.com', '*.shop.com'), false)
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
