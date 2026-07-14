import { join } from 'node:path'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import type { AssetStorage } from './types.ts'

function cwd(): string {
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    return process.cwd()
  }
  return '.'
}

function assetsRoot(): string {
  const env =
    (typeof process !== 'undefined' && process.env?.ASSETS_DIR) || null
  if (env) return env
  return join(cwd(), 'data', 'assets')
}

export class LocalFsAssetStorage implements AssetStorage {
  constructor(private readonly root: string = assetsRoot()) {}

  private fullPath(key: string): string {
    const safe = key.replace(/\.\./g, '').replace(/^\/+/, '')
    return join(this.root, safe)
  }

  async write(
    key: string,
    bytes: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    const path = this.fullPath(key)
    const dir = join(path, '..')
    await mkdir(dir, { recursive: true })
    await writeFile(path, bytes)
  }

  async read(key: string): Promise<Uint8Array | null> {
    try {
      const data = await readFile(this.fullPath(key))
      return new Uint8Array(data)
    } catch {
      return null
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.fullPath(key))
    } catch {
      // Already gone.
    }
  }

  publicUrl(_key: string): string | null {
    return null
  }
}
