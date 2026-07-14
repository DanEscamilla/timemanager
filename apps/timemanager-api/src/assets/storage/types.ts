/** Pure blob backend — no DB. */
export interface AssetStorage {
  write(
    key: string,
    bytes: Uint8Array,
    contentType: string,
  ): Promise<void>
  read(key: string): Promise<Uint8Array | null>
  delete(key: string): Promise<void>
  /** Optional public/signed URL for the key. */
  publicUrl?(key: string): string | null
}

export const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

export const MAX_ASSET_BYTES = 2 * 1024 * 1024 // 2 MB

export function extensionForContentType(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}
