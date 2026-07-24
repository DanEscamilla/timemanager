export function asIsoTimestamp(value: Date | string): string {
  if (value instanceof Date) return value.toISOString()
  const trimmed = value.trim()
  if (/^\d{10,}$/.test(trimmed)) {
    const n = Number(trimmed)
    const ms = trimmed.length <= 10 ? n * 1000 : n
    return new Date(ms).toISOString()
  }
  return value
}

export function asIsoTimestampOrNull(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null
  return asIsoTimestamp(value)
}
