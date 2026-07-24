/**
 * Helpers for allowlist expansion sync: track which domain/sender patterns
 * have been covered by a completed backfill, and diff new patterns to fetch.
 */

/** Lowercase + trim; drop empties; preserve first-seen order. */
export function normalizeDomainPatterns(
  patterns: readonly string[],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase()
    if (!p || seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

/** Parse JSON array of patterns; invalid / null → []. */
export function parseDomainPatternsJson(
  raw: string | null | undefined,
): string[] {
  if (raw == null || raw.trim() === '') return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return normalizeDomainPatterns(
      parsed.filter((x): x is string => typeof x === 'string'),
    )
  } catch {
    return []
  }
}

export function serializeDomainPatternsJson(
  patterns: readonly string[],
): string {
  return JSON.stringify(normalizeDomainPatterns(patterns))
}

/**
 * Patterns in `current` that are not yet in `synced` (case-insensitive).
 * Result is normalized (lowercase).
 */
export function diffNewDomainPatterns(
  current: readonly string[],
  synced: readonly string[],
): string[] {
  const syncedSet = new Set(normalizeDomainPatterns(synced))
  return normalizeDomainPatterns(current).filter((p) => !syncedSet.has(p))
}

/**
 * After a backfill completes: keep synced patterns still on the allowlist,
 * then union with patterns just fetched. Order follows current allowlist.
 */
export function mergeSyncedDomainPatterns(
  synced: readonly string[],
  currentAllowlist: readonly string[],
  justCompleted: readonly string[],
): string[] {
  const current = normalizeDomainPatterns(currentAllowlist)
  const currentSet = new Set(current)
  const keep = new Set<string>()
  for (const p of normalizeDomainPatterns(synced)) {
    if (currentSet.has(p)) keep.add(p)
  }
  for (const p of normalizeDomainPatterns(justCompleted)) {
    if (currentSet.has(p)) keep.add(p)
  }
  return current.filter((p) => keep.has(p))
}

/**
 * Decide fetch patterns + whether to ignore DB message coverage (expansion).
 * Expansion when there are patterns not yet in the synced set.
 */
export function resolveSyncFetchPlan(input: {
  currentPatterns: readonly string[]
  syncedPatterns: readonly string[]
}): {
  fetchPatterns: string[]
  expansionMode: boolean
  /** JSON to store on mailbox for this run; null when not expanding. */
  syncFetchPatternsJson: string | null
} {
  const current = normalizeDomainPatterns(input.currentPatterns)
  const synced = normalizeDomainPatterns(input.syncedPatterns)
  const newPatterns = diffNewDomainPatterns(current, synced)
  if (newPatterns.length > 0) {
    return {
      fetchPatterns: newPatterns,
      expansionMode: true,
      syncFetchPatternsJson: serializeDomainPatternsJson(newPatterns),
    }
  }
  return {
    fetchPatterns: current,
    expansionMode: false,
    syncFetchPatternsJson: null,
  }
}
