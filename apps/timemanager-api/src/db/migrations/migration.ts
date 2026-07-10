import * as path from 'node:path'
import { promises as fs } from 'node:fs'
import {
  Migrator,
  FileMigrationProvider,
} from 'kysely'
import { db } from '../database.ts'

async function migrateToLatest() {
  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      // This needs to be an absolute path.
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