import { Kysely, sql } from 'kysely'

/**
 * Rewards system: assets, definitions, rules, inventory, transactions.
 */
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('assets')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('sha256', 'varchar(64)', (col) => col.notNull())
    .addColumn('content_type', 'varchar(128)', (col) => col.notNull())
    .addColumn('byte_size', 'integer', (col) => col.notNull())
    .addColumn('storage_key', 'varchar(512)', (col) => col.notNull())
    .addColumn('ref_count', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('orphaned_at', 'timestamp')
    .execute()

  await db.schema
    .createIndex('assets_user_sha256_unique')
    .on('assets')
    .columns(['user_id', 'sha256'])
    .unique()
    .execute()

  await db.schema
    .createTable('reward_definitions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('notes', 'text')
    .addColumn('category', 'varchar(128)')
    .addColumn('tags', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'[]'::jsonb`)
    )
    .addColumn('color', 'varchar(7)', (col) => col.notNull())
    .addColumn('icon', 'varchar(64)')
    .addColumn('image_asset_id', 'integer', (col) =>
      col.references('assets.id').onDelete('set null')
    )
    .addColumn('stackable', 'boolean', (col) =>
      col.notNull().defaultTo(true)
    )
    .addColumn('default_quantity', 'integer', (col) =>
      col.notNull().defaultTo(1)
    )
    .addColumn('sort_order', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('archived_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await db.schema
    .createIndex('reward_definitions_user_id_index')
    .on('reward_definitions')
    .column('user_id')
    .execute()

  await db.schema
    .createTable('reward_rules')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('source_type', 'varchar(64)', (col) => col.notNull())
    .addColumn('source_id', 'integer', (col) => col.notNull())
    .addColumn('reward_definition_id', 'integer', (col) =>
      col.notNull().references('reward_definitions.id').onDelete('cascade')
    )
    .addColumn('quantity', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('mode', 'varchar(32)', (col) =>
      col.notNull().defaultTo('fixed')
    )
    .addColumn('config', 'jsonb', (col) =>
      col.notNull().defaultTo(sql`'{}'::jsonb`)
    )
    .addColumn('enabled', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE reward_rules
    ADD CONSTRAINT reward_rules_quantity_check
    CHECK (quantity >= 1)
  `.execute(db)

  await sql`
    ALTER TABLE reward_rules
    ADD CONSTRAINT reward_rules_mode_check
    CHECK (mode IN ('fixed', 'probability', 'random_pool'))
  `.execute(db)

  await db.schema
    .createIndex('reward_rules_source_index')
    .on('reward_rules')
    .columns(['user_id', 'source_type', 'source_id'])
    .execute()

  await db.schema
    .createTable('reward_inventory')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('reward_definition_id', 'integer', (col) =>
      col.notNull().references('reward_definitions.id').onDelete('restrict')
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('stack_key', 'uuid')
    .addColumn('first_earned_at', 'timestamp', (col) => col.notNull())
    .addColumn('last_earned_at', 'timestamp', (col) => col.notNull())
    .addColumn('updated_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE reward_inventory
    ADD CONSTRAINT reward_inventory_quantity_check
    CHECK (quantity > 0)
  `.execute(db)

  // One stacked row per definition when stack_key is null.
  await sql`
    CREATE UNIQUE INDEX reward_inventory_stack_unique
    ON reward_inventory (user_id, reward_definition_id)
    WHERE stack_key IS NULL
  `.execute(db)

  await db.schema
    .createIndex('reward_inventory_user_id_index')
    .on('reward_inventory')
    .column('user_id')
    .execute()

  await db.schema
    .createTable('reward_transactions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('user_id', 'integer', (col) =>
      col.notNull().references('users.id').onDelete('cascade')
    )
    .addColumn('type', 'varchar(32)', (col) => col.notNull())
    .addColumn('reward_definition_id', 'integer', (col) =>
      col.references('reward_definitions.id').onDelete('set null')
    )
    .addColumn('inventory_id', 'integer', (col) =>
      col.references('reward_inventory.id').onDelete('set null')
    )
    .addColumn('quantity', 'integer', (col) => col.notNull())
    .addColumn('definition_name', 'varchar(255)', (col) => col.notNull())
    .addColumn('definition_color', 'varchar(7)', (col) => col.notNull())
    .addColumn('definition_icon', 'varchar(64)')
    .addColumn('image_asset_id', 'integer', (col) =>
      col.references('assets.id').onDelete('set null')
    )
    .addColumn('source_type', 'varchar(64)')
    .addColumn('source_id', 'integer')
    .addColumn('trigger_key', 'varchar(255)')
    .addColumn('rule_id', 'integer', (col) =>
      col.references('reward_rules.id').onDelete('set null')
    )
    .addColumn('activity_id', 'integer', (col) =>
      col.references('activities.id').onDelete('set null')
    )
    .addColumn('goal_id', 'integer', (col) =>
      col.references('goals.id').onDelete('set null')
    )
    .addColumn('completion_id', 'integer', (col) =>
      col.references('activity_completions.id').onDelete('set null')
    )
    .addColumn('cycle_id', 'integer', (col) =>
      col.references('goal_cycles.id').onDelete('set null')
    )
    .addColumn('note', 'text')
    .addColumn('metadata', 'jsonb')
    .addColumn('created_at', 'timestamp', (col) =>
      col.notNull().defaultTo(sql`now()`)
    )
    .execute()

  await sql`
    ALTER TABLE reward_transactions
    ADD CONSTRAINT reward_transactions_type_check
    CHECK (type IN ('earn', 'consume', 'delete', 'restore', 'adjust'))
  `.execute(db)

  await sql`
    ALTER TABLE reward_transactions
    ADD CONSTRAINT reward_transactions_quantity_check
    CHECK (quantity > 0)
  `.execute(db)

  // Idempotent earns: one earn per (user, trigger, rule).
  await sql`
    CREATE UNIQUE INDEX reward_transactions_earn_idempotency
    ON reward_transactions (user_id, type, trigger_key, rule_id)
    WHERE type = 'earn' AND trigger_key IS NOT NULL AND rule_id IS NOT NULL
  `.execute(db)

  await db.schema
    .createIndex('reward_transactions_user_created_index')
    .on('reward_transactions')
    .columns(['user_id', 'created_at'])
    .execute()

  await db.schema
    .createIndex('reward_transactions_definition_index')
    .on('reward_transactions')
    .columns(['user_id', 'reward_definition_id'])
    .execute()

  await db.schema
    .createIndex('reward_transactions_completion_index')
    .on('reward_transactions')
    .column('completion_id')
    .execute()
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('reward_transactions').ifExists().execute()
  await db.schema.dropTable('reward_inventory').ifExists().execute()
  await db.schema.dropTable('reward_rules').ifExists().execute()
  await db.schema.dropTable('reward_definitions').ifExists().execute()
  await db.schema.dropTable('assets').ifExists().execute()
}
