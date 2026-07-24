import { isDevelopment } from './env.ts'

type RequestHandler = (req: Request) => Promise<Response>

export function withDevRequestLogging(handler: RequestHandler): RequestHandler {
  if (!isDevelopment()) return handler

  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const path = url.pathname
    const started = performance.now()
    console.log(`[ai-api] request received ${req.method} ${path}`)

    try {
      const res = await handler(req)
      const ms = Math.round(performance.now() - started)
      console.log(
        `[ai-api] request finished ${req.method} ${path} → ${res.status} (${ms}ms)`,
      )

      if (res.status >= 400) {
        await logErrorBody(req.method, path, res)
      }

      return res
    } catch (err) {
      console.error(`[ai-api] request threw ${req.method} ${path}`, err)
      throw err
    }
  }
}

async function logErrorBody(
  method: string,
  path: string,
  res: Response,
): Promise<void> {
  try {
    const body: unknown = await res.clone().json()
    console.error(
      `[ai-api] error returned ${method} ${path} status=${res.status}`,
      body,
    )
  } catch {
    console.error(
      `[ai-api] error returned ${method} ${path} status=${res.status}`,
    )
  }
}
