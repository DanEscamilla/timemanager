/** Read an env var from Node `process.env` or Deno. */
export function env(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name]
  }
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}
