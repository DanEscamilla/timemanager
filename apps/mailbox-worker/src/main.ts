import { db } from 'mailbox_api/db/database.ts'
import { syncDueMailboxes } from './sync.ts'

const pollIntervalMs = Number(Deno.env.get('POLL_INTERVAL_MS') ?? 300_000)

console.log(
  `[mailbox-worker] starting; poll interval ${pollIntervalMs}ms`,
)

async function tick() {
  console.log('[mailbox-worker] tick')
  try {
    await syncDueMailboxes({ pollIntervalMs })
  } catch (err) {
    console.error('[mailbox-worker] tick failed', err)
  }
}

await tick()
const handle = setInterval(tick, pollIntervalMs)

Deno.addSignalListener('SIGINT', async () => {
  clearInterval(handle)
  await db.destroy()
  Deno.exit(0)
})

Deno.addSignalListener('SIGTERM', async () => {
  clearInterval(handle)
  await db.destroy()
  Deno.exit(0)
})
