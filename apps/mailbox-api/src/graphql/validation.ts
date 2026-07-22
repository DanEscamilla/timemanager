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

export function validateDomainPatterns(patterns: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of patterns) {
    const p = raw.trim().toLowerCase()
    if (!p) continue
    if (p.length > 255) {
      throw new InvalidMailboxError('domain filter pattern is too long')
    }
    if (!p.includes('.') && !p.includes('@')) {
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

export function validateArtifactStatus(status: string): string {
  const trimmed = status.trim().toLowerCase()
  if (!ARTIFACT_STATUSES.has(trimmed)) {
    throw new InvalidMailboxError(
      `status must be one of: ${[...ARTIFACT_STATUSES].join(', ')}`,
    )
  }
  return trimmed
}
