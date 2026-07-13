import { Kysely, sql } from 'kysely'

/**
 * Goal start dates — every goal has a concrete starts_at.
 * Backfill from cycle 0 (fallback created_at) so existing goals keep current behavior.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('goals')
    .addColumn('starts_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    UPDATE goals g
    SET starts_at = COALESCE(
      (
        SELECT c.starts_at
        FROM goal_cycles c
        WHERE c.goal_id = g.id AND c.cycle_index = 0
        LIMIT 1
      ),
      g.created_at
    )
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('goals').dropColumn('starts_at').execute()
}
