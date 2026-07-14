import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE activities
    ADD COLUMN notification_offsets integer[] NOT NULL DEFAULT '{}'
  `.execute(db)

  await sql`
    ALTER TABLE activities
    ADD CONSTRAINT activities_notification_offsets_len
    CHECK (cardinality(notification_offsets) <= 8)
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    ALTER TABLE activities
    DROP CONSTRAINT activities_notification_offsets_len
  `.execute(db)

  await sql`
    ALTER TABLE activities
    DROP COLUMN notification_offsets
  `.execute(db)
}
