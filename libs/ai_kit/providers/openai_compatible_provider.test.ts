import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { AiProviderError } from '../errors.ts'
import {
  buildOpenAiChatBody,
  OpenAiCompatibleProvider,
} from './openai_compatible_provider.ts'

Deno.test('buildOpenAiChatBody includes system and json hint', () => {
  const body = buildOpenAiChatBody(
    {
      system: 'Be brief',
      jsonSchemaHint: '{"summary": string}',
      messages: [{ role: 'user', content: 'Hello' }],
      temperature: 0.1,
    },
    'llama3.2',
  )

  assertEquals(body.model, 'llama3.2')
  assertEquals(body.temperature, 0.1)
  assertEquals(body.messages, [
    {
      role: 'system',
      content:
        'Be brief\n\nRespond with JSON matching this schema hint:\n{"summary": string}',
    },
    { role: 'user', content: 'Hello' },
  ])
})

Deno.test('OpenAiCompatibleProvider posts to /chat/completions', async () => {
  let seenUrl = ''
  let seenAuth = ''
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = String(input)
    seenAuth = new Headers(init?.headers).get('Authorization') ?? ''
    return new Response(
      JSON.stringify({
        model: 'llama3.2',
        choices: [{
          message: { content: 'Done' },
          finish_reason: 'stop',
        }],
      }),
      { status: 200 },
    )
  }

  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'http://localhost:11434/v1/',
    apiKey: 'ollama-key',
    fetchImpl,
  })
  const result = await provider.complete({
    messages: [{ role: 'user', content: 'Hi' }],
  })

  assertEquals(seenUrl, 'http://localhost:11434/v1/chat/completions')
  assertEquals(seenAuth, 'Bearer ollama-key')
  assertEquals(result.text, 'Done')
  assertEquals(result.model, 'llama3.2')
})

Deno.test('OpenAiCompatibleProvider maps auth failures', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ error: { message: 'bad key' } }), {
      status: 401,
    })

  const provider = new OpenAiCompatibleProvider({
    baseUrl: 'http://localhost:11434/v1',
    fetchImpl,
  })
  const err = await assertRejects(
    () => provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    AiProviderError,
  )
  assertEquals(err.code, 'auth')
})
