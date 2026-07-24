export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type CompletionRequest = {
  /** Override the provider default model when set. */
  model?: string
  system?: string
  messages: ChatMessage[]
  temperature?: number
  /** Optional hint to nudge JSON / structured output in the prompt. */
  jsonSchemaHint?: string
}

export type CompletionResult = {
  text: string
  model: string
  /** Provider-specific raw finish reason when available. */
  finishReason?: string
}

/** Normalized model entry from provider list-models APIs. */
export type ModelInfo = {
  /** ID usable as `CompletionRequest.model` / env `AI_MODEL_*`. */
  id: string
  displayName?: string
  description?: string
  /** e.g. Gemini `supportedGenerationMethods`. */
  supportedMethods?: string[]
}

export type AiProviderKind = 'gemini' | 'openai_compatible'
