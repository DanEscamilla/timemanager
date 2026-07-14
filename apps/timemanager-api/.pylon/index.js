var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/rewards/inventory.ts
function snapshotFields(definition) {
  return {
    definition_name: definition.name,
    definition_color: definition.color,
    definition_icon: definition.icon,
    image_asset_id: definition.image_asset_id
  };
}
function newStackKey() {
  return crypto.randomUUID();
}
async function recomputeInventoryFromLedger(db2, userId) {
  await db2.deleteFrom("reward_inventory").where("user_id", "=", userId).execute();
  const txs = await db2.selectFrom("reward_transactions").where("user_id", "=", userId).orderBy("created_at", "asc").orderBy("id", "asc").selectAll().execute();
  const defs = await db2.selectFrom("reward_definitions").where("user_id", "=", userId).selectAll().execute();
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const net = /* @__PURE__ */ new Map();
  const firstEarn = /* @__PURE__ */ new Map();
  const lastEarn = /* @__PURE__ */ new Map();
  for (const tx of txs) {
    if (tx.reward_definition_id == null) continue;
    const defId = tx.reward_definition_id;
    const cur = net.get(defId) ?? 0;
    const created = typeof tx.created_at === "string" ? tx.created_at : new Date(tx.created_at).toISOString();
    if (tx.type === "earn" || tx.type === "restore") {
      net.set(defId, cur + tx.quantity);
      if (!firstEarn.has(defId)) firstEarn.set(defId, created);
      lastEarn.set(defId, created);
    } else if (tx.type === "consume" || tx.type === "delete" || tx.type === "adjust") {
      net.set(defId, Math.max(0, cur - tx.quantity));
    }
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  for (const [defId, qty] of net) {
    if (qty <= 0) continue;
    const definition = defMap.get(defId);
    if (!definition) continue;
    if (definition.stackable) {
      await db2.insertInto("reward_inventory").values({
        user_id: userId,
        reward_definition_id: defId,
        quantity: qty,
        stack_key: null,
        first_earned_at: firstEarn.get(defId) ?? now,
        last_earned_at: lastEarn.get(defId) ?? now,
        updated_at: now
      }).execute();
    } else {
      for (let i = 0; i < qty; i++) {
        await db2.insertInto("reward_inventory").values({
          user_id: userId,
          reward_definition_id: defId,
          quantity: 1,
          stack_key: newStackKey(),
          first_earned_at: firstEarn.get(defId) ?? now,
          last_earned_at: lastEarn.get(defId) ?? now,
          updated_at: now
        }).execute();
      }
    }
  }
}
var DbInventoryManager, InventoryError;
var init_inventory = __esm({
  "src/rewards/inventory.ts"() {
    "use strict";
    DbInventoryManager = class {
      async applyEarn(trx, userId, definition, instruction) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const snap = snapshotFields(definition);
        let inventory;
        if (definition.stackable) {
          const existing = await trx.selectFrom("reward_inventory").where("user_id", "=", userId).where("reward_definition_id", "=", definition.id).where("stack_key", "is", null).selectAll().executeTakeFirst();
          if (existing) {
            inventory = await trx.updateTable("reward_inventory").set({
              quantity: existing.quantity + instruction.quantity,
              last_earned_at: now,
              updated_at: now
            }).where("id", "=", existing.id).returningAll().executeTakeFirstOrThrow();
          } else {
            inventory = await trx.insertInto("reward_inventory").values({
              user_id: userId,
              reward_definition_id: definition.id,
              quantity: instruction.quantity,
              stack_key: null,
              first_earned_at: now,
              last_earned_at: now,
              updated_at: now
            }).returningAll().executeTakeFirstOrThrow();
          }
        } else {
          let last;
          for (let i = 0; i < instruction.quantity; i++) {
            last = await trx.insertInto("reward_inventory").values({
              user_id: userId,
              reward_definition_id: definition.id,
              quantity: 1,
              stack_key: newStackKey(),
              first_earned_at: now,
              last_earned_at: now,
              updated_at: now
            }).returningAll().executeTakeFirstOrThrow();
          }
          inventory = last;
        }
        const transaction = await trx.insertInto("reward_transactions").values({
          user_id: userId,
          type: "earn",
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
          created_at: now
        }).returningAll().executeTakeFirstOrThrow();
        return { inventory, transaction };
      }
      async applyConsume(trx, userId, inventoryId, quantity, note) {
        return await this.decrement(
          trx,
          userId,
          inventoryId,
          quantity,
          "consume",
          note ?? null
        );
      }
      async applyDiscard(trx, userId, inventoryId, quantity) {
        return await this.decrement(
          trx,
          userId,
          inventoryId,
          quantity,
          "delete",
          null
        );
      }
      async decrement(trx, userId, inventoryId, quantity, type, note) {
        if (quantity < 1) {
          throw new InventoryError("quantity must be >= 1");
        }
        const row = await trx.selectFrom("reward_inventory").where("id", "=", inventoryId).where("user_id", "=", userId).selectAll().executeTakeFirst();
        if (!row) throw new InventoryError("inventory item not found");
        if (row.quantity < quantity) {
          throw new InventoryError("insufficient quantity");
        }
        const definition = await trx.selectFrom("reward_definitions").where("id", "=", row.reward_definition_id).selectAll().executeTakeFirst();
        const snap = definition ? snapshotFields(definition) : {
          definition_name: "Unknown reward",
          definition_color: "#64748B",
          definition_icon: null,
          image_asset_id: null
        };
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const remaining = row.quantity - quantity;
        let inventory;
        if (remaining === 0) {
          await trx.deleteFrom("reward_inventory").where("id", "=", row.id).execute();
          inventory = null;
        } else {
          inventory = await trx.updateTable("reward_inventory").set({ quantity: remaining, updated_at: now }).where("id", "=", row.id).returningAll().executeTakeFirstOrThrow();
        }
        const transaction = await trx.insertInto("reward_transactions").values({
          user_id: userId,
          type,
          reward_definition_id: row.reward_definition_id,
          inventory_id: remaining === 0 ? null : row.id,
          quantity,
          ...snap,
          source_type: "manual",
          source_id: null,
          trigger_key: null,
          rule_id: null,
          activity_id: null,
          goal_id: null,
          completion_id: null,
          cycle_id: null,
          note,
          metadata: remaining === 0 ? JSON.stringify({ cleared_inventory_id: row.id }) : null,
          created_at: now
        }).returningAll().executeTakeFirstOrThrow();
        return { inventory, transaction };
      }
      async applyRestore(trx, userId, consumeTransactionId) {
        const consumeTx = await trx.selectFrom("reward_transactions").where("id", "=", consumeTransactionId).where("user_id", "=", userId).where("type", "=", "consume").selectAll().executeTakeFirst();
        if (!consumeTx) throw new InventoryError("consume transaction not found");
        if (consumeTx.reward_definition_id == null) {
          throw new InventoryError("cannot restore: definition missing");
        }
        const already = await trx.selectFrom("reward_transactions").where("user_id", "=", userId).where("type", "=", "restore").where("metadata", "is not", null).selectAll().execute();
        const restored = already.some((t) => {
          const meta = typeof t.metadata === "string" ? JSON.parse(t.metadata) : t.metadata;
          return meta && meta.restored_from === consumeTransactionId;
        });
        if (restored) throw new InventoryError("already restored");
        const definition = await trx.selectFrom("reward_definitions").where("id", "=", consumeTx.reward_definition_id).selectAll().executeTakeFirstOrThrow();
        const instruction = {
          ruleId: null,
          definitionId: definition.id,
          quantity: consumeTx.quantity,
          triggerKey: `restore:${consumeTransactionId}`,
          sourceType: "manual",
          sourceId: 0
        };
        const { inventory } = await this.applyEarnWithoutLedger(
          trx,
          userId,
          definition,
          instruction.quantity
        );
        const now = (/* @__PURE__ */ new Date()).toISOString();
        const transaction = await trx.insertInto("reward_transactions").values({
          user_id: userId,
          type: "restore",
          reward_definition_id: definition.id,
          inventory_id: inventory.id,
          quantity: consumeTx.quantity,
          ...snapshotFields(definition),
          source_type: "manual",
          source_id: null,
          trigger_key: `restore:${consumeTransactionId}`,
          rule_id: null,
          activity_id: null,
          goal_id: null,
          completion_id: null,
          cycle_id: null,
          note: null,
          metadata: JSON.stringify({ restored_from: consumeTransactionId }),
          created_at: now
        }).returningAll().executeTakeFirstOrThrow();
        return { inventory, transaction };
      }
      /** Inventory bump without writing an earn ledger row (used by restore). */
      async applyEarnWithoutLedger(trx, userId, definition, quantity) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        if (definition.stackable) {
          const existing = await trx.selectFrom("reward_inventory").where("user_id", "=", userId).where("reward_definition_id", "=", definition.id).where("stack_key", "is", null).selectAll().executeTakeFirst();
          if (existing) {
            const inventory3 = await trx.updateTable("reward_inventory").set({
              quantity: existing.quantity + quantity,
              updated_at: now
            }).where("id", "=", existing.id).returningAll().executeTakeFirstOrThrow();
            return { inventory: inventory3 };
          }
          const inventory2 = await trx.insertInto("reward_inventory").values({
            user_id: userId,
            reward_definition_id: definition.id,
            quantity,
            stack_key: null,
            first_earned_at: now,
            last_earned_at: now,
            updated_at: now
          }).returningAll().executeTakeFirstOrThrow();
          return { inventory: inventory2 };
        }
        const inventory = await trx.insertInto("reward_inventory").values({
          user_id: userId,
          reward_definition_id: definition.id,
          quantity: 1,
          stack_key: newStackKey(),
          first_earned_at: now,
          last_earned_at: now,
          updated_at: now
        }).returningAll().executeTakeFirstOrThrow();
        return { inventory };
      }
      /**
       * Revoke unconsumed portion of earns tied to a completion.
       * Never drives inventory negative.
       */
      async revokeUnconsumedForCompletion(trx, userId, completionId) {
        const earns = await trx.selectFrom("reward_transactions").where("user_id", "=", userId).where("type", "=", "earn").where("completion_id", "=", completionId).selectAll().execute();
        let revoked = 0;
        for (const earn of earns) {
          if (earn.reward_definition_id == null) continue;
          const inv = await trx.selectFrom("reward_inventory").where("user_id", "=", userId).where("reward_definition_id", "=", earn.reward_definition_id).selectAll().execute();
          const available = inv.reduce((s, r) => s + r.quantity, 0);
          const toRevoke = Math.min(earn.quantity, available);
          if (toRevoke <= 0) continue;
          let remaining = toRevoke;
          for (const row of inv) {
            if (remaining <= 0) break;
            const take = Math.min(row.quantity, remaining);
            await this.decrement(
              trx,
              userId,
              row.id,
              take,
              "delete",
              `revoked:completion:${completionId}`
            );
            remaining -= take;
            revoked += take;
          }
        }
        return revoked;
      }
    };
    InventoryError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "InventoryError";
      }
    };
  }
});

// src/rewards/rules/evaluate.ts
function parseConfig(config2) {
  if (config2 == null) return {};
  if (typeof config2 === "string") {
    try {
      return JSON.parse(config2);
    } catch {
      return {};
    }
  }
  return config2;
}
function evaluateRule(rule, ctx) {
  if (!rule.enabled) return null;
  const config2 = parseConfig(rule.config);
  const now = ctx.now ?? /* @__PURE__ */ new Date();
  const random = ctx.random ?? Math.random;
  if (config2.once && ctx.priorEarnCount > 0) return null;
  if (typeof config2.max_grants_total === "number" && ctx.priorEarnCount >= config2.max_grants_total) {
    return null;
  }
  if (typeof config2.cooldown_hours === "number" && config2.cooldown_hours > 0 && ctx.lastEarnAt) {
    const last = new Date(ctx.lastEarnAt).getTime();
    const cooldownMs = config2.cooldown_hours * 60 * 60 * 1e3;
    if (now.getTime() - last < cooldownMs) return null;
  }
  if (typeof config2.max_grants_per_period === "number" && typeof config2.period_hours === "number" && config2.period_hours > 0 && ctx.lastEarnAt) {
    const periodMs = config2.period_hours * 60 * 60 * 1e3;
    const last = new Date(ctx.lastEarnAt).getTime();
    if (now.getTime() - last < periodMs && ctx.priorEarnCount >= config2.max_grants_per_period) {
      return null;
    }
  }
  const mode = rule.mode;
  if (mode === "probability") {
    const p = typeof config2.probability === "number" ? config2.probability : 1;
    if (random() > p) return null;
    return baseInstruction(rule, ctx, rule.reward_definition_id, rule.quantity);
  }
  if (mode === "random_pool") {
    const pool = config2.pool;
    if (!pool || pool.length === 0) return null;
    const totalWeight = pool.reduce((s, e) => s + (e.weight ?? 1), 0);
    if (totalWeight <= 0) return null;
    let roll = random() * totalWeight;
    for (const entry of pool) {
      roll -= entry.weight ?? 1;
      if (roll <= 0) {
        return baseInstruction(
          rule,
          ctx,
          entry.definition_id,
          entry.quantity ?? rule.quantity
        );
      }
    }
    const last = pool[pool.length - 1];
    return baseInstruction(
      rule,
      ctx,
      last.definition_id,
      last.quantity ?? rule.quantity
    );
  }
  return baseInstruction(
    rule,
    ctx,
    rule.reward_definition_id,
    rule.quantity
  );
}
function baseInstruction(rule, ctx, definitionId, quantity) {
  return {
    ruleId: rule.id,
    definitionId,
    quantity: Math.max(1, Math.floor(quantity)),
    triggerKey: ctx.triggerKey,
    sourceType: ctx.sourceType,
    sourceId: ctx.sourceId,
    activityId: ctx.activityId ?? null,
    goalId: ctx.goalId ?? null,
    completionId: ctx.completionId ?? null,
    cycleId: ctx.cycleId ?? null
  };
}
var init_evaluate = __esm({
  "src/rewards/rules/evaluate.ts"() {
    "use strict";
  }
});

// src/rewards/grant_service.ts
var DefaultRewardGrantService, rewardGrantService;
var init_grant_service = __esm({
  "src/rewards/grant_service.ts"() {
    "use strict";
    init_inventory();
    init_evaluate();
    DefaultRewardGrantService = class {
      constructor(inventory = new DbInventoryManager()) {
        this.inventory = inventory;
      }
      async grant(db2, userId, instructions) {
        const results = [];
        for (const instruction of instructions) {
          let existingQuery = db2.selectFrom("reward_transactions").where("user_id", "=", userId).where("type", "=", "earn").where("trigger_key", "=", instruction.triggerKey);
          if (instruction.ruleId != null) {
            existingQuery = existingQuery.where("rule_id", "=", instruction.ruleId);
          } else {
            existingQuery = existingQuery.where("rule_id", "is", null);
          }
          const existing = await existingQuery.selectAll().executeTakeFirst();
          if (existing) {
            results.push({
              instruction,
              transaction: existing,
              skipped: true,
              reason: "already_granted"
            });
            continue;
          }
          const definition = await db2.selectFrom("reward_definitions").where("id", "=", instruction.definitionId).where("user_id", "=", userId).selectAll().executeTakeFirst();
          if (!definition) {
            results.push({
              instruction,
              transaction: null,
              skipped: true,
              reason: "definition_not_found"
            });
            continue;
          }
          try {
            const { transaction } = await this.inventory.applyEarn(
              db2,
              userId,
              definition,
              instruction
            );
            results.push({ instruction, transaction, skipped: false });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("reward_transactions_earn_idempotency") || message.includes("unique")) {
              results.push({
                instruction,
                transaction: null,
                skipped: true,
                reason: "already_granted"
              });
              continue;
            }
            throw err;
          }
        }
        return results;
      }
      async collectAndGrant(db2, userId, rules, baseCtx) {
        const instructions = [];
        for (const rule of rules) {
          const earns = await db2.selectFrom("reward_transactions").where("user_id", "=", userId).where("type", "=", "earn").where("rule_id", "=", rule.id).orderBy("created_at", "desc").selectAll().execute();
          const config2 = typeof rule.config === "string" ? JSON.parse(rule.config) : rule.config ?? {};
          let priorEarnCount = earns.length;
          let lastEarnAt = earns[0] != null ? typeof earns[0].created_at === "string" ? earns[0].created_at : new Date(earns[0].created_at).toISOString() : null;
          if (typeof config2.period_hours === "number" && config2.period_hours > 0) {
            const now = baseCtx.now ?? /* @__PURE__ */ new Date();
            const windowMs = config2.period_hours * 60 * 60 * 1e3;
            const inWindow = earns.filter((e) => {
              const t = new Date(e.created_at).getTime();
              return now.getTime() - t < windowMs;
            });
            priorEarnCount = inWindow.length;
            lastEarnAt = inWindow[0] != null ? typeof inWindow[0].created_at === "string" ? inWindow[0].created_at : new Date(inWindow[0].created_at).toISOString() : null;
          }
          const ctx = {
            ...baseCtx,
            userId,
            priorEarnCount,
            lastEarnAt
          };
          const instruction = evaluateRule(rule, ctx);
          if (instruction) instructions.push(instruction);
        }
        return await this.grant(db2, userId, instructions);
      }
    };
    rewardGrantService = new DefaultRewardGrantService();
  }
});

// src/rewards/sources/index.ts
async function loadRules(db2, userId, sourceType, sourceId) {
  return await db2.selectFrom("reward_rules").where("user_id", "=", userId).where("source_type", "=", sourceType).where("source_id", "=", sourceId).where("enabled", "=", true).selectAll().execute();
}
async function enrichAndEvaluate(db2, rules, base) {
  const out = [];
  for (const rule of rules) {
    const last = await db2.selectFrom("reward_transactions").where("user_id", "=", base.userId).where("type", "=", "earn").where("rule_id", "=", rule.id).orderBy("created_at", "desc").selectAll().execute();
    const instruction = evaluateRule(rule, {
      ...base,
      priorEarnCount: last.length,
      lastEarnAt: last[0] != null ? typeof last[0].created_at === "string" ? last[0].created_at : new Date(last[0].created_at).toISOString() : null
    });
    if (instruction) out.push(instruction);
  }
  return out;
}
function getRewardSourceAdapter(sourceType) {
  return REWARD_SOURCE_ADAPTERS.find((a) => a.sourceType === sourceType) ?? null;
}
var activityRewardSource, goalRewardSource, streakRewardSource, dailyCompletionRewardSource, weeklyCompletionRewardSource, REWARD_SOURCE_ADAPTERS;
var init_sources = __esm({
  "src/rewards/sources/index.ts"() {
    "use strict";
    init_evaluate();
    activityRewardSource = {
      sourceType: "activity",
      async collectGrants(db2, ctx) {
        const rules = await loadRules(db2, ctx.userId, "activity", ctx.sourceId);
        return enrichAndEvaluate(db2, rules, ctx);
      }
    };
    goalRewardSource = {
      sourceType: "goal",
      async collectGrants(db2, ctx) {
        const rules = await loadRules(db2, ctx.userId, "goal", ctx.sourceId);
        return enrichAndEvaluate(db2, rules, ctx);
      }
    };
    streakRewardSource = {
      sourceType: "streak",
      async collectGrants(db2, ctx) {
        const rules = await loadRules(db2, ctx.userId, "streak", ctx.sourceId);
        return enrichAndEvaluate(db2, rules, ctx);
      }
    };
    dailyCompletionRewardSource = {
      sourceType: "daily_completion",
      async collectGrants(db2, ctx) {
        const rules = await loadRules(
          db2,
          ctx.userId,
          "daily_completion",
          ctx.sourceId
        );
        return enrichAndEvaluate(db2, rules, ctx);
      }
    };
    weeklyCompletionRewardSource = {
      sourceType: "weekly_completion",
      async collectGrants(db2, ctx) {
        const rules = await loadRules(
          db2,
          ctx.userId,
          "weekly_completion",
          ctx.sourceId
        );
        return enrichAndEvaluate(db2, rules, ctx);
      }
    };
    REWARD_SOURCE_ADAPTERS = [
      activityRewardSource,
      goalRewardSource,
      streakRewardSource,
      dailyCompletionRewardSource,
      weeklyCompletionRewardSource
    ];
  }
});

// src/rewards/hooks.ts
var hooks_exports = {};
__export(hooks_exports, {
  grantRewardsForActivityCompletion: () => grantRewardsForActivityCompletion,
  grantRewardsForGoalCycleSuccess: () => grantRewardsForGoalCycleSuccess
});
async function grantRewardsForActivityCompletion(db2, opts) {
  const adapter = getRewardSourceAdapter("activity");
  if (!adapter) return [];
  const triggerKey = `completion:${opts.completionId}`;
  const instructions = await adapter.collectGrants(db2, {
    userId: opts.userId,
    sourceType: "activity",
    sourceId: opts.activityId,
    triggerKey,
    activityId: opts.activityId,
    completionId: opts.completionId
  });
  return await rewardGrantService.grant(db2, opts.userId, instructions);
}
async function grantRewardsForGoalCycleSuccess(db2, opts) {
  const adapter = getRewardSourceAdapter("goal");
  if (!adapter) return [];
  const triggerKey = `cycle:${opts.cycleId}:succeeded`;
  const instructions = await adapter.collectGrants(db2, {
    userId: opts.userId,
    sourceType: "goal",
    sourceId: opts.goalId,
    triggerKey,
    goalId: opts.goalId,
    cycleId: opts.cycleId
  });
  return await rewardGrantService.grant(db2, opts.userId, instructions);
}
var init_hooks = __esm({
  "src/rewards/hooks.ts"() {
    "use strict";
    init_grant_service();
    init_sources();
  }
});

// src/rewards/nudges.ts
var nudges_exports = {};
__export(nudges_exports, {
  buildRewardNudges: () => buildRewardNudges
});
function buildRewardNudges(input) {
  const nudges = [];
  const now = input.now ?? /* @__PURE__ */ new Date();
  const totalQty = input.inventory.reduce((s, i) => s + i.quantity, 0);
  if (totalQty > 0) {
    const top = [...input.inventory].sort((a, b) => b.quantity - a.quantity)[0];
    nudges.push({
      kind: "inventory_available",
      title: "Rewards ready",
      message: totalQty === 1 ? "You have 1 reward waiting to be enjoyed." : `You have ${totalQty} rewards waiting to be enjoyed.`,
      severity: "info",
      definitionId: top?.reward_definition_id,
      inventoryId: top?.id
    });
  }
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1e3;
  const fresh = input.recentEarns.filter((e) => {
    const t = new Date(e.created_at).getTime();
    return t >= dayAgo;
  });
  for (const earn of fresh.slice(0, 3)) {
    nudges.push({
      kind: "recently_earned",
      title: "Reward earned",
      message: `You earned ${earn.definition_name} \xD7${earn.quantity}.`,
      severity: "success",
      definitionId: earn.reward_definition_id
    });
  }
  const bigStack = input.inventory.find((i) => i.quantity >= 5);
  if (bigStack) {
    nudges.push({
      kind: "unconsumed_stack",
      title: "Growing stack",
      message: `${bigStack.name ?? "A reward"} is stacked \xD7${bigStack.quantity} \u2014 treat yourself?`,
      severity: "info",
      definitionId: bigStack.reward_definition_id,
      inventoryId: bigStack.id
    });
  }
  return nudges;
}
var init_nudges = __esm({
  "src/rewards/nudges.ts"() {
    "use strict";
  }
});

// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import "kysely";
import { getContext as getContext3 } from "@getcronit/pylon";

// src/db/types/schema.ts
import "kysely";

// src/db/database.ts
import { Pool, types } from "pg";
import { Kysely, PostgresDialect } from "kysely";
types.setTypeParser(types.builtins.DATE, (value) => value);
var dialect = new PostgresDialect({
  pool: new Pool({
    database: "timemanager",
    host: "localhost",
    user: "postgres",
    password: "test1234",
    port: 5432,
    max: 10
  })
});
var db = new Kysely({
  dialect
});

// src/goals/lifecycle.ts
function lifecyclePhase(goal, now = /* @__PURE__ */ new Date()) {
  if (goal.status === "paused") return "paused";
  if (goal.status === "completed") return "completed";
  if (goal.status === "archived") return "archived";
  if (goal.status === "failed") return "failed";
  if (goal.status === "active" && new Date(goal.starts_at) > now) {
    return "scheduled";
  }
  return "active";
}
function cycleHasStarted(cycle, now = /* @__PURE__ */ new Date()) {
  return now >= new Date(cycle.starts_at);
}

// src/goals/evaluators/index.ts
function dedupeEvents(events) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const event of events) {
    const key = event.activity_id != null && event.occurrence_date ? `${event.activity_id}:${event.occurrence_date}:${event.metric}` : `id:${event.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}
function eventsInWindow(events, cycle) {
  const start = new Date(cycle.starts_at).getTime();
  const end = cycle.ends_at ? new Date(cycle.ends_at).getTime() : Number.POSITIVE_INFINITY;
  return events.filter((e) => {
    const t = new Date(e.occurred_at).getTime();
    return t >= start && t < end;
  });
}
function linkedActivityIds(links) {
  return new Set(
    links.filter((l) => l.link_type === "activity" && l.activity_id != null).map((l) => l.activity_id)
  );
}
function linkedGroupIds(links) {
  return new Set(
    links.filter((l) => l.link_type === "group" && l.group_id != null).map((l) => l.group_id)
  );
}
function weightForEvent(event, links) {
  for (const link of links) {
    if (link.link_type === "activity" && link.activity_id != null && event.activity_id === link.activity_id) {
      return Number(link.weight);
    }
    if (link.link_type === "group" && link.group_id != null && event.group_id === link.group_id) {
      return Number(link.weight);
    }
  }
  return 1;
}
function matchesLinks(event, links) {
  const activities = linkedActivityIds(links);
  const groups = linkedGroupIds(links);
  if (activities.size === 0 && groups.size === 0) return false;
  if (event.activity_id != null && activities.has(event.activity_id)) return true;
  if (event.group_id != null && groups.has(event.group_id)) return true;
  return false;
}
function sumWeighted(events, links, metric) {
  let total = 0;
  for (const event of dedupeEvents(events)) {
    if (event.metric !== metric) continue;
    if (!matchesLinks(event, links)) continue;
    total += Number(event.amount) * weightForEvent(event, links);
  }
  return total;
}
function withCarryOver(value, cycle) {
  return Math.max(0, value + Number(cycle.carry_over || 0));
}
function result(value, target) {
  const currentValue = Math.max(0, value);
  return {
    currentValue,
    done: target > 0 ? currentValue >= target : currentValue > 0
  };
}
var activityCountEvaluator = {
  ruleType: "activity_count",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, "count"),
      ctx.cycle
    );
    return result(value, Number(ctx.cycle.target_value));
  }
};
var activityDurationEvaluator = {
  ruleType: "activity_duration",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, "duration"),
      ctx.cycle
    );
    return result(value, Number(ctx.cycle.target_value));
  }
};
var groupDurationEvaluator = {
  ruleType: "group_duration",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, "duration"),
      ctx.cycle
    );
    return result(value, Number(ctx.cycle.target_value));
  }
};
var groupCountEvaluator = {
  ruleType: "group_count",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const value = withCarryOver(
      sumWeighted(windowed, ctx.links, "count"),
      ctx.cycle
    );
    return result(value, Number(ctx.cycle.target_value));
  }
};
var groupAnyCountEvaluator = {
  ruleType: "group_any_count",
  evaluate(ctx) {
    return groupCountEvaluator.evaluate(ctx);
  }
};
var groupAllCompleteEvaluator = {
  ruleType: "group_all_complete",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const activityIds = new Set(ctx.groupActivityIds ?? []);
    const completed = /* @__PURE__ */ new Set();
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== "count") continue;
      if (event.activity_id == null) continue;
      if (activityIds.size > 0 && !activityIds.has(event.activity_id)) continue;
      if (!matchesLinks(event, ctx.links) && activityIds.size === 0) continue;
      if (activityIds.size > 0 || matchesLinks(event, ctx.links)) {
        completed.add(event.activity_id);
      }
    }
    const value = withCarryOver(
      activityIds.size > 0 ? [...completed].filter((id) => activityIds.has(id)).length : completed.size,
      ctx.cycle
    );
    return result(value, Number(ctx.cycle.target_value));
  }
};
var multiActivityDurationEvaluator = {
  ruleType: "multi_activity_duration",
  evaluate(ctx) {
    return activityDurationEvaluator.evaluate(ctx);
  }
};
var streakEvaluator = {
  ruleType: "streak",
  evaluate(ctx) {
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    const days = /* @__PURE__ */ new Set();
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== "count") continue;
      if (!matchesLinks(event, ctx.links)) continue;
      const day = event.occurrence_date ?? new Date(event.occurred_at).toISOString().slice(0, 10);
      days.add(day);
    }
    const sorted = [...days].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const day of sorted) {
      if (prev) {
        const prevDate = /* @__PURE__ */ new Date(prev + "T00:00:00Z");
        const curDate = /* @__PURE__ */ new Date(day + "T00:00:00Z");
        const diff = (curDate.getTime() - prevDate.getTime()) / 864e5;
        run = diff === 1 ? run + 1 : 1;
      } else {
        run = 1;
      }
      best = Math.max(best, run);
      prev = day;
    }
    const value = withCarryOver(best, ctx.cycle);
    return result(value, Number(ctx.cycle.target_value));
  }
};
var timeOfDayCountEvaluator = {
  ruleType: "time_of_day_count",
  evaluate(ctx) {
    const config2 = typeof ctx.goal.config === "string" ? JSON.parse(ctx.goal.config) : ctx.goal.config ?? {};
    const before = typeof config2.before_time === "string" ? config2.before_time : null;
    const after = typeof config2.after_time === "string" ? config2.after_time : null;
    const windowed = eventsInWindow(ctx.events, ctx.cycle);
    let total = 0;
    for (const event of dedupeEvents(windowed)) {
      if (event.metric !== "count") continue;
      if (!matchesLinks(event, ctx.links)) continue;
      const hhmm = new Date(event.occurred_at).toISOString().slice(11, 16);
      if (before && hhmm >= before) continue;
      if (after && hhmm < after) continue;
      total += Number(event.amount) * weightForEvent(event, ctx.links);
    }
    return result(withCarryOver(total, ctx.cycle), Number(ctx.cycle.target_value));
  }
};
var compositeEvaluator = {
  ruleType: "composite",
  evaluate(ctx) {
    const config2 = typeof ctx.goal.config === "string" ? JSON.parse(ctx.goal.config) : ctx.goal.config ?? {};
    const mode = config2.composite_mode ?? "all";
    const children = ctx.childCycles;
    if (!children || children.size === 0) {
      return result(0, Number(ctx.cycle.target_value));
    }
    const entries = [...children.entries()];
    if (mode === "weighted") {
      let weightedSum = 0;
      let weightTotal = 0;
      for (const [childId, cycle] of entries) {
        const w = Number(ctx.childWeights?.get(childId) ?? 1);
        const progress = Number(cycle.target_value) > 0 ? Math.min(1, Number(cycle.current_value) / Number(cycle.target_value)) : cycle.status === "succeeded" ? 1 : 0;
        weightedSum += progress * w;
        weightTotal += w;
      }
      const pct = weightTotal > 0 ? weightedSum / weightTotal : 0;
      const value = pct * Number(ctx.cycle.target_value);
      return result(value, Number(ctx.cycle.target_value));
    }
    const completed = entries.filter(
      ([, c]) => c.status === "succeeded" || Number(c.target_value) > 0 && Number(c.current_value) >= Number(c.target_value)
    ).length;
    if (mode === "any") {
      const needed = Math.max(1, Number(config2.count_required ?? 1));
      return result(completed, needed);
    }
    return result(completed, entries.length);
  }
};
var EVALUATORS = [
  activityCountEvaluator,
  activityDurationEvaluator,
  groupDurationEvaluator,
  groupCountEvaluator,
  groupAnyCountEvaluator,
  groupAllCompleteEvaluator,
  multiActivityDurationEvaluator,
  streakEvaluator,
  timeOfDayCountEvaluator,
  compositeEvaluator
];
var REGISTRY = new Map(EVALUATORS.map((e) => [e.ruleType, e]));
var GOAL_RULE_TYPES = EVALUATORS.map((e) => e.ruleType);
function getEvaluator(ruleType) {
  const evaluator = REGISTRY.get(ruleType);
  if (!evaluator) {
    throw new Error(`Unknown goal rule_type: ${ruleType}`);
  }
  return evaluator;
}
function evaluateGoal(ctx) {
  return getEvaluator(ctx.goal.rule_type).evaluate(ctx);
}

// src/goals/progress.ts
function parseJson(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value ?? {};
}
async function fetchGoalLinks(db2, goalId) {
  return await db2.selectFrom("goal_links").where("goal_id", "=", goalId).selectAll().execute();
}
async function fetchEventsForUser(db2, userId, from, to) {
  let query = db2.selectFrom("goal_events").where("user_id", "=", userId).selectAll();
  if (from) {
    const fromDate = typeof from === "string" ? new Date(from) : from;
    query = query.where("occurred_at", ">=", fromDate);
  }
  if (to) {
    const toDate = typeof to === "string" ? new Date(to) : to;
    query = query.where("occurred_at", "<", toDate);
  }
  return await query.execute();
}
async function groupActivityIdsForLinks(db2, links, userId) {
  const groupIds = links.filter((l) => l.link_type === "group" && l.group_id != null).map((l) => l.group_id);
  if (groupIds.length === 0) return [];
  const rows = await db2.selectFrom("activities").where("user_id", "=", userId).where("group_id", "in", groupIds).select("id").execute();
  return rows.map((r) => r.id);
}
async function fetchChildCycles(db2, goalId) {
  const deps = await db2.selectFrom("goal_dependencies").where("goal_id", "=", goalId).selectAll().execute();
  const cycles = /* @__PURE__ */ new Map();
  const weights = /* @__PURE__ */ new Map();
  for (const dep of deps) {
    weights.set(dep.depends_on_goal_id, Number(dep.weight));
    const cycle = await db2.selectFrom("goal_cycles").where("goal_id", "=", dep.depends_on_goal_id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    if (cycle) {
      cycles.set(dep.depends_on_goal_id, cycle);
      continue;
    }
    const latest = await db2.selectFrom("goal_cycles").where("goal_id", "=", dep.depends_on_goal_id).orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    if (latest) cycles.set(dep.depends_on_goal_id, latest);
  }
  return { cycles, weights };
}
function shouldCloseCycleOnTarget(goal) {
  return goal.recurrence == null;
}
async function recomputeCycle(db2, goal, cycle, now = /* @__PURE__ */ new Date()) {
  if (cycle.status === "active" && !cycleHasStarted(cycle, now)) {
    if (Number(cycle.current_value) === 0) return cycle;
    const stamped = now.toISOString();
    return await db2.updateTable("goal_cycles").set({ current_value: 0, updated_at: stamped }).where("id", "=", cycle.id).returningAll().executeTakeFirstOrThrow();
  }
  const links = await fetchGoalLinks(db2, goal.id);
  const events = await fetchEventsForUser(
    db2,
    goal.user_id,
    cycle.starts_at,
    cycle.ends_at ?? void 0
  );
  const groupActivityIds = await groupActivityIdsForLinks(
    db2,
    links,
    goal.user_id
  );
  const { cycles: childCycles, weights: childWeights } = goal.rule_type === "composite" ? await fetchChildCycles(db2, goal.id) : {
    cycles: /* @__PURE__ */ new Map(),
    weights: /* @__PURE__ */ new Map()
  };
  const { currentValue, done } = evaluateGoal({
    goal: {
      ...goal,
      config: parseJson(goal.config)
    },
    cycle,
    links,
    events,
    childCycles,
    childWeights,
    groupActivityIds
  });
  const nowIso = now.toISOString();
  let status = cycle.status;
  if (cycle.status === "active" && done && shouldCloseCycleOnTarget(goal)) {
    status = "succeeded";
  }
  const updated = await db2.updateTable("goal_cycles").set({
    current_value: currentValue,
    status,
    updated_at: nowIso
  }).where("id", "=", cycle.id).returningAll().executeTakeFirstOrThrow();
  const asOf = nowIso.slice(0, 10);
  await db2.insertInto("goal_progress_snapshots").values({
    goal_cycle_id: updated.id,
    as_of: asOf,
    value: currentValue
  }).onConflict(
    (oc) => oc.columns(["goal_cycle_id", "as_of"]).doUpdateSet({
      value: currentValue
    })
  ).execute();
  if (status === "succeeded" && !goal.recurrence && goal.status === "active") {
    await db2.updateTable("goals").set({ status: "completed", updated_at: nowIso }).where("id", "=", goal.id).execute();
  }
  if (status === "succeeded" && cycle.status !== "succeeded") {
    const { grantRewardsForGoalCycleSuccess: grantRewardsForGoalCycleSuccess2 } = await Promise.resolve().then(() => (init_hooks(), hooks_exports));
    await grantRewardsForGoalCycleSuccess2(db2, {
      userId: goal.user_id,
      goalId: goal.id,
      cycleId: updated.id
    });
  }
  return updated;
}
async function recomputeAffectedCycles(db2, userId, opts) {
  const goalIds = /* @__PURE__ */ new Set();
  if (opts.activityId != null) {
    const rows = await db2.selectFrom("goal_links").innerJoin("goals", "goals.id", "goal_links.goal_id").where("goals.user_id", "=", userId).where("goal_links.activity_id", "=", opts.activityId).select("goal_links.goal_id").execute();
    for (const r of rows) goalIds.add(r.goal_id);
  }
  if (opts.groupId != null) {
    const rows = await db2.selectFrom("goal_links").innerJoin("goals", "goals.id", "goal_links.goal_id").where("goals.user_id", "=", userId).where("goal_links.group_id", "=", opts.groupId).select("goal_links.goal_id").execute();
    for (const r of rows) goalIds.add(r.goal_id);
  }
  if (goalIds.size > 0) {
    const deps = await db2.selectFrom("goal_dependencies").where("depends_on_goal_id", "in", [...goalIds]).select("goal_id").execute();
    for (const d of deps) goalIds.add(d.goal_id);
  }
  for (const goalId of goalIds) {
    const goal = await db2.selectFrom("goals").where("id", "=", goalId).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!goal || goal.status === "paused" || goal.status === "archived")
      continue;
    const cycle = await db2.selectFrom("goal_cycles").where("goal_id", "=", goalId).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    if (!cycle) continue;
    await recomputeCycle(db2, goal, cycle);
  }
}
async function recomputeAllActiveCycles(db2, userId) {
  const goals = await db2.selectFrom("goals").where("user_id", "=", userId).where("status", "in", ["active", "completed", "failed"]).selectAll().execute();
  let count = 0;
  for (const goal of goals) {
    const cycles = await db2.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").selectAll().execute();
    for (const cycle of cycles) {
      await recomputeCycle(db2, goal, cycle);
      count++;
    }
  }
  return count;
}

// src/graphql/group_palette.ts
var GROUP_COLOR_PALETTE = [
  "#0F766E",
  // teal (brand)
  "#2563EB",
  // blue
  "#7C3AED",
  // violet
  "#DB2777",
  // pink
  "#DC2626",
  // red
  "#EA580C",
  // orange
  "#CA8A04",
  // yellow
  "#16A34A",
  // green
  "#0891B2",
  // cyan
  "#4B5563"
  // gray
];
var HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
function isAllowedGroupColor(color) {
  if (!HEX_COLOR_RE.test(color)) return false;
  const normalized = color.toUpperCase();
  return GROUP_COLOR_PALETTE.some(
    (c) => c.toUpperCase() === normalized
  );
}
function normalizeGroupColor(color) {
  const match = GROUP_COLOR_PALETTE.find(
    (c) => c.toUpperCase() === color.toUpperCase()
  );
  if (!match) {
    throw new Error(`Invalid group color: ${color}`);
  }
  return match;
}

// src/graphql/validation.ts
var InvalidActivityScheduleError = class extends Error {
};
var InvalidGroupError = class extends Error {
};
var InvalidCompletionError = class extends Error {
};
var InvalidGoalError = class extends Error {
};
function validateActivitySchedule(input) {
  if (!input.isRecurring) {
    if (!input.date) {
      throw new InvalidActivityScheduleError(
        "date is required when isRecurring is false"
      );
    }
    return;
  }
  if (!input.recurrencePattern) {
    throw new InvalidActivityScheduleError(
      "recurrencePattern is required when isRecurring is true"
    );
  }
  const { recurrenceType, config: config2 } = input.recurrencePattern;
  if (!config2 || !config2.start_date) {
    throw new InvalidActivityScheduleError(
      "recurrencePattern.config.start_date is required"
    );
  }
  switch (recurrenceType) {
    case "weekly":
      validateDaysOfWeek(config2.days_of_week);
      break;
    case "monthly":
      validateDaysOfMonth(config2.days_of_month, config2.is_last_day_of_month);
      break;
    case "every_x_days":
      validateIntervalDays(config2.interval_days);
      break;
    default:
      throw new InvalidActivityScheduleError(
        `Unsupported recurrenceType: ${recurrenceType}`
      );
  }
}
function validateGroupColor(color) {
  if (!isAllowedGroupColor(color)) {
    throw new InvalidGroupError(
      "color must be a hex value from the group palette (e.g. #0F766E)"
    );
  }
  return normalizeGroupColor(color);
}
function validateGroupName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidGroupError("name is required");
  }
  if (trimmed.length > 255) {
    throw new InvalidGroupError("name must be at most 255 characters");
  }
  return trimmed;
}
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var TIME_RE = /^\d{2}:\d{2}$/;
function validateOccurrenceDate(date) {
  if (!DATE_RE.test(date)) {
    throw new InvalidCompletionError("occurrenceDate must be YYYY-MM-DD");
  }
  return date;
}
function validateDurationMinutes(value) {
  if (value === void 0 || value === null) return null;
  if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    throw new InvalidCompletionError("durationMinutes must be a non-negative integer");
  }
  return value;
}
function validatePositiveDuration(value) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isInteger(value)) {
    throw new InvalidCompletionError("durationMinutes must be a positive integer");
  }
  return value;
}
function validateDaysOfWeek(daysOfWeek) {
  if (!daysOfWeek || daysOfWeek.length === 0) {
    throw new InvalidActivityScheduleError(
      "config.days_of_week is required for weekly recurrence"
    );
  }
  if (daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InvalidActivityScheduleError(
      "config.days_of_week must contain integers between 0 (Sunday) and 6 (Saturday)"
    );
  }
}
function validateDaysOfMonth(daysOfMonth, isLastDayOfMonth) {
  const hasDaysOfMonth = !!daysOfMonth && daysOfMonth.length > 0;
  if (!hasDaysOfMonth && !isLastDayOfMonth) {
    throw new InvalidActivityScheduleError(
      "config.days_of_month or config.is_last_day_of_month is required for monthly recurrence"
    );
  }
  if (hasDaysOfMonth && daysOfMonth.some((day) => !Number.isInteger(day) || day < 1 || day > 31)) {
    throw new InvalidActivityScheduleError(
      "config.days_of_month must contain integers between 1 and 31"
    );
  }
}
function validateIntervalDays(intervalDays) {
  if (intervalDays === void 0 || intervalDays === null || !Number.isInteger(intervalDays) || intervalDays < 1) {
    throw new InvalidActivityScheduleError(
      "config.interval_days must be an integer >= 1 for every_x_days recurrence"
    );
  }
}
function validateGoalTitle(title) {
  const trimmed = title.trim();
  if (!trimmed) throw new InvalidGoalError("title is required");
  if (trimmed.length > 255) throw new InvalidGoalError("title must be at most 255 characters");
  return trimmed;
}
function validateGoalColor(color) {
  return validateGroupColor(color);
}
function validateRuleType(ruleType) {
  if (!GOAL_RULE_TYPES.includes(ruleType)) {
    throw new InvalidGoalError(
      `ruleType must be one of: ${GOAL_RULE_TYPES.join(", ")}`
    );
  }
  return ruleType;
}
function validateTargetValue(value) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new InvalidGoalError("targetValue must be a positive number");
  }
  return value;
}
function validateGoalLinks(links, ruleType) {
  const list = links ?? [];
  if (ruleType === "composite") {
    if (list.length > 0) {
      throw new InvalidGoalError("composite goals must not have activity/group links");
    }
    return [];
  }
  if (list.length === 0) {
    throw new InvalidGoalError("at least one link is required");
  }
  for (const link of list) {
    if (link.linkType === "activity") {
      if (link.activityId == null) {
        throw new InvalidGoalError("activity links require activityId");
      }
      if (link.groupId != null) {
        throw new InvalidGoalError("activity links must not set groupId");
      }
    } else if (link.linkType === "group") {
      if (link.groupId == null) {
        throw new InvalidGoalError("group links require groupId");
      }
      if (link.activityId != null) {
        throw new InvalidGoalError("group links must not set activityId");
      }
    } else {
      throw new InvalidGoalError("linkType must be activity or group");
    }
    if (link.weight != null && (!Number.isFinite(link.weight) || link.weight <= 0)) {
      throw new InvalidGoalError("link weight must be a positive number");
    }
  }
  return list;
}
function validateGoalDependencies(deps, ruleType) {
  const list = deps ?? [];
  if (ruleType === "composite" && list.length === 0) {
    throw new InvalidGoalError("composite goals require at least one dependency");
  }
  for (const dep of list) {
    if (!Number.isInteger(dep.dependsOnGoalId) || dep.dependsOnGoalId <= 0) {
      throw new InvalidGoalError("dependsOnGoalId must be a positive integer");
    }
    if (dep.requirement != null && dep.requirement !== "complete" && dep.requirement !== "progress") {
      throw new InvalidGoalError("requirement must be complete or progress");
    }
  }
  return list;
}
function validateGoalRecurrence(recurrence) {
  if (recurrence == null) return null;
  const periods = ["weekly", "monthly", "quarterly", "every_x_days"];
  if (!periods.includes(recurrence.period)) {
    throw new InvalidGoalError(`unsupported recurrence period: ${recurrence.period}`);
  }
  if (recurrence.interval != null && (!Number.isInteger(recurrence.interval) || recurrence.interval < 1)) {
    throw new InvalidGoalError("recurrence.interval must be an integer >= 1");
  }
  if (recurrence.carryOver != null && recurrence.carryOver !== "none" && recurrence.carryOver !== "overflow") {
    throw new InvalidGoalError("carryOver must be none or overflow");
  }
  return recurrence;
}
function validateGoalDeadline(deadline) {
  if (deadline == null) return null;
  if (deadline.kind === "absolute") {
    if (!deadline.date || !DATE_RE.test(deadline.date)) {
      throw new InvalidGoalError("absolute deadline requires date YYYY-MM-DD");
    }
  } else if (deadline.kind === "relative") {
    if (deadline.daysAfterCycleStart == null || !Number.isInteger(deadline.daysAfterCycleStart) || deadline.daysAfterCycleStart < 0) {
      throw new InvalidGoalError(
        "relative deadline requires daysAfterCycleStart >= 0"
      );
    }
  } else {
    throw new InvalidGoalError("deadline.kind must be absolute or relative");
  }
  return deadline;
}
var MAX_START_YEARS_AHEAD = 5;
function validateStartsAt(startsAt, now = /* @__PURE__ */ new Date()) {
  if (startsAt == null || startsAt === "") return null;
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidGoalError("startsAt must be a valid ISO-8601 datetime");
  }
  const max = new Date(now);
  max.setUTCFullYear(max.getUTCFullYear() + MAX_START_YEARS_AHEAD);
  if (parsed > max) {
    throw new InvalidGoalError(
      `startsAt must be within ${MAX_START_YEARS_AHEAD} years from now`
    );
  }
  return parsed;
}
function assertDeadlineAfterStart(startsAt, deadline) {
  if (!deadline || deadline.kind !== "absolute" || !deadline.date) return;
  const deadlineAt = /* @__PURE__ */ new Date(deadline.date + "T23:59:59.999Z");
  if (deadlineAt < startsAt) {
    throw new InvalidGoalError("deadline must be on or after the goal start");
  }
}
function validateCreateGoalInput(input, now = /* @__PURE__ */ new Date()) {
  const title = validateGoalTitle(input.title);
  const color = validateGoalColor(input.color);
  const ruleType = validateRuleType(input.ruleType);
  const targetValue = validateTargetValue(input.targetValue);
  if (input.metric !== "count" && input.metric !== "duration") {
    throw new InvalidGoalError("metric must be count or duration");
  }
  const links = validateGoalLinks(input.links, ruleType);
  const dependencies = validateGoalDependencies(input.dependencies, ruleType);
  const recurrence = validateGoalRecurrence(input.recurrence);
  const deadline = validateGoalDeadline(input.deadline);
  const startsAt = validateStartsAt(input.startsAt, now) ?? now;
  assertDeadlineAfterStart(startsAt, deadline);
  if (input.config?.beforeTime && !TIME_RE.test(input.config.beforeTime)) {
    throw new InvalidGoalError("beforeTime must be HH:mm");
  }
  if (input.config?.afterTime && !TIME_RE.test(input.config.afterTime)) {
    throw new InvalidGoalError("afterTime must be HH:mm");
  }
  return {
    title,
    color,
    ruleType,
    targetValue,
    links,
    dependencies,
    recurrence,
    deadline,
    startsAt
  };
}
function validateUpdateGoalInput(input, existingRuleType, now = /* @__PURE__ */ new Date()) {
  const ruleType = input.ruleType != null ? validateRuleType(input.ruleType) : existingRuleType;
  if (input.title != null) validateGoalTitle(input.title);
  if (input.color != null) validateGoalColor(input.color);
  if (input.targetValue != null) validateTargetValue(input.targetValue);
  if (input.metric != null && input.metric !== "count" && input.metric !== "duration") {
    throw new InvalidGoalError("metric must be count or duration");
  }
  if (input.status != null) {
    const allowed = ["active", "paused", "completed", "archived", "failed"];
    if (!allowed.includes(input.status)) {
      throw new InvalidGoalError(`invalid status: ${input.status}`);
    }
  }
  const links = input.links !== void 0 ? validateGoalLinks(input.links, ruleType) : void 0;
  const dependencies = input.dependencies !== void 0 ? validateGoalDependencies(input.dependencies, ruleType) : void 0;
  const recurrence = input.recurrence !== void 0 ? validateGoalRecurrence(input.recurrence) : void 0;
  const deadline = input.deadline !== void 0 ? validateGoalDeadline(input.deadline) : void 0;
  const startsAt = input.startsAt !== void 0 ? validateStartsAt(input.startsAt, now) : void 0;
  return { ruleType, links, dependencies, recurrence, deadline, startsAt };
}
function wouldCreateDependencyCycle(edges, startId) {
  const visiting = /* @__PURE__ */ new Set();
  const visited = /* @__PURE__ */ new Set();
  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of edges.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }
  return dfs(startId);
}

// src/graphql/notification_offsets.ts
var MAX_NOTIFICATION_OFFSET_MINUTES = 10080;
var MAX_NOTIFICATION_OFFSETS = 8;
function normalizeNotificationOffsets(offsets) {
  if (offsets == null) return [];
  if (offsets.length > MAX_NOTIFICATION_OFFSETS) {
    throw new InvalidActivityScheduleError(
      `notificationOffsets must have at most ${MAX_NOTIFICATION_OFFSETS} values`
    );
  }
  const seen = /* @__PURE__ */ new Set();
  const result2 = [];
  for (const raw of offsets) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || !Number.isInteger(raw)) {
      throw new InvalidActivityScheduleError(
        "notificationOffsets must be integers"
      );
    }
    if (raw < 0 || raw > MAX_NOTIFICATION_OFFSET_MINUTES) {
      throw new InvalidActivityScheduleError(
        `notificationOffsets must be between 0 and ${MAX_NOTIFICATION_OFFSET_MINUTES}`
      );
    }
    if (seen.has(raw)) continue;
    seen.add(raw);
    result2.push(raw);
  }
  result2.sort((a, b) => a - b);
  return result2;
}

// src/graphql/numeric.ts
function asNumber(value, fallback = 0) {
  if (value == null) return fallback;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function asNumberOrNull(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

// src/graphql/resolvers/goals_resolvers.ts
import { getContext } from "@getcronit/pylon";

// src/goals/cycles.ts
function parseJson2(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}
function addDays(date, days) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function addMonths(date, months) {
  const d = new Date(date);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}
function computeCycleEnd(startsAt, recurrence) {
  if (!recurrence) return null;
  const interval = Math.max(1, recurrence.interval ?? 1);
  switch (recurrence.period) {
    case "weekly":
      return addDays(startsAt, 7 * interval);
    case "monthly":
      return addMonths(startsAt, interval);
    case "quarterly":
      return addMonths(startsAt, 3 * interval);
    case "every_x_days":
      return addDays(startsAt, interval);
    default:
      return null;
  }
}
function computeDeadlineAt(startsAt, deadline) {
  if (!deadline) return null;
  if (deadline.kind === "absolute" && deadline.date) {
    return /* @__PURE__ */ new Date(deadline.date + "T23:59:59.999Z");
  }
  if (deadline.kind === "relative" && deadline.days_after_cycle_start != null) {
    return addDays(startsAt, deadline.days_after_cycle_start);
  }
  return null;
}
function deadlineState(cycle, deadline, now = /* @__PURE__ */ new Date()) {
  if (!cycle.deadline_at) return "on_track";
  const deadlineAt = new Date(cycle.deadline_at);
  const grace = deadline?.grace_days ?? 0;
  const warn = deadline?.warn_days ?? 3;
  const graceEnd = addDays(deadlineAt, grace);
  if (Number(cycle.current_value) >= Number(cycle.target_value)) {
    return "on_track";
  }
  if (now > graceEnd) return "failed";
  if (now > deadlineAt) return "overdue";
  const warnStart = addDays(deadlineAt, -warn);
  if (now >= warnStart) return "approaching";
  return "on_track";
}
function dateOnlyIso(date) {
  return date.toISOString().slice(0, 10);
}
async function writeSnapshot(db2, cycle, asOf) {
  const asOfStr = dateOnlyIso(asOf);
  await db2.insertInto("goal_progress_snapshots").values({
    goal_cycle_id: cycle.id,
    as_of: asOfStr,
    value: Number(cycle.current_value)
  }).onConflict(
    (oc) => oc.columns(["goal_cycle_id", "as_of"]).doUpdateSet({
      value: Number(cycle.current_value)
    })
  ).execute();
}
async function createInitialCycle(db2, goal, now = /* @__PURE__ */ new Date()) {
  const recurrence = parseJson2(goal.recurrence);
  const deadline = parseJson2(goal.deadline);
  const startsAt = new Date(goal.starts_at);
  const endsAt = computeCycleEnd(startsAt, recurrence);
  const deadlineAt = computeDeadlineAt(startsAt, deadline);
  return await db2.insertInto("goal_cycles").values({
    goal_id: goal.id,
    cycle_index: 0,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    deadline_at: deadlineAt ? deadlineAt.toISOString() : null,
    target_value: Number(goal.target_value),
    current_value: 0,
    status: "active",
    carry_over: 0,
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  }).returningAll().executeTakeFirstOrThrow();
}
async function rescheduleActiveCycle(db2, goal, cycle, startsAt, now = /* @__PURE__ */ new Date()) {
  const recurrence = parseJson2(goal.recurrence);
  const deadline = parseJson2(goal.deadline);
  const endsAt = computeCycleEnd(startsAt, recurrence);
  const deadlineAt = computeDeadlineAt(startsAt, deadline);
  return await db2.updateTable("goal_cycles").set({
    starts_at: startsAt.toISOString(),
    ends_at: endsAt ? endsAt.toISOString() : null,
    deadline_at: deadlineAt ? deadlineAt.toISOString() : null,
    target_value: Number(goal.target_value),
    updated_at: now.toISOString()
  }).where("id", "=", cycle.id).returningAll().executeTakeFirstOrThrow();
}
async function rollOverIfNeeded(db2, goal, cycle, now = /* @__PURE__ */ new Date()) {
  if (!cycleHasStarted(cycle, now)) {
    return cycle;
  }
  const recurrence = parseJson2(goal.recurrence);
  if (!recurrence || !cycle.ends_at) {
    const deadline2 = parseJson2(goal.deadline);
    const state2 = deadlineState(cycle, deadline2, now);
    if (cycle.status === "active" && state2 === "failed") {
      const updated = await db2.updateTable("goal_cycles").set({
        status: "failed",
        updated_at: now.toISOString()
      }).where("id", "=", cycle.id).returningAll().executeTakeFirstOrThrow();
      await db2.updateTable("goals").set({ status: "failed", updated_at: now.toISOString() }).where("id", "=", goal.id).execute();
      await writeSnapshot(db2, updated, now);
      return updated;
    }
    return cycle;
  }
  if (cycle.status !== "active") return cycle;
  if (now < new Date(cycle.ends_at)) return cycle;
  let closed = await recomputeCycle(db2, goal, cycle);
  const met = Number(closed.current_value) >= Number(closed.target_value);
  const deadline = parseJson2(goal.deadline);
  const state = deadlineState(closed, deadline, new Date(cycle.ends_at));
  let closeStatus = met ? "succeeded" : state === "failed" || state === "overdue" ? "failed" : "missed";
  let cursorStart = new Date(cycle.starts_at);
  let cursorEnd = new Date(cycle.ends_at);
  let cycleIndex = cycle.cycle_index;
  let carry = 0;
  if (recurrence.carry_over === "overflow" && Number(closed.current_value) > Number(closed.target_value)) {
    carry = Number(closed.current_value) - Number(closed.target_value);
  }
  closed = await db2.updateTable("goal_cycles").set({
    status: closeStatus,
    updated_at: now.toISOString()
  }).where("id", "=", closed.id).returningAll().executeTakeFirstOrThrow();
  await writeSnapshot(db2, closed, cursorEnd);
  if (closeStatus === "succeeded" && cycle.status !== "succeeded") {
    const { grantRewardsForGoalCycleSuccess: grantRewardsForGoalCycleSuccess2 } = await Promise.resolve().then(() => (init_hooks(), hooks_exports));
    await grantRewardsForGoalCycleSuccess2(db2, {
      userId: goal.user_id,
      goalId: goal.id,
      cycleId: closed.id
    });
  }
  while (cursorEnd <= now) {
    const nextStart = cursorEnd;
    const nextEnd = computeCycleEnd(nextStart, recurrence);
    if (!nextEnd) break;
    cycleIndex += 1;
    if (nextEnd <= now) {
      const missedDeadline = computeDeadlineAt(nextStart, deadline);
      const missed = await db2.insertInto("goal_cycles").values({
        goal_id: goal.id,
        cycle_index: cycleIndex,
        starts_at: nextStart.toISOString(),
        ends_at: nextEnd.toISOString(),
        deadline_at: missedDeadline ? missedDeadline.toISOString() : null,
        target_value: Number(goal.target_value),
        current_value: 0,
        status: "missed",
        carry_over: 0,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }).returningAll().executeTakeFirstOrThrow();
      await writeSnapshot(db2, missed, nextEnd);
      cursorStart = nextStart;
      cursorEnd = nextEnd;
      carry = 0;
      continue;
    }
    const nextDeadline = computeDeadlineAt(nextStart, deadline);
    const next = await db2.insertInto("goal_cycles").values({
      goal_id: goal.id,
      cycle_index: cycleIndex,
      starts_at: nextStart.toISOString(),
      ends_at: nextEnd.toISOString(),
      deadline_at: nextDeadline ? nextDeadline.toISOString() : null,
      target_value: Number(goal.target_value),
      current_value: 0,
      status: "active",
      carry_over: carry,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    }).returningAll().executeTakeFirstOrThrow();
    return await recomputeCycle(db2, goal, next);
  }
  return closed;
}
async function rollOverUserGoals(db2, userId, now = /* @__PURE__ */ new Date()) {
  const goals = await db2.selectFrom("goals").where("user_id", "=", userId).where("status", "in", ["active", "paused"]).selectAll().execute();
  for (const goal of goals) {
    if (goal.status === "paused") continue;
    const cycle = await db2.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    if (!cycle) continue;
    await rollOverIfNeeded(db2, goal, cycle, now);
  }
}

// src/goals/nudges.ts
function parseDeadline(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}
var STARTING_SOON_DAYS = 3;
function buildGoalNudges(goals, now = /* @__PURE__ */ new Date()) {
  const nudges = [];
  for (const { goal, cycle } of goals) {
    if (!cycle || goal.status !== "active") continue;
    const startsAt = new Date(goal.starts_at);
    if (startsAt > now) {
      const msUntil = startsAt.getTime() - now.getTime();
      const daysUntil = msUntil / (24 * 60 * 60 * 1e3);
      if (daysUntil <= STARTING_SOON_DAYS) {
        const daysLabel = Math.max(1, Math.ceil(daysUntil));
        nudges.push({
          kind: "goal_starting_soon",
          goalId: goal.id,
          title: goal.title,
          message: `\u201C${goal.title}\u201D starts in ${daysLabel} day${daysLabel === 1 ? "" : "s"}.`,
          severity: "info"
        });
      }
      continue;
    }
    const targetMet = cycle.status === "succeeded" || Number(cycle.target_value) > 0 && Number(cycle.current_value) >= Number(cycle.target_value);
    if (targetMet) {
      nudges.push({
        kind: "cycle_complete",
        goalId: goal.id,
        title: goal.title,
        message: `You completed \u201C${goal.title}\u201D for this cycle.`,
        severity: "success"
      });
      continue;
    }
    const deadline = parseDeadline(goal.deadline);
    const state = deadlineState(cycle, deadline, now);
    if (state === "approaching") {
      nudges.push({
        kind: "deadline_approaching",
        goalId: goal.id,
        title: goal.title,
        message: `Deadline for \u201C${goal.title}\u201D is approaching.`,
        severity: "warning"
      });
    } else if (state === "overdue") {
      nudges.push({
        kind: "deadline_overdue",
        goalId: goal.id,
        title: goal.title,
        message: `\u201C${goal.title}\u201D is past its deadline.`,
        severity: "warning"
      });
    }
    if (cycle.ends_at && Number(cycle.target_value) > 0) {
      const start = new Date(cycle.starts_at).getTime();
      const end = new Date(cycle.ends_at).getTime();
      const span = Math.max(1, end - start);
      const elapsed = Math.min(1, Math.max(0, (now.getTime() - start) / span));
      const expected = elapsed * Number(cycle.target_value);
      const actual = Number(cycle.current_value);
      if (elapsed >= 0.35 && actual < expected * 0.7) {
        nudges.push({
          kind: "behind_pace",
          goalId: goal.id,
          title: goal.title,
          message: `\u201C${goal.title}\u201D is behind pace this cycle.`,
          severity: "info"
        });
      }
    }
  }
  return nudges;
}

// src/graphql/resolvers/goals_resolvers.ts
function requireUserId() {
  const userId = getContext().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function parseJson3(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}
function mapCycleScalars(cycle) {
  return {
    ...cycle,
    target_value: asNumber(cycle.target_value),
    current_value: asNumber(cycle.current_value),
    carry_over: asNumber(cycle.carry_over)
  };
}
function mapLinkScalars(link) {
  return {
    ...link,
    weight: asNumber(link.weight, 1)
  };
}
function mapDependencyScalars(dep) {
  return {
    ...dep,
    threshold: asNumberOrNull(dep.threshold),
    weight: asNumber(dep.weight, 1)
  };
}
function mapSnapshotScalars(snapshot) {
  return {
    ...snapshot,
    value: asNumber(snapshot.value)
  };
}
function toRecurrenceJson(input) {
  if (input == null) return null;
  return {
    period: input.period,
    interval: input.interval,
    anchor: input.anchor,
    carry_over: input.carryOver,
    reset: input.reset
  };
}
function toDeadlineJson(input) {
  if (input == null) return null;
  return {
    kind: input.kind,
    date: input.date,
    days_after_cycle_start: input.daysAfterCycleStart,
    grace_days: input.graceDays,
    warn_days: input.warnDays
  };
}
function toConfigJson(input) {
  if (!input) return {};
  return {
    composite_mode: input.compositeMode,
    count_required: input.countRequired,
    before_time: input.beforeTime,
    after_time: input.afterTime,
    block_until_unlocked: input.blockUntilUnlocked
  };
}
async function assertOwnedActivities(trx, userId, activityIds) {
  if (activityIds.length === 0) return;
  const rows = await trx.selectFrom("activities").where("user_id", "=", userId).where("id", "in", activityIds).select("id").execute();
  if (rows.length !== activityIds.length) {
    throw new InvalidGoalError("one or more activities not found");
  }
}
async function assertOwnedGroups(trx, userId, groupIds) {
  if (groupIds.length === 0) return;
  const rows = await trx.selectFrom("groups").where("user_id", "=", userId).where("id", "in", groupIds).select("id").execute();
  if (rows.length !== groupIds.length) {
    throw new InvalidGoalError("one or more groups not found");
  }
}
async function assertOwnedGoals(trx, userId, goalIds) {
  if (goalIds.length === 0) return;
  const rows = await trx.selectFrom("goals").where("user_id", "=", userId).where("id", "in", goalIds).select("id").execute();
  if (rows.length !== goalIds.length) {
    throw new InvalidGoalError("one or more dependency goals not found");
  }
}
async function replaceLinks(trx, goalId, userId, links) {
  await trx.deleteFrom("goal_links").where("goal_id", "=", goalId).execute();
  const activityIds = links.filter((l) => l.linkType === "activity" && l.activityId != null).map((l) => l.activityId);
  const groupIds = links.filter((l) => l.linkType === "group" && l.groupId != null).map((l) => l.groupId);
  await assertOwnedActivities(trx, userId, activityIds);
  await assertOwnedGroups(trx, userId, groupIds);
  for (const link of links) {
    await trx.insertInto("goal_links").values({
      goal_id: goalId,
      link_type: link.linkType,
      activity_id: link.linkType === "activity" ? link.activityId ?? null : null,
      group_id: link.linkType === "group" ? link.groupId ?? null : null,
      weight: link.weight ?? 1
    }).execute();
  }
}
async function replaceDependencies(trx, goalId, userId, deps) {
  const depIds = deps.map((d) => d.dependsOnGoalId);
  if (depIds.includes(goalId)) {
    throw new InvalidGoalError("a goal cannot depend on itself");
  }
  await assertOwnedGoals(trx, userId, depIds);
  const allGoals = await trx.selectFrom("goals").where("user_id", "=", userId).select("id").execute();
  const existing = await trx.selectFrom("goal_dependencies").innerJoin("goals", "goals.id", "goal_dependencies.goal_id").where("goals.user_id", "=", userId).select([
    "goal_dependencies.goal_id",
    "goal_dependencies.depends_on_goal_id"
  ]).execute();
  const edges = /* @__PURE__ */ new Map();
  for (const g of allGoals) edges.set(g.id, []);
  for (const e of existing) {
    if (e.goal_id === goalId) continue;
    edges.get(e.goal_id)?.push(e.depends_on_goal_id);
  }
  edges.set(goalId, depIds);
  if (wouldCreateDependencyCycle(edges, goalId)) {
    throw new InvalidGoalError("dependency cycle detected");
  }
  await trx.deleteFrom("goal_dependencies").where("goal_id", "=", goalId).execute();
  for (const dep of deps) {
    await trx.insertInto("goal_dependencies").values({
      goal_id: goalId,
      depends_on_goal_id: dep.dependsOnGoalId,
      requirement: dep.requirement ?? "complete",
      threshold: dep.threshold ?? null,
      weight: dep.weight ?? 1
    }).execute();
  }
}
async function dependenciesMet(goalId, userId) {
  const deps = await db.selectFrom("goal_dependencies").where("goal_id", "=", goalId).selectAll().execute();
  if (deps.length === 0) return true;
  for (const dep of deps) {
    const childGoal = await db.selectFrom("goals").where("id", "=", dep.depends_on_goal_id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!childGoal) return false;
    const cycle = await db.selectFrom("goal_cycles").where("goal_id", "=", dep.depends_on_goal_id).orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    if (!cycle) return false;
    if (dep.requirement === "complete") {
      const targetMet = Number(cycle.target_value) > 0 && Number(cycle.current_value) >= Number(cycle.target_value);
      if (cycle.status !== "succeeded" && childGoal.status !== "completed" && !targetMet) {
        return false;
      }
    } else {
      const threshold = dep.threshold ?? Number(cycle.target_value);
      if (Number(cycle.current_value) < Number(threshold)) return false;
    }
  }
  return true;
}
function withGoalRelations(goal) {
  const config2 = parseJson3(goal.config) ?? {};
  const recurrence = parseJson3(goal.recurrence);
  const deadline = parseJson3(goal.deadline);
  const now = /* @__PURE__ */ new Date();
  return {
    ...goal,
    target_value: asNumber(goal.target_value),
    startsAt: new Date(goal.starts_at).toISOString(),
    lifecyclePhase: lifecyclePhase(goal, now),
    config: config2,
    recurrence,
    deadline,
    links: async () => {
      const rows = await db.selectFrom("goal_links").where("goal_id", "=", goal.id).selectAll().execute();
      return rows.map((link) => ({
        ...mapLinkScalars(link),
        activity: async () => {
          if (link.activity_id == null) return null;
          return await db.selectFrom("activities").where("id", "=", link.activity_id).selectAll().executeTakeFirst() ?? null;
        },
        group: async () => {
          if (link.group_id == null) return null;
          return await db.selectFrom("groups").where("id", "=", link.group_id).selectAll().executeTakeFirst() ?? null;
        }
      }));
    },
    activeCycle: async () => {
      let cycle = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
      if (cycle && goal.status === "active") {
        cycle = await rollOverIfNeeded(db, goal, cycle);
      }
      if (!cycle) {
        const latest = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
        if (latest && goal.status === "active" && goal.recurrence != null && latest.status === "succeeded" && (!latest.ends_at || now < new Date(latest.ends_at))) {
          cycle = await db.updateTable("goal_cycles").set({ status: "active", updated_at: now.toISOString() }).where("id", "=", latest.id).returningAll().executeTakeFirstOrThrow();
        } else {
          cycle = latest;
        }
      }
      if (!cycle) return null;
      const state = deadlineState(cycle, deadline);
      const target = asNumber(cycle.target_value);
      const current = asNumber(cycle.current_value);
      return {
        ...mapCycleScalars(cycle),
        deadlineState: state,
        percentComplete: target > 0 ? Math.min(1, current / target) : 0,
        remaining: Math.max(0, target - current)
      };
    },
    cycles: async () => {
      const rows = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).orderBy("cycle_index", "asc").selectAll().execute();
      return rows.map(mapCycleScalars);
    },
    dependencies: async () => {
      const rows = await db.selectFrom("goal_dependencies").where("goal_id", "=", goal.id).selectAll().execute();
      return rows.map((dep) => ({
        ...mapDependencyScalars(dep),
        dependsOn: async () => {
          const g = await db.selectFrom("goals").where("id", "=", dep.depends_on_goal_id).selectAll().executeTakeFirst();
          return g ? withGoalRelations(g) : null;
        }
      }));
    },
    snapshots: async () => {
      const cycle = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
      if (!cycle) return [];
      const rows = await db.selectFrom("goal_progress_snapshots").where("goal_cycle_id", "=", cycle.id).orderBy("as_of", "asc").selectAll().execute();
      return rows.map(mapSnapshotScalars);
    },
    isLocked: async () => {
      if (!config2.block_until_unlocked) return false;
      return !await dependenciesMet(goal.id, goal.user_id);
    }
  };
}
var GoalQuery = {
  goals: async (args) => {
    const userId = requireUserId();
    await rollOverUserGoals(db, userId);
    let query = db.selectFrom("goals").where("user_id", "=", userId).orderBy("priority", "desc").orderBy("sort_order", "asc").orderBy("id", "desc").selectAll();
    if (args?.status) {
      query = query.where("status", "=", args.status);
    }
    const rows = await query.execute();
    return rows.map(withGoalRelations);
  },
  goal: async (args) => {
    const userId = requireUserId();
    await rollOverUserGoals(db, userId);
    const row = await db.selectFrom("goals").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withGoalRelations(row) : null;
  },
  goalNudges: async (args) => {
    const userId = requireUserId();
    await rollOverUserGoals(db, userId);
    const goals = await db.selectFrom("goals").where("user_id", "=", userId).where("status", "=", "active").selectAll().execute();
    const pairs = [];
    for (const goal of goals) {
      const cycle = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
      pairs.push({ goal, cycle: cycle ?? null });
    }
    return buildGoalNudges(pairs);
  },
  dailyProgress: async (args) => {
    const userId = requireUserId();
    const date = args?.date ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
    const completions = await db.selectFrom("activity_completions").where("user_id", "=", userId).where("occurrence_date", "=", date).selectAll().execute();
    const timeEvents = await db.selectFrom("goal_events").where("user_id", "=", userId).where("metric", "=", "duration").where("occurrence_date", "=", date).selectAll().execute();
    const minutesToday = timeEvents.reduce(
      (sum, e) => sum + Number(e.amount),
      0
    );
    let streak = 0;
    const cursor = /* @__PURE__ */ new Date(date + "T00:00:00Z");
    for (let i = 0; i < 365; i++) {
      const day = cursor.toISOString().slice(0, 10);
      const row = await db.selectFrom("activity_completions").where("user_id", "=", userId).where("occurrence_date", "=", day).select("id").executeTakeFirst();
      if (!row) break;
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
    return {
      date,
      completedCount: completions.length,
      minutesToday,
      streakDays: streak,
      completions
    };
  }
};
var GoalMutation = {
  createGoal: async (args) => {
    const userId = requireUserId();
    const input = args.input;
    const now = /* @__PURE__ */ new Date();
    const validated = validateCreateGoalInput(input, now);
    const goal = await db.transaction().execute(async (trx) => {
      const created = await trx.insertInto("goals").values({
        user_id: userId,
        title: validated.title,
        description: input.description ?? null,
        color: validated.color,
        icon: input.icon ?? null,
        rule_type: validated.ruleType,
        metric: input.metric,
        target_value: validated.targetValue,
        config: JSON.stringify(toConfigJson(input.config)),
        status: "active",
        recurrence: validated.recurrence ? JSON.stringify(toRecurrenceJson(validated.recurrence)) : null,
        deadline: validated.deadline ? JSON.stringify(toDeadlineJson(validated.deadline)) : null,
        priority: input.priority ?? 0,
        sort_order: input.sortOrder ?? 0,
        starts_at: validated.startsAt.toISOString(),
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      }).returningAll().executeTakeFirstOrThrow();
      await replaceLinks(trx, created.id, userId, validated.links);
      await replaceDependencies(trx, created.id, userId, validated.dependencies);
      await createInitialCycle(trx, created, now);
      return created;
    });
    await recomputeCycle(
      db,
      goal,
      await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).selectAll().executeTakeFirstOrThrow(),
      now
    );
    return withGoalRelations(
      await db.selectFrom("goals").where("id", "=", goal.id).selectAll().executeTakeFirstOrThrow()
    );
  },
  updateGoal: async (args) => {
    const userId = requireUserId();
    const existing = await db.selectFrom("goals").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirstOrThrow();
    const nowDate = /* @__PURE__ */ new Date();
    const validated = validateUpdateGoalInput(
      args.input,
      existing.rule_type,
      nowDate
    );
    const input = args.input;
    const now = nowDate.toISOString();
    const activeCycle = await db.selectFrom("goal_cycles").where("goal_id", "=", existing.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
    let nextStartsAt;
    if (validated.startsAt !== void 0) {
      if (existing.status === "completed" || existing.status === "failed") {
        throw new InvalidGoalError(
          "cannot change startsAt on a completed or failed goal"
        );
      }
      if (validated.startsAt == null) {
        throw new InvalidGoalError("startsAt cannot be cleared; omit to leave unchanged");
      }
      nextStartsAt = validated.startsAt;
      const closedCycles = await db.selectFrom("goal_cycles").where("goal_id", "=", existing.id).where("status", "!=", "active").select("id").executeTakeFirst();
      if (closedCycles != null) {
        throw new InvalidGoalError(
          "cannot change startsAt after the first cycle has closed"
        );
      }
      const progressBegun = activeCycle != null && Number(activeCycle.current_value) > 0;
      if (progressBegun && nextStartsAt.getTime() > new Date(existing.starts_at).getTime()) {
        if (!input.confirmStartsAtChange) {
          throw new InvalidGoalError(
            "moving startsAt later after progress requires confirmStartsAtChange"
          );
        }
      }
    }
    const effectiveStartsAt = nextStartsAt ?? new Date(existing.starts_at);
    const effectiveDeadline = validated.deadline !== void 0 ? validated.deadline : (() => {
      const d = parseJson3(existing.deadline);
      if (!d) return null;
      return {
        kind: d.kind,
        date: d.date,
        daysAfterCycleStart: d.days_after_cycle_start,
        graceDays: d.grace_days,
        warnDays: d.warn_days
      };
    })();
    assertDeadlineAfterStart(effectiveStartsAt, effectiveDeadline);
    await db.transaction().execute(async (trx) => {
      await trx.updateTable("goals").set({
        ...input.title != null ? { title: validateGoalTitle(input.title) } : {},
        ...input.description !== void 0 ? { description: input.description } : {},
        ...input.color != null ? { color: validateGoalColor(input.color) } : {},
        ...input.icon !== void 0 ? { icon: input.icon } : {},
        ...input.ruleType != null ? { rule_type: validated.ruleType } : {},
        ...input.metric != null ? { metric: input.metric } : {},
        ...input.targetValue != null ? { target_value: input.targetValue } : {},
        ...input.config !== void 0 ? { config: JSON.stringify(toConfigJson(input.config)) } : {},
        ...input.status != null ? { status: input.status } : {},
        ...validated.recurrence !== void 0 ? {
          recurrence: validated.recurrence ? JSON.stringify(toRecurrenceJson(validated.recurrence)) : null
        } : {},
        ...validated.deadline !== void 0 ? {
          deadline: validated.deadline ? JSON.stringify(toDeadlineJson(validated.deadline)) : null
        } : {},
        ...nextStartsAt != null ? { starts_at: nextStartsAt.toISOString() } : {},
        ...input.priority != null ? { priority: input.priority } : {},
        ...input.sortOrder != null ? { sort_order: input.sortOrder } : {},
        updated_at: now
      }).where("id", "=", args.id).where("user_id", "=", userId).execute();
      if (validated.links) {
        await replaceLinks(trx, args.id, userId, validated.links);
      }
      if (validated.dependencies) {
        await replaceDependencies(trx, args.id, userId, validated.dependencies);
      }
      const goalAfter = await trx.selectFrom("goals").where("id", "=", args.id).selectAll().executeTakeFirstOrThrow();
      const cycle2 = await trx.selectFrom("goal_cycles").where("goal_id", "=", args.id).where("status", "=", "active").orderBy("cycle_index", "desc").selectAll().executeTakeFirst();
      if (cycle2 && nextStartsAt != null) {
        await rescheduleActiveCycle(trx, goalAfter, cycle2, nextStartsAt, nowDate);
      } else if (cycle2 && input.targetValue != null) {
        await trx.updateTable("goal_cycles").set({
          target_value: input.targetValue,
          updated_at: now
        }).where("id", "=", cycle2.id).execute();
      } else if (cycle2 && (validated.deadline !== void 0 || validated.recurrence !== void 0) && Number(cycle2.current_value) === 0 && cycle2.cycle_index === 0) {
        await rescheduleActiveCycle(
          trx,
          goalAfter,
          cycle2,
          new Date(goalAfter.starts_at),
          nowDate
        );
      }
    });
    const goal = await db.selectFrom("goals").where("id", "=", args.id).selectAll().executeTakeFirstOrThrow();
    const cycle = await db.selectFrom("goal_cycles").where("goal_id", "=", goal.id).where("status", "=", "active").selectAll().executeTakeFirst();
    if (cycle) await recomputeCycle(db, goal, cycle, nowDate);
    return withGoalRelations(goal);
  },
  pauseGoal: async (args) => {
    const userId = requireUserId();
    const goal = await db.updateTable("goals").set({ status: "paused", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).where("id", "=", args.id).where("user_id", "=", userId).where("status", "=", "active").returningAll().executeTakeFirstOrThrow();
    return withGoalRelations(goal);
  },
  resumeGoal: async (args) => {
    const userId = requireUserId();
    const goal = await db.updateTable("goals").set({ status: "active", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).where("id", "=", args.id).where("user_id", "=", userId).where("status", "=", "paused").returningAll().executeTakeFirstOrThrow();
    return withGoalRelations(goal);
  },
  archiveGoal: async (args) => {
    const userId = requireUserId();
    const goal = await db.updateTable("goals").set({ status: "archived", updated_at: (/* @__PURE__ */ new Date()).toISOString() }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return withGoalRelations(goal);
  },
  deleteGoal: async (args) => {
    const userId = requireUserId();
    const result2 = await db.deleteFrom("goals").where("id", "=", args.id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  recomputeGoalProgress: async (args) => {
    const userId = requireUserId();
    const count = await recomputeAllActiveCycles(db, userId);
    return { recomputed: count };
  }
};

// src/graphql/resolvers/rewards_resolvers.ts
import { getContext as getContext2 } from "@getcronit/pylon";

// src/assets/hashing.ts
async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var defaultImageHashingService = {
  sha256: sha256Hex
};

// src/assets/storage/local_fs.ts
import { join } from "node:path";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
function cwd() {
  if (typeof process !== "undefined" && typeof process.cwd === "function") {
    return process.cwd();
  }
  return ".";
}
function assetsRoot() {
  const env = typeof process !== "undefined" && process.env?.ASSETS_DIR || null;
  if (env) return env;
  return join(cwd(), "data", "assets");
}
var LocalFsAssetStorage = class {
  constructor(root = assetsRoot()) {
    this.root = root;
  }
  fullPath(key) {
    const safe = key.replace(/\.\./g, "").replace(/^\/+/, "");
    return join(this.root, safe);
  }
  async write(key, bytes, _contentType) {
    const path = this.fullPath(key);
    const dir = join(path, "..");
    await mkdir(dir, { recursive: true });
    await writeFile(path, bytes);
  }
  async read(key) {
    try {
      const data = await readFile(this.fullPath(key));
      return new Uint8Array(data);
    } catch {
      return null;
    }
  }
  async delete(key) {
    try {
      await unlink(this.fullPath(key));
    } catch {
    }
  }
  publicUrl(_key) {
    return null;
  }
};

// src/assets/storage/s3.ts
var S3AssetStorage = class {
  bucket;
  region;
  endpoint;
  constructor(opts) {
    this.bucket = opts?.bucket ?? (typeof process !== "undefined" && process.env?.ASSETS_S3_BUCKET || "");
    this.region = opts?.region ?? (typeof process !== "undefined" && process.env?.ASSETS_S3_REGION || "us-east-1");
    this.endpoint = opts?.endpoint ?? (typeof process !== "undefined" && process.env?.ASSETS_S3_ENDPOINT || null);
  }
  assertConfigured() {
    if (!this.bucket) {
      throw new Error(
        "S3AssetStorage is not configured (set ASSETS_S3_BUCKET)"
      );
    }
  }
  async write(key, bytes, contentType) {
    this.assertConfigured();
    const url = this.objectUrl(key);
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength)
      },
      body: bytes
    });
    if (!res.ok) {
      throw new Error(`S3 put failed: ${res.status} ${await res.text()}`);
    }
  }
  async read(key) {
    this.assertConfigured();
    const res = await fetch(this.objectUrl(key));
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`S3 get failed: ${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }
  async delete(key) {
    this.assertConfigured();
    await fetch(this.objectUrl(key), { method: "DELETE" });
  }
  publicUrl(key) {
    if (!this.bucket) return null;
    return this.objectUrl(key);
  }
  objectUrl(key) {
    const safe = key.replace(/^\/+/, "");
    if (this.endpoint) {
      return `${this.endpoint.replace(/\/$/, "")}/${this.bucket}/${safe}`;
    }
    return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${safe}`;
  }
};
function createAssetStorageFromEnv() {
  const mode = typeof process !== "undefined" && process.env?.ASSETS_STORAGE || "local";
  if (mode === "s3") {
    return new S3AssetStorage();
  }
  return new LocalFsAssetStorage();
}

// src/assets/storage/types.ts
var ALLOWED_IMAGE_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);
var MAX_ASSET_BYTES = 2 * 1024 * 1024;
function extensionForContentType(contentType) {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return "bin";
  }
}

// src/assets/repository.ts
var DbAssetRepository = class {
  constructor(db2, storage, hashing = defaultImageHashingService) {
    this.db = db2;
    this.storage = storage;
    this.hashing = hashing;
  }
  async put(input) {
    const contentType = input.contentType.toLowerCase().split(";")[0].trim();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      throw new AssetValidationError(
        `unsupported content type: ${contentType}`,
        415
      );
    }
    if (input.bytes.byteLength === 0) {
      throw new AssetValidationError("empty file", 400);
    }
    if (input.bytes.byteLength > MAX_ASSET_BYTES) {
      throw new AssetValidationError("file too large", 413);
    }
    const sha256 = await this.hashing.sha256(input.bytes);
    const existing = await this.db.selectFrom("assets").where("user_id", "=", input.userId).where("sha256", "=", sha256).selectAll().executeTakeFirst();
    if (existing) {
      return existing;
    }
    const ext = extensionForContentType(contentType);
    const storageKey = `${input.userId}/${sha256}.${ext}`;
    await this.storage.write(storageKey, input.bytes, contentType);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      return await this.db.insertInto("assets").values({
        user_id: input.userId,
        sha256,
        content_type: contentType,
        byte_size: input.bytes.byteLength,
        storage_key: storageKey,
        ref_count: 0,
        created_at: now,
        orphaned_at: now
      }).returningAll().executeTakeFirstOrThrow();
    } catch (err) {
      await this.storage.delete(storageKey);
      throw err;
    }
  }
  async getMetadata(assetId, userId) {
    return await this.db.selectFrom("assets").where("id", "=", assetId).where("user_id", "=", userId).selectAll().executeTakeFirst() ?? null;
  }
  async readBytes(assetId, userId) {
    const meta = await this.getMetadata(assetId, userId);
    if (!meta) return null;
    const bytes = await this.storage.read(meta.storage_key);
    if (!bytes) return null;
    return { bytes, contentType: meta.content_type };
  }
  async retain(assetId, userId) {
    const row = await this.getMetadata(assetId, userId);
    if (!row) throw new AssetValidationError("asset not found", 404);
    await this.db.updateTable("assets").set({
      ref_count: row.ref_count + 1,
      orphaned_at: null
    }).where("id", "=", assetId).execute();
  }
  async release(assetId, userId) {
    const row = await this.getMetadata(assetId, userId);
    if (!row) return;
    const next = Math.max(0, row.ref_count - 1);
    await this.db.updateTable("assets").set({
      ref_count: next,
      orphaned_at: next === 0 ? (/* @__PURE__ */ new Date()).toISOString() : null
    }).where("id", "=", assetId).execute();
    if (next === 0) {
      await this.purgeIfOrphan(assetId);
    }
  }
  async purgeIfOrphan(assetId) {
    const row = await this.db.selectFrom("assets").where("id", "=", assetId).selectAll().executeTakeFirst();
    if (!row || row.ref_count > 0) return false;
    await this.storage.delete(row.storage_key);
    await this.db.deleteFrom("assets").where("id", "=", assetId).execute();
    return true;
  }
  async listRecent(userId, limit = 20) {
    return await this.db.selectFrom("assets").where("user_id", "=", userId).where("ref_count", ">", 0).orderBy("created_at", "desc").limit(limit).selectAll().execute();
  }
};
var AssetValidationError = class extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
    this.name = "AssetValidationError";
  }
};
function createDefaultAssetRepository(db2) {
  const storage = createAssetStorageFromEnv();
  return new DbAssetRepository(db2, storage);
}
function assetPublicPath(assetId) {
  return `/assets/${assetId}`;
}

// src/graphql/resolvers/rewards_resolvers.ts
init_inventory();
init_grant_service();
var InvalidRewardError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidRewardError";
  }
};
function requireUserId2() {
  const userId = getContext2().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function parseTags(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function parseConfig2(value) {
  if (value == null) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}
function withDefinitionRelations(row) {
  return {
    ...row,
    tags: parseTags(row.tags),
    image_url: row.image_asset_id ? assetPublicPath(row.image_asset_id) : null,
    image: async () => {
      if (row.image_asset_id == null) return null;
      const repo = createDefaultAssetRepository(db);
      const asset = await repo.getMetadata(row.image_asset_id, row.user_id);
      if (!asset) return null;
      return {
        ...asset,
        url: assetPublicPath(asset.id)
      };
    }
  };
}
function withInventoryRelations(row) {
  return {
    ...row,
    definition: async () => {
      const def = await db.selectFrom("reward_definitions").where("id", "=", row.reward_definition_id).selectAll().executeTakeFirst();
      return def ? withDefinitionRelations(def) : null;
    }
  };
}
function withRuleRelations(row) {
  return {
    ...row,
    config: parseConfig2(row.config),
    definition: async () => {
      const def = await db.selectFrom("reward_definitions").where("id", "=", row.reward_definition_id).selectAll().executeTakeFirst();
      return def ? withDefinitionRelations(def) : null;
    }
  };
}
function mapTransaction(row) {
  return {
    ...row,
    metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata
  };
}
function validateName(name) {
  const trimmed = name.trim();
  if (!trimmed) throw new InvalidRewardError("name is required");
  if (trimmed.length > 255) throw new InvalidRewardError("name too long");
  return trimmed;
}
var RewardQuery = {
  rewardDefinitions: async (args) => {
    const userId = requireUserId2();
    const filter = args.filter ?? {};
    let q = db.selectFrom("reward_definitions").where("user_id", "=", userId);
    if (!filter.includeArchived) {
      q = q.where("archived_at", "is", null);
    }
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      q = q.where(
        (eb) => eb.or([
          eb("name", "ilike", term),
          eb("description", "ilike", term),
          eb("category", "ilike", term)
        ])
      );
    }
    if (filter.category?.trim()) {
      q = q.where("category", "=", filter.category.trim());
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await q.orderBy("sort_order", "asc").orderBy("name", "asc").limit(limit).offset(offset).selectAll().execute();
    return rows.map(withDefinitionRelations);
  },
  rewardDefinition: async (args) => {
    const userId = requireUserId2();
    const row = await db.selectFrom("reward_definitions").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withDefinitionRelations(row) : null;
  },
  rewardInventory: async (args) => {
    const userId = requireUserId2();
    const filter = args.filter ?? {};
    let q = db.selectFrom("reward_inventory").innerJoin(
      "reward_definitions",
      "reward_definitions.id",
      "reward_inventory.reward_definition_id"
    ).where("reward_inventory.user_id", "=", userId);
    if (filter.search?.trim()) {
      const term = `%${filter.search.trim().toLowerCase()}%`;
      q = q.where("reward_definitions.name", "ilike", term);
    }
    if (filter.stackableOnly) {
      q = q.where("reward_definitions.stackable", "=", true);
    }
    const sort = filter.sort ?? "recent";
    if (sort === "name") {
      q = q.orderBy("reward_definitions.name", "asc");
    } else if (sort === "quantity") {
      q = q.orderBy("reward_inventory.quantity", "desc");
    } else {
      q = q.orderBy("reward_inventory.last_earned_at", "desc");
    }
    const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await q.selectAll("reward_inventory").limit(limit).offset(offset).execute();
    return rows.map(withInventoryRelations);
  },
  rewardHistory: async (args) => {
    const userId = requireUserId2();
    const filter = args.filter ?? {};
    let q = db.selectFrom("reward_transactions").where("user_id", "=", userId);
    if (filter.definitionId != null) {
      q = q.where("reward_definition_id", "=", filter.definitionId);
    }
    if (filter.type?.trim()) {
      q = q.where("type", "=", filter.type.trim());
    }
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = await q.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).offset(offset).selectAll().execute();
    return rows.map(mapTransaction);
  },
  rewardRules: async (args) => {
    const userId = requireUserId2();
    const rows = await db.selectFrom("reward_rules").where("user_id", "=", userId).where("source_type", "=", args.sourceType).where("source_id", "=", args.sourceId).selectAll().execute();
    return rows.map(withRuleRelations);
  },
  recentAssets: async (args) => {
    const userId = requireUserId2();
    const repo = createDefaultAssetRepository(db);
    const rows = await repo.listRecent(
      userId,
      Math.min(Math.max(args.limit ?? 20, 1), 50)
    );
    return rows.map((a) => ({ ...a, url: assetPublicPath(a.id) }));
  },
  rewardNudges: async (_args) => {
    const userId = requireUserId2();
    const { buildRewardNudges: buildRewardNudges2 } = await Promise.resolve().then(() => (init_nudges(), nudges_exports));
    const inventory = await db.selectFrom("reward_inventory").innerJoin(
      "reward_definitions",
      "reward_definitions.id",
      "reward_inventory.reward_definition_id"
    ).where("reward_inventory.user_id", "=", userId).select([
      "reward_inventory.id",
      "reward_inventory.quantity",
      "reward_inventory.reward_definition_id",
      "reward_definitions.name"
    ]).execute();
    const recentEarns = await db.selectFrom("reward_transactions").where("user_id", "=", userId).where("type", "=", "earn").orderBy("created_at", "desc").limit(10).selectAll().execute();
    return buildRewardNudges2({
      inventory: inventory.map((r) => ({
        id: r.id,
        quantity: r.quantity,
        reward_definition_id: r.reward_definition_id,
        name: r.name
      })),
      recentEarns
    });
  }
};
var RewardMutation = {
  createRewardDefinition: async (args) => {
    const userId = requireUserId2();
    const { input } = args;
    const name = validateName(input.name);
    const color = validateGroupColor(input.color);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    if (input.imageAssetId != null) {
      const repo = createDefaultAssetRepository(db);
      const asset = await repo.getMetadata(input.imageAssetId, userId);
      if (!asset) throw new InvalidRewardError("image asset not found");
      await repo.retain(input.imageAssetId, userId);
    }
    const row = await db.insertInto("reward_definitions").values({
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
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return withDefinitionRelations(row);
  },
  updateRewardDefinition: async (args) => {
    const userId = requireUserId2();
    const existing = await db.selectFrom("reward_definitions").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!existing) throw new InvalidRewardError("definition not found");
    const input = args.input;
    const patch = {
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (input.name != null) patch.name = validateName(input.name);
    if (input.description !== void 0) {
      patch.description = input.description?.trim() || null;
    }
    if (input.notes !== void 0) {
      patch.notes = input.notes?.trim() || null;
    }
    if (input.category !== void 0) {
      patch.category = input.category?.trim() || null;
    }
    if (input.tags !== void 0) {
      patch.tags = JSON.stringify(input.tags ?? []);
    }
    if (input.color != null) patch.color = validateGroupColor(input.color);
    if (input.icon !== void 0) patch.icon = input.icon?.trim() || null;
    if (input.stackable != null) patch.stackable = input.stackable;
    if (input.defaultQuantity != null) {
      patch.default_quantity = Math.max(1, input.defaultQuantity);
    }
    if (input.sortOrder != null) patch.sort_order = input.sortOrder;
    if (input.imageAssetId !== void 0) {
      const repo = createDefaultAssetRepository(db);
      if (input.imageAssetId != null) {
        const asset = await repo.getMetadata(input.imageAssetId, userId);
        if (!asset) throw new InvalidRewardError("image asset not found");
        if (existing.image_asset_id !== input.imageAssetId) {
          await repo.retain(input.imageAssetId, userId);
          if (existing.image_asset_id != null) {
            await repo.release(existing.image_asset_id, userId);
          }
        }
      } else if (existing.image_asset_id != null) {
        await repo.release(existing.image_asset_id, userId);
      }
      patch.image_asset_id = input.imageAssetId;
    }
    const row = await db.updateTable("reward_definitions").set(patch).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return withDefinitionRelations(row);
  },
  archiveRewardDefinition: async (args) => {
    const userId = requireUserId2();
    const row = await db.updateTable("reward_definitions").set({
      archived_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirst();
    if (!row) throw new InvalidRewardError("definition not found");
    return withDefinitionRelations(row);
  },
  unarchiveRewardDefinition: async (args) => {
    const userId = requireUserId2();
    const row = await db.updateTable("reward_definitions").set({
      archived_at: null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirst();
    if (!row) throw new InvalidRewardError("definition not found");
    return withDefinitionRelations(row);
  },
  deleteRewardDefinition: async (args) => {
    const userId = requireUserId2();
    const inv = await db.selectFrom("reward_inventory").where("user_id", "=", userId).where("reward_definition_id", "=", args.id).select("id").executeTakeFirst();
    if (inv) {
      throw new InvalidRewardError(
        "cannot delete definition with inventory; archive instead"
      );
    }
    const existing = await db.selectFrom("reward_definitions").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!existing) return false;
    await db.deleteFrom("reward_definitions").where("id", "=", args.id).where("user_id", "=", userId).execute();
    if (existing.image_asset_id != null) {
      const repo = createDefaultAssetRepository(db);
      await repo.release(existing.image_asset_id, userId);
    }
    return true;
  },
  attachRewardRule: async (args) => {
    const userId = requireUserId2();
    const { input } = args;
    const sourceType = input.sourceType.trim();
    if (!sourceType) throw new InvalidRewardError("sourceType is required");
    if (!Number.isFinite(input.sourceId)) {
      throw new InvalidRewardError("sourceId is required");
    }
    const definition = await db.selectFrom("reward_definitions").where("id", "=", input.rewardDefinitionId).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!definition) throw new InvalidRewardError("definition not found");
    if (sourceType === "activity") {
      const act = await db.selectFrom("activities").where("id", "=", input.sourceId).where("user_id", "=", userId).select("id").executeTakeFirst();
      if (!act) throw new InvalidRewardError("activity not found");
    } else if (sourceType === "goal") {
      const goal = await db.selectFrom("goals").where("id", "=", input.sourceId).where("user_id", "=", userId).select("id").executeTakeFirst();
      if (!goal) throw new InvalidRewardError("goal not found");
    }
    let config2 = {};
    if (input.configJson?.trim()) {
      try {
        config2 = JSON.parse(input.configJson);
      } catch {
        throw new InvalidRewardError("configJson must be valid JSON");
      }
    }
    const mode = input.mode ?? "fixed";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.insertInto("reward_rules").values({
      user_id: userId,
      source_type: sourceType,
      source_id: input.sourceId,
      reward_definition_id: input.rewardDefinitionId,
      quantity: Math.max(1, input.quantity ?? 1),
      mode,
      config: JSON.stringify(config2),
      enabled: input.enabled ?? true,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return withRuleRelations(row);
  },
  detachRewardRule: async (args) => {
    const userId = requireUserId2();
    const result2 = await db.deleteFrom("reward_rules").where("id", "=", args.id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  consumeReward: async (args) => {
    const userId = requireUserId2();
    const quantity = Math.max(1, args.input.quantity ?? 1);
    const manager = new DbInventoryManager();
    try {
      const { inventory, transaction } = await db.transaction().execute(async (trx) => {
        return await manager.applyConsume(
          trx,
          userId,
          args.input.inventoryId,
          quantity,
          args.input.note
        );
      });
      return {
        inventory: inventory ? withInventoryRelations(inventory) : null,
        transaction: mapTransaction(transaction)
      };
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message);
      }
      throw err;
    }
  },
  discardReward: async (args) => {
    const userId = requireUserId2();
    const quantity = Math.max(1, args.input.quantity ?? 1);
    const manager = new DbInventoryManager();
    try {
      const { inventory, transaction } = await db.transaction().execute(async (trx) => {
        return await manager.applyDiscard(
          trx,
          userId,
          args.input.inventoryId,
          quantity
        );
      });
      return {
        inventory: inventory ? withInventoryRelations(inventory) : null,
        transaction: mapTransaction(transaction)
      };
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message);
      }
      throw err;
    }
  },
  restoreReward: async (args) => {
    const userId = requireUserId2();
    const manager = new DbInventoryManager();
    try {
      const { inventory, transaction } = await db.transaction().execute(async (trx) => {
        return await manager.applyRestore(trx, userId, args.transactionId);
      });
      return {
        inventory: withInventoryRelations(inventory),
        transaction: mapTransaction(transaction)
      };
    } catch (err) {
      if (err instanceof InventoryError) {
        throw new InvalidRewardError(err.message);
      }
      throw err;
    }
  },
  manualGrantReward: async (args) => {
    const userId = requireUserId2();
    const quantity = Math.max(1, args.input.quantity ?? 1);
    const definition = await db.selectFrom("reward_definitions").where("id", "=", args.input.rewardDefinitionId).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!definition) throw new InvalidRewardError("definition not found");
    const results = await db.transaction().execute(async (trx) => {
      return await rewardGrantService.grant(trx, userId, [
        {
          ruleId: null,
          definitionId: definition.id,
          quantity,
          triggerKey: `manual:${Date.now()}:${crypto.randomUUID()}`,
          sourceType: "manual",
          sourceId: 0
        }
      ]);
    });
    const tx = results[0]?.transaction;
    return tx ? mapTransaction(tx) : null;
  },
  recomputeRewardInventory: async () => {
    const userId = requireUserId2();
    await recomputeInventoryFromLedger(db, userId);
    return true;
  }
};

// src/graphql/resolvers/resolvers.ts
init_hooks();
init_inventory();
function requireUserId3() {
  const userId = getContext3().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function parseConfig3(config2) {
  try {
    return typeof config2 === "string" ? JSON.parse(config2) : config2;
  } catch {
    return null;
  }
}
async function fetchRecurrencePattern(activityId) {
  return await db.selectFrom("recurrence_patterns").where("activity_id", "=", activityId).selectAll().executeTakeFirst();
}
async function fetchGroupForUser(groupId, userId) {
  return await db.selectFrom("groups").where("id", "=", groupId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
async function resolveGroupId(groupId, userId) {
  if (groupId === void 0) return void 0;
  if (groupId === null) return null;
  const group = await fetchGroupForUser(groupId, userId);
  if (!group) {
    throw new InvalidGroupError("group not found");
  }
  return group.id;
}
async function fetchOwnedActivity(activityId, userId) {
  return await db.selectFrom("activities").where("id", "=", activityId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
function withActivityRelations(activity) {
  return {
    ...activity,
    recurrencePattern: async () => {
      if (!activity.is_recurring) return null;
      const pattern = await fetchRecurrencePattern(activity.id);
      if (!pattern) return null;
      const config2 = parseConfig3(pattern.config);
      if (!config2) return null;
      return { ...pattern, config: config2 };
    },
    group: async () => {
      if (activity.group_id == null) return null;
      return await db.selectFrom("groups").where("id", "=", activity.group_id).selectAll().executeTakeFirst() ?? null;
    }
  };
}
var Query = {
  groups: async (args) => {
    const userId = requireUserId3();
    return await db.selectFrom("groups").where("user_id", "=", userId).orderBy("name", "asc").selectAll().execute();
  },
  group: async (args) => {
    const userId = requireUserId3();
    const { id } = args;
    return await db.selectFrom("groups").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst() ?? null;
  },
  activities: async (args) => {
    const userId = requireUserId3();
    const rows = await db.selectFrom("activities").where("user_id", "=", userId).selectAll().execute();
    return rows.map(withActivityRelations);
  },
  activity: async (args) => {
    const userId = requireUserId3();
    const { id } = args;
    const row = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withActivityRelations(row) : null;
  },
  activityCompletions: async (args) => {
    const userId = requireUserId3();
    let query = db.selectFrom("activity_completions").where("user_id", "=", userId).orderBy("occurrence_date", "desc").selectAll();
    if (args?.activityId != null) {
      query = query.where("activity_id", "=", args.activityId);
    }
    if (args?.fromDate) {
      query = query.where("occurrence_date", ">=", args.fromDate);
    }
    if (args?.toDate) {
      query = query.where("occurrence_date", "<=", args.toDate);
    }
    return await query.execute();
  },
  ...GoalQuery,
  ...RewardQuery
};
var Mutation = {
  createGroup: async (args) => {
    const { input } = args;
    const userId = requireUserId3();
    const name = validateGroupName(input.name);
    const color = validateGroupColor(input.color);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    return await db.insertInto("groups").values({
      user_id: userId,
      name,
      color,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
  },
  updateGroup: async (args) => {
    const { id, input } = args;
    const userId = requireUserId3();
    const existing = await db.selectFrom("groups").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirstOrThrow();
    const name = input.name !== void 0 ? validateGroupName(input.name) : existing.name;
    const color = input.color !== void 0 ? validateGroupColor(input.color) : existing.color;
    return await db.updateTable("groups").set({
      name,
      color,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
  },
  deleteGroup: async (args) => {
    const { id } = args;
    const userId = requireUserId3();
    const result2 = await db.deleteFrom("groups").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  createActivity: async (args) => {
    const { input } = args;
    const userId = requireUserId3();
    validateActivitySchedule({
      isRecurring: input.isRecurring,
      date: input.date,
      recurrencePattern: input.recurrencePattern
    });
    const notificationOffsets = normalizeNotificationOffsets(
      input.notificationOffsets
    );
    const groupId = await resolveGroupId(input.groupId ?? null, userId);
    const activity = await db.transaction().execute(async (trx) => {
      const activity2 = await trx.insertInto("activities").values({
        user_id: userId,
        title: input.title,
        description: input.description,
        start_time: input.startTime,
        end_time: input.endTime,
        is_recurring: input.isRecurring,
        date: input.isRecurring ? null : input.date ?? null,
        group_id: groupId ?? null,
        notification_offsets: notificationOffsets
      }).returningAll().executeTakeFirstOrThrow();
      if (input.isRecurring && input.recurrencePattern) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        await trx.insertInto("recurrence_patterns").values({
          activity_id: activity2.id,
          recurrence_type: input.recurrencePattern.recurrenceType,
          config: JSON.stringify(input.recurrencePattern.config),
          created_at: now,
          updated_at: now
        }).execute();
      }
      return activity2;
    });
    return withActivityRelations(activity);
  },
  updateActivity: async (args) => {
    const { id, input } = args;
    const userId = requireUserId3();
    const existing = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirstOrThrow();
    const isRecurring = input.isRecurring ?? existing.is_recurring;
    const date = input.date !== void 0 ? input.date : existing.date;
    let recurrencePattern = input.recurrencePattern;
    if (isRecurring && !recurrencePattern) {
      const existingPattern = await fetchRecurrencePattern(id);
      if (existingPattern) {
        const config2 = parseConfig3(existingPattern.config);
        recurrencePattern = config2 ? { recurrenceType: existingPattern.recurrence_type, config: config2 } : void 0;
      }
    }
    validateActivitySchedule({ isRecurring, date, recurrencePattern });
    const resolvedGroupId = input.groupId !== void 0 ? await resolveGroupId(input.groupId, userId) : void 0;
    const notificationOffsets = input.notificationOffsets !== void 0 ? normalizeNotificationOffsets(input.notificationOffsets) : void 0;
    const activity = await db.transaction().execute(async (trx) => {
      const activity2 = await trx.updateTable("activities").set({
        title: input.title,
        description: input.description,
        start_time: input.startTime,
        end_time: input.endTime,
        is_recurring: isRecurring,
        date: isRecurring ? null : date ?? null,
        ...resolvedGroupId !== void 0 ? { group_id: resolvedGroupId } : {},
        ...notificationOffsets !== void 0 ? { notification_offsets: notificationOffsets } : {},
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).where("id", "=", id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
      if (isRecurring && input.recurrencePattern) {
        const now = (/* @__PURE__ */ new Date()).toISOString();
        await trx.insertInto("recurrence_patterns").values({
          activity_id: activity2.id,
          recurrence_type: input.recurrencePattern.recurrenceType,
          config: JSON.stringify(input.recurrencePattern.config),
          created_at: now,
          updated_at: now
        }).onConflict(
          (oc) => oc.columns(["activity_id"]).doUpdateSet({
            recurrence_type: input.recurrencePattern.recurrenceType,
            config: JSON.stringify(input.recurrencePattern.config),
            updated_at: (/* @__PURE__ */ new Date()).toISOString()
          })
        ).execute();
      } else if (!isRecurring) {
        await trx.deleteFrom("recurrence_patterns").where("activity_id", "=", activity2.id).execute();
      }
      return activity2;
    });
    return withActivityRelations(activity);
  },
  deleteActivity: async (args) => {
    const { id } = args;
    const userId = requireUserId3();
    const result2 = await db.deleteFrom("activities").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  completeActivity: async (args) => {
    const userId = requireUserId3();
    const { input } = args;
    const occurrenceDate = validateOccurrenceDate(input.occurrenceDate);
    const durationMinutes = validateDurationMinutes(input.durationMinutes);
    const activity = await fetchOwnedActivity(input.activityId, userId);
    if (!activity) {
      throw new InvalidCompletionError("activity not found");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const completion = await db.transaction().execute(async (trx) => {
      const existing = await trx.selectFrom("activity_completions").where("activity_id", "=", activity.id).where("occurrence_date", "=", occurrenceDate).selectAll().executeTakeFirst();
      if (existing) {
        await trx.deleteFrom("goal_events").where("completion_id", "=", existing.id).execute();
      }
      const completion2 = await trx.insertInto("activity_completions").values({
        activity_id: activity.id,
        user_id: userId,
        occurrence_date: occurrenceDate,
        duration_minutes: durationMinutes,
        completed_at: now,
        metadata: input.notes ? JSON.stringify({ notes: input.notes, title: activity.title }) : JSON.stringify({ title: activity.title })
      }).onConflict(
        (oc) => oc.columns(["activity_id", "occurrence_date"]).doUpdateSet({
          duration_minutes: durationMinutes,
          completed_at: now,
          metadata: input.notes ? JSON.stringify({ notes: input.notes, title: activity.title }) : JSON.stringify({ title: activity.title })
        })
      ).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto("goal_events").values({
        user_id: userId,
        source_type: "completion",
        activity_id: activity.id,
        group_id: activity.group_id,
        completion_id: completion2.id,
        occurred_at: now,
        occurrence_date: occurrenceDate,
        metric: "count",
        amount: 1,
        metadata: null,
        created_at: now
      }).execute();
      let minutes = durationMinutes;
      if (minutes == null) {
        const [sh, sm] = activity.start_time.split(":").map(Number);
        const [eh, em] = activity.end_time.split(":").map(Number);
        const derived = eh * 60 + em - (sh * 60 + sm);
        if (derived > 0) minutes = derived;
      }
      if (minutes != null && minutes > 0) {
        await trx.insertInto("goal_events").values({
          user_id: userId,
          source_type: "completion",
          activity_id: activity.id,
          group_id: activity.group_id,
          completion_id: completion2.id,
          occurred_at: now,
          occurrence_date: occurrenceDate,
          metric: "duration",
          amount: minutes,
          metadata: null,
          created_at: now
        }).execute();
      }
      return completion2;
    });
    await recomputeAffectedCycles(db, userId, {
      activityId: activity.id,
      groupId: activity.group_id
    });
    const granted = await db.transaction().execute(async (trx) => {
      return await grantRewardsForActivityCompletion(trx, {
        userId,
        activityId: activity.id,
        completionId: completion.id
      });
    });
    return {
      ...completion,
      grantedRewards: granted.filter((g) => !g.skipped && g.transaction).map((g) => g.transaction)
    };
  },
  undoCompletion: async (args) => {
    const userId = requireUserId3();
    const existing = await db.selectFrom("activity_completions").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!existing) return false;
    const activity = await fetchOwnedActivity(existing.activity_id, userId);
    await db.transaction().execute(async (trx) => {
      const manager = new DbInventoryManager();
      await manager.revokeUnconsumedForCompletion(trx, userId, existing.id);
      await trx.deleteFrom("goal_events").where("completion_id", "=", existing.id).execute();
      await trx.deleteFrom("activity_completions").where("id", "=", existing.id).execute();
    });
    await recomputeAffectedCycles(db, userId, {
      activityId: existing.activity_id,
      groupId: activity?.group_id ?? null
    });
    return true;
  },
  logTime: async (args) => {
    const userId = requireUserId3();
    const { input } = args;
    const minutes = validatePositiveDuration(input.durationMinutes);
    const occurrenceDate = validateOccurrenceDate(
      input.occurrenceDate ?? (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)
    );
    const activity = await fetchOwnedActivity(input.activityId, userId);
    if (!activity) {
      throw new InvalidCompletionError("activity not found");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const event = await db.insertInto("goal_events").values({
      user_id: userId,
      source_type: "time_log",
      activity_id: activity.id,
      group_id: activity.group_id,
      completion_id: null,
      occurred_at: now,
      occurrence_date: occurrenceDate,
      metric: "duration",
      amount: minutes,
      metadata: input.notes ? JSON.stringify({ notes: input.notes }) : null,
      created_at: now
    }).returningAll().executeTakeFirstOrThrow();
    await recomputeAffectedCycles(db, userId, {
      activityId: activity.id,
      groupId: activity.group_id
    });
    return {
      ...event,
      amount: asNumber(event.amount)
    };
  },
  ...GoalMutation,
  ...RewardMutation
};
var resolvers = {
  Query,
  Mutation
};

// src/auth/verify.ts
import { createRemoteJWKSet, jwtVerify } from "jose";
var AUTH_API_DOMAIN = typeof process !== "undefined" && process.env?.AUTH_API_DOMAIN || "http://localhost:3001";
var JWKS_URL = `${AUTH_API_DOMAIN}/auth/jwt/jwks.json`;
var jwks = createRemoteJWKSet(new URL(JWKS_URL));
async function verifyAccessToken(authorizationHeader) {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authorizationHeader.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, jwks, {
      algorithms: ["RS256"]
    });
    const authUserId = typeof payload.sub === "string" ? payload.sub : null;
    if (!authUserId) {
      return null;
    }
    const email = typeof payload.email === "string" ? payload.email : void 0;
    return { authUserId, email };
  } catch {
    return null;
  }
}
function unauthorizedResponse() {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, st-auth-mode",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    }
  });
}
async function corsMiddleware(ctx, next) {
  if (ctx.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, st-auth-mode",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
      }
    });
  }
  await next();
  ctx.res.headers.set("Access-Control-Allow-Origin", "*");
  ctx.res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, st-auth-mode"
  );
  ctx.res.headers.set(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
}

// src/db/users.ts
async function resolveLocalUser(identity) {
  const existing = await db.selectFrom("users").where("auth_user_id", "=", identity.authUserId).selectAll().executeTakeFirst();
  if (existing) {
    return existing;
  }
  const email = identity.email?.trim() || `${identity.authUserId}@users.local`;
  const name = identity.name?.trim() || email.split("@")[0] || "User";
  const byEmail = await db.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
  if (byEmail) {
    return await db.updateTable("users").set({
      auth_user_id: identity.authUserId,
      name: byEmail.name || name,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", byEmail.id).returningAll().executeTakeFirstOrThrow();
  }
  return await db.insertInto("users").values({
    email,
    name,
    auth_user_id: identity.authUserId,
    password_hash: null
  }).returningAll().executeTakeFirstOrThrow();
}

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
app.use(corsMiddleware);
async function resolveUserIdFromRequest(authorization) {
  const verified = await verifyAccessToken(authorization);
  if (!verified) return null;
  const localUser = await resolveLocalUser({
    authUserId: verified.authUserId,
    email: verified.email
  });
  return localUser.id;
}
app.use(async (ctx, next) => {
  if (ctx.req.method === "OPTIONS") {
    await next();
    return;
  }
  const path = new URL(ctx.req.url).pathname;
  if (path === "/assets" && ctx.req.method === "POST") {
    const userId = await resolveUserIdFromRequest(
      ctx.req.header("Authorization")
    );
    if (userId == null) return unauthorizedResponse();
    try {
      const contentType = ctx.req.header("Content-Type")?.toLowerCase() ?? "";
      let bytes;
      let mime = "application/octet-stream";
      let filename;
      if (contentType.includes("multipart/form-data")) {
        const form = await ctx.req.formData();
        const file = form.get("file");
        if (!file || typeof file === "string") {
          return jsonError("file field required", 400);
        }
        const blob = file;
        mime = blob.type || "application/octet-stream";
        filename = blob.name;
        const buf = await blob.arrayBuffer();
        bytes = new Uint8Array(buf);
      } else {
        mime = contentType.split(";")[0].trim() || "application/octet-stream";
        const buf = await ctx.req.arrayBuffer();
        bytes = new Uint8Array(buf);
      }
      if (bytes.byteLength > MAX_ASSET_BYTES) {
        return jsonError("file too large", 413);
      }
      const repo = createDefaultAssetRepository(db);
      const asset = await repo.put({
        userId,
        bytes,
        contentType: mime,
        filename
      });
      return new Response(
        JSON.stringify({
          id: asset.id,
          sha256: asset.sha256,
          contentType: asset.content_type,
          byteSize: asset.byte_size,
          url: `/assets/${asset.id}`
        }),
        {
          status: 201,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          }
        }
      );
    } catch (err) {
      if (err instanceof AssetValidationError) {
        return jsonError(err.message, err.status);
      }
      console.error("asset upload failed", err);
      return jsonError("upload failed", 500);
    }
  }
  const assetMatch = path.match(/^\/assets\/(\d+)$/);
  if (assetMatch && ctx.req.method === "GET") {
    const userId = await resolveUserIdFromRequest(
      ctx.req.header("Authorization")
    );
    if (userId == null) return unauthorizedResponse();
    const assetId = Number(assetMatch[1]);
    const repo = createDefaultAssetRepository(db);
    const result2 = await repo.readBytes(assetId, userId);
    if (!result2) {
      return jsonError("not found", 404);
    }
    return new Response(result2.bytes.buffer.slice(
      result2.bytes.byteOffset,
      result2.bytes.byteOffset + result2.bytes.byteLength
    ), {
      status: 200,
      headers: {
        "Content-Type": result2.contentType,
        "Cache-Control": "private, max-age=3600",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  if (path !== "/graphql" && !path.endsWith("/graphql")) {
    await next();
    return;
  }
  const verified = await verifyAccessToken(ctx.req.header("Authorization"));
  if (!verified) {
    return unauthorizedResponse();
  }
  const localUser = await resolveLocalUser({
    authUserId: verified.authUserId,
    email: verified.email
  });
  ctx.set("authUserId", verified.authUserId);
  if (verified.email) {
    ctx.set("authEmail", verified.email);
  }
  ctx.set("userId", localUser.id);
  await next();
});
function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
var graphql = {
  ...resolvers
};
var src_default = app;
var __internalPylonConfig = void 0;
try {
  __internalPylonConfig = config;
} catch {
}
app.use(__internalPylonHandler({
  typeDefs: 'input ArgsInput {\n	filter: RewardDefinitionsFilterInput\n}\ninput RewardDefinitionsFilterInput {\n	includeArchived: Boolean\n	search: String\n	category: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	filter: RewardInventoryFilterInput\n}\ninput RewardInventoryFilterInput {\n	search: String\n	stackableOnly: Boolean\n	sort: NAME_QUANTITY_RECENTInput\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_3 {\n	filter: RewardHistoryFilterInput\n}\ninput RewardHistoryFilterInput {\n	definitionId: Number\n	type: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_4 {\n	sourceType: String!\n	sourceId: Number!\n}\ninput ArgsInput_5 {\n	limit: Number\n}\ninput ArgsInput_6 {\n	status: String\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ninput ArgsInput_8 {\n	date: String\n}\ninput ArgsInput_9 {\n	id: Number!\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	activityId: Number\n	fromDate: String\n	toDate: String\n}\ninput ArgsInput_12 {\n	input: CreateRewardDefinitionInputInput!\n}\ninput CreateRewardDefinitionInputInput {\n	name: String!\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String!\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_13 {\n	id: Number!\n	input: UpdateRewardDefinitionInputInput!\n}\ninput UpdateRewardDefinitionInputInput {\n	name: String\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_14 {\n	id: Number!\n}\ninput ArgsInput_15 {\n	id: Number!\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ninput ArgsInput_17 {\n	input: AttachRewardRuleInputInput!\n}\ninput AttachRewardRuleInputInput {\n	sourceType: String!\n	sourceId: Number!\n	rewardDefinitionId: Number!\n	quantity: Number\n	mode: FIXED_PROBABILITY_RANDOM_POOLInput\n	configJson: String\n	enabled: Boolean\n}\ninput ArgsInput_18 {\n	id: Number!\n}\ninput ArgsInput_19 {\n	input: ConsumeRewardInputInput!\n}\ninput ConsumeRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_20 {\n	input: DiscardRewardInputInput!\n}\ninput DiscardRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n}\ninput ArgsInput_21 {\n	transactionId: Number!\n}\ninput ArgsInput_22 {\n	input: ManualGrantRewardInputInput!\n}\ninput ManualGrantRewardInputInput {\n	rewardDefinitionId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_23 {\n	input: CreateGoalInputInput!\n}\ninput CreateGoalInputInput {\n	title: String!\n	description: String\n	color: String!\n	icon: String\n	ruleType: String!\n	metric: COUNT_DURATIONInput!\n	targetValue: Number!\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	priority: Number\n	sortOrder: Number\n}\ninput GoalConfigInputInput {\n	compositeMode: ALL_ANY_WEIGHTEDInput\n	countRequired: Number\n	beforeTime: String\n	afterTime: String\n	blockUntilUnlocked: Boolean\n}\ninput GoalLinkInputInput {\n	linkType: ACTIVITY_GROUPInput!\n	activityId: Number\n	groupId: Number\n	weight: Number\n}\ninput GoalDependencyInputInput {\n	dependsOnGoalId: Number!\n	requirement: COMPLETE_PROGRESSInput\n	threshold: Number\n	weight: Number\n}\ninput GoalRecurrenceInputInput {\n	period: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput!\n	interval: Number\n	anchor: String\n	carryOver: NONE_OVERFLOWInput\n	reset: String\n}\ninput GoalDeadlineInputInput {\n	kind: ABSOLUTE_RELATIVEInput!\n	date: String\n	daysAfterCycleStart: Number\n	graceDays: Number\n	warnDays: Number\n}\ninput ArgsInput_24 {\n	id: Number!\n	input: UpdateGoalInputInput!\n}\ninput UpdateGoalInputInput {\n	title: String\n	description: String\n	color: String\n	icon: String\n	ruleType: String\n	metric: COUNT_DURATIONInput\n	targetValue: Number\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	confirmStartsAtChange: Boolean\n	status: ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput\n	priority: Number\n	sortOrder: Number\n}\ninput ArgsInput_25 {\n	id: Number!\n}\ninput ArgsInput_26 {\n	id: Number!\n}\ninput ArgsInput_27 {\n	id: Number!\n}\ninput ArgsInput_28 {\n	id: Number!\n}\ninput ArgsInput_29 {\n	input: CreateGroupInputInput!\n}\ninput CreateGroupInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_30 {\n	id: Number!\n	input: UpdateGroupInputInput!\n}\ninput UpdateGroupInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_31 {\n	id: Number!\n}\ninput ArgsInput_32 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_33 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput ArgsInput_34 {\n	id: Number!\n}\ninput ArgsInput_35 {\n	input: CompleteActivityInputInput!\n}\ninput CompleteActivityInputInput {\n	activityId: Number!\n	occurrenceDate: String!\n	durationMinutes: Number\n	notes: String\n}\ninput ArgsInput_36 {\n	id: Number!\n}\ninput ArgsInput_37 {\n	input: LogTimeInputInput!\n}\ninput LogTimeInputInput {\n	activityId: Number!\n	durationMinutes: Number!\n	occurrenceDate: String\n	notes: String\n}\ntype Query {\nrewardDefinitions(args: ArgsInput!): [RewardDefinitions!]!\nrewardDefinition(args: ArgsInput_1!): RewardDefinitions\nrewardInventory(args: ArgsInput_2!): [RewardInventory!]!\nrewardHistory(args: ArgsInput_3!): [RewardHistory!]!\nrewardRules(args: ArgsInput_4!): [RewardRules!]!\nrecentAssets(args: ArgsInput_5!): [RecentAssets!]!\nrewardNudges(_args: Object): [RewardNudge!]!\ngoals(args: ArgsInput_6): [Goals!]!\ngoal(args: ArgsInput_7!): Goals\ngoalNudges(args: Object): [GoalNudge!]!\ndailyProgress(args: ArgsInput_8): DailyProgress!\ngroups(args: Object): [Groups!]!\ngroup(args: ArgsInput_9!): Groups\nactivities(args: Object): [Activities!]!\nactivity(args: ArgsInput_10!): Activities\nactivityCompletions(args: ArgsInput_11): [ActivityCompletions!]!\n}\ntype RewardDefinitions {\ntags: [String!]!\nimage_url: String\nimage: Image\nuser_id: Number!\nid: Number!\nname: String!\ndescription: String\nnotes: String\ncategory: String\ncolor: String!\nicon: String\nimage_asset_id: Number\nstackable: Boolean!\ndefault_quantity: Number!\nsort_order: Number!\narchived_at: Date\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Image {\nurl: String!\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\norphaned_at: Date\n}\ntype RewardInventory {\ndefinition: RewardDefinitions\nuser_id: Number!\nid: Number!\nupdated_at: Date!\nreward_definition_id: Number!\nquantity: Number!\nstack_key: String\nfirst_earned_at: Date!\nlast_earned_at: Date!\n}\ntype RewardHistory {\nmetadata: Any!\nuser_id: Number!\nid: Number!\nimage_asset_id: Number\ncreated_at: Date!\nactivity_id: Number\nreward_definition_id: Number\nquantity: Number!\ntype: RewardTransactionType!\ninventory_id: Number\ndefinition_name: String!\ndefinition_color: String!\ndefinition_icon: String\nsource_type: String\nsource_id: Number\ntrigger_key: String\nrule_id: Number\ngoal_id: Number\ncompletion_id: Number\ncycle_id: Number\nnote: String\n}\ntype RewardRules {\nconfig: RewardRuleConfig!\ndefinition: RewardDefinitions\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nreward_definition_id: Number!\nquantity: Number!\nsource_type: String!\nsource_id: Number!\nmode: RewardRuleMode!\nenabled: Boolean!\n}\ntype RewardRuleConfig {\nonce: Boolean\ncooldown_hours: Number\nmax_grants_total: Number\nmax_grants_per_period: Number\nperiod_hours: Number\nprobability: Number\n"""\nPool of definition ids for random_pool mode.\n"""\npool: [Pool!]\n}\ntype Pool {\ndefinition_id: Number!\nweight: Number\nquantity: Number\n}\ntype RecentAssets {\nurl: String!\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\norphaned_at: Date\n}\ntype RewardNudge {\nkind: RewardNudgeKind!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS!\ndefinitionId: Number\ninventoryId: Number\n}\ntype Goals {\ntarget_value: Number!\nstartsAt: String!\nlifecyclePhase: GoalLifecyclePhase!\nconfig: GoalConfig!\nrecurrence: GoalRecurrenceConfig\ndeadline: GoalDeadlineConfig\nlinks: [Links!]!\nactiveCycle: ActiveCycle\ncycles: [CyclesAndCycles_1!]!\ndependencies: [Dependencies!]!\nsnapshots: [Snapshots!]!\nisLocked: Boolean!\nuser_id: Number!\nid: Number!\ndescription: String\ncolor: String!\nicon: String\nsort_order: Number!\ncreated_at: Date!\nupdated_at: Date!\ntitle: String!\nrule_type: String!\nmetric: GoalMetric!\nstatus: GoalStatus!\npriority: Number!\nstarts_at: Date!\n}\ntype GoalConfig {\ncomposite_mode: ALL_ANY_WEIGHTED\ncount_required: Number\nbefore_time: String\nafter_time: String\nblock_until_unlocked: Boolean\n}\ntype GoalRecurrenceConfig {\nperiod: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS!\ninterval: Number\nanchor: String\ncarry_over: NONE_OVERFLOW\nreset: String\n}\ntype GoalDeadlineConfig {\nkind: ABSOLUTE_RELATIVE!\ndate: String\ndays_after_cycle_start: Number\ngrace_days: Number\nwarn_days: Number\n}\ntype Links {\nactivity: Activity\ngroup: Groups\nweight: Number!\nid: Number!\ncreated_at: Date!\nactivity_id: Number\ngoal_id: Number!\nlink_type: GoalLinkType!\ngroup_id: Number\n}\ntype Activity {\nuser_id: Number!\nid: Number!\ndescription: String\ncreated_at: Date!\nupdated_at: Date!\ntitle: String!\ngroup_id: Number\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\nnotification_offsets: [Number!]!\n}\ntype Groups {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype ActiveCycle {\ndeadlineState: DeadlineState!\npercentComplete: Number!\nremaining: Number!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\ngoal_id: Number!\ntarget_value: Number!\nstatus: GoalCycleStatus!\nstarts_at: Date!\ncycle_index: Number!\nends_at: Date\ndeadline_at: Date\ncurrent_value: Number!\ncarry_over: Number!\n}\ntype CyclesAndCycles_1 {\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\ngoal_id: Number!\ntarget_value: Number!\nstatus: GoalCycleStatus!\nstarts_at: Date!\ncycle_index: Number!\nends_at: Date\ndeadline_at: Date\ncurrent_value: Number!\ncarry_over: Number!\n}\ntype Dependencies {\ndependsOn: Goals\nthreshold: Number\nweight: Number!\nid: Number!\ncreated_at: Date!\ngoal_id: Number!\ndepends_on_goal_id: Number!\nrequirement: GoalDependencyRequirement!\n}\ntype Snapshots {\nvalue: Number!\nid: Number!\ncreated_at: Date!\ngoal_cycle_id: Number!\nas_of: String!\n}\ntype GoalNudge {\nkind: GoalNudgeKind!\ngoalId: Number!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS_WARNING!\n}\ntype DailyProgress {\ndate: String!\ncompletedCount: Number!\nminutesToday: Number!\nstreakDays: Number!\ncompletions: [ActivityCompletions!]!\n}\ntype ActivityCompletions {\nuser_id: Number!\nid: Number!\nactivity_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata\n}\ntype Metadata {\ntitle: String\nnotes: String\ntrigger_events: [String!]\n}\ntype Activities {\nrecurrencePattern: ParsedRecurrencePattern\ngroup: Group\nuser_id: Number!\nid: Number!\ndescription: String\ncreated_at: Date!\nupdated_at: Date!\ntitle: String!\ngroup_id: Number\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\nnotification_offsets: [Number!]!\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype Group {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Mutation {\ncreateRewardDefinition(args: ArgsInput_12!): RewardDefinitions!\nupdateRewardDefinition(args: ArgsInput_13!): RewardDefinitions!\narchiveRewardDefinition(args: ArgsInput_14!): RewardDefinitions!\nunarchiveRewardDefinition(args: ArgsInput_15!): RewardDefinitions!\ndeleteRewardDefinition(args: ArgsInput_16!): Boolean!\nattachRewardRule(args: ArgsInput_17!): RewardRules!\ndetachRewardRule(args: ArgsInput_18!): Boolean!\nconsumeReward(args: ArgsInput_19!): ConsumeReward!\ndiscardReward(args: ArgsInput_20!): DiscardReward!\nrestoreReward(args: ArgsInput_21!): RestoreReward!\nmanualGrantReward(args: ArgsInput_22!): RewardHistory\nrecomputeRewardInventory: Boolean!\ncreateGoal(args: ArgsInput_23!): Goals!\nupdateGoal(args: ArgsInput_24!): Goals!\npauseGoal(args: ArgsInput_25!): Goals!\nresumeGoal(args: ArgsInput_26!): Goals!\narchiveGoal(args: ArgsInput_27!): Goals!\ndeleteGoal(args: ArgsInput_28!): Boolean!\nrecomputeGoalProgress(args: Object): RecomputeGoalProgress!\ncreateGroup(args: ArgsInput_29!): CreateGroup!\nupdateGroup(args: ArgsInput_30!): CreateGroup!\ndeleteGroup(args: ArgsInput_31!): Boolean!\ncreateActivity(args: ArgsInput_32!): Activities!\nupdateActivity(args: ArgsInput_33!): Activities!\ndeleteActivity(args: ArgsInput_34!): Boolean!\ncompleteActivity(args: ArgsInput_35!): CompleteActivity!\nundoCompletion(args: ArgsInput_36!): Boolean!\nlogTime(args: ArgsInput_37!): LogTime!\n}\ntype ConsumeReward {\ninventory: RewardInventory\ntransaction: RewardHistory!\n}\ntype DiscardReward {\ninventory: RewardInventory\ntransaction: RewardHistory!\n}\ntype RestoreReward {\ninventory: RewardInventory!\ntransaction: RewardHistory!\n}\ntype RecomputeGoalProgress {\nrecomputed: Number!\n}\ntype CreateGroup {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype CompleteActivity {\ngrantedRewards: [GrantedRewards]!\nuser_id: Number!\nid: Number!\nactivity_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata\n}\ntype GrantedRewards {\nuser_id: Number!\nid: Number!\nimage_asset_id: Number\ncreated_at: Date!\nactivity_id: Number\nmetadata: Object\nreward_definition_id: Number\nquantity: Number!\ntype: RewardTransactionType!\ninventory_id: Number\ndefinition_name: String!\ndefinition_color: String!\ndefinition_icon: String\nsource_type: String\nsource_id: Number\ntrigger_key: String\nrule_id: Number\ngoal_id: Number\ncompletion_id: Number\ncycle_id: Number\nnote: String\n}\ntype LogTime {\namount: Number!\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nactivity_id: Number\noccurrence_date: String\nmetadata: Object\nsource_type: GoalEventSourceType!\ncompletion_id: Number\nmetric: GoalEventMetric!\ngroup_id: Number\noccurred_at: Date!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum RewardTransactionType {\n	earn\n	consume\n	delete\n	restore\n	adjust\n}\nenum RewardRuleMode {\n	fixed\n	probability\n	random_pool\n}\nenum RewardNudgeKind {\n	inventory_available\n	recently_earned\n	unconsumed_stack\n}\nenum INFO_SUCCESS {\n	info\n	success\n}\nenum GoalLifecyclePhase {\n	active\n	paused\n	completed\n	archived\n	failed\n	scheduled\n}\nenum GoalMetric {\n	count\n	duration\n}\nenum GoalStatus {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum ALL_ANY_WEIGHTED {\n	all\n	any\n	weighted\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOW {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVE {\n	absolute\n	relative\n}\nenum GoalLinkType {\n	activity\n	group\n}\nenum DeadlineState {\n	failed\n	on_track\n	approaching\n	overdue\n}\nenum GoalCycleStatus {\n	active\n	failed\n	succeeded\n	missed\n}\nenum GoalDependencyRequirement {\n	complete\n	progress\n}\nenum GoalNudgeKind {\n	deadline_approaching\n	deadline_overdue\n	behind_pace\n	cycle_complete\n	dependency_unlocked\n	goal_starting_soon\n}\nenum INFO_SUCCESS_WARNING {\n	info\n	success\n	warning\n}\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum GoalEventSourceType {\n	completion\n	time_log\n	manual\n}\nenum GoalEventMetric {\n	count\n	duration\n}\nenum NAME_QUANTITY_RECENTInput {\n	name\n	quantity\n	recent\n}\nenum FIXED_PROBABILITY_RANDOM_POOLInput {\n	fixed\n	probability\n	random_pool\n}\nenum COUNT_DURATIONInput {\n	count\n	duration\n}\nenum ALL_ANY_WEIGHTEDInput {\n	all\n	any\n	weighted\n}\nenum ACTIVITY_GROUPInput {\n	activity\n	group\n}\nenum COMPLETE_PROGRESSInput {\n	complete\n	progress\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOWInput {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVEInput {\n	absolute\n	relative\n}\nenum ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n',
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3Jld2FyZHMvaW52ZW50b3J5LnRzIiwgIi4uL3NyYy9yZXdhcmRzL3J1bGVzL2V2YWx1YXRlLnRzIiwgIi4uL3NyYy9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMiLCAiLi4vc3JjL3Jld2FyZHMvc291cmNlcy9pbmRleC50cyIsICIuLi9zcmMvcmV3YXJkcy9ob29rcy50cyIsICIuLi9zcmMvcmV3YXJkcy9udWRnZXMudHMiLCAiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dvYWxzL2xpZmVjeWNsZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ29hbHMvcHJvZ3Jlc3MudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9ncmFwaHFsL25vdGlmaWNhdGlvbl9vZmZzZXRzLnRzIiwgIi4uL3NyYy9ncmFwaHFsL251bWVyaWMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL2dvYWxzX3Jlc29sdmVycy50cyIsICIuLi9zcmMvZ29hbHMvY3ljbGVzLnRzIiwgIi4uL3NyYy9nb2Fscy9udWRnZXMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL3Jld2FyZHNfcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9hc3NldHMvaGFzaGluZy50cyIsICIuLi9zcmMvYXNzZXRzL3N0b3JhZ2UvbG9jYWxfZnMudHMiLCAiLi4vc3JjL2Fzc2V0cy9zdG9yYWdlL3MzLnRzIiwgIi4uL3NyYy9hc3NldHMvc3RvcmFnZS90eXBlcy50cyIsICIuLi9zcmMvYXNzZXRzL3JlcG9zaXRvcnkudHMiLCAiLi4vc3JjL2F1dGgvdmVyaWZ5LnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgTmV3UmV3YXJkSW52ZW50b3J5LFxuICBOZXdSZXdhcmRUcmFuc2FjdGlvbixcbiAgUmV3YXJkRGVmaW5pdGlvbixcbiAgUmV3YXJkSW52ZW50b3J5LFxuICBSZXdhcmRUcmFuc2FjdGlvbixcbn0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHR5cGUgeyBHcmFudEluc3RydWN0aW9uIH0gZnJvbSAnLi9ydWxlcy9ldmFsdWF0ZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW52ZW50b3J5TWFuYWdlciB7XG4gIGFwcGx5RWFybihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uLFxuICAgIGluc3RydWN0aW9uOiBHcmFudEluc3RydWN0aW9uLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnk7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PlxuXG4gIGFwcGx5Q29uc3VtZShcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICAgbm90ZT86IHN0cmluZyB8IG51bGwsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PlxuXG4gIGFwcGx5RGlzY2FyZChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PlxuXG4gIGFwcGx5UmVzdG9yZShcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBjb25zdW1lVHJhbnNhY3Rpb25JZDogbnVtYmVyLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnk7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PlxuXG4gIHJldm9rZVVuY29uc3VtZWRGb3JDb21wbGV0aW9uKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyLFxuICApOiBQcm9taXNlPG51bWJlcj5cbn1cblxuZnVuY3Rpb24gc25hcHNob3RGaWVsZHMoZGVmaW5pdGlvbjogUmV3YXJkRGVmaW5pdGlvbikge1xuICByZXR1cm4ge1xuICAgIGRlZmluaXRpb25fbmFtZTogZGVmaW5pdGlvbi5uYW1lLFxuICAgIGRlZmluaXRpb25fY29sb3I6IGRlZmluaXRpb24uY29sb3IsXG4gICAgZGVmaW5pdGlvbl9pY29uOiBkZWZpbml0aW9uLmljb24sXG4gICAgaW1hZ2VfYXNzZXRfaWQ6IGRlZmluaXRpb24uaW1hZ2VfYXNzZXRfaWQsXG4gIH1cbn1cblxuZnVuY3Rpb24gbmV3U3RhY2tLZXkoKTogc3RyaW5nIHtcbiAgcmV0dXJuIGNyeXB0by5yYW5kb21VVUlEKClcbn1cblxuZXhwb3J0IGNsYXNzIERiSW52ZW50b3J5TWFuYWdlciBpbXBsZW1lbnRzIEludmVudG9yeU1hbmFnZXIge1xuICBhc3luYyBhcHBseUVhcm4oXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgZGVmaW5pdGlvbjogUmV3YXJkRGVmaW5pdGlvbixcbiAgICBpbnN0cnVjdGlvbjogR3JhbnRJbnN0cnVjdGlvbixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5OyB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfT4ge1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHNuYXAgPSBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uKVxuXG4gICAgbGV0IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5XG5cbiAgICBpZiAoZGVmaW5pdGlvbi5zdGFja2FibGUpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGRlZmluaXRpb24uaWQpXG4gICAgICAgIC53aGVyZSgnc3RhY2tfa2V5JywgJ2lzJywgbnVsbClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICBxdWFudGl0eTogZXhpc3RpbmcucXVhbnRpdHkgKyBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSlcbiAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgICBxdWFudGl0eTogaW5zdHJ1Y3Rpb24ucXVhbnRpdHksXG4gICAgICAgICAgICBzdGFja19rZXk6IG51bGwsXG4gICAgICAgICAgICBmaXJzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdSZXdhcmRJbnZlbnRvcnkpXG4gICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gTm9uLXN0YWNrYWJsZTogb25lIHJvdyBwZXIgZ3JhbnRlZCB1bml0IChxdWFudGl0eSBhbHdheXMgMSBwZXIgcm93KS5cbiAgICAgIC8vIElmIGluc3RydWN0aW9uLnF1YW50aXR5ID4gMSwgY3JlYXRlIG11bHRpcGxlIHJvd3M7IHJldHVybiB0aGUgbGFzdC5cbiAgICAgIGxldCBsYXN0ITogUmV3YXJkSW52ZW50b3J5XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IGluc3RydWN0aW9uLnF1YW50aXR5OyBpKyspIHtcbiAgICAgICAgbGFzdCA9IGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICAgICAgcXVhbnRpdHk6IDEsXG4gICAgICAgICAgICBzdGFja19rZXk6IG5ld1N0YWNrS2V5KCksXG4gICAgICAgICAgICBmaXJzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdSZXdhcmRJbnZlbnRvcnkpXG4gICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIH1cbiAgICAgIGludmVudG9yeSA9IGxhc3RcbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgdHlwZTogJ2Vhcm4nLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgaW52ZW50b3J5X2lkOiBpbnZlbnRvcnkuaWQsXG4gICAgICAgIHF1YW50aXR5OiBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICAgICAgLi4uc25hcCxcbiAgICAgICAgc291cmNlX3R5cGU6IGluc3RydWN0aW9uLnNvdXJjZVR5cGUsXG4gICAgICAgIHNvdXJjZV9pZDogaW5zdHJ1Y3Rpb24uc291cmNlSWQsXG4gICAgICAgIHRyaWdnZXJfa2V5OiBpbnN0cnVjdGlvbi50cmlnZ2VyS2V5LFxuICAgICAgICBydWxlX2lkOiBpbnN0cnVjdGlvbi5ydWxlSWQsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBpbnN0cnVjdGlvbi5hY3Rpdml0eUlkID8/IG51bGwsXG4gICAgICAgIGdvYWxfaWQ6IGluc3RydWN0aW9uLmdvYWxJZCA/PyBudWxsLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBpbnN0cnVjdGlvbi5jb21wbGV0aW9uSWQgPz8gbnVsbCxcbiAgICAgICAgY3ljbGVfaWQ6IGluc3RydWN0aW9uLmN5Y2xlSWQgPz8gbnVsbCxcbiAgICAgICAgbm90ZTogbnVsbCxcbiAgICAgICAgbWV0YWRhdGE6IG51bGwsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkVHJhbnNhY3Rpb24pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4geyBpbnZlbnRvcnksIHRyYW5zYWN0aW9uIH1cbiAgfVxuXG4gIGFzeW5jIGFwcGx5Q29uc3VtZShcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICAgbm90ZT86IHN0cmluZyB8IG51bGwsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgaW52ZW50b3J5SWQsXG4gICAgICBxdWFudGl0eSxcbiAgICAgICdjb25zdW1lJyxcbiAgICAgIG5vdGUgPz8gbnVsbCxcbiAgICApXG4gIH1cblxuICBhc3luYyBhcHBseURpc2NhcmQoXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW52ZW50b3J5SWQ6IG51bWJlcixcbiAgICBxdWFudGl0eTogbnVtYmVyLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnkgfCBudWxsOyB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfT4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRlY3JlbWVudChcbiAgICAgIHRyeCxcbiAgICAgIHVzZXJJZCxcbiAgICAgIGludmVudG9yeUlkLFxuICAgICAgcXVhbnRpdHksXG4gICAgICAnZGVsZXRlJyxcbiAgICAgIG51bGwsXG4gICAgKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBkZWNyZW1lbnQoXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW52ZW50b3J5SWQ6IG51bWJlcixcbiAgICBxdWFudGl0eTogbnVtYmVyLFxuICAgIHR5cGU6ICdjb25zdW1lJyB8ICdkZWxldGUnLFxuICAgIG5vdGU6IHN0cmluZyB8IG51bGwsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgaWYgKHF1YW50aXR5IDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdxdWFudGl0eSBtdXN0IGJlID49IDEnKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW52ZW50b3J5SWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFyb3cpIHRocm93IG5ldyBJbnZlbnRvcnlFcnJvcignaW52ZW50b3J5IGl0ZW0gbm90IGZvdW5kJylcbiAgICBpZiAocm93LnF1YW50aXR5IDwgcXVhbnRpdHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZlbnRvcnlFcnJvcignaW5zdWZmaWNpZW50IHF1YW50aXR5JylcbiAgICB9XG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIHJvdy5yZXdhcmRfZGVmaW5pdGlvbl9pZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgY29uc3Qgc25hcCA9IGRlZmluaXRpb25cbiAgICAgID8gc25hcHNob3RGaWVsZHMoZGVmaW5pdGlvbilcbiAgICAgIDoge1xuICAgICAgICAgIGRlZmluaXRpb25fbmFtZTogJ1Vua25vd24gcmV3YXJkJyxcbiAgICAgICAgICBkZWZpbml0aW9uX2NvbG9yOiAnIzY0NzQ4QicsXG4gICAgICAgICAgZGVmaW5pdGlvbl9pY29uOiBudWxsIGFzIHN0cmluZyB8IG51bGwsXG4gICAgICAgICAgaW1hZ2VfYXNzZXRfaWQ6IG51bGwgYXMgbnVtYmVyIHwgbnVsbCxcbiAgICAgICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3QgcmVtYWluaW5nID0gcm93LnF1YW50aXR5IC0gcXVhbnRpdHlcbiAgICBsZXQgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnkgfCBudWxsXG5cbiAgICBpZiAocmVtYWluaW5nID09PSAwKSB7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLmRlbGV0ZUZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cuaWQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIGludmVudG9yeSA9IG51bGxcbiAgICB9IGVsc2Uge1xuICAgICAgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC5zZXQoeyBxdWFudGl0eTogcmVtYWluaW5nLCB1cGRhdGVkX2F0OiBub3cgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LmlkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9XG5cbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgdHlwZSxcbiAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IHJvdy5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICAgICAgaW52ZW50b3J5X2lkOiByZW1haW5pbmcgPT09IDAgPyBudWxsIDogcm93LmlkLFxuICAgICAgICBxdWFudGl0eSxcbiAgICAgICAgLi4uc25hcCxcbiAgICAgICAgc291cmNlX3R5cGU6ICdtYW51YWwnLFxuICAgICAgICBzb3VyY2VfaWQ6IG51bGwsXG4gICAgICAgIHRyaWdnZXJfa2V5OiBudWxsLFxuICAgICAgICBydWxlX2lkOiBudWxsLFxuICAgICAgICBhY3Rpdml0eV9pZDogbnVsbCxcbiAgICAgICAgZ29hbF9pZDogbnVsbCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgY3ljbGVfaWQ6IG51bGwsXG4gICAgICAgIG5vdGUsXG4gICAgICAgIG1ldGFkYXRhOiByZW1haW5pbmcgPT09IDBcbiAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHsgY2xlYXJlZF9pbnZlbnRvcnlfaWQ6IHJvdy5pZCB9KVxuICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRUcmFuc2FjdGlvbilcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlSZXN0b3JlKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbnN1bWVUcmFuc2FjdGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICBjb25zdCBjb25zdW1lVHggPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGNvbnN1bWVUcmFuc2FjdGlvbklkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdjb25zdW1lJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFjb25zdW1lVHgpIHRocm93IG5ldyBJbnZlbnRvcnlFcnJvcignY29uc3VtZSB0cmFuc2FjdGlvbiBub3QgZm91bmQnKVxuICAgIGlmIChjb25zdW1lVHgucmV3YXJkX2RlZmluaXRpb25faWQgPT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdjYW5ub3QgcmVzdG9yZTogZGVmaW5pdGlvbiBtaXNzaW5nJylcbiAgICB9XG5cbiAgICAvLyBQcmV2ZW50IGRvdWJsZS1yZXN0b3JlLlxuICAgIGNvbnN0IGFscmVhZHkgPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCd0eXBlJywgJz0nLCAncmVzdG9yZScpXG4gICAgICAud2hlcmUoJ21ldGFkYXRhJywgJ2lzIG5vdCcsIG51bGwpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IHJlc3RvcmVkID0gYWxyZWFkeS5zb21lKCh0KSA9PiB7XG4gICAgICBjb25zdCBtZXRhID1cbiAgICAgICAgdHlwZW9mIHQubWV0YWRhdGEgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBKU09OLnBhcnNlKHQubWV0YWRhdGEpXG4gICAgICAgICAgOiB0Lm1ldGFkYXRhXG4gICAgICByZXR1cm4gbWV0YSAmJiBtZXRhLnJlc3RvcmVkX2Zyb20gPT09IGNvbnN1bWVUcmFuc2FjdGlvbklkXG4gICAgfSlcbiAgICBpZiAocmVzdG9yZWQpIHRocm93IG5ldyBJbnZlbnRvcnlFcnJvcignYWxyZWFkeSByZXN0b3JlZCcpXG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGNvbnN1bWVUeC5yZXdhcmRfZGVmaW5pdGlvbl9pZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGNvbnN0IGluc3RydWN0aW9uOiBHcmFudEluc3RydWN0aW9uID0ge1xuICAgICAgcnVsZUlkOiBudWxsLFxuICAgICAgZGVmaW5pdGlvbklkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgcXVhbnRpdHk6IGNvbnN1bWVUeC5xdWFudGl0eSxcbiAgICAgIHRyaWdnZXJLZXk6IGByZXN0b3JlOiR7Y29uc3VtZVRyYW5zYWN0aW9uSWR9YCxcbiAgICAgIHNvdXJjZVR5cGU6ICdtYW51YWwnLFxuICAgICAgc291cmNlSWQ6IDAsXG4gICAgfVxuXG4gICAgLy8gUmUtYXBwbHkgYXMgZWFybi1saWtlIGludmVudG9yeSBidW1wLCB0aGVuIHdyaXRlIHJlc3RvcmUgdHguXG4gICAgY29uc3QgeyBpbnZlbnRvcnkgfSA9IGF3YWl0IHRoaXMuYXBwbHlFYXJuV2l0aG91dExlZGdlcihcbiAgICAgIHRyeCxcbiAgICAgIHVzZXJJZCxcbiAgICAgIGRlZmluaXRpb24sXG4gICAgICBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICApXG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCB0cmFuc2FjdGlvbiA9IGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgdHlwZTogJ3Jlc3RvcmUnLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgaW52ZW50b3J5X2lkOiBpbnZlbnRvcnkuaWQsXG4gICAgICAgIHF1YW50aXR5OiBjb25zdW1lVHgucXVhbnRpdHksXG4gICAgICAgIC4uLnNuYXBzaG90RmllbGRzKGRlZmluaXRpb24pLFxuICAgICAgICBzb3VyY2VfdHlwZTogJ21hbnVhbCcsXG4gICAgICAgIHNvdXJjZV9pZDogbnVsbCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IGByZXN0b3JlOiR7Y29uc3VtZVRyYW5zYWN0aW9uSWR9YCxcbiAgICAgICAgcnVsZV9pZDogbnVsbCxcbiAgICAgICAgYWN0aXZpdHlfaWQ6IG51bGwsXG4gICAgICAgIGdvYWxfaWQ6IG51bGwsXG4gICAgICAgIGNvbXBsZXRpb25faWQ6IG51bGwsXG4gICAgICAgIGN5Y2xlX2lkOiBudWxsLFxuICAgICAgICBub3RlOiBudWxsLFxuICAgICAgICBtZXRhZGF0YTogSlNPTi5zdHJpbmdpZnkoeyByZXN0b3JlZF9mcm9tOiBjb25zdW1lVHJhbnNhY3Rpb25JZCB9KSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRUcmFuc2FjdGlvbilcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfVxuICB9XG5cbiAgLyoqIEludmVudG9yeSBidW1wIHdpdGhvdXQgd3JpdGluZyBhbiBlYXJuIGxlZGdlciByb3cgKHVzZWQgYnkgcmVzdG9yZSkuICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlFYXJuV2l0aG91dExlZGdlcihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB9PiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgaWYgKGRlZmluaXRpb24uc3RhY2thYmxlKSB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9uX2lkJywgJz0nLCBkZWZpbml0aW9uLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YWNrX2tleScsICdpcycsIG51bGwpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBjb25zdCBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgICAudXBkYXRlVGFibGUoJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC5zZXQoe1xuICAgICAgICAgICAgcXVhbnRpdHk6IGV4aXN0aW5nLnF1YW50aXR5ICsgcXVhbnRpdHksXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSlcbiAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgICByZXR1cm4geyBpbnZlbnRvcnkgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgc3RhY2tfa2V5OiBudWxsLFxuICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICByZXR1cm4geyBpbnZlbnRvcnkgfVxuICAgIH1cblxuICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgIHF1YW50aXR5OiAxLFxuICAgICAgICBzdGFja19rZXk6IG5ld1N0YWNrS2V5KCksXG4gICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICBsYXN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4geyBpbnZlbnRvcnkgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldm9rZSB1bmNvbnN1bWVkIHBvcnRpb24gb2YgZWFybnMgdGllZCB0byBhIGNvbXBsZXRpb24uXG4gICAqIE5ldmVyIGRyaXZlcyBpbnZlbnRvcnkgbmVnYXRpdmUuXG4gICAqL1xuICBhc3luYyByZXZva2VVbmNvbnN1bWVkRm9yQ29tcGxldGlvbihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBjb21wbGV0aW9uSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgICBjb25zdCBlYXJucyA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgIC53aGVyZSgnY29tcGxldGlvbl9pZCcsICc9JywgY29tcGxldGlvbklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBsZXQgcmV2b2tlZCA9IDBcbiAgICBmb3IgKGNvbnN0IGVhcm4gb2YgZWFybnMpIHtcbiAgICAgIGlmIChlYXJuLnJld2FyZF9kZWZpbml0aW9uX2lkID09IG51bGwpIGNvbnRpbnVlXG5cbiAgICAgIGNvbnN0IGludiA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9uX2lkJywgJz0nLCBlYXJuLnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgICBjb25zdCBhdmFpbGFibGUgPSBpbnYucmVkdWNlKChzLCByKSA9PiBzICsgci5xdWFudGl0eSwgMClcbiAgICAgIGNvbnN0IHRvUmV2b2tlID0gTWF0aC5taW4oZWFybi5xdWFudGl0eSwgYXZhaWxhYmxlKVxuICAgICAgaWYgKHRvUmV2b2tlIDw9IDApIGNvbnRpbnVlXG5cbiAgICAgIGxldCByZW1haW5pbmcgPSB0b1Jldm9rZVxuICAgICAgZm9yIChjb25zdCByb3cgb2YgaW52KSB7XG4gICAgICAgIGlmIChyZW1haW5pbmcgPD0gMCkgYnJlYWtcbiAgICAgICAgY29uc3QgdGFrZSA9IE1hdGgubWluKHJvdy5xdWFudGl0eSwgcmVtYWluaW5nKVxuICAgICAgICBhd2FpdCB0aGlzLmRlY3JlbWVudChcbiAgICAgICAgICB0cngsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICAgIHJvdy5pZCxcbiAgICAgICAgICB0YWtlLFxuICAgICAgICAgICdkZWxldGUnLFxuICAgICAgICAgIGByZXZva2VkOmNvbXBsZXRpb246JHtjb21wbGV0aW9uSWR9YCxcbiAgICAgICAgKVxuICAgICAgICByZW1haW5pbmcgLT0gdGFrZVxuICAgICAgICByZXZva2VkICs9IHRha2VcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHJldm9rZWRcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW52ZW50b3J5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmVudG9yeUVycm9yJ1xuICB9XG59XG5cbi8qKiBSZWJ1aWxkIGludmVudG9yeSBxdWFudGl0aWVzIGZyb20gdGhlIGxlZGdlciAocmVwYWlyKS4gRG9lcyBub3Qgd3JpdGUgbGVkZ2VyIHJvd3MuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlSW52ZW50b3J5RnJvbUxlZGdlcihcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgZGJcbiAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IHR4cyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2FzYycpXG4gICAgLm9yZGVyQnkoJ2lkJywgJ2FzYycpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IGRlZnMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKClcbiAgY29uc3QgZGVmTWFwID0gbmV3IE1hcChkZWZzLm1hcCgoZCkgPT4gW2QuaWQsIGRdKSlcblxuICBjb25zdCBuZXQgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpXG4gIGNvbnN0IGZpcnN0RWFybiA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KClcbiAgY29uc3QgbGFzdEVhcm4gPSBuZXcgTWFwPG51bWJlciwgc3RyaW5nPigpXG5cbiAgZm9yIChjb25zdCB0eCBvZiB0eHMpIHtcbiAgICBpZiAodHgucmV3YXJkX2RlZmluaXRpb25faWQgPT0gbnVsbCkgY29udGludWVcbiAgICBjb25zdCBkZWZJZCA9IHR4LnJld2FyZF9kZWZpbml0aW9uX2lkXG4gICAgY29uc3QgY3VyID0gbmV0LmdldChkZWZJZCkgPz8gMFxuICAgIGNvbnN0IGNyZWF0ZWQgPVxuICAgICAgdHlwZW9mIHR4LmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgID8gdHguY3JlYXRlZF9hdFxuICAgICAgICA6IG5ldyBEYXRlKHR4LmNyZWF0ZWRfYXQpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmICh0eC50eXBlID09PSAnZWFybicgfHwgdHgudHlwZSA9PT0gJ3Jlc3RvcmUnKSB7XG4gICAgICBuZXQuc2V0KGRlZklkLCBjdXIgKyB0eC5xdWFudGl0eSlcbiAgICAgIGlmICghZmlyc3RFYXJuLmhhcyhkZWZJZCkpIGZpcnN0RWFybi5zZXQoZGVmSWQsIGNyZWF0ZWQpXG4gICAgICBsYXN0RWFybi5zZXQoZGVmSWQsIGNyZWF0ZWQpXG4gICAgfSBlbHNlIGlmIChcbiAgICAgIHR4LnR5cGUgPT09ICdjb25zdW1lJyB8fFxuICAgICAgdHgudHlwZSA9PT0gJ2RlbGV0ZScgfHxcbiAgICAgIHR4LnR5cGUgPT09ICdhZGp1c3QnXG4gICAgKSB7XG4gICAgICBuZXQuc2V0KGRlZklkLCBNYXRoLm1heCgwLCBjdXIgLSB0eC5xdWFudGl0eSkpXG4gICAgfVxuICB9XG5cbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gIGZvciAoY29uc3QgW2RlZklkLCBxdHldIG9mIG5ldCkge1xuICAgIGlmIChxdHkgPD0gMCkgY29udGludWVcbiAgICBjb25zdCBkZWZpbml0aW9uID0gZGVmTWFwLmdldChkZWZJZClcbiAgICBpZiAoIWRlZmluaXRpb24pIGNvbnRpbnVlXG5cbiAgICBpZiAoZGVmaW5pdGlvbi5zdGFja2FibGUpIHtcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZJZCxcbiAgICAgICAgICBxdWFudGl0eTogcXR5LFxuICAgICAgICAgIHN0YWNrX2tleTogbnVsbCxcbiAgICAgICAgICBmaXJzdF9lYXJuZWRfYXQ6IGZpcnN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICBsYXN0X2Vhcm5lZF9hdDogbGFzdEVhcm4uZ2V0KGRlZklkKSA/PyBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHF0eTsgaSsrKSB7XG4gICAgICAgIGF3YWl0IGRiXG4gICAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZklkLFxuICAgICAgICAgICAgcXVhbnRpdHk6IDEsXG4gICAgICAgICAgICBzdGFja19rZXk6IG5ld1N0YWNrS2V5KCksXG4gICAgICAgICAgICBmaXJzdF9lYXJuZWRfYXQ6IGZpcnN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBsYXN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICB9XG4gICAgfVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUge1xuICBSZXdhcmRSdWxlLFxuICBSZXdhcmRSdWxlQ29uZmlnLFxuICBSZXdhcmRSdWxlTW9kZSxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdyYW50Q29udGV4dCB7XG4gIHVzZXJJZDogbnVtYmVyXG4gIHNvdXJjZVR5cGU6IHN0cmluZ1xuICBzb3VyY2VJZDogbnVtYmVyXG4gIHRyaWdnZXJLZXk6IHN0cmluZ1xuICBhY3Rpdml0eUlkPzogbnVtYmVyIHwgbnVsbFxuICBnb2FsSWQ/OiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRpb25JZD86IG51bWJlciB8IG51bGxcbiAgY3ljbGVJZD86IG51bWJlciB8IG51bGxcbiAgLyoqIFByaW9yIGVhcm4gY291bnQgZm9yIHRoaXMgcnVsZSAoZm9yIG9uY2UgLyBtYXhfZ3JhbnRzKS4gKi9cbiAgcHJpb3JFYXJuQ291bnQ6IG51bWJlclxuICAvKiogSVNPIHRpbWVzdGFtcCBvZiBsYXN0IGVhcm4gZm9yIHRoaXMgcnVsZSwgaWYgYW55LiAqL1xuICBsYXN0RWFybkF0OiBzdHJpbmcgfCBudWxsXG4gIG5vdz86IERhdGVcbiAgLyoqIFJORyBmb3IgcHJvYmFiaWxpdHkgLyByYW5kb21fcG9vbCAoaW5qZWN0YWJsZSBmb3IgdGVzdHMpLiAqL1xuICByYW5kb20/OiAoKSA9PiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHcmFudEluc3RydWN0aW9uIHtcbiAgcnVsZUlkOiBudW1iZXIgfCBudWxsXG4gIGRlZmluaXRpb25JZDogbnVtYmVyXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgdHJpZ2dlcktleTogc3RyaW5nXG4gIHNvdXJjZVR5cGU6IHN0cmluZ1xuICBzb3VyY2VJZDogbnVtYmVyXG4gIGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsXG4gIGdvYWxJZD86IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBjeWNsZUlkPzogbnVtYmVyIHwgbnVsbFxufVxuXG5mdW5jdGlvbiBwYXJzZUNvbmZpZyhjb25maWc6IFJld2FyZFJ1bGVbJ2NvbmZpZyddKTogUmV3YXJkUnVsZUNvbmZpZyB7XG4gIGlmIChjb25maWcgPT0gbnVsbCkgcmV0dXJuIHt9XG4gIGlmICh0eXBlb2YgY29uZmlnID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZShjb25maWcpIGFzIFJld2FyZFJ1bGVDb25maWdcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7fVxuICAgIH1cbiAgfVxuICByZXR1cm4gY29uZmlnIGFzIFJld2FyZFJ1bGVDb25maWdcbn1cblxuLyoqXG4gKiBFdmFsdWF0ZSBhIHNpbmdsZSByZXdhcmQgcnVsZSBhZ2FpbnN0IGEgZ3JhbnQgY29udGV4dC5cbiAqIFJldHVybnMgbnVsbCB3aGVuIHRoZSBydWxlIHNob3VsZCBub3QgZ3JhbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZVJ1bGUoXG4gIHJ1bGU6IFJld2FyZFJ1bGUsXG4gIGN0eDogR3JhbnRDb250ZXh0LFxuKTogR3JhbnRJbnN0cnVjdGlvbiB8IG51bGwge1xuICBpZiAoIXJ1bGUuZW5hYmxlZCkgcmV0dXJuIG51bGxcblxuICBjb25zdCBjb25maWcgPSBwYXJzZUNvbmZpZyhydWxlLmNvbmZpZylcbiAgY29uc3Qgbm93ID0gY3R4Lm5vdyA/PyBuZXcgRGF0ZSgpXG4gIGNvbnN0IHJhbmRvbSA9IGN0eC5yYW5kb20gPz8gTWF0aC5yYW5kb21cblxuICBpZiAoY29uZmlnLm9uY2UgJiYgY3R4LnByaW9yRWFybkNvdW50ID4gMCkgcmV0dXJuIG51bGxcblxuICBpZiAoXG4gICAgdHlwZW9mIGNvbmZpZy5tYXhfZ3JhbnRzX3RvdGFsID09PSAnbnVtYmVyJyAmJlxuICAgIGN0eC5wcmlvckVhcm5Db3VudCA+PSBjb25maWcubWF4X2dyYW50c190b3RhbFxuICApIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKFxuICAgIHR5cGVvZiBjb25maWcuY29vbGRvd25faG91cnMgPT09ICdudW1iZXInICYmXG4gICAgY29uZmlnLmNvb2xkb3duX2hvdXJzID4gMCAmJlxuICAgIGN0eC5sYXN0RWFybkF0XG4gICkge1xuICAgIGNvbnN0IGxhc3QgPSBuZXcgRGF0ZShjdHgubGFzdEVhcm5BdCkuZ2V0VGltZSgpXG4gICAgY29uc3QgY29vbGRvd25NcyA9IGNvbmZpZy5jb29sZG93bl9ob3VycyAqIDYwICogNjAgKiAxMDAwXG4gICAgaWYgKG5vdy5nZXRUaW1lKCkgLSBsYXN0IDwgY29vbGRvd25NcykgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGlmIChcbiAgICB0eXBlb2YgY29uZmlnLm1heF9ncmFudHNfcGVyX3BlcmlvZCA9PT0gJ251bWJlcicgJiZcbiAgICB0eXBlb2YgY29uZmlnLnBlcmlvZF9ob3VycyA9PT0gJ251bWJlcicgJiZcbiAgICBjb25maWcucGVyaW9kX2hvdXJzID4gMCAmJlxuICAgIGN0eC5sYXN0RWFybkF0XG4gICkge1xuICAgIC8vIExpZ2h0d2VpZ2h0IHBlcmlvZCBjaGVjazogaWYgbGFzdCBlYXJuIGlzIHdpdGhpbiBwZXJpb2QgYW5kIHdlJ3ZlXG4gICAgLy8gYWxyZWFkeSBoaXQgdGhlIGNhcCB2aWEgcHJpb3JFYXJuQ291bnQgYXBwcm94aW1hdGlvbiwgc2tpcC5cbiAgICAvLyBGdWxsIHBlcmlvZCBjb3VudGluZyBpcyBoYW5kbGVkIGJ5IGNhbGxlcnMgdGhhdCBzZXQgcHJpb3JFYXJuQ291bnRcbiAgICAvLyB0byB0aGUgY291bnQgd2l0aGluIHRoZSBwZXJpb2Qgd2luZG93IHdoZW4gcGVyaW9kX2hvdXJzIGlzIHNldC5cbiAgICBjb25zdCBwZXJpb2RNcyA9IGNvbmZpZy5wZXJpb2RfaG91cnMgKiA2MCAqIDYwICogMTAwMFxuICAgIGNvbnN0IGxhc3QgPSBuZXcgRGF0ZShjdHgubGFzdEVhcm5BdCkuZ2V0VGltZSgpXG4gICAgaWYgKFxuICAgICAgbm93LmdldFRpbWUoKSAtIGxhc3QgPCBwZXJpb2RNcyAmJlxuICAgICAgY3R4LnByaW9yRWFybkNvdW50ID49IGNvbmZpZy5tYXhfZ3JhbnRzX3Blcl9wZXJpb2RcbiAgICApIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHJ1bGUubW9kZSBhcyBSZXdhcmRSdWxlTW9kZVxuXG4gIGlmIChtb2RlID09PSAncHJvYmFiaWxpdHknKSB7XG4gICAgY29uc3QgcCA9XG4gICAgICB0eXBlb2YgY29uZmlnLnByb2JhYmlsaXR5ID09PSAnbnVtYmVyJyA/IGNvbmZpZy5wcm9iYWJpbGl0eSA6IDFcbiAgICBpZiAocmFuZG9tKCkgPiBwKSByZXR1cm4gbnVsbFxuICAgIHJldHVybiBiYXNlSW5zdHJ1Y3Rpb24ocnVsZSwgY3R4LCBydWxlLnJld2FyZF9kZWZpbml0aW9uX2lkLCBydWxlLnF1YW50aXR5KVxuICB9XG5cbiAgaWYgKG1vZGUgPT09ICdyYW5kb21fcG9vbCcpIHtcbiAgICBjb25zdCBwb29sID0gY29uZmlnLnBvb2xcbiAgICBpZiAoIXBvb2wgfHwgcG9vbC5sZW5ndGggPT09IDApIHJldHVybiBudWxsXG4gICAgY29uc3QgdG90YWxXZWlnaHQgPSBwb29sLnJlZHVjZSgocywgZSkgPT4gcyArIChlLndlaWdodCA/PyAxKSwgMClcbiAgICBpZiAodG90YWxXZWlnaHQgPD0gMCkgcmV0dXJuIG51bGxcbiAgICBsZXQgcm9sbCA9IHJhbmRvbSgpICogdG90YWxXZWlnaHRcbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHBvb2wpIHtcbiAgICAgIHJvbGwgLT0gZW50cnkud2VpZ2h0ID8/IDFcbiAgICAgIGlmIChyb2xsIDw9IDApIHtcbiAgICAgICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihcbiAgICAgICAgICBydWxlLFxuICAgICAgICAgIGN0eCxcbiAgICAgICAgICBlbnRyeS5kZWZpbml0aW9uX2lkLFxuICAgICAgICAgIGVudHJ5LnF1YW50aXR5ID8/IHJ1bGUucXVhbnRpdHksXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbGFzdCA9IHBvb2xbcG9vbC5sZW5ndGggLSAxXVxuICAgIHJldHVybiBiYXNlSW5zdHJ1Y3Rpb24oXG4gICAgICBydWxlLFxuICAgICAgY3R4LFxuICAgICAgbGFzdC5kZWZpbml0aW9uX2lkLFxuICAgICAgbGFzdC5xdWFudGl0eSA/PyBydWxlLnF1YW50aXR5LFxuICAgIClcbiAgfVxuXG4gIC8vIGZpeGVkIChkZWZhdWx0KVxuICByZXR1cm4gYmFzZUluc3RydWN0aW9uKFxuICAgIHJ1bGUsXG4gICAgY3R4LFxuICAgIHJ1bGUucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgcnVsZS5xdWFudGl0eSxcbiAgKVxufVxuXG5mdW5jdGlvbiBiYXNlSW5zdHJ1Y3Rpb24oXG4gIHJ1bGU6IFJld2FyZFJ1bGUsXG4gIGN0eDogR3JhbnRDb250ZXh0LFxuICBkZWZpbml0aW9uSWQ6IG51bWJlcixcbiAgcXVhbnRpdHk6IG51bWJlcixcbik6IEdyYW50SW5zdHJ1Y3Rpb24ge1xuICByZXR1cm4ge1xuICAgIHJ1bGVJZDogcnVsZS5pZCxcbiAgICBkZWZpbml0aW9uSWQsXG4gICAgcXVhbnRpdHk6IE1hdGgubWF4KDEsIE1hdGguZmxvb3IocXVhbnRpdHkpKSxcbiAgICB0cmlnZ2VyS2V5OiBjdHgudHJpZ2dlcktleSxcbiAgICBzb3VyY2VUeXBlOiBjdHguc291cmNlVHlwZSxcbiAgICBzb3VyY2VJZDogY3R4LnNvdXJjZUlkLFxuICAgIGFjdGl2aXR5SWQ6IGN0eC5hY3Rpdml0eUlkID8/IG51bGwsXG4gICAgZ29hbElkOiBjdHguZ29hbElkID8/IG51bGwsXG4gICAgY29tcGxldGlvbklkOiBjdHguY29tcGxldGlvbklkID8/IG51bGwsXG4gICAgY3ljbGVJZDogY3R4LmN5Y2xlSWQgPz8gbnVsbCxcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIFJld2FyZERlZmluaXRpb24sXG4gIFJld2FyZFJ1bGUsXG4gIFJld2FyZFRyYW5zYWN0aW9uLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBEYkludmVudG9yeU1hbmFnZXIsXG4gIHR5cGUgSW52ZW50b3J5TWFuYWdlcixcbn0gZnJvbSAnLi9pbnZlbnRvcnkudHMnXG5pbXBvcnQge1xuICBldmFsdWF0ZVJ1bGUsXG4gIHR5cGUgR3JhbnRDb250ZXh0LFxuICB0eXBlIEdyYW50SW5zdHJ1Y3Rpb24sXG59IGZyb20gJy4vcnVsZXMvZXZhbHVhdGUudHMnXG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPlxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYW50UmVzdWx0IHtcbiAgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb25cbiAgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIHwgbnVsbFxuICBza2lwcGVkOiBib29sZWFuXG4gIHJlYXNvbj86IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZEdyYW50U2VydmljZSB7XG4gIGdyYW50KFxuICAgIGRiOiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW5zdHJ1Y3Rpb25zOiBHcmFudEluc3RydWN0aW9uW10sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT5cblxuICBjb2xsZWN0QW5kR3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBydWxlczogUmV3YXJkUnVsZVtdLFxuICAgIGJhc2VDdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnIHwgJ3VzZXJJZCc+LFxuICApOiBQcm9taXNlPEdyYW50UmVzdWx0W10+XG59XG5cbmV4cG9ydCBjbGFzcyBEZWZhdWx0UmV3YXJkR3JhbnRTZXJ2aWNlIGltcGxlbWVudHMgUmV3YXJkR3JhbnRTZXJ2aWNlIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBpbnZlbnRvcnk6IEludmVudG9yeU1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKCksXG4gICkge31cblxuICBhc3luYyBncmFudChcbiAgICBkYjogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGluc3RydWN0aW9uczogR3JhbnRJbnN0cnVjdGlvbltdLFxuICApOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgICBjb25zdCByZXN1bHRzOiBHcmFudFJlc3VsdFtdID0gW11cblxuICAgIGZvciAoY29uc3QgaW5zdHJ1Y3Rpb24gb2YgaW5zdHJ1Y3Rpb25zKSB7XG4gICAgICAvLyBJZGVtcG90ZW5jeTogc2tpcCBpZiBlYXJuIGFscmVhZHkgZXhpc3RzLlxuICAgICAgbGV0IGV4aXN0aW5nUXVlcnkgPSBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgICAgLndoZXJlKCd0cmlnZ2VyX2tleScsICc9JywgaW5zdHJ1Y3Rpb24udHJpZ2dlcktleSlcblxuICAgICAgaWYgKGluc3RydWN0aW9uLnJ1bGVJZCAhPSBudWxsKSB7XG4gICAgICAgIGV4aXN0aW5nUXVlcnkgPSBleGlzdGluZ1F1ZXJ5LndoZXJlKCdydWxlX2lkJywgJz0nLCBpbnN0cnVjdGlvbi5ydWxlSWQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBleGlzdGluZ1F1ZXJ5ID0gZXhpc3RpbmdRdWVyeS53aGVyZSgncnVsZV9pZCcsICdpcycsIG51bGwpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZXhpc3RpbmdRdWVyeS5zZWxlY3RBbGwoKS5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgaW5zdHJ1Y3Rpb24sXG4gICAgICAgICAgdHJhbnNhY3Rpb246IGV4aXN0aW5nLFxuICAgICAgICAgIHNraXBwZWQ6IHRydWUsXG4gICAgICAgICAgcmVhc29uOiAnYWxyZWFkeV9ncmFudGVkJyxcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgY29uc3QgZGVmaW5pdGlvbiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnN0cnVjdGlvbi5kZWZpbml0aW9uSWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoIWRlZmluaXRpb24pIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICB0cmFuc2FjdGlvbjogbnVsbCxcbiAgICAgICAgICBza2lwcGVkOiB0cnVlLFxuICAgICAgICAgIHJlYXNvbjogJ2RlZmluaXRpb25fbm90X2ZvdW5kJyxcbiAgICAgICAgfSlcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgY29uc3QgeyB0cmFuc2FjdGlvbiB9ID0gYXdhaXQgdGhpcy5pbnZlbnRvcnkuYXBwbHlFYXJuKFxuICAgICAgICAgIGRiLFxuICAgICAgICAgIHVzZXJJZCxcbiAgICAgICAgICBkZWZpbml0aW9uIGFzIFJld2FyZERlZmluaXRpb24sXG4gICAgICAgICAgaW5zdHJ1Y3Rpb24sXG4gICAgICAgIClcbiAgICAgICAgcmVzdWx0cy5wdXNoKHsgaW5zdHJ1Y3Rpb24sIHRyYW5zYWN0aW9uLCBza2lwcGVkOiBmYWxzZSB9KVxuICAgICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICAgIC8vIFVuaXF1ZSBjb25zdHJhaW50IHJhY2UgXHUyMTkyIHRyZWF0IGFzIGFscmVhZHkgZ3JhbnRlZC5cbiAgICAgICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBTdHJpbmcoZXJyKVxuICAgICAgICBpZiAoXG4gICAgICAgICAgbWVzc2FnZS5pbmNsdWRlcygncmV3YXJkX3RyYW5zYWN0aW9uc19lYXJuX2lkZW1wb3RlbmN5JykgfHxcbiAgICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKCd1bmlxdWUnKVxuICAgICAgICApIHtcbiAgICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgICAgaW5zdHJ1Y3Rpb24sXG4gICAgICAgICAgICB0cmFuc2FjdGlvbjogbnVsbCxcbiAgICAgICAgICAgIHNraXBwZWQ6IHRydWUsXG4gICAgICAgICAgICByZWFzb246ICdhbHJlYWR5X2dyYW50ZWQnLFxuICAgICAgICAgIH0pXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuICAgICAgICB0aHJvdyBlcnJcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzdWx0c1xuICB9XG5cbiAgYXN5bmMgY29sbGVjdEFuZEdyYW50KFxuICAgIGRiOiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgcnVsZXM6IFJld2FyZFJ1bGVbXSxcbiAgICBiYXNlQ3R4OiBPbWl0PEdyYW50Q29udGV4dCwgJ3ByaW9yRWFybkNvdW50JyB8ICdsYXN0RWFybkF0JyB8ICd1c2VySWQnPixcbiAgKTogUHJvbWlzZTxHcmFudFJlc3VsdFtdPiB7XG4gICAgY29uc3QgaW5zdHJ1Y3Rpb25zOiBHcmFudEluc3RydWN0aW9uW10gPSBbXVxuXG4gICAgZm9yIChjb25zdCBydWxlIG9mIHJ1bGVzKSB7XG4gICAgICBjb25zdCBlYXJucyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgICAud2hlcmUoJ3J1bGVfaWQnLCAnPScsIHJ1bGUuaWQpXG4gICAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgICBjb25zdCBjb25maWcgPVxuICAgICAgICB0eXBlb2YgcnVsZS5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICAgICAgPyBKU09OLnBhcnNlKHJ1bGUuY29uZmlnKVxuICAgICAgICAgIDogcnVsZS5jb25maWcgPz8ge31cblxuICAgICAgbGV0IHByaW9yRWFybkNvdW50ID0gZWFybnMubGVuZ3RoXG4gICAgICBsZXQgbGFzdEVhcm5BdDogc3RyaW5nIHwgbnVsbCA9XG4gICAgICAgIGVhcm5zWzBdICE9IG51bGxcbiAgICAgICAgICA/IHR5cGVvZiBlYXJuc1swXS5jcmVhdGVkX2F0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBlYXJuc1swXS5jcmVhdGVkX2F0XG4gICAgICAgICAgICA6IG5ldyBEYXRlKGVhcm5zWzBdLmNyZWF0ZWRfYXQpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICA6IG51bGxcblxuICAgICAgLy8gV2hlbiBwZXJpb2RfaG91cnMgaXMgc2V0LCBjb3VudCBvbmx5IGVhcm5zIGluc2lkZSB0aGUgd2luZG93LlxuICAgICAgaWYgKFxuICAgICAgICB0eXBlb2YgY29uZmlnLnBlcmlvZF9ob3VycyA9PT0gJ251bWJlcicgJiZcbiAgICAgICAgY29uZmlnLnBlcmlvZF9ob3VycyA+IDBcbiAgICAgICkge1xuICAgICAgICBjb25zdCBub3cgPSBiYXNlQ3R4Lm5vdyA/PyBuZXcgRGF0ZSgpXG4gICAgICAgIGNvbnN0IHdpbmRvd01zID0gY29uZmlnLnBlcmlvZF9ob3VycyAqIDYwICogNjAgKiAxMDAwXG4gICAgICAgIGNvbnN0IGluV2luZG93ID0gZWFybnMuZmlsdGVyKChlKSA9PiB7XG4gICAgICAgICAgY29uc3QgdCA9IG5ldyBEYXRlKGUuY3JlYXRlZF9hdCkuZ2V0VGltZSgpXG4gICAgICAgICAgcmV0dXJuIG5vdy5nZXRUaW1lKCkgLSB0IDwgd2luZG93TXNcbiAgICAgICAgfSlcbiAgICAgICAgcHJpb3JFYXJuQ291bnQgPSBpbldpbmRvdy5sZW5ndGhcbiAgICAgICAgbGFzdEVhcm5BdCA9XG4gICAgICAgICAgaW5XaW5kb3dbMF0gIT0gbnVsbFxuICAgICAgICAgICAgPyB0eXBlb2YgaW5XaW5kb3dbMF0uY3JlYXRlZF9hdCA9PT0gJ3N0cmluZydcbiAgICAgICAgICAgICAgPyBpbldpbmRvd1swXS5jcmVhdGVkX2F0XG4gICAgICAgICAgICAgIDogbmV3IERhdGUoaW5XaW5kb3dbMF0uY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgICAgOiBudWxsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGN0eDogR3JhbnRDb250ZXh0ID0ge1xuICAgICAgICAuLi5iYXNlQ3R4LFxuICAgICAgICB1c2VySWQsXG4gICAgICAgIHByaW9yRWFybkNvdW50LFxuICAgICAgICBsYXN0RWFybkF0LFxuICAgICAgfVxuXG4gICAgICBjb25zdCBpbnN0cnVjdGlvbiA9IGV2YWx1YXRlUnVsZShydWxlLCBjdHgpXG4gICAgICBpZiAoaW5zdHJ1Y3Rpb24pIGluc3RydWN0aW9ucy5wdXNoKGluc3RydWN0aW9uKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCB0aGlzLmdyYW50KGRiLCB1c2VySWQsIGluc3RydWN0aW9ucylcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgcmV3YXJkR3JhbnRTZXJ2aWNlID0gbmV3IERlZmF1bHRSZXdhcmRHcmFudFNlcnZpY2UoKVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgRGF0YWJhc2UsIFJld2FyZFJ1bGUgfSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgdHlwZSB7IEdyYW50SW5zdHJ1Y3Rpb24gfSBmcm9tICcuLi9ydWxlcy9ldmFsdWF0ZS50cydcbmltcG9ydCB7IGV2YWx1YXRlUnVsZSwgdHlwZSBHcmFudENvbnRleHQgfSBmcm9tICcuLi9ydWxlcy9ldmFsdWF0ZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkU291cmNlQWRhcHRlciB7XG4gIHNvdXJjZVR5cGU6IHN0cmluZ1xuICBjb2xsZWN0R3JhbnRzKFxuICAgIGRiOiBEYkxpa2UsXG4gICAgY3R4OiBPbWl0PEdyYW50Q29udGV4dCwgJ3ByaW9yRWFybkNvdW50JyB8ICdsYXN0RWFybkF0Jz4sXG4gICk6IFByb21pc2U8R3JhbnRJbnN0cnVjdGlvbltdPlxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkUnVsZXMoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBzb3VyY2VUeXBlOiBzdHJpbmcsXG4gIHNvdXJjZUlkOiBudW1iZXIsXG4pOiBQcm9taXNlPFJld2FyZFJ1bGVbXT4ge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3J1bGVzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3NvdXJjZV90eXBlJywgJz0nLCBzb3VyY2VUeXBlKVxuICAgIC53aGVyZSgnc291cmNlX2lkJywgJz0nLCBzb3VyY2VJZClcbiAgICAud2hlcmUoJ2VuYWJsZWQnLCAnPScsIHRydWUpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxufVxuXG5hc3luYyBmdW5jdGlvbiBlbnJpY2hBbmRFdmFsdWF0ZShcbiAgZGI6IERiTGlrZSxcbiAgcnVsZXM6IFJld2FyZFJ1bGVbXSxcbiAgYmFzZTogT21pdDxHcmFudENvbnRleHQsICdwcmlvckVhcm5Db3VudCcgfCAnbGFzdEVhcm5BdCc+LFxuKTogUHJvbWlzZTxHcmFudEluc3RydWN0aW9uW10+IHtcbiAgY29uc3Qgb3V0OiBHcmFudEluc3RydWN0aW9uW10gPSBbXVxuICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICBjb25zdCBsYXN0ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgYmFzZS51c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgIC53aGVyZSgncnVsZV9pZCcsICc9JywgcnVsZS5pZClcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCBpbnN0cnVjdGlvbiA9IGV2YWx1YXRlUnVsZShydWxlLCB7XG4gICAgICAuLi5iYXNlLFxuICAgICAgcHJpb3JFYXJuQ291bnQ6IGxhc3QubGVuZ3RoLFxuICAgICAgbGFzdEVhcm5BdDpcbiAgICAgICAgbGFzdFswXSAhPSBudWxsXG4gICAgICAgICAgPyB0eXBlb2YgbGFzdFswXS5jcmVhdGVkX2F0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgPyBsYXN0WzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgIDogbmV3IERhdGUobGFzdFswXS5jcmVhdGVkX2F0KS50b0lTT1N0cmluZygpXG4gICAgICAgICAgOiBudWxsLFxuICAgIH0pXG4gICAgaWYgKGluc3RydWN0aW9uKSBvdXQucHVzaChpbnN0cnVjdGlvbilcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eVJld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ2FjdGl2aXR5JyxcbiAgYXN5bmMgY29sbGVjdEdyYW50cyhkYiwgY3R4KSB7XG4gICAgY29uc3QgcnVsZXMgPSBhd2FpdCBsb2FkUnVsZXMoZGIsIGN0eC51c2VySWQsICdhY3Rpdml0eScsIGN0eC5zb3VyY2VJZClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBnb2FsUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnZ29hbCcsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKGRiLCBjdHgudXNlcklkLCAnZ29hbCcsIGN0eC5zb3VyY2VJZClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbi8qKiBGdXR1cmU6IHN0cmVhay1iYXNlZCBncmFudHMgKFBoYXNlIDMgc3R1YiBcdTIwMTQgcmVnaXN0ZXIgd2hlbiBzdHJlYWsgZXZlbnRzIGV4aXN0KS4gKi9cbmV4cG9ydCBjb25zdCBzdHJlYWtSZXdhcmRTb3VyY2U6IFJld2FyZFNvdXJjZUFkYXB0ZXIgPSB7XG4gIHNvdXJjZVR5cGU6ICdzdHJlYWsnLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhkYiwgY3R4LnVzZXJJZCwgJ3N0cmVhaycsIGN0eC5zb3VyY2VJZClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbi8qKiBGdXR1cmU6IGRhaWx5IGNvbXBsZXRpb24gZ3JhbnRzLiAqL1xuZXhwb3J0IGNvbnN0IGRhaWx5Q29tcGxldGlvblJld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ2RhaWx5X2NvbXBsZXRpb24nLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhcbiAgICAgIGRiLFxuICAgICAgY3R4LnVzZXJJZCxcbiAgICAgICdkYWlseV9jb21wbGV0aW9uJyxcbiAgICAgIGN0eC5zb3VyY2VJZCxcbiAgICApXG4gICAgcmV0dXJuIGVucmljaEFuZEV2YWx1YXRlKGRiLCBydWxlcywgY3R4KVxuICB9LFxufVxuXG4vKiogRnV0dXJlOiB3ZWVrbHkgY29tcGxldGlvbiBncmFudHMuICovXG5leHBvcnQgY29uc3Qgd2Vla2x5Q29tcGxldGlvblJld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ3dlZWtseV9jb21wbGV0aW9uJyxcbiAgYXN5bmMgY29sbGVjdEdyYW50cyhkYiwgY3R4KSB7XG4gICAgY29uc3QgcnVsZXMgPSBhd2FpdCBsb2FkUnVsZXMoXG4gICAgICBkYixcbiAgICAgIGN0eC51c2VySWQsXG4gICAgICAnd2Vla2x5X2NvbXBsZXRpb24nLFxuICAgICAgY3R4LnNvdXJjZUlkLFxuICAgIClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBSRVdBUkRfU09VUkNFX0FEQVBURVJTOiBSZXdhcmRTb3VyY2VBZGFwdGVyW10gPSBbXG4gIGFjdGl2aXR5UmV3YXJkU291cmNlLFxuICBnb2FsUmV3YXJkU291cmNlLFxuICBzdHJlYWtSZXdhcmRTb3VyY2UsXG4gIGRhaWx5Q29tcGxldGlvblJld2FyZFNvdXJjZSxcbiAgd2Vla2x5Q29tcGxldGlvblJld2FyZFNvdXJjZSxcbl1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFJld2FyZFNvdXJjZUFkYXB0ZXIoXG4gIHNvdXJjZVR5cGU6IHN0cmluZyxcbik6IFJld2FyZFNvdXJjZUFkYXB0ZXIgfCBudWxsIHtcbiAgcmV0dXJuIChcbiAgICBSRVdBUkRfU09VUkNFX0FEQVBURVJTLmZpbmQoKGEpID0+IGEuc291cmNlVHlwZSA9PT0gc291cmNlVHlwZSkgPz8gbnVsbFxuICApXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IHJld2FyZEdyYW50U2VydmljZSB9IGZyb20gJy4vZ3JhbnRfc2VydmljZS50cydcbmltcG9ydCB7IGdldFJld2FyZFNvdXJjZUFkYXB0ZXIgfSBmcm9tICcuL3NvdXJjZXMvaW5kZXgudHMnXG5pbXBvcnQgdHlwZSB7IEdyYW50UmVzdWx0IH0gZnJvbSAnLi9ncmFudF9zZXJ2aWNlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuLyoqIEdyYW50IHJld2FyZHMgZm9yIGFuIGFjdGl2aXR5IGNvbXBsZXRpb24gKGlkZW1wb3RlbnQgcGVyIGNvbXBsZXRpb24rcnVsZSkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ3JhbnRSZXdhcmRzRm9yQWN0aXZpdHlDb21wbGV0aW9uKFxuICBkYjogRGJMaWtlLFxuICBvcHRzOiB7XG4gICAgdXNlcklkOiBudW1iZXJcbiAgICBhY3Rpdml0eUlkOiBudW1iZXJcbiAgICBjb21wbGV0aW9uSWQ6IG51bWJlclxuICB9LFxuKTogUHJvbWlzZTxHcmFudFJlc3VsdFtdPiB7XG4gIGNvbnN0IGFkYXB0ZXIgPSBnZXRSZXdhcmRTb3VyY2VBZGFwdGVyKCdhY3Rpdml0eScpXG4gIGlmICghYWRhcHRlcikgcmV0dXJuIFtdXG5cbiAgY29uc3QgdHJpZ2dlcktleSA9IGBjb21wbGV0aW9uOiR7b3B0cy5jb21wbGV0aW9uSWR9YFxuICBjb25zdCBpbnN0cnVjdGlvbnMgPSBhd2FpdCBhZGFwdGVyLmNvbGxlY3RHcmFudHMoZGIsIHtcbiAgICB1c2VySWQ6IG9wdHMudXNlcklkLFxuICAgIHNvdXJjZVR5cGU6ICdhY3Rpdml0eScsXG4gICAgc291cmNlSWQ6IG9wdHMuYWN0aXZpdHlJZCxcbiAgICB0cmlnZ2VyS2V5LFxuICAgIGFjdGl2aXR5SWQ6IG9wdHMuYWN0aXZpdHlJZCxcbiAgICBjb21wbGV0aW9uSWQ6IG9wdHMuY29tcGxldGlvbklkLFxuICB9KVxuXG4gIHJldHVybiBhd2FpdCByZXdhcmRHcmFudFNlcnZpY2UuZ3JhbnQoZGIsIG9wdHMudXNlcklkLCBpbnN0cnVjdGlvbnMpXG59XG5cbi8qKiBHcmFudCByZXdhcmRzIHdoZW4gYSBnb2FsIGN5Y2xlIHRyYW5zaXRpb25zIHRvIHN1Y2NlZWRlZCAoZWRnZS10cmlnZ2VyZWQpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MoXG4gIGRiOiBEYkxpa2UsXG4gIG9wdHM6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGdvYWxJZDogbnVtYmVyXG4gICAgY3ljbGVJZDogbnVtYmVyXG4gIH0sXG4pOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgY29uc3QgYWRhcHRlciA9IGdldFJld2FyZFNvdXJjZUFkYXB0ZXIoJ2dvYWwnKVxuICBpZiAoIWFkYXB0ZXIpIHJldHVybiBbXVxuXG4gIGNvbnN0IHRyaWdnZXJLZXkgPSBgY3ljbGU6JHtvcHRzLmN5Y2xlSWR9OnN1Y2NlZWRlZGBcbiAgY29uc3QgaW5zdHJ1Y3Rpb25zID0gYXdhaXQgYWRhcHRlci5jb2xsZWN0R3JhbnRzKGRiLCB7XG4gICAgdXNlcklkOiBvcHRzLnVzZXJJZCxcbiAgICBzb3VyY2VUeXBlOiAnZ29hbCcsXG4gICAgc291cmNlSWQ6IG9wdHMuZ29hbElkLFxuICAgIHRyaWdnZXJLZXksXG4gICAgZ29hbElkOiBvcHRzLmdvYWxJZCxcbiAgICBjeWNsZUlkOiBvcHRzLmN5Y2xlSWQsXG4gIH0pXG5cbiAgcmV0dXJuIGF3YWl0IHJld2FyZEdyYW50U2VydmljZS5ncmFudChkYiwgb3B0cy51c2VySWQsIGluc3RydWN0aW9ucylcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFJld2FyZEludmVudG9yeSwgUmV3YXJkVHJhbnNhY3Rpb24gfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIFJld2FyZE51ZGdlS2luZCA9XG4gIHwgJ2ludmVudG9yeV9hdmFpbGFibGUnXG4gIHwgJ3JlY2VudGx5X2Vhcm5lZCdcbiAgfCAndW5jb25zdW1lZF9zdGFjaydcblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmROdWRnZSB7XG4gIGtpbmQ6IFJld2FyZE51ZGdlS2luZFxuICB0aXRsZTogc3RyaW5nXG4gIG1lc3NhZ2U6IHN0cmluZ1xuICBzZXZlcml0eTogJ2luZm8nIHwgJ3N1Y2Nlc3MnXG4gIGRlZmluaXRpb25JZD86IG51bWJlciB8IG51bGxcbiAgaW52ZW50b3J5SWQ/OiBudW1iZXIgfCBudWxsXG59XG5cbi8qKlxuICogQnVpbGQgbGlnaHR3ZWlnaHQgcmV3YXJkIG51ZGdlcyBmb3IgdGhlIE92ZXJ2aWV3IHN1cmZhY2UuXG4gKiBQdXJlIFx1MjAxNCBubyBJL08uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFJld2FyZE51ZGdlcyhpbnB1dDoge1xuICBpbnZlbnRvcnk6IEFycmF5PFxuICAgIFBpY2s8UmV3YXJkSW52ZW50b3J5LCAnaWQnIHwgJ3F1YW50aXR5JyB8ICdyZXdhcmRfZGVmaW5pdGlvbl9pZCc+ICYge1xuICAgICAgbmFtZT86IHN0cmluZ1xuICAgIH1cbiAgPlxuICByZWNlbnRFYXJuczogQXJyYXk8XG4gICAgUGljazxcbiAgICAgIFJld2FyZFRyYW5zYWN0aW9uLFxuICAgICAgJ2lkJyB8ICdkZWZpbml0aW9uX25hbWUnIHwgJ3F1YW50aXR5JyB8ICdjcmVhdGVkX2F0JyB8ICdyZXdhcmRfZGVmaW5pdGlvbl9pZCdcbiAgICA+XG4gID5cbiAgbm93PzogRGF0ZVxufSk6IFJld2FyZE51ZGdlW10ge1xuICBjb25zdCBudWRnZXM6IFJld2FyZE51ZGdlW10gPSBbXVxuICBjb25zdCBub3cgPSBpbnB1dC5ub3cgPz8gbmV3IERhdGUoKVxuXG4gIGNvbnN0IHRvdGFsUXR5ID0gaW5wdXQuaW52ZW50b3J5LnJlZHVjZSgocywgaSkgPT4gcyArIGkucXVhbnRpdHksIDApXG4gIGlmICh0b3RhbFF0eSA+IDApIHtcbiAgICBjb25zdCB0b3AgPSBbLi4uaW5wdXQuaW52ZW50b3J5XS5zb3J0KChhLCBiKSA9PiBiLnF1YW50aXR5IC0gYS5xdWFudGl0eSlbMF1cbiAgICBudWRnZXMucHVzaCh7XG4gICAgICBraW5kOiAnaW52ZW50b3J5X2F2YWlsYWJsZScsXG4gICAgICB0aXRsZTogJ1Jld2FyZHMgcmVhZHknLFxuICAgICAgbWVzc2FnZTpcbiAgICAgICAgdG90YWxRdHkgPT09IDFcbiAgICAgICAgICA/ICdZb3UgaGF2ZSAxIHJld2FyZCB3YWl0aW5nIHRvIGJlIGVuam95ZWQuJ1xuICAgICAgICAgIDogYFlvdSBoYXZlICR7dG90YWxRdHl9IHJld2FyZHMgd2FpdGluZyB0byBiZSBlbmpveWVkLmAsXG4gICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgZGVmaW5pdGlvbklkOiB0b3A/LnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgaW52ZW50b3J5SWQ6IHRvcD8uaWQsXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IGRheUFnbyA9IG5vdy5nZXRUaW1lKCkgLSAyNCAqIDYwICogNjAgKiAxMDAwXG4gIGNvbnN0IGZyZXNoID0gaW5wdXQucmVjZW50RWFybnMuZmlsdGVyKChlKSA9PiB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGUuY3JlYXRlZF9hdCkuZ2V0VGltZSgpXG4gICAgcmV0dXJuIHQgPj0gZGF5QWdvXG4gIH0pXG4gIGZvciAoY29uc3QgZWFybiBvZiBmcmVzaC5zbGljZSgwLCAzKSkge1xuICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdyZWNlbnRseV9lYXJuZWQnLFxuICAgICAgdGl0bGU6ICdSZXdhcmQgZWFybmVkJyxcbiAgICAgIG1lc3NhZ2U6IGBZb3UgZWFybmVkICR7ZWFybi5kZWZpbml0aW9uX25hbWV9IFx1MDBENyR7ZWFybi5xdWFudGl0eX0uYCxcbiAgICAgIHNldmVyaXR5OiAnc3VjY2VzcycsXG4gICAgICBkZWZpbml0aW9uSWQ6IGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgfSlcbiAgfVxuXG4gIGNvbnN0IGJpZ1N0YWNrID0gaW5wdXQuaW52ZW50b3J5LmZpbmQoKGkpID0+IGkucXVhbnRpdHkgPj0gNSlcbiAgaWYgKGJpZ1N0YWNrKSB7XG4gICAgbnVkZ2VzLnB1c2goe1xuICAgICAga2luZDogJ3VuY29uc3VtZWRfc3RhY2snLFxuICAgICAgdGl0bGU6ICdHcm93aW5nIHN0YWNrJyxcbiAgICAgIG1lc3NhZ2U6IGAke2JpZ1N0YWNrLm5hbWUgPz8gJ0EgcmV3YXJkJ30gaXMgc3RhY2tlZCBcdTAwRDcke2JpZ1N0YWNrLnF1YW50aXR5fSBcdTIwMTQgdHJlYXQgeW91cnNlbGY/YCxcbiAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICBkZWZpbml0aW9uSWQ6IGJpZ1N0YWNrLnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgaW52ZW50b3J5SWQ6IGJpZ1N0YWNrLmlkLFxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gbnVkZ2VzXG59XG4iLCAiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHtcbiAgY29yc01pZGRsZXdhcmUsXG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbn0gZnJvbSAnLi9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgfSBmcm9tICcuL2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHtcbiAgQXNzZXRWYWxpZGF0aW9uRXJyb3IsXG4gIGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnksXG59IGZyb20gJy4vYXNzZXRzL3JlcG9zaXRvcnkudHMnXG5pbXBvcnQgeyBNQVhfQVNTRVRfQllURVMgfSBmcm9tICcuL2Fzc2V0cy9zdG9yYWdlL3R5cGVzLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVXNlcklkRnJvbVJlcXVlc3QoXG4gIGF1dGhvcml6YXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGF1dGhvcml6YXRpb24pXG4gIGlmICghdmVyaWZpZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuICByZXR1cm4gbG9jYWxVc2VyLmlkXG59XG5cbmFwcC51c2UoYXN5bmMgKGN0eCwgbmV4dCkgPT4ge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIGF3YWl0IG5leHQoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG5cbiAgLy8gQXNzZXQgdXBsb2FkIC8gZG93bmxvYWQgKGF1dGhlbnRpY2F0ZWQgUkVTVCwgbm90IEdyYXBoUUwpLlxuICBpZiAocGF0aCA9PT0gJy9hc3NldHMnICYmIGN0eC5yZXEubWV0aG9kID09PSAnUE9TVCcpIHtcbiAgICBjb25zdCB1c2VySWQgPSBhd2FpdCByZXNvbHZlVXNlcklkRnJvbVJlcXVlc3QoXG4gICAgICBjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpLFxuICAgIClcbiAgICBpZiAodXNlcklkID09IG51bGwpIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3QgY29udGVudFR5cGUgPVxuICAgICAgICBjdHgucmVxLmhlYWRlcignQ29udGVudC1UeXBlJyk/LnRvTG93ZXJDYXNlKCkgPz8gJydcbiAgICAgIGxldCBieXRlczogVWludDhBcnJheVxuICAgICAgbGV0IG1pbWUgPSAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICAgICAgbGV0IGZpbGVuYW1lOiBzdHJpbmcgfCB1bmRlZmluZWRcblxuICAgICAgaWYgKGNvbnRlbnRUeXBlLmluY2x1ZGVzKCdtdWx0aXBhcnQvZm9ybS1kYXRhJykpIHtcbiAgICAgICAgY29uc3QgZm9ybSA9IGF3YWl0IGN0eC5yZXEuZm9ybURhdGEoKVxuICAgICAgICBjb25zdCBmaWxlID0gZm9ybS5nZXQoJ2ZpbGUnKVxuICAgICAgICBpZiAoIWZpbGUgfHwgdHlwZW9mIGZpbGUgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgcmV0dXJuIGpzb25FcnJvcignZmlsZSBmaWVsZCByZXF1aXJlZCcsIDQwMClcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBibG9iID0gZmlsZSBhcyBGaWxlXG4gICAgICAgIG1pbWUgPSBibG9iLnR5cGUgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgICAgICAgZmlsZW5hbWUgPSBibG9iLm5hbWVcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgYmxvYi5hcnJheUJ1ZmZlcigpXG4gICAgICAgIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWltZSA9IGNvbnRlbnRUeXBlLnNwbGl0KCc7JylbMF0udHJpbSgpIHx8ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGN0eC5yZXEuYXJyYXlCdWZmZXIoKVxuICAgICAgICBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICAgIH1cblxuICAgICAgaWYgKGJ5dGVzLmJ5dGVMZW5ndGggPiBNQVhfQVNTRVRfQllURVMpIHtcbiAgICAgICAgcmV0dXJuIGpzb25FcnJvcignZmlsZSB0b28gbGFyZ2UnLCA0MTMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCByZXBvLnB1dCh7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYnl0ZXMsXG4gICAgICAgIGNvbnRlbnRUeXBlOiBtaW1lLFxuICAgICAgICBmaWxlbmFtZSxcbiAgICAgIH0pXG5cbiAgICAgIHJldHVybiBuZXcgUmVzcG9uc2UoXG4gICAgICAgIEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgICBpZDogYXNzZXQuaWQsXG4gICAgICAgICAgc2hhMjU2OiBhc3NldC5zaGEyNTYsXG4gICAgICAgICAgY29udGVudFR5cGU6IGFzc2V0LmNvbnRlbnRfdHlwZSxcbiAgICAgICAgICBieXRlU2l6ZTogYXNzZXQuYnl0ZV9zaXplLFxuICAgICAgICAgIHVybDogYC9hc3NldHMvJHthc3NldC5pZH1gLFxuICAgICAgICB9KSxcbiAgICAgICAge1xuICAgICAgICAgIHN0YXR1czogMjAxLFxuICAgICAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAgIH0sXG4gICAgICAgIH0sXG4gICAgICApXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgQXNzZXRWYWxpZGF0aW9uRXJyb3IpIHtcbiAgICAgICAgcmV0dXJuIGpzb25FcnJvcihlcnIubWVzc2FnZSwgZXJyLnN0YXR1cylcbiAgICAgIH1cbiAgICAgIGNvbnNvbGUuZXJyb3IoJ2Fzc2V0IHVwbG9hZCBmYWlsZWQnLCBlcnIpXG4gICAgICByZXR1cm4ganNvbkVycm9yKCd1cGxvYWQgZmFpbGVkJywgNTAwKVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGFzc2V0TWF0Y2ggPSBwYXRoLm1hdGNoKC9eXFwvYXNzZXRzXFwvKFxcZCspJC8pXG4gIGlmIChhc3NldE1hdGNoICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIGNvbnN0IHVzZXJJZCA9IGF3YWl0IHJlc29sdmVVc2VySWRGcm9tUmVxdWVzdChcbiAgICAgIGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJyksXG4gICAgKVxuICAgIGlmICh1c2VySWQgPT0gbnVsbCkgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcblxuICAgIGNvbnN0IGFzc2V0SWQgPSBOdW1iZXIoYXNzZXRNYXRjaFsxXSlcbiAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCByZXBvLnJlYWRCeXRlcyhhc3NldElkLCB1c2VySWQpXG4gICAgaWYgKCFyZXN1bHQpIHtcbiAgICAgIHJldHVybiBqc29uRXJyb3IoJ25vdCBmb3VuZCcsIDQwNClcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKHJlc3VsdC5ieXRlcy5idWZmZXIuc2xpY2UoXG4gICAgICByZXN1bHQuYnl0ZXMuYnl0ZU9mZnNldCxcbiAgICAgIHJlc3VsdC5ieXRlcy5ieXRlT2Zmc2V0ICsgcmVzdWx0LmJ5dGVzLmJ5dGVMZW5ndGgsXG4gICAgKSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiByZXN1bHQuY29udGVudFR5cGUsXG4gICAgICAgICdDYWNoZS1Db250cm9sJzogJ3ByaXZhdGUsIG1heC1hZ2U9MzYwMCcsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBpZiAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSkge1xuICAgIGF3YWl0IG5leHQoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcbiAgfVxuXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuXG4gIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICBjdHguc2V0KCdhdXRoRW1haWwnLCB2ZXJpZmllZC5lbWFpbClcbiAgfVxuICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgYXdhaXQgbmV4dCgpXG59KVxuXG5mdW5jdGlvbiBqc29uRXJyb3IobWVzc2FnZTogc3RyaW5nLCBzdGF0dXM6IG51bWJlcik6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiBtZXNzYWdlIH0pLCB7XG4gICAgc3RhdHVzLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgIH0sXG4gIH0pXG59XG5cbmV4cG9ydCBjb25zdCBncmFwaHFsID0ge1xuICAuLi5yZXNvbHZlcnMsXG59XG5cbmV4cG9ydCBkZWZhdWx0IGFwcFxuXG4gICAgICBpbXBvcnQge2hhbmRsZXIgYXMgX19pbnRlcm5hbFB5bG9uSGFuZGxlcn0gZnJvbSBcIkBnZXRjcm9uaXQvcHlsb25cIlxuXG4gICAgICBsZXQgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gdW5kZWZpbmVkXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IGNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGNvbmZpZyBpcyBub3QgZGVjbGFyZWQsIHB5bG9uQ29uZmlnIHJlbWFpbnMgdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGFwcC51c2UoX19pbnRlcm5hbFB5bG9uSGFuZGxlcih7XG4gICAgICAgIHR5cGVEZWZzOiBcImlucHV0IEFyZ3NJbnB1dCB7XFxuXFx0ZmlsdGVyOiBSZXdhcmREZWZpbml0aW9uc0ZpbHRlcklucHV0XFxufVxcbmlucHV0IFJld2FyZERlZmluaXRpb25zRmlsdGVySW5wdXQge1xcblxcdGluY2x1ZGVBcmNoaXZlZDogQm9vbGVhblxcblxcdHNlYXJjaDogU3RyaW5nXFxuXFx0Y2F0ZWdvcnk6IFN0cmluZ1xcblxcdGxpbWl0OiBOdW1iZXJcXG5cXHRvZmZzZXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGZpbHRlcjogUmV3YXJkSW52ZW50b3J5RmlsdGVySW5wdXRcXG59XFxuaW5wdXQgUmV3YXJkSW52ZW50b3J5RmlsdGVySW5wdXQge1xcblxcdHNlYXJjaDogU3RyaW5nXFxuXFx0c3RhY2thYmxlT25seTogQm9vbGVhblxcblxcdHNvcnQ6IE5BTUVfUVVBTlRJVFlfUkVDRU5USW5wdXRcXG5cXHRsaW1pdDogTnVtYmVyXFxuXFx0b2Zmc2V0OiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMge1xcblxcdGZpbHRlcjogUmV3YXJkSGlzdG9yeUZpbHRlcklucHV0XFxufVxcbmlucHV0IFJld2FyZEhpc3RvcnlGaWx0ZXJJbnB1dCB7XFxuXFx0ZGVmaW5pdGlvbklkOiBOdW1iZXJcXG5cXHR0eXBlOiBTdHJpbmdcXG5cXHRsaW1pdDogTnVtYmVyXFxuXFx0b2Zmc2V0OiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzQge1xcblxcdHNvdXJjZVR5cGU6IFN0cmluZyFcXG5cXHRzb3VyY2VJZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNSB7XFxuXFx0bGltaXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNiB7XFxuXFx0c3RhdHVzOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzcge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF84IHtcXG5cXHRkYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzkge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzExIHtcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXJcXG5cXHRmcm9tRGF0ZTogU3RyaW5nXFxuXFx0dG9EYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEyIHtcXG5cXHRpbnB1dDogQ3JlYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dElucHV0IHtcXG5cXHRuYW1lOiBTdHJpbmchXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG5cXHRjYXRlZ29yeTogU3RyaW5nXFxuXFx0dGFnczogW1N0cmluZyFdXFxuXFx0Y29sb3I6IFN0cmluZyFcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRpbWFnZUFzc2V0SWQ6IE51bWJlclxcblxcdHN0YWNrYWJsZTogQm9vbGVhblxcblxcdGRlZmF1bHRRdWFudGl0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEzIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRub3RlczogU3RyaW5nXFxuXFx0Y2F0ZWdvcnk6IFN0cmluZ1xcblxcdHRhZ3M6IFtTdHJpbmchXVxcblxcdGNvbG9yOiBTdHJpbmdcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRpbWFnZUFzc2V0SWQ6IE51bWJlclxcblxcdHN0YWNrYWJsZTogQm9vbGVhblxcblxcdGRlZmF1bHRRdWFudGl0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTUge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE3IHtcXG5cXHRpbnB1dDogQXR0YWNoUmV3YXJkUnVsZUlucHV0SW5wdXQhXFxufVxcbmlucHV0IEF0dGFjaFJld2FyZFJ1bGVJbnB1dElucHV0IHtcXG5cXHRzb3VyY2VUeXBlOiBTdHJpbmchXFxuXFx0c291cmNlSWQ6IE51bWJlciFcXG5cXHRyZXdhcmREZWZpbml0aW9uSWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxuXFx0bW9kZTogRklYRURfUFJPQkFCSUxJVFlfUkFORE9NX1BPT0xJbnB1dFxcblxcdGNvbmZpZ0pzb246IFN0cmluZ1xcblxcdGVuYWJsZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgQXJnc0lucHV0XzE4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTkge1xcblxcdGlucHV0OiBDb25zdW1lUmV3YXJkSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ29uc3VtZVJld2FyZElucHV0SW5wdXQge1xcblxcdGludmVudG9yeUlkOiBOdW1iZXIhXFxuXFx0cXVhbnRpdHk6IE51bWJlclxcblxcdG5vdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjAge1xcblxcdGlucHV0OiBEaXNjYXJkUmV3YXJkSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgRGlzY2FyZFJld2FyZElucHV0SW5wdXQge1xcblxcdGludmVudG9yeUlkOiBOdW1iZXIhXFxuXFx0cXVhbnRpdHk6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjEge1xcblxcdHRyYW5zYWN0aW9uSWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIyIHtcXG5cXHRpbnB1dDogTWFudWFsR3JhbnRSZXdhcmRJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBNYW51YWxHcmFudFJld2FyZElucHV0SW5wdXQge1xcblxcdHJld2FyZERlZmluaXRpb25JZDogTnVtYmVyIVxcblxcdHF1YW50aXR5OiBOdW1iZXJcXG5cXHRub3RlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIzIHtcXG5cXHRpbnB1dDogQ3JlYXRlR29hbElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdvYWxJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nIVxcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nIVxcblxcdGljb246IFN0cmluZ1xcblxcdHJ1bGVUeXBlOiBTdHJpbmchXFxuXFx0bWV0cmljOiBDT1VOVF9EVVJBVElPTklucHV0IVxcblxcdHRhcmdldFZhbHVlOiBOdW1iZXIhXFxuXFx0Y29uZmlnOiBHb2FsQ29uZmlnSW5wdXRJbnB1dFxcblxcdGxpbmtzOiBbR29hbExpbmtJbnB1dElucHV0IV1cXG5cXHRkZXBlbmRlbmNpZXM6IFtHb2FsRGVwZW5kZW5jeUlucHV0SW5wdXQhXVxcblxcdHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlSW5wdXRJbnB1dFxcblxcdGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dElucHV0XFxuXFx0c3RhcnRzQXQ6IFN0cmluZ1xcblxcdHByaW9yaXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBHb2FsQ29uZmlnSW5wdXRJbnB1dCB7XFxuXFx0Y29tcG9zaXRlTW9kZTogQUxMX0FOWV9XRUlHSFRFRElucHV0XFxuXFx0Y291bnRSZXF1aXJlZDogTnVtYmVyXFxuXFx0YmVmb3JlVGltZTogU3RyaW5nXFxuXFx0YWZ0ZXJUaW1lOiBTdHJpbmdcXG5cXHRibG9ja1VudGlsVW5sb2NrZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgR29hbExpbmtJbnB1dElucHV0IHtcXG5cXHRsaW5rVHlwZTogQUNUSVZJVFlfR1JPVVBJbnB1dCFcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXJcXG5cXHRncm91cElkOiBOdW1iZXJcXG5cXHR3ZWlnaHQ6IE51bWJlclxcbn1cXG5pbnB1dCBHb2FsRGVwZW5kZW5jeUlucHV0SW5wdXQge1xcblxcdGRlcGVuZHNPbkdvYWxJZDogTnVtYmVyIVxcblxcdHJlcXVpcmVtZW50OiBDT01QTEVURV9QUk9HUkVTU0lucHV0XFxuXFx0dGhyZXNob2xkOiBOdW1iZXJcXG5cXHR3ZWlnaHQ6IE51bWJlclxcbn1cXG5pbnB1dCBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXQge1xcblxcdHBlcmlvZDogV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZU0lucHV0IVxcblxcdGludGVydmFsOiBOdW1iZXJcXG5cXHRhbmNob3I6IFN0cmluZ1xcblxcdGNhcnJ5T3ZlcjogTk9ORV9PVkVSRkxPV0lucHV0XFxuXFx0cmVzZXQ6IFN0cmluZ1xcbn1cXG5pbnB1dCBHb2FsRGVhZGxpbmVJbnB1dElucHV0IHtcXG5cXHRraW5kOiBBQlNPTFVURV9SRUxBVElWRUlucHV0IVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdGRheXNBZnRlckN5Y2xlU3RhcnQ6IE51bWJlclxcblxcdGdyYWNlRGF5czogTnVtYmVyXFxuXFx0d2FybkRheXM6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjQge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0cnVsZVR5cGU6IFN0cmluZ1xcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dFxcblxcdHRhcmdldFZhbHVlOiBOdW1iZXJcXG5cXHRjb25maWc6IEdvYWxDb25maWdJbnB1dElucHV0XFxuXFx0bGlua3M6IFtHb2FsTGlua0lucHV0SW5wdXQhXVxcblxcdGRlcGVuZGVuY2llczogW0dvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCFdXFxuXFx0cmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dElucHV0XFxuXFx0ZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0SW5wdXRcXG5cXHRzdGFydHNBdDogU3RyaW5nXFxuXFx0Y29uZmlybVN0YXJ0c0F0Q2hhbmdlOiBCb29sZWFuXFxuXFx0c3RhdHVzOiBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dFxcblxcdHByaW9yaXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjUge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI3IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjgge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yOSB7XFxuXFx0aW5wdXQ6IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlR3JvdXBJbnB1dElucHV0IHtcXG5cXHRuYW1lOiBTdHJpbmchXFxuXFx0Y29sb3I6IFN0cmluZyFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMwIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzEge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMiB7XFxuXFx0aW5wdXQ6IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nIVxcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRzdGFydFRpbWU6IFN0cmluZyFcXG5cXHRlbmRUaW1lOiBTdHJpbmchXFxuXFx0aXNSZWN1cnJpbmc6IEJvb2xlYW4hXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0cmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dFxcblxcdGdyb3VwSWQ6IE51bWJlclxcblxcdG5vdGlmaWNhdGlvbk9mZnNldHM6IFtOdW1iZXIhXVxcbn1cXG5pbnB1dCBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXQge1xcblxcdHJlY3VycmVuY2VUeXBlOiBSZWN1cnJlbmNlVHlwZUlucHV0IVxcblxcdGNvbmZpZzogUmVjdXJyZW5jZUNvbmZpZ0lucHV0IVxcbn1cXG5pbnB1dCBSZWN1cnJlbmNlQ29uZmlnSW5wdXQge1xcblxcdGRheXNfb2Zfd2VlazogW051bWJlciFdXFxuXFx0ZGF5c19vZl9tb250aDogW051bWJlciFdXFxuXFx0aXNfbGFzdF9kYXlfb2ZfbW9udGg6IEJvb2xlYW5cXG5cXHRpbnRlcnZhbF9kYXlzOiBOdW1iZXJcXG5cXHRzdGFydF9kYXRlOiBTdHJpbmchXFxuXFx0ZW5kX2RhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzMge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nXFxuXFx0ZW5kVGltZTogU3RyaW5nXFxuXFx0aXNSZWN1cnJpbmc6IEJvb2xlYW5cXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0bm90aWZpY2F0aW9uT2Zmc2V0czogW051bWJlciFdXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzM1IHtcXG5cXHRpbnB1dDogQ29tcGxldGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENvbXBsZXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXIhXFxuXFx0b2NjdXJyZW5jZURhdGU6IFN0cmluZyFcXG5cXHRkdXJhdGlvbk1pbnV0ZXM6IE51bWJlclxcblxcdG5vdGVzOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzM2IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzcge1xcblxcdGlucHV0OiBMb2dUaW1lSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgTG9nVGltZUlucHV0SW5wdXQge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlciFcXG5cXHRkdXJhdGlvbk1pbnV0ZXM6IE51bWJlciFcXG5cXHRvY2N1cnJlbmNlRGF0ZTogU3RyaW5nXFxuXFx0bm90ZXM6IFN0cmluZ1xcbn1cXG50eXBlIFF1ZXJ5IHtcXG5yZXdhcmREZWZpbml0aW9ucyhhcmdzOiBBcmdzSW5wdXQhKTogW1Jld2FyZERlZmluaXRpb25zIV0hXFxucmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMSEpOiBSZXdhcmREZWZpbml0aW9uc1xcbnJld2FyZEludmVudG9yeShhcmdzOiBBcmdzSW5wdXRfMiEpOiBbUmV3YXJkSW52ZW50b3J5IV0hXFxucmV3YXJkSGlzdG9yeShhcmdzOiBBcmdzSW5wdXRfMyEpOiBbUmV3YXJkSGlzdG9yeSFdIVxcbnJld2FyZFJ1bGVzKGFyZ3M6IEFyZ3NJbnB1dF80ISk6IFtSZXdhcmRSdWxlcyFdIVxcbnJlY2VudEFzc2V0cyhhcmdzOiBBcmdzSW5wdXRfNSEpOiBbUmVjZW50QXNzZXRzIV0hXFxucmV3YXJkTnVkZ2VzKF9hcmdzOiBPYmplY3QpOiBbUmV3YXJkTnVkZ2UhXSFcXG5nb2FscyhhcmdzOiBBcmdzSW5wdXRfNik6IFtHb2FscyFdIVxcbmdvYWwoYXJnczogQXJnc0lucHV0XzchKTogR29hbHNcXG5nb2FsTnVkZ2VzKGFyZ3M6IE9iamVjdCk6IFtHb2FsTnVkZ2UhXSFcXG5kYWlseVByb2dyZXNzKGFyZ3M6IEFyZ3NJbnB1dF84KTogRGFpbHlQcm9ncmVzcyFcXG5ncm91cHMoYXJnczogT2JqZWN0KTogW0dyb3VwcyFdIVxcbmdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF85ISk6IEdyb3Vwc1xcbmFjdGl2aXRpZXMoYXJnczogT2JqZWN0KTogW0FjdGl2aXRpZXMhXSFcXG5hY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMTAhKTogQWN0aXZpdGllc1xcbmFjdGl2aXR5Q29tcGxldGlvbnMoYXJnczogQXJnc0lucHV0XzExKTogW0FjdGl2aXR5Q29tcGxldGlvbnMhXSFcXG59XFxudHlwZSBSZXdhcmREZWZpbml0aW9ucyB7XFxudGFnczogW1N0cmluZyFdIVxcbmltYWdlX3VybDogU3RyaW5nXFxuaW1hZ2U6IEltYWdlXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxuY2F0ZWdvcnk6IFN0cmluZ1xcbmNvbG9yOiBTdHJpbmchXFxuaWNvbjogU3RyaW5nXFxuaW1hZ2VfYXNzZXRfaWQ6IE51bWJlclxcbnN0YWNrYWJsZTogQm9vbGVhbiFcXG5kZWZhdWx0X3F1YW50aXR5OiBOdW1iZXIhXFxuc29ydF9vcmRlcjogTnVtYmVyIVxcbmFyY2hpdmVkX2F0OiBEYXRlXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIEltYWdlIHtcXG51cmw6IFN0cmluZyFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnNoYTI1NjogU3RyaW5nIVxcbmNvbnRlbnRfdHlwZTogU3RyaW5nIVxcbmJ5dGVfc2l6ZTogTnVtYmVyIVxcbnN0b3JhZ2Vfa2V5OiBTdHJpbmchXFxucmVmX2NvdW50OiBOdW1iZXIhXFxub3JwaGFuZWRfYXQ6IERhdGVcXG59XFxudHlwZSBSZXdhcmRJbnZlbnRvcnkge1xcbmRlZmluaXRpb246IFJld2FyZERlZmluaXRpb25zXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5yZXdhcmRfZGVmaW5pdGlvbl9pZDogTnVtYmVyIVxcbnF1YW50aXR5OiBOdW1iZXIhXFxuc3RhY2tfa2V5OiBTdHJpbmdcXG5maXJzdF9lYXJuZWRfYXQ6IERhdGUhXFxubGFzdF9lYXJuZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgUmV3YXJkSGlzdG9yeSB7XFxubWV0YWRhdGE6IEFueSFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5pbWFnZV9hc3NldF9pZDogTnVtYmVyXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxucmV3YXJkX2RlZmluaXRpb25faWQ6IE51bWJlclxcbnF1YW50aXR5OiBOdW1iZXIhXFxudHlwZTogUmV3YXJkVHJhbnNhY3Rpb25UeXBlIVxcbmludmVudG9yeV9pZDogTnVtYmVyXFxuZGVmaW5pdGlvbl9uYW1lOiBTdHJpbmchXFxuZGVmaW5pdGlvbl9jb2xvcjogU3RyaW5nIVxcbmRlZmluaXRpb25faWNvbjogU3RyaW5nXFxuc291cmNlX3R5cGU6IFN0cmluZ1xcbnNvdXJjZV9pZDogTnVtYmVyXFxudHJpZ2dlcl9rZXk6IFN0cmluZ1xcbnJ1bGVfaWQ6IE51bWJlclxcbmdvYWxfaWQ6IE51bWJlclxcbmNvbXBsZXRpb25faWQ6IE51bWJlclxcbmN5Y2xlX2lkOiBOdW1iZXJcXG5ub3RlOiBTdHJpbmdcXG59XFxudHlwZSBSZXdhcmRSdWxlcyB7XFxuY29uZmlnOiBSZXdhcmRSdWxlQ29uZmlnIVxcbmRlZmluaXRpb246IFJld2FyZERlZmluaXRpb25zXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnJld2FyZF9kZWZpbml0aW9uX2lkOiBOdW1iZXIhXFxucXVhbnRpdHk6IE51bWJlciFcXG5zb3VyY2VfdHlwZTogU3RyaW5nIVxcbnNvdXJjZV9pZDogTnVtYmVyIVxcbm1vZGU6IFJld2FyZFJ1bGVNb2RlIVxcbmVuYWJsZWQ6IEJvb2xlYW4hXFxufVxcbnR5cGUgUmV3YXJkUnVsZUNvbmZpZyB7XFxub25jZTogQm9vbGVhblxcbmNvb2xkb3duX2hvdXJzOiBOdW1iZXJcXG5tYXhfZ3JhbnRzX3RvdGFsOiBOdW1iZXJcXG5tYXhfZ3JhbnRzX3Blcl9wZXJpb2Q6IE51bWJlclxcbnBlcmlvZF9ob3VyczogTnVtYmVyXFxucHJvYmFiaWxpdHk6IE51bWJlclxcblxcXCJcXFwiXFxcIlxcblBvb2wgb2YgZGVmaW5pdGlvbiBpZHMgZm9yIHJhbmRvbV9wb29sIG1vZGUuXFxuXFxcIlxcXCJcXFwiXFxucG9vbDogW1Bvb2whXVxcbn1cXG50eXBlIFBvb2wge1xcbmRlZmluaXRpb25faWQ6IE51bWJlciFcXG53ZWlnaHQ6IE51bWJlclxcbnF1YW50aXR5OiBOdW1iZXJcXG59XFxudHlwZSBSZWNlbnRBc3NldHMge1xcbnVybDogU3RyaW5nIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuc2hhMjU2OiBTdHJpbmchXFxuY29udGVudF90eXBlOiBTdHJpbmchXFxuYnl0ZV9zaXplOiBOdW1iZXIhXFxuc3RvcmFnZV9rZXk6IFN0cmluZyFcXG5yZWZfY291bnQ6IE51bWJlciFcXG5vcnBoYW5lZF9hdDogRGF0ZVxcbn1cXG50eXBlIFJld2FyZE51ZGdlIHtcXG5raW5kOiBSZXdhcmROdWRnZUtpbmQhXFxudGl0bGU6IFN0cmluZyFcXG5tZXNzYWdlOiBTdHJpbmchXFxuc2V2ZXJpdHk6IElORk9fU1VDQ0VTUyFcXG5kZWZpbml0aW9uSWQ6IE51bWJlclxcbmludmVudG9yeUlkOiBOdW1iZXJcXG59XFxudHlwZSBHb2FscyB7XFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhcnRzQXQ6IFN0cmluZyFcXG5saWZlY3ljbGVQaGFzZTogR29hbExpZmVjeWNsZVBoYXNlIVxcbmNvbmZpZzogR29hbENvbmZpZyFcXG5yZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUNvbmZpZ1xcbmRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWdcXG5saW5rczogW0xpbmtzIV0hXFxuYWN0aXZlQ3ljbGU6IEFjdGl2ZUN5Y2xlXFxuY3ljbGVzOiBbQ3ljbGVzQW5kQ3ljbGVzXzEhXSFcXG5kZXBlbmRlbmNpZXM6IFtEZXBlbmRlbmNpZXMhXSFcXG5zbmFwc2hvdHM6IFtTbmFwc2hvdHMhXSFcXG5pc0xvY2tlZDogQm9vbGVhbiFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxuY29sb3I6IFN0cmluZyFcXG5pY29uOiBTdHJpbmdcXG5zb3J0X29yZGVyOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnRpdGxlOiBTdHJpbmchXFxucnVsZV90eXBlOiBTdHJpbmchXFxubWV0cmljOiBHb2FsTWV0cmljIVxcbnN0YXR1czogR29hbFN0YXR1cyFcXG5wcmlvcml0eTogTnVtYmVyIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsQ29uZmlnIHtcXG5jb21wb3NpdGVfbW9kZTogQUxMX0FOWV9XRUlHSFRFRFxcbmNvdW50X3JlcXVpcmVkOiBOdW1iZXJcXG5iZWZvcmVfdGltZTogU3RyaW5nXFxuYWZ0ZXJfdGltZTogU3RyaW5nXFxuYmxvY2tfdW50aWxfdW5sb2NrZWQ6IEJvb2xlYW5cXG59XFxudHlwZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XFxucGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIVxcbmludGVydmFsOiBOdW1iZXJcXG5hbmNob3I6IFN0cmluZ1xcbmNhcnJ5X292ZXI6IE5PTkVfT1ZFUkZMT1dcXG5yZXNldDogU3RyaW5nXFxufVxcbnR5cGUgR29hbERlYWRsaW5lQ29uZmlnIHtcXG5raW5kOiBBQlNPTFVURV9SRUxBVElWRSFcXG5kYXRlOiBTdHJpbmdcXG5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBOdW1iZXJcXG5ncmFjZV9kYXlzOiBOdW1iZXJcXG53YXJuX2RheXM6IE51bWJlclxcbn1cXG50eXBlIExpbmtzIHtcXG5hY3Rpdml0eTogQWN0aXZpdHlcXG5ncm91cDogR3JvdXBzXFxud2VpZ2h0OiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXJcXG5nb2FsX2lkOiBOdW1iZXIhXFxubGlua190eXBlOiBHb2FsTGlua1R5cGUhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbn1cXG50eXBlIEFjdGl2aXR5IHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnRpdGxlOiBTdHJpbmchXFxuZ3JvdXBfaWQ6IE51bWJlclxcbnN0YXJ0X3RpbWU6IFN0cmluZyFcXG5lbmRfdGltZTogU3RyaW5nIVxcbmlzX3JlY3VycmluZzogQm9vbGVhbiFcXG5kYXRlOiBTdHJpbmdcXG5ub3RpZmljYXRpb25fb2Zmc2V0czogW051bWJlciFdIVxcbn1cXG50eXBlIEdyb3VwcyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIEFjdGl2ZUN5Y2xlIHtcXG5kZWFkbGluZVN0YXRlOiBEZWFkbGluZVN0YXRlIVxcbnBlcmNlbnRDb21wbGV0ZTogTnVtYmVyIVxcbnJlbWFpbmluZzogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbmdvYWxfaWQ6IE51bWJlciFcXG50YXJnZXRfdmFsdWU6IE51bWJlciFcXG5zdGF0dXM6IEdvYWxDeWNsZVN0YXR1cyFcXG5zdGFydHNfYXQ6IERhdGUhXFxuY3ljbGVfaW5kZXg6IE51bWJlciFcXG5lbmRzX2F0OiBEYXRlXFxuZGVhZGxpbmVfYXQ6IERhdGVcXG5jdXJyZW50X3ZhbHVlOiBOdW1iZXIhXFxuY2Fycnlfb3ZlcjogTnVtYmVyIVxcbn1cXG50eXBlIEN5Y2xlc0FuZEN5Y2xlc18xIHtcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5nb2FsX2lkOiBOdW1iZXIhXFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXMhXFxuc3RhcnRzX2F0OiBEYXRlIVxcbmN5Y2xlX2luZGV4OiBOdW1iZXIhXFxuZW5kc19hdDogRGF0ZVxcbmRlYWRsaW5lX2F0OiBEYXRlXFxuY3VycmVudF92YWx1ZTogTnVtYmVyIVxcbmNhcnJ5X292ZXI6IE51bWJlciFcXG59XFxudHlwZSBEZXBlbmRlbmNpZXMge1xcbmRlcGVuZHNPbjogR29hbHNcXG50aHJlc2hvbGQ6IE51bWJlclxcbndlaWdodDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5nb2FsX2lkOiBOdW1iZXIhXFxuZGVwZW5kc19vbl9nb2FsX2lkOiBOdW1iZXIhXFxucmVxdWlyZW1lbnQ6IEdvYWxEZXBlbmRlbmN5UmVxdWlyZW1lbnQhXFxufVxcbnR5cGUgU25hcHNob3RzIHtcXG52YWx1ZTogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5nb2FsX2N5Y2xlX2lkOiBOdW1iZXIhXFxuYXNfb2Y6IFN0cmluZyFcXG59XFxudHlwZSBHb2FsTnVkZ2Uge1xcbmtpbmQ6IEdvYWxOdWRnZUtpbmQhXFxuZ29hbElkOiBOdW1iZXIhXFxudGl0bGU6IFN0cmluZyFcXG5tZXNzYWdlOiBTdHJpbmchXFxuc2V2ZXJpdHk6IElORk9fU1VDQ0VTU19XQVJOSU5HIVxcbn1cXG50eXBlIERhaWx5UHJvZ3Jlc3Mge1xcbmRhdGU6IFN0cmluZyFcXG5jb21wbGV0ZWRDb3VudDogTnVtYmVyIVxcbm1pbnV0ZXNUb2RheTogTnVtYmVyIVxcbnN0cmVha0RheXM6IE51bWJlciFcXG5jb21wbGV0aW9uczogW0FjdGl2aXR5Q29tcGxldGlvbnMhXSFcXG59XFxudHlwZSBBY3Rpdml0eUNvbXBsZXRpb25zIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5hY3Rpdml0eV9pZDogTnVtYmVyIVxcbm9jY3VycmVuY2VfZGF0ZTogU3RyaW5nIVxcbmR1cmF0aW9uX21pbnV0ZXM6IE51bWJlclxcbmNvbXBsZXRlZF9hdDogRGF0ZSFcXG5tZXRhZGF0YTogTWV0YWRhdGFcXG59XFxudHlwZSBNZXRhZGF0YSB7XFxudGl0bGU6IFN0cmluZ1xcbm5vdGVzOiBTdHJpbmdcXG50cmlnZ2VyX2V2ZW50czogW1N0cmluZyFdXFxufVxcbnR5cGUgQWN0aXZpdGllcyB7XFxucmVjdXJyZW5jZVBhdHRlcm46IFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuXFxuZ3JvdXA6IEdyb3VwXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG50aXRsZTogU3RyaW5nIVxcbmdyb3VwX2lkOiBOdW1iZXJcXG5zdGFydF90aW1lOiBTdHJpbmchXFxuZW5kX3RpbWU6IFN0cmluZyFcXG5pc19yZWN1cnJpbmc6IEJvb2xlYW4hXFxuZGF0ZTogU3RyaW5nXFxubm90aWZpY2F0aW9uX29mZnNldHM6IFtOdW1iZXIhXSFcXG59XFxudHlwZSBQYXJzZWRSZWN1cnJlbmNlUGF0dGVybiB7XFxuY29uZmlnOiBSZWN1cnJlbmNlQ29uZmlnIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXIhXFxucmVjdXJyZW5jZV90eXBlOiBXRUVLTFlfTU9OVEhMWV9FVkVSWV9YX0RBWVMhXFxufVxcbnR5cGUgUmVjdXJyZW5jZUNvbmZpZyB7XFxuZGF5c19vZl93ZWVrOiBbTnVtYmVyIV1cXG5kYXlzX29mX21vbnRoOiBbTnVtYmVyIV1cXG5pc19sYXN0X2RheV9vZl9tb250aDogQm9vbGVhblxcbmludGVydmFsX2RheXM6IE51bWJlclxcbnN0YXJ0X2RhdGU6IFN0cmluZyFcXG5lbmRfZGF0ZTogU3RyaW5nXFxufVxcbnR5cGUgR3JvdXAge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5jb2xvcjogU3RyaW5nIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBNdXRhdGlvbiB7XFxuY3JlYXRlUmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMTIhKTogUmV3YXJkRGVmaW5pdGlvbnMhXFxudXBkYXRlUmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMTMhKTogUmV3YXJkRGVmaW5pdGlvbnMhXFxuYXJjaGl2ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE0ISk6IFJld2FyZERlZmluaXRpb25zIVxcbnVuYXJjaGl2ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE1ISk6IFJld2FyZERlZmluaXRpb25zIVxcbmRlbGV0ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE2ISk6IEJvb2xlYW4hXFxuYXR0YWNoUmV3YXJkUnVsZShhcmdzOiBBcmdzSW5wdXRfMTchKTogUmV3YXJkUnVsZXMhXFxuZGV0YWNoUmV3YXJkUnVsZShhcmdzOiBBcmdzSW5wdXRfMTghKTogQm9vbGVhbiFcXG5jb25zdW1lUmV3YXJkKGFyZ3M6IEFyZ3NJbnB1dF8xOSEpOiBDb25zdW1lUmV3YXJkIVxcbmRpc2NhcmRSZXdhcmQoYXJnczogQXJnc0lucHV0XzIwISk6IERpc2NhcmRSZXdhcmQhXFxucmVzdG9yZVJld2FyZChhcmdzOiBBcmdzSW5wdXRfMjEhKTogUmVzdG9yZVJld2FyZCFcXG5tYW51YWxHcmFudFJld2FyZChhcmdzOiBBcmdzSW5wdXRfMjIhKTogUmV3YXJkSGlzdG9yeVxcbnJlY29tcHV0ZVJld2FyZEludmVudG9yeTogQm9vbGVhbiFcXG5jcmVhdGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yMyEpOiBHb2FscyFcXG51cGRhdGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yNCEpOiBHb2FscyFcXG5wYXVzZUdvYWwoYXJnczogQXJnc0lucHV0XzI1ISk6IEdvYWxzIVxcbnJlc3VtZUdvYWwoYXJnczogQXJnc0lucHV0XzI2ISk6IEdvYWxzIVxcbmFyY2hpdmVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yNyEpOiBHb2FscyFcXG5kZWxldGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yOCEpOiBCb29sZWFuIVxcbnJlY29tcHV0ZUdvYWxQcm9ncmVzcyhhcmdzOiBPYmplY3QpOiBSZWNvbXB1dGVHb2FsUHJvZ3Jlc3MhXFxuY3JlYXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzI5ISk6IENyZWF0ZUdyb3VwIVxcbnVwZGF0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8zMCEpOiBDcmVhdGVHcm91cCFcXG5kZWxldGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMzEhKTogQm9vbGVhbiFcXG5jcmVhdGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzIhKTogQWN0aXZpdGllcyFcXG51cGRhdGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzMhKTogQWN0aXZpdGllcyFcXG5kZWxldGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzQhKTogQm9vbGVhbiFcXG5jb21wbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8zNSEpOiBDb21wbGV0ZUFjdGl2aXR5IVxcbnVuZG9Db21wbGV0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8zNiEpOiBCb29sZWFuIVxcbmxvZ1RpbWUoYXJnczogQXJnc0lucHV0XzM3ISk6IExvZ1RpbWUhXFxufVxcbnR5cGUgQ29uc3VtZVJld2FyZCB7XFxuaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlcXG50cmFuc2FjdGlvbjogUmV3YXJkSGlzdG9yeSFcXG59XFxudHlwZSBEaXNjYXJkUmV3YXJkIHtcXG5pbnZlbnRvcnk6IFJld2FyZEludmVudG9yeVxcbnRyYW5zYWN0aW9uOiBSZXdhcmRIaXN0b3J5IVxcbn1cXG50eXBlIFJlc3RvcmVSZXdhcmQge1xcbmludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IVxcbnRyYW5zYWN0aW9uOiBSZXdhcmRIaXN0b3J5IVxcbn1cXG50eXBlIFJlY29tcHV0ZUdvYWxQcm9ncmVzcyB7XFxucmVjb21wdXRlZDogTnVtYmVyIVxcbn1cXG50eXBlIENyZWF0ZUdyb3VwIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgQ29tcGxldGVBY3Rpdml0eSB7XFxuZ3JhbnRlZFJld2FyZHM6IFtHcmFudGVkUmV3YXJkc10hXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXFxufVxcbnR5cGUgR3JhbnRlZFJld2FyZHMge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmltYWdlX2Fzc2V0X2lkOiBOdW1iZXJcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXJcXG5tZXRhZGF0YTogT2JqZWN0XFxucmV3YXJkX2RlZmluaXRpb25faWQ6IE51bWJlclxcbnF1YW50aXR5OiBOdW1iZXIhXFxudHlwZTogUmV3YXJkVHJhbnNhY3Rpb25UeXBlIVxcbmludmVudG9yeV9pZDogTnVtYmVyXFxuZGVmaW5pdGlvbl9uYW1lOiBTdHJpbmchXFxuZGVmaW5pdGlvbl9jb2xvcjogU3RyaW5nIVxcbmRlZmluaXRpb25faWNvbjogU3RyaW5nXFxuc291cmNlX3R5cGU6IFN0cmluZ1xcbnNvdXJjZV9pZDogTnVtYmVyXFxudHJpZ2dlcl9rZXk6IFN0cmluZ1xcbnJ1bGVfaWQ6IE51bWJlclxcbmdvYWxfaWQ6IE51bWJlclxcbmNvbXBsZXRpb25faWQ6IE51bWJlclxcbmN5Y2xlX2lkOiBOdW1iZXJcXG5ub3RlOiBTdHJpbmdcXG59XFxudHlwZSBMb2dUaW1lIHtcXG5hbW91bnQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXJcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZ1xcbm1ldGFkYXRhOiBPYmplY3RcXG5zb3VyY2VfdHlwZTogR29hbEV2ZW50U291cmNlVHlwZSFcXG5jb21wbGV0aW9uX2lkOiBOdW1iZXJcXG5tZXRyaWM6IEdvYWxFdmVudE1ldHJpYyFcXG5ncm91cF9pZDogTnVtYmVyXFxub2NjdXJyZWRfYXQ6IERhdGUhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gUmV3YXJkVHJhbnNhY3Rpb25UeXBlIHtcXG5cXHRlYXJuXFxuXFx0Y29uc3VtZVxcblxcdGRlbGV0ZVxcblxcdHJlc3RvcmVcXG5cXHRhZGp1c3RcXG59XFxuZW51bSBSZXdhcmRSdWxlTW9kZSB7XFxuXFx0Zml4ZWRcXG5cXHRwcm9iYWJpbGl0eVxcblxcdHJhbmRvbV9wb29sXFxufVxcbmVudW0gUmV3YXJkTnVkZ2VLaW5kIHtcXG5cXHRpbnZlbnRvcnlfYXZhaWxhYmxlXFxuXFx0cmVjZW50bHlfZWFybmVkXFxuXFx0dW5jb25zdW1lZF9zdGFja1xcbn1cXG5lbnVtIElORk9fU1VDQ0VTUyB7XFxuXFx0aW5mb1xcblxcdHN1Y2Nlc3NcXG59XFxuZW51bSBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxuXFx0c2NoZWR1bGVkXFxufVxcbmVudW0gR29hbE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxTdGF0dXMge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRCB7XFxuXFx0YWxsXFxuXFx0YW55XFxuXFx0d2VpZ2h0ZWRcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPVyB7XFxuXFx0bm9uZVxcblxcdG92ZXJmbG93XFxufVxcbmVudW0gQUJTT0xVVEVfUkVMQVRJVkUge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBHb2FsTGlua1R5cGUge1xcblxcdGFjdGl2aXR5XFxuXFx0Z3JvdXBcXG59XFxuZW51bSBEZWFkbGluZVN0YXRlIHtcXG5cXHRmYWlsZWRcXG5cXHRvbl90cmFja1xcblxcdGFwcHJvYWNoaW5nXFxuXFx0b3ZlcmR1ZVxcbn1cXG5lbnVtIEdvYWxDeWNsZVN0YXR1cyB7XFxuXFx0YWN0aXZlXFxuXFx0ZmFpbGVkXFxuXFx0c3VjY2VlZGVkXFxuXFx0bWlzc2VkXFxufVxcbmVudW0gR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCB7XFxuXFx0Y29tcGxldGVcXG5cXHRwcm9ncmVzc1xcbn1cXG5lbnVtIEdvYWxOdWRnZUtpbmQge1xcblxcdGRlYWRsaW5lX2FwcHJvYWNoaW5nXFxuXFx0ZGVhZGxpbmVfb3ZlcmR1ZVxcblxcdGJlaGluZF9wYWNlXFxuXFx0Y3ljbGVfY29tcGxldGVcXG5cXHRkZXBlbmRlbmN5X3VubG9ja2VkXFxuXFx0Z29hbF9zdGFydGluZ19zb29uXFxufVxcbmVudW0gSU5GT19TVUNDRVNTX1dBUk5JTkcge1xcblxcdGluZm9cXG5cXHRzdWNjZXNzXFxuXFx0d2FybmluZ1xcbn1cXG5lbnVtIFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5lbnVtIEdvYWxFdmVudFNvdXJjZVR5cGUge1xcblxcdGNvbXBsZXRpb25cXG5cXHR0aW1lX2xvZ1xcblxcdG1hbnVhbFxcbn1cXG5lbnVtIEdvYWxFdmVudE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIE5BTUVfUVVBTlRJVFlfUkVDRU5USW5wdXQge1xcblxcdG5hbWVcXG5cXHRxdWFudGl0eVxcblxcdHJlY2VudFxcbn1cXG5lbnVtIEZJWEVEX1BST0JBQklMSVRZX1JBTkRPTV9QT09MSW5wdXQge1xcblxcdGZpeGVkXFxuXFx0cHJvYmFiaWxpdHlcXG5cXHRyYW5kb21fcG9vbFxcbn1cXG5lbnVtIENPVU5UX0RVUkFUSU9OSW5wdXQge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBBTExfQU5ZX1dFSUdIVEVESW5wdXQge1xcblxcdGFsbFxcblxcdGFueVxcblxcdHdlaWdodGVkXFxufVxcbmVudW0gQUNUSVZJVFlfR1JPVVBJbnB1dCB7XFxuXFx0YWN0aXZpdHlcXG5cXHRncm91cFxcbn1cXG5lbnVtIENPTVBMRVRFX1BST0dSRVNTSW5wdXQge1xcblxcdGNvbXBsZXRlXFxuXFx0cHJvZ3Jlc3NcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRxdWFydGVybHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBOT05FX09WRVJGTE9XSW5wdXQge1xcblxcdG5vbmVcXG5cXHRvdmVyZmxvd1xcbn1cXG5lbnVtIEFCU09MVVRFX1JFTEFUSVZFSW5wdXQge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dCB7XFxuXFx0YWN0aXZlXFxuXFx0cGF1c2VkXFxuXFx0Y29tcGxldGVkXFxuXFx0YXJjaGl2ZWRcXG5cXHRmYWlsZWRcXG59XFxuZW51bSBSZWN1cnJlbmNlVHlwZUlucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgT25Db25mbGljdEJ1aWxkZXIsIFRyYW5zYWN0aW9uIH0gZnJvbSBcImt5c2VseVwiO1xuaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCI7XG5pbXBvcnQgeyBkYiB9IGZyb20gXCIuLi8uLi9kYi9kYXRhYmFzZS50c1wiO1xuaW1wb3J0IHR5cGUge1xuICBBY3Rpdml0eSBhcyBBY3Rpdml0eVJvdyxcbiAgRGF0YWJhc2UsXG4gIEdyb3VwIGFzIEdyb3VwUm93LFxuICBOZXdBY3Rpdml0eSxcbiAgTmV3QWN0aXZpdHlDb21wbGV0aW9uLFxuICBOZXdHb2FsRXZlbnQsXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzIH0gZnJvbSBcIi4uLy4uL2dvYWxzL3Byb2dyZXNzLnRzXCI7XG5pbXBvcnQge1xuICBDb21wbGV0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUdyb3VwSW5wdXQsXG4gIExvZ1RpbWVJbnB1dCxcbiAgUmVjdXJyZW5jZUNvbmZpZyxcbiAgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCxcbiAgVXBkYXRlQWN0aXZpdHlJbnB1dCxcbiAgVXBkYXRlR3JvdXBJbnB1dCxcbn0gZnJvbSBcIi4uL3R5cGVzLnRzXCI7XG5pbXBvcnQge1xuICBJbnZhbGlkQ29tcGxldGlvbkVycm9yLFxuICBJbnZhbGlkR3JvdXBFcnJvcixcbiAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlLFxuICB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyxcbiAgdmFsaWRhdGVHcm91cENvbG9yLFxuICB2YWxpZGF0ZUdyb3VwTmFtZSxcbiAgdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZSxcbiAgdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uLFxufSBmcm9tIFwiLi4vdmFsaWRhdGlvbi50c1wiO1xuaW1wb3J0IHsgbm9ybWFsaXplTm90aWZpY2F0aW9uT2Zmc2V0cyB9IGZyb20gXCIuLi9ub3RpZmljYXRpb25fb2Zmc2V0cy50c1wiO1xuaW1wb3J0IHsgYXNOdW1iZXIgfSBmcm9tIFwiLi4vbnVtZXJpYy50c1wiO1xuaW1wb3J0IHsgR29hbE11dGF0aW9uLCBHb2FsUXVlcnkgfSBmcm9tIFwiLi9nb2Fsc19yZXNvbHZlcnMudHNcIjtcbmltcG9ydCB7IFJld2FyZE11dGF0aW9uLCBSZXdhcmRRdWVyeSB9IGZyb20gXCIuL3Jld2FyZHNfcmVzb2x2ZXJzLnRzXCI7XG5pbXBvcnQge1xuICBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24sXG59IGZyb20gXCIuLi8uLi9yZXdhcmRzL2hvb2tzLnRzXCI7XG5pbXBvcnQge1xuICBEYkludmVudG9yeU1hbmFnZXIsXG59IGZyb20gXCIuLi8uLi9yZXdhcmRzL2ludmVudG9yeS50c1wiO1xuXG5pbnRlcmZhY2UgUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gZXh0ZW5kcyBPbWl0PFJlY3VycmVuY2VQYXR0ZXJuUm93LCBcImNvbmZpZ1wiPiB7XG4gIGNvbmZpZzogUmVjdXJyZW5jZUNvbmZpZztcbn1cblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KFwidXNlcklkXCIpO1xuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gXCJudW1iZXJcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlVuYXV0aGVudGljYXRlZFwiKTtcbiAgfVxuICByZXR1cm4gdXNlcklkO1xufVxuXG5mdW5jdGlvbiBwYXJzZUNvbmZpZyhjb25maWc6IFJlY3VycmVuY2VQYXR0ZXJuUm93W1wiY29uZmlnXCJdKTogUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiB0eXBlb2YgY29uZmlnID09PSBcInN0cmluZ1wiID8gSlNPTi5wYXJzZShjb25maWcpIDogY29uZmlnO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGFjdGl2aXR5SWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHlJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaEdyb3VwRm9yVXNlcihncm91cElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGdyb3VwSWQpXG4gICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG59XG5cbi8qKlxuICogUmVzb2x2ZXMgYSBncm91cElkIGZvciBjcmVhdGUvdXBkYXRlLiBUaHJvd3MgaWYgdGhlIGdyb3VwIGRvZXMgbm90IGJlbG9uZ1xuICogdG8gdGhlIHVzZXIuIFJldHVybnMgbnVsbCB3aGVuIGNsZWFyaW5nIG9yIHdoZW4gbm8gZ3JvdXAgaXMgYXNzaWduZWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVHcm91cElkKFxuICBncm91cElkOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZD4ge1xuICBpZiAoZ3JvdXBJZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdW5kZWZpbmVkO1xuICBpZiAoZ3JvdXBJZCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG5cbiAgY29uc3QgZ3JvdXAgPSBhd2FpdCBmZXRjaEdyb3VwRm9yVXNlcihncm91cElkLCB1c2VySWQpO1xuICBpZiAoIWdyb3VwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKFwiZ3JvdXAgbm90IGZvdW5kXCIpO1xuICB9XG4gIHJldHVybiBncm91cC5pZDtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hPd25lZEFjdGl2aXR5KGFjdGl2aXR5SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG59XG5cbi8vIFB5bG9uIHJlc29sdmVzIG5lc3RlZCBHcmFwaFFMIGZpZWxkcyBmcm9tIChwb3NzaWJseSBhc3luYykgcHJvcGVydGllcyBvblxuLy8gdGhlIHJldHVybmVkIG9iamVjdCwgbm90IGZyb20gYSBzZXBhcmF0ZSByZXNvbHZlciBtYXAgXHUyMDE0IHNvIG5lc3RlZCBkYXRhIGlzXG4vLyBhdHRhY2hlZCBpbmxpbmUgaGVyZSByYXRoZXIgdGhhbiB2aWEgYSBzdGFuZGFsb25lIHJlc29sdmVyIGV4cG9ydC5cbmZ1bmN0aW9uIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eTogQWN0aXZpdHlSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5hY3Rpdml0eSxcbiAgICByZWN1cnJlbmNlUGF0dGVybjogYXN5bmMgKCk6IFByb21pc2U8UGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gfCBudWxsPiA9PiB7XG4gICAgICBpZiAoIWFjdGl2aXR5LmlzX3JlY3VycmluZykgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBwYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eS5pZCk7XG4gICAgICBpZiAoIXBhdHRlcm4pIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcocGF0dGVybi5jb25maWcpO1xuICAgICAgaWYgKCFjb25maWcpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgLi4ucGF0dGVybiwgY29uZmlnIH07XG4gICAgfSxcbiAgICBncm91cDogYXN5bmMgKCk6IFByb21pc2U8R3JvdXBSb3cgfCBudWxsPiA9PiB7XG4gICAgICBpZiAoYWN0aXZpdHkuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFjdGl2aXR5Lmdyb3VwX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgZ3JvdXBzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoXCJuYW1lXCIsIFwiYXNjXCIpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH0sXG5cbiAgZ3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICB9LFxuXG4gIGFjdGl2aXRpZXM6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIHJldHVybiByb3dzLm1hcCh3aXRoQWN0aXZpdHlSZWxhdGlvbnMpO1xuICB9LFxuXG4gIGFjdGl2aXR5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgcmV0dXJuIHJvdyA/IHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhyb3cpIDogbnVsbDtcbiAgfSxcblxuICBhY3Rpdml0eUNvbXBsZXRpb25zOiBhc3luYyAoYXJncz86IHtcbiAgICBhY3Rpdml0eUlkPzogbnVtYmVyO1xuICAgIGZyb21EYXRlPzogc3RyaW5nO1xuICAgIHRvRGF0ZT86IHN0cmluZztcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCJkZXNjXCIpXG4gICAgICAuc2VsZWN0QWxsKCk7XG5cbiAgICBpZiAoYXJncz8uYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFyZ3MuYWN0aXZpdHlJZCk7XG4gICAgfVxuICAgIGlmIChhcmdzPy5mcm9tRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIj49XCIsIGFyZ3MuZnJvbURhdGUpO1xuICAgIH1cbiAgICBpZiAoYXJncz8udG9EYXRlKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiPD1cIiwgYXJncy50b0RhdGUpO1xuICAgIH1cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpO1xuICB9LFxuXG4gIC4uLkdvYWxRdWVyeSxcbiAgLi4uUmV3YXJkUXVlcnksXG59O1xuXG5leHBvcnQgY29uc3QgTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlR3JvdXBJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpO1xuICAgIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ3JvdXBzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dyb3VwKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICB1cGRhdGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgbmFtZSA9IGlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lO1xuICAgIGNvbnN0IGNvbG9yID0gaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpXG4gICAgICA6IGV4aXN0aW5nLmNvbG9yO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoXCJncm91cHNcIilcbiAgICAgIC5zZXQoe1xuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgZGVsZXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNyZWF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7XG4gICAgICBpc1JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICBkYXRlOiBpbnB1dC5kYXRlLFxuICAgICAgcmVjdXJyZW5jZVBhdHRlcm46IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uT2Zmc2V0cyA9IG5vcm1hbGl6ZU5vdGlmaWNhdGlvbk9mZnNldHMoXG4gICAgICBpbnB1dC5ub3RpZmljYXRpb25PZmZzZXRzLFxuICAgICk7XG4gICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IHJlc29sdmVHcm91cElkKGlucHV0Lmdyb3VwSWQgPz8gbnVsbCwgdXNlcklkKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlucHV0LmlzUmVjdXJyaW5nID8gbnVsbCA6IChpbnB1dC5kYXRlID8/IG51bGwpLFxuICAgICAgICAgIGdyb3VwX2lkOiBncm91cElkID8/IG51bGwsXG4gICAgICAgICAgbm90aWZpY2F0aW9uX29mZnNldHM6IG5vdGlmaWNhdGlvbk9mZnNldHMsXG4gICAgICAgIH0gYXMgTmV3QWN0aXZpdHkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlucHV0LmlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgdXBkYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IGlzUmVjdXJyaW5nID0gaW5wdXQuaXNSZWN1cnJpbmcgPz8gZXhpc3RpbmcuaXNfcmVjdXJyaW5nO1xuICAgIGNvbnN0IGRhdGUgPSBpbnB1dC5kYXRlICE9PSB1bmRlZmluZWQgPyBpbnB1dC5kYXRlIDogZXhpc3RpbmcuZGF0ZTtcblxuICAgIC8vIElmIHRoZSBzY2hlZHVsZSBpcyBzdGlsbCByZWN1cnJpbmcgYW5kIG5vIG5ldyBwYXR0ZXJuIHdhcyBzdXBwbGllZCxcbiAgICAvLyB2YWxpZGF0ZSBhZ2FpbnN0IHRoZSBwYXR0ZXJuIGFscmVhZHkgb24gZmlsZS5cbiAgICBsZXQgcmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm47XG4gICAgaWYgKGlzUmVjdXJyaW5nICYmICFyZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgY29uc3QgZXhpc3RpbmdQYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihpZCk7XG4gICAgICBpZiAoZXhpc3RpbmdQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKGV4aXN0aW5nUGF0dGVybi5jb25maWcpO1xuICAgICAgICByZWN1cnJlbmNlUGF0dGVybiA9IGNvbmZpZ1xuICAgICAgICAgID8geyByZWN1cnJlbmNlVHlwZTogZXhpc3RpbmdQYXR0ZXJuLnJlY3VycmVuY2VfdHlwZSwgY29uZmlnIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoeyBpc1JlY3VycmluZywgZGF0ZSwgcmVjdXJyZW5jZVBhdHRlcm4gfSk7XG5cbiAgICBjb25zdCByZXNvbHZlZEdyb3VwSWQgPSBpbnB1dC5ncm91cElkICE9PSB1bmRlZmluZWRcbiAgICAgID8gYXdhaXQgcmVzb2x2ZUdyb3VwSWQoaW5wdXQuZ3JvdXBJZCwgdXNlcklkKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBub3RpZmljYXRpb25PZmZzZXRzID0gaW5wdXQubm90aWZpY2F0aW9uT2Zmc2V0cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IG5vcm1hbGl6ZU5vdGlmaWNhdGlvbk9mZnNldHMoaW5wdXQubm90aWZpY2F0aW9uT2Zmc2V0cylcbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+KSA9PiB7XG4gICAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IHRyeFxuICAgICAgICAudXBkYXRlVGFibGUoXCJhY3Rpdml0aWVzXCIpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgc3RhcnRfdGltZTogaW5wdXQuc3RhcnRUaW1lLFxuICAgICAgICAgIGVuZF90aW1lOiBpbnB1dC5lbmRUaW1lLFxuICAgICAgICAgIGlzX3JlY3VycmluZzogaXNSZWN1cnJpbmcsXG4gICAgICAgICAgZGF0ZTogaXNSZWN1cnJpbmcgPyBudWxsIDogKGRhdGUgPz8gbnVsbCksXG4gICAgICAgICAgLi4uKHJlc29sdmVkR3JvdXBJZCAhPT0gdW5kZWZpbmVkID8geyBncm91cF9pZDogcmVzb2x2ZWRHcm91cElkIH0gOiB7fSksXG4gICAgICAgICAgLi4uKG5vdGlmaWNhdGlvbk9mZnNldHMgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7IG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBub3RpZmljYXRpb25PZmZzZXRzIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLm9uQ29uZmxpY3QoKG9jOiBPbkNvbmZsaWN0QnVpbGRlcjxhbnksIGFueT4pID0+XG4gICAgICAgICAgICBvYy5jb2x1bW5zKFtcImFjdGl2aXR5X2lkXCJdKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4hLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5jb25maWcpLFxuICAgICAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfSBlbHNlIGlmICghaXNSZWN1cnJpbmcpIHtcbiAgICAgICAgLy8gQ2xlYW4gdXAgYW55IHN0YWxlIHBhdHRlcm4gb25jZSBhbiBhY3Rpdml0eSBzdG9wcyByZWN1cnJpbmcuXG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5kZWxldGVGcm9tKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhY3Rpdml0eS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0aXZpdHk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5KTtcbiAgfSxcblxuICBkZWxldGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlciB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDA7XG4gIH0sXG5cbiAgY29tcGxldGVBY3Rpdml0eTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENvbXBsZXRlQWN0aXZpdHlJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgb2NjdXJyZW5jZURhdGUgPSB2YWxpZGF0ZU9jY3VycmVuY2VEYXRlKGlucHV0Lm9jY3VycmVuY2VEYXRlKTtcbiAgICBjb25zdCBkdXJhdGlvbk1pbnV0ZXMgPSB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyhpbnB1dC5kdXJhdGlvbk1pbnV0ZXMpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBmZXRjaE93bmVkQWN0aXZpdHkoaW5wdXQuYWN0aXZpdHlJZCwgdXNlcklkKTtcbiAgICBpZiAoIWFjdGl2aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcihcImFjdGl2aXR5IG5vdCBmb3VuZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgY29tcGxldGlvbiA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAgIC53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhY3Rpdml0eS5pZClcbiAgICAgICAgLndoZXJlKFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiPVwiLCBvY2N1cnJlbmNlRGF0ZSlcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG5cbiAgICAgIGlmIChleGlzdGluZykge1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuZGVsZXRlRnJvbShcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgICAgLndoZXJlKFwiY29tcGxldGlvbl9pZFwiLCBcIj1cIiwgZXhpc3RpbmcuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgY29tcGxldGlvbiA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50byhcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgICBkdXJhdGlvbl9taW51dGVzOiBkdXJhdGlvbk1pbnV0ZXMsXG4gICAgICAgICAgY29tcGxldGVkX2F0OiBub3csXG4gICAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHsgbm90ZXM6IGlucHV0Lm5vdGVzLCB0aXRsZTogYWN0aXZpdHkudGl0bGUgfSlcbiAgICAgICAgICAgIDogSlNPTi5zdHJpbmdpZnkoeyB0aXRsZTogYWN0aXZpdHkudGl0bGUgfSksXG4gICAgICAgIH0gYXMgTmV3QWN0aXZpdHlDb21wbGV0aW9uKVxuICAgICAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICAgICAgb2MuY29sdW1ucyhbXCJhY3Rpdml0eV9pZFwiLCBcIm9jY3VycmVuY2VfZGF0ZVwiXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICAgICAgZHVyYXRpb25fbWludXRlczogZHVyYXRpb25NaW51dGVzLFxuICAgICAgICAgICAgY29tcGxldGVkX2F0OiBub3csXG4gICAgICAgICAgICBtZXRhZGF0YTogaW5wdXQubm90ZXNcbiAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcywgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pXG4gICAgICAgICAgICAgIDogSlNPTi5zdHJpbmdpZnkoeyB0aXRsZTogYWN0aXZpdHkudGl0bGUgfSksXG4gICAgICAgICAgfSlcbiAgICAgICAgKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIC8vIENvdW50IGV2ZW50XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgc291cmNlX3R5cGU6IFwiY29tcGxldGlvblwiLFxuICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICBncm91cF9pZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgICAgICAgY29tcGxldGlvbl9pZDogY29tcGxldGlvbi5pZCxcbiAgICAgICAgICBvY2N1cnJlZF9hdDogbm93LFxuICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgbWV0cmljOiBcImNvdW50XCIsXG4gICAgICAgICAgYW1vdW50OiAxLFxuICAgICAgICAgIG1ldGFkYXRhOiBudWxsLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSBhcyBOZXdHb2FsRXZlbnQpXG4gICAgICAgIC5leGVjdXRlKCk7XG5cbiAgICAgIC8vIE9wdGlvbmFsIGR1cmF0aW9uIGV2ZW50IHdoZW4gbWludXRlcyBwcm92aWRlZCBvciBkZXJpdmVkIGZyb20gc2NoZWR1bGUuXG4gICAgICBsZXQgbWludXRlcyA9IGR1cmF0aW9uTWludXRlcztcbiAgICAgIGlmIChtaW51dGVzID09IG51bGwpIHtcbiAgICAgICAgLy8gRGVyaXZlIGZyb20gc2NoZWR1bGVkIHNsb3Qgd2hlbiBwb3NzaWJsZS5cbiAgICAgICAgY29uc3QgW3NoLCBzbV0gPSBhY3Rpdml0eS5zdGFydF90aW1lLnNwbGl0KFwiOlwiKS5tYXAoTnVtYmVyKTtcbiAgICAgICAgY29uc3QgW2VoLCBlbV0gPSBhY3Rpdml0eS5lbmRfdGltZS5zcGxpdChcIjpcIikubWFwKE51bWJlcik7XG4gICAgICAgIGNvbnN0IGRlcml2ZWQgPSAoZWggKiA2MCArIGVtKSAtIChzaCAqIDYwICsgc20pO1xuICAgICAgICBpZiAoZGVyaXZlZCA+IDApIG1pbnV0ZXMgPSBkZXJpdmVkO1xuICAgICAgfVxuICAgICAgaWYgKG1pbnV0ZXMgIT0gbnVsbCAmJiBtaW51dGVzID4gMCkge1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50byhcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICBzb3VyY2VfdHlwZTogXCJjb21wbGV0aW9uXCIsXG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICBncm91cF9pZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgICAgICAgICBjb21wbGV0aW9uX2lkOiBjb21wbGV0aW9uLmlkLFxuICAgICAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgICBtZXRyaWM6IFwiZHVyYXRpb25cIixcbiAgICAgICAgICAgIGFtb3VudDogbWludXRlcyxcbiAgICAgICAgICAgIG1ldGFkYXRhOiBudWxsLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBjb21wbGV0aW9uO1xuICAgIH0pO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICB9KTtcblxuICAgIGNvbnN0IGdyYW50ZWQgPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgcmV0dXJuIGF3YWl0IGdyYW50UmV3YXJkc0ZvckFjdGl2aXR5Q29tcGxldGlvbih0cngsIHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBhY3Rpdml0eUlkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgY29tcGxldGlvbklkOiBjb21wbGV0aW9uLmlkLFxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uY29tcGxldGlvbixcbiAgICAgIGdyYW50ZWRSZXdhcmRzOiBncmFudGVkXG4gICAgICAgIC5maWx0ZXIoKGcpID0+ICFnLnNraXBwZWQgJiYgZy50cmFuc2FjdGlvbilcbiAgICAgICAgLm1hcCgoZykgPT4gZy50cmFuc2FjdGlvbiksXG4gICAgfTtcbiAgfSxcblxuICB1bmRvQ29tcGxldGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghZXhpc3RpbmcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGV4aXN0aW5nLmFjdGl2aXR5X2lkLCB1c2VySWQpO1xuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGNvbnN0IG1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKCk7XG4gICAgICBhd2FpdCBtYW5hZ2VyLnJldm9rZVVuY29uc3VtZWRGb3JDb21wbGV0aW9uKHRyeCwgdXNlcklkLCBleGlzdGluZy5pZCk7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLmRlbGV0ZUZyb20oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAud2hlcmUoXCJjb21wbGV0aW9uX2lkXCIsIFwiPVwiLCBleGlzdGluZy5pZClcbiAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbShcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBleGlzdGluZy5pZClcbiAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICB9KTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGV4aXN0aW5nLmFjdGl2aXR5X2lkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHk/Lmdyb3VwX2lkID8/IG51bGwsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICBsb2dUaW1lOiBhc3luYyAoYXJnczogeyBpbnB1dDogTG9nVGltZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCBtaW51dGVzID0gdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uKGlucHV0LmR1cmF0aW9uTWludXRlcyk7XG4gICAgY29uc3Qgb2NjdXJyZW5jZURhdGUgPSB2YWxpZGF0ZU9jY3VycmVuY2VEYXRlKFxuICAgICAgaW5wdXQub2NjdXJyZW5jZURhdGUgPz8gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSxcbiAgICApO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBmZXRjaE93bmVkQWN0aXZpdHkoaW5wdXQuYWN0aXZpdHlJZCwgdXNlcklkKTtcbiAgICBpZiAoIWFjdGl2aXR5KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcihcImFjdGl2aXR5IG5vdCBmb3VuZFwiKTtcbiAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgY29uc3QgZXZlbnQgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgc291cmNlX3R5cGU6IFwidGltZV9sb2dcIixcbiAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICBncm91cF9pZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgICAgIGNvbXBsZXRpb25faWQ6IG51bGwsXG4gICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgIG1ldHJpYzogXCJkdXJhdGlvblwiLFxuICAgICAgICBhbW91bnQ6IG1pbnV0ZXMsXG4gICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMgfSlcbiAgICAgICAgICA6IG51bGwsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgfSk7XG5cbiAgICByZXR1cm4ge1xuICAgICAgLi4uZXZlbnQsXG4gICAgICBhbW91bnQ6IGFzTnVtYmVyKGV2ZW50LmFtb3VudCksXG4gICAgfTtcbiAgfSxcblxuICAuLi5Hb2FsTXV0YXRpb24sXG4gIC4uLlJld2FyZE11dGF0aW9uLFxufTtcblxuZXhwb3J0IGNvbnN0IHJlc29sdmVycyA9IHtcbiAgUXVlcnksXG4gIE11dGF0aW9uLFxufTtcbiIsICJpbXBvcnQgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEluc2VydGFibGUsIFNlbGVjdGFibGUsIFVwZGF0ZWFibGUgfSBmcm9tICdreXNlbHknXG5cbi8vIE1haW4gRGF0YWJhc2UgaW50ZXJmYWNlIHRoYXQgZGVzY3JpYmVzIGFsbCB0YWJsZXNcbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2Uge1xuICB1c2VyczogVXNlcnNUYWJsZVxuICBncm91cHM6IEdyb3Vwc1RhYmxlXG4gIGFjdGl2aXRpZXM6IEFjdGl2aXRpZXNUYWJsZVxuICByZWN1cnJlbmNlX3BhdHRlcm5zOiBSZWN1cnJlbmNlUGF0dGVybnNUYWJsZVxuICBhY3Rpdml0eV9jb21wbGV0aW9uczogQWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlXG4gIGdvYWxfZXZlbnRzOiBHb2FsRXZlbnRzVGFibGVcbiAgZ29hbHM6IEdvYWxzVGFibGVcbiAgZ29hbF9saW5rczogR29hbExpbmtzVGFibGVcbiAgZ29hbF9jeWNsZXM6IEdvYWxDeWNsZXNUYWJsZVxuICBnb2FsX2RlcGVuZGVuY2llczogR29hbERlcGVuZGVuY2llc1RhYmxlXG4gIGdvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzOiBHb2FsUHJvZ3Jlc3NTbmFwc2hvdHNUYWJsZVxuICBhc3NldHM6IEFzc2V0c1RhYmxlXG4gIHJld2FyZF9kZWZpbml0aW9uczogUmV3YXJkRGVmaW5pdGlvbnNUYWJsZVxuICByZXdhcmRfcnVsZXM6IFJld2FyZFJ1bGVzVGFibGVcbiAgcmV3YXJkX2ludmVudG9yeTogUmV3YXJkSW52ZW50b3J5VGFibGVcbiAgcmV3YXJkX3RyYW5zYWN0aW9uczogUmV3YXJkVHJhbnNhY3Rpb25zVGFibGVcbn1cblxuLy8gVXNlcnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEdyb3VwcyB0YWJsZSBpbnRlcmZhY2UgXHUyMDE0IHVzZXItc2NvcGVkIGFjdGl2aXR5IHRheG9ub215IHdpdGggZGlzcGxheSBjb2xvci5cbmV4cG9ydCBpbnRlcmZhY2UgR3JvdXBzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICAvLyBIZXggY29sb3IgZnJvbSB0aGUgc2hhcmVkIHByZXNldCBwYWxldHRlLCBlLmcuIFwiIzBGNzY2RVwiXG4gIGNvbG9yOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0aWVzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0aWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIC8vIE9wdGlvbmFsIGdyb3VwIGFzc2lnbm1lbnQuIE51bGwgd2hlbiB1bmdyb3VwZWQ7IGNsZWFyZWQgaWYgdGhlIGdyb3VwXG4gIC8vIGlzIGRlbGV0ZWQgKE9OIERFTEVURSBTRVQgTlVMTCkuXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgc3RhcnRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBlbmRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBpc19yZWN1cnJpbmc6IGJvb2xlYW5cbiAgLy8gQ2FsZW5kYXIgZGF0ZSB0aGUgYWN0aXZpdHkgb2NjdXJzIG9uLiBSZXF1aXJlZCB3aGVuIGlzX3JlY3VycmluZyBpc1xuICAvLyBmYWxzZTsgbnVsbCB3aGVuIGlzX3JlY3VycmluZyBpcyB0cnVlIChkYXRlcyBsaXZlIGluIHRoZSByZWN1cnJlbmNlXG4gIC8vIHBhdHRlcm4ncyBjb25maWcgaW5zdGVhZCkuXG4gIGRhdGU6IHN0cmluZyB8IG51bGxcbiAgLy8gTWludXRlcyBiZWZvcmUgc3RhcnRfdGltZSB0byBmaXJlIGEgbG9jYWwgcmVtaW5kZXI7IDAgPSBhdCBzdGFydC5cbiAgLy8gRW1wdHkgYXJyYXkgPSBubyByZW1pbmRlcnMuIE1heCA4IHVuaXF1ZSB2YWx1ZXMgaW4gWzAsIDEwMDgwXS5cbiAgbm90aWZpY2F0aW9uX29mZnNldHM6IG51bWJlcltdXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gUmVjdXJyZW5jZSBwYXR0ZXJucyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgUmVjdXJyZW5jZVBhdHRlcm5zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgYWN0aXZpdHlfaWQ6IG51bWJlclxuICAvLyBUeXBlIG9mIHJlY3VycmVuY2U6IHdlZWtseSwgbW9udGhseSwgb3IgZXZlcnkgWCBkYXlzXG4gIHJlY3VycmVuY2VfdHlwZTogJ3dlZWtseScgfCAnbW9udGhseScgfCAnZXZlcnlfeF9kYXlzJ1xuICAvLyBKU09OIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSByZWN1cnJlbmNlXG4gIGNvbmZpZzogQ29sdW1uVHlwZTx7XG4gICAgLy8gRm9yIHdlZWtseTogYXJyYXkgb2YgZGF5cyAoMC02LCB3aGVyZSAwIGlzIFN1bmRheSlcbiAgICBkYXlzX29mX3dlZWs/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBkYXlzIG9mIHRoZSBtb250aCAoMS0zMSlcbiAgICBkYXlzX29mX21vbnRoPzogbnVtYmVyW11cbiAgICAvLyBGb3IgbW9udGhseTogYWxzbyByZXBlYXQgb24gdGhlIGxhc3QgZGF5IG9mIHRoZSBtb250aC4gS2VwdCBhcyBpdHNcbiAgICAvLyBvd24gYm9vbGVhbiAocmF0aGVyIHRoYW4gYSAnbGFzdCcgc2VudGluZWwgaW4gZGF5c19vZl9tb250aCkgYmVjYXVzZVxuICAgIC8vIFB5bG9uL0dyYXBoUUwgaW5wdXQgdHlwZXMgY2FuJ3QgcmVwcmVzZW50IGEgbnVtYmVyfHN0cmluZyB1bmlvbi5cbiAgICBpc19sYXN0X2RheV9vZl9tb250aD86IGJvb2xlYW5cbiAgICAvLyBGb3IgZXZlcnlfeF9kYXlzOiByZXBlYXQgZXZlcnkgTiBkYXlzICg+PSAxKVxuICAgIGludGVydmFsX2RheXM/OiBudW1iZXJcbiAgICAvLyBTdGFydCBkYXRlIG9mIHRoZSByZWN1cnJlbmNlXG4gICAgc3RhcnRfZGF0ZTogc3RyaW5nXG4gICAgLy8gRW5kIGRhdGUgb2YgdGhlIHJlY3VycmVuY2UgKG9wdGlvbmFsKVxuICAgIGVuZF9kYXRlPzogc3RyaW5nIHwgbnVsbFxuICB9LCBzdHJpbmcsIHN0cmluZz5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0eSBjb21wbGV0aW9ucyBcdTIwMTQgb25lIHJvdyBwZXIgKGFjdGl2aXR5LCBvY2N1cnJlbmNlX2RhdGUpXG5leHBvcnQgaW50ZXJmYWNlIEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZ1xuICBkdXJhdGlvbl9taW51dGVzOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICAvLyBTdG9yZSBhbnkgYWRkaXRpb25hbCBkYXRhIGFib3V0IHRoZSBjb21wbGV0aW9uXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPHtcbiAgICB0aXRsZT86IHN0cmluZ1xuICAgIG5vdGVzPzogc3RyaW5nXG4gICAgdHJpZ2dlcl9ldmVudHM/OiBzdHJpbmdbXVxuICB9IHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbn1cblxuZXhwb3J0IHR5cGUgR29hbEV2ZW50U291cmNlVHlwZSA9ICdjb21wbGV0aW9uJyB8ICd0aW1lX2xvZycgfCAnbWFudWFsJ1xuZXhwb3J0IHR5cGUgR29hbEV2ZW50TWV0cmljID0gJ2NvdW50JyB8ICdkdXJhdGlvbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRXZlbnRzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNvdXJjZV90eXBlOiBHb2FsRXZlbnRTb3VyY2VUeXBlXG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgb2NjdXJyZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBuZXZlcj5cbiAgb2NjdXJyZW5jZV9kYXRlOiBzdHJpbmcgfCBudWxsXG4gIG1ldHJpYzogR29hbEV2ZW50TWV0cmljXG4gIGFtb3VudDogbnVtYmVyXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsU3RhdHVzID0gJ2FjdGl2ZScgfCAncGF1c2VkJyB8ICdjb21wbGV0ZWQnIHwgJ2FyY2hpdmVkJyB8ICdmYWlsZWQnXG5leHBvcnQgdHlwZSBHb2FsTWV0cmljID0gJ2NvdW50JyB8ICdkdXJhdGlvbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XG4gIHBlcmlvZDogJ3dlZWtseScgfCAnbW9udGhseScgfCAncXVhcnRlcmx5JyB8ICdldmVyeV94X2RheXMnXG4gIGludGVydmFsPzogbnVtYmVyXG4gIGFuY2hvcj86IHN0cmluZ1xuICBjYXJyeV9vdmVyPzogJ25vbmUnIHwgJ292ZXJmbG93J1xuICByZXNldD86ICdoYXJkJ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxEZWFkbGluZUNvbmZpZyB7XG4gIGtpbmQ6ICdhYnNvbHV0ZScgfCAncmVsYXRpdmUnXG4gIGRhdGU/OiBzdHJpbmdcbiAgZGF5c19hZnRlcl9jeWNsZV9zdGFydD86IG51bWJlclxuICBncmFjZV9kYXlzPzogbnVtYmVyXG4gIHdhcm5fZGF5cz86IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxDb25maWcge1xuICBjb21wb3NpdGVfbW9kZT86ICdhbGwnIHwgJ2FueScgfCAnd2VpZ2h0ZWQnXG4gIGNvdW50X3JlcXVpcmVkPzogbnVtYmVyXG4gIGJlZm9yZV90aW1lPzogc3RyaW5nXG4gIGFmdGVyX3RpbWU/OiBzdHJpbmdcbiAgYmxvY2tfdW50aWxfdW5sb2NrZWQ/OiBib29sZWFuXG4gIFtrZXk6IHN0cmluZ106IHVua25vd25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2Fsc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIGNvbG9yOiBzdHJpbmdcbiAgaWNvbjogc3RyaW5nIHwgbnVsbFxuICBydWxlX3R5cGU6IHN0cmluZ1xuICBtZXRyaWM6IEdvYWxNZXRyaWNcbiAgdGFyZ2V0X3ZhbHVlOiBudW1iZXJcbiAgY29uZmlnOiBDb2x1bW5UeXBlPEdvYWxDb25maWcsIHN0cmluZyB8IEdvYWxDb25maWcsIHN0cmluZyB8IEdvYWxDb25maWc+XG4gIHN0YXR1czogR29hbFN0YXR1c1xuICByZWN1cnJlbmNlOiBDb2x1bW5UeXBlPFxuICAgIEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsXG4gID5cbiAgZGVhZGxpbmU6IENvbHVtblR5cGU8XG4gICAgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGxcbiAgPlxuICBwcmlvcml0eTogbnVtYmVyXG4gIHNvcnRfb3JkZXI6IG51bWJlclxuICAvKiogRWZmZWN0aXZlIHN0YXJ0IG9mIHRoZSBnb2FsIChzZWVkcyBjeWNsZSAwKS4gQWx3YXlzIHNldC4gKi9cbiAgc3RhcnRzX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxMaW5rVHlwZSA9ICdhY3Rpdml0eScgfCAnZ3JvdXAnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbExpbmtzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGxpbmtfdHlwZTogR29hbExpbmtUeXBlXG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHdlaWdodDogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlU3RhdHVzID0gJ2FjdGl2ZScgfCAnc3VjY2VlZGVkJyB8ICdmYWlsZWQnIHwgJ21pc3NlZCdcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsQ3ljbGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGN5Y2xlX2luZGV4OiBudW1iZXJcbiAgc3RhcnRzX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxuICBlbmRzX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICBkZWFkbGluZV9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgdGFyZ2V0X3ZhbHVlOiBudW1iZXJcbiAgY3VycmVudF92YWx1ZTogbnVtYmVyXG4gIHN0YXR1czogR29hbEN5Y2xlU3RhdHVzXG4gIGNhcnJ5X292ZXI6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5UmVxdWlyZW1lbnQgPSAnY29tcGxldGUnIHwgJ3Byb2dyZXNzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxEZXBlbmRlbmNpZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgZGVwZW5kc19vbl9nb2FsX2lkOiBudW1iZXJcbiAgcmVxdWlyZW1lbnQ6IEdvYWxEZXBlbmRlbmN5UmVxdWlyZW1lbnRcbiAgdGhyZXNob2xkOiBudW1iZXIgfCBudWxsXG4gIHdlaWdodDogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsUHJvZ3Jlc3NTbmFwc2hvdHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2N5Y2xlX2lkOiBudW1iZXJcbiAgYXNfb2Y6IHN0cmluZ1xuICB2YWx1ZTogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuLy8gRXhwb3J0IGNvbnZlbmllbmNlIHR5cGVzIGZvciBlYWNoIHRhYmxlXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3VXNlciA9IEluc2VydGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIFVzZXJVcGRhdGUgPSBVcGRhdGVhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdyb3VwID0gU2VsZWN0YWJsZTxHcm91cHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dyb3VwID0gSW5zZXJ0YWJsZTxHcm91cHNUYWJsZT5cbmV4cG9ydCB0eXBlIEdyb3VwVXBkYXRlID0gVXBkYXRlYWJsZTxHcm91cHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQWN0aXZpdHkgPSBTZWxlY3RhYmxlPEFjdGl2aXRpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0FjdGl2aXR5ID0gSW5zZXJ0YWJsZTxBY3Rpdml0aWVzVGFibGU+XG5leHBvcnQgdHlwZSBBY3Rpdml0eVVwZGF0ZSA9IFVwZGF0ZWFibGU8QWN0aXZpdGllc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBSZWN1cnJlbmNlUGF0dGVybiA9IFNlbGVjdGFibGU8UmVjdXJyZW5jZVBhdHRlcm5zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZWN1cnJlbmNlUGF0dGVybiA9IEluc2VydGFibGU8UmVjdXJyZW5jZVBhdHRlcm5zVGFibGU+XG5leHBvcnQgdHlwZSBSZWN1cnJlbmNlUGF0dGVyblVwZGF0ZSA9IFVwZGF0ZWFibGU8UmVjdXJyZW5jZVBhdHRlcm5zVGFibGU+XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5Q29tcGxldGlvbiA9IFNlbGVjdGFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QWN0aXZpdHlDb21wbGV0aW9uID0gSW5zZXJ0YWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBBY3Rpdml0eUNvbXBsZXRpb25VcGRhdGUgPSBVcGRhdGVhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbEV2ZW50ID0gU2VsZWN0YWJsZTxHb2FsRXZlbnRzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsRXZlbnQgPSBJbnNlcnRhYmxlPEdvYWxFdmVudHNUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxFdmVudFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbEV2ZW50c1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsID0gU2VsZWN0YWJsZTxHb2Fsc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbCA9IEluc2VydGFibGU8R29hbHNUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxMaW5rID0gU2VsZWN0YWJsZTxHb2FsTGlua3NUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxMaW5rID0gSW5zZXJ0YWJsZTxHb2FsTGlua3NUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxMaW5rVXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsTGlua3NUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlID0gU2VsZWN0YWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsQ3ljbGUgPSBJbnNlcnRhYmxlPEdvYWxDeWNsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxDeWNsZVVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbEN5Y2xlc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsRGVwZW5kZW5jeSA9IFNlbGVjdGFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbERlcGVuZGVuY3kgPSBJbnNlcnRhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxQcm9ncmVzc1NuYXBzaG90ID0gU2VsZWN0YWJsZTxHb2FsUHJvZ3Jlc3NTbmFwc2hvdHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxQcm9ncmVzc1NuYXBzaG90ID0gSW5zZXJ0YWJsZTxHb2FsUHJvZ3Jlc3NTbmFwc2hvdHNUYWJsZT5cbmV4cG9ydCB0eXBlIEdvYWxQcm9ncmVzc1NuYXBzaG90VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsUHJvZ3Jlc3NTbmFwc2hvdHNUYWJsZT5cblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBBc3NldHMgJiBSZXdhcmRzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBBc3NldHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgc2hhMjU2OiBzdHJpbmdcbiAgY29udGVudF90eXBlOiBzdHJpbmdcbiAgYnl0ZV9zaXplOiBudW1iZXJcbiAgc3RvcmFnZV9rZXk6IHN0cmluZ1xuICByZWZfY291bnQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIG9ycGhhbmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZERlZmluaXRpb25zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBub3Rlczogc3RyaW5nIHwgbnVsbFxuICBjYXRlZ29yeTogc3RyaW5nIHwgbnVsbFxuICB0YWdzOiBDb2x1bW5UeXBlPHN0cmluZ1tdLCBzdHJpbmcgfCBzdHJpbmdbXSwgc3RyaW5nIHwgc3RyaW5nW10+XG4gIGNvbG9yOiBzdHJpbmdcbiAgaWNvbjogc3RyaW5nIHwgbnVsbFxuICBpbWFnZV9hc3NldF9pZDogbnVtYmVyIHwgbnVsbFxuICBzdGFja2FibGU6IGJvb2xlYW5cbiAgZGVmYXVsdF9xdWFudGl0eTogbnVtYmVyXG4gIHNvcnRfb3JkZXI6IG51bWJlclxuICBhcmNoaXZlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBSZXdhcmRSdWxlTW9kZSA9ICdmaXhlZCcgfCAncHJvYmFiaWxpdHknIHwgJ3JhbmRvbV9wb29sJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZFJ1bGVDb25maWcge1xuICBvbmNlPzogYm9vbGVhblxuICBjb29sZG93bl9ob3Vycz86IG51bWJlclxuICBtYXhfZ3JhbnRzX3RvdGFsPzogbnVtYmVyXG4gIG1heF9ncmFudHNfcGVyX3BlcmlvZD86IG51bWJlclxuICBwZXJpb2RfaG91cnM/OiBudW1iZXJcbiAgcHJvYmFiaWxpdHk/OiBudW1iZXJcbiAgLyoqIFBvb2wgb2YgZGVmaW5pdGlvbiBpZHMgZm9yIHJhbmRvbV9wb29sIG1vZGUuICovXG4gIHBvb2w/OiBBcnJheTx7IGRlZmluaXRpb25faWQ6IG51bWJlcjsgd2VpZ2h0PzogbnVtYmVyOyBxdWFudGl0eT86IG51bWJlciB9PlxuICBba2V5OiBzdHJpbmddOiB1bmtub3duXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkUnVsZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgc291cmNlX3R5cGU6IHN0cmluZ1xuICBzb3VyY2VfaWQ6IG51bWJlclxuICByZXdhcmRfZGVmaW5pdGlvbl9pZDogbnVtYmVyXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgbW9kZTogUmV3YXJkUnVsZU1vZGVcbiAgY29uZmlnOiBDb2x1bW5UeXBlPFxuICAgIFJld2FyZFJ1bGVDb25maWcsXG4gICAgc3RyaW5nIHwgUmV3YXJkUnVsZUNvbmZpZyxcbiAgICBzdHJpbmcgfCBSZXdhcmRSdWxlQ29uZmlnXG4gID5cbiAgZW5hYmxlZDogYm9vbGVhblxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkSW52ZW50b3J5VGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHJld2FyZF9kZWZpbml0aW9uX2lkOiBudW1iZXJcbiAgcXVhbnRpdHk6IG51bWJlclxuICBzdGFja19rZXk6IHN0cmluZyB8IG51bGxcbiAgZmlyc3RfZWFybmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxuICBsYXN0X2Vhcm5lZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgUmV3YXJkVHJhbnNhY3Rpb25UeXBlID1cbiAgfCAnZWFybidcbiAgfCAnY29uc3VtZSdcbiAgfCAnZGVsZXRlJ1xuICB8ICdyZXN0b3JlJ1xuICB8ICdhZGp1c3QnXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkVHJhbnNhY3Rpb25zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHR5cGU6IFJld2FyZFRyYW5zYWN0aW9uVHlwZVxuICByZXdhcmRfZGVmaW5pdGlvbl9pZDogbnVtYmVyIHwgbnVsbFxuICBpbnZlbnRvcnlfaWQ6IG51bWJlciB8IG51bGxcbiAgcXVhbnRpdHk6IG51bWJlclxuICBkZWZpbml0aW9uX25hbWU6IHN0cmluZ1xuICBkZWZpbml0aW9uX2NvbG9yOiBzdHJpbmdcbiAgZGVmaW5pdGlvbl9pY29uOiBzdHJpbmcgfCBudWxsXG4gIGltYWdlX2Fzc2V0X2lkOiBudW1iZXIgfCBudWxsXG4gIHNvdXJjZV90eXBlOiBzdHJpbmcgfCBudWxsXG4gIHNvdXJjZV9pZDogbnVtYmVyIHwgbnVsbFxuICB0cmlnZ2VyX2tleTogc3RyaW5nIHwgbnVsbFxuICBydWxlX2lkOiBudW1iZXIgfCBudWxsXG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsXG4gIGdvYWxfaWQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbl9pZDogbnVtYmVyIHwgbnVsbFxuICBjeWNsZV9pZDogbnVtYmVyIHwgbnVsbFxuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPFxuICAgIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCxcbiAgICBzdHJpbmcgfCBudWxsLFxuICAgIHN0cmluZyB8IG51bGxcbiAgPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEFzc2V0ID0gU2VsZWN0YWJsZTxBc3NldHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0Fzc2V0ID0gSW5zZXJ0YWJsZTxBc3NldHNUYWJsZT5cbmV4cG9ydCB0eXBlIEFzc2V0VXBkYXRlID0gVXBkYXRlYWJsZTxBc3NldHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmV3YXJkRGVmaW5pdGlvbiA9IFNlbGVjdGFibGU8UmV3YXJkRGVmaW5pdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZERlZmluaXRpb24gPSBJbnNlcnRhYmxlPFJld2FyZERlZmluaXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBSZXdhcmREZWZpbml0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmREZWZpbml0aW9uc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBSZXdhcmRSdWxlID0gU2VsZWN0YWJsZTxSZXdhcmRSdWxlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmV3YXJkUnVsZSA9IEluc2VydGFibGU8UmV3YXJkUnVsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZFJ1bGVVcGRhdGUgPSBVcGRhdGVhYmxlPFJld2FyZFJ1bGVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZEludmVudG9yeSA9IFNlbGVjdGFibGU8UmV3YXJkSW52ZW50b3J5VGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZXdhcmRJbnZlbnRvcnkgPSBJbnNlcnRhYmxlPFJld2FyZEludmVudG9yeVRhYmxlPlxuZXhwb3J0IHR5cGUgUmV3YXJkSW52ZW50b3J5VXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmRJbnZlbnRvcnlUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmV3YXJkVHJhbnNhY3Rpb24gPSBTZWxlY3RhYmxlPFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmV3YXJkVHJhbnNhY3Rpb24gPSBJbnNlcnRhYmxlPFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmV3YXJkVHJhbnNhY3Rpb25VcGRhdGUgPSBVcGRhdGVhYmxlPFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlPlxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5cbi8vIEtlZXAgUG9zdGdyZXMgYGRhdGVgIGFzIGBZWVlZLU1NLUREYCBzdHJpbmdzLiBUaGUgZGVmYXVsdCBwZyBwYXJzZXIgdHVybnNcbi8vIHRoZW0gaW50byBKUyBEYXRlIG9iamVjdHMsIHdoaWNoIEdyYXBoUUwgdGhlbiBzdHJpbmdpZmllcyBhcyBmdWxsIHRpbWVzdGFtcHNcbi8vIChvciBEYXRlLnRvU3RyaW5nKCkpIGFuZCBicmVha3MgRmx1dHRlcidzIGRhdGUtb25seSBwYXJzaW5nLlxudHlwZXMuc2V0VHlwZVBhcnNlcih0eXBlcy5idWlsdGlucy5EQVRFLCAodmFsdWU6IHN0cmluZykgPT4gdmFsdWUpXG5cbmNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgcG9vbDogbmV3IFBvb2woe1xuICAgIGRhdGFiYXNlOiAndGltZW1hbmFnZXInLFxuICAgIGhvc3Q6ICdsb2NhbGhvc3QnLFxuICAgIHVzZXI6ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogNTQzMixcbiAgICBtYXg6IDEwLFxuICB9KVxufSlcblxuLy8gRGF0YWJhc2UgaW50ZXJmYWNlIGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLCBLeXNlbHkgXG4vLyBrbm93cyB5b3VyIGRhdGFiYXNlIHN0cnVjdHVyZS5cbi8vIERpYWxlY3QgaXMgcGFzc2VkIHRvIEt5c2VseSdzIGNvbnN0cnVjdG9yLCBhbmQgZnJvbSBub3cgb24sIEt5c2VseSBrbm93cyBob3cgXG4vLyB0byBjb21tdW5pY2F0ZSB3aXRoIHlvdXIgZGF0YWJhc2UuXG5leHBvcnQgY29uc3QgZGIgPSBuZXcgS3lzZWx5PERhdGFiYXNlPih7XG4gIGRpYWxlY3QsXG59KSIsICJpbXBvcnQgdHlwZSB7IEdvYWwsIEdvYWxDeWNsZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgR29hbExpZmVjeWNsZVBoYXNlID1cbiAgfCAnc2NoZWR1bGVkJ1xuICB8ICdhY3RpdmUnXG4gIHwgJ3BhdXNlZCdcbiAgfCAnY29tcGxldGVkJ1xuICB8ICdhcmNoaXZlZCdcbiAgfCAnZmFpbGVkJ1xuXG4vKiogRGVyaXZlZCBVSS9BUEkgcGhhc2UgXHUyMDE0IHNjaGVkdWxlZCBpcyBub3QgYSBzdG9yZWQgc3RhdHVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxpZmVjeWNsZVBoYXNlKFxuICBnb2FsOiBQaWNrPEdvYWwsICdzdGF0dXMnIHwgJ3N0YXJ0c19hdCc+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbExpZmVjeWNsZVBoYXNlIHtcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgcmV0dXJuICdwYXVzZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpIHJldHVybiAnY29tcGxldGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhcmNoaXZlZCcpIHJldHVybiAnYXJjaGl2ZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHJldHVybiAnZmFpbGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnICYmIG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KSA+IG5vdykge1xuICAgIHJldHVybiAnc2NoZWR1bGVkJ1xuICB9XG4gIHJldHVybiAnYWN0aXZlJ1xufVxuXG4vKiogVHJ1ZSB3aGVuIHRoZSBjeWNsZSBldmFsdWF0aW9uIHdpbmRvdyBoYXMgYmVndW4uICovXG5leHBvcnQgZnVuY3Rpb24gY3ljbGVIYXNTdGFydGVkKFxuICBjeWNsZTogUGljazxHb2FsQ3ljbGUsICdzdGFydHNfYXQnPixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gbm93ID49IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbEV2ZW50LFxuICBHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlUmVzdWx0IHtcbiAgY3VycmVudFZhbHVlOiBudW1iZXJcbiAgZG9uZTogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlQ29udGV4dCB7XG4gIGdvYWw6IEdvYWxcbiAgY3ljbGU6IEdvYWxDeWNsZVxuICBsaW5rczogR29hbExpbmtbXVxuICBldmVudHM6IEdvYWxFdmVudFtdXG4gIC8qKiBBY3RpdmUgKG9yIGxhdGVzdCkgY2hpbGQgY3ljbGVzIGtleWVkIGJ5IGNoaWxkIGdvYWwgaWQsIGZvciBjb21wb3NpdGVzLiAqL1xuICBjaGlsZEN5Y2xlcz86IE1hcDxudW1iZXIsIEdvYWxDeWNsZT5cbiAgLyoqIENoaWxkIGRlcGVuZGVuY3kgd2VpZ2h0cyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLiAqL1xuICBjaGlsZFdlaWdodHM/OiBNYXA8bnVtYmVyLCBudW1iZXI+XG4gIC8qKiBGb3IgZ3JvdXBfYWxsX2NvbXBsZXRlOiBhY3Rpdml0eSBpZHMgdGhhdCBiZWxvbmcgdG8gbGlua2VkIGdyb3Vwcy4gKi9cbiAgZ3JvdXBBY3Rpdml0eUlkcz86IG51bWJlcltdXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEV2YWx1YXRvciB7XG4gIHJ1bGVUeXBlOiBzdHJpbmdcbiAgZXZhbHVhdGUoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdFxufVxuXG4vKiogRGVkdXBsaWNhdGUgZXZlbnRzIGJ5IChhY3Rpdml0eV9pZCwgb2NjdXJyZW5jZV9kYXRlKSwgcHJlZmVycmluZyBmaXJzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWR1cGVFdmVudHMoZXZlbnRzOiBHb2FsRXZlbnRbXSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIGNvbnN0IG91dDogR29hbEV2ZW50W10gPSBbXVxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgIGNvbnN0IGtleSA9IGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgZXZlbnQub2NjdXJyZW5jZV9kYXRlXG4gICAgICA/IGAke2V2ZW50LmFjdGl2aXR5X2lkfToke2V2ZW50Lm9jY3VycmVuY2VfZGF0ZX06JHtldmVudC5tZXRyaWN9YFxuICAgICAgOiBgaWQ6JHtldmVudC5pZH1gXG4gICAgaWYgKHNlZW4uaGFzKGtleSkpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQoa2V5KVxuICAgIG91dC5wdXNoKGV2ZW50KVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gZXZlbnRzSW5XaW5kb3coZXZlbnRzOiBHb2FsRXZlbnRbXSwgY3ljbGU6IEdvYWxDeWNsZSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICBjb25zdCBlbmQgPSBjeWNsZS5lbmRzX2F0ID8gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gIHJldHVybiBldmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGUub2NjdXJyZWRfYXQpLmdldFRpbWUoKVxuICAgIHJldHVybiB0ID49IHN0YXJ0ICYmIHQgPCBlbmRcbiAgfSlcbn1cblxuZnVuY3Rpb24gbGlua2VkQWN0aXZpdHlJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJiBsLmFjdGl2aXR5X2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmFjdGl2aXR5X2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gbGlua2VkR3JvdXBJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwX2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gd2VpZ2h0Rm9yRXZlbnQoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBudW1iZXIge1xuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlua3MpIHtcbiAgICBpZiAoXG4gICAgICBsaW5rLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJlxuICAgICAgbGluay5hY3Rpdml0eV9pZCAhPSBudWxsICYmXG4gICAgICBldmVudC5hY3Rpdml0eV9pZCA9PT0gbGluay5hY3Rpdml0eV9pZFxuICAgICkge1xuICAgICAgcmV0dXJuIE51bWJlcihsaW5rLndlaWdodClcbiAgICB9XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdncm91cCcgJiZcbiAgICAgIGxpbmsuZ3JvdXBfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuZ3JvdXBfaWQgPT09IGxpbmsuZ3JvdXBfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICB9XG4gIHJldHVybiAxXG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNMaW5rcyhldmVudDogR29hbEV2ZW50LCBsaW5rczogR29hbExpbmtbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBhY3Rpdml0aWVzID0gbGlua2VkQWN0aXZpdHlJZHMobGlua3MpXG4gIGNvbnN0IGdyb3VwcyA9IGxpbmtlZEdyb3VwSWRzKGxpbmtzKVxuICBpZiAoYWN0aXZpdGllcy5zaXplID09PSAwICYmIGdyb3Vwcy5zaXplID09PSAwKSByZXR1cm4gZmFsc2VcbiAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgYWN0aXZpdGllcy5oYXMoZXZlbnQuYWN0aXZpdHlfaWQpKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXZlbnQuZ3JvdXBfaWQgIT0gbnVsbCAmJiBncm91cHMuaGFzKGV2ZW50Lmdyb3VwX2lkKSkgcmV0dXJuIHRydWVcbiAgcmV0dXJuIGZhbHNlXG59XG5cbmZ1bmN0aW9uIHN1bVdlaWdodGVkKFxuICBldmVudHM6IEdvYWxFdmVudFtdLFxuICBsaW5rczogR29hbExpbmtbXSxcbiAgbWV0cmljOiAnY291bnQnIHwgJ2R1cmF0aW9uJyxcbik6IG51bWJlciB7XG4gIGxldCB0b3RhbCA9IDBcbiAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMoZXZlbnRzKSkge1xuICAgIGlmIChldmVudC5tZXRyaWMgIT09IG1ldHJpYykgY29udGludWVcbiAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgbGlua3MpKSBjb250aW51ZVxuICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGxpbmtzKVxuICB9XG4gIHJldHVybiB0b3RhbFxufVxuXG5mdW5jdGlvbiB3aXRoQ2FycnlPdmVyKHZhbHVlOiBudW1iZXIsIGN5Y2xlOiBHb2FsQ3ljbGUpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgdmFsdWUgKyBOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciB8fCAwKSlcbn1cblxuZnVuY3Rpb24gcmVzdWx0KHZhbHVlOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogRXZhbHVhdGVSZXN1bHQge1xuICBjb25zdCBjdXJyZW50VmFsdWUgPSBNYXRoLm1heCgwLCB2YWx1ZSlcbiAgcmV0dXJuIHtcbiAgICBjdXJyZW50VmFsdWUsXG4gICAgZG9uZTogdGFyZ2V0ID4gMCA/IGN1cnJlbnRWYWx1ZSA+PSB0YXJnZXQgOiBjdXJyZW50VmFsdWUgPiAwLFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdkdXJhdGlvbicpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBncm91cENvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuLyoqIENvdW50IGNvbXBsZXRpb25zIG9mIGFueSBhY3Rpdml0eSBpbiBsaW5rZWQgZ3JvdXBzLiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQW55Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYW55X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgcmV0dXJuIGdyb3VwQ291bnRFdmFsdWF0b3IuZXZhbHVhdGUoY3R4KVxuICB9LFxufVxuXG4vKipcbiAqIFByb2dyZXNzID0gbnVtYmVyIG9mIGRpc3RpbmN0IGxpbmtlZC1ncm91cCBhY3Rpdml0aWVzIGNvbXBsZXRlZCBhdCBsZWFzdFxuICogb25jZSBpbiB0aGUgY3ljbGUuIFRhcmdldCBpcyB0eXBpY2FsbHkgdGhlIHNpemUgb2YgdGhlIGdyb3VwLlxuICovXG5leHBvcnQgY29uc3QgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9hbGxfY29tcGxldGUnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBhY3Rpdml0eUlkcyA9IG5ldyBTZXQoY3R4Lmdyb3VwQWN0aXZpdHlJZHMgPz8gW10pXG4gICAgY29uc3QgY29tcGxldGVkID0gbmV3IFNldDxudW1iZXI+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoZXZlbnQuYWN0aXZpdHlfaWQgPT0gbnVsbCkgY29udGludWVcbiAgICAgIGlmIChhY3Rpdml0eUlkcy5zaXplID4gMCAmJiAhYWN0aXZpdHlJZHMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpICYmIGFjdGl2aXR5SWRzLnNpemUgPT09IDApIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgfHwgbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSB7XG4gICAgICAgIGNvbXBsZXRlZC5hZGQoZXZlbnQuYWN0aXZpdHlfaWQpXG4gICAgICB9XG4gICAgfVxuICAgIC8vIFByZWZlciBjb3VudGluZyBvbmx5IGFjdGl2aXRpZXMgdGhhdCBiZWxvbmcgdG8gdGhlIGdyb3VwLlxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIGFjdGl2aXR5SWRzLnNpemUgPiAwXG4gICAgICAgID8gWy4uLmNvbXBsZXRlZF0uZmlsdGVyKChpZCkgPT4gYWN0aXZpdHlJZHMuaGFzKGlkKSkubGVuZ3RoXG4gICAgICAgIDogY29tcGxldGVkLnNpemUsXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdtdWx0aV9hY3Rpdml0eV9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqIENvbnNlY3V0aXZlIGNhbGVuZGFyIGRheXMgd2l0aCBhdCBsZWFzdCBvbmUgbWF0Y2hpbmcgY291bnQgZXZlbnQuICovXG5leHBvcnQgY29uc3Qgc3RyZWFrRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ3N0cmVhaycsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IGRheXMgPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKHdpbmRvd2VkKSkge1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gJ2NvdW50JykgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSBjb250aW51ZVxuICAgICAgY29uc3QgZGF5ID0gZXZlbnQub2NjdXJyZW5jZV9kYXRlID8/XG4gICAgICAgIG5ldyBEYXRlKGV2ZW50Lm9jY3VycmVkX2F0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuICAgICAgZGF5cy5hZGQoZGF5KVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uZGF5c10uc29ydCgpXG4gICAgbGV0IGJlc3QgPSAwXG4gICAgbGV0IHJ1biA9IDBcbiAgICBsZXQgcHJldjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IGRheSBvZiBzb3J0ZWQpIHtcbiAgICAgIGlmIChwcmV2KSB7XG4gICAgICAgIGNvbnN0IHByZXZEYXRlID0gbmV3IERhdGUocHJldiArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgY3VyRGF0ZSA9IG5ldyBEYXRlKGRheSArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgZGlmZiA9IChjdXJEYXRlLmdldFRpbWUoKSAtIHByZXZEYXRlLmdldFRpbWUoKSkgLyA4Nl80MDBfMDAwXG4gICAgICAgIHJ1biA9IGRpZmYgPT09IDEgPyBydW4gKyAxIDogMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcnVuID0gMVxuICAgICAgfVxuICAgICAgYmVzdCA9IE1hdGgubWF4KGJlc3QsIHJ1bilcbiAgICAgIHByZXYgPSBkYXlcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKGJlc3QsIGN0eC5jeWNsZSlcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyB3aG9zZSBvY2N1cnJlbmNlIGxvY2FsIHRpbWUgaXMgYmVmb3JlIGNvbmZpZy5iZWZvcmVfdGltZS4gKi9cbmV4cG9ydCBjb25zdCB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICd0aW1lX29mX2RheV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IGJlZm9yZSA9IHR5cGVvZiBjb25maWcuYmVmb3JlX3RpbWUgPT09ICdzdHJpbmcnID8gY29uZmlnLmJlZm9yZV90aW1lIDogbnVsbFxuICAgIGNvbnN0IGFmdGVyID0gdHlwZW9mIGNvbmZpZy5hZnRlcl90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5hZnRlcl90aW1lIDogbnVsbFxuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGxldCB0b3RhbCA9IDBcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGhobW0gPSBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgxMSwgMTYpXG4gICAgICBpZiAoYmVmb3JlICYmIGhobW0gPj0gYmVmb3JlKSBjb250aW51ZVxuICAgICAgaWYgKGFmdGVyICYmIGhobW0gPCBhZnRlcikgY29udGludWVcbiAgICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGN0eC5saW5rcylcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdCh3aXRoQ2FycnlPdmVyKHRvdGFsLCBjdHguY3ljbGUpLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBjb21wb3NpdGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnY29tcG9zaXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3QgY29uZmlnID0gdHlwZW9mIGN0eC5nb2FsLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShjdHguZ29hbC5jb25maWcpXG4gICAgICA6IChjdHguZ29hbC5jb25maWcgPz8ge30pXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZy5jb21wb3NpdGVfbW9kZSA/PyAnYWxsJ1xuICAgIGNvbnN0IGNoaWxkcmVuID0gY3R4LmNoaWxkQ3ljbGVzXG4gICAgaWYgKCFjaGlsZHJlbiB8fCBjaGlsZHJlbi5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm4gcmVzdWx0KDAsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gWy4uLmNoaWxkcmVuLmVudHJpZXMoKV1cbiAgICBpZiAobW9kZSA9PT0gJ3dlaWdodGVkJykge1xuICAgICAgbGV0IHdlaWdodGVkU3VtID0gMFxuICAgICAgbGV0IHdlaWdodFRvdGFsID0gMFxuICAgICAgZm9yIChjb25zdCBbY2hpbGRJZCwgY3ljbGVdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgdyA9IE51bWJlcihjdHguY2hpbGRXZWlnaHRzPy5nZXQoY2hpbGRJZCkgPz8gMSlcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3MgPSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDBcbiAgICAgICAgICA/IE1hdGgubWluKDEsIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSAvIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgICAgICAgIDogKGN5Y2xlLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgPyAxIDogMClcbiAgICAgICAgd2VpZ2h0ZWRTdW0gKz0gcHJvZ3Jlc3MgKiB3XG4gICAgICAgIHdlaWdodFRvdGFsICs9IHdcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBjdCA9IHdlaWdodFRvdGFsID4gMCA/IHdlaWdodGVkU3VtIC8gd2VpZ2h0VG90YWwgOiAwXG4gICAgICAvLyBSZXByZXNlbnQgYXMgMFx1MjAxMzEwMCBwZXJjZW50IG9mIHRhcmdldC5cbiAgICAgIGNvbnN0IHZhbHVlID0gcGN0ICogTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29tcGxldGVkID0gZW50cmllcy5maWx0ZXIoKFssIGNdKSA9PlxuICAgICAgYy5zdGF0dXMgPT09ICdzdWNjZWVkZWQnIHx8XG4gICAgICAoTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSA+IDAgJiYgTnVtYmVyKGMuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSlcbiAgICApLmxlbmd0aFxuXG4gICAgaWYgKG1vZGUgPT09ICdhbnknKSB7XG4gICAgICBjb25zdCBuZWVkZWQgPSBNYXRoLm1heCgxLCBOdW1iZXIoY29uZmlnLmNvdW50X3JlcXVpcmVkID8/IDEpKVxuICAgICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIG5lZWRlZClcbiAgICB9XG5cbiAgICAvLyBhbGxcbiAgICByZXR1cm4gcmVzdWx0KGNvbXBsZXRlZCwgZW50cmllcy5sZW5ndGgpXG4gIH0sXG59XG5cbmNvbnN0IEVWQUxVQVRPUlM6IEdvYWxFdmFsdWF0b3JbXSA9IFtcbiAgYWN0aXZpdHlDb3VudEV2YWx1YXRvcixcbiAgYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbnlDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcixcbiAgbXVsdGlBY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLFxuICBzdHJlYWtFdmFsdWF0b3IsXG4gIHRpbWVPZkRheUNvdW50RXZhbHVhdG9yLFxuICBjb21wb3NpdGVFdmFsdWF0b3IsXG5dXG5cbmNvbnN0IFJFR0lTVFJZID0gbmV3IE1hcChFVkFMVUFUT1JTLm1hcCgoZSkgPT4gW2UucnVsZVR5cGUsIGVdKSlcblxuZXhwb3J0IGNvbnN0IEdPQUxfUlVMRV9UWVBFUyA9IEVWQUxVQVRPUlMubWFwKChlKSA9PiBlLnJ1bGVUeXBlKVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RXZhbHVhdG9yKHJ1bGVUeXBlOiBzdHJpbmcpOiBHb2FsRXZhbHVhdG9yIHtcbiAgY29uc3QgZXZhbHVhdG9yID0gUkVHSVNUUlkuZ2V0KHJ1bGVUeXBlKVxuICBpZiAoIWV2YWx1YXRvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBnb2FsIHJ1bGVfdHlwZTogJHtydWxlVHlwZX1gKVxuICB9XG4gIHJldHVybiBldmFsdWF0b3Jcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlR29hbChjdHg6IEV2YWx1YXRlQ29udGV4dCk6IEV2YWx1YXRlUmVzdWx0IHtcbiAgcmV0dXJuIGdldEV2YWx1YXRvcihjdHguZ29hbC5ydWxlX3R5cGUpLmV2YWx1YXRlKGN0eClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknO1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgR29hbCxcbiAgR29hbEN5Y2xlLFxuICBHb2FsRXZlbnQsXG4gIEdvYWxMaW5rLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnO1xuaW1wb3J0IHsgY3ljbGVIYXNTdGFydGVkIH0gZnJvbSAnLi9saWZlY3ljbGUudHMnO1xuaW1wb3J0IHsgZXZhbHVhdGVHb2FsIH0gZnJvbSAnLi9ldmFsdWF0b3JzL2luZGV4LnRzJztcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+O1xuXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24pOiBUIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge30gYXMgVDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh2YWx1ZSA/PyB7fSkgYXMgVDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoR29hbExpbmtzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8R29hbExpbmtbXT4ge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoRXZlbnRzRm9yVXNlcihcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIGZyb20/OiBEYXRlIHwgc3RyaW5nLFxuICB0bz86IERhdGUgfCBzdHJpbmcsXG4pOiBQcm9taXNlPEdvYWxFdmVudFtdPiB7XG4gIGxldCBxdWVyeSA9IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZXZlbnRzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKCk7XG5cbiAgaWYgKGZyb20pIHtcbiAgICBjb25zdCBmcm9tRGF0ZSA9IHR5cGVvZiBmcm9tID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKGZyb20pIDogZnJvbTtcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdvY2N1cnJlZF9hdCcsICc+PScsIGZyb21EYXRlIGFzIG5ldmVyKTtcbiAgfVxuICBpZiAodG8pIHtcbiAgICBjb25zdCB0b0RhdGUgPSB0eXBlb2YgdG8gPT09ICdzdHJpbmcnID8gbmV3IERhdGUodG8pIDogdG87XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnb2NjdXJyZWRfYXQnLCAnPCcsIHRvRGF0ZSBhcyBuZXZlcik7XG4gIH1cblxuICByZXR1cm4gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gIGRiOiBEYkxpa2UsXG4gIGxpbmtzOiBHb2FsTGlua1tdLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyW10+IHtcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua190eXBlID09PSAnZ3JvdXAnICYmIGwuZ3JvdXBfaWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISk7XG4gIGlmIChncm91cElkcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdncm91cF9pZCcsICdpbicsIGdyb3VwSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpO1xuICByZXR1cm4gcm93cy5tYXAoKHIpID0+IHIuaWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaENoaWxkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8eyBjeWNsZXM6IE1hcDxudW1iZXIsIEdvYWxDeWNsZT47IHdlaWdodHM6IE1hcDxudW1iZXIsIG51bWJlcj4gfT4ge1xuICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgY29uc3QgY3ljbGVzID0gbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKTtcbiAgY29uc3Qgd2VpZ2h0cyA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7XG5cbiAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgIHdlaWdodHMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIE51bWJlcihkZXAud2VpZ2h0KSk7XG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcblxuICAgIGlmIChjeWNsZSkge1xuICAgICAgY3ljbGVzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBjeWNsZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAobGF0ZXN0KSBjeWNsZXMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIGxhdGVzdCk7XG4gIH1cblxuICByZXR1cm4geyBjeWNsZXMsIHdlaWdodHMgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGhpdHRpbmcgdGhlIHRhcmdldCBzaG91bGQgY2xvc2UgdGhlIGN5Y2xlIGltbWVkaWF0ZWx5LlxuICogUmVjdXJyaW5nIGN5Y2xlcyBzdGF5IGBhY3RpdmVgIHVudGlsIHJvbGwtb3ZlciBhdCBlbmRzX2F0IHNvIHRoZSBVSSBrZWVwc1xuICogYW4gYWN0aXZlQ3ljbGUgKGFuZCBwcm9ncmVzcykgZm9yIHRoZSByZXN0IG9mIHRoZSB3aW5kb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoXG4gIGdvYWw6IFBpY2s8R29hbCwgJ3JlY3VycmVuY2UnPixcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gZ29hbC5yZWN1cnJlbmNlID09IG51bGw7XG59XG5cbi8qKlxuICogUmVjb21wdXRlIGFuZCBwZXJzaXN0IGN1cnJlbnRfdmFsdWUgZm9yIGEgc2luZ2xlIGN5Y2xlLlxuICogUmV0dXJucyB0aGUgdXBkYXRlZCBjeWNsZS5cbiAqIFNraXBzIGFjY3J1YWwgd2hpbGUgdGhlIGN5Y2xlIGhhcyBub3Qgc3RhcnRlZCAoa2VlcHMgY3VycmVudF92YWx1ZSBhdCAwLFxuICogbmV2ZXIgYXV0by1zdWNjZWVkcykgXHUyMDE0IGNvdmVycyBjb21wb3NpdGUgcGFyZW50cyBjb21wbGV0aW5nIGVhcmx5IHZpYSBjaGlsZHJlbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgaWYgKGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgIWN5Y2xlSGFzU3RhcnRlZChjeWNsZSwgbm93KSkge1xuICAgIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPT09IDApIHJldHVybiBjeWNsZTtcbiAgICBjb25zdCBzdGFtcGVkID0gbm93LnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgIC5zZXQoeyBjdXJyZW50X3ZhbHVlOiAwLCB1cGRhdGVkX2F0OiBzdGFtcGVkIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH1cblxuICBjb25zdCBsaW5rcyA9IGF3YWl0IGZldGNoR29hbExpbmtzKGRiLCBnb2FsLmlkKTtcbiAgY29uc3QgZXZlbnRzID0gYXdhaXQgZmV0Y2hFdmVudHNGb3JVc2VyKFxuICAgIGRiLFxuICAgIGdvYWwudXNlcl9pZCxcbiAgICBjeWNsZS5zdGFydHNfYXQsXG4gICAgY3ljbGUuZW5kc19hdCA/PyB1bmRlZmluZWQsXG4gICk7XG4gIGNvbnN0IGdyb3VwQWN0aXZpdHlJZHMgPSBhd2FpdCBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gICAgZGIsXG4gICAgbGlua3MsXG4gICAgZ29hbC51c2VyX2lkLFxuICApO1xuICBjb25zdCB7IGN5Y2xlczogY2hpbGRDeWNsZXMsIHdlaWdodHM6IGNoaWxkV2VpZ2h0cyB9ID1cbiAgICBnb2FsLnJ1bGVfdHlwZSA9PT0gJ2NvbXBvc2l0ZSdcbiAgICAgID8gYXdhaXQgZmV0Y2hDaGlsZEN5Y2xlcyhkYiwgZ29hbC5pZClcbiAgICAgIDoge1xuICAgICAgICAgIGN5Y2xlczogbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKSxcbiAgICAgICAgICB3ZWlnaHRzOiBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpLFxuICAgICAgICB9O1xuXG4gIGNvbnN0IHsgY3VycmVudFZhbHVlLCBkb25lIH0gPSBldmFsdWF0ZUdvYWwoe1xuICAgIGdvYWw6IHtcbiAgICAgIC4uLmdvYWwsXG4gICAgICBjb25maWc6IHBhcnNlSnNvbihnb2FsLmNvbmZpZyksXG4gICAgfSxcbiAgICBjeWNsZSxcbiAgICBsaW5rcyxcbiAgICBldmVudHMsXG4gICAgY2hpbGRDeWNsZXMsXG4gICAgY2hpbGRXZWlnaHRzLFxuICAgIGdyb3VwQWN0aXZpdHlJZHMsXG4gIH0pO1xuXG4gIGNvbnN0IG5vd0lzbyA9IG5vdy50b0lTT1N0cmluZygpO1xuICBsZXQgc3RhdHVzID0gY3ljbGUuc3RhdHVzO1xuICAvLyBPbmUtdGltZSBnb2FscyBjbG9zZSBhcyBzb29uIGFzIHRoZSB0YXJnZXQgaXMgbWV0LiBSZWN1cnJpbmcgY3ljbGVzIHN0YXlcbiAgLy8gYWN0aXZlIHVudGlsIHJvbGxPdmVySWZOZWVkZWQgY2xvc2VzIHRoZW0gYXQgZW5kc19hdCBcdTIwMTQgb3RoZXJ3aXNlXG4gIC8vIGFjdGl2ZUN5Y2xlIGdvZXMgbnVsbCBtaWQtd2luZG93IGFuZCB0aGUgY2xpZW50IHNob3dzIDAlIHByb2dyZXNzLlxuICBpZiAoXG4gICAgY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgIGRvbmUgJiZcbiAgICBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoZ29hbClcbiAgKSB7XG4gICAgc3RhdHVzID0gJ3N1Y2NlZWRlZCc7XG4gIH1cblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIGN1cnJlbnRfdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vd0lzbyxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gIC8vIERhaWx5IHNuYXBzaG90IGZvciBoaXN0b3J5IGNoYXJ0cyAodXBzZXJ0IGJ5IGFzX29mIGRhdGUpLlxuICBjb25zdCBhc09mID0gbm93SXNvLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogdXBkYXRlZC5pZCxcbiAgICAgIGFzX29mOiBhc09mLFxuICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICB9KVxuICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgIG9jLmNvbHVtbnMoWydnb2FsX2N5Y2xlX2lkJywgJ2FzX29mJ10pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIH0pLFxuICAgIClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIC8vIE1hcmsgcGFyZW50IGdvYWwgY29tcGxldGVkIHdoZW4gYSBvbmUtdGltZSBjeWNsZSBzdWNjZWVkcy5cbiAgaWYgKHN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgIWdvYWwucmVjdXJyZW5jZSAmJiBnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScpIHtcbiAgICBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAnY29tcGxldGVkJywgdXBkYXRlZF9hdDogbm93SXNvIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgfVxuXG4gIC8vIEVkZ2UtdHJpZ2dlciByZXdhcmQgZ3JhbnRzIHdoZW4gYSBjeWNsZSBuZXdseSBzdWNjZWVkcy5cbiAgaWYgKHN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgY3ljbGUuc3RhdHVzICE9PSAnc3VjY2VlZGVkJykge1xuICAgIGNvbnN0IHsgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyB9ID0gYXdhaXQgaW1wb3J0KFxuICAgICAgJy4uL3Jld2FyZHMvaG9va3MudHMnXG4gICAgKTtcbiAgICBhd2FpdCBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzKGRiLCB7XG4gICAgICB1c2VySWQ6IGdvYWwudXNlcl9pZCxcbiAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlSWQ6IHVwZGF0ZWQuaWQsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gdXBkYXRlZDtcbn1cblxuLyoqIFJlY29tcHV0ZSBhbGwgYWN0aXZlIGN5Y2xlcyBsaW5rZWQgdG8gYW4gYWN0aXZpdHkgb3IgZ3JvdXAgdmlhIGdvYWxfbGlua3MuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBvcHRzOiB7IGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsOyBncm91cElkPzogbnVtYmVyIHwgbnVsbCB9LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGdvYWxJZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcblxuICBpZiAob3B0cy5hY3Rpdml0eUlkICE9IG51bGwpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZ29hbF9saW5rcy5hY3Rpdml0eV9pZCcsICc9Jywgb3B0cy5hY3Rpdml0eUlkKVxuICAgICAgLnNlbGVjdCgnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCByIG9mIHJvd3MpIGdvYWxJZHMuYWRkKHIuZ29hbF9pZCk7XG4gIH1cblxuICBpZiAob3B0cy5ncm91cElkICE9IG51bGwpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZ29hbF9saW5rcy5ncm91cF9pZCcsICc9Jywgb3B0cy5ncm91cElkKVxuICAgICAgLnNlbGVjdCgnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCByIG9mIHJvd3MpIGdvYWxJZHMuYWRkKHIuZ29hbF9pZCk7XG4gIH1cblxuICAvLyBBbHNvIHJlY29tcHV0ZSBjb21wb3NpdGVzIHRoYXQgZGVwZW5kIG9uIGFmZmVjdGVkIGdvYWxzLlxuICBpZiAoZ29hbElkcy5zaXplID4gMCkge1xuICAgIGNvbnN0IGRlcHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgIC53aGVyZSgnZGVwZW5kc19vbl9nb2FsX2lkJywgJ2luJywgWy4uLmdvYWxJZHNdKVxuICAgICAgLnNlbGVjdCgnZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgZCBvZiBkZXBzKSBnb2FsSWRzLmFkZChkLmdvYWxfaWQpO1xuICB9XG5cbiAgZm9yIChjb25zdCBnb2FsSWQgb2YgZ29hbElkcykge1xuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWxJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghZ29hbCB8fCBnb2FsLnN0YXR1cyA9PT0gJ3BhdXNlZCcgfHwgZ29hbC5zdGF0dXMgPT09ICdhcmNoaXZlZCcpXG4gICAgICBjb250aW51ZTtcblxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWN5Y2xlKSBjb250aW51ZTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSk7XG4gIH1cbn1cblxuLyoqIEZ1bGwgcmVjb21wdXRlIG9mIGV2ZXJ5IGFjdGl2ZSBjeWNsZSBmb3IgYSB1c2VyIChyZXBhaXIgcGF0aCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyPiB7XG4gIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydhY3RpdmUnLCAnY29tcGxldGVkJywgJ2ZhaWxlZCddKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgbGV0IGNvdW50ID0gMDtcbiAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgY29uc3QgY3ljbGVzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCBjeWNsZSBvZiBjeWNsZXMpIHtcbiAgICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSk7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY291bnQ7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJlc2V0IHBhbGV0dGUgZm9yIGFjdGl2aXR5IGdyb3Vwcy5cbiAqIEtlZXAgaW4gc3luYyB3aXRoIEZsdXR0ZXIgYGxpYi90aGVtZS90b2tlbnMvZ3JvdXBfcGFsZXR0ZS5kYXJ0YC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdST1VQX0NPTE9SX1BBTEVUVEUgPSBbXG4gICcjMEY3NjZFJywgLy8gdGVhbCAoYnJhbmQpXG4gICcjMjU2M0VCJywgLy8gYmx1ZVxuICAnIzdDM0FFRCcsIC8vIHZpb2xldFxuICAnI0RCMjc3NycsIC8vIHBpbmtcbiAgJyNEQzI2MjYnLCAvLyByZWRcbiAgJyNFQTU4MEMnLCAvLyBvcmFuZ2VcbiAgJyNDQThBMDQnLCAvLyB5ZWxsb3dcbiAgJyMxNkEzNEEnLCAvLyBncmVlblxuICAnIzA4OTFCMicsIC8vIGN5YW5cbiAgJyM0QjU1NjMnLCAvLyBncmF5XG5dIGFzIGNvbnN0XG5cbmV4cG9ydCB0eXBlIEdyb3VwQ29sb3IgPSAodHlwZW9mIEdST1VQX0NPTE9SX1BBTEVUVEUpW251bWJlcl1cblxuY29uc3QgSEVYX0NPTE9SX1JFID0gL14jWzAtOUEtRmEtZl17Nn0kL1xuXG5leHBvcnQgZnVuY3Rpb24gaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogY29sb3IgaXMgR3JvdXBDb2xvciB7XG4gIGlmICghSEVYX0NPTE9SX1JFLnRlc3QoY29sb3IpKSByZXR1cm4gZmFsc2VcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNvbG9yLnRvVXBwZXJDYXNlKClcbiAgcmV0dXJuIChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5zb21lKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQsXG4gIClcbn1cblxuLyoqIE5vcm1hbGl6ZSB0byBjYW5vbmljYWwgYCNSUkdHQkJgIHVwcGVyY2FzZSBmcm9tIHRoZSBhbGxvd2xpc3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogR3JvdXBDb2xvciB7XG4gIGNvbnN0IG1hdGNoID0gKEdST1VQX0NPTE9SX1BBTEVUVEUgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmZpbmQoXG4gICAgKGMpID0+IGMudG9VcHBlckNhc2UoKSA9PT0gY29sb3IudG9VcHBlckNhc2UoKSxcbiAgKVxuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyb3VwIGNvbG9yOiAke2NvbG9yfWApXG4gIH1cbiAgcmV0dXJuIG1hdGNoIGFzIEdyb3VwQ29sb3Jcbn1cbiIsICJpbXBvcnQgeyBSZWN1cnJlbmNlQ29uZmlnLCBSZWN1cnJlbmNlUGF0dGVybklucHV0IH0gZnJvbSAnLi90eXBlcy50cydcbmltcG9ydCB7IGlzQWxsb3dlZEdyb3VwQ29sb3IsIG5vcm1hbGl6ZUdyb3VwQ29sb3IgfSBmcm9tICcuL2dyb3VwX3BhbGV0dGUudHMnXG5pbXBvcnQgeyBHT0FMX1JVTEVfVFlQRVMgfSBmcm9tICcuLi9nb2Fscy9ldmFsdWF0b3JzL2luZGV4LnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDcmVhdGVHb2FsSW5wdXQsXG4gIEdvYWxEZWFkbGluZUlucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBHb2FsUmVjdXJyZW5jZUlucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4vdHlwZXMudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmV4cG9ydCBjbGFzcyBJbnZhbGlkR3JvdXBFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZENvbXBsZXRpb25FcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdvYWxFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmludGVyZmFjZSBBY3Rpdml0eVNjaGVkdWxlIHtcbiAgaXNSZWN1cnJpbmc6IGJvb2xlYW5cbiAgZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgcmVjdXJyZW5jZVBhdHRlcm4/OiBSZWN1cnJlbmNlUGF0dGVybklucHV0IHwgbnVsbFxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGF0IGFuIGFjdGl2aXR5J3Mgc2NoZWR1bGUgaXMgaW50ZXJuYWxseSBjb25zaXN0ZW50OlxuICogLSBOb24tcmVjdXJyaW5nIGFjdGl2aXRpZXMgbXVzdCBoYXZlIGEgYGRhdGVgIGFuZCBubyByZWN1cnJlbmNlIHBhdHRlcm4uXG4gKiAtIFJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIHJlY3VycmVuY2UgcGF0dGVybiAoYW5kIG5vIGBkYXRlYCksXG4gKiAgIHdpdGggY29uZmlnIGZpZWxkcyBtYXRjaGluZyB0aGUgY2hvc2VuIHJlY3VycmVuY2UgdHlwZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZShpbnB1dDogQWN0aXZpdHlTY2hlZHVsZSk6IHZvaWQge1xuICBpZiAoIWlucHV0LmlzUmVjdXJyaW5nKSB7XG4gICAgaWYgKCFpbnB1dC5kYXRlKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgJ2RhdGUgaXMgcmVxdWlyZWQgd2hlbiBpc1JlY3VycmluZyBpcyBmYWxzZScsXG4gICAgICApXG4gICAgfVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCFpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ3JlY3VycmVuY2VQYXR0ZXJuIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgdHJ1ZScsXG4gICAgKVxuICB9XG5cbiAgY29uc3QgeyByZWN1cnJlbmNlVHlwZSwgY29uZmlnIH0gPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVyblxuICBpZiAoIWNvbmZpZyB8fCAhY29uZmlnLnN0YXJ0X2RhdGUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybi5jb25maWcuc3RhcnRfZGF0ZSBpcyByZXF1aXJlZCcsXG4gICAgKVxuICB9XG5cbiAgc3dpdGNoIChyZWN1cnJlbmNlVHlwZSkge1xuICAgIGNhc2UgJ3dlZWtseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZldlZWsoY29uZmlnLmRheXNfb2Zfd2VlaylcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZk1vbnRoKGNvbmZpZy5kYXlzX29mX21vbnRoLCBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICB2YWxpZGF0ZUludGVydmFsRGF5cyhjb25maWcuaW50ZXJ2YWxfZGF5cylcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICBgVW5zdXBwb3J0ZWQgcmVjdXJyZW5jZVR5cGU6ICR7cmVjdXJyZW5jZVR5cGV9YCxcbiAgICAgIClcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIGdyb3VwIGNvbG9yIGFnYWluc3QgdGhlIHNoYXJlZCBoZXggYWxsb3dsaXN0LlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIHBhbGV0dGUgdmFsdWUgKGUuZy4gYCMwRjc2NkVgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFpc0FsbG93ZWRHcm91cENvbG9yKGNvbG9yKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcbiAgICAgICdjb2xvciBtdXN0IGJlIGEgaGV4IHZhbHVlIGZyb20gdGhlIGdyb3VwIHBhbGV0dGUgKGUuZy4gIzBGNzY2RSknLFxuICAgIClcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcilcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgZ3JvdXAgbmFtZSBpcyBub24tZW1wdHkgYWZ0ZXIgdHJpbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcignbmFtZSBtdXN0IGJlIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnMnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmNvbnN0IERBVEVfUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9JC9cbmNvbnN0IFRJTUVfUkUgPSAvXlxcZHsyfTpcXGR7Mn0kL1xuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShkYXRlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIURBVEVfUkUudGVzdChkYXRlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKCdvY2N1cnJlbmNlRGF0ZSBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG4gIHJldHVybiBkYXRlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyh2YWx1ZTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCk6IG51bWJlciB8IG51bGwge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDwgMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24odmFsdWU6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8PSAwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKCdkdXJhdGlvbk1pbnV0ZXMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURheXNPZldlZWsoZGF5c09mV2VlazogUmVjdXJyZW5jZUNvbmZpZ1snZGF5c19vZl93ZWVrJ10pOiB2b2lkIHtcbiAgaWYgKCFkYXlzT2ZXZWVrIHx8IGRheXNPZldlZWsubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2Zfd2VlayBpcyByZXF1aXJlZCBmb3Igd2Vla2x5IHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxuICBpZiAoZGF5c09mV2Vlay5zb21lKChkYXkpID0+ICFOdW1iZXIuaXNJbnRlZ2VyKGRheSkgfHwgZGF5IDwgMCB8fCBkYXkgPiA2KSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgbXVzdCBjb250YWluIGludGVnZXJzIGJldHdlZW4gMCAoU3VuZGF5KSBhbmQgNiAoU2F0dXJkYXkpJyxcbiAgICApXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZNb250aChcbiAgZGF5c09mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2ZfbW9udGgnXSxcbiAgaXNMYXN0RGF5T2ZNb250aDogUmVjdXJyZW5jZUNvbmZpZ1snaXNfbGFzdF9kYXlfb2ZfbW9udGgnXSxcbik6IHZvaWQge1xuICBjb25zdCBoYXNEYXlzT2ZNb250aCA9ICEhZGF5c09mTW9udGggJiYgZGF5c09mTW9udGgubGVuZ3RoID4gMFxuICBpZiAoIWhhc0RheXNPZk1vbnRoICYmICFpc0xhc3REYXlPZk1vbnRoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2ZfbW9udGggb3IgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoIGlzIHJlcXVpcmVkIGZvciBtb250aGx5IHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxuICBpZiAoXG4gICAgaGFzRGF5c09mTW9udGggJiZcbiAgICBkYXlzT2ZNb250aCEuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDEgfHwgZGF5ID4gMzEpXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDEgYW5kIDMxJyxcbiAgICApXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbERheXMoaW50ZXJ2YWxEYXlzOiBSZWN1cnJlbmNlQ29uZmlnWydpbnRlcnZhbF9kYXlzJ10pOiB2b2lkIHtcbiAgaWYgKFxuICAgIGludGVydmFsRGF5cyA9PT0gdW5kZWZpbmVkIHx8XG4gICAgaW50ZXJ2YWxEYXlzID09PSBudWxsIHx8XG4gICAgIU51bWJlci5pc0ludGVnZXIoaW50ZXJ2YWxEYXlzKSB8fFxuICAgIGludGVydmFsRGF5cyA8IDFcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmludGVydmFsX2RheXMgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEgZm9yIGV2ZXJ5X3hfZGF5cyByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbFRpdGxlKHRpdGxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gdGl0bGUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGl0bGUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbENvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsaWRhdGVHcm91cENvbG9yKGNvbG9yKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVSdWxlVHlwZShydWxlVHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFHT0FMX1JVTEVfVFlQRVMuaW5jbHVkZXMocnVsZVR5cGUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICBgcnVsZVR5cGUgbXVzdCBiZSBvbmUgb2Y6ICR7R09BTF9SVUxFX1RZUEVTLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHJ1bGVUeXBlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVRhcmdldFZhbHVlKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0YXJnZXRWYWx1ZSBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbExpbmtzKFxuICBsaW5rczogR29hbExpbmtJbnB1dFtdIHwgdW5kZWZpbmVkLFxuICBydWxlVHlwZTogc3RyaW5nLFxuKTogR29hbExpbmtJbnB1dFtdIHtcbiAgY29uc3QgbGlzdCA9IGxpbmtzID8/IFtdXG4gIGlmIChydWxlVHlwZSA9PT0gJ2NvbXBvc2l0ZScpIHtcbiAgICBpZiAobGlzdC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignY29tcG9zaXRlIGdvYWxzIG11c3Qgbm90IGhhdmUgYWN0aXZpdHkvZ3JvdXAgbGlua3MnKVxuICAgIH1cbiAgICByZXR1cm4gW11cbiAgfVxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYXQgbGVhc3Qgb25lIGxpbmsgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGZvciAoY29uc3QgbGluayBvZiBsaXN0KSB7XG4gICAgaWYgKGxpbmsubGlua1R5cGUgPT09ICdhY3Rpdml0eScpIHtcbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWN0aXZpdHkgbGlua3MgcmVxdWlyZSBhY3Rpdml0eUlkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWN0aXZpdHkgbGlua3MgbXVzdCBub3Qgc2V0IGdyb3VwSWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGluay5saW5rVHlwZSA9PT0gJ2dyb3VwJykge1xuICAgICAgaWYgKGxpbmsuZ3JvdXBJZCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdncm91cCBsaW5rcyByZXF1aXJlIGdyb3VwSWQnKVxuICAgICAgfVxuICAgICAgaWYgKGxpbmsuYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdncm91cCBsaW5rcyBtdXN0IG5vdCBzZXQgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdsaW5rVHlwZSBtdXN0IGJlIGFjdGl2aXR5IG9yIGdyb3VwJylcbiAgICB9XG4gICAgaWYgKGxpbmsud2VpZ2h0ICE9IG51bGwgJiYgKCFOdW1iZXIuaXNGaW5pdGUobGluay53ZWlnaHQpIHx8IGxpbmsud2VpZ2h0IDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGluayB3ZWlnaHQgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gICAgfVxuICB9XG4gIHJldHVybiBsaXN0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoXG4gIGRlcHM6IEdvYWxEZXBlbmRlbmN5SW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxEZXBlbmRlbmN5SW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBkZXBzID8/IFtdXG4gIGlmIChydWxlVHlwZSA9PT0gJ2NvbXBvc2l0ZScgJiYgbGlzdC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignY29tcG9zaXRlIGdvYWxzIHJlcXVpcmUgYXQgbGVhc3Qgb25lIGRlcGVuZGVuY3knKVxuICB9XG4gIGZvciAoY29uc3QgZGVwIG9mIGxpc3QpIHtcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoZGVwLmRlcGVuZHNPbkdvYWxJZCkgfHwgZGVwLmRlcGVuZHNPbkdvYWxJZCA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVwZW5kc09uR29hbElkIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgICB9XG4gICAgaWYgKFxuICAgICAgZGVwLnJlcXVpcmVtZW50ICE9IG51bGwgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ2NvbXBsZXRlJyAmJlxuICAgICAgZGVwLnJlcXVpcmVtZW50ICE9PSAncHJvZ3Jlc3MnXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigncmVxdWlyZW1lbnQgbXVzdCBiZSBjb21wbGV0ZSBvciBwcm9ncmVzcycpXG4gICAgfVxuICB9XG4gIHJldHVybiBsaXN0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKFxuICByZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IEdvYWxSZWN1cnJlbmNlSW5wdXQgfCBudWxsIHtcbiAgaWYgKHJlY3VycmVuY2UgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgcGVyaW9kcyA9IFsnd2Vla2x5JywgJ21vbnRobHknLCAncXVhcnRlcmx5JywgJ2V2ZXJ5X3hfZGF5cyddXG4gIGlmICghcGVyaW9kcy5pbmNsdWRlcyhyZWN1cnJlbmNlLnBlcmlvZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihgdW5zdXBwb3J0ZWQgcmVjdXJyZW5jZSBwZXJpb2Q6ICR7cmVjdXJyZW5jZS5wZXJpb2R9YClcbiAgfVxuICBpZiAoXG4gICAgcmVjdXJyZW5jZS5pbnRlcnZhbCAhPSBudWxsICYmXG4gICAgKCFOdW1iZXIuaXNJbnRlZ2VyKHJlY3VycmVuY2UuaW50ZXJ2YWwpIHx8IHJlY3VycmVuY2UuaW50ZXJ2YWwgPCAxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigncmVjdXJyZW5jZS5pbnRlcnZhbCBtdXN0IGJlIGFuIGludGVnZXIgPj0gMScpXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9IG51bGwgJiZcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPT0gJ25vbmUnICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdvdmVyZmxvdydcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NhcnJ5T3ZlciBtdXN0IGJlIG5vbmUgb3Igb3ZlcmZsb3cnKVxuICB9XG4gIHJldHVybiByZWN1cnJlbmNlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxEZWFkbGluZShcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB7XG4gIGlmIChkZWFkbGluZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ2Fic29sdXRlJykge1xuICAgIGlmICghZGVhZGxpbmUuZGF0ZSB8fCAhREFURV9SRS50ZXN0KGRlYWRsaW5lLmRhdGUpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWJzb2x1dGUgZGVhZGxpbmUgcmVxdWlyZXMgZGF0ZSBZWVlZLU1NLUREJylcbiAgICB9XG4gIH0gZWxzZSBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ3JlbGF0aXZlJykge1xuICAgIGlmIChcbiAgICAgIGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQgPT0gbnVsbCB8fFxuICAgICAgIU51bWJlci5pc0ludGVnZXIoZGVhZGxpbmUuZGF5c0FmdGVyQ3ljbGVTdGFydCkgfHxcbiAgICAgIGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQgPCAwXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgJ3JlbGF0aXZlIGRlYWRsaW5lIHJlcXVpcmVzIGRheXNBZnRlckN5Y2xlU3RhcnQgPj0gMCcsXG4gICAgICApXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZWFkbGluZS5raW5kIG11c3QgYmUgYWJzb2x1dGUgb3IgcmVsYXRpdmUnKVxuICB9XG4gIHJldHVybiBkZWFkbGluZVxufVxuXG5jb25zdCBNQVhfU1RBUlRfWUVBUlNfQUhFQUQgPSA1XG5cbi8qKiBQYXJzZSBhbmQgdmFsaWRhdGUgYW4gb3B0aW9uYWwgSVNPLTg2MDEgc3RhcnRzQXQuIFJldHVybnMgbnVsbCBpZiBvbWl0dGVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3RhcnRzQXQoXG4gIHN0YXJ0c0F0OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoc3RhcnRzQXQgPT0gbnVsbCB8fCBzdGFydHNBdCA9PT0gJycpIHJldHVybiBudWxsXG4gIGNvbnN0IHBhcnNlZCA9IG5ldyBEYXRlKHN0YXJ0c0F0KVxuICBpZiAoTnVtYmVyLmlzTmFOKHBhcnNlZC5nZXRUaW1lKCkpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3N0YXJ0c0F0IG11c3QgYmUgYSB2YWxpZCBJU08tODYwMSBkYXRldGltZScpXG4gIH1cbiAgY29uc3QgbWF4ID0gbmV3IERhdGUobm93KVxuICBtYXguc2V0VVRDRnVsbFllYXIobWF4LmdldFVUQ0Z1bGxZZWFyKCkgKyBNQVhfU1RBUlRfWUVBUlNfQUhFQUQpXG4gIGlmIChwYXJzZWQgPiBtYXgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgIGBzdGFydHNBdCBtdXN0IGJlIHdpdGhpbiAke01BWF9TVEFSVF9ZRUFSU19BSEVBRH0geWVhcnMgZnJvbSBub3dgLFxuICAgIClcbiAgfVxuICByZXR1cm4gcGFyc2VkXG59XG5cbi8qKiBSZWplY3QgYWJzb2x1dGUgZGVhZGxpbmVzIHRoYXQgZW5kIGJlZm9yZSB0aGUgZ29hbCBzdGFydHMuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0KFxuICBzdGFydHNBdDogRGF0ZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHZvaWQge1xuICBpZiAoIWRlYWRsaW5lIHx8IGRlYWRsaW5lLmtpbmQgIT09ICdhYnNvbHV0ZScgfHwgIWRlYWRsaW5lLmRhdGUpIHJldHVyblxuICBjb25zdCBkZWFkbGluZUF0ID0gbmV3IERhdGUoZGVhZGxpbmUuZGF0ZSArICdUMjM6NTk6NTkuOTk5WicpXG4gIGlmIChkZWFkbGluZUF0IDwgc3RhcnRzQXQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUgbXVzdCBiZSBvbiBvciBhZnRlciB0aGUgZ29hbCBzdGFydCcpXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ3JlYXRlR29hbElucHV0KFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKSB7XG4gIGNvbnN0IHRpdGxlID0gdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpXG4gIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHb2FsQ29sb3IoaW5wdXQuY29sb3IpXG4gIGNvbnN0IHJ1bGVUeXBlID0gdmFsaWRhdGVSdWxlVHlwZShpbnB1dC5ydWxlVHlwZSlcbiAgY29uc3QgdGFyZ2V0VmFsdWUgPSB2YWxpZGF0ZVRhcmdldFZhbHVlKGlucHV0LnRhcmdldFZhbHVlKVxuICBpZiAoaW5wdXQubWV0cmljICE9PSAnY291bnQnICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2R1cmF0aW9uJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdtZXRyaWMgbXVzdCBiZSBjb3VudCBvciBkdXJhdGlvbicpXG4gIH1cbiAgY29uc3QgbGlua3MgPSB2YWxpZGF0ZUdvYWxMaW5rcyhpbnB1dC5saW5rcywgcnVsZVR5cGUpXG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhpbnB1dC5kZXBlbmRlbmNpZXMsIHJ1bGVUeXBlKVxuICBjb25zdCByZWN1cnJlbmNlID0gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShpbnB1dC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHZhbGlkYXRlR29hbERlYWRsaW5lKGlucHV0LmRlYWRsaW5lKVxuICBjb25zdCBzdGFydHNBdCA9IHZhbGlkYXRlU3RhcnRzQXQoaW5wdXQuc3RhcnRzQXQsIG5vdykgPz8gbm93XG4gIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgaWYgKGlucHV0LmNvbmZpZz8uYmVmb3JlVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5iZWZvcmVUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdiZWZvcmVUaW1lIG11c3QgYmUgSEg6bW0nKVxuICB9XG4gIGlmIChpbnB1dC5jb25maWc/LmFmdGVyVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5hZnRlclRpbWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FmdGVyVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdGl0bGUsXG4gICAgY29sb3IsXG4gICAgcnVsZVR5cGUsXG4gICAgdGFyZ2V0VmFsdWUsXG4gICAgbGlua3MsXG4gICAgZGVwZW5kZW5jaWVzLFxuICAgIHJlY3VycmVuY2UsXG4gICAgZGVhZGxpbmUsXG4gICAgc3RhcnRzQXQsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVXBkYXRlR29hbElucHV0KFxuICBpbnB1dDogVXBkYXRlR29hbElucHV0LFxuICBleGlzdGluZ1J1bGVUeXBlOiBzdHJpbmcsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pIHtcbiAgY29uc3QgcnVsZVR5cGUgPSBpbnB1dC5ydWxlVHlwZSAhPSBudWxsXG4gICAgPyB2YWxpZGF0ZVJ1bGVUeXBlKGlucHV0LnJ1bGVUeXBlKVxuICAgIDogZXhpc3RpbmdSdWxlVHlwZVxuXG4gIGlmIChpbnB1dC50aXRsZSAhPSBudWxsKSB2YWxpZGF0ZUdvYWxUaXRsZShpbnB1dC50aXRsZSlcbiAgaWYgKGlucHV0LmNvbG9yICE9IG51bGwpIHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKVxuICBpZiAoaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbCkgdmFsaWRhdGVUYXJnZXRWYWx1ZShpbnB1dC50YXJnZXRWYWx1ZSlcbiAgaWYgKGlucHV0Lm1ldHJpYyAhPSBudWxsICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2NvdW50JyAmJiBpbnB1dC5tZXRyaWMgIT09ICdkdXJhdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbWV0cmljIG11c3QgYmUgY291bnQgb3IgZHVyYXRpb24nKVxuICB9XG4gIGlmIChpbnB1dC5zdGF0dXMgIT0gbnVsbCkge1xuICAgIGNvbnN0IGFsbG93ZWQgPSBbJ2FjdGl2ZScsICdwYXVzZWQnLCAnY29tcGxldGVkJywgJ2FyY2hpdmVkJywgJ2ZhaWxlZCddXG4gICAgaWYgKCFhbGxvd2VkLmluY2x1ZGVzKGlucHV0LnN0YXR1cykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKGBpbnZhbGlkIHN0YXR1czogJHtpbnB1dC5zdGF0dXN9YClcbiAgICB9XG4gIH1cblxuICBjb25zdCBsaW5rcyA9IGlucHV0LmxpbmtzICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbExpbmtzKGlucHV0LmxpbmtzLCBydWxlVHlwZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBkZXBlbmRlbmNpZXMgPSBpbnB1dC5kZXBlbmRlbmNpZXMgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKGlucHV0LmRlcGVuZGVuY2llcywgcnVsZVR5cGUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgcmVjdXJyZW5jZSA9IGlucHV0LnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShpbnB1dC5yZWN1cnJlbmNlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IGRlYWRsaW5lID0gaW5wdXQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsRGVhZGxpbmUoaW5wdXQuZGVhZGxpbmUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3Qgc3RhcnRzQXQgPSBpbnB1dC5zdGFydHNBdCAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZVN0YXJ0c0F0KGlucHV0LnN0YXJ0c0F0LCBub3cpXG4gICAgOiB1bmRlZmluZWRcblxuICByZXR1cm4geyBydWxlVHlwZSwgbGlua3MsIGRlcGVuZGVuY2llcywgcmVjdXJyZW5jZSwgZGVhZGxpbmUsIHN0YXJ0c0F0IH1cbn1cblxuLyoqXG4gKiBEZXRlY3RzIHdoZXRoZXIgYWRkaW5nIGVkZ2VzIHdvdWxkIGNyZWF0ZSBhIGN5Y2xlIGluIHRoZSBkZXBlbmRlbmN5IERBRy5cbiAqIGBlZGdlc2AgaXMgdGhlIGZ1bGwgYWRqYWNlbmN5IGxpc3QgYWZ0ZXIgdGhlIHByb3Bvc2VkIGNoYW5nZSAoZ29hbElkIC0+IGRlcHMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUoXG4gIGVkZ2VzOiBNYXA8bnVtYmVyLCBudW1iZXJbXT4sXG4gIHN0YXJ0SWQ6IG51bWJlcixcbik6IGJvb2xlYW4ge1xuICBjb25zdCB2aXNpdGluZyA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gIGNvbnN0IHZpc2l0ZWQgPSBuZXcgU2V0PG51bWJlcj4oKVxuXG4gIGZ1bmN0aW9uIGRmcyhub2RlOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICBpZiAodmlzaXRpbmcuaGFzKG5vZGUpKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2aXNpdGVkLmhhcyhub2RlKSkgcmV0dXJuIGZhbHNlXG4gICAgdmlzaXRpbmcuYWRkKG5vZGUpXG4gICAgZm9yIChjb25zdCBuZXh0IG9mIGVkZ2VzLmdldChub2RlKSA/PyBbXSkge1xuICAgICAgaWYgKGRmcyhuZXh0KSkgcmV0dXJuIHRydWVcbiAgICB9XG4gICAgdmlzaXRpbmcuZGVsZXRlKG5vZGUpXG4gICAgdmlzaXRlZC5hZGQobm9kZSlcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBkZnMoc3RhcnRJZClcbn1cbiIsICJpbXBvcnQgeyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIH0gZnJvbSAnLi92YWxpZGF0aW9uLnRzJ1xuXG4vKiogTWludXRlcyBiZWZvcmUgYWN0aXZpdHkgc3RhcnQ7IDAgPSBhdCBzdGFydC4gTWF4IGxvb2tiYWNrID0gNyBkYXlzLiAqL1xuZXhwb3J0IGNvbnN0IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVMgPSAxMDA4MFxuZXhwb3J0IGNvbnN0IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUUyA9IDhcblxuLyoqXG4gKiBOb3JtYWxpemVzIHJlbWluZGVyIG9mZnNldHM6IGNvZXJjZSB0byBpbnRzLCByZWplY3Qgb3V0LW9mLXJhbmdlLFxuICogZGVkdXBlLCBzb3J0IGFzY2VuZGluZy4gRW1wdHkvbnVsbCBcdTIxOTIgW10uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKFxuICBvZmZzZXRzOiBudW1iZXJbXSB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBudW1iZXJbXSB7XG4gIGlmIChvZmZzZXRzID09IG51bGwpIHJldHVybiBbXVxuXG4gIGlmIChvZmZzZXRzLmxlbmd0aCA+IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUUykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgYG5vdGlmaWNhdGlvbk9mZnNldHMgbXVzdCBoYXZlIGF0IG1vc3QgJHtNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFN9IHZhbHVlc2AsXG4gICAgKVxuICB9XG5cbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gIGNvbnN0IHJlc3VsdDogbnVtYmVyW10gPSBbXVxuXG4gIGZvciAoY29uc3QgcmF3IG9mIG9mZnNldHMpIHtcbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShyYXcpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICAnbm90aWZpY2F0aW9uT2Zmc2V0cyBtdXN0IGJlIGludGVnZXJzJyxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHJhdyA8IDAgfHwgcmF3ID4gTUFYX05PVElGSUNBVElPTl9PRkZTRVRfTUlOVVRFUykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgIGBub3RpZmljYXRpb25PZmZzZXRzIG11c3QgYmUgYmV0d2VlbiAwIGFuZCAke01BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVN9YCxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHNlZW4uaGFzKHJhdykpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQocmF3KVxuICAgIHJlc3VsdC5wdXNoKHJhdylcbiAgfVxuXG4gIHJlc3VsdC5zb3J0KChhLCBiKSA9PiBhIC0gYilcbiAgcmV0dXJuIHJlc3VsdFxufVxuIiwgIi8qKiBQb3N0Z3JlcyBgbnVtZXJpY2AgYXJyaXZlcyBhcyBzdHJpbmcgdmlhIGBwZ2A7IEdyYXBoUUwgTnVtYmVyIHJlcXVpcmVzIEpTIG51bWJlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlcih2YWx1ZTogdW5rbm93biwgZmFsbGJhY2sgPSAwKTogbnVtYmVyIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxsYmFja1xuICBjb25zdCBuID0gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyA/IHZhbHVlIDogTnVtYmVyKHZhbHVlKVxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IGZhbGxiYWNrXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlck9yTnVsbCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgbiA9IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBudWxsXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwgYXMgR29hbFJvdyxcbiAgR29hbENvbmZpZyxcbiAgR29hbEN5Y2xlIGFzIEdvYWxDeWNsZVJvdyxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsRGVwZW5kZW5jeSBhcyBHb2FsRGVwZW5kZW5jeVJvdyxcbiAgR29hbExpbmsgYXMgR29hbExpbmtSb3csXG4gIEdvYWxQcm9ncmVzc1NuYXBzaG90IGFzIEdvYWxTbmFwc2hvdFJvdyxcbiAgR29hbFJlY3VycmVuY2VDb25maWcsXG4gIE5ld0dvYWwsXG4gIE5ld0dvYWxEZXBlbmRlbmN5LFxuICBOZXdHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlSW5pdGlhbEN5Y2xlLCBkZWFkbGluZVN0YXRlLCBsaWZlY3ljbGVQaGFzZSwgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlLCByb2xsT3ZlcklmTmVlZGVkLCByb2xsT3ZlclVzZXJHb2FscyB9IGZyb20gJy4uLy4uL2dvYWxzL2N5Y2xlcy50cydcbmltcG9ydCB7IGJ1aWxkR29hbE51ZGdlcyB9IGZyb20gJy4uLy4uL2dvYWxzL251ZGdlcy50cydcbmltcG9ydCB7IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcywgcmVjb21wdXRlQ3ljbGUgfSBmcm9tICcuLi8uLi9nb2Fscy9wcm9ncmVzcy50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0LFxuICBJbnZhbGlkR29hbEVycm9yLFxuICB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dCxcbiAgdmFsaWRhdGVHb2FsQ29sb3IsXG4gIHZhbGlkYXRlR29hbFRpdGxlLFxuICB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dCxcbiAgd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5pbXBvcnQgeyBhc051bWJlciwgYXNOdW1iZXJPck51bGwgfSBmcm9tICcuLi9udW1lcmljLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgVFxufVxuXG4vKiogUG9zdGdyZXMgYG51bWVyaWNgIGFycml2ZXMgYXMgc3RyaW5nIHZpYSBgcGdgOyBHcmFwaFFMIE51bWJlciByZXF1aXJlcyBKUyBudW1iZXIuICovXG5mdW5jdGlvbiBtYXBDeWNsZVNjYWxhcnM8VCBleHRlbmRzIEdvYWxDeWNsZVJvdz4oY3ljbGU6IFQpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5jeWNsZSxcbiAgICB0YXJnZXRfdmFsdWU6IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSksXG4gICAgY3VycmVudF92YWx1ZTogYXNOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgY2Fycnlfb3ZlcjogYXNOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwTGlua1NjYWxhcnMobGluazogR29hbExpbmtSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5saW5rLFxuICAgIHdlaWdodDogYXNOdW1iZXIobGluay53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcDogR29hbERlcGVuZGVuY3lSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5kZXAsXG4gICAgdGhyZXNob2xkOiBhc051bWJlck9yTnVsbChkZXAudGhyZXNob2xkKSxcbiAgICB3ZWlnaHQ6IGFzTnVtYmVyKGRlcC53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFNuYXBzaG90U2NhbGFycyhzbmFwc2hvdDogR29hbFNuYXBzaG90Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uc25hcHNob3QsXG4gICAgdmFsdWU6IGFzTnVtYmVyKHNuYXBzaG90LnZhbHVlKSxcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1JlY3VycmVuY2VKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydyZWN1cnJlbmNlJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ3JlY3VycmVuY2UnXSxcbik6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIHBlcmlvZDogaW5wdXQucGVyaW9kLFxuICAgIGludGVydmFsOiBpbnB1dC5pbnRlcnZhbCxcbiAgICBhbmNob3I6IGlucHV0LmFuY2hvcixcbiAgICBjYXJyeV9vdmVyOiBpbnB1dC5jYXJyeU92ZXIsXG4gICAgcmVzZXQ6IGlucHV0LnJlc2V0LFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvRGVhZGxpbmVKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydkZWFkbGluZSddIHwgVXBkYXRlR29hbElucHV0WydkZWFkbGluZSddLFxuKTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBpbnB1dC5kYXlzQWZ0ZXJDeWNsZVN0YXJ0LFxuICAgIGdyYWNlX2RheXM6IGlucHV0LmdyYWNlRGF5cyxcbiAgICB3YXJuX2RheXM6IGlucHV0Lndhcm5EYXlzLFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvQ29uZmlnSnNvbihcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dFsnY29uZmlnJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ2NvbmZpZyddLFxuKTogR29hbENvbmZpZyB7XG4gIGlmICghaW5wdXQpIHJldHVybiB7fVxuICByZXR1cm4ge1xuICAgIGNvbXBvc2l0ZV9tb2RlOiBpbnB1dC5jb21wb3NpdGVNb2RlLFxuICAgIGNvdW50X3JlcXVpcmVkOiBpbnB1dC5jb3VudFJlcXVpcmVkLFxuICAgIGJlZm9yZV90aW1lOiBpbnB1dC5iZWZvcmVUaW1lLFxuICAgIGFmdGVyX3RpbWU6IGlucHV0LmFmdGVyVGltZSxcbiAgICBibG9ja191bnRpbF91bmxvY2tlZDogaW5wdXQuYmxvY2tVbnRpbFVubG9ja2VkLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkQWN0aXZpdGllcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBhY3Rpdml0eUlkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGFjdGl2aXR5SWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdpZCcsICdpbicsIGFjdGl2aXR5SWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gYWN0aXZpdHlJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGFjdGl2aXRpZXMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEdyb3VwcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBncm91cElkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGdyb3VwSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ3JvdXBzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ3JvdXBJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBncm91cElkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgZ3JvdXBzIG5vdCBmb3VuZCcpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRHb2FscyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBnb2FsSWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoZ29hbElkcy5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCByb3dzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ29hbElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGdvYWxJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGRlcGVuZGVuY3kgZ29hbHMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXBsYWNlTGlua3MoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGxpbmtzOiBHb2FsTGlua0lucHV0W10sXG4pIHtcbiAgYXdhaXQgdHJ4LmRlbGV0ZUZyb20oJ2dvYWxfbGlua3MnKS53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKS5leGVjdXRlKClcbiAgY29uc3QgYWN0aXZpdHlJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eUlkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eUlkISlcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cElkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5ncm91cElkISlcbiAgYXdhaXQgYXNzZXJ0T3duZWRBY3Rpdml0aWVzKHRyeCwgdXNlcklkLCBhY3Rpdml0eUlkcylcbiAgYXdhaXQgYXNzZXJ0T3duZWRHcm91cHModHJ4LCB1c2VySWQsIGdyb3VwSWRzKVxuXG4gIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xuICAgIGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ2dvYWxfbGlua3MnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgbGlua190eXBlOiBsaW5rLmxpbmtUeXBlLFxuICAgICAgICBhY3Rpdml0eV9pZDogbGluay5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5JyA/IGxpbmsuYWN0aXZpdHlJZCA/PyBudWxsIDogbnVsbCxcbiAgICAgICAgZ3JvdXBfaWQ6IGxpbmsubGlua1R5cGUgPT09ICdncm91cCcgPyBsaW5rLmdyb3VwSWQgPz8gbnVsbCA6IG51bGwsXG4gICAgICAgIHdlaWdodDogbGluay53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbExpbmspXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVwbGFjZURlcGVuZGVuY2llcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbiAgZGVwczogR29hbERlcGVuZGVuY3lJbnB1dFtdLFxuKSB7XG4gIGNvbnN0IGRlcElkcyA9IGRlcHMubWFwKChkKSA9PiBkLmRlcGVuZHNPbkdvYWxJZClcbiAgaWYgKGRlcElkcy5pbmNsdWRlcyhnb2FsSWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2EgZ29hbCBjYW5ub3QgZGVwZW5kIG9uIGl0c2VsZicpXG4gIH1cbiAgYXdhaXQgYXNzZXJ0T3duZWRHb2Fscyh0cngsIHVzZXJJZCwgZGVwSWRzKVxuXG4gIC8vIEJ1aWxkIGFkamFjZW5jeSBmcm9tIGFsbCBleGlzdGluZyBkZXBzIGZvciB0aGlzIHVzZXIsIHJlcGxhY2luZyB0aGlzIGdvYWwncyBlZGdlcy5cbiAgY29uc3QgYWxsR29hbHMgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJylcbiAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0KFtcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJyxcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5kZXBlbmRzX29uX2dvYWxfaWQnLFxuICAgIF0pXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IGVkZ2VzID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcltdPigpXG4gIGZvciAoY29uc3QgZyBvZiBhbGxHb2FscykgZWRnZXMuc2V0KGcuaWQsIFtdKVxuICBmb3IgKGNvbnN0IGUgb2YgZXhpc3RpbmcpIHtcbiAgICBpZiAoZS5nb2FsX2lkID09PSBnb2FsSWQpIGNvbnRpbnVlXG4gICAgZWRnZXMuZ2V0KGUuZ29hbF9pZCk/LnB1c2goZS5kZXBlbmRzX29uX2dvYWxfaWQpXG4gIH1cbiAgZWRnZXMuc2V0KGdvYWxJZCwgZGVwSWRzKVxuXG4gIGlmICh3b3VsZENyZWF0ZURlcGVuZGVuY3lDeWNsZShlZGdlcywgZ29hbElkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZXBlbmRlbmN5IGN5Y2xlIGRldGVjdGVkJylcbiAgfVxuXG4gIGF3YWl0IHRyeC5kZWxldGVGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpLmV4ZWN1dGUoKVxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgZGVwZW5kc19vbl9nb2FsX2lkOiBkZXAuZGVwZW5kc09uR29hbElkLFxuICAgICAgICByZXF1aXJlbWVudDogZGVwLnJlcXVpcmVtZW50ID8/ICdjb21wbGV0ZScsXG4gICAgICAgIHRocmVzaG9sZDogZGVwLnRocmVzaG9sZCA/PyBudWxsLFxuICAgICAgICB3ZWlnaHQ6IGRlcC53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbERlcGVuZGVuY3kpXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZGVwZW5kZW5jaWVzTWV0KFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChkZXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWVcblxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgY29uc3QgY2hpbGRHb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWNoaWxkR29hbCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoZGVwLnJlcXVpcmVtZW50ID09PSAnY29tcGxldGUnKSB7XG4gICAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgICBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDAgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoXG4gICAgICAgIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgY2hpbGRHb2FsLnN0YXR1cyAhPT0gJ2NvbXBsZXRlZCcgJiZcbiAgICAgICAgIXRhcmdldE1ldFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB0aHJlc2hvbGQgPSBkZXAudGhyZXNob2xkID8/IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpIDwgTnVtYmVyKHRocmVzaG9sZCkpIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsOiBHb2FsUm93KSB7XG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlSnNvbjxHb2FsQ29uZmlnPihnb2FsLmNvbmZpZykgPz8ge31cbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcblxuICByZXR1cm4ge1xuICAgIC4uLmdvYWwsXG4gICAgdGFyZ2V0X3ZhbHVlOiBhc051bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgc3RhcnRzQXQ6IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KS50b0lTT1N0cmluZygpLFxuICAgIGxpZmVjeWNsZVBoYXNlOiBsaWZlY3ljbGVQaGFzZShnb2FsLCBub3cpLFxuICAgIGNvbmZpZyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIGxpbmtzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAoKGxpbmspID0+ICh7XG4gICAgICAgIC4uLm1hcExpbmtTY2FsYXJzKGxpbmspLFxuICAgICAgICBhY3Rpdml0eTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChsaW5rLmFjdGl2aXR5X2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmFjdGl2aXR5X2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgZ3JvdXA6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAobGluay5ncm91cF9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dyb3VwcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmdyb3VwX2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0sXG4gICAgYWN0aXZlQ3ljbGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGxldCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoY3ljbGUgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgIGN5Y2xlID0gYXdhaXQgcm9sbE92ZXJJZk5lZWRlZChkYiwgZ29hbCwgY3ljbGUpXG4gICAgICB9XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbGF0ZXN0IGN5Y2xlIHNvIGNvbXBsZXRlZCAvIG1pZC13aW5kb3cgc3VjY2VlZGVkIGN5Y2xlc1xuICAgICAgLy8gc3RpbGwgZXhwb3NlIHByb2dyZXNzLiBBbHNvIHJlcGFpciByZWN1cnJpbmcgY3ljbGVzIHRoYXQgd2VyZSBjbG9zZWRcbiAgICAgIC8vIGVhcmx5IChiZWZvcmUgZW5kc19hdCkgc28gdGhleSByZW1haW4gdGhlIGFjdGl2ZSB3aW5kb3cuXG4gICAgICBpZiAoIWN5Y2xlKSB7XG4gICAgICAgIGNvbnN0IGxhdGVzdCA9IGF3YWl0IGRiXG4gICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGxhdGVzdCAmJlxuICAgICAgICAgIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgICAgICAgIGdvYWwucmVjdXJyZW5jZSAhPSBudWxsICYmXG4gICAgICAgICAgbGF0ZXN0LnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgICAoIWxhdGVzdC5lbmRzX2F0IHx8IG5vdyA8IG5ldyBEYXRlKGxhdGVzdC5lbmRzX2F0KSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWN0aXZlJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxhdGVzdC5pZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjeWNsZSA9IGxhdGVzdFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWN5Y2xlKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ubWFwQ3ljbGVTY2FsYXJzKGN5Y2xlKSxcbiAgICAgICAgZGVhZGxpbmVTdGF0ZTogc3RhdGUsXG4gICAgICAgIHBlcmNlbnRDb21wbGV0ZTogdGFyZ2V0ID4gMCA/IE1hdGgubWluKDEsIGN1cnJlbnQgLyB0YXJnZXQpIDogMCxcbiAgICAgICAgcmVtYWluaW5nOiBNYXRoLm1heCgwLCB0YXJnZXQgLSBjdXJyZW50KSxcbiAgICAgIH1cbiAgICB9LFxuICAgIGN5Y2xlczogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2FzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAobWFwQ3ljbGVTY2FsYXJzKVxuICAgIH0sXG4gICAgZGVwZW5kZW5jaWVzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKChkZXApID0+ICh7XG4gICAgICAgIC4uLm1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcCksXG4gICAgICAgIGRlcGVuZHNPbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgICByZXR1cm4gZyA/IHdpdGhHb2FsUmVsYXRpb25zKGcpIDogbnVsbFxuICAgICAgICB9LFxuICAgICAgfSkpXG4gICAgfSxcbiAgICBzbmFwc2hvdHM6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghY3ljbGUpIHJldHVybiBbXVxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX3Byb2dyZXNzX3NuYXBzaG90cycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9jeWNsZV9pZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5vcmRlckJ5KCdhc19vZicsICdhc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKG1hcFNuYXBzaG90U2NhbGFycylcbiAgICB9LFxuICAgIGlzTG9ja2VkOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWNvbmZpZy5ibG9ja191bnRpbF91bmxvY2tlZCkgcmV0dXJuIGZhbHNlXG4gICAgICByZXR1cm4gIShhd2FpdCBkZXBlbmRlbmNpZXNNZXQoZ29hbC5pZCwgZ29hbC51c2VyX2lkKSlcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBHb2FsUXVlcnkgPSB7XG4gIGdvYWxzOiBhc3luYyAoYXJncz86IHsgc3RhdHVzPzogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdwcmlvcml0eScsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdzb3J0X29yZGVyJywgJ2FzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5zdGF0dXMpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3N0YXR1cycsICc9JywgYXJncy5zdGF0dXMgYXMgR29hbFJvd1snc3RhdHVzJ10pXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoR29hbFJlbGF0aW9ucylcbiAgfSxcblxuICBnb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIHJvdyA/IHdpdGhHb2FsUmVsYXRpb25zKHJvdykgOiBudWxsXG4gIH0sXG5cbiAgZ29hbE51ZGdlczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3NcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcGFpcnMgPSBbXVxuICAgIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcGFpcnMucHVzaCh7IGdvYWwsIGN5Y2xlOiBjeWNsZSA/PyBudWxsIH0pXG4gICAgfVxuICAgIHJldHVybiBidWlsZEdvYWxOdWRnZXMocGFpcnMpXG4gIH0sXG5cbiAgZGFpbHlQcm9ncmVzczogYXN5bmMgKGFyZ3M/OiB7IGRhdGU/OiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGRhdGUgPSBhcmdzPy5kYXRlID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcblxuICAgIGNvbnN0IGNvbXBsZXRpb25zID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0eV9jb21wbGV0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnb2NjdXJyZW5jZV9kYXRlJywgJz0nLCBkYXRlKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCB0aW1lRXZlbnRzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2V2ZW50cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnbWV0cmljJywgJz0nLCAnZHVyYXRpb24nKVxuICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRhdGUpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IG1pbnV0ZXNUb2RheSA9IHRpbWVFdmVudHMucmVkdWNlKFxuICAgICAgKHN1bSwgZSkgPT4gc3VtICsgTnVtYmVyKGUuYW1vdW50KSxcbiAgICAgIDAsXG4gICAgKVxuXG4gICAgLy8gU3RyZWFrOiBjb25zZWN1dGl2ZSBkYXlzIGVuZGluZyB0b2RheSB3aXRoID49IDEgY29tcGxldGlvbi5cbiAgICBsZXQgc3RyZWFrID0gMFxuICAgIGNvbnN0IGN1cnNvciA9IG5ldyBEYXRlKGRhdGUgKyAnVDAwOjAwOjAwWicpXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAzNjU7IGkrKykge1xuICAgICAgY29uc3QgZGF5ID0gY3Vyc29yLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdHlfY29tcGxldGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRheSlcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIXJvdykgYnJlYWtcbiAgICAgIHN0cmVhaysrXG4gICAgICBjdXJzb3Iuc2V0VVRDRGF0ZShjdXJzb3IuZ2V0VVRDRGF0ZSgpIC0gMSlcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGNvbXBsZXRlZENvdW50OiBjb21wbGV0aW9ucy5sZW5ndGgsXG4gICAgICBtaW51dGVzVG9kYXksXG4gICAgICBzdHJlYWtEYXlzOiBzdHJlYWssXG4gICAgICBjb21wbGV0aW9ucyxcbiAgICB9XG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBHb2FsTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChpbnB1dCwgbm93KVxuXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBjcmVhdGVkID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKCdnb2FscycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogdmFsaWRhdGVkLnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICAgIGNvbG9yOiB2YWxpZGF0ZWQuY29sb3IsXG4gICAgICAgICAgaWNvbjogaW5wdXQuaWNvbiA/PyBudWxsLFxuICAgICAgICAgIHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlLFxuICAgICAgICAgIG1ldHJpYzogaW5wdXQubWV0cmljLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogdmFsaWRhdGVkLnRhcmdldFZhbHVlLFxuICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkodG9Db25maWdKc29uKGlucHV0LmNvbmZpZykpLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgcmVjdXJyZW5jZTogdmFsaWRhdGVkLnJlY3VycmVuY2VcbiAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b0RlYWRsaW5lSnNvbih2YWxpZGF0ZWQuZGVhZGxpbmUpKVxuICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgIHByaW9yaXR5OiBpbnB1dC5wcmlvcml0eSA/PyAwLFxuICAgICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICAgIHN0YXJ0c19hdDogdmFsaWRhdGVkLnN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0gYXMgTmV3R29hbClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICAgIGF3YWl0IHJlcGxhY2VMaW5rcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmxpbmtzKVxuICAgICAgYXdhaXQgcmVwbGFjZURlcGVuZGVuY2llcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmRlcGVuZGVuY2llcylcbiAgICAgIGF3YWl0IGNyZWF0ZUluaXRpYWxDeWNsZSh0cngsIGNyZWF0ZWQsIG5vdylcbiAgICAgIHJldHVybiBjcmVhdGVkXG4gICAgfSlcblxuICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKFxuICAgICAgZGIsXG4gICAgICBnb2FsLFxuICAgICAgKGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpKSxcbiAgICAgIG5vdyxcbiAgICApXG5cbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoXG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCksXG4gICAgKVxuICB9LFxuXG4gIHVwZGF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBjb25zdCBub3dEYXRlID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlVXBkYXRlR29hbElucHV0KFxuICAgICAgYXJncy5pbnB1dCxcbiAgICAgIGV4aXN0aW5nLnJ1bGVfdHlwZSxcbiAgICAgIG5vd0RhdGUsXG4gICAgKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5vd0RhdGUudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgYWN0aXZlQ3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZXhpc3RpbmcuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGxldCBuZXh0U3RhcnRzQXQ6IERhdGUgfCB1bmRlZmluZWRcbiAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChleGlzdGluZy5zdGF0dXMgPT09ICdjb21wbGV0ZWQnIHx8IGV4aXN0aW5nLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICAgJ2Nhbm5vdCBjaGFuZ2Ugc3RhcnRzQXQgb24gYSBjb21wbGV0ZWQgb3IgZmFpbGVkIGdvYWwnLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3N0YXJ0c0F0IGNhbm5vdCBiZSBjbGVhcmVkOyBvbWl0IHRvIGxlYXZlIHVuY2hhbmdlZCcpXG4gICAgICB9XG4gICAgICBuZXh0U3RhcnRzQXQgPSB2YWxpZGF0ZWQuc3RhcnRzQXRcblxuICAgICAgY29uc3QgY2xvc2VkQ3ljbGVzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnIT0nLCAnYWN0aXZlJylcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIC8vIEFmdGVyIGN5Y2xlIDAgaGFzIGNsb3NlZCwgc3RhcnQgaXMgZnJvemVuLlxuICAgICAgaWYgKGNsb3NlZEN5Y2xlcyAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICdjYW5ub3QgY2hhbmdlIHN0YXJ0c0F0IGFmdGVyIHRoZSBmaXJzdCBjeWNsZSBoYXMgY2xvc2VkJyxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm9ncmVzc0JlZ3VuID1cbiAgICAgICAgYWN0aXZlQ3ljbGUgIT0gbnVsbCAmJiBOdW1iZXIoYWN0aXZlQ3ljbGUuY3VycmVudF92YWx1ZSkgPiAwXG5cbiAgICAgIGlmIChcbiAgICAgICAgcHJvZ3Jlc3NCZWd1biAmJlxuICAgICAgICBuZXh0U3RhcnRzQXQuZ2V0VGltZSgpID4gbmV3IERhdGUoZXhpc3Rpbmcuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgICAgICkge1xuICAgICAgICBpZiAoIWlucHV0LmNvbmZpcm1TdGFydHNBdENoYW5nZSkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICAgJ21vdmluZyBzdGFydHNBdCBsYXRlciBhZnRlciBwcm9ncmVzcyByZXF1aXJlcyBjb25maXJtU3RhcnRzQXRDaGFuZ2UnLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGVmZmVjdGl2ZVN0YXJ0c0F0ID0gbmV4dFN0YXJ0c0F0ID8/IG5ldyBEYXRlKGV4aXN0aW5nLnN0YXJ0c19hdClcbiAgICBjb25zdCBlZmZlY3RpdmVEZWFkbGluZSA9IHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgOiAoKCkgPT4ge1xuICAgICAgICBjb25zdCBkID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZXhpc3RpbmcuZGVhZGxpbmUpXG4gICAgICAgIGlmICghZCkgcmV0dXJuIG51bGxcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiBkLmtpbmQsXG4gICAgICAgICAgZGF0ZTogZC5kYXRlLFxuICAgICAgICAgIGRheXNBZnRlckN5Y2xlU3RhcnQ6IGQuZGF5c19hZnRlcl9jeWNsZV9zdGFydCxcbiAgICAgICAgICBncmFjZURheXM6IGQuZ3JhY2VfZGF5cyxcbiAgICAgICAgICB3YXJuRGF5czogZC53YXJuX2RheXMsXG4gICAgICAgIH1cbiAgICAgIH0pKClcbiAgICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoZWZmZWN0aXZlU3RhcnRzQXQsIGVmZmVjdGl2ZURlYWRsaW5lKVxuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgLi4uKGlucHV0LnRpdGxlICE9IG51bGxcbiAgICAgICAgICAgID8geyB0aXRsZTogdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5kZXNjcmlwdGlvbiAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5jb2xvciAhPSBudWxsXG4gICAgICAgICAgICA/IHsgY29sb3I6IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuaWNvbiAhPT0gdW5kZWZpbmVkID8geyBpY29uOiBpbnB1dC5pY29uIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnJ1bGVUeXBlICE9IG51bGwgPyB7IHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0Lm1ldHJpYyAhPSBudWxsID8geyBtZXRyaWM6IGlucHV0Lm1ldHJpYyB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsXG4gICAgICAgICAgICA/IHsgdGFyZ2V0X3ZhbHVlOiBpbnB1dC50YXJnZXRWYWx1ZSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuY29uZmlnICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBjb25maWc6IEpTT04uc3RyaW5naWZ5KHRvQ29uZmlnSnNvbihpbnB1dC5jb25maWcpKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc3RhdHVzICE9IG51bGwgPyB7IHN0YXR1czogaW5wdXQuc3RhdHVzIH0gOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICByZWN1cnJlbmNlOiB2YWxpZGF0ZWQucmVjdXJyZW5jZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9EZWFkbGluZUpzb24odmFsaWRhdGVkLmRlYWRsaW5lKSlcbiAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4obmV4dFN0YXJ0c0F0ICE9IG51bGxcbiAgICAgICAgICAgID8geyBzdGFydHNfYXQ6IG5leHRTdGFydHNBdC50b0lTT1N0cmluZygpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5wcmlvcml0eSAhPSBudWxsID8geyBwcmlvcml0eTogaW5wdXQucHJpb3JpdHkgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc29ydE9yZGVyICE9IG51bGwgPyB7IHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciB9IDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5leGVjdXRlKClcblxuICAgICAgaWYgKHZhbGlkYXRlZC5saW5rcykge1xuICAgICAgICBhd2FpdCByZXBsYWNlTGlua3ModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5saW5rcylcbiAgICAgIH1cbiAgICAgIGlmICh2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGF3YWl0IHJlcGxhY2VEZXBlbmRlbmNpZXModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5kZXBlbmRlbmNpZXMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGdvYWxBZnRlciA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGN5Y2xlICYmIG5leHRTdGFydHNBdCAhPSBudWxsKSB7XG4gICAgICAgIGF3YWl0IHJlc2NoZWR1bGVBY3RpdmVDeWNsZSh0cngsIGdvYWxBZnRlciwgY3ljbGUsIG5leHRTdGFydHNBdCwgbm93RGF0ZSlcbiAgICAgIH0gZWxzZSBpZiAoY3ljbGUgJiYgaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHRhcmdldF92YWx1ZTogaW5wdXQudGFyZ2V0VmFsdWUsXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSlcbiAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjeWNsZSAmJlxuICAgICAgICAodmFsaWRhdGVkLmRlYWRsaW5lICE9PSB1bmRlZmluZWQgfHwgdmFsaWRhdGVkLnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZCkgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID09PSAwICYmXG4gICAgICAgIGN5Y2xlLmN5Y2xlX2luZGV4ID09PSAwXG4gICAgICApIHtcbiAgICAgICAgLy8gUmVmcmVzaCBib3VuZHMgb24gdW5zdGFydGVkIGN5Y2xlIDAgd2hlbiBkZWFkbGluZS9yZWN1cnJlbmNlIGNoYW5nZS5cbiAgICAgICAgYXdhaXQgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICBnb2FsQWZ0ZXIsXG4gICAgICAgICAgY3ljbGUsXG4gICAgICAgICAgbmV3IERhdGUoZ29hbEFmdGVyLnN0YXJ0c19hdCksXG4gICAgICAgICAgbm93RGF0ZSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoY3ljbGUpIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSwgbm93RGF0ZSlcblxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIHBhdXNlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdwYXVzZWQnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICByZXN1bWVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FjdGl2ZScsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdwYXVzZWQnKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIGFyY2hpdmVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FyY2hpdmVkJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgZGVsZXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwXG4gIH0sXG5cbiAgcmVjb21wdXRlR29hbFByb2dyZXNzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJnc1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzKGRiLCB1c2VySWQpXG4gICAgcmV0dXJuIHsgcmVjb21wdXRlZDogY291bnQgfVxuICB9LFxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsUmVjdXJyZW5jZUNvbmZpZyxcbiAgTmV3R29hbEN5Y2xlLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjeWNsZUhhc1N0YXJ0ZWQgfSBmcm9tICcuL2xpZmVjeWNsZS50cydcbmltcG9ydCB7IHJlY29tcHV0ZUN5Y2xlIH0gZnJvbSAnLi9wcm9ncmVzcy50cydcblxuZXhwb3J0IHtcbiAgY3ljbGVIYXNTdGFydGVkLFxuICBsaWZlY3ljbGVQaGFzZSxcbiAgdHlwZSBHb2FsTGlmZWN5Y2xlUGhhc2UsXG59IGZyb20gJy4vbGlmZWN5Y2xlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBUXG59XG5cbmZ1bmN0aW9uIGFkZERheXMoZGF0ZTogRGF0ZSwgZGF5czogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlKVxuICBkLnNldFVUQ0RhdGUoZC5nZXRVVENEYXRlKCkgKyBkYXlzKVxuICByZXR1cm4gZFxufVxuXG5mdW5jdGlvbiBhZGRNb250aHMoZGF0ZTogRGF0ZSwgbW9udGhzOiBudW1iZXIpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGRhdGUpXG4gIGQuc2V0VVRDTW9udGgoZC5nZXRVVENNb250aCgpICsgbW9udGhzKVxuICByZXR1cm4gZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZUN5Y2xlRW5kKFxuICBzdGFydHNBdDogRGF0ZSxcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoIXJlY3VycmVuY2UpIHJldHVybiBudWxsXG4gIGNvbnN0IGludGVydmFsID0gTWF0aC5tYXgoMSwgcmVjdXJyZW5jZS5pbnRlcnZhbCA/PyAxKVxuICBzd2l0Y2ggKHJlY3VycmVuY2UucGVyaW9kKSB7XG4gICAgY2FzZSAnd2Vla2x5JzpcbiAgICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCA3ICogaW50ZXJ2YWwpXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICByZXR1cm4gYWRkTW9udGhzKHN0YXJ0c0F0LCBpbnRlcnZhbClcbiAgICBjYXNlICdxdWFydGVybHknOlxuICAgICAgcmV0dXJuIGFkZE1vbnRocyhzdGFydHNBdCwgMyAqIGludGVydmFsKVxuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgaW50ZXJ2YWwpXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVEZWFkbGluZUF0KFxuICBzdGFydHNBdDogRGF0ZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4pOiBEYXRlIHwgbnVsbCB7XG4gIGlmICghZGVhZGxpbmUpIHJldHVybiBudWxsXG4gIGlmIChkZWFkbGluZS5raW5kID09PSAnYWJzb2x1dGUnICYmIGRlYWRsaW5lLmRhdGUpIHtcbiAgICByZXR1cm4gbmV3IERhdGUoZGVhZGxpbmUuZGF0ZSArICdUMjM6NTk6NTkuOTk5WicpXG4gIH1cbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScgJiYgZGVhZGxpbmUuZGF5c19hZnRlcl9jeWNsZV9zdGFydCAhPSBudWxsKSB7XG4gICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIGRlYWRsaW5lLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQpXG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cblxuZXhwb3J0IHR5cGUgRGVhZGxpbmVTdGF0ZSA9ICdvbl90cmFjaycgfCAnYXBwcm9hY2hpbmcnIHwgJ292ZXJkdWUnIHwgJ2ZhaWxlZCdcblxuZXhwb3J0IGZ1bmN0aW9uIGRlYWRsaW5lU3RhdGUoXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogRGVhZGxpbmVTdGF0ZSB7XG4gIGlmICghY3ljbGUuZGVhZGxpbmVfYXQpIHJldHVybiAnb25fdHJhY2snXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBuZXcgRGF0ZShjeWNsZS5kZWFkbGluZV9hdClcbiAgY29uc3QgZ3JhY2UgPSBkZWFkbGluZT8uZ3JhY2VfZGF5cyA/PyAwXG4gIGNvbnN0IHdhcm4gPSBkZWFkbGluZT8ud2Fybl9kYXlzID8/IDNcbiAgY29uc3QgZ3JhY2VFbmQgPSBhZGREYXlzKGRlYWRsaW5lQXQsIGdyYWNlKVxuXG4gIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpIHtcbiAgICByZXR1cm4gJ29uX3RyYWNrJ1xuICB9XG4gIGlmIChub3cgPiBncmFjZUVuZCkgcmV0dXJuICdmYWlsZWQnXG4gIGlmIChub3cgPiBkZWFkbGluZUF0KSByZXR1cm4gJ292ZXJkdWUnXG4gIGNvbnN0IHdhcm5TdGFydCA9IGFkZERheXMoZGVhZGxpbmVBdCwgLXdhcm4pXG4gIGlmIChub3cgPj0gd2FyblN0YXJ0KSByZXR1cm4gJ2FwcHJvYWNoaW5nJ1xuICByZXR1cm4gJ29uX3RyYWNrJ1xufVxuXG5mdW5jdGlvbiBkYXRlT25seUlzbyhkYXRlOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVTbmFwc2hvdChcbiAgZGI6IERiTGlrZSxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgYXNPZjogRGF0ZSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhc09mU3RyID0gZGF0ZU9ubHlJc28oYXNPZilcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogY3ljbGUuaWQsXG4gICAgICBhc19vZjogYXNPZlN0cixcbiAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgfSlcbiAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICBvYy5jb2x1bW5zKFsnZ29hbF9jeWNsZV9pZCcsICdhc19vZiddKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgICB9KVxuICAgIClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbi8qKlxuICogQ3JlYXRlIHRoZSBmaXJzdCBjeWNsZSBmb3IgYSBuZXdseSBjcmVhdGVkIGdvYWwuXG4gKiBVc2VzIGdvYWwuc3RhcnRzX2F0IGFzIHRoZSBjeWNsZSB3aW5kb3cgc3RhcnQgKG5vdCB3YWxsLWNsb2NrIG5vdykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVJbml0aWFsQ3ljbGUoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgY29uc3QgZW5kc0F0ID0gY29tcHV0ZUN5Y2xlRW5kKHN0YXJ0c0F0LCByZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZUF0ID0gY29tcHV0ZURlYWRsaW5lQXQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgY3ljbGVfaW5kZXg6IDAsXG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgIGNhcnJ5X292ZXI6IDAsXG4gICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogUmV3cml0ZSBhbiBhY3RpdmUgY3ljbGUncyB3aW5kb3cgZnJvbSBhIG5ldyBzdGFydHNfYXQgKGFuZCBvcHRpb25hbFxuICogdXBkYXRlZCBnb2FsIHJlY3VycmVuY2UvZGVhZGxpbmUvdGFyZ2V0KS4gVXNlZCB3aGVuIGVkaXRpbmcgc3RhcnQgZGF0ZVxuICogYmVmb3JlIHByb2dyZXNzIC8gd2hlbiByZXNjaGVkdWxpbmcgYW4gdW5zdGFydGVkIGN5Y2xlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBzdGFydHNBdDogRGF0ZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBlbmRzQXQgPSBjb21wdXRlQ3ljbGVFbmQoc3RhcnRzQXQsIHJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBjb21wdXRlRGVhZGxpbmVBdChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogQ2xvc2UgYW4gYWN0aXZlIGN5Y2xlIGFuZCBvcGVuIHRoZSBuZXh0IG9uZSB3aGVuIHJlY3VycmVuY2UgYXBwbGllcy5cbiAqIFVzZXMgbGF6eS1vbi1yZWFkOiBjYWxsIGJlZm9yZSByZXR1cm5pbmcgZ29hbHMgdG8gdGhlIGNsaWVudC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvbGxPdmVySWZOZWVkZWQoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICAvLyBEbyBub3Qgcm9sbCBvdmVyLCBtaXNzLWJhY2tmaWxsLCBvciBmYWlsIGRlYWRsaW5lcyBiZWZvcmUgdGhlIGN5Y2xlIHN0YXJ0cy5cbiAgaWYgKCFjeWNsZUhhc1N0YXJ0ZWQoY3ljbGUsIG5vdykpIHtcbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgaWYgKCFyZWN1cnJlbmNlIHx8ICFjeWNsZS5lbmRzX2F0KSB7XG4gICAgLy8gT25lLXRpbWU6IG1heWJlIGZhaWwgb24gZGVhZGxpbmUgZ3JhY2UuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUsIG5vdylcbiAgICBpZiAoY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJiBzdGF0ZSA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdmYWlsZWQnLCB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCB1cGRhdGVkLCBub3cpXG4gICAgICByZXR1cm4gdXBkYXRlZFxuICAgIH1cbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGlmIChjeWNsZS5zdGF0dXMgIT09ICdhY3RpdmUnKSByZXR1cm4gY3ljbGVcbiAgaWYgKG5vdyA8IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpKSByZXR1cm4gY3ljbGVcblxuICAvLyBSZWNvbXB1dGUgb25lIGxhc3QgdGltZSBiZWZvcmUgY2xvc2luZy5cbiAgbGV0IGNsb3NlZCA9IGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSlcbiAgY29uc3QgbWV0ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY2xvc2VkLCBkZWFkbGluZSwgbmV3IERhdGUoY3ljbGUuZW5kc19hdCkpXG5cbiAgbGV0IGNsb3NlU3RhdHVzOiBHb2FsQ3ljbGVbJ3N0YXR1cyddID0gbWV0XG4gICAgPyAnc3VjY2VlZGVkJ1xuICAgIDogc3RhdGUgPT09ICdmYWlsZWQnIHx8IHN0YXRlID09PSAnb3ZlcmR1ZSdcbiAgICA/ICdmYWlsZWQnXG4gICAgOiAnbWlzc2VkJ1xuXG4gIC8vIEJhY2stZmlsbCBtaXNzZWQgaW50ZXJtZWRpYXRlIGN5Y2xlcyBpZiB3ZSBza2lwcGVkIG11bHRpcGxlIHdpbmRvd3MuXG4gIGxldCBjdXJzb3JTdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbiAgbGV0IGN1cnNvckVuZCA9IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpXG4gIGxldCBjeWNsZUluZGV4ID0gY3ljbGUuY3ljbGVfaW5kZXhcbiAgbGV0IGNhcnJ5ID0gMFxuXG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5X292ZXIgPT09ICdvdmVyZmxvdycgJiZcbiAgICBOdW1iZXIoY2xvc2VkLmN1cnJlbnRfdmFsdWUpID4gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gICkge1xuICAgIGNhcnJ5ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSAtIE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICB9XG5cbiAgY2xvc2VkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIHN0YXR1czogY2xvc2VTdGF0dXMsXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNsb3NlZC5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCBjbG9zZWQsIGN1cnNvckVuZClcblxuICAvLyBHcmFudCByZXdhcmRzIHdoZW4gYSByZWN1cnJpbmcgY3ljbGUgY2xvc2VzIGFzIHN1Y2NlZWRlZCAoZWRnZS10cmlnZ2VyKS5cbiAgLy8gT25lLXRpbWUgc3VjY2VzcyBpcyBhbHJlYWR5IGdyYW50ZWQgaW5zaWRlIHJlY29tcHV0ZUN5Y2xlLlxuICBpZiAoY2xvc2VTdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcpIHtcbiAgICBjb25zdCB7IGdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MgfSA9IGF3YWl0IGltcG9ydChcbiAgICAgICcuLi9yZXdhcmRzL2hvb2tzLnRzJ1xuICAgIClcbiAgICBhd2FpdCBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzKGRiLCB7XG4gICAgICB1c2VySWQ6IGdvYWwudXNlcl9pZCxcbiAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlSWQ6IGNsb3NlZC5pZCxcbiAgICB9KVxuICB9XG5cbiAgLy8gRmlsbCBnYXBzIHVudGlsIHdlIHJlYWNoIGEgY3ljbGUgdGhhdCBjb250YWlucyBgbm93YC5cbiAgd2hpbGUgKGN1cnNvckVuZCA8PSBub3cpIHtcbiAgICBjb25zdCBuZXh0U3RhcnQgPSBjdXJzb3JFbmRcbiAgICBjb25zdCBuZXh0RW5kID0gY29tcHV0ZUN5Y2xlRW5kKG5leHRTdGFydCwgcmVjdXJyZW5jZSlcbiAgICBpZiAoIW5leHRFbmQpIGJyZWFrXG5cbiAgICBjeWNsZUluZGV4ICs9IDFcblxuICAgIC8vIElmIHRoaXMgaW50ZXJtZWRpYXRlIHdpbmRvdyBpcyBhbHJlYWR5IGZ1bGx5IGluIHRoZSBwYXN0LCBtYXJrIG1pc3NlZC5cbiAgICBpZiAobmV4dEVuZCA8PSBub3cpIHtcbiAgICAgIGNvbnN0IG1pc3NlZERlYWRsaW5lID0gY29tcHV0ZURlYWRsaW5lQXQobmV4dFN0YXJ0LCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IG1pc3NlZCA9IGF3YWl0IGRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIGdvYWxfaWQ6IGdvYWwuaWQsXG4gICAgICAgICAgY3ljbGVfaW5kZXg6IGN5Y2xlSW5kZXgsXG4gICAgICAgICAgc3RhcnRzX2F0OiBuZXh0U3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBlbmRzX2F0OiBuZXh0RW5kLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZGVhZGxpbmVfYXQ6IG1pc3NlZERlYWRsaW5lID8gbWlzc2VkRGVhZGxpbmUudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICAgICAgc3RhdHVzOiAnbWlzc2VkJyxcbiAgICAgICAgICBjYXJyeV9vdmVyOiAwLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCBtaXNzZWQsIG5leHRFbmQpXG4gICAgICBjdXJzb3JTdGFydCA9IG5leHRTdGFydFxuICAgICAgY3Vyc29yRW5kID0gbmV4dEVuZFxuICAgICAgY2FycnkgPSAwXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIC8vIEFjdGl2ZSBuZXh0IGN5Y2xlLlxuICAgIGNvbnN0IG5leHREZWFkbGluZSA9IGNvbXB1dGVEZWFkbGluZUF0KG5leHRTdGFydCwgZGVhZGxpbmUpXG4gICAgY29uc3QgbmV4dCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWwuaWQsXG4gICAgICAgIGN5Y2xlX2luZGV4OiBjeWNsZUluZGV4LFxuICAgICAgICBzdGFydHNfYXQ6IG5leHRTdGFydC50b0lTT1N0cmluZygpLFxuICAgICAgICBlbmRzX2F0OiBuZXh0RW5kLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGRlYWRsaW5lX2F0OiBuZXh0RGVhZGxpbmUgPyBuZXh0RGVhZGxpbmUudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgICAgY3VycmVudF92YWx1ZTogMCxcbiAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgY2Fycnlfb3ZlcjogY2FycnksXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBuZXh0KVxuICB9XG5cbiAgcmV0dXJuIGNsb3NlZFxufVxuXG4vKiogUm9sbCBvdmVyIGFsbCBhY3RpdmUgY3ljbGVzIGZvciBhIHVzZXIgKGxhenkgYmF0Y2gpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvbGxPdmVyVXNlckdvYWxzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3N0YXR1cycsICdpbicsIFsnYWN0aXZlJywgJ3BhdXNlZCddKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKClcblxuICBmb3IgKGNvbnN0IGdvYWwgb2YgZ29hbHMpIHtcbiAgICBpZiAoZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnKSBjb250aW51ZVxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWN5Y2xlKSBjb250aW51ZVxuICAgIGF3YWl0IHJvbGxPdmVySWZOZWVkZWQoZGIsIGdvYWwsIGN5Y2xlLCBub3cpXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IEdvYWwsIEdvYWxDeWNsZSwgR29hbERlYWRsaW5lQ29uZmlnIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgZGVhZGxpbmVTdGF0ZSB9IGZyb20gJy4vY3ljbGVzLnRzJ1xuXG5leHBvcnQgdHlwZSBHb2FsTnVkZ2VLaW5kID1cbiAgfCAnZGVhZGxpbmVfYXBwcm9hY2hpbmcnXG4gIHwgJ2RlYWRsaW5lX292ZXJkdWUnXG4gIHwgJ2JlaGluZF9wYWNlJ1xuICB8ICdjeWNsZV9jb21wbGV0ZSdcbiAgfCAnZGVwZW5kZW5jeV91bmxvY2tlZCdcbiAgfCAnZ29hbF9zdGFydGluZ19zb29uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxOdWRnZSB7XG4gIGtpbmQ6IEdvYWxOdWRnZUtpbmRcbiAgZ29hbElkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBtZXNzYWdlOiBzdHJpbmdcbiAgc2V2ZXJpdHk6ICdpbmZvJyB8ICd3YXJuaW5nJyB8ICdzdWNjZXNzJ1xufVxuXG5mdW5jdGlvbiBwYXJzZURlYWRsaW5lKHZhbHVlOiB1bmtub3duKTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgR29hbERlYWRsaW5lQ29uZmlnXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgR29hbERlYWRsaW5lQ29uZmlnXG59XG5cbmNvbnN0IFNUQVJUSU5HX1NPT05fREFZUyA9IDNcblxuLyoqXG4gKiBCdWlsZCBpbi1hcHAgbnVkZ2VzIGZvciBkYXNoYm9hcmQgLyBub3RpZmljYXRpb25zIHN1cmZhY2UuXG4gKiBQdXJlIGZ1bmN0aW9uIFx1MjAxNCBubyBJL08uXG4gKiBTa2lwcyBkZWFkbGluZS9iZWhpbmRfcGFjZSBmb3IgZ29hbHMgdGhhdCBoYXZlIG5vdCBzdGFydGVkIHlldC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkR29hbE51ZGdlcyhcbiAgZ29hbHM6IEFycmF5PHsgZ29hbDogR29hbDsgY3ljbGU6IEdvYWxDeWNsZSB8IG51bGwgfT4sXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBHb2FsTnVkZ2VbXSB7XG4gIGNvbnN0IG51ZGdlczogR29hbE51ZGdlW10gPSBbXVxuXG4gIGZvciAoY29uc3QgeyBnb2FsLCBjeWNsZSB9IG9mIGdvYWxzKSB7XG4gICAgaWYgKCFjeWNsZSB8fCBnb2FsLnN0YXR1cyAhPT0gJ2FjdGl2ZScpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBzdGFydHNBdCA9IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KVxuICAgIGlmIChzdGFydHNBdCA+IG5vdykge1xuICAgICAgY29uc3QgbXNVbnRpbCA9IHN0YXJ0c0F0LmdldFRpbWUoKSAtIG5vdy5nZXRUaW1lKClcbiAgICAgIGNvbnN0IGRheXNVbnRpbCA9IG1zVW50aWwgLyAoMjQgKiA2MCAqIDYwICogMTAwMClcbiAgICAgIGlmIChkYXlzVW50aWwgPD0gU1RBUlRJTkdfU09PTl9EQVlTKSB7XG4gICAgICAgIGNvbnN0IGRheXNMYWJlbCA9IE1hdGgubWF4KDEsIE1hdGguY2VpbChkYXlzVW50aWwpKVxuICAgICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2dvYWxfc3RhcnRpbmdfc29vbicsXG4gICAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIHN0YXJ0cyBpbiAke2RheXNMYWJlbH0gZGF5JHtcbiAgICAgICAgICAgIGRheXNMYWJlbCA9PT0gMSA/ICcnIDogJ3MnXG4gICAgICAgICAgfS5gLFxuICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1ldCA9XG4gICAgICBjeWNsZS5zdGF0dXMgPT09ICdzdWNjZWVkZWQnIHx8XG4gICAgICAoTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwICYmXG4gICAgICAgIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICBpZiAodGFyZ2V0TWV0KSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdjeWNsZV9jb21wbGV0ZScsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBZb3UgY29tcGxldGVkIFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgZm9yIHRoaXMgY3ljbGUuYCxcbiAgICAgICAgc2V2ZXJpdHk6ICdzdWNjZXNzJyxcbiAgICAgIH0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VEZWFkbGluZShnb2FsLmRlYWRsaW5lKVxuICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUsIG5vdylcbiAgICBpZiAoc3RhdGUgPT09ICdhcHByb2FjaGluZycpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlYWRsaW5lX2FwcHJvYWNoaW5nJyxcbiAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgbWVzc2FnZTogYERlYWRsaW5lIGZvciBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIGFwcHJvYWNoaW5nLmAsXG4gICAgICAgIHNldmVyaXR5OiAnd2FybmluZycsXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT09ICdvdmVyZHVlJykge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVhZGxpbmVfb3ZlcmR1ZScsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIHBhc3QgaXRzIGRlYWRsaW5lLmAsXG4gICAgICAgIHNldmVyaXR5OiAnd2FybmluZycsXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIEJlaGluZC1wYWNlIGZvciByZWN1cnJpbmcgY3ljbGVzIHdpdGggYSBrbm93biBlbmQuXG4gICAgaWYgKGN5Y2xlLmVuZHNfYXQgJiYgTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwKSB7XG4gICAgICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdCkuZ2V0VGltZSgpXG4gICAgICBjb25zdCBlbmQgPSBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KS5nZXRUaW1lKClcbiAgICAgIGNvbnN0IHNwYW4gPSBNYXRoLm1heCgxLCBlbmQgLSBzdGFydClcbiAgICAgIGNvbnN0IGVsYXBzZWQgPSBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAobm93LmdldFRpbWUoKSAtIHN0YXJ0KSAvIHNwYW4pKVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBlbGFwc2VkICogTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbCA9IE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgaWYgKGVsYXBzZWQgPj0gMC4zNSAmJiBhY3R1YWwgPCBleHBlY3RlZCAqIDAuNykge1xuICAgICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2JlaGluZF9wYWNlJyxcbiAgICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgICAgbWVzc2FnZTogYFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgaXMgYmVoaW5kIHBhY2UgdGhpcyBjeWNsZS5gLFxuICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51ZGdlc1xufVxuIiwgImltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHtcbiAgTmV3UmV3YXJkRGVmaW5pdGlvbixcbiAgTmV3UmV3YXJkUnVsZSxcbiAgUmV3YXJkRGVmaW5pdGlvbiBhcyBSZXdhcmREZWZpbml0aW9uUm93LFxuICBSZXdhcmRJbnZlbnRvcnkgYXMgUmV3YXJkSW52ZW50b3J5Um93LFxuICBSZXdhcmRSdWxlIGFzIFJld2FyZFJ1bGVSb3csXG4gIFJld2FyZFJ1bGVDb25maWcsXG4gIFJld2FyZFRyYW5zYWN0aW9uIGFzIFJld2FyZFRyYW5zYWN0aW9uUm93LFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBhc3NldFB1YmxpY1BhdGgsXG4gIGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnksXG59IGZyb20gJy4uLy4uL2Fzc2V0cy9yZXBvc2l0b3J5LnRzJ1xuaW1wb3J0IHtcbiAgRGJJbnZlbnRvcnlNYW5hZ2VyLFxuICBJbnZlbnRvcnlFcnJvcixcbiAgcmVjb21wdXRlSW52ZW50b3J5RnJvbUxlZGdlcixcbn0gZnJvbSAnLi4vLi4vcmV3YXJkcy9pbnZlbnRvcnkudHMnXG5pbXBvcnQgeyByZXdhcmRHcmFudFNlcnZpY2UgfSBmcm9tICcuLi8uLi9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMnXG5pbXBvcnQgeyB2YWxpZGF0ZUdyb3VwQ29sb3IgfSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBBdHRhY2hSZXdhcmRSdWxlSW5wdXQsXG4gIENvbnN1bWVSZXdhcmRJbnB1dCxcbiAgQ3JlYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0LFxuICBEaXNjYXJkUmV3YXJkSW5wdXQsXG4gIE1hbnVhbEdyYW50UmV3YXJkSW5wdXQsXG4gIFJld2FyZERlZmluaXRpb25zRmlsdGVyLFxuICBSZXdhcmRIaXN0b3J5RmlsdGVyLFxuICBSZXdhcmRJbnZlbnRvcnlGaWx0ZXIsXG4gIFVwZGF0ZVJld2FyZERlZmluaXRpb25JbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkUmV3YXJkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRSZXdhcmRFcnJvcidcbiAgfVxufVxuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFncyh2YWx1ZTogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBbXVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5tYXAoU3RyaW5nKVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHZhbHVlKVxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFyc2VkKSA/IHBhcnNlZC5tYXAoU3RyaW5nKSA6IFtdXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKHZhbHVlOiB1bmtub3duKTogUmV3YXJkUnVsZUNvbmZpZyB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4ge31cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFJld2FyZFJ1bGVDb25maWdcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7fVxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgUmV3YXJkUnVsZUNvbmZpZ1xufVxuXG5mdW5jdGlvbiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3c6IFJld2FyZERlZmluaXRpb25Sb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgdGFnczogcGFyc2VUYWdzKHJvdy50YWdzKSxcbiAgICBpbWFnZV91cmw6IHJvdy5pbWFnZV9hc3NldF9pZFxuICAgICAgPyBhc3NldFB1YmxpY1BhdGgocm93LmltYWdlX2Fzc2V0X2lkKVxuICAgICAgOiBudWxsLFxuICAgIGltYWdlOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocm93LmltYWdlX2Fzc2V0X2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgcmVwby5nZXRNZXRhZGF0YShyb3cuaW1hZ2VfYXNzZXRfaWQsIHJvdy51c2VyX2lkKVxuICAgICAgaWYgKCFhc3NldCkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFzc2V0LFxuICAgICAgICB1cmw6IGFzc2V0UHVibGljUGF0aChhc3NldC5pZCksXG4gICAgICB9XG4gICAgfSxcbiAgfVxufVxuXG5mdW5jdGlvbiB3aXRoSW52ZW50b3J5UmVsYXRpb25zKHJvdzogUmV3YXJkSW52ZW50b3J5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIGRlZmluaXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gZGVmID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMoZGVmKSA6IG51bGxcbiAgICB9LFxuICB9XG59XG5cbmZ1bmN0aW9uIHdpdGhSdWxlUmVsYXRpb25zKHJvdzogUmV3YXJkUnVsZVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBjb25maWc6IHBhcnNlQ29uZmlnKHJvdy5jb25maWcpLFxuICAgIGRlZmluaXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gZGVmID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMoZGVmKSA6IG51bGxcbiAgICB9LFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFRyYW5zYWN0aW9uKHJvdzogUmV3YXJkVHJhbnNhY3Rpb25Sb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgbWV0YWRhdGE6XG4gICAgICB0eXBlb2Ygcm93Lm1ldGFkYXRhID09PSAnc3RyaW5nJ1xuICAgICAgICA/IEpTT04ucGFyc2Uocm93Lm1ldGFkYXRhKVxuICAgICAgICA6IHJvdy5tZXRhZGF0YSxcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignbmFtZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignbmFtZSB0b28gbG9uZycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBjb25zdCBSZXdhcmRRdWVyeSA9IHtcbiAgcmV3YXJkRGVmaW5pdGlvbnM6IGFzeW5jIChhcmdzOiB7XG4gICAgZmlsdGVyPzogUmV3YXJkRGVmaW5pdGlvbnNGaWx0ZXIgfCBudWxsXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmaWx0ZXIgPSBhcmdzLmZpbHRlciA/PyB7fVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuc2VhcmNoPy50cmltKCkpIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBgJSR7ZmlsdGVyLnNlYXJjaC50cmltKCkudG9Mb3dlckNhc2UoKX0lYFxuICAgICAgcSA9IHEud2hlcmUoKGViKSA9PlxuICAgICAgICBlYi5vcihbXG4gICAgICAgICAgZWIoJ25hbWUnLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignZGVzY3JpcHRpb24nLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignY2F0ZWdvcnknLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgXSksXG4gICAgICApXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuY2F0ZWdvcnk/LnRyaW0oKSkge1xuICAgICAgcSA9IHEud2hlcmUoJ2NhdGVnb3J5JywgJz0nLCBmaWx0ZXIuY2F0ZWdvcnkudHJpbSgpKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDEwMCwgMSksIDIwMClcbiAgICBjb25zdCBvZmZzZXQgPSBNYXRoLm1heChmaWx0ZXIub2Zmc2V0ID8/IDAsIDApXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcVxuICAgICAgLm9yZGVyQnkoJ3NvcnRfb3JkZXInLCAnYXNjJylcbiAgICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgICAubGltaXQobGltaXQpXG4gICAgICAub2Zmc2V0KG9mZnNldClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKVxuICB9LFxuXG4gIHJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpIDogbnVsbFxuICB9LFxuXG4gIHJld2FyZEludmVudG9yeTogYXN5bmMgKGFyZ3M6IHtcbiAgICBmaWx0ZXI/OiBSZXdhcmRJbnZlbnRvcnlGaWx0ZXIgfCBudWxsXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmaWx0ZXIgPSBhcmdzLmZpbHRlciA/PyB7fVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC5pbm5lckpvaW4oXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMnLFxuICAgICAgICAncmV3YXJkX2RlZmluaXRpb25zLmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucmV3YXJkX2RlZmluaXRpb25faWQnLFxuICAgICAgKVxuICAgICAgLndoZXJlKCdyZXdhcmRfaW52ZW50b3J5LnVzZXJfaWQnLCAnPScsIHVzZXJJZClcblxuICAgIGlmIChmaWx0ZXIuc2VhcmNoPy50cmltKCkpIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBgJSR7ZmlsdGVyLnNlYXJjaC50cmltKCkudG9Mb3dlckNhc2UoKX0lYFxuICAgICAgcSA9IHEud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9ucy5uYW1lJywgJ2lsaWtlJywgdGVybSlcbiAgICB9XG4gICAgaWYgKGZpbHRlci5zdGFja2FibGVPbmx5KSB7XG4gICAgICBxID0gcS53aGVyZSgncmV3YXJkX2RlZmluaXRpb25zLnN0YWNrYWJsZScsICc9JywgdHJ1ZSlcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0ID0gZmlsdGVyLnNvcnQgPz8gJ3JlY2VudCdcbiAgICBpZiAoc29ydCA9PT0gJ25hbWUnKSB7XG4gICAgICBxID0gcS5vcmRlckJ5KCdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsICdhc2MnKVxuICAgIH0gZWxzZSBpZiAoc29ydCA9PT0gJ3F1YW50aXR5Jykge1xuICAgICAgcSA9IHEub3JkZXJCeSgncmV3YXJkX2ludmVudG9yeS5xdWFudGl0eScsICdkZXNjJylcbiAgICB9IGVsc2Uge1xuICAgICAgcSA9IHEub3JkZXJCeSgncmV3YXJkX2ludmVudG9yeS5sYXN0X2Vhcm5lZF9hdCcsICdkZXNjJylcbiAgICB9XG5cbiAgICBjb25zdCBsaW1pdCA9IE1hdGgubWluKE1hdGgubWF4KGZpbHRlci5saW1pdCA/PyAxMDAsIDEpLCAyMDApXG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoZmlsdGVyLm9mZnNldCA/PyAwLCAwKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHFcbiAgICAgIC5zZWxlY3RBbGwoJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEludmVudG9yeVJlbGF0aW9ucylcbiAgfSxcblxuICByZXdhcmRIaXN0b3J5OiBhc3luYyAoYXJnczogeyBmaWx0ZXI/OiBSZXdhcmRIaXN0b3J5RmlsdGVyIHwgbnVsbCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZmlsdGVyID0gYXJncy5maWx0ZXIgPz8ge31cbiAgICBsZXQgcSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcblxuICAgIGlmIChmaWx0ZXIuZGVmaW5pdGlvbklkICE9IG51bGwpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgZmlsdGVyLmRlZmluaXRpb25JZClcbiAgICB9XG4gICAgaWYgKGZpbHRlci50eXBlPy50cmltKCkpIHtcbiAgICAgIHEgPSBxLndoZXJlKCd0eXBlJywgJz0nLCBmaWx0ZXIudHlwZS50cmltKCkgYXMgbmV2ZXIpXG4gICAgfVxuXG4gICAgY29uc3QgbGltaXQgPSBNYXRoLm1pbihNYXRoLm1heChmaWx0ZXIubGltaXQgPz8gNTAsIDEpLCAyMDApXG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoZmlsdGVyLm9mZnNldCA/PyAwLCAwKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHFcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcChtYXBUcmFuc2FjdGlvbilcbiAgfSxcblxuICByZXdhcmRSdWxlczogYXN5bmMgKGFyZ3M6IHtcbiAgICBzb3VyY2VUeXBlOiBzdHJpbmdcbiAgICBzb3VyY2VJZDogbnVtYmVyXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3NvdXJjZV90eXBlJywgJz0nLCBhcmdzLnNvdXJjZVR5cGUpXG4gICAgICAud2hlcmUoJ3NvdXJjZV9pZCcsICc9JywgYXJncy5zb3VyY2VJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoUnVsZVJlbGF0aW9ucylcbiAgfSxcblxuICByZWNlbnRBc3NldHM6IGFzeW5jIChhcmdzOiB7IGxpbWl0PzogbnVtYmVyIHwgbnVsbCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHJlcG8ubGlzdFJlY2VudChcbiAgICAgIHVzZXJJZCxcbiAgICAgIE1hdGgubWluKE1hdGgubWF4KGFyZ3MubGltaXQgPz8gMjAsIDEpLCA1MCksXG4gICAgKVxuICAgIHJldHVybiByb3dzLm1hcCgoYSkgPT4gKHsgLi4uYSwgdXJsOiBhc3NldFB1YmxpY1BhdGgoYS5pZCkgfSkpXG4gIH0sXG5cbiAgcmV3YXJkTnVkZ2VzOiBhc3luYyAoX2FyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IGJ1aWxkUmV3YXJkTnVkZ2VzIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL3Jld2FyZHMvbnVkZ2VzLnRzJylcbiAgICBjb25zdCBpbnZlbnRvcnkgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmlubmVySm9pbihcbiAgICAgICAgJ3Jld2FyZF9kZWZpbml0aW9ucycsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMuaWQnLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICApXG4gICAgICAud2hlcmUoJ3Jld2FyZF9pbnZlbnRvcnkudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdChbXG4gICAgICAgICdyZXdhcmRfaW52ZW50b3J5LmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucXVhbnRpdHknLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsXG4gICAgICBdKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVjZW50RWFybnMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KDEwKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gYnVpbGRSZXdhcmROdWRnZXMoe1xuICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkubWFwKChyKSA9PiAoe1xuICAgICAgICBpZDogci5pZCxcbiAgICAgICAgcXVhbnRpdHk6IHIucXVhbnRpdHksXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiByLnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBuYW1lOiByLm5hbWUsXG4gICAgICB9KSksXG4gICAgICByZWNlbnRFYXJucyxcbiAgICB9KVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgUmV3YXJkTXV0YXRpb24gPSB7XG4gIGNyZWF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaW5wdXQ6IENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dFxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJnc1xuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8uZ2V0TWV0YWRhdGEoaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgYXdhaXQgcmVwby5yZXRhaW4oaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgbm90ZXM6IGlucHV0Lm5vdGVzPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgY2F0ZWdvcnk6IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgdGFnczogSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSksXG4gICAgICAgIGNvbG9yLFxuICAgICAgICBpY29uOiBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgaW1hZ2VfYXNzZXRfaWQ6IGlucHV0LmltYWdlQXNzZXRJZCA/PyBudWxsLFxuICAgICAgICBzdGFja2FibGU6IGlucHV0LnN0YWNrYWJsZSA/PyB0cnVlLFxuICAgICAgICBkZWZhdWx0X3F1YW50aXR5OiBNYXRoLm1heCgxLCBpbnB1dC5kZWZhdWx0UXVhbnRpdHkgPz8gMSksXG4gICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZERlZmluaXRpb24pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIHVwZGF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaWQ6IG51bWJlclxuICAgIGlucHV0OiBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3QgcGF0Y2g6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBpZiAoaW5wdXQuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2guZGVzY3JpcHRpb24gPSBpbnB1dC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IG51bGxcbiAgICB9XG4gICAgaWYgKGlucHV0Lm5vdGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLm5vdGVzID0gaW5wdXQubm90ZXM/LnRyaW0oKSB8fCBudWxsXG4gICAgfVxuICAgIGlmIChpbnB1dC5jYXRlZ29yeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC5jYXRlZ29yeSA9IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbFxuICAgIH1cbiAgICBpZiAoaW5wdXQudGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC50YWdzID0gSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSlcbiAgICB9XG4gICAgaWYgKGlucHV0LmNvbG9yICE9IG51bGwpIHBhdGNoLmNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKVxuICAgIGlmIChpbnB1dC5pY29uICE9PSB1bmRlZmluZWQpIHBhdGNoLmljb24gPSBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbFxuICAgIGlmIChpbnB1dC5zdGFja2FibGUgIT0gbnVsbCkgcGF0Y2guc3RhY2thYmxlID0gaW5wdXQuc3RhY2thYmxlXG4gICAgaWYgKGlucHV0LmRlZmF1bHRRdWFudGl0eSAhPSBudWxsKSB7XG4gICAgICBwYXRjaC5kZWZhdWx0X3F1YW50aXR5ID0gTWF0aC5tYXgoMSwgaW5wdXQuZGVmYXVsdFF1YW50aXR5KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuc29ydE9yZGVyICE9IG51bGwpIHBhdGNoLnNvcnRfb3JkZXIgPSBpbnB1dC5zb3J0T3JkZXJcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBpZiAoaW5wdXQuaW1hZ2VBc3NldElkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCByZXBvLmdldE1ldGFkYXRhKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT09IGlucHV0LmltYWdlQXNzZXRJZCkge1xuICAgICAgICAgIGF3YWl0IHJlcG8ucmV0YWluKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICAgIGlmIChleGlzdGluZy5pbWFnZV9hc3NldF9pZCAhPSBudWxsKSB7XG4gICAgICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgIH1cbiAgICAgIHBhdGNoLmltYWdlX2Fzc2V0X2lkID0gaW5wdXQuaW1hZ2VBc3NldElkXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQocGF0Y2gpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIGFyY2hpdmVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGFyY2hpdmVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuICAgIHJldHVybiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgdW5hcmNoaXZlUmV3YXJkRGVmaW5pdGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghcm93KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdkZWZpbml0aW9uIG5vdCBmb3VuZCcpXG4gICAgcmV0dXJuIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICBkZWxldGVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBpbnYgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9uX2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmIChpbnYpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoXG4gICAgICAgICdjYW5ub3QgZGVsZXRlIGRlZmluaXRpb24gd2l0aCBpbnZlbnRvcnk7IGFyY2hpdmUgaW5zdGVhZCcsXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGlmIChleGlzdGluZy5pbWFnZV9hc3NldF9pZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICAgIGF3YWl0IHJlcG8ucmVsZWFzZShleGlzdGluZy5pbWFnZV9hc3NldF9pZCwgdXNlcklkKVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZVxuICB9LFxuXG4gIGF0dGFjaFJld2FyZFJ1bGU6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBBdHRhY2hSZXdhcmRSdWxlSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3NcbiAgICBjb25zdCBzb3VyY2VUeXBlID0gaW5wdXQuc291cmNlVHlwZS50cmltKClcbiAgICBpZiAoIXNvdXJjZVR5cGUpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ3NvdXJjZVR5cGUgaXMgcmVxdWlyZWQnKVxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlucHV0LnNvdXJjZUlkKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignc291cmNlSWQgaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5yZXdhcmREZWZpbml0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgaWYgKHNvdXJjZVR5cGUgPT09ICdhY3Rpdml0eScpIHtcbiAgICAgIGNvbnN0IGFjdCA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuc291cmNlSWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghYWN0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdhY3Rpdml0eSBub3QgZm91bmQnKVxuICAgIH0gZWxzZSBpZiAoc291cmNlVHlwZSA9PT0gJ2dvYWwnKSB7XG4gICAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuc291cmNlSWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghZ29hbCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZ29hbCBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGxldCBjb25maWc6IFJld2FyZFJ1bGVDb25maWcgPSB7fVxuICAgIGlmIChpbnB1dC5jb25maWdKc29uPy50cmltKCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbmZpZyA9IEpTT04ucGFyc2UoaW5wdXQuY29uZmlnSnNvbikgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2NvbmZpZ0pzb24gbXVzdCBiZSB2YWxpZCBKU09OJylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gaW5wdXQubW9kZSA/PyAnZml4ZWQnXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgc291cmNlX3R5cGU6IHNvdXJjZVR5cGUsXG4gICAgICAgIHNvdXJjZV9pZDogaW5wdXQuc291cmNlSWQsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBpbnB1dC5yZXdhcmREZWZpbml0aW9uSWQsXG4gICAgICAgIHF1YW50aXR5OiBNYXRoLm1heCgxLCBpbnB1dC5xdWFudGl0eSA/PyAxKSxcbiAgICAgICAgbW9kZSxcbiAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShjb25maWcpLFxuICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRSdWxlKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHdpdGhSdWxlUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICBkZXRhY2hSZXdhcmRSdWxlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3Jld2FyZF9ydWxlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwXG4gIH0sXG5cbiAgY29uc3VtZVJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENvbnN1bWVSZXdhcmRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcXVhbnRpdHkgPSBNYXRoLm1heCgxLCBhcmdzLmlucHV0LnF1YW50aXR5ID8/IDEpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseUNvbnN1bWUoXG4gICAgICAgICAgICB0cngsXG4gICAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgICBhcmdzLmlucHV0LmludmVudG9yeUlkLFxuICAgICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgICBhcmdzLmlucHV0Lm5vdGUsXG4gICAgICAgICAgKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkgPyB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSkgOiBudWxsLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgZGlzY2FyZFJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IERpc2NhcmRSZXdhcmRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcXVhbnRpdHkgPSBNYXRoLm1heCgxLCBhcmdzLmlucHV0LnF1YW50aXR5ID8/IDEpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseURpc2NhcmQoXG4gICAgICAgICAgICB0cngsXG4gICAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgICBhcmdzLmlucHV0LmludmVudG9yeUlkLFxuICAgICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkgPyB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSkgOiBudWxsLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgcmVzdG9yZVJld2FyZDogYXN5bmMgKGFyZ3M6IHsgdHJhbnNhY3Rpb25JZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtYW5hZ2VyID0gbmV3IERiSW52ZW50b3J5TWFuYWdlcigpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9ID0gYXdhaXQgZGJcbiAgICAgICAgLnRyYW5zYWN0aW9uKClcbiAgICAgICAgLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBtYW5hZ2VyLmFwcGx5UmVzdG9yZSh0cngsIHVzZXJJZCwgYXJncy50cmFuc2FjdGlvbklkKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSksXG4gICAgICAgIHRyYW5zYWN0aW9uOiBtYXBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbiksXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgSW52ZW50b3J5RXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcihlcnIubWVzc2FnZSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICBtYW51YWxHcmFudFJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IE1hbnVhbEdyYW50UmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlucHV0LnJld2FyZERlZmluaXRpb25JZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFkZWZpbml0aW9uKSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdkZWZpbml0aW9uIG5vdCBmb3VuZCcpXG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCByZXdhcmRHcmFudFNlcnZpY2UuZ3JhbnQodHJ4LCB1c2VySWQsIFtcbiAgICAgICAge1xuICAgICAgICAgIHJ1bGVJZDogbnVsbCxcbiAgICAgICAgICBkZWZpbml0aW9uSWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgdHJpZ2dlcktleTogYG1hbnVhbDoke0RhdGUubm93KCl9OiR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gLFxuICAgICAgICAgIHNvdXJjZVR5cGU6ICdtYW51YWwnLFxuICAgICAgICAgIHNvdXJjZUlkOiAwLFxuICAgICAgICB9LFxuICAgICAgXSlcbiAgICB9KVxuXG4gICAgY29uc3QgdHggPSByZXN1bHRzWzBdPy50cmFuc2FjdGlvblxuICAgIHJldHVybiB0eCA/IG1hcFRyYW5zYWN0aW9uKHR4KSA6IG51bGxcbiAgfSxcblxuICByZWNvbXB1dGVSZXdhcmRJbnZlbnRvcnk6IGFzeW5jICgpID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZWNvbXB1dGVJbnZlbnRvcnlGcm9tTGVkZ2VyKGRiLCB1c2VySWQpXG4gICAgcmV0dXJuIHRydWVcbiAgfSxcbn1cbiIsICIvKiogU0hBLTI1NiBoZXggZGlnZXN0IG9mIHJhdyBieXRlcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaGEyNTZIZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkaWdlc3QgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgnU0hBLTI1NicsIGJ5dGVzKVxuICByZXR1cm4gQXJyYXkuZnJvbShuZXcgVWludDhBcnJheShkaWdlc3QpKVxuICAgIC5tYXAoKGIpID0+IGIudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJykpXG4gICAgLmpvaW4oJycpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VIYXNoaW5nU2VydmljZSB7XG4gIHNoYTI1NihieXRlczogVWludDhBcnJheSk6IFByb21pc2U8c3RyaW5nPlxufVxuXG5leHBvcnQgY29uc3QgZGVmYXVsdEltYWdlSGFzaGluZ1NlcnZpY2U6IEltYWdlSGFzaGluZ1NlcnZpY2UgPSB7XG4gIHNoYTI1Njogc2hhMjU2SGV4LFxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHVubGluaywgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB0eXBlIHsgQXNzZXRTdG9yYWdlIH0gZnJvbSAnLi90eXBlcy50cydcblxuZnVuY3Rpb24gY3dkKCk6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHByb2Nlc3MuY3dkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHByb2Nlc3MuY3dkKClcbiAgfVxuICByZXR1cm4gJy4nXG59XG5cbmZ1bmN0aW9uIGFzc2V0c1Jvb3QoKTogc3RyaW5nIHtcbiAgY29uc3QgZW52ID1cbiAgICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfRElSKSB8fCBudWxsXG4gIGlmIChlbnYpIHJldHVybiBlbnZcbiAgcmV0dXJuIGpvaW4oY3dkKCksICdkYXRhJywgJ2Fzc2V0cycpXG59XG5cbmV4cG9ydCBjbGFzcyBMb2NhbEZzQXNzZXRTdG9yYWdlIGltcGxlbWVudHMgQXNzZXRTdG9yYWdlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSByb290OiBzdHJpbmcgPSBhc3NldHNSb290KCkpIHt9XG5cbiAgcHJpdmF0ZSBmdWxsUGF0aChrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZSA9IGtleS5yZXBsYWNlKC9cXC5cXC4vZywgJycpLnJlcGxhY2UoL15cXC8rLywgJycpXG4gICAgcmV0dXJuIGpvaW4odGhpcy5yb290LCBzYWZlKVxuICB9XG5cbiAgYXN5bmMgd3JpdGUoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXksXG4gICAgX2NvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBhdGggPSB0aGlzLmZ1bGxQYXRoKGtleSlcbiAgICBjb25zdCBkaXIgPSBqb2luKHBhdGgsICcuLicpXG4gICAgYXdhaXQgbWtkaXIoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICAgIGF3YWl0IHdyaXRlRmlsZShwYXRoLCBieXRlcylcbiAgfVxuXG4gIGFzeW5jIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkRmlsZSh0aGlzLmZ1bGxQYXRoKGtleSkpXG4gICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHVubGluayh0aGlzLmZ1bGxQYXRoKGtleSkpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBbHJlYWR5IGdvbmUuXG4gICAgfVxuICB9XG5cbiAgcHVibGljVXJsKF9rZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IEFzc2V0U3RvcmFnZSB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBMb2NhbEZzQXNzZXRTdG9yYWdlIH0gZnJvbSAnLi9sb2NhbF9mcy50cydcblxuLyoqXG4gKiBTMy1jb21wYXRpYmxlIGFzc2V0IHN0b3JhZ2UgKFBoYXNlIDMpLlxuICpcbiAqIEVudjogQVNTRVRTX1MzX0JVQ0tFVCwgQVNTRVRTX1MzX1JFR0lPTiwgQVNTRVRTX1MzX0VORFBPSU5ULFxuICogQVdTX0FDQ0VTU19LRVlfSUQgLyBBV1NfU0VDUkVUX0FDQ0VTU19LRVkuXG4gKi9cbmV4cG9ydCBjbGFzcyBTM0Fzc2V0U3RvcmFnZSBpbXBsZW1lbnRzIEFzc2V0U3RvcmFnZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVja2V0OiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpb246IHN0cmluZ1xuICBwcml2YXRlIHJlYWRvbmx5IGVuZHBvaW50OiBzdHJpbmcgfCBudWxsXG5cbiAgY29uc3RydWN0b3Iob3B0cz86IHtcbiAgICBidWNrZXQ/OiBzdHJpbmdcbiAgICByZWdpb24/OiBzdHJpbmdcbiAgICBlbmRwb2ludD86IHN0cmluZyB8IG51bGxcbiAgfSkge1xuICAgIHRoaXMuYnVja2V0ID1cbiAgICAgIG9wdHM/LmJ1Y2tldCA/P1xuICAgICAgKCh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TM19CVUNLRVQpIHx8XG4gICAgICAgICcnKVxuICAgIHRoaXMucmVnaW9uID1cbiAgICAgIG9wdHM/LnJlZ2lvbiA/P1xuICAgICAgKCh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TM19SRUdJT04pIHx8XG4gICAgICAgICd1cy1lYXN0LTEnKVxuICAgIHRoaXMuZW5kcG9pbnQgPVxuICAgICAgb3B0cz8uZW5kcG9pbnQgPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfRU5EUE9JTlQpIHx8XG4gICAgICAgIG51bGwpXG4gIH1cblxuICBwcml2YXRlIGFzc2VydENvbmZpZ3VyZWQoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmJ1Y2tldCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnUzNBc3NldFN0b3JhZ2UgaXMgbm90IGNvbmZpZ3VyZWQgKHNldCBBU1NFVFNfUzNfQlVDS0VUKScsXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgd3JpdGUoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXksXG4gICAgY29udGVudFR5cGU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBjb25zdCB1cmwgPSB0aGlzLm9iamVjdFVybChrZXkpXG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogY29udGVudFR5cGUsXG4gICAgICAgICdDb250ZW50LUxlbmd0aCc6IFN0cmluZyhieXRlcy5ieXRlTGVuZ3RoKSxcbiAgICAgIH0sXG4gICAgICBib2R5OiBieXRlcyxcbiAgICB9KVxuICAgIGlmICghcmVzLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFMzIHB1dCBmYWlsZWQ6ICR7cmVzLnN0YXR1c30gJHthd2FpdCByZXMudGV4dCgpfWApXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVhZChrZXk6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IG51bGw+IHtcbiAgICB0aGlzLmFzc2VydENvbmZpZ3VyZWQoKVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRoaXMub2JqZWN0VXJsKGtleSkpXG4gICAgaWYgKHJlcy5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXJlcy5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTMyBnZXQgZmFpbGVkOiAke3Jlcy5zdGF0dXN9YClcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IHJlcy5hcnJheUJ1ZmZlcigpKVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBhd2FpdCBmZXRjaCh0aGlzLm9iamVjdFVybChrZXkpLCB7IG1ldGhvZDogJ0RFTEVURScgfSlcbiAgfVxuXG4gIHB1YmxpY1VybChrZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIGlmICghdGhpcy5idWNrZXQpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHRoaXMub2JqZWN0VXJsKGtleSlcbiAgfVxuXG4gIHByaXZhdGUgb2JqZWN0VXJsKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlID0ga2V5LnJlcGxhY2UoL15cXC8rLywgJycpXG4gICAgaWYgKHRoaXMuZW5kcG9pbnQpIHtcbiAgICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50LnJlcGxhY2UoL1xcLyQvLCAnJyl9LyR7dGhpcy5idWNrZXR9LyR7c2FmZX1gXG4gICAgfVxuICAgIHJldHVybiBgaHR0cHM6Ly8ke3RoaXMuYnVja2V0fS5zMy4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7c2FmZX1gXG4gIH1cbn1cblxuLyoqIFBpY2sgc3RvcmFnZSBiYWNrZW5kIGZyb20gZW52OiBBU1NFVFNfU1RPUkFHRT1zMyB8IGxvY2FsIChkZWZhdWx0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBc3NldFN0b3JhZ2VGcm9tRW52KCk6IEFzc2V0U3RvcmFnZSB7XG4gIGNvbnN0IG1vZGUgPVxuICAgICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TVE9SQUdFKSB8fFxuICAgICdsb2NhbCdcbiAgaWYgKG1vZGUgPT09ICdzMycpIHtcbiAgICByZXR1cm4gbmV3IFMzQXNzZXRTdG9yYWdlKClcbiAgfVxuICByZXR1cm4gbmV3IExvY2FsRnNBc3NldFN0b3JhZ2UoKVxufVxuIiwgIi8qKiBQdXJlIGJsb2IgYmFja2VuZCBcdTIwMTQgbm8gREIuICovXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0U3RvcmFnZSB7XG4gIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD5cbiAgcmVhZChrZXk6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IG51bGw+XG4gIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cbiAgLyoqIE9wdGlvbmFsIHB1YmxpYy9zaWduZWQgVVJMIGZvciB0aGUga2V5LiAqL1xuICBwdWJsaWNVcmw/KGtleTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgQUxMT1dFRF9JTUFHRV9UWVBFUyA9IG5ldyBTZXQoW1xuICAnaW1hZ2UvanBlZycsXG4gICdpbWFnZS9wbmcnLFxuICAnaW1hZ2Uvd2VicCcsXG5dKVxuXG5leHBvcnQgY29uc3QgTUFYX0FTU0VUX0JZVEVTID0gMiAqIDEwMjQgKiAxMDI0IC8vIDIgTUJcblxuZXhwb3J0IGZ1bmN0aW9uIGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlKGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgY2FzZSAnaW1hZ2UvanBlZyc6XG4gICAgICByZXR1cm4gJ2pwZydcbiAgICBjYXNlICdpbWFnZS9wbmcnOlxuICAgICAgcmV0dXJuICdwbmcnXG4gICAgY2FzZSAnaW1hZ2Uvd2VicCc6XG4gICAgICByZXR1cm4gJ3dlYnAnXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAnYmluJ1xuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBBc3NldCwgRGF0YWJhc2UsIE5ld0Fzc2V0IH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgZGVmYXVsdEltYWdlSGFzaGluZ1NlcnZpY2UsXG4gIHR5cGUgSW1hZ2VIYXNoaW5nU2VydmljZSxcbn0gZnJvbSAnLi9oYXNoaW5nLnRzJ1xuaW1wb3J0IHsgY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudiB9IGZyb20gJy4vc3RvcmFnZS9zMy50cydcbmltcG9ydCB7XG4gIEFMTE9XRURfSU1BR0VfVFlQRVMsXG4gIGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlLFxuICBNQVhfQVNTRVRfQllURVMsXG4gIHR5cGUgQXNzZXRTdG9yYWdlLFxufSBmcm9tICcuL3N0b3JhZ2UvdHlwZXMudHMnXG5cbmV4cG9ydCB0eXBlIEFzc2V0UmVjb3JkID0gQXNzZXRcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldFJlcG9zaXRvcnkge1xuICBwdXQoaW5wdXQ6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGJ5dGVzOiBVaW50OEFycmF5XG4gICAgY29udGVudFR5cGU6IHN0cmluZ1xuICAgIGZpbGVuYW1lPzogc3RyaW5nXG4gIH0pOiBQcm9taXNlPEFzc2V0UmVjb3JkPlxuXG4gIGdldE1ldGFkYXRhKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxBc3NldFJlY29yZCB8IG51bGw+XG5cbiAgcmVhZEJ5dGVzKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGJ5dGVzOiBVaW50OEFycmF5OyBjb250ZW50VHlwZTogc3RyaW5nIH0gfCBudWxsPlxuXG4gIHJlbGVhc2UoYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD5cbiAgcmV0YWluKGFzc2V0SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+XG4gIHB1cmdlSWZPcnBoYW4oYXNzZXRJZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPlxuXG4gIGxpc3RSZWNlbnQodXNlcklkOiBudW1iZXIsIGxpbWl0PzogbnVtYmVyKTogUHJvbWlzZTxBc3NldFJlY29yZFtdPlxufVxuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGNsYXNzIERiQXNzZXRSZXBvc2l0b3J5IGltcGxlbWVudHMgQXNzZXRSZXBvc2l0b3J5IHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBkYjogRGJMaWtlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RvcmFnZTogQXNzZXRTdG9yYWdlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgaGFzaGluZzogSW1hZ2VIYXNoaW5nU2VydmljZSA9IGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlLFxuICApIHt9XG5cbiAgYXN5bmMgcHV0KGlucHV0OiB7XG4gICAgdXNlcklkOiBudW1iZXJcbiAgICBieXRlczogVWludDhBcnJheVxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmdcbiAgICBmaWxlbmFtZT86IHN0cmluZ1xuICB9KTogUHJvbWlzZTxBc3NldFJlY29yZD4ge1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gaW5wdXQuY29udGVudFR5cGUudG9Mb3dlckNhc2UoKS5zcGxpdCgnOycpWzBdLnRyaW0oKVxuICAgIGlmICghQUxMT1dFRF9JTUFHRV9UWVBFUy5oYXMoY29udGVudFR5cGUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXNzZXRWYWxpZGF0aW9uRXJyb3IoXG4gICAgICAgIGB1bnN1cHBvcnRlZCBjb250ZW50IHR5cGU6ICR7Y29udGVudFR5cGV9YCxcbiAgICAgICAgNDE1LFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoaW5wdXQuYnl0ZXMuYnl0ZUxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKCdlbXB0eSBmaWxlJywgNDAwKVxuICAgIH1cbiAgICBpZiAoaW5wdXQuYnl0ZXMuYnl0ZUxlbmd0aCA+IE1BWF9BU1NFVF9CWVRFUykge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKCdmaWxlIHRvbyBsYXJnZScsIDQxMylcbiAgICB9XG5cbiAgICBjb25zdCBzaGEyNTYgPSBhd2FpdCB0aGlzLmhhc2hpbmcuc2hhMjU2KGlucHV0LmJ5dGVzKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIGlucHV0LnVzZXJJZClcbiAgICAgIC53aGVyZSgnc2hhMjU2JywgJz0nLCBzaGEyNTYpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIC8vIERlZHVwIGhpdDogcmV0dXJuIGV4aXN0aW5nIG1ldGFkYXRhLiBDYWxsZXJzIHJldGFpbigpIG9uIGF0dGFjaC5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHJldHVybiBleGlzdGluZ1xuICAgIH1cblxuICAgIGNvbnN0IGV4dCA9IGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlKGNvbnRlbnRUeXBlKVxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSBgJHtpbnB1dC51c2VySWR9LyR7c2hhMjU2fS4ke2V4dH1gXG4gICAgYXdhaXQgdGhpcy5zdG9yYWdlLndyaXRlKHN0b3JhZ2VLZXksIGlucHV0LmJ5dGVzLCBjb250ZW50VHlwZSlcblxuICAgIC8vIE5ldyBibG9icyBzdGFydCBhdCByZWZfY291bnQgMDsgY2FsbGVycyByZXRhaW4oKSB3aGVuIGF0dGFjaGluZy5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgICAgLmluc2VydEludG8oJ2Fzc2V0cycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IGlucHV0LnVzZXJJZCxcbiAgICAgICAgICBzaGEyNTYsXG4gICAgICAgICAgY29udGVudF90eXBlOiBjb250ZW50VHlwZSxcbiAgICAgICAgICBieXRlX3NpemU6IGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGgsXG4gICAgICAgICAgc3RvcmFnZV9rZXk6IHN0b3JhZ2VLZXksXG4gICAgICAgICAgcmVmX2NvdW50OiAwLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvcnBoYW5lZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0Fzc2V0KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5kZWxldGUoc3RvcmFnZUtleSlcbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldE1ldGFkYXRhKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxBc3NldFJlY29yZCB8IG51bGw+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbFxuICB9XG5cbiAgYXN5bmMgcmVhZEJ5dGVzKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGJ5dGVzOiBVaW50OEFycmF5OyBjb250ZW50VHlwZTogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgY29uc3QgbWV0YSA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghbWV0YSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuc3RvcmFnZS5yZWFkKG1ldGEuc3RvcmFnZV9rZXkpXG4gICAgaWYgKCFieXRlcykgcmV0dXJuIG51bGxcbiAgICByZXR1cm4geyBieXRlcywgY29udGVudFR5cGU6IG1ldGEuY29udGVudF90eXBlIH1cbiAgfVxuXG4gIGFzeW5jIHJldGFpbihhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5nZXRNZXRhZGF0YShhc3NldElkLCB1c2VySWQpXG4gICAgaWYgKCFyb3cpIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignYXNzZXQgbm90IGZvdW5kJywgNDA0KVxuICAgIGF3YWl0IHRoaXMuZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYXNzZXRzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICByZWZfY291bnQ6IHJvdy5yZWZfY291bnQgKyAxLFxuICAgICAgICBvcnBoYW5lZF9hdDogbnVsbCxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG5cbiAgYXN5bmMgcmVsZWFzZShhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5nZXRNZXRhZGF0YShhc3NldElkLCB1c2VySWQpXG4gICAgaWYgKCFyb3cpIHJldHVyblxuICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCByb3cucmVmX2NvdW50IC0gMSlcbiAgICBhd2FpdCB0aGlzLmRiXG4gICAgICAudXBkYXRlVGFibGUoJ2Fzc2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgcmVmX2NvdW50OiBuZXh0LFxuICAgICAgICBvcnBoYW5lZF9hdDogbmV4dCA9PT0gMCA/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC5leGVjdXRlKClcbiAgICBpZiAobmV4dCA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5wdXJnZUlmT3JwaGFuKGFzc2V0SWQpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHVyZ2VJZk9ycGhhbihhc3NldElkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByb3cgPSBhd2FpdCB0aGlzLmRiXG4gICAgICAuc2VsZWN0RnJvbSgnYXNzZXRzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdyB8fCByb3cucmVmX2NvdW50ID4gMCkgcmV0dXJuIGZhbHNlXG4gICAgYXdhaXQgdGhpcy5zdG9yYWdlLmRlbGV0ZShyb3cuc3RvcmFnZV9rZXkpXG4gICAgYXdhaXQgdGhpcy5kYi5kZWxldGVGcm9tKCdhc3NldHMnKS53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpLmV4ZWN1dGUoKVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBhc3luYyBsaXN0UmVjZW50KHVzZXJJZDogbnVtYmVyLCBsaW1pdCA9IDIwKTogUHJvbWlzZTxBc3NldFJlY29yZFtdPiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3JlZl9jb3VudCcsICc+JywgMClcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEFzc2V0VmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgc3RhdHVzOiBudW1iZXIsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0Fzc2V0VmFsaWRhdGlvbkVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KFxuICBkYjogRGJMaWtlLFxuKTogRGJBc3NldFJlcG9zaXRvcnkge1xuICBjb25zdCBzdG9yYWdlID0gY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudigpXG4gIHJldHVybiBuZXcgRGJBc3NldFJlcG9zaXRvcnkoZGIsIHN0b3JhZ2UpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc3NldFB1YmxpY1BhdGgoYXNzZXRJZDogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAvYXNzZXRzLyR7YXNzZXRJZH1gXG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuLy8gUHlsb24gc2VydmVzIHRoZSBidWlsdCBhcHAgd2l0aCBCdW4vTm9kZSBcdTIwMTQgdXNlIHByb2Nlc3MuZW52LCBub3QgRGVuby5lbnYuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJyxcbiAgICAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7QUFp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SUFDdEQ7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQLGdCQUFnQjtBQUFBLE1BQ2hCLCtCQUErQjtBQUFBLElBQ2pDO0FBQUEsRUFDRixDQUFDO0FBQ0g7QUFFTyxJQUFNLFVBQVU7QUFBQSxFQUNyQixHQUFHO0FBQ0w7QUFFQSxJQUFPLGNBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJkYiIsICJpbnZlbnRvcnkiLCAiY29uZmlnIiwgImRiIiwgImNvbmZpZyIsICJkYiIsICJkYiIsICJnZXRDb250ZXh0IiwgImNvbmZpZyIsICJkYiIsICJncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzIiwgImNvbmZpZyIsICJyZXN1bHQiLCAicGFyc2VKc29uIiwgImRiIiwgImRlYWRsaW5lIiwgInN0YXRlIiwgImdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MiLCAicGFyc2VKc29uIiwgImNvbmZpZyIsICJjeWNsZSIsICJyZXN1bHQiLCAiZ2V0Q29udGV4dCIsICJkYiIsICJyZXF1aXJlVXNlcklkIiwgImdldENvbnRleHQiLCAicGFyc2VDb25maWciLCAiYnVpbGRSZXdhcmROdWRnZXMiLCAiY29uZmlnIiwgInJlc3VsdCIsICJyZXF1aXJlVXNlcklkIiwgImdldENvbnRleHQiLCAicGFyc2VDb25maWciLCAiY29uZmlnIiwgInJlc3VsdCIsICJhY3Rpdml0eSIsICJjb21wbGV0aW9uIiwgInJlc3VsdCJdCn0K
