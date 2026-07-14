/** SHA-256 hex digest of raw bytes. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export interface ImageHashingService {
  sha256(bytes: Uint8Array): Promise<string>
}

export const defaultImageHashingService: ImageHashingService = {
  sha256: sha256Hex,
}
