import { getContext } from '@getcronit/pylon'
import { db } from '../../db/database.ts'
import type {
  NewRewardDefinition,
  NewRewardRule,
  RewardDefinition as RewardDefinitionRow,
  RewardInventory as RewardInventoryRow,
  RewardRule as RewardRuleRow,
  RewardRuleConfig,
  RewardTransaction as RewardTransactionRow,
} from '../../db/types/schema.ts'
import {
  assetPublicPath,
  createDefaultAssetRepository,
} from '../../assets/repository.ts'
import {
  DbInventoryManager,
  InventoryError,
  recomputeInventoryFromLedger,
} from '../../rewards/inventory.ts'
import { rewardGrantService } from '../../rewards/grant_service.ts'
import { validateGroupColor } from '../validation.ts'
import type {
  AttachRewardRuleInput,
  ConsumeRewardInput,
  CreateRewardDefinitionInput,
  DiscardRewardInput,
  ManualGrantRewardInput,
  RewardDefinitionsFilter,
  RewardHistoryFilter,
  RewardInventoryFilter,
  UpdateRewardDefinitionInput,
} from '../types.ts'

export class InvalidRewardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidRewardError'
  }
}

function requireUserId(): number {
  const userId = getContext().get('userId')
  if (typeof userId !== 'number') {
    throw new Error('Unauthenticated')
  }
  return userId
}

function parseTags(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function parseConfig(value: unknown): RewardRuleConfig {
  if (value == null) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as RewardRuleConfig
    } catch {
      return {}
    }
  }
  return value as RewardRuleConfig
}

function withDefinitionRelations(row: RewardDefinitionRow) {
  return {
    ...row,
    tags: parseTags(row.tags),
    image_url: row.image_asset_id
      ? assetPublicPath(row.image_asset_id)
      : null,
    image: async () => {
      if (row.image_asset_id == null) return null
      const repo = createDefaultAssetRepository(db)
      const asset = await repo.getMetadata(row.image_asset_id, row.user_id)
      if (!asset) return null
      return {
        ...asset,
        url: assetPublicPath(asset.id),
      }
    },
  }
}

function withInventoryRelations(row: RewardInventoryRow) {
  return {
    ...row,
    definition: async () => {
      const def = await db
        .selectFrom('reward_definitions')
        .where('id', '=', row.reward_definition_id)
        .selectAll()
        .executeTakeFirst()
      return def ? withDefinitionRelations(def) : null
    },
  }
}

function withRuleRelations(row: RewardRuleRow) {
  return {
    ...row,
    config: parseConfig(row.config),
    definition: async () => {
      const def = await db
        .selectFrom('reward_definitions')
        .where('id', '=', row.reward_definition_id)
        .selectAll()
        .executeTakeFirst()
      return def ? withDefinitionRelations(def) : null
    },
  }
}

function mapTransaction(row: RewardTransactionRow) {
  return {
    ...row,
    metadata:
      typeof row.metadata === 'string'
        ? JSON.parse(row.metadata)
        : row.metadata,
  }
}

function validateName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new InvalidRewardError('name is required')
  if (trimmed.length > 255) throw new InvalidRewardError('name too long')
  return trimmed
}

export const RewardQuery = {
  rewardDefinitions: async (args: {
    filter?: RewardDefinitionsFilter | null
  }) => {
    const userId = requireUserId()
    const filter = args.filter ?? {}
    let q = db
      .selectFrom('reward_definitions')
      .where('user_id', '=', userId)

    if (!filter.includeArchived) {
      q = q.where('archived_at', 'is', null)
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`
      q = q.where((eb) =>
        eb.or([
          eb('name', 'ilike', term),
          eb('description', 'ilike', term),
          eb('category', 'ilike', term),
        ]),
      )
    }
    if (filter.category?.trim()) {
      q = q.where('category', '=', filter.category.trim())
    }

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200)
    const offset = Math.max(filter.offset ?? 0, 0)

    const rows = await q
      .orderBy('sort_order', 'asc')
      .orderBy('name', 'asc')
      .limit(limit)
      .offset(offset)
      .selectAll()
      .execute()

    return rows.map(withDefinitionRelations)
  },

  rewardDefinition: async (args: { id: number }) => {
    const userId = requireUserId()
    const row = await db
      .selectFrom('reward_definitions')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? withDefinitionRelations(row) : null
  },

  rewardInventory: async (args: {
    filter?: RewardInventoryFilter | null
  }) => {
    const userId = requireUserId()
    const filter = args.filter ?? {}
    let q = db
      .selectFrom('reward_inventory')
      .innerJoin(
        'reward_definitions',
        'reward_definitions.id',
        'reward_inventory.reward_definition_id',
      )
      .where('reward_inventory.user_id', '=', userId)

    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`
      q = q.where('reward_definitions.name', 'ilike', term)
    }
    if (filter.stackableOnly) {
      q = q.where('reward_definitions.stackable', '=', true)
    }

    const sort = filter.sort ?? 'recent'
    if (sort === 'name') {
      q = q.orderBy('reward_definitions.name', 'asc')
    } else if (sort === 'quantity') {
      q = q.orderBy('reward_inventory.quantity', 'desc')
    } else {
      q = q.orderBy('reward_inventory.last_earned_at', 'desc')
    }

    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200)
    const offset = Math.max(filter.offset ?? 0, 0)

    const rows = await q
      .selectAll('reward_inventory')
      .limit(limit)
      .offset(offset)
      .execute()

    return rows.map(withInventoryRelations)
  },

  rewardHistory: async (args: { filter?: RewardHistoryFilter | null }) => {
    const userId = requireUserId()
    const filter = args.filter ?? {}
    let q = db
      .selectFrom('reward_transactions')
      .where('user_id', '=', userId)

    if (filter.definitionId != null) {
      q = q.where('reward_definition_id', '=', filter.definitionId)
    }
    if (filter.type?.trim()) {
      q = q.where('type', '=', filter.type.trim() as never)
    }

    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200)
    const offset = Math.max(filter.offset ?? 0, 0)

    const rows = await q
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .selectAll()
      .execute()

    return rows.map(mapTransaction)
  },

  rewardRules: async (args: {
    sourceType: string
    sourceId: number
  }) => {
    const userId = requireUserId()
    const rows = await db
      .selectFrom('reward_rules')
      .where('user_id', '=', userId)
      .where('source_type', '=', args.sourceType)
      .where('source_id', '=', args.sourceId)
      .selectAll()
      .execute()
    return rows.map(withRuleRelations)
  },

  recentAssets: async (args: { limit?: number | null }) => {
    const userId = requireUserId()
    const repo = createDefaultAssetRepository(db)
    const rows = await repo.listRecent(
      userId,
      Math.min(Math.max(args.limit ?? 20, 1), 50),
    )
    return rows.map((a) => ({ ...a, url: assetPublicPath(a.id) }))
  },

  rewardNudges: async (_args?: Record<string, never>) => {
    const userId = requireUserId()
    const { buildRewardNudges } = await import('../../rewards/nudges.ts')
    const inventory = await db
      .selectFrom('reward_inventory')
      .innerJoin(
        'reward_definitions',
        'reward_definitions.id',
        'reward_inventory.reward_definition_id',
      )
      .where('reward_inventory.user_id', '=', userId)
      .select([
        'reward_inventory.id',
        'reward_inventory.quantity',
        'reward_inventory.reward_definition_id',
        'reward_definitions.name',
      ])
      .execute()

    const recentEarns = await db
      .selectFrom('reward_transactions')
      .where('user_id', '=', userId)
      .where('type', '=', 'earn')
      .orderBy('created_at', 'desc')
      .limit(10)
      .selectAll()
      .execute()

    return buildRewardNudges({
      inventory: inventory.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        reward_definition_id: r.reward_definition_id,
        name: r.name,
      })),
      recentEarns,
    })
  },
}

export const RewardMutation = {
  createRewardDefinition: async (args: {
    input: CreateRewardDefinitionInput
  }) => {
    const userId = requireUserId()
    const { input } = args
    const name = validateName(input.name)
    const color = validateGroupColor(input.color)
    const now = new Date().toISOString()

    if (input.imageAssetId != null) {
      const repo = createDefaultAssetRepository(db)
      const asset = await repo.getMetadata(input.imageAssetId, userId)
      if (!asset) throw new InvalidRewardError('image asset not found')
      await repo.retain(input.imageAssetId, userId)
    }

    const row = await db
      .insertInto('reward_definitions')
      .values({
        user_id: userId,
        name,
        description: input.description?.trim() || null,
        notes: input.notes?.trim() || null,
        category: input.category?.trim() || null,
        tags: JSON.stringify(input.tags ?? []),
        color,
        icon: input.icon?.trim() || null,
        image_asset_id: input.imageAssetId ?? null,
        stackable: input.stackable ?? true,
        default_quantity: Math.max(1, input.defaultQuantity ?? 1),
        sort_order: input.sortOrder ?? 0,
        archived_at: null,
        created_at: now,
        updated_at: now,
      } as NewRewardDefinition)
      .returningAll()
      .executeTakeFirstOrThrow()

    return withDefinitionRelations(row)
  },

  updateRewardDefinition: async (args: {
    id: number
    input: UpdateRewardDefinitionInput
  }) => {
    const userId = requireUserId()
    const existing = await db
      .selectFrom('reward_definitions')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    if (!existing) throw new InvalidRewardError('definition not found')

    const input = args.input
    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (input.name != null) patch.name = validateName(input.name)
    if (input.description !== undefined) {
      patch.description = input.description?.trim() || null
    }
    if (input.notes !== undefined) {
      patch.notes = input.notes?.trim() || null
    }
    if (input.category !== undefined) {
      patch.category = input.category?.trim() || null
    }
    if (input.tags !== undefined) {
      patch.tags = JSON.stringify(input.tags ?? [])
    }
    if (input.color != null) patch.color = validateGroupColor(input.color)
    if (input.icon !== undefined) patch.icon = input.icon?.trim() || null
    if (input.stackable != null) patch.stackable = input.stackable
    if (input.defaultQuantity != null) {
      patch.default_quantity = Math.max(1, input.defaultQuantity)
    }
    if (input.sortOrder != null) patch.sort_order = input.sortOrder

    if (input.imageAssetId !== undefined) {
      const repo = createDefaultAssetRepository(db)
      if (input.imageAssetId != null) {
        const asset = await repo.getMetadata(input.imageAssetId, userId)
        if (!asset) throw new InvalidRewardError('image asset not found')
        if (existing.image_asset_id !== input.imageAssetId) {
          await repo.retain(input.imageAssetId, userId)
          if (existing.image_asset_id != null) {
            await repo.release(existing.image_asset_id, userId)
          }
        }
      } else if (existing.image_asset_id != null) {
        await repo.release(existing.image_asset_id, userId)
      }
      patch.image_asset_id = input.imageAssetId
    }

    const row = await db
      .updateTable('reward_definitions')
      .set(patch)
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirstOrThrow()

    return withDefinitionRelations(row)
  },

  archiveRewardDefinition: async (args: { id: number }) => {
    const userId = requireUserId()
    const row = await db
      .updateTable('reward_definitions')
      .set({
        archived_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst()
    if (!row) throw new InvalidRewardError('definition not found')
    return withDefinitionRelations(row)
  },

  unarchiveRewardDefinition: async (args: { id: number }) => {
    const userId = requireUserId()
    const row = await db
      .updateTable('reward_definitions')
      .set({
        archived_at: null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .returningAll()
      .executeTakeFirst()
    if (!row) throw new InvalidRewardError('definition not found')
    return withDefinitionRelations(row)
  },

  deleteRewardDefinition: async (args: { id: number }) => {
    const userId = requireUserId()
    const inv = await db
      .selectFrom('reward_inventory')
      .where('user_id', '=', userId)
      .where('reward_definition_id', '=', args.id)
      .select('id')
      .executeTakeFirst()
    if (inv) {
      throw new InvalidRewardError(
        'cannot delete definition with inventory; archive instead',
      )
    }

    const existing = await db
      .selectFrom('reward_definitions')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    if (!existing) return false

    await db
      .deleteFrom('reward_definitions')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .execute()

    if (existing.image_asset_id != null) {
      const repo = createDefaultAssetRepository(db)
      await repo.release(existing.image_asset_id, userId)
    }
    return true
  },

  attachRewardRule: async (args: { input: AttachRewardRuleInput }) => {
    const userId = requireUserId()
    const { input } = args
    const sourceType = input.sourceType.trim()
    if (!sourceType) throw new InvalidRewardError('sourceType is required')
    if (!Number.isFinite(input.sourceId)) {
      throw new InvalidRewardError('sourceId is required')
    }

    const definition = await db
      .selectFrom('reward_definitions')
      .where('id', '=', input.rewardDefinitionId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    if (!definition) throw new InvalidRewardError('definition not found')

    if (sourceType === 'activity') {
      const act = await db
        .selectFrom('activities')
        .where('id', '=', input.sourceId)
        .where('user_id', '=', userId)
        .select('id')
        .executeTakeFirst()
      if (!act) throw new InvalidRewardError('activity not found')
    } else if (sourceType === 'goal') {
      const goal = await db
        .selectFrom('goals')
        .where('id', '=', input.sourceId)
        .where('user_id', '=', userId)
        .select('id')
        .executeTakeFirst()
      if (!goal) throw new InvalidRewardError('goal not found')
    }

    let config: RewardRuleConfig = {}
    if (input.configJson?.trim()) {
      try {
        config = JSON.parse(input.configJson) as RewardRuleConfig
      } catch {
        throw new InvalidRewardError('configJson must be valid JSON')
      }
    }

    const mode = input.mode ?? 'fixed'
    const now = new Date().toISOString()
    const row = await db
      .insertInto('reward_rules')
      .values({
        user_id: userId,
        source_type: sourceType,
        source_id: input.sourceId,
        reward_definition_id: input.rewardDefinitionId,
        quantity: Math.max(1, input.quantity ?? 1),
        mode,
        config: JSON.stringify(config),
        enabled: input.enabled ?? true,
        created_at: now,
        updated_at: now,
      } as NewRewardRule)
      .returningAll()
      .executeTakeFirstOrThrow()

    return withRuleRelations(row)
  },

  detachRewardRule: async (args: { id: number }) => {
    const userId = requireUserId()
    const result = await db
      .deleteFrom('reward_rules')
      .where('id', '=', args.id)
      .where('user_id', '=', userId)
      .execute()
    return result.length > 0
  },

  consumeReward: async (args: { input: ConsumeRewardInput }) => {
    const userId = requireUserId()
    const quantity = Math.max(1, args.input.quantity ?? 1)
    const manager = new DbInventoryManager()
    try {
      const { inventory, transaction } = await db
        .transaction()
        .execute(async (trx) => {
          return await manager.applyConsume(
            trx,
            userId,
            args.input.inventoryId,
            quantity,
            args.input.note,
          )
        })
      return {
        inventory: inventory ? withInventoryRelations(inventory) : null,
        transaction: mapTransaction(transaction),
      }
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message)
      }
      throw err
    }
  },

  discardReward: async (args: { input: DiscardRewardInput }) => {
    const userId = requireUserId()
    const quantity = Math.max(1, args.input.quantity ?? 1)
    const manager = new DbInventoryManager()
    try {
      const { inventory, transaction } = await db
        .transaction()
        .execute(async (trx) => {
          return await manager.applyDiscard(
            trx,
            userId,
            args.input.inventoryId,
            quantity,
          )
        })
      return {
        inventory: inventory ? withInventoryRelations(inventory) : null,
        transaction: mapTransaction(transaction),
      }
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message)
      }
      throw err
    }
  },

  restoreReward: async (args: { transactionId: number }) => {
    const userId = requireUserId()
    const manager = new DbInventoryManager()
    try {
      const { inventory, transaction } = await db
        .transaction()
        .execute(async (trx) => {
          return await manager.applyRestore(trx, userId, args.transactionId)
        })
      return {
        inventory: withInventoryRelations(inventory),
        transaction: mapTransaction(transaction),
      }
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message)
      }
      throw err
    }
  },

  manualGrantReward: async (args: { input: ManualGrantRewardInput }) => {
    const userId = requireUserId()
    const quantity = Math.max(1, args.input.quantity ?? 1)
    const definition = await db
      .selectFrom('reward_definitions')
      .where('id', '=', args.input.rewardDefinitionId)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    if (!definition) throw new InvalidRewardError('definition not found')

    const results = await db.transaction().execute(async (trx) => {
      return await rewardGrantService.grant(trx, userId, [
        {
          ruleId: null,
          definitionId: definition.id,
          quantity,
          triggerKey: `manual:${Date.now()}:${crypto.randomUUID()}`,
          sourceType: 'manual',
          sourceId: 0,
        },
      ])
    })

    const tx = results[0]?.transaction
    return tx ? mapTransaction(tx) : null
  },

  recomputeRewardInventory: async () => {
    const userId = requireUserId()
    await recomputeInventoryFromLedger(db, userId)
    return true
  },
}
