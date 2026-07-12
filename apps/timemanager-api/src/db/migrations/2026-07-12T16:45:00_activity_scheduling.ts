import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // Calendar date for non-recurring activities. Recurring activities carry
  // their dates in recurrence_patterns.config (start_date/end_date) instead.
  await db.schema
    .alterTable('activities')
    .addColumn('date', 'date')
    .execute()

  // Backfill existing non-recurring activities (created before this
  // migration) so the CHECK constraint below doesn't reject real data.
  await sql`
    UPDATE activities
    SET date = created_at::date
    WHERE is_recurring = false AND date IS NULL
  `.execute(db)

  await sql`
    ALTER TABLE activities
    ADD CONSTRAINT activities_date_or_recurring
    CHECK (
      (is_recurring AND date IS NULL) OR
      (NOT is_recurring AND date IS NOT NULL)
    )
  `.execute(db)

  // Consolidate recurrence types down to the 3 supported patterns.
  await sql`
    ALTER TABLE recurrence_patterns
    DROP CONSTRAINT recurrence_patterns_recurrence_type_check
  `.execute(db)

  await sql`
    ALTER TABLE recurrence_patterns
    ADD CONSTRAINT recurrence_patterns_recurrence_type_check
    CHECK (recurrence_type in ('weekly', 'monthly', 'every_x_days'))
  `.execute(db)

  // One recurrence pattern per activity — required for the upsert
  // (onConflict on activity_id) used by updateActivity.
  await db.schema
    .dropIndex('recurrence_patterns_activity_id_index')
    .execute()

  await db.schema
    .createIndex('recurrence_patterns_activity_id_unique')
    .on('recurrence_patterns')
    .column('activity_id')
    .unique()
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('recurrence_patterns_activity_id_unique')
    .execute()

  await db.schema
    .createIndex('recurrence_patterns_activity_id_index')
    .on('recurrence_patterns')
    .column('activity_id')
    .execute()

  await sql`
    ALTER TABLE recurrence_patterns
    DROP CONSTRAINT recurrence_patterns_recurrence_type_check
  `.execute(db)

  await sql`
    ALTER TABLE recurrence_patterns
    ADD CONSTRAINT recurrence_patterns_recurrence_type_check
    CHECK (recurrence_type in ('daily', 'weekly', 'monthly', 'custom'))
  `.execute(db)

  await sql`
    ALTER TABLE activities
    DROP CONSTRAINT activities_date_or_recurring
  `.execute(db)

  await db.schema
    .alterTable('activities')
    .dropColumn('date')
    .execute()
}
