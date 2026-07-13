import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('groups')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('color', 'varchar(7)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('groups_user_id_index')
    .on('groups')
    .column('user_id')
    .execute()

  await db.schema
    .alterTable('activities')
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('set null')
    )
    .execute()

  await db.schema
    .createIndex('activities_group_id_index')
    .on('activities')
    .column('group_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('activities_group_id_index')
    .execute()

  await db.schema
    .alterTable('activities')
    .dropColumn('group_id')
    .execute()

  await db.schema
    .dropIndex('groups_user_id_index')
    .execute()

  await db.schema
    .dropTable('groups')
    .execute()
}
