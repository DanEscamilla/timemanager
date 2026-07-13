import { Kysely, sql } from 'kysely'

/**
 * Phase 0 — Capture foundation.
 * Extends activity_completions for user-scoped, occurrence-aware tracking
 * and adds goal_events as the append-only progress feed for Goals.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('activity_completions')
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade')
    )
    .execute()

  await db.schema
    .alterTable('activity_completions')
    .addColumn('occurrence_date', 'date')
    .execute()

  await db.schema
    .alterTable('activity_completions')
    .addColumn('duration_minutes', 'integer')
    .execute()

  // Backfill user_id + occurrence_date from the parent activity.
  await sql`
    UPDATE activity_completions AS ac
    SET
      user_id = a.user_id,
      occurrence_date = COALESCE(
        a.date,
        (ac.completed_at AT TIME ZONE 'UTC')::date
      ),
      duration_minutes = CASE
        WHEN ac.metadata ? 'duration'
          THEN (ac.metadata->>'duration')::integer
        ELSE NULL
      END
    FROM activities AS a
    WHERE ac.activity_id = a.id
  `.execute(db)

  // Any orphaned rows (activity already gone) get removed.
  await sql`
    DELETE FROM activity_completions WHERE user_id IS NULL
  `.execute(db)

  await sql`
    ALTER TABLE activity_completions
    ALTER COLUMN user_id SET NOT NULL
  `.execute(db)

  await sql`
    ALTER TABLE activity_completions
    ALTER COLUMN occurrence_date SET NOT NULL
  `.execute(db)

  await db.schema
    .createIndex('activity_completions_user_id_completed_at_index')
    .on('activity_completions')
    .columns(['user_id', 'completed_at'])
    .execute()

  await db.schema
    .createIndex('activity_completions_activity_occurrence_unique')
    .unique()
    .on('activity_completions')
    .columns(['activity_id', 'occurrence_date'])
    .execute()

  await db.schema
    .createTable('goal_events')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('source_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('activity_id', 'integer', (col) =>
      col.references('activities.id').onDelete('set null')
    )
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('set null')
    )
    .addColumn('completion_id', 'integer', (col) =>
      col.references('activity_completions.id').onDelete('set null')
    )
    .addColumn('occurred_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('occurrence_date', 'date')
    .addColumn('metric', 'varchar(50)', (col) => col.notNull())
    .addColumn('amount', 'numeric', (col) => col.notNull())
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE goal_events
    ADD CONSTRAINT goal_events_source_type_check
    CHECK (source_type IN ('completion', 'time_log', 'manual'))
  `.execute(db)

  await sql`
    ALTER TABLE goal_events
    ADD CONSTRAINT goal_events_metric_check
    CHECK (metric IN ('count', 'duration'))
  `.execute(db)

  await db.schema
    .createIndex('goal_events_user_id_occurred_at_index')
    .on('goal_events')
    .columns(['user_id', 'occurred_at'])
    .execute()

  await db.schema
    .createIndex('goal_events_activity_id_index')
    .on('goal_events')
    .column('activity_id')
    .execute()

  await db.schema
    .createIndex('goal_events_group_id_index')
    .on('goal_events')
    .column('group_id')
    .execute()

  await db.schema
    .createIndex('goal_events_completion_id_index')
    .on('goal_events')
    .column('completion_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('goal_events').execute()

  await db.schema
    .dropIndex('activity_completions_activity_occurrence_unique')
    .execute()
  await db.schema
    .dropIndex('activity_completions_user_id_completed_at_index')
    .execute()

  await db.schema
    .alterTable('activity_completions')
    .dropColumn('duration_minutes')
    .execute()
  await db.schema
    .alterTable('activity_completions')
    .dropColumn('occurrence_date')
    .execute()
  await db.schema
    .alterTable('activity_completions')
    .dropColumn('user_id')
    .execute()
}
