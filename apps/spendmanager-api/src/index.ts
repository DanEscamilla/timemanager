import { app } from '@getcronit/pylon'
import { createPushSenderFromEnv } from 'deno_api_kit/push/mod.ts'
import { setPushSender } from './budgets/alert_push.ts'
import { resolvers } from './graphql/resolvers/resolvers.ts'
import { corsMiddleware } from 'deno_api_kit/auth/verify.ts'
import {
  createGraphQLAuthMiddleware,
  healthMiddleware,
} from 'deno_api_kit/pylon/middleware.ts'
import { resolveLocalUser } from './db/users.ts'

const pushSender = await createPushSenderFromEnv()
setPushSender(pushSender)

app.use(corsMiddleware)
app.use(healthMiddleware)
app.use(createGraphQLAuthMiddleware(resolveLocalUser))

export const graphql = {
  ...resolvers,
}

export default app
