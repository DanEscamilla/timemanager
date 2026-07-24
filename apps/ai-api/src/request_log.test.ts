import { assertEquals } from 'jsr:@std/assert@1'
import { withDevRequestLogging } from './request_log.ts'

function stubOk(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

function stubError(): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

Deno.test('withDevRequestLogging is a no-op when AI_ENV is unset', async () => {
  const prev = Deno.env.get('AI_ENV')
  Deno.env.delete('AI_ENV')

  const logs: unknown[][] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }

  try {
    const handler = withDevRequestLogging(async () => await stubOk())
    const res = await handler(new Request('http://localhost/health'))
    assertEquals(res.status, 200)
    assertEquals(logs.length, 0)
  } finally {
    console.log = originalLog
    if (prev === undefined) Deno.env.delete('AI_ENV')
    else Deno.env.set('AI_ENV', prev)
  }
})

Deno.test('withDevRequestLogging is a no-op when AI_ENV=production', async () => {
  const prev = Deno.env.get('AI_ENV')
  Deno.env.set('AI_ENV', 'production')

  const logs: unknown[][] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }

  try {
    const handler = withDevRequestLogging(async () => await stubOk())
    const res = await handler(new Request('http://localhost/health'))
    assertEquals(res.status, 200)
    assertEquals(logs.length, 0)
  } finally {
    console.log = originalLog
    if (prev === undefined) Deno.env.delete('AI_ENV')
    else Deno.env.set('AI_ENV', prev)
  }
})

Deno.test('withDevRequestLogging logs received and finished in development', async () => {
  const prev = Deno.env.get('AI_ENV')
  Deno.env.set('AI_ENV', 'development')

  const logs: unknown[][] = []
  const originalLog = console.log
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }

  try {
    const handler = withDevRequestLogging(async () => await stubOk())
    const res = await handler(new Request('http://localhost/v1/use-cases'))
    assertEquals(res.status, 200)
    assertEquals(logs.length, 2)
    assertEquals(
      String(logs[0]![0]),
      '[ai-api] request received GET /v1/use-cases',
    )
    assertEquals(
      String(logs[1]![0]).startsWith(
        '[ai-api] request finished GET /v1/use-cases → 200 (',
      ),
      true,
    )
  } finally {
    console.log = originalLog
    if (prev === undefined) Deno.env.delete('AI_ENV')
    else Deno.env.set('AI_ENV', prev)
  }
})

Deno.test('withDevRequestLogging logs error body when status >= 400', async () => {
  const prev = Deno.env.get('AI_ENV')
  Deno.env.set('AI_ENV', 'development')

  const logs: unknown[][] = []
  const errors: unknown[][] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...args: unknown[]) => {
    logs.push(args)
  }
  console.error = (...args: unknown[]) => {
    errors.push(args)
  }

  try {
    const handler = withDevRequestLogging(async () => await stubError())
    const res = await handler(new Request('http://localhost/v1/use-cases'))
    assertEquals(res.status, 401)
    // Response body still readable by caller after clone+log
    assertEquals(await res.json(), { error: 'unauthorized' })
    assertEquals(logs.length, 2)
    assertEquals(errors.length, 1)
    assertEquals(
      String(errors[0]![0]),
      '[ai-api] error returned GET /v1/use-cases status=401',
    )
    assertEquals(errors[0]![1], { error: 'unauthorized' })
  } finally {
    console.log = originalLog
    console.error = originalError
    if (prev === undefined) Deno.env.delete('AI_ENV')
    else Deno.env.set('AI_ENV', prev)
  }
})
