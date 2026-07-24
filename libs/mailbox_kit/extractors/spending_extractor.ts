import type { Extractor } from '../extractor.ts'
import { htmlToPlainText } from '../html_to_plain_text.ts'
import {
  SPENDING_CANDIDATE_KIND,
  type EmailMessage,
  type ExtractionArtifact,
  type SpendingCandidatePayload,
} from '../types.ts'

const RECEIPT_HINT =
  /\b(receipt|invoice|order|payment|charged|purchase|total|spent|transaction)\b/i

const AMOUNT_PATTERNS: RegExp[] = [
  /(?:total|amount|charged|paid|payment)[:\s]*\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})/i,
  /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?|\d+\.\d{2})/,
  /(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d+\.\d{2})\s*(USD|EUR|GBP|MXN|CAD)/i,
]

const CURRENCY_HINT = /\b(USD|EUR|GBP|MXN|CAD)\b/i

/**
 * Heuristic spending extractor. Emits spending.candidate artifacts only.
 */
export class SpendingExtractor implements Extractor {
  readonly kind = SPENDING_CANDIDATE_KIND

  canHandle(message: EmailMessage): boolean {
    const body = message.textBody?.trim()
      ? message.textBody
      : htmlToPlainText(message.htmlBody)
    const haystack = `${message.subject}\n${body}`
    if (RECEIPT_HINT.test(haystack)) return true
    return AMOUNT_PATTERNS.some((re) => re.test(haystack))
  }

  extract(message: EmailMessage): ExtractionArtifact[] {
    const text = [
      message.subject,
      message.textBody ?? '',
      htmlToPlainText(message.htmlBody),
    ]
      .join('\n')
      .trim()

    const amountCents = parseAmountCents(text)
    if (amountCents === null) return []

    const currency = parseCurrency(text) ?? 'USD'
    const spentOn = parseSpentOn(text) ?? toDateString(message.receivedAt)
    const merchant = parseMerchant(message)

    const payload: SpendingCandidatePayload = {
      amountCents,
      currency,
      spentOn,
      merchant,
      note: message.subject.slice(0, 200) || null,
      sourceSubject: message.subject,
      sourceFrom: message.from,
    }

    let confidence = 0.55
    if (RECEIPT_HINT.test(text)) confidence += 0.15
    if (merchant) confidence += 0.1
    if (parseSpentOn(text)) confidence += 0.1
    confidence = Math.min(0.95, confidence)

    return [
      {
        kind: SPENDING_CANDIDATE_KIND,
        payload: { ...payload },
        confidence,
      },
    ]
  }
}

function parseAmountCents(text: string): number | null {
  for (const re of AMOUNT_PATTERNS) {
    const m = text.match(re)
    if (!m?.[1]) continue
    const dollars = Number(m[1].replace(/,/g, ''))
    if (!Number.isFinite(dollars) || dollars <= 0) continue
    return Math.round(dollars * 100)
  }
  return null
}

function parseCurrency(text: string): string | null {
  const m = text.match(CURRENCY_HINT)
  return m?.[1]?.toUpperCase() ?? null
}

function parseSpentOn(text: string): string | null {
  // YYYY-MM-DD
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (iso?.[1]) return iso[1]

  // Month DD, YYYY
  const named = text.match(
    /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  )
  if (named) {
    const month = monthIndex(named[1]!)
    const day = Number(named[2])
    const year = Number(named[3])
    if (month >= 0 && day >= 1 && day <= 31) {
      return `${year}-${pad2(month + 1)}-${pad2(day)}`
    }
  }
  return null
}

function monthIndex(name: string): number {
  const key = name.slice(0, 3).toLowerCase()
  const months = [
    'jan',
    'feb',
    'mar',
    'apr',
    'may',
    'jun',
    'jul',
    'aug',
    'sep',
    'oct',
    'nov',
    'dec',
  ]
  return months.indexOf(key)
}

function parseMerchant(message: EmailMessage): string | null {
  const from = message.from.trim()
  const angle = from.match(/^(.*?)\s*<[^>]+>$/)
  if (angle?.[1]?.trim()) return angle[1].trim().slice(0, 120)

  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).toLowerCase()
  const domain = email.split('@')[1]
  if (!domain) return null
  const base = domain.split('.')[0]
  if (!base || base === 'gmail' || base === 'outlook' || base === 'yahoo') {
    return null
  }
  return base.charAt(0).toUpperCase() + base.slice(1)
}

function toDateString(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}
