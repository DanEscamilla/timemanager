import { assertEquals } from 'jsr:@std/assert@1'
import {
  clearInboxData,
  rejectAllPendingArtifacts,
  type InboxOpsStore,
  type MailboxRow,
} from './inbox_ops.ts'

function sampleMailbox(overrides: Partial<MailboxRow> = {}): MailboxRow {
  return {
    id: 5,
    user_id: 1,
    provider: 'fixture',
    label: 'Demo',
    enabled: true,
    sync_cursor: 'done:123',
    sync_requested: true,
    sync_since: new Date('2026-01-01T00:00:00.000Z'),
    sync_until: new Date('2026-07-01T00:00:00.000Z'),
    sync_backfill_cursor: 'page-2',
    oauth_tokens_json: null,
    last_synced_at: new Date('2026-07-20T00:00:00.000Z'),
    created_at: new Date('2026-07-01T00:00:00.000Z'),
    updated_at: new Date('2026-07-20T00:00:00.000Z'),
    ...overrides,
  }
}

function fakeStore(opts: {
  mailboxId?: number
  rejectedCount?: number
  calls?: {
    deleteMessages: number[]
    deleteSyncRuns: number[]
    reset: { mailboxId: number; updatedAt: string }[]
    reject: { mailboxId: number; updatedAt: string }[]
  }
}): InboxOpsStore {
  const mailboxId = opts.mailboxId ?? 5
  const calls = opts.calls ?? {
    deleteMessages: [],
    deleteSyncRuns: [],
    reset: [],
    reject: [],
  }
  return {
    async deleteMessages(id) {
      calls.deleteMessages.push(id)
      return 3
    },
    async deleteSyncRuns(id) {
      calls.deleteSyncRuns.push(id)
      return 2
    },
    async resetMailboxSyncState(id, updatedAt) {
      calls.reset.push({ mailboxId: id, updatedAt })
      return sampleMailbox({
        id: mailboxId,
        sync_cursor: null,
        sync_backfill_cursor: null,
        sync_since: null,
        sync_until: null,
        sync_requested: false,
        last_synced_at: null,
        updated_at: new Date(updatedAt),
      })
    },
    async rejectPendingArtifacts(id, updatedAt) {
      calls.reject.push({ mailboxId: id, updatedAt })
      return opts.rejectedCount ?? 4
    },
  }
}

Deno.test('clearInboxData deletes messages and sync runs then resets sync state', async () => {
  const calls = {
    deleteMessages: [] as number[],
    deleteSyncRuns: [] as number[],
    reset: [] as { mailboxId: number; updatedAt: string }[],
    reject: [] as { mailboxId: number; updatedAt: string }[],
  }
  const now = '2026-07-23T12:00:00.000Z'
  const row = await clearInboxData(fakeStore({ calls }), 5, now)

  assertEquals(calls.deleteMessages, [5])
  assertEquals(calls.deleteSyncRuns, [5])
  assertEquals(calls.reset, [{ mailboxId: 5, updatedAt: now }])
  assertEquals(calls.reject, [])
  assertEquals(row.sync_cursor, null)
  assertEquals(row.sync_backfill_cursor, null)
  assertEquals(row.sync_since, null)
  assertEquals(row.sync_until, null)
  assertEquals(row.sync_requested, false)
  assertEquals(row.last_synced_at, null)
})

Deno.test('rejectAllPendingArtifacts returns store update count', async () => {
  const calls = {
    deleteMessages: [] as number[],
    deleteSyncRuns: [] as number[],
    reset: [] as { mailboxId: number; updatedAt: string }[],
    reject: [] as { mailboxId: number; updatedAt: string }[],
  }
  const now = '2026-07-23T12:00:00.000Z'
  const count = await rejectAllPendingArtifacts(
    fakeStore({ calls, rejectedCount: 7 }),
    9,
    now,
  )

  assertEquals(count, 7)
  assertEquals(calls.reject, [{ mailboxId: 9, updatedAt: now }])
  assertEquals(calls.deleteMessages, [])
  assertEquals(calls.reset, [])
})
