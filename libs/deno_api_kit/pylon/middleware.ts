import type { Context } from '@getcronit/pylon'
import {
  unauthorizedResponse,
  verifyAccessToken,
  type VerifiedAuth,
} from '../auth/verify.ts'

/** Public ALB / load-balancer health check. */
export async function healthMiddleware(
  ctx: Context,
  next: () => Promise<void>,
) {
  const path = new URL(ctx.req.url).pathname
  if (path === '/health' && ctx.req.method === 'GET') {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }
  await next()
}

export type LocalUserRef = {
  id: number
}

export type ResolveLocalUserFn = (
  identity: VerifiedAuth,
) => Promise<LocalUserRef>

/**
 * Require a valid Bearer JWT on `/graphql` and set Pylon context vars:
 * `userId`, `authUserId`, optional `authEmail`.
 *
 * Callers that need auth for other paths (e.g. REST assets) should handle
 * those before this middleware or use `verifyAccessToken` directly.
 */
export function createGraphQLAuthMiddleware(
  resolveLocalUser: ResolveLocalUserFn,
) {
  return async function graphQLAuthMiddleware(
    ctx: Context,
    next: () => Promise<void>,
  ) {
    if (ctx.req.method === 'OPTIONS') {
      await next()
      return
    }

    const path = new URL(ctx.req.url).pathname

    if (
      path === '/health' ||
      (path !== '/graphql' && !path.endsWith('/graphql'))
    ) {
      await next()
      return
    }

    const verified = await verifyAccessToken(ctx.req.header('Authorization'))
    if (!verified) {
      return unauthorizedResponse()
    }

    const localUser = await resolveLocalUser(verified)

    ctx.set('authUserId', verified.authUserId)
    if (verified.email) {
      ctx.set('authEmail', verified.email)
    }
    ctx.set('userId', localUser.id)

    await next()
  }
}
