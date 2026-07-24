import type { AiProvider } from 'ai_kit/mod.ts'
import type { ModelTier } from '../model_tiers.ts'

export type UseCaseInputField = {
  name: string
  description: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  default?: string | number | boolean
}

/** Cross-cutting options for a use-case run (not part of use-case input). */
export type UseCaseRunOptions = {
  /** Override the provider default model for this request. */
  model?: string
}

export type UseCase<TIn, TOut> = {
  id: string
  description: string
  /** Which env model tier to use when the request omits `model`. */
  modelTier: ModelTier
  inputFields: UseCaseInputField[]
  parseInput(raw: unknown): TIn
  run(
    input: TIn,
    provider: AiProvider,
    options?: UseCaseRunOptions,
  ): Promise<TOut>
}

export class UseCaseInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UseCaseInputError'
  }
}
