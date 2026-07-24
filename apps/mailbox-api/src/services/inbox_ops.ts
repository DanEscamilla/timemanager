import type { Kysely } from 'kysely'
import type { Database, MailboxesTable } from '../db/types/schema.ts'
import type { Selectable } from 'kysely'

export type MailboxRow = Selectable<MailboxesTable>

/** Minimal store so clear / reject-all can be unit-tested without Postgres. */
export type InboxOpsStore = {
  deleteMessages(mailboxId: number): Promise<number>
  deleteSyncRuns(mailboxId: number): Promise<number>
  resetMailboxSyncState(
    mailboxId: number,
    updatedAt: string,
  ): Promise<MailboxRow>
  rejectPendingArtifacts(
    mailboxId: number,
    updatedAt: string,
  ): Promise<number>
}

export function createKyselyInboxOpsStore(
  db: Kysely<Database>,
): InboxOpsStore {
  return {
    async deleteMessages(mailboxId) {
      const result = await db
        .deleteFrom('messages')
        .where('mailbox_id', '=', mailboxId)
        .executeTakeFirst()
      return Number(result.numDeletedRows ?? 0)
    },
    async deleteSyncRuns(mailboxId) {
      const result = await db
        .deleteFrom('sync_runs')
        .where('mailbox_id', '=', mailboxId)
        .executeTakeFirst()
      return Number(result.numDeletedRows ?? 0)
    },
    async resetMailboxSyncState(mailboxId, updatedAt) {
      return await db
        .updateTable('mailboxes')
        .set({
          sync_cursor: null,
          sync_backfill_cursor: null,
          sync_since: null,
          sync_until: null,
          sync_requested: false,
          synced_domain_filters_json: null,
          sync_fetch_patterns_json: null,
          last_synced_at: null,
          updated_at: updatedAt,
        })
        .where('id', '=', mailboxId)
        .returningAll()
        .executeTakeFirstOrThrow()
    },
    async rejectPendingArtifacts(mailboxId, updatedAt) {
      const result = await db
        .updateTable('extraction_artifacts')
        .set({ status: 'rejected', updated_at: updatedAt })
        .where('status', '=', 'pending')
        .where(
          'message_id',
          'in',
          db
            .selectFrom('messages')
            .select('id')
            .where('mailbox_id', '=', mailboxId),
        )
        .executeTakeFirst()
      return Number(result.numUpdatedRows ?? 0)
    },
  }
}

/**
 * Wipe synced messages (artifacts cascade), sync runs, and reset sync cursors
 * (including synced/fetch domain-filter snapshots).
 * Does not remove domain filters, parsing templates, or the mailbox itself.
 */
export async function clearInboxData(
  store: InboxOpsStore,
  mailboxId: number,
  now: string = new Date().toISOString(),
): Promise<MailboxRow> {
  await store.deleteMessages(mailboxId)
  await store.deleteSyncRuns(mailboxId)
  return await store.resetMailboxSyncState(mailboxId, now)
}

/** Reject all pending extraction artifacts for a mailbox. Returns updated count. */
export async function rejectAllPendingArtifacts(
  store: InboxOpsStore,
  mailboxId: number,
  now: string = new Date().toISOString(),
): Promise<number> {
  return await store.rejectPendingArtifacts(mailboxId, now)
}
