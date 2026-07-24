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
    "spentOn": DatePartsExtractor | null,
    "merchant": FieldExtractor | null,
    "note": FieldExtractor | null,
    "direction": DirectionExtractor | null
  }
}
FieldExtractor is one of:
- { "source": "subject"|"text"|"html_text", "regex": string, "group": number }
- { "source": "from_domain" }
- { "source": "constant", "value": string }

DatePartsExtractor (preferred for dates — locale-agnostic):
{ "source": "subject"|"text"|"html_text", "regex": string, "yearGroup": number, "monthGroup": number, "dayGroup": number }
Capture numeric year, month, and day in separate groups. Example for "El 11/07/2026":
{ "source": "text", "regex": "El\\\\s+(\\\\d{1,2})/(\\\\d{1,2})/(20\\\\d{2})", "dayGroup": 1, "monthGroup": 2, "yearGroup": 3 }

DirectionExtractor (optional — skip inbound money):
{ "source": "subject"|"text"|"html_text", "regex": string, "group": number, "inboundMatches": string[], "outboundMatches": string[] }
When the capture matches an inbound keyword (case-insensitive), the message is ignored.
Use the email's language. Spanish examples: inbound abono/depósito/recibiste; outbound compra/cargo.
English examples: inbound deposit/received/credit; outbound purchase/charged/paid.

Rules:
- Prefer robust regexes anchored near labels like Total/Amount/Order total.
- amount is required; never invent amounts that are not in the email.
- Prefer DatePartsExtractor for spentOn (numeric parts only; do not capture month names).
- For bank/transfer emails, include direction so inbound transfers are skipped; outbound charges still extract.
- Even if the sample email is inbound-only, still emit amount + direction so future similar mails are skipped.
- matchFromPattern uses domain/wildcard grammar: shop.com, *.shop.com, *@shop.com, user@shop.com.
- If unsure about optional fields, set them to null.
- Message bodies are pre-extracted plain text. Prefer source "text" for body fields.
- "html_text" remains valid for backward-compatible templates but usually mirrors plain text.`

export const generateEmailSpendTemplateUseCase: UseCase<
  GenerateEmailSpendTemplateInput,
  GenerateEmailSpendTemplateOutput
> = {
  id: 'generate_email_spend_template',
  description:
    'Generate a deterministic spending email parsing template from a sample message',
  modelTier: 'high',
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
        'Return JSON with matchFromPattern, matchSubjectRegex, nameSuggestion, extractors (amount, spentOn date parts, optional direction)',
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
