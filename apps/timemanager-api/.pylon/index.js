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

// src/db/ssl.ts
function sslForDatabaseUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return void 0;
  }
  const mode = url.searchParams.get("sslmode")?.toLowerCase();
  if (mode === "disable") return false;
  if (mode === "require" || mode === "verify-ca" || mode === "verify-full") {
    return { rejectUnauthorized: false };
  }
  const host = url.hostname;
  if (host === "localhost" || host === "127.0.0.1") return void 0;
  return { rejectUnauthorized: false };
}

// src/db/database.ts
types.setTypeParser(types.builtins.DATE, (value) => value);
function env(name) {
  if (typeof process !== "undefined" && process.env?.[name]) {
    return process.env[name];
  }
  try {
    return Deno.env.get(name);
  } catch {
    return void 0;
  }
}
function poolConfigFromEnv() {
  const databaseUrl = env("DATABASE_URL");
  if (databaseUrl) {
    const ssl = sslForDatabaseUrl(databaseUrl);
    return {
      connectionString: databaseUrl,
      max: 10,
      ...ssl === void 0 ? {} : { ssl }
    };
  }
  return {
    database: env("PGDATABASE") ?? "timemanager",
    host: env("PGHOST") ?? "localhost",
    user: env("PGUSER") ?? "postgres",
    password: env("PGPASSWORD") ?? "test1234",
    port: Number(env("PGPORT") ?? "5432"),
    max: 10
  };
}
var dialect = new PostgresDialect({
  pool: new Pool(poolConfigFromEnv())
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
  const env2 = typeof process !== "undefined" && process.env?.ASSETS_DIR || null;
  if (env2) return env2;
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
app.use(async (ctx, next) => {
  const path = new URL(ctx.req.url).pathname;
  if (path === "/health" && ctx.req.method === "GET") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });
  }
  await next();
});
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
  if (path === "/health" || path !== "/graphql" && !path.endsWith("/graphql")) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3Jld2FyZHMvaW52ZW50b3J5LnRzIiwgIi4uL3NyYy9yZXdhcmRzL3J1bGVzL2V2YWx1YXRlLnRzIiwgIi4uL3NyYy9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMiLCAiLi4vc3JjL3Jld2FyZHMvc291cmNlcy9pbmRleC50cyIsICIuLi9zcmMvcmV3YXJkcy9ob29rcy50cyIsICIuLi9zcmMvcmV3YXJkcy9udWRnZXMudHMiLCAiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2RiL3NzbC50cyIsICIuLi9zcmMvZ29hbHMvbGlmZWN5Y2xlLnRzIiwgIi4uL3NyYy9nb2Fscy9ldmFsdWF0b3JzL2luZGV4LnRzIiwgIi4uL3NyYy9nb2Fscy9wcm9ncmVzcy50cyIsICIuLi9zcmMvZ3JhcGhxbC9ncm91cF9wYWxldHRlLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3ZhbGlkYXRpb24udHMiLCAiLi4vc3JjL2dyYXBocWwvbm90aWZpY2F0aW9uX29mZnNldHMudHMiLCAiLi4vc3JjL2dyYXBocWwvbnVtZXJpYy50cyIsICIuLi9zcmMvZ3JhcGhxbC9yZXNvbHZlcnMvZ29hbHNfcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9nb2Fscy9jeWNsZXMudHMiLCAiLi4vc3JjL2dvYWxzL251ZGdlcy50cyIsICIuLi9zcmMvZ3JhcGhxbC9yZXNvbHZlcnMvcmV3YXJkc19yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2Fzc2V0cy9oYXNoaW5nLnRzIiwgIi4uL3NyYy9hc3NldHMvc3RvcmFnZS9sb2NhbF9mcy50cyIsICIuLi9zcmMvYXNzZXRzL3N0b3JhZ2UvczMudHMiLCAiLi4vc3JjL2Fzc2V0cy9zdG9yYWdlL3R5cGVzLnRzIiwgIi4uL3NyYy9hc3NldHMvcmVwb3NpdG9yeS50cyIsICIuLi9zcmMvYXV0aC92ZXJpZnkudHMiLCAiLi4vc3JjL2RiL3VzZXJzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBOZXdSZXdhcmRJbnZlbnRvcnksXG4gIE5ld1Jld2FyZFRyYW5zYWN0aW9uLFxuICBSZXdhcmREZWZpbml0aW9uLFxuICBSZXdhcmRJbnZlbnRvcnksXG4gIFJld2FyZFRyYW5zYWN0aW9uLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgdHlwZSB7IEdyYW50SW5zdHJ1Y3Rpb24gfSBmcm9tICcuL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBJbnZlbnRvcnlNYW5hZ2VyIHtcbiAgYXBwbHlFYXJuKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24sXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlEaXNjYXJkKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlSZXN0b3JlKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbnN1bWVUcmFuc2FjdGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgcmV2b2tlVW5jb25zdW1lZEZvckNvbXBsZXRpb24oXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29tcGxldGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8bnVtYmVyPlxufVxuXG5mdW5jdGlvbiBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgZGVmaW5pdGlvbl9uYW1lOiBkZWZpbml0aW9uLm5hbWUsXG4gICAgZGVmaW5pdGlvbl9jb2xvcjogZGVmaW5pdGlvbi5jb2xvcixcbiAgICBkZWZpbml0aW9uX2ljb246IGRlZmluaXRpb24uaWNvbixcbiAgICBpbWFnZV9hc3NldF9pZDogZGVmaW5pdGlvbi5pbWFnZV9hc3NldF9pZCxcbiAgfVxufVxuXG5mdW5jdGlvbiBuZXdTdGFja0tleSgpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLnJhbmRvbVVVSUQoKVxufVxuXG5leHBvcnQgY2xhc3MgRGJJbnZlbnRvcnlNYW5hZ2VyIGltcGxlbWVudHMgSW52ZW50b3J5TWFuYWdlciB7XG4gIGFzeW5jIGFwcGx5RWFybihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uLFxuICAgIGluc3RydWN0aW9uOiBHcmFudEluc3RydWN0aW9uLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnk7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgc25hcCA9IHNuYXBzaG90RmllbGRzKGRlZmluaXRpb24pXG5cbiAgICBsZXQgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgZGVmaW5pdGlvbi5pZClcbiAgICAgICAgLndoZXJlKCdzdGFja19rZXknLCAnaXMnLCBudWxsKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHF1YW50aXR5OiBleGlzdGluZy5xdWFudGl0eSArIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICAgIHF1YW50aXR5OiBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbnVsbCxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb24tc3RhY2thYmxlOiBvbmUgcm93IHBlciBncmFudGVkIHVuaXQgKHF1YW50aXR5IGFsd2F5cyAxIHBlciByb3cpLlxuICAgICAgLy8gSWYgaW5zdHJ1Y3Rpb24ucXVhbnRpdHkgPiAxLCBjcmVhdGUgbXVsdGlwbGUgcm93czsgcmV0dXJuIHRoZSBsYXN0LlxuICAgICAgbGV0IGxhc3QhOiBSZXdhcmRJbnZlbnRvcnlcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaW5zdHJ1Y3Rpb24ucXVhbnRpdHk7IGkrKykge1xuICAgICAgICBsYXN0ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgICAgaW52ZW50b3J5ID0gbGFzdFxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAnZWFybicsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogaW5zdHJ1Y3Rpb24uc291cmNlVHlwZSxcbiAgICAgICAgc291cmNlX2lkOiBpbnN0cnVjdGlvbi5zb3VyY2VJZCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IGluc3RydWN0aW9uLnRyaWdnZXJLZXksXG4gICAgICAgIHJ1bGVfaWQ6IGluc3RydWN0aW9uLnJ1bGVJZCxcbiAgICAgICAgYWN0aXZpdHlfaWQ6IGluc3RydWN0aW9uLmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICAgICAgZ29hbF9pZDogaW5zdHJ1Y3Rpb24uZ29hbElkID8/IG51bGwsXG4gICAgICAgIGNvbXBsZXRpb25faWQ6IGluc3RydWN0aW9uLmNvbXBsZXRpb25JZCA/PyBudWxsLFxuICAgICAgICBjeWNsZV9pZDogaW5zdHJ1Y3Rpb24uY3ljbGVJZCA/PyBudWxsLFxuICAgICAgICBub3RlOiBudWxsLFxuICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRUcmFuc2FjdGlvbilcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWNyZW1lbnQoXG4gICAgICB0cngsXG4gICAgICB1c2VySWQsXG4gICAgICBpbnZlbnRvcnlJZCxcbiAgICAgIHF1YW50aXR5LFxuICAgICAgJ2NvbnN1bWUnLFxuICAgICAgbm90ZSA/PyBudWxsLFxuICAgIClcbiAgfVxuXG4gIGFzeW5jIGFwcGx5RGlzY2FyZChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgaW52ZW50b3J5SWQsXG4gICAgICBxdWFudGl0eSxcbiAgICAgICdkZWxldGUnLFxuICAgICAgbnVsbCxcbiAgICApXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGRlY3JlbWVudChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICAgdHlwZTogJ2NvbnN1bWUnIHwgJ2RlbGV0ZScsXG4gICAgbm90ZTogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICBpZiAocXVhbnRpdHkgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ3F1YW50aXR5IG11c3QgYmUgPj0gMScpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnZlbnRvcnlJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnZlbnRvcnkgaXRlbSBub3QgZm91bmQnKVxuICAgIGlmIChyb3cucXVhbnRpdHkgPCBxdWFudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnN1ZmZpY2llbnQgcXVhbnRpdHknKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBjb25zdCBzbmFwID0gZGVmaW5pdGlvblxuICAgICAgPyBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uKVxuICAgICAgOiB7XG4gICAgICAgICAgZGVmaW5pdGlvbl9uYW1lOiAnVW5rbm93biByZXdhcmQnLFxuICAgICAgICAgIGRlZmluaXRpb25fY29sb3I6ICcjNjQ3NDhCJyxcbiAgICAgICAgICBkZWZpbml0aW9uX2ljb246IG51bGwgYXMgc3RyaW5nIHwgbnVsbCxcbiAgICAgICAgICBpbWFnZV9hc3NldF9pZDogbnVsbCBhcyBudW1iZXIgfCBudWxsLFxuICAgICAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByZW1haW5pbmcgPSByb3cucXVhbnRpdHkgLSBxdWFudGl0eVxuICAgIGxldCBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGxcblxuICAgIGlmIChyZW1haW5pbmcgPT09IDApIHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIHJvdy5pZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgaW52ZW50b3J5ID0gbnVsbFxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLnNldCh7IHF1YW50aXR5OiByZW1haW5pbmcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogcm93LnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IHJlbWFpbmluZyA9PT0gMCA/IG51bGwgOiByb3cuaWQsXG4gICAgICAgIHF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogJ21hbnVhbCcsXG4gICAgICAgIHNvdXJjZV9pZDogbnVsbCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IG51bGwsXG4gICAgICAgIHJ1bGVfaWQ6IG51bGwsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBudWxsLFxuICAgICAgICBnb2FsX2lkOiBudWxsLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBudWxsLFxuICAgICAgICBjeWNsZV9pZDogbnVsbCxcbiAgICAgICAgbm90ZSxcbiAgICAgICAgbWV0YWRhdGE6IHJlbWFpbmluZyA9PT0gMFxuICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBjbGVhcmVkX2ludmVudG9yeV9pZDogcm93LmlkIH0pXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICBhc3luYyBhcHBseVJlc3RvcmUoXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29uc3VtZVRyYW5zYWN0aW9uSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5OyB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfT4ge1xuICAgIGNvbnN0IGNvbnN1bWVUeCA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVRyYW5zYWN0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2NvbnN1bWUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIWNvbnN1bWVUeCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdjb25zdW1lIHRyYW5zYWN0aW9uIG5vdCBmb3VuZCcpXG4gICAgaWYgKGNvbnN1bWVUeC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ2Nhbm5vdCByZXN0b3JlOiBkZWZpbml0aW9uIG1pc3NpbmcnKVxuICAgIH1cblxuICAgIC8vIFByZXZlbnQgZG91YmxlLXJlc3RvcmUuXG4gICAgY29uc3QgYWxyZWFkeSA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdyZXN0b3JlJylcbiAgICAgIC53aGVyZSgnbWV0YWRhdGEnLCAnaXMgbm90JywgbnVsbClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVzdG9yZWQgPSBhbHJlYWR5LnNvbWUoKHQpID0+IHtcbiAgICAgIGNvbnN0IG1ldGEgPVxuICAgICAgICB0eXBlb2YgdC5tZXRhZGF0YSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UodC5tZXRhZGF0YSlcbiAgICAgICAgICA6IHQubWV0YWRhdGFcbiAgICAgIHJldHVybiBtZXRhICYmIG1ldGEucmVzdG9yZWRfZnJvbSA9PT0gY29uc3VtZVRyYW5zYWN0aW9uSWRcbiAgICB9KVxuICAgIGlmIChyZXN0b3JlZCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdhbHJlYWR5IHJlc3RvcmVkJylcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVR4LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgY29uc3QgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24gPSB7XG4gICAgICBydWxlSWQ6IG51bGwsXG4gICAgICBkZWZpbml0aW9uSWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICBxdWFudGl0eTogY29uc3VtZVR4LnF1YW50aXR5LFxuICAgICAgdHJpZ2dlcktleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgc291cmNlVHlwZTogJ21hbnVhbCcsXG4gICAgICBzb3VyY2VJZDogMCxcbiAgICB9XG5cbiAgICAvLyBSZS1hcHBseSBhcyBlYXJuLWxpa2UgaW52ZW50b3J5IGJ1bXAsIHRoZW4gd3JpdGUgcmVzdG9yZSB0eC5cbiAgICBjb25zdCB7IGludmVudG9yeSB9ID0gYXdhaXQgdGhpcy5hcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgIClcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAncmVzdG9yZScsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGNvbnN1bWVUeC5xdWFudGl0eSxcbiAgICAgICAgLi4uc25hcHNob3RGaWVsZHMoZGVmaW5pdGlvbiksXG4gICAgICAgIHNvdXJjZV90eXBlOiAnbWFudWFsJyxcbiAgICAgICAgc291cmNlX2lkOiBudWxsLFxuICAgICAgICB0cmlnZ2VyX2tleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgICBydWxlX2lkOiBudWxsLFxuICAgICAgICBhY3Rpdml0eV9pZDogbnVsbCxcbiAgICAgICAgZ29hbF9pZDogbnVsbCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgY3ljbGVfaWQ6IG51bGwsXG4gICAgICAgIG5vdGU6IG51bGwsXG4gICAgICAgIG1ldGFkYXRhOiBKU09OLnN0cmluZ2lmeSh7IHJlc3RvcmVkX2Zyb206IGNvbnN1bWVUcmFuc2FjdGlvbklkIH0pLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICAvKiogSW52ZW50b3J5IGJ1bXAgd2l0aG91dCB3cml0aW5nIGFuIGVhcm4gbGVkZ2VyIHJvdyAodXNlZCBieSByZXN0b3JlKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyBhcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IH0+IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBpZiAoZGVmaW5pdGlvbi5zdGFja2FibGUpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGRlZmluaXRpb24uaWQpXG4gICAgICAgIC53aGVyZSgnc3RhY2tfa2V5JywgJ2lzJywgbnVsbClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICBxdWFudGl0eTogZXhpc3RpbmcucXVhbnRpdHkgKyBxdWFudGl0eSxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICBxdWFudGl0eSxcbiAgICAgICAgICBzdGFja19rZXk6IG51bGwsXG4gICAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgfVxuXG4gICAgY29uc3QgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgcXVhbnRpdHk6IDEsXG4gICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlIHVuY29uc3VtZWQgcG9ydGlvbiBvZiBlYXJucyB0aWVkIHRvIGEgY29tcGxldGlvbi5cbiAgICogTmV2ZXIgZHJpdmVzIGludmVudG9yeSBuZWdhdGl2ZS5cbiAgICovXG4gIGFzeW5jIHJldm9rZVVuY29uc3VtZWRGb3JDb21wbGV0aW9uKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyLFxuICApOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdjb21wbGV0aW9uX2lkJywgJz0nLCBjb21wbGV0aW9uSWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGxldCByZXZva2VkID0gMFxuICAgIGZvciAoY29uc3QgZWFybiBvZiBlYXJucykge1xuICAgICAgaWYgKGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQgPT0gbnVsbCkgY29udGludWVcblxuICAgICAgY29uc3QgaW52ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGludi5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnF1YW50aXR5LCAwKVxuICAgICAgY29uc3QgdG9SZXZva2UgPSBNYXRoLm1pbihlYXJuLnF1YW50aXR5LCBhdmFpbGFibGUpXG4gICAgICBpZiAodG9SZXZva2UgPD0gMCkgY29udGludWVcblxuICAgICAgbGV0IHJlbWFpbmluZyA9IHRvUmV2b2tlXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiBpbnYpIHtcbiAgICAgICAgaWYgKHJlbWFpbmluZyA8PSAwKSBicmVha1xuICAgICAgICBjb25zdCB0YWtlID0gTWF0aC5taW4ocm93LnF1YW50aXR5LCByZW1haW5pbmcpXG4gICAgICAgIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgcm93LmlkLFxuICAgICAgICAgIHRha2UsXG4gICAgICAgICAgJ2RlbGV0ZScsXG4gICAgICAgICAgYHJldm9rZWQ6Y29tcGxldGlvbjoke2NvbXBsZXRpb25JZH1gLFxuICAgICAgICApXG4gICAgICAgIHJlbWFpbmluZyAtPSB0YWtlXG4gICAgICAgIHJldm9rZWQgKz0gdGFrZVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV2b2tlZFxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZlbnRvcnlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52ZW50b3J5RXJyb3InXG4gIH1cbn1cblxuLyoqIFJlYnVpbGQgaW52ZW50b3J5IHF1YW50aXRpZXMgZnJvbSB0aGUgbGVkZ2VyIChyZXBhaXIpLiBEb2VzIG5vdCB3cml0ZSBsZWRnZXIgcm93cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVJbnZlbnRvcnlGcm9tTGVkZ2VyKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBkYlxuICAgIC5kZWxldGVGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgdHhzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnYXNjJylcbiAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgZGVmcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuICBjb25zdCBkZWZNYXAgPSBuZXcgTWFwKGRlZnMubWFwKChkKSA9PiBbZC5pZCwgZF0pKVxuXG4gIGNvbnN0IG5ldCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KClcbiAgY29uc3QgZmlyc3RFYXJuID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKVxuICBjb25zdCBsYXN0RWFybiA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KClcblxuICBmb3IgKGNvbnN0IHR4IG9mIHR4cykge1xuICAgIGlmICh0eC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZklkID0gdHgucmV3YXJkX2RlZmluaXRpb25faWRcbiAgICBjb25zdCBjdXIgPSBuZXQuZ2V0KGRlZklkKSA/PyAwXG4gICAgY29uc3QgY3JlYXRlZCA9XG4gICAgICB0eXBlb2YgdHguY3JlYXRlZF9hdCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyB0eC5jcmVhdGVkX2F0XG4gICAgICAgIDogbmV3IERhdGUodHguY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKHR4LnR5cGUgPT09ICdlYXJuJyB8fCB0eC50eXBlID09PSAncmVzdG9yZScpIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIGN1ciArIHR4LnF1YW50aXR5KVxuICAgICAgaWYgKCFmaXJzdEVhcm4uaGFzKGRlZklkKSkgZmlyc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICAgIGxhc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgdHgudHlwZSA9PT0gJ2NvbnN1bWUnIHx8XG4gICAgICB0eC50eXBlID09PSAnZGVsZXRlJyB8fFxuICAgICAgdHgudHlwZSA9PT0gJ2FkanVzdCdcbiAgICApIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIE1hdGgubWF4KDAsIGN1ciAtIHR4LnF1YW50aXR5KSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgZm9yIChjb25zdCBbZGVmSWQsIHF0eV0gb2YgbmV0KSB7XG4gICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBkZWZNYXAuZ2V0KGRlZklkKVxuICAgIGlmICghZGVmaW5pdGlvbikgY29udGludWVcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZklkLFxuICAgICAgICAgIHF1YW50aXR5OiBxdHksXG4gICAgICAgICAgc3RhY2tfa2V5OiBudWxsLFxuICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBsYXN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcXR5OyBpKyspIHtcbiAgICAgICAgYXdhaXQgZGJcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmSWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IGxhc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAgIC5leGVjdXRlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIFJld2FyZFJ1bGUsXG4gIFJld2FyZFJ1bGVDb25maWcsXG4gIFJld2FyZFJ1bGVNb2RlLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRDb250ZXh0IHtcbiAgdXNlcklkOiBudW1iZXJcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgdHJpZ2dlcktleTogc3RyaW5nXG4gIGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsXG4gIGdvYWxJZD86IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBjeWNsZUlkPzogbnVtYmVyIHwgbnVsbFxuICAvKiogUHJpb3IgZWFybiBjb3VudCBmb3IgdGhpcyBydWxlIChmb3Igb25jZSAvIG1heF9ncmFudHMpLiAqL1xuICBwcmlvckVhcm5Db3VudDogbnVtYmVyXG4gIC8qKiBJU08gdGltZXN0YW1wIG9mIGxhc3QgZWFybiBmb3IgdGhpcyBydWxlLCBpZiBhbnkuICovXG4gIGxhc3RFYXJuQXQ6IHN0cmluZyB8IG51bGxcbiAgbm93PzogRGF0ZVxuICAvKiogUk5HIGZvciBwcm9iYWJpbGl0eSAvIHJhbmRvbV9wb29sIChpbmplY3RhYmxlIGZvciB0ZXN0cykuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYW50SW5zdHJ1Y3Rpb24ge1xuICBydWxlSWQ6IG51bWJlciB8IG51bGxcbiAgZGVmaW5pdGlvbklkOiBudW1iZXJcbiAgcXVhbnRpdHk6IG51bWJlclxuICB0cmlnZ2VyS2V5OiBzdHJpbmdcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgYWN0aXZpdHlJZD86IG51bWJlciB8IG51bGxcbiAgZ29hbElkPzogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uSWQ/OiBudW1iZXIgfCBudWxsXG4gIGN5Y2xlSWQ/OiBudW1iZXIgfCBudWxsXG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKGNvbmZpZzogUmV3YXJkUnVsZVsnY29uZmlnJ10pOiBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgaWYgKGNvbmZpZyA9PSBudWxsKSByZXR1cm4ge31cbiAgaWYgKHR5cGVvZiBjb25maWcgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGNvbmZpZykgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiBjb25maWcgYXMgUmV3YXJkUnVsZUNvbmZpZ1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGEgc2luZ2xlIHJld2FyZCBydWxlIGFnYWluc3QgYSBncmFudCBjb250ZXh0LlxuICogUmV0dXJucyBudWxsIHdoZW4gdGhlIHJ1bGUgc2hvdWxkIG5vdCBncmFudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlUnVsZShcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4pOiBHcmFudEluc3RydWN0aW9uIHwgbnVsbCB7XG4gIGlmICghcnVsZS5lbmFibGVkKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHJ1bGUuY29uZmlnKVxuICBjb25zdCBub3cgPSBjdHgubm93ID8/IG5ldyBEYXRlKClcbiAgY29uc3QgcmFuZG9tID0gY3R4LnJhbmRvbSA/PyBNYXRoLnJhbmRvbVxuXG4gIGlmIChjb25maWcub25jZSAmJiBjdHgucHJpb3JFYXJuQ291bnQgPiAwKSByZXR1cm4gbnVsbFxuXG4gIGlmIChcbiAgICB0eXBlb2YgY29uZmlnLm1heF9ncmFudHNfdG90YWwgPT09ICdudW1iZXInICYmXG4gICAgY3R4LnByaW9yRWFybkNvdW50ID49IGNvbmZpZy5tYXhfZ3JhbnRzX3RvdGFsXG4gICkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBpZiAoXG4gICAgdHlwZW9mIGNvbmZpZy5jb29sZG93bl9ob3VycyA9PT0gJ251bWJlcicgJiZcbiAgICBjb25maWcuY29vbGRvd25faG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBjb25zdCBjb29sZG93bk1zID0gY29uZmlnLmNvb2xkb3duX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICBpZiAobm93LmdldFRpbWUoKSAtIGxhc3QgPCBjb29sZG93bk1zKSByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKFxuICAgIHR5cGVvZiBjb25maWcubWF4X2dyYW50c19wZXJfcGVyaW9kID09PSAnbnVtYmVyJyAmJlxuICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgIGNvbmZpZy5wZXJpb2RfaG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgLy8gTGlnaHR3ZWlnaHQgcGVyaW9kIGNoZWNrOiBpZiBsYXN0IGVhcm4gaXMgd2l0aGluIHBlcmlvZCBhbmQgd2UndmVcbiAgICAvLyBhbHJlYWR5IGhpdCB0aGUgY2FwIHZpYSBwcmlvckVhcm5Db3VudCBhcHByb3hpbWF0aW9uLCBza2lwLlxuICAgIC8vIEZ1bGwgcGVyaW9kIGNvdW50aW5nIGlzIGhhbmRsZWQgYnkgY2FsbGVycyB0aGF0IHNldCBwcmlvckVhcm5Db3VudFxuICAgIC8vIHRvIHRoZSBjb3VudCB3aXRoaW4gdGhlIHBlcmlvZCB3aW5kb3cgd2hlbiBwZXJpb2RfaG91cnMgaXMgc2V0LlxuICAgIGNvbnN0IHBlcmlvZE1zID0gY29uZmlnLnBlcmlvZF9ob3VycyAqIDYwICogNjAgKiAxMDAwXG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBpZiAoXG4gICAgICBub3cuZ2V0VGltZSgpIC0gbGFzdCA8IHBlcmlvZE1zICYmXG4gICAgICBjdHgucHJpb3JFYXJuQ291bnQgPj0gY29uZmlnLm1heF9ncmFudHNfcGVyX3BlcmlvZFxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cblxuICBjb25zdCBtb2RlID0gcnVsZS5tb2RlIGFzIFJld2FyZFJ1bGVNb2RlXG5cbiAgaWYgKG1vZGUgPT09ICdwcm9iYWJpbGl0eScpIHtcbiAgICBjb25zdCBwID1cbiAgICAgIHR5cGVvZiBjb25maWcucHJvYmFiaWxpdHkgPT09ICdudW1iZXInID8gY29uZmlnLnByb2JhYmlsaXR5IDogMVxuICAgIGlmIChyYW5kb20oKSA+IHApIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihydWxlLCBjdHgsIHJ1bGUucmV3YXJkX2RlZmluaXRpb25faWQsIHJ1bGUucXVhbnRpdHkpXG4gIH1cblxuICBpZiAobW9kZSA9PT0gJ3JhbmRvbV9wb29sJykge1xuICAgIGNvbnN0IHBvb2wgPSBjb25maWcucG9vbFxuICAgIGlmICghcG9vbCB8fCBwb29sLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB0b3RhbFdlaWdodCA9IHBvb2wucmVkdWNlKChzLCBlKSA9PiBzICsgKGUud2VpZ2h0ID8/IDEpLCAwKVxuICAgIGlmICh0b3RhbFdlaWdodCA8PSAwKSByZXR1cm4gbnVsbFxuICAgIGxldCByb2xsID0gcmFuZG9tKCkgKiB0b3RhbFdlaWdodFxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcG9vbCkge1xuICAgICAgcm9sbCAtPSBlbnRyeS53ZWlnaHQgPz8gMVxuICAgICAgaWYgKHJvbGwgPD0gMCkge1xuICAgICAgICByZXR1cm4gYmFzZUluc3RydWN0aW9uKFxuICAgICAgICAgIHJ1bGUsXG4gICAgICAgICAgY3R4LFxuICAgICAgICAgIGVudHJ5LmRlZmluaXRpb25faWQsXG4gICAgICAgICAgZW50cnkucXVhbnRpdHkgPz8gcnVsZS5xdWFudGl0eSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBsYXN0ID0gcG9vbFtwb29sLmxlbmd0aCAtIDFdXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihcbiAgICAgIHJ1bGUsXG4gICAgICBjdHgsXG4gICAgICBsYXN0LmRlZmluaXRpb25faWQsXG4gICAgICBsYXN0LnF1YW50aXR5ID8/IHJ1bGUucXVhbnRpdHksXG4gICAgKVxuICB9XG5cbiAgLy8gZml4ZWQgKGRlZmF1bHQpXG4gIHJldHVybiBiYXNlSW5zdHJ1Y3Rpb24oXG4gICAgcnVsZSxcbiAgICBjdHgsXG4gICAgcnVsZS5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICBydWxlLnF1YW50aXR5LFxuICApXG59XG5cbmZ1bmN0aW9uIGJhc2VJbnN0cnVjdGlvbihcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4gIGRlZmluaXRpb25JZDogbnVtYmVyLFxuICBxdWFudGl0eTogbnVtYmVyLFxuKTogR3JhbnRJbnN0cnVjdGlvbiB7XG4gIHJldHVybiB7XG4gICAgcnVsZUlkOiBydWxlLmlkLFxuICAgIGRlZmluaXRpb25JZCxcbiAgICBxdWFudGl0eTogTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihxdWFudGl0eSkpLFxuICAgIHRyaWdnZXJLZXk6IGN0eC50cmlnZ2VyS2V5LFxuICAgIHNvdXJjZVR5cGU6IGN0eC5zb3VyY2VUeXBlLFxuICAgIHNvdXJjZUlkOiBjdHguc291cmNlSWQsXG4gICAgYWN0aXZpdHlJZDogY3R4LmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICBnb2FsSWQ6IGN0eC5nb2FsSWQgPz8gbnVsbCxcbiAgICBjb21wbGV0aW9uSWQ6IGN0eC5jb21wbGV0aW9uSWQgPz8gbnVsbCxcbiAgICBjeWNsZUlkOiBjdHguY3ljbGVJZCA/PyBudWxsLFxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgUmV3YXJkRGVmaW5pdGlvbixcbiAgUmV3YXJkUnVsZSxcbiAgUmV3YXJkVHJhbnNhY3Rpb24sXG59IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbiAgdHlwZSBJbnZlbnRvcnlNYW5hZ2VyLFxufSBmcm9tICcuL2ludmVudG9yeS50cydcbmltcG9ydCB7XG4gIGV2YWx1YXRlUnVsZSxcbiAgdHlwZSBHcmFudENvbnRleHQsXG4gIHR5cGUgR3JhbnRJbnN0cnVjdGlvbixcbn0gZnJvbSAnLi9ydWxlcy9ldmFsdWF0ZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRSZXN1bHQge1xuICBpbnN0cnVjdGlvbjogR3JhbnRJbnN0cnVjdGlvblxuICB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfCBudWxsXG4gIHNraXBwZWQ6IGJvb2xlYW5cbiAgcmVhc29uPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkR3JhbnRTZXJ2aWNlIHtcbiAgZ3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSxcbiAgKTogUHJvbWlzZTxHcmFudFJlc3VsdFtdPlxuXG4gIGNvbGxlY3RBbmRHcmFudChcbiAgICBkYjogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIHJ1bGVzOiBSZXdhcmRSdWxlW10sXG4gICAgYmFzZUN0eDogT21pdDxHcmFudENvbnRleHQsICdwcmlvckVhcm5Db3VudCcgfCAnbGFzdEVhcm5BdCcgfCAndXNlcklkJz4sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT5cbn1cblxuZXhwb3J0IGNsYXNzIERlZmF1bHRSZXdhcmRHcmFudFNlcnZpY2UgaW1wbGVtZW50cyBSZXdhcmRHcmFudFNlcnZpY2Uge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGludmVudG9yeTogSW52ZW50b3J5TWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKSxcbiAgKSB7fVxuXG4gIGFzeW5jIGdyYW50KFxuICAgIGRiOiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW5zdHJ1Y3Rpb25zOiBHcmFudEluc3RydWN0aW9uW10sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICAgIGNvbnN0IHJlc3VsdHM6IEdyYW50UmVzdWx0W10gPSBbXVxuXG4gICAgZm9yIChjb25zdCBpbnN0cnVjdGlvbiBvZiBpbnN0cnVjdGlvbnMpIHtcbiAgICAgIC8vIElkZW1wb3RlbmN5OiBza2lwIGlmIGVhcm4gYWxyZWFkeSBleGlzdHMuXG4gICAgICBsZXQgZXhpc3RpbmdRdWVyeSA9IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgICAud2hlcmUoJ3RyaWdnZXJfa2V5JywgJz0nLCBpbnN0cnVjdGlvbi50cmlnZ2VyS2V5KVxuXG4gICAgICBpZiAoaW5zdHJ1Y3Rpb24ucnVsZUlkICE9IG51bGwpIHtcbiAgICAgICAgZXhpc3RpbmdRdWVyeSA9IGV4aXN0aW5nUXVlcnkud2hlcmUoJ3J1bGVfaWQnLCAnPScsIGluc3RydWN0aW9uLnJ1bGVJZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4aXN0aW5nUXVlcnkgPSBleGlzdGluZ1F1ZXJ5LndoZXJlKCdydWxlX2lkJywgJ2lzJywgbnVsbClcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBleGlzdGluZ1F1ZXJ5LnNlbGVjdEFsbCgpLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICB0cmFuc2FjdGlvbjogZXhpc3RpbmcsXG4gICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICByZWFzb246ICdhbHJlYWR5X2dyYW50ZWQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGluc3RydWN0aW9uLmRlZmluaXRpb25JZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbikge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGluc3RydWN0aW9uLFxuICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgIHNraXBwZWQ6IHRydWUsXG4gICAgICAgICAgcmVhc29uOiAnZGVmaW5pdGlvbl9ub3RfZm91bmQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHRyYW5zYWN0aW9uIH0gPSBhd2FpdCB0aGlzLmludmVudG9yeS5hcHBseUVhcm4oXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICAgIGRlZmluaXRpb24gYXMgUmV3YXJkRGVmaW5pdGlvbixcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgKVxuICAgICAgICByZXN1bHRzLnB1c2goeyBpbnN0cnVjdGlvbiwgdHJhbnNhY3Rpb24sIHNraXBwZWQ6IGZhbHNlIH0pXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gVW5pcXVlIGNvbnN0cmFpbnQgcmFjZSBcdTIxOTIgdHJlYXQgYXMgYWxyZWFkeSBncmFudGVkLlxuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpXG4gICAgICAgIGlmIChcbiAgICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKCdyZXdhcmRfdHJhbnNhY3Rpb25zX2Vhcm5faWRlbXBvdGVuY3knKSB8fFxuICAgICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoJ3VuaXF1ZScpXG4gICAgICAgICkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYXNvbjogJ2FscmVhZHlfZ3JhbnRlZCcsXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICAgIHRocm93IGVyclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzXG4gIH1cblxuICBhc3luYyBjb2xsZWN0QW5kR3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBydWxlczogUmV3YXJkUnVsZVtdLFxuICAgIGJhc2VDdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnIHwgJ3VzZXJJZCc+LFxuICApOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgICBjb25zdCBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCd0eXBlJywgJz0nLCAnZWFybicpXG4gICAgICAgIC53aGVyZSgncnVsZV9pZCcsICc9JywgcnVsZS5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGNvbmZpZyA9XG4gICAgICAgIHR5cGVvZiBydWxlLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UocnVsZS5jb25maWcpXG4gICAgICAgICAgOiBydWxlLmNvbmZpZyA/PyB7fVxuXG4gICAgICBsZXQgcHJpb3JFYXJuQ291bnQgPSBlYXJucy5sZW5ndGhcbiAgICAgIGxldCBsYXN0RWFybkF0OiBzdHJpbmcgfCBudWxsID1cbiAgICAgICAgZWFybnNbMF0gIT0gbnVsbFxuICAgICAgICAgID8gdHlwZW9mIGVhcm5zWzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGVhcm5zWzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgIDogbmV3IERhdGUoZWFybnNbMF0uY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgIDogbnVsbFxuXG4gICAgICAvLyBXaGVuIHBlcmlvZF9ob3VycyBpcyBzZXQsIGNvdW50IG9ubHkgZWFybnMgaW5zaWRlIHRoZSB3aW5kb3cuXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgICAgICBjb25maWcucGVyaW9kX2hvdXJzID4gMFxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IGJhc2VDdHgubm93ID8/IG5ldyBEYXRlKClcbiAgICAgICAgY29uc3Qgd2luZG93TXMgPSBjb25maWcucGVyaW9kX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICAgICAgY29uc3QgaW5XaW5kb3cgPSBlYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICAgICAgICByZXR1cm4gbm93LmdldFRpbWUoKSAtIHQgPCB3aW5kb3dNc1xuICAgICAgICB9KVxuICAgICAgICBwcmlvckVhcm5Db3VudCA9IGluV2luZG93Lmxlbmd0aFxuICAgICAgICBsYXN0RWFybkF0ID1cbiAgICAgICAgICBpbldpbmRvd1swXSAhPSBudWxsXG4gICAgICAgICAgICA/IHR5cGVvZiBpbldpbmRvd1swXS5jcmVhdGVkX2F0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICA/IGluV2luZG93WzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgICAgOiBuZXcgRGF0ZShpbldpbmRvd1swXS5jcmVhdGVkX2F0KS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICA6IG51bGxcbiAgICAgIH1cblxuICAgICAgY29uc3QgY3R4OiBHcmFudENvbnRleHQgPSB7XG4gICAgICAgIC4uLmJhc2VDdHgsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgcHJpb3JFYXJuQ291bnQsXG4gICAgICAgIGxhc3RFYXJuQXQsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIGN0eClcbiAgICAgIGlmIChpbnN0cnVjdGlvbikgaW5zdHJ1Y3Rpb25zLnB1c2goaW5zdHJ1Y3Rpb24pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ3JhbnQoZGIsIHVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCByZXdhcmRHcmFudFNlcnZpY2UgPSBuZXcgRGVmYXVsdFJld2FyZEdyYW50U2VydmljZSgpXG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSwgUmV3YXJkUnVsZSB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRJbnN0cnVjdGlvbiB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuaW1wb3J0IHsgZXZhbHVhdGVSdWxlLCB0eXBlIEdyYW50Q29udGV4dCB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRTb3VyY2VBZGFwdGVyIHtcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIGNvbGxlY3RHcmFudHMoXG4gICAgZGI6IERiTGlrZSxcbiAgICBjdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnPixcbiAgKTogUHJvbWlzZTxHcmFudEluc3RydWN0aW9uW10+XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRSdWxlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIHNvdXJjZVR5cGU6IHN0cmluZyxcbiAgc291cmNlSWQ6IG51bWJlcixcbik6IFByb21pc2U8UmV3YXJkUnVsZVtdPiB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc291cmNlX3R5cGUnLCAnPScsIHNvdXJjZVR5cGUpXG4gICAgLndoZXJlKCdzb3VyY2VfaWQnLCAnPScsIHNvdXJjZUlkKVxuICAgIC53aGVyZSgnZW5hYmxlZCcsICc9JywgdHJ1ZSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVucmljaEFuZEV2YWx1YXRlKFxuICBkYjogRGJMaWtlLFxuICBydWxlczogUmV3YXJkUnVsZVtdLFxuICBiYXNlOiBPbWl0PEdyYW50Q29udGV4dCwgJ3ByaW9yRWFybkNvdW50JyB8ICdsYXN0RWFybkF0Jz4sXG4pOiBQcm9taXNlPEdyYW50SW5zdHJ1Y3Rpb25bXT4ge1xuICBjb25zdCBvdXQ6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGNvbnN0IGxhc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBiYXNlLnVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdydWxlX2lkJywgJz0nLCBydWxlLmlkKVxuICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIHtcbiAgICAgIC4uLmJhc2UsXG4gICAgICBwcmlvckVhcm5Db3VudDogbGFzdC5sZW5ndGgsXG4gICAgICBsYXN0RWFybkF0OlxuICAgICAgICBsYXN0WzBdICE9IG51bGxcbiAgICAgICAgICA/IHR5cGVvZiBsYXN0WzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGxhc3RbMF0uY3JlYXRlZF9hdFxuICAgICAgICAgICAgOiBuZXcgRGF0ZShsYXN0WzBdLmNyZWF0ZWRfYXQpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICA6IG51bGwsXG4gICAgfSlcbiAgICBpZiAoaW5zdHJ1Y3Rpb24pIG91dC5wdXNoKGluc3RydWN0aW9uKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5UmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnYWN0aXZpdHknLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhkYiwgY3R4LnVzZXJJZCwgJ2FjdGl2aXR5JywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdvYWxSZXdhcmRTb3VyY2U6IFJld2FyZFNvdXJjZUFkYXB0ZXIgPSB7XG4gIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgYXN5bmMgY29sbGVjdEdyYW50cyhkYiwgY3R4KSB7XG4gICAgY29uc3QgcnVsZXMgPSBhd2FpdCBsb2FkUnVsZXMoZGIsIGN0eC51c2VySWQsICdnb2FsJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogc3RyZWFrLWJhc2VkIGdyYW50cyAoUGhhc2UgMyBzdHViIFx1MjAxNCByZWdpc3RlciB3aGVuIHN0cmVhayBldmVudHMgZXhpc3QpLiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha1Jld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ3N0cmVhaycsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKGRiLCBjdHgudXNlcklkLCAnc3RyZWFrJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogZGFpbHkgY29tcGxldGlvbiBncmFudHMuICovXG5leHBvcnQgY29uc3QgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnZGFpbHlfY29tcGxldGlvbicsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKFxuICAgICAgZGIsXG4gICAgICBjdHgudXNlcklkLFxuICAgICAgJ2RhaWx5X2NvbXBsZXRpb24nLFxuICAgICAgY3R4LnNvdXJjZUlkLFxuICAgIClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbi8qKiBGdXR1cmU6IHdlZWtseSBjb21wbGV0aW9uIGdyYW50cy4gKi9cbmV4cG9ydCBjb25zdCB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnd2Vla2x5X2NvbXBsZXRpb24nLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhcbiAgICAgIGRiLFxuICAgICAgY3R4LnVzZXJJZCxcbiAgICAgICd3ZWVrbHlfY29tcGxldGlvbicsXG4gICAgICBjdHguc291cmNlSWQsXG4gICAgKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IFJFV0FSRF9TT1VSQ0VfQURBUFRFUlM6IFJld2FyZFNvdXJjZUFkYXB0ZXJbXSA9IFtcbiAgYWN0aXZpdHlSZXdhcmRTb3VyY2UsXG4gIGdvYWxSZXdhcmRTb3VyY2UsXG4gIHN0cmVha1Jld2FyZFNvdXJjZSxcbiAgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuICB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuXVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmV3YXJkU291cmNlQWRhcHRlcihcbiAgc291cmNlVHlwZTogc3RyaW5nLFxuKTogUmV3YXJkU291cmNlQWRhcHRlciB8IG51bGwge1xuICByZXR1cm4gKFxuICAgIFJFV0FSRF9TT1VSQ0VfQURBUFRFUlMuZmluZCgoYSkgPT4gYS5zb3VyY2VUeXBlID09PSBzb3VyY2VUeXBlKSA/PyBudWxsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgcmV3YXJkR3JhbnRTZXJ2aWNlIH0gZnJvbSAnLi9ncmFudF9zZXJ2aWNlLnRzJ1xuaW1wb3J0IHsgZ2V0UmV3YXJkU291cmNlQWRhcHRlciB9IGZyb20gJy4vc291cmNlcy9pbmRleC50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRSZXN1bHQgfSBmcm9tICcuL2dyYW50X3NlcnZpY2UudHMnXG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPlxuXG4vKiogR3JhbnQgcmV3YXJkcyBmb3IgYW4gYWN0aXZpdHkgY29tcGxldGlvbiAoaWRlbXBvdGVudCBwZXIgY29tcGxldGlvbitydWxlKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24oXG4gIGRiOiBEYkxpa2UsXG4gIG9wdHM6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGFjdGl2aXR5SWQ6IG51bWJlclxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyXG4gIH0sXG4pOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgY29uc3QgYWRhcHRlciA9IGdldFJld2FyZFNvdXJjZUFkYXB0ZXIoJ2FjdGl2aXR5JylcbiAgaWYgKCFhZGFwdGVyKSByZXR1cm4gW11cblxuICBjb25zdCB0cmlnZ2VyS2V5ID0gYGNvbXBsZXRpb246JHtvcHRzLmNvbXBsZXRpb25JZH1gXG4gIGNvbnN0IGluc3RydWN0aW9ucyA9IGF3YWl0IGFkYXB0ZXIuY29sbGVjdEdyYW50cyhkYiwge1xuICAgIHVzZXJJZDogb3B0cy51c2VySWQsXG4gICAgc291cmNlVHlwZTogJ2FjdGl2aXR5JyxcbiAgICBzb3VyY2VJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIHRyaWdnZXJLZXksXG4gICAgYWN0aXZpdHlJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIGNvbXBsZXRpb25JZDogb3B0cy5jb21wbGV0aW9uSWQsXG4gIH0pXG5cbiAgcmV0dXJuIGF3YWl0IHJld2FyZEdyYW50U2VydmljZS5ncmFudChkYiwgb3B0cy51c2VySWQsIGluc3RydWN0aW9ucylcbn1cblxuLyoqIEdyYW50IHJld2FyZHMgd2hlbiBhIGdvYWwgY3ljbGUgdHJhbnNpdGlvbnMgdG8gc3VjY2VlZGVkIChlZGdlLXRyaWdnZXJlZCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhcbiAgZGI6IERiTGlrZSxcbiAgb3B0czoge1xuICAgIHVzZXJJZDogbnVtYmVyXG4gICAgZ29hbElkOiBudW1iZXJcbiAgICBjeWNsZUlkOiBudW1iZXJcbiAgfSxcbik6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICBjb25zdCBhZGFwdGVyID0gZ2V0UmV3YXJkU291cmNlQWRhcHRlcignZ29hbCcpXG4gIGlmICghYWRhcHRlcikgcmV0dXJuIFtdXG5cbiAgY29uc3QgdHJpZ2dlcktleSA9IGBjeWNsZToke29wdHMuY3ljbGVJZH06c3VjY2VlZGVkYFxuICBjb25zdCBpbnN0cnVjdGlvbnMgPSBhd2FpdCBhZGFwdGVyLmNvbGxlY3RHcmFudHMoZGIsIHtcbiAgICB1c2VySWQ6IG9wdHMudXNlcklkLFxuICAgIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgICBzb3VyY2VJZDogb3B0cy5nb2FsSWQsXG4gICAgdHJpZ2dlcktleSxcbiAgICBnb2FsSWQ6IG9wdHMuZ29hbElkLFxuICAgIGN5Y2xlSWQ6IG9wdHMuY3ljbGVJZCxcbiAgfSlcblxuICByZXR1cm4gYXdhaXQgcmV3YXJkR3JhbnRTZXJ2aWNlLmdyYW50KGRiLCBvcHRzLnVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxufVxuIiwgImltcG9ydCB0eXBlIHsgUmV3YXJkSW52ZW50b3J5LCBSZXdhcmRUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgUmV3YXJkTnVkZ2VLaW5kID1cbiAgfCAnaW52ZW50b3J5X2F2YWlsYWJsZSdcbiAgfCAncmVjZW50bHlfZWFybmVkJ1xuICB8ICd1bmNvbnN1bWVkX3N0YWNrJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZE51ZGdlIHtcbiAga2luZDogUmV3YXJkTnVkZ2VLaW5kXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnc3VjY2VzcydcbiAgZGVmaW5pdGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBpbnZlbnRvcnlJZD86IG51bWJlciB8IG51bGxcbn1cblxuLyoqXG4gKiBCdWlsZCBsaWdodHdlaWdodCByZXdhcmQgbnVkZ2VzIGZvciB0aGUgT3ZlcnZpZXcgc3VyZmFjZS5cbiAqIFB1cmUgXHUyMDE0IG5vIEkvTy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmV3YXJkTnVkZ2VzKGlucHV0OiB7XG4gIGludmVudG9yeTogQXJyYXk8XG4gICAgUGljazxSZXdhcmRJbnZlbnRvcnksICdpZCcgfCAncXVhbnRpdHknIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJz4gJiB7XG4gICAgICBuYW1lPzogc3RyaW5nXG4gICAgfVxuICA+XG4gIHJlY2VudEVhcm5zOiBBcnJheTxcbiAgICBQaWNrPFxuICAgICAgUmV3YXJkVHJhbnNhY3Rpb24sXG4gICAgICAnaWQnIHwgJ2RlZmluaXRpb25fbmFtZScgfCAncXVhbnRpdHknIHwgJ2NyZWF0ZWRfYXQnIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJ1xuICAgID5cbiAgPlxuICBub3c/OiBEYXRlXG59KTogUmV3YXJkTnVkZ2VbXSB7XG4gIGNvbnN0IG51ZGdlczogUmV3YXJkTnVkZ2VbXSA9IFtdXG4gIGNvbnN0IG5vdyA9IGlucHV0Lm5vdyA/PyBuZXcgRGF0ZSgpXG5cbiAgY29uc3QgdG90YWxRdHkgPSBpbnB1dC5pbnZlbnRvcnkucmVkdWNlKChzLCBpKSA9PiBzICsgaS5xdWFudGl0eSwgMClcbiAgaWYgKHRvdGFsUXR5ID4gMCkge1xuICAgIGNvbnN0IHRvcCA9IFsuLi5pbnB1dC5pbnZlbnRvcnldLnNvcnQoKGEsIGIpID0+IGIucXVhbnRpdHkgLSBhLnF1YW50aXR5KVswXVxuICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdpbnZlbnRvcnlfYXZhaWxhYmxlJyxcbiAgICAgIHRpdGxlOiAnUmV3YXJkcyByZWFkeScsXG4gICAgICBtZXNzYWdlOlxuICAgICAgICB0b3RhbFF0eSA9PT0gMVxuICAgICAgICAgID8gJ1lvdSBoYXZlIDEgcmV3YXJkIHdhaXRpbmcgdG8gYmUgZW5qb3llZC4nXG4gICAgICAgICAgOiBgWW91IGhhdmUgJHt0b3RhbFF0eX0gcmV3YXJkcyB3YWl0aW5nIHRvIGJlIGVuam95ZWQuYCxcbiAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICBkZWZpbml0aW9uSWQ6IHRvcD8ucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogdG9wPy5pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgZGF5QWdvID0gbm93LmdldFRpbWUoKSAtIDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgY29uc3QgZnJlc2ggPSBpbnB1dC5yZWNlbnRFYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBkYXlBZ29cbiAgfSlcbiAgZm9yIChjb25zdCBlYXJuIG9mIGZyZXNoLnNsaWNlKDAsIDMpKSB7XG4gICAgbnVkZ2VzLnB1c2goe1xuICAgICAga2luZDogJ3JlY2VudGx5X2Vhcm5lZCcsXG4gICAgICB0aXRsZTogJ1Jld2FyZCBlYXJuZWQnLFxuICAgICAgbWVzc2FnZTogYFlvdSBlYXJuZWQgJHtlYXJuLmRlZmluaXRpb25fbmFtZX0gXHUwMEQ3JHtlYXJuLnF1YW50aXR5fS5gLFxuICAgICAgc2V2ZXJpdHk6ICdzdWNjZXNzJyxcbiAgICAgIGRlZmluaXRpb25JZDogZWFybi5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgYmlnU3RhY2sgPSBpbnB1dC5pbnZlbnRvcnkuZmluZCgoaSkgPT4gaS5xdWFudGl0eSA+PSA1KVxuICBpZiAoYmlnU3RhY2spIHtcbiAgICBudWRnZXMucHVzaCh7XG4gICAgICBraW5kOiAndW5jb25zdW1lZF9zdGFjaycsXG4gICAgICB0aXRsZTogJ0dyb3dpbmcgc3RhY2snLFxuICAgICAgbWVzc2FnZTogYCR7YmlnU3RhY2submFtZSA/PyAnQSByZXdhcmQnfSBpcyBzdGFja2VkIFx1MDBENyR7YmlnU3RhY2sucXVhbnRpdHl9IFx1MjAxNCB0cmVhdCB5b3Vyc2VsZj9gLFxuICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgIGRlZmluaXRpb25JZDogYmlnU3RhY2sucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogYmlnU3RhY2suaWQsXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBhcHAgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgcmVzb2x2ZXJzIH0gZnJvbSAnLi9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMnXG5pbXBvcnQge1xuICBjb3JzTWlkZGxld2FyZSxcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxufSBmcm9tICcuL2F1dGgvdmVyaWZ5LnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQge1xuICBBc3NldFZhbGlkYXRpb25FcnJvcixcbiAgY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeSxcbn0gZnJvbSAnLi9hc3NldHMvcmVwb3NpdG9yeS50cydcbmltcG9ydCB7IE1BWF9BU1NFVF9CWVRFUyB9IGZyb20gJy4vYXNzZXRzL3N0b3JhZ2UvdHlwZXMudHMnXG5cbmFwcC51c2UoY29yc01pZGRsZXdhcmUpXG5cbmFwcC51c2UoYXN5bmMgKGN0eCwgbmV4dCkgPT4ge1xuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggPT09ICcvaGVhbHRoJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUgfSksIHtcbiAgICAgIHN0YXR1czogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG4gIGF3YWl0IG5leHQoKVxufSlcblxuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZVVzZXJJZEZyb21SZXF1ZXN0KFxuICBhdXRob3JpemF0aW9uOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGw+IHtcbiAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihhdXRob3JpemF0aW9uKVxuICBpZiAoIXZlcmlmaWVkKSByZXR1cm4gbnVsbFxuICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHtcbiAgICBhdXRoVXNlcklkOiB2ZXJpZmllZC5hdXRoVXNlcklkLFxuICAgIGVtYWlsOiB2ZXJpZmllZC5lbWFpbCxcbiAgfSlcbiAgcmV0dXJuIGxvY2FsVXNlci5pZFxufVxuXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gIC8vIEFzc2V0IHVwbG9hZCAvIGRvd25sb2FkIChhdXRoZW50aWNhdGVkIFJFU1QsIG5vdCBHcmFwaFFMKS5cbiAgaWYgKHBhdGggPT09ICcvYXNzZXRzJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ1BPU1QnKSB7XG4gICAgY29uc3QgdXNlcklkID0gYXdhaXQgcmVzb2x2ZVVzZXJJZEZyb21SZXF1ZXN0KFxuICAgICAgY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSxcbiAgICApXG4gICAgaWYgKHVzZXJJZCA9PSBudWxsKSByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnRUeXBlID1cbiAgICAgICAgY3R4LnJlcS5oZWFkZXIoJ0NvbnRlbnQtVHlwZScpPy50b0xvd2VyQ2FzZSgpID8/ICcnXG4gICAgICBsZXQgYnl0ZXM6IFVpbnQ4QXJyYXlcbiAgICAgIGxldCBtaW1lID0gJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgICAgIGxldCBmaWxlbmFtZTogc3RyaW5nIHwgdW5kZWZpbmVkXG5cbiAgICAgIGlmIChjb250ZW50VHlwZS5pbmNsdWRlcygnbXVsdGlwYXJ0L2Zvcm0tZGF0YScpKSB7XG4gICAgICAgIGNvbnN0IGZvcm0gPSBhd2FpdCBjdHgucmVxLmZvcm1EYXRhKClcbiAgICAgICAgY29uc3QgZmlsZSA9IGZvcm0uZ2V0KCdmaWxlJylcbiAgICAgICAgaWYgKCFmaWxlIHx8IHR5cGVvZiBmaWxlID09PSAnc3RyaW5nJykge1xuICAgICAgICAgIHJldHVybiBqc29uRXJyb3IoJ2ZpbGUgZmllbGQgcmVxdWlyZWQnLCA0MDApXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgYmxvYiA9IGZpbGUgYXMgRmlsZVxuICAgICAgICBtaW1lID0gYmxvYi50eXBlIHx8ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nXG4gICAgICAgIGZpbGVuYW1lID0gYmxvYi5uYW1lXG4gICAgICAgIGNvbnN0IGJ1ZiA9IGF3YWl0IGJsb2IuYXJyYXlCdWZmZXIoKVxuICAgICAgICBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pbWUgPSBjb250ZW50VHlwZS5zcGxpdCgnOycpWzBdLnRyaW0oKSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCBjdHgucmVxLmFycmF5QnVmZmVyKClcbiAgICAgICAgYnl0ZXMgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgICB9XG5cbiAgICAgIGlmIChieXRlcy5ieXRlTGVuZ3RoID4gTUFYX0FTU0VUX0JZVEVTKSB7XG4gICAgICAgIHJldHVybiBqc29uRXJyb3IoJ2ZpbGUgdG9vIGxhcmdlJywgNDEzKVxuICAgICAgfVxuXG4gICAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgcmVwby5wdXQoe1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGJ5dGVzLFxuICAgICAgICBjb250ZW50VHlwZTogbWltZSxcbiAgICAgICAgZmlsZW5hbWUsXG4gICAgICB9KVxuXG4gICAgICByZXR1cm4gbmV3IFJlc3BvbnNlKFxuICAgICAgICBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgICAgaWQ6IGFzc2V0LmlkLFxuICAgICAgICAgIHNoYTI1NjogYXNzZXQuc2hhMjU2LFxuICAgICAgICAgIGNvbnRlbnRUeXBlOiBhc3NldC5jb250ZW50X3R5cGUsXG4gICAgICAgICAgYnl0ZVNpemU6IGFzc2V0LmJ5dGVfc2l6ZSxcbiAgICAgICAgICB1cmw6IGAvYXNzZXRzLyR7YXNzZXQuaWR9YCxcbiAgICAgICAgfSksXG4gICAgICAgIHtcbiAgICAgICAgICBzdGF0dXM6IDIwMSxcbiAgICAgICAgICBoZWFkZXJzOiB7XG4gICAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgICB9LFxuICAgICAgICB9LFxuICAgICAgKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEFzc2V0VmFsaWRhdGlvbkVycm9yKSB7XG4gICAgICAgIHJldHVybiBqc29uRXJyb3IoZXJyLm1lc3NhZ2UsIGVyci5zdGF0dXMpXG4gICAgICB9XG4gICAgICBjb25zb2xlLmVycm9yKCdhc3NldCB1cGxvYWQgZmFpbGVkJywgZXJyKVxuICAgICAgcmV0dXJuIGpzb25FcnJvcigndXBsb2FkIGZhaWxlZCcsIDUwMClcbiAgICB9XG4gIH1cblxuICBjb25zdCBhc3NldE1hdGNoID0gcGF0aC5tYXRjaCgvXlxcL2Fzc2V0c1xcLyhcXGQrKSQvKVxuICBpZiAoYXNzZXRNYXRjaCAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICBjb25zdCB1c2VySWQgPSBhd2FpdCByZXNvbHZlVXNlcklkRnJvbVJlcXVlc3QoXG4gICAgICBjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpLFxuICAgIClcbiAgICBpZiAodXNlcklkID09IG51bGwpIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG5cbiAgICBjb25zdCBhc3NldElkID0gTnVtYmVyKGFzc2V0TWF0Y2hbMV0pXG4gICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgcmVwby5yZWFkQnl0ZXMoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghcmVzdWx0KSB7XG4gICAgICByZXR1cm4ganNvbkVycm9yKCdub3QgZm91bmQnLCA0MDQpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShyZXN1bHQuYnl0ZXMuYnVmZmVyLnNsaWNlKFxuICAgICAgcmVzdWx0LmJ5dGVzLmJ5dGVPZmZzZXQsXG4gICAgICByZXN1bHQuYnl0ZXMuYnl0ZU9mZnNldCArIHJlc3VsdC5ieXRlcy5ieXRlTGVuZ3RoLFxuICAgICksIHtcbiAgICAgIHN0YXR1czogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogcmVzdWx0LmNvbnRlbnRUeXBlLFxuICAgICAgICAnQ2FjaGUtQ29udHJvbCc6ICdwcml2YXRlLCBtYXgtYWdlPTM2MDAnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG5cbiAgaWYgKHBhdGggPT09ICcvaGVhbHRoJyB8fCAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSkpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgaWYgKCF2ZXJpZmllZCkge1xuICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gIH1cblxuICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHtcbiAgICBhdXRoVXNlcklkOiB2ZXJpZmllZC5hdXRoVXNlcklkLFxuICAgIGVtYWlsOiB2ZXJpZmllZC5lbWFpbCxcbiAgfSlcblxuICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgaWYgKHZlcmlmaWVkLmVtYWlsKSB7XG4gICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gIH1cbiAgY3R4LnNldCgndXNlcklkJywgbG9jYWxVc2VyLmlkKVxuXG4gIGF3YWl0IG5leHQoKVxufSlcblxuZnVuY3Rpb24ganNvbkVycm9yKG1lc3NhZ2U6IHN0cmluZywgc3RhdHVzOiBudW1iZXIpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogbWVzc2FnZSB9KSwge1xuICAgIHN0YXR1cyxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICB9LFxuICB9KVxufVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdGZpbHRlcjogUmV3YXJkRGVmaW5pdGlvbnNGaWx0ZXJJbnB1dFxcbn1cXG5pbnB1dCBSZXdhcmREZWZpbml0aW9uc0ZpbHRlcklucHV0IHtcXG5cXHRpbmNsdWRlQXJjaGl2ZWQ6IEJvb2xlYW5cXG5cXHRzZWFyY2g6IFN0cmluZ1xcblxcdGNhdGVnb3J5OiBTdHJpbmdcXG5cXHRsaW1pdDogTnVtYmVyXFxuXFx0b2Zmc2V0OiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yIHtcXG5cXHRmaWx0ZXI6IFJld2FyZEludmVudG9yeUZpbHRlcklucHV0XFxufVxcbmlucHV0IFJld2FyZEludmVudG9yeUZpbHRlcklucHV0IHtcXG5cXHRzZWFyY2g6IFN0cmluZ1xcblxcdHN0YWNrYWJsZU9ubHk6IEJvb2xlYW5cXG5cXHRzb3J0OiBOQU1FX1FVQU5USVRZX1JFQ0VOVElucHV0XFxuXFx0bGltaXQ6IE51bWJlclxcblxcdG9mZnNldDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRmaWx0ZXI6IFJld2FyZEhpc3RvcnlGaWx0ZXJJbnB1dFxcbn1cXG5pbnB1dCBSZXdhcmRIaXN0b3J5RmlsdGVySW5wdXQge1xcblxcdGRlZmluaXRpb25JZDogTnVtYmVyXFxuXFx0dHlwZTogU3RyaW5nXFxuXFx0bGltaXQ6IE51bWJlclxcblxcdG9mZnNldDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF80IHtcXG5cXHRzb3VyY2VUeXBlOiBTdHJpbmchXFxuXFx0c291cmNlSWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGxpbWl0OiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdHN0YXR1czogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfOCB7XFxuXFx0ZGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMSB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyXFxuXFx0ZnJvbURhdGU6IFN0cmluZ1xcblxcdHRvRGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMiB7XFxuXFx0aW5wdXQ6IENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRub3RlczogU3RyaW5nXFxuXFx0Y2F0ZWdvcnk6IFN0cmluZ1xcblxcdHRhZ3M6IFtTdHJpbmchXVxcblxcdGNvbG9yOiBTdHJpbmchXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0aW1hZ2VBc3NldElkOiBOdW1iZXJcXG5cXHRzdGFja2FibGU6IEJvb2xlYW5cXG5cXHRkZWZhdWx0UXVhbnRpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZVJld2FyZERlZmluaXRpb25JbnB1dElucHV0IHtcXG5cXHRuYW1lOiBTdHJpbmdcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0bm90ZXM6IFN0cmluZ1xcblxcdGNhdGVnb3J5OiBTdHJpbmdcXG5cXHR0YWdzOiBbU3RyaW5nIV1cXG5cXHRjb2xvcjogU3RyaW5nXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0aW1hZ2VBc3NldElkOiBOdW1iZXJcXG5cXHRzdGFja2FibGU6IEJvb2xlYW5cXG5cXHRkZWZhdWx0UXVhbnRpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE1IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNyB7XFxuXFx0aW5wdXQ6IEF0dGFjaFJld2FyZFJ1bGVJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBBdHRhY2hSZXdhcmRSdWxlSW5wdXRJbnB1dCB7XFxuXFx0c291cmNlVHlwZTogU3RyaW5nIVxcblxcdHNvdXJjZUlkOiBOdW1iZXIhXFxuXFx0cmV3YXJkRGVmaW5pdGlvbklkOiBOdW1iZXIhXFxuXFx0cXVhbnRpdHk6IE51bWJlclxcblxcdG1vZGU6IEZJWEVEX1BST0JBQklMSVRZX1JBTkRPTV9QT09MSW5wdXRcXG5cXHRjb25maWdKc29uOiBTdHJpbmdcXG5cXHRlbmFibGVkOiBCb29sZWFuXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE5IHtcXG5cXHRpbnB1dDogQ29uc3VtZVJld2FyZElucHV0SW5wdXQhXFxufVxcbmlucHV0IENvbnN1bWVSZXdhcmRJbnB1dElucHV0IHtcXG5cXHRpbnZlbnRvcnlJZDogTnVtYmVyIVxcblxcdHF1YW50aXR5OiBOdW1iZXJcXG5cXHRub3RlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIwIHtcXG5cXHRpbnB1dDogRGlzY2FyZFJld2FyZElucHV0SW5wdXQhXFxufVxcbmlucHV0IERpc2NhcmRSZXdhcmRJbnB1dElucHV0IHtcXG5cXHRpbnZlbnRvcnlJZDogTnVtYmVyIVxcblxcdHF1YW50aXR5OiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIxIHtcXG5cXHR0cmFuc2FjdGlvbklkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMiB7XFxuXFx0aW5wdXQ6IE1hbnVhbEdyYW50UmV3YXJkSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgTWFudWFsR3JhbnRSZXdhcmRJbnB1dElucHV0IHtcXG5cXHRyZXdhcmREZWZpbml0aW9uSWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMyB7XFxuXFx0aW5wdXQ6IENyZWF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZyFcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRydWxlVHlwZTogU3RyaW5nIVxcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dCFcXG5cXHR0YXJnZXRWYWx1ZTogTnVtYmVyIVxcblxcdGNvbmZpZzogR29hbENvbmZpZ0lucHV0SW5wdXRcXG5cXHRsaW5rczogW0dvYWxMaW5rSW5wdXRJbnB1dCFdXFxuXFx0ZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3lJbnB1dElucHV0IV1cXG5cXHRyZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXRcXG5cXHRkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXRJbnB1dFxcblxcdHN0YXJ0c0F0OiBTdHJpbmdcXG5cXHRwcmlvcml0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbENvbmZpZ0lucHV0SW5wdXQge1xcblxcdGNvbXBvc2l0ZU1vZGU6IEFMTF9BTllfV0VJR0hURURJbnB1dFxcblxcdGNvdW50UmVxdWlyZWQ6IE51bWJlclxcblxcdGJlZm9yZVRpbWU6IFN0cmluZ1xcblxcdGFmdGVyVGltZTogU3RyaW5nXFxuXFx0YmxvY2tVbnRpbFVubG9ja2VkOiBCb29sZWFuXFxufVxcbmlucHV0IEdvYWxMaW5rSW5wdXRJbnB1dCB7XFxuXFx0bGlua1R5cGU6IEFDVElWSVRZX0dST1VQSW5wdXQhXFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyXFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbERlcGVuZGVuY3lJbnB1dElucHV0IHtcXG5cXHRkZXBlbmRzT25Hb2FsSWQ6IE51bWJlciFcXG5cXHRyZXF1aXJlbWVudDogQ09NUExFVEVfUFJPR1JFU1NJbnB1dFxcblxcdHRocmVzaG9sZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbFJlY3VycmVuY2VJbnB1dElucHV0IHtcXG5cXHRwZXJpb2Q6IFdFRUtMWV9NT05USExZX1FVQVJURVJMWV9FVkVSWV9YX0RBWVNJbnB1dCFcXG5cXHRpbnRlcnZhbDogTnVtYmVyXFxuXFx0YW5jaG9yOiBTdHJpbmdcXG5cXHRjYXJyeU92ZXI6IE5PTkVfT1ZFUkZMT1dJbnB1dFxcblxcdHJlc2V0OiBTdHJpbmdcXG59XFxuaW5wdXQgR29hbERlYWRsaW5lSW5wdXRJbnB1dCB7XFxuXFx0a2luZDogQUJTT0xVVEVfUkVMQVRJVkVJbnB1dCFcXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRkYXlzQWZ0ZXJDeWNsZVN0YXJ0OiBOdW1iZXJcXG5cXHRncmFjZURheXM6IE51bWJlclxcblxcdHdhcm5EYXlzOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI0IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVHb2FsSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlR29hbElucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmdcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcblxcdGljb246IFN0cmluZ1xcblxcdHJ1bGVUeXBlOiBTdHJpbmdcXG5cXHRtZXRyaWM6IENPVU5UX0RVUkFUSU9OSW5wdXRcXG5cXHR0YXJnZXRWYWx1ZTogTnVtYmVyXFxuXFx0Y29uZmlnOiBHb2FsQ29uZmlnSW5wdXRJbnB1dFxcblxcdGxpbmtzOiBbR29hbExpbmtJbnB1dElucHV0IV1cXG5cXHRkZXBlbmRlbmNpZXM6IFtHb2FsRGVwZW5kZW5jeUlucHV0SW5wdXQhXVxcblxcdHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlSW5wdXRJbnB1dFxcblxcdGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dElucHV0XFxuXFx0c3RhcnRzQXQ6IFN0cmluZ1xcblxcdGNvbmZpcm1TdGFydHNBdENoYW5nZTogQm9vbGVhblxcblxcdHN0YXR1czogQUNUSVZFX1BBVVNFRF9DT01QTEVURURfQVJDSElWRURfRkFJTEVESW5wdXRcXG5cXHRwcmlvcml0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI1IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjkge1xcblxcdGlucHV0OiBDcmVhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMCB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlR3JvdXBJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHcm91cElucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMxIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzIge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG5cXHRub3RpZmljYXRpb25PZmZzZXRzOiBbTnVtYmVyIV1cXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMzIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRzdGFydFRpbWU6IFN0cmluZ1xcblxcdGVuZFRpbWU6IFN0cmluZ1xcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0cmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dFxcblxcdGdyb3VwSWQ6IE51bWJlclxcblxcdG5vdGlmaWNhdGlvbk9mZnNldHM6IFtOdW1iZXIhXVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzQge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zNSB7XFxuXFx0aW5wdXQ6IENvbXBsZXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDb21wbGV0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyIVxcblxcdG9jY3VycmVuY2VEYXRlOiBTdHJpbmchXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXJcXG5cXHRub3RlczogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzM3IHtcXG5cXHRpbnB1dDogTG9nVGltZUlucHV0SW5wdXQhXFxufVxcbmlucHV0IExvZ1RpbWVJbnB1dElucHV0IHtcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXIhXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXIhXFxuXFx0b2NjdXJyZW5jZURhdGU6IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxucmV3YXJkRGVmaW5pdGlvbnMoYXJnczogQXJnc0lucHV0ISk6IFtSZXdhcmREZWZpbml0aW9ucyFdIVxcbnJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzEhKTogUmV3YXJkRGVmaW5pdGlvbnNcXG5yZXdhcmRJbnZlbnRvcnkoYXJnczogQXJnc0lucHV0XzIhKTogW1Jld2FyZEludmVudG9yeSFdIVxcbnJld2FyZEhpc3RvcnkoYXJnczogQXJnc0lucHV0XzMhKTogW1Jld2FyZEhpc3RvcnkhXSFcXG5yZXdhcmRSdWxlcyhhcmdzOiBBcmdzSW5wdXRfNCEpOiBbUmV3YXJkUnVsZXMhXSFcXG5yZWNlbnRBc3NldHMoYXJnczogQXJnc0lucHV0XzUhKTogW1JlY2VudEFzc2V0cyFdIVxcbnJld2FyZE51ZGdlcyhfYXJnczogT2JqZWN0KTogW1Jld2FyZE51ZGdlIV0hXFxuZ29hbHMoYXJnczogQXJnc0lucHV0XzYpOiBbR29hbHMhXSFcXG5nb2FsKGFyZ3M6IEFyZ3NJbnB1dF83ISk6IEdvYWxzXFxuZ29hbE51ZGdlcyhhcmdzOiBPYmplY3QpOiBbR29hbE51ZGdlIV0hXFxuZGFpbHlQcm9ncmVzcyhhcmdzOiBBcmdzSW5wdXRfOCk6IERhaWx5UHJvZ3Jlc3MhXFxuZ3JvdXBzKGFyZ3M6IE9iamVjdCk6IFtHcm91cHMhXSFcXG5ncm91cChhcmdzOiBBcmdzSW5wdXRfOSEpOiBHcm91cHNcXG5hY3Rpdml0aWVzKGFyZ3M6IE9iamVjdCk6IFtBY3Rpdml0aWVzIV0hXFxuYWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzEwISk6IEFjdGl2aXRpZXNcXG5hY3Rpdml0eUNvbXBsZXRpb25zKGFyZ3M6IEFyZ3NJbnB1dF8xMSk6IFtBY3Rpdml0eUNvbXBsZXRpb25zIV0hXFxufVxcbnR5cGUgUmV3YXJkRGVmaW5pdGlvbnMge1xcbnRhZ3M6IFtTdHJpbmchXSFcXG5pbWFnZV91cmw6IFN0cmluZ1xcbmltYWdlOiBJbWFnZVxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxubm90ZXM6IFN0cmluZ1xcbmNhdGVnb3J5OiBTdHJpbmdcXG5jb2xvcjogU3RyaW5nIVxcbmljb246IFN0cmluZ1xcbmltYWdlX2Fzc2V0X2lkOiBOdW1iZXJcXG5zdGFja2FibGU6IEJvb2xlYW4hXFxuZGVmYXVsdF9xdWFudGl0eTogTnVtYmVyIVxcbnNvcnRfb3JkZXI6IE51bWJlciFcXG5hcmNoaXZlZF9hdDogRGF0ZVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBJbWFnZSB7XFxudXJsOiBTdHJpbmchXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5zaGEyNTY6IFN0cmluZyFcXG5jb250ZW50X3R5cGU6IFN0cmluZyFcXG5ieXRlX3NpemU6IE51bWJlciFcXG5zdG9yYWdlX2tleTogU3RyaW5nIVxcbnJlZl9jb3VudDogTnVtYmVyIVxcbm9ycGhhbmVkX2F0OiBEYXRlXFxufVxcbnR5cGUgUmV3YXJkSW52ZW50b3J5IHtcXG5kZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uc1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxucmV3YXJkX2RlZmluaXRpb25faWQ6IE51bWJlciFcXG5xdWFudGl0eTogTnVtYmVyIVxcbnN0YWNrX2tleTogU3RyaW5nXFxuZmlyc3RfZWFybmVkX2F0OiBEYXRlIVxcbmxhc3RfZWFybmVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIFJld2FyZEhpc3Rvcnkge1xcbm1ldGFkYXRhOiBBbnkhXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuaW1hZ2VfYXNzZXRfaWQ6IE51bWJlclxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlclxcbnJld2FyZF9kZWZpbml0aW9uX2lkOiBOdW1iZXJcXG5xdWFudGl0eTogTnVtYmVyIVxcbnR5cGU6IFJld2FyZFRyYW5zYWN0aW9uVHlwZSFcXG5pbnZlbnRvcnlfaWQ6IE51bWJlclxcbmRlZmluaXRpb25fbmFtZTogU3RyaW5nIVxcbmRlZmluaXRpb25fY29sb3I6IFN0cmluZyFcXG5kZWZpbml0aW9uX2ljb246IFN0cmluZ1xcbnNvdXJjZV90eXBlOiBTdHJpbmdcXG5zb3VyY2VfaWQ6IE51bWJlclxcbnRyaWdnZXJfa2V5OiBTdHJpbmdcXG5ydWxlX2lkOiBOdW1iZXJcXG5nb2FsX2lkOiBOdW1iZXJcXG5jb21wbGV0aW9uX2lkOiBOdW1iZXJcXG5jeWNsZV9pZDogTnVtYmVyXFxubm90ZTogU3RyaW5nXFxufVxcbnR5cGUgUmV3YXJkUnVsZXMge1xcbmNvbmZpZzogUmV3YXJkUnVsZUNvbmZpZyFcXG5kZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uc1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5yZXdhcmRfZGVmaW5pdGlvbl9pZDogTnVtYmVyIVxcbnF1YW50aXR5OiBOdW1iZXIhXFxuc291cmNlX3R5cGU6IFN0cmluZyFcXG5zb3VyY2VfaWQ6IE51bWJlciFcXG5tb2RlOiBSZXdhcmRSdWxlTW9kZSFcXG5lbmFibGVkOiBCb29sZWFuIVxcbn1cXG50eXBlIFJld2FyZFJ1bGVDb25maWcge1xcbm9uY2U6IEJvb2xlYW5cXG5jb29sZG93bl9ob3VyczogTnVtYmVyXFxubWF4X2dyYW50c190b3RhbDogTnVtYmVyXFxubWF4X2dyYW50c19wZXJfcGVyaW9kOiBOdW1iZXJcXG5wZXJpb2RfaG91cnM6IE51bWJlclxcbnByb2JhYmlsaXR5OiBOdW1iZXJcXG5cXFwiXFxcIlxcXCJcXG5Qb29sIG9mIGRlZmluaXRpb24gaWRzIGZvciByYW5kb21fcG9vbCBtb2RlLlxcblxcXCJcXFwiXFxcIlxcbnBvb2w6IFtQb29sIV1cXG59XFxudHlwZSBQb29sIHtcXG5kZWZpbml0aW9uX2lkOiBOdW1iZXIhXFxud2VpZ2h0OiBOdW1iZXJcXG5xdWFudGl0eTogTnVtYmVyXFxufVxcbnR5cGUgUmVjZW50QXNzZXRzIHtcXG51cmw6IFN0cmluZyFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnNoYTI1NjogU3RyaW5nIVxcbmNvbnRlbnRfdHlwZTogU3RyaW5nIVxcbmJ5dGVfc2l6ZTogTnVtYmVyIVxcbnN0b3JhZ2Vfa2V5OiBTdHJpbmchXFxucmVmX2NvdW50OiBOdW1iZXIhXFxub3JwaGFuZWRfYXQ6IERhdGVcXG59XFxudHlwZSBSZXdhcmROdWRnZSB7XFxua2luZDogUmV3YXJkTnVkZ2VLaW5kIVxcbnRpdGxlOiBTdHJpbmchXFxubWVzc2FnZTogU3RyaW5nIVxcbnNldmVyaXR5OiBJTkZPX1NVQ0NFU1MhXFxuZGVmaW5pdGlvbklkOiBOdW1iZXJcXG5pbnZlbnRvcnlJZDogTnVtYmVyXFxufVxcbnR5cGUgR29hbHMge1xcbnRhcmdldF92YWx1ZTogTnVtYmVyIVxcbnN0YXJ0c0F0OiBTdHJpbmchXFxubGlmZWN5Y2xlUGhhc2U6IEdvYWxMaWZlY3ljbGVQaGFzZSFcXG5jb25maWc6IEdvYWxDb25maWchXFxucmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VDb25maWdcXG5kZWFkbGluZTogR29hbERlYWRsaW5lQ29uZmlnXFxubGlua3M6IFtMaW5rcyFdIVxcbmFjdGl2ZUN5Y2xlOiBBY3RpdmVDeWNsZVxcbmN5Y2xlczogW0N5Y2xlc0FuZEN5Y2xlc18xIV0hXFxuZGVwZW5kZW5jaWVzOiBbRGVwZW5kZW5jaWVzIV0hXFxuc25hcHNob3RzOiBbU25hcHNob3RzIV0hXFxuaXNMb2NrZWQ6IEJvb2xlYW4hXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNvbG9yOiBTdHJpbmchXFxuaWNvbjogU3RyaW5nXFxuc29ydF9vcmRlcjogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG50aXRsZTogU3RyaW5nIVxcbnJ1bGVfdHlwZTogU3RyaW5nIVxcbm1ldHJpYzogR29hbE1ldHJpYyFcXG5zdGF0dXM6IEdvYWxTdGF0dXMhXFxucHJpb3JpdHk6IE51bWJlciFcXG5zdGFydHNfYXQ6IERhdGUhXFxufVxcbnR5cGUgR29hbENvbmZpZyB7XFxuY29tcG9zaXRlX21vZGU6IEFMTF9BTllfV0VJR0hURURcXG5jb3VudF9yZXF1aXJlZDogTnVtYmVyXFxuYmVmb3JlX3RpbWU6IFN0cmluZ1xcbmFmdGVyX3RpbWU6IFN0cmluZ1xcbmJsb2NrX3VudGlsX3VubG9ja2VkOiBCb29sZWFuXFxufVxcbnR5cGUgR29hbFJlY3VycmVuY2VDb25maWcge1xcbnBlcmlvZDogV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZUyFcXG5pbnRlcnZhbDogTnVtYmVyXFxuYW5jaG9yOiBTdHJpbmdcXG5jYXJyeV9vdmVyOiBOT05FX09WRVJGTE9XXFxucmVzZXQ6IFN0cmluZ1xcbn1cXG50eXBlIEdvYWxEZWFkbGluZUNvbmZpZyB7XFxua2luZDogQUJTT0xVVEVfUkVMQVRJVkUhXFxuZGF0ZTogU3RyaW5nXFxuZGF5c19hZnRlcl9jeWNsZV9zdGFydDogTnVtYmVyXFxuZ3JhY2VfZGF5czogTnVtYmVyXFxud2Fybl9kYXlzOiBOdW1iZXJcXG59XFxudHlwZSBMaW5rcyB7XFxuYWN0aXZpdHk6IEFjdGl2aXR5XFxuZ3JvdXA6IEdyb3Vwc1xcbndlaWdodDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxuZ29hbF9pZDogTnVtYmVyIVxcbmxpbmtfdHlwZTogR29hbExpbmtUeXBlIVxcbmdyb3VwX2lkOiBOdW1iZXJcXG59XFxudHlwZSBBY3Rpdml0eSB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG50aXRsZTogU3RyaW5nIVxcbmdyb3VwX2lkOiBOdW1iZXJcXG5zdGFydF90aW1lOiBTdHJpbmchXFxuZW5kX3RpbWU6IFN0cmluZyFcXG5pc19yZWN1cnJpbmc6IEJvb2xlYW4hXFxuZGF0ZTogU3RyaW5nXFxubm90aWZpY2F0aW9uX29mZnNldHM6IFtOdW1iZXIhXSFcXG59XFxudHlwZSBHcm91cHMge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5jb2xvcjogU3RyaW5nIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBBY3RpdmVDeWNsZSB7XFxuZGVhZGxpbmVTdGF0ZTogRGVhZGxpbmVTdGF0ZSFcXG5wZXJjZW50Q29tcGxldGU6IE51bWJlciFcXG5yZW1haW5pbmc6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5nb2FsX2lkOiBOdW1iZXIhXFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXMhXFxuc3RhcnRzX2F0OiBEYXRlIVxcbmN5Y2xlX2luZGV4OiBOdW1iZXIhXFxuZW5kc19hdDogRGF0ZVxcbmRlYWRsaW5lX2F0OiBEYXRlXFxuY3VycmVudF92YWx1ZTogTnVtYmVyIVxcbmNhcnJ5X292ZXI6IE51bWJlciFcXG59XFxudHlwZSBDeWNsZXNBbmRDeWNsZXNfMSB7XFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbnRhcmdldF92YWx1ZTogTnVtYmVyIVxcbnN0YXR1czogR29hbEN5Y2xlU3RhdHVzIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5jeWNsZV9pbmRleDogTnVtYmVyIVxcbmVuZHNfYXQ6IERhdGVcXG5kZWFkbGluZV9hdDogRGF0ZVxcbmN1cnJlbnRfdmFsdWU6IE51bWJlciFcXG5jYXJyeV9vdmVyOiBOdW1iZXIhXFxufVxcbnR5cGUgRGVwZW5kZW5jaWVzIHtcXG5kZXBlbmRzT246IEdvYWxzXFxudGhyZXNob2xkOiBOdW1iZXJcXG53ZWlnaHQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbmRlcGVuZHNfb25fZ29hbF9pZDogTnVtYmVyIVxcbnJlcXVpcmVtZW50OiBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50IVxcbn1cXG50eXBlIFNuYXBzaG90cyB7XFxudmFsdWU6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9jeWNsZV9pZDogTnVtYmVyIVxcbmFzX29mOiBTdHJpbmchXFxufVxcbnR5cGUgR29hbE51ZGdlIHtcXG5raW5kOiBHb2FsTnVkZ2VLaW5kIVxcbmdvYWxJZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxubWVzc2FnZTogU3RyaW5nIVxcbnNldmVyaXR5OiBJTkZPX1NVQ0NFU1NfV0FSTklORyFcXG59XFxudHlwZSBEYWlseVByb2dyZXNzIHtcXG5kYXRlOiBTdHJpbmchXFxuY29tcGxldGVkQ291bnQ6IE51bWJlciFcXG5taW51dGVzVG9kYXk6IE51bWJlciFcXG5zdHJlYWtEYXlzOiBOdW1iZXIhXFxuY29tcGxldGlvbnM6IFtBY3Rpdml0eUNvbXBsZXRpb25zIV0hXFxufVxcbnR5cGUgQWN0aXZpdHlDb21wbGV0aW9ucyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXFxufVxcbnR5cGUgTWV0YWRhdGEge1xcbnRpdGxlOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxudHJpZ2dlcl9ldmVudHM6IFtTdHJpbmchXVxcbn1cXG50eXBlIEFjdGl2aXRpZXMge1xcbnJlY3VycmVuY2VQYXR0ZXJuOiBQYXJzZWRSZWN1cnJlbmNlUGF0dGVyblxcbmdyb3VwOiBHcm91cFxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxudGl0bGU6IFN0cmluZyFcXG5ncm91cF9pZDogTnVtYmVyXFxuc3RhcnRfdGltZTogU3RyaW5nIVxcbmVuZF90aW1lOiBTdHJpbmchXFxuaXNfcmVjdXJyaW5nOiBCb29sZWFuIVxcbmRhdGU6IFN0cmluZ1xcbm5vdGlmaWNhdGlvbl9vZmZzZXRzOiBbTnVtYmVyIV0hXFxufVxcbnR5cGUgUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4ge1xcbmNvbmZpZzogUmVjdXJyZW5jZUNvbmZpZyFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyIVxcbnJlY3VycmVuY2VfdHlwZTogV0VFS0xZX01PTlRITFlfRVZFUllfWF9EQVlTIVxcbn1cXG50eXBlIFJlY3VycmVuY2VDb25maWcge1xcbmRheXNfb2Zfd2VlazogW051bWJlciFdXFxuZGF5c19vZl9tb250aDogW051bWJlciFdXFxuaXNfbGFzdF9kYXlfb2ZfbW9udGg6IEJvb2xlYW5cXG5pbnRlcnZhbF9kYXlzOiBOdW1iZXJcXG5zdGFydF9kYXRlOiBTdHJpbmchXFxuZW5kX2RhdGU6IFN0cmluZ1xcbn1cXG50eXBlIEdyb3VwIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzEyISk6IFJld2FyZERlZmluaXRpb25zIVxcbnVwZGF0ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzEzISk6IFJld2FyZERlZmluaXRpb25zIVxcbmFyY2hpdmVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNCEpOiBSZXdhcmREZWZpbml0aW9ucyFcXG51bmFyY2hpdmVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNSEpOiBSZXdhcmREZWZpbml0aW9ucyFcXG5kZWxldGVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNiEpOiBCb29sZWFuIVxcbmF0dGFjaFJld2FyZFJ1bGUoYXJnczogQXJnc0lucHV0XzE3ISk6IFJld2FyZFJ1bGVzIVxcbmRldGFjaFJld2FyZFJ1bGUoYXJnczogQXJnc0lucHV0XzE4ISk6IEJvb2xlYW4hXFxuY29uc3VtZVJld2FyZChhcmdzOiBBcmdzSW5wdXRfMTkhKTogQ29uc3VtZVJld2FyZCFcXG5kaXNjYXJkUmV3YXJkKGFyZ3M6IEFyZ3NJbnB1dF8yMCEpOiBEaXNjYXJkUmV3YXJkIVxcbnJlc3RvcmVSZXdhcmQoYXJnczogQXJnc0lucHV0XzIxISk6IFJlc3RvcmVSZXdhcmQhXFxubWFudWFsR3JhbnRSZXdhcmQoYXJnczogQXJnc0lucHV0XzIyISk6IFJld2FyZEhpc3RvcnlcXG5yZWNvbXB1dGVSZXdhcmRJbnZlbnRvcnk6IEJvb2xlYW4hXFxuY3JlYXRlR29hbChhcmdzOiBBcmdzSW5wdXRfMjMhKTogR29hbHMhXFxudXBkYXRlR29hbChhcmdzOiBBcmdzSW5wdXRfMjQhKTogR29hbHMhXFxucGF1c2VHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yNSEpOiBHb2FscyFcXG5yZXN1bWVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yNiEpOiBHb2FscyFcXG5hcmNoaXZlR29hbChhcmdzOiBBcmdzSW5wdXRfMjchKTogR29hbHMhXFxuZGVsZXRlR29hbChhcmdzOiBBcmdzSW5wdXRfMjghKTogQm9vbGVhbiFcXG5yZWNvbXB1dGVHb2FsUHJvZ3Jlc3MoYXJnczogT2JqZWN0KTogUmVjb21wdXRlR29hbFByb2dyZXNzIVxcbmNyZWF0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8yOSEpOiBDcmVhdGVHcm91cCFcXG51cGRhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMzAhKTogQ3JlYXRlR3JvdXAhXFxuZGVsZXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzMxISk6IEJvb2xlYW4hXFxuY3JlYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzMyISk6IEFjdGl2aXRpZXMhXFxudXBkYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzMzISk6IEFjdGl2aXRpZXMhXFxuZGVsZXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzM0ISk6IEJvb2xlYW4hXFxuY29tcGxldGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzUhKTogQ29tcGxldGVBY3Rpdml0eSFcXG51bmRvQ29tcGxldGlvbihhcmdzOiBBcmdzSW5wdXRfMzYhKTogQm9vbGVhbiFcXG5sb2dUaW1lKGFyZ3M6IEFyZ3NJbnB1dF8zNyEpOiBMb2dUaW1lIVxcbn1cXG50eXBlIENvbnN1bWVSZXdhcmQge1xcbmludmVudG9yeTogUmV3YXJkSW52ZW50b3J5XFxudHJhbnNhY3Rpb246IFJld2FyZEhpc3RvcnkhXFxufVxcbnR5cGUgRGlzY2FyZFJld2FyZCB7XFxuaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlcXG50cmFuc2FjdGlvbjogUmV3YXJkSGlzdG9yeSFcXG59XFxudHlwZSBSZXN0b3JlUmV3YXJkIHtcXG5pbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSFcXG50cmFuc2FjdGlvbjogUmV3YXJkSGlzdG9yeSFcXG59XFxudHlwZSBSZWNvbXB1dGVHb2FsUHJvZ3Jlc3Mge1xcbnJlY29tcHV0ZWQ6IE51bWJlciFcXG59XFxudHlwZSBDcmVhdGVHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIENvbXBsZXRlQWN0aXZpdHkge1xcbmdyYW50ZWRSZXdhcmRzOiBbR3JhbnRlZFJld2FyZHNdIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXIhXFxub2NjdXJyZW5jZV9kYXRlOiBTdHJpbmchXFxuZHVyYXRpb25fbWludXRlczogTnVtYmVyXFxuY29tcGxldGVkX2F0OiBEYXRlIVxcbm1ldGFkYXRhOiBNZXRhZGF0YVxcbn1cXG50eXBlIEdyYW50ZWRSZXdhcmRzIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5pbWFnZV9hc3NldF9pZDogTnVtYmVyXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxubWV0YWRhdGE6IE9iamVjdFxcbnJld2FyZF9kZWZpbml0aW9uX2lkOiBOdW1iZXJcXG5xdWFudGl0eTogTnVtYmVyIVxcbnR5cGU6IFJld2FyZFRyYW5zYWN0aW9uVHlwZSFcXG5pbnZlbnRvcnlfaWQ6IE51bWJlclxcbmRlZmluaXRpb25fbmFtZTogU3RyaW5nIVxcbmRlZmluaXRpb25fY29sb3I6IFN0cmluZyFcXG5kZWZpbml0aW9uX2ljb246IFN0cmluZ1xcbnNvdXJjZV90eXBlOiBTdHJpbmdcXG5zb3VyY2VfaWQ6IE51bWJlclxcbnRyaWdnZXJfa2V5OiBTdHJpbmdcXG5ydWxlX2lkOiBOdW1iZXJcXG5nb2FsX2lkOiBOdW1iZXJcXG5jb21wbGV0aW9uX2lkOiBOdW1iZXJcXG5jeWNsZV9pZDogTnVtYmVyXFxubm90ZTogU3RyaW5nXFxufVxcbnR5cGUgTG9nVGltZSB7XFxuYW1vdW50OiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxub2NjdXJyZW5jZV9kYXRlOiBTdHJpbmdcXG5tZXRhZGF0YTogT2JqZWN0XFxuc291cmNlX3R5cGU6IEdvYWxFdmVudFNvdXJjZVR5cGUhXFxuY29tcGxldGlvbl9pZDogTnVtYmVyXFxubWV0cmljOiBHb2FsRXZlbnRNZXRyaWMhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbm9jY3VycmVkX2F0OiBEYXRlIVxcbn1cXG5zY2FsYXIgSURcXG5zY2FsYXIgSW50XFxuc2NhbGFyIEZsb2F0XFxuc2NhbGFyIE51bWJlclxcbnNjYWxhciBBbnlcXG5zY2FsYXIgVm9pZFxcbnNjYWxhciBPYmplY3RcXG5zY2FsYXIgRmlsZVxcbnNjYWxhciBEYXRlXFxuc2NhbGFyIEpTT05cXG5zY2FsYXIgU3RyaW5nXFxuc2NhbGFyIEJvb2xlYW5cXG5lbnVtIFJld2FyZFRyYW5zYWN0aW9uVHlwZSB7XFxuXFx0ZWFyblxcblxcdGNvbnN1bWVcXG5cXHRkZWxldGVcXG5cXHRyZXN0b3JlXFxuXFx0YWRqdXN0XFxufVxcbmVudW0gUmV3YXJkUnVsZU1vZGUge1xcblxcdGZpeGVkXFxuXFx0cHJvYmFiaWxpdHlcXG5cXHRyYW5kb21fcG9vbFxcbn1cXG5lbnVtIFJld2FyZE51ZGdlS2luZCB7XFxuXFx0aW52ZW50b3J5X2F2YWlsYWJsZVxcblxcdHJlY2VudGx5X2Vhcm5lZFxcblxcdHVuY29uc3VtZWRfc3RhY2tcXG59XFxuZW51bSBJTkZPX1NVQ0NFU1Mge1xcblxcdGluZm9cXG5cXHRzdWNjZXNzXFxufVxcbmVudW0gR29hbExpZmVjeWNsZVBoYXNlIHtcXG5cXHRhY3RpdmVcXG5cXHRwYXVzZWRcXG5cXHRjb21wbGV0ZWRcXG5cXHRhcmNoaXZlZFxcblxcdGZhaWxlZFxcblxcdHNjaGVkdWxlZFxcbn1cXG5lbnVtIEdvYWxNZXRyaWMge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBHb2FsU3RhdHVzIHtcXG5cXHRhY3RpdmVcXG5cXHRwYXVzZWRcXG5cXHRjb21wbGV0ZWRcXG5cXHRhcmNoaXZlZFxcblxcdGZhaWxlZFxcbn1cXG5lbnVtIEFMTF9BTllfV0VJR0hURUQge1xcblxcdGFsbFxcblxcdGFueVxcblxcdHdlaWdodGVkXFxufVxcbmVudW0gV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZUyB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdHF1YXJ0ZXJseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5lbnVtIE5PTkVfT1ZFUkZMT1cge1xcblxcdG5vbmVcXG5cXHRvdmVyZmxvd1xcbn1cXG5lbnVtIEFCU09MVVRFX1JFTEFUSVZFIHtcXG5cXHRhYnNvbHV0ZVxcblxcdHJlbGF0aXZlXFxufVxcbmVudW0gR29hbExpbmtUeXBlIHtcXG5cXHRhY3Rpdml0eVxcblxcdGdyb3VwXFxufVxcbmVudW0gRGVhZGxpbmVTdGF0ZSB7XFxuXFx0ZmFpbGVkXFxuXFx0b25fdHJhY2tcXG5cXHRhcHByb2FjaGluZ1xcblxcdG92ZXJkdWVcXG59XFxuZW51bSBHb2FsQ3ljbGVTdGF0dXMge1xcblxcdGFjdGl2ZVxcblxcdGZhaWxlZFxcblxcdHN1Y2NlZWRlZFxcblxcdG1pc3NlZFxcbn1cXG5lbnVtIEdvYWxEZXBlbmRlbmN5UmVxdWlyZW1lbnQge1xcblxcdGNvbXBsZXRlXFxuXFx0cHJvZ3Jlc3NcXG59XFxuZW51bSBHb2FsTnVkZ2VLaW5kIHtcXG5cXHRkZWFkbGluZV9hcHByb2FjaGluZ1xcblxcdGRlYWRsaW5lX292ZXJkdWVcXG5cXHRiZWhpbmRfcGFjZVxcblxcdGN5Y2xlX2NvbXBsZXRlXFxuXFx0ZGVwZW5kZW5jeV91bmxvY2tlZFxcblxcdGdvYWxfc3RhcnRpbmdfc29vblxcbn1cXG5lbnVtIElORk9fU1VDQ0VTU19XQVJOSU5HIHtcXG5cXHRpbmZvXFxuXFx0c3VjY2Vzc1xcblxcdHdhcm5pbmdcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9FVkVSWV9YX0RBWVMge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBHb2FsRXZlbnRTb3VyY2VUeXBlIHtcXG5cXHRjb21wbGV0aW9uXFxuXFx0dGltZV9sb2dcXG5cXHRtYW51YWxcXG59XFxuZW51bSBHb2FsRXZlbnRNZXRyaWMge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBOQU1FX1FVQU5USVRZX1JFQ0VOVElucHV0IHtcXG5cXHRuYW1lXFxuXFx0cXVhbnRpdHlcXG5cXHRyZWNlbnRcXG59XFxuZW51bSBGSVhFRF9QUk9CQUJJTElUWV9SQU5ET01fUE9PTElucHV0IHtcXG5cXHRmaXhlZFxcblxcdHByb2JhYmlsaXR5XFxuXFx0cmFuZG9tX3Bvb2xcXG59XFxuZW51bSBDT1VOVF9EVVJBVElPTklucHV0IHtcXG5cXHRjb3VudFxcblxcdGR1cmF0aW9uXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRElucHV0IHtcXG5cXHRhbGxcXG5cXHRhbnlcXG5cXHR3ZWlnaHRlZFxcbn1cXG5lbnVtIEFDVElWSVRZX0dST1VQSW5wdXQge1xcblxcdGFjdGl2aXR5XFxuXFx0Z3JvdXBcXG59XFxuZW51bSBDT01QTEVURV9QUk9HUkVTU0lucHV0IHtcXG5cXHRjb21wbGV0ZVxcblxcdHByb2dyZXNzXFxufVxcbmVudW0gV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZU0lucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPV0lucHV0IHtcXG5cXHRub25lXFxuXFx0b3ZlcmZsb3dcXG59XFxuZW51bSBBQlNPTFVURV9SRUxBVElWRUlucHV0IHtcXG5cXHRhYnNvbHV0ZVxcblxcdHJlbGF0aXZlXFxufVxcbmVudW0gQUNUSVZFX1BBVVNFRF9DT01QTEVURURfQVJDSElWRURfRkFJTEVESW5wdXQge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gUmVjdXJyZW5jZVR5cGVJbnB1dCB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IE9uQ29uZmxpY3RCdWlsZGVyLCBUcmFuc2FjdGlvbiB9IGZyb20gXCJreXNlbHlcIjtcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiO1xuaW1wb3J0IHsgZGIgfSBmcm9tIFwiLi4vLi4vZGIvZGF0YWJhc2UudHNcIjtcbmltcG9ydCB0eXBlIHtcbiAgQWN0aXZpdHkgYXMgQWN0aXZpdHlSb3csXG4gIERhdGFiYXNlLFxuICBHcm91cCBhcyBHcm91cFJvdyxcbiAgTmV3QWN0aXZpdHksXG4gIE5ld0FjdGl2aXR5Q29tcGxldGlvbixcbiAgTmV3R29hbEV2ZW50LFxuICBOZXdHcm91cCxcbiAgTmV3UmVjdXJyZW5jZVBhdHRlcm4sXG4gIFJlY3VycmVuY2VQYXR0ZXJuIGFzIFJlY3VycmVuY2VQYXR0ZXJuUm93LFxufSBmcm9tIFwiLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzXCI7XG5pbXBvcnQgeyByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyB9IGZyb20gXCIuLi8uLi9nb2Fscy9wcm9ncmVzcy50c1wiO1xuaW1wb3J0IHtcbiAgQ29tcGxldGVBY3Rpdml0eUlucHV0LFxuICBDcmVhdGVBY3Rpdml0eUlucHV0LFxuICBDcmVhdGVHcm91cElucHV0LFxuICBMb2dUaW1lSW5wdXQsXG4gIFJlY3VycmVuY2VDb25maWcsXG4gIFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQsXG4gIFVwZGF0ZUFjdGl2aXR5SW5wdXQsXG4gIFVwZGF0ZUdyb3VwSW5wdXQsXG59IGZyb20gXCIuLi90eXBlcy50c1wiO1xuaW1wb3J0IHtcbiAgSW52YWxpZENvbXBsZXRpb25FcnJvcixcbiAgSW52YWxpZEdyb3VwRXJyb3IsXG4gIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSxcbiAgdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMsXG4gIHZhbGlkYXRlR3JvdXBDb2xvcixcbiAgdmFsaWRhdGVHcm91cE5hbWUsXG4gIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUsXG4gIHZhbGlkYXRlUG9zaXRpdmVEdXJhdGlvbixcbn0gZnJvbSBcIi4uL3ZhbGlkYXRpb24udHNcIjtcbmltcG9ydCB7IG5vcm1hbGl6ZU5vdGlmaWNhdGlvbk9mZnNldHMgfSBmcm9tIFwiLi4vbm90aWZpY2F0aW9uX29mZnNldHMudHNcIjtcbmltcG9ydCB7IGFzTnVtYmVyIH0gZnJvbSBcIi4uL251bWVyaWMudHNcIjtcbmltcG9ydCB7IEdvYWxNdXRhdGlvbiwgR29hbFF1ZXJ5IH0gZnJvbSBcIi4vZ29hbHNfcmVzb2x2ZXJzLnRzXCI7XG5pbXBvcnQgeyBSZXdhcmRNdXRhdGlvbiwgUmV3YXJkUXVlcnkgfSBmcm9tIFwiLi9yZXdhcmRzX3Jlc29sdmVycy50c1wiO1xuaW1wb3J0IHtcbiAgZ3JhbnRSZXdhcmRzRm9yQWN0aXZpdHlDb21wbGV0aW9uLFxufSBmcm9tIFwiLi4vLi4vcmV3YXJkcy9ob29rcy50c1wiO1xuaW1wb3J0IHtcbiAgRGJJbnZlbnRvcnlNYW5hZ2VyLFxufSBmcm9tIFwiLi4vLi4vcmV3YXJkcy9pbnZlbnRvcnkudHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRBY3Rpdml0eShhY3Rpdml0eUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eUlkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vLyBQeWxvbiByZXNvbHZlcyBuZXN0ZWQgR3JhcGhRTCBmaWVsZHMgZnJvbSAocG9zc2libHkgYXN5bmMpIHByb3BlcnRpZXMgb25cbi8vIHRoZSByZXR1cm5lZCBvYmplY3QsIG5vdCBmcm9tIGEgc2VwYXJhdGUgcmVzb2x2ZXIgbWFwIFx1MjAxNCBzbyBuZXN0ZWQgZGF0YSBpc1xuLy8gYXR0YWNoZWQgaW5saW5lIGhlcmUgcmF0aGVyIHRoYW4gdmlhIGEgc3RhbmRhbG9uZSByZXNvbHZlciBleHBvcnQuXG5mdW5jdGlvbiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHk6IEFjdGl2aXR5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uYWN0aXZpdHksXG4gICAgcmVjdXJyZW5jZVBhdHRlcm46IGFzeW5jICgpOiBQcm9taXNlPFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKCFhY3Rpdml0eS5pc19yZWN1cnJpbmcpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgcGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkuaWQpO1xuICAgICAgaWYgKCFwYXR0ZXJuKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHBhdHRlcm4uY29uZmlnKTtcbiAgICAgIGlmICghY29uZmlnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IC4uLnBhdHRlcm4sIGNvbmZpZyB9O1xuICAgIH0sXG4gICAgZ3JvdXA6IGFzeW5jICgpOiBQcm9taXNlPEdyb3VwUm93IHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKGFjdGl2aXR5Lmdyb3VwX2lkID09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eS5ncm91cF9pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGdyb3VwczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwibmFtZVwiLCBcImFzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICB9LFxuXG4gIGdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgfSxcblxuICBhY3Rpdml0aWVzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEFjdGl2aXR5UmVsYXRpb25zKTtcbiAgfSxcblxuICBhY3Rpdml0eTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIHJldHVybiByb3cgPyB3aXRoQWN0aXZpdHlSZWxhdGlvbnMocm93KSA6IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdHlDb21wbGV0aW9uczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgYWN0aXZpdHlJZD86IG51bWJlcjtcbiAgICBmcm9tRGF0ZT86IHN0cmluZztcbiAgICB0b0RhdGU/OiBzdHJpbmc7XG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiZGVzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpO1xuXG4gICAgaWYgKGFyZ3M/LmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhcmdzLmFjdGl2aXR5SWQpO1xuICAgIH1cbiAgICBpZiAoYXJncz8uZnJvbURhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI+PVwiLCBhcmdzLmZyb21EYXRlKTtcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIjw9XCIsIGFyZ3MudG9EYXRlKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgfSxcblxuICAuLi5Hb2FsUXVlcnksXG4gIC4uLlJld2FyZFF1ZXJ5LFxufTtcblxuZXhwb3J0IGNvbnN0IE11dGF0aW9uID0ge1xuICBjcmVhdGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUdyb3VwSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKTtcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcik7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50byhcImdyb3Vwc1wiKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY29sb3IsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdHcm91cClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgdXBkYXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVHcm91cElucHV0IH0pID0+IHtcbiAgICBjb25zdCB7IGlkLCBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IG5hbWUgPSBpbnB1dC5uYW1lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVHcm91cE5hbWUoaW5wdXQubmFtZSlcbiAgICAgIDogZXhpc3RpbmcubmFtZTtcbiAgICBjb25zdCBjb2xvciA9IGlucHV0LmNvbG9yICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKVxuICAgICAgOiBleGlzdGluZy5jb2xvcjtcblxuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKFwiZ3JvdXBzXCIpXG4gICAgICAuc2V0KHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY29sb3IsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9LFxuXG4gIGRlbGV0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKTtcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMDtcbiAgfSxcblxuICBjcmVhdGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUFjdGl2aXR5SW5wdXQgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoe1xuICAgICAgaXNSZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICAgIHJlY3VycmVuY2VQYXR0ZXJuOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybixcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbk9mZnNldHMgPSBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKFxuICAgICAgaW5wdXQubm90aWZpY2F0aW9uT2Zmc2V0cyxcbiAgICApO1xuICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkID8/IG51bGwsIHVzZXJJZCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpbnB1dC5pc1JlY3VycmluZyA/IG51bGwgOiAoaW5wdXQuZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICBncm91cF9pZDogZ3JvdXBJZCA/PyBudWxsLFxuICAgICAgICAgIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBub3RpZmljYXRpb25PZmZzZXRzLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpbnB1dC5pc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHkpO1xuICB9LFxuXG4gIHVwZGF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkLCBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBjb25zdCBpc1JlY3VycmluZyA9IGlucHV0LmlzUmVjdXJyaW5nID8/IGV4aXN0aW5nLmlzX3JlY3VycmluZztcbiAgICBjb25zdCBkYXRlID0gaW5wdXQuZGF0ZSAhPT0gdW5kZWZpbmVkID8gaW5wdXQuZGF0ZSA6IGV4aXN0aW5nLmRhdGU7XG5cbiAgICAvLyBJZiB0aGUgc2NoZWR1bGUgaXMgc3RpbGwgcmVjdXJyaW5nIGFuZCBubyBuZXcgcGF0dGVybiB3YXMgc3VwcGxpZWQsXG4gICAgLy8gdmFsaWRhdGUgYWdhaW5zdCB0aGUgcGF0dGVybiBhbHJlYWR5IG9uIGZpbGUuXG4gICAgbGV0IHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCA9IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuO1xuICAgIGlmIChpc1JlY3VycmluZyAmJiAhcmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oaWQpO1xuICAgICAgaWYgKGV4aXN0aW5nUGF0dGVybikge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwYXJzZUNvbmZpZyhleGlzdGluZ1BhdHRlcm4uY29uZmlnKTtcbiAgICAgICAgcmVjdXJyZW5jZVBhdHRlcm4gPSBjb25maWdcbiAgICAgICAgICA/IHsgcmVjdXJyZW5jZVR5cGU6IGV4aXN0aW5nUGF0dGVybi5yZWN1cnJlbmNlX3R5cGUsIGNvbmZpZyB9XG4gICAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKHsgaXNSZWN1cnJpbmcsIGRhdGUsIHJlY3VycmVuY2VQYXR0ZXJuIH0pO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRHcm91cElkID0gaW5wdXQuZ3JvdXBJZCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IGF3YWl0IHJlc29sdmVHcm91cElkKGlucHV0Lmdyb3VwSWQsIHVzZXJJZClcbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uT2Zmc2V0cyA9IGlucHV0Lm5vdGlmaWNhdGlvbk9mZnNldHMgIT09IHVuZGVmaW5lZFxuICAgICAgPyBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKGlucHV0Lm5vdGlmaWNhdGlvbk9mZnNldHMpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlzUmVjdXJyaW5nID8gbnVsbCA6IChkYXRlID8/IG51bGwpLFxuICAgICAgICAgIC4uLihyZXNvbHZlZEdyb3VwSWQgIT09IHVuZGVmaW5lZCA/IHsgZ3JvdXBfaWQ6IHJlc29sdmVkR3JvdXBJZCB9IDoge30pLFxuICAgICAgICAgIC4uLihub3RpZmljYXRpb25PZmZzZXRzICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBub3RpZmljYXRpb25fb2Zmc2V0czogbm90aWZpY2F0aW9uT2Zmc2V0cyB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5vbkNvbmZsaWN0KChvYzogT25Db25mbGljdEJ1aWxkZXI8YW55LCBhbnk+KSA9PlxuICAgICAgICAgICAgb2MuY29sdW1ucyhbXCJhY3Rpdml0eV9pZFwiXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEuY29uZmlnKSxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH0gZWxzZSBpZiAoIWlzUmVjdXJyaW5nKSB7XG4gICAgICAgIC8vIENsZWFuIHVwIGFueSBzdGFsZSBwYXR0ZXJuIG9uY2UgYW4gYWN0aXZpdHkgc3RvcHMgcmVjdXJyaW5nLlxuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuZGVsZXRlRnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgZGVsZXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXIgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNvbXBsZXRlQWN0aXZpdHk6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShpbnB1dC5vY2N1cnJlbmNlRGF0ZSk7XG4gICAgY29uc3QgZHVyYXRpb25NaW51dGVzID0gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMoaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgIC53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIj1cIiwgb2NjdXJyZW5jZURhdGUpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgZHVyYXRpb25fbWludXRlczogZHVyYXRpb25NaW51dGVzLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcywgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pXG4gICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5Q29tcGxldGlvbilcbiAgICAgICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgICAgIG9jLmNvbHVtbnMoW1wiYWN0aXZpdHlfaWRcIiwgXCJvY2N1cnJlbmNlX2RhdGVcIl0pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgIGR1cmF0aW9uX21pbnV0ZXM6IGR1cmF0aW9uTWludXRlcyxcbiAgICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMsIHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KVxuICAgICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICAvLyBDb3VudCBldmVudFxuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHNvdXJjZV90eXBlOiBcImNvbXBsZXRpb25cIixcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgIGNvbXBsZXRpb25faWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgIG1ldHJpYzogXCJjb3VudFwiLFxuICAgICAgICAgIGFtb3VudDogMSxcbiAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgICAvLyBPcHRpb25hbCBkdXJhdGlvbiBldmVudCB3aGVuIG1pbnV0ZXMgcHJvdmlkZWQgb3IgZGVyaXZlZCBmcm9tIHNjaGVkdWxlLlxuICAgICAgbGV0IG1pbnV0ZXMgPSBkdXJhdGlvbk1pbnV0ZXM7XG4gICAgICBpZiAobWludXRlcyA9PSBudWxsKSB7XG4gICAgICAgIC8vIERlcml2ZSBmcm9tIHNjaGVkdWxlZCBzbG90IHdoZW4gcG9zc2libGUuXG4gICAgICAgIGNvbnN0IFtzaCwgc21dID0gYWN0aXZpdHkuc3RhcnRfdGltZS5zcGxpdChcIjpcIikubWFwKE51bWJlcik7XG4gICAgICAgIGNvbnN0IFtlaCwgZW1dID0gYWN0aXZpdHkuZW5kX3RpbWUuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgICAgICBjb25zdCBkZXJpdmVkID0gKGVoICogNjAgKyBlbSkgLSAoc2ggKiA2MCArIHNtKTtcbiAgICAgICAgaWYgKGRlcml2ZWQgPiAwKSBtaW51dGVzID0gZGVyaXZlZDtcbiAgICAgIH1cbiAgICAgIGlmIChtaW51dGVzICE9IG51bGwgJiYgbWludXRlcyA+IDApIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgc291cmNlX3R5cGU6IFwiY29tcGxldGlvblwiLFxuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgICAgY29tcGxldGlvbl9pZDogY29tcGxldGlvbi5pZCxcbiAgICAgICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICBhbW91bnQ6IG1pbnV0ZXMsXG4gICAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgICB9KTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgfSk7XG5cbiAgICBjb25zdCBncmFudGVkID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24odHJ4LCB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICAgIGNvbXBsZXRpb25JZDogY29tcGxldGlvbi5pZCxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmNvbXBsZXRpb24sXG4gICAgICBncmFudGVkUmV3YXJkczogZ3JhbnRlZFxuICAgICAgICAuZmlsdGVyKChnKSA9PiAhZy5za2lwcGVkICYmIGcudHJhbnNhY3Rpb24pXG4gICAgICAgIC5tYXAoKGcpID0+IGcudHJhbnNhY3Rpb24pLFxuICAgIH07XG4gIH0sXG5cbiAgdW5kb0NvbXBsZXRpb246IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgYXJncy5pZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShleGlzdGluZy5hY3Rpdml0eV9pZCwgdXNlcklkKTtcblxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBtYW5hZ2VyID0gbmV3IERiSW52ZW50b3J5TWFuYWdlcigpO1xuICAgICAgYXdhaXQgbWFuYWdlci5yZXZva2VVbmNvbnN1bWVkRm9yQ29tcGxldGlvbih0cngsIHVzZXJJZCwgZXhpc3RpbmcuaWQpO1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5kZWxldGVGcm9tKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLndoZXJlKFwiY29tcGxldGlvbl9pZFwiLCBcIj1cIiwgZXhpc3RpbmcuaWQpXG4gICAgICAgIC5leGVjdXRlKCk7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgZXhpc3RpbmcuaWQpXG4gICAgICAgIC5leGVjdXRlKCk7XG4gICAgfSk7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhkYiwgdXNlcklkLCB7XG4gICAgICBhY3Rpdml0eUlkOiBleGlzdGluZy5hY3Rpdml0eV9pZCxcbiAgICAgIGdyb3VwSWQ6IGFjdGl2aXR5Py5ncm91cF9pZCA/PyBudWxsLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgbG9nVGltZTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IExvZ1RpbWVJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgbWludXRlcyA9IHZhbGlkYXRlUG9zaXRpdmVEdXJhdGlvbihpbnB1dC5kdXJhdGlvbk1pbnV0ZXMpO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShcbiAgICAgIGlucHV0Lm9jY3VycmVuY2VEYXRlID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGV2ZW50ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIHNvdXJjZV90eXBlOiBcInRpbWVfbG9nXCIsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBudWxsLFxuICAgICAgICBvY2N1cnJlZF9hdDogbm93LFxuICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICBtZXRyaWM6IFwiZHVyYXRpb25cIixcbiAgICAgICAgYW1vdW50OiBtaW51dGVzLFxuICAgICAgICBtZXRhZGF0YTogaW5wdXQubm90ZXNcbiAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHsgbm90ZXM6IGlucHV0Lm5vdGVzIH0pXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhkYiwgdXNlcklkLCB7XG4gICAgICBhY3Rpdml0eUlkOiBhY3Rpdml0eS5pZCxcbiAgICAgIGdyb3VwSWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgYW1vdW50OiBhc051bWJlcihldmVudC5hbW91bnQpLFxuICAgIH07XG4gIH0sXG5cbiAgLi4uR29hbE11dGF0aW9uLFxuICAuLi5SZXdhcmRNdXRhdGlvbixcbn07XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7XG4gIFF1ZXJ5LFxuICBNdXRhdGlvbixcbn07XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vLyBNYWluIERhdGFiYXNlIGludGVyZmFjZSB0aGF0IGRlc2NyaWJlcyBhbGwgdGFibGVzXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgZ3JvdXBzOiBHcm91cHNUYWJsZVxuICBhY3Rpdml0aWVzOiBBY3Rpdml0aWVzVGFibGVcbiAgcmVjdXJyZW5jZV9wYXR0ZXJuczogUmVjdXJyZW5jZVBhdHRlcm5zVGFibGVcbiAgYWN0aXZpdHlfY29tcGxldGlvbnM6IEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZVxuICBnb2FsX2V2ZW50czogR29hbEV2ZW50c1RhYmxlXG4gIGdvYWxzOiBHb2Fsc1RhYmxlXG4gIGdvYWxfbGlua3M6IEdvYWxMaW5rc1RhYmxlXG4gIGdvYWxfY3ljbGVzOiBHb2FsQ3ljbGVzVGFibGVcbiAgZ29hbF9kZXBlbmRlbmNpZXM6IEdvYWxEZXBlbmRlbmNpZXNUYWJsZVxuICBnb2FsX3Byb2dyZXNzX3NuYXBzaG90czogR29hbFByb2dyZXNzU25hcHNob3RzVGFibGVcbiAgYXNzZXRzOiBBc3NldHNUYWJsZVxuICByZXdhcmRfZGVmaW5pdGlvbnM6IFJld2FyZERlZmluaXRpb25zVGFibGVcbiAgcmV3YXJkX3J1bGVzOiBSZXdhcmRSdWxlc1RhYmxlXG4gIHJld2FyZF9pbnZlbnRvcnk6IFJld2FyZEludmVudG9yeVRhYmxlXG4gIHJld2FyZF90cmFuc2FjdGlvbnM6IFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlXG59XG5cbi8vIFVzZXJzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3VwZXJUb2tlbnMgdXNlciBpZCBcdTIwMTQgbGlua3MgU1NPIGlkZW50aXR5IHRvIGxvY2FsIHJvd3MuICovXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBHcm91cHMgdGFibGUgaW50ZXJmYWNlIFx1MjAxNCB1c2VyLXNjb3BlZCBhY3Rpdml0eSB0YXhvbm9teSB3aXRoIGRpc3BsYXkgY29sb3IuXG5leHBvcnQgaW50ZXJmYWNlIEdyb3Vwc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLy8gSGV4IGNvbG9yIGZyb20gdGhlIHNoYXJlZCBwcmVzZXQgcGFsZXR0ZSwgZS5nLiBcIiMwRjc2NkVcIlxuICBjb2xvcjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdGllcyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdGllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICAvLyBPcHRpb25hbCBncm91cCBhc3NpZ25tZW50LiBOdWxsIHdoZW4gdW5ncm91cGVkOyBjbGVhcmVkIGlmIHRoZSBncm91cFxuICAvLyBpcyBkZWxldGVkIChPTiBERUxFVEUgU0VUIE5VTEwpLlxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIHN0YXJ0X3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgZW5kX3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgaXNfcmVjdXJyaW5nOiBib29sZWFuXG4gIC8vIENhbGVuZGFyIGRhdGUgdGhlIGFjdGl2aXR5IG9jY3VycyBvbi4gUmVxdWlyZWQgd2hlbiBpc19yZWN1cnJpbmcgaXNcbiAgLy8gZmFsc2U7IG51bGwgd2hlbiBpc19yZWN1cnJpbmcgaXMgdHJ1ZSAoZGF0ZXMgbGl2ZSBpbiB0aGUgcmVjdXJyZW5jZVxuICAvLyBwYXR0ZXJuJ3MgY29uZmlnIGluc3RlYWQpLlxuICBkYXRlOiBzdHJpbmcgfCBudWxsXG4gIC8vIE1pbnV0ZXMgYmVmb3JlIHN0YXJ0X3RpbWUgdG8gZmlyZSBhIGxvY2FsIHJlbWluZGVyOyAwID0gYXQgc3RhcnQuXG4gIC8vIEVtcHR5IGFycmF5ID0gbm8gcmVtaW5kZXJzLiBNYXggOCB1bmlxdWUgdmFsdWVzIGluIFswLCAxMDA4MF0uXG4gIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBudW1iZXJbXVxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIFJlY3VycmVuY2UgcGF0dGVybnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgLy8gVHlwZSBvZiByZWN1cnJlbmNlOiB3ZWVrbHksIG1vbnRobHksIG9yIGV2ZXJ5IFggZGF5c1xuICByZWN1cnJlbmNlX3R5cGU6ICd3ZWVrbHknIHwgJ21vbnRobHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgLy8gSlNPTiBjb25maWd1cmF0aW9uIGZvciB0aGUgcmVjdXJyZW5jZVxuICBjb25maWc6IENvbHVtblR5cGU8e1xuICAgIC8vIEZvciB3ZWVrbHk6IGFycmF5IG9mIGRheXMgKDAtNiwgd2hlcmUgMCBpcyBTdW5kYXkpXG4gICAgZGF5c19vZl93ZWVrPzogbnVtYmVyW11cbiAgICAvLyBGb3IgbW9udGhseTogZGF5cyBvZiB0aGUgbW9udGggKDEtMzEpXG4gICAgZGF5c19vZl9tb250aD86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGFsc28gcmVwZWF0IG9uIHRoZSBsYXN0IGRheSBvZiB0aGUgbW9udGguIEtlcHQgYXMgaXRzXG4gICAgLy8gb3duIGJvb2xlYW4gKHJhdGhlciB0aGFuIGEgJ2xhc3QnIHNlbnRpbmVsIGluIGRheXNfb2ZfbW9udGgpIGJlY2F1c2VcbiAgICAvLyBQeWxvbi9HcmFwaFFMIGlucHV0IHR5cGVzIGNhbid0IHJlcHJlc2VudCBhIG51bWJlcnxzdHJpbmcgdW5pb24uXG4gICAgaXNfbGFzdF9kYXlfb2ZfbW9udGg/OiBib29sZWFuXG4gICAgLy8gRm9yIGV2ZXJ5X3hfZGF5czogcmVwZWF0IGV2ZXJ5IE4gZGF5cyAoPj0gMSlcbiAgICBpbnRlcnZhbF9kYXlzPzogbnVtYmVyXG4gICAgLy8gU3RhcnQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZVxuICAgIHN0YXJ0X2RhdGU6IHN0cmluZ1xuICAgIC8vIEVuZCBkYXRlIG9mIHRoZSByZWN1cnJlbmNlIChvcHRpb25hbClcbiAgICBlbmRfZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgfSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdHkgY29tcGxldGlvbnMgXHUyMDE0IG9uZSByb3cgcGVyIChhY3Rpdml0eSwgb2NjdXJyZW5jZV9kYXRlKVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgYWN0aXZpdHlfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgb2NjdXJyZW5jZV9kYXRlOiBzdHJpbmdcbiAgZHVyYXRpb25fbWludXRlczogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBuZXZlcj5cbiAgLy8gU3RvcmUgYW55IGFkZGl0aW9uYWwgZGF0YSBhYm91dCB0aGUgY29tcGxldGlvblxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTx7XG4gICAgdGl0bGU/OiBzdHJpbmdcbiAgICBub3Rlcz86IHN0cmluZ1xuICAgIHRyaWdnZXJfZXZlbnRzPzogc3RyaW5nW11cbiAgfSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxFdmVudFNvdXJjZVR5cGUgPSAnY29tcGxldGlvbicgfCAndGltZV9sb2cnIHwgJ21hbnVhbCdcbmV4cG9ydCB0eXBlIEdvYWxFdmVudE1ldHJpYyA9ICdjb3VudCcgfCAnZHVyYXRpb24nXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEV2ZW50c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBzb3VyY2VfdHlwZTogR29hbEV2ZW50U291cmNlVHlwZVxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIG9jY3VycmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nIHwgbnVsbFxuICBtZXRyaWM6IEdvYWxFdmVudE1ldHJpY1xuICBhbW91bnQ6IG51bWJlclxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IHR5cGUgR29hbFN0YXR1cyA9ICdhY3RpdmUnIHwgJ3BhdXNlZCcgfCAnY29tcGxldGVkJyB8ICdhcmNoaXZlZCcgfCAnZmFpbGVkJ1xuZXhwb3J0IHR5cGUgR29hbE1ldHJpYyA9ICdjb3VudCcgfCAnZHVyYXRpb24nXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbFJlY3VycmVuY2VDb25maWcge1xuICBwZXJpb2Q6ICd3ZWVrbHknIHwgJ21vbnRobHknIHwgJ3F1YXJ0ZXJseScgfCAnZXZlcnlfeF9kYXlzJ1xuICBpbnRlcnZhbD86IG51bWJlclxuICBhbmNob3I/OiBzdHJpbmdcbiAgY2Fycnlfb3Zlcj86ICdub25lJyB8ICdvdmVyZmxvdydcbiAgcmVzZXQ/OiAnaGFyZCdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRGVhZGxpbmVDb25maWcge1xuICBraW5kOiAnYWJzb2x1dGUnIHwgJ3JlbGF0aXZlJ1xuICBkYXRlPzogc3RyaW5nXG4gIGRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQ/OiBudW1iZXJcbiAgZ3JhY2VfZGF5cz86IG51bWJlclxuICB3YXJuX2RheXM/OiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsQ29uZmlnIHtcbiAgY29tcG9zaXRlX21vZGU/OiAnYWxsJyB8ICdhbnknIHwgJ3dlaWdodGVkJ1xuICBjb3VudF9yZXF1aXJlZD86IG51bWJlclxuICBiZWZvcmVfdGltZT86IHN0cmluZ1xuICBhZnRlcl90aW1lPzogc3RyaW5nXG4gIGJsb2NrX3VudGlsX3VubG9ja2VkPzogYm9vbGVhblxuICBba2V5OiBzdHJpbmddOiB1bmtub3duXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBjb2xvcjogc3RyaW5nXG4gIGljb246IHN0cmluZyB8IG51bGxcbiAgcnVsZV90eXBlOiBzdHJpbmdcbiAgbWV0cmljOiBHb2FsTWV0cmljXG4gIHRhcmdldF92YWx1ZTogbnVtYmVyXG4gIGNvbmZpZzogQ29sdW1uVHlwZTxHb2FsQ29uZmlnLCBzdHJpbmcgfCBHb2FsQ29uZmlnLCBzdHJpbmcgfCBHb2FsQ29uZmlnPlxuICBzdGF0dXM6IEdvYWxTdGF0dXNcbiAgcmVjdXJyZW5jZTogQ29sdW1uVHlwZTxcbiAgICBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbFxuICA+XG4gIGRlYWRsaW5lOiBDb2x1bW5UeXBlPFxuICAgIEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsXG4gID5cbiAgcHJpb3JpdHk6IG51bWJlclxuICBzb3J0X29yZGVyOiBudW1iZXJcbiAgLyoqIEVmZmVjdGl2ZSBzdGFydCBvZiB0aGUgZ29hbCAoc2VlZHMgY3ljbGUgMCkuIEFsd2F5cyBzZXQuICovXG4gIHN0YXJ0c19hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsTGlua1R5cGUgPSAnYWN0aXZpdHknIHwgJ2dyb3VwJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxMaW5rc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBsaW5rX3R5cGU6IEdvYWxMaW5rVHlwZVxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB3ZWlnaHQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxDeWNsZVN0YXR1cyA9ICdhY3RpdmUnIHwgJ3N1Y2NlZWRlZCcgfCAnZmFpbGVkJyB8ICdtaXNzZWQnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEN5Y2xlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBjeWNsZV9pbmRleDogbnVtYmVyXG4gIHN0YXJ0c19hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgZW5kc19hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgZGVhZGxpbmVfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIHRhcmdldF92YWx1ZTogbnVtYmVyXG4gIGN1cnJlbnRfdmFsdWU6IG51bWJlclxuICBzdGF0dXM6IEdvYWxDeWNsZVN0YXR1c1xuICBjYXJyeV9vdmVyOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50ID0gJ2NvbXBsZXRlJyB8ICdwcm9ncmVzcydcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRGVwZW5kZW5jaWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGRlcGVuZHNfb25fZ29hbF9pZDogbnVtYmVyXG4gIHJlcXVpcmVtZW50OiBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50XG4gIHRocmVzaG9sZDogbnVtYmVyIHwgbnVsbFxuICB3ZWlnaHQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbFByb2dyZXNzU25hcHNob3RzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9jeWNsZV9pZDogbnVtYmVyXG4gIGFzX29mOiBzdHJpbmdcbiAgdmFsdWU6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbi8vIEV4cG9ydCBjb252ZW5pZW5jZSB0eXBlcyBmb3IgZWFjaCB0YWJsZVxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1VzZXIgPSBJbnNlcnRhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBVc2VyVXBkYXRlID0gVXBkYXRlYWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHcm91cCA9IFNlbGVjdGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHcm91cCA9IEluc2VydGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBHcm91cFVwZGF0ZSA9IFVwZGF0ZWFibGU8R3JvdXBzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5ID0gU2VsZWN0YWJsZTxBY3Rpdml0aWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eSA9IEluc2VydGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlVcGRhdGUgPSBVcGRhdGVhYmxlPEFjdGl2aXRpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm4gPSBTZWxlY3RhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmVjdXJyZW5jZVBhdHRlcm4gPSBJbnNlcnRhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm5VcGRhdGUgPSBVcGRhdGVhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eUNvbXBsZXRpb24gPSBTZWxlY3RhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0FjdGl2aXR5Q29tcGxldGlvbiA9IEluc2VydGFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxFdmVudCA9IFNlbGVjdGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbEV2ZW50ID0gSW5zZXJ0YWJsZTxHb2FsRXZlbnRzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsRXZlbnRVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxFdmVudHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbCA9IFNlbGVjdGFibGU8R29hbHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWwgPSBJbnNlcnRhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsVXBkYXRlID0gVXBkYXRlYWJsZTxHb2Fsc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsTGluayA9IFNlbGVjdGFibGU8R29hbExpbmtzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsTGluayA9IEluc2VydGFibGU8R29hbExpbmtzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsTGlua1VwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbExpbmtzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxDeWNsZSA9IFNlbGVjdGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbEN5Y2xlID0gSW5zZXJ0YWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsQ3ljbGVVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxDeWNsZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3kgPSBTZWxlY3RhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxEZXBlbmRlbmN5ID0gSW5zZXJ0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsRGVwZW5kZW5jeVVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsUHJvZ3Jlc3NTbmFwc2hvdCA9IFNlbGVjdGFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsUHJvZ3Jlc3NTbmFwc2hvdCA9IEluc2VydGFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsUHJvZ3Jlc3NTbmFwc2hvdFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQXNzZXRzICYgUmV3YXJkc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNoYTI1Njogc3RyaW5nXG4gIGNvbnRlbnRfdHlwZTogc3RyaW5nXG4gIGJ5dGVfc2l6ZTogbnVtYmVyXG4gIHN0b3JhZ2Vfa2V5OiBzdHJpbmdcbiAgcmVmX2NvdW50OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICBvcnBoYW5lZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmREZWZpbml0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgbm90ZXM6IHN0cmluZyB8IG51bGxcbiAgY2F0ZWdvcnk6IHN0cmluZyB8IG51bGxcbiAgdGFnczogQ29sdW1uVHlwZTxzdHJpbmdbXSwgc3RyaW5nIHwgc3RyaW5nW10sIHN0cmluZyB8IHN0cmluZ1tdPlxuICBjb2xvcjogc3RyaW5nXG4gIGljb246IHN0cmluZyB8IG51bGxcbiAgaW1hZ2VfYXNzZXRfaWQ6IG51bWJlciB8IG51bGxcbiAgc3RhY2thYmxlOiBib29sZWFuXG4gIGRlZmF1bHRfcXVhbnRpdHk6IG51bWJlclxuICBzb3J0X29yZGVyOiBudW1iZXJcbiAgYXJjaGl2ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgUmV3YXJkUnVsZU1vZGUgPSAnZml4ZWQnIHwgJ3Byb2JhYmlsaXR5JyB8ICdyYW5kb21fcG9vbCdcblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgb25jZT86IGJvb2xlYW5cbiAgY29vbGRvd25faG91cnM/OiBudW1iZXJcbiAgbWF4X2dyYW50c190b3RhbD86IG51bWJlclxuICBtYXhfZ3JhbnRzX3Blcl9wZXJpb2Q/OiBudW1iZXJcbiAgcGVyaW9kX2hvdXJzPzogbnVtYmVyXG4gIHByb2JhYmlsaXR5PzogbnVtYmVyXG4gIC8qKiBQb29sIG9mIGRlZmluaXRpb24gaWRzIGZvciByYW5kb21fcG9vbCBtb2RlLiAqL1xuICBwb29sPzogQXJyYXk8eyBkZWZpbml0aW9uX2lkOiBudW1iZXI7IHdlaWdodD86IG51bWJlcjsgcXVhbnRpdHk/OiBudW1iZXIgfT5cbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZFJ1bGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNvdXJjZV90eXBlOiBzdHJpbmdcbiAgc291cmNlX2lkOiBudW1iZXJcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlclxuICBxdWFudGl0eTogbnVtYmVyXG4gIG1vZGU6IFJld2FyZFJ1bGVNb2RlXG4gIGNvbmZpZzogQ29sdW1uVHlwZTxcbiAgICBSZXdhcmRSdWxlQ29uZmlnLFxuICAgIHN0cmluZyB8IFJld2FyZFJ1bGVDb25maWcsXG4gICAgc3RyaW5nIHwgUmV3YXJkUnVsZUNvbmZpZ1xuICA+XG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZEludmVudG9yeVRhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICByZXdhcmRfZGVmaW5pdGlvbl9pZDogbnVtYmVyXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgc3RhY2tfa2V5OiBzdHJpbmcgfCBudWxsXG4gIGZpcnN0X2Vhcm5lZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgbGFzdF9lYXJuZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uVHlwZSA9XG4gIHwgJ2Vhcm4nXG4gIHwgJ2NvbnN1bWUnXG4gIHwgJ2RlbGV0ZSdcbiAgfCAncmVzdG9yZSdcbiAgfCAnYWRqdXN0J1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICB0eXBlOiBSZXdhcmRUcmFuc2FjdGlvblR5cGVcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgaW52ZW50b3J5X2lkOiBudW1iZXIgfCBudWxsXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgZGVmaW5pdGlvbl9uYW1lOiBzdHJpbmdcbiAgZGVmaW5pdGlvbl9jb2xvcjogc3RyaW5nXG4gIGRlZmluaXRpb25faWNvbjogc3RyaW5nIHwgbnVsbFxuICBpbWFnZV9hc3NldF9pZDogbnVtYmVyIHwgbnVsbFxuICBzb3VyY2VfdHlwZTogc3RyaW5nIHwgbnVsbFxuICBzb3VyY2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdHJpZ2dlcl9rZXk6IHN0cmluZyB8IG51bGxcbiAgcnVsZV9pZDogbnVtYmVyIHwgbnVsbFxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBnb2FsX2lkOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgY3ljbGVfaWQ6IG51bWJlciB8IG51bGxcbiAgbm90ZTogc3RyaW5nIHwgbnVsbFxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTxcbiAgICBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwsXG4gICAgc3RyaW5nIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBudWxsXG4gID5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBBc3NldCA9IFNlbGVjdGFibGU8QXNzZXRzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBc3NldCA9IEluc2VydGFibGU8QXNzZXRzVGFibGU+XG5leHBvcnQgdHlwZSBBc3NldFVwZGF0ZSA9IFVwZGF0ZWFibGU8QXNzZXRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZERlZmluaXRpb24gPSBTZWxlY3RhYmxlPFJld2FyZERlZmluaXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZXdhcmREZWZpbml0aW9uID0gSW5zZXJ0YWJsZTxSZXdhcmREZWZpbml0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmV3YXJkRGVmaW5pdGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkRGVmaW5pdGlvbnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmV3YXJkUnVsZSA9IFNlbGVjdGFibGU8UmV3YXJkUnVsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZFJ1bGUgPSBJbnNlcnRhYmxlPFJld2FyZFJ1bGVzVGFibGU+XG5leHBvcnQgdHlwZSBSZXdhcmRSdWxlVXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmRSdWxlc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBSZXdhcmRJbnZlbnRvcnkgPSBTZWxlY3RhYmxlPFJld2FyZEludmVudG9yeVRhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmV3YXJkSW52ZW50b3J5ID0gSW5zZXJ0YWJsZTxSZXdhcmRJbnZlbnRvcnlUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZEludmVudG9yeVVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkSW52ZW50b3J5VGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uID0gU2VsZWN0YWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZFRyYW5zYWN0aW9uID0gSW5zZXJ0YWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cbiIsICJpbXBvcnQgeyBEYXRhYmFzZSB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgUG9vbCwgdHlwZXMgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgc3NsRm9yRGF0YWJhc2VVcmwgfSBmcm9tICcuL3NzbC50cydcblxuLy8gS2VlcCBQb3N0Z3JlcyBgZGF0ZWAgYXMgYFlZWVktTU0tRERgIHN0cmluZ3MuIFRoZSBkZWZhdWx0IHBnIHBhcnNlciB0dXJuc1xuLy8gdGhlbSBpbnRvIEpTIERhdGUgb2JqZWN0cywgd2hpY2ggR3JhcGhRTCB0aGVuIHN0cmluZ2lmaWVzIGFzIGZ1bGwgdGltZXN0YW1wc1xuLy8gKG9yIERhdGUudG9TdHJpbmcoKSkgYW5kIGJyZWFrcyBGbHV0dGVyJ3MgZGF0ZS1vbmx5IHBhcnNpbmcuXG50eXBlcy5zZXRUeXBlUGFyc2VyKHR5cGVzLmJ1aWx0aW5zLkRBVEUsICh2YWx1ZTogc3RyaW5nKSA9PiB2YWx1ZSlcblxuZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIERlbm8uZW52LmdldChuYW1lKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuZnVuY3Rpb24gcG9vbENvbmZpZ0Zyb21FbnYoKTogQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBQb29sPlswXSB7XG4gIGNvbnN0IGRhdGFiYXNlVXJsID0gZW52KCdEQVRBQkFTRV9VUkwnKVxuICBpZiAoZGF0YWJhc2VVcmwpIHtcbiAgICBjb25zdCBzc2wgPSBzc2xGb3JEYXRhYmFzZVVybChkYXRhYmFzZVVybClcbiAgICByZXR1cm4ge1xuICAgICAgY29ubmVjdGlvblN0cmluZzogZGF0YWJhc2VVcmwsXG4gICAgICBtYXg6IDEwLFxuICAgICAgLi4uKHNzbCA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHNzbCB9KSxcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlOiBlbnYoJ1BHREFUQUJBU0UnKSA/PyAndGltZW1hbmFnZXInLFxuICAgIGhvc3Q6IGVudignUEdIT1NUJykgPz8gJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogZW52KCdQR1VTRVInKSA/PyAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiBlbnYoJ1BHUEFTU1dPUkQnKSA/PyAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IE51bWJlcihlbnYoJ1BHUE9SVCcpID8/ICc1NDMyJyksXG4gICAgbWF4OiAxMCxcbiAgfVxufVxuXG5jb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gIHBvb2w6IG5ldyBQb29sKHBvb2xDb25maWdGcm9tRW52KCkpLFxufSlcblxuLy8gRGF0YWJhc2UgaW50ZXJmYWNlIGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLFxuLy8ga25vd3MgeW91ciBkYXRhYmFzZSBzdHJ1Y3R1cmUuXG4vLyBEaWFsZWN0IGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLCBLeXNlbHkga25vd3MgaG93XG4vLyB0byBjb21tdW5pY2F0ZSB3aXRoIHlvdXIgZGF0YWJhc2UuXG5leHBvcnQgY29uc3QgZGIgPSBuZXcgS3lzZWx5PERhdGFiYXNlPih7XG4gIGRpYWxlY3QsXG59KVxuIiwgIi8qKiBUTFMgb3B0aW9ucyBmb3IgYHBnYCBmcm9tIGEgUG9zdGdyZXMgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNzbEZvckRhdGFiYXNlVXJsKFxuICBkYXRhYmFzZVVybDogc3RyaW5nLFxuKTogZmFsc2UgfCB7IHJlamVjdFVuYXV0aG9yaXplZDogYm9vbGVhbiB9IHwgdW5kZWZpbmVkIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzc2xtb2RlJyk/LnRvTG93ZXJDYXNlKClcbiAgaWYgKG1vZGUgPT09ICdkaXNhYmxlJykgcmV0dXJuIGZhbHNlXG4gIGlmIChtb2RlID09PSAncmVxdWlyZScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1jYScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1mdWxsJykge1xuICAgIC8vIFJEUyB1c2VzIEFtYXpvbiBDQXM7IHNraXAgdmVyaWZ5IHVubGVzcyBhIENBIGJ1bmRsZSBpcyBtb3VudGVkLlxuICAgIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxuICB9XG5cbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZVxuICBpZiAoaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdCA9PT0gJzEyNy4wLjAuMScpIHJldHVybiB1bmRlZmluZWRcblxuICAvLyBOb24tbG9jYWwgVVJMcyAoZS5nLiBSRFMpIHR5cGljYWxseSByZXF1aXJlIFRMUyBldmVuIGlmIHNzbG1vZGUgaXMgb21pdHRlZC5cbiAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBHb2FsLCBHb2FsQ3ljbGUgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIEdvYWxMaWZlY3ljbGVQaGFzZSA9XG4gIHwgJ3NjaGVkdWxlZCdcbiAgfCAnYWN0aXZlJ1xuICB8ICdwYXVzZWQnXG4gIHwgJ2NvbXBsZXRlZCdcbiAgfCAnYXJjaGl2ZWQnXG4gIHwgJ2ZhaWxlZCdcblxuLyoqIERlcml2ZWQgVUkvQVBJIHBoYXNlIFx1MjAxNCBzY2hlZHVsZWQgaXMgbm90IGEgc3RvcmVkIHN0YXR1cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsaWZlY3ljbGVQaGFzZShcbiAgZ29hbDogUGljazxHb2FsLCAnc3RhdHVzJyB8ICdzdGFydHNfYXQnPixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IEdvYWxMaWZlY3ljbGVQaGFzZSB7XG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ3BhdXNlZCcpIHJldHVybiAncGF1c2VkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdjb21wbGV0ZWQnKSByZXR1cm4gJ2NvbXBsZXRlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnYXJjaGl2ZWQnKSByZXR1cm4gJ2FyY2hpdmVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdmYWlsZWQnKSByZXR1cm4gJ2ZhaWxlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJiBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdCkgPiBub3cpIHtcbiAgICByZXR1cm4gJ3NjaGVkdWxlZCdcbiAgfVxuICByZXR1cm4gJ2FjdGl2ZSdcbn1cblxuLyoqIFRydWUgd2hlbiB0aGUgY3ljbGUgZXZhbHVhdGlvbiB3aW5kb3cgaGFzIGJlZ3VuLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGN5Y2xlSGFzU3RhcnRlZChcbiAgY3ljbGU6IFBpY2s8R29hbEN5Y2xlLCAnc3RhcnRzX2F0Jz4sXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vdyA+PSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpXG59XG4iLCAiaW1wb3J0IHR5cGUge1xuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxFdmVudCxcbiAgR29hbExpbmssXG59IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZVJlc3VsdCB7XG4gIGN1cnJlbnRWYWx1ZTogbnVtYmVyXG4gIGRvbmU6IGJvb2xlYW5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZUNvbnRleHQge1xuICBnb2FsOiBHb2FsXG4gIGN5Y2xlOiBHb2FsQ3ljbGVcbiAgbGlua3M6IEdvYWxMaW5rW11cbiAgZXZlbnRzOiBHb2FsRXZlbnRbXVxuICAvKiogQWN0aXZlIChvciBsYXRlc3QpIGNoaWxkIGN5Y2xlcyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLCBmb3IgY29tcG9zaXRlcy4gKi9cbiAgY2hpbGRDeWNsZXM/OiBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+XG4gIC8qKiBDaGlsZCBkZXBlbmRlbmN5IHdlaWdodHMga2V5ZWQgYnkgY2hpbGQgZ29hbCBpZC4gKi9cbiAgY2hpbGRXZWlnaHRzPzogTWFwPG51bWJlciwgbnVtYmVyPlxuICAvKiogRm9yIGdyb3VwX2FsbF9jb21wbGV0ZTogYWN0aXZpdHkgaWRzIHRoYXQgYmVsb25nIHRvIGxpbmtlZCBncm91cHMuICovXG4gIGdyb3VwQWN0aXZpdHlJZHM/OiBudW1iZXJbXVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmFsdWF0b3Ige1xuICBydWxlVHlwZTogc3RyaW5nXG4gIGV2YWx1YXRlKGN0eDogRXZhbHVhdGVDb250ZXh0KTogRXZhbHVhdGVSZXN1bHRcbn1cblxuLyoqIERlZHVwbGljYXRlIGV2ZW50cyBieSAoYWN0aXZpdHlfaWQsIG9jY3VycmVuY2VfZGF0ZSksIHByZWZlcnJpbmcgZmlyc3QuICovXG5leHBvcnQgZnVuY3Rpb24gZGVkdXBlRXZlbnRzKGV2ZW50czogR29hbEV2ZW50W10pOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICBjb25zdCBvdXQ6IEdvYWxFdmVudFtdID0gW11cbiAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICBjb25zdCBrZXkgPSBldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGV2ZW50Lm9jY3VycmVuY2VfZGF0ZVxuICAgICAgPyBgJHtldmVudC5hY3Rpdml0eV9pZH06JHtldmVudC5vY2N1cnJlbmNlX2RhdGV9OiR7ZXZlbnQubWV0cmljfWBcbiAgICAgIDogYGlkOiR7ZXZlbnQuaWR9YFxuICAgIGlmIChzZWVuLmhhcyhrZXkpKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKGtleSlcbiAgICBvdXQucHVzaChldmVudClcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIGV2ZW50c0luV2luZG93KGV2ZW50czogR29hbEV2ZW50W10sIGN5Y2xlOiBHb2FsQ3ljbGUpOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgY29uc3QgZW5kID0gY3ljbGUuZW5kc19hdCA/IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpLmdldFRpbWUoKSA6IE51bWJlci5QT1NJVElWRV9JTkZJTklUWVxuICByZXR1cm4gZXZlbnRzLmZpbHRlcigoZSkgPT4ge1xuICAgIGNvbnN0IHQgPSBuZXcgRGF0ZShlLm9jY3VycmVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBzdGFydCAmJiB0IDwgZW5kXG4gIH0pXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eV9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eV9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEdyb3VwSWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cF9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5ncm91cF9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIHdlaWdodEZvckV2ZW50KGV2ZW50OiBHb2FsRXZlbnQsIGxpbmtzOiBHb2FsTGlua1tdKTogbnVtYmVyIHtcbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiZcbiAgICAgIGxpbmsuYWN0aXZpdHlfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuYWN0aXZpdHlfaWQgPT09IGxpbmsuYWN0aXZpdHlfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGxpbmsubGlua190eXBlID09PSAnZ3JvdXAnICYmXG4gICAgICBsaW5rLmdyb3VwX2lkICE9IG51bGwgJiZcbiAgICAgIGV2ZW50Lmdyb3VwX2lkID09PSBsaW5rLmdyb3VwX2lkXG4gICAgKSB7XG4gICAgICByZXR1cm4gTnVtYmVyKGxpbmsud2VpZ2h0KVxuICAgIH1cbiAgfVxuICByZXR1cm4gMVxufVxuXG5mdW5jdGlvbiBtYXRjaGVzTGlua3MoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBib29sZWFuIHtcbiAgY29uc3QgYWN0aXZpdGllcyA9IGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzKVxuICBjb25zdCBncm91cHMgPSBsaW5rZWRHcm91cElkcyhsaW5rcylcbiAgaWYgKGFjdGl2aXRpZXMuc2l6ZSA9PT0gMCAmJiBncm91cHMuc2l6ZSA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gIGlmIChldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGFjdGl2aXRpZXMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgcmV0dXJuIHRydWVcbiAgaWYgKGV2ZW50Lmdyb3VwX2lkICE9IG51bGwgJiYgZ3JvdXBzLmhhcyhldmVudC5ncm91cF9pZCkpIHJldHVybiB0cnVlXG4gIHJldHVybiBmYWxzZVxufVxuXG5mdW5jdGlvbiBzdW1XZWlnaHRlZChcbiAgZXZlbnRzOiBHb2FsRXZlbnRbXSxcbiAgbGlua3M6IEdvYWxMaW5rW10sXG4gIG1ldHJpYzogJ2NvdW50JyB8ICdkdXJhdGlvbicsXG4pOiBudW1iZXIge1xuICBsZXQgdG90YWwgPSAwXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKGV2ZW50cykpIHtcbiAgICBpZiAoZXZlbnQubWV0cmljICE9PSBtZXRyaWMpIGNvbnRpbnVlXG4gICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGxpbmtzKSkgY29udGludWVcbiAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBsaW5rcylcbiAgfVxuICByZXR1cm4gdG90YWxcbn1cblxuZnVuY3Rpb24gd2l0aENhcnJ5T3Zlcih2YWx1ZTogbnVtYmVyLCBjeWNsZTogR29hbEN5Y2xlKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIHZhbHVlICsgTnVtYmVyKGN5Y2xlLmNhcnJ5X292ZXIgfHwgMCkpXG59XG5cbmZ1bmN0aW9uIHJlc3VsdCh2YWx1ZTogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IEV2YWx1YXRlUmVzdWx0IHtcbiAgY29uc3QgY3VycmVudFZhbHVlID0gTWF0aC5tYXgoMCwgdmFsdWUpXG4gIHJldHVybiB7XG4gICAgY3VycmVudFZhbHVlLFxuICAgIGRvbmU6IHRhcmdldCA+IDAgPyBjdXJyZW50VmFsdWUgPj0gdGFyZ2V0IDogY3VycmVudFZhbHVlID4gMCxcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYWN0aXZpdHlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdhY3Rpdml0eV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2R1cmF0aW9uJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2R1cmF0aW9uJyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdyb3VwRHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyBvZiBhbnkgYWN0aXZpdHkgaW4gbGlua2VkIGdyb3Vwcy4gKi9cbmV4cG9ydCBjb25zdCBncm91cEFueUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2FueV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBncm91cENvdW50RXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqXG4gKiBQcm9ncmVzcyA9IG51bWJlciBvZiBkaXN0aW5jdCBsaW5rZWQtZ3JvdXAgYWN0aXZpdGllcyBjb21wbGV0ZWQgYXQgbGVhc3RcbiAqIG9uY2UgaW4gdGhlIGN5Y2xlLiBUYXJnZXQgaXMgdHlwaWNhbGx5IHRoZSBzaXplIG9mIHRoZSBncm91cC5cbiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYWxsX2NvbXBsZXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgYWN0aXZpdHlJZHMgPSBuZXcgU2V0KGN0eC5ncm91cEFjdGl2aXR5SWRzID8/IFtdKVxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkID09IG51bGwpIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgJiYgIWFjdGl2aXR5SWRzLmhhcyhldmVudC5hY3Rpdml0eV9pZCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSAmJiBhY3Rpdml0eUlkcy5zaXplID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKGFjdGl2aXR5SWRzLnNpemUgPiAwIHx8IG1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkge1xuICAgICAgICBjb21wbGV0ZWQuYWRkKGV2ZW50LmFjdGl2aXR5X2lkKVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBQcmVmZXIgY291bnRpbmcgb25seSBhY3Rpdml0aWVzIHRoYXQgYmVsb25nIHRvIHRoZSBncm91cC5cbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBhY3Rpdml0eUlkcy5zaXplID4gMFxuICAgICAgICA/IFsuLi5jb21wbGV0ZWRdLmZpbHRlcigoaWQpID0+IGFjdGl2aXR5SWRzLmhhcyhpZCkpLmxlbmd0aFxuICAgICAgICA6IGNvbXBsZXRlZC5zaXplLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBtdWx0aUFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnbXVsdGlfYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICByZXR1cm4gYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvci5ldmFsdWF0ZShjdHgpXG4gIH0sXG59XG5cbi8qKiBDb25zZWN1dGl2ZSBjYWxlbmRhciBkYXlzIHdpdGggYXQgbGVhc3Qgb25lIG1hdGNoaW5nIGNvdW50IGV2ZW50LiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha0V2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdzdHJlYWsnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBkYXlzID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGRheSA9IGV2ZW50Lm9jY3VycmVuY2VfZGF0ZSA/P1xuICAgICAgICBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbiAgICAgIGRheXMuYWRkKGRheSlcbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLmRheXNdLnNvcnQoKVxuICAgIGxldCBiZXN0ID0gMFxuICAgIGxldCBydW4gPSAwXG4gICAgbGV0IHByZXY6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gICAgZm9yIChjb25zdCBkYXkgb2Ygc29ydGVkKSB7XG4gICAgICBpZiAocHJldikge1xuICAgICAgICBjb25zdCBwcmV2RGF0ZSA9IG5ldyBEYXRlKHByZXYgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGN1ckRhdGUgPSBuZXcgRGF0ZShkYXkgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGRpZmYgPSAoY3VyRGF0ZS5nZXRUaW1lKCkgLSBwcmV2RGF0ZS5nZXRUaW1lKCkpIC8gODZfNDAwXzAwMFxuICAgICAgICBydW4gPSBkaWZmID09PSAxID8gcnVuICsgMSA6IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJ1biA9IDFcbiAgICAgIH1cbiAgICAgIGJlc3QgPSBNYXRoLm1heChiZXN0LCBydW4pXG4gICAgICBwcmV2ID0gZGF5XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihiZXN0LCBjdHguY3ljbGUpXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG4vKiogQ291bnQgY29tcGxldGlvbnMgd2hvc2Ugb2NjdXJyZW5jZSBsb2NhbCB0aW1lIGlzIGJlZm9yZSBjb25maWcuYmVmb3JlX3RpbWUuICovXG5leHBvcnQgY29uc3QgdGltZU9mRGF5Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAndGltZV9vZl9kYXlfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCBjb25maWcgPSB0eXBlb2YgY3R4LmdvYWwuY29uZmlnID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKGN0eC5nb2FsLmNvbmZpZylcbiAgICAgIDogKGN0eC5nb2FsLmNvbmZpZyA/PyB7fSlcbiAgICBjb25zdCBiZWZvcmUgPSB0eXBlb2YgY29uZmlnLmJlZm9yZV90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5iZWZvcmVfdGltZSA6IG51bGxcbiAgICBjb25zdCBhZnRlciA9IHR5cGVvZiBjb25maWcuYWZ0ZXJfdGltZSA9PT0gJ3N0cmluZycgPyBjb25maWcuYWZ0ZXJfdGltZSA6IG51bGxcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBsZXQgdG90YWwgPSAwXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykpIGNvbnRpbnVlXG4gICAgICBjb25zdCBoaG1tID0gbmV3IERhdGUoZXZlbnQub2NjdXJyZWRfYXQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsIDE2KVxuICAgICAgaWYgKGJlZm9yZSAmJiBoaG1tID49IGJlZm9yZSkgY29udGludWVcbiAgICAgIGlmIChhZnRlciAmJiBoaG1tIDwgYWZ0ZXIpIGNvbnRpbnVlXG4gICAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBjdHgubGlua3MpXG4gICAgfVxuICAgIHJldHVybiByZXN1bHQod2l0aENhcnJ5T3Zlcih0b3RhbCwgY3R4LmN5Y2xlKSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgY29tcG9zaXRlRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2NvbXBvc2l0ZScsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWcuY29tcG9zaXRlX21vZGUgPz8gJ2FsbCdcbiAgICBjb25zdCBjaGlsZHJlbiA9IGN0eC5jaGlsZEN5Y2xlc1xuICAgIGlmICghY2hpbGRyZW4gfHwgY2hpbGRyZW4uc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHJlc3VsdCgwLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IFsuLi5jaGlsZHJlbi5lbnRyaWVzKCldXG4gICAgaWYgKG1vZGUgPT09ICd3ZWlnaHRlZCcpIHtcbiAgICAgIGxldCB3ZWlnaHRlZFN1bSA9IDBcbiAgICAgIGxldCB3ZWlnaHRUb3RhbCA9IDBcbiAgICAgIGZvciAoY29uc3QgW2NoaWxkSWQsIGN5Y2xlXSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IHcgPSBOdW1iZXIoY3R4LmNoaWxkV2VpZ2h0cz8uZ2V0KGNoaWxkSWQpID8/IDEpXG4gICAgICAgIGNvbnN0IHByb2dyZXNzID0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwXG4gICAgICAgICAgPyBNYXRoLm1pbigxLCBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgLyBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICAgICAgICA6IChjeWNsZS5zdGF0dXMgPT09ICdzdWNjZWVkZWQnID8gMSA6IDApXG4gICAgICAgIHdlaWdodGVkU3VtICs9IHByb2dyZXNzICogd1xuICAgICAgICB3ZWlnaHRUb3RhbCArPSB3XG4gICAgICB9XG4gICAgICBjb25zdCBwY3QgPSB3ZWlnaHRUb3RhbCA+IDAgPyB3ZWlnaHRlZFN1bSAvIHdlaWdodFRvdGFsIDogMFxuICAgICAgLy8gUmVwcmVzZW50IGFzIDBcdTIwMTMxMDAgcGVyY2VudCBvZiB0YXJnZXQuXG4gICAgICBjb25zdCB2YWx1ZSA9IHBjdCAqIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IGVudHJpZXMuZmlsdGVyKChbLCBjXSkgPT5cbiAgICAgIGMuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjLnRhcmdldF92YWx1ZSkgPiAwICYmIE51bWJlcihjLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjLnRhcmdldF92YWx1ZSkpXG4gICAgKS5sZW5ndGhcblxuICAgIGlmIChtb2RlID09PSAnYW55Jykge1xuICAgICAgY29uc3QgbmVlZGVkID0gTWF0aC5tYXgoMSwgTnVtYmVyKGNvbmZpZy5jb3VudF9yZXF1aXJlZCA/PyAxKSlcbiAgICAgIHJldHVybiByZXN1bHQoY29tcGxldGVkLCBuZWVkZWQpXG4gICAgfVxuXG4gICAgLy8gYWxsXG4gICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIGVudHJpZXMubGVuZ3RoKVxuICB9LFxufVxuXG5jb25zdCBFVkFMVUFUT1JTOiBHb2FsRXZhbHVhdG9yW10gPSBbXG4gIGFjdGl2aXR5Q291bnRFdmFsdWF0b3IsXG4gIGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwRHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwQ291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQW55Q291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3IsXG4gIG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgc3RyZWFrRXZhbHVhdG9yLFxuICB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcixcbiAgY29tcG9zaXRlRXZhbHVhdG9yLFxuXVxuXG5jb25zdCBSRUdJU1RSWSA9IG5ldyBNYXAoRVZBTFVBVE9SUy5tYXAoKGUpID0+IFtlLnJ1bGVUeXBlLCBlXSkpXG5cbmV4cG9ydCBjb25zdCBHT0FMX1JVTEVfVFlQRVMgPSBFVkFMVUFUT1JTLm1hcCgoZSkgPT4gZS5ydWxlVHlwZSlcblxuZXhwb3J0IGZ1bmN0aW9uIGdldEV2YWx1YXRvcihydWxlVHlwZTogc3RyaW5nKTogR29hbEV2YWx1YXRvciB7XG4gIGNvbnN0IGV2YWx1YXRvciA9IFJFR0lTVFJZLmdldChydWxlVHlwZSlcbiAgaWYgKCFldmFsdWF0b3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZ29hbCBydWxlX3R5cGU6ICR7cnVsZVR5cGV9YClcbiAgfVxuICByZXR1cm4gZXZhbHVhdG9yXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZUdvYWwoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdCB7XG4gIHJldHVybiBnZXRFdmFsdWF0b3IoY3R4LmdvYWwucnVsZV90eXBlKS5ldmFsdWF0ZShjdHgpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5JztcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbEV2ZW50LFxuICBHb2FsTGluayxcbn0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJztcbmltcG9ydCB7IGN5Y2xlSGFzU3RhcnRlZCB9IGZyb20gJy4vbGlmZWN5Y2xlLnRzJztcbmltcG9ydCB7IGV2YWx1YXRlR29hbCB9IGZyb20gJy4vZXZhbHVhdG9ycy9pbmRleC50cyc7XG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPjtcblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9IGFzIFQ7XG4gICAgfVxuICB9XG4gIHJldHVybiAodmFsdWUgPz8ge30pIGFzIFQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEdvYWxMaW5rcyhcbiAgZGI6IERiTGlrZSxcbiAgZ29hbElkOiBudW1iZXIsXG4pOiBQcm9taXNlPEdvYWxMaW5rW10+IHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEV2ZW50c0ZvclVzZXIoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBmcm9tPzogRGF0ZSB8IHN0cmluZyxcbiAgdG8/OiBEYXRlIHwgc3RyaW5nLFxuKTogUHJvbWlzZTxHb2FsRXZlbnRbXT4ge1xuICBsZXQgcXVlcnkgPSBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2V2ZW50cycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpO1xuXG4gIGlmIChmcm9tKSB7XG4gICAgY29uc3QgZnJvbURhdGUgPSB0eXBlb2YgZnJvbSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZShmcm9tKSA6IGZyb207XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnb2NjdXJyZWRfYXQnLCAnPj0nLCBmcm9tRGF0ZSBhcyBuZXZlcik7XG4gIH1cbiAgaWYgKHRvKSB7XG4gICAgY29uc3QgdG9EYXRlID0gdHlwZW9mIHRvID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKHRvKSA6IHRvO1xuICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ29jY3VycmVkX2F0JywgJzwnLCB0b0RhdGUgYXMgbmV2ZXIpO1xuICB9XG5cbiAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ3JvdXBBY3Rpdml0eUlkc0ZvckxpbmtzKFxuICBkYjogRGJMaWtlLFxuICBsaW5rczogR29hbExpbmtbXSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlcltdPiB7XG4gIGNvbnN0IGdyb3VwSWRzID0gbGlua3NcbiAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwX2lkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5ncm91cF9pZCEpO1xuICBpZiAoZ3JvdXBJZHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2FjdGl2aXRpZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnZ3JvdXBfaWQnLCAnaW4nLCBncm91cElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKTtcbiAgcmV0dXJuIHJvd3MubWFwKChyKSA9PiByLmlkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hDaGlsZEN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgZ29hbElkOiBudW1iZXIsXG4pOiBQcm9taXNlPHsgY3ljbGVzOiBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+OyB3ZWlnaHRzOiBNYXA8bnVtYmVyLCBudW1iZXI+IH0+IHtcbiAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIGNvbnN0IGN5Y2xlcyA9IG5ldyBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+KCk7XG4gIGNvbnN0IHdlaWdodHMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpO1xuXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICB3ZWlnaHRzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBOdW1iZXIoZGVwLndlaWdodCkpO1xuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG5cbiAgICBpZiAoY3ljbGUpIHtcbiAgICAgIGN5Y2xlcy5zZXQoZGVwLmRlcGVuZHNfb25fZ29hbF9pZCwgY3ljbGUpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbGF0ZXN0ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKGxhdGVzdCkgY3ljbGVzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBsYXRlc3QpO1xuICB9XG5cbiAgcmV0dXJuIHsgY3ljbGVzLCB3ZWlnaHRzIH07XG59XG5cbi8qKlxuICogV2hldGhlciBoaXR0aW5nIHRoZSB0YXJnZXQgc2hvdWxkIGNsb3NlIHRoZSBjeWNsZSBpbW1lZGlhdGVseS5cbiAqIFJlY3VycmluZyBjeWNsZXMgc3RheSBgYWN0aXZlYCB1bnRpbCByb2xsLW92ZXIgYXQgZW5kc19hdCBzbyB0aGUgVUkga2VlcHNcbiAqIGFuIGFjdGl2ZUN5Y2xlIChhbmQgcHJvZ3Jlc3MpIGZvciB0aGUgcmVzdCBvZiB0aGUgd2luZG93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkQ2xvc2VDeWNsZU9uVGFyZ2V0KFxuICBnb2FsOiBQaWNrPEdvYWwsICdyZWN1cnJlbmNlJz4sXG4pOiBib29sZWFuIHtcbiAgcmV0dXJuIGdvYWwucmVjdXJyZW5jZSA9PSBudWxsO1xufVxuXG4vKipcbiAqIFJlY29tcHV0ZSBhbmQgcGVyc2lzdCBjdXJyZW50X3ZhbHVlIGZvciBhIHNpbmdsZSBjeWNsZS5cbiAqIFJldHVybnMgdGhlIHVwZGF0ZWQgY3ljbGUuXG4gKiBTa2lwcyBhY2NydWFsIHdoaWxlIHRoZSBjeWNsZSBoYXMgbm90IHN0YXJ0ZWQgKGtlZXBzIGN1cnJlbnRfdmFsdWUgYXQgMCxcbiAqIG5ldmVyIGF1dG8tc3VjY2VlZHMpIFx1MjAxNCBjb3ZlcnMgY29tcG9zaXRlIHBhcmVudHMgY29tcGxldGluZyBlYXJseSB2aWEgY2hpbGRyZW4uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVDeWNsZShcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGlmIChjeWNsZS5zdGF0dXMgPT09ICdhY3RpdmUnICYmICFjeWNsZUhhc1N0YXJ0ZWQoY3ljbGUsIG5vdykpIHtcbiAgICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID09PSAwKSByZXR1cm4gY3ljbGU7XG4gICAgY29uc3Qgc3RhbXBlZCA9IG5vdy50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAuc2V0KHsgY3VycmVudF92YWx1ZTogMCwgdXBkYXRlZF9hdDogc3RhbXBlZCB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9XG5cbiAgY29uc3QgbGlua3MgPSBhd2FpdCBmZXRjaEdvYWxMaW5rcyhkYiwgZ29hbC5pZCk7XG4gIGNvbnN0IGV2ZW50cyA9IGF3YWl0IGZldGNoRXZlbnRzRm9yVXNlcihcbiAgICBkYixcbiAgICBnb2FsLnVzZXJfaWQsXG4gICAgY3ljbGUuc3RhcnRzX2F0LFxuICAgIGN5Y2xlLmVuZHNfYXQgPz8gdW5kZWZpbmVkLFxuICApO1xuICBjb25zdCBncm91cEFjdGl2aXR5SWRzID0gYXdhaXQgZ3JvdXBBY3Rpdml0eUlkc0ZvckxpbmtzKFxuICAgIGRiLFxuICAgIGxpbmtzLFxuICAgIGdvYWwudXNlcl9pZCxcbiAgKTtcbiAgY29uc3QgeyBjeWNsZXM6IGNoaWxkQ3ljbGVzLCB3ZWlnaHRzOiBjaGlsZFdlaWdodHMgfSA9XG4gICAgZ29hbC5ydWxlX3R5cGUgPT09ICdjb21wb3NpdGUnXG4gICAgICA/IGF3YWl0IGZldGNoQ2hpbGRDeWNsZXMoZGIsIGdvYWwuaWQpXG4gICAgICA6IHtcbiAgICAgICAgICBjeWNsZXM6IG5ldyBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+KCksXG4gICAgICAgICAgd2VpZ2h0czogbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKSxcbiAgICAgICAgfTtcblxuICBjb25zdCB7IGN1cnJlbnRWYWx1ZSwgZG9uZSB9ID0gZXZhbHVhdGVHb2FsKHtcbiAgICBnb2FsOiB7XG4gICAgICAuLi5nb2FsLFxuICAgICAgY29uZmlnOiBwYXJzZUpzb24oZ29hbC5jb25maWcpLFxuICAgIH0sXG4gICAgY3ljbGUsXG4gICAgbGlua3MsXG4gICAgZXZlbnRzLFxuICAgIGNoaWxkQ3ljbGVzLFxuICAgIGNoaWxkV2VpZ2h0cyxcbiAgICBncm91cEFjdGl2aXR5SWRzLFxuICB9KTtcblxuICBjb25zdCBub3dJc28gPSBub3cudG9JU09TdHJpbmcoKTtcbiAgbGV0IHN0YXR1cyA9IGN5Y2xlLnN0YXR1cztcbiAgLy8gT25lLXRpbWUgZ29hbHMgY2xvc2UgYXMgc29vbiBhcyB0aGUgdGFyZ2V0IGlzIG1ldC4gUmVjdXJyaW5nIGN5Y2xlcyBzdGF5XG4gIC8vIGFjdGl2ZSB1bnRpbCByb2xsT3ZlcklmTmVlZGVkIGNsb3NlcyB0aGVtIGF0IGVuZHNfYXQgXHUyMDE0IG90aGVyd2lzZVxuICAvLyBhY3RpdmVDeWNsZSBnb2VzIG51bGwgbWlkLXdpbmRvdyBhbmQgdGhlIGNsaWVudCBzaG93cyAwJSBwcm9ncmVzcy5cbiAgaWYgKFxuICAgIGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiZcbiAgICBkb25lICYmXG4gICAgc2hvdWxkQ2xvc2VDeWNsZU9uVGFyZ2V0KGdvYWwpXG4gICkge1xuICAgIHN0YXR1cyA9ICdzdWNjZWVkZWQnO1xuICB9XG5cbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBjdXJyZW50X3ZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgICBzdGF0dXMsXG4gICAgICB1cGRhdGVkX2F0OiBub3dJc28sXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAvLyBEYWlseSBzbmFwc2hvdCBmb3IgaGlzdG9yeSBjaGFydHMgKHVwc2VydCBieSBhc19vZiBkYXRlKS5cbiAgY29uc3QgYXNPZiA9IG5vd0lzby5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGdvYWxfY3ljbGVfaWQ6IHVwZGF0ZWQuaWQsXG4gICAgICBhc19vZjogYXNPZixcbiAgICAgIHZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgfSlcbiAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICBvYy5jb2x1bW5zKFsnZ29hbF9jeWNsZV9pZCcsICdhc19vZiddKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgIHZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgICB9KSxcbiAgICApXG4gICAgLmV4ZWN1dGUoKTtcblxuICAvLyBNYXJrIHBhcmVudCBnb2FsIGNvbXBsZXRlZCB3aGVuIGEgb25lLXRpbWUgY3ljbGUgc3VjY2VlZHMuXG4gIGlmIChzdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmICFnb2FsLnJlY3VycmVuY2UgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2NvbXBsZXRlZCcsIHVwZGF0ZWRfYXQ6IG5vd0lzbyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbC5pZClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH1cblxuICAvLyBFZGdlLXRyaWdnZXIgcmV3YXJkIGdyYW50cyB3aGVuIGEgY3ljbGUgbmV3bHkgc3VjY2VlZHMuXG4gIGlmIChzdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcpIHtcbiAgICBjb25zdCB7IGdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MgfSA9IGF3YWl0IGltcG9ydChcbiAgICAgICcuLi9yZXdhcmRzL2hvb2tzLnRzJ1xuICAgICk7XG4gICAgYXdhaXQgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhkYiwge1xuICAgICAgdXNlcklkOiBnb2FsLnVzZXJfaWQsXG4gICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICBjeWNsZUlkOiB1cGRhdGVkLmlkLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHVwZGF0ZWQ7XG59XG5cbi8qKiBSZWNvbXB1dGUgYWxsIGFjdGl2ZSBjeWNsZXMgbGlua2VkIHRvIGFuIGFjdGl2aXR5IG9yIGdyb3VwIHZpYSBnb2FsX2xpbmtzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgb3B0czogeyBhY3Rpdml0eUlkPzogbnVtYmVyIHwgbnVsbDsgZ3JvdXBJZD86IG51bWJlciB8IG51bGwgfSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBnb2FsSWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG5cbiAgaWYgKG9wdHMuYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuYWN0aXZpdHlfaWQnLCAnPScsIG9wdHMuYWN0aXZpdHlJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgaWYgKG9wdHMuZ3JvdXBJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuZ3JvdXBfaWQnLCAnPScsIG9wdHMuZ3JvdXBJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgLy8gQWxzbyByZWNvbXB1dGUgY29tcG9zaXRlcyB0aGF0IGRlcGVuZCBvbiBhZmZlY3RlZCBnb2Fscy5cbiAgaWYgKGdvYWxJZHMuc2l6ZSA+IDApIHtcbiAgICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAud2hlcmUoJ2RlcGVuZHNfb25fZ29hbF9pZCcsICdpbicsIFsuLi5nb2FsSWRzXSlcbiAgICAgIC5zZWxlY3QoJ2dvYWxfaWQnKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwcykgZ29hbElkcy5hZGQoZC5nb2FsX2lkKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZ29hbElkIG9mIGdvYWxJZHMpIHtcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWdvYWwgfHwgZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnIHx8IGdvYWwuc3RhdHVzID09PSAnYXJjaGl2ZWQnKVxuICAgICAgY29udGludWU7XG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKCFjeWNsZSkgY29udGludWU7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICB9XG59XG5cbi8qKiBGdWxsIHJlY29tcHV0ZSBvZiBldmVyeSBhY3RpdmUgY3ljbGUgZm9yIGEgdXNlciAocmVwYWlyIHBhdGgpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3N0YXR1cycsICdpbicsIFsnYWN0aXZlJywgJ2NvbXBsZXRlZCcsICdmYWlsZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIGxldCBjb3VudCA9IDA7XG4gIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgIGNvbnN0IGN5Y2xlcyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgY3ljbGUgb2YgY3ljbGVzKSB7XG4gICAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICAgICAgY291bnQrKztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvdW50O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIHByZXNldCBwYWxldHRlIGZvciBhY3Rpdml0eSBncm91cHMuXG4gKiBLZWVwIGluIHN5bmMgd2l0aCBGbHV0dGVyIGBsaWIvdGhlbWUvdG9rZW5zL2dyb3VwX3BhbGV0dGUuZGFydGAuXG4gKi9cbmV4cG9ydCBjb25zdCBHUk9VUF9DT0xPUl9QQUxFVFRFID0gW1xuICAnIzBGNzY2RScsIC8vIHRlYWwgKGJyYW5kKVxuICAnIzI1NjNFQicsIC8vIGJsdWVcbiAgJyM3QzNBRUQnLCAvLyB2aW9sZXRcbiAgJyNEQjI3NzcnLCAvLyBwaW5rXG4gICcjREMyNjI2JywgLy8gcmVkXG4gICcjRUE1ODBDJywgLy8gb3JhbmdlXG4gICcjQ0E4QTA0JywgLy8geWVsbG93XG4gICcjMTZBMzRBJywgLy8gZ3JlZW5cbiAgJyMwODkxQjInLCAvLyBjeWFuXG4gICcjNEI1NTYzJywgLy8gZ3JheVxuXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBHcm91cENvbG9yID0gKHR5cGVvZiBHUk9VUF9DT0xPUl9QQUxFVFRFKVtudW1iZXJdXG5cbmNvbnN0IEhFWF9DT0xPUl9SRSA9IC9eI1swLTlBLUZhLWZdezZ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQWxsb3dlZEdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IGNvbG9yIGlzIEdyb3VwQ29sb3Ige1xuICBpZiAoIUhFWF9DT0xPUl9SRS50ZXN0KGNvbG9yKSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjb2xvci50b1VwcGVyQ2FzZSgpXG4gIHJldHVybiAoR1JPVVBfQ09MT1JfUEFMRVRURSBhcyByZWFkb25seSBzdHJpbmdbXSkuc29tZShcbiAgICAoYykgPT4gYy50b1VwcGVyQ2FzZSgpID09PSBub3JtYWxpemVkLFxuICApXG59XG5cbi8qKiBOb3JtYWxpemUgdG8gY2Fub25pY2FsIGAjUlJHR0JCYCB1cHBlcmNhc2UgZnJvbSB0aGUgYWxsb3dsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IEdyb3VwQ29sb3Ige1xuICBjb25zdCBtYXRjaCA9IChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5maW5kKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IGNvbG9yLnRvVXBwZXJDYXNlKCksXG4gIClcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncm91cCBjb2xvcjogJHtjb2xvcn1gKVxuICB9XG4gIHJldHVybiBtYXRjaCBhcyBHcm91cENvbG9yXG59XG4iLCAiaW1wb3J0IHsgUmVjdXJyZW5jZUNvbmZpZywgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBpc0FsbG93ZWRHcm91cENvbG9yLCBub3JtYWxpemVHcm91cENvbG9yIH0gZnJvbSAnLi9ncm91cF9wYWxldHRlLnRzJ1xuaW1wb3J0IHsgR09BTF9SVUxFX1RZUEVTIH0gZnJvbSAnLi4vZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVhZGxpbmVJbnB1dCxcbiAgR29hbERlcGVuZGVuY3lJbnB1dCxcbiAgR29hbExpbmtJbnB1dCxcbiAgR29hbFJlY3VycmVuY2VJbnB1dCxcbiAgVXBkYXRlR29hbElucHV0LFxufSBmcm9tICcuL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdyb3VwRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRDb21wbGV0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRHb2FsRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5pbnRlcmZhY2UgQWN0aXZpdHlTY2hlZHVsZSB7XG4gIGlzUmVjdXJyaW5nOiBib29sZWFuXG4gIGRhdGU/OiBzdHJpbmcgfCBudWxsXG4gIHJlY3VycmVuY2VQYXR0ZXJuPzogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGxcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhbiBhY3Rpdml0eSdzIHNjaGVkdWxlIGlzIGludGVybmFsbHkgY29uc2lzdGVudDpcbiAqIC0gTm9uLXJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIGBkYXRlYCBhbmQgbm8gcmVjdXJyZW5jZSBwYXR0ZXJuLlxuICogLSBSZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSByZWN1cnJlbmNlIHBhdHRlcm4gKGFuZCBubyBgZGF0ZWApLFxuICogICB3aXRoIGNvbmZpZyBmaWVsZHMgbWF0Y2hpbmcgdGhlIGNob3NlbiByZWN1cnJlbmNlIHR5cGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoaW5wdXQ6IEFjdGl2aXR5U2NoZWR1bGUpOiB2b2lkIHtcbiAgaWYgKCFpbnB1dC5pc1JlY3VycmluZykge1xuICAgIGlmICghaW5wdXQuZGF0ZSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgICdkYXRlIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgZmFsc2UnLFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybiBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIHRydWUnLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHsgcmVjdXJyZW5jZVR5cGUsIGNvbmZpZyB9ID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm5cbiAgaWYgKCFjb25maWcgfHwgIWNvbmZpZy5zdGFydF9kYXRlKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnLnN0YXJ0X2RhdGUgaXMgcmVxdWlyZWQnLFxuICAgIClcbiAgfVxuXG4gIHN3aXRjaCAocmVjdXJyZW5jZVR5cGUpIHtcbiAgICBjYXNlICd3ZWVrbHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZXZWVrKGNvbmZpZy5kYXlzX29mX3dlZWspXG4gICAgICBicmVha1xuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZNb250aChjb25maWcuZGF5c19vZl9tb250aCwgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgdmFsaWRhdGVJbnRlcnZhbERheXMoY29uZmlnLmludGVydmFsX2RheXMpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgYFVuc3VwcG9ydGVkIHJlY3VycmVuY2VUeXBlOiAke3JlY3VycmVuY2VUeXBlfWAsXG4gICAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBncm91cCBjb2xvciBhZ2FpbnN0IHRoZSBzaGFyZWQgaGV4IGFsbG93bGlzdC5cbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBwYWxldHRlIHZhbHVlIChlLmcuIGAjMEY3NjZFYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoXG4gICAgICAnY29sb3IgbXVzdCBiZSBhIGhleCB2YWx1ZSBmcm9tIHRoZSBncm91cCBwYWxldHRlIChlLmcuICMwRjc2NkUpJyxcbiAgICApXG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3IpXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGdyb3VwIG5hbWUgaXMgbm9uLWVtcHR5IGFmdGVyIHRyaW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5jb25zdCBEQVRFX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBUSU1FX1JFID0gL15cXGR7Mn06XFxkezJ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoZGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFEQVRFX1JFLnRlc3QoZGF0ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignb2NjdXJyZW5jZURhdGUgbXVzdCBiZSBZWVlZLU1NLUREJylcbiAgfVxuICByZXR1cm4gZGF0ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXModmFsdWU6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8IDAgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ2R1cmF0aW9uTWludXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZXZWVrKGRheXNPZldlZWs6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2Zfd2VlayddKTogdm9pZCB7XG4gIGlmICghZGF5c09mV2VlayB8fCBkYXlzT2ZXZWVrLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgaXMgcmVxdWlyZWQgZm9yIHdlZWtseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKGRheXNPZldlZWsuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDAgfHwgZGF5ID4gNikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDAgKFN1bmRheSkgYW5kIDYgKFNhdHVyZGF5KScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mTW9udGgoXG4gIGRheXNPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX21vbnRoJ10sXG4gIGlzTGFzdERheU9mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2lzX2xhc3RfZGF5X29mX21vbnRoJ10sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFzRGF5c09mTW9udGggPSAhIWRheXNPZk1vbnRoICYmIGRheXNPZk1vbnRoLmxlbmd0aCA+IDBcbiAgaWYgKCFoYXNEYXlzT2ZNb250aCAmJiAhaXNMYXN0RGF5T2ZNb250aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG9yIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aCBpcyByZXF1aXJlZCBmb3IgbW9udGhseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKFxuICAgIGhhc0RheXNPZk1vbnRoICYmXG4gICAgZGF5c09mTW9udGghLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAxIHx8IGRheSA+IDMxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAxIGFuZCAzMScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGludGVydmFsRGF5czogUmVjdXJyZW5jZUNvbmZpZ1snaW50ZXJ2YWxfZGF5cyddKTogdm9pZCB7XG4gIGlmIChcbiAgICBpbnRlcnZhbERheXMgPT09IHVuZGVmaW5lZCB8fFxuICAgIGludGVydmFsRGF5cyA9PT0gbnVsbCB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGludGVydmFsRGF5cykgfHxcbiAgICBpbnRlcnZhbERheXMgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5pbnRlcnZhbF9kYXlzIG11c3QgYmUgYW4gaW50ZWdlciA+PSAxIGZvciBldmVyeV94X2RheXMgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxUaXRsZSh0aXRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHRpdGxlLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0aXRsZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIG11c3QgYmUgYXQgbW9zdCAyNTUgY2hhcmFjdGVycycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUnVsZVR5cGUocnVsZVR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghR09BTF9SVUxFX1RZUEVTLmluY2x1ZGVzKHJ1bGVUeXBlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgYHJ1bGVUeXBlIG11c3QgYmUgb25lIG9mOiAke0dPQUxfUlVMRV9UWVBFUy5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiBydWxlVHlwZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUYXJnZXRWYWx1ZSh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGFyZ2V0VmFsdWUgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxMaW5rcyhcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxMaW5rSW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBsaW5rcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnKSB7XG4gICAgaWYgKGxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyBtdXN0IG5vdCBoYXZlIGFjdGl2aXR5L2dyb3VwIGxpbmtzJylcbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2F0IGxlYXN0IG9uZSBsaW5rIGlzIHJlcXVpcmVkJylcbiAgfVxuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlzdCkge1xuICAgIGlmIChsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBpZiAobGluay5hY3Rpdml0eUlkID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIHJlcXVpcmUgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgICBpZiAobGluay5ncm91cElkICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIG11c3Qgbm90IHNldCBncm91cElkJylcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxpbmsubGlua1R5cGUgPT09ICdncm91cCcpIHtcbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgcmVxdWlyZSBncm91cElkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgbXVzdCBub3Qgc2V0IGFjdGl2aXR5SWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGlua1R5cGUgbXVzdCBiZSBhY3Rpdml0eSBvciBncm91cCcpXG4gICAgfVxuICAgIGlmIChsaW5rLndlaWdodCAhPSBudWxsICYmICghTnVtYmVyLmlzRmluaXRlKGxpbmsud2VpZ2h0KSB8fCBsaW5rLndlaWdodCA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2xpbmsgd2VpZ2h0IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10gfCB1bmRlZmluZWQsXG4gIHJ1bGVUeXBlOiBzdHJpbmcsXG4pOiBHb2FsRGVwZW5kZW5jeUlucHV0W10ge1xuICBjb25zdCBsaXN0ID0gZGVwcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnICYmIGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyByZXF1aXJlIGF0IGxlYXN0IG9uZSBkZXBlbmRlbmN5JylcbiAgfVxuICBmb3IgKGNvbnN0IGRlcCBvZiBsaXN0KSB7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGRlcC5kZXBlbmRzT25Hb2FsSWQpIHx8IGRlcC5kZXBlbmRzT25Hb2FsSWQgPD0gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZHNPbkdvYWxJZCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPSBudWxsICYmXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT09ICdjb21wbGV0ZScgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ3Byb2dyZXNzJ1xuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlcXVpcmVtZW50IG11c3QgYmUgY29tcGxldGUgb3IgcHJvZ3Jlc3MnKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB7XG4gIGlmIChyZWN1cnJlbmNlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHBlcmlvZHMgPSBbJ3dlZWtseScsICdtb250aGx5JywgJ3F1YXJ0ZXJseScsICdldmVyeV94X2RheXMnXVxuICBpZiAoIXBlcmlvZHMuaW5jbHVkZXMocmVjdXJyZW5jZS5wZXJpb2QpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYHVuc3VwcG9ydGVkIHJlY3VycmVuY2UgcGVyaW9kOiAke3JlY3VycmVuY2UucGVyaW9kfWApXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuaW50ZXJ2YWwgIT0gbnVsbCAmJlxuICAgICghTnVtYmVyLmlzSW50ZWdlcihyZWN1cnJlbmNlLmludGVydmFsKSB8fCByZWN1cnJlbmNlLmludGVydmFsIDwgMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlY3VycmVuY2UuaW50ZXJ2YWwgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEnKVxuICB9XG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPSBudWxsICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdub25lJyAmJlxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9PSAnb3ZlcmZsb3cnXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjYXJyeU92ZXIgbXVzdCBiZSBub25lIG9yIG92ZXJmbG93JylcbiAgfVxuICByZXR1cm4gcmVjdXJyZW5jZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVhZGxpbmUoXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwge1xuICBpZiAoZGVhZGxpbmUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdhYnNvbHV0ZScpIHtcbiAgICBpZiAoIWRlYWRsaW5lLmRhdGUgfHwgIURBVEVfUkUudGVzdChkZWFkbGluZS5kYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2Fic29sdXRlIGRlYWRsaW5lIHJlcXVpcmVzIGRhdGUgWVlZWS1NTS1ERCcpXG4gICAgfVxuICB9IGVsc2UgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScpIHtcbiAgICBpZiAoXG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0ID09IG51bGwgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQpIHx8XG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0IDwgMFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICdyZWxhdGl2ZSBkZWFkbGluZSByZXF1aXJlcyBkYXlzQWZ0ZXJDeWNsZVN0YXJ0ID49IDAnLFxuICAgICAgKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUua2luZCBtdXN0IGJlIGFic29sdXRlIG9yIHJlbGF0aXZlJylcbiAgfVxuICByZXR1cm4gZGVhZGxpbmVcbn1cblxuY29uc3QgTUFYX1NUQVJUX1lFQVJTX0FIRUFEID0gNVxuXG4vKiogUGFyc2UgYW5kIHZhbGlkYXRlIGFuIG9wdGlvbmFsIElTTy04NjAxIHN0YXJ0c0F0LiBSZXR1cm5zIG51bGwgaWYgb21pdHRlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVN0YXJ0c0F0KFxuICBzdGFydHNBdDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKHN0YXJ0c0F0ID09IG51bGwgfHwgc3RhcnRzQXQgPT09ICcnKSByZXR1cm4gbnVsbFxuICBjb25zdCBwYXJzZWQgPSBuZXcgRGF0ZShzdGFydHNBdClcbiAgaWYgKE51bWJlci5pc05hTihwYXJzZWQuZ2V0VGltZSgpKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdzdGFydHNBdCBtdXN0IGJlIGEgdmFsaWQgSVNPLTg2MDEgZGF0ZXRpbWUnKVxuICB9XG4gIGNvbnN0IG1heCA9IG5ldyBEYXRlKG5vdylcbiAgbWF4LnNldFVUQ0Z1bGxZZWFyKG1heC5nZXRVVENGdWxsWWVhcigpICsgTUFYX1NUQVJUX1lFQVJTX0FIRUFEKVxuICBpZiAocGFyc2VkID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICBgc3RhcnRzQXQgbXVzdCBiZSB3aXRoaW4gJHtNQVhfU1RBUlRfWUVBUlNfQUhFQUR9IHllYXJzIGZyb20gbm93YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHBhcnNlZFxufVxuXG4vKiogUmVqZWN0IGFic29sdXRlIGRlYWRsaW5lcyB0aGF0IGVuZCBiZWZvcmUgdGhlIGdvYWwgc3RhcnRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiB2b2lkIHtcbiAgaWYgKCFkZWFkbGluZSB8fCBkZWFkbGluZS5raW5kICE9PSAnYWJzb2x1dGUnIHx8ICFkZWFkbGluZS5kYXRlKSByZXR1cm5cbiAgY29uc3QgZGVhZGxpbmVBdCA9IG5ldyBEYXRlKGRlYWRsaW5lLmRhdGUgKyAnVDIzOjU5OjU5Ljk5OVonKVxuICBpZiAoZGVhZGxpbmVBdCA8IHN0YXJ0c0F0KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlYWRsaW5lIG11c3QgYmUgb24gb3IgYWZ0ZXIgdGhlIGdvYWwgc3RhcnQnKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbikge1xuICBjb25zdCB0aXRsZSA9IHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKVxuICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKVxuICBjb25zdCBydWxlVHlwZSA9IHZhbGlkYXRlUnVsZVR5cGUoaW5wdXQucnVsZVR5cGUpXG4gIGNvbnN0IHRhcmdldFZhbHVlID0gdmFsaWRhdGVUYXJnZXRWYWx1ZShpbnB1dC50YXJnZXRWYWx1ZSlcbiAgaWYgKGlucHV0Lm1ldHJpYyAhPT0gJ2NvdW50JyAmJiBpbnB1dC5tZXRyaWMgIT09ICdkdXJhdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbWV0cmljIG11c3QgYmUgY291bnQgb3IgZHVyYXRpb24nKVxuICB9XG4gIGNvbnN0IGxpbmtzID0gdmFsaWRhdGVHb2FsTGlua3MoaW5wdXQubGlua3MsIHJ1bGVUeXBlKVxuICBjb25zdCBkZXBlbmRlbmNpZXMgPSB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoaW5wdXQuZGVwZW5kZW5jaWVzLCBydWxlVHlwZSlcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSB2YWxpZGF0ZUdvYWxEZWFkbGluZShpbnB1dC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSB2YWxpZGF0ZVN0YXJ0c0F0KGlucHV0LnN0YXJ0c0F0LCBub3cpID8/IG5vd1xuICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIGlmIChpbnB1dC5jb25maWc/LmJlZm9yZVRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYmVmb3JlVGltZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYmVmb3JlVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuICBpZiAoaW5wdXQuY29uZmlnPy5hZnRlclRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYWZ0ZXJUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhZnRlclRpbWUgbXVzdCBiZSBISDptbScpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHRpdGxlLFxuICAgIGNvbG9yLFxuICAgIHJ1bGVUeXBlLFxuICAgIHRhcmdldFZhbHVlLFxuICAgIGxpbmtzLFxuICAgIGRlcGVuZGVuY2llcyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIHN0YXJ0c0F0LFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dCxcbiAgZXhpc3RpbmdSdWxlVHlwZTogc3RyaW5nLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKSB7XG4gIGNvbnN0IHJ1bGVUeXBlID0gaW5wdXQucnVsZVR5cGUgIT0gbnVsbFxuICAgID8gdmFsaWRhdGVSdWxlVHlwZShpbnB1dC5ydWxlVHlwZSlcbiAgICA6IGV4aXN0aW5nUnVsZVR5cGVcblxuICBpZiAoaW5wdXQudGl0bGUgIT0gbnVsbCkgdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpXG4gIGlmIChpbnB1dC5jb2xvciAhPSBudWxsKSB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcilcbiAgaWYgKGlucHV0LnRhcmdldFZhbHVlICE9IG51bGwpIHZhbGlkYXRlVGFyZ2V0VmFsdWUoaW5wdXQudGFyZ2V0VmFsdWUpXG4gIGlmIChpbnB1dC5tZXRyaWMgIT0gbnVsbCAmJiBpbnB1dC5tZXRyaWMgIT09ICdjb3VudCcgJiYgaW5wdXQubWV0cmljICE9PSAnZHVyYXRpb24nKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ21ldHJpYyBtdXN0IGJlIGNvdW50IG9yIGR1cmF0aW9uJylcbiAgfVxuICBpZiAoaW5wdXQuc3RhdHVzICE9IG51bGwpIHtcbiAgICBjb25zdCBhbGxvd2VkID0gWydhY3RpdmUnLCAncGF1c2VkJywgJ2NvbXBsZXRlZCcsICdhcmNoaXZlZCcsICdmYWlsZWQnXVxuICAgIGlmICghYWxsb3dlZC5pbmNsdWRlcyhpbnB1dC5zdGF0dXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihgaW52YWxpZCBzdGF0dXM6ICR7aW5wdXQuc3RhdHVzfWApXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlua3MgPSBpbnB1dC5saW5rcyAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxMaW5rcyhpbnB1dC5saW5rcywgcnVsZVR5cGUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gaW5wdXQuZGVwZW5kZW5jaWVzICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhpbnB1dC5kZXBlbmRlbmNpZXMsIHJ1bGVUeXBlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBpbnB1dC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBkZWFkbGluZSA9IGlucHV0LmRlYWRsaW5lICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlYWRsaW5lKGlucHV0LmRlYWRsaW5lKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHN0YXJ0c0F0ID0gaW5wdXQuc3RhcnRzQXQgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVTdGFydHNBdChpbnB1dC5zdGFydHNBdCwgbm93KVxuICAgIDogdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcnVsZVR5cGUsIGxpbmtzLCBkZXBlbmRlbmNpZXMsIHJlY3VycmVuY2UsIGRlYWRsaW5lLCBzdGFydHNBdCB9XG59XG5cbi8qKlxuICogRGV0ZWN0cyB3aGV0aGVyIGFkZGluZyBlZGdlcyB3b3VsZCBjcmVhdGUgYSBjeWNsZSBpbiB0aGUgZGVwZW5kZW5jeSBEQUcuXG4gKiBgZWRnZXNgIGlzIHRoZSBmdWxsIGFkamFjZW5jeSBsaXN0IGFmdGVyIHRoZSBwcm9wb3NlZCBjaGFuZ2UgKGdvYWxJZCAtPiBkZXBzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKFxuICBlZGdlczogTWFwPG51bWJlciwgbnVtYmVyW10+LFxuICBzdGFydElkOiBudW1iZXIsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgdmlzaXRpbmcgPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCB2aXNpdGVkID0gbmV3IFNldDxudW1iZXI+KClcblxuICBmdW5jdGlvbiBkZnMobm9kZTogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgaWYgKHZpc2l0aW5nLmhhcyhub2RlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmlzaXRlZC5oYXMobm9kZSkpIHJldHVybiBmYWxzZVxuICAgIHZpc2l0aW5nLmFkZChub2RlKVxuICAgIGZvciAoY29uc3QgbmV4dCBvZiBlZGdlcy5nZXQobm9kZSkgPz8gW10pIHtcbiAgICAgIGlmIChkZnMobmV4dCkpIHJldHVybiB0cnVlXG4gICAgfVxuICAgIHZpc2l0aW5nLmRlbGV0ZShub2RlKVxuICAgIHZpc2l0ZWQuYWRkKG5vZGUpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gZGZzKHN0YXJ0SWQpXG59XG4iLCAiaW1wb3J0IHsgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciB9IGZyb20gJy4vdmFsaWRhdGlvbi50cydcblxuLyoqIE1pbnV0ZXMgYmVmb3JlIGFjdGl2aXR5IHN0YXJ0OyAwID0gYXQgc3RhcnQuIE1heCBsb29rYmFjayA9IDcgZGF5cy4gKi9cbmV4cG9ydCBjb25zdCBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVF9NSU5VVEVTID0gMTAwODBcbmV4cG9ydCBjb25zdCBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFMgPSA4XG5cbi8qKlxuICogTm9ybWFsaXplcyByZW1pbmRlciBvZmZzZXRzOiBjb2VyY2UgdG8gaW50cywgcmVqZWN0IG91dC1vZi1yYW5nZSxcbiAqIGRlZHVwZSwgc29ydCBhc2NlbmRpbmcuIEVtcHR5L251bGwgXHUyMTkyIFtdLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTm90aWZpY2F0aW9uT2Zmc2V0cyhcbiAgb2Zmc2V0czogbnVtYmVyW10gfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogbnVtYmVyW10ge1xuICBpZiAob2Zmc2V0cyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAob2Zmc2V0cy5sZW5ndGggPiBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFMpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgIGBub3RpZmljYXRpb25PZmZzZXRzIG11c3QgaGF2ZSBhdCBtb3N0ICR7TUFYX05PVElGSUNBVElPTl9PRkZTRVRTfSB2YWx1ZXNgLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCByZXN1bHQ6IG51bWJlcltdID0gW11cblxuICBmb3IgKGNvbnN0IHJhdyBvZiBvZmZzZXRzKSB7XG4gICAgaWYgKHR5cGVvZiByYXcgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUocmF3KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgJ25vdGlmaWNhdGlvbk9mZnNldHMgbXVzdCBiZSBpbnRlZ2VycycsXG4gICAgICApXG4gICAgfVxuICAgIGlmIChyYXcgPCAwIHx8IHJhdyA+IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVMpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICBgbm90aWZpY2F0aW9uT2Zmc2V0cyBtdXN0IGJlIGJldHdlZW4gMCBhbmQgJHtNQVhfTk9USUZJQ0FUSU9OX09GRlNFVF9NSU5VVEVTfWAsXG4gICAgICApXG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhyYXcpKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKHJhdylcbiAgICByZXN1bHQucHVzaChyYXcpXG4gIH1cblxuICByZXN1bHQuc29ydCgoYSwgYikgPT4gYSAtIGIpXG4gIHJldHVybiByZXN1bHRcbn1cbiIsICIvKiogUG9zdGdyZXMgYG51bWVyaWNgIGFycml2ZXMgYXMgc3RyaW5nIHZpYSBgcGdgOyBHcmFwaFFMIE51bWJlciByZXF1aXJlcyBKUyBudW1iZXIuICovXG5leHBvcnQgZnVuY3Rpb24gYXNOdW1iZXIodmFsdWU6IHVua25vd24sIGZhbGxiYWNrID0gMCk6IG51bWJlciB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gZmFsbGJhY2tcbiAgY29uc3QgbiA9IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBmYWxsYmFja1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNOdW1iZXJPck51bGwodmFsdWU6IHVua25vd24pOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IG4gPSB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInID8gdmFsdWUgOiBOdW1iZXIodmFsdWUpXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogbnVsbFxufVxuIiwgImltcG9ydCB0eXBlIHsgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBHb2FsIGFzIEdvYWxSb3csXG4gIEdvYWxDb25maWcsXG4gIEdvYWxDeWNsZSBhcyBHb2FsQ3ljbGVSb3csXG4gIEdvYWxEZWFkbGluZUNvbmZpZyxcbiAgR29hbERlcGVuZGVuY3kgYXMgR29hbERlcGVuZGVuY3lSb3csXG4gIEdvYWxMaW5rIGFzIEdvYWxMaW5rUm93LFxuICBHb2FsUHJvZ3Jlc3NTbmFwc2hvdCBhcyBHb2FsU25hcHNob3RSb3csXG4gIEdvYWxSZWN1cnJlbmNlQ29uZmlnLFxuICBOZXdHb2FsLFxuICBOZXdHb2FsRGVwZW5kZW5jeSxcbiAgTmV3R29hbExpbmssXG59IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGNyZWF0ZUluaXRpYWxDeWNsZSwgZGVhZGxpbmVTdGF0ZSwgbGlmZWN5Y2xlUGhhc2UsIHJlc2NoZWR1bGVBY3RpdmVDeWNsZSwgcm9sbE92ZXJJZk5lZWRlZCwgcm9sbE92ZXJVc2VyR29hbHMgfSBmcm9tICcuLi8uLi9nb2Fscy9jeWNsZXMudHMnXG5pbXBvcnQgeyBidWlsZEdvYWxOdWRnZXMgfSBmcm9tICcuLi8uLi9nb2Fscy9udWRnZXMudHMnXG5pbXBvcnQgeyByZWNvbXB1dGVBbGxBY3RpdmVDeWNsZXMsIHJlY29tcHV0ZUN5Y2xlIH0gZnJvbSAnLi4vLi4vZ29hbHMvcHJvZ3Jlc3MudHMnXG5pbXBvcnQgdHlwZSB7XG4gIENyZWF0ZUdvYWxJbnB1dCxcbiAgR29hbERlcGVuZGVuY3lJbnB1dCxcbiAgR29hbExpbmtJbnB1dCxcbiAgVXBkYXRlR29hbElucHV0LFxufSBmcm9tICcuLi90eXBlcy50cydcbmltcG9ydCB7XG4gIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydCxcbiAgSW52YWxpZEdvYWxFcnJvcixcbiAgdmFsaWRhdGVDcmVhdGVHb2FsSW5wdXQsXG4gIHZhbGlkYXRlR29hbENvbG9yLFxuICB2YWxpZGF0ZUdvYWxUaXRsZSxcbiAgdmFsaWRhdGVVcGRhdGVHb2FsSW5wdXQsXG4gIHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuaW1wb3J0IHsgYXNOdW1iZXIsIGFzTnVtYmVyT3JOdWxsIH0gZnJvbSAnLi4vbnVtZXJpYy50cydcblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24pOiBUIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgVFxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIFRcbn1cblxuLyoqIFBvc3RncmVzIGBudW1lcmljYCBhcnJpdmVzIGFzIHN0cmluZyB2aWEgYHBnYDsgR3JhcGhRTCBOdW1iZXIgcmVxdWlyZXMgSlMgbnVtYmVyLiAqL1xuZnVuY3Rpb24gbWFwQ3ljbGVTY2FsYXJzPFQgZXh0ZW5kcyBHb2FsQ3ljbGVSb3c+KGN5Y2xlOiBUKSB7XG4gIHJldHVybiB7XG4gICAgLi4uY3ljbGUsXG4gICAgdGFyZ2V0X3ZhbHVlOiBhc051bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpLFxuICAgIGN1cnJlbnRfdmFsdWU6IGFzTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpLFxuICAgIGNhcnJ5X292ZXI6IGFzTnVtYmVyKGN5Y2xlLmNhcnJ5X292ZXIpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcExpbmtTY2FsYXJzKGxpbms6IEdvYWxMaW5rUm93KSB7XG4gIHJldHVybiB7XG4gICAgLi4ubGluayxcbiAgICB3ZWlnaHQ6IGFzTnVtYmVyKGxpbmsud2VpZ2h0LCAxKSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBEZXBlbmRlbmN5U2NhbGFycyhkZXA6IEdvYWxEZXBlbmRlbmN5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uZGVwLFxuICAgIHRocmVzaG9sZDogYXNOdW1iZXJPck51bGwoZGVwLnRocmVzaG9sZCksXG4gICAgd2VpZ2h0OiBhc051bWJlcihkZXAud2VpZ2h0LCAxKSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBTbmFwc2hvdFNjYWxhcnMoc25hcHNob3Q6IEdvYWxTbmFwc2hvdFJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLnNuYXBzaG90LFxuICAgIHZhbHVlOiBhc051bWJlcihzbmFwc2hvdC52YWx1ZSksXG4gIH1cbn1cblxuZnVuY3Rpb24gdG9SZWN1cnJlbmNlSnNvbihcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dFsncmVjdXJyZW5jZSddIHwgVXBkYXRlR29hbElucHV0WydyZWN1cnJlbmNlJ10sXG4pOiBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwge1xuICBpZiAoaW5wdXQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHtcbiAgICBwZXJpb2Q6IGlucHV0LnBlcmlvZCxcbiAgICBpbnRlcnZhbDogaW5wdXQuaW50ZXJ2YWwsXG4gICAgYW5jaG9yOiBpbnB1dC5hbmNob3IsXG4gICAgY2Fycnlfb3ZlcjogaW5wdXQuY2FycnlPdmVyLFxuICAgIHJlc2V0OiBpbnB1dC5yZXNldCxcbiAgfVxufVxuXG5mdW5jdGlvbiB0b0RlYWRsaW5lSnNvbihcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dFsnZGVhZGxpbmUnXSB8IFVwZGF0ZUdvYWxJbnB1dFsnZGVhZGxpbmUnXSxcbik6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwge1xuICBpZiAoaW5wdXQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgcmV0dXJuIHtcbiAgICBraW5kOiBpbnB1dC5raW5kLFxuICAgIGRhdGU6IGlucHV0LmRhdGUsXG4gICAgZGF5c19hZnRlcl9jeWNsZV9zdGFydDogaW5wdXQuZGF5c0FmdGVyQ3ljbGVTdGFydCxcbiAgICBncmFjZV9kYXlzOiBpbnB1dC5ncmFjZURheXMsXG4gICAgd2Fybl9kYXlzOiBpbnB1dC53YXJuRGF5cyxcbiAgfVxufVxuXG5mdW5jdGlvbiB0b0NvbmZpZ0pzb24oXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXRbJ2NvbmZpZyddIHwgVXBkYXRlR29hbElucHV0Wydjb25maWcnXSxcbik6IEdvYWxDb25maWcge1xuICBpZiAoIWlucHV0KSByZXR1cm4ge31cbiAgcmV0dXJuIHtcbiAgICBjb21wb3NpdGVfbW9kZTogaW5wdXQuY29tcG9zaXRlTW9kZSxcbiAgICBjb3VudF9yZXF1aXJlZDogaW5wdXQuY291bnRSZXF1aXJlZCxcbiAgICBiZWZvcmVfdGltZTogaW5wdXQuYmVmb3JlVGltZSxcbiAgICBhZnRlcl90aW1lOiBpbnB1dC5hZnRlclRpbWUsXG4gICAgYmxvY2tfdW50aWxfdW5sb2NrZWQ6IGlucHV0LmJsb2NrVW50aWxVbmxvY2tlZCxcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEFjdGl2aXRpZXMoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICB1c2VySWQ6IG51bWJlcixcbiAgYWN0aXZpdHlJZHM6IG51bWJlcltdLFxuKSB7XG4gIGlmIChhY3Rpdml0eUlkcy5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCByb3dzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2FjdGl2aXRpZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnaWQnLCAnaW4nLCBhY3Rpdml0eUlkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGFjdGl2aXR5SWRzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdvbmUgb3IgbW9yZSBhY3Rpdml0aWVzIG5vdCBmb3VuZCcpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRHcm91cHMoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICB1c2VySWQ6IG51bWJlcixcbiAgZ3JvdXBJZHM6IG51bWJlcltdLFxuKSB7XG4gIGlmIChncm91cElkcy5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCByb3dzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dyb3VwcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdpZCcsICdpbicsIGdyb3VwSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gZ3JvdXBJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGdyb3VwcyBub3QgZm91bmQnKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkR29hbHMoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICB1c2VySWQ6IG51bWJlcixcbiAgZ29hbElkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGdvYWxJZHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdpZCcsICdpbicsIGdvYWxJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBnb2FsSWRzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdvbmUgb3IgbW9yZSBkZXBlbmRlbmN5IGdvYWxzIG5vdCBmb3VuZCcpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVwbGFjZUxpbmtzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgZ29hbElkOiBudW1iZXIsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBsaW5rczogR29hbExpbmtJbnB1dFtdLFxuKSB7XG4gIGF3YWl0IHRyeC5kZWxldGVGcm9tKCdnb2FsX2xpbmtzJykud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZCkuZXhlY3V0ZSgpXG4gIGNvbnN0IGFjdGl2aXR5SWRzID0gbGlua3NcbiAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtUeXBlID09PSAnYWN0aXZpdHknICYmIGwuYWN0aXZpdHlJZCAhPSBudWxsKVxuICAgIC5tYXAoKGwpID0+IGwuYWN0aXZpdHlJZCEpXG4gIGNvbnN0IGdyb3VwSWRzID0gbGlua3NcbiAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtUeXBlID09PSAnZ3JvdXAnICYmIGwuZ3JvdXBJZCAhPSBudWxsKVxuICAgIC5tYXAoKGwpID0+IGwuZ3JvdXBJZCEpXG4gIGF3YWl0IGFzc2VydE93bmVkQWN0aXZpdGllcyh0cngsIHVzZXJJZCwgYWN0aXZpdHlJZHMpXG4gIGF3YWl0IGFzc2VydE93bmVkR3JvdXBzKHRyeCwgdXNlcklkLCBncm91cElkcylcblxuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlua3MpIHtcbiAgICBhd2FpdCB0cnhcbiAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2xpbmtzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBnb2FsX2lkOiBnb2FsSWQsXG4gICAgICAgIGxpbmtfdHlwZTogbGluay5saW5rVHlwZSxcbiAgICAgICAgYWN0aXZpdHlfaWQ6IGxpbmsubGlua1R5cGUgPT09ICdhY3Rpdml0eScgPyBsaW5rLmFjdGl2aXR5SWQgPz8gbnVsbCA6IG51bGwsXG4gICAgICAgIGdyb3VwX2lkOiBsaW5rLmxpbmtUeXBlID09PSAnZ3JvdXAnID8gbGluay5ncm91cElkID8/IG51bGwgOiBudWxsLFxuICAgICAgICB3ZWlnaHQ6IGxpbmsud2VpZ2h0ID8/IDEsXG4gICAgICB9IGFzIE5ld0dvYWxMaW5rKVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VEZXBlbmRlbmNpZXMoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGRlcHM6IEdvYWxEZXBlbmRlbmN5SW5wdXRbXSxcbikge1xuICBjb25zdCBkZXBJZHMgPSBkZXBzLm1hcCgoZCkgPT4gZC5kZXBlbmRzT25Hb2FsSWQpXG4gIGlmIChkZXBJZHMuaW5jbHVkZXMoZ29hbElkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhIGdvYWwgY2Fubm90IGRlcGVuZCBvbiBpdHNlbGYnKVxuICB9XG4gIGF3YWl0IGFzc2VydE93bmVkR29hbHModHJ4LCB1c2VySWQsIGRlcElkcylcblxuICAvLyBCdWlsZCBhZGphY2VuY3kgZnJvbSBhbGwgZXhpc3RpbmcgZGVwcyBmb3IgdGhpcyB1c2VyLCByZXBsYWNpbmcgdGhpcyBnb2FsJ3MgZWRnZXMuXG4gIGNvbnN0IGFsbEdvYWxzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgLmlubmVySm9pbignZ29hbHMnLCAnZ29hbHMuaWQnLCAnZ29hbF9kZXBlbmRlbmNpZXMuZ29hbF9pZCcpXG4gICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdChbXG4gICAgICAnZ29hbF9kZXBlbmRlbmNpZXMuZ29hbF9pZCcsXG4gICAgICAnZ29hbF9kZXBlbmRlbmNpZXMuZGVwZW5kc19vbl9nb2FsX2lkJyxcbiAgICBdKVxuICAgIC5leGVjdXRlKClcblxuICBjb25zdCBlZGdlcyA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXJbXT4oKVxuICBmb3IgKGNvbnN0IGcgb2YgYWxsR29hbHMpIGVkZ2VzLnNldChnLmlkLCBbXSlcbiAgZm9yIChjb25zdCBlIG9mIGV4aXN0aW5nKSB7XG4gICAgaWYgKGUuZ29hbF9pZCA9PT0gZ29hbElkKSBjb250aW51ZVxuICAgIGVkZ2VzLmdldChlLmdvYWxfaWQpPy5wdXNoKGUuZGVwZW5kc19vbl9nb2FsX2lkKVxuICB9XG4gIGVkZ2VzLnNldChnb2FsSWQsIGRlcElkcylcblxuICBpZiAod291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUoZWRnZXMsIGdvYWxJZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVwZW5kZW5jeSBjeWNsZSBkZXRlY3RlZCcpXG4gIH1cblxuICBhd2FpdCB0cnguZGVsZXRlRnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKS53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKS5leGVjdXRlKClcbiAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgIGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBnb2FsX2lkOiBnb2FsSWQsXG4gICAgICAgIGRlcGVuZHNfb25fZ29hbF9pZDogZGVwLmRlcGVuZHNPbkdvYWxJZCxcbiAgICAgICAgcmVxdWlyZW1lbnQ6IGRlcC5yZXF1aXJlbWVudCA/PyAnY29tcGxldGUnLFxuICAgICAgICB0aHJlc2hvbGQ6IGRlcC50aHJlc2hvbGQgPz8gbnVsbCxcbiAgICAgICAgd2VpZ2h0OiBkZXAud2VpZ2h0ID8/IDEsXG4gICAgICB9IGFzIE5ld0dvYWxEZXBlbmRlbmN5KVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlcGVuZGVuY2llc01ldChcbiAgZ29hbElkOiBudW1iZXIsXG4gIHVzZXJJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGRlcHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAoZGVwcy5sZW5ndGggPT09IDApIHJldHVybiB0cnVlXG5cbiAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgIGNvbnN0IGNoaWxkR29hbCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjaGlsZEdvYWwpIHJldHVybiBmYWxzZVxuXG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghY3ljbGUpIHJldHVybiBmYWxzZVxuXG4gICAgaWYgKGRlcC5yZXF1aXJlbWVudCA9PT0gJ2NvbXBsZXRlJykge1xuICAgICAgY29uc3QgdGFyZ2V0TWV0ID1cbiAgICAgICAgTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwICYmXG4gICAgICAgIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgaWYgKFxuICAgICAgICBjeWNsZS5zdGF0dXMgIT09ICdzdWNjZWVkZWQnICYmXG4gICAgICAgIGNoaWxkR29hbC5zdGF0dXMgIT09ICdjb21wbGV0ZWQnICYmXG4gICAgICAgICF0YXJnZXRNZXRcbiAgICAgICkge1xuICAgICAgICByZXR1cm4gZmFsc2VcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgY29uc3QgdGhyZXNob2xkID0gZGVwLnRocmVzaG9sZCA/PyBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgaWYgKE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA8IE51bWJlcih0aHJlc2hvbGQpKSByZXR1cm4gZmFsc2VcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRydWVcbn1cblxuZnVuY3Rpb24gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbDogR29hbFJvdykge1xuICBjb25zdCBjb25maWcgPSBwYXJzZUpzb248R29hbENvbmZpZz4oZ29hbC5jb25maWcpID8/IHt9XG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpXG5cbiAgcmV0dXJuIHtcbiAgICAuLi5nb2FsLFxuICAgIHRhcmdldF92YWx1ZTogYXNOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgIHN0YXJ0c0F0OiBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdCkudG9JU09TdHJpbmcoKSxcbiAgICBsaWZlY3ljbGVQaGFzZTogbGlmZWN5Y2xlUGhhc2UoZ29hbCwgbm93KSxcbiAgICBjb25maWcsXG4gICAgcmVjdXJyZW5jZSxcbiAgICBkZWFkbGluZSxcbiAgICBsaW5rczogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKChsaW5rKSA9PiAoe1xuICAgICAgICAuLi5tYXBMaW5rU2NhbGFycyhsaW5rKSxcbiAgICAgICAgYWN0aXZpdHk6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAobGluay5hY3Rpdml0eV9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2FjdGl2aXRpZXMnKVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgbGluay5hY3Rpdml0eV9pZClcbiAgICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsXG4gICAgICAgIH0sXG4gICAgICAgIGdyb3VwOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKGxpbmsuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdncm91cHMnKVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgbGluay5ncm91cF9pZClcbiAgICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsXG4gICAgICAgIH0sXG4gICAgICB9KSlcbiAgICB9LFxuICAgIGFjdGl2ZUN5Y2xlOiBhc3luYyAoKSA9PiB7XG4gICAgICBsZXQgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKGN5Y2xlICYmIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJykge1xuICAgICAgICBjeWNsZSA9IGF3YWl0IHJvbGxPdmVySWZOZWVkZWQoZGIsIGdvYWwsIGN5Y2xlKVxuICAgICAgfVxuICAgICAgLy8gRmFsbCBiYWNrIHRvIGxhdGVzdCBjeWNsZSBzbyBjb21wbGV0ZWQgLyBtaWQtd2luZG93IHN1Y2NlZWRlZCBjeWNsZXNcbiAgICAgIC8vIHN0aWxsIGV4cG9zZSBwcm9ncmVzcy4gQWxzbyByZXBhaXIgcmVjdXJyaW5nIGN5Y2xlcyB0aGF0IHdlcmUgY2xvc2VkXG4gICAgICAvLyBlYXJseSAoYmVmb3JlIGVuZHNfYXQpIHNvIHRoZXkgcmVtYWluIHRoZSBhY3RpdmUgd2luZG93LlxuICAgICAgaWYgKCFjeWNsZSkge1xuICAgICAgICBjb25zdCBsYXRlc3QgPSBhd2FpdCBkYlxuICAgICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICAgIGlmIChcbiAgICAgICAgICBsYXRlc3QgJiZcbiAgICAgICAgICBnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiZcbiAgICAgICAgICBnb2FsLnJlY3VycmVuY2UgIT0gbnVsbCAmJlxuICAgICAgICAgIGxhdGVzdC5zdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmXG4gICAgICAgICAgKCFsYXRlc3QuZW5kc19hdCB8fCBub3cgPCBuZXcgRGF0ZShsYXRlc3QuZW5kc19hdCkpXG4gICAgICAgICkge1xuICAgICAgICAgIGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAgICAgLnNldCh7IHN0YXR1czogJ2FjdGl2ZScsIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpIH0pXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsYXRlc3QuaWQpXG4gICAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgY3ljbGUgPSBsYXRlc3RcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgaWYgKCFjeWNsZSkgcmV0dXJuIG51bGxcbiAgICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUpXG4gICAgICBjb25zdCB0YXJnZXQgPSBhc051bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBjb25zdCBjdXJyZW50ID0gYXNOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLm1hcEN5Y2xlU2NhbGFycyhjeWNsZSksXG4gICAgICAgIGRlYWRsaW5lU3RhdGU6IHN0YXRlLFxuICAgICAgICBwZXJjZW50Q29tcGxldGU6IHRhcmdldCA+IDAgPyBNYXRoLm1pbigxLCBjdXJyZW50IC8gdGFyZ2V0KSA6IDAsXG4gICAgICAgIHJlbWFpbmluZzogTWF0aC5tYXgoMCwgdGFyZ2V0IC0gY3VycmVudCksXG4gICAgICB9XG4gICAgfSxcbiAgICBjeWNsZXM6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdhc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKG1hcEN5Y2xlU2NhbGFycylcbiAgICB9LFxuICAgIGRlcGVuZGVuY2llczogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcCgoZGVwKSA9PiAoe1xuICAgICAgICAuLi5tYXBEZXBlbmRlbmN5U2NhbGFycyhkZXApLFxuICAgICAgICBkZXBlbmRzT246IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBjb25zdCBnID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICAgICAgcmV0dXJuIGcgPyB3aXRoR29hbFJlbGF0aW9ucyhnKSA6IG51bGxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0sXG4gICAgc25hcHNob3RzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIWN5Y2xlKSByZXR1cm4gW11cbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfY3ljbGVfaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgICAgICAub3JkZXJCeSgnYXNfb2YnLCAnYXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcChtYXBTbmFwc2hvdFNjYWxhcnMpXG4gICAgfSxcbiAgICBpc0xvY2tlZDogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKCFjb25maWcuYmxvY2tfdW50aWxfdW5sb2NrZWQpIHJldHVybiBmYWxzZVxuICAgICAgcmV0dXJuICEoYXdhaXQgZGVwZW5kZW5jaWVzTWV0KGdvYWwuaWQsIGdvYWwudXNlcl9pZCkpXG4gICAgfSxcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgR29hbFF1ZXJ5ID0ge1xuICBnb2FsczogYXN5bmMgKGFyZ3M/OiB7IHN0YXR1cz86IHN0cmluZyB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcm9sbE92ZXJVc2VyR29hbHMoZGIsIHVzZXJJZClcblxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgncHJpb3JpdHknLCAnZGVzYycpXG4gICAgICAub3JkZXJCeSgnc29ydF9vcmRlcicsICdhc2MnKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG5cbiAgICBpZiAoYXJncz8uc3RhdHVzKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdzdGF0dXMnLCAnPScsIGFyZ3Muc3RhdHVzIGFzIEdvYWxSb3dbJ3N0YXR1cyddKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEdvYWxSZWxhdGlvbnMpXG4gIH0sXG5cbiAgZ29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcm9sbE92ZXJVc2VyR29hbHMoZGIsIHVzZXJJZClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyB3aXRoR29hbFJlbGF0aW9ucyhyb3cpIDogbnVsbFxuICB9LFxuXG4gIGdvYWxOdWRnZXM6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzXG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcm9sbE92ZXJVc2VyR29hbHMoZGIsIHVzZXJJZClcbiAgICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IHBhaXJzID0gW11cbiAgICBmb3IgKGNvbnN0IGdvYWwgb2YgZ29hbHMpIHtcbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIHBhaXJzLnB1c2goeyBnb2FsLCBjeWNsZTogY3ljbGUgPz8gbnVsbCB9KVxuICAgIH1cbiAgICByZXR1cm4gYnVpbGRHb2FsTnVkZ2VzKHBhaXJzKVxuICB9LFxuXG4gIGRhaWx5UHJvZ3Jlc3M6IGFzeW5jIChhcmdzPzogeyBkYXRlPzogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBkYXRlID0gYXJncz8uZGF0ZSA/PyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG5cbiAgICBjb25zdCBjb21wbGV0aW9ucyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdHlfY29tcGxldGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ29jY3VycmVuY2VfZGF0ZScsICc9JywgZGF0ZSlcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgdGltZUV2ZW50cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9ldmVudHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ21ldHJpYycsICc9JywgJ2R1cmF0aW9uJylcbiAgICAgIC53aGVyZSgnb2NjdXJyZW5jZV9kYXRlJywgJz0nLCBkYXRlKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCBtaW51dGVzVG9kYXkgPSB0aW1lRXZlbnRzLnJlZHVjZShcbiAgICAgIChzdW0sIGUpID0+IHN1bSArIE51bWJlcihlLmFtb3VudCksXG4gICAgICAwLFxuICAgIClcblxuICAgIC8vIFN0cmVhazogY29uc2VjdXRpdmUgZGF5cyBlbmRpbmcgdG9kYXkgd2l0aCA+PSAxIGNvbXBsZXRpb24uXG4gICAgbGV0IHN0cmVhayA9IDBcbiAgICBjb25zdCBjdXJzb3IgPSBuZXcgRGF0ZShkYXRlICsgJ1QwMDowMDowMFonKVxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgMzY1OyBpKyspIHtcbiAgICAgIGNvbnN0IGRheSA9IGN1cnNvci50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2FjdGl2aXR5X2NvbXBsZXRpb25zJylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgnb2NjdXJyZW5jZV9kYXRlJywgJz0nLCBkYXkpXG4gICAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFyb3cpIGJyZWFrXG4gICAgICBzdHJlYWsrK1xuICAgICAgY3Vyc29yLnNldFVUQ0RhdGUoY3Vyc29yLmdldFVUQ0RhdGUoKSAtIDEpXG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGRhdGUsXG4gICAgICBjb21wbGV0ZWRDb3VudDogY29tcGxldGlvbnMubGVuZ3RoLFxuICAgICAgbWludXRlc1RvZGF5LFxuICAgICAgc3RyZWFrRGF5czogc3RyZWFrLFxuICAgICAgY29tcGxldGlvbnMsXG4gICAgfVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgR29hbE11dGF0aW9uID0ge1xuICBjcmVhdGVHb2FsOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlR29hbElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBpbnB1dCA9IGFyZ3MuaW5wdXRcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVDcmVhdGVHb2FsSW5wdXQoaW5wdXQsIG5vdylcblxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgY3JlYXRlZCA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50bygnZ29hbHMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgdGl0bGU6IHZhbGlkYXRlZC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24gPz8gbnVsbCxcbiAgICAgICAgICBjb2xvcjogdmFsaWRhdGVkLmNvbG9yLFxuICAgICAgICAgIGljb246IGlucHV0Lmljb24gPz8gbnVsbCxcbiAgICAgICAgICBydWxlX3R5cGU6IHZhbGlkYXRlZC5ydWxlVHlwZSxcbiAgICAgICAgICBtZXRyaWM6IGlucHV0Lm1ldHJpYyxcbiAgICAgICAgICB0YXJnZXRfdmFsdWU6IHZhbGlkYXRlZC50YXJnZXRWYWx1ZSxcbiAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KHRvQ29uZmlnSnNvbihpbnB1dC5jb25maWcpKSxcbiAgICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICAgIHJlY3VycmVuY2U6IHZhbGlkYXRlZC5yZWN1cnJlbmNlXG4gICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvUmVjdXJyZW5jZUpzb24odmFsaWRhdGVkLnJlY3VycmVuY2UpKVxuICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgIGRlYWRsaW5lOiB2YWxpZGF0ZWQuZGVhZGxpbmVcbiAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9EZWFkbGluZUpzb24odmFsaWRhdGVkLmRlYWRsaW5lKSlcbiAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICBwcmlvcml0eTogaW5wdXQucHJpb3JpdHkgPz8gMCxcbiAgICAgICAgICBzb3J0X29yZGVyOiBpbnB1dC5zb3J0T3JkZXIgPz8gMCxcbiAgICAgICAgICBzdGFydHNfYXQ6IHZhbGlkYXRlZC5zdGFydHNBdC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB9IGFzIE5ld0dvYWwpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgICBhd2FpdCByZXBsYWNlTGlua3ModHJ4LCBjcmVhdGVkLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5saW5rcylcbiAgICAgIGF3YWl0IHJlcGxhY2VEZXBlbmRlbmNpZXModHJ4LCBjcmVhdGVkLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5kZXBlbmRlbmNpZXMpXG4gICAgICBhd2FpdCBjcmVhdGVJbml0aWFsQ3ljbGUodHJ4LCBjcmVhdGVkLCBub3cpXG4gICAgICByZXR1cm4gY3JlYXRlZFxuICAgIH0pXG5cbiAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShcbiAgICAgIGRiLFxuICAgICAgZ29hbCxcbiAgICAgIChhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKSksXG4gICAgICBub3csXG4gICAgKVxuXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKFxuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpLFxuICAgIClcbiAgfSxcblxuICB1cGRhdGVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlR29hbElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgY29uc3Qgbm93RGF0ZSA9IG5ldyBEYXRlKClcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dChcbiAgICAgIGFyZ3MuaW5wdXQsXG4gICAgICBleGlzdGluZy5ydWxlX3R5cGUsXG4gICAgICBub3dEYXRlLFxuICAgIClcbiAgICBjb25zdCBpbnB1dCA9IGFyZ3MuaW5wdXRcbiAgICBjb25zdCBub3cgPSBub3dEYXRlLnRvSVNPU3RyaW5nKClcblxuICAgIGNvbnN0IGFjdGl2ZUN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBsZXQgbmV4dFN0YXJ0c0F0OiBEYXRlIHwgdW5kZWZpbmVkXG4gICAgaWYgKHZhbGlkYXRlZC5zdGFydHNBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoZXhpc3Rpbmcuc3RhdHVzID09PSAnY29tcGxldGVkJyB8fCBleGlzdGluZy5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICdjYW5ub3QgY2hhbmdlIHN0YXJ0c0F0IG9uIGEgY29tcGxldGVkIG9yIGZhaWxlZCBnb2FsJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgaWYgKHZhbGlkYXRlZC5zdGFydHNBdCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdzdGFydHNBdCBjYW5ub3QgYmUgY2xlYXJlZDsgb21pdCB0byBsZWF2ZSB1bmNoYW5nZWQnKVxuICAgICAgfVxuICAgICAgbmV4dFN0YXJ0c0F0ID0gdmFsaWRhdGVkLnN0YXJ0c0F0XG5cbiAgICAgIGNvbnN0IGNsb3NlZEN5Y2xlcyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZXhpc3RpbmcuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJyE9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICAvLyBBZnRlciBjeWNsZSAwIGhhcyBjbG9zZWQsIHN0YXJ0IGlzIGZyb3plbi5cbiAgICAgIGlmIChjbG9zZWRDeWNsZXMgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgICAnY2Fubm90IGNoYW5nZSBzdGFydHNBdCBhZnRlciB0aGUgZmlyc3QgY3ljbGUgaGFzIGNsb3NlZCcsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHJvZ3Jlc3NCZWd1biA9XG4gICAgICAgIGFjdGl2ZUN5Y2xlICE9IG51bGwgJiYgTnVtYmVyKGFjdGl2ZUN5Y2xlLmN1cnJlbnRfdmFsdWUpID4gMFxuXG4gICAgICBpZiAoXG4gICAgICAgIHByb2dyZXNzQmVndW4gJiZcbiAgICAgICAgbmV4dFN0YXJ0c0F0LmdldFRpbWUoKSA+IG5ldyBEYXRlKGV4aXN0aW5nLnN0YXJ0c19hdCkuZ2V0VGltZSgpXG4gICAgICApIHtcbiAgICAgICAgaWYgKCFpbnB1dC5jb25maXJtU3RhcnRzQXRDaGFuZ2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgICAgICdtb3Zpbmcgc3RhcnRzQXQgbGF0ZXIgYWZ0ZXIgcHJvZ3Jlc3MgcmVxdWlyZXMgY29uZmlybVN0YXJ0c0F0Q2hhbmdlJyxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBlZmZlY3RpdmVTdGFydHNBdCA9IG5leHRTdGFydHNBdCA/PyBuZXcgRGF0ZShleGlzdGluZy5zdGFydHNfYXQpXG4gICAgY29uc3QgZWZmZWN0aXZlRGVhZGxpbmUgPSB2YWxpZGF0ZWQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZWQuZGVhZGxpbmVcbiAgICAgIDogKCgpID0+IHtcbiAgICAgICAgY29uc3QgZCA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGV4aXN0aW5nLmRlYWRsaW5lKVxuICAgICAgICBpZiAoIWQpIHJldHVybiBudWxsXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2luZDogZC5raW5kLFxuICAgICAgICAgIGRhdGU6IGQuZGF0ZSxcbiAgICAgICAgICBkYXlzQWZ0ZXJDeWNsZVN0YXJ0OiBkLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQsXG4gICAgICAgICAgZ3JhY2VEYXlzOiBkLmdyYWNlX2RheXMsXG4gICAgICAgICAgd2FybkRheXM6IGQud2Fybl9kYXlzLFxuICAgICAgICB9XG4gICAgICB9KSgpXG4gICAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0KGVmZmVjdGl2ZVN0YXJ0c0F0LCBlZmZlY3RpdmVEZWFkbGluZSlcblxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIC4uLihpbnB1dC50aXRsZSAhPSBudWxsXG4gICAgICAgICAgICA/IHsgdGl0bGU6IHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7IGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbiB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuY29sb3IgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IGNvbG9yOiB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcikgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0Lmljb24gIT09IHVuZGVmaW5lZCA/IHsgaWNvbjogaW5wdXQuaWNvbiB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5ydWxlVHlwZSAhPSBudWxsID8geyBydWxlX3R5cGU6IHZhbGlkYXRlZC5ydWxlVHlwZSB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5tZXRyaWMgIT0gbnVsbCA/IHsgbWV0cmljOiBpbnB1dC5tZXRyaWMgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IHRhcmdldF92YWx1ZTogaW5wdXQudGFyZ2V0VmFsdWUgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LmNvbmZpZyAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgY29uZmlnOiBKU09OLnN0cmluZ2lmeSh0b0NvbmZpZ0pzb24oaW5wdXQuY29uZmlnKSkgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnN0YXR1cyAhPSBudWxsID8geyBzdGF0dXM6IGlucHV0LnN0YXR1cyB9IDoge30pLFxuICAgICAgICAgIC4uLih2YWxpZGF0ZWQucmVjdXJyZW5jZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgcmVjdXJyZW5jZTogdmFsaWRhdGVkLnJlY3VycmVuY2VcbiAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvUmVjdXJyZW5jZUpzb24odmFsaWRhdGVkLnJlY3VycmVuY2UpKVxuICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLih2YWxpZGF0ZWQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIGRlYWRsaW5lOiB2YWxpZGF0ZWQuZGVhZGxpbmVcbiAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvRGVhZGxpbmVKc29uKHZhbGlkYXRlZC5kZWFkbGluZSkpXG4gICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKG5leHRTdGFydHNBdCAhPSBudWxsXG4gICAgICAgICAgICA/IHsgc3RhcnRzX2F0OiBuZXh0U3RhcnRzQXQudG9JU09TdHJpbmcoKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQucHJpb3JpdHkgIT0gbnVsbCA/IHsgcHJpb3JpdHk6IGlucHV0LnByaW9yaXR5IH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnNvcnRPcmRlciAhPSBudWxsID8geyBzb3J0X29yZGVyOiBpbnB1dC5zb3J0T3JkZXIgfSA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGlmICh2YWxpZGF0ZWQubGlua3MpIHtcbiAgICAgICAgYXdhaXQgcmVwbGFjZUxpbmtzKHRyeCwgYXJncy5pZCwgdXNlcklkLCB2YWxpZGF0ZWQubGlua3MpXG4gICAgICB9XG4gICAgICBpZiAodmFsaWRhdGVkLmRlcGVuZGVuY2llcykge1xuICAgICAgICBhd2FpdCByZXBsYWNlRGVwZW5kZW5jaWVzKHRyeCwgYXJncy5pZCwgdXNlcklkLCB2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBnb2FsQWZ0ZXIgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmIChjeWNsZSAmJiBuZXh0U3RhcnRzQXQgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCByZXNjaGVkdWxlQWN0aXZlQ3ljbGUodHJ4LCBnb2FsQWZ0ZXIsIGN5Y2xlLCBuZXh0U3RhcnRzQXQsIG5vd0RhdGUpXG4gICAgICB9IGVsc2UgaWYgKGN5Y2xlICYmIGlucHV0LnRhcmdldFZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICB0YXJnZXRfdmFsdWU6IGlucHV0LnRhcmdldFZhbHVlLFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgY3ljbGUgJiZcbiAgICAgICAgKHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkIHx8IHZhbGlkYXRlZC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWQpICYmXG4gICAgICAgIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA9PT0gMCAmJlxuICAgICAgICBjeWNsZS5jeWNsZV9pbmRleCA9PT0gMFxuICAgICAgKSB7XG4gICAgICAgIC8vIFJlZnJlc2ggYm91bmRzIG9uIHVuc3RhcnRlZCBjeWNsZSAwIHdoZW4gZGVhZGxpbmUvcmVjdXJyZW5jZSBjaGFuZ2UuXG4gICAgICAgIGF3YWl0IHJlc2NoZWR1bGVBY3RpdmVDeWNsZShcbiAgICAgICAgICB0cngsXG4gICAgICAgICAgZ29hbEFmdGVyLFxuICAgICAgICAgIGN5Y2xlLFxuICAgICAgICAgIG5ldyBEYXRlKGdvYWxBZnRlci5zdGFydHNfYXQpLFxuICAgICAgICAgIG5vd0RhdGUsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKGN5Y2xlKSBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUsIG5vd0RhdGUpXG5cbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICBwYXVzZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAncGF1c2VkJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgcmVzdW1lR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY3RpdmUnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAncGF1c2VkJylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICBhcmNoaXZlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdhcmNoaXZlZCcsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIGRlbGV0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMFxuICB9LFxuXG4gIHJlY29tcHV0ZUdvYWxQcm9ncmVzczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3NcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBjb3VudCA9IGF3YWl0IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcyhkYiwgdXNlcklkKVxuICAgIHJldHVybiB7IHJlY29tcHV0ZWQ6IGNvdW50IH1cbiAgfSxcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxEZWFkbGluZUNvbmZpZyxcbiAgR29hbFJlY3VycmVuY2VDb25maWcsXG4gIE5ld0dvYWxDeWNsZSxcbn0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3ljbGVIYXNTdGFydGVkIH0gZnJvbSAnLi9saWZlY3ljbGUudHMnXG5pbXBvcnQgeyByZWNvbXB1dGVDeWNsZSB9IGZyb20gJy4vcHJvZ3Jlc3MudHMnXG5cbmV4cG9ydCB7XG4gIGN5Y2xlSGFzU3RhcnRlZCxcbiAgbGlmZWN5Y2xlUGhhc2UsXG4gIHR5cGUgR29hbExpZmVjeWNsZVBoYXNlLFxufSBmcm9tICcuL2xpZmVjeWNsZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgVFxufVxuXG5mdW5jdGlvbiBhZGREYXlzKGRhdGU6IERhdGUsIGRheXM6IG51bWJlcik6IERhdGUge1xuICBjb25zdCBkID0gbmV3IERhdGUoZGF0ZSlcbiAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgZGF5cylcbiAgcmV0dXJuIGRcbn1cblxuZnVuY3Rpb24gYWRkTW9udGhzKGRhdGU6IERhdGUsIG1vbnRoczogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlKVxuICBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIG1vbnRocylcbiAgcmV0dXJuIGRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVDeWNsZUVuZChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKCFyZWN1cnJlbmNlKSByZXR1cm4gbnVsbFxuICBjb25zdCBpbnRlcnZhbCA9IE1hdGgubWF4KDEsIHJlY3VycmVuY2UuaW50ZXJ2YWwgPz8gMSlcbiAgc3dpdGNoIChyZWN1cnJlbmNlLnBlcmlvZCkge1xuICAgIGNhc2UgJ3dlZWtseSc6XG4gICAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgNyAqIGludGVydmFsKVxuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgcmV0dXJuIGFkZE1vbnRocyhzdGFydHNBdCwgaW50ZXJ2YWwpXG4gICAgY2FzZSAncXVhcnRlcmx5JzpcbiAgICAgIHJldHVybiBhZGRNb250aHMoc3RhcnRzQXQsIDMgKiBpbnRlcnZhbClcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIGludGVydmFsKVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlRGVhZGxpbmVBdChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoIWRlYWRsaW5lKSByZXR1cm4gbnVsbFxuICBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ2Fic29sdXRlJyAmJiBkZWFkbGluZS5kYXRlKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKGRlYWRsaW5lLmRhdGUgKyAnVDIzOjU5OjU5Ljk5OVonKVxuICB9XG4gIGlmIChkZWFkbGluZS5raW5kID09PSAncmVsYXRpdmUnICYmIGRlYWRsaW5lLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQgIT0gbnVsbCkge1xuICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCBkZWFkbGluZS5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0KVxuICB9XG4gIHJldHVybiBudWxsXG59XG5cbmV4cG9ydCB0eXBlIERlYWRsaW5lU3RhdGUgPSAnb25fdHJhY2snIHwgJ2FwcHJvYWNoaW5nJyB8ICdvdmVyZHVlJyB8ICdmYWlsZWQnXG5cbmV4cG9ydCBmdW5jdGlvbiBkZWFkbGluZVN0YXRlKFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IERlYWRsaW5lU3RhdGUge1xuICBpZiAoIWN5Y2xlLmRlYWRsaW5lX2F0KSByZXR1cm4gJ29uX3RyYWNrJ1xuICBjb25zdCBkZWFkbGluZUF0ID0gbmV3IERhdGUoY3ljbGUuZGVhZGxpbmVfYXQpXG4gIGNvbnN0IGdyYWNlID0gZGVhZGxpbmU/LmdyYWNlX2RheXMgPz8gMFxuICBjb25zdCB3YXJuID0gZGVhZGxpbmU/Lndhcm5fZGF5cyA/PyAzXG4gIGNvbnN0IGdyYWNlRW5kID0gYWRkRGF5cyhkZWFkbGluZUF0LCBncmFjZSlcblxuICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKSB7XG4gICAgcmV0dXJuICdvbl90cmFjaydcbiAgfVxuICBpZiAobm93ID4gZ3JhY2VFbmQpIHJldHVybiAnZmFpbGVkJ1xuICBpZiAobm93ID4gZGVhZGxpbmVBdCkgcmV0dXJuICdvdmVyZHVlJ1xuICBjb25zdCB3YXJuU3RhcnQgPSBhZGREYXlzKGRlYWRsaW5lQXQsIC13YXJuKVxuICBpZiAobm93ID49IHdhcm5TdGFydCkgcmV0dXJuICdhcHByb2FjaGluZydcbiAgcmV0dXJuICdvbl90cmFjaydcbn1cblxuZnVuY3Rpb24gZGF0ZU9ubHlJc28oZGF0ZTogRGF0ZSk6IHN0cmluZyB7XG4gIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlU25hcHNob3QoXG4gIGRiOiBEYkxpa2UsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIGFzT2Y6IERhdGUsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgYXNPZlN0ciA9IGRhdGVPbmx5SXNvKGFzT2YpXG4gIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGdvYWxfY3ljbGVfaWQ6IGN5Y2xlLmlkLFxuICAgICAgYXNfb2Y6IGFzT2ZTdHIsXG4gICAgICB2YWx1ZTogTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpLFxuICAgIH0pXG4gICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgb2MuY29sdW1ucyhbJ2dvYWxfY3ljbGVfaWQnLCAnYXNfb2YnXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICB2YWx1ZTogTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpLFxuICAgICAgfSlcbiAgICApXG4gICAgLmV4ZWN1dGUoKVxufVxuXG4vKipcbiAqIENyZWF0ZSB0aGUgZmlyc3QgY3ljbGUgZm9yIGEgbmV3bHkgY3JlYXRlZCBnb2FsLlxuICogVXNlcyBnb2FsLnN0YXJ0c19hdCBhcyB0aGUgY3ljbGUgd2luZG93IHN0YXJ0IChub3Qgd2FsbC1jbG9jayBub3cpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlSW5pdGlhbEN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IHN0YXJ0c0F0ID0gbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpXG4gIGNvbnN0IGVuZHNBdCA9IGNvbXB1dGVDeWNsZUVuZChzdGFydHNBdCwgcmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmVBdCA9IGNvbXB1dGVEZWFkbGluZUF0KHN0YXJ0c0F0LCBkZWFkbGluZSlcblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9pZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlX2luZGV4OiAwLFxuICAgICAgc3RhcnRzX2F0OiBzdGFydHNBdC50b0lTT1N0cmluZygpLFxuICAgICAgZW5kc19hdDogZW5kc0F0ID8gZW5kc0F0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgZGVhZGxpbmVfYXQ6IGRlYWRsaW5lQXQgPyBkZWFkbGluZUF0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgY3VycmVudF92YWx1ZTogMCxcbiAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICBjYXJyeV9vdmVyOiAwLFxuICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuXG4vKipcbiAqIFJld3JpdGUgYW4gYWN0aXZlIGN5Y2xlJ3Mgd2luZG93IGZyb20gYSBuZXcgc3RhcnRzX2F0IChhbmQgb3B0aW9uYWxcbiAqIHVwZGF0ZWQgZ29hbCByZWN1cnJlbmNlL2RlYWRsaW5lL3RhcmdldCkuIFVzZWQgd2hlbiBlZGl0aW5nIHN0YXJ0IGRhdGVcbiAqIGJlZm9yZSBwcm9ncmVzcyAvIHdoZW4gcmVzY2hlZHVsaW5nIGFuIHVuc3RhcnRlZCBjeWNsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc2NoZWR1bGVBY3RpdmVDeWNsZShcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3QgZW5kc0F0ID0gY29tcHV0ZUN5Y2xlRW5kKHN0YXJ0c0F0LCByZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZUF0ID0gY29tcHV0ZURlYWRsaW5lQXQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgIC5zZXQoe1xuICAgICAgc3RhcnRzX2F0OiBzdGFydHNBdC50b0lTT1N0cmluZygpLFxuICAgICAgZW5kc19hdDogZW5kc0F0ID8gZW5kc0F0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgZGVhZGxpbmVfYXQ6IGRlYWRsaW5lQXQgPyBkZWFkbGluZUF0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuXG4vKipcbiAqIENsb3NlIGFuIGFjdGl2ZSBjeWNsZSBhbmQgb3BlbiB0aGUgbmV4dCBvbmUgd2hlbiByZWN1cnJlbmNlIGFwcGxpZXMuXG4gKiBVc2VzIGxhenktb24tcmVhZDogY2FsbCBiZWZvcmUgcmV0dXJuaW5nIGdvYWxzIHRvIHRoZSBjbGllbnQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb2xsT3ZlcklmTmVlZGVkKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgLy8gRG8gbm90IHJvbGwgb3ZlciwgbWlzcy1iYWNrZmlsbCwgb3IgZmFpbCBkZWFkbGluZXMgYmVmb3JlIHRoZSBjeWNsZSBzdGFydHMuXG4gIGlmICghY3ljbGVIYXNTdGFydGVkKGN5Y2xlLCBub3cpKSB7XG4gICAgcmV0dXJuIGN5Y2xlXG4gIH1cblxuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGlmICghcmVjdXJyZW5jZSB8fCAhY3ljbGUuZW5kc19hdCkge1xuICAgIC8vIE9uZS10aW1lOiBtYXliZSBmYWlsIG9uIGRlYWRsaW5lIGdyYWNlLlxuICAgIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lLCBub3cpXG4gICAgaWYgKGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgc3RhdGUgPT09ICdmYWlsZWQnKSB7XG4gICAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzOiAnZmFpbGVkJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgdXBkYXRlZCwgbm93KVxuICAgICAgcmV0dXJuIHVwZGF0ZWRcbiAgICB9XG4gICAgcmV0dXJuIGN5Y2xlXG4gIH1cblxuICBpZiAoY3ljbGUuc3RhdHVzICE9PSAnYWN0aXZlJykgcmV0dXJuIGN5Y2xlXG4gIGlmIChub3cgPCBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KSkgcmV0dXJuIGN5Y2xlXG5cbiAgLy8gUmVjb21wdXRlIG9uZSBsYXN0IHRpbWUgYmVmb3JlIGNsb3NpbmcuXG4gIGxldCBjbG9zZWQgPSBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpXG4gIGNvbnN0IG1ldCA9IE51bWJlcihjbG9zZWQuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGNsb3NlZCwgZGVhZGxpbmUsIG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpKVxuXG4gIGxldCBjbG9zZVN0YXR1czogR29hbEN5Y2xlWydzdGF0dXMnXSA9IG1ldFxuICAgID8gJ3N1Y2NlZWRlZCdcbiAgICA6IHN0YXRlID09PSAnZmFpbGVkJyB8fCBzdGF0ZSA9PT0gJ292ZXJkdWUnXG4gICAgPyAnZmFpbGVkJ1xuICAgIDogJ21pc3NlZCdcblxuICAvLyBCYWNrLWZpbGwgbWlzc2VkIGludGVybWVkaWF0ZSBjeWNsZXMgaWYgd2Ugc2tpcHBlZCBtdWx0aXBsZSB3aW5kb3dzLlxuICBsZXQgY3Vyc29yU3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpXG4gIGxldCBjdXJzb3JFbmQgPSBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KVxuICBsZXQgY3ljbGVJbmRleCA9IGN5Y2xlLmN5Y2xlX2luZGV4XG4gIGxldCBjYXJyeSA9IDBcblxuICBpZiAoXG4gICAgcmVjdXJyZW5jZS5jYXJyeV9vdmVyID09PSAnb3ZlcmZsb3cnICYmXG4gICAgTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSA+IE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICApIHtcbiAgICBjYXJyeSA9IE51bWJlcihjbG9zZWQuY3VycmVudF92YWx1ZSkgLSBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgfVxuXG4gIGNsb3NlZCA9IGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBzdGF0dXM6IGNsb3NlU3RhdHVzLFxuICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjbG9zZWQuaWQpXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgY2xvc2VkLCBjdXJzb3JFbmQpXG5cbiAgLy8gR3JhbnQgcmV3YXJkcyB3aGVuIGEgcmVjdXJyaW5nIGN5Y2xlIGNsb3NlcyBhcyBzdWNjZWVkZWQgKGVkZ2UtdHJpZ2dlcikuXG4gIC8vIE9uZS10aW1lIHN1Y2Nlc3MgaXMgYWxyZWFkeSBncmFudGVkIGluc2lkZSByZWNvbXB1dGVDeWNsZS5cbiAgaWYgKGNsb3NlU3RhdHVzID09PSAnc3VjY2VlZGVkJyAmJiBjeWNsZS5zdGF0dXMgIT09ICdzdWNjZWVkZWQnKSB7XG4gICAgY29uc3QgeyBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzIH0gPSBhd2FpdCBpbXBvcnQoXG4gICAgICAnLi4vcmV3YXJkcy9ob29rcy50cydcbiAgICApXG4gICAgYXdhaXQgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhkYiwge1xuICAgICAgdXNlcklkOiBnb2FsLnVzZXJfaWQsXG4gICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICBjeWNsZUlkOiBjbG9zZWQuaWQsXG4gICAgfSlcbiAgfVxuXG4gIC8vIEZpbGwgZ2FwcyB1bnRpbCB3ZSByZWFjaCBhIGN5Y2xlIHRoYXQgY29udGFpbnMgYG5vd2AuXG4gIHdoaWxlIChjdXJzb3JFbmQgPD0gbm93KSB7XG4gICAgY29uc3QgbmV4dFN0YXJ0ID0gY3Vyc29yRW5kXG4gICAgY29uc3QgbmV4dEVuZCA9IGNvbXB1dGVDeWNsZUVuZChuZXh0U3RhcnQsIHJlY3VycmVuY2UpXG4gICAgaWYgKCFuZXh0RW5kKSBicmVha1xuXG4gICAgY3ljbGVJbmRleCArPSAxXG5cbiAgICAvLyBJZiB0aGlzIGludGVybWVkaWF0ZSB3aW5kb3cgaXMgYWxyZWFkeSBmdWxseSBpbiB0aGUgcGFzdCwgbWFyayBtaXNzZWQuXG4gICAgaWYgKG5leHRFbmQgPD0gbm93KSB7XG4gICAgICBjb25zdCBtaXNzZWREZWFkbGluZSA9IGNvbXB1dGVEZWFkbGluZUF0KG5leHRTdGFydCwgZGVhZGxpbmUpXG4gICAgICBjb25zdCBtaXNzZWQgPSBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICAgIGN5Y2xlX2luZGV4OiBjeWNsZUluZGV4LFxuICAgICAgICAgIHN0YXJ0c19hdDogbmV4dFN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGRlYWRsaW5lX2F0OiBtaXNzZWREZWFkbGluZSA/IG1pc3NlZERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgICAgIHN0YXR1czogJ21pc3NlZCcsXG4gICAgICAgICAgY2Fycnlfb3ZlcjogMCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSBhcyBOZXdHb2FsQ3ljbGUpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgbWlzc2VkLCBuZXh0RW5kKVxuICAgICAgY3Vyc29yU3RhcnQgPSBuZXh0U3RhcnRcbiAgICAgIGN1cnNvckVuZCA9IG5leHRFbmRcbiAgICAgIGNhcnJ5ID0gMFxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICAvLyBBY3RpdmUgbmV4dCBjeWNsZS5cbiAgICBjb25zdCBuZXh0RGVhZGxpbmUgPSBjb21wdXRlRGVhZGxpbmVBdChuZXh0U3RhcnQsIGRlYWRsaW5lKVxuICAgIGNvbnN0IG5leHQgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICBjeWNsZV9pbmRleDogY3ljbGVJbmRleCxcbiAgICAgICAgc3RhcnRzX2F0OiBuZXh0U3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICBkZWFkbGluZV9hdDogbmV4dERlYWRsaW5lID8gbmV4dERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgIGNhcnJ5X292ZXI6IGNhcnJ5LFxuICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgbmV4dClcbiAgfVxuXG4gIHJldHVybiBjbG9zZWRcbn1cblxuLyoqIFJvbGwgb3ZlciBhbGwgYWN0aXZlIGN5Y2xlcyBmb3IgYSB1c2VyIChsYXp5IGJhdGNoKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb2xsT3ZlclVzZXJHb2FscyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ2FjdGl2ZScsICdwYXVzZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgY29udGludWVcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgY29udGludWVcbiAgICBhd2FpdCByb2xsT3ZlcklmTmVlZGVkKGRiLCBnb2FsLCBjeWNsZSwgbm93KVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBHb2FsLCBHb2FsQ3ljbGUsIEdvYWxEZWFkbGluZUNvbmZpZyB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGRlYWRsaW5lU3RhdGUgfSBmcm9tICcuL2N5Y2xlcy50cydcblxuZXhwb3J0IHR5cGUgR29hbE51ZGdlS2luZCA9XG4gIHwgJ2RlYWRsaW5lX2FwcHJvYWNoaW5nJ1xuICB8ICdkZWFkbGluZV9vdmVyZHVlJ1xuICB8ICdiZWhpbmRfcGFjZSdcbiAgfCAnY3ljbGVfY29tcGxldGUnXG4gIHwgJ2RlcGVuZGVuY3lfdW5sb2NrZWQnXG4gIHwgJ2dvYWxfc3RhcnRpbmdfc29vbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTnVkZ2Uge1xuICBraW5kOiBHb2FsTnVkZ2VLaW5kXG4gIGdvYWxJZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnd2FybmluZycgfCAnc3VjY2Vzcydcbn1cblxuZnVuY3Rpb24gcGFyc2VEZWFkbGluZSh2YWx1ZTogdW5rbm93bik6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xufVxuXG5jb25zdCBTVEFSVElOR19TT09OX0RBWVMgPSAzXG5cbi8qKlxuICogQnVpbGQgaW4tYXBwIG51ZGdlcyBmb3IgZGFzaGJvYXJkIC8gbm90aWZpY2F0aW9ucyBzdXJmYWNlLlxuICogUHVyZSBmdW5jdGlvbiBcdTIwMTQgbm8gSS9PLlxuICogU2tpcHMgZGVhZGxpbmUvYmVoaW5kX3BhY2UgZm9yIGdvYWxzIHRoYXQgaGF2ZSBub3Qgc3RhcnRlZCB5ZXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdvYWxOdWRnZXMoXG4gIGdvYWxzOiBBcnJheTx7IGdvYWw6IEdvYWw7IGN5Y2xlOiBHb2FsQ3ljbGUgfCBudWxsIH0+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbE51ZGdlW10ge1xuICBjb25zdCBudWRnZXM6IEdvYWxOdWRnZVtdID0gW11cblxuICBmb3IgKGNvbnN0IHsgZ29hbCwgY3ljbGUgfSBvZiBnb2Fscykge1xuICAgIGlmICghY3ljbGUgfHwgZ29hbC5zdGF0dXMgIT09ICdhY3RpdmUnKSBjb250aW51ZVxuXG4gICAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgICBpZiAoc3RhcnRzQXQgPiBub3cpIHtcbiAgICAgIGNvbnN0IG1zVW50aWwgPSBzdGFydHNBdC5nZXRUaW1lKCkgLSBub3cuZ2V0VGltZSgpXG4gICAgICBjb25zdCBkYXlzVW50aWwgPSBtc1VudGlsIC8gKDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICBpZiAoZGF5c1VudGlsIDw9IFNUQVJUSU5HX1NPT05fREFZUykge1xuICAgICAgICBjb25zdCBkYXlzTGFiZWwgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwoZGF5c1VudGlsKSlcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdnb2FsX3N0YXJ0aW5nX3Nvb24nLFxuICAgICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBzdGFydHMgaW4gJHtkYXlzTGFiZWx9IGRheSR7XG4gICAgICAgICAgICBkYXlzTGFiZWwgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0uYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgY3ljbGUuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgaWYgKHRhcmdldE1ldCkge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnY3ljbGVfY29tcGxldGUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgWW91IGNvbXBsZXRlZCBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGZvciB0aGlzIGN5Y2xlLmAsXG4gICAgICAgIHNldmVyaXR5OiAnc3VjY2VzcycsXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCBkZWFkbGluZSA9IHBhcnNlRGVhZGxpbmUoZ29hbC5kZWFkbGluZSlcbiAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lLCBub3cpXG4gICAgaWYgKHN0YXRlID09PSAnYXBwcm9hY2hpbmcnKSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdkZWFkbGluZV9hcHByb2FjaGluZycsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBEZWFkbGluZSBmb3IgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBhcHByb2FjaGluZy5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHN0YXRlID09PSAnb3ZlcmR1ZScpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlYWRsaW5lX292ZXJkdWUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBwYXN0IGl0cyBkZWFkbGluZS5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBCZWhpbmQtcGFjZSBmb3IgcmVjdXJyaW5nIGN5Y2xlcyB3aXRoIGEga25vd24gZW5kLlxuICAgIGlmIChjeWNsZS5lbmRzX2F0ICYmIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICAgICAgY29uc3QgZW5kID0gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpXG4gICAgICBjb25zdCBzcGFuID0gTWF0aC5tYXgoMSwgZW5kIC0gc3RhcnQpXG4gICAgICBjb25zdCBlbGFwc2VkID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKG5vdy5nZXRUaW1lKCkgLSBzdGFydCkgLyBzcGFuKSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkID0gZWxhcHNlZCAqIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBjb25zdCBhY3R1YWwgPSBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSlcbiAgICAgIGlmIChlbGFwc2VkID49IDAuMzUgJiYgYWN0dWFsIDwgZXhwZWN0ZWQgKiAwLjcpIHtcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdiZWhpbmRfcGFjZScsXG4gICAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIGJlaGluZCBwYWNlIHRoaXMgY3ljbGUuYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIE5ld1Jld2FyZERlZmluaXRpb24sXG4gIE5ld1Jld2FyZFJ1bGUsXG4gIFJld2FyZERlZmluaXRpb24gYXMgUmV3YXJkRGVmaW5pdGlvblJvdyxcbiAgUmV3YXJkSW52ZW50b3J5IGFzIFJld2FyZEludmVudG9yeVJvdyxcbiAgUmV3YXJkUnVsZSBhcyBSZXdhcmRSdWxlUm93LFxuICBSZXdhcmRSdWxlQ29uZmlnLFxuICBSZXdhcmRUcmFuc2FjdGlvbiBhcyBSZXdhcmRUcmFuc2FjdGlvblJvdyxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXRQdWJsaWNQYXRoLFxuICBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5LFxufSBmcm9tICcuLi8uLi9hc3NldHMvcmVwb3NpdG9yeS50cydcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbiAgSW52ZW50b3J5RXJyb3IsXG4gIHJlY29tcHV0ZUludmVudG9yeUZyb21MZWRnZXIsXG59IGZyb20gJy4uLy4uL3Jld2FyZHMvaW52ZW50b3J5LnRzJ1xuaW1wb3J0IHsgcmV3YXJkR3JhbnRTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vcmV3YXJkcy9ncmFudF9zZXJ2aWNlLnRzJ1xuaW1wb3J0IHsgdmFsaWRhdGVHcm91cENvbG9yIH0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcbmltcG9ydCB0eXBlIHtcbiAgQXR0YWNoUmV3YXJkUnVsZUlucHV0LFxuICBDb25zdW1lUmV3YXJkSW5wdXQsXG4gIENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dCxcbiAgRGlzY2FyZFJld2FyZElucHV0LFxuICBNYW51YWxHcmFudFJld2FyZElucHV0LFxuICBSZXdhcmREZWZpbml0aW9uc0ZpbHRlcixcbiAgUmV3YXJkSGlzdG9yeUZpbHRlcixcbiAgUmV3YXJkSW52ZW50b3J5RmlsdGVyLFxuICBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZFJld2FyZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkUmV3YXJkRXJyb3InXG4gIH1cbn1cblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG5mdW5jdGlvbiBwYXJzZVRhZ3ModmFsdWU6IHVua25vd24pOiBzdHJpbmdbXSB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gW11cbiAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSByZXR1cm4gdmFsdWUubWFwKFN0cmluZylcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZSh2YWx1ZSlcbiAgICAgIHJldHVybiBBcnJheS5pc0FycmF5KHBhcnNlZCkgPyBwYXJzZWQubWFwKFN0cmluZykgOiBbXVxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIFtdXG4gICAgfVxuICB9XG4gIHJldHVybiBbXVxufVxuXG5mdW5jdGlvbiBwYXJzZUNvbmZpZyh2YWx1ZTogdW5rbm93bik6IFJld2FyZFJ1bGVDb25maWcge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIHt9XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBSZXdhcmRSdWxlQ29uZmlnXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge31cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIFJld2FyZFJ1bGVDb25maWdcbn1cblxuZnVuY3Rpb24gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93OiBSZXdhcmREZWZpbml0aW9uUm93KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIHRhZ3M6IHBhcnNlVGFncyhyb3cudGFncyksXG4gICAgaW1hZ2VfdXJsOiByb3cuaW1hZ2VfYXNzZXRfaWRcbiAgICAgID8gYXNzZXRQdWJsaWNQYXRoKHJvdy5pbWFnZV9hc3NldF9pZClcbiAgICAgIDogbnVsbCxcbiAgICBpbWFnZTogYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHJvdy5pbWFnZV9hc3NldF9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8uZ2V0TWV0YWRhdGEocm93LmltYWdlX2Fzc2V0X2lkLCByb3cudXNlcl9pZClcbiAgICAgIGlmICghYXNzZXQpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hc3NldCxcbiAgICAgICAgdXJsOiBhc3NldFB1YmxpY1BhdGgoYXNzZXQuaWQpLFxuICAgICAgfVxuICAgIH0sXG4gIH1cbn1cblxuZnVuY3Rpb24gd2l0aEludmVudG9yeVJlbGF0aW9ucyhyb3c6IFJld2FyZEludmVudG9yeVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBkZWZpbml0aW9uOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBkZWYgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcmV0dXJuIGRlZiA/IHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKGRlZikgOiBudWxsXG4gICAgfSxcbiAgfVxufVxuXG5mdW5jdGlvbiB3aXRoUnVsZVJlbGF0aW9ucyhyb3c6IFJld2FyZFJ1bGVSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgY29uZmlnOiBwYXJzZUNvbmZpZyhyb3cuY29uZmlnKSxcbiAgICBkZWZpbml0aW9uOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCBkZWYgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcmV0dXJuIGRlZiA/IHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKGRlZikgOiBudWxsXG4gICAgfSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBUcmFuc2FjdGlvbihyb3c6IFJld2FyZFRyYW5zYWN0aW9uUm93KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIG1ldGFkYXRhOlxuICAgICAgdHlwZW9mIHJvdy5tZXRhZGF0YSA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBKU09OLnBhcnNlKHJvdy5tZXRhZGF0YSlcbiAgICAgICAgOiByb3cubWV0YWRhdGEsXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ25hbWUgdG9vIGxvbmcnKVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgY29uc3QgUmV3YXJkUXVlcnkgPSB7XG4gIHJld2FyZERlZmluaXRpb25zOiBhc3luYyAoYXJnczoge1xuICAgIGZpbHRlcj86IFJld2FyZERlZmluaXRpb25zRmlsdGVyIHwgbnVsbFxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZmlsdGVyID0gYXJncy5maWx0ZXIgPz8ge31cbiAgICBsZXQgcSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuXG4gICAgaWYgKCFmaWx0ZXIuaW5jbHVkZUFyY2hpdmVkKSB7XG4gICAgICBxID0gcS53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgIH1cbiAgICBpZiAoZmlsdGVyLnNlYXJjaD8udHJpbSgpKSB7XG4gICAgICBjb25zdCB0ZXJtID0gYCUke2ZpbHRlci5zZWFyY2gudHJpbSgpLnRvTG93ZXJDYXNlKCl9JWBcbiAgICAgIHEgPSBxLndoZXJlKChlYikgPT5cbiAgICAgICAgZWIub3IoW1xuICAgICAgICAgIGViKCduYW1lJywgJ2lsaWtlJywgdGVybSksXG4gICAgICAgICAgZWIoJ2Rlc2NyaXB0aW9uJywgJ2lsaWtlJywgdGVybSksXG4gICAgICAgICAgZWIoJ2NhdGVnb3J5JywgJ2lsaWtlJywgdGVybSksXG4gICAgICAgIF0pLFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoZmlsdGVyLmNhdGVnb3J5Py50cmltKCkpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdjYXRlZ29yeScsICc9JywgZmlsdGVyLmNhdGVnb3J5LnRyaW0oKSlcbiAgICB9XG5cbiAgICBjb25zdCBsaW1pdCA9IE1hdGgubWluKE1hdGgubWF4KGZpbHRlci5saW1pdCA/PyAxMDAsIDEpLCAyMDApXG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoZmlsdGVyLm9mZnNldCA/PyAwLCAwKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHFcbiAgICAgIC5vcmRlckJ5KCdzb3J0X29yZGVyJywgJ2FzYycpXG4gICAgICAub3JkZXJCeSgnbmFtZScsICdhc2MnKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoRGVmaW5pdGlvblJlbGF0aW9ucylcbiAgfSxcblxuICByZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KSA6IG51bGxcbiAgfSxcblxuICByZXdhcmRJbnZlbnRvcnk6IGFzeW5jIChhcmdzOiB7XG4gICAgZmlsdGVyPzogUmV3YXJkSW52ZW50b3J5RmlsdGVyIHwgbnVsbFxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZmlsdGVyID0gYXJncy5maWx0ZXIgPz8ge31cbiAgICBsZXQgcSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAuaW5uZXJKb2luKFxuICAgICAgICAncmV3YXJkX2RlZmluaXRpb25zJyxcbiAgICAgICAgJ3Jld2FyZF9kZWZpbml0aW9ucy5pZCcsXG4gICAgICAgICdyZXdhcmRfaW52ZW50b3J5LnJld2FyZF9kZWZpbml0aW9uX2lkJyxcbiAgICAgIClcbiAgICAgIC53aGVyZSgncmV3YXJkX2ludmVudG9yeS51c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoZmlsdGVyLnNlYXJjaD8udHJpbSgpKSB7XG4gICAgICBjb25zdCB0ZXJtID0gYCUke2ZpbHRlci5zZWFyY2gudHJpbSgpLnRvTG93ZXJDYXNlKCl9JWBcbiAgICAgIHEgPSBxLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsICdpbGlrZScsIHRlcm0pXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuc3RhY2thYmxlT25seSkge1xuICAgICAgcSA9IHEud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9ucy5zdGFja2FibGUnLCAnPScsIHRydWUpXG4gICAgfVxuXG4gICAgY29uc3Qgc29ydCA9IGZpbHRlci5zb3J0ID8/ICdyZWNlbnQnXG4gICAgaWYgKHNvcnQgPT09ICduYW1lJykge1xuICAgICAgcSA9IHEub3JkZXJCeSgncmV3YXJkX2RlZmluaXRpb25zLm5hbWUnLCAnYXNjJylcbiAgICB9IGVsc2UgaWYgKHNvcnQgPT09ICdxdWFudGl0eScpIHtcbiAgICAgIHEgPSBxLm9yZGVyQnkoJ3Jld2FyZF9pbnZlbnRvcnkucXVhbnRpdHknLCAnZGVzYycpXG4gICAgfSBlbHNlIHtcbiAgICAgIHEgPSBxLm9yZGVyQnkoJ3Jld2FyZF9pbnZlbnRvcnkubGFzdF9lYXJuZWRfYXQnLCAnZGVzYycpXG4gICAgfVxuXG4gICAgY29uc3QgbGltaXQgPSBNYXRoLm1pbihNYXRoLm1heChmaWx0ZXIubGltaXQgPz8gMTAwLCAxKSwgMjAwKVxuICAgIGNvbnN0IG9mZnNldCA9IE1hdGgubWF4KGZpbHRlci5vZmZzZXQgPz8gMCwgMClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxXG4gICAgICAuc2VsZWN0QWxsKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC5saW1pdChsaW1pdClcbiAgICAgIC5vZmZzZXQob2Zmc2V0KVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhJbnZlbnRvcnlSZWxhdGlvbnMpXG4gIH0sXG5cbiAgcmV3YXJkSGlzdG9yeTogYXN5bmMgKGFyZ3M6IHsgZmlsdGVyPzogUmV3YXJkSGlzdG9yeUZpbHRlciB8IG51bGwgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZpbHRlciA9IGFyZ3MuZmlsdGVyID8/IHt9XG4gICAgbGV0IHEgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoZmlsdGVyLmRlZmluaXRpb25JZCAhPSBudWxsKSB7XG4gICAgICBxID0gcS53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGZpbHRlci5kZWZpbml0aW9uSWQpXG4gICAgfVxuICAgIGlmIChmaWx0ZXIudHlwZT8udHJpbSgpKSB7XG4gICAgICBxID0gcS53aGVyZSgndHlwZScsICc9JywgZmlsdGVyLnR5cGUudHJpbSgpIGFzIG5ldmVyKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDUwLCAxKSwgMjAwKVxuICAgIGNvbnN0IG9mZnNldCA9IE1hdGgubWF4KGZpbHRlci5vZmZzZXQgPz8gMCwgMClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxXG4gICAgICAub3JkZXJCeSgnY3JlYXRlZF9hdCcsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5saW1pdChsaW1pdClcbiAgICAgIC5vZmZzZXQob2Zmc2V0KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcm93cy5tYXAobWFwVHJhbnNhY3Rpb24pXG4gIH0sXG5cbiAgcmV3YXJkUnVsZXM6IGFzeW5jIChhcmdzOiB7XG4gICAgc291cmNlVHlwZTogc3RyaW5nXG4gICAgc291cmNlSWQ6IG51bWJlclxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3J1bGVzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzb3VyY2VfdHlwZScsICc9JywgYXJncy5zb3VyY2VUeXBlKVxuICAgICAgLndoZXJlKCdzb3VyY2VfaWQnLCAnPScsIGFyZ3Muc291cmNlSWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aFJ1bGVSZWxhdGlvbnMpXG4gIH0sXG5cbiAgcmVjZW50QXNzZXRzOiBhc3luYyAoYXJnczogeyBsaW1pdD86IG51bWJlciB8IG51bGwgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCByZXBvLmxpc3RSZWNlbnQoXG4gICAgICB1c2VySWQsXG4gICAgICBNYXRoLm1pbihNYXRoLm1heChhcmdzLmxpbWl0ID8/IDIwLCAxKSwgNTApLFxuICAgIClcbiAgICByZXR1cm4gcm93cy5tYXAoKGEpID0+ICh7IC4uLmEsIHVybDogYXNzZXRQdWJsaWNQYXRoKGEuaWQpIH0pKVxuICB9LFxuXG4gIHJld2FyZE51ZGdlczogYXN5bmMgKF9hcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgeyBidWlsZFJld2FyZE51ZGdlcyB9ID0gYXdhaXQgaW1wb3J0KCcuLi8uLi9yZXdhcmRzL251ZGdlcy50cycpXG4gICAgY29uc3QgaW52ZW50b3J5ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC5pbm5lckpvaW4oXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMnLFxuICAgICAgICAncmV3YXJkX2RlZmluaXRpb25zLmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucmV3YXJkX2RlZmluaXRpb25faWQnLFxuICAgICAgKVxuICAgICAgLndoZXJlKCdyZXdhcmRfaW52ZW50b3J5LnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3QoW1xuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5pZCcsXG4gICAgICAgICdyZXdhcmRfaW52ZW50b3J5LnF1YW50aXR5JyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucmV3YXJkX2RlZmluaXRpb25faWQnLFxuICAgICAgICAncmV3YXJkX2RlZmluaXRpb25zLm5hbWUnLFxuICAgICAgXSlcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IHJlY2VudEVhcm5zID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCd0eXBlJywgJz0nLCAnZWFybicpXG4gICAgICAub3JkZXJCeSgnY3JlYXRlZF9hdCcsICdkZXNjJylcbiAgICAgIC5saW1pdCgxMClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIGJ1aWxkUmV3YXJkTnVkZ2VzKHtcbiAgICAgIGludmVudG9yeTogaW52ZW50b3J5Lm1hcCgocikgPT4gKHtcbiAgICAgICAgaWQ6IHIuaWQsXG4gICAgICAgIHF1YW50aXR5OiByLnF1YW50aXR5LFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogci5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICAgICAgbmFtZTogci5uYW1lLFxuICAgICAgfSkpLFxuICAgICAgcmVjZW50RWFybnMsXG4gICAgfSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IFJld2FyZE11dGF0aW9uID0ge1xuICBjcmVhdGVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczoge1xuICAgIGlucHV0OiBDcmVhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3NcbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVOYW1lKGlucHV0Lm5hbWUpXG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBpZiAoaW5wdXQuaW1hZ2VBc3NldElkICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCByZXBvLmdldE1ldGFkYXRhKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgaWYgKCFhc3NldCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignaW1hZ2UgYXNzZXQgbm90IGZvdW5kJylcbiAgICAgIGF3YWl0IHJlcG8ucmV0YWluKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IG51bGwsXG4gICAgICAgIG5vdGVzOiBpbnB1dC5ub3Rlcz8udHJpbSgpIHx8IG51bGwsXG4gICAgICAgIGNhdGVnb3J5OiBpbnB1dC5jYXRlZ29yeT8udHJpbSgpIHx8IG51bGwsXG4gICAgICAgIHRhZ3M6IEpTT04uc3RyaW5naWZ5KGlucHV0LnRhZ3MgPz8gW10pLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgaWNvbjogaW5wdXQuaWNvbj8udHJpbSgpIHx8IG51bGwsXG4gICAgICAgIGltYWdlX2Fzc2V0X2lkOiBpbnB1dC5pbWFnZUFzc2V0SWQgPz8gbnVsbCxcbiAgICAgICAgc3RhY2thYmxlOiBpbnB1dC5zdGFja2FibGUgPz8gdHJ1ZSxcbiAgICAgICAgZGVmYXVsdF9xdWFudGl0eTogTWF0aC5tYXgoMSwgaW5wdXQuZGVmYXVsdFF1YW50aXR5ID8/IDEpLFxuICAgICAgICBzb3J0X29yZGVyOiBpbnB1dC5zb3J0T3JkZXIgPz8gMCxcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG51bGwsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmREZWZpbml0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICB1cGRhdGVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczoge1xuICAgIGlkOiBudW1iZXJcbiAgICBpbnB1dDogVXBkYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0XG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZXhpc3RpbmcpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2RlZmluaXRpb24gbm90IGZvdW5kJylcblxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IHBhdGNoOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiA9IHtcbiAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICB9XG5cbiAgICBpZiAoaW5wdXQubmFtZSAhPSBudWxsKSBwYXRjaC5uYW1lID0gdmFsaWRhdGVOYW1lKGlucHV0Lm5hbWUpXG4gICAgaWYgKGlucHV0LmRlc2NyaXB0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLmRlc2NyaXB0aW9uID0gaW5wdXQuZGVzY3JpcHRpb24/LnRyaW0oKSB8fCBudWxsXG4gICAgfVxuICAgIGlmIChpbnB1dC5ub3RlcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC5ub3RlcyA9IGlucHV0Lm5vdGVzPy50cmltKCkgfHwgbnVsbFxuICAgIH1cbiAgICBpZiAoaW5wdXQuY2F0ZWdvcnkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2guY2F0ZWdvcnkgPSBpbnB1dC5jYXRlZ29yeT8udHJpbSgpIHx8IG51bGxcbiAgICB9XG4gICAgaWYgKGlucHV0LnRhZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2gudGFncyA9IEpTT04uc3RyaW5naWZ5KGlucHV0LnRhZ3MgPz8gW10pXG4gICAgfVxuICAgIGlmIChpbnB1dC5jb2xvciAhPSBudWxsKSBwYXRjaC5jb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICBpZiAoaW5wdXQuaWNvbiAhPT0gdW5kZWZpbmVkKSBwYXRjaC5pY29uID0gaW5wdXQuaWNvbj8udHJpbSgpIHx8IG51bGxcbiAgICBpZiAoaW5wdXQuc3RhY2thYmxlICE9IG51bGwpIHBhdGNoLnN0YWNrYWJsZSA9IGlucHV0LnN0YWNrYWJsZVxuICAgIGlmIChpbnB1dC5kZWZhdWx0UXVhbnRpdHkgIT0gbnVsbCkge1xuICAgICAgcGF0Y2guZGVmYXVsdF9xdWFudGl0eSA9IE1hdGgubWF4KDEsIGlucHV0LmRlZmF1bHRRdWFudGl0eSlcbiAgICB9XG4gICAgaWYgKGlucHV0LnNvcnRPcmRlciAhPSBudWxsKSBwYXRjaC5zb3J0X29yZGVyID0gaW5wdXQuc29ydE9yZGVyXG5cbiAgICBpZiAoaW5wdXQuaW1hZ2VBc3NldElkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgICAgaWYgKGlucHV0LmltYWdlQXNzZXRJZCAhPSBudWxsKSB7XG4gICAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgcmVwby5nZXRNZXRhZGF0YShpbnB1dC5pbWFnZUFzc2V0SWQsIHVzZXJJZClcbiAgICAgICAgaWYgKCFhc3NldCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignaW1hZ2UgYXNzZXQgbm90IGZvdW5kJylcbiAgICAgICAgaWYgKGV4aXN0aW5nLmltYWdlX2Fzc2V0X2lkICE9PSBpbnB1dC5pbWFnZUFzc2V0SWQpIHtcbiAgICAgICAgICBhd2FpdCByZXBvLnJldGFpbihpbnB1dC5pbWFnZUFzc2V0SWQsIHVzZXJJZClcbiAgICAgICAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgICAgICAgYXdhaXQgcmVwby5yZWxlYXNlKGV4aXN0aW5nLmltYWdlX2Fzc2V0X2lkLCB1c2VySWQpXG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGV4aXN0aW5nLmltYWdlX2Fzc2V0X2lkICE9IG51bGwpIHtcbiAgICAgICAgYXdhaXQgcmVwby5yZWxlYXNlKGV4aXN0aW5nLmltYWdlX2Fzc2V0X2lkLCB1c2VySWQpXG4gICAgICB9XG4gICAgICBwYXRjaC5pbWFnZV9hc3NldF9pZCA9IGlucHV0LmltYWdlQXNzZXRJZFxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAuc2V0KHBhdGNoKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICBhcmNoaXZlUmV3YXJkRGVmaW5pdGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhcmNoaXZlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFyb3cpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2RlZmluaXRpb24gbm90IGZvdW5kJylcbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIHVuYXJjaGl2ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG51bGwsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuICAgIHJldHVybiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgZGVsZXRlUmV3YXJkRGVmaW5pdGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgaW52ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgYXJncy5pZClcbiAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoaW52KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKFxuICAgICAgICAnY2Fubm90IGRlbGV0ZSBkZWZpbml0aW9uIHdpdGggaW52ZW50b3J5OyBhcmNoaXZlIGluc3RlYWQnLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICB9XG4gICAgcmV0dXJuIHRydWVcbiAgfSxcblxuICBhdHRhY2hSZXdhcmRSdWxlOiBhc3luYyAoYXJnczogeyBpbnB1dDogQXR0YWNoUmV3YXJkUnVsZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzXG4gICAgY29uc3Qgc291cmNlVHlwZSA9IGlucHV0LnNvdXJjZVR5cGUudHJpbSgpXG4gICAgaWYgKCFzb3VyY2VUeXBlKSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdzb3VyY2VUeXBlIGlzIHJlcXVpcmVkJylcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShpbnB1dC5zb3VyY2VJZCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ3NvdXJjZUlkIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQucmV3YXJkRGVmaW5pdGlvbklkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2RlZmluaXRpb24gbm90IGZvdW5kJylcblxuICAgIGlmIChzb3VyY2VUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBjb25zdCBhY3QgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LnNvdXJjZUlkKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIWFjdCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignYWN0aXZpdHkgbm90IGZvdW5kJylcbiAgICB9IGVsc2UgaWYgKHNvdXJjZVR5cGUgPT09ICdnb2FsJykge1xuICAgICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LnNvdXJjZUlkKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIWdvYWwpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2dvYWwgbm90IGZvdW5kJylcbiAgICB9XG5cbiAgICBsZXQgY29uZmlnOiBSZXdhcmRSdWxlQ29uZmlnID0ge31cbiAgICBpZiAoaW5wdXQuY29uZmlnSnNvbj8udHJpbSgpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25maWcgPSBKU09OLnBhcnNlKGlucHV0LmNvbmZpZ0pzb24pIGFzIFJld2FyZFJ1bGVDb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdjb25maWdKc29uIG11c3QgYmUgdmFsaWQgSlNPTicpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGlucHV0Lm1vZGUgPz8gJ2ZpeGVkJ1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3J1bGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIHNvdXJjZV90eXBlOiBzb3VyY2VUeXBlLFxuICAgICAgICBzb3VyY2VfaWQ6IGlucHV0LnNvdXJjZUlkLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogaW5wdXQucmV3YXJkRGVmaW5pdGlvbklkLFxuICAgICAgICBxdWFudGl0eTogTWF0aC5tYXgoMSwgaW5wdXQucXVhbnRpdHkgPz8gMSksXG4gICAgICAgIG1vZGUsXG4gICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoY29uZmlnKSxcbiAgICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkUnVsZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB3aXRoUnVsZVJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgZGV0YWNoUmV3YXJkUnVsZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMFxuICB9LFxuXG4gIGNvbnN1bWVSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb25zdW1lUmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IG1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKClcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBpbnZlbnRvcnksIHRyYW5zYWN0aW9uIH0gPSBhd2FpdCBkYlxuICAgICAgICAudHJhbnNhY3Rpb24oKVxuICAgICAgICAuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IG1hbmFnZXIuYXBwbHlDb25zdW1lKFxuICAgICAgICAgICAgdHJ4LFxuICAgICAgICAgICAgdXNlcklkLFxuICAgICAgICAgICAgYXJncy5pbnB1dC5pbnZlbnRvcnlJZCxcbiAgICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgICAgYXJncy5pbnB1dC5ub3RlLFxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogaW52ZW50b3J5ID8gd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpIDogbnVsbCxcbiAgICAgICAgdHJhbnNhY3Rpb246IG1hcFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKSxcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBJbnZlbnRvcnlFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIGRpc2NhcmRSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBEaXNjYXJkUmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IG1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKClcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBpbnZlbnRvcnksIHRyYW5zYWN0aW9uIH0gPSBhd2FpdCBkYlxuICAgICAgICAudHJhbnNhY3Rpb24oKVxuICAgICAgICAuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IG1hbmFnZXIuYXBwbHlEaXNjYXJkKFxuICAgICAgICAgICAgdHJ4LFxuICAgICAgICAgICAgdXNlcklkLFxuICAgICAgICAgICAgYXJncy5pbnB1dC5pbnZlbnRvcnlJZCxcbiAgICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogaW52ZW50b3J5ID8gd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpIDogbnVsbCxcbiAgICAgICAgdHJhbnNhY3Rpb246IG1hcFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKSxcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBJbnZlbnRvcnlFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIHJlc3RvcmVSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IHRyYW5zYWN0aW9uSWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseVJlc3RvcmUodHJ4LCB1c2VySWQsIGFyZ3MudHJhbnNhY3Rpb25JZClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgbWFudWFsR3JhbnRSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBNYW51YWxHcmFudFJld2FyZElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBxdWFudGl0eSA9IE1hdGgubWF4KDEsIGFyZ3MuaW5wdXQucXVhbnRpdHkgPz8gMSlcbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pbnB1dC5yZXdhcmREZWZpbml0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgcmV3YXJkR3JhbnRTZXJ2aWNlLmdyYW50KHRyeCwgdXNlcklkLCBbXG4gICAgICAgIHtcbiAgICAgICAgICBydWxlSWQ6IG51bGwsXG4gICAgICAgICAgZGVmaW5pdGlvbklkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgIHRyaWdnZXJLZXk6IGBtYW51YWw6JHtEYXRlLm5vdygpfToke2NyeXB0by5yYW5kb21VVUlEKCl9YCxcbiAgICAgICAgICBzb3VyY2VUeXBlOiAnbWFudWFsJyxcbiAgICAgICAgICBzb3VyY2VJZDogMCxcbiAgICAgICAgfSxcbiAgICAgIF0pXG4gICAgfSlcblxuICAgIGNvbnN0IHR4ID0gcmVzdWx0c1swXT8udHJhbnNhY3Rpb25cbiAgICByZXR1cm4gdHggPyBtYXBUcmFuc2FjdGlvbih0eCkgOiBudWxsXG4gIH0sXG5cbiAgcmVjb21wdXRlUmV3YXJkSW52ZW50b3J5OiBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVjb21wdXRlSW52ZW50b3J5RnJvbUxlZGdlcihkYiwgdXNlcklkKVxuICAgIHJldHVybiB0cnVlXG4gIH0sXG59XG4iLCAiLyoqIFNIQS0yNTYgaGV4IGRpZ2VzdCBvZiByYXcgYnl0ZXMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoJ1NIQS0yNTYnLCBieXRlcylcbiAgcmV0dXJuIEFycmF5LmZyb20obmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSlcbiAgICAubWFwKChiKSA9PiBiLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpKVxuICAgIC5qb2luKCcnKVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlSGFzaGluZ1NlcnZpY2Uge1xuICBzaGEyNTYoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz5cbn1cblxuZXhwb3J0IGNvbnN0IGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlOiBJbWFnZUhhc2hpbmdTZXJ2aWNlID0ge1xuICBzaGEyNTY6IHNoYTI1NkhleCxcbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCB1bmxpbmssIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgdHlwZSB7IEFzc2V0U3RvcmFnZSB9IGZyb20gJy4vdHlwZXMudHMnXG5cbmZ1bmN0aW9uIGN3ZCgpOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBwcm9jZXNzLmN3ZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBwcm9jZXNzLmN3ZCgpXG4gIH1cbiAgcmV0dXJuICcuJ1xufVxuXG5mdW5jdGlvbiBhc3NldHNSb290KCk6IHN0cmluZyB7XG4gIGNvbnN0IGVudiA9XG4gICAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVNTRVRTX0RJUikgfHwgbnVsbFxuICBpZiAoZW52KSByZXR1cm4gZW52XG4gIHJldHVybiBqb2luKGN3ZCgpLCAnZGF0YScsICdhc3NldHMnKVxufVxuXG5leHBvcnQgY2xhc3MgTG9jYWxGc0Fzc2V0U3RvcmFnZSBpbXBsZW1lbnRzIEFzc2V0U3RvcmFnZSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcm9vdDogc3RyaW5nID0gYXNzZXRzUm9vdCgpKSB7fVxuXG4gIHByaXZhdGUgZnVsbFBhdGgoa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmUgPSBrZXkucmVwbGFjZSgvXFwuXFwuL2csICcnKS5yZXBsYWNlKC9eXFwvKy8sICcnKVxuICAgIHJldHVybiBqb2luKHRoaXMucm9vdCwgc2FmZSlcbiAgfVxuXG4gIGFzeW5jIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIF9jb250ZW50VHlwZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYXRoID0gdGhpcy5mdWxsUGF0aChrZXkpXG4gICAgY29uc3QgZGlyID0gam9pbihwYXRoLCAnLi4nKVxuICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgICBhd2FpdCB3cml0ZUZpbGUocGF0aCwgYnl0ZXMpXG4gIH1cblxuICBhc3luYyByZWFkKGtleTogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVhZEZpbGUodGhpcy5mdWxsUGF0aChrZXkpKVxuICAgICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGRhdGEpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB1bmxpbmsodGhpcy5mdWxsUGF0aChrZXkpKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQWxyZWFkeSBnb25lLlxuICAgIH1cbiAgfVxuXG4gIHB1YmxpY1VybChfa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBBc3NldFN0b3JhZ2UgfSBmcm9tICcuL3R5cGVzLnRzJ1xuaW1wb3J0IHsgTG9jYWxGc0Fzc2V0U3RvcmFnZSB9IGZyb20gJy4vbG9jYWxfZnMudHMnXG5cbi8qKlxuICogUzMtY29tcGF0aWJsZSBhc3NldCBzdG9yYWdlIChQaGFzZSAzKS5cbiAqXG4gKiBFbnY6IEFTU0VUU19TM19CVUNLRVQsIEFTU0VUU19TM19SRUdJT04sIEFTU0VUU19TM19FTkRQT0lOVCxcbiAqIEFXU19BQ0NFU1NfS0VZX0lEIC8gQVdTX1NFQ1JFVF9BQ0NFU1NfS0VZLlxuICovXG5leHBvcnQgY2xhc3MgUzNBc3NldFN0b3JhZ2UgaW1wbGVtZW50cyBBc3NldFN0b3JhZ2Uge1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1Y2tldDogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSBlbmRwb2ludDogc3RyaW5nIHwgbnVsbFxuXG4gIGNvbnN0cnVjdG9yKG9wdHM/OiB7XG4gICAgYnVja2V0Pzogc3RyaW5nXG4gICAgcmVnaW9uPzogc3RyaW5nXG4gICAgZW5kcG9pbnQ/OiBzdHJpbmcgfCBudWxsXG4gIH0pIHtcbiAgICB0aGlzLmJ1Y2tldCA9XG4gICAgICBvcHRzPy5idWNrZXQgPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfQlVDS0VUKSB8fFxuICAgICAgICAnJylcbiAgICB0aGlzLnJlZ2lvbiA9XG4gICAgICBvcHRzPy5yZWdpb24gPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfUkVHSU9OKSB8fFxuICAgICAgICAndXMtZWFzdC0xJylcbiAgICB0aGlzLmVuZHBvaW50ID1cbiAgICAgIG9wdHM/LmVuZHBvaW50ID8/XG4gICAgICAoKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVNTRVRTX1MzX0VORFBPSU5UKSB8fFxuICAgICAgICBudWxsKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3NlcnRDb25maWd1cmVkKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5idWNrZXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ1MzQXNzZXRTdG9yYWdlIGlzIG5vdCBjb25maWd1cmVkIChzZXQgQVNTRVRTX1MzX0JVQ0tFVCknLFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYXNzZXJ0Q29uZmlndXJlZCgpXG4gICAgY29uc3QgdXJsID0gdGhpcy5vYmplY3RVcmwoa2V5KVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6IGNvbnRlbnRUeXBlLFxuICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBTdHJpbmcoYnl0ZXMuYnl0ZUxlbmd0aCksXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMsXG4gICAgfSlcbiAgICBpZiAoIXJlcy5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTMyBwdXQgZmFpbGVkOiAke3Jlcy5zdGF0dXN9ICR7YXdhaXQgcmVzLnRleHQoKX1gKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0aGlzLm9iamVjdFVybChrZXkpKVxuICAgIGlmIChyZXMuc3RhdHVzID09PSA0MDQpIHJldHVybiBudWxsXG4gICAgaWYgKCFyZXMub2spIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUzMgZ2V0IGZhaWxlZDogJHtyZXMuc3RhdHVzfWApXG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXMuYXJyYXlCdWZmZXIoKSlcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYXNzZXJ0Q29uZmlndXJlZCgpXG4gICAgYXdhaXQgZmV0Y2godGhpcy5vYmplY3RVcmwoa2V5KSwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG4gIH1cblxuICBwdWJsaWNVcmwoa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuYnVja2V0KSByZXR1cm4gbnVsbFxuICAgIHJldHVybiB0aGlzLm9iamVjdFVybChrZXkpXG4gIH1cblxuICBwcml2YXRlIG9iamVjdFVybChrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZSA9IGtleS5yZXBsYWNlKC9eXFwvKy8sICcnKVxuICAgIGlmICh0aGlzLmVuZHBvaW50KSB7XG4gICAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludC5yZXBsYWNlKC9cXC8kLywgJycpfS8ke3RoaXMuYnVja2V0fS8ke3NhZmV9YFxuICAgIH1cbiAgICByZXR1cm4gYGh0dHBzOi8vJHt0aGlzLmJ1Y2tldH0uczMuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3NhZmV9YFxuICB9XG59XG5cbi8qKiBQaWNrIHN0b3JhZ2UgYmFja2VuZCBmcm9tIGVudjogQVNTRVRTX1NUT1JBR0U9czMgfCBsb2NhbCAoZGVmYXVsdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudigpOiBBc3NldFN0b3JhZ2Uge1xuICBjb25zdCBtb2RlID1cbiAgICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfU1RPUkFHRSkgfHxcbiAgICAnbG9jYWwnXG4gIGlmIChtb2RlID09PSAnczMnKSB7XG4gICAgcmV0dXJuIG5ldyBTM0Fzc2V0U3RvcmFnZSgpXG4gIH1cbiAgcmV0dXJuIG5ldyBMb2NhbEZzQXNzZXRTdG9yYWdlKClcbn1cbiIsICIvKiogUHVyZSBibG9iIGJhY2tlbmQgXHUyMDE0IG5vIERCLiAqL1xuZXhwb3J0IGludGVyZmFjZSBBc3NldFN0b3JhZ2Uge1xuICB3cml0ZShcbiAgICBrZXk6IHN0cmluZyxcbiAgICBieXRlczogVWludDhBcnJheSxcbiAgICBjb250ZW50VHlwZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPlxuICBkZWxldGUoa2V5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG4gIC8qKiBPcHRpb25hbCBwdWJsaWMvc2lnbmVkIFVSTCBmb3IgdGhlIGtleS4gKi9cbiAgcHVibGljVXJsPyhrZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IGNvbnN0IEFMTE9XRURfSU1BR0VfVFlQRVMgPSBuZXcgU2V0KFtcbiAgJ2ltYWdlL2pwZWcnLFxuICAnaW1hZ2UvcG5nJyxcbiAgJ2ltYWdlL3dlYnAnLFxuXSlcblxuZXhwb3J0IGNvbnN0IE1BWF9BU1NFVF9CWVRFUyA9IDIgKiAxMDI0ICogMTAyNCAvLyAyIE1CXG5cbmV4cG9ydCBmdW5jdGlvbiBleHRlbnNpb25Gb3JDb250ZW50VHlwZShjb250ZW50VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgIGNhc2UgJ2ltYWdlL2pwZWcnOlxuICAgICAgcmV0dXJuICdqcGcnXG4gICAgY2FzZSAnaW1hZ2UvcG5nJzpcbiAgICAgIHJldHVybiAncG5nJ1xuICAgIGNhc2UgJ2ltYWdlL3dlYnAnOlxuICAgICAgcmV0dXJuICd3ZWJwJ1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJ2JpbidcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgQXNzZXQsIERhdGFiYXNlLCBOZXdBc3NldCB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlLFxuICB0eXBlIEltYWdlSGFzaGluZ1NlcnZpY2UsXG59IGZyb20gJy4vaGFzaGluZy50cydcbmltcG9ydCB7IGNyZWF0ZUFzc2V0U3RvcmFnZUZyb21FbnYgfSBmcm9tICcuL3N0b3JhZ2UvczMudHMnXG5pbXBvcnQge1xuICBBTExPV0VEX0lNQUdFX1RZUEVTLFxuICBleHRlbnNpb25Gb3JDb250ZW50VHlwZSxcbiAgTUFYX0FTU0VUX0JZVEVTLFxuICB0eXBlIEFzc2V0U3RvcmFnZSxcbn0gZnJvbSAnLi9zdG9yYWdlL3R5cGVzLnRzJ1xuXG5leHBvcnQgdHlwZSBBc3NldFJlY29yZCA9IEFzc2V0XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRSZXBvc2l0b3J5IHtcbiAgcHV0KGlucHV0OiB7XG4gICAgdXNlcklkOiBudW1iZXJcbiAgICBieXRlczogVWludDhBcnJheVxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmdcbiAgICBmaWxlbmFtZT86IHN0cmluZ1xuICB9KTogUHJvbWlzZTxBc3NldFJlY29yZD5cblxuICBnZXRNZXRhZGF0YShcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8QXNzZXRSZWNvcmQgfCBudWxsPlxuXG4gIHJlYWRCeXRlcyhcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBieXRlczogVWludDhBcnJheTsgY29udGVudFR5cGU6IHN0cmluZyB9IHwgbnVsbD5cblxuICByZWxlYXNlKGFzc2V0SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+XG4gIHJldGFpbihhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPlxuICBwdXJnZUlmT3JwaGFuKGFzc2V0SWQ6IG51bWJlcik6IFByb21pc2U8Ym9vbGVhbj5cblxuICBsaXN0UmVjZW50KHVzZXJJZDogbnVtYmVyLCBsaW1pdD86IG51bWJlcik6IFByb21pc2U8QXNzZXRSZWNvcmRbXT5cbn1cblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBjbGFzcyBEYkFzc2V0UmVwb3NpdG9yeSBpbXBsZW1lbnRzIEFzc2V0UmVwb3NpdG9yeSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZGI6IERiTGlrZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JhZ2U6IEFzc2V0U3RvcmFnZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGhhc2hpbmc6IEltYWdlSGFzaGluZ1NlcnZpY2UgPSBkZWZhdWx0SW1hZ2VIYXNoaW5nU2VydmljZSxcbiAgKSB7fVxuXG4gIGFzeW5jIHB1dChpbnB1dDoge1xuICAgIHVzZXJJZDogbnVtYmVyXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXlcbiAgICBjb250ZW50VHlwZTogc3RyaW5nXG4gICAgZmlsZW5hbWU/OiBzdHJpbmdcbiAgfSk6IFByb21pc2U8QXNzZXRSZWNvcmQ+IHtcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IGlucHV0LmNvbnRlbnRUeXBlLnRvTG93ZXJDYXNlKCkuc3BsaXQoJzsnKVswXS50cmltKClcbiAgICBpZiAoIUFMTE9XRURfSU1BR0VfVFlQRVMuaGFzKGNvbnRlbnRUeXBlKSkge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKFxuICAgICAgICBgdW5zdXBwb3J0ZWQgY29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAsXG4gICAgICAgIDQxNSxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignZW1wdHkgZmlsZScsIDQwMClcbiAgICB9XG4gICAgaWYgKGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGggPiBNQVhfQVNTRVRfQllURVMpIHtcbiAgICAgIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignZmlsZSB0b28gbGFyZ2UnLCA0MTMpXG4gICAgfVxuXG4gICAgY29uc3Qgc2hhMjU2ID0gYXdhaXQgdGhpcy5oYXNoaW5nLnNoYTI1NihpbnB1dC5ieXRlcylcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBpbnB1dC51c2VySWQpXG4gICAgICAud2hlcmUoJ3NoYTI1NicsICc9Jywgc2hhMjU2KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAvLyBEZWR1cCBoaXQ6IHJldHVybiBleGlzdGluZyBtZXRhZGF0YS4gQ2FsbGVycyByZXRhaW4oKSBvbiBhdHRhY2guXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICByZXR1cm4gZXhpc3RpbmdcbiAgICB9XG5cbiAgICBjb25zdCBleHQgPSBleHRlbnNpb25Gb3JDb250ZW50VHlwZShjb250ZW50VHlwZSlcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gYCR7aW5wdXQudXNlcklkfS8ke3NoYTI1Nn0uJHtleHR9YFxuICAgIGF3YWl0IHRoaXMuc3RvcmFnZS53cml0ZShzdG9yYWdlS2V5LCBpbnB1dC5ieXRlcywgY29udGVudFR5cGUpXG5cbiAgICAvLyBOZXcgYmxvYnMgc3RhcnQgYXQgcmVmX2NvdW50IDA7IGNhbGxlcnMgcmV0YWluKCkgd2hlbiBhdHRhY2hpbmcuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdhc3NldHMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiBpbnB1dC51c2VySWQsXG4gICAgICAgICAgc2hhMjU2LFxuICAgICAgICAgIGNvbnRlbnRfdHlwZTogY29udGVudFR5cGUsXG4gICAgICAgICAgYnl0ZV9zaXplOiBpbnB1dC5ieXRlcy5ieXRlTGVuZ3RoLFxuICAgICAgICAgIHN0b3JhZ2Vfa2V5OiBzdG9yYWdlS2V5LFxuICAgICAgICAgIHJlZl9jb3VudDogMCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgb3JwaGFuZWRfYXQ6IG5vdyxcbiAgICAgICAgfSBhcyBOZXdBc3NldClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3JhZ2UuZGVsZXRlKHN0b3JhZ2VLZXkpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRNZXRhZGF0YShcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8QXNzZXRSZWNvcmQgfCBudWxsPiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgfVxuXG4gIGFzeW5jIHJlYWRCeXRlcyhcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBieXRlczogVWludDhBcnJheTsgY29udGVudFR5cGU6IHN0cmluZyB9IHwgbnVsbD4ge1xuICAgIGNvbnN0IG1ldGEgPSBhd2FpdCB0aGlzLmdldE1ldGFkYXRhKGFzc2V0SWQsIHVzZXJJZClcbiAgICBpZiAoIW1ldGEpIHJldHVybiBudWxsXG4gICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLnN0b3JhZ2UucmVhZChtZXRhLnN0b3JhZ2Vfa2V5KVxuICAgIGlmICghYnl0ZXMpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHsgYnl0ZXMsIGNvbnRlbnRUeXBlOiBtZXRhLmNvbnRlbnRfdHlwZSB9XG4gIH1cblxuICBhc3luYyByZXRhaW4oYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghcm93KSB0aHJvdyBuZXcgQXNzZXRWYWxpZGF0aW9uRXJyb3IoJ2Fzc2V0IG5vdCBmb3VuZCcsIDQwNClcbiAgICBhd2FpdCB0aGlzLmRiXG4gICAgICAudXBkYXRlVGFibGUoJ2Fzc2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgcmVmX2NvdW50OiByb3cucmVmX2NvdW50ICsgMSxcbiAgICAgICAgb3JwaGFuZWRfYXQ6IG51bGwsXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC5leGVjdXRlKClcbiAgfVxuXG4gIGFzeW5jIHJlbGVhc2UoYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghcm93KSByZXR1cm5cbiAgICBjb25zdCBuZXh0ID0gTWF0aC5tYXgoMCwgcm93LnJlZl9jb3VudCAtIDEpXG4gICAgYXdhaXQgdGhpcy5kYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdhc3NldHMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIHJlZl9jb3VudDogbmV4dCxcbiAgICAgICAgb3JwaGFuZWRfYXQ6IG5leHQgPT09IDAgPyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgaWYgKG5leHQgPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMucHVyZ2VJZk9ycGhhbihhc3NldElkKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHB1cmdlSWZPcnBoYW4oYXNzZXRJZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFyb3cgfHwgcm93LnJlZl9jb3VudCA+IDApIHJldHVybiBmYWxzZVxuICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5kZWxldGUocm93LnN0b3JhZ2Vfa2V5KVxuICAgIGF3YWl0IHRoaXMuZGIuZGVsZXRlRnJvbSgnYXNzZXRzJykud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKS5leGVjdXRlKClcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgYXN5bmMgbGlzdFJlY2VudCh1c2VySWQ6IG51bWJlciwgbGltaXQgPSAyMCk6IFByb21pc2U8QXNzZXRSZWNvcmRbXT4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRiXG4gICAgICAuc2VsZWN0RnJvbSgnYXNzZXRzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdyZWZfY291bnQnLCAnPicsIDApXG4gICAgICAub3JkZXJCeSgnY3JlYXRlZF9hdCcsICdkZXNjJylcbiAgICAgIC5saW1pdChsaW1pdClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBBc3NldFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdBc3NldFZhbGlkYXRpb25FcnJvcidcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShcbiAgZGI6IERiTGlrZSxcbik6IERiQXNzZXRSZXBvc2l0b3J5IHtcbiAgY29uc3Qgc3RvcmFnZSA9IGNyZWF0ZUFzc2V0U3RvcmFnZUZyb21FbnYoKVxuICByZXR1cm4gbmV3IERiQXNzZXRSZXBvc2l0b3J5KGRiLCBzdG9yYWdlKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNzZXRQdWJsaWNQYXRoKGFzc2V0SWQ6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiBgL2Fzc2V0cy8ke2Fzc2V0SWR9YFxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbi8vIFB5bG9uIHNlcnZlcyB0aGUgYnVpbHQgYXBwIHdpdGggQnVuL05vZGUgXHUyMDE0IHVzZSBwcm9jZXNzLmVudiwgbm90IERlbm8uZW52LlxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsXG4gICAgJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gIClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7O0FBaURBLFNBQVMsZUFBZSxZQUE4QjtBQUNwRCxTQUFPO0FBQUEsSUFDTCxpQkFBaUIsV0FBVztBQUFBLElBQzVCLGtCQUFrQixXQUFXO0FBQUEsSUFDN0IsaUJBQWlCLFdBQVc7QUFBQSxJQUM1QixnQkFBZ0IsV0FBVztBQUFBLEVBQzdCO0FBQ0Y7QUFFQSxTQUFTLGNBQXNCO0FBQzdCLFNBQU8sT0FBTyxXQUFXO0FBQzNCO0FBMmFBLGVBQXNCLDZCQUNwQkEsS0FDQSxRQUNlO0FBQ2YsUUFBTUEsSUFDSCxXQUFXLGtCQUFrQixFQUM3QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVE7QUFFWCxRQUFNLE1BQU0sTUFBTUEsSUFDZixXQUFXLHFCQUFxQixFQUNoQyxNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVEsY0FBYyxLQUFLLEVBQzNCLFFBQVEsTUFBTSxLQUFLLEVBQ25CLFVBQVUsRUFDVixRQUFRO0FBRVgsUUFBTSxPQUFPLE1BQU1BLElBQ2hCLFdBQVcsb0JBQW9CLEVBQy9CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLFFBQVE7QUFDWCxRQUFNLFNBQVMsSUFBSSxJQUFJLEtBQUssSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLElBQUksQ0FBQyxDQUFDLENBQUM7QUFFakQsUUFBTSxNQUFNLG9CQUFJLElBQW9CO0FBQ3BDLFFBQU0sWUFBWSxvQkFBSSxJQUFvQjtBQUMxQyxRQUFNLFdBQVcsb0JBQUksSUFBb0I7QUFFekMsYUFBVyxNQUFNLEtBQUs7QUFDcEIsUUFBSSxHQUFHLHdCQUF3QixLQUFNO0FBQ3JDLFVBQU0sUUFBUSxHQUFHO0FBQ2pCLFVBQU0sTUFBTSxJQUFJLElBQUksS0FBSyxLQUFLO0FBQzlCLFVBQU0sVUFD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QUFJLE9BQU8sZUFBZSxDQUFDO0FBQ3hFLE1BQUksQ0FBQyxVQUFVO0FBQ2IsV0FBTyxxQkFBcUI7QUFBQSxFQUM5QjtBQUVBLFFBQU0sWUFBWSxNQUFNLGlCQUFpQjtBQUFBLElBQ3ZDLFlBQVksU0FBUztBQUFBLElBQ3JCLE9BQU8sU0FBUztBQUFBLEVBQ2xCLENBQUM7QUFFRCxNQUFJLElBQUksY0FBYyxTQUFTLFVBQVU7QUFDekMsTUFBSSxTQUFTLE9BQU87QUFDbEIsUUFBSSxJQUFJLGFBQWEsU0FBUyxLQUFLO0FBQUEsRUFDckM7QUFDQSxNQUFJLElBQUksVUFBVSxVQUFVLEVBQUU7QUFFOUIsUUFBTSxLQUFLO0FBQ2IsQ0FBQztBQUVELFNBQVMsVUFBVSxTQUFpQixRQUEwQjtBQUM1RCxTQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxPQUFPLFFBQVEsQ0FBQyxHQUFHO0FBQUEsSUFDdEQ7QUFBQSxJQUNBLFNBQVM7QUFBQSxNQUNQLGdCQUFnQjtBQUFBLE1BQ2hCLCtCQUErQjtBQUFBLElBQ2pDO0FBQUEsRUFDRixDQUFDO0FBQ0g7QUFFTyxJQUFNLFVBQVU7QUFBQSxFQUNyQixHQUFHO0FBQ0w7QUFFQSxJQUFPLGNBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJkYiIsICJpbnZlbnRvcnkiLCAiY29uZmlnIiwgImRiIiwgImNvbmZpZyIsICJkYiIsICJkYiIsICJnZXRDb250ZXh0IiwgImNvbmZpZyIsICJkYiIsICJncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzIiwgImNvbmZpZyIsICJyZXN1bHQiLCAicGFyc2VKc29uIiwgImRiIiwgImRlYWRsaW5lIiwgInN0YXRlIiwgImdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MiLCAicGFyc2VKc29uIiwgImNvbmZpZyIsICJjeWNsZSIsICJyZXN1bHQiLCAiZ2V0Q29udGV4dCIsICJlbnYiLCAiZGIiLCAicmVxdWlyZVVzZXJJZCIsICJnZXRDb250ZXh0IiwgInBhcnNlQ29uZmlnIiwgImJ1aWxkUmV3YXJkTnVkZ2VzIiwgImNvbmZpZyIsICJyZXN1bHQiLCAicmVxdWlyZVVzZXJJZCIsICJnZXRDb250ZXh0IiwgInBhcnNlQ29uZmlnIiwgImNvbmZpZyIsICJyZXN1bHQiLCAiYWN0aXZpdHkiLCAiY29tcGxldGlvbiIsICJyZXN1bHQiXQp9Cg==
