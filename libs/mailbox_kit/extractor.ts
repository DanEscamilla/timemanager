import type { EmailMessage, ExtractionArtifact } from './types.ts'

/**
 * Pluggable extractor. Implementations must not depend on spendmanager types.
 */
export interface Extractor {
  readonly kind: string
  canHandle(message: EmailMessage): boolean
  extract(message: EmailMessage): ExtractionArtifact[]
}

export type ExtractorPipelineOptions = {
  /**
   * When true, stop after the first extractor that returns artifacts.
   * Used so templates win over the heuristic fallback.
   */
  firstMatchOnly?: boolean
}

export class ExtractorPipeline {
  private readonly firstMatchOnly: boolean

  constructor(
    private readonly extractors: readonly Extractor[],
    options?: ExtractorPipelineOptions,
  ) {
    this.firstMatchOnly = options?.firstMatchOnly ?? false
  }

  run(message: EmailMessage): ExtractionArtifact[] {
    const out: ExtractionArtifact[] = []
    for (const extractor of this.extractors) {
      if (!extractor.canHandle(message)) continue
      const arts = extractor.extract(message)
      if (arts.length === 0) continue
      out.push(...arts)
      if (this.firstMatchOnly) return out
    }
    return out
  }
}
