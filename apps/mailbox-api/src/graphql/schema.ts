import { gql } from 'graphql-tag'

/**
 * Human-readable GraphQL schema mirror. Pylon derives the runtime schema from
 * resolver exports in resolvers.ts.
 */
export const typeDefs = gql`
  type Mailbox {
    id: Int!
    user_id: Int!
    provider: String!
    label: String!
    enabled: Boolean!
    sync_cursor: String
    sync_requested: Boolean!
    last_synced_at: String
    created_at: String!
    updated_at: String!
  }

  type DomainFilter {
    id: Int!
    mailbox_id: Int!
    pattern: String!
    created_at: String!
  }

  type Message {
    id: Int!
    mailbox_id: Int!
    provider_message_id: String!
    rfc_message_id: String!
    from_address: String!
    subject: String!
    received_at: String!
    text_body: String
    html_body: String
    created_at: String!
  }

  type ExtractionArtifact {
    id: Int!
    message_id: Int!
    kind: String!
    payload: String!
    confidence: Float!
    status: String!
    published_expense_id: Int
    created_at: String!
    updated_at: String!
  }

  type SyncRun {
    id: Int!
    mailbox_id: Int!
    started_at: String!
    finished_at: String
    fetched_count: Int!
    extracted_count: Int!
    error_text: String
  }

  type ParsingTemplate {
    id: Int!
    mailbox_id: Int!
    user_id: Int!
    name: String!
    enabled: Boolean!
    match_from_pattern: String!
    match_subject_regex: String
    extractors: String!
    source_message_id: Int
    version: Int!
    created_at: String!
    updated_at: String!
  }

  input CreateMailboxInput {
    provider: String!
    label: String!
    enabled: Boolean
    domainFilters: [String!]
    oauthTokensJson: String
  }

  input UpdateMailboxInput {
    id: Int!
    label: String!
  }

  input SetDomainFiltersInput {
    mailboxId: Int!
    patterns: [String!]!
  }

  input UpdateArtifactStatusInput {
    artifactId: Int!
    status: String!
    categoryId: Int
  }

  input ConnectGmailInput {
    mailboxId: Int!
    accessToken: String!
    refreshToken: String
    expiresAtMs: Float
  }

  input StartGmailOAuthInput {
    mailboxId: Int!
    returnTo: String!
  }

  type StartGmailOAuthPayload {
    authorizationUrl: String!
  }

  input CreateParsingTemplateInput {
    mailboxId: Int!
    name: String!
    matchFromPattern: String!
    matchSubjectRegex: String
    extractorsJson: String!
    enabled: Boolean
    sourceMessageId: Int
  }

  input UpdateParsingTemplateInput {
    id: Int!
    name: String
    matchFromPattern: String
    matchSubjectRegex: String
    extractorsJson: String
    enabled: Boolean
  }

  input GenerateParsingTemplateInput {
    messageId: Int!
    name: String
    hints: String
  }

  type Query {
    mailboxes: [Mailbox!]!
    domainFilters(mailboxId: Int!): [DomainFilter!]!
    messages(mailboxId: Int!): [Message!]!
    message(id: Int!): Message
    sourceMessageForExpense(expenseId: Int!): Message
    extractionArtifacts(mailboxId: Int, status: String): [ExtractionArtifact!]!
    syncRuns(mailboxId: Int!): [SyncRun!]!
    parsingTemplates(mailboxId: Int!): [ParsingTemplate!]!
  }

  type Mutation {
    createMailbox(input: CreateMailboxInput!): Mailbox!
    updateMailbox(input: UpdateMailboxInput!): Mailbox!
    deleteMailbox(id: Int!): Boolean!
    setDomainFilters(input: SetDomainFiltersInput!): [DomainFilter!]!
    triggerSync(mailboxId: Int!): Mailbox!
    updateArtifactStatus(input: UpdateArtifactStatusInput!): ExtractionArtifact!
    connectGmail(input: ConnectGmailInput!): Mailbox!
    startGmailOAuth(input: StartGmailOAuthInput!): StartGmailOAuthPayload!
    createParsingTemplate(input: CreateParsingTemplateInput!): ParsingTemplate!
    updateParsingTemplate(input: UpdateParsingTemplateInput!): ParsingTemplate!
    deleteParsingTemplate(id: Int!): Boolean!
    generateParsingTemplate(input: GenerateParsingTemplateInput!): ParsingTemplate!
  }
`
