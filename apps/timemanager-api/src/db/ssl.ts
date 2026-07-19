/** TLS options for `pg` from a Postgres URL. */
export function sslForDatabaseUrl(
  databaseUrl: string,
): false | { rejectUnauthorized: boolean } | undefined {
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    return undefined
  }

  const mode = url.searchParams.get('sslmode')?.toLowerCase()
  if (mode === 'disable') return false
  if (mode === 'require' || mode === 'verify-ca' || mode === 'verify-full') {
    // RDS uses Amazon CAs; skip verify unless a CA bundle is mounted.
    return { rejectUnauthorized: false }
  }

  const host = url.hostname
  if (host === 'localhost' || host === '127.0.0.1') return undefined

  // Non-local URLs (e.g. RDS) typically require TLS even if sslmode is omitted.
  return { rejectUnauthorized: false }
}
