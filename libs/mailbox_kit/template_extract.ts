import { ExtractorPipeline } from './extractor.ts'
import { TemplateSpendingExtractor } from './extractors/template_spending_extractor.ts'
import {
  messageMatchesAnyTemplate,
  type TemplateMatchSpec,
} from './template_match.ts'
import type {
  EmailMessage,
  ExtractionArtifact,
  SpendParsingTemplate,
} from './types.ts'

/**
 * Classify + extract spending candidates for a message.
 *
 * Reject templates short-circuit (no artifacts). Approve templates run with
 * first-match-only. No heuristic fallback — only approve templates produce
 * review items.
 */
export function extractSpendingCandidates(
  message: EmailMessage,
  options: {
    rejectTemplates: readonly TemplateMatchSpec[]
    approveTemplates: readonly SpendParsingTemplate[]
  },
): ExtractionArtifact[] {
  if (messageMatchesAnyTemplate(message, options.rejectTemplates)) {
    return []
  }
  if (options.approveTemplates.length === 0) return []

  const pipeline = new ExtractorPipeline(
    options.approveTemplates.map((t) => new TemplateSpendingExtractor(t)),
    { firstMatchOnly: true },
  )
  return pipeline.run(message)
}
