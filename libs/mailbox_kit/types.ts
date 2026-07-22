/** Normalized email used by the extract pipeline. */
export interface EmailMessage {
  /** Provider-specific id (Gmail message id, fixture id, etc.). */
  id: string
  /** RFC 5322 Message-ID when available; used for idempotency. */
  rfcMessageId: string
  from: string
  subject: string
  receivedAt: Date
  textBody: string | null
  htmlBody: string | null
}

/** Opaque sync cursor returned by a MailboxProvider. */
export type SyncCursor = string | null

export interface ListMessagesResult {
  messages: EmailMessage[]
  /** Cursor to persist after a successful sync. */
  nextCursor: SyncCursor
}

export type ArtifactStatus = 'pending' | 'accepted' | 'rejected'

/** Domain-agnostic extraction result (not a spendmanager expense). */
export interface ExtractionArtifact {
  kind: string
  payload: Record<string, unknown>
  confidence: number
}

/** Payload shape for SpendingExtractor (`kind: "spending.candidate"`). */
export interface SpendingCandidatePayload {
  amountCents: number
  currency: string
  spentOn: string
  merchant: string | null
  note: string | null
  sourceSubject: string
  sourceFrom: string
  /** Set when published to spendmanager. */
  publishedExpenseId?: number | null
  /** Parsing template id when extracted via a template. */
  templateId?: number | null
}

export const SPENDING_CANDIDATE_KIND = 'spending.candidate' as const

/** Deterministic field extractor used by parsing templates. */
export type FieldExtractor =
  | {
    source: 'subject' | 'text' | 'html_text'
    regex: string
    group: number
  }
  | { source: 'from_domain' }
  | { source: 'constant'; value: string }

/** Field map stored in `parsing_templates.extractors` JSONB. */
export type SpendTemplateExtractors = {
  amount: FieldExtractor
  currency?: FieldExtractor | null
  spentOn?: FieldExtractor | null
  merchant?: FieldExtractor | null
  note?: FieldExtractor | null
}

/** Runtime definition for a mailbox parsing template. */
export type SpendParsingTemplate = {
  id: number
  matchFromPattern: string
  matchSubjectRegex?: string | null
  extractors: SpendTemplateExtractors
  enabled?: boolean
}
