import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
  describeInvalidFromPattern,
  InvalidMailboxError,
  validateArtifactStatus,
  validateDomainPatterns,
  validateProvider,
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

Deno.test('validateDomainPatterns accepts wildcards', () => {
  assertEquals(
    validateDomainPatterns(['*.shop.com', '*@shop.com', '*@*.shop.com']),
    ['*.shop.com', '*@shop.com', '*@*.shop.com'],
  )
  assertThrows(() => validateDomainPatterns(['*.com']), InvalidMailboxError)
  assertThrows(() => validateDomainPatterns(['*@*']), InvalidMailboxError)
})

Deno.test('describeInvalidFromPattern suggests *. for missing dot after *', () => {
  const msg = describeInvalidFromPattern(
    '*envio.santander.com.mx',
    'domain filter',
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

Deno.test('validateDomainPatterns rejects *envio… with helpful message', () => {
  const err = assertThrows(
    () => validateDomainPatterns(['*envio.santander.com.mx']),
    InvalidMailboxError,
  ) as InvalidMailboxError
  assertEquals(err.message.includes('*.envio.santander.com.mx'), true)
  assertEquals(err.message.includes('Allowed patterns:'), true)
})

Deno.test('validateArtifactStatus', () => {
  assertEquals(validateArtifactStatus('Accepted'), 'accepted')
  assertThrows(() => validateArtifactStatus('done'), InvalidMailboxError)
})
