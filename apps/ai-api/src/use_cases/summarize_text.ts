import type { AiProvider } from 'ai_kit/mod.ts'
import { UseCaseInputError, type UseCase } from './types.ts'

export type SummarizeTextInput = {
  text: string
  /** Optional max sentence count hint for the model. */
  maxSentences?: number
}

export type SummarizeTextOutput = {
  summary: string
}

export const summarizeTextUseCase: UseCase<SummarizeTextInput, SummarizeTextOutput> = {
  id: 'summarize_text',
  description: 'Summarize plain text into a short paragraph',
  inputFields: [
    {
      name: 'text',
      description: 'Plain text to summarize',
      type: 'string',
      required: true,
    },
    {
      name: 'maxSentences',
      description: 'Maximum sentence count hint for the model',
      type: 'number',
      required: false,
      default: 2,
    },
  ],

  parseInput(raw: unknown): SummarizeTextInput {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new UseCaseInputError('input must be an object')
    }
    const obj = raw as Record<string, unknown>
    if (typeof obj.text !== 'string' || !obj.text.trim()) {
      throw new UseCaseInputError('input.text must be a non-empty string')
    }
    let maxSentences: number | undefined
    if (obj.maxSentences !== undefined) {
      if (
        typeof obj.maxSentences !== 'number' ||
        !Number.isInteger(obj.maxSentences) ||
        obj.maxSentences < 1
      ) {
        throw new UseCaseInputError('input.maxSentences must be a positive integer')
      }
      maxSentences = obj.maxSentences
    }
    return { text: obj.text, maxSentences }
  },

  async run(input, provider: AiProvider, options): Promise<SummarizeTextOutput> {
    const lengthHint = input.maxSentences
      ? `Use at most ${input.maxSentences} sentences.`
      : 'Keep it to 2-3 sentences.'

    const result = await provider.complete({
      model: options?.model,
      system: `You summarize text clearly and concisely. ${lengthHint} Reply with only the summary.`,
      messages: [{ role: 'user', content: input.text }],
      temperature: 0.2,
    })

    return { summary: result.text.trim() }
  },
}
