import { assertEquals } from 'jsr:@std/assert@1'
import {
  messageMatchesAnyTemplate,
  messageMatchesTemplate,
} from './template_match.ts'

const msg = {
  from: 'Amazon <noreply@amazon.com>',
  subject: 'Your Amazon.com order receipt',
}

Deno.test('messageMatchesTemplate: from + subject', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'amazon.com',
      matchSubjectRegex: 'receipt',
      enabled: true,
    }),
    true,
  )
})

Deno.test('messageMatchesTemplate: rejects disabled', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'amazon.com',
      enabled: false,
    }),
    false,
  )
})

Deno.test('messageMatchesTemplate: rejects from mismatch', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'uber.com',
      enabled: true,
    }),
    false,
  )
})

Deno.test('messageMatchesTemplate: rejects subject mismatch', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'amazon.com',
      matchSubjectRegex: 'invoice',
      enabled: true,
    }),
    false,
  )
})

Deno.test('messageMatchesTemplate: invalid subject regex is non-match', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'amazon.com',
      matchSubjectRegex: '(unclosed',
      enabled: true,
    }),
    false,
  )
})

Deno.test('messageMatchesTemplate: exact sender address', () => {
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'noreply@amazon.com',
      enabled: true,
    }),
    true,
  )
  assertEquals(
    messageMatchesTemplate(msg, {
      matchFromPattern: 'other@amazon.com',
      enabled: true,
    }),
    false,
  )
})

Deno.test('messageMatchesAnyTemplate: any match wins', () => {
  assertEquals(
    messageMatchesAnyTemplate(msg, [
      { matchFromPattern: 'uber.com', enabled: true },
      { matchFromPattern: 'amazon.com', matchSubjectRegex: 'receipt' },
    ]),
    true,
  )
  assertEquals(
    messageMatchesAnyTemplate(msg, [
      { matchFromPattern: 'uber.com', enabled: true },
    ]),
    false,
  )
})
