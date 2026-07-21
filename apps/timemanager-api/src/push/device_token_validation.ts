const DEVICE_PLATFORMS = new Set(['ios', 'android', 'web'])

export function validateDevicePlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase()
  if (!DEVICE_PLATFORMS.has(normalized)) {
    throw new Error('platform must be ios, android, or web')
  }
  return normalized
}

export function validateDeviceToken(token: string): string {
  const trimmed = token.trim()
  if (trimmed.length < 8 || trimmed.length > 4096) {
    throw new Error('invalid device token')
  }
  return trimmed
}
