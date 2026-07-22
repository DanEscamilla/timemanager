import { db } from './database.ts'

const DEV_USER = {
  email: 'dev@local.test',
  password_hash: 'dev',
  name: 'Dev User',
} as const

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

  const existing = await db
    .selectFrom('mailboxes')
    .where('user_id', '=', user.id)
    .where('provider', '=', 'fixture')
    .selectAll()
    .executeTakeFirst()

  if (existing) {
    console.log(
      `Fixture mailbox already exists (id=${existing.id}); skipping sample data.`,
    )
    return
  }

  const now = new Date().toISOString()
  const mailbox = await db
    .insertInto('mailboxes')
    .values({
      user_id: user.id,
      provider: 'fixture',
      label: 'Demo fixture inbox',
      enabled: true,
      sync_cursor: null,
      sync_requested: true,
      oauth_tokens_json: null,
      last_synced_at: null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow()

  await db
    .insertInto('domain_filters')
    .values([
      {
        mailbox_id: mailbox.id,
        pattern: 'amazon.com',
        created_at: now,
      },
      {
        mailbox_id: mailbox.id,
        pattern: 'uber.com',
        created_at: now,
      },
    ])
    .execute()

  console.log(
    `Seeded fixture mailbox id=${mailbox.id} with domain filters amazon.com, uber.com`,
  )
  console.log(
    'Run mailbox-worker to sync; sign in via SuperTokens to link auth_user_id on first GraphQL request.',
  )
}

try {
  await seed()
} finally {
  await db.destroy()
}
