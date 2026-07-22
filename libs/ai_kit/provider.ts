import type { CompletionRequest, CompletionResult } from './types.ts'

/**
 * Abstract chat completion. Hosted Gemini and OpenAI-compatible self-host
 * both implement this so use cases stay provider-agnostic.
 */
export interface AiProvider {
  readonly name: string
  complete(request: CompletionRequest): Promise<CompletionResult>
}
