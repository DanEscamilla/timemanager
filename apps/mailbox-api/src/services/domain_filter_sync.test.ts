import { assertEquals } from 'jsr:@std/assert@1'
import {
  diffNewDomainPatterns,
  mergeSyncedDomainPatterns,
  normalizeDomainPatterns,
  parseDomainPatternsJson,
  resolveSyncFetchPlan,
  serializeDomainPatternsJson,
} from './domain_filter_sync.ts'

Deno.test('normalizeDomainPatterns lowercases and dedupes', () => {
  assertEquals(
    normalizeDomainPatterns(['Amazon.com', ' amazon.com ', 'Uber.com', '']),
    ['amazon.com', 'uber.com'],
  )
})

Deno.test('parseDomainPatternsJson handles null and invalid', () => {
  assertEquals(parseDomainPatternsJson(null), [])
  assertEquals(parseDomainPatternsJson('not-json'), [])
  assertEquals(parseDomainPatternsJson('{"a":1}'), [])
  assertEquals(
    parseDomainPatternsJson('["Amazon.com","uber.com"]'),
    ['amazon.com', 'uber.com'],
  )
})

Deno.test('serializeDomainPatternsJson round-trips normalized', () => {
  const json = serializeDomainPatternsJson(['Uber.com', 'amazon.com'])
  assertEquals(json, '["uber.com","amazon.com"]')
  assertEquals(parseDomainPatternsJson(json), ['uber.com', 'amazon.com'])
})

Deno.test('diffNewDomainPatterns returns only unsynced', () => {
  assertEquals(
    diffNewDomainPatterns(
      ['amazon.com', 'uber.com', 'shop.com'],
      ['Amazon.com'],
    ),
    ['uber.com', 'shop.com'],
  )
  assertEquals(
    diffNewDomainPatterns(['amazon.com'], ['amazon.com', 'uber.com']),
    [],
  )
})

Deno.test('mergeSyncedDomainPatterns drops removed and unions completed', () => {
  assertEquals(
    mergeSyncedDomainPatterns(
      ['amazon.com', 'old.com'],
      ['amazon.com', 'uber.com'],
      ['uber.com'],
    ),
    ['amazon.com', 'uber.com'],
  )
})

Deno.test('resolveSyncFetchPlan expansion when new patterns', () => {
  const plan = resolveSyncFetchPlan({
    currentPatterns: ['amazon.com', 'uber.com'],
    syncedPatterns: ['amazon.com'],
  })
  assertEquals(plan.expansionMode, true)
  assertEquals(plan.fetchPatterns, ['uber.com'])
  assertEquals(plan.syncFetchPatternsJson, '["uber.com"]')
})

Deno.test('resolveSyncFetchPlan gap mode when fully synced', () => {
  const plan = resolveSyncFetchPlan({
    currentPatterns: ['amazon.com', 'uber.com'],
    syncedPatterns: ['uber.com', 'amazon.com'],
  })
  assertEquals(plan.expansionMode, false)
  assertEquals(plan.fetchPatterns, ['amazon.com', 'uber.com'])
  assertEquals(plan.syncFetchPatternsJson, null)
})

Deno.test('resolveSyncFetchPlan first sync expands all current', () => {
  const plan = resolveSyncFetchPlan({
    currentPatterns: ['amazon.com'],
    syncedPatterns: [],
  })
  assertEquals(plan.expansionMode, true)
  assertEquals(plan.fetchPatterns, ['amazon.com'])
  assertEquals(plan.syncFetchPatternsJson, '["amazon.com"]')
})
