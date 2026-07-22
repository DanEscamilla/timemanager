export type {
  ArtifactStatus,
  EmailMessage,
  ExtractionArtifact,
  ListMessagesResult,
  SpendingCandidatePayload,
  SyncCursor,
} from './types.ts'
export { SPENDING_CANDIDATE_KIND } from './types.ts'

export type { ListMessagesOptions, MailboxProvider } from './provider.ts'

export {
  filterMessagesByDomain,
  matchesDomainFilter,
} from './domain_filter.ts'

export type { Extractor } from './extractor.ts'
export { ExtractorPipeline } from './extractor.ts'

export type { ExpenseSink } from './expense_sink.ts'
export { NoopExpenseSink } from './expense_sink.ts'

export { SpendingExtractor } from './extractors/spending_extractor.ts'

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
