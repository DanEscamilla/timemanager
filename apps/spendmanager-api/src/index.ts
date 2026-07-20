import { app } from '@getcronit/pylon'
import { resolvers } from './graphql/resolvers/resolvers.ts'
import {
  corsMiddleware,
  unauthorizedResponse,
  verifyAccessToken,
} from './auth/verify.ts'
import { resolveLocalUser } from './db/users.ts'

app.use(corsMiddleware)

app.use(async (ctx, next) => {
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
})

app.use(async (ctx, next) => {
  if (ctx.req.method === 'OPTIONS') {
    await next()
    return
  }

  const path = new URL(ctx.req.url).pathname

  if (path === '/health' || (path !== '/graphql' && !path.endsWith('/graphql'))) {
    await next()
    return
  }

  const verified = await verifyAccessToken(ctx.req.header('Authorization'))
  if (!verified) {
    return unauthorizedResponse()
  }

  const localUser = await resolveLocalUser({
    authUserId: verified.authUserId,
    email: verified.email,
  })

  ctx.set('authUserId', verified.authUserId)
  if (verified.email) {
    ctx.set('authEmail', verified.email)
  }
  ctx.set('userId', localUser.id)

  await next()
})

export const graphql = {
  ...resolvers,
}

export default app
