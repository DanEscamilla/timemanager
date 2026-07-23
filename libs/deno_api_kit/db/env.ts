/** Read an env var from Node `process.env` or Deno (Pylon bundles run under Node). */
export function env(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name]
  }
  if (typeof Deno !== 'undefined' && typeof Deno.env?.get === 'function') {
    return Deno.env.get(name)
  }
  return undefined
}
