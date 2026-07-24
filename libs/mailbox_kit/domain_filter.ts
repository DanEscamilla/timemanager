/**
 * Optional allowlist of sender domains or full email addresses.
 * Empty / undefined list = reject all (filters are required for sync).
 *
 * Pattern grammar:
 * - `user@shop.com` — exact address
 * - `shop.com` — apex + subdomains
 * - `*.shop.com` — subdomains only (not apex); legacy / template patterns
 * - `*@shop.com` — any local-part at that exact domain
 * - `*@*.shop.com` — any local-part at a subdomain of shop.com
 *
 * Domain filters no longer accept wildcards at the API; matching still
 * supports them for parsing-template `matchFromPattern` and legacy rows.
 */
export function matchesDomainFilter(
  fromAddress: string,
  patterns: readonly string[] | null | undefined,
): boolean {
  if (!patterns || patterns.length === 0) return false

  const normalizedFrom = normalizeFrom(fromAddress)
  if (!normalizedFrom) return false

  for (const raw of patterns) {
    const pattern = raw.trim().toLowerCase()
    if (!pattern) continue
    if (matchesSinglePattern(normalizedFrom, pattern)) return true
  }
  return false
}

export function filterMessagesByDomain<T extends { from: string }>(
  messages: readonly T[],
  patterns: readonly string[] | null | undefined,
): T[] {
  if (!patterns || patterns.length === 0) return []
  return messages.filter((m) => matchesDomainFilter(m.from, patterns))
}

/** True when `fromAddress` matches a single allowlist / template pattern. */
export function matchesFromPattern(
  fromAddress: string,
  pattern: string,
): boolean {
  const normalizedFrom = normalizeFrom(fromAddress)
  if (!normalizedFrom) return false
  const p = pattern.trim().toLowerCase()
  if (!p) return false
  return matchesSinglePattern(normalizedFrom, p)
}

export function normalizeFrom(
  from: string,
): { email: string; local: string; domain: string } | null {
  const trimmed = from.trim()
  // "Name <user@domain.com>" or bare "user@domain.com"
  const angle = trimmed.match(/<([^>]+)>/)
  const email = (angle?.[1] ?? trimmed).trim().toLowerCase()
  const at = email.lastIndexOf('@')
  if (at <= 0 || at === email.length - 1) return null
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (!domain.includes('.')) return null
  return { email, local, domain }
}

function matchesSinglePattern(
  from: { email: string; local: string; domain: string },
  pattern: string,
): boolean {
  if (pattern.includes('@')) {
    return matchesAddressPattern(from, pattern)
  }
  return matchesDomainPattern(from.domain, pattern)
}

function matchesAddressPattern(
  from: { email: string; local: string; domain: string },
  pattern: string,
): boolean {
  const at = pattern.lastIndexOf('@')
  if (at <= 0 || at === pattern.length - 1) return false
  const localPat = pattern.slice(0, at)
  const domainPat = pattern.slice(at + 1)

  if (localPat !== '*' && localPat !== from.local) return false
  // Address-form domain side: exact apex, or explicit *.subdomain pattern.
  // (`*@shop.com` does not match mail.shop.com; use `*@*.shop.com` for that.)
  if (domainPat.startsWith('*.')) {
    return matchesDomainPattern(from.domain, domainPat)
  }
  return from.domain === domainPat
}

function matchesDomainPattern(domain: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(2)
    if (!suffix.includes('.')) return false
    // Subdomains only — not the apex itself.
    return domain.endsWith(`.${suffix}`)
  }
  return domain === pattern || domain.endsWith(`.${pattern}`)
}
