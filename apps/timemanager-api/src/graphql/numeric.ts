/** Postgres `numeric` arrives as string via `pg`; GraphQL Number requires JS number. */
export function asNumber(value: unknown, fallback = 0): number {
  if (value == null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

export function asNumberOrNull(value: unknown): number | null {
  if (value == null) return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
