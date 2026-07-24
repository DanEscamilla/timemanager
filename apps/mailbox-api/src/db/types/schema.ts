import { ColumnType, Generated, Insertable, Selectable, Updateable } from 'kysely'

export interface Database {
  users: UsersTable
  mailboxes: MailboxesTable
  domain_filters: DomainFiltersTable
  messages: MessagesTable
  extraction_artifacts: ExtractionArtifactsTable
  sync_runs: SyncRunsTable
  parsing_templates: ParsingTemplatesTable
}

export interface UsersTable {
  id: Generated<number>
  email: string
  password_hash: string | null
  auth_user_id: string | null
  name: string
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export interface MailboxesTable {
  id: Generated<number>
  user_id: number
  /** 'fixture' | 'gmail' */
  provider: string
  label: string
  enabled: boolean
  /** Opaque provider sync cursor. */
  sync_cursor: string | null
  /** When true, worker should sync ASAP. */
  sync_requested: boolean
  /** One-shot backfill window start (inclusive); null = open or incremental. */
  sync_since: ColumnType<Date | null, string | null | undefined, string | null>
  /** One-shot backfill window end (inclusive); null = open or incremental. */
  sync_until: ColumnType<Date | null, string | null | undefined, string | null>
  /** Page cursor for an in-progress backfill; does not replace sync_cursor. */
  sync_backfill_cursor: string | null
  /** JSON: { accessToken, refreshToken?, expiresAtMs? } for gmail. */
  oauth_tokens_json: string | null
  last_synced_at: ColumnType<Date | null, string | null | undefined, string | null>
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export interface DomainFiltersTable {
  id: Generated<number>
  mailbox_id: number
  /** Domain (amazon.com) or full address (noreply@amazon.com). */
  pattern: string
  created_at: ColumnType<Date, string | undefined, never>
}

export interface MessagesTable {
  id: Generated<number>
  mailbox_id: number
  provider_message_id: string
  rfc_message_id: string
  from_address: string
  subject: string
  received_at: ColumnType<Date, string | undefined, string>
  body_hash: string | null
  text_body: string | null
  html_body: string | null
  created_at: ColumnType<Date, string | undefined, never>
}

export interface ExtractionArtifactsTable {
  id: Generated<number>
  message_id: number
  kind: string
  payload: ColumnType<unknown, string | unknown, string | unknown>
  confidence: number
  /** 'pending' | 'accepted' | 'rejected' */
  status: string
  /** spendmanager expense id after accept+publish */
  published_expense_id: number | null
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export interface ParsingTemplatesTable {
  id: Generated<number>
  mailbox_id: number
  user_id: number
  name: string
  /** 'approve' | 'reject' */
  kind: string
  enabled: boolean
  match_from_pattern: string
  match_subject_regex: string | null
  /** Null for reject templates (match-only). */
  extractors: ColumnType<
    unknown | null,
    string | unknown | null | undefined,
    string | unknown | null
  >
  source_message_id: number | null
  version: number
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export interface SyncRunsTable {
  id: Generated<number>
  mailbox_id: number
  started_at: ColumnType<Date, string | undefined, never>
  finished_at: ColumnType<Date | null, string | null | undefined, string | null>
  fetched_count: number
  extracted_count: number
  error_text: string | null
}

export type User = Selectable<UsersTable>
export type Mailbox = Selectable<MailboxesTable>
export type NewMailbox = Insertable<MailboxesTable>
export type DomainFilter = Selectable<DomainFiltersTable>
export type Message = Selectable<MessagesTable>
export type ExtractionArtifact = Selectable<ExtractionArtifactsTable>
export type SyncRun = Selectable<SyncRunsTable>
export type NewSyncRun = Insertable<SyncRunsTable>
export type ParsingTemplate = Selectable<ParsingTemplatesTable>
export type NewParsingTemplate = Insertable<ParsingTemplatesTable>
