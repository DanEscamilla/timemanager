import { db } from './database.ts'
import { resolveLocalUser as resolveLocalUserKit } from 'deno_api_kit/db/users.ts'
import type { AuthIdentity } from 'deno_api_kit/db/users.ts'
import type { User } from './types/schema.ts'

export type { AuthIdentity }

export async function resolveLocalUser(identity: AuthIdentity): Promise<User> {
  return resolveLocalUserKit(db, identity)
}
