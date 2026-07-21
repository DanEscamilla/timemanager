import {
  assertEquals,
  assertThrows,
} from 'https://deno.land/std@0.224.0/assert/mod.ts'
import {
  validateDevicePlatform,
  validateDeviceToken,
} from './device_token_validation.ts'

Deno.test('validateDevicePlatform accepts ios/android/web', () => {
  assertEquals(validateDevicePlatform('iOS'), 'ios')
  assertEquals(validateDevicePlatform(' Android '), 'android')
  assertEquals(validateDevicePlatform('web'), 'web')
})

Deno.test('validateDevicePlatform rejects unknown platforms', () => {
  assertThrows(
    () => validateDevicePlatform('desktop'),
    Error,
    'platform must be ios, android, or web',
  )
})

Deno.test('validateDeviceToken trims and accepts length bounds', () => {
  assertEquals(validateDeviceToken('  abcdefgh  '), 'abcdefgh')
})

Deno.test('validateDeviceToken rejects too short or too long', () => {
  assertThrows(() => validateDeviceToken('short'), Error, 'invalid device token')
  assertThrows(
    () => validateDeviceToken('x'.repeat(4097)),
    Error,
    'invalid device token',
  )
})
