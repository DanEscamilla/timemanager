import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import {
  autoTemplateFromMessage,
  templateRowToMatchSets,
  type AutoTemplateAi,
  type AutoTemplateStore,
} from './auto_template_from_message.ts'
import type { ParsingTemplate } from '../db/types/schema.ts'
import { InvalidMailboxError } from '../graphql/validation.ts'

function fakeRow(
  overrides: Partial<ParsingTemplate> = {},
): ParsingTemplate {
  const now = new Date('2026-07-24T00:00:00.000Z')
  return {
    id: 10,
    mailbox_id: 1,
    user_id: 2,
    name: 'Test',
    kind: 'approve',
    enabled: true,
    match_from_pattern: 'shop.com',
    match_subject_regex: 'receipt',
    extractors: {
      amount: { source: 'text', regex: '(\\d+)', group: 1 },
    },
    source_message_id: 5,
    version: 1,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

Deno.test('autoTemplateFromMessage creates approve when useful', async () => {
  const inserted: unknown[] = []
  const store: AutoTemplateStore = {
    insertTemplate: (row) => {
      inserted.push(row)
      return Promise.resolve(
        fakeRow({
          kind: row.kind,
          name: row.name,
          match_from_pattern: row.match_from_pattern,
          match_subject_regex: row.match_subject_regex,
          extractors: row.extractors,
        }),
      )
    },
  }
  const ai: AutoTemplateAi = {
    classify: () => Promise.resolve({ useful: true, reason: 'receipt' }),
    generateSpend: () =>
      Promise.resolve({
        matchFromPattern: 'shop.com',
        matchSubjectRegex: 'order',
        extractors: {
          amount: { source: 'text', regex: 'Total\\s+\\$?([\\d.]+)', group: 1 },
        },
        nameSuggestion: 'Shop receipts',
      }),
    generateReject: () => Promise.reject(new Error('should not reject')),
  }

  const result = await autoTemplateFromMessage(
    {
      id: 5,
      mailbox_id: 1,
      user_id: 2,
      from_address: 'receipts@shop.com',
      subject: 'Your order',
      text_body: 'Total $12.99',
    },
    { store, ai },
  )

  assertEquals(result.useful, true)
  assertEquals(result.reason, 'receipt')
  assertEquals(result.template.kind, 'approve')
  assertEquals((inserted[0] as { kind: string }).kind, 'approve')
  assertEquals((inserted[0] as { name: string }).name, 'Shop receipts')
})

Deno.test('autoTemplateFromMessage creates reject when not useful', async () => {
  const store: AutoTemplateStore = {
    insertTemplate: (row) =>
      Promise.resolve(
        fakeRow({
          kind: row.kind,
          name: row.name,
          match_from_pattern: row.match_from_pattern,
          match_subject_regex: row.match_subject_regex,
          extractors: null,
        }),
      ),
  }
  const ai: AutoTemplateAi = {
    classify: () =>
      Promise.resolve({ useful: false, reason: 'marketing' }),
    generateSpend: () => Promise.reject(new Error('should not spend')),
    generateReject: () =>
      Promise.resolve({
        matchFromPattern: 'bank.com',
        matchSubjectRegex: 'oferta',
        nameSuggestion: 'Bank promos',
      }),
  }

  const result = await autoTemplateFromMessage(
    {
      id: 5,
      mailbox_id: 1,
      user_id: 2,
      from_address: 'promos@bank.com',
      subject: 'Oferta',
      text_body: 'Descuento 20%',
    },
    { store, ai },
  )

  assertEquals(result.useful, false)
  assertEquals(result.template.kind, 'reject')
  assertEquals(result.template.name, 'Bank promos')
})

Deno.test('autoTemplateFromMessage requires body', async () => {
  await assertRejects(
    () =>
      autoTemplateFromMessage(
        {
          id: 1,
          mailbox_id: 1,
          user_id: 1,
          from_address: 'a@b.com',
          subject: 'x',
          text_body: null,
        },
        {
          store: {
            insertTemplate: () => Promise.reject(new Error('no')),
          },
          ai: {
            classify: () => Promise.reject(new Error('no')),
            generateSpend: () => Promise.reject(new Error('no')),
            generateReject: () => Promise.reject(new Error('no')),
          },
        },
      ),
    InvalidMailboxError,
  )
})

Deno.test('templateRowToMatchSets maps approve and reject', () => {
  const approve = templateRowToMatchSets(fakeRow())
  assertEquals(approve.approve?.id, 10)
  assertEquals(approve.reject, undefined)

  const reject = templateRowToMatchSets(
    fakeRow({ kind: 'reject', extractors: null }),
  )
  assertEquals(reject.reject?.matchFromPattern, 'shop.com')
  assertEquals(reject.approve, undefined)
})
