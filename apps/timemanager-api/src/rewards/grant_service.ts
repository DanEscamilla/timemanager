import type { Kysely, Transaction } from 'kysely'
import type {
  Database,
  RewardDefinition,
  RewardRule,
  RewardTransaction,
} from '../db/types/schema.ts'
import {
  DbInventoryManager,
  type InventoryManager,
} from './inventory.ts'
import {
  evaluateRule,
  type GrantContext,
  type GrantInstruction,
} from './rules/evaluate.ts'

type DbLike = Kysely<Database> | Transaction<Database>

export interface GrantResult {
  instruction: GrantInstruction
  transaction: RewardTransaction | null
  skipped: boolean
  reason?: string
}

export interface RewardGrantService {
  grant(
    db: DbLike,
    userId: number,
    instructions: GrantInstruction[],
  ): Promise<GrantResult[]>

  collectAndGrant(
    db: DbLike,
    userId: number,
    rules: RewardRule[],
    baseCtx: Omit<GrantContext, 'priorEarnCount' | 'lastEarnAt' | 'userId'>,
  ): Promise<GrantResult[]>
}

export class DefaultRewardGrantService implements RewardGrantService {
  constructor(
    private readonly inventory: InventoryManager = new DbInventoryManager(),
  ) {}

  async grant(
    db: DbLike,
    userId: number,
    instructions: GrantInstruction[],
  ): Promise<GrantResult[]> {
    const results: GrantResult[] = []

    for (const instruction of instructions) {
      // Idempotency: skip if earn already exists.
      let existingQuery = db
        .selectFrom('reward_transactions')
        .where('user_id', '=', userId)
        .where('type', '=', 'earn')
        .where('trigger_key', '=', instruction.triggerKey)

      if (instruction.ruleId != null) {
        existingQuery = existingQuery.where('rule_id', '=', instruction.ruleId)
      } else {
        existingQuery = existingQuery.where('rule_id', 'is', null)
      }

      const existing = await existingQuery.selectAll().executeTakeFirst()

      if (existing) {
        results.push({
          instruction,
          transaction: existing,
          skipped: true,
          reason: 'already_granted',
        })
        continue
      }

      const definition = await db
        .selectFrom('reward_definitions')
        .where('id', '=', instruction.definitionId)
        .where('user_id', '=', userId)
        .selectAll()
        .executeTakeFirst()

      if (!definition) {
        results.push({
          instruction,
          transaction: null,
          skipped: true,
          reason: 'definition_not_found',
        })
        continue
      }

      try {
        const { transaction } = await this.inventory.applyEarn(
          db,
          userId,
          definition as RewardDefinition,
          instruction,
        )
        results.push({ instruction, transaction, skipped: false })
      } catch (err) {
        // Unique constraint race → treat as already granted.
        const message = err instanceof Error ? err.message : String(err)
        if (
          message.includes('reward_transactions_earn_idempotency') ||
          message.includes('unique')
        ) {
          results.push({
            instruction,
            transaction: null,
            skipped: true,
            reason: 'already_granted',
          })
          continue
        }
        throw err
      }
    }

    return results
  }

  async collectAndGrant(
    db: DbLike,
    userId: number,
    rules: RewardRule[],
    baseCtx: Omit<GrantContext, 'priorEarnCount' | 'lastEarnAt' | 'userId'>,
  ): Promise<GrantResult[]> {
    const instructions: GrantInstruction[] = []

    for (const rule of rules) {
      const earns = await db
        .selectFrom('reward_transactions')
        .where('user_id', '=', userId)
        .where('type', '=', 'earn')
        .where('rule_id', '=', rule.id)
        .orderBy('created_at', 'desc')
        .selectAll()
        .execute()

      const config =
        typeof rule.config === 'string'
          ? JSON.parse(rule.config)
          : rule.config ?? {}

      let priorEarnCount = earns.length
      let lastEarnAt: string | null =
        earns[0] != null
          ? typeof earns[0].created_at === 'string'
            ? earns[0].created_at
            : new Date(earns[0].created_at).toISOString()
          : null

      // When period_hours is set, count only earns inside the window.
      if (
        typeof config.period_hours === 'number' &&
        config.period_hours > 0
      ) {
        const now = baseCtx.now ?? new Date()
        const windowMs = config.period_hours * 60 * 60 * 1000
        const inWindow = earns.filter((e) => {
          const t = new Date(e.created_at).getTime()
          return now.getTime() - t < windowMs
        })
        priorEarnCount = inWindow.length
        lastEarnAt =
          inWindow[0] != null
            ? typeof inWindow[0].created_at === 'string'
              ? inWindow[0].created_at
              : new Date(inWindow[0].created_at).toISOString()
            : null
      }

      const ctx: GrantContext = {
        ...baseCtx,
        userId,
        priorEarnCount,
        lastEarnAt,
      }

      const instruction = evaluateRule(rule, ctx)
      if (instruction) instructions.push(instruction)
    }

    return await this.grant(db, userId, instructions)
  }
}

export const rewardGrantService = new DefaultRewardGrantService()
