import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('mailboxes')
    .addColumn('sync_since', 'timestamptz')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .addColumn('sync_until', 'timestamptz')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .addColumn('sync_backfill_cursor', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('mailboxes')
    .dropColumn('sync_backfill_cursor')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .dropColumn('sync_until')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .dropColumn('sync_since')
    .execute()
}
