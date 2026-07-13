import { Kysely, sql } from 'kysely'

/**
 * Phase 1–4 — Goals core tables: goals, links, cycles, dependencies, snapshots.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('goals')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('color', 'varchar(7)', (col) => col.notNull())
    .addColumn('icon', 'varchar(64)')
    .addColumn('rule_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('metric', 'varchar(50)', (col) => col.notNull())
    .addColumn('target_value', 'numeric', (col) => col.notNull())
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .addColumn('status', 'varchar(50)', (col) =>
      col.notNull().defaultTo('active')
    )
    .addColumn('recurrence', 'jsonb')
    .addColumn('deadline', 'jsonb')
    .addColumn('priority', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE goals
    ADD CONSTRAINT goals_metric_check
    CHECK (metric IN ('count', 'duration'))
  `.execute(db)

  await sql`
    ALTER TABLE goals
    ADD CONSTRAINT goals_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'archived', 'failed'))
  `.execute(db)

  await db.schema
    .createIndex('goals_user_id_status_index')
    .on('goals')
    .columns(['user_id', 'status'])
    .execute()

  await db.schema
    .createTable('goal_links')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('goal_id', 'integer', (col) =>
      col.notNull().references('goals.id').onDelete('cascade')
    )
    .addColumn('link_type', 'varchar(50)', (col) => col.notNull())
    .addColumn('activity_id', 'integer', (col) =>
      col.references('activities.id').onDelete('set null')
    )
    .addColumn('group_id', 'integer', (col) =>
      col.references('groups.id').onDelete('set null')
    )
    .addColumn('weight', 'numeric', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE goal_links
    ADD CONSTRAINT goal_links_link_type_check
    CHECK (link_type IN ('activity', 'group'))
  `.execute(db)

  // activity links keep group_id null; group links keep activity_id null.
  // Either target may become null after ON DELETE SET NULL (dangling link).
  await sql`
    ALTER TABLE goal_links
    ADD CONSTRAINT goal_links_target_check
    CHECK (
      (link_type = 'activity' AND group_id IS NULL) OR
      (link_type = 'group' AND activity_id IS NULL)
    )
  `.execute(db)

  await db.schema
    .createIndex('goal_links_goal_id_index')
    .on('goal_links')
    .column('goal_id')
    .execute()

  await db.schema
    .createIndex('goal_links_activity_id_index')
    .on('goal_links')
    .column('activity_id')
    .execute()

  await db.schema
    .createIndex('goal_links_group_id_index')
    .on('goal_links')
    .column('group_id')
    .execute()

  await db.schema
    .createTable('goal_cycles')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('goal_id', 'integer', (col) =>
      col.notNull().references('goals.id').onDelete('cascade')
    )
    .addColumn('cycle_index', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('starts_at', 'timestamp', (col) => col.notNull())
    .addColumn('ends_at', 'timestamp')
    .addColumn('deadline_at', 'timestamp')
    .addColumn('target_value', 'numeric', (col) => col.notNull())
    .addColumn('current_value', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('status', 'varchar(50)', (col) =>
      col.notNull().defaultTo('active')
    )
    .addColumn('carry_over', 'numeric', (col) => col.notNull().defaultTo(0))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE goal_cycles
    ADD CONSTRAINT goal_cycles_status_check
    CHECK (status IN ('active', 'succeeded', 'failed', 'missed'))
  `.execute(db)

  await db.schema
    .createIndex('goal_cycles_goal_id_status_index')
    .on('goal_cycles')
    .columns(['goal_id', 'status'])
    .execute()

  await db.schema
    .createIndex('goal_cycles_goal_id_cycle_index_unique')
    .unique()
    .on('goal_cycles')
    .columns(['goal_id', 'cycle_index'])
    .execute()

  await db.schema
    .createTable('goal_dependencies')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('goal_id', 'integer', (col) =>
      col.notNull().references('goals.id').onDelete('cascade')
    )
    .addColumn('depends_on_goal_id', 'integer', (col) =>
      col.notNull().references('goals.id').onDelete('cascade')
    )
    .addColumn('requirement', 'varchar(50)', (col) =>
      col.notNull().defaultTo('complete')
    )
    .addColumn('threshold', 'numeric')
    .addColumn('weight', 'numeric', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE goal_dependencies
    ADD CONSTRAINT goal_dependencies_requirement_check
    CHECK (requirement IN ('complete', 'progress'))
  `.execute(db)

  await sql`
    ALTER TABLE goal_dependencies
    ADD CONSTRAINT goal_dependencies_no_self_check
    CHECK (goal_id <> depends_on_goal_id)
  `.execute(db)

  await db.schema
    .createIndex('goal_dependencies_goal_id_index')
    .on('goal_dependencies')
    .column('goal_id')
    .execute()

  await db.schema
    .createIndex('goal_dependencies_depends_on_index')
    .on('goal_dependencies')
    .column('depends_on_goal_id')
    .execute()

  await db.schema
    .createIndex('goal_dependencies_unique')
    .unique()
    .on('goal_dependencies')
    .columns(['goal_id', 'depends_on_goal_id'])
    .execute()

  await db.schema
    .createTable('goal_progress_snapshots')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('goal_cycle_id', 'integer', (col) =>
      col.notNull().references('goal_cycles.id').onDelete('cascade')
    )
    .addColumn('as_of', 'date', (col) => col.notNull())
    .addColumn('value', 'numeric', (col) => col.notNull())
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('goal_progress_snapshots_cycle_as_of_unique')
    .unique()
    .on('goal_progress_snapshots')
    .columns(['goal_cycle_id', 'as_of'])
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('goal_progress_snapshots').execute()
  await db.schema.dropTable('goal_dependencies').execute()
  await db.schema.dropTable('goal_cycles').execute()
  await db.schema.dropTable('goal_links').execute()
  await db.schema.dropTable('goals').execute()
}
