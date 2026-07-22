import { summarizeTextUseCase } from './summarize_text.ts'
import type { UseCase, UseCaseInputField } from './types.ts'

/** Register new use cases here — one import + one map entry. */
// deno-lint-ignore no-explicit-any
const useCases: UseCase<any, any>[] = [
  summarizeTextUseCase,
]

const byId = new Map(useCases.map((uc) => [uc.id, uc]))

export type UseCaseSummary = {
  id: string
  description: string
  inputFields: UseCaseInputField[]
}

export function listUseCases(): UseCaseSummary[] {
  return useCases.map((uc) => ({
    id: uc.id,
    description: uc.description,
    inputFields: uc.inputFields,
  }))
}

export function getUseCase(id: string): UseCase<unknown, unknown> | undefined {
  return byId.get(id)
}
