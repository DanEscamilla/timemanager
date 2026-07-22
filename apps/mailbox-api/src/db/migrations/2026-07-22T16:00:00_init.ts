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
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('users_auth_user_id_unique')
    .on('users')
    .column('auth_user_id')
    .unique()
    .execute()

  await db.schema
    .createTable('mailboxes')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('provider', 'varchar(32)', (col) => col.notNull())
    .addColumn('label', 'varchar(255)', (col) => col.notNull())
    .addColumn('enabled', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('sync_cursor', 'text')
    .addColumn('sync_requested', 'boolean', (col) =>
      col.notNull().defaultTo(false),
    )
    .addColumn('oauth_tokens_json', 'text')
    .addColumn('last_synced_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('mailboxes_user_id_index')
    .on('mailboxes')
    .column('user_id')
    .execute()

  await db.schema
    .createTable('domain_filters')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('mailbox_id', 'integer', (col) =>
      col.notNull().references('mailboxes.id').onDelete('cascade'),
    )
    .addColumn('pattern', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('domain_filters_mailbox_id_index')
    .on('domain_filters')
    .column('mailbox_id')
    .execute()

  await sql`
    CREATE UNIQUE INDEX domain_filters_mailbox_pattern_unique
    ON domain_filters (mailbox_id, lower(pattern))
  `.execute(db)

  await db.schema
    .createTable('messages')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('mailbox_id', 'integer', (col) =>
      col.notNull().references('mailboxes.id').onDelete('cascade'),
    )
    .addColumn('provider_message_id', 'varchar(255)', (col) => col.notNull())
    .addColumn('rfc_message_id', 'varchar(512)', (col) => col.notNull())
    .addColumn('from_address', 'varchar(512)', (col) => col.notNull())
    .addColumn('subject', 'text', (col) => col.notNull())
    .addColumn('received_at', 'timestamp', (col) => col.notNull())
    .addColumn('body_hash', 'varchar(64)')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await sql`
    CREATE UNIQUE INDEX messages_mailbox_rfc_message_id_unique
    ON messages (mailbox_id, rfc_message_id)
  `.execute(db)

  await db.schema
    .createIndex('messages_mailbox_id_index')
    .on('messages')
    .column('mailbox_id')
    .execute()

  await db.schema
    .createTable('extraction_artifacts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('message_id', 'integer', (col) =>
      col.notNull().references('messages.id').onDelete('cascade'),
    )
    .addColumn('kind', 'varchar(128)', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('confidence', 'double precision', (col) => col.notNull())
    .addColumn('status', 'varchar(32)', (col) =>
      col.notNull().defaultTo('pending'),
    )
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute()

  await db.schema
    .createIndex('extraction_artifacts_message_id_index')
    .on('extraction_artifacts')
    .column('message_id')
    .execute()

  await db.schema
    .createIndex('extraction_artifacts_status_index')
    .on('extraction_artifacts')
    .column('status')
    .execute()

  await db.schema
    .createTable('sync_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('mailbox_id', 'integer', (col) =>
      col.notNull().references('mailboxes.id').onDelete('cascade'),
    )
    .addColumn('started_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('finished_at', 'timestamp')
    .addColumn('fetched_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('extracted_count', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('error_text', 'text')
    .execute()

  await db.schema
    .createIndex('sync_runs_mailbox_id_index')
    .on('sync_runs')
    .column('mailbox_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('sync_runs').execute()
  await db.schema.dropTable('extraction_artifacts').execute()
  await db.schema.dropTable('messages').execute()
  await sql`DROP INDEX IF EXISTS domain_filters_mailbox_pattern_unique`.execute(
    db,
  )
  await db.schema.dropTable('domain_filters').execute()
  await db.schema.dropTable('mailboxes').execute()
  await db.schema.dropTable('users').execute()
}
