/**
 * Optional allowlist of sender domains or full email addresses.
 * Empty / undefined list = no filter (accept all).
 */
export function matchesDomainFilter(
  fromAddress: string,
  patterns: readonly string[] | null | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return true

  const normalizedFrom = normalizeFrom(fromAddress)
  if (!normalizedFrom) return false

  const email = normalizedFrom.email
  const domain = normalizedFrom.domain

  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase()
    if (!pattern) continue
    if (pattern.includes('@')) {
      if (email === pattern) return true
    } else if (domain === pattern || domain.endsWith(`.${pattern}`)) {
      return true
    }
  }
  return false
}

export function filterMessagesByDomain<T extends { from: string }>(
  messages: readonly T[],
  patterns: readonly string[] | null | undefined,
): T[] {
  if (!patterns || patterns.length === 0) return [...messages]
  return messages.filter((m) => matchesDomainFilter(m.from, patterns))
}

function normalizeFrom(
  from: string,
): { email: string; domain: string } | null {
  const trimmed = from.trim()
  // "Name <user@domain.com>" or bare "user@domain.com"
  const angle = trimmed.match(/<([^>]+)>/)
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  const domain = email.slice(at + 1)
  if (!domain.includes('.')) return null
  return { email, domain }
}
