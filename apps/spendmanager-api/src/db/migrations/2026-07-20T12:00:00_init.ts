import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'varchar(255)')
    .addColumn('auth_user_id', 'text')
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('users_auth_user_id_unique')
    .on('users')
    .column('auth_user_id')
    .unique()
    .execute()

  await db.schema
    .createTable('categories')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('color', 'varchar(7)', (col) => col.notNull())
    .addColumn('archived_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('categories_user_id_index')
    .on('categories')
    .column('user_id')
    .execute()

  // Unique active category names per user (archived rows may reuse names).
  await sql`
    CREATE UNIQUE INDEX categories_user_id_lower_name_active_unique
    ON categories (user_id, lower(name))
    WHERE archived_at IS NULL
  `.execute(db)

  await db.schema
    .createTable('expenses')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('category_id', 'integer', (col) =>
      col.notNull().references('categories.id').onDelete('restrict')
    )
    .addColumn('amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('currency', 'char(3)', (col) =>
      col.notNull().defaultTo('USD')
    )
    .addColumn('spent_on', 'date', (col) => col.notNull())
    .addColumn('note', 'text')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('expenses_user_id_spent_on_index')
    .on('expenses')
    .columns(['user_id', 'spent_on'])
    .execute()

  await db.schema
    .createIndex('expenses_user_id_category_id_index')
    .on('expenses')
    .columns(['user_id', 'category_id'])
    .execute()

  await db.schema
    .createIndex('expenses_user_id_spent_on_category_id_index')
    .on('expenses')
    .columns(['user_id', 'spent_on', 'category_id'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('expenses').execute()
  await sql`DROP INDEX IF EXISTS categories_user_id_lower_name_active_unique`.execute(db)
  await db.schema.dropTable('categories').execute()
  await db.schema.dropTable('users').execute()
}
