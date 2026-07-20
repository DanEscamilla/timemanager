import { Pool } from 'pg'
import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  Migrator,
  FileMigrationProvider,
} from 'kysely'
import { db, env } from '../database.ts'
import {
  connectionStringWithoutSslParams,
  sslForDatabaseUrl,
} from '../ssl.ts'

const TARGET_DB = env('PGDATABASE') ?? 'spendmanager'

/**
 * Ensure the spendmanager database exists on the shared Postgres instance.
 * Fresh docker volumes get it from init/02-spendmanager.sql; existing volumes
 * need this bootstrap.
 */
async function ensureDatabaseExists(): Promise<void> {
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
      [TARGET_DB],
    )
    if (exists.rowCount === 0) {
      // Identifier cannot be parameterized; TARGET_DB is from env / default.
      await pool.query(`CREATE DATABASE "${TARGET_DB.replaceAll('"', '')}"`)
      console.log(`created database "${TARGET_DB}"`)
    } else {
      console.log(`database "${TARGET_DB}" already exists`)
    }
  } finally {
    await pool.end()
  }
}

async function migrateToLatest() {
  await ensureDatabaseExists()

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: import.meta.dirname!,
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

  await db.destroy()
}

migrateToLatest()
