import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('device_tokens')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('token', 'text', (col) => col.notNull().unique())
    .addColumn('platform', 'varchar(16)', (col) => col.notNull())
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('device_tokens_user_id_index')
    .on('device_tokens')
    .column('user_id')
    .execute()

  await sql`
    ALTER TABLE device_tokens
    ADD CONSTRAINT device_tokens_platform_check
    CHECK (platform IN ('ios', 'android', 'web'))
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('device_tokens').execute()
}
