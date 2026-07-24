export type {
  ArtifactStatus,
  DatePartsExtractor,
  DirectionExtractor,
  EmailMessage,
  ExtractionArtifact,
  FieldExtractor,
  ListMessagesResult,
  SpendParsingTemplate,
  SpendTemplateExtractors,
  SpendingCandidatePayload,
  SyncCursor,
} from './types.ts'
export { SPENDING_CANDIDATE_KIND } from './types.ts'

export type { ListMessagesOptions, MailboxProvider } from './provider.ts'

export {
  filterMessagesByDomain,
  matchesDomainFilter,
  matchesFromPattern,
  normalizeFrom,
} from './domain_filter.ts'

export type { TemplateMatchSpec } from './template_match.ts'
export {
  messageMatchesAnyTemplate,
  messageMatchesTemplate,
} from './template_match.ts'

export { extractSpendingCandidates } from './template_extract.ts'

export {
  htmlToPlainText,
  looksLikeHtml,
  resolveTextBody,
} from './html_to_plain_text.ts'

export type { Extractor } from './extractor.ts'
export { ExtractorPipeline } from './extractor.ts'

export type { ExpenseSink } from './expense_sink.ts'
export { NoopExpenseSink } from './expense_sink.ts'

export { SpendingExtractor } from './extractors/spending_extractor.ts'
export {
  TemplateSpendingExtractor,
  parseSpendTemplateExtractors,
} from './extractors/template_spending_extractor.ts'

export {
  FIXTURE_RECEIPT_MESSAGES,
  FixtureMailboxProvider,
} from './providers/fixture_provider.ts'

export {
  GmailMailboxProvider,
  parseGmailCursor,
  serializeGmailCursor,
} from './providers/gmail_provider.ts'
export type {
  GmailMailboxProviderOptions,
  GmailOAuthTokens,
} from './providers/gmail_provider.ts'
