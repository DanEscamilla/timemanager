import { app } from '@getcronit/pylon'
import { resolvers } from './graphql/resolvers/resolvers.ts'
import { corsMiddleware } from 'deno_api_kit/auth/verify.ts'
import {
  createGraphQLAuthMiddleware,
  healthMiddleware,
} from 'deno_api_kit/pylon/middleware.ts'
import { resolveLocalUser } from './db/users.ts'
import { db } from './db/database.ts'
import { handleGmailOAuthCallback } from './services/gmail_oauth_callback.ts'

app.use(corsMiddleware)
app.use(healthMiddleware)

/** Public Google OAuth redirect (auth is signed `state`). */
app.use(async (ctx, next) => {
  if (ctx.req.method === 'OPTIONS') {
    await next()
    return
  }

  const url = new URL(ctx.req.url)
  if (url.pathname === '/oauth/gmail/callback' && ctx.req.method === 'GET') {
    return handleGmailOAuthCallback(url, { db })
  }

  await next()
})

app.use(createGraphQLAuthMiddleware(resolveLocalUser))

export const graphql = {
  ...resolvers,
}

export default app
