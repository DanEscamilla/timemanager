import { assertEquals } from 'jsr:@std/assert@1'
import {
  reevaluatePendingWithTemplate,
  toSpendParsingTemplate,
  type PendingArtifactRow,
  type ReevaluateTemplateInput,
  type TemplateReevaluateStore,
} from './template_reevaluate.ts'

const approveExtractors = {
  amount: {
    source: 'text',
    regex: 'Total:\\s*\\$?([0-9.]+)',
    group: 1,
  },
  currency: { source: 'constant', value: 'USD' },
  merchant: { source: 'constant', value: 'Shop' },
}

function sampleTemplate(
  overrides: Partial<ReevaluateTemplateInput> = {},
): ReevaluateTemplateInput {
  return {
    id: 7,
    mailbox_id: 1,
    kind: 'approve',
    enabled: true,
    match_from_pattern: 'shop.com',
    match_subject_regex: 'receipt',
    extractors: approveExtractors,
    ...overrides,
  }
}

function samplePending(
  overrides: Partial<PendingArtifactRow> = {},
): PendingArtifactRow {
  return {
    artifact_id: 50,
    message_id: 100,
    provider_message_id: 'p1',
    rfc_message_id: '<1@x>',
    from_address: 'a@shop.com',
    subject: 'Your receipt',
    received_at: '2026-07-01T00:00:00.000Z',
    text_body: 'Total: $12.00',
    html_body: null,
    ...overrides,
  }
}

function makeStore(pending: PendingArtifactRow[]): TemplateReevaluateStore & {
  updates: Array<{
    artifactId: number
    payload: unknown
    confidence: number
    updatedAt: string
  }>
} {
  const updates: Array<{
    artifactId: number
    payload: unknown
    confidence: number
    updatedAt: string
  }> = []
  return {
    updates,
    async listPendingArtifacts() {
      return pending
    },
    async updateArtifact(artifactId, payload, confidence, updatedAt) {
      updates.push({ artifactId, payload, confidence, updatedAt })
    },
  }
}

Deno.test('toSpendParsingTemplate returns null for invalid extractors', () => {
  assertEquals(
    toSpendParsingTemplate(sampleTemplate({ extractors: { amount: 'bad' } })),
    null,
  )
})

Deno.test('reevaluatePendingWithTemplate updates matching pending artifacts', async () => {
  const store = makeStore([
    samplePending(),
    samplePending({
      artifact_id: 51,
      message_id: 101,
      from_address: 'other@example.com',
      subject: 'Unrelated',
      text_body: 'Total: $99.00',
    }),
  ])
  const now = '2026-07-23T12:00:00.000Z'
  const count = await reevaluatePendingWithTemplate(
    store,
    sampleTemplate(),
    now,
  )

  assertEquals(count, 1)
  assertEquals(store.updates.length, 1)
  assertEquals(store.updates[0]!.artifactId, 50)
  assertEquals(store.updates[0]!.updatedAt, now)
  assertEquals(store.updates[0]!.confidence, 0.9)
  const payload = store.updates[0]!.payload as Record<string, unknown>
  assertEquals(payload.amountCents, 1200)
  assertEquals(payload.templateId, 7)
  assertEquals(payload.merchant, 'Shop')
})

Deno.test('reevaluatePendingWithTemplate leaves extract misses unchanged', async () => {
  const store = makeStore([
    samplePending({
      text_body: 'No amount here',
    }),
  ])
  const count = await reevaluatePendingWithTemplate(store, sampleTemplate())
  assertEquals(count, 0)
  assertEquals(store.updates.length, 0)
})

Deno.test('reevaluatePendingWithTemplate skips reject and disabled templates', async () => {
  const store = makeStore([samplePending()])
  assertEquals(
    await reevaluatePendingWithTemplate(
      store,
      sampleTemplate({ kind: 'reject', extractors: null }),
    ),
    0,
  )
  assertEquals(
    await reevaluatePendingWithTemplate(
      store,
      sampleTemplate({ enabled: false }),
    ),
    0,
  )
  assertEquals(store.updates.length, 0)
})
