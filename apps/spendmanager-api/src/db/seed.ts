import { db } from './database.ts'

const DEV_USER = {
  email: 'dev@local.test',
  password_hash: 'dev',
  name: 'Dev User',
} as const

const SAMPLE_CATEGORIES = [
  { name: 'Groceries', color: '#0F766E' },
  { name: 'Transport', color: '#1D4ED8' },
  { name: 'Dining', color: '#B45309' },
] as const

async function seed() {
  let user = await db
    .selectFrom('users')
    .where('email', '=', DEV_USER.email)
    .selectAll()
    .executeTakeFirst()

  if (!user) {
    user = await db
      .insertInto('users')
      .values({
        email: DEV_USER.email,
        password_hash: DEV_USER.password_hash,
        name: DEV_USER.name,
        auth_user_id: null,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    console.log(`Created demo user (id=${user.id}, email=${user.email})`)
  } else {
    console.log(`Demo user already exists (id=${user.id})`)
  }

  const existingCategories = await db
    .selectFrom('categories')
    .where('user_id', '=', user.id)
    .selectAll()
    .execute()

  if (existingCategories.length > 0) {
    console.log(
      `User already has ${existingCategories.length} categories; skipping sample data.`,
    )
    console.log(
      'Sign in via SuperTokens to create/link a real user; auth_user_id is set on first GraphQL request.',
    )
    return
  }

  const now = new Date().toISOString()
  const categories = []
  for (const sample of SAMPLE_CATEGORIES) {
    const row = await db
      .insertInto('categories')
      .values({
        user_id: user.id,
        name: sample.name,
        color: sample.color,
        archived_at: null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow()
    categories.push(row)
  }

  const today = new Date().toISOString().slice(0, 10)
  await db
    .insertInto('expenses')
    .values([
      {
        user_id: user.id,
        category_id: categories[0]!.id,
        amount_cents: 4525,
        currency: 'USD',
        spent_on: today,
        note: 'Weekly groceries',
        created_at: now,
        updated_at: now,
      },
      {
        user_id: user.id,
        category_id: categories[1]!.id,
        amount_cents: 1250,
        currency: 'USD',
        spent_on: today,
        note: 'Transit pass',
        created_at: now,
        updated_at: now,
      },
    ])
    .execute()

  console.log(
    `Seeded ${categories.length} categories and 2 sample expenses for user ${user.id}`,
  )
  console.log(
    'Sign in via SuperTokens to create/link a real user; auth_user_id is set on first GraphQL request.',
  )
}

try {
  await seed()
} finally {
  await db.destroy()
}
