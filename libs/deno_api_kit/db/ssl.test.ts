import {
  connectionStringWithoutSslParams,
  sslForDatabaseUrl,
} from './ssl.ts'

Deno.test('sslForDatabaseUrl local is undefined', () => {
  if (
    sslForDatabaseUrl('postgres://u:p@localhost:5432/app') !== undefined
  ) {
    throw new Error('expected undefined for localhost')
  }
})

Deno.test('sslForDatabaseUrl require enables tls', () => {
  const ssl = sslForDatabaseUrl(
    'postgres://u:p@db.example:5432/app?sslmode=require',
  )
  if (ssl == null || typeof ssl === 'boolean' || ssl.rejectUnauthorized !== false) {
    throw new Error('expected rejectUnauthorized false')
  }
})

Deno.test('connectionStringWithoutSslParams strips sslmode', () => {
  const out = connectionStringWithoutSslParams(
    'postgres://u:p@db.example:5432/tm?sslmode=require',
  )
  if (out.includes('sslmode')) {
    throw new Error('sslmode should be stripped')
  }
})
