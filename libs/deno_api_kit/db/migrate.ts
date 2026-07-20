import { Pool } from 'pg'
import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  FileMigrationProvider,
  type Kysely,
  Migrator,
} from 'kysely'
import { env } from './env.ts'
import {
  connectionStringWithoutSslParams,
  sslForDatabaseUrl,
} from './ssl.ts'

/**
 * Ensure a database exists on the shared Postgres instance.
 * Fresh docker volumes may create it via init scripts; existing volumes need this.
 */
export async function ensureDatabaseExists(
  databaseName: string,
): Promise<void> {
  const databaseUrl = env('DATABASE_URL')
  let adminConfig: ConstructorParameters<typeof Pool>[0]

  if (databaseUrl) {
    const url = new URL(databaseUrl)
    url.pathname = '/postgres'
    const adminUrl = url.toString()
    const ssl = sslForDatabaseUrl(adminUrl)
    adminConfig = {
      connectionString: connectionStringWithoutSslParams(adminUrl),
      ...(ssl === undefined ? {} : { ssl }),
    }
  } else {
    adminConfig = {
      database: 'postgres',
      host: env('PGHOST') ?? 'localhost',
      user: env('PGUSER') ?? 'postgres',
      password: env('PGPASSWORD') ?? 'test1234',
      port: Number(env('PGPORT') ?? '5432'),
    }
  }

  const pool = new Pool(adminConfig)
  try {
    const exists = await pool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName],
    )
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterized; name is from env / default.
      await pool.query(
        `CREATE DATABASE "${databaseName.replaceAll('"', '')}"`,
      )
      console.log(`created database "${databaseName}"`)
    } else {
      console.log(`database "${databaseName}" already exists`)
    }
  } finally {
    await pool.end()
  }
}

export type MigrateToLatestOptions = {
  // deno-lint-ignore no-explicit-any
  db: Kysely<any>
  /** Absolute path to the migrations folder. */
  migrationFolder: string
  /**
   * When set, ensure this database exists before migrating
   * (covers shared Postgres volumes that lack the app DB).
   */
  ensureDatabase?: string
}

/** Run pending Kysely migrations and destroy the db connection. */
export async function migrateToLatest(
  options: MigrateToLatestOptions,
): Promise<void> {
  if (options.ensureDatabase) {
    await ensureDatabaseExists(options.ensureDatabase)
  }

  const migrator = new Migrator({
    db: options.db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: options.migrationFolder,
    }),
  })

  const { error, results } = await migrator.migrateToLatest()

  results?.forEach((it) => {
    if (it.status === 'Success') {
      console.log(`migration "${it.migrationName}" was executed successfully`)
    } else if (it.status === 'Error') {
      console.error(`failed to execute migration "${it.migrationName}"`)
    }
  })

  if (error) {
    console.error('failed to migrate')
    console.error(error)
    Deno.exit(1)
  }

  await options.db.destroy()
}
