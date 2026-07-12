import { db } from './database.ts'

const DEV_USER = {
  email: 'dev@local.test',
  password_hash: 'dev',
  name: 'Dev User',
} as const

async function seed() {
  const existing = await db
    .selectFrom('users')
    .where('email', '=', DEV_USER.email)
    .select(['id', 'email', 'name', 'auth_user_id'])
    .executeTakeFirst()

  if (existing) {
    console.log(
      `Dev user already exists (id=${existing.id}, email=${existing.email}, auth_user_id=${existing.auth_user_id ?? 'null'})`,
    )
    console.log(
      'Local users are created/linked automatically on first SuperTokens login.',
    )
    return
  }

  const user = await db
    .insertInto('users')
    .values({
      email: DEV_USER.email,
      password_hash: DEV_USER.password_hash,
      name: DEV_USER.name,
      auth_user_id: null,
    })
    .returning(['id', 'email', 'name'])
    .executeTakeFirstOrThrow()

  console.log(`Created optional demo user (id=${user.id}, email=${user.email})`)
  console.log(
    'Sign in via SuperTokens to create/link a real user; auth_user_id is set on first GraphQL request.',
  )
}

try {
  await seed()
} finally {
  await db.destroy()
}
