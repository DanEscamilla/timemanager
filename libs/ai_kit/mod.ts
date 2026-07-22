export type {
  AiProviderKind,
  ChatMessage,
  ChatRole,
  CompletionRequest,
  CompletionResult,
} from './types.ts'

export type { AiProvider } from './provider.ts'

export {
  AiProviderError,
  mapHttpStatusToCode,
  type AiProviderErrorCode,
} from './errors.ts'

export { createAiProvider, type CreateAiProviderOptions } from './factory.ts'

export {
  GeminiProvider,
  buildGeminiRequestBody,
  type GeminiProviderOptions,
} from './providers/gemini_provider.ts'

export {
  OpenAiCompatibleProvider,
  buildOpenAiChatBody,
  type OpenAiCompatibleProviderOptions,
} from './providers/openai_compatible_provider.ts'
