import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('budgets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('category_id', 'integer', (col) =>
      col.references('categories.id').onDelete('restrict')
    )
    .addColumn('amount_cents', 'bigint', (col) => col.notNull())
    .addColumn('currency', 'char(3)', (col) =>
      col.notNull().defaultTo('USD')
    )
    .addColumn('interval_unit', 'varchar(16)', (col) => col.notNull())
    .addColumn('interval_count', 'integer', (col) => col.notNull())
    .addColumn('anchor_date', 'date', (col) => col.notNull())
    .addColumn('alert_percent', 'integer', (col) => col.notNull())
    .addColumn('archived_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('budgets_user_id_index')
    .on('budgets')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('budgets_user_id_category_id_index')
    .on('budgets')
    .columns(['user_id', 'category_id'])
    .execute()

  await sql`
    ALTER TABLE budgets
    ADD CONSTRAINT budgets_interval_unit_check
    CHECK (interval_unit IN ('day', 'week', 'month'))
  `.execute(db)

  await sql`
    ALTER TABLE budgets
    ADD CONSTRAINT budgets_interval_count_check
    CHECK (interval_count >= 1)
  `.execute(db)

  await sql`
    ALTER TABLE budgets
    ADD CONSTRAINT budgets_alert_percent_check
    CHECK (alert_percent >= 1 AND alert_percent <= 100)
  `.execute(db)

  await sql`
    ALTER TABLE budgets
    ADD CONSTRAINT budgets_amount_cents_check
    CHECK (amount_cents > 0)
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('budgets').execute()
}
