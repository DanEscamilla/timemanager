import type { ModelInfo } from 'ai_kit/mod.ts'
import type { UseCaseSummary } from '../use_cases/registry.ts'

export type AiApiClient = {
  health(): Promise<void>
  listUseCases(): Promise<UseCaseSummary[]>
  listModels(): Promise<{ provider: string; models: ModelInfo[] }>
  runUseCase(
    id: string,
    input: Record<string, unknown>,
    options?: { model?: string },
  ): Promise<{ status: number; body: unknown }>
}

export function createAiApiClient(options: {
  baseUrl: string
  serviceKey: string
  fetchImpl?: typeof fetch
}): AiApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch

  function authHeaders(): HeadersInit {
    return {
      Authorization: `Bearer ${options.serviceKey}`,
      'Content-Type': 'application/json',
    }
  }

  return {
    async health(): Promise<void> {
      let res: Response
      try {
        res = await fetchImpl(`${baseUrl}/health`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(
          `Cannot reach ai-api at ${baseUrl} (${message}). Is \`pnpm ai\` running?`,
        )
      }
      if (!res.ok) {
        throw new Error(
          `ai-api health check failed (${res.status}). Is \`pnpm ai\` running?`,
        )
      }
    },

    async listUseCases(): Promise<UseCaseSummary[]> {
      const res = await fetchImpl(`${baseUrl}/v1/use-cases`, {
        headers: authHeaders(),
      })
      const body = await res.json() as { useCases?: UseCaseSummary[]; error?: string }
      if (!res.ok) {
        throw new Error(body.error ?? `list use cases failed (${res.status})`)
      }
      if (!Array.isArray(body.useCases)) {
        throw new Error('list use cases response missing useCases array')
      }
      return body.useCases
    },

    async listModels(): Promise<{ provider: string; models: ModelInfo[] }> {
      const res = await fetchImpl(`${baseUrl}/v1/models`, {
        headers: authHeaders(),
      })
      const body = await res.json() as {
        provider?: string
        models?: ModelInfo[]
        error?: string
      }
      if (!res.ok) {
        throw new Error(body.error ?? `list models failed (${res.status})`)
      }
      if (!Array.isArray(body.models)) {
        throw new Error('list models response missing models array')
      }
      return {
        provider: body.provider ?? 'unknown',
        models: body.models,
      }
    },

    async runUseCase(
      id: string,
      input: Record<string, unknown>,
      options?: { model?: string },
    ): Promise<{ status: number; body: unknown }> {
      const payload: { input: Record<string, unknown>; model?: string } = {
        input,
      }
      if (options?.model) {
        payload.model = options.model
      }
      const res = await fetchImpl(
        `${baseUrl}/v1/use-cases/${encodeURIComponent(id)}/run`,
        {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify(payload),
        },
      )
      let body: unknown
      try {
        body = await res.json()
      } catch {
        body = { error: `non-JSON response (${res.status})` }
      }
      return { status: res.status, body }
    },
  }
}
