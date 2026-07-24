import {
  parseSpendTemplateExtractors,
  type SpendParsingTemplate,
  type TemplateMatchSpec,
} from 'mailbox_kit/mod.ts'
import type { Kysely } from 'kysely'
import type { Database, ParsingTemplate } from '../db/types/schema.ts'
import {
  AiClientError,
  classifyEmailSpendRelevance,
  generateEmailRejectTemplate,
  generateEmailSpendTemplate,
  type ClassifyEmailSpendRelevanceAiOutput,
  type GenerateApproveTemplateAiOutput,
  type GenerateRejectTemplateAiOutput,
  type GenerateTemplateAiInput,
} from './ai_client.ts'
import {
  InvalidMailboxError,
  validateMatchFromPattern,
  validateSubjectRegex,
  validateTemplateName,
} from '../graphql/validation.ts'

export type AutoTemplateMessage = {
  id: number
  mailbox_id: number
  user_id: number
  from_address: string
  subject: string
  text_body: string | null
}

export type AutoTemplateAi = {
  classify: (
    input: GenerateTemplateAiInput,
  ) => Promise<ClassifyEmailSpendRelevanceAiOutput>
  generateSpend: (
    input: GenerateTemplateAiInput,
  ) => Promise<GenerateApproveTemplateAiOutput>
  generateReject: (
    input: GenerateTemplateAiInput,
  ) => Promise<GenerateRejectTemplateAiOutput>
}

export type AutoTemplateStore = {
  insertTemplate(row: {
    mailbox_id: number
    user_id: number
    name: string
    kind: 'approve' | 'reject'
    match_from_pattern: string
    match_subject_regex: string | null
    extractors: Record<string, unknown> | null
    source_message_id: number
    now: string
  }): Promise<ParsingTemplate>
}

export function createKyselyAutoTemplateStore(
  db: Kysely<Database>,
): AutoTemplateStore {
  return {
    async insertTemplate(row) {
      return await db
        .insertInto('parsing_templates')
        .values({
          mailbox_id: row.mailbox_id,
          user_id: row.user_id,
          name: row.name,
          kind: row.kind,
          enabled: true,
          match_from_pattern: row.match_from_pattern,
          match_subject_regex: row.match_subject_regex,
          extractors: row.extractors,
          source_message_id: row.source_message_id,
          version: 1,
          created_at: row.now,
          updated_at: row.now,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    },
  }
}

export const defaultAutoTemplateAi: AutoTemplateAi = {
  classify: (input) => classifyEmailSpendRelevance(input),
  generateSpend: (input) => generateEmailSpendTemplate(input),
  generateReject: (input) => generateEmailRejectTemplate(input),
}

export type AutoTemplateResult = {
  template: ParsingTemplate
  useful: boolean
  reason: string
}

/**
 * Classify an unmatched message and persist an approve or reject template.
 */
export async function autoTemplateFromMessage(
  message: AutoTemplateMessage,
  options?: {
    store?: AutoTemplateStore
    ai?: AutoTemplateAi
    now?: string
  },
): Promise<AutoTemplateResult> {
  if (!message.text_body?.trim()) {
    throw new InvalidMailboxError(
      'message has no stored body; cannot auto-template',
    )
  }

  const ai = options?.ai ?? defaultAutoTemplateAi
  const store = options?.store
  if (!store) {
    throw new Error('autoTemplateFromMessage requires a store')
  }
  const now = options?.now ?? new Date().toISOString()

  const aiInput: GenerateTemplateAiInput = {
    from: message.from_address,
    subject: message.subject,
    textBody: message.text_body,
  }

  let classification: ClassifyEmailSpendRelevanceAiOutput
  try {
    classification = await ai.classify(aiInput)
  } catch (err) {
    if (err instanceof AiClientError) throw err
    throw err
  }

  const useful = classification.useful === true
  let matchFromPattern: string
  let matchSubjectRegex: string | null
  let extractors: Record<string, unknown> | null = null
  let nameSuggestion: string

  if (useful) {
    const aiOut = await ai.generateSpend(aiInput)
    matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern)
    matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex)
    const parsed = parseSpendTemplateExtractors(aiOut.extractors)
    if (!parsed) {
      throw new InvalidMailboxError('AI returned invalid extractors')
    }
    extractors = parsed as unknown as Record<string, unknown>
    nameSuggestion = aiOut.nameSuggestion || 'Spending template'
  } else {
    const aiOut = await ai.generateReject(aiInput)
    matchFromPattern = validateMatchFromPattern(aiOut.matchFromPattern)
    matchSubjectRegex = validateSubjectRegex(aiOut.matchSubjectRegex)
    nameSuggestion = aiOut.nameSuggestion || 'Ignored email type'
  }

  const name = validateTemplateName(nameSuggestion)
  const template = await store.insertTemplate({
    mailbox_id: message.mailbox_id,
    user_id: message.user_id,
    name,
    kind: useful ? 'approve' : 'reject',
    match_from_pattern: matchFromPattern,
    match_subject_regex: matchSubjectRegex,
    extractors,
    source_message_id: message.id,
    now,
  })

  return {
    template,
    useful,
    reason: classification.reason,
  }
}

/** Convert a persisted template row into worker in-memory template sets pieces. */
export function templateRowToMatchSets(row: ParsingTemplate): {
  reject?: TemplateMatchSpec
  approve?: SpendParsingTemplate
} {
  const match: TemplateMatchSpec = {
    matchFromPattern: row.match_from_pattern,
    matchSubjectRegex: row.match_subject_regex,
    enabled: row.enabled,
  }
  if (row.kind === 'reject') {
    return { reject: match }
  }
  const extractors = parseSpendTemplateExtractors(row.extractors)
  if (!extractors) return {}
  return {
    approve: {
      id: row.id,
      matchFromPattern: row.match_from_pattern,
      matchSubjectRegex: row.match_subject_regex,
      extractors,
      enabled: row.enabled,
    },
  }
}
