import type { AiProvider } from 'ai_kit/mod.ts'
import { UseCaseInputError, type UseCase } from './types.ts'

const MAX_BODY = 12_000

export type GenerateEmailSpendTemplateInput = {
  from: string
  subject: string
  textBody?: string
  htmlBody?: string
  hints?: string
}

export type GenerateEmailSpendTemplateOutput = {
  matchFromPattern: string
  matchSubjectRegex: string | null
  extractors: Record<string, unknown>
  nameSuggestion: string
}

const SYSTEM_PROMPT = `You design deterministic email parsing templates for spending receipts.
Return ONLY valid JSON (no markdown) with this exact shape:
{
  "matchFromPattern": string,
  "matchSubjectRegex": string | null,
  "nameSuggestion": string,
  "extractors": {
    "amount": { "source": "subject"|"text"|"html_text", "regex": string, "group": number },
    "currency": FieldExtractor | null,
    "spentOn": FieldExtractor | null,
    "merchant": FieldExtractor | null,
    "note": FieldExtractor | null
  }
}
FieldExtractor is one of:
- { "source": "subject"|"text"|"html_text", "regex": string, "group": number }
- { "source": "from_domain" }
- { "source": "constant", "value": string }

Rules:
- Prefer robust regexes anchored near labels like Total/Amount/Order total.
- amount is required; never invent amounts that are not in the email.
- matchFromPattern uses domain/wildcard grammar: shop.com, *.shop.com, *@shop.com, user@shop.com.
- If unsure about optional fields, set them to null.
- Use "text" source when the body is plain text; "html_text" when only HTML is useful.`

export const generateEmailSpendTemplateUseCase: UseCase<
  GenerateEmailSpendTemplateInput,
  GenerateEmailSpendTemplateOutput
> = {
  id: 'generate_email_spend_template',
  description:
    'Generate a deterministic spending email parsing template from a sample message',
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
      description: 'Plain text body (optional)',
      type: 'string',
      required: false,
    },
    {
      name: 'htmlBody',
      description: 'HTML body (optional)',
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

  parseInput(raw: unknown): GenerateEmailSpendTemplateInput {
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
        'input.textBody or input.htmlBody is required',
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
  ): Promise<GenerateEmailSpendTemplateOutput> {
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
        'Return JSON with matchFromPattern, matchSubjectRegex, nameSuggestion, extractors',
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
): GenerateEmailSpendTemplateOutput {
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
  if (
    raw.extractors === null ||
    typeof raw.extractors !== 'object' ||
    Array.isArray(raw.extractors)
  ) {
    throw new UseCaseInputError('model output missing extractors object')
  }
  const extractors = raw.extractors as Record<string, unknown>
  if (
    extractors.amount === null ||
    typeof extractors.amount !== 'object' ||
    Array.isArray(extractors.amount)
  ) {
    throw new UseCaseInputError('model output extractors.amount is required')
  }
  const nameSuggestion =
    typeof raw.nameSuggestion === 'string' && raw.nameSuggestion.trim()
      ? raw.nameSuggestion.trim().slice(0, 255)
      : 'Spending template'

  return {
    matchFromPattern: raw.matchFromPattern.trim().toLowerCase(),
    matchSubjectRegex:
      typeof raw.matchSubjectRegex === 'string' && raw.matchSubjectRegex.trim()
        ? raw.matchSubjectRegex.trim()
        : null,
    extractors,
    nameSuggestion,
  }
}
