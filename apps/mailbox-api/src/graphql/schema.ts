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
    created_at: String!
  }

  type ExtractionArtifact {
    id: Int!
    message_id: Int!
    kind: String!
    payload: String!
    confidence: Float!
    status: String!
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

  input CreateMailboxInput {
    provider: String!
    label: String!
    enabled: Boolean
    domainFilters: [String!]
    oauthTokensJson: String
  }

  input SetDomainFiltersInput {
    mailboxId: Int!
    patterns: [String!]!
  }

  input UpdateArtifactStatusInput {
    artifactId: Int!
    status: String!
  }

  input ConnectGmailInput {
    mailboxId: Int!
    accessToken: String!
    refreshToken: String
    expiresAtMs: Float
  }

  type Query {
    mailboxes: [Mailbox!]!
    domainFilters(mailboxId: Int!): [DomainFilter!]!
    messages(mailboxId: Int!): [Message!]!
    extractionArtifacts(mailboxId: Int, status: String): [ExtractionArtifact!]!
    syncRuns(mailboxId: Int!): [SyncRun!]!
  }

  type Mutation {
    createMailbox(input: CreateMailboxInput!): Mailbox!
    deleteMailbox(id: Int!): Boolean!
    setDomainFilters(input: SetDomainFiltersInput!): [DomainFilter!]!
    triggerSync(mailboxId: Int!): Mailbox!
    updateArtifactStatus(input: UpdateArtifactStatusInput!): ExtractionArtifact!
    connectGmail(input: ConnectGmailInput!): Mailbox!
  }
`
