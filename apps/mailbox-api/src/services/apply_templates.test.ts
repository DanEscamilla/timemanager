import { assertEquals } from 'jsr:@std/assert@1'
import type { ExtractionArtifact } from 'mailbox_kit/mod.ts'
import {
  applyTemplatesToMailbox,
  type ApplyTemplatesStore,
} from './apply_templates.ts'

function makeStore(opts: {
  templates: Array<{
    id: number
    kind: string
    enabled: boolean
    match_from_pattern: string
    match_subject_regex: string | null
    extractors: unknown
  }>
  messages: Array<{
    id: number
    provider_message_id: string
    rfc_message_id: string
    from_address: string
    subject: string
    received_at: Date | string
    text_body: string | null
    html_body: string | null
  }>
  statuses?: Array<{ message_id: number; status: string }>
}): ApplyTemplatesStore & {
  inserted: Array<{ messageId: number; art: ExtractionArtifact }>
  rejectedIds: number[]
} {
  const inserted: Array<{ messageId: number; art: ExtractionArtifact }> = []
  const rejectedIds: number[] = []
  return {
    inserted,
    rejectedIds,
    async listEnabledTemplates() {
      return opts.templates
    },
    async listMessages() {
      return opts.messages
    },
    async listArtifactStatuses() {
      return opts.statuses ?? []
    },
    async rejectPendingForMessages(messageIds) {
      rejectedIds.push(...messageIds)
      return messageIds.length
    },
    async insertArtifact(messageId, art) {
      inserted.push({ messageId, art })
    },
  }
}

const approveExtractors = {
  amount: {
    source: 'text',
    regex: 'Total:\\s*\\$?([0-9.]+)',
    group: 1,
  },
  currency: { source: 'constant', value: 'USD' },
}

Deno.test('applyTemplatesToMailbox inserts approve matches', async () => {
  const store = makeStore({
    templates: [{
      id: 1,
      kind: 'approve',
      enabled: true,
      match_from_pattern: 'shop.com',
      match_subject_regex: 'receipt',
      extractors: approveExtractors,
    }],
    messages: [{
      id: 100,
      provider_message_id: 'p1',
      rfc_message_id: '<1@x>',
      from_address: 'a@shop.com',
      subject: 'Your receipt',
      received_at: '2026-07-01T00:00:00.000Z',
      text_body: 'Total: $12.00',
      html_body: null,
    }],
  })

  const result = await applyTemplatesToMailbox(store, 1, '2026-07-23T00:00:00.000Z')
  assertEquals(result.insertedArtifacts, 1)
  assertEquals(result.rejectedPending, 0)
  assertEquals(store.inserted.length, 1)
  assertEquals(store.inserted[0]!.messageId, 100)
  assertEquals(store.inserted[0]!.art.payload.amountCents, 1200)
})

Deno.test('applyTemplatesToMailbox skips messages with pending/accepted', async () => {
  const store = makeStore({
    templates: [{
      id: 1,
      kind: 'approve',
      enabled: true,
      match_from_pattern: 'shop.com',
      match_subject_regex: null,
      extractors: approveExtractors,
    }],
    messages: [{
      id: 100,
      provider_message_id: 'p1',
      rfc_message_id: '<1@x>',
      from_address: 'a@shop.com',
      subject: 'x',
      received_at: '2026-07-01T00:00:00.000Z',
      text_body: 'Total: $12.00',
      html_body: null,
    }],
    statuses: [{ message_id: 100, status: 'accepted' }],
  })

  const result = await applyTemplatesToMailbox(store, 1)
  assertEquals(result.insertedArtifacts, 0)
  assertEquals(store.inserted.length, 0)
})

Deno.test('applyTemplatesToMailbox reject short-circuits and rejects pending', async () => {
  const store = makeStore({
    templates: [
      {
        id: 2,
        kind: 'reject',
        enabled: true,
        match_from_pattern: 'shop.com',
        match_subject_regex: 'promo',
        extractors: null,
      },
      {
        id: 1,
        kind: 'approve',
        enabled: true,
        match_from_pattern: 'shop.com',
        match_subject_regex: null,
        extractors: approveExtractors,
      },
    ],
    messages: [{
      id: 100,
      provider_message_id: 'p1',
      rfc_message_id: '<1@x>',
      from_address: 'a@shop.com',
      subject: 'Weekly promo',
      received_at: '2026-07-01T00:00:00.000Z',
      text_body: 'Total: $12.00',
      html_body: null,
    }],
  })

  const result = await applyTemplatesToMailbox(store, 1)
  assertEquals(result.insertedArtifacts, 0)
  assertEquals(result.rejectedPending, 1)
  assertEquals(store.rejectedIds, [100])
  assertEquals(store.inserted.length, 0)
})
