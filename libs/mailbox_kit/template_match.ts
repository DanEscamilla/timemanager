import { matchesFromPattern } from './domain_filter.ts'

/** Minimal template match fields (from pattern + optional subject regex). */
export type TemplateMatchSpec = {
  matchFromPattern: string
  matchSubjectRegex?: string | null
  /** When explicitly false, never matches. Undefined/true = enabled. */
  enabled?: boolean
}

/**
 * Whether a message fits a parsing template's match rules
 * (from pattern + optional subject regex). Does not require a successful extract.
 */
export function messageMatchesTemplate(
  message: { from: string; subject: string },
  template: TemplateMatchSpec,
): boolean {
  if (template.enabled === false) return false
  if (!matchesFromPattern(message.from, template.matchFromPattern)) {
    return false
  }
  const subjectRe = template.matchSubjectRegex?.trim()
  if (subjectRe) {
    try {
      if (!new RegExp(subjectRe, 'i').test(message.subject)) return false
    } catch {
      return false
    }
  }
  return true
}

/** True when any enabled template matches the message. */
export function messageMatchesAnyTemplate(
  message: { from: string; subject: string },
  templates: readonly TemplateMatchSpec[],
): boolean {
  return templates.some((t) => messageMatchesTemplate(message, t))
}
