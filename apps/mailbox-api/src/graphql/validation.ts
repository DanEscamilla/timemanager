const PROVIDERS = new Set(['fixture', 'gmail'])
const ARTIFACT_STATUSES = new Set(['pending', 'accepted', 'rejected'])

export class InvalidMailboxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidMailboxError'
  }
}

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
      throw new InvalidMailboxError(
        `invalid domain filter pattern: ${raw}`,
      )
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
    throw new InvalidMailboxError(`invalid matchFromPattern: ${pattern}`)
  }
  return p
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
