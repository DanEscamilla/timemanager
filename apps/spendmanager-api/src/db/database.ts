import { Database } from './types/schema.ts'
import { createKysely } from 'deno_api_kit/db/create_kysely.ts'

export { env } from 'deno_api_kit/db/env.ts'

export const db = createKysely<Database>({
  defaultDatabase: 'spendmanager',
})
