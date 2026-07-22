import type { EmailMessage, ExtractionArtifact } from './types.ts'

/**
 * Pluggable extractor. Implementations must not depend on spendmanager types.
 */
export interface Extractor {
  readonly kind: string
  canHandle(message: EmailMessage): boolean
  extract(message: EmailMessage): ExtractionArtifact[]
}

export class ExtractorPipeline {
  constructor(private readonly extractors: readonly Extractor[]) {}

  run(message: EmailMessage): ExtractionArtifact[] {
    const out: ExtractionArtifact[] = []
    for (const extractor of this.extractors) {
      if (!extractor.canHandle(message)) continue
      out.push(...extractor.extract(message))
    }
    return out
  }
}
