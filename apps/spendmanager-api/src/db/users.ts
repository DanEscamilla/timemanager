import { db } from './database.ts'
import type { User } from './types/schema.ts'

export type AuthIdentity = {
  authUserId: string
  email?: string
  name?: string
}

/**
 * Resolve (or create) the local `users` row for a SuperTokens identity.
 */
export async function resolveLocalUser(identity: AuthIdentity): Promise<User> {
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
