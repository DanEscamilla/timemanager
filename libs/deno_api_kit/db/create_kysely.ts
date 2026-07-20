import { Pool, types } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'
import { env } from './env.ts'
import {
  connectionStringWithoutSslParams,
  sslForDatabaseUrl,
} from './ssl.ts'

// Keep Postgres `date` as `YYYY-MM-DD` strings. The default pg parser turns
// them into JS Date objects, which GraphQL then stringifies as full timestamps
// and breaks Flutter's date-only parsing.
types.setTypeParser(types.builtins.DATE, (value: string) => value)

export type CreateKyselyOptions = {
  /** Fallback when `PGDATABASE` / `DATABASE_URL` are unset. */
  defaultDatabase: string
}

function poolConfigFromEnv(
  defaultDatabase: string,
): ConstructorParameters<typeof Pool>[0] {
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
    database: env('PGDATABASE') ?? defaultDatabase,
    host: env('PGHOST') ?? 'localhost',
    user: env('PGUSER') ?? 'postgres',
    password: env('PGPASSWORD') ?? 'test1234',
    port: Number(env('PGPORT') ?? '5432'),
    max: 10,
  }
}

/** Create a Kysely instance for the given schema type and default DB name. */
export function createKysely<DB>(options: CreateKyselyOptions): Kysely<DB> {
  const dialect = new PostgresDialect({
    pool: new Pool(poolConfigFromEnv(options.defaultDatabase)),
  })
  return new Kysely<DB>({ dialect })
}
