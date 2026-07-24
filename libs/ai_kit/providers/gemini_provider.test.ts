import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { AiProviderError } from '../errors.ts'
import {
  buildGeminiRequestBody,
  GeminiProvider,
  normalizeGeminiModelId,
} from './gemini_provider.ts'

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

Deno.test('normalizeGeminiModelId strips models/ prefix', () => {
  assertEquals(normalizeGeminiModelId('models/gemini-2.0-flash'), 'gemini-2.0-flash')
  assertEquals(normalizeGeminiModelId('gemini-2.0-flash'), 'gemini-2.0-flash')
  assertEquals(normalizeGeminiModelId('  '), undefined)
})

Deno.test('GeminiProvider listModels calls ModelService.ListModels', async () => {
  const urls: string[] = []
  const fetchImpl: typeof fetch = async (input) => {
    urls.push(String(input))
    if (urls.length === 1) {
      return new Response(
        JSON.stringify({
          models: [{
            name: 'models/gemini-2.0-flash',
            displayName: 'Gemini 2.0 Flash',
            supportedGenerationMethods: ['generateContent'],
          }],
          nextPageToken: 'page-2',
        }),
        { status: 200 },
      )
    }
    return new Response(
      JSON.stringify({
        models: [{
          name: 'models/gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        }],
      }),
      { status: 200 },
    )
  }

  const provider = new GeminiProvider({
    apiKey: 'test-key',
    fetchImpl,
  })
  const models = await provider.listModels()

  assertEquals(urls.length, 2)
  assertEquals(urls[0]!.includes('/models?'), true)
  assertEquals(urls[0]!.includes('key=test-key'), true)
  assertEquals(urls[1]!.includes('pageToken=page-2'), true)
  assertEquals(models, [
    {
      id: 'gemini-2.0-flash',
      displayName: 'Gemini 2.0 Flash',
      supportedMethods: ['generateContent'],
    },
    {
      id: 'gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      supportedMethods: ['generateContent', 'countTokens'],
    },
  ])
})
