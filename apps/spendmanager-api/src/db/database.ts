import { Database } from './types/schema.ts'
import { Pool, types } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import {
  connectionStringWithoutSslParams,
  sslForDatabaseUrl,
} from './ssl.ts'

// Keep Postgres `date` as `YYYY-MM-DD` strings.
types.setTypeParser(types.builtins.DATE, (value: string) => value)

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

function poolConfigFromEnv(): ConstructorParameters<typeof Pool>[0] {
  const databaseUrl = env('DATABASE_URL')
  if (databaseUrl) {
    const ssl = sslForDatabaseUrl(databaseUrl)
    return {
      connectionString: connectionStringWithoutSslParams(databaseUrl),
      max: 10,
      ...(ssl === undefined ? {} : { ssl }),
    }
  }

  return {
    database: env('PGDATABASE') ?? 'spendmanager',
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

export const db = new Kysely<Database>({
  dialect,
})
