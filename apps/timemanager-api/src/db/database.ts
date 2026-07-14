import { Database } from './types/schema.ts'
import { Pool, types } from 'pg'
import { Kysely, PostgresDialect } from 'kysely'

// Keep Postgres `date` as `YYYY-MM-DD` strings. The default pg parser turns
// them into JS Date objects, which GraphQL then stringifies as full timestamps
// (or Date.toString()) and breaks Flutter's date-only parsing.
types.setTypeParser(types.builtins.DATE, (value: string) => value)

const dialect = new PostgresDialect({
  pool: new Pool({
    database: 'timemanager',
    host: 'localhost',
    user: 'postgres',
    password: 'test1234',
    port: 5432,
    max: 10,
  })
})

// Database interface is passed to Kysely's constructor, and from now on, Kysely 
// knows your database structure.
// Dialect is passed to Kysely's constructor, and from now on, Kysely knows how 
// to communicate with your database.
export const db = new Kysely<Database>({
  dialect,
})