import type { Kysely, Transaction } from 'kysely'
import type {
  Database,
  NewRewardInventory,
  NewRewardTransaction,
  RewardDefinition,
  RewardInventory,
  RewardTransaction,
} from '../db/types/schema.ts'
import type { GrantInstruction } from './rules/evaluate.ts'

type DbLike = Kysely<Database> | Transaction<Database>

export interface InventoryManager {
  applyEarn(
    trx: DbLike,
    userId: number,
    definition: RewardDefinition,
    instruction: GrantInstruction,
  ): Promise<{ inventory: RewardInventory; transaction: RewardTransaction }>

  applyConsume(
    trx: DbLike,
    userId: number,
    inventoryId: number,
    quantity: number,
    note?: string | null,
  ): Promise<{ inventory: RewardInventory | null; transaction: RewardTransaction }>

  applyDiscard(
    trx: DbLike,
    userId: number,
    inventoryId: number,
    quantity: number,
  ): Promise<{ inventory: RewardInventory | null; transaction: RewardTransaction }>

  applyRestore(
    trx: DbLike,
    userId: number,
    consumeTransactionId: number,
  ): Promise<{ inventory: RewardInventory; transaction: RewardTransaction }>

  revokeUnconsumedForCompletion(
    trx: DbLike,
    userId: number,
    completionId: number,
  ): Promise<number>
}

function snapshotFields(definition: RewardDefinition) {
  return {
    definition_name: definition.name,
    definition_color: definition.color,
    definition_icon: definition.icon,
    image_asset_id: definition.image_asset_id,
  }
}

function newStackKey(): string {
  return crypto.randomUUID()
}

export class DbInventoryManager implements InventoryManager {
  async applyEarn(
    trx: DbLike,
    userId: number,
    definition: RewardDefinition,
    instruction: GrantInstruction,
  ): Promise<{ inventory: RewardInventory; transaction: RewardTransaction }> {
    const now = new Date().toISOString()
    const snap = snapshotFields(definition)

    let inventory: RewardInventory

    if (definition.stackable) {
      const existing = await trx
        .selectFrom('reward_inventory')
        .where('user_id', '=', userId)
        .where('reward_definition_id', '=', definition.id)
        .where('stack_key', 'is', null)
        .selectAll()
        .executeTakeFirst()

      if (existing) {
        inventory = await trx
          .updateTable('reward_inventory')
          .set({
            quantity: existing.quantity + instruction.quantity,
            last_earned_at: now,
            updated_at: now,
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
      } else {
        inventory = await trx
          .insertInto('reward_inventory')
          .values({
            user_id: userId,
            reward_definition_id: definition.id,
            quantity: instruction.quantity,
            stack_key: null,
            first_earned_at: now,
            last_earned_at: now,
            updated_at: now,
          } as NewRewardInventory)
          .returningAll()
          .executeTakeFirstOrThrow()
      }
    } else {
      // Non-stackable: one row per granted unit (quantity always 1 per row).
      // If instruction.quantity > 1, create multiple rows; return the last.
      let last!: RewardInventory
      for (let i = 0; i < instruction.quantity; i++) {
        last = await trx
          .insertInto('reward_inventory')
          .values({
            user_id: userId,
            reward_definition_id: definition.id,
            quantity: 1,
            stack_key: newStackKey(),
            first_earned_at: now,
            last_earned_at: now,
            updated_at: now,
          } as NewRewardInventory)
          .returningAll()
          .executeTakeFirstOrThrow()
      }
      inventory = last
    }

    const transaction = await trx
      .insertInto('reward_transactions')
      .values({
        user_id: userId,
        type: 'earn',
        reward_definition_id: definition.id,
        inventory_id: inventory.id,
        quantity: instruction.quantity,
        ...snap,
        source_type: instruction.sourceType,
        source_id: instruction.sourceId,
        trigger_key: instruction.triggerKey,
        rule_id: instruction.ruleId,
        activity_id: instruction.activityId ?? null,
        goal_id: instruction.goalId ?? null,
        completion_id: instruction.completionId ?? null,
        cycle_id: instruction.cycleId ?? null,
        note: null,
        metadata: null,
        created_at: now,
      } as NewRewardTransaction)
      .returningAll()
      .executeTakeFirstOrThrow()

    return { inventory, transaction }
  }

  async applyConsume(
    trx: DbLike,
    userId: number,
    inventoryId: number,
    quantity: number,
    note?: string | null,
  ): Promise<{ inventory: RewardInventory | null; transaction: RewardTransaction }> {
    return await this.decrement(
      trx,
      userId,
      inventoryId,
      quantity,
      'consume',
      note ?? null,
    )
  }

  async applyDiscard(
    trx: DbLike,
    userId: number,
    inventoryId: number,
    quantity: number,
  ): Promise<{ inventory: RewardInventory | null; transaction: RewardTransaction }> {
    return await this.decrement(
      trx,
      userId,
      inventoryId,
      quantity,
      'delete',
      null,
    )
  }

  private async decrement(
    trx: DbLike,
    userId: number,
    inventoryId: number,
    quantity: number,
    type: 'consume' | 'delete',
    note: string | null,
  ): Promise<{ inventory: RewardInventory | null; transaction: RewardTransaction }> {
    if (quantity < 1) {
      throw new InventoryError('quantity must be >= 1')
    }

    const row = await trx
      .selectFrom('reward_inventory')
      .where('id', '=', inventoryId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()

    if (!row) throw new InventoryError('inventory item not found')
    if (row.quantity < quantity) {
      throw new InventoryError('insufficient quantity')
    }

    const definition = await trx
      .selectFrom('reward_definitions')
      .where('id', '=', row.reward_definition_id)
      .selectAll()
      .executeTakeFirst()

    const snap = definition
      ? snapshotFields(definition)
      : {
          definition_name: 'Unknown reward',
          definition_color: '#64748B',
          definition_icon: null as string | null,
          image_asset_id: null as number | null,
        }

    const now = new Date().toISOString()
    const remaining = row.quantity - quantity
    let inventory: RewardInventory | null

    if (remaining === 0) {
      await trx
        .deleteFrom('reward_inventory')
        .where('id', '=', row.id)
        .execute()
      inventory = null
    } else {
      inventory = await trx
        .updateTable('reward_inventory')
        .set({ quantity: remaining, updated_at: now })
        .where('id', '=', row.id)
        .returningAll()
        .executeTakeFirstOrThrow()
    }

    const transaction = await trx
      .insertInto('reward_transactions')
      .values({
        user_id: userId,
        type,
        reward_definition_id: row.reward_definition_id,
        inventory_id: remaining === 0 ? null : row.id,
        quantity,
        ...snap,
        source_type: 'manual',
        source_id: null,
        trigger_key: null,
        rule_id: null,
        activity_id: null,
        goal_id: null,
        completion_id: null,
        cycle_id: null,
        note,
        metadata: remaining === 0
          ? JSON.stringify({ cleared_inventory_id: row.id })
          : null,
        created_at: now,
      } as NewRewardTransaction)
      .returningAll()
      .executeTakeFirstOrThrow()

    return { inventory, transaction }
  }

  async applyRestore(
    trx: DbLike,
    userId: number,
    consumeTransactionId: number,
  ): Promise<{ inventory: RewardInventory; transaction: RewardTransaction }> {
    const consumeTx = await trx
      .selectFrom('reward_transactions')
      .where('id', '=', consumeTransactionId)
      .where('user_id', '=', userId)
      .where('type', '=', 'consume')
      .selectAll()
      .executeTakeFirst()

    if (!consumeTx) throw new InventoryError('consume transaction not found')
    if (consumeTx.reward_definition_id == null) {
      throw new InventoryError('cannot restore: definition missing')
    }

    // Prevent double-restore.
    const already = await trx
      .selectFrom('reward_transactions')
      .where('user_id', '=', userId)
      .where('type', '=', 'restore')
      .where('metadata', 'is not', null)
      .selectAll()
      .execute()

    const restored = already.some((t) => {
      const meta =
        typeof t.metadata === 'string'
          ? JSON.parse(t.metadata)
          : t.metadata
      return meta && meta.restored_from === consumeTransactionId
    })
    if (restored) throw new InventoryError('already restored')

    const definition = await trx
      .selectFrom('reward_definitions')
      .where('id', '=', consumeTx.reward_definition_id)
      .selectAll()
      .executeTakeFirstOrThrow()

    const instruction: GrantInstruction = {
      ruleId: null,
      definitionId: definition.id,
      quantity: consumeTx.quantity,
      triggerKey: `restore:${consumeTransactionId}`,
      sourceType: 'manual',
      sourceId: 0,
    }

    // Re-apply as earn-like inventory bump, then write restore tx.
    const { inventory } = await this.applyEarnWithoutLedger(
      trx,
      userId,
      definition,
      instruction.quantity,
    )

    const now = new Date().toISOString()
    const transaction = await trx
      .insertInto('reward_transactions')
      .values({
        user_id: userId,
        type: 'restore',
        reward_definition_id: definition.id,
        inventory_id: inventory.id,
        quantity: consumeTx.quantity,
        ...snapshotFields(definition),
        source_type: 'manual',
        source_id: null,
        trigger_key: `restore:${consumeTransactionId}`,
        rule_id: null,
        activity_id: null,
        goal_id: null,
        completion_id: null,
        cycle_id: null,
        note: null,
        metadata: JSON.stringify({ restored_from: consumeTransactionId }),
        created_at: now,
      } as NewRewardTransaction)
      .returningAll()
      .executeTakeFirstOrThrow()

    return { inventory, transaction }
  }

  /** Inventory bump without writing an earn ledger row (used by restore). */
  private async applyEarnWithoutLedger(
    trx: DbLike,
    userId: number,
    definition: RewardDefinition,
    quantity: number,
  ): Promise<{ inventory: RewardInventory }> {
    const now = new Date().toISOString()
    if (definition.stackable) {
      const existing = await trx
        .selectFrom('reward_inventory')
        .where('user_id', '=', userId)
        .where('reward_definition_id', '=', definition.id)
        .where('stack_key', 'is', null)
        .selectAll()
        .executeTakeFirst()

      if (existing) {
        const inventory = await trx
          .updateTable('reward_inventory')
          .set({
            quantity: existing.quantity + quantity,
            updated_at: now,
          })
          .where('id', '=', existing.id)
          .returningAll()
          .executeTakeFirstOrThrow()
        return { inventory }
      }

      const inventory = await trx
        .insertInto('reward_inventory')
        .values({
          user_id: userId,
          reward_definition_id: definition.id,
          quantity,
          stack_key: null,
          first_earned_at: now,
          last_earned_at: now,
          updated_at: now,
        } as NewRewardInventory)
        .returningAll()
        .executeTakeFirstOrThrow()
      return { inventory }
    }

    const inventory = await trx
      .insertInto('reward_inventory')
      .values({
        user_id: userId,
        reward_definition_id: definition.id,
        quantity: 1,
        stack_key: newStackKey(),
        first_earned_at: now,
        last_earned_at: now,
        updated_at: now,
      } as NewRewardInventory)
      .returningAll()
      .executeTakeFirstOrThrow()
    return { inventory }
  }

  /**
   * Revoke unconsumed portion of earns tied to a completion.
   * Never drives inventory negative.
   */
  async revokeUnconsumedForCompletion(
    trx: DbLike,
    userId: number,
    completionId: number,
  ): Promise<number> {
    const earns = await trx
      .selectFrom('reward_transactions')
      .where('user_id', '=', userId)
      .where('type', '=', 'earn')
      .where('completion_id', '=', completionId)
      .selectAll()
      .execute()

    let revoked = 0
    for (const earn of earns) {
      if (earn.reward_definition_id == null) continue

      const inv = await trx
        .selectFrom('reward_inventory')
        .where('user_id', '=', userId)
        .where('reward_definition_id', '=', earn.reward_definition_id)
        .selectAll()
        .execute()

      const available = inv.reduce((s, r) => s + r.quantity, 0)
      const toRevoke = Math.min(earn.quantity, available)
      if (toRevoke <= 0) continue

      let remaining = toRevoke
      for (const row of inv) {
        if (remaining <= 0) break
        const take = Math.min(row.quantity, remaining)
        await this.decrement(
          trx,
          userId,
          row.id,
          take,
          'delete',
          `revoked:completion:${completionId}`,
        )
        remaining -= take
        revoked += take
      }
    }
    return revoked
  }
}

export class InventoryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventoryError'
  }
}

/** Rebuild inventory quantities from the ledger (repair). Does not write ledger rows. */
export async function recomputeInventoryFromLedger(
  db: DbLike,
  userId: number,
): Promise<void> {
  await db
    .deleteFrom('reward_inventory')
    .where('user_id', '=', userId)
    .execute()

  const txs = await db
    .selectFrom('reward_transactions')
    .where('user_id', '=', userId)
    .orderBy('created_at', 'asc')
    .orderBy('id', 'asc')
    .selectAll()
    .execute()

  const defs = await db
    .selectFrom('reward_definitions')
    .where('user_id', '=', userId)
    .selectAll()
    .execute()
  const defMap = new Map(defs.map((d) => [d.id, d]))

  const net = new Map<number, number>()
  const firstEarn = new Map<number, string>()
  const lastEarn = new Map<number, string>()

  for (const tx of txs) {
    if (tx.reward_definition_id == null) continue
    const defId = tx.reward_definition_id
    const cur = net.get(defId) ?? 0
    const created =
      typeof tx.created_at === 'string'
        ? tx.created_at
        : new Date(tx.created_at).toISOString()

    if (tx.type === 'earn' || tx.type === 'restore') {
      net.set(defId, cur + tx.quantity)
      if (!firstEarn.has(defId)) firstEarn.set(defId, created)
      lastEarn.set(defId, created)
    } else if (
      tx.type === 'consume' ||
      tx.type === 'delete' ||
      tx.type === 'adjust'
    ) {
      net.set(defId, Math.max(0, cur - tx.quantity))
    }
  }

  const now = new Date().toISOString()
  for (const [defId, qty] of net) {
    if (qty <= 0) continue
    const definition = defMap.get(defId)
    if (!definition) continue

    if (definition.stackable) {
      await db
        .insertInto('reward_inventory')
        .values({
          user_id: userId,
          reward_definition_id: defId,
          quantity: qty,
          stack_key: null,
          first_earned_at: firstEarn.get(defId) ?? now,
          last_earned_at: lastEarn.get(defId) ?? now,
          updated_at: now,
        } as NewRewardInventory)
        .execute()
    } else {
      for (let i = 0; i < qty; i++) {
        await db
          .insertInto('reward_inventory')
          .values({
            user_id: userId,
            reward_definition_id: defId,
            quantity: 1,
            stack_key: newStackKey(),
            first_earned_at: firstEarn.get(defId) ?? now,
            last_earned_at: lastEarn.get(defId) ?? now,
            updated_at: now,
          } as NewRewardInventory)
          .execute()
      }
    }
  }
}
