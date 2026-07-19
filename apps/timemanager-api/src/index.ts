import { app } from '@getcronit/pylon'
import { resolvers } from './graphql/resolvers/resolvers.ts'
import {
  corsMiddleware,
  unauthorizedResponse,
  verifyAccessToken,
} from './auth/verify.ts'
import { resolveLocalUser } from './db/users.ts'
import { db } from './db/database.ts'
import {
  AssetValidationError,
  createDefaultAssetRepository,
} from './assets/repository.ts'
import { MAX_ASSET_BYTES } from './assets/storage/types.ts'

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

async function resolveUserIdFromRequest(
  authorization: string | undefined,
): Promise<number | null> {
  const verified = await verifyAccessToken(authorization)
  if (!verified) return null
  const localUser = await resolveLocalUser({
    authUserId: verified.authUserId,
    email: verified.email,
  })
  return localUser.id
}

app.use(async (ctx, next) => {
  if (ctx.req.method === 'OPTIONS') {
    await next()
    return
  }

  const path = new URL(ctx.req.url).pathname

  // Asset upload / download (authenticated REST, not GraphQL).
  if (path === '/assets' && ctx.req.method === 'POST') {
    const userId = await resolveUserIdFromRequest(
      ctx.req.header('Authorization'),
    )
    if (userId == null) return unauthorizedResponse()

    try {
      const contentType =
        ctx.req.header('Content-Type')?.toLowerCase() ?? ''
      let bytes: Uint8Array
      let mime = 'application/octet-stream'
      let filename: string | undefined

      if (contentType.includes('multipart/form-data')) {
        const form = await ctx.req.formData()
        const file = form.get('file')
        if (!file || typeof file === 'string') {
          return jsonError('file field required', 400)
        }
        const blob = file as File
        mime = blob.type || 'application/octet-stream'
        filename = blob.name
        const buf = await blob.arrayBuffer()
        bytes = new Uint8Array(buf)
      } else {
        mime = contentType.split(';')[0].trim() || 'application/octet-stream'
        const buf = await ctx.req.arrayBuffer()
        bytes = new Uint8Array(buf)
      }

      if (bytes.byteLength > MAX_ASSET_BYTES) {
        return jsonError('file too large', 413)
      }

      const repo = createDefaultAssetRepository(db)
      const asset = await repo.put({
        userId,
        bytes,
        contentType: mime,
        filename,
      })

      return new Response(
        JSON.stringify({
          id: asset.id,
          sha256: asset.sha256,
          contentType: asset.content_type,
          byteSize: asset.byte_size,
          url: `/assets/${asset.id}`,
        }),
        {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      )
    } catch (err) {
      if (err instanceof AssetValidationError) {
        return jsonError(err.message, err.status)
      }
      console.error('asset upload failed', err)
      return jsonError('upload failed', 500)
    }
  }

  const assetMatch = path.match(/^\/assets\/(\d+)$/)
  if (assetMatch && ctx.req.method === 'GET') {
    const userId = await resolveUserIdFromRequest(
      ctx.req.header('Authorization'),
    )
    if (userId == null) return unauthorizedResponse()

    const assetId = Number(assetMatch[1])
    const repo = createDefaultAssetRepository(db)
    const result = await repo.readBytes(assetId, userId)
    if (!result) {
      return jsonError('not found', 404)
    }

    return new Response(result.bytes.buffer.slice(
      result.bytes.byteOffset,
      result.bytes.byteOffset + result.bytes.byteLength,
    ), {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Cache-Control': 'private, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

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

function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

export const graphql = {
  ...resolvers,
}

export default app
