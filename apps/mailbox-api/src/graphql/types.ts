export interface CreateMailboxInput {
  provider: string
  label: string
  enabled?: boolean | null
  /** Optional initial domain allowlist. */
  domainFilters?: string[] | null
  /** Gmail OAuth tokens JSON (access + refresh); fixture ignores. */
  oauthTokensJson?: string | null
}

export interface UpdateMailboxInput {
  id: number
  label: string
}

export interface SetDomainFiltersInput {
  mailboxId: number
  patterns: string[]
}

export interface UpdateArtifactStatusInput {
  artifactId: number
  status: string
  /** Required when accepting a spending.candidate. */
  categoryId?: number | null
}

export interface ConnectGmailInput {
  mailboxId: number
  accessToken: string
  refreshToken?: string | null
  expiresAtMs?: number | null
}

export interface StartGmailOAuthInput {
  mailboxId: number
  /** Flutter Email import URL to redirect to after Google consent. */
  returnTo: string
}

export interface CreateParsingTemplateInput {
  mailboxId: number
  name: string
  /** 'approve' | 'reject' (default approve). */
  kind?: string | null
  matchFromPattern: string
  matchSubjectRegex?: string | null
  /** Required for approve; ignored/cleared for reject. */
  extractorsJson?: string | null
  enabled?: boolean | null
  sourceMessageId?: number | null
}

export interface UpdateParsingTemplateInput {
  id: number
  name?: string | null
  matchFromPattern?: string | null
  matchSubjectRegex?: string | null
  extractorsJson?: string | null
  enabled?: boolean | null
}

export interface GenerateParsingTemplateInput {
  messageId: number
  /** 'approve' | 'reject' */
  decision: string
  name?: string | null
  hints?: string | null
}
