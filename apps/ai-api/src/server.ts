import {
  AiProviderError,
  type AiProvider,
} from 'ai_kit/mod.ts'
import { isAuthorized } from './auth.ts'
import { resolveModelForTier } from './model_tiers.ts'
import { getUseCase, listUseCases } from './use_cases/registry.ts'
import { UseCaseInputError } from './use_cases/types.ts'

export type AiApiDeps = {
  serviceKey: string
  provider: AiProvider
  /** Override env for model-tier resolution (tests). Defaults to Deno.env. */
  env?: Record<string, string | undefined>
}

export function createHandler(deps: AiApiDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    if (req.method === 'GET' && path === '/health') {
      return json({ ok: true })
    }

    if (!isAuthorized(req.headers, deps.serviceKey)) {
      return json({ error: 'unauthorized' }, 401)
    }

    if (req.method === 'GET' && path === '/v1/use-cases') {
      return json({ useCases: listUseCases() })
    }

    if (req.method === 'GET' && path === '/v1/models') {
      return await handleListModels(deps)
    }

    const runMatch = /^\/v1\/use-cases\/([^/]+)\/run$/.exec(path)
    if (req.method === 'POST' && runMatch) {
      const id = decodeURIComponent(runMatch[1]!)
      return await handleRun(id, req, deps)
    }

    return json({ error: 'not found' }, 404)
  }
}

async function handleListModels(deps: AiApiDeps): Promise<Response> {
  try {
    const models = await deps.provider.listModels()
    return json({ provider: deps.provider.name, models })
  } catch (err) {
    if (err instanceof AiProviderError) {
      const status = statusForProviderError(err)
      return json(
        {
          error: err.message,
          code: err.code,
          provider: err.provider,
        },
        status,
      )
    }
    console.error('[ai-api] list models failed', err)
    return json({ error: 'internal error' }, 500)
  }
}

async function handleRun(
  id: string,
  req: Request,
  deps: AiApiDeps,
): Promise<Response> {
  const useCase = getUseCase(id)
  if (!useCase) {
    return json({ error: `unknown use case: ${id}` }, 404)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'request body must be JSON' }, 400)
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'request body must be an object' }, 400)
  }

  const { input, model: modelRaw } = body as {
    input?: unknown
    model?: unknown
  }

  let model: string | undefined
  if (modelRaw !== undefined) {
    if (typeof modelRaw !== 'string' || !modelRaw.trim()) {
      return json({ error: 'model must be a non-empty string when provided' }, 400)
    }
    model = modelRaw.trim()
  } else {
    model = resolveModelForTier(
      useCase.modelTier,
      deps.env ?? Deno.env.toObject(),
    )
  }

  try {
    const parsed = useCase.parseInput(input)
    const output = await useCase.run(parsed, deps.provider, { model })
    return json({ output })
  } catch (err) {
    if (err instanceof UseCaseInputError) {
      return json({ error: err.message }, 400)
    }
    if (err instanceof AiProviderError) {
      const status = statusForProviderError(err)
      return json(
        {
          error: err.message,
          code: err.code,
          provider: err.provider,
        },
        status,
      )
    }
    console.error('[ai-api] use case failed', err)
    return json({ error: 'internal error' }, 500)
  }
}

function statusForProviderError(err: AiProviderError): number {
  switch (err.code) {
    case 'auth':
      return 502
    case 'rate_limit':
    case 'quota':
      return 429
    case 'bad_request':
      return 400
    case 'config':
      return 500
    default:
      return err.status && err.status >= 400 && err.status < 600
        ? err.status
        : 502
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
