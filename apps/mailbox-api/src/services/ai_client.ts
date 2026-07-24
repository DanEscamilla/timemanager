import { env as readEnv } from 'deno_api_kit/db/env.ts'

export type GenerateTemplateAiInput = {
  from: string
  subject: string
  textBody?: string | null
  htmlBody?: string | null
  hints?: string | null
}

export type GenerateApproveTemplateAiOutput = {
  matchFromPattern: string
  matchSubjectRegex: string | null
  extractors: Record<string, unknown>
  nameSuggestion: string
}

export type GenerateRejectTemplateAiOutput = {
  matchFromPattern: string
  matchSubjectRegex: string | null
  nameSuggestion: string
}

/** @deprecated Prefer GenerateApproveTemplateAiOutput */
export type GenerateTemplateAiOutput = GenerateApproveTemplateAiOutput

export type ClassifyEmailSpendRelevanceAiOutput = {
  useful: boolean
  reason: string
}

export class AiClientError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiClientError'
  }
}

async function runAiUseCase<T>(
  useCaseId: string,
  input: GenerateTemplateAiInput,
  options?: {
    baseUrl?: string
    serviceKey?: string
    fetchImpl?: typeof fetch
  },
): Promise<T> {
  const baseUrl = (options?.baseUrl ??
    readEnv('AI_API_BASE_URL') ??
    'http://localhost:3004').replace(/\/$/, '')
  const serviceKey = options?.serviceKey ?? readEnv('AI_SERVICE_KEY')
  if (!serviceKey) {
    throw new AiClientError('AI_SERVICE_KEY is not configured')
  }

  const fetchImpl = options?.fetchImpl ?? fetch
  const res = await fetchImpl(
    `${baseUrl}/v1/use-cases/${useCaseId}/run`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        input: {
          from: input.from,
          subject: input.subject,
          textBody: input.textBody ?? undefined,
          htmlBody: input.htmlBody ?? undefined,
          hints: input.hints ?? undefined,
        },
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new AiClientError(
      `ai-api error ${res.status}: ${text.slice(0, 300)}`,
    )
  }

  const body = await res.json() as { output?: T }
  if (!body.output) {
    throw new AiClientError('ai-api response missing output')
  }
  return body.output
}

/**
 * Call ai-api generate_email_spend_template use case.
 * Overridable fetch for tests.
 */
export async function generateEmailSpendTemplate(
  input: GenerateTemplateAiInput,
  options?: {
    baseUrl?: string
    serviceKey?: string
    fetchImpl?: typeof fetch
  },
): Promise<GenerateApproveTemplateAiOutput> {
  return await runAiUseCase<GenerateApproveTemplateAiOutput>(
    'generate_email_spend_template',
    input,
    options,
  )
}

/**
 * Call ai-api generate_email_reject_template use case.
 * Overridable fetch for tests.
 */
export async function generateEmailRejectTemplate(
  input: GenerateTemplateAiInput,
  options?: {
    baseUrl?: string
    serviceKey?: string
    fetchImpl?: typeof fetch
  },
): Promise<GenerateRejectTemplateAiOutput> {
  return await runAiUseCase<GenerateRejectTemplateAiOutput>(
    'generate_email_reject_template',
    input,
    options,
  )
}

/**
 * Call ai-api classify_email_spend_relevance use case.
 * Overridable fetch for tests.
 */
export async function classifyEmailSpendRelevance(
  input: GenerateTemplateAiInput,
  options?: {
    baseUrl?: string
    serviceKey?: string
    fetchImpl?: typeof fetch
  },
): Promise<ClassifyEmailSpendRelevanceAiOutput> {
  return await runAiUseCase<ClassifyEmailSpendRelevanceAiOutput>(
    'classify_email_spend_relevance',
    input,
    options,
  )
}
