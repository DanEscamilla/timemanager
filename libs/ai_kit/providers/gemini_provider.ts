import { AiProviderError, mapHttpStatusToCode } from '../errors.ts'
import type { AiProvider } from '../provider.ts'
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  ModelInfo,
} from '../types.ts'

const DEFAULT_MODEL = 'gemini-2.0-flash'
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

export type GeminiProviderOptions = {
  apiKey: string
  model?: string
  baseUrl?: string
  fetchImpl?: typeof fetch
}

type GeminiPart = { text?: string }
type GeminiContent = { role?: string; parts: GeminiPart[] }

type GeminiResponse = {
  candidates?: Array<{
    content?: GeminiContent
    finishReason?: string
  }>
  error?: { message?: string; status?: string; code?: number }
}

type GeminiListModelsResponse = {
  models?: Array<{
    name?: string
    displayName?: string
    description?: string
    supportedGenerationMethods?: string[]
  }>
  nextPageToken?: string
  error?: { message?: string; status?: string; code?: number }
}

export function buildGeminiRequestBody(request: CompletionRequest): Record<string, unknown> {
  const contents = toGeminiContents(request.messages)
  const body: Record<string, unknown> = { contents }

  const systemText = composeSystemText(request)
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] }
  }

  if (request.temperature !== undefined) {
    body.generationConfig = { temperature: request.temperature }
  }

  return body
}

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini'
  readonly #apiKey: string
  readonly #model: string
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor(options: GeminiProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new AiProviderError('GEMINI_API_KEY is required', {
        code: 'config',
        provider: 'gemini',
      })
    }
    this.#apiKey = options.apiKey
    this.#model = options.model?.trim() || DEFAULT_MODEL
    this.#baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.#fetch = options.fetchImpl ?? fetch
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const model = request.model?.trim() || this.#model
    const url =
      `${this.#baseUrl}/models/${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(this.#apiKey)}`

    const response = await this.#fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeminiRequestBody(request)),
    })

    const rawText = await response.text()
    let payload: GeminiResponse = {}
    try {
      payload = rawText ? JSON.parse(rawText) as GeminiResponse : {}
    } catch {
      // keep empty payload; use rawText in error below
    }

    if (!response.ok) {
      const message = payload.error?.message ||
        rawText ||
        `Gemini request failed with status ${response.status}`
      const code = response.status === 429
        ? (message.toLowerCase().includes('quota') ? 'quota' : 'rate_limit')
        : mapHttpStatusToCode(response.status)
      throw new AiProviderError(message, {
        code,
        provider: this.name,
        status: response.status,
      })
    }

    const text = extractGeminiText(payload)
    if (!text) {
      throw new AiProviderError('Gemini returned an empty completion', {
        code: 'upstream',
        provider: this.name,
        status: response.status,
      })
    }

    return {
      text,
      model,
      finishReason: payload.candidates?.[0]?.finishReason,
    }
  }

  /** Gemini `ModelService.ListModels` (`GET /v1beta/models`). */
  async listModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = []
    let pageToken: string | undefined

    do {
      const params = new URLSearchParams({
        key: this.#apiKey,
        pageSize: '100',
      })
      if (pageToken) params.set('pageToken', pageToken)

      const url = `${this.#baseUrl}/models?${params}`
      const response = await this.#fetch(url)
      const rawText = await response.text()
      let payload: GeminiListModelsResponse = {}
      try {
        payload = rawText ? JSON.parse(rawText) as GeminiListModelsResponse : {}
      } catch {
        // keep empty payload
      }

      if (!response.ok) {
        const message = payload.error?.message ||
          rawText ||
          `Gemini ListModels failed with status ${response.status}`
        throw new AiProviderError(message, {
          code: mapHttpStatusToCode(response.status),
          provider: this.name,
          status: response.status,
        })
      }

      for (const entry of payload.models ?? []) {
        const id = normalizeGeminiModelId(entry.name)
        if (!id) continue
        const info: ModelInfo = { id }
        if (entry.displayName) info.displayName = entry.displayName
        if (entry.description) info.description = entry.description
        if (entry.supportedGenerationMethods?.length) {
          info.supportedMethods = entry.supportedGenerationMethods
        }
        models.push(info)
      }

      pageToken = payload.nextPageToken?.trim() || undefined
    } while (pageToken)

    return models
  }
}

/** Strip Gemini resource prefix (`models/gemini-2.0-flash` → `gemini-2.0-flash`). */
export function normalizeGeminiModelId(name: string | undefined): string | undefined {
  const trimmed = name?.trim()
  if (!trimmed) return undefined
  return trimmed.startsWith('models/') ? trimmed.slice('models/'.length) : trimmed
}

function composeSystemText(request: CompletionRequest): string | undefined {
  const parts: string[] = []
  if (request.system?.trim()) parts.push(request.system.trim())
  if (request.jsonSchemaHint?.trim()) {
    parts.push(
      `Respond with JSON matching this schema hint:\n${request.jsonSchemaHint.trim()}`,
    )
  }
  return parts.length > 0 ? parts.join('\n\n') : undefined
}

function toGeminiContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
}

function extractGeminiText(payload: GeminiResponse): string {
  const parts = payload.candidates?.[0]?.content?.parts ?? []
  return parts
    .map((part) => part.text ?? '')
    .join('')
    .trim()
}
