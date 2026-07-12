import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('users')
    .addColumn('auth_user_id', 'text')
    .execute()

  await db.schema
    .createIndex('users_auth_user_id_unique')
    .on('users')
    .column('auth_user_id')
    .unique()
    .execute()

  // OAuth-only users have no local password.
  await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE users SET password_hash = '' WHERE password_hash IS NULL
  `.execute(db)
  await sql`ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL`.execute(db)

  await db.schema.dropIndex('users_auth_user_id_unique').execute()
  await db.schema.alterTable('users').dropColumn('auth_user_id').execute()
}
