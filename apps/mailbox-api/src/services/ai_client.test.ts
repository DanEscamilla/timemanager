import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  AiClientError,
  classifyEmailSpendRelevance,
  generateEmailRejectTemplate,
  generateEmailSpendTemplate,
} from './ai_client.ts'

Deno.test('generateEmailSpendTemplate posts to ai-api use case', async () => {
  let seenUrl = ''
  let seenAuth = ''
  let seenBody: unknown

  const out = await generateEmailSpendTemplate(
    {
      from: 'receipts@shop.com',
      subject: 'Your order',
      textBody: 'Total $12.99',
      htmlBody: null,
      hints: null,
    },
    {
      baseUrl: 'http://ai.test',
      serviceKey: 'test-key',
      fetchImpl: (input, init) => {
        seenUrl = String(input)
        seenAuth = (init?.headers as Record<string, string>).Authorization
        seenBody = JSON.parse(String(init?.body))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output: {
                matchFromPattern: '*@shop.com',
                matchSubjectRegex: 'order',
                extractors: { amount: { source: 'text', regex: '(\\d+)', group: 1 } },
                nameSuggestion: 'Shop receipts',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      },
    },
  )

  assertEquals(
    seenUrl,
    'http://ai.test/v1/use-cases/generate_email_spend_template/run',
  )
  assertEquals(seenAuth, 'Bearer test-key')
  const input = (seenBody as { input: Record<string, unknown> }).input
  assertEquals(input.from, 'receipts@shop.com')
  assertEquals(input.subject, 'Your order')
  assertEquals(out.nameSuggestion, 'Shop receipts')
  assertEquals(out.matchFromPattern, '*@shop.com')
})

Deno.test('generateEmailSpendTemplate requires service key', async () => {
  await assertRejects(
    () =>
      generateEmailSpendTemplate(
        { from: 'a@b.com', subject: 'x' },
        {
          baseUrl: 'http://ai.test',
          serviceKey: '',
          fetchImpl: () => Promise.reject(new Error('should not fetch')),
        },
      ),
    AiClientError,
    'AI_SERVICE_KEY is not configured',
  )
})

Deno.test('generateEmailSpendTemplate throws AiClientError on non-ok', async () => {
  await assertRejects(
    () =>
      generateEmailSpendTemplate(
        { from: 'a@b.com', subject: 'x' },
        {
          baseUrl: 'http://ai.test',
          serviceKey: 'test-key',
          fetchImpl: () =>
            Promise.resolve(
              new Response('model overloaded: quota exceeded xyz', {
                status: 503,
              }),
            ),
        },
      ),
    AiClientError,
    'ai-api error 503',
  )
})

Deno.test('generateEmailRejectTemplate posts to reject use case', async () => {
  let seenUrl = ''
  const out = await generateEmailRejectTemplate(
    {
      from: 'promos@bank.com',
      subject: 'Oferta especial',
      textBody: 'No es un cargo',
    },
    {
      baseUrl: 'http://ai.test',
      serviceKey: 'test-key',
      fetchImpl: (input) => {
        seenUrl = String(input)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output: {
                matchFromPattern: 'bank.com',
                matchSubjectRegex: 'oferta',
                nameSuggestion: 'Bank promos',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      },
    },
  )
  assertEquals(
    seenUrl,
    'http://ai.test/v1/use-cases/generate_email_reject_template/run',
  )
  assertEquals(out.nameSuggestion, 'Bank promos')
  assertEquals(out.matchSubjectRegex, 'oferta')
})

Deno.test('classifyEmailSpendRelevance posts to classify use case', async () => {
  let seenUrl = ''
  const out = await classifyEmailSpendRelevance(
    {
      from: 'alertas@bank.com',
      subject: 'Compra',
      textBody: 'Cargo $10',
    },
    {
      baseUrl: 'http://ai.test',
      serviceKey: 'test-key',
      fetchImpl: (input) => {
        seenUrl = String(input)
        return Promise.resolve(
          new Response(
            JSON.stringify({
              output: {
                useful: true,
                reason: 'Purchase charge',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      },
    },
  )
  assertEquals(
    seenUrl,
    'http://ai.test/v1/use-cases/classify_email_spend_relevance/run',
  )
  assertEquals(out.useful, true)
  assertEquals(out.reason, 'Purchase charge')
})
