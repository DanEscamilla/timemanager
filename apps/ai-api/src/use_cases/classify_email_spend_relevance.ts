import type { AiProvider } from 'ai_kit/mod.ts'
import { UseCaseInputError, type UseCase } from './types.ts'

const MAX_BODY = 12_000

export type ClassifyEmailSpendRelevanceInput = {
  from: string
  subject: string
  textBody?: string
  htmlBody?: string
  hints?: string
}

export type ClassifyEmailSpendRelevanceOutput = {
  useful: boolean
  reason: string
}

const SYSTEM_PROMPT = `You classify whether an email TYPE is useful for extracting personal spending data.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "useful": boolean,
  "reason": string
}

useful=true ONLY when the email is a transactional spending signal the user would want as an expense candidate, such as:
- Purchase / charge / payment receipts
- Order confirmations with an amount paid
- Outbound bank transfers / card charges / SPEI sent
- Subscription renewal charges

useful=false for everything else, including:
- Marketing, newsletters, promotions, offers
- OTP / verification / security codes
- Account alerts without a spend (login, password, balance-only)
- Inbound money (deposits, refunds received, money you got)
- Shipping updates without a new charge
- Ambiguous emails where you cannot tell if money left the user

Rules:
- Classify the email TYPE, not a one-off instance.
- When unsure, set useful=false.
- reason is a short English explanation (one sentence).
- Message bodies are pre-extracted plain text.`

export const classifyEmailSpendRelevanceUseCase: UseCase<
  ClassifyEmailSpendRelevanceInput,
  ClassifyEmailSpendRelevanceOutput
> = {
  id: 'classify_email_spend_relevance',
  description:
    'Classify whether an email type is useful for spending extraction',
  modelTier: 'low',
  inputFields: [
    {
      name: 'from',
      description: 'From header / address',
      type: 'string',
      required: true,
    },
    {
      name: 'subject',
      description: 'Email subject',
      type: 'string',
      required: true,
    },
    {
      name: 'textBody',
      description: 'Plain text body (preferred; extracted from HTML at sync)',
      type: 'string',
      required: false,
    },
    {
      name: 'htmlBody',
      description: 'Raw HTML body (optional legacy; prefer textBody)',
      type: 'string',
      required: false,
    },
    {
      name: 'hints',
      description: 'Optional human hints',
      type: 'string',
      required: false,
    },
  ],

  parseInput(raw: unknown): ClassifyEmailSpendRelevanceInput {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new UseCaseInputError('input must be an object')
    }
    const obj = raw as Record<string, unknown>
    if (typeof obj.from !== 'string' || !obj.from.trim()) {
      throw new UseCaseInputError('input.from must be a non-empty string')
    }
    if (typeof obj.subject !== 'string' || !obj.subject.trim()) {
      throw new UseCaseInputError('input.subject must be a non-empty string')
    }
    const textBody = optionalString(obj.textBody, 'textBody')
    const htmlBody = optionalString(obj.htmlBody, 'htmlBody')
    const hints = optionalString(obj.hints, 'hints')
    if (!textBody && !htmlBody) {
      throw new UseCaseInputError(
        'input.textBody is required (htmlBody is legacy-only)',
      )
    }
    return {
      from: obj.from.trim(),
      subject: obj.subject.trim(),
      textBody,
      htmlBody,
      hints,
    }
  },

  async run(
    input,
    provider: AiProvider,
    options,
  ): Promise<ClassifyEmailSpendRelevanceOutput> {
    const userContent = [
      `From: ${input.from}`,
      `Subject: ${input.subject}`,
      input.textBody
        ? `Text body:\n${truncate(input.textBody, MAX_BODY)}`
        : null,
      input.htmlBody
        ? `HTML body:\n${truncate(input.htmlBody, MAX_BODY)}`
        : null,
      input.hints ? `Hints: ${input.hints}` : null,
    ]
      .filter(Boolean)
      .join('\n\n')

    const result = await provider.complete({
      model: options?.model,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      temperature: 0.1,
      jsonSchemaHint: 'Return JSON with useful (boolean) and reason (string)',
    })

    const parsed = parseModelJson(result.text)
    return normalizeOutput(parsed)
  },
}

function optionalString(raw: unknown, field: string): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') {
    throw new UseCaseInputError(`input.${field} must be a string`)
  }
  const trimmed = raw.trim()
  return trimmed ? trimmed : undefined
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n…[truncated]` : s
}

function parseModelJson(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] ?? trimmed).trim()
  try {
    const value = JSON.parse(candidate)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new UseCaseInputError('model output must be a JSON object')
    }
    return value as Record<string, unknown>
  } catch (err) {
    if (err instanceof UseCaseInputError) throw err
    throw new UseCaseInputError('model output is not valid JSON')
  }
}

function normalizeOutput(
  raw: Record<string, unknown>,
): ClassifyEmailSpendRelevanceOutput {
  if (typeof raw.useful !== 'boolean') {
    throw new UseCaseInputError('model output useful must be a boolean')
  }
  const reason =
    typeof raw.reason === 'string' && raw.reason.trim()
      ? raw.reason.trim().slice(0, 500)
      : raw.useful
      ? 'Looks like a spending email'
      : 'Not useful for spending extraction'

  return {
    useful: raw.useful,
    reason,
  }
}
