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
    return { rejectUnauthorized: false }
  }

  const host = url.hostname
  if (host === 'localhost' || host === '127.0.0.1') return undefined

  return { rejectUnauthorized: false }
}

/**
 * Strip SSL query params from a Postgres URL before passing it to `pg`.
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
