import type { UseCaseInputField } from '../use_cases/types.ts'
import { parseTypedValue } from './prompt.ts'

export type FieldAnswer = string | null

/**
 * Build a use-case input object from field metadata and raw string answers.
 * - required blank → throws
 * - optional blank → omit field when no default; otherwise apply default
 */
export function buildInputFromAnswers(
  fields: UseCaseInputField[],
  answers: FieldAnswer[],
): Record<string, unknown> {
  if (answers.length !== fields.length) {
    throw new Error(
      `expected ${fields.length} answers, got ${answers.length}`,
    )
  }

  const input: Record<string, unknown> = {}

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!
    const answer = answers[i]
    const trimmed = answer?.trim() ?? ''

    if (trimmed === '') {
      if (field.required) {
        throw new Error(`field "${field.name}" is required`)
      }
      if (field.default !== undefined) {
        input[field.name] = field.default
      }
      continue
    }

    try {
      input[field.name] = parseTypedValue(trimmed, field.type)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`field "${field.name}": ${message}`)
    }
  }

  return input
}

export function fieldPromptLabel(field: UseCaseInputField): string {
  const parts = [field.name, `(${field.type})`]
  if (field.description) parts.push(`— ${field.description}`)
  if (!field.required && field.default !== undefined) {
    parts.push(`[default: ${String(field.default)}]`)
  } else if (!field.required) {
    parts.push('[optional]')
  }
  return parts.join(' ')
}
