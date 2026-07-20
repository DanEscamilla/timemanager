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

/**
 * Strip SSL query params from a Postgres URL before passing it to `pg`.
 *
 * `pg` does `Object.assign({}, config, parse(connectionString))`, so
 * `sslmode=require` overwrites an explicit `ssl: { rejectUnauthorized: false }`
 * with `ssl: {}` (Node/Deno default = verify on) → SELF_SIGNED_CERT_IN_CHAIN.
 */
export function connectionStringWithoutSslParams(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl)
    for (const key of [
      'sslmode',
      'ssl',
      'sslrootcert',
      'sslcert',
      'sslkey',
    ]) {
      url.searchParams.delete(key)
    }
    return url.toString()
  } catch {
    return databaseUrl
  }
}
