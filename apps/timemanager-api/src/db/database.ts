import { Database } from './types/schema.ts'
import { Pool, types } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import { sslForDatabaseUrl } from './ssl.ts'

// Keep Postgres `date` as `YYYY-MM-DD` strings. The default pg parser turns
// them into JS Date objects, which GraphQL then stringifies as full timestamps
// (or Date.toString()) and breaks Flutter's date-only parsing.
types.setTypeParser(types.builtins.DATE, (value: string) => value)

function env(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name]
  }
  try {
    return Deno.env.get(name)
  } catch {
    return undefined
  }
}

function poolConfigFromEnv(): ConstructorParameters<typeof Pool>[0] {
  const databaseUrl = env('DATABASE_URL')
  if (databaseUrl) {
    const ssl = sslForDatabaseUrl(databaseUrl)
    return {
      connectionString: databaseUrl,
      max: 10,
      ...(ssl === undefined ? {} : { ssl }),
    }
  }

  return {
    database: env('PGDATABASE') ?? 'timemanager',
    host: env('PGHOST') ?? 'localhost',
    user: env('PGUSER') ?? 'postgres',
    password: env('PGPASSWORD') ?? 'test1234',
    port: Number(env('PGPORT') ?? '5432'),
    max: 10,
  }
}

const dialect = new PostgresDialect({
  pool: new Pool(poolConfigFromEnv()),
})

// Database interface is passed to Kysely's constructor, and from now on,
// knows your database structure.
// Dialect is passed to Kysely's constructor, and from now on, Kysely knows how
// to communicate with your database.
export const db = new Kysely<Database>({
  dialect,
})
