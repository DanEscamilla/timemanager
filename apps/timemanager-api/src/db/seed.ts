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
    .select(['id', 'email', 'name'])
    .executeTakeFirst()

  if (existing) {
    console.log(`Dev user already exists (id=${existing.id}, email=${existing.email})`)
    return
  }

  const user = await db
    .insertInto('users')
    .values({
      email: DEV_USER.email,
      password_hash: DEV_USER.password_hash,
      name: DEV_USER.name,
    })
    .returning(['id', 'email', 'name'])
    .executeTakeFirstOrThrow()

  console.log(`Created dev user (id=${user.id}, email=${user.email})`)
  console.log('Flutter app uses ApiConfig.defaultUserId = 1 — ensure this user has id 1.')
}

try {
  await seed()
} finally {
  await db.destroy()
}
