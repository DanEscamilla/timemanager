import type { AssetStorage } from './types.ts'
import { LocalFsAssetStorage } from './local_fs.ts'

/**
 * S3-compatible asset storage (Phase 3).
 *
 * Env: ASSETS_S3_BUCKET, ASSETS_S3_REGION, ASSETS_S3_ENDPOINT,
 * AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
 */
export class S3AssetStorage implements AssetStorage {
  private readonly bucket: string
  private readonly region: string
  private readonly endpoint: string | null

  constructor(opts?: {
    bucket?: string
    region?: string
    endpoint?: string | null
  }) {
    this.bucket =
      opts?.bucket ??
      ((typeof process !== 'undefined' && process.env?.ASSETS_S3_BUCKET) ||
        '')
    this.region =
      opts?.region ??
      ((typeof process !== 'undefined' && process.env?.ASSETS_S3_REGION) ||
        'us-east-1')
    this.endpoint =
      opts?.endpoint ??
      ((typeof process !== 'undefined' && process.env?.ASSETS_S3_ENDPOINT) ||
        null)
  }

  private assertConfigured(): void {
    if (!this.bucket) {
      throw new Error(
        'S3AssetStorage is not configured (set ASSETS_S3_BUCKET)',
      )
    }
  }

  async write(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void> {
    this.assertConfigured()
    const url = this.objectUrl(key)
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    })
    if (!res.ok) {
      throw new Error(`S3 put failed: ${res.status} ${await res.text()}`)
    }
  }

  async read(key: string): Promise<Uint8Array | null> {
    this.assertConfigured()
    const res = await fetch(this.objectUrl(key))
    if (res.status === 404) return null
    if (!res.ok) {
      throw new Error(`S3 get failed: ${res.status}`)
    }
    return new Uint8Array(await res.arrayBuffer())
  }

  async delete(key: string): Promise<void> {
    this.assertConfigured()
    await fetch(this.objectUrl(key), { method: 'DELETE' })
  }

  publicUrl(key: string): string | null {
    if (!this.bucket) return null
    return this.objectUrl(key)
  }

  private objectUrl(key: string): string {
    const safe = key.replace(/^\/+/, '')
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, '')}/${this.bucket}/${safe}`
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${safe}`
  }
}

/** Pick storage backend from env: ASSETS_STORAGE=s3 | local (default). */
export function createAssetStorageFromEnv(): AssetStorage {
  const mode =
    (typeof process !== 'undefined' && process.env?.ASSETS_STORAGE) ||
    'local'
  if (mode === 's3') {
    return new S3AssetStorage()
  }
  return new LocalFsAssetStorage()
}
