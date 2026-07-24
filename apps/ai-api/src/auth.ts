/**
 * Internal service auth for backend callers.
 * Accepts Authorization: Bearer <key> or X-AI-Service-Key: <key>.
 */
export function extractServiceKey(headers: Headers): string | null {
  const bearer = headers.get('authorization')
  if (bearer) {
    const match = /^Bearer\s+(.+)$/i.exec(bearer.trim())
    if (match?.[1]?.trim()) return match[1].trim()
  }
  const headerKey = headers.get('x-ai-service-key')
  if (headerKey?.trim()) return headerKey.trim()
  return null
}

export function isAuthorized(
  headers: Headers,
  expectedServiceKey: string,
): boolean {
  if (!expectedServiceKey) return false
  const provided = extractServiceKey(headers)
  if (!provided) return false
  return timingSafeEqual(provided, expectedServiceKey)
}

function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder()
  const aBytes = encoder.encode(a)
  const bBytes = encoder.encode(b)
  if (aBytes.length !== bBytes.length) {
    // Still compare to reduce trivial timing leaks on length.
    let diff = aBytes.length ^ bBytes.length
    const len = Math.max(aBytes.length, bBytes.length)
    for (let i = 0; i < len; i++) {
      diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0)
    }
    return diff === 0 && aBytes.length === bBytes.length
  }
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i]! ^ bBytes[i]!
  }
  return diff === 0
}
