import { db } from 'mailbox_api/db/database.ts'
import { syncDueMailboxes } from './sync.ts'

const n = await syncDueMailboxes({ pollIntervalMs: 1 })
console.log('synced mailboxes:', n)
const msgs = await db.selectFrom('messages').selectAll().execute()
const arts = await db.selectFrom('extraction_artifacts').selectAll().execute()
const runs = await db.selectFrom('sync_runs').selectAll().execute()
console.log('messages', msgs.length, 'artifacts', arts.length, 'runs', runs.length)
console.log(
  'artifacts',
  arts.map((a) => `${a.kind}:${a.status}:${(a.payload as { amountCents?: number }).amountCents}`),
)
await db.destroy()
