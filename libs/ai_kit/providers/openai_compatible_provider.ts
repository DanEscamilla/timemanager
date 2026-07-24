import { AiProviderError, mapHttpStatusToCode } from '../errors.ts'
import type { AiProvider } from '../provider.ts'
import type {
  CompletionRequest,
  CompletionResult,
  ModelInfo,
} from '../types.ts'

const DEFAULT_MODEL = 'llama3.2'

export type OpenAiCompatibleProviderOptions = {
  baseUrl: string
  apiKey?: string
  model?: string
  fetchImpl?: typeof fetch
}

type OpenAiChatResponse = {
  model?: string
  choices?: Array<{
    message?: { content?: string | null }
    finish_reason?: string
  }>
  error?: { message?: string; type?: string; code?: string | number }
}

type OpenAiListModelsResponse = {
  data?: Array<{ id?: string; owned_by?: string }>
  error?: { message?: string; type?: string; code?: string | number }
}

export function buildOpenAiChatBody(
  request: CompletionRequest,
  defaultModel: string,
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = []
  const systemText = composeSystemText(request)
  if (systemText) {
    messages.push({ role: 'system', content: systemText })
  }
  for (const message of request.messages) {
    messages.push({ role: message.role, content: message.content })
  }

  const body: Record<string, unknown> = {
    model: request.model?.trim() || defaultModel,
    messages,
  }
  if (request.temperature !== undefined) {
    body.temperature = request.temperature
  }
  return body
}

/**
 * OpenAI Chat Completions–compatible client (Ollama, vLLM, LocalAI, etc.).
 */
export class OpenAiCompatibleProvider implements AiProvider {
  readonly name = 'openai_compatible'
  readonly #baseUrl: string
  readonly #apiKey: string | undefined
  readonly #model: string
  readonly #fetch: typeof fetch

  constructor(options: OpenAiCompatibleProviderOptions) {
    const baseUrl = options.baseUrl.trim().replace(/\/$/, '')
    if (!baseUrl) {
      throw new AiProviderError('AI_BASE_URL is required for openai_compatible', {
        code: 'config',
        provider: 'openai_compatible',
      })
    }
    this.#baseUrl = baseUrl
    this.#apiKey = options.apiKey?.trim() || undefined
    this.#model = options.model?.trim() || DEFAULT_MODEL
    this.#fetch = options.fetchImpl ?? fetch
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const url = `${this.#baseUrl}/chat/completions`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.#apiKey) {
      headers.Authorization = `Bearer ${this.#apiKey}`
    }

    const body = buildOpenAiChatBody(request, this.#model)
    const response = await this.#fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    const rawText = await response.text()
    let payload: OpenAiChatResponse = {}
    try {
      payload = rawText ? JSON.parse(rawText) as OpenAiChatResponse : {}
    } catch {
      // keep empty payload
    }

    if (!response.ok) {
      const message = payload.error?.message ||
        rawText ||
        `OpenAI-compatible request failed with status ${response.status}`
      throw new AiProviderError(message, {
        code: mapHttpStatusToCode(response.status),
        provider: this.name,
        status: response.status,
      })
    }

    const text = payload.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) {
      throw new AiProviderError('OpenAI-compatible provider returned an empty completion', {
        code: 'upstream',
        provider: this.name,
        status: response.status,
      })
    }

    return {
      text,
      model: payload.model || String(body.model),
      finishReason: payload.choices?.[0]?.finish_reason,
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = `${this.#baseUrl}/models`
    const headers: Record<string, string> = {}
    if (this.#apiKey) {
      headers.Authorization = `Bearer ${this.#apiKey}`
    }

    const response = await this.#fetch(url, { headers })
    const rawText = await response.text()
    let payload: OpenAiListModelsResponse = {}
    try {
      payload = rawText ? JSON.parse(rawText) as OpenAiListModelsResponse : {}
    } catch {
      // keep empty payload
    }

    if (!response.ok) {
      const message = payload.error?.message ||
        rawText ||
        `OpenAI-compatible ListModels failed with status ${response.status}`
      throw new AiProviderError(message, {
        code: mapHttpStatusToCode(response.status),
        provider: this.name,
        status: response.status,
      })
    }

    const models: ModelInfo[] = []
    for (const entry of payload.data ?? []) {
      const id = entry.id?.trim()
      if (!id) continue
      const info: ModelInfo = { id }
      if (entry.owned_by) {
        info.displayName = `${id} (${entry.owned_by})`
      }
      models.push(info)
    }
    return models
  }
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
