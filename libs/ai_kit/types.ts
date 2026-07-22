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

export type AiProviderKind = 'gemini' | 'openai_compatible'
