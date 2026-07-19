import { assertEquals } from 'jsr:@std/assert'
import { sslForDatabaseUrl } from './ssl.ts'

Deno.test('sslForDatabaseUrl: localhost leaves ssl unset', () => {
  assertEquals(
    sslForDatabaseUrl('postgres://u:p@localhost:5432/timemanager'),
    undefined,
  )
})

Deno.test('sslForDatabaseUrl: sslmode=disable disables tls', () => {
  assertEquals(
    sslForDatabaseUrl('postgres://u:p@db.example:5432/tm?sslmode=disable'),
    false,
  )
})

Deno.test('sslForDatabaseUrl: sslmode=require enables tls', () => {
  assertEquals(
    sslForDatabaseUrl('postgres://u:p@db.example:5432/tm?sslmode=require'),
    { rejectUnauthorized: false },
  )
})

Deno.test('sslForDatabaseUrl: remote host without sslmode enables tls', () => {
  assertEquals(
    sslForDatabaseUrl(
      'postgres://timemanager:secret@my-db.xxxx.us-east-1.rds.amazonaws.com:5432/timemanager',
    ),
    { rejectUnauthorized: false },
  )
})
