import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('messages')
    .addColumn('text_body', 'text')
    .execute()

  await db.schema
    .alterTable('messages')
    .addColumn('html_body', 'text')
    .execute()

  await db.schema
    .alterTable('extraction_artifacts')
    .addColumn('published_expense_id', 'integer')
    .execute()

  await db.schema
    .createTable('parsing_templates')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('mailbox_id', 'integer', (col) =>
      col.notNull().references('mailboxes.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('match_from_pattern', 'varchar(255)', (col) => col.notNull())
    .addColumn('match_subject_regex', 'text')
    .addColumn('extractors', 'jsonb', (col) => col.notNull())
    .addColumn('source_message_id', 'integer', (col) =>
      col.references('messages.id').onDelete('set null'),
    )
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('parsing_templates_mailbox_id_index')
    .on('parsing_templates')
    .column('mailbox_id')
    .execute()

  await db.schema
    .createIndex('parsing_templates_user_id_index')
    .on('parsing_templates')
    .column('user_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('parsing_templates').execute()
  await db.schema
    .alterTable('extraction_artifacts')
    .dropColumn('published_expense_id')
    .execute()
  await db.schema.alterTable('messages').dropColumn('html_body').execute()
  await db.schema.alterTable('messages').dropColumn('text_body').execute()
}
