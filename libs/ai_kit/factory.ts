import { AiProviderError } from './errors.ts'
import type { AiProvider } from './provider.ts'
import { GeminiProvider } from './providers/gemini_provider.ts'
import { OpenAiCompatibleProvider } from './providers/openai_compatible_provider.ts'
import type { AiProviderKind } from './types.ts'

export type CreateAiProviderOptions = {
  kind?: string
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
}

/**
 * Build an AiProvider from env-style config.
 * - AI_PROVIDER=gemini | openai_compatible (default: gemini)
 * - Gemini: GEMINI_API_KEY, optional GEMINI_MODEL / GEMINI_BASE_URL
 * - Compatible: AI_BASE_URL, optional AI_API_KEY / AI_MODEL
 */
export function createAiProvider(
  options: CreateAiProviderOptions = {},
): AiProvider {
  const env = options.env ?? Deno.env.toObject()
  const kind = normalizeKind(options.kind ?? env.AI_PROVIDER ?? 'gemini')

  if (kind === 'gemini') {
    const apiKey = env.GEMINI_API_KEY
    if (!apiKey?.trim()) {
      throw new AiProviderError('GEMINI_API_KEY is required when AI_PROVIDER=gemini', {
        code: 'config',
        provider: 'gemini',
      })
    }
    return new GeminiProvider({
      apiKey,
      model: env.GEMINI_MODEL,
      baseUrl: env.GEMINI_BASE_URL,
      fetchImpl: options.fetchImpl,
    })
  }

  const baseUrl = env.AI_BASE_URL
  if (!baseUrl?.trim()) {
    throw new AiProviderError(
      'AI_BASE_URL is required when AI_PROVIDER=openai_compatible',
      { code: 'config', provider: 'openai_compatible' },
    )
  }
  return new OpenAiCompatibleProvider({
    baseUrl,
    apiKey: env.AI_API_KEY,
    model: env.AI_MODEL,
    fetchImpl: options.fetchImpl,
  })
}

function normalizeKind(raw: string): AiProviderKind {
  const value = raw.trim().toLowerCase()
  if (value === 'gemini') return 'gemini'
  if (
    value === 'openai_compatible' ||
    value === 'openai-compatible' ||
    value === 'openai'
  ) {
    return 'openai_compatible'
  }
  throw new AiProviderError(
    `unsupported AI_PROVIDER "${raw}" (expected gemini | openai_compatible)`,
    { code: 'config', provider: value || 'unknown' },
  )
}
