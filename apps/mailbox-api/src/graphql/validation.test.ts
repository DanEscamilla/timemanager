import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  clampArtifactPage,
  describeInvalidDomainFilter,
  describeInvalidFromPattern,
  InvalidMailboxError,
  validateArtifactStatus,
  validateDomainPatterns,
  validateMatchFromPattern,
  validateOptionalSyncDate,
  validateProvider,
  validateSyncDateRange,
  validateTemplateKind,
} from './validation.ts'

Deno.test('validateProvider accepts fixture and gmail', () => {
  assertEquals(validateProvider('Fixture'), 'fixture')
  assertEquals(validateProvider('gmail'), 'gmail')
  assertThrows(() => validateProvider('imap'), InvalidMailboxError)
})

Deno.test('validateDomainPatterns normalizes', () => {
  assertEquals(validateDomainPatterns([' Amazon.com ', 'amazon.com']), [
    'amazon.com',
  ])
  assertThrows(() => validateDomainPatterns(['nodot']), InvalidMailboxError)
})

Deno.test('validateDomainPatterns requires at least one pattern', () => {
  const err = assertThrows(
    () => validateDomainPatterns([]),
    InvalidMailboxError,
  ) as InvalidMailboxError
  assertEquals(err.message, 'domain filters are required')
  assertThrows(() => validateDomainPatterns(['  ', '']), InvalidMailboxError)
})

Deno.test('validateDomainPatterns accepts domain and exact address', () => {
  assertEquals(validateDomainPatterns(['shop.com', 'user@shop.com']), [
    'shop.com',
    'user@shop.com',
  ])
})

Deno.test('validateDomainPatterns rejects wildcards', () => {
  assertThrows(
    () => validateDomainPatterns(['*.shop.com']),
    InvalidMailboxError,
  )
  assertThrows(
    () => validateDomainPatterns(['*@shop.com']),
    InvalidMailboxError,
  )
  assertThrows(
    () => validateDomainPatterns(['*@*.shop.com']),
    InvalidMailboxError,
  )
  assertThrows(() => validateDomainPatterns(['*.com']), InvalidMailboxError)
})

Deno.test('describeInvalidDomainFilter rejects wildcards with domain hint', () => {
  const msg = describeInvalidDomainFilter('*.envio.santander.com.mx')
  assertEquals(msg.includes('wildcards are not allowed'), true)
  assertEquals(msg.includes('envio.santander.com.mx'), true)
  assertEquals(msg.includes('Allowed patterns:'), true)
})

Deno.test('validateDomainPatterns rejects *envio… with no-wildcard message', () => {
  const err = assertThrows(
    () => validateDomainPatterns(['*envio.santander.com.mx']),
    InvalidMailboxError,
  ) as InvalidMailboxError
  assertEquals(err.message.includes('wildcards are not allowed'), true)
  assertEquals(err.message.includes('envio.santander.com.mx'), true)
})

Deno.test('validateMatchFromPattern still allows wildcards for templates', () => {
  assertEquals(validateMatchFromPattern('*.shop.com'), '*.shop.com')
  assertEquals(validateMatchFromPattern('*@shop.com'), '*@shop.com')
  assertThrows(() => validateMatchFromPattern('*.com'), InvalidMailboxError)
})

Deno.test('describeInvalidFromPattern suggests *. for missing dot after *', () => {
  const msg = describeInvalidFromPattern(
    '*envio.santander.com.mx',
    'matchFromPattern',
  )
  assertEquals(
    msg.includes('*.envio.santander.com.mx'),
    true,
    `expected suggestion in: ${msg}`,
  )
  assertEquals(
    msg.includes('envio.santander.com.mx'),
    true,
  )
  assertEquals(msg.includes('Allowed patterns:'), true)
})

Deno.test('validateArtifactStatus', () => {
  assertEquals(validateArtifactStatus('Accepted'), 'accepted')
  assertThrows(() => validateArtifactStatus('done'), InvalidMailboxError)
})

Deno.test('validateOptionalSyncDate and range', () => {
  assertEquals(validateOptionalSyncDate(null, 'since'), null)
  assertEquals(validateOptionalSyncDate('  ', 'since'), null)
  const iso = validateOptionalSyncDate('2026-06-01T00:00:00.000Z', 'since')
  assertEquals(iso, '2026-06-01T00:00:00.000Z')
  assertThrows(
    () => validateOptionalSyncDate('not-a-date', 'since'),
    InvalidMailboxError,
  )
  assertThrows(
    () =>
      validateSyncDateRange(
        '2026-07-01T00:00:00.000Z',
        '2026-06-01T00:00:00.000Z',
      ),
    InvalidMailboxError,
  )
  assertEquals(
    validateSyncDateRange(
      '2026-06-01T00:00:00.000Z',
      '2026-07-01T00:00:00.000Z',
    ),
    {
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-07-01T00:00:00.000Z',
    },
  )
})

Deno.test('clampArtifactPage defaults and clamps', () => {
  assertEquals(clampArtifactPage(null, null), {
    page: 1,
    pageSize: 20,
    offset: 0,
  })
  assertEquals(clampArtifactPage(2, 10), {
    page: 2,
    pageSize: 10,
    offset: 10,
  })
  assertEquals(clampArtifactPage(0, 500), {
    page: 1,
    pageSize: 100,
    offset: 0,
  })
})

Deno.test('validateTemplateKind accepts approve and reject', () => {
  assertEquals(validateTemplateKind('Approve'), 'approve')
  assertEquals(validateTemplateKind('reject'), 'reject')
  assertThrows(() => validateTemplateKind('ignore'), InvalidMailboxError)
})
