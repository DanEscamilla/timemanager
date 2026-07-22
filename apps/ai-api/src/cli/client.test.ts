import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { createAiApiClient } from './client.ts'

Deno.test('client.health fails with helpful message when unreachable', async () => {
  const client = createAiApiClient({
    baseUrl: 'http://localhost:3999',
    serviceKey: 'key',
    fetchImpl: () => Promise.reject(new TypeError('connection refused')),
  })
  await assertRejects(
    () => client.health(),
    Error,
    'pnpm ai',
  )
})

Deno.test('client.listUseCases returns registry payload', async () => {
  const client = createAiApiClient({
    baseUrl: 'http://localhost:3004',
    serviceKey: 'key',
    fetchImpl: (input) => {
      assertEquals(String(input), 'http://localhost:3004/v1/use-cases')
      return Promise.resolve(
        Response.json({
          useCases: [
            {
              id: 'summarize_text',
              description: 'Summarize',
              inputFields: [],
            },
          ],
        }),
      )
    },
  })
  const list = await client.listUseCases()
  assertEquals(list[0]?.id, 'summarize_text')
})

Deno.test('client.runUseCase posts input and returns status/body', async () => {
  const client = createAiApiClient({
    baseUrl: 'http://localhost:3004/',
    serviceKey: 'key',
    fetchImpl: (input, init) => {
      assertEquals(
        String(input),
        'http://localhost:3004/v1/use-cases/summarize_text/run',
      )
      assertEquals(init?.method, 'POST')
      assertEquals(JSON.parse(String(init?.body)), {
        input: { text: 'hi' },
      })
      return Promise.resolve(
        Response.json({ output: { summary: 'ok' } }, { status: 200 }),
      )
    },
  })
  const result = await client.runUseCase('summarize_text', { text: 'hi' })
  assertEquals(result, { status: 200, body: { output: { summary: 'ok' } } })
})

Deno.test('client.runUseCase includes model when provided', async () => {
  const client = createAiApiClient({
    baseUrl: 'http://localhost:3004',
    serviceKey: 'key',
    fetchImpl: (_input, init) => {
      assertEquals(JSON.parse(String(init?.body)), {
        input: { text: 'hi' },
        model: 'gemini-2.0-flash',
      })
      return Promise.resolve(
        Response.json({ output: { summary: 'ok' } }, { status: 200 }),
      )
    },
  })
  await client.runUseCase('summarize_text', { text: 'hi' }, {
    model: 'gemini-2.0-flash',
  })
})
