import { assertEquals } from 'jsr:@std/assert@1'
import { extractServiceKey, isAuthorized } from './auth.ts'

Deno.test('extractServiceKey reads Bearer token', () => {
  const headers = new Headers({ Authorization: 'Bearer secret-key' })
  assertEquals(extractServiceKey(headers), 'secret-key')
})

Deno.test('extractServiceKey reads X-AI-Service-Key', () => {
  const headers = new Headers({ 'X-AI-Service-Key': 'header-key' })
  assertEquals(extractServiceKey(headers), 'header-key')
})

Deno.test('isAuthorized accepts matching key', () => {
  const headers = new Headers({ Authorization: 'Bearer correct' })
  assertEquals(isAuthorized(headers, 'correct'), true)
  assertEquals(isAuthorized(headers, 'wrong'), false)
})

Deno.test('isAuthorized rejects missing key', () => {
  assertEquals(isAuthorized(new Headers(), 'correct'), false)
})
