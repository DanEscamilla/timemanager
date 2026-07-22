import { assertEquals } from 'jsr:@std/assert@1'
import type { AiProvider, CompletionRequest, CompletionResult } from 'ai_kit/mod.ts'
import { createHandler } from './server.ts'

class FakeProvider implements AiProvider {
  readonly name = 'fake'
  lastRequest: CompletionRequest | null = null

  complete(request: CompletionRequest): Promise<CompletionResult> {
    this.lastRequest = request
    return Promise.resolve({
      text: 'A short summary.',
      model: 'fake-model',
    })
  }
}

const serviceKey = 'test-service-key'

function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${serviceKey}` }
}

Deno.test('GET /health is public', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(new Request('http://localhost/health'))
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { ok: true })
})

Deno.test('protected routes require service key', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(new Request('http://localhost/v1/use-cases'))
  assertEquals(res.status, 401)
})

Deno.test('GET /v1/use-cases lists registry', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases', { headers: authHeaders() }),
  )
  assertEquals(res.status, 200)
  const body = await res.json()
  assertEquals(
    body.useCases.some((uc: { id: string }) => uc.id === 'summarize_text'),
    true,
  )
})

Deno.test('POST unknown use case returns 404', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/missing/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: 'hi' } }),
    }),
  )
  assertEquals(res.status, 404)
})

Deno.test('POST summarize_text runs with fake provider', async () => {
  const provider = new FakeProvider()
  const handler = createHandler({ serviceKey, provider })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/summarize_text/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: 'Long article about cats and dogs.' },
      }),
    }),
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { output: { summary: 'A short summary.' } })
  assertEquals(provider.lastRequest?.messages[0]?.content.includes('cats'), true)
})

Deno.test('POST summarize_text validates input', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/summarize_text/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: '' } }),
    }),
  )
  assertEquals(res.status, 400)
})
