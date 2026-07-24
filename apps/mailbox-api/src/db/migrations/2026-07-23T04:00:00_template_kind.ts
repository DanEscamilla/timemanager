import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('parsing_templates')
    .addColumn('kind', 'text', (col) =>
      col.notNull().defaultTo('approve'),
    )
    .execute()

  await sql`
    ALTER TABLE parsing_templates
    ADD CONSTRAINT parsing_templates_kind_check
    CHECK (kind IN ('approve', 'reject'))
  `.execute(db)

  await sql`
    ALTER TABLE parsing_templates
    ALTER COLUMN extractors DROP NOT NULL
  `.execute(db)

  await sql`
    UPDATE parsing_templates SET kind = 'approve' WHERE kind IS DISTINCT FROM 'approve'
  `.execute(db)

  // Legacy heuristic candidates have no templateId — drop them from Review.
  await sql`
    UPDATE extraction_artifacts
    SET status = 'rejected', updated_at = now()
    WHERE status = 'pending'
      AND kind = 'spending.candidate'
      AND (
        payload->>'templateId' IS NULL
        OR payload->>'templateId' = ''
      )
  `.execute(db)
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    UPDATE parsing_templates
    SET extractors = '{}'::jsonb
    WHERE extractors IS NULL
  `.execute(db)

  await sql`
    ALTER TABLE parsing_templates
    ALTER COLUMN extractors SET NOT NULL
  `.execute(db)

  await sql`
    ALTER TABLE parsing_templates
    DROP CONSTRAINT IF EXISTS parsing_templates_kind_check
  `.execute(db)

  await db.schema
    .alterTable('parsing_templates')
    .dropColumn('kind')
    .execute()
}
