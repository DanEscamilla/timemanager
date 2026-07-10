import { Kysely, sql } from 'kysely'

export async function up(db: Kysely<any>): Promise<void> {
  // create database if it doesn't exist

  // Create users table
  await db.schema
    .createTable('users')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('email', 'varchar(255)', (col) => col.notNull().unique())
    .addColumn('password_hash', 'varchar(255)', (col) => col.notNull())
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  // Create activities table
  await db.schema
    .createTable('activities')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) => 
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('start_time', 'time', (col) => col.notNull())
    .addColumn('end_time', 'time', (col) => col.notNull())
    .addColumn('is_recurring', 'boolean', (col) => 
      col.notNull().defaultTo(false)
    )
    .addColumn('created_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  // Create recurrence_patterns table
  await db.schema
    .createTable('recurrence_patterns')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('activity_id', 'integer', (col) => 
      col.notNull().references('activities.id').onDelete('cascade')
    )
    .addColumn('recurrence_type', 'varchar(50)', (col) => 
      col.notNull().check(
        sql`recurrence_type in ('daily', 'weekly', 'monthly', 'custom')`
      )
    )
    .addColumn('config', 'jsonb', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  // Create activity_completions table
  await db.schema
    .createTable('activity_completions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('activity_id', 'integer', (col) => 
      col.notNull().references('activities.id').onDelete('cascade')
    )
    .addColumn('completed_at', 'timestamp', (col) => 
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('metadata', 'jsonb')
    .execute()

  // Create indexes for better query performance
  await db.schema
    .createIndex('activities_user_id_index')
    .on('activities')
    .column('user_id')
    .execute()

  await db.schema
    .createIndex('recurrence_patterns_activity_id_index')
    .on('recurrence_patterns')
    .column('activity_id')
    .execute()

  await db.schema
    .createIndex('activity_completions_activity_id_index')
    .on('activity_completions')
    .column('activity_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  // Drop tables in reverse order to handle foreign key constraints
  await db.schema.dropTable('activity_completions').execute()
  await db.schema.dropTable('recurrence_patterns').execute()
  await db.schema.dropTable('activities').execute()
  await db.schema.dropTable('users').execute()
}
