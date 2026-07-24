import type { AiProvider } from 'ai_kit/mod.ts'
import { UseCaseInputError, type UseCase } from './types.ts'

const MAX_BODY = 12_000

export type GenerateEmailRejectTemplateInput = {
  from: string
  subject: string
  textBody?: string
  htmlBody?: string
  hints?: string
}

export type GenerateEmailRejectTemplateOutput = {
  matchFromPattern: string
  matchSubjectRegex: string | null
  nameSuggestion: string
}

const SYSTEM_PROMPT = `You design deterministic email IGNORE templates.
These templates identify a type of email so it can be skipped forever — they do NOT parse amounts or fields.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "matchFromPattern": string,
  "matchSubjectRegex": string | null,
  "nameSuggestion": string
}

Rules:
- matchFromPattern uses domain/wildcard grammar: shop.com, *.shop.com, *@shop.com, user@shop.com.
- Prefer a domain (or full address when only one sender on a domain matters).
- matchSubjectRegex should uniquely identify this email TYPE (promotional, newsletter, OTP, etc.), not a single instance.
- Prefer stable subject phrases; avoid dates, amounts, order ids, and other per-message tokens.
- If subject is too unique/variable, set matchSubjectRegex to null and rely on from alone only when that sender is always noise.
- nameSuggestion is a short human label (e.g. "Santander marketing").
- Message bodies are pre-extracted plain text; use them only to understand email type, not to invent extractors.`

export const generateEmailRejectTemplateUseCase: UseCase<
  GenerateEmailRejectTemplateInput,
  GenerateEmailRejectTemplateOutput
> = {
  id: 'generate_email_reject_template',
  description:
    'Generate a match-only ignore template from a sample email (no field extractors)',
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
      description: 'Optional human hints for the template',
      type: 'string',
      required: false,
    },
  ],

  parseInput(raw: unknown): GenerateEmailRejectTemplateInput {
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
  ): Promise<GenerateEmailRejectTemplateOutput> {
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
      jsonSchemaHint:
        'Return JSON with matchFromPattern, matchSubjectRegex, nameSuggestion only (no extractors)',
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
): GenerateEmailRejectTemplateOutput {
  if (typeof raw.matchFromPattern !== 'string' || !raw.matchFromPattern.trim()) {
    throw new UseCaseInputError('model output missing matchFromPattern')
  }
  if (
    raw.matchSubjectRegex !== null &&
    raw.matchSubjectRegex !== undefined &&
    typeof raw.matchSubjectRegex !== 'string'
  ) {
    throw new UseCaseInputError('model output matchSubjectRegex must be string|null')
  }
  // Ignore any extractors the model may emit — reject templates are match-only.
  const nameSuggestion =
    typeof raw.nameSuggestion === 'string' && raw.nameSuggestion.trim()
      ? raw.nameSuggestion.trim().slice(0, 255)
      : 'Ignored email type'

  return {
    matchFromPattern: raw.matchFromPattern.trim().toLowerCase(),
    matchSubjectRegex:
      typeof raw.matchSubjectRegex === 'string' && raw.matchSubjectRegex.trim()
        ? raw.matchSubjectRegex.trim()
        : null,
    nameSuggestion,
  }
}
