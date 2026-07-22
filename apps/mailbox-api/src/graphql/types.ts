export interface CreateMailboxInput {
  provider: string
  label: string
  enabled?: boolean | null
  /** Optional initial domain allowlist. */
  domainFilters?: string[] | null
  /** Gmail OAuth tokens JSON (access + refresh); fixture ignores. */
  oauthTokensJson?: string | null
}

export interface SetDomainFiltersInput {
  mailboxId: number
  patterns: string[]
}

export interface UpdateArtifactStatusInput {
  artifactId: number
  status: string
}

export interface ConnectGmailInput {
  mailboxId: number
  accessToken: string
  refreshToken?: string | null
  expiresAtMs?: number | null
}
