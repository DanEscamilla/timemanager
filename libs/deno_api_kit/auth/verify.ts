import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Context } from '@getcronit/pylon'

const AUTH_API_DOMAIN =
  (typeof process !== 'undefined' && process.env?.AUTH_API_DOMAIN) ||
  'http://localhost:3001'
const JWKS_URL = `${AUTH_API_DOMAIN}/auth/jwt/jwks.json`

const jwks = createRemoteJWKSet(new URL(JWKS_URL))

export type VerifiedAuth = {
  authUserId: string
  email?: string
}

export async function verifyAccessToken(
  authorizationHeader: string | undefined,
): Promise<VerifiedAuth | null> {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null
  }

  const token = authorizationHeader.slice('Bearer '.length).trim()
  if (!token) {
    return null
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ['RS256'],
    })

    const authUserId = typeof payload.sub === 'string' ? payload.sub : null
    if (!authUserId) {
      return null
    }

    const email =
      typeof payload.email === 'string' ? payload.email : undefined

    return { authUserId, email }
  } catch {
    return null
  }
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers':
        'Content-Type, Authorization, st-auth-mode',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  })
}

/** CORS preflight / simple responses for browser GraphQL clients. */
export async function corsMiddleware(ctx: Context, next: () => Promise<void>) {
  if (ctx.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, st-auth-mode',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    })
  }

  await next()

  ctx.res.headers.set('Access-Control-Allow-Origin', '*')
  ctx.res.headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, st-auth-mode',
  )
  ctx.res.headers.set(
    'Access-Control-Allow-Methods',
    'GET, POST, OPTIONS',
  )
}
