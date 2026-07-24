import { normalizeFrom } from '../domain_filter.ts'
import type { Extractor } from '../extractor.ts'
import { htmlToPlainText, resolveTextBody } from '../html_to_plain_text.ts'
import { messageMatchesTemplate } from '../template_match.ts'
import {
  SPENDING_CANDIDATE_KIND,
  type DatePartsExtractor,
  type DirectionExtractor,
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
    return messageMatchesTemplate(message, this.template)
  }

  extract(message: EmailMessage): ExtractionArtifact[] {
    const sources = buildSources(message)

    if (this.template.extractors.direction) {
      const flow = classifyDirection(
        this.template.extractors.direction,
        sources,
      )
      if (flow === 'inbound') return []
    }

    const amountRaw = applyField(this.template.extractors.amount, sources)
    const amountCents = parseMoneyToCents(amountRaw)
    if (amountCents === null) return []

    const currencyRaw = this.template.extractors.currency
      ? applyField(this.template.extractors.currency, sources)
      : null
    const currency = normalizeCurrency(currencyRaw) ?? 'USD'

    const spentOn =
      resolveSpentOn(this.template.extractors.spentOn, sources) ??
      toDateString(message.receivedAt)

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
  // Same plain text as resolveTextBody / stored messages.text_body (not raw MIME).
  const text = resolveTextBody(message.textBody, message.htmlBody) ?? ''
  const fromHtml = htmlToPlainText(message.htmlBody)
  return {
    subject: message.subject ?? '',
    text,
    // Prefer extracted HTML; fall back to stored plain text (post-migration).
    html_text: fromHtml || text,
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

function resolveSpentOn(
  extractor: FieldExtractor | DatePartsExtractor | null | undefined,
  sources: Sources,
): string | null {
  if (!extractor) return null
  if (isDatePartsExtractor(extractor)) {
    return composeDateParts(extractor, sources)
  }
  const spentOnRaw = applyField(extractor, sources)
  return normalizeDate(spentOnRaw)
}

function composeDateParts(
  extractor: DatePartsExtractor,
  sources: Sources,
): string | null {
  const haystack = sources[extractor.source]
  try {
    const re = new RegExp(extractor.regex, 'i')
    const m = haystack.match(re)
    if (!m) return null
    const year = Number(m[extractor.yearGroup])
    const month = Number(m[extractor.monthGroup])
    const day = Number(m[extractor.dayGroup])
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      !Number.isInteger(day)
    ) {
      return null
    }
    if (year < 2000 || year > 2100) return null
    if (month < 1 || month > 12) return null
    if (day < 1 || day > 31) return null
    // Soft calendar check: reject e.g. Feb 31 via Date UTC round-trip.
    const composed = `${year}-${pad2(month)}-${pad2(day)}`
    const check = new Date(`${composed}T00:00:00.000Z`)
    if (
      Number.isNaN(check.getTime()) ||
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() + 1 !== month ||
      check.getUTCDate() !== day
    ) {
      return null
    }
    return composed
  } catch {
    return null
  }
}

function classifyDirection(
  extractor: DirectionExtractor,
  sources: Sources,
): 'inbound' | 'outbound' | 'unknown' {
  const haystack = sources[extractor.source]
  try {
    const re = new RegExp(extractor.regex, 'i')
    const m = haystack.match(re)
    const group = extractor.group
    if (!m || group < 0 || group >= m.length) return 'unknown'
    const raw = m[group]?.trim()
    if (!raw) return 'unknown'
    const normalized = foldKey(raw)
    if (extractor.inboundMatches.some((k) => foldKey(k) === normalized)) {
      return 'inbound'
    }
    if (extractor.outboundMatches.some((k) => foldKey(k) === normalized)) {
      return 'outbound'
    }
    return 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Case-fold + strip combining marks so "depósito" matches "deposito". */
function foldKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
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

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

function isDatePartsExtractor(
  raw: FieldExtractor | DatePartsExtractor,
): raw is DatePartsExtractor {
  return (
    'yearGroup' in raw &&
    'monthGroup' in raw &&
    'dayGroup' in raw &&
    typeof (raw as DatePartsExtractor).yearGroup === 'number'
  )
}

/** Validate extractors JSON shape (used by API + AI output). */
export function parseSpendTemplateExtractors(
  raw: unknown,
): SpendTemplateExtractors | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const amount = parseFieldExtractor(obj.amount)
  if (!amount) return null

  const spentOn = parseSpentOnExtractor(obj.spentOn)
  if (obj.spentOn !== undefined && obj.spentOn !== null && spentOn === null) {
    return null
  }

  const direction = parseDirectionExtractor(obj.direction)
  if (
    obj.direction !== undefined &&
    obj.direction !== null &&
    direction === null
  ) {
    return null
  }

  return {
    amount,
    currency: parseOptionalField(obj.currency),
    spentOn,
    merchant: parseOptionalField(obj.merchant),
    note: parseOptionalField(obj.note),
    direction,
  }
}

function parseOptionalField(raw: unknown): FieldExtractor | null {
  if (raw === undefined || raw === null) return null
  return parseFieldExtractor(raw)
}

function parseSpentOnExtractor(
  raw: unknown,
): FieldExtractor | DatePartsExtractor | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  if (
    typeof obj.yearGroup === 'number' ||
    typeof obj.monthGroup === 'number' ||
    typeof obj.dayGroup === 'number'
  ) {
    return parseDatePartsExtractor(obj)
  }
  return parseFieldExtractor(raw)
}

function parseDatePartsExtractor(
  obj: Record<string, unknown>,
): DatePartsExtractor | null {
  const source = obj.source
  if (source !== 'subject' && source !== 'text' && source !== 'html_text') {
    return null
  }
  if (typeof obj.regex !== 'string' || !obj.regex) return null
  if (!isNonNegInt(obj.yearGroup)) return null
  if (!isNonNegInt(obj.monthGroup)) return null
  if (!isNonNegInt(obj.dayGroup)) return null
  try {
    new RegExp(obj.regex, 'i')
  } catch {
    return null
  }
  return {
    source,
    regex: obj.regex,
    yearGroup: obj.yearGroup,
    monthGroup: obj.monthGroup,
    dayGroup: obj.dayGroup,
  }
}

function parseDirectionExtractor(raw: unknown): DirectionExtractor | null {
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const source = obj.source
  if (source !== 'subject' && source !== 'text' && source !== 'html_text') {
    return null
  }
  if (typeof obj.regex !== 'string' || !obj.regex) return null
  if (!isNonNegInt(obj.group)) return null
  const inbound = parseStringList(obj.inboundMatches)
  const outbound = parseStringList(obj.outboundMatches)
  if (!inbound || !outbound) return null
  if (inbound.length === 0 && outbound.length === 0) return null
  try {
    new RegExp(obj.regex, 'i')
  } catch {
    return null
  }
  return {
    source,
    regex: obj.regex,
    group: obj.group,
    inboundMatches: inbound,
    outboundMatches: outbound,
  }
}

function parseStringList(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') return null
    const trimmed = item.trim()
    if (trimmed) out.push(trimmed)
  }
  return out
}

function isNonNegInt(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0
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
