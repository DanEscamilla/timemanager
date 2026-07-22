import type { AiProvider } from 'ai_kit/mod.ts'

export type UseCase<TIn, TOut> = {
  id: string
  description: string
  parseInput(raw: unknown): TIn
  run(input: TIn, provider: AiProvider): Promise<TOut>
}

export class UseCaseInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UseCaseInputError'
  }
}
