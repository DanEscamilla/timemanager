import { Kysely, sql } from 'kysely'
import { resolveTextBody } from 'mailbox_kit/html_to_plain_text.ts'

/**
 * Extract plain text into text_body from stored HTML, then clear html_body.
 * Keeps the nullable html_body column for schema compatibility.
 */
export async function up(db: Kysely<any>): Promise<void> {
  const rows = await db
    .selectFrom('messages')
    .select(['id', 'text_body', 'html_body'])
    .where('html_body', 'is not', null)
    .execute()

  for (const row of rows) {
    const textBody = resolveTextBody(row.text_body, row.html_body)
    await db
      .updateTable('messages')
      .set({
        text_body: textBody,
        html_body: null,
      })
      .where('id', '=', row.id)
      .execute()
  }

  // Any leftover null-html rows that somehow still have HTML-looking text_body
  // are left as-is; worker resolveTextBody covers new inserts.
  await sql`
    UPDATE messages
    SET html_body = NULL
    WHERE html_body IS NOT NULL
  `.execute(db)
}

export async function down(_db: Kysely<any>): Promise<void> {
  // Irreversible: raw HTML was discarded after extraction.
}
