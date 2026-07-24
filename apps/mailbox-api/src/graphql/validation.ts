import { ServiceError } from '@getcronit/pylon'

const PROVIDERS = new Set(['fixture', 'gmail'])
const ARTIFACT_STATUSES = new Set(['pending', 'accepted', 'rejected'])
const TEMPLATE_KINDS = new Set(['approve', 'reject'])

/**
 * Client-facing validation failure. Extends Pylon ServiceError (GraphQLError)
 * so GraphQL Yoga does not mask the message as "Unexpected error."
 */
export class InvalidMailboxError extends ServiceError {
  constructor(message: string) {
    super(message, {
      code: 'INVALID_MAILBOX_INPUT',
      statusCode: 400,
    })
    this.name = 'InvalidMailboxError'
  }
}

const DOMAIN_FILTER_HELP =
  'Allowed patterns: shop.com, user@shop.com (wildcards are not allowed)'

const FROM_PATTERN_HELP =
  'Allowed patterns: shop.com, *.shop.com, user@shop.com, *@shop.com, *@*.shop.com'

export function validateProvider(provider: string): string {
  const trimmed = provider.trim().toLowerCase()
  if (!PROVIDERS.has(trimmed)) {
    throw new InvalidMailboxError(
      `provider must be one of: ${[...PROVIDERS].join(', ')}`,
    )
  }
  return trimmed
}

export function validateLabel(label: string): string {
  const trimmed = label.trim()
  if (!trimmed) throw new InvalidMailboxError('label is required')
  if (trimmed.length > 255) throw new InvalidMailboxError('label is too long')
  return trimmed
}

/**
 * Domain allowlist for sync. At least one pattern required.
 * Allowed: `shop.com`, `user@shop.com`. Wildcards are rejected.
 */
export function validateDomainPatterns(patterns: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase()
    if (!p) continue
    if (p.length > 255) {
      throw new InvalidMailboxError('domain filter pattern is too long')
    }
    if (!isValidDomainFilterPattern(p)) {
      throw new InvalidMailboxError(
        describeInvalidDomainFilter(raw),
      )
    }
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  if (out.length === 0) {
    throw new InvalidMailboxError('domain filters are required')
  }
  return out
}

/** Literal domain or exact address — no wildcards. */
function isValidDomainFilterPattern(pattern: string): boolean {
  if (pattern.includes('*')) return false

  if (pattern.includes('@')) {
    const at = pattern.lastIndexOf('@')
    if (at <= 0 || at === pattern.length - 1) return false
    const local = pattern.slice(0, at)
    const domain = pattern.slice(at + 1)
    if (!local || local.includes('@')) return false
    return isValidLiteralDomain(domain)
  }
  return isValidLiteralDomain(pattern)
}

function isValidLiteralDomain(domain: string): boolean {
  if (domain.includes('*')) return false
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
    .test(domain)
}

/** Template matchFromPattern — wildcards allowed. */
export function isValidFromPattern(pattern: string): boolean {
  const p = pattern.trim().toLowerCase()
  if (!p || p.length > 255) return false

  if (p.includes('@')) {
    const at = p.lastIndexOf('@')
    if (at <= 0 || at === p.length - 1) return false
    const local = p.slice(0, at)
    const domain = p.slice(at + 1)
    if (local !== '*' && (local.includes('*') || local.includes('@'))) {
      return false
    }
    return isValidDomainPattern(domain)
  }
  return isValidDomainPattern(p)
}

function isValidDomainPattern(domain: string): boolean {
  if (domain.startsWith('*.')) {
    const rest = domain.slice(2)
    if (!rest || rest.includes('*') || !rest.includes('.')) return false
    return isValidLiteralDomain(rest)
  }
  if (domain.includes('*')) return false
  return isValidLiteralDomain(domain)
}

export function validateArtifactStatus(status: string): string {
  const trimmed = status.trim().toLowerCase()
  if (!ARTIFACT_STATUSES.has(trimmed)) {
    throw new InvalidMailboxError(
      `status must be one of: ${[...ARTIFACT_STATUSES].join(', ')}`,
    )
  }
  return trimmed
}

export function validateTemplateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new InvalidMailboxError('template name is required')
  if (trimmed.length > 255) {
    throw new InvalidMailboxError('template name is too long')
  }
  return trimmed
}

/** Normalize template kind / classify decision: approve | reject. */
export function validateTemplateKind(kind: string): 'approve' | 'reject' {
  const trimmed = kind.trim().toLowerCase()
  if (!TEMPLATE_KINDS.has(trimmed)) {
    throw new InvalidMailboxError(
      `kind must be one of: ${[...TEMPLATE_KINDS].join(', ')}`,
    )
  }
  return trimmed as 'approve' | 'reject'
}

export function validateMatchFromPattern(pattern: string): string {
  const p = pattern.trim().toLowerCase()
  if (!isValidFromPattern(p)) {
    throw new InvalidMailboxError(
      describeInvalidFromPattern(pattern, 'matchFromPattern'),
    )
  }
  return p
}

export function describeInvalidDomainFilter(raw: string): string {
  const p = raw.trim().toLowerCase()
  const prefix = `invalid domain filter "${raw}"`

  if (!p) {
    return `${prefix}: pattern is empty. ${DOMAIN_FILTER_HELP}`
  }

  if (p.includes('*')) {
    // *.shop.com / *@shop.com / *@*.shop.com → suggest shop.com
    let candidate = p.replaceAll('*', '').replace(/^@/, '').replace(/^\./, '')
    if (candidate.includes('@')) {
      candidate = candidate.slice(candidate.lastIndexOf('@') + 1)
    }
    if (isValidLiteralDomain(candidate)) {
      return (
        `${prefix}: wildcards are not allowed; use "${candidate}" ` +
        `for that domain and its subdomains. ${DOMAIN_FILTER_HELP}`
      )
    }
    return `${prefix}: wildcards are not allowed. ${DOMAIN_FILTER_HELP}`
  }

  if (!p.includes('.') && !p.includes('@')) {
    return (
      `${prefix}: must include a domain with a dot (e.g. "shop.com"). ` +
      DOMAIN_FILTER_HELP
    )
  }

  return `${prefix}. ${DOMAIN_FILTER_HELP}`
}

/**
 * Explains why a from/domain pattern failed validation, with a fix hint when
 * the mistake is recognizable (e.g. `*envio.shop.com` → `*.envio.shop.com`).
 * Used for template matchFromPattern (wildcards allowed).
 */
export function describeInvalidFromPattern(
  raw: string,
  label: string,
): string {
  const p = raw.trim().toLowerCase()
  const prefix = `invalid ${label} "${raw}"`

  if (!p) {
    return `${prefix}: pattern is empty. ${FROM_PATTERN_HELP}`
  }

  // `*envio.santander.com.mx` — wildcard missing the dot (or @).
  if (p.startsWith('*') && !p.startsWith('*.') && !p.startsWith('*@')) {
    const rest = p.slice(1)
    if (rest.includes('.') && !rest.includes('*') && isValidDomainPattern(rest)) {
      return (
        `${prefix}: use "*.${rest}" for subdomains of ${rest}, ` +
        `or "${rest}" for that domain and its subdomains. ${FROM_PATTERN_HELP}`
      )
    }
    return (
      `${prefix}: wildcard must be "*.domain.tld" or "*@domain.tld". ` +
      FROM_PATTERN_HELP
    )
  }

  // `*.com` / `*@*` — needs a multi-part domain.
  if (
    (p.startsWith('*.') && !p.slice(2).includes('.')) ||
    (p.includes('@') && p.endsWith('@*'))
  ) {
    return (
      `${prefix}: wildcard needs a multi-part domain ` +
      `(e.g. "*.shop.com"), not a bare TLD. ${FROM_PATTERN_HELP}`
    )
  }

  if (!p.includes('.') && !p.includes('@')) {
    return (
      `${prefix}: must include a domain with a dot (e.g. "shop.com"). ` +
      FROM_PATTERN_HELP
    )
  }

  return `${prefix}. ${FROM_PATTERN_HELP}`
}

export function validateSubjectRegex(
  regex: string | null | undefined,
): string | null {
  if (regex === null || regex === undefined) return null
  const trimmed = regex.trim()
  if (!trimmed) return null
  try {
    new RegExp(trimmed, 'i')
  } catch {
    throw new InvalidMailboxError('matchSubjectRegex is not a valid regexp')
  }
  return trimmed
}

export function validateCategoryId(categoryId: unknown): number {
  if (
    typeof categoryId !== 'number' ||
    !Number.isInteger(categoryId) ||
    categoryId < 1
  ) {
    throw new InvalidMailboxError(
      'categoryId is required when accepting a spending candidate',
    )
  }
  return categoryId
}

/**
 * Parse optional ISO date string for sync range. Empty/null → null.
 * Returns ISO string suitable for timestamptz columns.
 */
export function validateOptionalSyncDate(
  value: string | null | undefined,
  field: 'since' | 'until',
): string | null {
  if (value === null || value === undefined) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const ms = Date.parse(trimmed)
  if (!Number.isFinite(ms)) {
    throw new InvalidMailboxError(`${field} must be a valid ISO date`)
  }
  return new Date(ms).toISOString()
}

export function validateSyncDateRange(
  since: string | null,
  until: string | null,
): { since: string | null; until: string | null } {
  if (since && until && Date.parse(since) > Date.parse(until)) {
    throw new InvalidMailboxError('since must be less than or equal to until')
  }
  return { since, until }
}

export function clampArtifactPage(
  page?: number | null,
  pageSize?: number | null,
): { page: number; pageSize: number; offset: number } {
  const p = typeof page === 'number' && Number.isFinite(page) ? page : 1
  const size =
    typeof pageSize === 'number' && Number.isFinite(pageSize) ? pageSize : 20
  const safePage = Math.max(1, Math.floor(p))
  const safeSize = Math.min(100, Math.max(1, Math.floor(size)))
  return {
    page: safePage,
    pageSize: safeSize,
    offset: (safePage - 1) * safeSize,
  }
}
