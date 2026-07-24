/**
 * Date-based sync progress: backfill walks newest → oldest within
 * [sync_since, sync_until], so the frontier is the oldest message synced so far.
 */

export type SyncProgressInput = {
  active: boolean
  syncSince: Date | null
  syncUntil: Date | null
  /** MIN(received_at) of messages in the sync window; null before any messages. */
  oldestSyncedAt: Date | null
  now?: Date
}

/**
 * Returns 0–100 while a dated sync is active, or null when progress cannot be
 * estimated (inactive, or missing usable date bounds).
 */
export function computeSyncProgressPercent(
  input: SyncProgressInput,
): number | null {
  if (!input.active) return null

  const now = input.now ?? new Date()
  const windowEnd = input.syncUntil ??
    (input.syncSince != null ? now : null)
  let windowStart = input.syncSince
  if (windowStart == null && input.syncUntil != null) {
    windowStart = input.oldestSyncedAt
  }
  if (windowStart == null || windowEnd == null) return null

  const spanMs = windowEnd.getTime() - windowStart.getTime()
  if (spanMs <= 0) return 100

  const frontier = input.oldestSyncedAt ?? windowEnd
  const progressedMs = windowEnd.getTime() - frontier.getTime()
  const raw = (progressedMs / spanMs) * 100
  return Math.max(0, Math.min(100, raw))
}
