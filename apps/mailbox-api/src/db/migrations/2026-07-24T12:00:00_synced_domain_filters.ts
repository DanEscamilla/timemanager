import { Kysely } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('mailboxes')
    .addColumn('synced_domain_filters_json', 'text')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .addColumn('sync_fetch_patterns_json', 'text')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('mailboxes')
    .dropColumn('sync_fetch_patterns_json')
    .execute()

  await db.schema
    .alterTable('mailboxes')
    .dropColumn('synced_domain_filters_json')
    .execute()
}
