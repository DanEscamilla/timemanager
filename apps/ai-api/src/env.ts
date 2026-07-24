export function isDevelopment(): boolean {
  const v = Deno.env.get('AI_ENV')?.trim().toLowerCase()
  return v === 'development' || v === 'dev'
}
