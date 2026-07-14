import type { Kysely, Transaction } from 'kysely'
import type { Asset, Database, NewAsset } from '../db/types/schema.ts'
import {
  defaultImageHashingService,
  type ImageHashingService,
} from './hashing.ts'
import { createAssetStorageFromEnv } from './storage/s3.ts'
import {
  ALLOWED_IMAGE_TYPES,
  extensionForContentType,
  MAX_ASSET_BYTES,
  type AssetStorage,
} from './storage/types.ts'

export type AssetRecord = Asset

export interface AssetRepository {
  put(input: {
    userId: number
    bytes: Uint8Array
    contentType: string
    filename?: string
  }): Promise<AssetRecord>

  getMetadata(
    assetId: number,
    userId: number,
  ): Promise<AssetRecord | null>

  readBytes(
    assetId: number,
    userId: number,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null>

  release(assetId: number, userId: number): Promise<void>
  retain(assetId: number, userId: number): Promise<void>
  purgeIfOrphan(assetId: number): Promise<boolean>

  listRecent(userId: number, limit?: number): Promise<AssetRecord[]>
}

type DbLike = Kysely<Database> | Transaction<Database>

export class DbAssetRepository implements AssetRepository {
  constructor(
    private readonly db: DbLike,
    private readonly storage: AssetStorage,
    private readonly hashing: ImageHashingService = defaultImageHashingService,
  ) {}

  async put(input: {
    userId: number
    bytes: Uint8Array
    contentType: string
    filename?: string
  }): Promise<AssetRecord> {
    const contentType = input.contentType.toLowerCase().split(';')[0].trim()
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new AssetValidationError(
        `unsupported content type: ${contentType}`,
        415,
      )
    }
    if (input.bytes.byteLength === 0) {
      throw new AssetValidationError('empty file', 400)
    }
    if (input.bytes.byteLength > MAX_ASSET_BYTES) {
      throw new AssetValidationError('file too large', 413)
    }

    const sha256 = await this.hashing.sha256(input.bytes)
    const existing = await this.db
      .selectFrom('assets')
      .where('user_id', '=', input.userId)
      .where('sha256', '=', sha256)
      .selectAll()
      .executeTakeFirst()

    // Dedup hit: return existing metadata. Callers retain() on attach.
    if (existing) {
      return existing
    }

    const ext = extensionForContentType(contentType)
    const storageKey = `${input.userId}/${sha256}.${ext}`
    await this.storage.write(storageKey, input.bytes, contentType)

    // New blobs start at ref_count 0; callers retain() when attaching.
    const now = new Date().toISOString()
    try {
      return await this.db
        .insertInto('assets')
        .values({
          user_id: input.userId,
          sha256,
          content_type: contentType,
          byte_size: input.bytes.byteLength,
          storage_key: storageKey,
          ref_count: 0,
          created_at: now,
          orphaned_at: now,
        } as NewAsset)
        .returningAll()
        .executeTakeFirstOrThrow()
    } catch (err) {
      await this.storage.delete(storageKey)
      throw err
    }
  }

  async getMetadata(
    assetId: number,
    userId: number,
  ): Promise<AssetRecord | null> {
    return await this.db
      .selectFrom('assets')
      .where('id', '=', assetId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst() ?? null
  }

  async readBytes(
    assetId: number,
    userId: number,
  ): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const meta = await this.getMetadata(assetId, userId)
    if (!meta) return null
    const bytes = await this.storage.read(meta.storage_key)
    if (!bytes) return null
    return { bytes, contentType: meta.content_type }
  }

  async retain(assetId: number, userId: number): Promise<void> {
    const row = await this.getMetadata(assetId, userId)
    if (!row) throw new AssetValidationError('asset not found', 404)
    await this.db
      .updateTable('assets')
      .set({
        ref_count: row.ref_count + 1,
        orphaned_at: null,
      })
      .where('id', '=', assetId)
      .execute()
  }

  async release(assetId: number, userId: number): Promise<void> {
    const row = await this.getMetadata(assetId, userId)
    if (!row) return
    const next = Math.max(0, row.ref_count - 1)
    await this.db
      .updateTable('assets')
      .set({
        ref_count: next,
        orphaned_at: next === 0 ? new Date().toISOString() : null,
      })
      .where('id', '=', assetId)
      .execute()
    if (next === 0) {
      await this.purgeIfOrphan(assetId)
    }
  }

  async purgeIfOrphan(assetId: number): Promise<boolean> {
    const row = await this.db
      .selectFrom('assets')
      .where('id', '=', assetId)
      .selectAll()
      .executeTakeFirst()
    if (!row || row.ref_count > 0) return false
    await this.storage.delete(row.storage_key)
    await this.db.deleteFrom('assets').where('id', '=', assetId).execute()
    return true
  }

  async listRecent(userId: number, limit = 20): Promise<AssetRecord[]> {
    return await this.db
      .selectFrom('assets')
      .where('user_id', '=', userId)
      .where('ref_count', '>', 0)
      .orderBy('created_at', 'desc')
      .limit(limit)
      .selectAll()
      .execute()
  }
}

export class AssetValidationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'AssetValidationError'
  }
}

export function createDefaultAssetRepository(
  db: DbLike,
): DbAssetRepository {
  const storage = createAssetStorageFromEnv()
  return new DbAssetRepository(db, storage)
}

export function assetPublicPath(assetId: number): string {
  return `/assets/${assetId}`
}
