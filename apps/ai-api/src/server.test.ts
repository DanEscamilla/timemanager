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

  listModels() {
    return Promise.resolve([{ id: 'fake-model', displayName: 'Fake Model' }])
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
  const summarize = body.useCases.find(
    (uc: { id: string }) => uc.id === 'summarize_text',
  )
  assertEquals(summarize !== undefined, true)
  assertEquals(Array.isArray(summarize.inputFields), true)
  assertEquals(
    summarize.inputFields.some(
      (f: { name: string }) => f.name === 'text',
    ),
    true,
  )
  assertEquals(
    summarize.inputFields.some(
      (f: { name: string; default?: number }) =>
        f.name === 'maxSentences' && f.default === 2,
    ),
    true,
  )
})

Deno.test('GET /v1/models lists provider models', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(
    new Request('http://localhost/v1/models', { headers: authHeaders() }),
  )
  assertEquals(res.status, 200)
  assertEquals(await res.json(), {
    provider: 'fake',
    models: [{ id: 'fake-model', displayName: 'Fake Model' }],
  })
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

Deno.test('POST summarize_text forwards model override', async () => {
  const provider = new FakeProvider()
  const handler = createHandler({
    serviceKey,
    provider,
    env: { AI_MODEL_LOW: 'tier-low', AI_MODEL_HIGH: 'tier-high' },
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/summarize_text/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: 'Short note.' },
        model: 'gemini-2.0-flash',
      }),
    }),
  )
  assertEquals(res.status, 200)
  assertEquals(provider.lastRequest?.model, 'gemini-2.0-flash')
})

Deno.test('POST summarize_text uses AI_MODEL_LOW when model omitted', async () => {
  const provider = new FakeProvider()
  const handler = createHandler({
    serviceKey,
    provider,
    env: { AI_MODEL_LOW: 'tier-low', AI_MODEL_HIGH: 'tier-high' },
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/summarize_text/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: 'Short note.' } }),
    }),
  )
  assertEquals(res.status, 200)
  assertEquals(provider.lastRequest?.model, 'tier-low')
})

Deno.test('POST classify_email_spend_relevance uses AI_MODEL_LOW', async () => {
  const provider = new FakeProvider()
  provider.complete = (request) => {
    provider.lastRequest = request
    return Promise.resolve({
      text: JSON.stringify({ useful: false, reason: 'marketing' }),
      model: request.model ?? 'fake',
    })
  }
  const handler = createHandler({
    serviceKey,
    provider,
    env: { AI_MODEL_LOW: 'tier-low', AI_MODEL_HIGH: 'tier-high' },
  })
  const res = await handler(
    new Request(
      'http://localhost/v1/use-cases/classify_email_spend_relevance/run',
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            from: 'promo@shop.com',
            subject: 'Sale',
            textBody: 'Buy now',
          },
        }),
      },
    ),
  )
  assertEquals(res.status, 200)
  assertEquals(provider.lastRequest?.model, 'tier-low')
})

Deno.test('POST generate_email_spend_template uses AI_MODEL_HIGH', async () => {
  const provider = new FakeProvider()
  provider.complete = (request) => {
    provider.lastRequest = request
    return Promise.resolve({
      text: JSON.stringify({
        matchFromPattern: '*@shop.com',
        matchSubjectRegex: null,
        nameSuggestion: 'Shop receipt',
        extractors: {
          amount: { source: 'text', regex: '(\\d+)', group: 1 },
        },
      }),
      model: request.model ?? 'fake',
    })
  }
  const handler = createHandler({
    serviceKey,
    provider,
    env: { AI_MODEL_LOW: 'tier-low', AI_MODEL_HIGH: 'tier-high' },
  })
  const res = await handler(
    new Request(
      'http://localhost/v1/use-cases/generate_email_spend_template/run',
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            from: 'orders@shop.com',
            subject: 'Your order',
            textBody: 'Total $12.00',
          },
        }),
      },
    ),
  )
  assertEquals(res.status, 200)
  assertEquals(provider.lastRequest?.model, 'tier-high')
})

Deno.test('POST generate_email_reject_template uses AI_MODEL_HIGH', async () => {
  const provider = new FakeProvider()
  provider.complete = (request) => {
    provider.lastRequest = request
    return Promise.resolve({
      text: JSON.stringify({
        matchFromPattern: '*@shop.com',
        matchSubjectRegex: null,
        nameSuggestion: 'Shop promo',
      }),
      model: request.model ?? 'fake',
    })
  }
  const handler = createHandler({
    serviceKey,
    provider,
    env: { AI_MODEL_LOW: 'tier-low', AI_MODEL_HIGH: 'tier-high' },
  })
  const res = await handler(
    new Request(
      'http://localhost/v1/use-cases/generate_email_reject_template/run',
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: {
            from: 'promo@shop.com',
            subject: 'Sale',
            textBody: 'Buy now',
          },
        }),
      },
    ),
  )
  assertEquals(res.status, 200)
  assertEquals(provider.lastRequest?.model, 'tier-high')
})

Deno.test('POST run rejects empty model override', async () => {
  const handler = createHandler({
    serviceKey,
    provider: new FakeProvider(),
  })
  const res = await handler(
    new Request('http://localhost/v1/use-cases/summarize_text/run', {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: 'Short note.' },
        model: '   ',
      }),
    }),
  )
  assertEquals(res.status, 400)
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
