import { ServiceError } from '@getcronit/pylon'

const PROVIDERS = new Set(['fixture', 'gmail'])
const ARTIFACT_STATUSES = new Set(['pending', 'accepted', 'rejected'])

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
 * Allowed patterns:
 * - `user@shop.com`, `*@shop.com`, `*@*.shop.com`
 * - `shop.com`, `*.shop.com`
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
    if (!isValidFromPattern(p)) {
      throw new InvalidMailboxError(describeInvalidFromPattern(raw, 'domain filter'))
    }
    if (seen.has(p)) continue
    seen.add(p)
    out.push(p)
  }
  return out
}

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
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(rest)
  }
  if (domain.includes('*')) return false
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
    .test(domain)
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

export function validateMatchFromPattern(pattern: string): string {
  const p = pattern.trim().toLowerCase()
  if (!isValidFromPattern(p)) {
    throw new InvalidMailboxError(
      describeInvalidFromPattern(pattern, 'matchFromPattern'),
    )
  }
  return p
}

/**
 * Explains why a from/domain pattern failed validation, with a fix hint when
 * the mistake is recognizable (e.g. `*envio.shop.com` → `*.envio.shop.com`).
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
