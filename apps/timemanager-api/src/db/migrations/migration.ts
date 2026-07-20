import { db, env } from '../database.ts'
import { migrateToLatest } from 'deno_api_kit/db/migrate.ts'

const TARGET_DB = env('PGDATABASE') ?? 'timemanager'

await migrateToLatest({
  db,
  migrationFolder: import.meta.dirname!,
  ensureDatabase: TARGET_DB,
})
