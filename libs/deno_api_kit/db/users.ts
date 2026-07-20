import type { ColumnType, Generated, Kysely, Selectable } from 'kysely'

/** Minimal users table shape required by resolveLocalUser. */
export interface UsersTable {
  id: Generated<number>
  email: string
  password_hash: string | null
  auth_user_id: string | null
  name: string
  created_at: ColumnType<Date, string | undefined, never>
  updated_at: ColumnType<Date, string, string>
}

export type UsersDatabase = {
  users: UsersTable
}

export type LocalUser = Selectable<UsersTable>

export type AuthIdentity = {
  authUserId: string
  email?: string
  name?: string
}

/**
 * Resolve (or create) the local `users` row for a SuperTokens identity.
 */
export async function resolveLocalUser<DB extends UsersDatabase>(
  db: Kysely<DB>,
  identity: AuthIdentity,
): Promise<Selectable<DB['users']>> {
  const existing = await db
    .selectFrom('users')
    .where('auth_user_id', '=', identity.authUserId)
    .selectAll()
    .executeTakeFirst()

  if (existing) {
    return existing
  }

  const email =
    identity.email?.trim() ||
    `${identity.authUserId}@users.local`
  const name =
    identity.name?.trim() ||
    email.split('@')[0] ||
    'User'

  // Prefer linking an existing email row (e.g. seeded dev user) when present.
  const byEmail = await db
    .selectFrom('users')
    .where('email', '=', email)
    .selectAll()
    .executeTakeFirst()

  if (byEmail) {
    return await db
      .updateTable('users')
      .set({
        auth_user_id: identity.authUserId,
        name: byEmail.name || name,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', byEmail.id)
      .returningAll()
      .executeTakeFirstOrThrow()
  }

  return await db
    .insertInto('users')
    .values({
      email,
      name,
      auth_user_id: identity.authUserId,
      password_hash: null,
    })
    .returningAll()
    .executeTakeFirstOrThrow()
}
