import { createAiProvider, type AiProvider, type CompletionRequest } from 'ai_kit/mod.ts'

/**
 * Defers provider construction until the first completion so /health and
 * use-case listing work before GEMINI_API_KEY / AI_BASE_URL are configured.
 */
export class LazyAiProvider implements AiProvider {
  #inner: AiProvider | null = null
  #nameHint: string

  constructor(nameHint = Deno.env.get('AI_PROVIDER')?.trim() || 'gemini') {
    this.#nameHint = nameHint
  }

  get name(): string {
    return this.#inner?.name ?? this.#nameHint
  }

  complete(request: CompletionRequest) {
    return this.#ensure().complete(request)
  }

  #ensure(): AiProvider {
    if (!this.#inner) {
      this.#inner = createAiProvider()
    }
    return this.#inner
  }
}
