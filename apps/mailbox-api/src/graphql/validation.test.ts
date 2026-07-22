import { assertEquals, assertThrows } from 'jsr:@std/assert@1'
import {
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

Deno.test('validateArtifactStatus', () => {
  assertEquals(validateArtifactStatus('Accepted'), 'accepted')
  assertThrows(() => validateArtifactStatus('done'), InvalidMailboxError)
})
