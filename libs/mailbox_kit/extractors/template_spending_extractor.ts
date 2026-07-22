import { matchesFromPattern, normalizeFrom } from '../domain_filter.ts'
import type { Extractor } from '../extractor.ts'
import {
  SPENDING_CANDIDATE_KIND,
  type EmailMessage,
  type ExtractionArtifact,
  type FieldExtractor,
  type SpendParsingTemplate,
  type SpendTemplateExtractors,
  type SpendingCandidatePayload,
} from '../types.ts'

/**
 * Deterministic spending extractor driven by a user/AI-generated template.
 * No LLM calls — regex / constant / from_domain only.
 */
export class TemplateSpendingExtractor implements Extractor {
  readonly kind = SPENDING_CANDIDATE_KIND

  constructor(private readonly template: SpendParsingTemplate) {}

  get templateId(): number {
    return this.template.id
  }

  canHandle(message: EmailMessage): boolean {
    if (this.template.enabled === false) return false
    if (!matchesFromPattern(message.from, this.template.matchFromPattern)) {
      return false
    }
    const subjectRe = this.template.matchSubjectRegex?.trim()
    if (subjectRe) {
      try {
        if (!new RegExp(subjectRe, 'i').test(message.subject)) return false
      } catch {
        return false
      }
    }
    return true
  }

  extract(message: EmailMessage): ExtractionArtifact[] {
    const sources = buildSources(message)
    const amountRaw = applyField(this.template.extractors.amount, sources)
    const amountCents = parseMoneyToCents(amountRaw)
    if (amountCents === null) return []

    const currencyRaw = this.template.extractors.currency
      ? applyField(this.template.extractors.currency, sources)
      : null
    const currency = normalizeCurrency(currencyRaw) ?? 'USD'

    const spentOnRaw = this.template.extractors.spentOn
      ? applyField(this.template.extractors.spentOn, sources)
      : null
    const spentOn = normalizeDate(spentOnRaw) ?? toDateString(message.receivedAt)

    const merchant = this.template.extractors.merchant
      ? applyField(this.template.extractors.merchant, sources)
      : null

    const note = this.template.extractors.note
      ? applyField(this.template.extractors.note, sources)
      : message.subject.slice(0, 200) || null

    const payload: SpendingCandidatePayload = {
      amountCents,
      currency,
      spentOn,
      merchant: merchant?.trim() ? merchant.trim().slice(0, 120) : null,
      note: note?.trim() ? note.trim().slice(0, 200) : null,
      sourceSubject: message.subject,
      sourceFrom: message.from,
      templateId: this.template.id,
    }

    return [
      {
        kind: SPENDING_CANDIDATE_KIND,
        payload: { ...payload },
        confidence: 0.9,
      },
    ]
  }
}

type Sources = {
  subject: string
  text: string
  html_text: string
  from_domain: string | null
}

function buildSources(message: EmailMessage): Sources {
  const from = normalizeFrom(message.from)
  return {
    subject: message.subject ?? '',
    text: message.textBody ?? '',
    html_text: stripHtml(message.htmlBody),
    from_domain: from?.domain ?? null,
  }
}

function applyField(
  extractor: FieldExtractor,
  sources: Sources,
): string | null {
  if (extractor.source === 'constant') {
    return extractor.value
  }
  if (extractor.source === 'from_domain') {
    if (!sources.from_domain) return null
    const base = sources.from_domain.split('.')[0]
    if (!base) return null
    return base.charAt(0).toUpperCase() + base.slice(1)
  }
  const haystack = sources[extractor.source]
  try {
    const re = new RegExp(extractor.regex, 'i')
    const m = haystack.match(re)
    const group = extractor.group
    if (!m || group < 0 || group >= m.length) return null
    const value = m[group]
    return value?.trim() ? value.trim() : null
  } catch {
    return null
  }
}

function stripHtml(html: string | null): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseMoneyToCents(raw: string | null): number | null {
  if (!raw) return null
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  if (!cleaned) return null
  const dollars = Number(cleaned)
  if (!Number.isFinite(dollars) || dollars <= 0) return null
  return Math.round(dollars * 100)
}

function normalizeCurrency(raw: string | null): string | null {
  if (!raw) return null
  const m = raw.toUpperCase().match(/\b(USD|EUR|GBP|MXN|CAD)\b/)
  return m?.[1] ?? null
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null
  const iso = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso?.[1]) return iso[1]
  return null
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Validate extractors JSON shape (used by API + AI output). */
export function parseSpendTemplateExtractors(
  raw: unknown,
): SpendTemplateExtractors | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const amount = parseFieldExtractor(obj.amount)
  if (!amount) return null
  return {
    amount,
    currency: parseOptionalField(obj.currency),
    spentOn: parseOptionalField(obj.spentOn),
    merchant: parseOptionalField(obj.merchant),
    note: parseOptionalField(obj.note),
  }
}

function parseOptionalField(raw: unknown): FieldExtractor | null {
  if (raw === undefined || raw === null) return null
  return parseFieldExtractor(raw)
}

function parseFieldExtractor(raw: unknown): FieldExtractor | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const source = obj.source
  if (source === 'from_domain') return { source: 'from_domain' }
  if (source === 'constant') {
    if (typeof obj.value !== 'string') return null
    return { source: 'constant', value: obj.value }
  }
  if (source === 'subject' || source === 'text' || source === 'html_text') {
    if (typeof obj.regex !== 'string' || !obj.regex) return null
    if (typeof obj.group !== 'number' || !Number.isInteger(obj.group) || obj.group < 0) {
      return null
    }
    try {
      new RegExp(obj.regex, 'i')
    } catch {
      return null
    }
    return { source, regex: obj.regex, group: obj.group }
  }
  return null
}
