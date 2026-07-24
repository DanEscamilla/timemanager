import { LazyAiProvider } from './lazy_provider.ts'
import { withDevRequestLogging } from './request_log.ts'
import { createHandler } from './server.ts'

const port = Number(Deno.env.get('PORT') ?? 3004)
const serviceKey = Deno.env.get('AI_SERVICE_KEY')?.trim() ?? ''

if (!serviceKey) {
  console.error('[ai-api] AI_SERVICE_KEY is required')
  Deno.exit(1)
}

const provider = new LazyAiProvider()
const handler = withDevRequestLogging(
  createHandler({ serviceKey, provider }),
)

console.log(
  `[ai-api] listening on :${port} (provider=${provider.name})`,
)

Deno.serve({ port }, handler)
