import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { AiProviderError } from '../errors.ts'
import { buildGeminiRequestBody, GeminiProvider } from './gemini_provider.ts'

Deno.test('buildGeminiRequestBody maps roles and system + json hint', () => {
  const body = buildGeminiRequestBody({
    system: 'Be brief',
    jsonSchemaHint: '{"summary": string}',
    messages: [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
    ],
    temperature: 0.2,
  })

  assertEquals(body.systemInstruction, {
    parts: [{
      text:
        'Be brief\n\nRespond with JSON matching this schema hint:\n{"summary": string}',
    }],
  })
  assertEquals(body.contents, [
    { role: 'user', parts: [{ text: 'Hello' }] },
    { role: 'model', parts: [{ text: 'Hi' }] },
  ])
  assertEquals(body.generationConfig, { temperature: 0.2 })
})

Deno.test('GeminiProvider complete maps generateContent response', async () => {
  const calls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    calls.push(String(input))
    return new Response(
      JSON.stringify({
        candidates: [{
          content: { parts: [{ text: ' Summary text ' }] },
          finishReason: 'STOP',
        }],
      }),
      { status: 200 },
    )
  }

  const provider = new GeminiProvider({
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    fetchImpl,
  })
  const result = await provider.complete({
    messages: [{ role: 'user', content: 'Summarize this' }],
  })

  assertEquals(result.text, 'Summary text')
  assertEquals(result.model, 'gemini-2.0-flash')
  assertEquals(result.finishReason, 'STOP')
  assertEquals(calls[0]!.includes('models/gemini-2.0-flash:generateContent'), true)
  assertEquals(calls[0]!.includes('key=test-key'), true)
})

Deno.test('GeminiProvider maps 429 quota to AiProviderError', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({ error: { message: 'Quota exceeded for free tier' } }),
      { status: 429 },
    )

  const provider = new GeminiProvider({ apiKey: 'k', fetchImpl })
  const err = await assertRejects(
    () => provider.complete({ messages: [{ role: 'user', content: 'x' }] }),
    AiProviderError,
  )
  assertEquals(err.code, 'quota')
  assertEquals(err.status, 429)
})
