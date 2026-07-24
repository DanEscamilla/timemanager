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

// ../../libs/deno_api_kit/push/noop_sender.ts
var NoOpPushSender = class {
  async sendToTokens(_tokens, _payload) {
    return { successCount: 0, invalidTokens: [] };
  }
};

// ../../libs/deno_api_kit/db/env.ts
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

// ../../libs/deno_api_kit/push/firebase_sender.ts
async function readTextFile(path) {
  if (typeof Deno !== "undefined" && typeof Deno.readTextFile === "function") {
    return await Deno.readTextFile(path);
  }
  const { readFile: readFile2 } = await import("node:fs/promises");
  return await readFile2(path, "utf8");
}
var INVALID_TOKEN_CODES = /* @__PURE__ */ new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);
var FirebasePushSender = class {
  constructor(messaging) {
    this.messaging = messaging;
  }
  async sendToTokens(tokens, payload) {
    if (tokens.length === 0) {
      return { successCount: 0, invalidTokens: [] };
    }
    const invalidTokens = [];
    let successCount = 0;
    const chunkSize = 500;
    for (let i = 0; i < tokens.length; i += chunkSize) {
      const chunk = tokens.slice(i, i + chunkSize);
      const result2 = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: payload.data
      });
      successCount += result2.successCount;
      result2.responses.forEach((response, index) => {
        if (response.success) return;
        const code = response.error?.code;
        if (code && INVALID_TOKEN_CODES.has(code)) {
          invalidTokens.push(chunk[index]);
        }
      });
    }
    return { successCount, invalidTokens };
  }
};
function parseServiceAccountJson(raw) {
  const parsed = JSON.parse(raw);
  if (typeof parsed.project_id !== "string" || typeof parsed.client_email !== "string" || typeof parsed.private_key !== "string") {
    throw new Error(
      "Firebase service account JSON must include project_id, client_email, private_key"
    );
  }
  parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
  return parsed;
}
async function loadServiceAccount() {
  const json = env("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (json && json.trim().length > 0) {
    return parseServiceAccountJson(json);
  }
  const path = env("FIREBASE_SERVICE_ACCOUNT_PATH");
  if (path && path.trim().length > 0) {
    const text = await readTextFile(path);
    return parseServiceAccountJson(text);
  }
  return null;
}
async function loadFirebaseAdmin() {
  const mod = await import("firebase-admin");
  return mod.default ?? mod;
}
async function createPushSenderFromEnv() {
  try {
    const account = await loadServiceAccount();
    if (!account) {
      console.info(
        "[push] FIREBASE_SERVICE_ACCOUNT_JSON/PATH unset; using no-op sender"
      );
      return new NoOpPushSender();
    }
    const admin = await loadFirebaseAdmin();
    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(account)
      });
    }
    return new FirebasePushSender(admin.messaging());
  } catch (err) {
    console.error("[push] failed to init Firebase sender; using no-op", err);
    return new NoOpPushSender();
  }
}

// src/graphql/resolvers/resolvers.ts
import "kysely";
import { getContext as getContext3 } from "@getcronit/pylon";

// src/db/types/schema.ts
import "kysely";

// ../../libs/deno_api_kit/db/create_kysely.ts
import { Pool, types } from "pg";
import { Kysely, PostgresDialect } from "kysely";

// ../../libs/deno_api_kit/db/ssl.ts
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
function connectionStringWithoutSslParams(databaseUrl) {
  try {
    const url = new URL(databaseUrl);
    for (const key of [
      "sslmode",
      "ssl",
      "sslrootcert",
      "sslcert",
      "sslkey"
    ]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

// ../../libs/deno_api_kit/db/create_kysely.ts
types.setTypeParser(types.builtins.DATE, (value) => value);
function poolConfigFromEnv(defaultDatabase) {
  const databaseUrl = env("DATABASE_URL");
  if (databaseUrl) {
    const ssl = sslForDatabaseUrl(databaseUrl);
    return {
      connectionString: connectionStringWithoutSslParams(databaseUrl),
      max: 10,
      ...ssl === void 0 ? {} : { ssl }
    };
  }
  return {
    database: env("PGDATABASE") ?? defaultDatabase,
    host: env("PGHOST") ?? "localhost",
    user: env("PGUSER") ?? "postgres",
    password: env("PGPASSWORD") ?? "test1234",
    port: Number(env("PGPORT") ?? "5432"),
    max: 10
  };
}
function createKysely(options) {
  const dialect = new PostgresDialect({
    pool: new Pool(poolConfigFromEnv(options.defaultDatabase))
  });
  return new Kysely({ dialect });
}

// src/db/database.ts
var db = createKysely({
  defaultDatabase: "timemanager"
});

// src/push/device_token_validation.ts
var DEVICE_PLATFORMS = /* @__PURE__ */ new Set(["ios", "android", "web"]);
function validateDevicePlatform(platform) {
  const normalized = platform.trim().toLowerCase();
  if (!DEVICE_PLATFORMS.has(normalized)) {
    throw new Error("platform must be ios, android, or web");
  }
  return normalized;
}
function validateDeviceToken(token) {
  const trimmed = token.trim();
  if (trimmed.length < 8 || trimmed.length > 4096) {
    throw new Error("invalid device token");
  }
  return trimmed;
}

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
  ...RewardMutation,
  registerDeviceToken: async (args) => {
    const userId = requireUserId3();
    const token = validateDeviceToken(args.token);
    const platform = validateDevicePlatform(args.platform);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    await db.insertInto("device_tokens").values({
      user_id: userId,
      token,
      platform,
      updated_at: now
    }).onConflict(
      (oc) => oc.column("token").doUpdateSet({
        user_id: userId,
        platform,
        updated_at: now
      })
    ).execute();
    return true;
  },
  unregisterDeviceToken: async (args) => {
    const userId = requireUserId3();
    const token = validateDeviceToken(args.token);
    const result2 = await db.deleteFrom("device_tokens").where("user_id", "=", userId).where("token", "=", token).execute();
    return result2.length > 0 && Number(result2[0]?.numDeletedRows ?? 0) > 0;
  }
};
var resolvers = {
  Query,
  Mutation
};

// ../../libs/deno_api_kit/auth/verify.ts
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

// ../../libs/deno_api_kit/pylon/middleware.ts
async function healthMiddleware(ctx, next) {
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
}
function createGraphQLAuthMiddleware(resolveLocalUser3) {
  return async function graphQLAuthMiddleware(ctx, next) {
    if (ctx.req.method === "OPTIONS") {
      await next();
      return;
    }
    const path = new URL(ctx.req.url).pathname;
    if (path === "/health" || path !== "/graphql" && !path.endsWith("/graphql")) {
      await next();
      return;
    }
    const verified = await verifyAccessToken(ctx.req.header("Authorization"));
    if (!verified) {
      return unauthorizedResponse();
    }
    const localUser = await resolveLocalUser3(verified);
    ctx.set("authUserId", verified.authUserId);
    if (verified.email) {
      ctx.set("authEmail", verified.email);
    }
    ctx.set("userId", localUser.id);
    await next();
  };
}

// ../../libs/deno_api_kit/db/users.ts
async function resolveLocalUser(db2, identity) {
  const existing = await db2.selectFrom("users").where("auth_user_id", "=", identity.authUserId).selectAll().executeTakeFirst();
  if (existing) {
    return existing;
  }
  const email = identity.email?.trim() || `${identity.authUserId}@users.local`;
  const name = identity.name?.trim() || email.split("@")[0] || "User";
  const byEmail = await db2.selectFrom("users").where("email", "=", email).selectAll().executeTakeFirst();
  if (byEmail) {
    return await db2.updateTable("users").set({
      auth_user_id: identity.authUserId,
      name: byEmail.name || name,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", byEmail.id).returningAll().executeTakeFirstOrThrow();
  }
  return await db2.insertInto("users").values({
    email,
    name,
    auth_user_id: identity.authUserId,
    password_hash: null
  }).returningAll().executeTakeFirstOrThrow();
}

// src/db/users.ts
async function resolveLocalUser2(identity) {
  return resolveLocalUser(db, identity);
}

// src/push/sender.ts
var pushSender = new NoOpPushSender();
function setPushSender(sender) {
  pushSender = sender;
}

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
var pushSender2 = await createPushSenderFromEnv();
setPushSender(pushSender2);
app.use(corsMiddleware);
app.use(healthMiddleware);
async function resolveUserIdFromRequest(authorization) {
  const verified = await verifyAccessToken(authorization);
  if (!verified) return null;
  const localUser = await resolveLocalUser2({
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
  await next();
});
app.use(createGraphQLAuthMiddleware(resolveLocalUser2));
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
  typeDefs: 'input ArgsInput {\n	filter: RewardDefinitionsFilterInput\n}\ninput RewardDefinitionsFilterInput {\n	includeArchived: Boolean\n	search: String\n	category: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	filter: RewardInventoryFilterInput\n}\ninput RewardInventoryFilterInput {\n	search: String\n	stackableOnly: Boolean\n	sort: RECENT_NAME_QUANTITYInput\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_3 {\n	filter: RewardHistoryFilterInput\n}\ninput RewardHistoryFilterInput {\n	definitionId: Number\n	type: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_4 {\n	sourceType: String!\n	sourceId: Number!\n}\ninput ArgsInput_5 {\n	limit: Number\n}\ninput ArgsInput_6 {\n	status: String\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ninput ArgsInput_8 {\n	date: String\n}\ninput ArgsInput_9 {\n	id: Number!\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	activityId: Number\n	fromDate: String\n	toDate: String\n}\ninput ArgsInput_12 {\n	token: String!\n	platform: String!\n}\ninput ArgsInput_13 {\n	token: String!\n}\ninput ArgsInput_14 {\n	input: CreateRewardDefinitionInputInput!\n}\ninput CreateRewardDefinitionInputInput {\n	name: String!\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String!\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_15 {\n	id: Number!\n	input: UpdateRewardDefinitionInputInput!\n}\ninput UpdateRewardDefinitionInputInput {\n	name: String\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ninput ArgsInput_17 {\n	id: Number!\n}\ninput ArgsInput_18 {\n	id: Number!\n}\ninput ArgsInput_19 {\n	input: AttachRewardRuleInputInput!\n}\ninput AttachRewardRuleInputInput {\n	sourceType: String!\n	sourceId: Number!\n	rewardDefinitionId: Number!\n	quantity: Number\n	mode: FIXED_PROBABILITY_RANDOM_POOLInput\n	configJson: String\n	enabled: Boolean\n}\ninput ArgsInput_20 {\n	id: Number!\n}\ninput ArgsInput_21 {\n	input: ConsumeRewardInputInput!\n}\ninput ConsumeRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_22 {\n	input: DiscardRewardInputInput!\n}\ninput DiscardRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n}\ninput ArgsInput_23 {\n	transactionId: Number!\n}\ninput ArgsInput_24 {\n	input: ManualGrantRewardInputInput!\n}\ninput ManualGrantRewardInputInput {\n	rewardDefinitionId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_25 {\n	input: CreateGoalInputInput!\n}\ninput CreateGoalInputInput {\n	title: String!\n	description: String\n	color: String!\n	icon: String\n	ruleType: String!\n	metric: COUNT_DURATIONInput!\n	targetValue: Number!\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	priority: Number\n	sortOrder: Number\n}\ninput GoalConfigInputInput {\n	compositeMode: ALL_ANY_WEIGHTEDInput\n	countRequired: Number\n	beforeTime: String\n	afterTime: String\n	blockUntilUnlocked: Boolean\n}\ninput GoalLinkInputInput {\n	linkType: ACTIVITY_GROUPInput!\n	activityId: Number\n	groupId: Number\n	weight: Number\n}\ninput GoalDependencyInputInput {\n	dependsOnGoalId: Number!\n	requirement: COMPLETE_PROGRESSInput\n	threshold: Number\n	weight: Number\n}\ninput GoalRecurrenceInputInput {\n	period: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput!\n	interval: Number\n	anchor: String\n	carryOver: NONE_OVERFLOWInput\n	reset: String\n}\ninput GoalDeadlineInputInput {\n	kind: ABSOLUTE_RELATIVEInput!\n	date: String\n	daysAfterCycleStart: Number\n	graceDays: Number\n	warnDays: Number\n}\ninput ArgsInput_26 {\n	id: Number!\n	input: UpdateGoalInputInput!\n}\ninput UpdateGoalInputInput {\n	title: String\n	description: String\n	color: String\n	icon: String\n	ruleType: String\n	metric: COUNT_DURATIONInput\n	targetValue: Number\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	confirmStartsAtChange: Boolean\n	status: ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput\n	priority: Number\n	sortOrder: Number\n}\ninput ArgsInput_27 {\n	id: Number!\n}\ninput ArgsInput_28 {\n	id: Number!\n}\ninput ArgsInput_29 {\n	id: Number!\n}\ninput ArgsInput_30 {\n	id: Number!\n}\ninput ArgsInput_31 {\n	input: CreateGroupInputInput!\n}\ninput CreateGroupInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_32 {\n	id: Number!\n	input: UpdateGroupInputInput!\n}\ninput UpdateGroupInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_33 {\n	id: Number!\n}\ninput ArgsInput_34 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_35 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput ArgsInput_36 {\n	id: Number!\n}\ninput ArgsInput_37 {\n	input: CompleteActivityInputInput!\n}\ninput CompleteActivityInputInput {\n	activityId: Number!\n	occurrenceDate: String!\n	durationMinutes: Number\n	notes: String\n}\ninput ArgsInput_38 {\n	id: Number!\n}\ninput ArgsInput_39 {\n	input: LogTimeInputInput!\n}\ninput LogTimeInputInput {\n	activityId: Number!\n	durationMinutes: Number!\n	occurrenceDate: String\n	notes: String\n}\ntype Query {\nrewardDefinitions(args: ArgsInput!): [RewardDefinition!]!\nrewardDefinition(args: ArgsInput_1!): RewardDefinition\nrewardInventory(args: ArgsInput_2!): [RewardInventoryItem!]!\nrewardHistory(args: ArgsInput_3!): [RewardHistoryItem!]!\nrewardRules(args: ArgsInput_4!): [RewardRule!]!\nrecentAssets(args: ArgsInput_5!): [RecentAssets!]!\nrewardNudges(_args: Object): [RewardNudge!]!\ngoals(args: ArgsInput_6): [Goal!]!\ngoal(args: ArgsInput_7!): Goal\ngoalNudges(args: Object): [GoalNudge!]!\ndailyProgress(args: ArgsInput_8): DailyProgress!\ngroups(args: Object): [Group!]!\ngroup(args: ArgsInput_9!): Group\nactivities(args: Object): [Activity!]!\nactivity(args: ArgsInput_10!): Activity\nactivityCompletions(args: ArgsInput_11): [ActivityCompletion!]!\n}\ntype RewardDefinition {\nid: Number!\nuser_id: Number!\nname: String!\ndescription: String\nnotes: String\ncategory: String\ntags: [String!]!\ncolor: String!\nicon: String\nimage_asset_id: Number\nstackable: Boolean!\ndefault_quantity: Number!\nsort_order: Number!\narchived_at: Date\ncreated_at: Date!\nupdated_at: Date!\nimage_url: String\nimage: RewardImage\n}\n"""\nNamed return shapes so Pylon emits GraphQL object types (not `Any!`).\n"""\ntype RewardImage {\nid: Number!\nuser_id: Number!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\ncreated_at: Date!\norphaned_at: Date\nurl: String!\n}\ntype RewardInventoryItem {\nid: Number!\nuser_id: Number!\nreward_definition_id: Number!\nquantity: Number!\nstack_key: String\nfirst_earned_at: Date!\nlast_earned_at: Date!\nupdated_at: Date!\ndefinition: RewardDefinition\n}\ntype RewardHistoryItem {\nid: Number!\nuser_id: Number!\ntype: String!\nreward_definition_id: Number\ninventory_id: Number\nquantity: Number!\ndefinition_name: String!\ndefinition_color: String!\ndefinition_icon: String\nimage_asset_id: Number\nsource_type: String\nsource_id: Number\ntrigger_key: String\nrule_id: Number\nactivity_id: Number\ngoal_id: Number\ncompletion_id: Number\ncycle_id: Number\nnote: String\nmetadata: Object\ncreated_at: Date!\n}\ntype RewardRule {\nid: Number!\nuser_id: Number!\nsource_type: String!\nsource_id: Number!\nreward_definition_id: Number!\nquantity: Number!\nmode: String!\nconfig: RewardRuleConfig!\nenabled: Boolean!\ncreated_at: Date!\nupdated_at: Date!\ndefinition: RewardDefinition\n}\ntype RewardRuleConfig {\nonce: Boolean\ncooldown_hours: Number\nmax_grants_total: Number\nmax_grants_per_period: Number\nperiod_hours: Number\nprobability: Number\n"""\nPool of definition ids for random_pool mode.\n"""\npool: [Pool!]\n}\ntype Pool {\ndefinition_id: Number!\nweight: Number\nquantity: Number\n}\ntype RecentAssets {\nurl: String!\nid: Number!\nuser_id: Number!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\ncreated_at: Date!\norphaned_at: Date\n}\ntype RewardNudge {\nkind: RewardNudgeKind!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS!\ndefinitionId: Number\ninventoryId: Number\n}\ntype Goal {\nid: Number!\nuser_id: Number!\ntitle: String!\ndescription: String\ncolor: String!\nicon: String\nrule_type: String!\nmetric: String!\ntarget_value: Number!\nconfig: GoalConfig!\nstatus: String!\nrecurrence: GoalRecurrenceConfig\ndeadline: GoalDeadlineConfig\npriority: Number!\nsort_order: Number!\nstarts_at: Date!\ncreated_at: Date!\nupdated_at: Date!\nstartsAt: String!\nlifecyclePhase: GoalLifecyclePhase!\nlinks: [GoalLink!]!\nactiveCycle: ActiveCycle\ncycles: [GoalCycleView!]!\ndependencies: [GoalDependency!]!\nsnapshots: [GoalSnapshot!]!\nisLocked: Boolean!\n}\ntype GoalConfig {\ncomposite_mode: ALL_ANY_WEIGHTED\ncount_required: Number\nbefore_time: String\nafter_time: String\nblock_until_unlocked: Boolean\n}\ntype GoalRecurrenceConfig {\nperiod: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS!\ninterval: Number\nanchor: String\ncarry_over: NONE_OVERFLOW\nreset: String\n}\ntype GoalDeadlineConfig {\nkind: ABSOLUTE_RELATIVE!\ndate: String\ndays_after_cycle_start: Number\ngrace_days: Number\nwarn_days: Number\n}\ntype GoalLink {\nid: Number!\ngoal_id: Number!\nlink_type: String!\nactivity_id: Number\ngroup_id: Number\nweight: Number!\ncreated_at: Date!\nactivity: LinkedActivity\ngroup: LinkedGroup\n}\n"""\nNamed return shapes so Pylon emits GraphQL object types (not `Any!`).\n"""\ntype LinkedActivity {\nid: Number!\nuser_id: Number!\ngroup_id: Number\ntitle: String!\ndescription: String\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\nnotification_offsets: [Number!]!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype LinkedGroup {\nid: Number!\nuser_id: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype ActiveCycle {\ndeadlineState: DeadlineState!\npercentComplete: Number!\nremaining: Number!\nid: Number!\ngoal_id: Number!\ncycle_index: Number!\nstarts_at: Date!\nends_at: Date\ndeadline_at: Date\ntarget_value: Number!\ncurrent_value: Number!\nstatus: String!\ncarry_over: Number!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype GoalCycleView {\nid: Number!\ngoal_id: Number!\ncycle_index: Number!\nstarts_at: Date!\nends_at: Date\ndeadline_at: Date\ntarget_value: Number!\ncurrent_value: Number!\nstatus: String!\ncarry_over: Number!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype GoalDependency {\nid: Number!\ngoal_id: Number!\ndepends_on_goal_id: Number!\nrequirement: String!\nthreshold: Number\nweight: Number!\ncreated_at: Date!\ndependsOn: Goal\n}\ntype GoalSnapshot {\nid: Number!\ngoal_cycle_id: Number!\nas_of: String!\nvalue: Number!\ncreated_at: Date!\n}\ntype GoalNudge {\nkind: GoalNudgeKind!\ngoalId: Number!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS_WARNING!\n}\ntype DailyProgress {\ndate: String!\ncompletedCount: Number!\nminutesToday: Number!\nstreakDays: Number!\ncompletions: [ActivityCompletionRow!]!\n}\ntype ActivityCompletionRow {\nid: Number!\nactivity_id: Number!\nuser_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata\n}\ntype Metadata {\ntitle: String\nnotes: String\ntrigger_events: [String!]\n}\ntype Group {\nid: Number!\nuser_id: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Activity {\nid: Number!\nuser_id: Number!\ngroup_id: Number\ntitle: String!\ndescription: String\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\nnotification_offsets: [Number!]!\ncreated_at: Date!\nupdated_at: Date!\nrecurrencePattern: ParsedRecurrencePattern\ngroup: Group\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype ActivityCompletion {\nid: Number!\nactivity_id: Number!\nuser_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata_1\n}\ntype Metadata_1 {\ntitle: String\nnotes: String\ntrigger_events: [String!]\n}\ntype Mutation {\nregisterDeviceToken(args: ArgsInput_12!): Boolean!\nunregisterDeviceToken(args: ArgsInput_13!): Boolean!\ncreateRewardDefinition(args: ArgsInput_14!): RewardDefinition!\nupdateRewardDefinition(args: ArgsInput_15!): RewardDefinition!\narchiveRewardDefinition(args: ArgsInput_16!): RewardDefinition!\nunarchiveRewardDefinition(args: ArgsInput_17!): RewardDefinition!\ndeleteRewardDefinition(args: ArgsInput_18!): Boolean!\nattachRewardRule(args: ArgsInput_19!): RewardRule!\ndetachRewardRule(args: ArgsInput_20!): Boolean!\nconsumeReward(args: ArgsInput_21!): ConsumeReward!\ndiscardReward(args: ArgsInput_22!): DiscardReward!\nrestoreReward(args: ArgsInput_23!): RestoreReward!\nmanualGrantReward(args: ArgsInput_24!): RewardHistoryItem\nrecomputeRewardInventory: Boolean!\ncreateGoal(args: ArgsInput_25!): Goal!\nupdateGoal(args: ArgsInput_26!): Goal!\npauseGoal(args: ArgsInput_27!): Goal!\nresumeGoal(args: ArgsInput_28!): Goal!\narchiveGoal(args: ArgsInput_29!): Goal!\ndeleteGoal(args: ArgsInput_30!): Boolean!\nrecomputeGoalProgress(args: Object): RecomputeGoalProgress!\ncreateGroup(args: ArgsInput_31!): Group!\nupdateGroup(args: ArgsInput_32!): Group!\ndeleteGroup(args: ArgsInput_33!): Boolean!\ncreateActivity(args: ArgsInput_34!): Activity!\nupdateActivity(args: ArgsInput_35!): Activity!\ndeleteActivity(args: ArgsInput_36!): Boolean!\ncompleteActivity(args: ArgsInput_37!): CompleteActivityResult!\nundoCompletion(args: ArgsInput_38!): Boolean!\nlogTime(args: ArgsInput_39!): LogTimeResult!\n}\ntype ConsumeReward {\ninventory: RewardInventoryItem\ntransaction: RewardHistoryItem!\n}\ntype DiscardReward {\ninventory: RewardInventoryItem\ntransaction: RewardHistoryItem!\n}\ntype RestoreReward {\ninventory: RewardInventoryItem!\ntransaction: RewardHistoryItem!\n}\ntype RecomputeGoalProgress {\nrecomputed: Number!\n}\ntype CompleteActivityResult {\ngrantedRewards: [Object]!\nid: Number!\nactivity_id: Number!\nuser_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata_1\n}\ntype LogTimeResult {\nid: Number!\nuser_id: Number!\nsource_type: String!\nactivity_id: Number\ngroup_id: Number\ncompletion_id: Number\noccurred_at: Date!\noccurrence_date: String\nmetric: String!\namount: Number!\nmetadata: Object\ncreated_at: Date!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum RewardNudgeKind {\n	inventory_available\n	recently_earned\n	unconsumed_stack\n}\nenum INFO_SUCCESS {\n	info\n	success\n}\nenum GoalLifecyclePhase {\n	scheduled\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum ALL_ANY_WEIGHTED {\n	all\n	any\n	weighted\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOW {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVE {\n	absolute\n	relative\n}\nenum DeadlineState {\n	failed\n	on_track\n	approaching\n	overdue\n}\nenum GoalNudgeKind {\n	deadline_approaching\n	deadline_overdue\n	behind_pace\n	cycle_complete\n	dependency_unlocked\n	goal_starting_soon\n}\nenum INFO_SUCCESS_WARNING {\n	info\n	success\n	warning\n}\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum RECENT_NAME_QUANTITYInput {\n	recent\n	name\n	quantity\n}\nenum FIXED_PROBABILITY_RANDOM_POOLInput {\n	fixed\n	probability\n	random_pool\n}\nenum COUNT_DURATIONInput {\n	count\n	duration\n}\nenum ALL_ANY_WEIGHTEDInput {\n	all\n	any\n	weighted\n}\nenum ACTIVITY_GROUPInput {\n	activity\n	group\n}\nenum COMPLETE_PROGRESSInput {\n	complete\n	progress\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOWInput {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVEInput {\n	absolute\n	relative\n}\nenum ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n',
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3Jld2FyZHMvaW52ZW50b3J5LnRzIiwgIi4uL3NyYy9yZXdhcmRzL3J1bGVzL2V2YWx1YXRlLnRzIiwgIi4uL3NyYy9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMiLCAiLi4vc3JjL3Jld2FyZHMvc291cmNlcy9pbmRleC50cyIsICIuLi9zcmMvcmV3YXJkcy9ob29rcy50cyIsICIuLi9zcmMvcmV3YXJkcy9udWRnZXMudHMiLCAiLi4vc3JjL2luZGV4LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvbm9vcF9zZW5kZXIudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvZmlyZWJhc2Vfc2VuZGVyLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3NzbC50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL3B1c2gvZGV2aWNlX3Rva2VuX3ZhbGlkYXRpb24udHMiLCAiLi4vc3JjL2dvYWxzL2xpZmVjeWNsZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ29hbHMvcHJvZ3Jlc3MudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9ncmFwaHFsL25vdGlmaWNhdGlvbl9vZmZzZXRzLnRzIiwgIi4uL3NyYy9ncmFwaHFsL251bWVyaWMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL2dvYWxzX3Jlc29sdmVycy50cyIsICIuLi9zcmMvZ29hbHMvY3ljbGVzLnRzIiwgIi4uL3NyYy9nb2Fscy9udWRnZXMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL3Jld2FyZHNfcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9hc3NldHMvaGFzaGluZy50cyIsICIuLi9zcmMvYXNzZXRzL3N0b3JhZ2UvbG9jYWxfZnMudHMiLCAiLi4vc3JjL2Fzc2V0cy9zdG9yYWdlL3MzLnRzIiwgIi4uL3NyYy9hc3NldHMvc3RvcmFnZS90eXBlcy50cyIsICIuLi9zcmMvYXNzZXRzL3JlcG9zaXRvcnkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvcHlsb24vbWlkZGxld2FyZS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiLCAiLi4vc3JjL3B1c2gvc2VuZGVyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBOZXdSZXdhcmRJbnZlbnRvcnksXG4gIE5ld1Jld2FyZFRyYW5zYWN0aW9uLFxuICBSZXdhcmREZWZpbml0aW9uLFxuICBSZXdhcmRJbnZlbnRvcnksXG4gIFJld2FyZFRyYW5zYWN0aW9uLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgdHlwZSB7IEdyYW50SW5zdHJ1Y3Rpb24gfSBmcm9tICcuL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBJbnZlbnRvcnlNYW5hZ2VyIHtcbiAgYXBwbHlFYXJuKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24sXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlEaXNjYXJkKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlSZXN0b3JlKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbnN1bWVUcmFuc2FjdGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgcmV2b2tlVW5jb25zdW1lZEZvckNvbXBsZXRpb24oXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29tcGxldGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8bnVtYmVyPlxufVxuXG5mdW5jdGlvbiBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgZGVmaW5pdGlvbl9uYW1lOiBkZWZpbml0aW9uLm5hbWUsXG4gICAgZGVmaW5pdGlvbl9jb2xvcjogZGVmaW5pdGlvbi5jb2xvcixcbiAgICBkZWZpbml0aW9uX2ljb246IGRlZmluaXRpb24uaWNvbixcbiAgICBpbWFnZV9hc3NldF9pZDogZGVmaW5pdGlvbi5pbWFnZV9hc3NldF9pZCxcbiAgfVxufVxuXG5mdW5jdGlvbiBuZXdTdGFja0tleSgpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLnJhbmRvbVVVSUQoKVxufVxuXG5leHBvcnQgY2xhc3MgRGJJbnZlbnRvcnlNYW5hZ2VyIGltcGxlbWVudHMgSW52ZW50b3J5TWFuYWdlciB7XG4gIGFzeW5jIGFwcGx5RWFybihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uLFxuICAgIGluc3RydWN0aW9uOiBHcmFudEluc3RydWN0aW9uLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnk7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgc25hcCA9IHNuYXBzaG90RmllbGRzKGRlZmluaXRpb24pXG5cbiAgICBsZXQgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgZGVmaW5pdGlvbi5pZClcbiAgICAgICAgLndoZXJlKCdzdGFja19rZXknLCAnaXMnLCBudWxsKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHF1YW50aXR5OiBleGlzdGluZy5xdWFudGl0eSArIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICAgIHF1YW50aXR5OiBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbnVsbCxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb24tc3RhY2thYmxlOiBvbmUgcm93IHBlciBncmFudGVkIHVuaXQgKHF1YW50aXR5IGFsd2F5cyAxIHBlciByb3cpLlxuICAgICAgLy8gSWYgaW5zdHJ1Y3Rpb24ucXVhbnRpdHkgPiAxLCBjcmVhdGUgbXVsdGlwbGUgcm93czsgcmV0dXJuIHRoZSBsYXN0LlxuICAgICAgbGV0IGxhc3QhOiBSZXdhcmRJbnZlbnRvcnlcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaW5zdHJ1Y3Rpb24ucXVhbnRpdHk7IGkrKykge1xuICAgICAgICBsYXN0ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgICAgaW52ZW50b3J5ID0gbGFzdFxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAnZWFybicsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogaW5zdHJ1Y3Rpb24uc291cmNlVHlwZSxcbiAgICAgICAgc291cmNlX2lkOiBpbnN0cnVjdGlvbi5zb3VyY2VJZCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IGluc3RydWN0aW9uLnRyaWdnZXJLZXksXG4gICAgICAgIHJ1bGVfaWQ6IGluc3RydWN0aW9uLnJ1bGVJZCxcbiAgICAgICAgYWN0aXZpdHlfaWQ6IGluc3RydWN0aW9uLmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICAgICAgZ29hbF9pZDogaW5zdHJ1Y3Rpb24uZ29hbElkID8/IG51bGwsXG4gICAgICAgIGNvbXBsZXRpb25faWQ6IGluc3RydWN0aW9uLmNvbXBsZXRpb25JZCA/PyBudWxsLFxuICAgICAgICBjeWNsZV9pZDogaW5zdHJ1Y3Rpb24uY3ljbGVJZCA/PyBudWxsLFxuICAgICAgICBub3RlOiBudWxsLFxuICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRUcmFuc2FjdGlvbilcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWNyZW1lbnQoXG4gICAgICB0cngsXG4gICAgICB1c2VySWQsXG4gICAgICBpbnZlbnRvcnlJZCxcbiAgICAgIHF1YW50aXR5LFxuICAgICAgJ2NvbnN1bWUnLFxuICAgICAgbm90ZSA/PyBudWxsLFxuICAgIClcbiAgfVxuXG4gIGFzeW5jIGFwcGx5RGlzY2FyZChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgaW52ZW50b3J5SWQsXG4gICAgICBxdWFudGl0eSxcbiAgICAgICdkZWxldGUnLFxuICAgICAgbnVsbCxcbiAgICApXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGRlY3JlbWVudChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICAgdHlwZTogJ2NvbnN1bWUnIHwgJ2RlbGV0ZScsXG4gICAgbm90ZTogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICBpZiAocXVhbnRpdHkgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ3F1YW50aXR5IG11c3QgYmUgPj0gMScpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnZlbnRvcnlJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnZlbnRvcnkgaXRlbSBub3QgZm91bmQnKVxuICAgIGlmIChyb3cucXVhbnRpdHkgPCBxdWFudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnN1ZmZpY2llbnQgcXVhbnRpdHknKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBjb25zdCBzbmFwID0gZGVmaW5pdGlvblxuICAgICAgPyBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uKVxuICAgICAgOiB7XG4gICAgICAgICAgZGVmaW5pdGlvbl9uYW1lOiAnVW5rbm93biByZXdhcmQnLFxuICAgICAgICAgIGRlZmluaXRpb25fY29sb3I6ICcjNjQ3NDhCJyxcbiAgICAgICAgICBkZWZpbml0aW9uX2ljb246IG51bGwgYXMgc3RyaW5nIHwgbnVsbCxcbiAgICAgICAgICBpbWFnZV9hc3NldF9pZDogbnVsbCBhcyBudW1iZXIgfCBudWxsLFxuICAgICAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByZW1haW5pbmcgPSByb3cucXVhbnRpdHkgLSBxdWFudGl0eVxuICAgIGxldCBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGxcblxuICAgIGlmIChyZW1haW5pbmcgPT09IDApIHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIHJvdy5pZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgaW52ZW50b3J5ID0gbnVsbFxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLnNldCh7IHF1YW50aXR5OiByZW1haW5pbmcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogcm93LnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IHJlbWFpbmluZyA9PT0gMCA/IG51bGwgOiByb3cuaWQsXG4gICAgICAgIHF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogJ21hbnVhbCcsXG4gICAgICAgIHNvdXJjZV9pZDogbnVsbCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IG51bGwsXG4gICAgICAgIHJ1bGVfaWQ6IG51bGwsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBudWxsLFxuICAgICAgICBnb2FsX2lkOiBudWxsLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBudWxsLFxuICAgICAgICBjeWNsZV9pZDogbnVsbCxcbiAgICAgICAgbm90ZSxcbiAgICAgICAgbWV0YWRhdGE6IHJlbWFpbmluZyA9PT0gMFxuICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBjbGVhcmVkX2ludmVudG9yeV9pZDogcm93LmlkIH0pXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICBhc3luYyBhcHBseVJlc3RvcmUoXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29uc3VtZVRyYW5zYWN0aW9uSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5OyB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfT4ge1xuICAgIGNvbnN0IGNvbnN1bWVUeCA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVRyYW5zYWN0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2NvbnN1bWUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIWNvbnN1bWVUeCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdjb25zdW1lIHRyYW5zYWN0aW9uIG5vdCBmb3VuZCcpXG4gICAgaWYgKGNvbnN1bWVUeC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ2Nhbm5vdCByZXN0b3JlOiBkZWZpbml0aW9uIG1pc3NpbmcnKVxuICAgIH1cblxuICAgIC8vIFByZXZlbnQgZG91YmxlLXJlc3RvcmUuXG4gICAgY29uc3QgYWxyZWFkeSA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdyZXN0b3JlJylcbiAgICAgIC53aGVyZSgnbWV0YWRhdGEnLCAnaXMgbm90JywgbnVsbClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVzdG9yZWQgPSBhbHJlYWR5LnNvbWUoKHQpID0+IHtcbiAgICAgIGNvbnN0IG1ldGEgPVxuICAgICAgICB0eXBlb2YgdC5tZXRhZGF0YSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UodC5tZXRhZGF0YSlcbiAgICAgICAgICA6IHQubWV0YWRhdGFcbiAgICAgIHJldHVybiBtZXRhICYmIG1ldGEucmVzdG9yZWRfZnJvbSA9PT0gY29uc3VtZVRyYW5zYWN0aW9uSWRcbiAgICB9KVxuICAgIGlmIChyZXN0b3JlZCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdhbHJlYWR5IHJlc3RvcmVkJylcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVR4LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgY29uc3QgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24gPSB7XG4gICAgICBydWxlSWQ6IG51bGwsXG4gICAgICBkZWZpbml0aW9uSWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICBxdWFudGl0eTogY29uc3VtZVR4LnF1YW50aXR5LFxuICAgICAgdHJpZ2dlcktleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgc291cmNlVHlwZTogJ21hbnVhbCcsXG4gICAgICBzb3VyY2VJZDogMCxcbiAgICB9XG5cbiAgICAvLyBSZS1hcHBseSBhcyBlYXJuLWxpa2UgaW52ZW50b3J5IGJ1bXAsIHRoZW4gd3JpdGUgcmVzdG9yZSB0eC5cbiAgICBjb25zdCB7IGludmVudG9yeSB9ID0gYXdhaXQgdGhpcy5hcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgIClcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAncmVzdG9yZScsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGNvbnN1bWVUeC5xdWFudGl0eSxcbiAgICAgICAgLi4uc25hcHNob3RGaWVsZHMoZGVmaW5pdGlvbiksXG4gICAgICAgIHNvdXJjZV90eXBlOiAnbWFudWFsJyxcbiAgICAgICAgc291cmNlX2lkOiBudWxsLFxuICAgICAgICB0cmlnZ2VyX2tleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgICBydWxlX2lkOiBudWxsLFxuICAgICAgICBhY3Rpdml0eV9pZDogbnVsbCxcbiAgICAgICAgZ29hbF9pZDogbnVsbCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgY3ljbGVfaWQ6IG51bGwsXG4gICAgICAgIG5vdGU6IG51bGwsXG4gICAgICAgIG1ldGFkYXRhOiBKU09OLnN0cmluZ2lmeSh7IHJlc3RvcmVkX2Zyb206IGNvbnN1bWVUcmFuc2FjdGlvbklkIH0pLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICAvKiogSW52ZW50b3J5IGJ1bXAgd2l0aG91dCB3cml0aW5nIGFuIGVhcm4gbGVkZ2VyIHJvdyAodXNlZCBieSByZXN0b3JlKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyBhcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IH0+IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBpZiAoZGVmaW5pdGlvbi5zdGFja2FibGUpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGRlZmluaXRpb24uaWQpXG4gICAgICAgIC53aGVyZSgnc3RhY2tfa2V5JywgJ2lzJywgbnVsbClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICBxdWFudGl0eTogZXhpc3RpbmcucXVhbnRpdHkgKyBxdWFudGl0eSxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICBxdWFudGl0eSxcbiAgICAgICAgICBzdGFja19rZXk6IG51bGwsXG4gICAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgfVxuXG4gICAgY29uc3QgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgcXVhbnRpdHk6IDEsXG4gICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlIHVuY29uc3VtZWQgcG9ydGlvbiBvZiBlYXJucyB0aWVkIHRvIGEgY29tcGxldGlvbi5cbiAgICogTmV2ZXIgZHJpdmVzIGludmVudG9yeSBuZWdhdGl2ZS5cbiAgICovXG4gIGFzeW5jIHJldm9rZVVuY29uc3VtZWRGb3JDb21wbGV0aW9uKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyLFxuICApOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdjb21wbGV0aW9uX2lkJywgJz0nLCBjb21wbGV0aW9uSWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGxldCByZXZva2VkID0gMFxuICAgIGZvciAoY29uc3QgZWFybiBvZiBlYXJucykge1xuICAgICAgaWYgKGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQgPT0gbnVsbCkgY29udGludWVcblxuICAgICAgY29uc3QgaW52ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGludi5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnF1YW50aXR5LCAwKVxuICAgICAgY29uc3QgdG9SZXZva2UgPSBNYXRoLm1pbihlYXJuLnF1YW50aXR5LCBhdmFpbGFibGUpXG4gICAgICBpZiAodG9SZXZva2UgPD0gMCkgY29udGludWVcblxuICAgICAgbGV0IHJlbWFpbmluZyA9IHRvUmV2b2tlXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiBpbnYpIHtcbiAgICAgICAgaWYgKHJlbWFpbmluZyA8PSAwKSBicmVha1xuICAgICAgICBjb25zdCB0YWtlID0gTWF0aC5taW4ocm93LnF1YW50aXR5LCByZW1haW5pbmcpXG4gICAgICAgIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgcm93LmlkLFxuICAgICAgICAgIHRha2UsXG4gICAgICAgICAgJ2RlbGV0ZScsXG4gICAgICAgICAgYHJldm9rZWQ6Y29tcGxldGlvbjoke2NvbXBsZXRpb25JZH1gLFxuICAgICAgICApXG4gICAgICAgIHJlbWFpbmluZyAtPSB0YWtlXG4gICAgICAgIHJldm9rZWQgKz0gdGFrZVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV2b2tlZFxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZlbnRvcnlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52ZW50b3J5RXJyb3InXG4gIH1cbn1cblxuLyoqIFJlYnVpbGQgaW52ZW50b3J5IHF1YW50aXRpZXMgZnJvbSB0aGUgbGVkZ2VyIChyZXBhaXIpLiBEb2VzIG5vdCB3cml0ZSBsZWRnZXIgcm93cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVJbnZlbnRvcnlGcm9tTGVkZ2VyKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBkYlxuICAgIC5kZWxldGVGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgdHhzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnYXNjJylcbiAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgZGVmcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuICBjb25zdCBkZWZNYXAgPSBuZXcgTWFwKGRlZnMubWFwKChkKSA9PiBbZC5pZCwgZF0pKVxuXG4gIGNvbnN0IG5ldCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KClcbiAgY29uc3QgZmlyc3RFYXJuID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKVxuICBjb25zdCBsYXN0RWFybiA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KClcblxuICBmb3IgKGNvbnN0IHR4IG9mIHR4cykge1xuICAgIGlmICh0eC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZklkID0gdHgucmV3YXJkX2RlZmluaXRpb25faWRcbiAgICBjb25zdCBjdXIgPSBuZXQuZ2V0KGRlZklkKSA/PyAwXG4gICAgY29uc3QgY3JlYXRlZCA9XG4gICAgICB0eXBlb2YgdHguY3JlYXRlZF9hdCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyB0eC5jcmVhdGVkX2F0XG4gICAgICAgIDogbmV3IERhdGUodHguY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKHR4LnR5cGUgPT09ICdlYXJuJyB8fCB0eC50eXBlID09PSAncmVzdG9yZScpIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIGN1ciArIHR4LnF1YW50aXR5KVxuICAgICAgaWYgKCFmaXJzdEVhcm4uaGFzKGRlZklkKSkgZmlyc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICAgIGxhc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgdHgudHlwZSA9PT0gJ2NvbnN1bWUnIHx8XG4gICAgICB0eC50eXBlID09PSAnZGVsZXRlJyB8fFxuICAgICAgdHgudHlwZSA9PT0gJ2FkanVzdCdcbiAgICApIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIE1hdGgubWF4KDAsIGN1ciAtIHR4LnF1YW50aXR5KSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgZm9yIChjb25zdCBbZGVmSWQsIHF0eV0gb2YgbmV0KSB7XG4gICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBkZWZNYXAuZ2V0KGRlZklkKVxuICAgIGlmICghZGVmaW5pdGlvbikgY29udGludWVcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZklkLFxuICAgICAgICAgIHF1YW50aXR5OiBxdHksXG4gICAgICAgICAgc3RhY2tfa2V5OiBudWxsLFxuICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBsYXN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcXR5OyBpKyspIHtcbiAgICAgICAgYXdhaXQgZGJcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmSWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IGxhc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAgIC5leGVjdXRlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIFJld2FyZFJ1bGUsXG4gIFJld2FyZFJ1bGVDb25maWcsXG4gIFJld2FyZFJ1bGVNb2RlLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRDb250ZXh0IHtcbiAgdXNlcklkOiBudW1iZXJcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgdHJpZ2dlcktleTogc3RyaW5nXG4gIGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsXG4gIGdvYWxJZD86IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBjeWNsZUlkPzogbnVtYmVyIHwgbnVsbFxuICAvKiogUHJpb3IgZWFybiBjb3VudCBmb3IgdGhpcyBydWxlIChmb3Igb25jZSAvIG1heF9ncmFudHMpLiAqL1xuICBwcmlvckVhcm5Db3VudDogbnVtYmVyXG4gIC8qKiBJU08gdGltZXN0YW1wIG9mIGxhc3QgZWFybiBmb3IgdGhpcyBydWxlLCBpZiBhbnkuICovXG4gIGxhc3RFYXJuQXQ6IHN0cmluZyB8IG51bGxcbiAgbm93PzogRGF0ZVxuICAvKiogUk5HIGZvciBwcm9iYWJpbGl0eSAvIHJhbmRvbV9wb29sIChpbmplY3RhYmxlIGZvciB0ZXN0cykuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYW50SW5zdHJ1Y3Rpb24ge1xuICBydWxlSWQ6IG51bWJlciB8IG51bGxcbiAgZGVmaW5pdGlvbklkOiBudW1iZXJcbiAgcXVhbnRpdHk6IG51bWJlclxuICB0cmlnZ2VyS2V5OiBzdHJpbmdcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgYWN0aXZpdHlJZD86IG51bWJlciB8IG51bGxcbiAgZ29hbElkPzogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uSWQ/OiBudW1iZXIgfCBudWxsXG4gIGN5Y2xlSWQ/OiBudW1iZXIgfCBudWxsXG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKGNvbmZpZzogUmV3YXJkUnVsZVsnY29uZmlnJ10pOiBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgaWYgKGNvbmZpZyA9PSBudWxsKSByZXR1cm4ge31cbiAgaWYgKHR5cGVvZiBjb25maWcgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGNvbmZpZykgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiBjb25maWcgYXMgUmV3YXJkUnVsZUNvbmZpZ1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGEgc2luZ2xlIHJld2FyZCBydWxlIGFnYWluc3QgYSBncmFudCBjb250ZXh0LlxuICogUmV0dXJucyBudWxsIHdoZW4gdGhlIHJ1bGUgc2hvdWxkIG5vdCBncmFudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlUnVsZShcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4pOiBHcmFudEluc3RydWN0aW9uIHwgbnVsbCB7XG4gIGlmICghcnVsZS5lbmFibGVkKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHJ1bGUuY29uZmlnKVxuICBjb25zdCBub3cgPSBjdHgubm93ID8/IG5ldyBEYXRlKClcbiAgY29uc3QgcmFuZG9tID0gY3R4LnJhbmRvbSA/PyBNYXRoLnJhbmRvbVxuXG4gIGlmIChjb25maWcub25jZSAmJiBjdHgucHJpb3JFYXJuQ291bnQgPiAwKSByZXR1cm4gbnVsbFxuXG4gIGlmIChcbiAgICB0eXBlb2YgY29uZmlnLm1heF9ncmFudHNfdG90YWwgPT09ICdudW1iZXInICYmXG4gICAgY3R4LnByaW9yRWFybkNvdW50ID49IGNvbmZpZy5tYXhfZ3JhbnRzX3RvdGFsXG4gICkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBpZiAoXG4gICAgdHlwZW9mIGNvbmZpZy5jb29sZG93bl9ob3VycyA9PT0gJ251bWJlcicgJiZcbiAgICBjb25maWcuY29vbGRvd25faG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBjb25zdCBjb29sZG93bk1zID0gY29uZmlnLmNvb2xkb3duX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICBpZiAobm93LmdldFRpbWUoKSAtIGxhc3QgPCBjb29sZG93bk1zKSByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKFxuICAgIHR5cGVvZiBjb25maWcubWF4X2dyYW50c19wZXJfcGVyaW9kID09PSAnbnVtYmVyJyAmJlxuICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgIGNvbmZpZy5wZXJpb2RfaG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgLy8gTGlnaHR3ZWlnaHQgcGVyaW9kIGNoZWNrOiBpZiBsYXN0IGVhcm4gaXMgd2l0aGluIHBlcmlvZCBhbmQgd2UndmVcbiAgICAvLyBhbHJlYWR5IGhpdCB0aGUgY2FwIHZpYSBwcmlvckVhcm5Db3VudCBhcHByb3hpbWF0aW9uLCBza2lwLlxuICAgIC8vIEZ1bGwgcGVyaW9kIGNvdW50aW5nIGlzIGhhbmRsZWQgYnkgY2FsbGVycyB0aGF0IHNldCBwcmlvckVhcm5Db3VudFxuICAgIC8vIHRvIHRoZSBjb3VudCB3aXRoaW4gdGhlIHBlcmlvZCB3aW5kb3cgd2hlbiBwZXJpb2RfaG91cnMgaXMgc2V0LlxuICAgIGNvbnN0IHBlcmlvZE1zID0gY29uZmlnLnBlcmlvZF9ob3VycyAqIDYwICogNjAgKiAxMDAwXG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBpZiAoXG4gICAgICBub3cuZ2V0VGltZSgpIC0gbGFzdCA8IHBlcmlvZE1zICYmXG4gICAgICBjdHgucHJpb3JFYXJuQ291bnQgPj0gY29uZmlnLm1heF9ncmFudHNfcGVyX3BlcmlvZFxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cblxuICBjb25zdCBtb2RlID0gcnVsZS5tb2RlIGFzIFJld2FyZFJ1bGVNb2RlXG5cbiAgaWYgKG1vZGUgPT09ICdwcm9iYWJpbGl0eScpIHtcbiAgICBjb25zdCBwID1cbiAgICAgIHR5cGVvZiBjb25maWcucHJvYmFiaWxpdHkgPT09ICdudW1iZXInID8gY29uZmlnLnByb2JhYmlsaXR5IDogMVxuICAgIGlmIChyYW5kb20oKSA+IHApIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihydWxlLCBjdHgsIHJ1bGUucmV3YXJkX2RlZmluaXRpb25faWQsIHJ1bGUucXVhbnRpdHkpXG4gIH1cblxuICBpZiAobW9kZSA9PT0gJ3JhbmRvbV9wb29sJykge1xuICAgIGNvbnN0IHBvb2wgPSBjb25maWcucG9vbFxuICAgIGlmICghcG9vbCB8fCBwb29sLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB0b3RhbFdlaWdodCA9IHBvb2wucmVkdWNlKChzLCBlKSA9PiBzICsgKGUud2VpZ2h0ID8/IDEpLCAwKVxuICAgIGlmICh0b3RhbFdlaWdodCA8PSAwKSByZXR1cm4gbnVsbFxuICAgIGxldCByb2xsID0gcmFuZG9tKCkgKiB0b3RhbFdlaWdodFxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcG9vbCkge1xuICAgICAgcm9sbCAtPSBlbnRyeS53ZWlnaHQgPz8gMVxuICAgICAgaWYgKHJvbGwgPD0gMCkge1xuICAgICAgICByZXR1cm4gYmFzZUluc3RydWN0aW9uKFxuICAgICAgICAgIHJ1bGUsXG4gICAgICAgICAgY3R4LFxuICAgICAgICAgIGVudHJ5LmRlZmluaXRpb25faWQsXG4gICAgICAgICAgZW50cnkucXVhbnRpdHkgPz8gcnVsZS5xdWFudGl0eSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBsYXN0ID0gcG9vbFtwb29sLmxlbmd0aCAtIDFdXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihcbiAgICAgIHJ1bGUsXG4gICAgICBjdHgsXG4gICAgICBsYXN0LmRlZmluaXRpb25faWQsXG4gICAgICBsYXN0LnF1YW50aXR5ID8/IHJ1bGUucXVhbnRpdHksXG4gICAgKVxuICB9XG5cbiAgLy8gZml4ZWQgKGRlZmF1bHQpXG4gIHJldHVybiBiYXNlSW5zdHJ1Y3Rpb24oXG4gICAgcnVsZSxcbiAgICBjdHgsXG4gICAgcnVsZS5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICBydWxlLnF1YW50aXR5LFxuICApXG59XG5cbmZ1bmN0aW9uIGJhc2VJbnN0cnVjdGlvbihcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4gIGRlZmluaXRpb25JZDogbnVtYmVyLFxuICBxdWFudGl0eTogbnVtYmVyLFxuKTogR3JhbnRJbnN0cnVjdGlvbiB7XG4gIHJldHVybiB7XG4gICAgcnVsZUlkOiBydWxlLmlkLFxuICAgIGRlZmluaXRpb25JZCxcbiAgICBxdWFudGl0eTogTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihxdWFudGl0eSkpLFxuICAgIHRyaWdnZXJLZXk6IGN0eC50cmlnZ2VyS2V5LFxuICAgIHNvdXJjZVR5cGU6IGN0eC5zb3VyY2VUeXBlLFxuICAgIHNvdXJjZUlkOiBjdHguc291cmNlSWQsXG4gICAgYWN0aXZpdHlJZDogY3R4LmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICBnb2FsSWQ6IGN0eC5nb2FsSWQgPz8gbnVsbCxcbiAgICBjb21wbGV0aW9uSWQ6IGN0eC5jb21wbGV0aW9uSWQgPz8gbnVsbCxcbiAgICBjeWNsZUlkOiBjdHguY3ljbGVJZCA/PyBudWxsLFxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgUmV3YXJkRGVmaW5pdGlvbixcbiAgUmV3YXJkUnVsZSxcbiAgUmV3YXJkVHJhbnNhY3Rpb24sXG59IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbiAgdHlwZSBJbnZlbnRvcnlNYW5hZ2VyLFxufSBmcm9tICcuL2ludmVudG9yeS50cydcbmltcG9ydCB7XG4gIGV2YWx1YXRlUnVsZSxcbiAgdHlwZSBHcmFudENvbnRleHQsXG4gIHR5cGUgR3JhbnRJbnN0cnVjdGlvbixcbn0gZnJvbSAnLi9ydWxlcy9ldmFsdWF0ZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRSZXN1bHQge1xuICBpbnN0cnVjdGlvbjogR3JhbnRJbnN0cnVjdGlvblxuICB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfCBudWxsXG4gIHNraXBwZWQ6IGJvb2xlYW5cbiAgcmVhc29uPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkR3JhbnRTZXJ2aWNlIHtcbiAgZ3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSxcbiAgKTogUHJvbWlzZTxHcmFudFJlc3VsdFtdPlxuXG4gIGNvbGxlY3RBbmRHcmFudChcbiAgICBkYjogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIHJ1bGVzOiBSZXdhcmRSdWxlW10sXG4gICAgYmFzZUN0eDogT21pdDxHcmFudENvbnRleHQsICdwcmlvckVhcm5Db3VudCcgfCAnbGFzdEVhcm5BdCcgfCAndXNlcklkJz4sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT5cbn1cblxuZXhwb3J0IGNsYXNzIERlZmF1bHRSZXdhcmRHcmFudFNlcnZpY2UgaW1wbGVtZW50cyBSZXdhcmRHcmFudFNlcnZpY2Uge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGludmVudG9yeTogSW52ZW50b3J5TWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKSxcbiAgKSB7fVxuXG4gIGFzeW5jIGdyYW50KFxuICAgIGRiOiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW5zdHJ1Y3Rpb25zOiBHcmFudEluc3RydWN0aW9uW10sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICAgIGNvbnN0IHJlc3VsdHM6IEdyYW50UmVzdWx0W10gPSBbXVxuXG4gICAgZm9yIChjb25zdCBpbnN0cnVjdGlvbiBvZiBpbnN0cnVjdGlvbnMpIHtcbiAgICAgIC8vIElkZW1wb3RlbmN5OiBza2lwIGlmIGVhcm4gYWxyZWFkeSBleGlzdHMuXG4gICAgICBsZXQgZXhpc3RpbmdRdWVyeSA9IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgICAud2hlcmUoJ3RyaWdnZXJfa2V5JywgJz0nLCBpbnN0cnVjdGlvbi50cmlnZ2VyS2V5KVxuXG4gICAgICBpZiAoaW5zdHJ1Y3Rpb24ucnVsZUlkICE9IG51bGwpIHtcbiAgICAgICAgZXhpc3RpbmdRdWVyeSA9IGV4aXN0aW5nUXVlcnkud2hlcmUoJ3J1bGVfaWQnLCAnPScsIGluc3RydWN0aW9uLnJ1bGVJZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4aXN0aW5nUXVlcnkgPSBleGlzdGluZ1F1ZXJ5LndoZXJlKCdydWxlX2lkJywgJ2lzJywgbnVsbClcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBleGlzdGluZ1F1ZXJ5LnNlbGVjdEFsbCgpLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICB0cmFuc2FjdGlvbjogZXhpc3RpbmcsXG4gICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICByZWFzb246ICdhbHJlYWR5X2dyYW50ZWQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGluc3RydWN0aW9uLmRlZmluaXRpb25JZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbikge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGluc3RydWN0aW9uLFxuICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgIHNraXBwZWQ6IHRydWUsXG4gICAgICAgICAgcmVhc29uOiAnZGVmaW5pdGlvbl9ub3RfZm91bmQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHRyYW5zYWN0aW9uIH0gPSBhd2FpdCB0aGlzLmludmVudG9yeS5hcHBseUVhcm4oXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICAgIGRlZmluaXRpb24gYXMgUmV3YXJkRGVmaW5pdGlvbixcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgKVxuICAgICAgICByZXN1bHRzLnB1c2goeyBpbnN0cnVjdGlvbiwgdHJhbnNhY3Rpb24sIHNraXBwZWQ6IGZhbHNlIH0pXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gVW5pcXVlIGNvbnN0cmFpbnQgcmFjZSBcdTIxOTIgdHJlYXQgYXMgYWxyZWFkeSBncmFudGVkLlxuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpXG4gICAgICAgIGlmIChcbiAgICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKCdyZXdhcmRfdHJhbnNhY3Rpb25zX2Vhcm5faWRlbXBvdGVuY3knKSB8fFxuICAgICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoJ3VuaXF1ZScpXG4gICAgICAgICkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYXNvbjogJ2FscmVhZHlfZ3JhbnRlZCcsXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICAgIHRocm93IGVyclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzXG4gIH1cblxuICBhc3luYyBjb2xsZWN0QW5kR3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBydWxlczogUmV3YXJkUnVsZVtdLFxuICAgIGJhc2VDdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnIHwgJ3VzZXJJZCc+LFxuICApOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgICBjb25zdCBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCd0eXBlJywgJz0nLCAnZWFybicpXG4gICAgICAgIC53aGVyZSgncnVsZV9pZCcsICc9JywgcnVsZS5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGNvbmZpZyA9XG4gICAgICAgIHR5cGVvZiBydWxlLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UocnVsZS5jb25maWcpXG4gICAgICAgICAgOiBydWxlLmNvbmZpZyA/PyB7fVxuXG4gICAgICBsZXQgcHJpb3JFYXJuQ291bnQgPSBlYXJucy5sZW5ndGhcbiAgICAgIGxldCBsYXN0RWFybkF0OiBzdHJpbmcgfCBudWxsID1cbiAgICAgICAgZWFybnNbMF0gIT0gbnVsbFxuICAgICAgICAgID8gdHlwZW9mIGVhcm5zWzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGVhcm5zWzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgIDogbmV3IERhdGUoZWFybnNbMF0uY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgIDogbnVsbFxuXG4gICAgICAvLyBXaGVuIHBlcmlvZF9ob3VycyBpcyBzZXQsIGNvdW50IG9ubHkgZWFybnMgaW5zaWRlIHRoZSB3aW5kb3cuXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgICAgICBjb25maWcucGVyaW9kX2hvdXJzID4gMFxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IGJhc2VDdHgubm93ID8/IG5ldyBEYXRlKClcbiAgICAgICAgY29uc3Qgd2luZG93TXMgPSBjb25maWcucGVyaW9kX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICAgICAgY29uc3QgaW5XaW5kb3cgPSBlYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICAgICAgICByZXR1cm4gbm93LmdldFRpbWUoKSAtIHQgPCB3aW5kb3dNc1xuICAgICAgICB9KVxuICAgICAgICBwcmlvckVhcm5Db3VudCA9IGluV2luZG93Lmxlbmd0aFxuICAgICAgICBsYXN0RWFybkF0ID1cbiAgICAgICAgICBpbldpbmRvd1swXSAhPSBudWxsXG4gICAgICAgICAgICA/IHR5cGVvZiBpbldpbmRvd1swXS5jcmVhdGVkX2F0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICA/IGluV2luZG93WzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgICAgOiBuZXcgRGF0ZShpbldpbmRvd1swXS5jcmVhdGVkX2F0KS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICA6IG51bGxcbiAgICAgIH1cblxuICAgICAgY29uc3QgY3R4OiBHcmFudENvbnRleHQgPSB7XG4gICAgICAgIC4uLmJhc2VDdHgsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgcHJpb3JFYXJuQ291bnQsXG4gICAgICAgIGxhc3RFYXJuQXQsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIGN0eClcbiAgICAgIGlmIChpbnN0cnVjdGlvbikgaW5zdHJ1Y3Rpb25zLnB1c2goaW5zdHJ1Y3Rpb24pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ3JhbnQoZGIsIHVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCByZXdhcmRHcmFudFNlcnZpY2UgPSBuZXcgRGVmYXVsdFJld2FyZEdyYW50U2VydmljZSgpXG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSwgUmV3YXJkUnVsZSB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRJbnN0cnVjdGlvbiB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuaW1wb3J0IHsgZXZhbHVhdGVSdWxlLCB0eXBlIEdyYW50Q29udGV4dCB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRTb3VyY2VBZGFwdGVyIHtcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIGNvbGxlY3RHcmFudHMoXG4gICAgZGI6IERiTGlrZSxcbiAgICBjdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnPixcbiAgKTogUHJvbWlzZTxHcmFudEluc3RydWN0aW9uW10+XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRSdWxlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIHNvdXJjZVR5cGU6IHN0cmluZyxcbiAgc291cmNlSWQ6IG51bWJlcixcbik6IFByb21pc2U8UmV3YXJkUnVsZVtdPiB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc291cmNlX3R5cGUnLCAnPScsIHNvdXJjZVR5cGUpXG4gICAgLndoZXJlKCdzb3VyY2VfaWQnLCAnPScsIHNvdXJjZUlkKVxuICAgIC53aGVyZSgnZW5hYmxlZCcsICc9JywgdHJ1ZSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVucmljaEFuZEV2YWx1YXRlKFxuICBkYjogRGJMaWtlLFxuICBydWxlczogUmV3YXJkUnVsZVtdLFxuICBiYXNlOiBPbWl0PEdyYW50Q29udGV4dCwgJ3ByaW9yRWFybkNvdW50JyB8ICdsYXN0RWFybkF0Jz4sXG4pOiBQcm9taXNlPEdyYW50SW5zdHJ1Y3Rpb25bXT4ge1xuICBjb25zdCBvdXQ6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGNvbnN0IGxhc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBiYXNlLnVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdydWxlX2lkJywgJz0nLCBydWxlLmlkKVxuICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIHtcbiAgICAgIC4uLmJhc2UsXG4gICAgICBwcmlvckVhcm5Db3VudDogbGFzdC5sZW5ndGgsXG4gICAgICBsYXN0RWFybkF0OlxuICAgICAgICBsYXN0WzBdICE9IG51bGxcbiAgICAgICAgICA/IHR5cGVvZiBsYXN0WzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGxhc3RbMF0uY3JlYXRlZF9hdFxuICAgICAgICAgICAgOiBuZXcgRGF0ZShsYXN0WzBdLmNyZWF0ZWRfYXQpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICA6IG51bGwsXG4gICAgfSlcbiAgICBpZiAoaW5zdHJ1Y3Rpb24pIG91dC5wdXNoKGluc3RydWN0aW9uKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5UmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnYWN0aXZpdHknLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhkYiwgY3R4LnVzZXJJZCwgJ2FjdGl2aXR5JywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdvYWxSZXdhcmRTb3VyY2U6IFJld2FyZFNvdXJjZUFkYXB0ZXIgPSB7XG4gIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgYXN5bmMgY29sbGVjdEdyYW50cyhkYiwgY3R4KSB7XG4gICAgY29uc3QgcnVsZXMgPSBhd2FpdCBsb2FkUnVsZXMoZGIsIGN0eC51c2VySWQsICdnb2FsJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogc3RyZWFrLWJhc2VkIGdyYW50cyAoUGhhc2UgMyBzdHViIFx1MjAxNCByZWdpc3RlciB3aGVuIHN0cmVhayBldmVudHMgZXhpc3QpLiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha1Jld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ3N0cmVhaycsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKGRiLCBjdHgudXNlcklkLCAnc3RyZWFrJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogZGFpbHkgY29tcGxldGlvbiBncmFudHMuICovXG5leHBvcnQgY29uc3QgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnZGFpbHlfY29tcGxldGlvbicsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKFxuICAgICAgZGIsXG4gICAgICBjdHgudXNlcklkLFxuICAgICAgJ2RhaWx5X2NvbXBsZXRpb24nLFxuICAgICAgY3R4LnNvdXJjZUlkLFxuICAgIClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbi8qKiBGdXR1cmU6IHdlZWtseSBjb21wbGV0aW9uIGdyYW50cy4gKi9cbmV4cG9ydCBjb25zdCB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnd2Vla2x5X2NvbXBsZXRpb24nLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhcbiAgICAgIGRiLFxuICAgICAgY3R4LnVzZXJJZCxcbiAgICAgICd3ZWVrbHlfY29tcGxldGlvbicsXG4gICAgICBjdHguc291cmNlSWQsXG4gICAgKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IFJFV0FSRF9TT1VSQ0VfQURBUFRFUlM6IFJld2FyZFNvdXJjZUFkYXB0ZXJbXSA9IFtcbiAgYWN0aXZpdHlSZXdhcmRTb3VyY2UsXG4gIGdvYWxSZXdhcmRTb3VyY2UsXG4gIHN0cmVha1Jld2FyZFNvdXJjZSxcbiAgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuICB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuXVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmV3YXJkU291cmNlQWRhcHRlcihcbiAgc291cmNlVHlwZTogc3RyaW5nLFxuKTogUmV3YXJkU291cmNlQWRhcHRlciB8IG51bGwge1xuICByZXR1cm4gKFxuICAgIFJFV0FSRF9TT1VSQ0VfQURBUFRFUlMuZmluZCgoYSkgPT4gYS5zb3VyY2VUeXBlID09PSBzb3VyY2VUeXBlKSA/PyBudWxsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgcmV3YXJkR3JhbnRTZXJ2aWNlIH0gZnJvbSAnLi9ncmFudF9zZXJ2aWNlLnRzJ1xuaW1wb3J0IHsgZ2V0UmV3YXJkU291cmNlQWRhcHRlciB9IGZyb20gJy4vc291cmNlcy9pbmRleC50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRSZXN1bHQgfSBmcm9tICcuL2dyYW50X3NlcnZpY2UudHMnXG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPlxuXG4vKiogR3JhbnQgcmV3YXJkcyBmb3IgYW4gYWN0aXZpdHkgY29tcGxldGlvbiAoaWRlbXBvdGVudCBwZXIgY29tcGxldGlvbitydWxlKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24oXG4gIGRiOiBEYkxpa2UsXG4gIG9wdHM6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGFjdGl2aXR5SWQ6IG51bWJlclxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyXG4gIH0sXG4pOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgY29uc3QgYWRhcHRlciA9IGdldFJld2FyZFNvdXJjZUFkYXB0ZXIoJ2FjdGl2aXR5JylcbiAgaWYgKCFhZGFwdGVyKSByZXR1cm4gW11cblxuICBjb25zdCB0cmlnZ2VyS2V5ID0gYGNvbXBsZXRpb246JHtvcHRzLmNvbXBsZXRpb25JZH1gXG4gIGNvbnN0IGluc3RydWN0aW9ucyA9IGF3YWl0IGFkYXB0ZXIuY29sbGVjdEdyYW50cyhkYiwge1xuICAgIHVzZXJJZDogb3B0cy51c2VySWQsXG4gICAgc291cmNlVHlwZTogJ2FjdGl2aXR5JyxcbiAgICBzb3VyY2VJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIHRyaWdnZXJLZXksXG4gICAgYWN0aXZpdHlJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIGNvbXBsZXRpb25JZDogb3B0cy5jb21wbGV0aW9uSWQsXG4gIH0pXG5cbiAgcmV0dXJuIGF3YWl0IHJld2FyZEdyYW50U2VydmljZS5ncmFudChkYiwgb3B0cy51c2VySWQsIGluc3RydWN0aW9ucylcbn1cblxuLyoqIEdyYW50IHJld2FyZHMgd2hlbiBhIGdvYWwgY3ljbGUgdHJhbnNpdGlvbnMgdG8gc3VjY2VlZGVkIChlZGdlLXRyaWdnZXJlZCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhcbiAgZGI6IERiTGlrZSxcbiAgb3B0czoge1xuICAgIHVzZXJJZDogbnVtYmVyXG4gICAgZ29hbElkOiBudW1iZXJcbiAgICBjeWNsZUlkOiBudW1iZXJcbiAgfSxcbik6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICBjb25zdCBhZGFwdGVyID0gZ2V0UmV3YXJkU291cmNlQWRhcHRlcignZ29hbCcpXG4gIGlmICghYWRhcHRlcikgcmV0dXJuIFtdXG5cbiAgY29uc3QgdHJpZ2dlcktleSA9IGBjeWNsZToke29wdHMuY3ljbGVJZH06c3VjY2VlZGVkYFxuICBjb25zdCBpbnN0cnVjdGlvbnMgPSBhd2FpdCBhZGFwdGVyLmNvbGxlY3RHcmFudHMoZGIsIHtcbiAgICB1c2VySWQ6IG9wdHMudXNlcklkLFxuICAgIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgICBzb3VyY2VJZDogb3B0cy5nb2FsSWQsXG4gICAgdHJpZ2dlcktleSxcbiAgICBnb2FsSWQ6IG9wdHMuZ29hbElkLFxuICAgIGN5Y2xlSWQ6IG9wdHMuY3ljbGVJZCxcbiAgfSlcblxuICByZXR1cm4gYXdhaXQgcmV3YXJkR3JhbnRTZXJ2aWNlLmdyYW50KGRiLCBvcHRzLnVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxufVxuIiwgImltcG9ydCB0eXBlIHsgUmV3YXJkSW52ZW50b3J5LCBSZXdhcmRUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgUmV3YXJkTnVkZ2VLaW5kID1cbiAgfCAnaW52ZW50b3J5X2F2YWlsYWJsZSdcbiAgfCAncmVjZW50bHlfZWFybmVkJ1xuICB8ICd1bmNvbnN1bWVkX3N0YWNrJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZE51ZGdlIHtcbiAga2luZDogUmV3YXJkTnVkZ2VLaW5kXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnc3VjY2VzcydcbiAgZGVmaW5pdGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBpbnZlbnRvcnlJZD86IG51bWJlciB8IG51bGxcbn1cblxuLyoqXG4gKiBCdWlsZCBsaWdodHdlaWdodCByZXdhcmQgbnVkZ2VzIGZvciB0aGUgT3ZlcnZpZXcgc3VyZmFjZS5cbiAqIFB1cmUgXHUyMDE0IG5vIEkvTy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmV3YXJkTnVkZ2VzKGlucHV0OiB7XG4gIGludmVudG9yeTogQXJyYXk8XG4gICAgUGljazxSZXdhcmRJbnZlbnRvcnksICdpZCcgfCAncXVhbnRpdHknIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJz4gJiB7XG4gICAgICBuYW1lPzogc3RyaW5nXG4gICAgfVxuICA+XG4gIHJlY2VudEVhcm5zOiBBcnJheTxcbiAgICBQaWNrPFxuICAgICAgUmV3YXJkVHJhbnNhY3Rpb24sXG4gICAgICAnaWQnIHwgJ2RlZmluaXRpb25fbmFtZScgfCAncXVhbnRpdHknIHwgJ2NyZWF0ZWRfYXQnIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJ1xuICAgID5cbiAgPlxuICBub3c/OiBEYXRlXG59KTogUmV3YXJkTnVkZ2VbXSB7XG4gIGNvbnN0IG51ZGdlczogUmV3YXJkTnVkZ2VbXSA9IFtdXG4gIGNvbnN0IG5vdyA9IGlucHV0Lm5vdyA/PyBuZXcgRGF0ZSgpXG5cbiAgY29uc3QgdG90YWxRdHkgPSBpbnB1dC5pbnZlbnRvcnkucmVkdWNlKChzLCBpKSA9PiBzICsgaS5xdWFudGl0eSwgMClcbiAgaWYgKHRvdGFsUXR5ID4gMCkge1xuICAgIGNvbnN0IHRvcCA9IFsuLi5pbnB1dC5pbnZlbnRvcnldLnNvcnQoKGEsIGIpID0+IGIucXVhbnRpdHkgLSBhLnF1YW50aXR5KVswXVxuICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdpbnZlbnRvcnlfYXZhaWxhYmxlJyxcbiAgICAgIHRpdGxlOiAnUmV3YXJkcyByZWFkeScsXG4gICAgICBtZXNzYWdlOlxuICAgICAgICB0b3RhbFF0eSA9PT0gMVxuICAgICAgICAgID8gJ1lvdSBoYXZlIDEgcmV3YXJkIHdhaXRpbmcgdG8gYmUgZW5qb3llZC4nXG4gICAgICAgICAgOiBgWW91IGhhdmUgJHt0b3RhbFF0eX0gcmV3YXJkcyB3YWl0aW5nIHRvIGJlIGVuam95ZWQuYCxcbiAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICBkZWZpbml0aW9uSWQ6IHRvcD8ucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogdG9wPy5pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgZGF5QWdvID0gbm93LmdldFRpbWUoKSAtIDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgY29uc3QgZnJlc2ggPSBpbnB1dC5yZWNlbnRFYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBkYXlBZ29cbiAgfSlcbiAgZm9yIChjb25zdCBlYXJuIG9mIGZyZXNoLnNsaWNlKDAsIDMpKSB7XG4gICAgbnVkZ2VzLnB1c2goe1xuICAgICAga2luZDogJ3JlY2VudGx5X2Vhcm5lZCcsXG4gICAgICB0aXRsZTogJ1Jld2FyZCBlYXJuZWQnLFxuICAgICAgbWVzc2FnZTogYFlvdSBlYXJuZWQgJHtlYXJuLmRlZmluaXRpb25fbmFtZX0gXHUwMEQ3JHtlYXJuLnF1YW50aXR5fS5gLFxuICAgICAgc2V2ZXJpdHk6ICdzdWNjZXNzJyxcbiAgICAgIGRlZmluaXRpb25JZDogZWFybi5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgYmlnU3RhY2sgPSBpbnB1dC5pbnZlbnRvcnkuZmluZCgoaSkgPT4gaS5xdWFudGl0eSA+PSA1KVxuICBpZiAoYmlnU3RhY2spIHtcbiAgICBudWRnZXMucHVzaCh7XG4gICAgICBraW5kOiAndW5jb25zdW1lZF9zdGFjaycsXG4gICAgICB0aXRsZTogJ0dyb3dpbmcgc3RhY2snLFxuICAgICAgbWVzc2FnZTogYCR7YmlnU3RhY2submFtZSA/PyAnQSByZXdhcmQnfSBpcyBzdGFja2VkIFx1MDBENyR7YmlnU3RhY2sucXVhbnRpdHl9IFx1MjAxNCB0cmVhdCB5b3Vyc2VsZj9gLFxuICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgIGRlZmluaXRpb25JZDogYmlnU3RhY2sucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogYmlnU3RhY2suaWQsXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBhcHAgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgY3JlYXRlUHVzaFNlbmRlckZyb21FbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvcHVzaC9tb2QudHMnXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7XG4gIGNvcnNNaWRkbGV3YXJlLFxuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZSxcbiAgaGVhbHRoTWlkZGxld2FyZSxcbn0gZnJvbSAnZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB7XG4gIEFzc2V0VmFsaWRhdGlvbkVycm9yLFxuICBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5LFxufSBmcm9tICcuL2Fzc2V0cy9yZXBvc2l0b3J5LnRzJ1xuaW1wb3J0IHsgTUFYX0FTU0VUX0JZVEVTIH0gZnJvbSAnLi9hc3NldHMvc3RvcmFnZS90eXBlcy50cydcbmltcG9ydCB7IHNldFB1c2hTZW5kZXIgfSBmcm9tICcuL3B1c2gvc2VuZGVyLnRzJ1xuXG5jb25zdCBwdXNoU2VuZGVyID0gYXdhaXQgY3JlYXRlUHVzaFNlbmRlckZyb21FbnYoKVxuc2V0UHVzaFNlbmRlcihwdXNoU2VuZGVyKVxuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuYXBwLnVzZShoZWFsdGhNaWRkbGV3YXJlKVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVXNlcklkRnJvbVJlcXVlc3QoXG4gIGF1dGhvcml6YXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGF1dGhvcml6YXRpb24pXG4gIGlmICghdmVyaWZpZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuICByZXR1cm4gbG9jYWxVc2VyLmlkXG59XG5cbi8qKiBBdXRoZW50aWNhdGVkIFJFU1QgZm9yIGFzc2V0IHVwbG9hZCAvIGRvd25sb2FkIChub3QgR3JhcGhRTCkuICovXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gIGlmIChwYXRoID09PSAnL2Fzc2V0cycgJiYgY3R4LnJlcS5tZXRob2QgPT09ICdQT1NUJykge1xuICAgIGNvbnN0IHVzZXJJZCA9IGF3YWl0IHJlc29sdmVVc2VySWRGcm9tUmVxdWVzdChcbiAgICAgIGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJyksXG4gICAgKVxuICAgIGlmICh1c2VySWQgPT0gbnVsbCkgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9XG4gICAgICAgIGN0eC5yZXEuaGVhZGVyKCdDb250ZW50LVR5cGUnKT8udG9Mb3dlckNhc2UoKSA/PyAnJ1xuICAgICAgbGV0IGJ5dGVzOiBVaW50OEFycmF5XG4gICAgICBsZXQgbWltZSA9ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nXG4gICAgICBsZXQgZmlsZW5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoJ211bHRpcGFydC9mb3JtLWRhdGEnKSkge1xuICAgICAgICBjb25zdCBmb3JtID0gYXdhaXQgY3R4LnJlcS5mb3JtRGF0YSgpXG4gICAgICAgIGNvbnN0IGZpbGUgPSBmb3JtLmdldCgnZmlsZScpXG4gICAgICAgIGlmICghZmlsZSB8fCB0eXBlb2YgZmlsZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4ganNvbkVycm9yKCdmaWxlIGZpZWxkIHJlcXVpcmVkJywgNDAwKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGJsb2IgPSBmaWxlIGFzIEZpbGVcbiAgICAgICAgbWltZSA9IGJsb2IudHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICAgICAgICBmaWxlbmFtZSA9IGJsb2IubmFtZVxuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKClcbiAgICAgICAgYnl0ZXMgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtaW1lID0gY29udGVudFR5cGUuc3BsaXQoJzsnKVswXS50cmltKCkgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgY3R4LnJlcS5hcnJheUJ1ZmZlcigpXG4gICAgICAgIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgICAgfVxuXG4gICAgICBpZiAoYnl0ZXMuYnl0ZUxlbmd0aCA+IE1BWF9BU1NFVF9CWVRFUykge1xuICAgICAgICByZXR1cm4ganNvbkVycm9yKCdmaWxlIHRvbyBsYXJnZScsIDQxMylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8ucHV0KHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBieXRlcyxcbiAgICAgICAgY29udGVudFR5cGU6IG1pbWUsXG4gICAgICAgIGZpbGVuYW1lLFxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGlkOiBhc3NldC5pZCxcbiAgICAgICAgICBzaGEyNTY6IGFzc2V0LnNoYTI1NixcbiAgICAgICAgICBjb250ZW50VHlwZTogYXNzZXQuY29udGVudF90eXBlLFxuICAgICAgICAgIGJ5dGVTaXplOiBhc3NldC5ieXRlX3NpemUsXG4gICAgICAgICAgdXJsOiBgL2Fzc2V0cy8ke2Fzc2V0LmlkfWAsXG4gICAgICAgIH0pLFxuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBBc3NldFZhbGlkYXRpb25FcnJvcikge1xuICAgICAgICByZXR1cm4ganNvbkVycm9yKGVyci5tZXNzYWdlLCBlcnIuc3RhdHVzKVxuICAgICAgfVxuICAgICAgY29uc29sZS5lcnJvcignYXNzZXQgdXBsb2FkIGZhaWxlZCcsIGVycilcbiAgICAgIHJldHVybiBqc29uRXJyb3IoJ3VwbG9hZCBmYWlsZWQnLCA1MDApXG4gICAgfVxuICB9XG5cbiAgY29uc3QgYXNzZXRNYXRjaCA9IHBhdGgubWF0Y2goL15cXC9hc3NldHNcXC8oXFxkKykkLylcbiAgaWYgKGFzc2V0TWF0Y2ggJiYgY3R4LnJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgY29uc3QgdXNlcklkID0gYXdhaXQgcmVzb2x2ZVVzZXJJZEZyb21SZXF1ZXN0KFxuICAgICAgY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSxcbiAgICApXG4gICAgaWYgKHVzZXJJZCA9PSBudWxsKSByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuXG4gICAgY29uc3QgYXNzZXRJZCA9IE51bWJlcihhc3NldE1hdGNoWzFdKVxuICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlcG8ucmVhZEJ5dGVzKGFzc2V0SWQsIHVzZXJJZClcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgcmV0dXJuIGpzb25FcnJvcignbm90IGZvdW5kJywgNDA0KVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgUmVzcG9uc2UocmVzdWx0LmJ5dGVzLmJ1ZmZlci5zbGljZShcbiAgICAgIHJlc3VsdC5ieXRlcy5ieXRlT2Zmc2V0LFxuICAgICAgcmVzdWx0LmJ5dGVzLmJ5dGVPZmZzZXQgKyByZXN1bHQuYnl0ZXMuYnl0ZUxlbmd0aCxcbiAgICApLCB7XG4gICAgICBzdGF0dXM6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6IHJlc3VsdC5jb250ZW50VHlwZSxcbiAgICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAncHJpdmF0ZSwgbWF4LWFnZT0zNjAwJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxufSlcblxuYXBwLnVzZShjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUocmVzb2x2ZUxvY2FsVXNlcikpXG5cbmZ1bmN0aW9uIGpzb25FcnJvcihtZXNzYWdlOiBzdHJpbmcsIHN0YXR1czogbnVtYmVyKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IG1lc3NhZ2UgfSksIHtcbiAgICBzdGF0dXMsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgfSxcbiAgfSlcbn1cblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQXJnc0lucHV0IHtcXG5cXHRmaWx0ZXI6IFJld2FyZERlZmluaXRpb25zRmlsdGVySW5wdXRcXG59XFxuaW5wdXQgUmV3YXJkRGVmaW5pdGlvbnNGaWx0ZXJJbnB1dCB7XFxuXFx0aW5jbHVkZUFyY2hpdmVkOiBCb29sZWFuXFxuXFx0c2VhcmNoOiBTdHJpbmdcXG5cXHRjYXRlZ29yeTogU3RyaW5nXFxuXFx0bGltaXQ6IE51bWJlclxcblxcdG9mZnNldDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZmlsdGVyOiBSZXdhcmRJbnZlbnRvcnlGaWx0ZXJJbnB1dFxcbn1cXG5pbnB1dCBSZXdhcmRJbnZlbnRvcnlGaWx0ZXJJbnB1dCB7XFxuXFx0c2VhcmNoOiBTdHJpbmdcXG5cXHRzdGFja2FibGVPbmx5OiBCb29sZWFuXFxuXFx0c29ydDogUkVDRU5UX05BTUVfUVVBTlRJVFlJbnB1dFxcblxcdGxpbWl0OiBOdW1iZXJcXG5cXHRvZmZzZXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMyB7XFxuXFx0ZmlsdGVyOiBSZXdhcmRIaXN0b3J5RmlsdGVySW5wdXRcXG59XFxuaW5wdXQgUmV3YXJkSGlzdG9yeUZpbHRlcklucHV0IHtcXG5cXHRkZWZpbml0aW9uSWQ6IE51bWJlclxcblxcdHR5cGU6IFN0cmluZ1xcblxcdGxpbWl0OiBOdW1iZXJcXG5cXHRvZmZzZXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0c291cmNlVHlwZTogU3RyaW5nIVxcblxcdHNvdXJjZUlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF81IHtcXG5cXHRsaW1pdDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF82IHtcXG5cXHRzdGF0dXM6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGRhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfOSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEwIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTEge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTIge1xcblxcdHRva2VuOiBTdHJpbmchXFxuXFx0cGxhdGZvcm06IFN0cmluZyFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEzIHtcXG5cXHR0b2tlbjogU3RyaW5nIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTQge1xcblxcdGlucHV0OiBDcmVhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0bm90ZXM6IFN0cmluZ1xcblxcdGNhdGVnb3J5OiBTdHJpbmdcXG5cXHR0YWdzOiBbU3RyaW5nIV1cXG5cXHRjb2xvcjogU3RyaW5nIVxcblxcdGljb246IFN0cmluZ1xcblxcdGltYWdlQXNzZXRJZDogTnVtYmVyXFxuXFx0c3RhY2thYmxlOiBCb29sZWFuXFxuXFx0ZGVmYXVsdFF1YW50aXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTUge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZVJld2FyZERlZmluaXRpb25JbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG5cXHRjYXRlZ29yeTogU3RyaW5nXFxuXFx0dGFnczogW1N0cmluZyFdXFxuXFx0Y29sb3I6IFN0cmluZ1xcblxcdGljb246IFN0cmluZ1xcblxcdGltYWdlQXNzZXRJZDogTnVtYmVyXFxuXFx0c3RhY2thYmxlOiBCb29sZWFuXFxuXFx0ZGVmYXVsdFF1YW50aXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTkge1xcblxcdGlucHV0OiBBdHRhY2hSZXdhcmRSdWxlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQXR0YWNoUmV3YXJkUnVsZUlucHV0SW5wdXQge1xcblxcdHNvdXJjZVR5cGU6IFN0cmluZyFcXG5cXHRzb3VyY2VJZDogTnVtYmVyIVxcblxcdHJld2FyZERlZmluaXRpb25JZDogTnVtYmVyIVxcblxcdHF1YW50aXR5OiBOdW1iZXJcXG5cXHRtb2RlOiBGSVhFRF9QUk9CQUJJTElUWV9SQU5ET01fUE9PTElucHV0XFxuXFx0Y29uZmlnSnNvbjogU3RyaW5nXFxuXFx0ZW5hYmxlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMSB7XFxuXFx0aW5wdXQ6IENvbnN1bWVSZXdhcmRJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDb25zdW1lUmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0aW52ZW50b3J5SWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMiB7XFxuXFx0aW5wdXQ6IERpc2NhcmRSZXdhcmRJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBEaXNjYXJkUmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0aW52ZW50b3J5SWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMyB7XFxuXFx0dHJhbnNhY3Rpb25JZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjQge1xcblxcdGlucHV0OiBNYW51YWxHcmFudFJld2FyZElucHV0SW5wdXQhXFxufVxcbmlucHV0IE1hbnVhbEdyYW50UmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0cmV3YXJkRGVmaW5pdGlvbklkOiBOdW1iZXIhXFxuXFx0cXVhbnRpdHk6IE51bWJlclxcblxcdG5vdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjUge1xcblxcdGlucHV0OiBDcmVhdGVHb2FsSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlR29hbElucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmchXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmchXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0cnVsZVR5cGU6IFN0cmluZyFcXG5cXHRtZXRyaWM6IENPVU5UX0RVUkFUSU9OSW5wdXQhXFxuXFx0dGFyZ2V0VmFsdWU6IE51bWJlciFcXG5cXHRjb25maWc6IEdvYWxDb25maWdJbnB1dElucHV0XFxuXFx0bGlua3M6IFtHb2FsTGlua0lucHV0SW5wdXQhXVxcblxcdGRlcGVuZGVuY2llczogW0dvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCFdXFxuXFx0cmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dElucHV0XFxuXFx0ZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0SW5wdXRcXG5cXHRzdGFydHNBdDogU3RyaW5nXFxuXFx0cHJpb3JpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxDb25maWdJbnB1dElucHV0IHtcXG5cXHRjb21wb3NpdGVNb2RlOiBBTExfQU5ZX1dFSUdIVEVESW5wdXRcXG5cXHRjb3VudFJlcXVpcmVkOiBOdW1iZXJcXG5cXHRiZWZvcmVUaW1lOiBTdHJpbmdcXG5cXHRhZnRlclRpbWU6IFN0cmluZ1xcblxcdGJsb2NrVW50aWxVbmxvY2tlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBHb2FsTGlua0lucHV0SW5wdXQge1xcblxcdGxpbmtUeXBlOiBBQ1RJVklUWV9HUk9VUElucHV0IVxcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGdyb3VwSWQ6IE51bWJlclxcblxcdHdlaWdodDogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCB7XFxuXFx0ZGVwZW5kc09uR29hbElkOiBOdW1iZXIhXFxuXFx0cmVxdWlyZW1lbnQ6IENPTVBMRVRFX1BST0dSRVNTSW5wdXRcXG5cXHR0aHJlc2hvbGQ6IE51bWJlclxcblxcdHdlaWdodDogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxSZWN1cnJlbmNlSW5wdXRJbnB1dCB7XFxuXFx0cGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQhXFxuXFx0aW50ZXJ2YWw6IE51bWJlclxcblxcdGFuY2hvcjogU3RyaW5nXFxuXFx0Y2FycnlPdmVyOiBOT05FX09WRVJGTE9XSW5wdXRcXG5cXHRyZXNldDogU3RyaW5nXFxufVxcbmlucHV0IEdvYWxEZWFkbGluZUlucHV0SW5wdXQge1xcblxcdGtpbmQ6IEFCU09MVVRFX1JFTEFUSVZFSW5wdXQhXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0ZGF5c0FmdGVyQ3ljbGVTdGFydDogTnVtYmVyXFxuXFx0Z3JhY2VEYXlzOiBOdW1iZXJcXG5cXHR3YXJuRGF5czogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNiB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlR29hbElucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUdvYWxJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmdcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRydWxlVHlwZTogU3RyaW5nXFxuXFx0bWV0cmljOiBDT1VOVF9EVVJBVElPTklucHV0XFxuXFx0dGFyZ2V0VmFsdWU6IE51bWJlclxcblxcdGNvbmZpZzogR29hbENvbmZpZ0lucHV0SW5wdXRcXG5cXHRsaW5rczogW0dvYWxMaW5rSW5wdXRJbnB1dCFdXFxuXFx0ZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3lJbnB1dElucHV0IV1cXG5cXHRyZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXRcXG5cXHRkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXRJbnB1dFxcblxcdHN0YXJ0c0F0OiBTdHJpbmdcXG5cXHRjb25maXJtU3RhcnRzQXRDaGFuZ2U6IEJvb2xlYW5cXG5cXHRzdGF0dXM6IEFDVElWRV9QQVVTRURfQ09NUExFVEVEX0FSQ0hJVkVEX0ZBSUxFRElucHV0XFxuXFx0cHJpb3JpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjkge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMxIHtcXG5cXHRpbnB1dDogQ3JlYXRlR3JvdXBJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVHcm91cElucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRjb2xvcjogU3RyaW5nIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzIge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlR3JvdXBJbnB1dElucHV0IHtcXG5cXHRuYW1lOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzM0IHtcXG5cXHRpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmchXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nIVxcblxcdGVuZFRpbWU6IFN0cmluZyFcXG5cXHRpc1JlY3VycmluZzogQm9vbGVhbiFcXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0bm90aWZpY2F0aW9uT2Zmc2V0czogW051bWJlciFdXFxufVxcbmlucHV0IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dCB7XFxuXFx0cmVjdXJyZW5jZVR5cGU6IFJlY3VycmVuY2VUeXBlSW5wdXQhXFxuXFx0Y29uZmlnOiBSZWN1cnJlbmNlQ29uZmlnSW5wdXQhXFxufVxcbmlucHV0IFJlY3VycmVuY2VDb25maWdJbnB1dCB7XFxuXFx0ZGF5c19vZl93ZWVrOiBbTnVtYmVyIV1cXG5cXHRkYXlzX29mX21vbnRoOiBbTnVtYmVyIV1cXG5cXHRpc19sYXN0X2RheV9vZl9tb250aDogQm9vbGVhblxcblxcdGludGVydmFsX2RheXM6IE51bWJlclxcblxcdHN0YXJ0X2RhdGU6IFN0cmluZyFcXG5cXHRlbmRfZGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zNSB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmdcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmdcXG5cXHRlbmRUaW1lOiBTdHJpbmdcXG5cXHRpc1JlY3VycmluZzogQm9vbGVhblxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG5cXHRub3RpZmljYXRpb25PZmZzZXRzOiBbTnVtYmVyIV1cXG59XFxuaW5wdXQgQXJnc0lucHV0XzM2IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzcge1xcblxcdGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ29tcGxldGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlciFcXG5cXHRvY2N1cnJlbmNlRGF0ZTogU3RyaW5nIVxcblxcdGR1cmF0aW9uTWludXRlczogTnVtYmVyXFxuXFx0bm90ZXM6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzgge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zOSB7XFxuXFx0aW5wdXQ6IExvZ1RpbWVJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBMb2dUaW1lSW5wdXRJbnB1dCB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyIVxcblxcdGR1cmF0aW9uTWludXRlczogTnVtYmVyIVxcblxcdG9jY3VycmVuY2VEYXRlOiBTdHJpbmdcXG5cXHRub3RlczogU3RyaW5nXFxufVxcbnR5cGUgUXVlcnkge1xcbnJld2FyZERlZmluaXRpb25zKGFyZ3M6IEFyZ3NJbnB1dCEpOiBbUmV3YXJkRGVmaW5pdGlvbiFdIVxcbnJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzEhKTogUmV3YXJkRGVmaW5pdGlvblxcbnJld2FyZEludmVudG9yeShhcmdzOiBBcmdzSW5wdXRfMiEpOiBbUmV3YXJkSW52ZW50b3J5SXRlbSFdIVxcbnJld2FyZEhpc3RvcnkoYXJnczogQXJnc0lucHV0XzMhKTogW1Jld2FyZEhpc3RvcnlJdGVtIV0hXFxucmV3YXJkUnVsZXMoYXJnczogQXJnc0lucHV0XzQhKTogW1Jld2FyZFJ1bGUhXSFcXG5yZWNlbnRBc3NldHMoYXJnczogQXJnc0lucHV0XzUhKTogW1JlY2VudEFzc2V0cyFdIVxcbnJld2FyZE51ZGdlcyhfYXJnczogT2JqZWN0KTogW1Jld2FyZE51ZGdlIV0hXFxuZ29hbHMoYXJnczogQXJnc0lucHV0XzYpOiBbR29hbCFdIVxcbmdvYWwoYXJnczogQXJnc0lucHV0XzchKTogR29hbFxcbmdvYWxOdWRnZXMoYXJnczogT2JqZWN0KTogW0dvYWxOdWRnZSFdIVxcbmRhaWx5UHJvZ3Jlc3MoYXJnczogQXJnc0lucHV0XzgpOiBEYWlseVByb2dyZXNzIVxcbmdyb3VwcyhhcmdzOiBPYmplY3QpOiBbR3JvdXAhXSFcXG5ncm91cChhcmdzOiBBcmdzSW5wdXRfOSEpOiBHcm91cFxcbmFjdGl2aXRpZXMoYXJnczogT2JqZWN0KTogW0FjdGl2aXR5IV0hXFxuYWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzEwISk6IEFjdGl2aXR5XFxuYWN0aXZpdHlDb21wbGV0aW9ucyhhcmdzOiBBcmdzSW5wdXRfMTEpOiBbQWN0aXZpdHlDb21wbGV0aW9uIV0hXFxufVxcbnR5cGUgUmV3YXJkRGVmaW5pdGlvbiB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxuY2F0ZWdvcnk6IFN0cmluZ1xcbnRhZ3M6IFtTdHJpbmchXSFcXG5jb2xvcjogU3RyaW5nIVxcbmljb246IFN0cmluZ1xcbmltYWdlX2Fzc2V0X2lkOiBOdW1iZXJcXG5zdGFja2FibGU6IEJvb2xlYW4hXFxuZGVmYXVsdF9xdWFudGl0eTogTnVtYmVyIVxcbnNvcnRfb3JkZXI6IE51bWJlciFcXG5hcmNoaXZlZF9hdDogRGF0ZVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5pbWFnZV91cmw6IFN0cmluZ1xcbmltYWdlOiBSZXdhcmRJbWFnZVxcbn1cXG5cXFwiXFxcIlxcXCJcXG5OYW1lZCByZXR1cm4gc2hhcGVzIHNvIFB5bG9uIGVtaXRzIEdyYXBoUUwgb2JqZWN0IHR5cGVzIChub3QgYEFueSFgKS5cXG5cXFwiXFxcIlxcXCJcXG50eXBlIFJld2FyZEltYWdlIHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5zaGEyNTY6IFN0cmluZyFcXG5jb250ZW50X3R5cGU6IFN0cmluZyFcXG5ieXRlX3NpemU6IE51bWJlciFcXG5zdG9yYWdlX2tleTogU3RyaW5nIVxcbnJlZl9jb3VudDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxub3JwaGFuZWRfYXQ6IERhdGVcXG51cmw6IFN0cmluZyFcXG59XFxudHlwZSBSZXdhcmRJbnZlbnRvcnlJdGVtIHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5yZXdhcmRfZGVmaW5pdGlvbl9pZDogTnVtYmVyIVxcbnF1YW50aXR5OiBOdW1iZXIhXFxuc3RhY2tfa2V5OiBTdHJpbmdcXG5maXJzdF9lYXJuZWRfYXQ6IERhdGUhXFxubGFzdF9lYXJuZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5kZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uXFxufVxcbnR5cGUgUmV3YXJkSGlzdG9yeUl0ZW0ge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbnR5cGU6IFN0cmluZyFcXG5yZXdhcmRfZGVmaW5pdGlvbl9pZDogTnVtYmVyXFxuaW52ZW50b3J5X2lkOiBOdW1iZXJcXG5xdWFudGl0eTogTnVtYmVyIVxcbmRlZmluaXRpb25fbmFtZTogU3RyaW5nIVxcbmRlZmluaXRpb25fY29sb3I6IFN0cmluZyFcXG5kZWZpbml0aW9uX2ljb246IFN0cmluZ1xcbmltYWdlX2Fzc2V0X2lkOiBOdW1iZXJcXG5zb3VyY2VfdHlwZTogU3RyaW5nXFxuc291cmNlX2lkOiBOdW1iZXJcXG50cmlnZ2VyX2tleTogU3RyaW5nXFxucnVsZV9pZDogTnVtYmVyXFxuYWN0aXZpdHlfaWQ6IE51bWJlclxcbmdvYWxfaWQ6IE51bWJlclxcbmNvbXBsZXRpb25faWQ6IE51bWJlclxcbmN5Y2xlX2lkOiBOdW1iZXJcXG5ub3RlOiBTdHJpbmdcXG5tZXRhZGF0YTogT2JqZWN0XFxuY3JlYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBSZXdhcmRSdWxlIHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5zb3VyY2VfdHlwZTogU3RyaW5nIVxcbnNvdXJjZV9pZDogTnVtYmVyIVxcbnJld2FyZF9kZWZpbml0aW9uX2lkOiBOdW1iZXIhXFxucXVhbnRpdHk6IE51bWJlciFcXG5tb2RlOiBTdHJpbmchXFxuY29uZmlnOiBSZXdhcmRSdWxlQ29uZmlnIVxcbmVuYWJsZWQ6IEJvb2xlYW4hXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbmRlZmluaXRpb246IFJld2FyZERlZmluaXRpb25cXG59XFxudHlwZSBSZXdhcmRSdWxlQ29uZmlnIHtcXG5vbmNlOiBCb29sZWFuXFxuY29vbGRvd25faG91cnM6IE51bWJlclxcbm1heF9ncmFudHNfdG90YWw6IE51bWJlclxcbm1heF9ncmFudHNfcGVyX3BlcmlvZDogTnVtYmVyXFxucGVyaW9kX2hvdXJzOiBOdW1iZXJcXG5wcm9iYWJpbGl0eTogTnVtYmVyXFxuXFxcIlxcXCJcXFwiXFxuUG9vbCBvZiBkZWZpbml0aW9uIGlkcyBmb3IgcmFuZG9tX3Bvb2wgbW9kZS5cXG5cXFwiXFxcIlxcXCJcXG5wb29sOiBbUG9vbCFdXFxufVxcbnR5cGUgUG9vbCB7XFxuZGVmaW5pdGlvbl9pZDogTnVtYmVyIVxcbndlaWdodDogTnVtYmVyXFxucXVhbnRpdHk6IE51bWJlclxcbn1cXG50eXBlIFJlY2VudEFzc2V0cyB7XFxudXJsOiBTdHJpbmchXFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxuc2hhMjU2OiBTdHJpbmchXFxuY29udGVudF90eXBlOiBTdHJpbmchXFxuYnl0ZV9zaXplOiBOdW1iZXIhXFxuc3RvcmFnZV9rZXk6IFN0cmluZyFcXG5yZWZfY291bnQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbm9ycGhhbmVkX2F0OiBEYXRlXFxufVxcbnR5cGUgUmV3YXJkTnVkZ2Uge1xcbmtpbmQ6IFJld2FyZE51ZGdlS2luZCFcXG50aXRsZTogU3RyaW5nIVxcbm1lc3NhZ2U6IFN0cmluZyFcXG5zZXZlcml0eTogSU5GT19TVUNDRVNTIVxcbmRlZmluaXRpb25JZDogTnVtYmVyXFxuaW52ZW50b3J5SWQ6IE51bWJlclxcbn1cXG50eXBlIEdvYWwge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNvbG9yOiBTdHJpbmchXFxuaWNvbjogU3RyaW5nXFxucnVsZV90eXBlOiBTdHJpbmchXFxubWV0cmljOiBTdHJpbmchXFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuY29uZmlnOiBHb2FsQ29uZmlnIVxcbnN0YXR1czogU3RyaW5nIVxcbnJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlQ29uZmlnXFxuZGVhZGxpbmU6IEdvYWxEZWFkbGluZUNvbmZpZ1xcbnByaW9yaXR5OiBOdW1iZXIhXFxuc29ydF9vcmRlcjogTnVtYmVyIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuc3RhcnRzQXQ6IFN0cmluZyFcXG5saWZlY3ljbGVQaGFzZTogR29hbExpZmVjeWNsZVBoYXNlIVxcbmxpbmtzOiBbR29hbExpbmshXSFcXG5hY3RpdmVDeWNsZTogQWN0aXZlQ3ljbGVcXG5jeWNsZXM6IFtHb2FsQ3ljbGVWaWV3IV0hXFxuZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3khXSFcXG5zbmFwc2hvdHM6IFtHb2FsU25hcHNob3QhXSFcXG5pc0xvY2tlZDogQm9vbGVhbiFcXG59XFxudHlwZSBHb2FsQ29uZmlnIHtcXG5jb21wb3NpdGVfbW9kZTogQUxMX0FOWV9XRUlHSFRFRFxcbmNvdW50X3JlcXVpcmVkOiBOdW1iZXJcXG5iZWZvcmVfdGltZTogU3RyaW5nXFxuYWZ0ZXJfdGltZTogU3RyaW5nXFxuYmxvY2tfdW50aWxfdW5sb2NrZWQ6IEJvb2xlYW5cXG59XFxudHlwZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XFxucGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIVxcbmludGVydmFsOiBOdW1iZXJcXG5hbmNob3I6IFN0cmluZ1xcbmNhcnJ5X292ZXI6IE5PTkVfT1ZFUkZMT1dcXG5yZXNldDogU3RyaW5nXFxufVxcbnR5cGUgR29hbERlYWRsaW5lQ29uZmlnIHtcXG5raW5kOiBBQlNPTFVURV9SRUxBVElWRSFcXG5kYXRlOiBTdHJpbmdcXG5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBOdW1iZXJcXG5ncmFjZV9kYXlzOiBOdW1iZXJcXG53YXJuX2RheXM6IE51bWJlclxcbn1cXG50eXBlIEdvYWxMaW5rIHtcXG5pZDogTnVtYmVyIVxcbmdvYWxfaWQ6IE51bWJlciFcXG5saW5rX3R5cGU6IFN0cmluZyFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxuZ3JvdXBfaWQ6IE51bWJlclxcbndlaWdodDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHk6IExpbmtlZEFjdGl2aXR5XFxuZ3JvdXA6IExpbmtlZEdyb3VwXFxufVxcblxcXCJcXFwiXFxcIlxcbk5hbWVkIHJldHVybiBzaGFwZXMgc28gUHlsb24gZW1pdHMgR3JhcGhRTCBvYmplY3QgdHlwZXMgKG5vdCBgQW55IWApLlxcblxcXCJcXFwiXFxcIlxcbnR5cGUgTGlua2VkQWN0aXZpdHkge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbmdyb3VwX2lkOiBOdW1iZXJcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5zdGFydF90aW1lOiBTdHJpbmchXFxuZW5kX3RpbWU6IFN0cmluZyFcXG5pc19yZWN1cnJpbmc6IEJvb2xlYW4hXFxuZGF0ZTogU3RyaW5nXFxubm90aWZpY2F0aW9uX29mZnNldHM6IFtOdW1iZXIhXSFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgTGlua2VkR3JvdXAge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5jb2xvcjogU3RyaW5nIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBBY3RpdmVDeWNsZSB7XFxuZGVhZGxpbmVTdGF0ZTogRGVhZGxpbmVTdGF0ZSFcXG5wZXJjZW50Q29tcGxldGU6IE51bWJlciFcXG5yZW1haW5pbmc6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmdvYWxfaWQ6IE51bWJlciFcXG5jeWNsZV9pbmRleDogTnVtYmVyIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5lbmRzX2F0OiBEYXRlXFxuZGVhZGxpbmVfYXQ6IERhdGVcXG50YXJnZXRfdmFsdWU6IE51bWJlciFcXG5jdXJyZW50X3ZhbHVlOiBOdW1iZXIhXFxuc3RhdHVzOiBTdHJpbmchXFxuY2Fycnlfb3ZlcjogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsQ3ljbGVWaWV3IHtcXG5pZDogTnVtYmVyIVxcbmdvYWxfaWQ6IE51bWJlciFcXG5jeWNsZV9pbmRleDogTnVtYmVyIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5lbmRzX2F0OiBEYXRlXFxuZGVhZGxpbmVfYXQ6IERhdGVcXG50YXJnZXRfdmFsdWU6IE51bWJlciFcXG5jdXJyZW50X3ZhbHVlOiBOdW1iZXIhXFxuc3RhdHVzOiBTdHJpbmchXFxuY2Fycnlfb3ZlcjogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsRGVwZW5kZW5jeSB7XFxuaWQ6IE51bWJlciFcXG5nb2FsX2lkOiBOdW1iZXIhXFxuZGVwZW5kc19vbl9nb2FsX2lkOiBOdW1iZXIhXFxucmVxdWlyZW1lbnQ6IFN0cmluZyFcXG50aHJlc2hvbGQ6IE51bWJlclxcbndlaWdodDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZGVwZW5kc09uOiBHb2FsXFxufVxcbnR5cGUgR29hbFNuYXBzaG90IHtcXG5pZDogTnVtYmVyIVxcbmdvYWxfY3ljbGVfaWQ6IE51bWJlciFcXG5hc19vZjogU3RyaW5nIVxcbnZhbHVlOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsTnVkZ2Uge1xcbmtpbmQ6IEdvYWxOdWRnZUtpbmQhXFxuZ29hbElkOiBOdW1iZXIhXFxudGl0bGU6IFN0cmluZyFcXG5tZXNzYWdlOiBTdHJpbmchXFxuc2V2ZXJpdHk6IElORk9fU1VDQ0VTU19XQVJOSU5HIVxcbn1cXG50eXBlIERhaWx5UHJvZ3Jlc3Mge1xcbmRhdGU6IFN0cmluZyFcXG5jb21wbGV0ZWRDb3VudDogTnVtYmVyIVxcbm1pbnV0ZXNUb2RheTogTnVtYmVyIVxcbnN0cmVha0RheXM6IE51bWJlciFcXG5jb21wbGV0aW9uczogW0FjdGl2aXR5Q29tcGxldGlvblJvdyFdIVxcbn1cXG50eXBlIEFjdGl2aXR5Q29tcGxldGlvblJvdyB7XFxuaWQ6IE51bWJlciFcXG5hY3Rpdml0eV9pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXFxufVxcbnR5cGUgTWV0YWRhdGEge1xcbnRpdGxlOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxudHJpZ2dlcl9ldmVudHM6IFtTdHJpbmchXVxcbn1cXG50eXBlIEdyb3VwIHtcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgQWN0aXZpdHkge1xcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbmdyb3VwX2lkOiBOdW1iZXJcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5zdGFydF90aW1lOiBTdHJpbmchXFxuZW5kX3RpbWU6IFN0cmluZyFcXG5pc19yZWN1cnJpbmc6IEJvb2xlYW4hXFxuZGF0ZTogU3RyaW5nXFxubm90aWZpY2F0aW9uX29mZnNldHM6IFtOdW1iZXIhXSFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxucmVjdXJyZW5jZVBhdHRlcm46IFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuXFxuZ3JvdXA6IEdyb3VwXFxufVxcbnR5cGUgUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4ge1xcbmNvbmZpZzogUmVjdXJyZW5jZUNvbmZpZyFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5hY3Rpdml0eV9pZDogTnVtYmVyIVxcbnJlY3VycmVuY2VfdHlwZTogV0VFS0xZX01PTlRITFlfRVZFUllfWF9EQVlTIVxcbn1cXG50eXBlIFJlY3VycmVuY2VDb25maWcge1xcbmRheXNfb2Zfd2VlazogW051bWJlciFdXFxuZGF5c19vZl9tb250aDogW051bWJlciFdXFxuaXNfbGFzdF9kYXlfb2ZfbW9udGg6IEJvb2xlYW5cXG5pbnRlcnZhbF9kYXlzOiBOdW1iZXJcXG5zdGFydF9kYXRlOiBTdHJpbmchXFxuZW5kX2RhdGU6IFN0cmluZ1xcbn1cXG50eXBlIEFjdGl2aXR5Q29tcGxldGlvbiB7XFxuaWQ6IE51bWJlciFcXG5hY3Rpdml0eV9pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXzFcXG59XFxudHlwZSBNZXRhZGF0YV8xIHtcXG50aXRsZTogU3RyaW5nXFxubm90ZXM6IFN0cmluZ1xcbnRyaWdnZXJfZXZlbnRzOiBbU3RyaW5nIV1cXG59XFxudHlwZSBNdXRhdGlvbiB7XFxucmVnaXN0ZXJEZXZpY2VUb2tlbihhcmdzOiBBcmdzSW5wdXRfMTIhKTogQm9vbGVhbiFcXG51bnJlZ2lzdGVyRGV2aWNlVG9rZW4oYXJnczogQXJnc0lucHV0XzEzISk6IEJvb2xlYW4hXFxuY3JlYXRlUmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMTQhKTogUmV3YXJkRGVmaW5pdGlvbiFcXG51cGRhdGVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNSEpOiBSZXdhcmREZWZpbml0aW9uIVxcbmFyY2hpdmVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNiEpOiBSZXdhcmREZWZpbml0aW9uIVxcbnVuYXJjaGl2ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE3ISk6IFJld2FyZERlZmluaXRpb24hXFxuZGVsZXRlUmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMTghKTogQm9vbGVhbiFcXG5hdHRhY2hSZXdhcmRSdWxlKGFyZ3M6IEFyZ3NJbnB1dF8xOSEpOiBSZXdhcmRSdWxlIVxcbmRldGFjaFJld2FyZFJ1bGUoYXJnczogQXJnc0lucHV0XzIwISk6IEJvb2xlYW4hXFxuY29uc3VtZVJld2FyZChhcmdzOiBBcmdzSW5wdXRfMjEhKTogQ29uc3VtZVJld2FyZCFcXG5kaXNjYXJkUmV3YXJkKGFyZ3M6IEFyZ3NJbnB1dF8yMiEpOiBEaXNjYXJkUmV3YXJkIVxcbnJlc3RvcmVSZXdhcmQoYXJnczogQXJnc0lucHV0XzIzISk6IFJlc3RvcmVSZXdhcmQhXFxubWFudWFsR3JhbnRSZXdhcmQoYXJnczogQXJnc0lucHV0XzI0ISk6IFJld2FyZEhpc3RvcnlJdGVtXFxucmVjb21wdXRlUmV3YXJkSW52ZW50b3J5OiBCb29sZWFuIVxcbmNyZWF0ZUdvYWwoYXJnczogQXJnc0lucHV0XzI1ISk6IEdvYWwhXFxudXBkYXRlR29hbChhcmdzOiBBcmdzSW5wdXRfMjYhKTogR29hbCFcXG5wYXVzZUdvYWwoYXJnczogQXJnc0lucHV0XzI3ISk6IEdvYWwhXFxucmVzdW1lR29hbChhcmdzOiBBcmdzSW5wdXRfMjghKTogR29hbCFcXG5hcmNoaXZlR29hbChhcmdzOiBBcmdzSW5wdXRfMjkhKTogR29hbCFcXG5kZWxldGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8zMCEpOiBCb29sZWFuIVxcbnJlY29tcHV0ZUdvYWxQcm9ncmVzcyhhcmdzOiBPYmplY3QpOiBSZWNvbXB1dGVHb2FsUHJvZ3Jlc3MhXFxuY3JlYXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzMxISk6IEdyb3VwIVxcbnVwZGF0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8zMiEpOiBHcm91cCFcXG5kZWxldGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMzMhKTogQm9vbGVhbiFcXG5jcmVhdGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzQhKTogQWN0aXZpdHkhXFxudXBkYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzM1ISk6IEFjdGl2aXR5IVxcbmRlbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8zNiEpOiBCb29sZWFuIVxcbmNvbXBsZXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzM3ISk6IENvbXBsZXRlQWN0aXZpdHlSZXN1bHQhXFxudW5kb0NvbXBsZXRpb24oYXJnczogQXJnc0lucHV0XzM4ISk6IEJvb2xlYW4hXFxubG9nVGltZShhcmdzOiBBcmdzSW5wdXRfMzkhKTogTG9nVGltZVJlc3VsdCFcXG59XFxudHlwZSBDb25zdW1lUmV3YXJkIHtcXG5pbnZlbnRvcnk6IFJld2FyZEludmVudG9yeUl0ZW1cXG50cmFuc2FjdGlvbjogUmV3YXJkSGlzdG9yeUl0ZW0hXFxufVxcbnR5cGUgRGlzY2FyZFJld2FyZCB7XFxuaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlJdGVtXFxudHJhbnNhY3Rpb246IFJld2FyZEhpc3RvcnlJdGVtIVxcbn1cXG50eXBlIFJlc3RvcmVSZXdhcmQge1xcbmludmVudG9yeTogUmV3YXJkSW52ZW50b3J5SXRlbSFcXG50cmFuc2FjdGlvbjogUmV3YXJkSGlzdG9yeUl0ZW0hXFxufVxcbnR5cGUgUmVjb21wdXRlR29hbFByb2dyZXNzIHtcXG5yZWNvbXB1dGVkOiBOdW1iZXIhXFxufVxcbnR5cGUgQ29tcGxldGVBY3Rpdml0eVJlc3VsdCB7XFxuZ3JhbnRlZFJld2FyZHM6IFtPYmplY3RdIVxcbmlkOiBOdW1iZXIhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxub2NjdXJyZW5jZV9kYXRlOiBTdHJpbmchXFxuZHVyYXRpb25fbWludXRlczogTnVtYmVyXFxuY29tcGxldGVkX2F0OiBEYXRlIVxcbm1ldGFkYXRhOiBNZXRhZGF0YV8xXFxufVxcbnR5cGUgTG9nVGltZVJlc3VsdCB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxuc291cmNlX3R5cGU6IFN0cmluZyFcXG5hY3Rpdml0eV9pZDogTnVtYmVyXFxuZ3JvdXBfaWQ6IE51bWJlclxcbmNvbXBsZXRpb25faWQ6IE51bWJlclxcbm9jY3VycmVkX2F0OiBEYXRlIVxcbm9jY3VycmVuY2VfZGF0ZTogU3RyaW5nXFxubWV0cmljOiBTdHJpbmchXFxuYW1vdW50OiBOdW1iZXIhXFxubWV0YWRhdGE6IE9iamVjdFxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gUmV3YXJkTnVkZ2VLaW5kIHtcXG5cXHRpbnZlbnRvcnlfYXZhaWxhYmxlXFxuXFx0cmVjZW50bHlfZWFybmVkXFxuXFx0dW5jb25zdW1lZF9zdGFja1xcbn1cXG5lbnVtIElORk9fU1VDQ0VTUyB7XFxuXFx0aW5mb1xcblxcdHN1Y2Nlc3NcXG59XFxuZW51bSBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xcblxcdHNjaGVkdWxlZFxcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRCB7XFxuXFx0YWxsXFxuXFx0YW55XFxuXFx0d2VpZ2h0ZWRcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPVyB7XFxuXFx0bm9uZVxcblxcdG92ZXJmbG93XFxufVxcbmVudW0gQUJTT0xVVEVfUkVMQVRJVkUge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBEZWFkbGluZVN0YXRlIHtcXG5cXHRmYWlsZWRcXG5cXHRvbl90cmFja1xcblxcdGFwcHJvYWNoaW5nXFxuXFx0b3ZlcmR1ZVxcbn1cXG5lbnVtIEdvYWxOdWRnZUtpbmQge1xcblxcdGRlYWRsaW5lX2FwcHJvYWNoaW5nXFxuXFx0ZGVhZGxpbmVfb3ZlcmR1ZVxcblxcdGJlaGluZF9wYWNlXFxuXFx0Y3ljbGVfY29tcGxldGVcXG5cXHRkZXBlbmRlbmN5X3VubG9ja2VkXFxuXFx0Z29hbF9zdGFydGluZ19zb29uXFxufVxcbmVudW0gSU5GT19TVUNDRVNTX1dBUk5JTkcge1xcblxcdGluZm9cXG5cXHRzdWNjZXNzXFxuXFx0d2FybmluZ1xcbn1cXG5lbnVtIFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5lbnVtIFJFQ0VOVF9OQU1FX1FVQU5USVRZSW5wdXQge1xcblxcdHJlY2VudFxcblxcdG5hbWVcXG5cXHRxdWFudGl0eVxcbn1cXG5lbnVtIEZJWEVEX1BST0JBQklMSVRZX1JBTkRPTV9QT09MSW5wdXQge1xcblxcdGZpeGVkXFxuXFx0cHJvYmFiaWxpdHlcXG5cXHRyYW5kb21fcG9vbFxcbn1cXG5lbnVtIENPVU5UX0RVUkFUSU9OSW5wdXQge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBBTExfQU5ZX1dFSUdIVEVESW5wdXQge1xcblxcdGFsbFxcblxcdGFueVxcblxcdHdlaWdodGVkXFxufVxcbmVudW0gQUNUSVZJVFlfR1JPVVBJbnB1dCB7XFxuXFx0YWN0aXZpdHlcXG5cXHRncm91cFxcbn1cXG5lbnVtIENPTVBMRVRFX1BST0dSRVNTSW5wdXQge1xcblxcdGNvbXBsZXRlXFxuXFx0cHJvZ3Jlc3NcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRxdWFydGVybHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBOT05FX09WRVJGTE9XSW5wdXQge1xcblxcdG5vbmVcXG5cXHRvdmVyZmxvd1xcbn1cXG5lbnVtIEFCU09MVVRFX1JFTEFUSVZFSW5wdXQge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dCB7XFxuXFx0YWN0aXZlXFxuXFx0cGF1c2VkXFxuXFx0Y29tcGxldGVkXFxuXFx0YXJjaGl2ZWRcXG5cXHRmYWlsZWRcXG59XFxuZW51bSBSZWN1cnJlbmNlVHlwZUlucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHR5cGUgeyBQdXNoUGF5bG9hZCwgUHVzaFNlbmRlciwgU2VuZFRvVG9rZW5zUmVzdWx0IH0gZnJvbSAnLi90eXBlcy50cydcblxuLyoqIE5vLW9wIHNlbmRlciB1c2VkIHdoZW4gRmlyZWJhc2UgY3JlZGVudGlhbHMgYXJlIG5vdCBjb25maWd1cmVkLiAqL1xuZXhwb3J0IGNsYXNzIE5vT3BQdXNoU2VuZGVyIGltcGxlbWVudHMgUHVzaFNlbmRlciB7XG4gIGFzeW5jIHNlbmRUb1Rva2VucyhcbiAgICBfdG9rZW5zOiBzdHJpbmdbXSxcbiAgICBfcGF5bG9hZDogUHVzaFBheWxvYWQsXG4gICk6IFByb21pc2U8U2VuZFRvVG9rZW5zUmVzdWx0PiB7XG4gICAgcmV0dXJuIHsgc3VjY2Vzc0NvdW50OiAwLCBpbnZhbGlkVG9rZW5zOiBbXSB9XG4gIH1cbn1cbiIsICIvKiogUmVhZCBhbiBlbnYgdmFyIGZyb20gTm9kZSBgcHJvY2Vzcy5lbnZgIG9yIERlbm8uICovXG5leHBvcnQgZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIERlbm8uZW52LmdldChuYW1lKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBlbnYgfSBmcm9tICcuLi9kYi9lbnYudHMnXG5pbXBvcnQgeyBOb09wUHVzaFNlbmRlciB9IGZyb20gJy4vbm9vcF9zZW5kZXIudHMnXG5pbXBvcnQgdHlwZSB7IFB1c2hQYXlsb2FkLCBQdXNoU2VuZGVyLCBTZW5kVG9Ub2tlbnNSZXN1bHQgfSBmcm9tICcuL3R5cGVzLnRzJ1xuXG5hc3luYyBmdW5jdGlvbiByZWFkVGV4dEZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgaWYgKHR5cGVvZiBEZW5vICE9PSAndW5kZWZpbmVkJyAmJiB0eXBlb2YgRGVuby5yZWFkVGV4dEZpbGUgPT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gYXdhaXQgRGVuby5yZWFkVGV4dEZpbGUocGF0aClcbiAgfVxuICBjb25zdCB7IHJlYWRGaWxlIH0gPSBhd2FpdCBpbXBvcnQoJ25vZGU6ZnMvcHJvbWlzZXMnKVxuICByZXR1cm4gYXdhaXQgcmVhZEZpbGUocGF0aCwgJ3V0ZjgnKVxufVxuXG50eXBlIFNlcnZpY2VBY2NvdW50ID0ge1xuICBwcm9qZWN0X2lkOiBzdHJpbmdcbiAgY2xpZW50X2VtYWlsOiBzdHJpbmdcbiAgcHJpdmF0ZV9rZXk6IHN0cmluZ1xuICBba2V5OiBzdHJpbmddOiB1bmtub3duXG59XG5cbnR5cGUgTWVzc2FnaW5nID0ge1xuICBzZW5kRWFjaEZvck11bHRpY2FzdDogKG1lc3NhZ2U6IHtcbiAgICB0b2tlbnM6IHN0cmluZ1tdXG4gICAgbm90aWZpY2F0aW9uOiB7IHRpdGxlOiBzdHJpbmc7IGJvZHk6IHN0cmluZyB9XG4gICAgZGF0YT86IFJlY29yZDxzdHJpbmcsIHN0cmluZz5cbiAgfSkgPT4gUHJvbWlzZTx7XG4gICAgc3VjY2Vzc0NvdW50OiBudW1iZXJcbiAgICByZXNwb25zZXM6IEFycmF5PHsgc3VjY2VzczogYm9vbGVhbjsgZXJyb3I/OiB7IGNvZGU/OiBzdHJpbmcgfSB9PlxuICB9PlxufVxuXG50eXBlIEZpcmViYXNlQWRtaW5Nb2R1bGUgPSB7XG4gIGFwcHM6IHVua25vd25bXVxuICBpbml0aWFsaXplQXBwOiAob3B0aW9uczoge1xuICAgIGNyZWRlbnRpYWw6IHVua25vd25cbiAgfSkgPT4gdW5rbm93blxuICBjcmVkZW50aWFsOiB7XG4gICAgY2VydDogKHNlcnZpY2VBY2NvdW50OiBTZXJ2aWNlQWNjb3VudCkgPT4gdW5rbm93blxuICB9XG4gIG1lc3NhZ2luZzogKCkgPT4gTWVzc2FnaW5nXG59XG5cbmNvbnN0IElOVkFMSURfVE9LRU5fQ09ERVMgPSBuZXcgU2V0KFtcbiAgJ21lc3NhZ2luZy9pbnZhbGlkLXJlZ2lzdHJhdGlvbi10b2tlbicsXG4gICdtZXNzYWdpbmcvcmVnaXN0cmF0aW9uLXRva2VuLW5vdC1yZWdpc3RlcmVkJyxcbl0pXG5cbi8qKlxuICogRmlyZWJhc2UgQ2xvdWQgTWVzc2FnaW5nIHNlbmRlciB2aWEgZmlyZWJhc2UtYWRtaW4uXG4gKlxuICogUHJlZmVyIGNvbnN0cnVjdGluZyB0aHJvdWdoIHtAbGluayBjcmVhdGVQdXNoU2VuZGVyRnJvbUVudn0gc28gbWlzc2luZ1xuICogY3JlZGVudGlhbHMgZGVncmFkZSB0byBhIG5vLW9wIGluc3RlYWQgb2YgY3Jhc2hpbmcgdGhlIEFQSS5cbiAqL1xuZXhwb3J0IGNsYXNzIEZpcmViYXNlUHVzaFNlbmRlciBpbXBsZW1lbnRzIFB1c2hTZW5kZXIge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG1lc3NhZ2luZzogTWVzc2FnaW5nKSB7fVxuXG4gIGFzeW5jIHNlbmRUb1Rva2VucyhcbiAgICB0b2tlbnM6IHN0cmluZ1tdLFxuICAgIHBheWxvYWQ6IFB1c2hQYXlsb2FkLFxuICApOiBQcm9taXNlPFNlbmRUb1Rva2Vuc1Jlc3VsdD4ge1xuICAgIGlmICh0b2tlbnMubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4geyBzdWNjZXNzQ291bnQ6IDAsIGludmFsaWRUb2tlbnM6IFtdIH1cbiAgICB9XG5cbiAgICBjb25zdCBpbnZhbGlkVG9rZW5zOiBzdHJpbmdbXSA9IFtdXG4gICAgbGV0IHN1Y2Nlc3NDb3VudCA9IDBcblxuICAgIC8vIEZDTSBtdWx0aWNhc3Qgc3VwcG9ydHMgdXAgdG8gNTAwIHRva2VucyBwZXIgcmVxdWVzdC5cbiAgICBjb25zdCBjaHVua1NpemUgPSA1MDBcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRva2Vucy5sZW5ndGg7IGkgKz0gY2h1bmtTaXplKSB7XG4gICAgICBjb25zdCBjaHVuayA9IHRva2Vucy5zbGljZShpLCBpICsgY2h1bmtTaXplKVxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5tZXNzYWdpbmcuc2VuZEVhY2hGb3JNdWx0aWNhc3Qoe1xuICAgICAgICB0b2tlbnM6IGNodW5rLFxuICAgICAgICBub3RpZmljYXRpb246IHtcbiAgICAgICAgICB0aXRsZTogcGF5bG9hZC50aXRsZSxcbiAgICAgICAgICBib2R5OiBwYXlsb2FkLmJvZHksXG4gICAgICAgIH0sXG4gICAgICAgIGRhdGE6IHBheWxvYWQuZGF0YSxcbiAgICAgIH0pXG4gICAgICBzdWNjZXNzQ291bnQgKz0gcmVzdWx0LnN1Y2Nlc3NDb3VudFxuICAgICAgcmVzdWx0LnJlc3BvbnNlcy5mb3JFYWNoKChyZXNwb25zZSwgaW5kZXgpID0+IHtcbiAgICAgICAgaWYgKHJlc3BvbnNlLnN1Y2Nlc3MpIHJldHVyblxuICAgICAgICBjb25zdCBjb2RlID0gcmVzcG9uc2UuZXJyb3I/LmNvZGVcbiAgICAgICAgaWYgKGNvZGUgJiYgSU5WQUxJRF9UT0tFTl9DT0RFUy5oYXMoY29kZSkpIHtcbiAgICAgICAgICBpbnZhbGlkVG9rZW5zLnB1c2goY2h1bmtbaW5kZXhdISlcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4geyBzdWNjZXNzQ291bnQsIGludmFsaWRUb2tlbnMgfVxuICB9XG59XG5cbmZ1bmN0aW9uIHBhcnNlU2VydmljZUFjY291bnRKc29uKHJhdzogc3RyaW5nKTogU2VydmljZUFjY291bnQge1xuICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdykgYXMgU2VydmljZUFjY291bnRcbiAgaWYgKFxuICAgIHR5cGVvZiBwYXJzZWQucHJvamVjdF9pZCAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgcGFyc2VkLmNsaWVudF9lbWFpbCAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgcGFyc2VkLnByaXZhdGVfa2V5ICE9PSAnc3RyaW5nJ1xuICApIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAnRmlyZWJhc2Ugc2VydmljZSBhY2NvdW50IEpTT04gbXVzdCBpbmNsdWRlIHByb2plY3RfaWQsIGNsaWVudF9lbWFpbCwgcHJpdmF0ZV9rZXknLFxuICAgIClcbiAgfVxuICAvLyBQcml2YXRlIGtleXMgaW4gZW52IHZhcnMgb2Z0ZW4gaGF2ZSBlc2NhcGVkIG5ld2xpbmVzLlxuICBwYXJzZWQucHJpdmF0ZV9rZXkgPSBwYXJzZWQucHJpdmF0ZV9rZXkucmVwbGFjZSgvXFxcXG4vZywgJ1xcbicpXG4gIHJldHVybiBwYXJzZWRcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZFNlcnZpY2VBY2NvdW50KCk6IFByb21pc2U8U2VydmljZUFjY291bnQgfCBudWxsPiB7XG4gIGNvbnN0IGpzb24gPSBlbnYoJ0ZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9KU09OJylcbiAgaWYgKGpzb24gJiYganNvbi50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIHJldHVybiBwYXJzZVNlcnZpY2VBY2NvdW50SnNvbihqc29uKVxuICB9XG5cbiAgY29uc3QgcGF0aCA9IGVudignRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX1BBVEgnKVxuICBpZiAocGF0aCAmJiBwYXRoLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgY29uc3QgdGV4dCA9IGF3YWl0IHJlYWRUZXh0RmlsZShwYXRoKVxuICAgIHJldHVybiBwYXJzZVNlcnZpY2VBY2NvdW50SnNvbih0ZXh0KVxuICB9XG5cbiAgcmV0dXJuIG51bGxcbn1cblxuYXN5bmMgZnVuY3Rpb24gbG9hZEZpcmViYXNlQWRtaW4oKTogUHJvbWlzZTxGaXJlYmFzZUFkbWluTW9kdWxlPiB7XG4gIC8vIER5bmFtaWMgaW1wb3J0IGtlZXBzIHRoZSBraXQgaW1wb3J0YWJsZSBpbiB1bml0IHRlc3RzIHdpdGhvdXQgcmVzb2x2aW5nXG4gIC8vIGZpcmViYXNlLWFkbWluIHVubGVzcyBhIHJlYWwgc2VuZGVyIGlzIGNvbnN0cnVjdGVkLlxuICAvLyBCdW4vTm9kZSBDSlMgaW50ZXJvcCBvZnRlbiBleHBvc2VzIHRoZSBTREsgb24gYGRlZmF1bHRgLlxuICBjb25zdCBtb2QgPSBhd2FpdCBpbXBvcnQoJ2ZpcmViYXNlLWFkbWluJykgYXMge1xuICAgIGRlZmF1bHQ/OiBGaXJlYmFzZUFkbWluTW9kdWxlXG4gIH0gJiBGaXJlYmFzZUFkbWluTW9kdWxlXG4gIHJldHVybiBtb2QuZGVmYXVsdCA/PyBtb2Rcbn1cblxuLyoqXG4gKiBCdWlsZHMgYSB7QGxpbmsgUHVzaFNlbmRlcn0gZnJvbSBlbnYuXG4gKlxuICogLSBgRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX0pTT05gIFx1MjAxNCByYXcgc2VydmljZS1hY2NvdW50IEpTT04gc3RyaW5nXG4gKiAtIGBGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfUEFUSGAgXHUyMDE0IHBhdGggdG8gYSBzZXJ2aWNlLWFjY291bnQgSlNPTiBmaWxlXG4gKlxuICogV2hlbiBuZWl0aGVyIGlzIHNldCAob3IgaW5pdCBmYWlscyksIHJldHVybnMge0BsaW5rIE5vT3BQdXNoU2VuZGVyfS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52KCk6IFByb21pc2U8UHVzaFNlbmRlcj4ge1xuICB0cnkge1xuICAgIGNvbnN0IGFjY291bnQgPSBhd2FpdCBsb2FkU2VydmljZUFjY291bnQoKVxuICAgIGlmICghYWNjb3VudCkge1xuICAgICAgY29uc29sZS5pbmZvKFxuICAgICAgICAnW3B1c2hdIEZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9KU09OL1BBVEggdW5zZXQ7IHVzaW5nIG5vLW9wIHNlbmRlcicsXG4gICAgICApXG4gICAgICByZXR1cm4gbmV3IE5vT3BQdXNoU2VuZGVyKClcbiAgICB9XG5cbiAgICBjb25zdCBhZG1pbiA9IGF3YWl0IGxvYWRGaXJlYmFzZUFkbWluKClcbiAgICBpZiAoYWRtaW4uYXBwcy5sZW5ndGggPT09IDApIHtcbiAgICAgIGFkbWluLmluaXRpYWxpemVBcHAoe1xuICAgICAgICBjcmVkZW50aWFsOiBhZG1pbi5jcmVkZW50aWFsLmNlcnQoYWNjb3VudCksXG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgRmlyZWJhc2VQdXNoU2VuZGVyKGFkbWluLm1lc3NhZ2luZygpKVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICBjb25zb2xlLmVycm9yKCdbcHVzaF0gZmFpbGVkIHRvIGluaXQgRmlyZWJhc2Ugc2VuZGVyOyB1c2luZyBuby1vcCcsIGVycilcbiAgICByZXR1cm4gbmV3IE5vT3BQdXNoU2VuZGVyKClcbiAgfVxufVxuIiwgImltcG9ydCB7IE9uQ29uZmxpY3RCdWlsZGVyLCBUcmFuc2FjdGlvbiB9IGZyb20gXCJreXNlbHlcIjtcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiO1xuaW1wb3J0IHsgZGIgfSBmcm9tIFwiLi4vLi4vZGIvZGF0YWJhc2UudHNcIjtcbmltcG9ydCB0eXBlIHtcbiAgQWN0aXZpdHkgYXMgQWN0aXZpdHlSb3csXG4gIERhdGFiYXNlLFxuICBOZXdBY3Rpdml0eSxcbiAgTmV3QWN0aXZpdHlDb21wbGV0aW9uLFxuICBOZXdEZXZpY2VUb2tlbixcbiAgTmV3R29hbEV2ZW50LFxuICBOZXdHcm91cCxcbiAgTmV3UmVjdXJyZW5jZVBhdHRlcm4sXG4gIFJlY3VycmVuY2VQYXR0ZXJuIGFzIFJlY3VycmVuY2VQYXR0ZXJuUm93LFxufSBmcm9tIFwiLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzXCI7XG5pbXBvcnQge1xuICB2YWxpZGF0ZURldmljZVBsYXRmb3JtLFxuICB2YWxpZGF0ZURldmljZVRva2VuLFxufSBmcm9tIFwiLi4vLi4vcHVzaC9kZXZpY2VfdG9rZW5fdmFsaWRhdGlvbi50c1wiO1xuaW1wb3J0IHsgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMgfSBmcm9tIFwiLi4vLi4vZ29hbHMvcHJvZ3Jlc3MudHNcIjtcbmltcG9ydCB7XG4gIENvbXBsZXRlQWN0aXZpdHlJbnB1dCxcbiAgQ3JlYXRlQWN0aXZpdHlJbnB1dCxcbiAgQ3JlYXRlR3JvdXBJbnB1dCxcbiAgTG9nVGltZUlucHV0LFxuICBSZWN1cnJlbmNlQ29uZmlnLFxuICBSZWN1cnJlbmNlUGF0dGVybklucHV0LFxuICBVcGRhdGVBY3Rpdml0eUlucHV0LFxuICBVcGRhdGVHcm91cElucHV0LFxufSBmcm9tIFwiLi4vdHlwZXMudHNcIjtcbmltcG9ydCB7XG4gIEludmFsaWRDb21wbGV0aW9uRXJyb3IsXG4gIEludmFsaWRHcm91cEVycm9yLFxuICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUsXG4gIHZhbGlkYXRlRHVyYXRpb25NaW51dGVzLFxuICB2YWxpZGF0ZUdyb3VwQ29sb3IsXG4gIHZhbGlkYXRlR3JvdXBOYW1lLFxuICB2YWxpZGF0ZU9jY3VycmVuY2VEYXRlLFxuICB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24sXG59IGZyb20gXCIuLi92YWxpZGF0aW9uLnRzXCI7XG5pbXBvcnQgeyBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzIH0gZnJvbSBcIi4uL25vdGlmaWNhdGlvbl9vZmZzZXRzLnRzXCI7XG5pbXBvcnQgeyBhc051bWJlciB9IGZyb20gXCIuLi9udW1lcmljLnRzXCI7XG5pbXBvcnQgeyBHb2FsTXV0YXRpb24sIEdvYWxRdWVyeSB9IGZyb20gXCIuL2dvYWxzX3Jlc29sdmVycy50c1wiO1xuaW1wb3J0IHsgUmV3YXJkTXV0YXRpb24sIFJld2FyZFF1ZXJ5IH0gZnJvbSBcIi4vcmV3YXJkc19yZXNvbHZlcnMudHNcIjtcbmltcG9ydCB7XG4gIGdyYW50UmV3YXJkc0ZvckFjdGl2aXR5Q29tcGxldGlvbixcbn0gZnJvbSBcIi4uLy4uL3Jld2FyZHMvaG9va3MudHNcIjtcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbn0gZnJvbSBcIi4uLy4uL3Jld2FyZHMvaW52ZW50b3J5LnRzXCI7XG5cbmludGVyZmFjZSBQYXJzZWRSZWN1cnJlbmNlUGF0dGVybiBleHRlbmRzIE9taXQ8UmVjdXJyZW5jZVBhdHRlcm5Sb3csIFwiY29uZmlnXCI+IHtcbiAgY29uZmlnOiBSZWN1cnJlbmNlQ29uZmlnO1xufVxuXG4vKiogTmFtZWQgcmV0dXJuIHNoYXBlcyBzbyBQeWxvbiBlbWl0cyBHcmFwaFFMIG9iamVjdCB0eXBlcyAobm90IGBBbnkhYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIEdyb3VwIHtcbiAgaWQ6IG51bWJlcjtcbiAgdXNlcl9pZDogbnVtYmVyO1xuICBuYW1lOiBzdHJpbmc7XG4gIGNvbG9yOiBzdHJpbmc7XG4gIGNyZWF0ZWRfYXQ6IERhdGU7XG4gIHVwZGF0ZWRfYXQ6IERhdGU7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdHkge1xuICBpZDogbnVtYmVyO1xuICB1c2VyX2lkOiBudW1iZXI7XG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsO1xuICB0aXRsZTogc3RyaW5nO1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbDtcbiAgc3RhcnRfdGltZTogc3RyaW5nO1xuICBlbmRfdGltZTogc3RyaW5nO1xuICBpc19yZWN1cnJpbmc6IGJvb2xlYW47XG4gIGRhdGU6IHN0cmluZyB8IG51bGw7XG4gIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBudW1iZXJbXTtcbiAgY3JlYXRlZF9hdDogRGF0ZTtcbiAgdXBkYXRlZF9hdDogRGF0ZTtcbiAgcmVjdXJyZW5jZVBhdHRlcm46ICgpID0+IFByb21pc2U8UGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gfCBudWxsPjtcbiAgZ3JvdXA6ICgpID0+IFByb21pc2U8R3JvdXAgfCBudWxsPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0eUNvbXBsZXRpb24ge1xuICBpZDogbnVtYmVyO1xuICBhY3Rpdml0eV9pZDogbnVtYmVyO1xuICB1c2VyX2lkOiBudW1iZXI7XG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nO1xuICBkdXJhdGlvbl9taW51dGVzOiBudW1iZXIgfCBudWxsO1xuICBjb21wbGV0ZWRfYXQ6IERhdGU7XG4gIG1ldGFkYXRhOiB7XG4gICAgdGl0bGU/OiBzdHJpbmc7XG4gICAgbm90ZXM/OiBzdHJpbmc7XG4gICAgdHJpZ2dlcl9ldmVudHM/OiBzdHJpbmdbXTtcbiAgfSB8IG51bGw7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGxldGVBY3Rpdml0eVJlc3VsdCBleHRlbmRzIEFjdGl2aXR5Q29tcGxldGlvbiB7XG4gIGdyYW50ZWRSZXdhcmRzOiBBcnJheTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwgfCB1bmRlZmluZWQ+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIExvZ1RpbWVSZXN1bHQge1xuICBpZDogbnVtYmVyO1xuICB1c2VyX2lkOiBudW1iZXI7XG4gIHNvdXJjZV90eXBlOiBzdHJpbmc7XG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsO1xuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbDtcbiAgY29tcGxldGlvbl9pZDogbnVtYmVyIHwgbnVsbDtcbiAgb2NjdXJyZWRfYXQ6IERhdGU7XG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nIHwgbnVsbDtcbiAgbWV0cmljOiBzdHJpbmc7XG4gIGFtb3VudDogbnVtYmVyO1xuICBtZXRhZGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsO1xuICBjcmVhdGVkX2F0OiBEYXRlO1xufVxuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoXCJ1c2VySWRcIik7XG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSBcIm51bWJlclwiKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFwiVW5hdXRoZW50aWNhdGVkXCIpO1xuICB9XG4gIHJldHVybiB1c2VySWQ7XG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKGNvbmZpZzogUmVjdXJyZW5jZVBhdHRlcm5Sb3dbXCJjb25maWdcIl0pOiBSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHR5cGVvZiBjb25maWcgPT09IFwic3RyaW5nXCIgPyBKU09OLnBhcnNlKGNvbmZpZykgOiBjb25maWc7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHlJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgIC53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhY3Rpdml0eUlkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoR3JvdXBGb3JVc2VyKGdyb3VwSWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgZ3JvdXBJZClcbiAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIGdyb3VwSWQgZm9yIGNyZWF0ZS91cGRhdGUuIFRocm93cyBpZiB0aGUgZ3JvdXAgZG9lcyBub3QgYmVsb25nXG4gKiB0byB0aGUgdXNlci4gUmV0dXJucyBudWxsIHdoZW4gY2xlYXJpbmcgb3Igd2hlbiBubyBncm91cCBpcyBhc3NpZ25lZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUdyb3VwSWQoXG4gIGdyb3VwSWQ6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQsXG4gIHVzZXJJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkPiB7XG4gIGlmIChncm91cElkID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWQ7XG4gIGlmIChncm91cElkID09PSBudWxsKSByZXR1cm4gbnVsbDtcblxuICBjb25zdCBncm91cCA9IGF3YWl0IGZldGNoR3JvdXBGb3JVc2VyKGdyb3VwSWQsIHVzZXJJZCk7XG4gIGlmICghZ3JvdXApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoXCJncm91cCBub3QgZm91bmRcIik7XG4gIH1cbiAgcmV0dXJuIGdyb3VwLmlkO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaE93bmVkQWN0aXZpdHkoYWN0aXZpdHlJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgYWN0aXZpdHlJZClcbiAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuLy8gUHlsb24gcmVzb2x2ZXMgbmVzdGVkIEdyYXBoUUwgZmllbGRzIGZyb20gKHBvc3NpYmx5IGFzeW5jKSBwcm9wZXJ0aWVzIG9uXG4vLyB0aGUgcmV0dXJuZWQgb2JqZWN0LCBub3QgZnJvbSBhIHNlcGFyYXRlIHJlc29sdmVyIG1hcCBcdTIwMTQgc28gbmVzdGVkIGRhdGEgaXNcbi8vIGF0dGFjaGVkIGlubGluZSBoZXJlIHJhdGhlciB0aGFuIHZpYSBhIHN0YW5kYWxvbmUgcmVzb2x2ZXIgZXhwb3J0LlxuZnVuY3Rpb24gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5OiBBY3Rpdml0eVJvdyk6IEFjdGl2aXR5IHtcbiAgcmV0dXJuIHtcbiAgICAuLi5hY3Rpdml0eSxcbiAgICByZWN1cnJlbmNlUGF0dGVybjogYXN5bmMgKCk6IFByb21pc2U8UGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gfCBudWxsPiA9PiB7XG4gICAgICBpZiAoIWFjdGl2aXR5LmlzX3JlY3VycmluZykgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBwYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eS5pZCk7XG4gICAgICBpZiAoIXBhdHRlcm4pIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcocGF0dGVybi5jb25maWcpO1xuICAgICAgaWYgKCFjb25maWcpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgLi4ucGF0dGVybiwgY29uZmlnIH07XG4gICAgfSxcbiAgICBncm91cDogYXN5bmMgKCk6IFByb21pc2U8R3JvdXAgfCBudWxsPiA9PiB7XG4gICAgICBpZiAoYWN0aXZpdHkuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFjdGl2aXR5Lmdyb3VwX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgZ3JvdXBzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPik6IFByb21pc2U8R3JvdXBbXT4gPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoXCJuYW1lXCIsIFwiYXNjXCIpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH0sXG5cbiAgZ3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSk6IFByb21pc2U8R3JvdXAgfCBudWxsPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdGllczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pOiBQcm9taXNlPEFjdGl2aXR5W10+ID0+IHtcbiAgICB2b2lkIGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhBY3Rpdml0eVJlbGF0aW9ucyk7XG4gIH0sXG5cbiAgYWN0aXZpdHk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSk6IFByb21pc2U8QWN0aXZpdHkgfCBudWxsPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIHJldHVybiByb3cgPyB3aXRoQWN0aXZpdHlSZWxhdGlvbnMocm93KSA6IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdHlDb21wbGV0aW9uczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgYWN0aXZpdHlJZD86IG51bWJlcjtcbiAgICBmcm9tRGF0ZT86IHN0cmluZztcbiAgICB0b0RhdGU/OiBzdHJpbmc7XG4gIH0pOiBQcm9taXNlPEFjdGl2aXR5Q29tcGxldGlvbltdPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAub3JkZXJCeShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcImRlc2NcIilcbiAgICAgIC5zZWxlY3RBbGwoKTtcblxuICAgIGlmIChhcmdzPy5hY3Rpdml0eUlkICE9IG51bGwpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYXJncy5hY3Rpdml0eUlkKTtcbiAgICB9XG4gICAgaWYgKGFyZ3M/LmZyb21EYXRlKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiPj1cIiwgYXJncy5mcm9tRGF0ZSk7XG4gICAgfVxuICAgIGlmIChhcmdzPy50b0RhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI8PVwiLCBhcmdzLnRvRGF0ZSk7XG4gICAgfVxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5leGVjdXRlKCk7XG4gIH0sXG5cbiAgLi4uR29hbFF1ZXJ5LFxuICAuLi5SZXdhcmRRdWVyeSxcbn07XG5cbmV4cG9ydCBjb25zdCBNdXRhdGlvbiA9IHtcbiAgY3JlYXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHcm91cElucHV0IH0pOiBQcm9taXNlPEdyb3VwPiA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpO1xuICAgIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ3JvdXBzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dyb3VwKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICB1cGRhdGVHcm91cDogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXQgfSxcbiAgKTogUHJvbWlzZTxHcm91cD4gPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgbmFtZSA9IGlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lO1xuICAgIGNvbnN0IGNvbG9yID0gaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpXG4gICAgICA6IGV4aXN0aW5nLmNvbG9yO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoXCJncm91cHNcIilcbiAgICAgIC5zZXQoe1xuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgZGVsZXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNyZWF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApOiBQcm9taXNlPEFjdGl2aXR5PiA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoe1xuICAgICAgaXNSZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICAgIHJlY3VycmVuY2VQYXR0ZXJuOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybixcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbk9mZnNldHMgPSBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKFxuICAgICAgaW5wdXQubm90aWZpY2F0aW9uT2Zmc2V0cyxcbiAgICApO1xuICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkID8/IG51bGwsIHVzZXJJZCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpbnB1dC5pc1JlY3VycmluZyA/IG51bGwgOiAoaW5wdXQuZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICBncm91cF9pZDogZ3JvdXBJZCA/PyBudWxsLFxuICAgICAgICAgIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBub3RpZmljYXRpb25PZmZzZXRzLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpbnB1dC5pc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHkpO1xuICB9LFxuXG4gIHVwZGF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApOiBQcm9taXNlPEFjdGl2aXR5PiA9PiB7XG4gICAgY29uc3QgeyBpZCwgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgaXNSZWN1cnJpbmcgPSBpbnB1dC5pc1JlY3VycmluZyA/PyBleGlzdGluZy5pc19yZWN1cnJpbmc7XG4gICAgY29uc3QgZGF0ZSA9IGlucHV0LmRhdGUgIT09IHVuZGVmaW5lZCA/IGlucHV0LmRhdGUgOiBleGlzdGluZy5kYXRlO1xuXG4gICAgLy8gSWYgdGhlIHNjaGVkdWxlIGlzIHN0aWxsIHJlY3VycmluZyBhbmQgbm8gbmV3IHBhdHRlcm4gd2FzIHN1cHBsaWVkLFxuICAgIC8vIHZhbGlkYXRlIGFnYWluc3QgdGhlIHBhdHRlcm4gYWxyZWFkeSBvbiBmaWxlLlxuICAgIGxldCByZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGwgfCB1bmRlZmluZWQgPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybjtcbiAgICBpZiAoaXNSZWN1cnJpbmcgJiYgIXJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1BhdHRlcm4gPSBhd2FpdCBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGlkKTtcbiAgICAgIGlmIChleGlzdGluZ1BhdHRlcm4pIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcoZXhpc3RpbmdQYXR0ZXJuLmNvbmZpZyk7XG4gICAgICAgIHJlY3VycmVuY2VQYXR0ZXJuID0gY29uZmlnXG4gICAgICAgICAgPyB7IHJlY3VycmVuY2VUeXBlOiBleGlzdGluZ1BhdHRlcm4ucmVjdXJyZW5jZV90eXBlLCBjb25maWcgfVxuICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7IGlzUmVjdXJyaW5nLCBkYXRlLCByZWN1cnJlbmNlUGF0dGVybiB9KTtcblxuICAgIGNvbnN0IHJlc29sdmVkR3JvdXBJZCA9IGlucHV0Lmdyb3VwSWQgIT09IHVuZGVmaW5lZFxuICAgICAgPyBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkLCB1c2VySWQpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbk9mZnNldHMgPSBpbnB1dC5ub3RpZmljYXRpb25PZmZzZXRzICE9PSB1bmRlZmluZWRcbiAgICAgID8gbm9ybWFsaXplTm90aWZpY2F0aW9uT2Zmc2V0cyhpbnB1dC5ub3RpZmljYXRpb25PZmZzZXRzKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZShcImFjdGl2aXRpZXNcIilcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpc1JlY3VycmluZyA/IG51bGwgOiAoZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICAuLi4ocmVzb2x2ZWRHcm91cElkICE9PSB1bmRlZmluZWQgPyB7IGdyb3VwX2lkOiByZXNvbHZlZEdyb3VwSWQgfSA6IHt9KSxcbiAgICAgICAgICAuLi4obm90aWZpY2F0aW9uT2Zmc2V0cyAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgbm90aWZpY2F0aW9uX29mZnNldHM6IG5vdGlmaWNhdGlvbk9mZnNldHMgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICBpZiAoaXNSZWN1cnJpbmcgJiYgaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50byhcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4ucmVjdXJyZW5jZVR5cGUsXG4gICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLmNvbmZpZyksXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdSZWN1cnJlbmNlUGF0dGVybilcbiAgICAgICAgICAub25Db25mbGljdCgob2M6IE9uQ29uZmxpY3RCdWlsZGVyPGFueSwgYW55PikgPT5cbiAgICAgICAgICAgIG9jLmNvbHVtbnMoW1wiYWN0aXZpdHlfaWRcIl0pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEucmVjdXJyZW5jZVR5cGUsXG4gICAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4hLmNvbmZpZyksXG4gICAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9IGVsc2UgaWYgKCFpc1JlY3VycmluZykge1xuICAgICAgICAvLyBDbGVhbiB1cCBhbnkgc3RhbGUgcGF0dGVybiBvbmNlIGFuIGFjdGl2aXR5IHN0b3BzIHJlY3VycmluZy5cbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5LmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHkpO1xuICB9LFxuXG4gIGRlbGV0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyIH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKTtcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMDtcbiAgfSxcblxuICBjb21wbGV0ZUFjdGl2aXR5OiBhc3luYyAoYXJnczoge1xuICAgIGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXQ7XG4gIH0pOiBQcm9taXNlPENvbXBsZXRlQWN0aXZpdHlSZXN1bHQ+ID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCBvY2N1cnJlbmNlRGF0ZSA9IHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoaW5wdXQub2NjdXJyZW5jZURhdGUpO1xuICAgIGNvbnN0IGR1cmF0aW9uTWludXRlcyA9IHZhbGlkYXRlRHVyYXRpb25NaW51dGVzKGlucHV0LmR1cmF0aW9uTWludXRlcyk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShpbnB1dC5hY3Rpdml0eUlkLCB1c2VySWQpO1xuICAgIGlmICghYWN0aXZpdHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKFwiYWN0aXZpdHkgbm90IGZvdW5kXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBjb21wbGV0aW9uID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5LmlkKVxuICAgICAgICAud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI9XCIsIG9jY3VycmVuY2VEYXRlKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5kZWxldGVGcm9tKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgICAud2hlcmUoXCJjb21wbGV0aW9uX2lkXCIsIFwiPVwiLCBleGlzdGluZy5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICBjb25zdCBjb21wbGV0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgIGR1cmF0aW9uX21pbnV0ZXM6IGR1cmF0aW9uTWludXRlcyxcbiAgICAgICAgICBjb21wbGV0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICBtZXRhZGF0YTogaW5wdXQubm90ZXNcbiAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMsIHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KVxuICAgICAgICAgICAgOiBKU09OLnN0cmluZ2lmeSh7IHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KSxcbiAgICAgICAgfSBhcyBOZXdBY3Rpdml0eUNvbXBsZXRpb24pXG4gICAgICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgICAgICBvYy5jb2x1bW5zKFtcImFjdGl2aXR5X2lkXCIsIFwib2NjdXJyZW5jZV9kYXRlXCJdKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgICBkdXJhdGlvbl9taW51dGVzOiBkdXJhdGlvbk1pbnV0ZXMsXG4gICAgICAgICAgICBjb21wbGV0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHsgbm90ZXM6IGlucHV0Lm5vdGVzLCB0aXRsZTogYWN0aXZpdHkudGl0bGUgfSlcbiAgICAgICAgICAgICAgOiBKU09OLnN0cmluZ2lmeSh7IHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KSxcbiAgICAgICAgICB9KVxuICAgICAgICApXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgLy8gQ291bnQgZXZlbnRcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50byhcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICBzb3VyY2VfdHlwZTogXCJjb21wbGV0aW9uXCIsXG4gICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgIGdyb3VwX2lkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICAgICAgICBjb21wbGV0aW9uX2lkOiBjb21wbGV0aW9uLmlkLFxuICAgICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgICBtZXRyaWM6IFwiY291bnRcIixcbiAgICAgICAgICBhbW91bnQ6IDEsXG4gICAgICAgICAgbWV0YWRhdGE6IG51bGwsXG4gICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgICAgLmV4ZWN1dGUoKTtcblxuICAgICAgLy8gT3B0aW9uYWwgZHVyYXRpb24gZXZlbnQgd2hlbiBtaW51dGVzIHByb3ZpZGVkIG9yIGRlcml2ZWQgZnJvbSBzY2hlZHVsZS5cbiAgICAgIGxldCBtaW51dGVzID0gZHVyYXRpb25NaW51dGVzO1xuICAgICAgaWYgKG1pbnV0ZXMgPT0gbnVsbCkge1xuICAgICAgICAvLyBEZXJpdmUgZnJvbSBzY2hlZHVsZWQgc2xvdCB3aGVuIHBvc3NpYmxlLlxuICAgICAgICBjb25zdCBbc2gsIHNtXSA9IGFjdGl2aXR5LnN0YXJ0X3RpbWUuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgICAgICBjb25zdCBbZWgsIGVtXSA9IGFjdGl2aXR5LmVuZF90aW1lLnNwbGl0KFwiOlwiKS5tYXAoTnVtYmVyKTtcbiAgICAgICAgY29uc3QgZGVyaXZlZCA9IChlaCAqIDYwICsgZW0pIC0gKHNoICogNjAgKyBzbSk7XG4gICAgICAgIGlmIChkZXJpdmVkID4gMCkgbWludXRlcyA9IGRlcml2ZWQ7XG4gICAgICB9XG4gICAgICBpZiAobWludXRlcyAhPSBudWxsICYmIG1pbnV0ZXMgPiAwKSB7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICAgIHNvdXJjZV90eXBlOiBcImNvbXBsZXRpb25cIixcbiAgICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICAgIGdyb3VwX2lkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICAgICAgICAgIGNvbXBsZXRpb25faWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICAgICAgICBvY2N1cnJlZF9hdDogbm93LFxuICAgICAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgICAgIG1ldHJpYzogXCJkdXJhdGlvblwiLFxuICAgICAgICAgICAgYW1vdW50OiBtaW51dGVzLFxuICAgICAgICAgICAgbWV0YWRhdGE6IG51bGwsXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdHb2FsRXZlbnQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGNvbXBsZXRpb247XG4gICAgfSk7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhkYiwgdXNlcklkLCB7XG4gICAgICBhY3Rpdml0eUlkOiBhY3Rpdml0eS5pZCxcbiAgICAgIGdyb3VwSWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZ3JhbnRlZCA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgZ3JhbnRSZXdhcmRzRm9yQWN0aXZpdHlDb21wbGV0aW9uKHRyeCwge1xuICAgICAgICB1c2VySWQsXG4gICAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICBjb21wbGV0aW9uSWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5jb21wbGV0aW9uLFxuICAgICAgZ3JhbnRlZFJld2FyZHM6IGdyYW50ZWRcbiAgICAgICAgLmZpbHRlcigoZykgPT4gIWcuc2tpcHBlZCAmJiBnLnRyYW5zYWN0aW9uKVxuICAgICAgICAubWFwKChnKSA9PiBnLnRyYW5zYWN0aW9uKSxcbiAgICB9O1xuICB9LFxuXG4gIHVuZG9Db21wbGV0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKCFleGlzdGluZykgcmV0dXJuIGZhbHNlO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBmZXRjaE93bmVkQWN0aXZpdHkoZXhpc3RpbmcuYWN0aXZpdHlfaWQsIHVzZXJJZCk7XG5cbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKTtcbiAgICAgIGF3YWl0IG1hbmFnZXIucmV2b2tlVW5jb25zdW1lZEZvckNvbXBsZXRpb24odHJ4LCB1c2VySWQsIGV4aXN0aW5nLmlkKTtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbShcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5kZWxldGVGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgIH0pO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogZXhpc3RpbmcuYWN0aXZpdHlfaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eT8uZ3JvdXBfaWQgPz8gbnVsbCxcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIGxvZ1RpbWU6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBMb2dUaW1lSW5wdXQgfSk6IFByb21pc2U8TG9nVGltZVJlc3VsdD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG1pbnV0ZXMgPSB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24oaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcbiAgICBjb25zdCBvY2N1cnJlbmNlRGF0ZSA9IHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoXG4gICAgICBpbnB1dC5vY2N1cnJlbmNlRGF0ZSA/PyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShpbnB1dC5hY3Rpdml0eUlkLCB1c2VySWQpO1xuICAgIGlmICghYWN0aXZpdHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKFwiYWN0aXZpdHkgbm90IGZvdW5kXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBldmVudCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50byhcImdvYWxfZXZlbnRzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBzb3VyY2VfdHlwZTogXCJ0aW1lX2xvZ1wiLFxuICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgIGdyb3VwX2lkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgIGFtb3VudDogbWludXRlcyxcbiAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcyB9KVxuICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdHb2FsRXZlbnQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGFtb3VudDogYXNOdW1iZXIoZXZlbnQuYW1vdW50KSxcbiAgICB9O1xuICB9LFxuXG4gIC4uLkdvYWxNdXRhdGlvbixcbiAgLi4uUmV3YXJkTXV0YXRpb24sXG5cbiAgcmVnaXN0ZXJEZXZpY2VUb2tlbjogYXN5bmMgKGFyZ3M6IHsgdG9rZW46IHN0cmluZzsgcGxhdGZvcm06IHN0cmluZyB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHRva2VuID0gdmFsaWRhdGVEZXZpY2VUb2tlbihhcmdzLnRva2VuKTtcbiAgICBjb25zdCBwbGF0Zm9ybSA9IHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0oYXJncy5wbGF0Zm9ybSk7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZGV2aWNlX3Rva2Vuc1wiKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgdG9rZW4sXG4gICAgICAgIHBsYXRmb3JtLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0RldmljZVRva2VuKVxuICAgICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgICBvYy5jb2x1bW4oXCJ0b2tlblwiKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHBsYXRmb3JtLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuICB1bnJlZ2lzdGVyRGV2aWNlVG9rZW46IGFzeW5jIChhcmdzOiB7IHRva2VuOiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB0b2tlbiA9IHZhbGlkYXRlRGV2aWNlVG9rZW4oYXJncy50b2tlbik7XG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiZGV2aWNlX3Rva2Vuc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLndoZXJlKFwidG9rZW5cIiwgXCI9XCIsIHRva2VuKVxuICAgICAgLmV4ZWN1dGUoKTtcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMCAmJiBOdW1iZXIocmVzdWx0WzBdPy5udW1EZWxldGVkUm93cyA/PyAwKSA+IDA7XG4gIH0sXG59O1xuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59O1xuIiwgImltcG9ydCB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgSW5zZXJ0YWJsZSwgU2VsZWN0YWJsZSwgVXBkYXRlYWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLy8gTWFpbiBEYXRhYmFzZSBpbnRlcmZhY2UgdGhhdCBkZXNjcmliZXMgYWxsIHRhYmxlc1xuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG4gIGdyb3VwczogR3JvdXBzVGFibGVcbiAgYWN0aXZpdGllczogQWN0aXZpdGllc1RhYmxlXG4gIHJlY3VycmVuY2VfcGF0dGVybnM6IFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlXG4gIGFjdGl2aXR5X2NvbXBsZXRpb25zOiBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGVcbiAgZ29hbF9ldmVudHM6IEdvYWxFdmVudHNUYWJsZVxuICBnb2FsczogR29hbHNUYWJsZVxuICBnb2FsX2xpbmtzOiBHb2FsTGlua3NUYWJsZVxuICBnb2FsX2N5Y2xlczogR29hbEN5Y2xlc1RhYmxlXG4gIGdvYWxfZGVwZW5kZW5jaWVzOiBHb2FsRGVwZW5kZW5jaWVzVGFibGVcbiAgZ29hbF9wcm9ncmVzc19zbmFwc2hvdHM6IEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlXG4gIGFzc2V0czogQXNzZXRzVGFibGVcbiAgcmV3YXJkX2RlZmluaXRpb25zOiBSZXdhcmREZWZpbml0aW9uc1RhYmxlXG4gIHJld2FyZF9ydWxlczogUmV3YXJkUnVsZXNUYWJsZVxuICByZXdhcmRfaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlUYWJsZVxuICByZXdhcmRfdHJhbnNhY3Rpb25zOiBSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZVxuICBkZXZpY2VfdG9rZW5zOiBEZXZpY2VUb2tlbnNUYWJsZVxufVxuXG4vLyBVc2VycyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgLyoqIFN1cGVyVG9rZW5zIHVzZXIgaWQgXHUyMDE0IGxpbmtzIFNTTyBpZGVudGl0eSB0byBsb2NhbCByb3dzLiAqL1xuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gR3JvdXBzIHRhYmxlIGludGVyZmFjZSBcdTIwMTQgdXNlci1zY29wZWQgYWN0aXZpdHkgdGF4b25vbXkgd2l0aCBkaXNwbGF5IGNvbG9yLlxuZXhwb3J0IGludGVyZmFjZSBHcm91cHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIC8vIEhleCBjb2xvciBmcm9tIHRoZSBzaGFyZWQgcHJlc2V0IHBhbGV0dGUsIGUuZy4gXCIjMEY3NjZFXCJcbiAgY29sb3I6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXRpZXMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIEFjdGl2aXRpZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgLy8gT3B0aW9uYWwgZ3JvdXAgYXNzaWdubWVudC4gTnVsbCB3aGVuIHVuZ3JvdXBlZDsgY2xlYXJlZCBpZiB0aGUgZ3JvdXBcbiAgLy8gaXMgZGVsZXRlZCAoT04gREVMRVRFIFNFVCBOVUxMKS5cbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgdGl0bGU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBzdGFydF90aW1lOiBzdHJpbmcgLy8gVGltZSBvZiBkYXkgaW4gSEg6bW0gZm9ybWF0XG4gIGVuZF90aW1lOiBzdHJpbmcgLy8gVGltZSBvZiBkYXkgaW4gSEg6bW0gZm9ybWF0XG4gIGlzX3JlY3VycmluZzogYm9vbGVhblxuICAvLyBDYWxlbmRhciBkYXRlIHRoZSBhY3Rpdml0eSBvY2N1cnMgb24uIFJlcXVpcmVkIHdoZW4gaXNfcmVjdXJyaW5nIGlzXG4gIC8vIGZhbHNlOyBudWxsIHdoZW4gaXNfcmVjdXJyaW5nIGlzIHRydWUgKGRhdGVzIGxpdmUgaW4gdGhlIHJlY3VycmVuY2VcbiAgLy8gcGF0dGVybidzIGNvbmZpZyBpbnN0ZWFkKS5cbiAgZGF0ZTogc3RyaW5nIHwgbnVsbFxuICAvLyBNaW51dGVzIGJlZm9yZSBzdGFydF90aW1lIHRvIGZpcmUgYSBsb2NhbCByZW1pbmRlcjsgMCA9IGF0IHN0YXJ0LlxuICAvLyBFbXB0eSBhcnJheSA9IG5vIHJlbWluZGVycy4gTWF4IDggdW5pcXVlIHZhbHVlcyBpbiBbMCwgMTAwODBdLlxuICBub3RpZmljYXRpb25fb2Zmc2V0czogbnVtYmVyW11cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBSZWN1cnJlbmNlIHBhdHRlcm5zIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBSZWN1cnJlbmNlUGF0dGVybnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIC8vIFR5cGUgb2YgcmVjdXJyZW5jZTogd2Vla2x5LCBtb250aGx5LCBvciBldmVyeSBYIGRheXNcbiAgcmVjdXJyZW5jZV90eXBlOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdldmVyeV94X2RheXMnXG4gIC8vIEpTT04gY29uZmlndXJhdGlvbiBmb3IgdGhlIHJlY3VycmVuY2VcbiAgY29uZmlnOiBDb2x1bW5UeXBlPHtcbiAgICAvLyBGb3Igd2Vla2x5OiBhcnJheSBvZiBkYXlzICgwLTYsIHdoZXJlIDAgaXMgU3VuZGF5KVxuICAgIGRheXNfb2Zfd2Vlaz86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGRheXMgb2YgdGhlIG1vbnRoICgxLTMxKVxuICAgIGRheXNfb2ZfbW9udGg/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBhbHNvIHJlcGVhdCBvbiB0aGUgbGFzdCBkYXkgb2YgdGhlIG1vbnRoLiBLZXB0IGFzIGl0c1xuICAgIC8vIG93biBib29sZWFuIChyYXRoZXIgdGhhbiBhICdsYXN0JyBzZW50aW5lbCBpbiBkYXlzX29mX21vbnRoKSBiZWNhdXNlXG4gICAgLy8gUHlsb24vR3JhcGhRTCBpbnB1dCB0eXBlcyBjYW4ndCByZXByZXNlbnQgYSBudW1iZXJ8c3RyaW5nIHVuaW9uLlxuICAgIGlzX2xhc3RfZGF5X29mX21vbnRoPzogYm9vbGVhblxuICAgIC8vIEZvciBldmVyeV94X2RheXM6IHJlcGVhdCBldmVyeSBOIGRheXMgKD49IDEpXG4gICAgaW50ZXJ2YWxfZGF5cz86IG51bWJlclxuICAgIC8vIFN0YXJ0IGRhdGUgb2YgdGhlIHJlY3VycmVuY2VcbiAgICBzdGFydF9kYXRlOiBzdHJpbmdcbiAgICAvLyBFbmQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZSAob3B0aW9uYWwpXG4gICAgZW5kX2RhdGU/OiBzdHJpbmcgfCBudWxsXG4gIH0sIHN0cmluZywgc3RyaW5nPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXR5IGNvbXBsZXRpb25zIFx1MjAxNCBvbmUgcm93IHBlciAoYWN0aXZpdHksIG9jY3VycmVuY2VfZGF0ZSlcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nXG4gIGR1cmF0aW9uX21pbnV0ZXM6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIC8vIFN0b3JlIGFueSBhZGRpdGlvbmFsIGRhdGEgYWJvdXQgdGhlIGNvbXBsZXRpb25cbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8e1xuICAgIHRpdGxlPzogc3RyaW5nXG4gICAgbm90ZXM/OiBzdHJpbmdcbiAgICB0cmlnZ2VyX2V2ZW50cz86IHN0cmluZ1tdXG4gIH0gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRTb3VyY2VUeXBlID0gJ2NvbXBsZXRpb24nIHwgJ3RpbWVfbG9nJyB8ICdtYW51YWwnXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmVudHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgc291cmNlX3R5cGU6IEdvYWxFdmVudFNvdXJjZVR5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbl9pZDogbnVtYmVyIHwgbnVsbFxuICBvY2N1cnJlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZyB8IG51bGxcbiAgbWV0cmljOiBHb2FsRXZlbnRNZXRyaWNcbiAgYW1vdW50OiBudW1iZXJcbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8UmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxTdGF0dXMgPSAnYWN0aXZlJyB8ICdwYXVzZWQnIHwgJ2NvbXBsZXRlZCcgfCAnYXJjaGl2ZWQnIHwgJ2ZhaWxlZCdcbmV4cG9ydCB0eXBlIEdvYWxNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxSZWN1cnJlbmNlQ29uZmlnIHtcbiAgcGVyaW9kOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdxdWFydGVybHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgaW50ZXJ2YWw/OiBudW1iZXJcbiAgYW5jaG9yPzogc3RyaW5nXG4gIGNhcnJ5X292ZXI/OiAnbm9uZScgfCAnb3ZlcmZsb3cnXG4gIHJlc2V0PzogJ2hhcmQnXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlYWRsaW5lQ29uZmlnIHtcbiAga2luZDogJ2Fic29sdXRlJyB8ICdyZWxhdGl2ZSdcbiAgZGF0ZT86IHN0cmluZ1xuICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0PzogbnVtYmVyXG4gIGdyYWNlX2RheXM/OiBudW1iZXJcbiAgd2Fybl9kYXlzPzogbnVtYmVyXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbENvbmZpZyB7XG4gIGNvbXBvc2l0ZV9tb2RlPzogJ2FsbCcgfCAnYW55JyB8ICd3ZWlnaHRlZCdcbiAgY291bnRfcmVxdWlyZWQ/OiBudW1iZXJcbiAgYmVmb3JlX3RpbWU/OiBzdHJpbmdcbiAgYWZ0ZXJfdGltZT86IHN0cmluZ1xuICBibG9ja191bnRpbF91bmxvY2tlZD86IGJvb2xlYW5cbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgY29sb3I6IHN0cmluZ1xuICBpY29uOiBzdHJpbmcgfCBudWxsXG4gIHJ1bGVfdHlwZTogc3RyaW5nXG4gIG1ldHJpYzogR29hbE1ldHJpY1xuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjb25maWc6IENvbHVtblR5cGU8R29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZz5cbiAgc3RhdHVzOiBHb2FsU3RhdHVzXG4gIHJlY3VycmVuY2U6IENvbHVtblR5cGU8XG4gICAgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGxcbiAgPlxuICBkZWFkbGluZTogQ29sdW1uVHlwZTxcbiAgICBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbFxuICA+XG4gIHByaW9yaXR5OiBudW1iZXJcbiAgc29ydF9vcmRlcjogbnVtYmVyXG4gIC8qKiBFZmZlY3RpdmUgc3RhcnQgb2YgdGhlIGdvYWwgKHNlZWRzIGN5Y2xlIDApLiBBbHdheXMgc2V0LiAqL1xuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbExpbmtUeXBlID0gJ2FjdGl2aXR5JyB8ICdncm91cCdcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTGlua3NUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgbGlua190eXBlOiBHb2FsTGlua1R5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGVTdGF0dXMgPSAnYWN0aXZlJyB8ICdzdWNjZWVkZWQnIHwgJ2ZhaWxlZCcgfCAnbWlzc2VkJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxDeWNsZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgY3ljbGVfaW5kZXg6IG51bWJlclxuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGVuZHNfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGRlYWRsaW5lX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjdXJyZW50X3ZhbHVlOiBudW1iZXJcbiAgc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXNcbiAgY2Fycnlfb3ZlcjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCA9ICdjb21wbGV0ZScgfCAncHJvZ3Jlc3MnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlcGVuZGVuY2llc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBkZXBlbmRzX29uX2dvYWxfaWQ6IG51bWJlclxuICByZXF1aXJlbWVudDogR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudFxuICB0aHJlc2hvbGQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfY3ljbGVfaWQ6IG51bWJlclxuICBhc19vZjogc3RyaW5nXG4gIHZhbHVlOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG4vLyBFeHBvcnQgY29udmVuaWVuY2UgdHlwZXMgZm9yIGVhY2ggdGFibGVcbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdVc2VyID0gSW5zZXJ0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgVXNlclVwZGF0ZSA9IFVwZGF0ZWFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR3JvdXAgPSBTZWxlY3RhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R3JvdXAgPSBJbnNlcnRhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgR3JvdXBVcGRhdGUgPSBVcGRhdGVhYmxlPEdyb3Vwc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eSA9IFNlbGVjdGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QWN0aXZpdHkgPSBJbnNlcnRhYmxlPEFjdGl2aXRpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5VXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0aWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuID0gU2VsZWN0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1JlY3VycmVuY2VQYXR0ZXJuID0gSW5zZXJ0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuVXBkYXRlID0gVXBkYXRlYWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uID0gU2VsZWN0YWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eUNvbXBsZXRpb24gPSBJbnNlcnRhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5Q29tcGxldGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnQgPSBTZWxlY3RhYmxlPEdvYWxFdmVudHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxFdmVudCA9IEluc2VydGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEV2ZW50VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsRXZlbnRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWwgPSBTZWxlY3RhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsID0gSW5zZXJ0YWJsZTxHb2Fsc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbExpbmsgPSBTZWxlY3RhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbExpbmsgPSBJbnNlcnRhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbExpbmtVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxMaW5rc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGUgPSBTZWxlY3RhYmxlPEdvYWxDeWNsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxDeWNsZSA9IEluc2VydGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlVXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5ID0gU2VsZWN0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsRGVwZW5kZW5jeSA9IEluc2VydGFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3QgPSBTZWxlY3RhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbFByb2dyZXNzU25hcHNob3QgPSBJbnNlcnRhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3RVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIEFzc2V0cyAmIFJld2FyZHNcbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBzaGEyNTY6IHN0cmluZ1xuICBjb250ZW50X3R5cGU6IHN0cmluZ1xuICBieXRlX3NpemU6IG51bWJlclxuICBzdG9yYWdlX2tleTogc3RyaW5nXG4gIHJlZl9jb3VudDogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgb3JwaGFuZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkRGVmaW5pdGlvbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIG5vdGVzOiBzdHJpbmcgfCBudWxsXG4gIGNhdGVnb3J5OiBzdHJpbmcgfCBudWxsXG4gIHRhZ3M6IENvbHVtblR5cGU8c3RyaW5nW10sIHN0cmluZyB8IHN0cmluZ1tdLCBzdHJpbmcgfCBzdHJpbmdbXT5cbiAgY29sb3I6IHN0cmluZ1xuICBpY29uOiBzdHJpbmcgfCBudWxsXG4gIGltYWdlX2Fzc2V0X2lkOiBudW1iZXIgfCBudWxsXG4gIHN0YWNrYWJsZTogYm9vbGVhblxuICBkZWZhdWx0X3F1YW50aXR5OiBudW1iZXJcbiAgc29ydF9vcmRlcjogbnVtYmVyXG4gIGFyY2hpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFJld2FyZFJ1bGVNb2RlID0gJ2ZpeGVkJyB8ICdwcm9iYWJpbGl0eScgfCAncmFuZG9tX3Bvb2wnXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkUnVsZUNvbmZpZyB7XG4gIG9uY2U/OiBib29sZWFuXG4gIGNvb2xkb3duX2hvdXJzPzogbnVtYmVyXG4gIG1heF9ncmFudHNfdG90YWw/OiBudW1iZXJcbiAgbWF4X2dyYW50c19wZXJfcGVyaW9kPzogbnVtYmVyXG4gIHBlcmlvZF9ob3Vycz86IG51bWJlclxuICBwcm9iYWJpbGl0eT86IG51bWJlclxuICAvKiogUG9vbCBvZiBkZWZpbml0aW9uIGlkcyBmb3IgcmFuZG9tX3Bvb2wgbW9kZS4gKi9cbiAgcG9vbD86IEFycmF5PHsgZGVmaW5pdGlvbl9pZDogbnVtYmVyOyB3ZWlnaHQ/OiBudW1iZXI7IHF1YW50aXR5PzogbnVtYmVyIH0+XG4gIFtrZXk6IHN0cmluZ106IHVua25vd25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRSdWxlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBzb3VyY2VfdHlwZTogc3RyaW5nXG4gIHNvdXJjZV9pZDogbnVtYmVyXG4gIHJld2FyZF9kZWZpbml0aW9uX2lkOiBudW1iZXJcbiAgcXVhbnRpdHk6IG51bWJlclxuICBtb2RlOiBSZXdhcmRSdWxlTW9kZVxuICBjb25maWc6IENvbHVtblR5cGU8XG4gICAgUmV3YXJkUnVsZUNvbmZpZyxcbiAgICBzdHJpbmcgfCBSZXdhcmRSdWxlQ29uZmlnLFxuICAgIHN0cmluZyB8IFJld2FyZFJ1bGVDb25maWdcbiAgPlxuICBlbmFibGVkOiBib29sZWFuXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRJbnZlbnRvcnlUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlclxuICBxdWFudGl0eTogbnVtYmVyXG4gIHN0YWNrX2tleTogc3RyaW5nIHwgbnVsbFxuICBmaXJzdF9lYXJuZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGxhc3RfZWFybmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBSZXdhcmRUcmFuc2FjdGlvblR5cGUgPVxuICB8ICdlYXJuJ1xuICB8ICdjb25zdW1lJ1xuICB8ICdkZWxldGUnXG4gIHwgJ3Jlc3RvcmUnXG4gIHwgJ2FkanVzdCdcblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdHlwZTogUmV3YXJkVHJhbnNhY3Rpb25UeXBlXG4gIHJld2FyZF9kZWZpbml0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIGludmVudG9yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBxdWFudGl0eTogbnVtYmVyXG4gIGRlZmluaXRpb25fbmFtZTogc3RyaW5nXG4gIGRlZmluaXRpb25fY29sb3I6IHN0cmluZ1xuICBkZWZpbml0aW9uX2ljb246IHN0cmluZyB8IG51bGxcbiAgaW1hZ2VfYXNzZXRfaWQ6IG51bWJlciB8IG51bGxcbiAgc291cmNlX3R5cGU6IHN0cmluZyB8IG51bGxcbiAgc291cmNlX2lkOiBudW1iZXIgfCBudWxsXG4gIHRyaWdnZXJfa2V5OiBzdHJpbmcgfCBudWxsXG4gIHJ1bGVfaWQ6IG51bWJlciB8IG51bGxcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ29hbF9pZDogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIGN5Y2xlX2lkOiBudW1iZXIgfCBudWxsXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8XG4gICAgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsLFxuICAgIHN0cmluZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgbnVsbFxuICA+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IHR5cGUgQXNzZXQgPSBTZWxlY3RhYmxlPEFzc2V0c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QXNzZXQgPSBJbnNlcnRhYmxlPEFzc2V0c1RhYmxlPlxuZXhwb3J0IHR5cGUgQXNzZXRVcGRhdGUgPSBVcGRhdGVhYmxlPEFzc2V0c1RhYmxlPlxuXG5leHBvcnQgdHlwZSBSZXdhcmREZWZpbml0aW9uID0gU2VsZWN0YWJsZTxSZXdhcmREZWZpbml0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmV3YXJkRGVmaW5pdGlvbiA9IEluc2VydGFibGU8UmV3YXJkRGVmaW5pdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZERlZmluaXRpb25VcGRhdGUgPSBVcGRhdGVhYmxlPFJld2FyZERlZmluaXRpb25zVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZFJ1bGUgPSBTZWxlY3RhYmxlPFJld2FyZFJ1bGVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZXdhcmRSdWxlID0gSW5zZXJ0YWJsZTxSZXdhcmRSdWxlc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmV3YXJkUnVsZVVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkUnVsZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmV3YXJkSW52ZW50b3J5ID0gU2VsZWN0YWJsZTxSZXdhcmRJbnZlbnRvcnlUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZEludmVudG9yeSA9IEluc2VydGFibGU8UmV3YXJkSW52ZW50b3J5VGFibGU+XG5leHBvcnQgdHlwZSBSZXdhcmRJbnZlbnRvcnlVcGRhdGUgPSBVcGRhdGVhYmxlPFJld2FyZEludmVudG9yeVRhYmxlPlxuXG5leHBvcnQgdHlwZSBSZXdhcmRUcmFuc2FjdGlvbiA9IFNlbGVjdGFibGU8UmV3YXJkVHJhbnNhY3Rpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZXdhcmRUcmFuc2FjdGlvbiA9IEluc2VydGFibGU8UmV3YXJkVHJhbnNhY3Rpb25zVGFibGU+XG5leHBvcnQgdHlwZSBSZXdhcmRUcmFuc2FjdGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkVHJhbnNhY3Rpb25zVGFibGU+XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlVG9rZW5zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHRva2VuOiBzdHJpbmdcbiAgLyoqICdpb3MnIHwgJ2FuZHJvaWQnIHwgJ3dlYicgKi9cbiAgcGxhdGZvcm06IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBEZXZpY2VUb2tlbiA9IFNlbGVjdGFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdEZXZpY2VUb2tlbiA9IEluc2VydGFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG5leHBvcnQgdHlwZSBEZXZpY2VUb2tlblVwZGF0ZSA9IFVwZGF0ZWFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG4iLCAiaW1wb3J0IHsgUG9vbCwgdHlwZXMgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgZW52IH0gZnJvbSAnLi9lbnYudHMnXG5pbXBvcnQge1xuICBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyxcbiAgc3NsRm9yRGF0YWJhc2VVcmwsXG59IGZyb20gJy4vc3NsLnRzJ1xuXG4vLyBLZWVwIFBvc3RncmVzIGBkYXRlYCBhcyBgWVlZWS1NTS1ERGAgc3RyaW5ncy4gVGhlIGRlZmF1bHQgcGcgcGFyc2VyIHR1cm5zXG4vLyB0aGVtIGludG8gSlMgRGF0ZSBvYmplY3RzLCB3aGljaCBHcmFwaFFMIHRoZW4gc3RyaW5naWZpZXMgYXMgZnVsbCB0aW1lc3RhbXBzXG4vLyBhbmQgYnJlYWtzIEZsdXR0ZXIncyBkYXRlLW9ubHkgcGFyc2luZy5cbnR5cGVzLnNldFR5cGVQYXJzZXIodHlwZXMuYnVpbHRpbnMuREFURSwgKHZhbHVlOiBzdHJpbmcpID0+IHZhbHVlKVxuXG5leHBvcnQgdHlwZSBDcmVhdGVLeXNlbHlPcHRpb25zID0ge1xuICAvKiogRmFsbGJhY2sgd2hlbiBgUEdEQVRBQkFTRWAgLyBgREFUQUJBU0VfVVJMYCBhcmUgdW5zZXQuICovXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHBvb2xDb25maWdGcm9tRW52KFxuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZyxcbik6IENvbnN0cnVjdG9yUGFyYW1ldGVyczx0eXBlb2YgUG9vbD5bMF0ge1xuICBjb25zdCBkYXRhYmFzZVVybCA9IGVudignREFUQUJBU0VfVVJMJylcbiAgaWYgKGRhdGFiYXNlVXJsKSB7XG4gICAgY29uc3Qgc3NsID0gc3NsRm9yRGF0YWJhc2VVcmwoZGF0YWJhc2VVcmwpXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbm5lY3Rpb25TdHJpbmc6IGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsKSxcbiAgICAgIG1heDogMTAsXG4gICAgICAuLi4oc3NsID09PSB1bmRlZmluZWQgPyB7fSA6IHsgc3NsIH0pLFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2U6IGVudignUEdEQVRBQkFTRScpID8/IGRlZmF1bHREYXRhYmFzZSxcbiAgICBob3N0OiBlbnYoJ1BHSE9TVCcpID8/ICdsb2NhbGhvc3QnLFxuICAgIHVzZXI6IGVudignUEdVU0VSJykgPz8gJ3Bvc3RncmVzJyxcbiAgICBwYXNzd29yZDogZW52KCdQR1BBU1NXT1JEJykgPz8gJ3Rlc3QxMjM0JyxcbiAgICBwb3J0OiBOdW1iZXIoZW52KCdQR1BPUlQnKSA/PyAnNTQzMicpLFxuICAgIG1heDogMTAsXG4gIH1cbn1cblxuLyoqIENyZWF0ZSBhIEt5c2VseSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIHNjaGVtYSB0eXBlIGFuZCBkZWZhdWx0IERCIG5hbWUuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5PERCPihvcHRpb25zOiBDcmVhdGVLeXNlbHlPcHRpb25zKTogS3lzZWx5PERCPiB7XG4gIGNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgICBwb29sOiBuZXcgUG9vbChwb29sQ29uZmlnRnJvbUVudihvcHRpb25zLmRlZmF1bHREYXRhYmFzZSkpLFxuICB9KVxuICByZXR1cm4gbmV3IEt5c2VseTxEQj4oeyBkaWFsZWN0IH0pXG59XG4iLCAiLyoqIFRMUyBvcHRpb25zIGZvciBgcGdgIGZyb20gYSBQb3N0Z3JlcyBVUkwuICovXG5leHBvcnQgZnVuY3Rpb24gc3NsRm9yRGF0YWJhc2VVcmwoXG4gIGRhdGFiYXNlVXJsOiBzdHJpbmcsXG4pOiBmYWxzZSB8IHsgcmVqZWN0VW5hdXRob3JpemVkOiBib29sZWFuIH0gfCB1bmRlZmluZWQge1xuICBsZXQgdXJsOiBVUkxcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICBjb25zdCBtb2RlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3NzbG1vZGUnKT8udG9Mb3dlckNhc2UoKVxuICBpZiAobW9kZSA9PT0gJ2Rpc2FibGUnKSByZXR1cm4gZmFsc2VcbiAgaWYgKG1vZGUgPT09ICdyZXF1aXJlJyB8fCBtb2RlID09PSAndmVyaWZ5LWNhJyB8fCBtb2RlID09PSAndmVyaWZ5LWZ1bGwnKSB7XG4gICAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG4gIH1cblxuICBjb25zdCBob3N0ID0gdXJsLmhvc3RuYW1lXG4gIGlmIChob3N0ID09PSAnbG9jYWxob3N0JyB8fCBob3N0ID09PSAnMTI3LjAuMC4xJykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxufVxuXG4vKipcbiAqIFN0cmlwIFNTTCBxdWVyeSBwYXJhbXMgZnJvbSBhIFBvc3RncmVzIFVSTCBiZWZvcmUgcGFzc2luZyBpdCB0byBgcGdgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBbXG4gICAgICAnc3NsbW9kZScsXG4gICAgICAnc3NsJyxcbiAgICAgICdzc2xyb290Y2VydCcsXG4gICAgICAnc3NsY2VydCcsXG4gICAgICAnc3Nsa2V5JyxcbiAgICBdKSB7XG4gICAgICB1cmwuc2VhcmNoUGFyYW1zLmRlbGV0ZShrZXkpXG4gICAgfVxuICAgIHJldHVybiB1cmwudG9TdHJpbmcoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZGF0YWJhc2VVcmxcbiAgfVxufVxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjcmVhdGVLeXNlbHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cydcblxuZXhwb3J0IHsgZW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcblxuZXhwb3J0IGNvbnN0IGRiID0gY3JlYXRlS3lzZWx5PERhdGFiYXNlPih7XG4gIGRlZmF1bHREYXRhYmFzZTogJ3RpbWVtYW5hZ2VyJyxcbn0pXG4iLCAiY29uc3QgREVWSUNFX1BMQVRGT1JNUyA9IG5ldyBTZXQoWydpb3MnLCAnYW5kcm9pZCcsICd3ZWInXSlcblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0ocGxhdGZvcm06IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBwbGF0Zm9ybS50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIURFVklDRV9QTEFURk9STVMuaGFzKG5vcm1hbGl6ZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwbGF0Zm9ybSBtdXN0IGJlIGlvcywgYW5kcm9pZCwgb3Igd2ViJylcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEZXZpY2VUb2tlbih0b2tlbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHRva2VuLnRyaW0oKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPCA4IHx8IHRyaW1tZWQubGVuZ3RoID4gNDA5Nikge1xuICAgIHRocm93IG5ldyBFcnJvcignaW52YWxpZCBkZXZpY2UgdG9rZW4nKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBHb2FsLCBHb2FsQ3ljbGUgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIEdvYWxMaWZlY3ljbGVQaGFzZSA9XG4gIHwgJ3NjaGVkdWxlZCdcbiAgfCAnYWN0aXZlJ1xuICB8ICdwYXVzZWQnXG4gIHwgJ2NvbXBsZXRlZCdcbiAgfCAnYXJjaGl2ZWQnXG4gIHwgJ2ZhaWxlZCdcblxuLyoqIERlcml2ZWQgVUkvQVBJIHBoYXNlIFx1MjAxNCBzY2hlZHVsZWQgaXMgbm90IGEgc3RvcmVkIHN0YXR1cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsaWZlY3ljbGVQaGFzZShcbiAgZ29hbDogUGljazxHb2FsLCAnc3RhdHVzJyB8ICdzdGFydHNfYXQnPixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IEdvYWxMaWZlY3ljbGVQaGFzZSB7XG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ3BhdXNlZCcpIHJldHVybiAncGF1c2VkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdjb21wbGV0ZWQnKSByZXR1cm4gJ2NvbXBsZXRlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnYXJjaGl2ZWQnKSByZXR1cm4gJ2FyY2hpdmVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdmYWlsZWQnKSByZXR1cm4gJ2ZhaWxlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJiBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdCkgPiBub3cpIHtcbiAgICByZXR1cm4gJ3NjaGVkdWxlZCdcbiAgfVxuICByZXR1cm4gJ2FjdGl2ZSdcbn1cblxuLyoqIFRydWUgd2hlbiB0aGUgY3ljbGUgZXZhbHVhdGlvbiB3aW5kb3cgaGFzIGJlZ3VuLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGN5Y2xlSGFzU3RhcnRlZChcbiAgY3ljbGU6IFBpY2s8R29hbEN5Y2xlLCAnc3RhcnRzX2F0Jz4sXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBib29sZWFuIHtcbiAgcmV0dXJuIG5vdyA+PSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpXG59XG4iLCAiaW1wb3J0IHR5cGUge1xuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxFdmVudCxcbiAgR29hbExpbmssXG59IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZVJlc3VsdCB7XG4gIGN1cnJlbnRWYWx1ZTogbnVtYmVyXG4gIGRvbmU6IGJvb2xlYW5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZUNvbnRleHQge1xuICBnb2FsOiBHb2FsXG4gIGN5Y2xlOiBHb2FsQ3ljbGVcbiAgbGlua3M6IEdvYWxMaW5rW11cbiAgZXZlbnRzOiBHb2FsRXZlbnRbXVxuICAvKiogQWN0aXZlIChvciBsYXRlc3QpIGNoaWxkIGN5Y2xlcyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLCBmb3IgY29tcG9zaXRlcy4gKi9cbiAgY2hpbGRDeWNsZXM/OiBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+XG4gIC8qKiBDaGlsZCBkZXBlbmRlbmN5IHdlaWdodHMga2V5ZWQgYnkgY2hpbGQgZ29hbCBpZC4gKi9cbiAgY2hpbGRXZWlnaHRzPzogTWFwPG51bWJlciwgbnVtYmVyPlxuICAvKiogRm9yIGdyb3VwX2FsbF9jb21wbGV0ZTogYWN0aXZpdHkgaWRzIHRoYXQgYmVsb25nIHRvIGxpbmtlZCBncm91cHMuICovXG4gIGdyb3VwQWN0aXZpdHlJZHM/OiBudW1iZXJbXVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmFsdWF0b3Ige1xuICBydWxlVHlwZTogc3RyaW5nXG4gIGV2YWx1YXRlKGN0eDogRXZhbHVhdGVDb250ZXh0KTogRXZhbHVhdGVSZXN1bHRcbn1cblxuLyoqIERlZHVwbGljYXRlIGV2ZW50cyBieSAoYWN0aXZpdHlfaWQsIG9jY3VycmVuY2VfZGF0ZSksIHByZWZlcnJpbmcgZmlyc3QuICovXG5leHBvcnQgZnVuY3Rpb24gZGVkdXBlRXZlbnRzKGV2ZW50czogR29hbEV2ZW50W10pOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICBjb25zdCBvdXQ6IEdvYWxFdmVudFtdID0gW11cbiAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICBjb25zdCBrZXkgPSBldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGV2ZW50Lm9jY3VycmVuY2VfZGF0ZVxuICAgICAgPyBgJHtldmVudC5hY3Rpdml0eV9pZH06JHtldmVudC5vY2N1cnJlbmNlX2RhdGV9OiR7ZXZlbnQubWV0cmljfWBcbiAgICAgIDogYGlkOiR7ZXZlbnQuaWR9YFxuICAgIGlmIChzZWVuLmhhcyhrZXkpKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKGtleSlcbiAgICBvdXQucHVzaChldmVudClcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIGV2ZW50c0luV2luZG93KGV2ZW50czogR29hbEV2ZW50W10sIGN5Y2xlOiBHb2FsQ3ljbGUpOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgY29uc3QgZW5kID0gY3ljbGUuZW5kc19hdCA/IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpLmdldFRpbWUoKSA6IE51bWJlci5QT1NJVElWRV9JTkZJTklUWVxuICByZXR1cm4gZXZlbnRzLmZpbHRlcigoZSkgPT4ge1xuICAgIGNvbnN0IHQgPSBuZXcgRGF0ZShlLm9jY3VycmVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBzdGFydCAmJiB0IDwgZW5kXG4gIH0pXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eV9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eV9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEdyb3VwSWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cF9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5ncm91cF9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIHdlaWdodEZvckV2ZW50KGV2ZW50OiBHb2FsRXZlbnQsIGxpbmtzOiBHb2FsTGlua1tdKTogbnVtYmVyIHtcbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiZcbiAgICAgIGxpbmsuYWN0aXZpdHlfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuYWN0aXZpdHlfaWQgPT09IGxpbmsuYWN0aXZpdHlfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGxpbmsubGlua190eXBlID09PSAnZ3JvdXAnICYmXG4gICAgICBsaW5rLmdyb3VwX2lkICE9IG51bGwgJiZcbiAgICAgIGV2ZW50Lmdyb3VwX2lkID09PSBsaW5rLmdyb3VwX2lkXG4gICAgKSB7XG4gICAgICByZXR1cm4gTnVtYmVyKGxpbmsud2VpZ2h0KVxuICAgIH1cbiAgfVxuICByZXR1cm4gMVxufVxuXG5mdW5jdGlvbiBtYXRjaGVzTGlua3MoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBib29sZWFuIHtcbiAgY29uc3QgYWN0aXZpdGllcyA9IGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzKVxuICBjb25zdCBncm91cHMgPSBsaW5rZWRHcm91cElkcyhsaW5rcylcbiAgaWYgKGFjdGl2aXRpZXMuc2l6ZSA9PT0gMCAmJiBncm91cHMuc2l6ZSA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gIGlmIChldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGFjdGl2aXRpZXMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgcmV0dXJuIHRydWVcbiAgaWYgKGV2ZW50Lmdyb3VwX2lkICE9IG51bGwgJiYgZ3JvdXBzLmhhcyhldmVudC5ncm91cF9pZCkpIHJldHVybiB0cnVlXG4gIHJldHVybiBmYWxzZVxufVxuXG5mdW5jdGlvbiBzdW1XZWlnaHRlZChcbiAgZXZlbnRzOiBHb2FsRXZlbnRbXSxcbiAgbGlua3M6IEdvYWxMaW5rW10sXG4gIG1ldHJpYzogJ2NvdW50JyB8ICdkdXJhdGlvbicsXG4pOiBudW1iZXIge1xuICBsZXQgdG90YWwgPSAwXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKGV2ZW50cykpIHtcbiAgICBpZiAoZXZlbnQubWV0cmljICE9PSBtZXRyaWMpIGNvbnRpbnVlXG4gICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGxpbmtzKSkgY29udGludWVcbiAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBsaW5rcylcbiAgfVxuICByZXR1cm4gdG90YWxcbn1cblxuZnVuY3Rpb24gd2l0aENhcnJ5T3Zlcih2YWx1ZTogbnVtYmVyLCBjeWNsZTogR29hbEN5Y2xlKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIHZhbHVlICsgTnVtYmVyKGN5Y2xlLmNhcnJ5X292ZXIgfHwgMCkpXG59XG5cbmZ1bmN0aW9uIHJlc3VsdCh2YWx1ZTogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IEV2YWx1YXRlUmVzdWx0IHtcbiAgY29uc3QgY3VycmVudFZhbHVlID0gTWF0aC5tYXgoMCwgdmFsdWUpXG4gIHJldHVybiB7XG4gICAgY3VycmVudFZhbHVlLFxuICAgIGRvbmU6IHRhcmdldCA+IDAgPyBjdXJyZW50VmFsdWUgPj0gdGFyZ2V0IDogY3VycmVudFZhbHVlID4gMCxcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYWN0aXZpdHlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdhY3Rpdml0eV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2R1cmF0aW9uJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2R1cmF0aW9uJyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdyb3VwRHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyBvZiBhbnkgYWN0aXZpdHkgaW4gbGlua2VkIGdyb3Vwcy4gKi9cbmV4cG9ydCBjb25zdCBncm91cEFueUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2FueV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBncm91cENvdW50RXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqXG4gKiBQcm9ncmVzcyA9IG51bWJlciBvZiBkaXN0aW5jdCBsaW5rZWQtZ3JvdXAgYWN0aXZpdGllcyBjb21wbGV0ZWQgYXQgbGVhc3RcbiAqIG9uY2UgaW4gdGhlIGN5Y2xlLiBUYXJnZXQgaXMgdHlwaWNhbGx5IHRoZSBzaXplIG9mIHRoZSBncm91cC5cbiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYWxsX2NvbXBsZXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgYWN0aXZpdHlJZHMgPSBuZXcgU2V0KGN0eC5ncm91cEFjdGl2aXR5SWRzID8/IFtdKVxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkID09IG51bGwpIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgJiYgIWFjdGl2aXR5SWRzLmhhcyhldmVudC5hY3Rpdml0eV9pZCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSAmJiBhY3Rpdml0eUlkcy5zaXplID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKGFjdGl2aXR5SWRzLnNpemUgPiAwIHx8IG1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkge1xuICAgICAgICBjb21wbGV0ZWQuYWRkKGV2ZW50LmFjdGl2aXR5X2lkKVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBQcmVmZXIgY291bnRpbmcgb25seSBhY3Rpdml0aWVzIHRoYXQgYmVsb25nIHRvIHRoZSBncm91cC5cbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBhY3Rpdml0eUlkcy5zaXplID4gMFxuICAgICAgICA/IFsuLi5jb21wbGV0ZWRdLmZpbHRlcigoaWQpID0+IGFjdGl2aXR5SWRzLmhhcyhpZCkpLmxlbmd0aFxuICAgICAgICA6IGNvbXBsZXRlZC5zaXplLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBtdWx0aUFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnbXVsdGlfYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICByZXR1cm4gYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvci5ldmFsdWF0ZShjdHgpXG4gIH0sXG59XG5cbi8qKiBDb25zZWN1dGl2ZSBjYWxlbmRhciBkYXlzIHdpdGggYXQgbGVhc3Qgb25lIG1hdGNoaW5nIGNvdW50IGV2ZW50LiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha0V2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdzdHJlYWsnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBkYXlzID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGRheSA9IGV2ZW50Lm9jY3VycmVuY2VfZGF0ZSA/P1xuICAgICAgICBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbiAgICAgIGRheXMuYWRkKGRheSlcbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLmRheXNdLnNvcnQoKVxuICAgIGxldCBiZXN0ID0gMFxuICAgIGxldCBydW4gPSAwXG4gICAgbGV0IHByZXY6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gICAgZm9yIChjb25zdCBkYXkgb2Ygc29ydGVkKSB7XG4gICAgICBpZiAocHJldikge1xuICAgICAgICBjb25zdCBwcmV2RGF0ZSA9IG5ldyBEYXRlKHByZXYgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGN1ckRhdGUgPSBuZXcgRGF0ZShkYXkgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGRpZmYgPSAoY3VyRGF0ZS5nZXRUaW1lKCkgLSBwcmV2RGF0ZS5nZXRUaW1lKCkpIC8gODZfNDAwXzAwMFxuICAgICAgICBydW4gPSBkaWZmID09PSAxID8gcnVuICsgMSA6IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJ1biA9IDFcbiAgICAgIH1cbiAgICAgIGJlc3QgPSBNYXRoLm1heChiZXN0LCBydW4pXG4gICAgICBwcmV2ID0gZGF5XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihiZXN0LCBjdHguY3ljbGUpXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG4vKiogQ291bnQgY29tcGxldGlvbnMgd2hvc2Ugb2NjdXJyZW5jZSBsb2NhbCB0aW1lIGlzIGJlZm9yZSBjb25maWcuYmVmb3JlX3RpbWUuICovXG5leHBvcnQgY29uc3QgdGltZU9mRGF5Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAndGltZV9vZl9kYXlfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCBjb25maWcgPSB0eXBlb2YgY3R4LmdvYWwuY29uZmlnID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKGN0eC5nb2FsLmNvbmZpZylcbiAgICAgIDogKGN0eC5nb2FsLmNvbmZpZyA/PyB7fSlcbiAgICBjb25zdCBiZWZvcmUgPSB0eXBlb2YgY29uZmlnLmJlZm9yZV90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5iZWZvcmVfdGltZSA6IG51bGxcbiAgICBjb25zdCBhZnRlciA9IHR5cGVvZiBjb25maWcuYWZ0ZXJfdGltZSA9PT0gJ3N0cmluZycgPyBjb25maWcuYWZ0ZXJfdGltZSA6IG51bGxcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBsZXQgdG90YWwgPSAwXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykpIGNvbnRpbnVlXG4gICAgICBjb25zdCBoaG1tID0gbmV3IERhdGUoZXZlbnQub2NjdXJyZWRfYXQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsIDE2KVxuICAgICAgaWYgKGJlZm9yZSAmJiBoaG1tID49IGJlZm9yZSkgY29udGludWVcbiAgICAgIGlmIChhZnRlciAmJiBoaG1tIDwgYWZ0ZXIpIGNvbnRpbnVlXG4gICAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBjdHgubGlua3MpXG4gICAgfVxuICAgIHJldHVybiByZXN1bHQod2l0aENhcnJ5T3Zlcih0b3RhbCwgY3R4LmN5Y2xlKSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgY29tcG9zaXRlRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2NvbXBvc2l0ZScsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWcuY29tcG9zaXRlX21vZGUgPz8gJ2FsbCdcbiAgICBjb25zdCBjaGlsZHJlbiA9IGN0eC5jaGlsZEN5Y2xlc1xuICAgIGlmICghY2hpbGRyZW4gfHwgY2hpbGRyZW4uc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHJlc3VsdCgwLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IFsuLi5jaGlsZHJlbi5lbnRyaWVzKCldXG4gICAgaWYgKG1vZGUgPT09ICd3ZWlnaHRlZCcpIHtcbiAgICAgIGxldCB3ZWlnaHRlZFN1bSA9IDBcbiAgICAgIGxldCB3ZWlnaHRUb3RhbCA9IDBcbiAgICAgIGZvciAoY29uc3QgW2NoaWxkSWQsIGN5Y2xlXSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IHcgPSBOdW1iZXIoY3R4LmNoaWxkV2VpZ2h0cz8uZ2V0KGNoaWxkSWQpID8/IDEpXG4gICAgICAgIGNvbnN0IHByb2dyZXNzID0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwXG4gICAgICAgICAgPyBNYXRoLm1pbigxLCBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgLyBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICAgICAgICA6IChjeWNsZS5zdGF0dXMgPT09ICdzdWNjZWVkZWQnID8gMSA6IDApXG4gICAgICAgIHdlaWdodGVkU3VtICs9IHByb2dyZXNzICogd1xuICAgICAgICB3ZWlnaHRUb3RhbCArPSB3XG4gICAgICB9XG4gICAgICBjb25zdCBwY3QgPSB3ZWlnaHRUb3RhbCA+IDAgPyB3ZWlnaHRlZFN1bSAvIHdlaWdodFRvdGFsIDogMFxuICAgICAgLy8gUmVwcmVzZW50IGFzIDBcdTIwMTMxMDAgcGVyY2VudCBvZiB0YXJnZXQuXG4gICAgICBjb25zdCB2YWx1ZSA9IHBjdCAqIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IGVudHJpZXMuZmlsdGVyKChbLCBjXSkgPT5cbiAgICAgIGMuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjLnRhcmdldF92YWx1ZSkgPiAwICYmIE51bWJlcihjLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjLnRhcmdldF92YWx1ZSkpXG4gICAgKS5sZW5ndGhcblxuICAgIGlmIChtb2RlID09PSAnYW55Jykge1xuICAgICAgY29uc3QgbmVlZGVkID0gTWF0aC5tYXgoMSwgTnVtYmVyKGNvbmZpZy5jb3VudF9yZXF1aXJlZCA/PyAxKSlcbiAgICAgIHJldHVybiByZXN1bHQoY29tcGxldGVkLCBuZWVkZWQpXG4gICAgfVxuXG4gICAgLy8gYWxsXG4gICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIGVudHJpZXMubGVuZ3RoKVxuICB9LFxufVxuXG5jb25zdCBFVkFMVUFUT1JTOiBHb2FsRXZhbHVhdG9yW10gPSBbXG4gIGFjdGl2aXR5Q291bnRFdmFsdWF0b3IsXG4gIGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwRHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwQ291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQW55Q291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3IsXG4gIG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgc3RyZWFrRXZhbHVhdG9yLFxuICB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcixcbiAgY29tcG9zaXRlRXZhbHVhdG9yLFxuXVxuXG5jb25zdCBSRUdJU1RSWSA9IG5ldyBNYXAoRVZBTFVBVE9SUy5tYXAoKGUpID0+IFtlLnJ1bGVUeXBlLCBlXSkpXG5cbmV4cG9ydCBjb25zdCBHT0FMX1JVTEVfVFlQRVMgPSBFVkFMVUFUT1JTLm1hcCgoZSkgPT4gZS5ydWxlVHlwZSlcblxuZXhwb3J0IGZ1bmN0aW9uIGdldEV2YWx1YXRvcihydWxlVHlwZTogc3RyaW5nKTogR29hbEV2YWx1YXRvciB7XG4gIGNvbnN0IGV2YWx1YXRvciA9IFJFR0lTVFJZLmdldChydWxlVHlwZSlcbiAgaWYgKCFldmFsdWF0b3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZ29hbCBydWxlX3R5cGU6ICR7cnVsZVR5cGV9YClcbiAgfVxuICByZXR1cm4gZXZhbHVhdG9yXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZUdvYWwoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdCB7XG4gIHJldHVybiBnZXRFdmFsdWF0b3IoY3R4LmdvYWwucnVsZV90eXBlKS5ldmFsdWF0ZShjdHgpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5JztcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbEV2ZW50LFxuICBHb2FsTGluayxcbn0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJztcbmltcG9ydCB7IGN5Y2xlSGFzU3RhcnRlZCB9IGZyb20gJy4vbGlmZWN5Y2xlLnRzJztcbmltcG9ydCB7IGV2YWx1YXRlR29hbCB9IGZyb20gJy4vZXZhbHVhdG9ycy9pbmRleC50cyc7XG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPjtcblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9IGFzIFQ7XG4gICAgfVxuICB9XG4gIHJldHVybiAodmFsdWUgPz8ge30pIGFzIFQ7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEdvYWxMaW5rcyhcbiAgZGI6IERiTGlrZSxcbiAgZ29hbElkOiBudW1iZXIsXG4pOiBQcm9taXNlPEdvYWxMaW5rW10+IHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEV2ZW50c0ZvclVzZXIoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBmcm9tPzogRGF0ZSB8IHN0cmluZyxcbiAgdG8/OiBEYXRlIHwgc3RyaW5nLFxuKTogUHJvbWlzZTxHb2FsRXZlbnRbXT4ge1xuICBsZXQgcXVlcnkgPSBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2V2ZW50cycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpO1xuXG4gIGlmIChmcm9tKSB7XG4gICAgY29uc3QgZnJvbURhdGUgPSB0eXBlb2YgZnJvbSA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZShmcm9tKSA6IGZyb207XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnb2NjdXJyZWRfYXQnLCAnPj0nLCBmcm9tRGF0ZSBhcyBuZXZlcik7XG4gIH1cbiAgaWYgKHRvKSB7XG4gICAgY29uc3QgdG9EYXRlID0gdHlwZW9mIHRvID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKHRvKSA6IHRvO1xuICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ29jY3VycmVkX2F0JywgJzwnLCB0b0RhdGUgYXMgbmV2ZXIpO1xuICB9XG5cbiAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZ3JvdXBBY3Rpdml0eUlkc0ZvckxpbmtzKFxuICBkYjogRGJMaWtlLFxuICBsaW5rczogR29hbExpbmtbXSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlcltdPiB7XG4gIGNvbnN0IGdyb3VwSWRzID0gbGlua3NcbiAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwX2lkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5ncm91cF9pZCEpO1xuICBpZiAoZ3JvdXBJZHMubGVuZ3RoID09PSAwKSByZXR1cm4gW107XG5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2FjdGl2aXRpZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnZ3JvdXBfaWQnLCAnaW4nLCBncm91cElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKTtcbiAgcmV0dXJuIHJvd3MubWFwKChyKSA9PiByLmlkKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hDaGlsZEN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgZ29hbElkOiBudW1iZXIsXG4pOiBQcm9taXNlPHsgY3ljbGVzOiBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+OyB3ZWlnaHRzOiBNYXA8bnVtYmVyLCBudW1iZXI+IH0+IHtcbiAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIGNvbnN0IGN5Y2xlcyA9IG5ldyBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+KCk7XG4gIGNvbnN0IHdlaWdodHMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpO1xuXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICB3ZWlnaHRzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBOdW1iZXIoZGVwLndlaWdodCkpO1xuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG5cbiAgICBpZiAoY3ljbGUpIHtcbiAgICAgIGN5Y2xlcy5zZXQoZGVwLmRlcGVuZHNfb25fZ29hbF9pZCwgY3ljbGUpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgY29uc3QgbGF0ZXN0ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKGxhdGVzdCkgY3ljbGVzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBsYXRlc3QpO1xuICB9XG5cbiAgcmV0dXJuIHsgY3ljbGVzLCB3ZWlnaHRzIH07XG59XG5cbi8qKlxuICogV2hldGhlciBoaXR0aW5nIHRoZSB0YXJnZXQgc2hvdWxkIGNsb3NlIHRoZSBjeWNsZSBpbW1lZGlhdGVseS5cbiAqIFJlY3VycmluZyBjeWNsZXMgc3RheSBgYWN0aXZlYCB1bnRpbCByb2xsLW92ZXIgYXQgZW5kc19hdCBzbyB0aGUgVUkga2VlcHNcbiAqIGFuIGFjdGl2ZUN5Y2xlIChhbmQgcHJvZ3Jlc3MpIGZvciB0aGUgcmVzdCBvZiB0aGUgd2luZG93LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2hvdWxkQ2xvc2VDeWNsZU9uVGFyZ2V0KFxuICBnb2FsOiBQaWNrPEdvYWwsICdyZWN1cnJlbmNlJz4sXG4pOiBib29sZWFuIHtcbiAgcmV0dXJuIGdvYWwucmVjdXJyZW5jZSA9PSBudWxsO1xufVxuXG4vKipcbiAqIFJlY29tcHV0ZSBhbmQgcGVyc2lzdCBjdXJyZW50X3ZhbHVlIGZvciBhIHNpbmdsZSBjeWNsZS5cbiAqIFJldHVybnMgdGhlIHVwZGF0ZWQgY3ljbGUuXG4gKiBTa2lwcyBhY2NydWFsIHdoaWxlIHRoZSBjeWNsZSBoYXMgbm90IHN0YXJ0ZWQgKGtlZXBzIGN1cnJlbnRfdmFsdWUgYXQgMCxcbiAqIG5ldmVyIGF1dG8tc3VjY2VlZHMpIFx1MjAxNCBjb3ZlcnMgY29tcG9zaXRlIHBhcmVudHMgY29tcGxldGluZyBlYXJseSB2aWEgY2hpbGRyZW4uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVDeWNsZShcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGlmIChjeWNsZS5zdGF0dXMgPT09ICdhY3RpdmUnICYmICFjeWNsZUhhc1N0YXJ0ZWQoY3ljbGUsIG5vdykpIHtcbiAgICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID09PSAwKSByZXR1cm4gY3ljbGU7XG4gICAgY29uc3Qgc3RhbXBlZCA9IG5vdy50b0lTT1N0cmluZygpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAuc2V0KHsgY3VycmVudF92YWx1ZTogMCwgdXBkYXRlZF9hdDogc3RhbXBlZCB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9XG5cbiAgY29uc3QgbGlua3MgPSBhd2FpdCBmZXRjaEdvYWxMaW5rcyhkYiwgZ29hbC5pZCk7XG4gIGNvbnN0IGV2ZW50cyA9IGF3YWl0IGZldGNoRXZlbnRzRm9yVXNlcihcbiAgICBkYixcbiAgICBnb2FsLnVzZXJfaWQsXG4gICAgY3ljbGUuc3RhcnRzX2F0LFxuICAgIGN5Y2xlLmVuZHNfYXQgPz8gdW5kZWZpbmVkLFxuICApO1xuICBjb25zdCBncm91cEFjdGl2aXR5SWRzID0gYXdhaXQgZ3JvdXBBY3Rpdml0eUlkc0ZvckxpbmtzKFxuICAgIGRiLFxuICAgIGxpbmtzLFxuICAgIGdvYWwudXNlcl9pZCxcbiAgKTtcbiAgY29uc3QgeyBjeWNsZXM6IGNoaWxkQ3ljbGVzLCB3ZWlnaHRzOiBjaGlsZFdlaWdodHMgfSA9XG4gICAgZ29hbC5ydWxlX3R5cGUgPT09ICdjb21wb3NpdGUnXG4gICAgICA/IGF3YWl0IGZldGNoQ2hpbGRDeWNsZXMoZGIsIGdvYWwuaWQpXG4gICAgICA6IHtcbiAgICAgICAgICBjeWNsZXM6IG5ldyBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+KCksXG4gICAgICAgICAgd2VpZ2h0czogbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKSxcbiAgICAgICAgfTtcblxuICBjb25zdCB7IGN1cnJlbnRWYWx1ZSwgZG9uZSB9ID0gZXZhbHVhdGVHb2FsKHtcbiAgICBnb2FsOiB7XG4gICAgICAuLi5nb2FsLFxuICAgICAgY29uZmlnOiBwYXJzZUpzb24oZ29hbC5jb25maWcpLFxuICAgIH0sXG4gICAgY3ljbGUsXG4gICAgbGlua3MsXG4gICAgZXZlbnRzLFxuICAgIGNoaWxkQ3ljbGVzLFxuICAgIGNoaWxkV2VpZ2h0cyxcbiAgICBncm91cEFjdGl2aXR5SWRzLFxuICB9KTtcblxuICBjb25zdCBub3dJc28gPSBub3cudG9JU09TdHJpbmcoKTtcbiAgbGV0IHN0YXR1cyA9IGN5Y2xlLnN0YXR1cztcbiAgLy8gT25lLXRpbWUgZ29hbHMgY2xvc2UgYXMgc29vbiBhcyB0aGUgdGFyZ2V0IGlzIG1ldC4gUmVjdXJyaW5nIGN5Y2xlcyBzdGF5XG4gIC8vIGFjdGl2ZSB1bnRpbCByb2xsT3ZlcklmTmVlZGVkIGNsb3NlcyB0aGVtIGF0IGVuZHNfYXQgXHUyMDE0IG90aGVyd2lzZVxuICAvLyBhY3RpdmVDeWNsZSBnb2VzIG51bGwgbWlkLXdpbmRvdyBhbmQgdGhlIGNsaWVudCBzaG93cyAwJSBwcm9ncmVzcy5cbiAgaWYgKFxuICAgIGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiZcbiAgICBkb25lICYmXG4gICAgc2hvdWxkQ2xvc2VDeWNsZU9uVGFyZ2V0KGdvYWwpXG4gICkge1xuICAgIHN0YXR1cyA9ICdzdWNjZWVkZWQnO1xuICB9XG5cbiAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBjdXJyZW50X3ZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgICBzdGF0dXMsXG4gICAgICB1cGRhdGVkX2F0OiBub3dJc28sXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAvLyBEYWlseSBzbmFwc2hvdCBmb3IgaGlzdG9yeSBjaGFydHMgKHVwc2VydCBieSBhc19vZiBkYXRlKS5cbiAgY29uc3QgYXNPZiA9IG5vd0lzby5zbGljZSgwLCAxMCk7XG4gIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGdvYWxfY3ljbGVfaWQ6IHVwZGF0ZWQuaWQsXG4gICAgICBhc19vZjogYXNPZixcbiAgICAgIHZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgfSlcbiAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICBvYy5jb2x1bW5zKFsnZ29hbF9jeWNsZV9pZCcsICdhc19vZiddKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgIHZhbHVlOiBjdXJyZW50VmFsdWUsXG4gICAgICB9KSxcbiAgICApXG4gICAgLmV4ZWN1dGUoKTtcblxuICAvLyBNYXJrIHBhcmVudCBnb2FsIGNvbXBsZXRlZCB3aGVuIGEgb25lLXRpbWUgY3ljbGUgc3VjY2VlZHMuXG4gIGlmIChzdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmICFnb2FsLnJlY3VycmVuY2UgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2NvbXBsZXRlZCcsIHVwZGF0ZWRfYXQ6IG5vd0lzbyB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbC5pZClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH1cblxuICAvLyBFZGdlLXRyaWdnZXIgcmV3YXJkIGdyYW50cyB3aGVuIGEgY3ljbGUgbmV3bHkgc3VjY2VlZHMuXG4gIGlmIChzdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcpIHtcbiAgICBjb25zdCB7IGdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MgfSA9IGF3YWl0IGltcG9ydChcbiAgICAgICcuLi9yZXdhcmRzL2hvb2tzLnRzJ1xuICAgICk7XG4gICAgYXdhaXQgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhkYiwge1xuICAgICAgdXNlcklkOiBnb2FsLnVzZXJfaWQsXG4gICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICBjeWNsZUlkOiB1cGRhdGVkLmlkLFxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHVwZGF0ZWQ7XG59XG5cbi8qKiBSZWNvbXB1dGUgYWxsIGFjdGl2ZSBjeWNsZXMgbGlua2VkIHRvIGFuIGFjdGl2aXR5IG9yIGdyb3VwIHZpYSBnb2FsX2xpbmtzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgb3B0czogeyBhY3Rpdml0eUlkPzogbnVtYmVyIHwgbnVsbDsgZ3JvdXBJZD86IG51bWJlciB8IG51bGwgfSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBnb2FsSWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG5cbiAgaWYgKG9wdHMuYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuYWN0aXZpdHlfaWQnLCAnPScsIG9wdHMuYWN0aXZpdHlJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgaWYgKG9wdHMuZ3JvdXBJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuZ3JvdXBfaWQnLCAnPScsIG9wdHMuZ3JvdXBJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgLy8gQWxzbyByZWNvbXB1dGUgY29tcG9zaXRlcyB0aGF0IGRlcGVuZCBvbiBhZmZlY3RlZCBnb2Fscy5cbiAgaWYgKGdvYWxJZHMuc2l6ZSA+IDApIHtcbiAgICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAud2hlcmUoJ2RlcGVuZHNfb25fZ29hbF9pZCcsICdpbicsIFsuLi5nb2FsSWRzXSlcbiAgICAgIC5zZWxlY3QoJ2dvYWxfaWQnKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwcykgZ29hbElkcy5hZGQoZC5nb2FsX2lkKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZ29hbElkIG9mIGdvYWxJZHMpIHtcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWdvYWwgfHwgZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnIHx8IGdvYWwuc3RhdHVzID09PSAnYXJjaGl2ZWQnKVxuICAgICAgY29udGludWU7XG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKCFjeWNsZSkgY29udGludWU7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICB9XG59XG5cbi8qKiBGdWxsIHJlY29tcHV0ZSBvZiBldmVyeSBhY3RpdmUgY3ljbGUgZm9yIGEgdXNlciAocmVwYWlyIHBhdGgpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3N0YXR1cycsICdpbicsIFsnYWN0aXZlJywgJ2NvbXBsZXRlZCcsICdmYWlsZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIGxldCBjb3VudCA9IDA7XG4gIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgIGNvbnN0IGN5Y2xlcyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgY3ljbGUgb2YgY3ljbGVzKSB7XG4gICAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICAgICAgY291bnQrKztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvdW50O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIHByZXNldCBwYWxldHRlIGZvciBhY3Rpdml0eSBncm91cHMuXG4gKiBLZWVwIGluIHN5bmMgd2l0aCBGbHV0dGVyIGBsaWIvdGhlbWUvdG9rZW5zL2dyb3VwX3BhbGV0dGUuZGFydGAuXG4gKi9cbmV4cG9ydCBjb25zdCBHUk9VUF9DT0xPUl9QQUxFVFRFID0gW1xuICAnIzBGNzY2RScsIC8vIHRlYWwgKGJyYW5kKVxuICAnIzI1NjNFQicsIC8vIGJsdWVcbiAgJyM3QzNBRUQnLCAvLyB2aW9sZXRcbiAgJyNEQjI3NzcnLCAvLyBwaW5rXG4gICcjREMyNjI2JywgLy8gcmVkXG4gICcjRUE1ODBDJywgLy8gb3JhbmdlXG4gICcjQ0E4QTA0JywgLy8geWVsbG93XG4gICcjMTZBMzRBJywgLy8gZ3JlZW5cbiAgJyMwODkxQjInLCAvLyBjeWFuXG4gICcjNEI1NTYzJywgLy8gZ3JheVxuXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBHcm91cENvbG9yID0gKHR5cGVvZiBHUk9VUF9DT0xPUl9QQUxFVFRFKVtudW1iZXJdXG5cbmNvbnN0IEhFWF9DT0xPUl9SRSA9IC9eI1swLTlBLUZhLWZdezZ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQWxsb3dlZEdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IGNvbG9yIGlzIEdyb3VwQ29sb3Ige1xuICBpZiAoIUhFWF9DT0xPUl9SRS50ZXN0KGNvbG9yKSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjb2xvci50b1VwcGVyQ2FzZSgpXG4gIHJldHVybiAoR1JPVVBfQ09MT1JfUEFMRVRURSBhcyByZWFkb25seSBzdHJpbmdbXSkuc29tZShcbiAgICAoYykgPT4gYy50b1VwcGVyQ2FzZSgpID09PSBub3JtYWxpemVkLFxuICApXG59XG5cbi8qKiBOb3JtYWxpemUgdG8gY2Fub25pY2FsIGAjUlJHR0JCYCB1cHBlcmNhc2UgZnJvbSB0aGUgYWxsb3dsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IEdyb3VwQ29sb3Ige1xuICBjb25zdCBtYXRjaCA9IChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5maW5kKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IGNvbG9yLnRvVXBwZXJDYXNlKCksXG4gIClcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncm91cCBjb2xvcjogJHtjb2xvcn1gKVxuICB9XG4gIHJldHVybiBtYXRjaCBhcyBHcm91cENvbG9yXG59XG4iLCAiaW1wb3J0IHsgUmVjdXJyZW5jZUNvbmZpZywgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBpc0FsbG93ZWRHcm91cENvbG9yLCBub3JtYWxpemVHcm91cENvbG9yIH0gZnJvbSAnLi9ncm91cF9wYWxldHRlLnRzJ1xuaW1wb3J0IHsgR09BTF9SVUxFX1RZUEVTIH0gZnJvbSAnLi4vZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVhZGxpbmVJbnB1dCxcbiAgR29hbERlcGVuZGVuY3lJbnB1dCxcbiAgR29hbExpbmtJbnB1dCxcbiAgR29hbFJlY3VycmVuY2VJbnB1dCxcbiAgVXBkYXRlR29hbElucHV0LFxufSBmcm9tICcuL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdyb3VwRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRDb21wbGV0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRHb2FsRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5pbnRlcmZhY2UgQWN0aXZpdHlTY2hlZHVsZSB7XG4gIGlzUmVjdXJyaW5nOiBib29sZWFuXG4gIGRhdGU/OiBzdHJpbmcgfCBudWxsXG4gIHJlY3VycmVuY2VQYXR0ZXJuPzogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGxcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhbiBhY3Rpdml0eSdzIHNjaGVkdWxlIGlzIGludGVybmFsbHkgY29uc2lzdGVudDpcbiAqIC0gTm9uLXJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIGBkYXRlYCBhbmQgbm8gcmVjdXJyZW5jZSBwYXR0ZXJuLlxuICogLSBSZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSByZWN1cnJlbmNlIHBhdHRlcm4gKGFuZCBubyBgZGF0ZWApLFxuICogICB3aXRoIGNvbmZpZyBmaWVsZHMgbWF0Y2hpbmcgdGhlIGNob3NlbiByZWN1cnJlbmNlIHR5cGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoaW5wdXQ6IEFjdGl2aXR5U2NoZWR1bGUpOiB2b2lkIHtcbiAgaWYgKCFpbnB1dC5pc1JlY3VycmluZykge1xuICAgIGlmICghaW5wdXQuZGF0ZSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgICdkYXRlIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgZmFsc2UnLFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybiBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIHRydWUnLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHsgcmVjdXJyZW5jZVR5cGUsIGNvbmZpZyB9ID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm5cbiAgaWYgKCFjb25maWcgfHwgIWNvbmZpZy5zdGFydF9kYXRlKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnLnN0YXJ0X2RhdGUgaXMgcmVxdWlyZWQnLFxuICAgIClcbiAgfVxuXG4gIHN3aXRjaCAocmVjdXJyZW5jZVR5cGUpIHtcbiAgICBjYXNlICd3ZWVrbHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZXZWVrKGNvbmZpZy5kYXlzX29mX3dlZWspXG4gICAgICBicmVha1xuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZNb250aChjb25maWcuZGF5c19vZl9tb250aCwgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgdmFsaWRhdGVJbnRlcnZhbERheXMoY29uZmlnLmludGVydmFsX2RheXMpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgYFVuc3VwcG9ydGVkIHJlY3VycmVuY2VUeXBlOiAke3JlY3VycmVuY2VUeXBlfWAsXG4gICAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBncm91cCBjb2xvciBhZ2FpbnN0IHRoZSBzaGFyZWQgaGV4IGFsbG93bGlzdC5cbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBwYWxldHRlIHZhbHVlIChlLmcuIGAjMEY3NjZFYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoXG4gICAgICAnY29sb3IgbXVzdCBiZSBhIGhleCB2YWx1ZSBmcm9tIHRoZSBncm91cCBwYWxldHRlIChlLmcuICMwRjc2NkUpJyxcbiAgICApXG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3IpXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGdyb3VwIG5hbWUgaXMgbm9uLWVtcHR5IGFmdGVyIHRyaW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5jb25zdCBEQVRFX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBUSU1FX1JFID0gL15cXGR7Mn06XFxkezJ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoZGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFEQVRFX1JFLnRlc3QoZGF0ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignb2NjdXJyZW5jZURhdGUgbXVzdCBiZSBZWVlZLU1NLUREJylcbiAgfVxuICByZXR1cm4gZGF0ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXModmFsdWU6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8IDAgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ2R1cmF0aW9uTWludXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZXZWVrKGRheXNPZldlZWs6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2Zfd2VlayddKTogdm9pZCB7XG4gIGlmICghZGF5c09mV2VlayB8fCBkYXlzT2ZXZWVrLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgaXMgcmVxdWlyZWQgZm9yIHdlZWtseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKGRheXNPZldlZWsuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDAgfHwgZGF5ID4gNikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDAgKFN1bmRheSkgYW5kIDYgKFNhdHVyZGF5KScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mTW9udGgoXG4gIGRheXNPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX21vbnRoJ10sXG4gIGlzTGFzdERheU9mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2lzX2xhc3RfZGF5X29mX21vbnRoJ10sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFzRGF5c09mTW9udGggPSAhIWRheXNPZk1vbnRoICYmIGRheXNPZk1vbnRoLmxlbmd0aCA+IDBcbiAgaWYgKCFoYXNEYXlzT2ZNb250aCAmJiAhaXNMYXN0RGF5T2ZNb250aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG9yIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aCBpcyByZXF1aXJlZCBmb3IgbW9udGhseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKFxuICAgIGhhc0RheXNPZk1vbnRoICYmXG4gICAgZGF5c09mTW9udGghLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAxIHx8IGRheSA+IDMxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAxIGFuZCAzMScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGludGVydmFsRGF5czogUmVjdXJyZW5jZUNvbmZpZ1snaW50ZXJ2YWxfZGF5cyddKTogdm9pZCB7XG4gIGlmIChcbiAgICBpbnRlcnZhbERheXMgPT09IHVuZGVmaW5lZCB8fFxuICAgIGludGVydmFsRGF5cyA9PT0gbnVsbCB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGludGVydmFsRGF5cykgfHxcbiAgICBpbnRlcnZhbERheXMgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5pbnRlcnZhbF9kYXlzIG11c3QgYmUgYW4gaW50ZWdlciA+PSAxIGZvciBldmVyeV94X2RheXMgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxUaXRsZSh0aXRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHRpdGxlLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0aXRsZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIG11c3QgYmUgYXQgbW9zdCAyNTUgY2hhcmFjdGVycycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUnVsZVR5cGUocnVsZVR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghR09BTF9SVUxFX1RZUEVTLmluY2x1ZGVzKHJ1bGVUeXBlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgYHJ1bGVUeXBlIG11c3QgYmUgb25lIG9mOiAke0dPQUxfUlVMRV9UWVBFUy5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiBydWxlVHlwZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUYXJnZXRWYWx1ZSh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGFyZ2V0VmFsdWUgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxMaW5rcyhcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxMaW5rSW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBsaW5rcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnKSB7XG4gICAgaWYgKGxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyBtdXN0IG5vdCBoYXZlIGFjdGl2aXR5L2dyb3VwIGxpbmtzJylcbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2F0IGxlYXN0IG9uZSBsaW5rIGlzIHJlcXVpcmVkJylcbiAgfVxuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlzdCkge1xuICAgIGlmIChsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBpZiAobGluay5hY3Rpdml0eUlkID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIHJlcXVpcmUgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgICBpZiAobGluay5ncm91cElkICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIG11c3Qgbm90IHNldCBncm91cElkJylcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxpbmsubGlua1R5cGUgPT09ICdncm91cCcpIHtcbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgcmVxdWlyZSBncm91cElkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgbXVzdCBub3Qgc2V0IGFjdGl2aXR5SWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGlua1R5cGUgbXVzdCBiZSBhY3Rpdml0eSBvciBncm91cCcpXG4gICAgfVxuICAgIGlmIChsaW5rLndlaWdodCAhPSBudWxsICYmICghTnVtYmVyLmlzRmluaXRlKGxpbmsud2VpZ2h0KSB8fCBsaW5rLndlaWdodCA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2xpbmsgd2VpZ2h0IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10gfCB1bmRlZmluZWQsXG4gIHJ1bGVUeXBlOiBzdHJpbmcsXG4pOiBHb2FsRGVwZW5kZW5jeUlucHV0W10ge1xuICBjb25zdCBsaXN0ID0gZGVwcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnICYmIGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyByZXF1aXJlIGF0IGxlYXN0IG9uZSBkZXBlbmRlbmN5JylcbiAgfVxuICBmb3IgKGNvbnN0IGRlcCBvZiBsaXN0KSB7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGRlcC5kZXBlbmRzT25Hb2FsSWQpIHx8IGRlcC5kZXBlbmRzT25Hb2FsSWQgPD0gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZHNPbkdvYWxJZCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPSBudWxsICYmXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT09ICdjb21wbGV0ZScgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ3Byb2dyZXNzJ1xuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlcXVpcmVtZW50IG11c3QgYmUgY29tcGxldGUgb3IgcHJvZ3Jlc3MnKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB7XG4gIGlmIChyZWN1cnJlbmNlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHBlcmlvZHMgPSBbJ3dlZWtseScsICdtb250aGx5JywgJ3F1YXJ0ZXJseScsICdldmVyeV94X2RheXMnXVxuICBpZiAoIXBlcmlvZHMuaW5jbHVkZXMocmVjdXJyZW5jZS5wZXJpb2QpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYHVuc3VwcG9ydGVkIHJlY3VycmVuY2UgcGVyaW9kOiAke3JlY3VycmVuY2UucGVyaW9kfWApXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuaW50ZXJ2YWwgIT0gbnVsbCAmJlxuICAgICghTnVtYmVyLmlzSW50ZWdlcihyZWN1cnJlbmNlLmludGVydmFsKSB8fCByZWN1cnJlbmNlLmludGVydmFsIDwgMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlY3VycmVuY2UuaW50ZXJ2YWwgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEnKVxuICB9XG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPSBudWxsICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdub25lJyAmJlxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9PSAnb3ZlcmZsb3cnXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjYXJyeU92ZXIgbXVzdCBiZSBub25lIG9yIG92ZXJmbG93JylcbiAgfVxuICByZXR1cm4gcmVjdXJyZW5jZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVhZGxpbmUoXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwge1xuICBpZiAoZGVhZGxpbmUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdhYnNvbHV0ZScpIHtcbiAgICBpZiAoIWRlYWRsaW5lLmRhdGUgfHwgIURBVEVfUkUudGVzdChkZWFkbGluZS5kYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2Fic29sdXRlIGRlYWRsaW5lIHJlcXVpcmVzIGRhdGUgWVlZWS1NTS1ERCcpXG4gICAgfVxuICB9IGVsc2UgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScpIHtcbiAgICBpZiAoXG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0ID09IG51bGwgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQpIHx8XG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0IDwgMFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICdyZWxhdGl2ZSBkZWFkbGluZSByZXF1aXJlcyBkYXlzQWZ0ZXJDeWNsZVN0YXJ0ID49IDAnLFxuICAgICAgKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUua2luZCBtdXN0IGJlIGFic29sdXRlIG9yIHJlbGF0aXZlJylcbiAgfVxuICByZXR1cm4gZGVhZGxpbmVcbn1cblxuY29uc3QgTUFYX1NUQVJUX1lFQVJTX0FIRUFEID0gNVxuXG4vKiogUGFyc2UgYW5kIHZhbGlkYXRlIGFuIG9wdGlvbmFsIElTTy04NjAxIHN0YXJ0c0F0LiBSZXR1cm5zIG51bGwgaWYgb21pdHRlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVN0YXJ0c0F0KFxuICBzdGFydHNBdDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKHN0YXJ0c0F0ID09IG51bGwgfHwgc3RhcnRzQXQgPT09ICcnKSByZXR1cm4gbnVsbFxuICBjb25zdCBwYXJzZWQgPSBuZXcgRGF0ZShzdGFydHNBdClcbiAgaWYgKE51bWJlci5pc05hTihwYXJzZWQuZ2V0VGltZSgpKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdzdGFydHNBdCBtdXN0IGJlIGEgdmFsaWQgSVNPLTg2MDEgZGF0ZXRpbWUnKVxuICB9XG4gIGNvbnN0IG1heCA9IG5ldyBEYXRlKG5vdylcbiAgbWF4LnNldFVUQ0Z1bGxZZWFyKG1heC5nZXRVVENGdWxsWWVhcigpICsgTUFYX1NUQVJUX1lFQVJTX0FIRUFEKVxuICBpZiAocGFyc2VkID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICBgc3RhcnRzQXQgbXVzdCBiZSB3aXRoaW4gJHtNQVhfU1RBUlRfWUVBUlNfQUhFQUR9IHllYXJzIGZyb20gbm93YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHBhcnNlZFxufVxuXG4vKiogUmVqZWN0IGFic29sdXRlIGRlYWRsaW5lcyB0aGF0IGVuZCBiZWZvcmUgdGhlIGdvYWwgc3RhcnRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiB2b2lkIHtcbiAgaWYgKCFkZWFkbGluZSB8fCBkZWFkbGluZS5raW5kICE9PSAnYWJzb2x1dGUnIHx8ICFkZWFkbGluZS5kYXRlKSByZXR1cm5cbiAgY29uc3QgZGVhZGxpbmVBdCA9IG5ldyBEYXRlKGRlYWRsaW5lLmRhdGUgKyAnVDIzOjU5OjU5Ljk5OVonKVxuICBpZiAoZGVhZGxpbmVBdCA8IHN0YXJ0c0F0KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlYWRsaW5lIG11c3QgYmUgb24gb3IgYWZ0ZXIgdGhlIGdvYWwgc3RhcnQnKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbikge1xuICBjb25zdCB0aXRsZSA9IHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKVxuICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKVxuICBjb25zdCBydWxlVHlwZSA9IHZhbGlkYXRlUnVsZVR5cGUoaW5wdXQucnVsZVR5cGUpXG4gIGNvbnN0IHRhcmdldFZhbHVlID0gdmFsaWRhdGVUYXJnZXRWYWx1ZShpbnB1dC50YXJnZXRWYWx1ZSlcbiAgaWYgKGlucHV0Lm1ldHJpYyAhPT0gJ2NvdW50JyAmJiBpbnB1dC5tZXRyaWMgIT09ICdkdXJhdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbWV0cmljIG11c3QgYmUgY291bnQgb3IgZHVyYXRpb24nKVxuICB9XG4gIGNvbnN0IGxpbmtzID0gdmFsaWRhdGVHb2FsTGlua3MoaW5wdXQubGlua3MsIHJ1bGVUeXBlKVxuICBjb25zdCBkZXBlbmRlbmNpZXMgPSB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoaW5wdXQuZGVwZW5kZW5jaWVzLCBydWxlVHlwZSlcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSB2YWxpZGF0ZUdvYWxEZWFkbGluZShpbnB1dC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSB2YWxpZGF0ZVN0YXJ0c0F0KGlucHV0LnN0YXJ0c0F0LCBub3cpID8/IG5vd1xuICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIGlmIChpbnB1dC5jb25maWc/LmJlZm9yZVRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYmVmb3JlVGltZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYmVmb3JlVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuICBpZiAoaW5wdXQuY29uZmlnPy5hZnRlclRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYWZ0ZXJUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhZnRlclRpbWUgbXVzdCBiZSBISDptbScpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHRpdGxlLFxuICAgIGNvbG9yLFxuICAgIHJ1bGVUeXBlLFxuICAgIHRhcmdldFZhbHVlLFxuICAgIGxpbmtzLFxuICAgIGRlcGVuZGVuY2llcyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIHN0YXJ0c0F0LFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dCxcbiAgZXhpc3RpbmdSdWxlVHlwZTogc3RyaW5nLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKSB7XG4gIGNvbnN0IHJ1bGVUeXBlID0gaW5wdXQucnVsZVR5cGUgIT0gbnVsbFxuICAgID8gdmFsaWRhdGVSdWxlVHlwZShpbnB1dC5ydWxlVHlwZSlcbiAgICA6IGV4aXN0aW5nUnVsZVR5cGVcblxuICBpZiAoaW5wdXQudGl0bGUgIT0gbnVsbCkgdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpXG4gIGlmIChpbnB1dC5jb2xvciAhPSBudWxsKSB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcilcbiAgaWYgKGlucHV0LnRhcmdldFZhbHVlICE9IG51bGwpIHZhbGlkYXRlVGFyZ2V0VmFsdWUoaW5wdXQudGFyZ2V0VmFsdWUpXG4gIGlmIChpbnB1dC5tZXRyaWMgIT0gbnVsbCAmJiBpbnB1dC5tZXRyaWMgIT09ICdjb3VudCcgJiYgaW5wdXQubWV0cmljICE9PSAnZHVyYXRpb24nKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ21ldHJpYyBtdXN0IGJlIGNvdW50IG9yIGR1cmF0aW9uJylcbiAgfVxuICBpZiAoaW5wdXQuc3RhdHVzICE9IG51bGwpIHtcbiAgICBjb25zdCBhbGxvd2VkID0gWydhY3RpdmUnLCAncGF1c2VkJywgJ2NvbXBsZXRlZCcsICdhcmNoaXZlZCcsICdmYWlsZWQnXVxuICAgIGlmICghYWxsb3dlZC5pbmNsdWRlcyhpbnB1dC5zdGF0dXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihgaW52YWxpZCBzdGF0dXM6ICR7aW5wdXQuc3RhdHVzfWApXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlua3MgPSBpbnB1dC5saW5rcyAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxMaW5rcyhpbnB1dC5saW5rcywgcnVsZVR5cGUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gaW5wdXQuZGVwZW5kZW5jaWVzICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhpbnB1dC5kZXBlbmRlbmNpZXMsIHJ1bGVUeXBlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBpbnB1dC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBkZWFkbGluZSA9IGlucHV0LmRlYWRsaW5lICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlYWRsaW5lKGlucHV0LmRlYWRsaW5lKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHN0YXJ0c0F0ID0gaW5wdXQuc3RhcnRzQXQgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVTdGFydHNBdChpbnB1dC5zdGFydHNBdCwgbm93KVxuICAgIDogdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcnVsZVR5cGUsIGxpbmtzLCBkZXBlbmRlbmNpZXMsIHJlY3VycmVuY2UsIGRlYWRsaW5lLCBzdGFydHNBdCB9XG59XG5cbi8qKlxuICogRGV0ZWN0cyB3aGV0aGVyIGFkZGluZyBlZGdlcyB3b3VsZCBjcmVhdGUgYSBjeWNsZSBpbiB0aGUgZGVwZW5kZW5jeSBEQUcuXG4gKiBgZWRnZXNgIGlzIHRoZSBmdWxsIGFkamFjZW5jeSBsaXN0IGFmdGVyIHRoZSBwcm9wb3NlZCBjaGFuZ2UgKGdvYWxJZCAtPiBkZXBzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKFxuICBlZGdlczogTWFwPG51bWJlciwgbnVtYmVyW10+LFxuICBzdGFydElkOiBudW1iZXIsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgdmlzaXRpbmcgPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCB2aXNpdGVkID0gbmV3IFNldDxudW1iZXI+KClcblxuICBmdW5jdGlvbiBkZnMobm9kZTogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgaWYgKHZpc2l0aW5nLmhhcyhub2RlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmlzaXRlZC5oYXMobm9kZSkpIHJldHVybiBmYWxzZVxuICAgIHZpc2l0aW5nLmFkZChub2RlKVxuICAgIGZvciAoY29uc3QgbmV4dCBvZiBlZGdlcy5nZXQobm9kZSkgPz8gW10pIHtcbiAgICAgIGlmIChkZnMobmV4dCkpIHJldHVybiB0cnVlXG4gICAgfVxuICAgIHZpc2l0aW5nLmRlbGV0ZShub2RlKVxuICAgIHZpc2l0ZWQuYWRkKG5vZGUpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gZGZzKHN0YXJ0SWQpXG59XG4iLCAiaW1wb3J0IHsgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciB9IGZyb20gJy4vdmFsaWRhdGlvbi50cydcblxuLyoqIE1pbnV0ZXMgYmVmb3JlIGFjdGl2aXR5IHN0YXJ0OyAwID0gYXQgc3RhcnQuIE1heCBsb29rYmFjayA9IDcgZGF5cy4gKi9cbmV4cG9ydCBjb25zdCBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVF9NSU5VVEVTID0gMTAwODBcbmV4cG9ydCBjb25zdCBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFMgPSA4XG5cbi8qKlxuICogTm9ybWFsaXplcyByZW1pbmRlciBvZmZzZXRzOiBjb2VyY2UgdG8gaW50cywgcmVqZWN0IG91dC1vZi1yYW5nZSxcbiAqIGRlZHVwZSwgc29ydCBhc2NlbmRpbmcuIEVtcHR5L251bGwgXHUyMTkyIFtdLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplTm90aWZpY2F0aW9uT2Zmc2V0cyhcbiAgb2Zmc2V0czogbnVtYmVyW10gfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogbnVtYmVyW10ge1xuICBpZiAob2Zmc2V0cyA9PSBudWxsKSByZXR1cm4gW11cblxuICBpZiAob2Zmc2V0cy5sZW5ndGggPiBNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFMpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgIGBub3RpZmljYXRpb25PZmZzZXRzIG11c3QgaGF2ZSBhdCBtb3N0ICR7TUFYX05PVElGSUNBVElPTl9PRkZTRVRTfSB2YWx1ZXNgLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCByZXN1bHQ6IG51bWJlcltdID0gW11cblxuICBmb3IgKGNvbnN0IHJhdyBvZiBvZmZzZXRzKSB7XG4gICAgaWYgKHR5cGVvZiByYXcgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUocmF3KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihyYXcpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgJ25vdGlmaWNhdGlvbk9mZnNldHMgbXVzdCBiZSBpbnRlZ2VycycsXG4gICAgICApXG4gICAgfVxuICAgIGlmIChyYXcgPCAwIHx8IHJhdyA+IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVMpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICBgbm90aWZpY2F0aW9uT2Zmc2V0cyBtdXN0IGJlIGJldHdlZW4gMCBhbmQgJHtNQVhfTk9USUZJQ0FUSU9OX09GRlNFVF9NSU5VVEVTfWAsXG4gICAgICApXG4gICAgfVxuICAgIGlmIChzZWVuLmhhcyhyYXcpKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKHJhdylcbiAgICByZXN1bHQucHVzaChyYXcpXG4gIH1cblxuICByZXN1bHQuc29ydCgoYSwgYikgPT4gYSAtIGIpXG4gIHJldHVybiByZXN1bHRcbn1cbiIsICIvKiogUG9zdGdyZXMgYG51bWVyaWNgIGFycml2ZXMgYXMgc3RyaW5nIHZpYSBgcGdgOyBHcmFwaFFMIE51bWJlciByZXF1aXJlcyBKUyBudW1iZXIuICovXG5leHBvcnQgZnVuY3Rpb24gYXNOdW1iZXIodmFsdWU6IHVua25vd24sIGZhbGxiYWNrID0gMCk6IG51bWJlciB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gZmFsbGJhY2tcbiAgY29uc3QgbiA9IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBmYWxsYmFja1xufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNOdW1iZXJPck51bGwodmFsdWU6IHVua25vd24pOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IG4gPSB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInID8gdmFsdWUgOiBOdW1iZXIodmFsdWUpXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogbnVsbFxufVxuIiwgImltcG9ydCB0eXBlIHsgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBHb2FsIGFzIEdvYWxSb3csXG4gIEdvYWxDb25maWcsXG4gIEdvYWxDeWNsZSBhcyBHb2FsQ3ljbGVSb3csXG4gIEdvYWxEZWFkbGluZUNvbmZpZyxcbiAgR29hbERlcGVuZGVuY3kgYXMgR29hbERlcGVuZGVuY3lSb3csXG4gIEdvYWxMaW5rIGFzIEdvYWxMaW5rUm93LFxuICBHb2FsUHJvZ3Jlc3NTbmFwc2hvdCBhcyBHb2FsU25hcHNob3RSb3csXG4gIEdvYWxSZWN1cnJlbmNlQ29uZmlnLFxuICBOZXdHb2FsLFxuICBOZXdHb2FsRGVwZW5kZW5jeSxcbiAgTmV3R29hbExpbmssXG59IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUluaXRpYWxDeWNsZSxcbiAgZGVhZGxpbmVTdGF0ZSxcbiAgdHlwZSBEZWFkbGluZVN0YXRlLFxuICBsaWZlY3ljbGVQaGFzZSxcbiAgdHlwZSBHb2FsTGlmZWN5Y2xlUGhhc2UsXG4gIHJlc2NoZWR1bGVBY3RpdmVDeWNsZSxcbiAgcm9sbE92ZXJJZk5lZWRlZCxcbiAgcm9sbE92ZXJVc2VyR29hbHMsXG59IGZyb20gJy4uLy4uL2dvYWxzL2N5Y2xlcy50cydcbmltcG9ydCB7IGJ1aWxkR29hbE51ZGdlcyB9IGZyb20gJy4uLy4uL2dvYWxzL251ZGdlcy50cydcbmltcG9ydCB7IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcywgcmVjb21wdXRlQ3ljbGUgfSBmcm9tICcuLi8uLi9nb2Fscy9wcm9ncmVzcy50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0LFxuICBJbnZhbGlkR29hbEVycm9yLFxuICB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dCxcbiAgdmFsaWRhdGVHb2FsQ29sb3IsXG4gIHZhbGlkYXRlR29hbFRpdGxlLFxuICB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dCxcbiAgd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5pbXBvcnQgeyBhc051bWJlciwgYXNOdW1iZXJPck51bGwgfSBmcm9tICcuLi9udW1lcmljLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbi8qKiBOYW1lZCByZXR1cm4gc2hhcGVzIHNvIFB5bG9uIGVtaXRzIEdyYXBoUUwgb2JqZWN0IHR5cGVzIChub3QgYEFueSFgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTGlua2VkQWN0aXZpdHkge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIHN0YXJ0X3RpbWU6IHN0cmluZ1xuICBlbmRfdGltZTogc3RyaW5nXG4gIGlzX3JlY3VycmluZzogYm9vbGVhblxuICBkYXRlOiBzdHJpbmcgfCBudWxsXG4gIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBudW1iZXJbXVxuICBjcmVhdGVkX2F0OiBEYXRlXG4gIHVwZGF0ZWRfYXQ6IERhdGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBMaW5rZWRHcm91cCB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBjb2xvcjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IERhdGVcbiAgdXBkYXRlZF9hdDogRGF0ZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxMaW5rIHtcbiAgaWQ6IG51bWJlclxuICBnb2FsX2lkOiBudW1iZXJcbiAgbGlua190eXBlOiBzdHJpbmdcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogRGF0ZVxuICBhY3Rpdml0eTogKCkgPT4gUHJvbWlzZTxMaW5rZWRBY3Rpdml0eSB8IG51bGw+XG4gIGdyb3VwOiAoKSA9PiBQcm9taXNlPExpbmtlZEdyb3VwIHwgbnVsbD5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsQ3ljbGVWaWV3IHtcbiAgaWQ6IG51bWJlclxuICBnb2FsX2lkOiBudW1iZXJcbiAgY3ljbGVfaW5kZXg6IG51bWJlclxuICBzdGFydHNfYXQ6IERhdGVcbiAgZW5kc19hdDogRGF0ZSB8IG51bGxcbiAgZGVhZGxpbmVfYXQ6IERhdGUgfCBudWxsXG4gIHRhcmdldF92YWx1ZTogbnVtYmVyXG4gIGN1cnJlbnRfdmFsdWU6IG51bWJlclxuICBzdGF0dXM6IHN0cmluZ1xuICBjYXJyeV9vdmVyOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogRGF0ZVxuICB1cGRhdGVkX2F0OiBEYXRlXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZlQ3ljbGUgZXh0ZW5kcyBHb2FsQ3ljbGVWaWV3IHtcbiAgZGVhZGxpbmVTdGF0ZTogRGVhZGxpbmVTdGF0ZVxuICBwZXJjZW50Q29tcGxldGU6IG51bWJlclxuICByZW1haW5pbmc6IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxEZXBlbmRlbmN5IHtcbiAgaWQ6IG51bWJlclxuICBnb2FsX2lkOiBudW1iZXJcbiAgZGVwZW5kc19vbl9nb2FsX2lkOiBudW1iZXJcbiAgcmVxdWlyZW1lbnQ6IHN0cmluZ1xuICB0aHJlc2hvbGQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogRGF0ZVxuICBkZXBlbmRzT246ICgpID0+IFByb21pc2U8R29hbCB8IG51bGw+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbFNuYXBzaG90IHtcbiAgaWQ6IG51bWJlclxuICBnb2FsX2N5Y2xlX2lkOiBudW1iZXJcbiAgYXNfb2Y6IHN0cmluZ1xuICB2YWx1ZTogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IERhdGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsIHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBjb2xvcjogc3RyaW5nXG4gIGljb246IHN0cmluZyB8IG51bGxcbiAgcnVsZV90eXBlOiBzdHJpbmdcbiAgbWV0cmljOiBzdHJpbmdcbiAgdGFyZ2V0X3ZhbHVlOiBudW1iZXJcbiAgY29uZmlnOiBHb2FsQ29uZmlnXG4gIHN0YXR1czogc3RyaW5nXG4gIHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbFxuICBwcmlvcml0eTogbnVtYmVyXG4gIHNvcnRfb3JkZXI6IG51bWJlclxuICBzdGFydHNfYXQ6IERhdGVcbiAgY3JlYXRlZF9hdDogRGF0ZVxuICB1cGRhdGVkX2F0OiBEYXRlXG4gIHN0YXJ0c0F0OiBzdHJpbmdcbiAgbGlmZWN5Y2xlUGhhc2U6IEdvYWxMaWZlY3ljbGVQaGFzZVxuICBsaW5rczogKCkgPT4gUHJvbWlzZTxHb2FsTGlua1tdPlxuICBhY3RpdmVDeWNsZTogKCkgPT4gUHJvbWlzZTxBY3RpdmVDeWNsZSB8IG51bGw+XG4gIGN5Y2xlczogKCkgPT4gUHJvbWlzZTxHb2FsQ3ljbGVWaWV3W10+XG4gIGRlcGVuZGVuY2llczogKCkgPT4gUHJvbWlzZTxHb2FsRGVwZW5kZW5jeVtdPlxuICBzbmFwc2hvdHM6ICgpID0+IFByb21pc2U8R29hbFNuYXBzaG90W10+XG4gIGlzTG9ja2VkOiAoKSA9PiBQcm9taXNlPGJvb2xlYW4+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdHlDb21wbGV0aW9uUm93IHtcbiAgaWQ6IG51bWJlclxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZ1xuICBkdXJhdGlvbl9taW51dGVzOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRlZF9hdDogRGF0ZVxuICBtZXRhZGF0YToge1xuICAgIHRpdGxlPzogc3RyaW5nXG4gICAgbm90ZXM/OiBzdHJpbmdcbiAgICB0cmlnZ2VyX2V2ZW50cz86IHN0cmluZ1tdXG4gIH0gfCBudWxsXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGFpbHlQcm9ncmVzcyB7XG4gIGRhdGU6IHN0cmluZ1xuICBjb21wbGV0ZWRDb3VudDogbnVtYmVyXG4gIG1pbnV0ZXNUb2RheTogbnVtYmVyXG4gIHN0cmVha0RheXM6IG51bWJlclxuICBjb21wbGV0aW9uczogQWN0aXZpdHlDb21wbGV0aW9uUm93W11cbn1cblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBUXG59XG5cbi8qKiBQb3N0Z3JlcyBgbnVtZXJpY2AgYXJyaXZlcyBhcyBzdHJpbmcgdmlhIGBwZ2A7IEdyYXBoUUwgTnVtYmVyIHJlcXVpcmVzIEpTIG51bWJlci4gKi9cbmZ1bmN0aW9uIG1hcEN5Y2xlU2NhbGFyczxUIGV4dGVuZHMgR29hbEN5Y2xlUm93PihjeWNsZTogVCkge1xuICByZXR1cm4ge1xuICAgIC4uLmN5Y2xlLFxuICAgIHRhcmdldF92YWx1ZTogYXNOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSxcbiAgICBjdXJyZW50X3ZhbHVlOiBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSxcbiAgICBjYXJyeV9vdmVyOiBhc051bWJlcihjeWNsZS5jYXJyeV9vdmVyKSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBMaW5rU2NhbGFycyhsaW5rOiBHb2FsTGlua1Jvdykge1xuICByZXR1cm4ge1xuICAgIC4uLmxpbmssXG4gICAgd2VpZ2h0OiBhc051bWJlcihsaW5rLndlaWdodCwgMSksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwRGVwZW5kZW5jeVNjYWxhcnMoZGVwOiBHb2FsRGVwZW5kZW5jeVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLmRlcCxcbiAgICB0aHJlc2hvbGQ6IGFzTnVtYmVyT3JOdWxsKGRlcC50aHJlc2hvbGQpLFxuICAgIHdlaWdodDogYXNOdW1iZXIoZGVwLndlaWdodCwgMSksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwU25hcHNob3RTY2FsYXJzKHNuYXBzaG90OiBHb2FsU25hcHNob3RSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5zbmFwc2hvdCxcbiAgICB2YWx1ZTogYXNOdW1iZXIoc25hcHNob3QudmFsdWUpLFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvUmVjdXJyZW5jZUpzb24oXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXRbJ3JlY3VycmVuY2UnXSB8IFVwZGF0ZUdvYWxJbnB1dFsncmVjdXJyZW5jZSddLFxuKTogR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgaWYgKGlucHV0ID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiB7XG4gICAgcGVyaW9kOiBpbnB1dC5wZXJpb2QsXG4gICAgaW50ZXJ2YWw6IGlucHV0LmludGVydmFsLFxuICAgIGFuY2hvcjogaW5wdXQuYW5jaG9yLFxuICAgIGNhcnJ5X292ZXI6IGlucHV0LmNhcnJ5T3ZlcixcbiAgICByZXNldDogaW5wdXQucmVzZXQsXG4gIH1cbn1cblxuZnVuY3Rpb24gdG9EZWFkbGluZUpzb24oXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXRbJ2RlYWRsaW5lJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ2RlYWRsaW5lJ10sXG4pOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsIHtcbiAgaWYgKGlucHV0ID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiB7XG4gICAga2luZDogaW5wdXQua2luZCxcbiAgICBkYXRlOiBpbnB1dC5kYXRlLFxuICAgIGRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQ6IGlucHV0LmRheXNBZnRlckN5Y2xlU3RhcnQsXG4gICAgZ3JhY2VfZGF5czogaW5wdXQuZ3JhY2VEYXlzLFxuICAgIHdhcm5fZGF5czogaW5wdXQud2FybkRheXMsXG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Db25maWdKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0Wydjb25maWcnXSB8IFVwZGF0ZUdvYWxJbnB1dFsnY29uZmlnJ10sXG4pOiBHb2FsQ29uZmlnIHtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuIHt9XG4gIHJldHVybiB7XG4gICAgY29tcG9zaXRlX21vZGU6IGlucHV0LmNvbXBvc2l0ZU1vZGUsXG4gICAgY291bnRfcmVxdWlyZWQ6IGlucHV0LmNvdW50UmVxdWlyZWQsXG4gICAgYmVmb3JlX3RpbWU6IGlucHV0LmJlZm9yZVRpbWUsXG4gICAgYWZ0ZXJfdGltZTogaW5wdXQuYWZ0ZXJUaW1lLFxuICAgIGJsb2NrX3VudGlsX3VubG9ja2VkOiBpbnB1dC5ibG9ja1VudGlsVW5sb2NrZWQsXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRBY3Rpdml0aWVzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGFjdGl2aXR5SWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoYWN0aXZpdHlJZHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgYWN0aXZpdHlJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBhY3Rpdml0eUlkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgYWN0aXZpdGllcyBub3QgZm91bmQnKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkR3JvdXBzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGdyb3VwSWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoZ3JvdXBJZHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdncm91cHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnaWQnLCAnaW4nLCBncm91cElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGdyb3VwSWRzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdvbmUgb3IgbW9yZSBncm91cHMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEdvYWxzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGdvYWxJZHM6IG51bWJlcltdLFxuKSB7XG4gIGlmIChnb2FsSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnaWQnLCAnaW4nLCBnb2FsSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gZ29hbElkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgZGVwZW5kZW5jeSBnb2FscyBub3QgZm91bmQnKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VMaW5rcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSxcbikge1xuICBhd2FpdCB0cnguZGVsZXRlRnJvbSgnZ29hbF9saW5rcycpLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpLmV4ZWN1dGUoKVxuICBjb25zdCBhY3Rpdml0eUlkcyA9IGxpbmtzXG4gICAgLmZpbHRlcigobCkgPT4gbC5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5JyAmJiBsLmFjdGl2aXR5SWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmFjdGl2aXR5SWQhKVxuICBjb25zdCBncm91cElkcyA9IGxpbmtzXG4gICAgLmZpbHRlcigobCkgPT4gbC5saW5rVHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwSWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmdyb3VwSWQhKVxuICBhd2FpdCBhc3NlcnRPd25lZEFjdGl2aXRpZXModHJ4LCB1c2VySWQsIGFjdGl2aXR5SWRzKVxuICBhd2FpdCBhc3NlcnRPd25lZEdyb3Vwcyh0cngsIHVzZXJJZCwgZ3JvdXBJZHMpXG5cbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XG4gICAgYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9saW5rcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgZ29hbF9pZDogZ29hbElkLFxuICAgICAgICBsaW5rX3R5cGU6IGxpbmsubGlua1R5cGUsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknID8gbGluay5hY3Rpdml0eUlkID8/IG51bGwgOiBudWxsLFxuICAgICAgICBncm91cF9pZDogbGluay5saW5rVHlwZSA9PT0gJ2dyb3VwJyA/IGxpbmsuZ3JvdXBJZCA/PyBudWxsIDogbnVsbCxcbiAgICAgICAgd2VpZ2h0OiBsaW5rLndlaWdodCA/PyAxLFxuICAgICAgfSBhcyBOZXdHb2FsTGluaylcbiAgICAgIC5leGVjdXRlKClcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXBsYWNlRGVwZW5kZW5jaWVzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgZ29hbElkOiBudW1iZXIsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10sXG4pIHtcbiAgY29uc3QgZGVwSWRzID0gZGVwcy5tYXAoKGQpID0+IGQuZGVwZW5kc09uR29hbElkKVxuICBpZiAoZGVwSWRzLmluY2x1ZGVzKGdvYWxJZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYSBnb2FsIGNhbm5vdCBkZXBlbmQgb24gaXRzZWxmJylcbiAgfVxuICBhd2FpdCBhc3NlcnRPd25lZEdvYWxzKHRyeCwgdXNlcklkLCBkZXBJZHMpXG5cbiAgLy8gQnVpbGQgYWRqYWNlbmN5IGZyb20gYWxsIGV4aXN0aW5nIGRlcHMgZm9yIHRoaXMgdXNlciwgcmVwbGFjaW5nIHRoaXMgZ29hbCdzIGVkZ2VzLlxuICBjb25zdCBhbGxHb2FscyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfZGVwZW5kZW5jaWVzLmdvYWxfaWQnKVxuICAgIC53aGVyZSgnZ29hbHMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoW1xuICAgICAgJ2dvYWxfZGVwZW5kZW5jaWVzLmdvYWxfaWQnLFxuICAgICAgJ2dvYWxfZGVwZW5kZW5jaWVzLmRlcGVuZHNfb25fZ29hbF9pZCcsXG4gICAgXSlcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgZWRnZXMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyW10+KClcbiAgZm9yIChjb25zdCBnIG9mIGFsbEdvYWxzKSBlZGdlcy5zZXQoZy5pZCwgW10pXG4gIGZvciAoY29uc3QgZSBvZiBleGlzdGluZykge1xuICAgIGlmIChlLmdvYWxfaWQgPT09IGdvYWxJZCkgY29udGludWVcbiAgICBlZGdlcy5nZXQoZS5nb2FsX2lkKT8ucHVzaChlLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgfVxuICBlZGdlcy5zZXQoZ29hbElkLCBkZXBJZHMpXG5cbiAgaWYgKHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKGVkZ2VzLCBnb2FsSWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZGVuY3kgY3ljbGUgZGV0ZWN0ZWQnKVxuICB9XG5cbiAgYXdhaXQgdHJ4LmRlbGV0ZUZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJykud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZCkuZXhlY3V0ZSgpXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICBhd2FpdCB0cnhcbiAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgZ29hbF9pZDogZ29hbElkLFxuICAgICAgICBkZXBlbmRzX29uX2dvYWxfaWQ6IGRlcC5kZXBlbmRzT25Hb2FsSWQsXG4gICAgICAgIHJlcXVpcmVtZW50OiBkZXAucmVxdWlyZW1lbnQgPz8gJ2NvbXBsZXRlJyxcbiAgICAgICAgdGhyZXNob2xkOiBkZXAudGhyZXNob2xkID8/IG51bGwsXG4gICAgICAgIHdlaWdodDogZGVwLndlaWdodCA/PyAxLFxuICAgICAgfSBhcyBOZXdHb2FsRGVwZW5kZW5jeSlcbiAgICAgIC5leGVjdXRlKClcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBkZXBlbmRlbmNpZXNNZXQoXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKGRlcHMubGVuZ3RoID09PSAwKSByZXR1cm4gdHJ1ZVxuXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICBjb25zdCBjaGlsZEdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghY2hpbGRHb2FsKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWN5Y2xlKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChkZXAucmVxdWlyZW1lbnQgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgIGNvbnN0IHRhcmdldE1ldCA9XG4gICAgICAgIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGlmIChcbiAgICAgICAgY3ljbGUuc3RhdHVzICE9PSAnc3VjY2VlZGVkJyAmJlxuICAgICAgICBjaGlsZEdvYWwuc3RhdHVzICE9PSAnY29tcGxldGVkJyAmJlxuICAgICAgICAhdGFyZ2V0TWV0XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHRocmVzaG9sZCA9IGRlcC50aHJlc2hvbGQgPz8gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPCBOdW1iZXIodGhyZXNob2xkKSkgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbmZ1bmN0aW9uIHdpdGhHb2FsUmVsYXRpb25zKGdvYWw6IEdvYWxSb3cpOiBHb2FsIHtcbiAgY29uc3QgY29uZmlnID0gcGFyc2VKc29uPEdvYWxDb25maWc+KGdvYWwuY29uZmlnKSA/PyB7fVxuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuXG4gIHJldHVybiB7XG4gICAgLi4uZ29hbCxcbiAgICB0YXJnZXRfdmFsdWU6IGFzTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICBzdGFydHNBdDogbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpLnRvSVNPU3RyaW5nKCksXG4gICAgbGlmZWN5Y2xlUGhhc2U6IGxpZmVjeWNsZVBoYXNlKGdvYWwsIG5vdyksXG4gICAgY29uZmlnLFxuICAgIHJlY3VycmVuY2UsXG4gICAgZGVhZGxpbmUsXG4gICAgbGlua3M6IGFzeW5jICgpOiBQcm9taXNlPEdvYWxMaW5rW10+ID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcCgobGluayk6IEdvYWxMaW5rID0+ICh7XG4gICAgICAgIC4uLm1hcExpbmtTY2FsYXJzKGxpbmspLFxuICAgICAgICBhY3Rpdml0eTogYXN5bmMgKCk6IFByb21pc2U8TGlua2VkQWN0aXZpdHkgfCBudWxsPiA9PiB7XG4gICAgICAgICAgaWYgKGxpbmsuYWN0aXZpdHlfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxpbmsuYWN0aXZpdHlfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbFxuICAgICAgICB9LFxuICAgICAgICBncm91cDogYXN5bmMgKCk6IFByb21pc2U8TGlua2VkR3JvdXAgfCBudWxsPiA9PiB7XG4gICAgICAgICAgaWYgKGxpbmsuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdncm91cHMnKVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgbGluay5ncm91cF9pZClcbiAgICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsXG4gICAgICAgIH0sXG4gICAgICB9KSlcbiAgICB9LFxuICAgIGFjdGl2ZUN5Y2xlOiBhc3luYyAoKTogUHJvbWlzZTxBY3RpdmVDeWNsZSB8IG51bGw+ID0+IHtcbiAgICAgIGxldCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoY3ljbGUgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgIGN5Y2xlID0gYXdhaXQgcm9sbE92ZXJJZk5lZWRlZChkYiwgZ29hbCwgY3ljbGUpXG4gICAgICB9XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbGF0ZXN0IGN5Y2xlIHNvIGNvbXBsZXRlZCAvIG1pZC13aW5kb3cgc3VjY2VlZGVkIGN5Y2xlc1xuICAgICAgLy8gc3RpbGwgZXhwb3NlIHByb2dyZXNzLiBBbHNvIHJlcGFpciByZWN1cnJpbmcgY3ljbGVzIHRoYXQgd2VyZSBjbG9zZWRcbiAgICAgIC8vIGVhcmx5IChiZWZvcmUgZW5kc19hdCkgc28gdGhleSByZW1haW4gdGhlIGFjdGl2ZSB3aW5kb3cuXG4gICAgICBpZiAoIWN5Y2xlKSB7XG4gICAgICAgIGNvbnN0IGxhdGVzdCA9IGF3YWl0IGRiXG4gICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGxhdGVzdCAmJlxuICAgICAgICAgIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgICAgICAgIGdvYWwucmVjdXJyZW5jZSAhPSBudWxsICYmXG4gICAgICAgICAgbGF0ZXN0LnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgICAoIWxhdGVzdC5lbmRzX2F0IHx8IG5vdyA8IG5ldyBEYXRlKGxhdGVzdC5lbmRzX2F0KSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWN0aXZlJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxhdGVzdC5pZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjeWNsZSA9IGxhdGVzdFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWN5Y2xlKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ubWFwQ3ljbGVTY2FsYXJzKGN5Y2xlKSxcbiAgICAgICAgZGVhZGxpbmVTdGF0ZTogc3RhdGUsXG4gICAgICAgIHBlcmNlbnRDb21wbGV0ZTogdGFyZ2V0ID4gMCA/IE1hdGgubWluKDEsIGN1cnJlbnQgLyB0YXJnZXQpIDogMCxcbiAgICAgICAgcmVtYWluaW5nOiBNYXRoLm1heCgwLCB0YXJnZXQgLSBjdXJyZW50KSxcbiAgICAgIH1cbiAgICB9LFxuICAgIGN5Y2xlczogYXN5bmMgKCk6IFByb21pc2U8R29hbEN5Y2xlVmlld1tdPiA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnYXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcChtYXBDeWNsZVNjYWxhcnMpXG4gICAgfSxcbiAgICBkZXBlbmRlbmNpZXM6IGFzeW5jICgpOiBQcm9taXNlPEdvYWxEZXBlbmRlbmN5W10+ID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAoKGRlcCk6IEdvYWxEZXBlbmRlbmN5ID0+ICh7XG4gICAgICAgIC4uLm1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcCksXG4gICAgICAgIGRlcGVuZHNPbjogYXN5bmMgKCk6IFByb21pc2U8R29hbCB8IG51bGw+ID0+IHtcbiAgICAgICAgICBjb25zdCBnID0gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICAgICAgcmV0dXJuIGcgPyB3aXRoR29hbFJlbGF0aW9ucyhnKSA6IG51bGxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0sXG4gICAgc25hcHNob3RzOiBhc3luYyAoKTogUHJvbWlzZTxHb2FsU25hcHNob3RbXT4gPT4ge1xuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFjeWNsZSkgcmV0dXJuIFtdXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2N5Y2xlX2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2FzX29mJywgJ2FzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAobWFwU25hcHNob3RTY2FsYXJzKVxuICAgIH0sXG4gICAgaXNMb2NrZWQ6IGFzeW5jICgpOiBQcm9taXNlPGJvb2xlYW4+ID0+IHtcbiAgICAgIGlmICghY29uZmlnLmJsb2NrX3VudGlsX3VubG9ja2VkKSByZXR1cm4gZmFsc2VcbiAgICAgIHJldHVybiAhKGF3YWl0IGRlcGVuZGVuY2llc01ldChnb2FsLmlkLCBnb2FsLnVzZXJfaWQpKVxuICAgIH0sXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IEdvYWxRdWVyeSA9IHtcbiAgZ29hbHM6IGFzeW5jIChhcmdzPzogeyBzdGF0dXM/OiBzdHJpbmcgfSk6IFByb21pc2U8R29hbFtdPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcm9sbE92ZXJVc2VyR29hbHMoZGIsIHVzZXJJZClcblxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgncHJpb3JpdHknLCAnZGVzYycpXG4gICAgICAub3JkZXJCeSgnc29ydF9vcmRlcicsICdhc2MnKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG5cbiAgICBpZiAoYXJncz8uc3RhdHVzKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdzdGF0dXMnLCAnPScsIGFyZ3Muc3RhdHVzIGFzIEdvYWxSb3dbJ3N0YXR1cyddKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEdvYWxSZWxhdGlvbnMpXG4gIH0sXG5cbiAgZ29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KTogUHJvbWlzZTxHb2FsIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJvbGxPdmVyVXNlckdvYWxzKGRiLCB1c2VySWQpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gd2l0aEdvYWxSZWxhdGlvbnMocm93KSA6IG51bGxcbiAgfSxcblxuICBnb2FsTnVkZ2VzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJnc1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJvbGxPdmVyVXNlckdvYWxzKGRiLCB1c2VySWQpXG4gICAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCBwYWlycyA9IFtdXG4gICAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBwYWlycy5wdXNoKHsgZ29hbCwgY3ljbGU6IGN5Y2xlID8/IG51bGwgfSlcbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkR29hbE51ZGdlcyhwYWlycylcbiAgfSxcblxuICBkYWlseVByb2dyZXNzOiBhc3luYyAoYXJncz86IHsgZGF0ZT86IHN0cmluZyB9KTogUHJvbWlzZTxEYWlseVByb2dyZXNzPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZGF0ZSA9IGFyZ3M/LmRhdGUgPz8gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuXG4gICAgY29uc3QgY29tcGxldGlvbnMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2FjdGl2aXR5X2NvbXBsZXRpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRhdGUpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IHRpbWVFdmVudHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZXZlbnRzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdtZXRyaWMnLCAnPScsICdkdXJhdGlvbicpXG4gICAgICAud2hlcmUoJ29jY3VycmVuY2VfZGF0ZScsICc9JywgZGF0ZSlcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgbWludXRlc1RvZGF5ID0gdGltZUV2ZW50cy5yZWR1Y2UoXG4gICAgICAoc3VtLCBlKSA9PiBzdW0gKyBOdW1iZXIoZS5hbW91bnQpLFxuICAgICAgMCxcbiAgICApXG5cbiAgICAvLyBTdHJlYWs6IGNvbnNlY3V0aXZlIGRheXMgZW5kaW5nIHRvZGF5IHdpdGggPj0gMSBjb21wbGV0aW9uLlxuICAgIGxldCBzdHJlYWsgPSAwXG4gICAgY29uc3QgY3Vyc29yID0gbmV3IERhdGUoZGF0ZSArICdUMDA6MDA6MDBaJylcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDM2NTsgaSsrKSB7XG4gICAgICBjb25zdCBkYXkgPSBjdXJzb3IudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0eV9jb21wbGV0aW9ucycpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ29jY3VycmVuY2VfZGF0ZScsICc9JywgZGF5KVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghcm93KSBicmVha1xuICAgICAgc3RyZWFrKytcbiAgICAgIGN1cnNvci5zZXRVVENEYXRlKGN1cnNvci5nZXRVVENEYXRlKCkgLSAxKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRlLFxuICAgICAgY29tcGxldGVkQ291bnQ6IGNvbXBsZXRpb25zLmxlbmd0aCxcbiAgICAgIG1pbnV0ZXNUb2RheSxcbiAgICAgIHN0cmVha0RheXM6IHN0cmVhayxcbiAgICAgIGNvbXBsZXRpb25zLFxuICAgIH1cbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IEdvYWxNdXRhdGlvbiA9IHtcbiAgY3JlYXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dCB9KTogUHJvbWlzZTxHb2FsPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlQ3JlYXRlR29hbElucHV0KGlucHV0LCBub3cpXG5cbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oJ2dvYWxzJylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHRpdGxlOiB2YWxpZGF0ZWQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uID8/IG51bGwsXG4gICAgICAgICAgY29sb3I6IHZhbGlkYXRlZC5jb2xvcixcbiAgICAgICAgICBpY29uOiBpbnB1dC5pY29uID8/IG51bGwsXG4gICAgICAgICAgcnVsZV90eXBlOiB2YWxpZGF0ZWQucnVsZVR5cGUsXG4gICAgICAgICAgbWV0cmljOiBpbnB1dC5tZXRyaWMsXG4gICAgICAgICAgdGFyZ2V0X3ZhbHVlOiB2YWxpZGF0ZWQudGFyZ2V0VmFsdWUsXG4gICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeSh0b0NvbmZpZ0pzb24oaW5wdXQuY29uZmlnKSksXG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICByZWN1cnJlbmNlOiB2YWxpZGF0ZWQucmVjdXJyZW5jZVxuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b1JlY3VycmVuY2VKc29uKHZhbGlkYXRlZC5yZWN1cnJlbmNlKSlcbiAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICBkZWFkbGluZTogdmFsaWRhdGVkLmRlYWRsaW5lXG4gICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvRGVhZGxpbmVKc29uKHZhbGlkYXRlZC5kZWFkbGluZSkpXG4gICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgcHJpb3JpdHk6IGlucHV0LnByaW9yaXR5ID8/IDAsXG4gICAgICAgICAgc29ydF9vcmRlcjogaW5wdXQuc29ydE9yZGVyID8/IDAsXG4gICAgICAgICAgc3RhcnRzX2F0OiB2YWxpZGF0ZWQuc3RhcnRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSBhcyBOZXdHb2FsKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgICAgYXdhaXQgcmVwbGFjZUxpbmtzKHRyeCwgY3JlYXRlZC5pZCwgdXNlcklkLCB2YWxpZGF0ZWQubGlua3MpXG4gICAgICBhd2FpdCByZXBsYWNlRGVwZW5kZW5jaWVzKHRyeCwgY3JlYXRlZC5pZCwgdXNlcklkLCB2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKVxuICAgICAgYXdhaXQgY3JlYXRlSW5pdGlhbEN5Y2xlKHRyeCwgY3JlYXRlZCwgbm93KVxuICAgICAgcmV0dXJuIGNyZWF0ZWRcbiAgICB9KVxuXG4gICAgYXdhaXQgcmVjb21wdXRlQ3ljbGUoXG4gICAgICBkYixcbiAgICAgIGdvYWwsXG4gICAgICAoYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCkpLFxuICAgICAgbm93LFxuICAgIClcblxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKSxcbiAgICApXG4gIH0sXG5cbiAgdXBkYXRlR29hbDogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dCB9LFxuICApOiBQcm9taXNlPEdvYWw+ID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgY29uc3Qgbm93RGF0ZSA9IG5ldyBEYXRlKClcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dChcbiAgICAgIGFyZ3MuaW5wdXQsXG4gICAgICBleGlzdGluZy5ydWxlX3R5cGUsXG4gICAgICBub3dEYXRlLFxuICAgIClcbiAgICBjb25zdCBpbnB1dCA9IGFyZ3MuaW5wdXRcbiAgICBjb25zdCBub3cgPSBub3dEYXRlLnRvSVNPU3RyaW5nKClcblxuICAgIGNvbnN0IGFjdGl2ZUN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBsZXQgbmV4dFN0YXJ0c0F0OiBEYXRlIHwgdW5kZWZpbmVkXG4gICAgaWYgKHZhbGlkYXRlZC5zdGFydHNBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoZXhpc3Rpbmcuc3RhdHVzID09PSAnY29tcGxldGVkJyB8fCBleGlzdGluZy5zdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICdjYW5ub3QgY2hhbmdlIHN0YXJ0c0F0IG9uIGEgY29tcGxldGVkIG9yIGZhaWxlZCBnb2FsJyxcbiAgICAgICAgKVxuICAgICAgfVxuICAgICAgaWYgKHZhbGlkYXRlZC5zdGFydHNBdCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdzdGFydHNBdCBjYW5ub3QgYmUgY2xlYXJlZDsgb21pdCB0byBsZWF2ZSB1bmNoYW5nZWQnKVxuICAgICAgfVxuICAgICAgbmV4dFN0YXJ0c0F0ID0gdmFsaWRhdGVkLnN0YXJ0c0F0XG5cbiAgICAgIGNvbnN0IGNsb3NlZEN5Y2xlcyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZXhpc3RpbmcuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJyE9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICAvLyBBZnRlciBjeWNsZSAwIGhhcyBjbG9zZWQsIHN0YXJ0IGlzIGZyb3plbi5cbiAgICAgIGlmIChjbG9zZWRDeWNsZXMgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgICAnY2Fubm90IGNoYW5nZSBzdGFydHNBdCBhZnRlciB0aGUgZmlyc3QgY3ljbGUgaGFzIGNsb3NlZCcsXG4gICAgICAgIClcbiAgICAgIH1cblxuICAgICAgY29uc3QgcHJvZ3Jlc3NCZWd1biA9XG4gICAgICAgIGFjdGl2ZUN5Y2xlICE9IG51bGwgJiYgTnVtYmVyKGFjdGl2ZUN5Y2xlLmN1cnJlbnRfdmFsdWUpID4gMFxuXG4gICAgICBpZiAoXG4gICAgICAgIHByb2dyZXNzQmVndW4gJiZcbiAgICAgICAgbmV4dFN0YXJ0c0F0LmdldFRpbWUoKSA+IG5ldyBEYXRlKGV4aXN0aW5nLnN0YXJ0c19hdCkuZ2V0VGltZSgpXG4gICAgICApIHtcbiAgICAgICAgaWYgKCFpbnB1dC5jb25maXJtU3RhcnRzQXRDaGFuZ2UpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgICAgICdtb3Zpbmcgc3RhcnRzQXQgbGF0ZXIgYWZ0ZXIgcHJvZ3Jlc3MgcmVxdWlyZXMgY29uZmlybVN0YXJ0c0F0Q2hhbmdlJyxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBlZmZlY3RpdmVTdGFydHNBdCA9IG5leHRTdGFydHNBdCA/PyBuZXcgRGF0ZShleGlzdGluZy5zdGFydHNfYXQpXG4gICAgY29uc3QgZWZmZWN0aXZlRGVhZGxpbmUgPSB2YWxpZGF0ZWQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZWQuZGVhZGxpbmVcbiAgICAgIDogKCgpID0+IHtcbiAgICAgICAgY29uc3QgZCA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGV4aXN0aW5nLmRlYWRsaW5lKVxuICAgICAgICBpZiAoIWQpIHJldHVybiBudWxsXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAga2luZDogZC5raW5kLFxuICAgICAgICAgIGRhdGU6IGQuZGF0ZSxcbiAgICAgICAgICBkYXlzQWZ0ZXJDeWNsZVN0YXJ0OiBkLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQsXG4gICAgICAgICAgZ3JhY2VEYXlzOiBkLmdyYWNlX2RheXMsXG4gICAgICAgICAgd2FybkRheXM6IGQud2Fybl9kYXlzLFxuICAgICAgICB9XG4gICAgICB9KSgpXG4gICAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0KGVmZmVjdGl2ZVN0YXJ0c0F0LCBlZmZlY3RpdmVEZWFkbGluZSlcblxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIC4uLihpbnB1dC50aXRsZSAhPSBudWxsXG4gICAgICAgICAgICA/IHsgdGl0bGU6IHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7IGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbiB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuY29sb3IgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IGNvbG9yOiB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcikgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0Lmljb24gIT09IHVuZGVmaW5lZCA/IHsgaWNvbjogaW5wdXQuaWNvbiB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5ydWxlVHlwZSAhPSBudWxsID8geyBydWxlX3R5cGU6IHZhbGlkYXRlZC5ydWxlVHlwZSB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5tZXRyaWMgIT0gbnVsbCA/IHsgbWV0cmljOiBpbnB1dC5tZXRyaWMgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IHRhcmdldF92YWx1ZTogaW5wdXQudGFyZ2V0VmFsdWUgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LmNvbmZpZyAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgY29uZmlnOiBKU09OLnN0cmluZ2lmeSh0b0NvbmZpZ0pzb24oaW5wdXQuY29uZmlnKSkgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnN0YXR1cyAhPSBudWxsID8geyBzdGF0dXM6IGlucHV0LnN0YXR1cyB9IDoge30pLFxuICAgICAgICAgIC4uLih2YWxpZGF0ZWQucmVjdXJyZW5jZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgcmVjdXJyZW5jZTogdmFsaWRhdGVkLnJlY3VycmVuY2VcbiAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvUmVjdXJyZW5jZUpzb24odmFsaWRhdGVkLnJlY3VycmVuY2UpKVxuICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLih2YWxpZGF0ZWQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIGRlYWRsaW5lOiB2YWxpZGF0ZWQuZGVhZGxpbmVcbiAgICAgICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvRGVhZGxpbmVKc29uKHZhbGlkYXRlZC5kZWFkbGluZSkpXG4gICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKG5leHRTdGFydHNBdCAhPSBudWxsXG4gICAgICAgICAgICA/IHsgc3RhcnRzX2F0OiBuZXh0U3RhcnRzQXQudG9JU09TdHJpbmcoKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQucHJpb3JpdHkgIT0gbnVsbCA/IHsgcHJpb3JpdHk6IGlucHV0LnByaW9yaXR5IH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnNvcnRPcmRlciAhPSBudWxsID8geyBzb3J0X29yZGVyOiBpbnB1dC5zb3J0T3JkZXIgfSA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGlmICh2YWxpZGF0ZWQubGlua3MpIHtcbiAgICAgICAgYXdhaXQgcmVwbGFjZUxpbmtzKHRyeCwgYXJncy5pZCwgdXNlcklkLCB2YWxpZGF0ZWQubGlua3MpXG4gICAgICB9XG4gICAgICBpZiAodmFsaWRhdGVkLmRlcGVuZGVuY2llcykge1xuICAgICAgICBhd2FpdCByZXBsYWNlRGVwZW5kZW5jaWVzKHRyeCwgYXJncy5pZCwgdXNlcklkLCB2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBnb2FsQWZ0ZXIgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmIChjeWNsZSAmJiBuZXh0U3RhcnRzQXQgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCByZXNjaGVkdWxlQWN0aXZlQ3ljbGUodHJ4LCBnb2FsQWZ0ZXIsIGN5Y2xlLCBuZXh0U3RhcnRzQXQsIG5vd0RhdGUpXG4gICAgICB9IGVsc2UgaWYgKGN5Y2xlICYmIGlucHV0LnRhcmdldFZhbHVlICE9IG51bGwpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICB0YXJnZXRfdmFsdWU6IGlucHV0LnRhcmdldFZhbHVlLFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0pXG4gICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgfSBlbHNlIGlmIChcbiAgICAgICAgY3ljbGUgJiZcbiAgICAgICAgKHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkIHx8IHZhbGlkYXRlZC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWQpICYmXG4gICAgICAgIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA9PT0gMCAmJlxuICAgICAgICBjeWNsZS5jeWNsZV9pbmRleCA9PT0gMFxuICAgICAgKSB7XG4gICAgICAgIC8vIFJlZnJlc2ggYm91bmRzIG9uIHVuc3RhcnRlZCBjeWNsZSAwIHdoZW4gZGVhZGxpbmUvcmVjdXJyZW5jZSBjaGFuZ2UuXG4gICAgICAgIGF3YWl0IHJlc2NoZWR1bGVBY3RpdmVDeWNsZShcbiAgICAgICAgICB0cngsXG4gICAgICAgICAgZ29hbEFmdGVyLFxuICAgICAgICAgIGN5Y2xlLFxuICAgICAgICAgIG5ldyBEYXRlKGdvYWxBZnRlci5zdGFydHNfYXQpLFxuICAgICAgICAgIG5vd0RhdGUsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKGN5Y2xlKSBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUsIG5vd0RhdGUpXG5cbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICBwYXVzZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSk6IFByb21pc2U8R29hbD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAncGF1c2VkJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgcmVzdW1lR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KTogUHJvbWlzZTxHb2FsPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY3RpdmUnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAncGF1c2VkJylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICBhcmNoaXZlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KTogUHJvbWlzZTxHb2FsPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdhcmNoaXZlZCcsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIGRlbGV0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMFxuICB9LFxuXG4gIHJlY29tcHV0ZUdvYWxQcm9ncmVzczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3NcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBjb3VudCA9IGF3YWl0IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcyhkYiwgdXNlcklkKVxuICAgIHJldHVybiB7IHJlY29tcHV0ZWQ6IGNvdW50IH1cbiAgfSxcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxEZWFkbGluZUNvbmZpZyxcbiAgR29hbFJlY3VycmVuY2VDb25maWcsXG4gIE5ld0dvYWxDeWNsZSxcbn0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3ljbGVIYXNTdGFydGVkIH0gZnJvbSAnLi9saWZlY3ljbGUudHMnXG5pbXBvcnQgeyByZWNvbXB1dGVDeWNsZSB9IGZyb20gJy4vcHJvZ3Jlc3MudHMnXG5cbmV4cG9ydCB7XG4gIGN5Y2xlSGFzU3RhcnRlZCxcbiAgbGlmZWN5Y2xlUGhhc2UsXG4gIHR5cGUgR29hbExpZmVjeWNsZVBoYXNlLFxufSBmcm9tICcuL2xpZmVjeWNsZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgVFxufVxuXG5mdW5jdGlvbiBhZGREYXlzKGRhdGU6IERhdGUsIGRheXM6IG51bWJlcik6IERhdGUge1xuICBjb25zdCBkID0gbmV3IERhdGUoZGF0ZSlcbiAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgZGF5cylcbiAgcmV0dXJuIGRcbn1cblxuZnVuY3Rpb24gYWRkTW9udGhzKGRhdGU6IERhdGUsIG1vbnRoczogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlKVxuICBkLnNldFVUQ01vbnRoKGQuZ2V0VVRDTW9udGgoKSArIG1vbnRocylcbiAgcmV0dXJuIGRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVDeWNsZUVuZChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKCFyZWN1cnJlbmNlKSByZXR1cm4gbnVsbFxuICBjb25zdCBpbnRlcnZhbCA9IE1hdGgubWF4KDEsIHJlY3VycmVuY2UuaW50ZXJ2YWwgPz8gMSlcbiAgc3dpdGNoIChyZWN1cnJlbmNlLnBlcmlvZCkge1xuICAgIGNhc2UgJ3dlZWtseSc6XG4gICAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgNyAqIGludGVydmFsKVxuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgcmV0dXJuIGFkZE1vbnRocyhzdGFydHNBdCwgaW50ZXJ2YWwpXG4gICAgY2FzZSAncXVhcnRlcmx5JzpcbiAgICAgIHJldHVybiBhZGRNb250aHMoc3RhcnRzQXQsIDMgKiBpbnRlcnZhbClcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIGludGVydmFsKVxuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlRGVhZGxpbmVBdChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoIWRlYWRsaW5lKSByZXR1cm4gbnVsbFxuICBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ2Fic29sdXRlJyAmJiBkZWFkbGluZS5kYXRlKSB7XG4gICAgcmV0dXJuIG5ldyBEYXRlKGRlYWRsaW5lLmRhdGUgKyAnVDIzOjU5OjU5Ljk5OVonKVxuICB9XG4gIGlmIChkZWFkbGluZS5raW5kID09PSAncmVsYXRpdmUnICYmIGRlYWRsaW5lLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQgIT0gbnVsbCkge1xuICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCBkZWFkbGluZS5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0KVxuICB9XG4gIHJldHVybiBudWxsXG59XG5cbmV4cG9ydCB0eXBlIERlYWRsaW5lU3RhdGUgPSAnb25fdHJhY2snIHwgJ2FwcHJvYWNoaW5nJyB8ICdvdmVyZHVlJyB8ICdmYWlsZWQnXG5cbmV4cG9ydCBmdW5jdGlvbiBkZWFkbGluZVN0YXRlKFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IERlYWRsaW5lU3RhdGUge1xuICBpZiAoIWN5Y2xlLmRlYWRsaW5lX2F0KSByZXR1cm4gJ29uX3RyYWNrJ1xuICBjb25zdCBkZWFkbGluZUF0ID0gbmV3IERhdGUoY3ljbGUuZGVhZGxpbmVfYXQpXG4gIGNvbnN0IGdyYWNlID0gZGVhZGxpbmU/LmdyYWNlX2RheXMgPz8gMFxuICBjb25zdCB3YXJuID0gZGVhZGxpbmU/Lndhcm5fZGF5cyA/PyAzXG4gIGNvbnN0IGdyYWNlRW5kID0gYWRkRGF5cyhkZWFkbGluZUF0LCBncmFjZSlcblxuICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKSB7XG4gICAgcmV0dXJuICdvbl90cmFjaydcbiAgfVxuICBpZiAobm93ID4gZ3JhY2VFbmQpIHJldHVybiAnZmFpbGVkJ1xuICBpZiAobm93ID4gZGVhZGxpbmVBdCkgcmV0dXJuICdvdmVyZHVlJ1xuICBjb25zdCB3YXJuU3RhcnQgPSBhZGREYXlzKGRlYWRsaW5lQXQsIC13YXJuKVxuICBpZiAobm93ID49IHdhcm5TdGFydCkgcmV0dXJuICdhcHByb2FjaGluZydcbiAgcmV0dXJuICdvbl90cmFjaydcbn1cblxuZnVuY3Rpb24gZGF0ZU9ubHlJc28oZGF0ZTogRGF0ZSk6IHN0cmluZyB7XG4gIHJldHVybiBkYXRlLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbmFzeW5jIGZ1bmN0aW9uIHdyaXRlU25hcHNob3QoXG4gIGRiOiBEYkxpa2UsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIGFzT2Y6IERhdGUsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgYXNPZlN0ciA9IGRhdGVPbmx5SXNvKGFzT2YpXG4gIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGdvYWxfY3ljbGVfaWQ6IGN5Y2xlLmlkLFxuICAgICAgYXNfb2Y6IGFzT2ZTdHIsXG4gICAgICB2YWx1ZTogTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpLFxuICAgIH0pXG4gICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgb2MuY29sdW1ucyhbJ2dvYWxfY3ljbGVfaWQnLCAnYXNfb2YnXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICB2YWx1ZTogTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpLFxuICAgICAgfSlcbiAgICApXG4gICAgLmV4ZWN1dGUoKVxufVxuXG4vKipcbiAqIENyZWF0ZSB0aGUgZmlyc3QgY3ljbGUgZm9yIGEgbmV3bHkgY3JlYXRlZCBnb2FsLlxuICogVXNlcyBnb2FsLnN0YXJ0c19hdCBhcyB0aGUgY3ljbGUgd2luZG93IHN0YXJ0IChub3Qgd2FsbC1jbG9jayBub3cpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlSW5pdGlhbEN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IHN0YXJ0c0F0ID0gbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpXG4gIGNvbnN0IGVuZHNBdCA9IGNvbXB1dGVDeWNsZUVuZChzdGFydHNBdCwgcmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmVBdCA9IGNvbXB1dGVEZWFkbGluZUF0KHN0YXJ0c0F0LCBkZWFkbGluZSlcblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9pZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlX2luZGV4OiAwLFxuICAgICAgc3RhcnRzX2F0OiBzdGFydHNBdC50b0lTT1N0cmluZygpLFxuICAgICAgZW5kc19hdDogZW5kc0F0ID8gZW5kc0F0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgZGVhZGxpbmVfYXQ6IGRlYWRsaW5lQXQgPyBkZWFkbGluZUF0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgY3VycmVudF92YWx1ZTogMCxcbiAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICBjYXJyeV9vdmVyOiAwLFxuICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuXG4vKipcbiAqIFJld3JpdGUgYW4gYWN0aXZlIGN5Y2xlJ3Mgd2luZG93IGZyb20gYSBuZXcgc3RhcnRzX2F0IChhbmQgb3B0aW9uYWxcbiAqIHVwZGF0ZWQgZ29hbCByZWN1cnJlbmNlL2RlYWRsaW5lL3RhcmdldCkuIFVzZWQgd2hlbiBlZGl0aW5nIHN0YXJ0IGRhdGVcbiAqIGJlZm9yZSBwcm9ncmVzcyAvIHdoZW4gcmVzY2hlZHVsaW5nIGFuIHVuc3RhcnRlZCBjeWNsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc2NoZWR1bGVBY3RpdmVDeWNsZShcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3QgZW5kc0F0ID0gY29tcHV0ZUN5Y2xlRW5kKHN0YXJ0c0F0LCByZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZUF0ID0gY29tcHV0ZURlYWRsaW5lQXQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgIC5zZXQoe1xuICAgICAgc3RhcnRzX2F0OiBzdGFydHNBdC50b0lTT1N0cmluZygpLFxuICAgICAgZW5kc19hdDogZW5kc0F0ID8gZW5kc0F0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgZGVhZGxpbmVfYXQ6IGRlYWRsaW5lQXQgPyBkZWFkbGluZUF0LnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuXG4vKipcbiAqIENsb3NlIGFuIGFjdGl2ZSBjeWNsZSBhbmQgb3BlbiB0aGUgbmV4dCBvbmUgd2hlbiByZWN1cnJlbmNlIGFwcGxpZXMuXG4gKiBVc2VzIGxhenktb24tcmVhZDogY2FsbCBiZWZvcmUgcmV0dXJuaW5nIGdvYWxzIHRvIHRoZSBjbGllbnQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb2xsT3ZlcklmTmVlZGVkKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgLy8gRG8gbm90IHJvbGwgb3ZlciwgbWlzcy1iYWNrZmlsbCwgb3IgZmFpbCBkZWFkbGluZXMgYmVmb3JlIHRoZSBjeWNsZSBzdGFydHMuXG4gIGlmICghY3ljbGVIYXNTdGFydGVkKGN5Y2xlLCBub3cpKSB7XG4gICAgcmV0dXJuIGN5Y2xlXG4gIH1cblxuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGlmICghcmVjdXJyZW5jZSB8fCAhY3ljbGUuZW5kc19hdCkge1xuICAgIC8vIE9uZS10aW1lOiBtYXliZSBmYWlsIG9uIGRlYWRsaW5lIGdyYWNlLlxuICAgIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lLCBub3cpXG4gICAgaWYgKGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgc3RhdGUgPT09ICdmYWlsZWQnKSB7XG4gICAgICBjb25zdCB1cGRhdGVkID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHN0YXR1czogJ2ZhaWxlZCcsXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgICAuc2V0KHsgc3RhdHVzOiAnZmFpbGVkJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgdXBkYXRlZCwgbm93KVxuICAgICAgcmV0dXJuIHVwZGF0ZWRcbiAgICB9XG4gICAgcmV0dXJuIGN5Y2xlXG4gIH1cblxuICBpZiAoY3ljbGUuc3RhdHVzICE9PSAnYWN0aXZlJykgcmV0dXJuIGN5Y2xlXG4gIGlmIChub3cgPCBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KSkgcmV0dXJuIGN5Y2xlXG5cbiAgLy8gUmVjb21wdXRlIG9uZSBsYXN0IHRpbWUgYmVmb3JlIGNsb3NpbmcuXG4gIGxldCBjbG9zZWQgPSBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpXG4gIGNvbnN0IG1ldCA9IE51bWJlcihjbG9zZWQuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGNsb3NlZCwgZGVhZGxpbmUsIG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpKVxuXG4gIGxldCBjbG9zZVN0YXR1czogR29hbEN5Y2xlWydzdGF0dXMnXSA9IG1ldFxuICAgID8gJ3N1Y2NlZWRlZCdcbiAgICA6IHN0YXRlID09PSAnZmFpbGVkJyB8fCBzdGF0ZSA9PT0gJ292ZXJkdWUnXG4gICAgPyAnZmFpbGVkJ1xuICAgIDogJ21pc3NlZCdcblxuICAvLyBCYWNrLWZpbGwgbWlzc2VkIGludGVybWVkaWF0ZSBjeWNsZXMgaWYgd2Ugc2tpcHBlZCBtdWx0aXBsZSB3aW5kb3dzLlxuICBsZXQgY3Vyc29yU3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpXG4gIGxldCBjdXJzb3JFbmQgPSBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KVxuICBsZXQgY3ljbGVJbmRleCA9IGN5Y2xlLmN5Y2xlX2luZGV4XG4gIGxldCBjYXJyeSA9IDBcblxuICBpZiAoXG4gICAgcmVjdXJyZW5jZS5jYXJyeV9vdmVyID09PSAnb3ZlcmZsb3cnICYmXG4gICAgTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSA+IE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICApIHtcbiAgICBjYXJyeSA9IE51bWJlcihjbG9zZWQuY3VycmVudF92YWx1ZSkgLSBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgfVxuXG4gIGNsb3NlZCA9IGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBzdGF0dXM6IGNsb3NlU3RhdHVzLFxuICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgfSlcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjbG9zZWQuaWQpXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgY2xvc2VkLCBjdXJzb3JFbmQpXG5cbiAgLy8gR3JhbnQgcmV3YXJkcyB3aGVuIGEgcmVjdXJyaW5nIGN5Y2xlIGNsb3NlcyBhcyBzdWNjZWVkZWQgKGVkZ2UtdHJpZ2dlcikuXG4gIC8vIE9uZS10aW1lIHN1Y2Nlc3MgaXMgYWxyZWFkeSBncmFudGVkIGluc2lkZSByZWNvbXB1dGVDeWNsZS5cbiAgaWYgKGNsb3NlU3RhdHVzID09PSAnc3VjY2VlZGVkJyAmJiBjeWNsZS5zdGF0dXMgIT09ICdzdWNjZWVkZWQnKSB7XG4gICAgY29uc3QgeyBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzIH0gPSBhd2FpdCBpbXBvcnQoXG4gICAgICAnLi4vcmV3YXJkcy9ob29rcy50cydcbiAgICApXG4gICAgYXdhaXQgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhkYiwge1xuICAgICAgdXNlcklkOiBnb2FsLnVzZXJfaWQsXG4gICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICBjeWNsZUlkOiBjbG9zZWQuaWQsXG4gICAgfSlcbiAgfVxuXG4gIC8vIEZpbGwgZ2FwcyB1bnRpbCB3ZSByZWFjaCBhIGN5Y2xlIHRoYXQgY29udGFpbnMgYG5vd2AuXG4gIHdoaWxlIChjdXJzb3JFbmQgPD0gbm93KSB7XG4gICAgY29uc3QgbmV4dFN0YXJ0ID0gY3Vyc29yRW5kXG4gICAgY29uc3QgbmV4dEVuZCA9IGNvbXB1dGVDeWNsZUVuZChuZXh0U3RhcnQsIHJlY3VycmVuY2UpXG4gICAgaWYgKCFuZXh0RW5kKSBicmVha1xuXG4gICAgY3ljbGVJbmRleCArPSAxXG5cbiAgICAvLyBJZiB0aGlzIGludGVybWVkaWF0ZSB3aW5kb3cgaXMgYWxyZWFkeSBmdWxseSBpbiB0aGUgcGFzdCwgbWFyayBtaXNzZWQuXG4gICAgaWYgKG5leHRFbmQgPD0gbm93KSB7XG4gICAgICBjb25zdCBtaXNzZWREZWFkbGluZSA9IGNvbXB1dGVEZWFkbGluZUF0KG5leHRTdGFydCwgZGVhZGxpbmUpXG4gICAgICBjb25zdCBtaXNzZWQgPSBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICAgIGN5Y2xlX2luZGV4OiBjeWNsZUluZGV4LFxuICAgICAgICAgIHN0YXJ0c19hdDogbmV4dFN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGRlYWRsaW5lX2F0OiBtaXNzZWREZWFkbGluZSA/IG1pc3NlZERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgICAgIHN0YXR1czogJ21pc3NlZCcsXG4gICAgICAgICAgY2Fycnlfb3ZlcjogMCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSBhcyBOZXdHb2FsQ3ljbGUpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgbWlzc2VkLCBuZXh0RW5kKVxuICAgICAgY3Vyc29yU3RhcnQgPSBuZXh0U3RhcnRcbiAgICAgIGN1cnNvckVuZCA9IG5leHRFbmRcbiAgICAgIGNhcnJ5ID0gMFxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICAvLyBBY3RpdmUgbmV4dCBjeWNsZS5cbiAgICBjb25zdCBuZXh0RGVhZGxpbmUgPSBjb21wdXRlRGVhZGxpbmVBdChuZXh0U3RhcnQsIGRlYWRsaW5lKVxuICAgIGNvbnN0IG5leHQgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICBjeWNsZV9pbmRleDogY3ljbGVJbmRleCxcbiAgICAgICAgc3RhcnRzX2F0OiBuZXh0U3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICBkZWFkbGluZV9hdDogbmV4dERlYWRsaW5lID8gbmV4dERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgIGNhcnJ5X292ZXI6IGNhcnJ5LFxuICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgbmV4dClcbiAgfVxuXG4gIHJldHVybiBjbG9zZWRcbn1cblxuLyoqIFJvbGwgb3ZlciBhbGwgYWN0aXZlIGN5Y2xlcyBmb3IgYSB1c2VyIChsYXp5IGJhdGNoKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb2xsT3ZlclVzZXJHb2FscyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ2FjdGl2ZScsICdwYXVzZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgY29udGludWVcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgY29udGludWVcbiAgICBhd2FpdCByb2xsT3ZlcklmTmVlZGVkKGRiLCBnb2FsLCBjeWNsZSwgbm93KVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBHb2FsLCBHb2FsQ3ljbGUsIEdvYWxEZWFkbGluZUNvbmZpZyB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGRlYWRsaW5lU3RhdGUgfSBmcm9tICcuL2N5Y2xlcy50cydcblxuZXhwb3J0IHR5cGUgR29hbE51ZGdlS2luZCA9XG4gIHwgJ2RlYWRsaW5lX2FwcHJvYWNoaW5nJ1xuICB8ICdkZWFkbGluZV9vdmVyZHVlJ1xuICB8ICdiZWhpbmRfcGFjZSdcbiAgfCAnY3ljbGVfY29tcGxldGUnXG4gIHwgJ2RlcGVuZGVuY3lfdW5sb2NrZWQnXG4gIHwgJ2dvYWxfc3RhcnRpbmdfc29vbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTnVkZ2Uge1xuICBraW5kOiBHb2FsTnVkZ2VLaW5kXG4gIGdvYWxJZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnd2FybmluZycgfCAnc3VjY2Vzcydcbn1cblxuZnVuY3Rpb24gcGFyc2VEZWFkbGluZSh2YWx1ZTogdW5rbm93bik6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xufVxuXG5jb25zdCBTVEFSVElOR19TT09OX0RBWVMgPSAzXG5cbi8qKlxuICogQnVpbGQgaW4tYXBwIG51ZGdlcyBmb3IgZGFzaGJvYXJkIC8gbm90aWZpY2F0aW9ucyBzdXJmYWNlLlxuICogUHVyZSBmdW5jdGlvbiBcdTIwMTQgbm8gSS9PLlxuICogU2tpcHMgZGVhZGxpbmUvYmVoaW5kX3BhY2UgZm9yIGdvYWxzIHRoYXQgaGF2ZSBub3Qgc3RhcnRlZCB5ZXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdvYWxOdWRnZXMoXG4gIGdvYWxzOiBBcnJheTx7IGdvYWw6IEdvYWw7IGN5Y2xlOiBHb2FsQ3ljbGUgfCBudWxsIH0+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbE51ZGdlW10ge1xuICBjb25zdCBudWRnZXM6IEdvYWxOdWRnZVtdID0gW11cblxuICBmb3IgKGNvbnN0IHsgZ29hbCwgY3ljbGUgfSBvZiBnb2Fscykge1xuICAgIGlmICghY3ljbGUgfHwgZ29hbC5zdGF0dXMgIT09ICdhY3RpdmUnKSBjb250aW51ZVxuXG4gICAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgICBpZiAoc3RhcnRzQXQgPiBub3cpIHtcbiAgICAgIGNvbnN0IG1zVW50aWwgPSBzdGFydHNBdC5nZXRUaW1lKCkgLSBub3cuZ2V0VGltZSgpXG4gICAgICBjb25zdCBkYXlzVW50aWwgPSBtc1VudGlsIC8gKDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICBpZiAoZGF5c1VudGlsIDw9IFNUQVJUSU5HX1NPT05fREFZUykge1xuICAgICAgICBjb25zdCBkYXlzTGFiZWwgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwoZGF5c1VudGlsKSlcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdnb2FsX3N0YXJ0aW5nX3Nvb24nLFxuICAgICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBzdGFydHMgaW4gJHtkYXlzTGFiZWx9IGRheSR7XG4gICAgICAgICAgICBkYXlzTGFiZWwgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0uYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgY3ljbGUuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgaWYgKHRhcmdldE1ldCkge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnY3ljbGVfY29tcGxldGUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgWW91IGNvbXBsZXRlZCBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGZvciB0aGlzIGN5Y2xlLmAsXG4gICAgICAgIHNldmVyaXR5OiAnc3VjY2VzcycsXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCBkZWFkbGluZSA9IHBhcnNlRGVhZGxpbmUoZ29hbC5kZWFkbGluZSlcbiAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lLCBub3cpXG4gICAgaWYgKHN0YXRlID09PSAnYXBwcm9hY2hpbmcnKSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdkZWFkbGluZV9hcHByb2FjaGluZycsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBEZWFkbGluZSBmb3IgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBhcHByb2FjaGluZy5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHN0YXRlID09PSAnb3ZlcmR1ZScpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlYWRsaW5lX292ZXJkdWUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBwYXN0IGl0cyBkZWFkbGluZS5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBCZWhpbmQtcGFjZSBmb3IgcmVjdXJyaW5nIGN5Y2xlcyB3aXRoIGEga25vd24gZW5kLlxuICAgIGlmIChjeWNsZS5lbmRzX2F0ICYmIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICAgICAgY29uc3QgZW5kID0gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpXG4gICAgICBjb25zdCBzcGFuID0gTWF0aC5tYXgoMSwgZW5kIC0gc3RhcnQpXG4gICAgICBjb25zdCBlbGFwc2VkID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKG5vdy5nZXRUaW1lKCkgLSBzdGFydCkgLyBzcGFuKSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkID0gZWxhcHNlZCAqIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBjb25zdCBhY3R1YWwgPSBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSlcbiAgICAgIGlmIChlbGFwc2VkID49IDAuMzUgJiYgYWN0dWFsIDwgZXhwZWN0ZWQgKiAwLjcpIHtcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdiZWhpbmRfcGFjZScsXG4gICAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIGJlaGluZCBwYWNlIHRoaXMgY3ljbGUuYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIE5ld1Jld2FyZERlZmluaXRpb24sXG4gIE5ld1Jld2FyZFJ1bGUsXG4gIFJld2FyZERlZmluaXRpb24gYXMgUmV3YXJkRGVmaW5pdGlvblJvdyxcbiAgUmV3YXJkSW52ZW50b3J5IGFzIFJld2FyZEludmVudG9yeVJvdyxcbiAgUmV3YXJkUnVsZSBhcyBSZXdhcmRSdWxlUm93LFxuICBSZXdhcmRSdWxlQ29uZmlnLFxuICBSZXdhcmRUcmFuc2FjdGlvbiBhcyBSZXdhcmRUcmFuc2FjdGlvblJvdyxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXRQdWJsaWNQYXRoLFxuICBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5LFxufSBmcm9tICcuLi8uLi9hc3NldHMvcmVwb3NpdG9yeS50cydcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbiAgSW52ZW50b3J5RXJyb3IsXG4gIHJlY29tcHV0ZUludmVudG9yeUZyb21MZWRnZXIsXG59IGZyb20gJy4uLy4uL3Jld2FyZHMvaW52ZW50b3J5LnRzJ1xuaW1wb3J0IHsgcmV3YXJkR3JhbnRTZXJ2aWNlIH0gZnJvbSAnLi4vLi4vcmV3YXJkcy9ncmFudF9zZXJ2aWNlLnRzJ1xuaW1wb3J0IHsgdmFsaWRhdGVHcm91cENvbG9yIH0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcbmltcG9ydCB0eXBlIHtcbiAgQXR0YWNoUmV3YXJkUnVsZUlucHV0LFxuICBDb25zdW1lUmV3YXJkSW5wdXQsXG4gIENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dCxcbiAgRGlzY2FyZFJld2FyZElucHV0LFxuICBNYW51YWxHcmFudFJld2FyZElucHV0LFxuICBSZXdhcmREZWZpbml0aW9uc0ZpbHRlcixcbiAgUmV3YXJkSGlzdG9yeUZpbHRlcixcbiAgUmV3YXJkSW52ZW50b3J5RmlsdGVyLFxuICBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZFJld2FyZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkUmV3YXJkRXJyb3InXG4gIH1cbn1cblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG4vKiogTmFtZWQgcmV0dXJuIHNoYXBlcyBzbyBQeWxvbiBlbWl0cyBHcmFwaFFMIG9iamVjdCB0eXBlcyAobm90IGBBbnkhYCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZEltYWdlIHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgc2hhMjU2OiBzdHJpbmdcbiAgY29udGVudF90eXBlOiBzdHJpbmdcbiAgYnl0ZV9zaXplOiBudW1iZXJcbiAgc3RvcmFnZV9rZXk6IHN0cmluZ1xuICByZWZfY291bnQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBEYXRlXG4gIG9ycGhhbmVkX2F0OiBEYXRlIHwgbnVsbFxuICB1cmw6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZERlZmluaXRpb24ge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgbm90ZXM6IHN0cmluZyB8IG51bGxcbiAgY2F0ZWdvcnk6IHN0cmluZyB8IG51bGxcbiAgdGFnczogc3RyaW5nW11cbiAgY29sb3I6IHN0cmluZ1xuICBpY29uOiBzdHJpbmcgfCBudWxsXG4gIGltYWdlX2Fzc2V0X2lkOiBudW1iZXIgfCBudWxsXG4gIHN0YWNrYWJsZTogYm9vbGVhblxuICBkZWZhdWx0X3F1YW50aXR5OiBudW1iZXJcbiAgc29ydF9vcmRlcjogbnVtYmVyXG4gIGFyY2hpdmVkX2F0OiBEYXRlIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlXG4gIHVwZGF0ZWRfYXQ6IERhdGVcbiAgaW1hZ2VfdXJsOiBzdHJpbmcgfCBudWxsXG4gIGltYWdlOiAoKSA9PiBQcm9taXNlPFJld2FyZEltYWdlIHwgbnVsbD5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRJbnZlbnRvcnlJdGVtIHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlclxuICBxdWFudGl0eTogbnVtYmVyXG4gIHN0YWNrX2tleTogc3RyaW5nIHwgbnVsbFxuICBmaXJzdF9lYXJuZWRfYXQ6IERhdGVcbiAgbGFzdF9lYXJuZWRfYXQ6IERhdGVcbiAgdXBkYXRlZF9hdDogRGF0ZVxuICBkZWZpbml0aW9uOiAoKSA9PiBQcm9taXNlPFJld2FyZERlZmluaXRpb24gfCBudWxsPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZEhpc3RvcnlJdGVtIHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgdHlwZTogc3RyaW5nXG4gIHJld2FyZF9kZWZpbml0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIGludmVudG9yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBxdWFudGl0eTogbnVtYmVyXG4gIGRlZmluaXRpb25fbmFtZTogc3RyaW5nXG4gIGRlZmluaXRpb25fY29sb3I6IHN0cmluZ1xuICBkZWZpbml0aW9uX2ljb246IHN0cmluZyB8IG51bGxcbiAgaW1hZ2VfYXNzZXRfaWQ6IG51bWJlciB8IG51bGxcbiAgc291cmNlX3R5cGU6IHN0cmluZyB8IG51bGxcbiAgc291cmNlX2lkOiBudW1iZXIgfCBudWxsXG4gIHRyaWdnZXJfa2V5OiBzdHJpbmcgfCBudWxsXG4gIHJ1bGVfaWQ6IG51bWJlciB8IG51bGxcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ29hbF9pZDogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIGN5Y2xlX2lkOiBudW1iZXIgfCBudWxsXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgbWV0YWRhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkUnVsZSB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNvdXJjZV90eXBlOiBzdHJpbmdcbiAgc291cmNlX2lkOiBudW1iZXJcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlclxuICBxdWFudGl0eTogbnVtYmVyXG4gIG1vZGU6IHN0cmluZ1xuICBjb25maWc6IFJld2FyZFJ1bGVDb25maWdcbiAgZW5hYmxlZDogYm9vbGVhblxuICBjcmVhdGVkX2F0OiBEYXRlXG4gIHVwZGF0ZWRfYXQ6IERhdGVcbiAgZGVmaW5pdGlvbjogKCkgPT4gUHJvbWlzZTxSZXdhcmREZWZpbml0aW9uIHwgbnVsbD5cbn1cblxuZnVuY3Rpb24gcGFyc2VUYWdzKHZhbHVlOiB1bmtub3duKTogc3RyaW5nW10ge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIFtdXG4gIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkgcmV0dXJuIHZhbHVlLm1hcChTdHJpbmcpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UodmFsdWUpXG4gICAgICByZXR1cm4gQXJyYXkuaXNBcnJheShwYXJzZWQpID8gcGFyc2VkLm1hcChTdHJpbmcpIDogW11cbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBbXVxuICAgIH1cbiAgfVxuICByZXR1cm4gW11cbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcodmFsdWU6IHVua25vd24pOiBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiB7fVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBSZXdhcmRSdWxlQ29uZmlnXG59XG5cbmZ1bmN0aW9uIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdzogUmV3YXJkRGVmaW5pdGlvblJvdyk6IFJld2FyZERlZmluaXRpb24ge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICB0YWdzOiBwYXJzZVRhZ3Mocm93LnRhZ3MpLFxuICAgIGltYWdlX3VybDogcm93LmltYWdlX2Fzc2V0X2lkXG4gICAgICA/IGFzc2V0UHVibGljUGF0aChyb3cuaW1hZ2VfYXNzZXRfaWQpXG4gICAgICA6IG51bGwsXG4gICAgaW1hZ2U6IGFzeW5jICgpOiBQcm9taXNlPFJld2FyZEltYWdlIHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKHJvdy5pbWFnZV9hc3NldF9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8uZ2V0TWV0YWRhdGEocm93LmltYWdlX2Fzc2V0X2lkLCByb3cudXNlcl9pZClcbiAgICAgIGlmICghYXNzZXQpIHJldHVybiBudWxsXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5hc3NldCxcbiAgICAgICAgdXJsOiBhc3NldFB1YmxpY1BhdGgoYXNzZXQuaWQpLFxuICAgICAgfVxuICAgIH0sXG4gIH1cbn1cblxuZnVuY3Rpb24gd2l0aEludmVudG9yeVJlbGF0aW9ucyhyb3c6IFJld2FyZEludmVudG9yeVJvdyk6IFJld2FyZEludmVudG9yeUl0ZW0ge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBkZWZpbml0aW9uOiBhc3luYyAoKTogUHJvbWlzZTxSZXdhcmREZWZpbml0aW9uIHwgbnVsbD4gPT4ge1xuICAgICAgY29uc3QgZGVmID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIHJvdy5yZXdhcmRfZGVmaW5pdGlvbl9pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIHJldHVybiBkZWYgPyB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhkZWYpIDogbnVsbFxuICAgIH0sXG4gIH1cbn1cblxuZnVuY3Rpb24gd2l0aFJ1bGVSZWxhdGlvbnMocm93OiBSZXdhcmRSdWxlUm93KTogUmV3YXJkUnVsZSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIGNvbmZpZzogcGFyc2VDb25maWcocm93LmNvbmZpZyksXG4gICAgZGVmaW5pdGlvbjogYXN5bmMgKCk6IFByb21pc2U8UmV3YXJkRGVmaW5pdGlvbiB8IG51bGw+ID0+IHtcbiAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gZGVmID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMoZGVmKSA6IG51bGxcbiAgICB9LFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFRyYW5zYWN0aW9uKHJvdzogUmV3YXJkVHJhbnNhY3Rpb25Sb3cpOiBSZXdhcmRIaXN0b3J5SXRlbSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIG1ldGFkYXRhOlxuICAgICAgdHlwZW9mIHJvdy5tZXRhZGF0YSA9PT0gJ3N0cmluZydcbiAgICAgICAgPyBKU09OLnBhcnNlKHJvdy5tZXRhZGF0YSlcbiAgICAgICAgOiByb3cubWV0YWRhdGEsXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ25hbWUgdG9vIGxvbmcnKVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgY29uc3QgUmV3YXJkUXVlcnkgPSB7XG4gIHJld2FyZERlZmluaXRpb25zOiBhc3luYyAoYXJnczoge1xuICAgIGZpbHRlcj86IFJld2FyZERlZmluaXRpb25zRmlsdGVyIHwgbnVsbFxuICB9KTogUHJvbWlzZTxSZXdhcmREZWZpbml0aW9uW10+ID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmaWx0ZXIgPSBhcmdzLmZpbHRlciA/PyB7fVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuc2VhcmNoPy50cmltKCkpIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBgJSR7ZmlsdGVyLnNlYXJjaC50cmltKCkudG9Mb3dlckNhc2UoKX0lYFxuICAgICAgcSA9IHEud2hlcmUoKGViKSA9PlxuICAgICAgICBlYi5vcihbXG4gICAgICAgICAgZWIoJ25hbWUnLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignZGVzY3JpcHRpb24nLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignY2F0ZWdvcnknLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgXSksXG4gICAgICApXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuY2F0ZWdvcnk/LnRyaW0oKSkge1xuICAgICAgcSA9IHEud2hlcmUoJ2NhdGVnb3J5JywgJz0nLCBmaWx0ZXIuY2F0ZWdvcnkudHJpbSgpKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDEwMCwgMSksIDIwMClcbiAgICBjb25zdCBvZmZzZXQgPSBNYXRoLm1heChmaWx0ZXIub2Zmc2V0ID8/IDAsIDApXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcVxuICAgICAgLm9yZGVyQnkoJ3NvcnRfb3JkZXInLCAnYXNjJylcbiAgICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgICAubGltaXQobGltaXQpXG4gICAgICAub2Zmc2V0KG9mZnNldClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKVxuICB9LFxuXG4gIHJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaWQ6IG51bWJlclxuICB9KTogUHJvbWlzZTxSZXdhcmREZWZpbml0aW9uIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpIDogbnVsbFxuICB9LFxuXG4gIHJld2FyZEludmVudG9yeTogYXN5bmMgKGFyZ3M6IHtcbiAgICBmaWx0ZXI/OiBSZXdhcmRJbnZlbnRvcnlGaWx0ZXIgfCBudWxsXG4gIH0pOiBQcm9taXNlPFJld2FyZEludmVudG9yeUl0ZW1bXT4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZpbHRlciA9IGFyZ3MuZmlsdGVyID8/IHt9XG4gICAgbGV0IHEgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmlubmVySm9pbihcbiAgICAgICAgJ3Jld2FyZF9kZWZpbml0aW9ucycsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMuaWQnLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICApXG4gICAgICAud2hlcmUoJ3Jld2FyZF9pbnZlbnRvcnkudXNlcl9pZCcsICc9JywgdXNlcklkKVxuXG4gICAgaWYgKGZpbHRlci5zZWFyY2g/LnRyaW0oKSkge1xuICAgICAgY29uc3QgdGVybSA9IGAlJHtmaWx0ZXIuc2VhcmNoLnRyaW0oKS50b0xvd2VyQ2FzZSgpfSVgXG4gICAgICBxID0gcS53aGVyZSgncmV3YXJkX2RlZmluaXRpb25zLm5hbWUnLCAnaWxpa2UnLCB0ZXJtKVxuICAgIH1cbiAgICBpZiAoZmlsdGVyLnN0YWNrYWJsZU9ubHkpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbnMuc3RhY2thYmxlJywgJz0nLCB0cnVlKVxuICAgIH1cblxuICAgIGNvbnN0IHNvcnQgPSBmaWx0ZXIuc29ydCA/PyAncmVjZW50J1xuICAgIGlmIChzb3J0ID09PSAnbmFtZScpIHtcbiAgICAgIHEgPSBxLm9yZGVyQnkoJ3Jld2FyZF9kZWZpbml0aW9ucy5uYW1lJywgJ2FzYycpXG4gICAgfSBlbHNlIGlmIChzb3J0ID09PSAncXVhbnRpdHknKSB7XG4gICAgICBxID0gcS5vcmRlckJ5KCdyZXdhcmRfaW52ZW50b3J5LnF1YW50aXR5JywgJ2Rlc2MnKVxuICAgIH0gZWxzZSB7XG4gICAgICBxID0gcS5vcmRlckJ5KCdyZXdhcmRfaW52ZW50b3J5Lmxhc3RfZWFybmVkX2F0JywgJ2Rlc2MnKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDEwMCwgMSksIDIwMClcbiAgICBjb25zdCBvZmZzZXQgPSBNYXRoLm1heChmaWx0ZXIub2Zmc2V0ID8/IDAsIDApXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcVxuICAgICAgLnNlbGVjdEFsbCgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAubGltaXQobGltaXQpXG4gICAgICAub2Zmc2V0KG9mZnNldClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoSW52ZW50b3J5UmVsYXRpb25zKVxuICB9LFxuXG4gIHJld2FyZEhpc3Rvcnk6IGFzeW5jIChhcmdzOiB7XG4gICAgZmlsdGVyPzogUmV3YXJkSGlzdG9yeUZpbHRlciB8IG51bGxcbiAgfSk6IFByb21pc2U8UmV3YXJkSGlzdG9yeUl0ZW1bXT4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZpbHRlciA9IGFyZ3MuZmlsdGVyID8/IHt9XG4gICAgbGV0IHEgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoZmlsdGVyLmRlZmluaXRpb25JZCAhPSBudWxsKSB7XG4gICAgICBxID0gcS53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGZpbHRlci5kZWZpbml0aW9uSWQpXG4gICAgfVxuICAgIGlmIChmaWx0ZXIudHlwZT8udHJpbSgpKSB7XG4gICAgICBxID0gcS53aGVyZSgndHlwZScsICc9JywgZmlsdGVyLnR5cGUudHJpbSgpIGFzIG5ldmVyKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDUwLCAxKSwgMjAwKVxuICAgIGNvbnN0IG9mZnNldCA9IE1hdGgubWF4KGZpbHRlci5vZmZzZXQgPz8gMCwgMClcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxXG4gICAgICAub3JkZXJCeSgnY3JlYXRlZF9hdCcsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5saW1pdChsaW1pdClcbiAgICAgIC5vZmZzZXQob2Zmc2V0KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcm93cy5tYXAobWFwVHJhbnNhY3Rpb24pXG4gIH0sXG5cbiAgcmV3YXJkUnVsZXM6IGFzeW5jIChhcmdzOiB7XG4gICAgc291cmNlVHlwZTogc3RyaW5nXG4gICAgc291cmNlSWQ6IG51bWJlclxuICB9KTogUHJvbWlzZTxSZXdhcmRSdWxlW10+ID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3NvdXJjZV90eXBlJywgJz0nLCBhcmdzLnNvdXJjZVR5cGUpXG4gICAgICAud2hlcmUoJ3NvdXJjZV9pZCcsICc9JywgYXJncy5zb3VyY2VJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoUnVsZVJlbGF0aW9ucylcbiAgfSxcblxuICByZWNlbnRBc3NldHM6IGFzeW5jIChhcmdzOiB7IGxpbWl0PzogbnVtYmVyIHwgbnVsbCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHJlcG8ubGlzdFJlY2VudChcbiAgICAgIHVzZXJJZCxcbiAgICAgIE1hdGgubWluKE1hdGgubWF4KGFyZ3MubGltaXQgPz8gMjAsIDEpLCA1MCksXG4gICAgKVxuICAgIHJldHVybiByb3dzLm1hcCgoYSkgPT4gKHsgLi4uYSwgdXJsOiBhc3NldFB1YmxpY1BhdGgoYS5pZCkgfSkpXG4gIH0sXG5cbiAgcmV3YXJkTnVkZ2VzOiBhc3luYyAoX2FyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IGJ1aWxkUmV3YXJkTnVkZ2VzIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL3Jld2FyZHMvbnVkZ2VzLnRzJylcbiAgICBjb25zdCBpbnZlbnRvcnkgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmlubmVySm9pbihcbiAgICAgICAgJ3Jld2FyZF9kZWZpbml0aW9ucycsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMuaWQnLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICApXG4gICAgICAud2hlcmUoJ3Jld2FyZF9pbnZlbnRvcnkudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdChbXG4gICAgICAgICdyZXdhcmRfaW52ZW50b3J5LmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucXVhbnRpdHknLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsXG4gICAgICBdKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVjZW50RWFybnMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KDEwKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gYnVpbGRSZXdhcmROdWRnZXMoe1xuICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkubWFwKChyKSA9PiAoe1xuICAgICAgICBpZDogci5pZCxcbiAgICAgICAgcXVhbnRpdHk6IHIucXVhbnRpdHksXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiByLnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBuYW1lOiByLm5hbWUsXG4gICAgICB9KSksXG4gICAgICByZWNlbnRFYXJucyxcbiAgICB9KVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgUmV3YXJkTXV0YXRpb24gPSB7XG4gIGNyZWF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaW5wdXQ6IENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dFxuICB9KTogUHJvbWlzZTxSZXdhcmREZWZpbml0aW9uPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJnc1xuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8uZ2V0TWV0YWRhdGEoaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgYXdhaXQgcmVwby5yZXRhaW4oaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgbm90ZXM6IGlucHV0Lm5vdGVzPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgY2F0ZWdvcnk6IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgdGFnczogSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSksXG4gICAgICAgIGNvbG9yLFxuICAgICAgICBpY29uOiBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgaW1hZ2VfYXNzZXRfaWQ6IGlucHV0LmltYWdlQXNzZXRJZCA/PyBudWxsLFxuICAgICAgICBzdGFja2FibGU6IGlucHV0LnN0YWNrYWJsZSA/PyB0cnVlLFxuICAgICAgICBkZWZhdWx0X3F1YW50aXR5OiBNYXRoLm1heCgxLCBpbnB1dC5kZWZhdWx0UXVhbnRpdHkgPz8gMSksXG4gICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZERlZmluaXRpb24pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIHVwZGF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaWQ6IG51bWJlclxuICAgIGlucHV0OiBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRcbiAgfSk6IFByb21pc2U8UmV3YXJkRGVmaW5pdGlvbj4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3QgcGF0Y2g6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBpZiAoaW5wdXQuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2guZGVzY3JpcHRpb24gPSBpbnB1dC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IG51bGxcbiAgICB9XG4gICAgaWYgKGlucHV0Lm5vdGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLm5vdGVzID0gaW5wdXQubm90ZXM/LnRyaW0oKSB8fCBudWxsXG4gICAgfVxuICAgIGlmIChpbnB1dC5jYXRlZ29yeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC5jYXRlZ29yeSA9IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbFxuICAgIH1cbiAgICBpZiAoaW5wdXQudGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC50YWdzID0gSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSlcbiAgICB9XG4gICAgaWYgKGlucHV0LmNvbG9yICE9IG51bGwpIHBhdGNoLmNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKVxuICAgIGlmIChpbnB1dC5pY29uICE9PSB1bmRlZmluZWQpIHBhdGNoLmljb24gPSBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbFxuICAgIGlmIChpbnB1dC5zdGFja2FibGUgIT0gbnVsbCkgcGF0Y2guc3RhY2thYmxlID0gaW5wdXQuc3RhY2thYmxlXG4gICAgaWYgKGlucHV0LmRlZmF1bHRRdWFudGl0eSAhPSBudWxsKSB7XG4gICAgICBwYXRjaC5kZWZhdWx0X3F1YW50aXR5ID0gTWF0aC5tYXgoMSwgaW5wdXQuZGVmYXVsdFF1YW50aXR5KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuc29ydE9yZGVyICE9IG51bGwpIHBhdGNoLnNvcnRfb3JkZXIgPSBpbnB1dC5zb3J0T3JkZXJcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBpZiAoaW5wdXQuaW1hZ2VBc3NldElkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCByZXBvLmdldE1ldGFkYXRhKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT09IGlucHV0LmltYWdlQXNzZXRJZCkge1xuICAgICAgICAgIGF3YWl0IHJlcG8ucmV0YWluKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICAgIGlmIChleGlzdGluZy5pbWFnZV9hc3NldF9pZCAhPSBudWxsKSB7XG4gICAgICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgIH1cbiAgICAgIHBhdGNoLmltYWdlX2Fzc2V0X2lkID0gaW5wdXQuaW1hZ2VBc3NldElkXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQocGF0Y2gpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIGFyY2hpdmVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczoge1xuICAgIGlkOiBudW1iZXJcbiAgfSk6IFByb21pc2U8UmV3YXJkRGVmaW5pdGlvbj4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghcm93KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdkZWZpbml0aW9uIG5vdCBmb3VuZCcpXG4gICAgcmV0dXJuIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICB1bmFyY2hpdmVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczoge1xuICAgIGlkOiBudW1iZXJcbiAgfSk6IFByb21pc2U8UmV3YXJkRGVmaW5pdGlvbj4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG51bGwsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuICAgIHJldHVybiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgZGVsZXRlUmV3YXJkRGVmaW5pdGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgaW52ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgYXJncy5pZClcbiAgICAgIC5zZWxlY3QoJ2lkJylcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoaW52KSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKFxuICAgICAgICAnY2Fubm90IGRlbGV0ZSBkZWZpbml0aW9uIHdpdGggaW52ZW50b3J5OyBhcmNoaXZlIGluc3RlYWQnLFxuICAgICAgKVxuICAgIH1cblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgcmV0dXJuIGZhbHNlXG5cbiAgICBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICB9XG4gICAgcmV0dXJuIHRydWVcbiAgfSxcblxuICBhdHRhY2hSZXdhcmRSdWxlOiBhc3luYyAoYXJnczogeyBpbnB1dDogQXR0YWNoUmV3YXJkUnVsZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzXG4gICAgY29uc3Qgc291cmNlVHlwZSA9IGlucHV0LnNvdXJjZVR5cGUudHJpbSgpXG4gICAgaWYgKCFzb3VyY2VUeXBlKSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdzb3VyY2VUeXBlIGlzIHJlcXVpcmVkJylcbiAgICBpZiAoIU51bWJlci5pc0Zpbml0ZShpbnB1dC5zb3VyY2VJZCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ3NvdXJjZUlkIGlzIHJlcXVpcmVkJylcbiAgICB9XG5cbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQucmV3YXJkRGVmaW5pdGlvbklkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2RlZmluaXRpb24gbm90IGZvdW5kJylcblxuICAgIGlmIChzb3VyY2VUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBjb25zdCBhY3QgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LnNvdXJjZUlkKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIWFjdCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignYWN0aXZpdHkgbm90IGZvdW5kJylcbiAgICB9IGVsc2UgaWYgKHNvdXJjZVR5cGUgPT09ICdnb2FsJykge1xuICAgICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlucHV0LnNvdXJjZUlkKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIWdvYWwpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2dvYWwgbm90IGZvdW5kJylcbiAgICB9XG5cbiAgICBsZXQgY29uZmlnOiBSZXdhcmRSdWxlQ29uZmlnID0ge31cbiAgICBpZiAoaW5wdXQuY29uZmlnSnNvbj8udHJpbSgpKSB7XG4gICAgICB0cnkge1xuICAgICAgICBjb25maWcgPSBKU09OLnBhcnNlKGlucHV0LmNvbmZpZ0pzb24pIGFzIFJld2FyZFJ1bGVDb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdjb25maWdKc29uIG11c3QgYmUgdmFsaWQgSlNPTicpXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgbW9kZSA9IGlucHV0Lm1vZGUgPz8gJ2ZpeGVkJ1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3J1bGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIHNvdXJjZV90eXBlOiBzb3VyY2VUeXBlLFxuICAgICAgICBzb3VyY2VfaWQ6IGlucHV0LnNvdXJjZUlkLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogaW5wdXQucmV3YXJkRGVmaW5pdGlvbklkLFxuICAgICAgICBxdWFudGl0eTogTWF0aC5tYXgoMSwgaW5wdXQucXVhbnRpdHkgPz8gMSksXG4gICAgICAgIG1vZGUsXG4gICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoY29uZmlnKSxcbiAgICAgICAgZW5hYmxlZDogaW5wdXQuZW5hYmxlZCA/PyB0cnVlLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkUnVsZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB3aXRoUnVsZVJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgZGV0YWNoUmV3YXJkUnVsZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMFxuICB9LFxuXG4gIGNvbnN1bWVSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb25zdW1lUmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IG1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKClcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBpbnZlbnRvcnksIHRyYW5zYWN0aW9uIH0gPSBhd2FpdCBkYlxuICAgICAgICAudHJhbnNhY3Rpb24oKVxuICAgICAgICAuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IG1hbmFnZXIuYXBwbHlDb25zdW1lKFxuICAgICAgICAgICAgdHJ4LFxuICAgICAgICAgICAgdXNlcklkLFxuICAgICAgICAgICAgYXJncy5pbnB1dC5pbnZlbnRvcnlJZCxcbiAgICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgICAgYXJncy5pbnB1dC5ub3RlLFxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogaW52ZW50b3J5ID8gd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpIDogbnVsbCxcbiAgICAgICAgdHJhbnNhY3Rpb246IG1hcFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKSxcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBJbnZlbnRvcnlFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIGRpc2NhcmRSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBEaXNjYXJkUmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IG1hbmFnZXIgPSBuZXcgRGJJbnZlbnRvcnlNYW5hZ2VyKClcbiAgICB0cnkge1xuICAgICAgY29uc3QgeyBpbnZlbnRvcnksIHRyYW5zYWN0aW9uIH0gPSBhd2FpdCBkYlxuICAgICAgICAudHJhbnNhY3Rpb24oKVxuICAgICAgICAuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICAgICAgcmV0dXJuIGF3YWl0IG1hbmFnZXIuYXBwbHlEaXNjYXJkKFxuICAgICAgICAgICAgdHJ4LFxuICAgICAgICAgICAgdXNlcklkLFxuICAgICAgICAgICAgYXJncy5pbnB1dC5pbnZlbnRvcnlJZCxcbiAgICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgIClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogaW52ZW50b3J5ID8gd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpIDogbnVsbCxcbiAgICAgICAgdHJhbnNhY3Rpb246IG1hcFRyYW5zYWN0aW9uKHRyYW5zYWN0aW9uKSxcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBJbnZlbnRvcnlFcnJvcikge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKGVyci5tZXNzYWdlKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIHJlc3RvcmVSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IHRyYW5zYWN0aW9uSWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseVJlc3RvcmUodHJ4LCB1c2VySWQsIGFyZ3MudHJhbnNhY3Rpb25JZClcbiAgICAgICAgfSlcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGludmVudG9yeTogd2l0aEludmVudG9yeVJlbGF0aW9ucyhpbnZlbnRvcnkpLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgbWFudWFsR3JhbnRSZXdhcmQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBNYW51YWxHcmFudFJld2FyZElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBxdWFudGl0eSA9IE1hdGgubWF4KDEsIGFyZ3MuaW5wdXQucXVhbnRpdHkgPz8gMSlcbiAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pbnB1dC5yZXdhcmREZWZpbml0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgY29uc3QgcmVzdWx0cyA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICByZXR1cm4gYXdhaXQgcmV3YXJkR3JhbnRTZXJ2aWNlLmdyYW50KHRyeCwgdXNlcklkLCBbXG4gICAgICAgIHtcbiAgICAgICAgICBydWxlSWQ6IG51bGwsXG4gICAgICAgICAgZGVmaW5pdGlvbklkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICAgIHF1YW50aXR5LFxuICAgICAgICAgIHRyaWdnZXJLZXk6IGBtYW51YWw6JHtEYXRlLm5vdygpfToke2NyeXB0by5yYW5kb21VVUlEKCl9YCxcbiAgICAgICAgICBzb3VyY2VUeXBlOiAnbWFudWFsJyxcbiAgICAgICAgICBzb3VyY2VJZDogMCxcbiAgICAgICAgfSxcbiAgICAgIF0pXG4gICAgfSlcblxuICAgIGNvbnN0IHR4ID0gcmVzdWx0c1swXT8udHJhbnNhY3Rpb25cbiAgICByZXR1cm4gdHggPyBtYXBUcmFuc2FjdGlvbih0eCkgOiBudWxsXG4gIH0sXG5cbiAgcmVjb21wdXRlUmV3YXJkSW52ZW50b3J5OiBhc3luYyAoKSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgYXdhaXQgcmVjb21wdXRlSW52ZW50b3J5RnJvbUxlZGdlcihkYiwgdXNlcklkKVxuICAgIHJldHVybiB0cnVlXG4gIH0sXG59XG4iLCAiLyoqIFNIQS0yNTYgaGV4IGRpZ2VzdCBvZiByYXcgYnl0ZXMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoJ1NIQS0yNTYnLCBieXRlcylcbiAgcmV0dXJuIEFycmF5LmZyb20obmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSlcbiAgICAubWFwKChiKSA9PiBiLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpKVxuICAgIC5qb2luKCcnKVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEltYWdlSGFzaGluZ1NlcnZpY2Uge1xuICBzaGEyNTYoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz5cbn1cblxuZXhwb3J0IGNvbnN0IGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlOiBJbWFnZUhhc2hpbmdTZXJ2aWNlID0ge1xuICBzaGEyNTY6IHNoYTI1NkhleCxcbn1cbiIsICJpbXBvcnQgeyBqb2luIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHsgbWtkaXIsIHJlYWRGaWxlLCB1bmxpbmssIHdyaXRlRmlsZSB9IGZyb20gJ25vZGU6ZnMvcHJvbWlzZXMnXG5pbXBvcnQgdHlwZSB7IEFzc2V0U3RvcmFnZSB9IGZyb20gJy4vdHlwZXMudHMnXG5cbmZ1bmN0aW9uIGN3ZCgpOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBwcm9jZXNzLmN3ZCA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBwcm9jZXNzLmN3ZCgpXG4gIH1cbiAgcmV0dXJuICcuJ1xufVxuXG5mdW5jdGlvbiBhc3NldHNSb290KCk6IHN0cmluZyB7XG4gIGNvbnN0IGVudiA9XG4gICAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVNTRVRTX0RJUikgfHwgbnVsbFxuICBpZiAoZW52KSByZXR1cm4gZW52XG4gIHJldHVybiBqb2luKGN3ZCgpLCAnZGF0YScsICdhc3NldHMnKVxufVxuXG5leHBvcnQgY2xhc3MgTG9jYWxGc0Fzc2V0U3RvcmFnZSBpbXBsZW1lbnRzIEFzc2V0U3RvcmFnZSB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgcm9vdDogc3RyaW5nID0gYXNzZXRzUm9vdCgpKSB7fVxuXG4gIHByaXZhdGUgZnVsbFBhdGgoa2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNhZmUgPSBrZXkucmVwbGFjZSgvXFwuXFwuL2csICcnKS5yZXBsYWNlKC9eXFwvKy8sICcnKVxuICAgIHJldHVybiBqb2luKHRoaXMucm9vdCwgc2FmZSlcbiAgfVxuXG4gIGFzeW5jIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIF9jb250ZW50VHlwZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwYXRoID0gdGhpcy5mdWxsUGF0aChrZXkpXG4gICAgY29uc3QgZGlyID0gam9pbihwYXRoLCAnLi4nKVxuICAgIGF3YWl0IG1rZGlyKGRpciwgeyByZWN1cnNpdmU6IHRydWUgfSlcbiAgICBhd2FpdCB3cml0ZUZpbGUocGF0aCwgYnl0ZXMpXG4gIH1cblxuICBhc3luYyByZWFkKGtleTogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBkYXRhID0gYXdhaXQgcmVhZEZpbGUodGhpcy5mdWxsUGF0aChrZXkpKVxuICAgICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGRhdGEpXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB1bmxpbmsodGhpcy5mdWxsUGF0aChrZXkpKVxuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQWxyZWFkeSBnb25lLlxuICAgIH1cbiAgfVxuXG4gIHB1YmxpY1VybChfa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBBc3NldFN0b3JhZ2UgfSBmcm9tICcuL3R5cGVzLnRzJ1xuaW1wb3J0IHsgTG9jYWxGc0Fzc2V0U3RvcmFnZSB9IGZyb20gJy4vbG9jYWxfZnMudHMnXG5cbi8qKlxuICogUzMtY29tcGF0aWJsZSBhc3NldCBzdG9yYWdlIChQaGFzZSAzKS5cbiAqXG4gKiBFbnY6IEFTU0VUU19TM19CVUNLRVQsIEFTU0VUU19TM19SRUdJT04sIEFTU0VUU19TM19FTkRQT0lOVCxcbiAqIEFXU19BQ0NFU1NfS0VZX0lEIC8gQVdTX1NFQ1JFVF9BQ0NFU1NfS0VZLlxuICovXG5leHBvcnQgY2xhc3MgUzNBc3NldFN0b3JhZ2UgaW1wbGVtZW50cyBBc3NldFN0b3JhZ2Uge1xuICBwcml2YXRlIHJlYWRvbmx5IGJ1Y2tldDogc3RyaW5nXG4gIHByaXZhdGUgcmVhZG9ubHkgcmVnaW9uOiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSBlbmRwb2ludDogc3RyaW5nIHwgbnVsbFxuXG4gIGNvbnN0cnVjdG9yKG9wdHM/OiB7XG4gICAgYnVja2V0Pzogc3RyaW5nXG4gICAgcmVnaW9uPzogc3RyaW5nXG4gICAgZW5kcG9pbnQ/OiBzdHJpbmcgfCBudWxsXG4gIH0pIHtcbiAgICB0aGlzLmJ1Y2tldCA9XG4gICAgICBvcHRzPy5idWNrZXQgPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfQlVDS0VUKSB8fFxuICAgICAgICAnJylcbiAgICB0aGlzLnJlZ2lvbiA9XG4gICAgICBvcHRzPy5yZWdpb24gPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfUkVHSU9OKSB8fFxuICAgICAgICAndXMtZWFzdC0xJylcbiAgICB0aGlzLmVuZHBvaW50ID1cbiAgICAgIG9wdHM/LmVuZHBvaW50ID8/XG4gICAgICAoKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVNTRVRTX1MzX0VORFBPSU5UKSB8fFxuICAgICAgICBudWxsKVxuICB9XG5cbiAgcHJpdmF0ZSBhc3NlcnRDb25maWd1cmVkKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5idWNrZXQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICAgJ1MzQXNzZXRTdG9yYWdlIGlzIG5vdCBjb25maWd1cmVkIChzZXQgQVNTRVRTX1MzX0JVQ0tFVCknLFxuICAgICAgKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYXNzZXJ0Q29uZmlndXJlZCgpXG4gICAgY29uc3QgdXJsID0gdGhpcy5vYmplY3RVcmwoa2V5KVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHVybCwge1xuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6IGNvbnRlbnRUeXBlLFxuICAgICAgICAnQ29udGVudC1MZW5ndGgnOiBTdHJpbmcoYnl0ZXMuYnl0ZUxlbmd0aCksXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMsXG4gICAgfSlcbiAgICBpZiAoIXJlcy5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTMyBwdXQgZmFpbGVkOiAke3Jlcy5zdGF0dXN9ICR7YXdhaXQgcmVzLnRleHQoKX1gKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBjb25zdCByZXMgPSBhd2FpdCBmZXRjaCh0aGlzLm9iamVjdFVybChrZXkpKVxuICAgIGlmIChyZXMuc3RhdHVzID09PSA0MDQpIHJldHVybiBudWxsXG4gICAgaWYgKCFyZXMub2spIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgUzMgZ2V0IGZhaWxlZDogJHtyZXMuc3RhdHVzfWApXG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXMuYXJyYXlCdWZmZXIoKSlcbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuYXNzZXJ0Q29uZmlndXJlZCgpXG4gICAgYXdhaXQgZmV0Y2godGhpcy5vYmplY3RVcmwoa2V5KSwgeyBtZXRob2Q6ICdERUxFVEUnIH0pXG4gIH1cblxuICBwdWJsaWNVcmwoa2V5OiBzdHJpbmcpOiBzdHJpbmcgfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuYnVja2V0KSByZXR1cm4gbnVsbFxuICAgIHJldHVybiB0aGlzLm9iamVjdFVybChrZXkpXG4gIH1cblxuICBwcml2YXRlIG9iamVjdFVybChrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZSA9IGtleS5yZXBsYWNlKC9eXFwvKy8sICcnKVxuICAgIGlmICh0aGlzLmVuZHBvaW50KSB7XG4gICAgICByZXR1cm4gYCR7dGhpcy5lbmRwb2ludC5yZXBsYWNlKC9cXC8kLywgJycpfS8ke3RoaXMuYnVja2V0fS8ke3NhZmV9YFxuICAgIH1cbiAgICByZXR1cm4gYGh0dHBzOi8vJHt0aGlzLmJ1Y2tldH0uczMuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbS8ke3NhZmV9YFxuICB9XG59XG5cbi8qKiBQaWNrIHN0b3JhZ2UgYmFja2VuZCBmcm9tIGVudjogQVNTRVRTX1NUT1JBR0U9czMgfCBsb2NhbCAoZGVmYXVsdCkuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudigpOiBBc3NldFN0b3JhZ2Uge1xuICBjb25zdCBtb2RlID1cbiAgICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfU1RPUkFHRSkgfHxcbiAgICAnbG9jYWwnXG4gIGlmIChtb2RlID09PSAnczMnKSB7XG4gICAgcmV0dXJuIG5ldyBTM0Fzc2V0U3RvcmFnZSgpXG4gIH1cbiAgcmV0dXJuIG5ldyBMb2NhbEZzQXNzZXRTdG9yYWdlKClcbn1cbiIsICIvKiogUHVyZSBibG9iIGJhY2tlbmQgXHUyMDE0IG5vIERCLiAqL1xuZXhwb3J0IGludGVyZmFjZSBBc3NldFN0b3JhZ2Uge1xuICB3cml0ZShcbiAgICBrZXk6IHN0cmluZyxcbiAgICBieXRlczogVWludDhBcnJheSxcbiAgICBjb250ZW50VHlwZTogc3RyaW5nLFxuICApOiBQcm9taXNlPHZvaWQ+XG4gIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPlxuICBkZWxldGUoa2V5OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+XG4gIC8qKiBPcHRpb25hbCBwdWJsaWMvc2lnbmVkIFVSTCBmb3IgdGhlIGtleS4gKi9cbiAgcHVibGljVXJsPyhrZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGxcbn1cblxuZXhwb3J0IGNvbnN0IEFMTE9XRURfSU1BR0VfVFlQRVMgPSBuZXcgU2V0KFtcbiAgJ2ltYWdlL2pwZWcnLFxuICAnaW1hZ2UvcG5nJyxcbiAgJ2ltYWdlL3dlYnAnLFxuXSlcblxuZXhwb3J0IGNvbnN0IE1BWF9BU1NFVF9CWVRFUyA9IDIgKiAxMDI0ICogMTAyNCAvLyAyIE1CXG5cbmV4cG9ydCBmdW5jdGlvbiBleHRlbnNpb25Gb3JDb250ZW50VHlwZShjb250ZW50VHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgc3dpdGNoIChjb250ZW50VHlwZSkge1xuICAgIGNhc2UgJ2ltYWdlL2pwZWcnOlxuICAgICAgcmV0dXJuICdqcGcnXG4gICAgY2FzZSAnaW1hZ2UvcG5nJzpcbiAgICAgIHJldHVybiAncG5nJ1xuICAgIGNhc2UgJ2ltYWdlL3dlYnAnOlxuICAgICAgcmV0dXJuICd3ZWJwJ1xuICAgIGRlZmF1bHQ6XG4gICAgICByZXR1cm4gJ2JpbidcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHsgQXNzZXQsIERhdGFiYXNlLCBOZXdBc3NldCB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlLFxuICB0eXBlIEltYWdlSGFzaGluZ1NlcnZpY2UsXG59IGZyb20gJy4vaGFzaGluZy50cydcbmltcG9ydCB7IGNyZWF0ZUFzc2V0U3RvcmFnZUZyb21FbnYgfSBmcm9tICcuL3N0b3JhZ2UvczMudHMnXG5pbXBvcnQge1xuICBBTExPV0VEX0lNQUdFX1RZUEVTLFxuICBleHRlbnNpb25Gb3JDb250ZW50VHlwZSxcbiAgTUFYX0FTU0VUX0JZVEVTLFxuICB0eXBlIEFzc2V0U3RvcmFnZSxcbn0gZnJvbSAnLi9zdG9yYWdlL3R5cGVzLnRzJ1xuXG5leHBvcnQgdHlwZSBBc3NldFJlY29yZCA9IEFzc2V0XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRSZXBvc2l0b3J5IHtcbiAgcHV0KGlucHV0OiB7XG4gICAgdXNlcklkOiBudW1iZXJcbiAgICBieXRlczogVWludDhBcnJheVxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmdcbiAgICBmaWxlbmFtZT86IHN0cmluZ1xuICB9KTogUHJvbWlzZTxBc3NldFJlY29yZD5cblxuICBnZXRNZXRhZGF0YShcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8QXNzZXRSZWNvcmQgfCBudWxsPlxuXG4gIHJlYWRCeXRlcyhcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBieXRlczogVWludDhBcnJheTsgY29udGVudFR5cGU6IHN0cmluZyB9IHwgbnVsbD5cblxuICByZWxlYXNlKGFzc2V0SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+XG4gIHJldGFpbihhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPlxuICBwdXJnZUlmT3JwaGFuKGFzc2V0SWQ6IG51bWJlcik6IFByb21pc2U8Ym9vbGVhbj5cblxuICBsaXN0UmVjZW50KHVzZXJJZDogbnVtYmVyLCBsaW1pdD86IG51bWJlcik6IFByb21pc2U8QXNzZXRSZWNvcmRbXT5cbn1cblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBjbGFzcyBEYkFzc2V0UmVwb3NpdG9yeSBpbXBsZW1lbnRzIEFzc2V0UmVwb3NpdG9yeSB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHByaXZhdGUgcmVhZG9ubHkgZGI6IERiTGlrZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JhZ2U6IEFzc2V0U3RvcmFnZSxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGhhc2hpbmc6IEltYWdlSGFzaGluZ1NlcnZpY2UgPSBkZWZhdWx0SW1hZ2VIYXNoaW5nU2VydmljZSxcbiAgKSB7fVxuXG4gIGFzeW5jIHB1dChpbnB1dDoge1xuICAgIHVzZXJJZDogbnVtYmVyXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXlcbiAgICBjb250ZW50VHlwZTogc3RyaW5nXG4gICAgZmlsZW5hbWU/OiBzdHJpbmdcbiAgfSk6IFByb21pc2U8QXNzZXRSZWNvcmQ+IHtcbiAgICBjb25zdCBjb250ZW50VHlwZSA9IGlucHV0LmNvbnRlbnRUeXBlLnRvTG93ZXJDYXNlKCkuc3BsaXQoJzsnKVswXS50cmltKClcbiAgICBpZiAoIUFMTE9XRURfSU1BR0VfVFlQRVMuaGFzKGNvbnRlbnRUeXBlKSkge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKFxuICAgICAgICBgdW5zdXBwb3J0ZWQgY29udGVudCB0eXBlOiAke2NvbnRlbnRUeXBlfWAsXG4gICAgICAgIDQxNSxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignZW1wdHkgZmlsZScsIDQwMClcbiAgICB9XG4gICAgaWYgKGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGggPiBNQVhfQVNTRVRfQllURVMpIHtcbiAgICAgIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignZmlsZSB0b28gbGFyZ2UnLCA0MTMpXG4gICAgfVxuXG4gICAgY29uc3Qgc2hhMjU2ID0gYXdhaXQgdGhpcy5oYXNoaW5nLnNoYTI1NihpbnB1dC5ieXRlcylcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBpbnB1dC51c2VySWQpXG4gICAgICAud2hlcmUoJ3NoYTI1NicsICc9Jywgc2hhMjU2KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAvLyBEZWR1cCBoaXQ6IHJldHVybiBleGlzdGluZyBtZXRhZGF0YS4gQ2FsbGVycyByZXRhaW4oKSBvbiBhdHRhY2guXG4gICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICByZXR1cm4gZXhpc3RpbmdcbiAgICB9XG5cbiAgICBjb25zdCBleHQgPSBleHRlbnNpb25Gb3JDb250ZW50VHlwZShjb250ZW50VHlwZSlcbiAgICBjb25zdCBzdG9yYWdlS2V5ID0gYCR7aW5wdXQudXNlcklkfS8ke3NoYTI1Nn0uJHtleHR9YFxuICAgIGF3YWl0IHRoaXMuc3RvcmFnZS53cml0ZShzdG9yYWdlS2V5LCBpbnB1dC5ieXRlcywgY29udGVudFR5cGUpXG5cbiAgICAvLyBOZXcgYmxvYnMgc3RhcnQgYXQgcmVmX2NvdW50IDA7IGNhbGxlcnMgcmV0YWluKCkgd2hlbiBhdHRhY2hpbmcuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdhc3NldHMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiBpbnB1dC51c2VySWQsXG4gICAgICAgICAgc2hhMjU2LFxuICAgICAgICAgIGNvbnRlbnRfdHlwZTogY29udGVudFR5cGUsXG4gICAgICAgICAgYnl0ZV9zaXplOiBpbnB1dC5ieXRlcy5ieXRlTGVuZ3RoLFxuICAgICAgICAgIHN0b3JhZ2Vfa2V5OiBzdG9yYWdlS2V5LFxuICAgICAgICAgIHJlZl9jb3VudDogMCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgb3JwaGFuZWRfYXQ6IG5vdyxcbiAgICAgICAgfSBhcyBOZXdBc3NldClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBhd2FpdCB0aGlzLnN0b3JhZ2UuZGVsZXRlKHN0b3JhZ2VLZXkpXG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH1cblxuICBhc3luYyBnZXRNZXRhZGF0YShcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8QXNzZXRSZWNvcmQgfCBudWxsPiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgfVxuXG4gIGFzeW5jIHJlYWRCeXRlcyhcbiAgICBhc3NldElkOiBudW1iZXIsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBieXRlczogVWludDhBcnJheTsgY29udGVudFR5cGU6IHN0cmluZyB9IHwgbnVsbD4ge1xuICAgIGNvbnN0IG1ldGEgPSBhd2FpdCB0aGlzLmdldE1ldGFkYXRhKGFzc2V0SWQsIHVzZXJJZClcbiAgICBpZiAoIW1ldGEpIHJldHVybiBudWxsXG4gICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLnN0b3JhZ2UucmVhZChtZXRhLnN0b3JhZ2Vfa2V5KVxuICAgIGlmICghYnl0ZXMpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHsgYnl0ZXMsIGNvbnRlbnRUeXBlOiBtZXRhLmNvbnRlbnRfdHlwZSB9XG4gIH1cblxuICBhc3luYyByZXRhaW4oYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghcm93KSB0aHJvdyBuZXcgQXNzZXRWYWxpZGF0aW9uRXJyb3IoJ2Fzc2V0IG5vdCBmb3VuZCcsIDQwNClcbiAgICBhd2FpdCB0aGlzLmRiXG4gICAgICAudXBkYXRlVGFibGUoJ2Fzc2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgcmVmX2NvdW50OiByb3cucmVmX2NvdW50ICsgMSxcbiAgICAgICAgb3JwaGFuZWRfYXQ6IG51bGwsXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC5leGVjdXRlKClcbiAgfVxuXG4gIGFzeW5jIHJlbGVhc2UoYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJvdyA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghcm93KSByZXR1cm5cbiAgICBjb25zdCBuZXh0ID0gTWF0aC5tYXgoMCwgcm93LnJlZl9jb3VudCAtIDEpXG4gICAgYXdhaXQgdGhpcy5kYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdhc3NldHMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIHJlZl9jb3VudDogbmV4dCxcbiAgICAgICAgb3JwaGFuZWRfYXQ6IG5leHQgPT09IDAgPyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgaWYgKG5leHQgPT09IDApIHtcbiAgICAgIGF3YWl0IHRoaXMucHVyZ2VJZk9ycGhhbihhc3NldElkKVxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHB1cmdlSWZPcnBoYW4oYXNzZXRJZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFyb3cgfHwgcm93LnJlZl9jb3VudCA+IDApIHJldHVybiBmYWxzZVxuICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5kZWxldGUocm93LnN0b3JhZ2Vfa2V5KVxuICAgIGF3YWl0IHRoaXMuZGIuZGVsZXRlRnJvbSgnYXNzZXRzJykud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKS5leGVjdXRlKClcbiAgICByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgYXN5bmMgbGlzdFJlY2VudCh1c2VySWQ6IG51bWJlciwgbGltaXQgPSAyMCk6IFByb21pc2U8QXNzZXRSZWNvcmRbXT4ge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRiXG4gICAgICAuc2VsZWN0RnJvbSgnYXNzZXRzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdyZWZfY291bnQnLCAnPicsIDApXG4gICAgICAub3JkZXJCeSgnY3JlYXRlZF9hdCcsICdkZXNjJylcbiAgICAgIC5saW1pdChsaW1pdClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBBc3NldFZhbGlkYXRpb25FcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdBc3NldFZhbGlkYXRpb25FcnJvcidcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShcbiAgZGI6IERiTGlrZSxcbik6IERiQXNzZXRSZXBvc2l0b3J5IHtcbiAgY29uc3Qgc3RvcmFnZSA9IGNyZWF0ZUFzc2V0U3RvcmFnZUZyb21FbnYoKVxuICByZXR1cm4gbmV3IERiQXNzZXRSZXBvc2l0b3J5KGRiLCBzdG9yYWdlKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gYXNzZXRQdWJsaWNQYXRoKGFzc2V0SWQ6IG51bWJlcik6IHN0cmluZyB7XG4gIHJldHVybiBgL2Fzc2V0cy8ke2Fzc2V0SWR9YFxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbmNvbnN0IEFVVEhfQVBJX0RPTUFJTiA9XG4gICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFVVEhfQVBJX0RPTUFJTikgfHxcbiAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMSdcbmNvbnN0IEpXS1NfVVJMID0gYCR7QVVUSF9BUElfRE9NQUlOfS9hdXRoL2p3dC9qd2tzLmpzb25gXG5cbmNvbnN0IGp3a3MgPSBjcmVhdGVSZW1vdGVKV0tTZXQobmV3IFVSTChKV0tTX1VSTCkpXG5cbmV4cG9ydCB0eXBlIFZlcmlmaWVkQXV0aCA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlBY2Nlc3NUb2tlbihcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuKTogUHJvbWlzZTxWZXJpZmllZEF1dGggfCBudWxsPiB7XG4gIGlmICghYXV0aG9yaXphdGlvbkhlYWRlcj8uc3RhcnRzV2l0aCgnQmVhcmVyICcpKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gYXV0aG9yaXphdGlvbkhlYWRlci5zbGljZSgnQmVhcmVyICcubGVuZ3RoKS50cmltKClcbiAgaWYgKCF0b2tlbikge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCB9ID0gYXdhaXQgand0VmVyaWZ5KHRva2VuLCBqd2tzLCB7XG4gICAgICBhbGdvcml0aG1zOiBbJ1JTMjU2J10sXG4gICAgfSlcblxuICAgIGNvbnN0IGF1dGhVc2VySWQgPSB0eXBlb2YgcGF5bG9hZC5zdWIgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5zdWIgOiBudWxsXG4gICAgaWYgKCFhdXRoVXNlcklkKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGVtYWlsID1cbiAgICAgIHR5cGVvZiBwYXlsb2FkLmVtYWlsID09PSAnc3RyaW5nJyA/IHBheWxvYWQuZW1haWwgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7IGF1dGhVc2VySWQsIGVtYWlsIH1cbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5hdXRob3JpemVkUmVzcG9uc2UoKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmF1dGhvcml6ZWQnIH0pLCB7XG4gICAgc3RhdHVzOiA0MDEsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgIH0sXG4gIH0pXG59XG5cbi8qKiBDT1JTIHByZWZsaWdodCAvIHNpbXBsZSByZXNwb25zZXMgZm9yIGJyb3dzZXIgR3JhcGhRTCBjbGllbnRzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcnNNaWRkbGV3YXJlKGN0eDogQ29udGV4dCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwge1xuICAgICAgc3RhdHVzOiAyMDQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgbmV4dCgpXG5cbiAgY3R4LnJlcy5oZWFkZXJzLnNldCgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJyxcbiAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICApXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnLFxuICAgICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICApXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7XG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbiAgdHlwZSBWZXJpZmllZEF1dGgsXG59IGZyb20gJy4uL2F1dGgvdmVyaWZ5LnRzJ1xuXG4vKiogUHVibGljIEFMQiAvIGxvYWQtYmFsYW5jZXIgaGVhbHRoIGNoZWNrLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGhlYWx0aE1pZGRsZXdhcmUoXG4gIGN0eDogQ29udGV4dCxcbiAgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPixcbikge1xuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggPT09ICcvaGVhbHRoJyAmJiBjdHgucmVxLm1ldGhvZCA9PT0gJ0dFVCcpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgb2s6IHRydWUgfSksIHtcbiAgICAgIHN0YXR1czogMjAwLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG4gIGF3YWl0IG5leHQoKVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXJSZWYgPSB7XG4gIGlkOiBudW1iZXJcbn1cblxuZXhwb3J0IHR5cGUgUmVzb2x2ZUxvY2FsVXNlckZuID0gKFxuICBpZGVudGl0eTogVmVyaWZpZWRBdXRoLFxuKSA9PiBQcm9taXNlPExvY2FsVXNlclJlZj5cblxuLyoqXG4gKiBSZXF1aXJlIGEgdmFsaWQgQmVhcmVyIEpXVCBvbiBgL2dyYXBocWxgIGFuZCBzZXQgUHlsb24gY29udGV4dCB2YXJzOlxuICogYHVzZXJJZGAsIGBhdXRoVXNlcklkYCwgb3B0aW9uYWwgYGF1dGhFbWFpbGAuXG4gKlxuICogQ2FsbGVycyB0aGF0IG5lZWQgYXV0aCBmb3Igb3RoZXIgcGF0aHMgKGUuZy4gUkVTVCBhc3NldHMpIHNob3VsZCBoYW5kbGVcbiAqIHRob3NlIGJlZm9yZSB0aGlzIG1pZGRsZXdhcmUgb3IgdXNlIGB2ZXJpZnlBY2Nlc3NUb2tlbmAgZGlyZWN0bHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gIHJlc29sdmVMb2NhbFVzZXI6IFJlc29sdmVMb2NhbFVzZXJGbixcbikge1xuICByZXR1cm4gYXN5bmMgZnVuY3Rpb24gZ3JhcGhRTEF1dGhNaWRkbGV3YXJlKFxuICAgIGN0eDogQ29udGV4dCxcbiAgICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApIHtcbiAgICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgICAgYXdhaXQgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcblxuICAgIGlmIChcbiAgICAgIHBhdGggPT09ICcvaGVhbHRoJyB8fFxuICAgICAgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpXG4gICAgKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgICByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuICAgIH1cblxuICAgIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIodmVyaWZpZWQpXG5cbiAgICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICAgIGN0eC5zZXQoJ2F1dGhFbWFpbCcsIHZlcmlmaWVkLmVtYWlsKVxuICAgIH1cbiAgICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgICBhd2FpdCBuZXh0KClcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBLeXNlbHksIFNlbGVjdGFibGUgfSBmcm9tICdreXNlbHknXG5cbi8qKiBNaW5pbWFsIHVzZXJzIHRhYmxlIHNoYXBlIHJlcXVpcmVkIGJ5IHJlc29sdmVMb2NhbFVzZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2Vyc0RhdGFiYXNlID0ge1xuICB1c2VyczogVXNlcnNUYWJsZVxufVxuXG5leHBvcnQgdHlwZSBMb2NhbFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEF1dGhJZGVudGl0eSA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG4gIG5hbWU/OiBzdHJpbmdcbn1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXI8REIgZXh0ZW5kcyBVc2Vyc0RhdGFiYXNlPihcbiAgZGI6IEt5c2VseTxEQj4sXG4gIGlkZW50aXR5OiBBdXRoSWRlbnRpdHksXG4pOiBQcm9taXNlPFNlbGVjdGFibGU8REJbJ3VzZXJzJ10+PiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIGFzIHJlc29sdmVMb2NhbFVzZXJLaXQgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgcmV0dXJuIHJlc29sdmVMb2NhbFVzZXJLaXQoZGIsIGlkZW50aXR5KVxufVxuIiwgImltcG9ydCB0eXBlIHsgUHVzaFNlbmRlciB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9wdXNoL21vZC50cydcbmltcG9ydCB7IE5vT3BQdXNoU2VuZGVyIH0gZnJvbSAnZGVub19hcGlfa2l0L3B1c2gvbW9kLnRzJ1xuXG5sZXQgcHVzaFNlbmRlcjogUHVzaFNlbmRlciA9IG5ldyBOb09wUHVzaFNlbmRlcigpXG5cbmV4cG9ydCBmdW5jdGlvbiBzZXRQdXNoU2VuZGVyKHNlbmRlcjogUHVzaFNlbmRlcik6IHZvaWQge1xuICBwdXNoU2VuZGVyID0gc2VuZGVyXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRQdXNoU2VuZGVyKCk6IFB1c2hTZW5kZXIge1xuICByZXR1cm4gcHVzaFNlbmRlclxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7QUFpREEsU0FBUyxlQUFlLFlBQThCO0FBQ3BELFNBQU87QUFBQSxJQUNMLGlCQUFpQixXQUFXO0FBQUEsSUFDNUIsa0JBQWtCLFdBQVc7QUFBQSxJQUM3QixpQkFBaUIsV0FBVztBQUFBLElBQzVCLGdCQUFnQixXQUFXO0FBQUEsRUFDN0I7QUFDRjtBQUVBLFNBQVMsY0FBc0I7QUFDN0IsU0FBTyxPQUFPLFdBQVc7QUFDM0I7QUEyYUEsZUFBc0IsNkJBQ3BCQSxLQUNBLFFBQ2U7QUFDZixRQUFNQSxJQUNILFdBQVcsa0JBQWtCLEVBQzdCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUTtBQUVYLFFBQU0sTUFBTSxNQUFNQSxJQUNmLFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUSxjQUFjLEtBQUssRUFDM0IsUUFBUSxNQUFNLEtBQUssRUFDbkIsVUFBVSxFQUNWLFFBQVE7QUFFWCxRQUFNLE9BQU8sTUFBTUEsSUFDaEIsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsUUFBUTtBQUNYLFFBQU0sU0FBUyxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsTUFBTSxDQUFDLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQztBQUVqRCxRQUFNLE1BQU0sb0JBQUksSUFBb0I7QUFDcEMsUUFBTSxZQUFZLG9CQUFJLElBQW9CO0FBQzFDLFFBQU0sV0FBVyxvQkFBSSxJQUFvQjtBQUV6QyxhQUFXLE1BQU0sS0FBSztBQUNwQixRQUFJLEdBQUcsd0JBQXdCLEtBQU07QUFDckMsVUFBTSxRQUFRLEdBQUc7QUFDakIsVUFBTSxNQUFNLElBQUksSUFBSSxLQUFLLEtBQUs7QUFDOUIsVUFBTSxVQUNKLE9BQU8sR0FBRyxlQUFlLFdBQ3JCLEdBQUcsYUFDSCxJQUFJLEtBQUssR0FBRyxVQUFVLEVBQUUsWUFBWTtBQUUxQyxRQUFJLEdBQUcsU0FBUyxVQUFVLEdBQUcsU0FBUyxXQUFXO0FBQy9DLFVBQUksSUFBSSxPQUFPLE1BQU0sR0FBRyxRQUFRO0FBQ2hDLFVBQUksQ0FBQyxVQUFVLElBQUksS0FBSyxFQUFHLFdBQVUsSUFBSSxPQUFPLE9BQU87QUFDdkQsZUFBUyxJQUFJLE9BQU8sT0FBTztBQUFBLElBQzdCLFdBQ0UsR0FBRyxTQUFTLGFBQ1osR0FBRyxTQUFTLFlBQ1osR0FBRyxTQUFTLFVBQ1o7QUFDQSxVQUFJLElBQUksT0FBTyxLQUFLLElBQUksR0FBRyxNQUFNLEdBQUcsUUFBUSxDQUFDO0FBQUEsSUFDL0M7QUFBQSxFQUNGO0FBRUEsUUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLGFBQVcsQ0FBQyxPQUFPLEdBQUcsS0FBSyxLQUFLO0FBQzlCLFFBQUksT0FBTyxFQUFHO0FBQ2QsVUFBTSxhQUFhLE9BQU8sSUFBSSxLQUFLO0FBQ25DLFFBQUksQ0FBQyxXQUFZO0FBRWpCLFFBQUksV0FBVyxXQUFXO0FBQ3hCLFlBQU1BLElBQ0gsV0FBVyxrQkFBa0IsRUFDN0IsT0FBTztBQUFBLFFBQ04sU0FBUztBQUFBLFFBQ1Qsc0JBQXNCO0FBQUEsUUFDdEIsVUFBVTtBQUFBLFFBQ1YsV0FBVztBQUFBLFFBQ1gsaUJBQWlCLFVBQVUsSUFBSSxLQUFLLEtBQUs7QUFBQSxRQUN6QyxnQkFBZ0IsU0FBUyxJQUFJLEtBQUssS0FBSztBQUFBLFFBQ3ZDLFlBQVk7QUFBQSxNQUNkLENBQXVCLEVBQ3RCLFFBQVE7QUFBQSxJQUNiLE9BQU87QUFDTCxlQUFTLElBQUksR0FBRyxJQUFJLEtBQUssS0FBSztBQUM1QixjQUFNQSxJQUNILFdBQVcsa0JBQWtCLEVBQzdCLE9BQU87QUFBQSxVQUNOLFNBQVM7QUFBQSxVQUNULHNCQUFzQjtBQUFBLFVBQ3RCLFVBQVU7QUFBQSxVQUNWLFdBQVcsWUFBWTtBQUFBLFVBQ3ZCLGlCQUFpQixVQUFVLElBQUksS0FBSyxLQUFLO0FBQUEsVUFDekMsZ0JBQWdCLFNBQVMsSUFBSSxLQUFLLEtBQUs7QUFBQSxVQUN2QyxZQUFZO0FBQUEsUUFDZCxDQUF1QixFQUN0QixRQUFRO0FBQUEsTUFDYjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUE3akJBLElBOERhLG9CQWlhQTtBQS9kYjtBQUFBO0FBQUE7QUE4RE8sSUFBTSxxQkFBTixNQUFxRDtBQUFBLE1BQzFELE1BQU0sVUFDSixLQUNBLFFBQ0EsWUFDQSxhQUN5RTtBQUN6RSxjQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsY0FBTSxPQUFPLGVBQWUsVUFBVTtBQUV0QyxZQUFJO0FBRUosWUFBSSxXQUFXLFdBQVc7QUFDeEIsZ0JBQU0sV0FBVyxNQUFNLElBQ3BCLFdBQVcsa0JBQWtCLEVBQzdCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSx3QkFBd0IsS0FBSyxXQUFXLEVBQUUsRUFDaEQsTUFBTSxhQUFhLE1BQU0sSUFBSSxFQUM3QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLGNBQUksVUFBVTtBQUNaLHdCQUFZLE1BQU0sSUFDZixZQUFZLGtCQUFrQixFQUM5QixJQUFJO0FBQUEsY0FDSCxVQUFVLFNBQVMsV0FBVyxZQUFZO0FBQUEsY0FDMUMsZ0JBQWdCO0FBQUEsY0FDaEIsWUFBWTtBQUFBLFlBQ2QsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLFNBQVMsRUFBRSxFQUM1QixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsVUFDN0IsT0FBTztBQUNMLHdCQUFZLE1BQU0sSUFDZixXQUFXLGtCQUFrQixFQUM3QixPQUFPO0FBQUEsY0FDTixTQUFTO0FBQUEsY0FDVCxzQkFBc0IsV0FBVztBQUFBLGNBQ2pDLFVBQVUsWUFBWTtBQUFBLGNBQ3RCLFdBQVc7QUFBQSxjQUNYLGlCQUFpQjtBQUFBLGNBQ2pCLGdCQUFnQjtBQUFBLGNBQ2hCLFlBQVk7QUFBQSxZQUNkLENBQXVCLEVBQ3RCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxVQUM3QjtBQUFBLFFBQ0YsT0FBTztBQUdMLGNBQUk7QUFDSixtQkFBUyxJQUFJLEdBQUcsSUFBSSxZQUFZLFVBQVUsS0FBSztBQUM3QyxtQkFBTyxNQUFNLElBQ1YsV0FBVyxrQkFBa0IsRUFDN0IsT0FBTztBQUFBLGNBQ04sU0FBUztBQUFBLGNBQ1Qsc0JBQXNCLFdBQVc7QUFBQSxjQUNqQyxVQUFVO0FBQUEsY0FDVixXQUFXLFlBQVk7QUFBQSxjQUN2QixpQkFBaUI7QUFBQSxjQUNqQixnQkFBZ0I7QUFBQSxjQUNoQixZQUFZO0FBQUEsWUFDZCxDQUF1QixFQUN0QixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsVUFDN0I7QUFDQSxzQkFBWTtBQUFBLFFBQ2Q7QUFFQSxjQUFNLGNBQWMsTUFBTSxJQUN2QixXQUFXLHFCQUFxQixFQUNoQyxPQUFPO0FBQUEsVUFDTixTQUFTO0FBQUEsVUFDVCxNQUFNO0FBQUEsVUFDTixzQkFBc0IsV0FBVztBQUFBLFVBQ2pDLGNBQWMsVUFBVTtBQUFBLFVBQ3hCLFVBQVUsWUFBWTtBQUFBLFVBQ3RCLEdBQUc7QUFBQSxVQUNILGFBQWEsWUFBWTtBQUFBLFVBQ3pCLFdBQVcsWUFBWTtBQUFBLFVBQ3ZCLGFBQWEsWUFBWTtBQUFBLFVBQ3pCLFNBQVMsWUFBWTtBQUFBLFVBQ3JCLGFBQWEsWUFBWSxjQUFjO0FBQUEsVUFDdkMsU0FBUyxZQUFZLFVBQVU7QUFBQSxVQUMvQixlQUFlLFlBQVksZ0JBQWdCO0FBQUEsVUFDM0MsVUFBVSxZQUFZLFdBQVc7QUFBQSxVQUNqQyxNQUFNO0FBQUEsVUFDTixVQUFVO0FBQUEsVUFDVixZQUFZO0FBQUEsUUFDZCxDQUF5QixFQUN4QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLGVBQU8sRUFBRSxXQUFXLFlBQVk7QUFBQSxNQUNsQztBQUFBLE1BRUEsTUFBTSxhQUNKLEtBQ0EsUUFDQSxhQUNBLFVBQ0EsTUFDZ0Y7QUFDaEYsZUFBTyxNQUFNLEtBQUs7QUFBQSxVQUNoQjtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBLFFBQVE7QUFBQSxRQUNWO0FBQUEsTUFDRjtBQUFBLE1BRUEsTUFBTSxhQUNKLEtBQ0EsUUFDQSxhQUNBLFVBQ2dGO0FBQ2hGLGVBQU8sTUFBTSxLQUFLO0FBQUEsVUFDaEI7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0E7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsTUFFQSxNQUFjLFVBQ1osS0FDQSxRQUNBLGFBQ0EsVUFDQSxNQUNBLE1BQ2dGO0FBQ2hGLFlBQUksV0FBVyxHQUFHO0FBQ2hCLGdCQUFNLElBQUksZUFBZSx1QkFBdUI7QUFBQSxRQUNsRDtBQUVBLGNBQU0sTUFBTSxNQUFNLElBQ2YsV0FBVyxrQkFBa0IsRUFDN0IsTUFBTSxNQUFNLEtBQUssV0FBVyxFQUM1QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsWUFBSSxDQUFDLElBQUssT0FBTSxJQUFJLGVBQWUsMEJBQTBCO0FBQzdELFlBQUksSUFBSSxXQUFXLFVBQVU7QUFDM0IsZ0JBQU0sSUFBSSxlQUFlLHVCQUF1QjtBQUFBLFFBQ2xEO0FBRUEsY0FBTSxhQUFhLE1BQU0sSUFDdEIsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxNQUFNLEtBQUssSUFBSSxvQkFBb0IsRUFDekMsVUFBVSxFQUNWLGlCQUFpQjtBQUVwQixjQUFNLE9BQU8sYUFDVCxlQUFlLFVBQVUsSUFDekI7QUFBQSxVQUNFLGlCQUFpQjtBQUFBLFVBQ2pCLGtCQUFrQjtBQUFBLFVBQ2xCLGlCQUFpQjtBQUFBLFVBQ2pCLGdCQUFnQjtBQUFBLFFBQ2xCO0FBRUosY0FBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLGNBQU0sWUFBWSxJQUFJLFdBQVc7QUFDakMsWUFBSTtBQUVKLFlBQUksY0FBYyxHQUFHO0FBQ25CLGdCQUFNLElBQ0gsV0FBVyxrQkFBa0IsRUFDN0IsTUFBTSxNQUFNLEtBQUssSUFBSSxFQUFFLEVBQ3ZCLFFBQVE7QUFDWCxzQkFBWTtBQUFBLFFBQ2QsT0FBTztBQUNMLHNCQUFZLE1BQU0sSUFDZixZQUFZLGtCQUFrQixFQUM5QixJQUFJLEVBQUUsVUFBVSxXQUFXLFlBQVksSUFBSSxDQUFDLEVBQzVDLE1BQU0sTUFBTSxLQUFLLElBQUksRUFBRSxFQUN2QixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsUUFDN0I7QUFFQSxjQUFNLGNBQWMsTUFBTSxJQUN2QixXQUFXLHFCQUFxQixFQUNoQyxPQUFPO0FBQUEsVUFDTixTQUFTO0FBQUEsVUFDVDtBQUFBLFVBQ0Esc0JBQXNCLElBQUk7QUFBQSxVQUMxQixjQUFjLGNBQWMsSUFBSSxPQUFPLElBQUk7QUFBQSxVQUMzQztBQUFBLFVBQ0EsR0FBRztBQUFBLFVBQ0gsYUFBYTtBQUFBLFVBQ2IsV0FBVztBQUFBLFVBQ1gsYUFBYTtBQUFBLFVBQ2IsU0FBUztBQUFBLFVBQ1QsYUFBYTtBQUFBLFVBQ2IsU0FBUztBQUFBLFVBQ1QsZUFBZTtBQUFBLFVBQ2YsVUFBVTtBQUFBLFVBQ1Y7QUFBQSxVQUNBLFVBQVUsY0FBYyxJQUNwQixLQUFLLFVBQVUsRUFBRSxzQkFBc0IsSUFBSSxHQUFHLENBQUMsSUFDL0M7QUFBQSxVQUNKLFlBQVk7QUFBQSxRQUNkLENBQXlCLEVBQ3hCLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsZUFBTyxFQUFFLFdBQVcsWUFBWTtBQUFBLE1BQ2xDO0FBQUEsTUFFQSxNQUFNLGFBQ0osS0FDQSxRQUNBLHNCQUN5RTtBQUN6RSxjQUFNLFlBQVksTUFBTSxJQUNyQixXQUFXLHFCQUFxQixFQUNoQyxNQUFNLE1BQU0sS0FBSyxvQkFBb0IsRUFDckMsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFFBQVEsS0FBSyxTQUFTLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsWUFBSSxDQUFDLFVBQVcsT0FBTSxJQUFJLGVBQWUsK0JBQStCO0FBQ3hFLFlBQUksVUFBVSx3QkFBd0IsTUFBTTtBQUMxQyxnQkFBTSxJQUFJLGVBQWUsb0NBQW9DO0FBQUEsUUFDL0Q7QUFHQSxjQUFNLFVBQVUsTUFBTSxJQUNuQixXQUFXLHFCQUFxQixFQUNoQyxNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sUUFBUSxLQUFLLFNBQVMsRUFDNUIsTUFBTSxZQUFZLFVBQVUsSUFBSSxFQUNoQyxVQUFVLEVBQ1YsUUFBUTtBQUVYLGNBQU0sV0FBVyxRQUFRLEtBQUssQ0FBQyxNQUFNO0FBQ25DLGdCQUFNLE9BQ0osT0FBTyxFQUFFLGFBQWEsV0FDbEIsS0FBSyxNQUFNLEVBQUUsUUFBUSxJQUNyQixFQUFFO0FBQ1IsaUJBQU8sUUFBUSxLQUFLLGtCQUFrQjtBQUFBLFFBQ3hDLENBQUM7QUFDRCxZQUFJLFNBQVUsT0FBTSxJQUFJLGVBQWUsa0JBQWtCO0FBRXpELGNBQU0sYUFBYSxNQUFNLElBQ3RCLFdBQVcsb0JBQW9CLEVBQy9CLE1BQU0sTUFBTSxLQUFLLFVBQVUsb0JBQW9CLEVBQy9DLFVBQVUsRUFDVix3QkFBd0I7QUFFM0IsY0FBTSxjQUFnQztBQUFBLFVBQ3BDLFFBQVE7QUFBQSxVQUNSLGNBQWMsV0FBVztBQUFBLFVBQ3pCLFVBQVUsVUFBVTtBQUFBLFVBQ3BCLFlBQVksV0FBVyxvQkFBb0I7QUFBQSxVQUMzQyxZQUFZO0FBQUEsVUFDWixVQUFVO0FBQUEsUUFDWjtBQUdBLGNBQU0sRUFBRSxVQUFVLElBQUksTUFBTSxLQUFLO0FBQUEsVUFDL0I7QUFBQSxVQUNBO0FBQUEsVUFDQTtBQUFBLFVBQ0EsWUFBWTtBQUFBLFFBQ2Q7QUFFQSxjQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsY0FBTSxjQUFjLE1BQU0sSUFDdkIsV0FBVyxxQkFBcUIsRUFDaEMsT0FBTztBQUFBLFVBQ04sU0FBUztBQUFBLFVBQ1QsTUFBTTtBQUFBLFVBQ04sc0JBQXNCLFdBQVc7QUFBQSxVQUNqQyxjQUFjLFVBQVU7QUFBQSxVQUN4QixVQUFVLFVBQVU7QUFBQSxVQUNwQixHQUFHLGVBQWUsVUFBVTtBQUFBLFVBQzVCLGFBQWE7QUFBQSxVQUNiLFdBQVc7QUFBQSxVQUNYLGFBQWEsV0FBVyxvQkFBb0I7QUFBQSxVQUM1QyxTQUFTO0FBQUEsVUFDVCxhQUFhO0FBQUEsVUFDYixTQUFTO0FBQUEsVUFDVCxlQUFlO0FBQUEsVUFDZixVQUFVO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTixVQUFVLEtBQUssVUFBVSxFQUFFLGVBQWUscUJBQXFCLENBQUM7QUFBQSxVQUNoRSxZQUFZO0FBQUEsUUFDZCxDQUF5QixFQUN4QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLGVBQU8sRUFBRSxXQUFXLFlBQVk7QUFBQSxNQUNsQztBQUFBO0FBQUEsTUFHQSxNQUFjLHVCQUNaLEtBQ0EsUUFDQSxZQUNBLFVBQ3lDO0FBQ3pDLGNBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUNuQyxZQUFJLFdBQVcsV0FBVztBQUN4QixnQkFBTSxXQUFXLE1BQU0sSUFDcEIsV0FBVyxrQkFBa0IsRUFDN0IsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLHdCQUF3QixLQUFLLFdBQVcsRUFBRSxFQUNoRCxNQUFNLGFBQWEsTUFBTSxJQUFJLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsY0FBSSxVQUFVO0FBQ1osa0JBQU1DLGFBQVksTUFBTSxJQUNyQixZQUFZLGtCQUFrQixFQUM5QixJQUFJO0FBQUEsY0FDSCxVQUFVLFNBQVMsV0FBVztBQUFBLGNBQzlCLFlBQVk7QUFBQSxZQUNkLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxTQUFTLEVBQUUsRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixtQkFBTyxFQUFFLFdBQUFBLFdBQVU7QUFBQSxVQUNyQjtBQUVBLGdCQUFNQSxhQUFZLE1BQU0sSUFDckIsV0FBVyxrQkFBa0IsRUFDN0IsT0FBTztBQUFBLFlBQ04sU0FBUztBQUFBLFlBQ1Qsc0JBQXNCLFdBQVc7QUFBQSxZQUNqQztBQUFBLFlBQ0EsV0FBVztBQUFBLFlBQ1gsaUJBQWlCO0FBQUEsWUFDakIsZ0JBQWdCO0FBQUEsWUFDaEIsWUFBWTtBQUFBLFVBQ2QsQ0FBdUIsRUFDdEIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixpQkFBTyxFQUFFLFdBQUFBLFdBQVU7QUFBQSxRQUNyQjtBQUVBLGNBQU0sWUFBWSxNQUFNLElBQ3JCLFdBQVcsa0JBQWtCLEVBQzdCLE9BQU87QUFBQSxVQUNOLFNBQVM7QUFBQSxVQUNULHNCQUFzQixXQUFXO0FBQUEsVUFDakMsVUFBVTtBQUFBLFVBQ1YsV0FBVyxZQUFZO0FBQUEsVUFDdkIsaUJBQWlCO0FBQUEsVUFDakIsZ0JBQWdCO0FBQUEsVUFDaEIsWUFBWTtBQUFBLFFBQ2QsQ0FBdUIsRUFDdEIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixlQUFPLEVBQUUsVUFBVTtBQUFBLE1BQ3JCO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxNQU1BLE1BQU0sOEJBQ0osS0FDQSxRQUNBLGNBQ2lCO0FBQ2pCLGNBQU0sUUFBUSxNQUFNLElBQ2pCLFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxRQUFRLEtBQUssTUFBTSxFQUN6QixNQUFNLGlCQUFpQixLQUFLLFlBQVksRUFDeEMsVUFBVSxFQUNWLFFBQVE7QUFFWCxZQUFJLFVBQVU7QUFDZCxtQkFBVyxRQUFRLE9BQU87QUFDeEIsY0FBSSxLQUFLLHdCQUF3QixLQUFNO0FBRXZDLGdCQUFNLE1BQU0sTUFBTSxJQUNmLFdBQVcsa0JBQWtCLEVBQzdCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSx3QkFBd0IsS0FBSyxLQUFLLG9CQUFvQixFQUM1RCxVQUFVLEVBQ1YsUUFBUTtBQUVYLGdCQUFNLFlBQVksSUFBSSxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRSxVQUFVLENBQUM7QUFDeEQsZ0JBQU0sV0FBVyxLQUFLLElBQUksS0FBSyxVQUFVLFNBQVM7QUFDbEQsY0FBSSxZQUFZLEVBQUc7QUFFbkIsY0FBSSxZQUFZO0FBQ2hCLHFCQUFXLE9BQU8sS0FBSztBQUNyQixnQkFBSSxhQUFhLEVBQUc7QUFDcEIsa0JBQU0sT0FBTyxLQUFLLElBQUksSUFBSSxVQUFVLFNBQVM7QUFDN0Msa0JBQU0sS0FBSztBQUFBLGNBQ1Q7QUFBQSxjQUNBO0FBQUEsY0FDQSxJQUFJO0FBQUEsY0FDSjtBQUFBLGNBQ0E7QUFBQSxjQUNBLHNCQUFzQixZQUFZO0FBQUEsWUFDcEM7QUFDQSx5QkFBYTtBQUNiLHVCQUFXO0FBQUEsVUFDYjtBQUFBLFFBQ0Y7QUFDQSxlQUFPO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFFTyxJQUFNLGlCQUFOLGNBQTZCLE1BQU07QUFBQSxNQUN4QyxZQUFZLFNBQWlCO0FBQzNCLGNBQU0sT0FBTztBQUNiLGFBQUssT0FBTztBQUFBLE1BQ2Q7QUFBQSxJQUNGO0FBQUE7QUFBQTs7O0FDL2JBLFNBQVMsWUFBWUMsU0FBZ0Q7QUFDbkUsTUFBSUEsV0FBVSxLQUFNLFFBQU8sQ0FBQztBQUM1QixNQUFJLE9BQU9BLFlBQVcsVUFBVTtBQUM5QixRQUFJO0FBQ0YsYUFBTyxLQUFLLE1BQU1BLE9BQU07QUFBQSxJQUMxQixRQUFRO0FBQ04sYUFBTyxDQUFDO0FBQUEsSUFDVjtBQUFBLEVBQ0Y7QUFDQSxTQUFPQTtBQUNUO0FBTU8sU0FBUyxhQUNkLE1BQ0EsS0FDeUI7QUFDekIsTUFBSSxDQUFDLEtBQUssUUFBUyxRQUFPO0FBRTFCLFFBQU1BLFVBQVMsWUFBWSxLQUFLLE1BQU07QUFDdEMsUUFBTSxNQUFNLElBQUksT0FBTyxvQkFBSSxLQUFLO0FBQ2hDLFFBQU0sU0FBUyxJQUFJLFVBQVUsS0FBSztBQUVsQyxNQUFJQSxRQUFPLFFBQVEsSUFBSSxpQkFBaUIsRUFBRyxRQUFPO0FBRWxELE1BQ0UsT0FBT0EsUUFBTyxxQkFBcUIsWUFDbkMsSUFBSSxrQkFBa0JBLFFBQU8sa0JBQzdCO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFFQSxNQUNFLE9BQU9BLFFBQU8sbUJBQW1CLFlBQ2pDQSxRQUFPLGlCQUFpQixLQUN4QixJQUFJLFlBQ0o7QUFDQSxVQUFNLE9BQU8sSUFBSSxLQUFLLElBQUksVUFBVSxFQUFFLFFBQVE7QUFDOUMsVUFBTSxhQUFhQSxRQUFPLGlCQUFpQixLQUFLLEtBQUs7QUFDckQsUUFBSSxJQUFJLFFBQVEsSUFBSSxPQUFPLFdBQVksUUFBTztBQUFBLEVBQ2hEO0FBRUEsTUFDRSxPQUFPQSxRQUFPLDBCQUEwQixZQUN4QyxPQUFPQSxRQUFPLGlCQUFpQixZQUMvQkEsUUFBTyxlQUFlLEtBQ3RCLElBQUksWUFDSjtBQUtBLFVBQU0sV0FBV0EsUUFBTyxlQUFlLEtBQUssS0FBSztBQUNqRCxVQUFNLE9BQU8sSUFBSSxLQUFLLElBQUksVUFBVSxFQUFFLFFBQVE7QUFDOUMsUUFDRSxJQUFJLFFBQVEsSUFBSSxPQUFPLFlBQ3ZCLElBQUksa0JBQWtCQSxRQUFPLHVCQUM3QjtBQUNBLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUVBLFFBQU0sT0FBTyxLQUFLO0FBRWxCLE1BQUksU0FBUyxlQUFlO0FBQzFCLFVBQU0sSUFDSixPQUFPQSxRQUFPLGdCQUFnQixXQUFXQSxRQUFPLGNBQWM7QUFDaEUsUUFBSSxPQUFPLElBQUksRUFBRyxRQUFPO0FBQ3pCLFdBQU8sZ0JBQWdCLE1BQU0sS0FBSyxLQUFLLHNCQUFzQixLQUFLLFFBQVE7QUFBQSxFQUM1RTtBQUVBLE1BQUksU0FBUyxlQUFlO0FBQzFCLFVBQU0sT0FBT0EsUUFBTztBQUNwQixRQUFJLENBQUMsUUFBUSxLQUFLLFdBQVcsRUFBRyxRQUFPO0FBQ3ZDLFVBQU0sY0FBYyxLQUFLLE9BQU8sQ0FBQyxHQUFHLE1BQU0sS0FBSyxFQUFFLFVBQVUsSUFBSSxDQUFDO0FBQ2hFLFFBQUksZUFBZSxFQUFHLFFBQU87QUFDN0IsUUFBSSxPQUFPLE9BQU8sSUFBSTtBQUN0QixlQUFXLFNBQVMsTUFBTTtBQUN4QixjQUFRLE1BQU0sVUFBVTtBQUN4QixVQUFJLFFBQVEsR0FBRztBQUNiLGVBQU87QUFBQSxVQUNMO0FBQUEsVUFDQTtBQUFBLFVBQ0EsTUFBTTtBQUFBLFVBQ04sTUFBTSxZQUFZLEtBQUs7QUFBQSxRQUN6QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsVUFBTSxPQUFPLEtBQUssS0FBSyxTQUFTLENBQUM7QUFDakMsV0FBTztBQUFBLE1BQ0w7QUFBQSxNQUNBO0FBQUEsTUFDQSxLQUFLO0FBQUEsTUFDTCxLQUFLLFlBQVksS0FBSztBQUFBLElBQ3hCO0FBQUEsRUFDRjtBQUdBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQTtBQUFBLElBQ0EsS0FBSztBQUFBLElBQ0wsS0FBSztBQUFBLEVBQ1A7QUFDRjtBQUVBLFNBQVMsZ0JBQ1AsTUFDQSxLQUNBLGNBQ0EsVUFDa0I7QUFDbEIsU0FBTztBQUFBLElBQ0wsUUFBUSxLQUFLO0FBQUEsSUFDYjtBQUFBLElBQ0EsVUFBVSxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sUUFBUSxDQUFDO0FBQUEsSUFDMUMsWUFBWSxJQUFJO0FBQUEsSUFDaEIsWUFBWSxJQUFJO0FBQUEsSUFDaEIsVUFBVSxJQUFJO0FBQUEsSUFDZCxZQUFZLElBQUksY0FBYztBQUFBLElBQzlCLFFBQVEsSUFBSSxVQUFVO0FBQUEsSUFDdEIsY0FBYyxJQUFJLGdCQUFnQjtBQUFBLElBQ2xDLFNBQVMsSUFBSSxXQUFXO0FBQUEsRUFDMUI7QUFDRjtBQXBLQTtBQUFBO0FBQUE7QUFBQTtBQUFBOzs7QUNBQSxJQXlDYSwyQkF1SkE7QUFoTWI7QUFBQTtBQUFBO0FBT0E7QUFJQTtBQThCTyxJQUFNLDRCQUFOLE1BQThEO0FBQUEsTUFDbkUsWUFDbUIsWUFBOEIsSUFBSSxtQkFBbUIsR0FDdEU7QUFEaUI7QUFBQSxNQUNoQjtBQUFBLE1BRUgsTUFBTSxNQUNKQyxLQUNBLFFBQ0EsY0FDd0I7QUFDeEIsY0FBTSxVQUF5QixDQUFDO0FBRWhDLG1CQUFXLGVBQWUsY0FBYztBQUV0QyxjQUFJLGdCQUFnQkEsSUFDakIsV0FBVyxxQkFBcUIsRUFDaEMsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFFBQVEsS0FBSyxNQUFNLEVBQ3pCLE1BQU0sZUFBZSxLQUFLLFlBQVksVUFBVTtBQUVuRCxjQUFJLFlBQVksVUFBVSxNQUFNO0FBQzlCLDRCQUFnQixjQUFjLE1BQU0sV0FBVyxLQUFLLFlBQVksTUFBTTtBQUFBLFVBQ3hFLE9BQU87QUFDTCw0QkFBZ0IsY0FBYyxNQUFNLFdBQVcsTUFBTSxJQUFJO0FBQUEsVUFDM0Q7QUFFQSxnQkFBTSxXQUFXLE1BQU0sY0FBYyxVQUFVLEVBQUUsaUJBQWlCO0FBRWxFLGNBQUksVUFBVTtBQUNaLG9CQUFRLEtBQUs7QUFBQSxjQUNYO0FBQUEsY0FDQSxhQUFhO0FBQUEsY0FDYixTQUFTO0FBQUEsY0FDVCxRQUFRO0FBQUEsWUFDVixDQUFDO0FBQ0Q7QUFBQSxVQUNGO0FBRUEsZ0JBQU0sYUFBYSxNQUFNQSxJQUN0QixXQUFXLG9CQUFvQixFQUMvQixNQUFNLE1BQU0sS0FBSyxZQUFZLFlBQVksRUFDekMsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLGNBQUksQ0FBQyxZQUFZO0FBQ2Ysb0JBQVEsS0FBSztBQUFBLGNBQ1g7QUFBQSxjQUNBLGFBQWE7QUFBQSxjQUNiLFNBQVM7QUFBQSxjQUNULFFBQVE7QUFBQSxZQUNWLENBQUM7QUFDRDtBQUFBLFVBQ0Y7QUFFQSxjQUFJO0FBQ0Ysa0JBQU0sRUFBRSxZQUFZLElBQUksTUFBTSxLQUFLLFVBQVU7QUFBQSxjQUMzQ0E7QUFBQSxjQUNBO0FBQUEsY0FDQTtBQUFBLGNBQ0E7QUFBQSxZQUNGO0FBQ0Esb0JBQVEsS0FBSyxFQUFFLGFBQWEsYUFBYSxTQUFTLE1BQU0sQ0FBQztBQUFBLFVBQzNELFNBQVMsS0FBSztBQUVaLGtCQUFNLFVBQVUsZUFBZSxRQUFRLElBQUksVUFBVSxPQUFPLEdBQUc7QUFDL0QsZ0JBQ0UsUUFBUSxTQUFTLHNDQUFzQyxLQUN2RCxRQUFRLFNBQVMsUUFBUSxHQUN6QjtBQUNBLHNCQUFRLEtBQUs7QUFBQSxnQkFDWDtBQUFBLGdCQUNBLGFBQWE7QUFBQSxnQkFDYixTQUFTO0FBQUEsZ0JBQ1QsUUFBUTtBQUFBLGNBQ1YsQ0FBQztBQUNEO0FBQUEsWUFDRjtBQUNBLGtCQUFNO0FBQUEsVUFDUjtBQUFBLFFBQ0Y7QUFFQSxlQUFPO0FBQUEsTUFDVDtBQUFBLE1BRUEsTUFBTSxnQkFDSkEsS0FDQSxRQUNBLE9BQ0EsU0FDd0I7QUFDeEIsY0FBTSxlQUFtQyxDQUFDO0FBRTFDLG1CQUFXLFFBQVEsT0FBTztBQUN4QixnQkFBTSxRQUFRLE1BQU1BLElBQ2pCLFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxRQUFRLEtBQUssTUFBTSxFQUN6QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsUUFBUSxjQUFjLE1BQU0sRUFDNUIsVUFBVSxFQUNWLFFBQVE7QUFFWCxnQkFBTUMsVUFDSixPQUFPLEtBQUssV0FBVyxXQUNuQixLQUFLLE1BQU0sS0FBSyxNQUFNLElBQ3RCLEtBQUssVUFBVSxDQUFDO0FBRXRCLGNBQUksaUJBQWlCLE1BQU07QUFDM0IsY0FBSSxhQUNGLE1BQU0sQ0FBQyxLQUFLLE9BQ1IsT0FBTyxNQUFNLENBQUMsRUFBRSxlQUFlLFdBQzdCLE1BQU0sQ0FBQyxFQUFFLGFBQ1QsSUFBSSxLQUFLLE1BQU0sQ0FBQyxFQUFFLFVBQVUsRUFBRSxZQUFZLElBQzVDO0FBR04sY0FDRSxPQUFPQSxRQUFPLGlCQUFpQixZQUMvQkEsUUFBTyxlQUFlLEdBQ3RCO0FBQ0Esa0JBQU0sTUFBTSxRQUFRLE9BQU8sb0JBQUksS0FBSztBQUNwQyxrQkFBTSxXQUFXQSxRQUFPLGVBQWUsS0FBSyxLQUFLO0FBQ2pELGtCQUFNLFdBQVcsTUFBTSxPQUFPLENBQUMsTUFBTTtBQUNuQyxvQkFBTSxJQUFJLElBQUksS0FBSyxFQUFFLFVBQVUsRUFBRSxRQUFRO0FBQ3pDLHFCQUFPLElBQUksUUFBUSxJQUFJLElBQUk7QUFBQSxZQUM3QixDQUFDO0FBQ0QsNkJBQWlCLFNBQVM7QUFDMUIseUJBQ0UsU0FBUyxDQUFDLEtBQUssT0FDWCxPQUFPLFNBQVMsQ0FBQyxFQUFFLGVBQWUsV0FDaEMsU0FBUyxDQUFDLEVBQUUsYUFDWixJQUFJLEtBQUssU0FBUyxDQUFDLEVBQUUsVUFBVSxFQUFFLFlBQVksSUFDL0M7QUFBQSxVQUNSO0FBRUEsZ0JBQU0sTUFBb0I7QUFBQSxZQUN4QixHQUFHO0FBQUEsWUFDSDtBQUFBLFlBQ0E7QUFBQSxZQUNBO0FBQUEsVUFDRjtBQUVBLGdCQUFNLGNBQWMsYUFBYSxNQUFNLEdBQUc7QUFDMUMsY0FBSSxZQUFhLGNBQWEsS0FBSyxXQUFXO0FBQUEsUUFDaEQ7QUFFQSxlQUFPLE1BQU0sS0FBSyxNQUFNRCxLQUFJLFFBQVEsWUFBWTtBQUFBLE1BQ2xEO0FBQUEsSUFDRjtBQUVPLElBQU0scUJBQXFCLElBQUksMEJBQTBCO0FBQUE7QUFBQTs7O0FDakxoRSxlQUFlLFVBQ2JFLEtBQ0EsUUFDQSxZQUNBLFVBQ3VCO0FBQ3ZCLFNBQU8sTUFBTUEsSUFDVixXQUFXLGNBQWMsRUFDekIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLGVBQWUsS0FBSyxVQUFVLEVBQ3BDLE1BQU0sYUFBYSxLQUFLLFFBQVEsRUFDaEMsTUFBTSxXQUFXLEtBQUssSUFBSSxFQUMxQixVQUFVLEVBQ1YsUUFBUTtBQUNiO0FBRUEsZUFBZSxrQkFDYkEsS0FDQSxPQUNBLE1BQzZCO0FBQzdCLFFBQU0sTUFBMEIsQ0FBQztBQUNqQyxhQUFXLFFBQVEsT0FBTztBQUN4QixVQUFNLE9BQU8sTUFBTUEsSUFDaEIsV0FBVyxxQkFBcUIsRUFDaEMsTUFBTSxXQUFXLEtBQUssS0FBSyxNQUFNLEVBQ2pDLE1BQU0sUUFBUSxLQUFLLE1BQU0sRUFDekIsTUFBTSxXQUFXLEtBQUssS0FBSyxFQUFFLEVBQzdCLFFBQVEsY0FBYyxNQUFNLEVBQzVCLFVBQVUsRUFDVixRQUFRO0FBRVgsVUFBTSxjQUFjLGFBQWEsTUFBTTtBQUFBLE1BQ3JDLEdBQUc7QUFBQSxNQUNILGdCQUFnQixLQUFLO0FBQUEsTUFDckIsWUFDRSxLQUFLLENBQUMsS0FBSyxPQUNQLE9BQU8sS0FBSyxDQUFDLEVBQUUsZUFBZSxXQUM1QixLQUFLLENBQUMsRUFBRSxhQUNSLElBQUksS0FBSyxLQUFLLENBQUMsRUFBRSxVQUFVLEVBQUUsWUFBWSxJQUMzQztBQUFBLElBQ1IsQ0FBQztBQUNELFFBQUksWUFBYSxLQUFJLEtBQUssV0FBVztBQUFBLEVBQ3ZDO0FBQ0EsU0FBTztBQUNUO0FBK0RPLFNBQVMsdUJBQ2QsWUFDNEI7QUFDNUIsU0FDRSx1QkFBdUIsS0FBSyxDQUFDLE1BQU0sRUFBRSxlQUFlLFVBQVUsS0FBSztBQUV2RTtBQWpJQSxJQThEYSxzQkFRQSxrQkFTQSxvQkFTQSw2QkFjQSw4QkFhQTtBQW5IYjtBQUFBO0FBQUE7QUFHQTtBQTJETyxJQUFNLHVCQUE0QztBQUFBLE1BQ3ZELFlBQVk7QUFBQSxNQUNaLE1BQU0sY0FBY0EsS0FBSSxLQUFLO0FBQzNCLGNBQU0sUUFBUSxNQUFNLFVBQVVBLEtBQUksSUFBSSxRQUFRLFlBQVksSUFBSSxRQUFRO0FBQ3RFLGVBQU8sa0JBQWtCQSxLQUFJLE9BQU8sR0FBRztBQUFBLE1BQ3pDO0FBQUEsSUFDRjtBQUVPLElBQU0sbUJBQXdDO0FBQUEsTUFDbkQsWUFBWTtBQUFBLE1BQ1osTUFBTSxjQUFjQSxLQUFJLEtBQUs7QUFDM0IsY0FBTSxRQUFRLE1BQU0sVUFBVUEsS0FBSSxJQUFJLFFBQVEsUUFBUSxJQUFJLFFBQVE7QUFDbEUsZUFBTyxrQkFBa0JBLEtBQUksT0FBTyxHQUFHO0FBQUEsTUFDekM7QUFBQSxJQUNGO0FBR08sSUFBTSxxQkFBMEM7QUFBQSxNQUNyRCxZQUFZO0FBQUEsTUFDWixNQUFNLGNBQWNBLEtBQUksS0FBSztBQUMzQixjQUFNLFFBQVEsTUFBTSxVQUFVQSxLQUFJLElBQUksUUFBUSxVQUFVLElBQUksUUFBUTtBQUNwRSxlQUFPLGtCQUFrQkEsS0FBSSxPQUFPLEdBQUc7QUFBQSxNQUN6QztBQUFBLElBQ0Y7QUFHTyxJQUFNLDhCQUFtRDtBQUFBLE1BQzlELFlBQVk7QUFBQSxNQUNaLE1BQU0sY0FBY0EsS0FBSSxLQUFLO0FBQzNCLGNBQU0sUUFBUSxNQUFNO0FBQUEsVUFDbEJBO0FBQUEsVUFDQSxJQUFJO0FBQUEsVUFDSjtBQUFBLFVBQ0EsSUFBSTtBQUFBLFFBQ047QUFDQSxlQUFPLGtCQUFrQkEsS0FBSSxPQUFPLEdBQUc7QUFBQSxNQUN6QztBQUFBLElBQ0Y7QUFHTyxJQUFNLCtCQUFvRDtBQUFBLE1BQy9ELFlBQVk7QUFBQSxNQUNaLE1BQU0sY0FBY0EsS0FBSSxLQUFLO0FBQzNCLGNBQU0sUUFBUSxNQUFNO0FBQUEsVUFDbEJBO0FBQUEsVUFDQSxJQUFJO0FBQUEsVUFDSjtBQUFBLFVBQ0EsSUFBSTtBQUFBLFFBQ047QUFDQSxlQUFPLGtCQUFrQkEsS0FBSSxPQUFPLEdBQUc7QUFBQSxNQUN6QztBQUFBLElBQ0Y7QUFFTyxJQUFNLHlCQUFnRDtBQUFBLE1BQzNEO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0Y7QUFBQTtBQUFBOzs7QUN6SEE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQVNBLGVBQXNCLGtDQUNwQkMsS0FDQSxNQUt3QjtBQUN4QixRQUFNLFVBQVUsdUJBQXVCLFVBQVU7QUFDakQsTUFBSSxDQUFDLFFBQVMsUUFBTyxDQUFDO0FBRXRCLFFBQU0sYUFBYSxjQUFjLEtBQUssWUFBWTtBQUNsRCxRQUFNLGVBQWUsTUFBTSxRQUFRLGNBQWNBLEtBQUk7QUFBQSxJQUNuRCxRQUFRLEtBQUs7QUFBQSxJQUNiLFlBQVk7QUFBQSxJQUNaLFVBQVUsS0FBSztBQUFBLElBQ2Y7QUFBQSxJQUNBLFlBQVksS0FBSztBQUFBLElBQ2pCLGNBQWMsS0FBSztBQUFBLEVBQ3JCLENBQUM7QUFFRCxTQUFPLE1BQU0sbUJBQW1CLE1BQU1BLEtBQUksS0FBSyxRQUFRLFlBQVk7QUFDckU7QUFHQSxlQUFzQixnQ0FDcEJBLEtBQ0EsTUFLd0I7QUFDeEIsUUFBTSxVQUFVLHVCQUF1QixNQUFNO0FBQzdDLE1BQUksQ0FBQyxRQUFTLFFBQU8sQ0FBQztBQUV0QixRQUFNLGFBQWEsU0FBUyxLQUFLLE9BQU87QUFDeEMsUUFBTSxlQUFlLE1BQU0sUUFBUSxjQUFjQSxLQUFJO0FBQUEsSUFDbkQsUUFBUSxLQUFLO0FBQUEsSUFDYixZQUFZO0FBQUEsSUFDWixVQUFVLEtBQUs7QUFBQSxJQUNmO0FBQUEsSUFDQSxRQUFRLEtBQUs7QUFBQSxJQUNiLFNBQVMsS0FBSztBQUFBLEVBQ2hCLENBQUM7QUFFRCxTQUFPLE1BQU0sbUJBQW1CLE1BQU1BLEtBQUksS0FBSyxRQUFRLFlBQVk7QUFDckU7QUF4REE7QUFBQTtBQUFBO0FBRUE7QUFDQTtBQUFBO0FBQUE7OztBQ0hBO0FBQUE7QUFBQTtBQUFBO0FBb0JPLFNBQVMsa0JBQWtCLE9BYWhCO0FBQ2hCLFFBQU0sU0FBd0IsQ0FBQztBQUMvQixRQUFNLE1BQU0sTUFBTSxPQUFPLG9CQUFJLEtBQUs7QUFFbEMsUUFBTSxXQUFXLE1BQU0sVUFBVSxPQUFPLENBQUMsR0FBRyxNQUFNLElBQUksRUFBRSxVQUFVLENBQUM7QUFDbkUsTUFBSSxXQUFXLEdBQUc7QUFDaEIsVUFBTSxNQUFNLENBQUMsR0FBRyxNQUFNLFNBQVMsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLEVBQUUsV0FBVyxFQUFFLFFBQVEsRUFBRSxDQUFDO0FBQzFFLFdBQU8sS0FBSztBQUFBLE1BQ1YsTUFBTTtBQUFBLE1BQ04sT0FBTztBQUFBLE1BQ1AsU0FDRSxhQUFhLElBQ1QsNkNBQ0EsWUFBWSxRQUFRO0FBQUEsTUFDMUIsVUFBVTtBQUFBLE1BQ1YsY0FBYyxLQUFLO0FBQUEsTUFDbkIsYUFBYSxLQUFLO0FBQUEsSUFDcEIsQ0FBQztBQUFBLEVBQ0g7QUFFQSxRQUFNLFNBQVMsSUFBSSxRQUFRLElBQUksS0FBSyxLQUFLLEtBQUs7QUFDOUMsUUFBTSxRQUFRLE1BQU0sWUFBWSxPQUFPLENBQUMsTUFBTTtBQUM1QyxVQUFNLElBQUksSUFBSSxLQUFLLEVBQUUsVUFBVSxFQUFFLFFBQVE7QUFDekMsV0FBTyxLQUFLO0FBQUEsRUFDZCxDQUFDO0FBQ0QsYUFBVyxRQUFRLE1BQU0sTUFBTSxHQUFHLENBQUMsR0FBRztBQUNwQyxXQUFPLEtBQUs7QUFBQSxNQUNWLE1BQU07QUFBQSxNQUNOLE9BQU87QUFBQSxNQUNQLFNBQVMsY0FBYyxLQUFLLGVBQWUsUUFBSyxLQUFLLFFBQVE7QUFBQSxNQUM3RCxVQUFVO0FBQUEsTUFDVixjQUFjLEtBQUs7QUFBQSxJQUNyQixDQUFDO0FBQUEsRUFDSDtBQUVBLFFBQU0sV0FBVyxNQUFNLFVBQVUsS0FBSyxDQUFDLE1BQU0sRUFBRSxZQUFZLENBQUM7QUFDNUQsTUFBSSxVQUFVO0FBQ1osV0FBTyxLQUFLO0FBQUEsTUFDVixNQUFNO0FBQUEsTUFDTixPQUFPO0FBQUEsTUFDUCxTQUFTLEdBQUcsU0FBUyxRQUFRLFVBQVUsbUJBQWdCLFNBQVMsUUFBUTtBQUFBLE1BQ3hFLFVBQVU7QUFBQSxNQUNWLGNBQWMsU0FBUztBQUFBLE1BQ3ZCLGFBQWEsU0FBUztBQUFBLElBQ3hCLENBQUM7QUFBQSxFQUNIO0FBRUEsU0FBTztBQUNUO0FBakZBO0FBQUE7QUFBQTtBQUFBO0FBQUE7OztBQ0FBLFNBQVMsV0FBVzs7O0FDR2IsSUFBTSxpQkFBTixNQUEyQztBQUFBLEVBQ2hELE1BQU0sYUFDSixTQUNBLFVBQzZCO0FBQzdCLFdBQU8sRUFBRSxjQUFjLEdBQUcsZUFBZSxDQUFDLEVBQUU7QUFBQSxFQUM5QztBQUNGOzs7QUNUTyxTQUFTLElBQUksTUFBa0M7QUFDcEQsTUFBSSxPQUFPLFlBQVksZUFBZSxRQUFRLE1BQU0sSUFBSSxHQUFHO0FBQ3pELFdBQU8sUUFBUSxJQUFJLElBQUk7QUFBQSxFQUN6QjtBQUNBLE1BQUk7QUFDRixXQUFPLEtBQUssSUFBSSxJQUFJLElBQUk7QUFBQSxFQUMxQixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjs7O0FDTkEsZUFBZSxhQUFhLE1BQStCO0FBQ3pELE1BQUksT0FBTyxTQUFTLGVBQWUsT0FBTyxLQUFLLGlCQUFpQixZQUFZO0FBQzFFLFdBQU8sTUFBTSxLQUFLLGFBQWEsSUFBSTtBQUFBLEVBQ3JDO0FBQ0EsUUFBTSxFQUFFLFVBQUFDLFVBQVMsSUFBSSxNQUFNLE9BQU8sa0JBQWtCO0FBQ3BELFNBQU8sTUFBTUEsVUFBUyxNQUFNLE1BQU07QUFDcEM7QUErQkEsSUFBTSxzQkFBc0Isb0JBQUksSUFBSTtBQUFBLEVBQ2xDO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFRTSxJQUFNLHFCQUFOLE1BQStDO0FBQUEsRUFDcEQsWUFBNkIsV0FBc0I7QUFBdEI7QUFBQSxFQUF1QjtBQUFBLEVBRXBELE1BQU0sYUFDSixRQUNBLFNBQzZCO0FBQzdCLFFBQUksT0FBTyxXQUFXLEdBQUc7QUFDdkIsYUFBTyxFQUFFLGNBQWMsR0FBRyxlQUFlLENBQUMsRUFBRTtBQUFBLElBQzlDO0FBRUEsVUFBTSxnQkFBMEIsQ0FBQztBQUNqQyxRQUFJLGVBQWU7QUFHbkIsVUFBTSxZQUFZO0FBQ2xCLGFBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxRQUFRLEtBQUssV0FBVztBQUNqRCxZQUFNLFFBQVEsT0FBTyxNQUFNLEdBQUcsSUFBSSxTQUFTO0FBQzNDLFlBQU1DLFVBQVMsTUFBTSxLQUFLLFVBQVUscUJBQXFCO0FBQUEsUUFDdkQsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFVBQ1osT0FBTyxRQUFRO0FBQUEsVUFDZixNQUFNLFFBQVE7QUFBQSxRQUNoQjtBQUFBLFFBQ0EsTUFBTSxRQUFRO0FBQUEsTUFDaEIsQ0FBQztBQUNELHNCQUFnQkEsUUFBTztBQUN2QixNQUFBQSxRQUFPLFVBQVUsUUFBUSxDQUFDLFVBQVUsVUFBVTtBQUM1QyxZQUFJLFNBQVMsUUFBUztBQUN0QixjQUFNLE9BQU8sU0FBUyxPQUFPO0FBQzdCLFlBQUksUUFBUSxvQkFBb0IsSUFBSSxJQUFJLEdBQUc7QUFDekMsd0JBQWMsS0FBSyxNQUFNLEtBQUssQ0FBRTtBQUFBLFFBQ2xDO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFdBQU8sRUFBRSxjQUFjLGNBQWM7QUFBQSxFQUN2QztBQUNGO0FBRUEsU0FBUyx3QkFBd0IsS0FBNkI7QUFDNUQsUUFBTSxTQUFTLEtBQUssTUFBTSxHQUFHO0FBQzdCLE1BQ0UsT0FBTyxPQUFPLGVBQWUsWUFDN0IsT0FBTyxPQUFPLGlCQUFpQixZQUMvQixPQUFPLE9BQU8sZ0JBQWdCLFVBQzlCO0FBQ0EsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTyxjQUFjLE9BQU8sWUFBWSxRQUFRLFFBQVEsSUFBSTtBQUM1RCxTQUFPO0FBQ1Q7QUFFQSxlQUFlLHFCQUFxRDtBQUNsRSxRQUFNLE9BQU8sSUFBSSwrQkFBK0I7QUFDaEQsTUFBSSxRQUFRLEtBQUssS0FBSyxFQUFFLFNBQVMsR0FBRztBQUNsQyxXQUFPLHdCQUF3QixJQUFJO0FBQUEsRUFDckM7QUFFQSxRQUFNLE9BQU8sSUFBSSwrQkFBK0I7QUFDaEQsTUFBSSxRQUFRLEtBQUssS0FBSyxFQUFFLFNBQVMsR0FBRztBQUNsQyxVQUFNLE9BQU8sTUFBTSxhQUFhLElBQUk7QUFDcEMsV0FBTyx3QkFBd0IsSUFBSTtBQUFBLEVBQ3JDO0FBRUEsU0FBTztBQUNUO0FBRUEsZUFBZSxvQkFBa0Q7QUFJL0QsUUFBTSxNQUFNLE1BQU0sT0FBTyxnQkFBZ0I7QUFHekMsU0FBTyxJQUFJLFdBQVc7QUFDeEI7QUFVQSxlQUFzQiwwQkFBK0M7QUFDbkUsTUFBSTtBQUNGLFVBQU0sVUFBVSxNQUFNLG1CQUFtQjtBQUN6QyxRQUFJLENBQUMsU0FBUztBQUNaLGNBQVE7QUFBQSxRQUNOO0FBQUEsTUFDRjtBQUNBLGFBQU8sSUFBSSxlQUFlO0FBQUEsSUFDNUI7QUFFQSxVQUFNLFFBQVEsTUFBTSxrQkFBa0I7QUFDdEMsUUFBSSxNQUFNLEtBQUssV0FBVyxHQUFHO0FBQzNCLFlBQU0sY0FBYztBQUFBLFFBQ2xCLFlBQVksTUFBTSxXQUFXLEtBQUssT0FBTztBQUFBLE1BQzNDLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTyxJQUFJLG1CQUFtQixNQUFNLFVBQVUsQ0FBQztBQUFBLEVBQ2pELFNBQVMsS0FBSztBQUNaLFlBQVEsTUFBTSxzREFBc0QsR0FBRztBQUN2RSxXQUFPLElBQUksZUFBZTtBQUFBLEVBQzVCO0FBQ0Y7OztBQ25LQSxPQUErQztBQUMvQyxTQUFTLGNBQUFDLG1CQUFrQjs7O0FDRDNCLE9BQTBFOzs7QUNBMUUsU0FBUyxNQUFNLGFBQWE7QUFDNUIsU0FBUyxRQUFRLHVCQUF1Qjs7O0FDQWpDLFNBQVMsa0JBQ2QsYUFDcUQ7QUFDckQsTUFBSTtBQUNKLE1BQUk7QUFDRixVQUFNLElBQUksSUFBSSxXQUFXO0FBQUEsRUFDM0IsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxPQUFPLElBQUksYUFBYSxJQUFJLFNBQVMsR0FBRyxZQUFZO0FBQzFELE1BQUksU0FBUyxVQUFXLFFBQU87QUFDL0IsTUFBSSxTQUFTLGFBQWEsU0FBUyxlQUFlLFNBQVMsZUFBZTtBQUN4RSxXQUFPLEVBQUUsb0JBQW9CLE1BQU07QUFBQSxFQUNyQztBQUVBLFFBQU0sT0FBTyxJQUFJO0FBQ2pCLE1BQUksU0FBUyxlQUFlLFNBQVMsWUFBYSxRQUFPO0FBRXpELFNBQU8sRUFBRSxvQkFBb0IsTUFBTTtBQUNyQztBQUtPLFNBQVMsaUNBQWlDLGFBQTZCO0FBQzVFLE1BQUk7QUFDRixVQUFNLE1BQU0sSUFBSSxJQUFJLFdBQVc7QUFDL0IsZUFBVyxPQUFPO0FBQUEsTUFDaEI7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixHQUFHO0FBQ0QsVUFBSSxhQUFhLE9BQU8sR0FBRztBQUFBLElBQzdCO0FBQ0EsV0FBTyxJQUFJLFNBQVM7QUFBQSxFQUN0QixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjs7O0FEL0JBLE1BQU0sY0FBYyxNQUFNLFNBQVMsTUFBTSxDQUFDLFVBQWtCLEtBQUs7QUFPakUsU0FBUyxrQkFDUCxpQkFDdUM7QUFDdkMsUUFBTSxjQUFjLElBQUksY0FBYztBQUN0QyxNQUFJLGFBQWE7QUFDZixVQUFNLE1BQU0sa0JBQWtCLFdBQVc7QUFDekMsV0FBTztBQUFBLE1BQ0wsa0JBQWtCLGlDQUFpQyxXQUFXO0FBQUEsTUFDOUQsS0FBSztBQUFBLE1BQ0wsR0FBSSxRQUFRLFNBQVksQ0FBQyxJQUFJLEVBQUUsSUFBSTtBQUFBLElBQ3JDO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMLFVBQVUsSUFBSSxZQUFZLEtBQUs7QUFBQSxJQUMvQixNQUFNLElBQUksUUFBUSxLQUFLO0FBQUEsSUFDdkIsTUFBTSxJQUFJLFFBQVEsS0FBSztBQUFBLElBQ3ZCLFVBQVUsSUFBSSxZQUFZLEtBQUs7QUFBQSxJQUMvQixNQUFNLE9BQU8sSUFBSSxRQUFRLEtBQUssTUFBTTtBQUFBLElBQ3BDLEtBQUs7QUFBQSxFQUNQO0FBQ0Y7QUFHTyxTQUFTLGFBQWlCLFNBQTBDO0FBQ3pFLFFBQU0sVUFBVSxJQUFJLGdCQUFnQjtBQUFBLElBQ2xDLE1BQU0sSUFBSSxLQUFLLGtCQUFrQixRQUFRLGVBQWUsQ0FBQztBQUFBLEVBQzNELENBQUM7QUFDRCxTQUFPLElBQUksT0FBVyxFQUFFLFFBQVEsQ0FBQztBQUNuQzs7O0FFMUNPLElBQU0sS0FBSyxhQUF1QjtBQUFBLEVBQ3ZDLGlCQUFpQjtBQUNuQixDQUFDOzs7QUNQRCxJQUFNLG1CQUFtQixvQkFBSSxJQUFJLENBQUMsT0FBTyxXQUFXLEtBQUssQ0FBQztBQUVuRCxTQUFTLHVCQUF1QixVQUEwQjtBQUMvRCxRQUFNLGFBQWEsU0FBUyxLQUFLLEVBQUUsWUFBWTtBQUMvQyxNQUFJLENBQUMsaUJBQWlCLElBQUksVUFBVSxHQUFHO0FBQ3JDLFVBQU0sSUFBSSxNQUFNLHVDQUF1QztBQUFBLEVBQ3pEO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxvQkFBb0IsT0FBdUI7QUFDekQsUUFBTSxVQUFVLE1BQU0sS0FBSztBQUMzQixNQUFJLFFBQVEsU0FBUyxLQUFLLFFBQVEsU0FBUyxNQUFNO0FBQy9DLFVBQU0sSUFBSSxNQUFNLHNCQUFzQjtBQUFBLEVBQ3hDO0FBQ0EsU0FBTztBQUNUOzs7QUNMTyxTQUFTLGVBQ2QsTUFDQSxNQUFZLG9CQUFJLEtBQUssR0FDRDtBQUNwQixNQUFJLEtBQUssV0FBVyxTQUFVLFFBQU87QUFDckMsTUFBSSxLQUFLLFdBQVcsWUFBYSxRQUFPO0FBQ3hDLE1BQUksS0FBSyxXQUFXLFdBQVksUUFBTztBQUN2QyxNQUFJLEtBQUssV0FBVyxTQUFVLFFBQU87QUFDckMsTUFBSSxLQUFLLFdBQVcsWUFBWSxJQUFJLEtBQUssS0FBSyxTQUFTLElBQUksS0FBSztBQUM5RCxXQUFPO0FBQUEsRUFDVDtBQUNBLFNBQU87QUFDVDtBQUdPLFNBQVMsZ0JBQ2QsT0FDQSxNQUFZLG9CQUFJLEtBQUssR0FDWjtBQUNULFNBQU8sT0FBTyxJQUFJLEtBQUssTUFBTSxTQUFTO0FBQ3hDOzs7QUNBTyxTQUFTLGFBQWEsUUFBa0M7QUFDN0QsUUFBTSxPQUFPLG9CQUFJLElBQVk7QUFDN0IsUUFBTSxNQUFtQixDQUFDO0FBQzFCLGFBQVcsU0FBUyxRQUFRO0FBQzFCLFVBQU0sTUFBTSxNQUFNLGVBQWUsUUFBUSxNQUFNLGtCQUMzQyxHQUFHLE1BQU0sV0FBVyxJQUFJLE1BQU0sZUFBZSxJQUFJLE1BQU0sTUFBTSxLQUM3RCxNQUFNLE1BQU0sRUFBRTtBQUNsQixRQUFJLEtBQUssSUFBSSxHQUFHLEVBQUc7QUFDbkIsU0FBSyxJQUFJLEdBQUc7QUFDWixRQUFJLEtBQUssS0FBSztBQUFBLEVBQ2hCO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLFFBQXFCLE9BQStCO0FBQzFFLFFBQU0sUUFBUSxJQUFJLEtBQUssTUFBTSxTQUFTLEVBQUUsUUFBUTtBQUNoRCxRQUFNLE1BQU0sTUFBTSxVQUFVLElBQUksS0FBSyxNQUFNLE9BQU8sRUFBRSxRQUFRLElBQUksT0FBTztBQUN2RSxTQUFPLE9BQU8sT0FBTyxDQUFDLE1BQU07QUFDMUIsVUFBTSxJQUFJLElBQUksS0FBSyxFQUFFLFdBQVcsRUFBRSxRQUFRO0FBQzFDLFdBQU8sS0FBSyxTQUFTLElBQUk7QUFBQSxFQUMzQixDQUFDO0FBQ0g7QUFFQSxTQUFTLGtCQUFrQixPQUFnQztBQUN6RCxTQUFPLElBQUk7QUFBQSxJQUNULE1BQ0csT0FBTyxDQUFDLE1BQU0sRUFBRSxjQUFjLGNBQWMsRUFBRSxlQUFlLElBQUksRUFDakUsSUFBSSxDQUFDLE1BQU0sRUFBRSxXQUFZO0FBQUEsRUFDOUI7QUFDRjtBQUVBLFNBQVMsZUFBZSxPQUFnQztBQUN0RCxTQUFPLElBQUk7QUFBQSxJQUNULE1BQ0csT0FBTyxDQUFDLE1BQU0sRUFBRSxjQUFjLFdBQVcsRUFBRSxZQUFZLElBQUksRUFDM0QsSUFBSSxDQUFDLE1BQU0sRUFBRSxRQUFTO0FBQUEsRUFDM0I7QUFDRjtBQUVBLFNBQVMsZUFBZSxPQUFrQixPQUEyQjtBQUNuRSxhQUFXLFFBQVEsT0FBTztBQUN4QixRQUNFLEtBQUssY0FBYyxjQUNuQixLQUFLLGVBQWUsUUFDcEIsTUFBTSxnQkFBZ0IsS0FBSyxhQUMzQjtBQUNBLGFBQU8sT0FBTyxLQUFLLE1BQU07QUFBQSxJQUMzQjtBQUNBLFFBQ0UsS0FBSyxjQUFjLFdBQ25CLEtBQUssWUFBWSxRQUNqQixNQUFNLGFBQWEsS0FBSyxVQUN4QjtBQUNBLGFBQU8sT0FBTyxLQUFLLE1BQU07QUFBQSxJQUMzQjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGFBQWEsT0FBa0IsT0FBNEI7QUFDbEUsUUFBTSxhQUFhLGtCQUFrQixLQUFLO0FBQzFDLFFBQU0sU0FBUyxlQUFlLEtBQUs7QUFDbkMsTUFBSSxXQUFXLFNBQVMsS0FBSyxPQUFPLFNBQVMsRUFBRyxRQUFPO0FBQ3ZELE1BQUksTUFBTSxlQUFlLFFBQVEsV0FBVyxJQUFJLE1BQU0sV0FBVyxFQUFHLFFBQU87QUFDM0UsTUFBSSxNQUFNLFlBQVksUUFBUSxPQUFPLElBQUksTUFBTSxRQUFRLEVBQUcsUUFBTztBQUNqRSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFlBQ1AsUUFDQSxPQUNBLFFBQ1E7QUFDUixNQUFJLFFBQVE7QUFDWixhQUFXLFNBQVMsYUFBYSxNQUFNLEdBQUc7QUFDeEMsUUFBSSxNQUFNLFdBQVcsT0FBUTtBQUM3QixRQUFJLENBQUMsYUFBYSxPQUFPLEtBQUssRUFBRztBQUNqQyxhQUFTLE9BQU8sTUFBTSxNQUFNLElBQUksZUFBZSxPQUFPLEtBQUs7QUFBQSxFQUM3RDtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsY0FBYyxPQUFlLE9BQTBCO0FBQzlELFNBQU8sS0FBSyxJQUFJLEdBQUcsUUFBUSxPQUFPLE1BQU0sY0FBYyxDQUFDLENBQUM7QUFDMUQ7QUFFQSxTQUFTLE9BQU8sT0FBZSxRQUFnQztBQUM3RCxRQUFNLGVBQWUsS0FBSyxJQUFJLEdBQUcsS0FBSztBQUN0QyxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0EsTUFBTSxTQUFTLElBQUksZ0JBQWdCLFNBQVMsZUFBZTtBQUFBLEVBQzdEO0FBQ0Y7QUFFTyxJQUFNLHlCQUF3QztBQUFBLEVBQ25ELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU0sV0FBVyxlQUFlLElBQUksUUFBUSxJQUFJLEtBQUs7QUFDckQsVUFBTSxRQUFRO0FBQUEsTUFDWixZQUFZLFVBQVUsSUFBSSxPQUFPLE9BQU87QUFBQSxNQUN4QyxJQUFJO0FBQUEsSUFDTjtBQUNBLFdBQU8sT0FBTyxPQUFPLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLEVBQ3JEO0FBQ0Y7QUFFTyxJQUFNLDRCQUEyQztBQUFBLEVBQ3RELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU0sV0FBVyxlQUFlLElBQUksUUFBUSxJQUFJLEtBQUs7QUFDckQsVUFBTSxRQUFRO0FBQUEsTUFDWixZQUFZLFVBQVUsSUFBSSxPQUFPLFVBQVU7QUFBQSxNQUMzQyxJQUFJO0FBQUEsSUFDTjtBQUNBLFdBQU8sT0FBTyxPQUFPLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLEVBQ3JEO0FBQ0Y7QUFFTyxJQUFNLHlCQUF3QztBQUFBLEVBQ25ELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU0sV0FBVyxlQUFlLElBQUksUUFBUSxJQUFJLEtBQUs7QUFDckQsVUFBTSxRQUFRO0FBQUEsTUFDWixZQUFZLFVBQVUsSUFBSSxPQUFPLFVBQVU7QUFBQSxNQUMzQyxJQUFJO0FBQUEsSUFDTjtBQUNBLFdBQU8sT0FBTyxPQUFPLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLEVBQ3JEO0FBQ0Y7QUFFTyxJQUFNLHNCQUFxQztBQUFBLEVBQ2hELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU0sV0FBVyxlQUFlLElBQUksUUFBUSxJQUFJLEtBQUs7QUFDckQsVUFBTSxRQUFRO0FBQUEsTUFDWixZQUFZLFVBQVUsSUFBSSxPQUFPLE9BQU87QUFBQSxNQUN4QyxJQUFJO0FBQUEsSUFDTjtBQUNBLFdBQU8sT0FBTyxPQUFPLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLEVBQ3JEO0FBQ0Y7QUFHTyxJQUFNLHlCQUF3QztBQUFBLEVBQ25ELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFdBQU8sb0JBQW9CLFNBQVMsR0FBRztBQUFBLEVBQ3pDO0FBQ0Y7QUFNTyxJQUFNLDRCQUEyQztBQUFBLEVBQ3RELFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU0sV0FBVyxlQUFlLElBQUksUUFBUSxJQUFJLEtBQUs7QUFDckQsVUFBTSxjQUFjLElBQUksSUFBSSxJQUFJLG9CQUFvQixDQUFDLENBQUM7QUFDdEQsVUFBTSxZQUFZLG9CQUFJLElBQVk7QUFDbEMsZUFBVyxTQUFTLGFBQWEsUUFBUSxHQUFHO0FBQzFDLFVBQUksTUFBTSxXQUFXLFFBQVM7QUFDOUIsVUFBSSxNQUFNLGVBQWUsS0FBTTtBQUMvQixVQUFJLFlBQVksT0FBTyxLQUFLLENBQUMsWUFBWSxJQUFJLE1BQU0sV0FBVyxFQUFHO0FBQ2pFLFVBQUksQ0FBQyxhQUFhLE9BQU8sSUFBSSxLQUFLLEtBQUssWUFBWSxTQUFTLEVBQUc7QUFDL0QsVUFBSSxZQUFZLE9BQU8sS0FBSyxhQUFhLE9BQU8sSUFBSSxLQUFLLEdBQUc7QUFDMUQsa0JBQVUsSUFBSSxNQUFNLFdBQVc7QUFBQSxNQUNqQztBQUFBLElBQ0Y7QUFFQSxVQUFNLFFBQVE7QUFBQSxNQUNaLFlBQVksT0FBTyxJQUNmLENBQUMsR0FBRyxTQUFTLEVBQUUsT0FBTyxDQUFDLE9BQU8sWUFBWSxJQUFJLEVBQUUsQ0FBQyxFQUFFLFNBQ25ELFVBQVU7QUFBQSxNQUNkLElBQUk7QUFBQSxJQUNOO0FBQ0EsV0FBTyxPQUFPLE9BQU8sT0FBTyxJQUFJLE1BQU0sWUFBWSxDQUFDO0FBQUEsRUFDckQ7QUFDRjtBQUVPLElBQU0saUNBQWdEO0FBQUEsRUFDM0QsVUFBVTtBQUFBLEVBQ1YsU0FBUyxLQUFLO0FBQ1osV0FBTywwQkFBMEIsU0FBUyxHQUFHO0FBQUEsRUFDL0M7QUFDRjtBQUdPLElBQU0sa0JBQWlDO0FBQUEsRUFDNUMsVUFBVTtBQUFBLEVBQ1YsU0FBUyxLQUFLO0FBQ1osVUFBTSxXQUFXLGVBQWUsSUFBSSxRQUFRLElBQUksS0FBSztBQUNyRCxVQUFNLE9BQU8sb0JBQUksSUFBWTtBQUM3QixlQUFXLFNBQVMsYUFBYSxRQUFRLEdBQUc7QUFDMUMsVUFBSSxNQUFNLFdBQVcsUUFBUztBQUM5QixVQUFJLENBQUMsYUFBYSxPQUFPLElBQUksS0FBSyxFQUFHO0FBQ3JDLFlBQU0sTUFBTSxNQUFNLG1CQUNoQixJQUFJLEtBQUssTUFBTSxXQUFXLEVBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQ3ZELFdBQUssSUFBSSxHQUFHO0FBQUEsSUFDZDtBQUNBLFVBQU0sU0FBUyxDQUFDLEdBQUcsSUFBSSxFQUFFLEtBQUs7QUFDOUIsUUFBSSxPQUFPO0FBQ1gsUUFBSSxNQUFNO0FBQ1YsUUFBSSxPQUFzQjtBQUMxQixlQUFXLE9BQU8sUUFBUTtBQUN4QixVQUFJLE1BQU07QUFDUixjQUFNLFdBQVcsb0JBQUksS0FBSyxPQUFPLFlBQVk7QUFDN0MsY0FBTSxVQUFVLG9CQUFJLEtBQUssTUFBTSxZQUFZO0FBQzNDLGNBQU0sUUFBUSxRQUFRLFFBQVEsSUFBSSxTQUFTLFFBQVEsS0FBSztBQUN4RCxjQUFNLFNBQVMsSUFBSSxNQUFNLElBQUk7QUFBQSxNQUMvQixPQUFPO0FBQ0wsY0FBTTtBQUFBLE1BQ1I7QUFDQSxhQUFPLEtBQUssSUFBSSxNQUFNLEdBQUc7QUFDekIsYUFBTztBQUFBLElBQ1Q7QUFDQSxVQUFNLFFBQVEsY0FBYyxNQUFNLElBQUksS0FBSztBQUMzQyxXQUFPLE9BQU8sT0FBTyxPQUFPLElBQUksTUFBTSxZQUFZLENBQUM7QUFBQSxFQUNyRDtBQUNGO0FBR08sSUFBTSwwQkFBeUM7QUFBQSxFQUNwRCxVQUFVO0FBQUEsRUFDVixTQUFTLEtBQUs7QUFDWixVQUFNQyxVQUFTLE9BQU8sSUFBSSxLQUFLLFdBQVcsV0FDdEMsS0FBSyxNQUFNLElBQUksS0FBSyxNQUFNLElBQ3pCLElBQUksS0FBSyxVQUFVLENBQUM7QUFDekIsVUFBTSxTQUFTLE9BQU9BLFFBQU8sZ0JBQWdCLFdBQVdBLFFBQU8sY0FBYztBQUM3RSxVQUFNLFFBQVEsT0FBT0EsUUFBTyxlQUFlLFdBQVdBLFFBQU8sYUFBYTtBQUMxRSxVQUFNLFdBQVcsZUFBZSxJQUFJLFFBQVEsSUFBSSxLQUFLO0FBQ3JELFFBQUksUUFBUTtBQUNaLGVBQVcsU0FBUyxhQUFhLFFBQVEsR0FBRztBQUMxQyxVQUFJLE1BQU0sV0FBVyxRQUFTO0FBQzlCLFVBQUksQ0FBQyxhQUFhLE9BQU8sSUFBSSxLQUFLLEVBQUc7QUFDckMsWUFBTSxPQUFPLElBQUksS0FBSyxNQUFNLFdBQVcsRUFBRSxZQUFZLEVBQUUsTUFBTSxJQUFJLEVBQUU7QUFDbkUsVUFBSSxVQUFVLFFBQVEsT0FBUTtBQUM5QixVQUFJLFNBQVMsT0FBTyxNQUFPO0FBQzNCLGVBQVMsT0FBTyxNQUFNLE1BQU0sSUFBSSxlQUFlLE9BQU8sSUFBSSxLQUFLO0FBQUEsSUFDakU7QUFDQSxXQUFPLE9BQU8sY0FBYyxPQUFPLElBQUksS0FBSyxHQUFHLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLEVBQy9FO0FBQ0Y7QUFFTyxJQUFNLHFCQUFvQztBQUFBLEVBQy9DLFVBQVU7QUFBQSxFQUNWLFNBQVMsS0FBSztBQUNaLFVBQU1BLFVBQVMsT0FBTyxJQUFJLEtBQUssV0FBVyxXQUN0QyxLQUFLLE1BQU0sSUFBSSxLQUFLLE1BQU0sSUFDekIsSUFBSSxLQUFLLFVBQVUsQ0FBQztBQUN6QixVQUFNLE9BQU9BLFFBQU8sa0JBQWtCO0FBQ3RDLFVBQU0sV0FBVyxJQUFJO0FBQ3JCLFFBQUksQ0FBQyxZQUFZLFNBQVMsU0FBUyxHQUFHO0FBQ3BDLGFBQU8sT0FBTyxHQUFHLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLElBQ2pEO0FBRUEsVUFBTSxVQUFVLENBQUMsR0FBRyxTQUFTLFFBQVEsQ0FBQztBQUN0QyxRQUFJLFNBQVMsWUFBWTtBQUN2QixVQUFJLGNBQWM7QUFDbEIsVUFBSSxjQUFjO0FBQ2xCLGlCQUFXLENBQUMsU0FBUyxLQUFLLEtBQUssU0FBUztBQUN0QyxjQUFNLElBQUksT0FBTyxJQUFJLGNBQWMsSUFBSSxPQUFPLEtBQUssQ0FBQztBQUNwRCxjQUFNLFdBQVcsT0FBTyxNQUFNLFlBQVksSUFBSSxJQUMxQyxLQUFLLElBQUksR0FBRyxPQUFPLE1BQU0sYUFBYSxJQUFJLE9BQU8sTUFBTSxZQUFZLENBQUMsSUFDbkUsTUFBTSxXQUFXLGNBQWMsSUFBSTtBQUN4Qyx1QkFBZSxXQUFXO0FBQzFCLHVCQUFlO0FBQUEsTUFDakI7QUFDQSxZQUFNLE1BQU0sY0FBYyxJQUFJLGNBQWMsY0FBYztBQUUxRCxZQUFNLFFBQVEsTUFBTSxPQUFPLElBQUksTUFBTSxZQUFZO0FBQ2pELGFBQU8sT0FBTyxPQUFPLE9BQU8sSUFBSSxNQUFNLFlBQVksQ0FBQztBQUFBLElBQ3JEO0FBRUEsVUFBTSxZQUFZLFFBQVE7QUFBQSxNQUFPLENBQUMsQ0FBQyxFQUFFLENBQUMsTUFDcEMsRUFBRSxXQUFXLGVBQ1osT0FBTyxFQUFFLFlBQVksSUFBSSxLQUFLLE9BQU8sRUFBRSxhQUFhLEtBQUssT0FBTyxFQUFFLFlBQVk7QUFBQSxJQUNqRixFQUFFO0FBRUYsUUFBSSxTQUFTLE9BQU87QUFDbEIsWUFBTSxTQUFTLEtBQUssSUFBSSxHQUFHLE9BQU9BLFFBQU8sa0JBQWtCLENBQUMsQ0FBQztBQUM3RCxhQUFPLE9BQU8sV0FBVyxNQUFNO0FBQUEsSUFDakM7QUFHQSxXQUFPLE9BQU8sV0FBVyxRQUFRLE1BQU07QUFBQSxFQUN6QztBQUNGO0FBRUEsSUFBTSxhQUE4QjtBQUFBLEVBQ2xDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0Y7QUFFQSxJQUFNLFdBQVcsSUFBSSxJQUFJLFdBQVcsSUFBSSxDQUFDLE1BQU0sQ0FBQyxFQUFFLFVBQVUsQ0FBQyxDQUFDLENBQUM7QUFFeEQsSUFBTSxrQkFBa0IsV0FBVyxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVE7QUFFeEQsU0FBUyxhQUFhLFVBQWlDO0FBQzVELFFBQU0sWUFBWSxTQUFTLElBQUksUUFBUTtBQUN2QyxNQUFJLENBQUMsV0FBVztBQUNkLFVBQU0sSUFBSSxNQUFNLDJCQUEyQixRQUFRLEVBQUU7QUFBQSxFQUN2RDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsYUFBYSxLQUFzQztBQUNqRSxTQUFPLGFBQWEsSUFBSSxLQUFLLFNBQVMsRUFBRSxTQUFTLEdBQUc7QUFDdEQ7OztBQzlVQSxTQUFTLFVBQWEsT0FBbUI7QUFDdkMsTUFBSSxPQUFPLFVBQVUsVUFBVTtBQUM3QixRQUFJO0FBQ0YsYUFBTyxLQUFLLE1BQU0sS0FBSztBQUFBLElBQ3pCLFFBQVE7QUFDTixhQUFPLENBQUM7QUFBQSxJQUNWO0FBQUEsRUFDRjtBQUNBLFNBQVEsU0FBUyxDQUFDO0FBQ3BCO0FBRUEsZUFBc0IsZUFDcEJDLEtBQ0EsUUFDcUI7QUFDckIsU0FBTyxNQUFNQSxJQUNWLFdBQVcsWUFBWSxFQUN2QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixRQUFRO0FBQ2I7QUFFQSxlQUFzQixtQkFDcEJBLEtBQ0EsUUFDQSxNQUNBLElBQ3NCO0FBQ3RCLE1BQUksUUFBUUEsSUFDVCxXQUFXLGFBQWEsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVO0FBRWIsTUFBSSxNQUFNO0FBQ1IsVUFBTSxXQUFXLE9BQU8sU0FBUyxXQUFXLElBQUksS0FBSyxJQUFJLElBQUk7QUFDN0QsWUFBUSxNQUFNLE1BQU0sZUFBZSxNQUFNLFFBQWlCO0FBQUEsRUFDNUQ7QUFDQSxNQUFJLElBQUk7QUFDTixVQUFNLFNBQVMsT0FBTyxPQUFPLFdBQVcsSUFBSSxLQUFLLEVBQUUsSUFBSTtBQUN2RCxZQUFRLE1BQU0sTUFBTSxlQUFlLEtBQUssTUFBZTtBQUFBLEVBQ3pEO0FBRUEsU0FBTyxNQUFNLE1BQU0sUUFBUTtBQUM3QjtBQUVBLGVBQWUseUJBQ2JBLEtBQ0EsT0FDQSxRQUNtQjtBQUNuQixRQUFNLFdBQVcsTUFDZCxPQUFPLENBQUMsTUFBTSxFQUFFLGNBQWMsV0FBVyxFQUFFLFlBQVksSUFBSSxFQUMzRCxJQUFJLENBQUMsTUFBTSxFQUFFLFFBQVM7QUFDekIsTUFBSSxTQUFTLFdBQVcsRUFBRyxRQUFPLENBQUM7QUFFbkMsUUFBTSxPQUFPLE1BQU1BLElBQ2hCLFdBQVcsWUFBWSxFQUN2QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sWUFBWSxNQUFNLFFBQVEsRUFDaEMsT0FBTyxJQUFJLEVBQ1gsUUFBUTtBQUNYLFNBQU8sS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUU7QUFDN0I7QUFFQSxlQUFlLGlCQUNiQSxLQUNBLFFBQzJFO0FBQzNFLFFBQU0sT0FBTyxNQUFNQSxJQUNoQixXQUFXLG1CQUFtQixFQUM5QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixRQUFRO0FBRVgsUUFBTSxTQUFTLG9CQUFJLElBQXVCO0FBQzFDLFFBQU0sVUFBVSxvQkFBSSxJQUFvQjtBQUV4QyxhQUFXLE9BQU8sTUFBTTtBQUN0QixZQUFRLElBQUksSUFBSSxvQkFBb0IsT0FBTyxJQUFJLE1BQU0sQ0FBQztBQUN0RCxVQUFNLFFBQVEsTUFBTUEsSUFDakIsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLElBQUksa0JBQWtCLEVBQzVDLE1BQU0sVUFBVSxLQUFLLFFBQVEsRUFDN0IsUUFBUSxlQUFlLE1BQU0sRUFDN0IsVUFBVSxFQUNWLGlCQUFpQjtBQUVwQixRQUFJLE9BQU87QUFDVCxhQUFPLElBQUksSUFBSSxvQkFBb0IsS0FBSztBQUN4QztBQUFBLElBQ0Y7QUFFQSxVQUFNLFNBQVMsTUFBTUEsSUFDbEIsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLElBQUksa0JBQWtCLEVBQzVDLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsUUFBSSxPQUFRLFFBQU8sSUFBSSxJQUFJLG9CQUFvQixNQUFNO0FBQUEsRUFDdkQ7QUFFQSxTQUFPLEVBQUUsUUFBUSxRQUFRO0FBQzNCO0FBT08sU0FBUyx5QkFDZCxNQUNTO0FBQ1QsU0FBTyxLQUFLLGNBQWM7QUFDNUI7QUFRQSxlQUFzQixlQUNwQkEsS0FDQSxNQUNBLE9BQ0EsTUFBWSxvQkFBSSxLQUFLLEdBQ0Q7QUFDcEIsTUFBSSxNQUFNLFdBQVcsWUFBWSxDQUFDLGdCQUFnQixPQUFPLEdBQUcsR0FBRztBQUM3RCxRQUFJLE9BQU8sTUFBTSxhQUFhLE1BQU0sRUFBRyxRQUFPO0FBQzlDLFVBQU0sVUFBVSxJQUFJLFlBQVk7QUFDaEMsV0FBTyxNQUFNQSxJQUNWLFlBQVksYUFBYSxFQUN6QixJQUFJLEVBQUUsZUFBZSxHQUFHLFlBQVksUUFBUSxDQUFDLEVBQzdDLE1BQU0sTUFBTSxLQUFLLE1BQU0sRUFBRSxFQUN6QixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsRUFDN0I7QUFFQSxRQUFNLFFBQVEsTUFBTSxlQUFlQSxLQUFJLEtBQUssRUFBRTtBQUM5QyxRQUFNLFNBQVMsTUFBTTtBQUFBLElBQ25CQTtBQUFBLElBQ0EsS0FBSztBQUFBLElBQ0wsTUFBTTtBQUFBLElBQ04sTUFBTSxXQUFXO0FBQUEsRUFDbkI7QUFDQSxRQUFNLG1CQUFtQixNQUFNO0FBQUEsSUFDN0JBO0FBQUEsSUFDQTtBQUFBLElBQ0EsS0FBSztBQUFBLEVBQ1A7QUFDQSxRQUFNLEVBQUUsUUFBUSxhQUFhLFNBQVMsYUFBYSxJQUNqRCxLQUFLLGNBQWMsY0FDZixNQUFNLGlCQUFpQkEsS0FBSSxLQUFLLEVBQUUsSUFDbEM7QUFBQSxJQUNFLFFBQVEsb0JBQUksSUFBdUI7QUFBQSxJQUNuQyxTQUFTLG9CQUFJLElBQW9CO0FBQUEsRUFDbkM7QUFFTixRQUFNLEVBQUUsY0FBYyxLQUFLLElBQUksYUFBYTtBQUFBLElBQzFDLE1BQU07QUFBQSxNQUNKLEdBQUc7QUFBQSxNQUNILFFBQVEsVUFBVSxLQUFLLE1BQU07QUFBQSxJQUMvQjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0YsQ0FBQztBQUVELFFBQU0sU0FBUyxJQUFJLFlBQVk7QUFDL0IsTUFBSSxTQUFTLE1BQU07QUFJbkIsTUFDRSxNQUFNLFdBQVcsWUFDakIsUUFDQSx5QkFBeUIsSUFBSSxHQUM3QjtBQUNBLGFBQVM7QUFBQSxFQUNYO0FBRUEsUUFBTSxVQUFVLE1BQU1BLElBQ25CLFlBQVksYUFBYSxFQUN6QixJQUFJO0FBQUEsSUFDSCxlQUFlO0FBQUEsSUFDZjtBQUFBLElBQ0EsWUFBWTtBQUFBLEVBQ2QsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLE1BQU0sRUFBRSxFQUN6QixhQUFhLEVBQ2Isd0JBQXdCO0FBRzNCLFFBQU0sT0FBTyxPQUFPLE1BQU0sR0FBRyxFQUFFO0FBQy9CLFFBQU1BLElBQ0gsV0FBVyx5QkFBeUIsRUFDcEMsT0FBTztBQUFBLElBQ04sZUFBZSxRQUFRO0FBQUEsSUFDdkIsT0FBTztBQUFBLElBQ1AsT0FBTztBQUFBLEVBQ1QsQ0FBQyxFQUNBO0FBQUEsSUFBVyxDQUFDLE9BQ1gsR0FBRyxRQUFRLENBQUMsaUJBQWlCLE9BQU8sQ0FBQyxFQUFFLFlBQVk7QUFBQSxNQUNqRCxPQUFPO0FBQUEsSUFDVCxDQUFDO0FBQUEsRUFDSCxFQUNDLFFBQVE7QUFHWCxNQUFJLFdBQVcsZUFBZSxDQUFDLEtBQUssY0FBYyxLQUFLLFdBQVcsVUFBVTtBQUMxRSxVQUFNQSxJQUNILFlBQVksT0FBTyxFQUNuQixJQUFJLEVBQUUsUUFBUSxhQUFhLFlBQVksT0FBTyxDQUFDLEVBQy9DLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixRQUFRO0FBQUEsRUFDYjtBQUdBLE1BQUksV0FBVyxlQUFlLE1BQU0sV0FBVyxhQUFhO0FBQzFELFVBQU0sRUFBRSxpQ0FBQUMsaUNBQWdDLElBQUksTUFBTTtBQUdsRCxVQUFNQSxpQ0FBZ0NELEtBQUk7QUFBQSxNQUN4QyxRQUFRLEtBQUs7QUFBQSxNQUNiLFFBQVEsS0FBSztBQUFBLE1BQ2IsU0FBUyxRQUFRO0FBQUEsSUFDbkIsQ0FBQztBQUFBLEVBQ0g7QUFFQSxTQUFPO0FBQ1Q7QUFHQSxlQUFzQix3QkFDcEJBLEtBQ0EsUUFDQSxNQUNlO0FBQ2YsUUFBTSxVQUFVLG9CQUFJLElBQVk7QUFFaEMsTUFBSSxLQUFLLGNBQWMsTUFBTTtBQUMzQixVQUFNLE9BQU8sTUFBTUEsSUFDaEIsV0FBVyxZQUFZLEVBQ3ZCLFVBQVUsU0FBUyxZQUFZLG9CQUFvQixFQUNuRCxNQUFNLGlCQUFpQixLQUFLLE1BQU0sRUFDbEMsTUFBTSwwQkFBMEIsS0FBSyxLQUFLLFVBQVUsRUFDcEQsT0FBTyxvQkFBb0IsRUFDM0IsUUFBUTtBQUNYLGVBQVcsS0FBSyxLQUFNLFNBQVEsSUFBSSxFQUFFLE9BQU87QUFBQSxFQUM3QztBQUVBLE1BQUksS0FBSyxXQUFXLE1BQU07QUFDeEIsVUFBTSxPQUFPLE1BQU1BLElBQ2hCLFdBQVcsWUFBWSxFQUN2QixVQUFVLFNBQVMsWUFBWSxvQkFBb0IsRUFDbkQsTUFBTSxpQkFBaUIsS0FBSyxNQUFNLEVBQ2xDLE1BQU0sdUJBQXVCLEtBQUssS0FBSyxPQUFPLEVBQzlDLE9BQU8sb0JBQW9CLEVBQzNCLFFBQVE7QUFDWCxlQUFXLEtBQUssS0FBTSxTQUFRLElBQUksRUFBRSxPQUFPO0FBQUEsRUFDN0M7QUFHQSxNQUFJLFFBQVEsT0FBTyxHQUFHO0FBQ3BCLFVBQU0sT0FBTyxNQUFNQSxJQUNoQixXQUFXLG1CQUFtQixFQUM5QixNQUFNLHNCQUFzQixNQUFNLENBQUMsR0FBRyxPQUFPLENBQUMsRUFDOUMsT0FBTyxTQUFTLEVBQ2hCLFFBQVE7QUFDWCxlQUFXLEtBQUssS0FBTSxTQUFRLElBQUksRUFBRSxPQUFPO0FBQUEsRUFDN0M7QUFFQSxhQUFXLFVBQVUsU0FBUztBQUM1QixVQUFNLE9BQU8sTUFBTUEsSUFDaEIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sTUFBTSxLQUFLLE1BQU0sRUFDdkIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFFBQUksQ0FBQyxRQUFRLEtBQUssV0FBVyxZQUFZLEtBQUssV0FBVztBQUN2RDtBQUVGLFVBQU0sUUFBUSxNQUFNQSxJQUNqQixXQUFXLGFBQWEsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsUUFBSSxDQUFDLE1BQU87QUFFWixVQUFNLGVBQWVBLEtBQUksTUFBTSxLQUFLO0FBQUEsRUFDdEM7QUFDRjtBQUdBLGVBQXNCLHlCQUNwQkEsS0FDQSxRQUNpQjtBQUNqQixRQUFNLFFBQVEsTUFBTUEsSUFDakIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxVQUFVLE1BQU0sQ0FBQyxVQUFVLGFBQWEsUUFBUSxDQUFDLEVBQ3ZELFVBQVUsRUFDVixRQUFRO0FBRVgsTUFBSSxRQUFRO0FBQ1osYUFBVyxRQUFRLE9BQU87QUFDeEIsVUFBTSxTQUFTLE1BQU1BLElBQ2xCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsTUFBTSxVQUFVLEtBQUssUUFBUSxFQUM3QixVQUFVLEVBQ1YsUUFBUTtBQUNYLGVBQVcsU0FBUyxRQUFRO0FBQzFCLFlBQU0sZUFBZUEsS0FBSSxNQUFNLEtBQUs7QUFDcEM7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDs7O0FDN1VPLElBQU0sc0JBQXNCO0FBQUEsRUFDakM7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUNGO0FBSUEsSUFBTSxlQUFlO0FBRWQsU0FBUyxvQkFBb0IsT0FBb0M7QUFDdEUsTUFBSSxDQUFDLGFBQWEsS0FBSyxLQUFLLEVBQUcsUUFBTztBQUN0QyxRQUFNLGFBQWEsTUFBTSxZQUFZO0FBQ3JDLFNBQVEsb0JBQTBDO0FBQUEsSUFDaEQsQ0FBQyxNQUFNLEVBQUUsWUFBWSxNQUFNO0FBQUEsRUFDN0I7QUFDRjtBQUdPLFNBQVMsb0JBQW9CLE9BQTJCO0FBQzdELFFBQU0sUUFBUyxvQkFBMEM7QUFBQSxJQUN2RCxDQUFDLE1BQU0sRUFBRSxZQUFZLE1BQU0sTUFBTSxZQUFZO0FBQUEsRUFDL0M7QUFDQSxNQUFJLENBQUMsT0FBTztBQUNWLFVBQU0sSUFBSSxNQUFNLHdCQUF3QixLQUFLLEVBQUU7QUFBQSxFQUNqRDtBQUNBLFNBQU87QUFDVDs7O0FDMUJPLElBQU0sK0JBQU4sY0FBMkMsTUFBTTtBQUFDO0FBQ2xELElBQU0sb0JBQU4sY0FBZ0MsTUFBTTtBQUFDO0FBQ3ZDLElBQU0seUJBQU4sY0FBcUMsTUFBTTtBQUFDO0FBQzVDLElBQU0sbUJBQU4sY0FBK0IsTUFBTTtBQUFDO0FBY3RDLFNBQVMseUJBQXlCLE9BQStCO0FBQ3RFLE1BQUksQ0FBQyxNQUFNLGFBQWE7QUFDdEIsUUFBSSxDQUFDLE1BQU0sTUFBTTtBQUNmLFlBQU0sSUFBSTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBO0FBQUEsRUFDRjtBQUVBLE1BQUksQ0FBQyxNQUFNLG1CQUFtQjtBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLEVBQUUsZ0JBQWdCLFFBQUFFLFFBQU8sSUFBSSxNQUFNO0FBQ3pDLE1BQUksQ0FBQ0EsV0FBVSxDQUFDQSxRQUFPLFlBQVk7QUFDakMsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsVUFBUSxnQkFBZ0I7QUFBQSxJQUN0QixLQUFLO0FBQ0gseUJBQW1CQSxRQUFPLFlBQVk7QUFDdEM7QUFBQSxJQUNGLEtBQUs7QUFDSCwwQkFBb0JBLFFBQU8sZUFBZUEsUUFBTyxvQkFBb0I7QUFDckU7QUFBQSxJQUNGLEtBQUs7QUFDSCwyQkFBcUJBLFFBQU8sYUFBYTtBQUN6QztBQUFBLElBQ0Y7QUFDRSxZQUFNLElBQUk7QUFBQSxRQUNSLCtCQUErQixjQUFjO0FBQUEsTUFDL0M7QUFBQSxFQUNKO0FBQ0Y7QUFNTyxTQUFTLG1CQUFtQixPQUF1QjtBQUN4RCxNQUFJLENBQUMsb0JBQW9CLEtBQUssR0FBRztBQUMvQixVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLG9CQUFvQixLQUFLO0FBQ2xDO0FBS08sU0FBUyxrQkFBa0IsTUFBc0I7QUFDdEQsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixNQUFJLENBQUMsU0FBUztBQUNaLFVBQU0sSUFBSSxrQkFBa0Isa0JBQWtCO0FBQUEsRUFDaEQ7QUFDQSxNQUFJLFFBQVEsU0FBUyxLQUFLO0FBQ3hCLFVBQU0sSUFBSSxrQkFBa0IscUNBQXFDO0FBQUEsRUFDbkU7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxJQUFNLFVBQVU7QUFDaEIsSUFBTSxVQUFVO0FBRVQsU0FBUyx1QkFBdUIsTUFBc0I7QUFDM0QsTUFBSSxDQUFDLFFBQVEsS0FBSyxJQUFJLEdBQUc7QUFDdkIsVUFBTSxJQUFJLHVCQUF1QixtQ0FBbUM7QUFBQSxFQUN0RTtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsd0JBQXdCLE9BQWlEO0FBQ3ZGLE1BQUksVUFBVSxVQUFhLFVBQVUsS0FBTSxRQUFPO0FBQ2xELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxLQUFLLFFBQVEsS0FBSyxDQUFDLE9BQU8sVUFBVSxLQUFLLEdBQUc7QUFDcEUsVUFBTSxJQUFJLHVCQUF1QixnREFBZ0Q7QUFBQSxFQUNuRjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMseUJBQXlCLE9BQXVCO0FBQzlELE1BQUksQ0FBQyxPQUFPLFNBQVMsS0FBSyxLQUFLLFNBQVMsS0FBSyxDQUFDLE9BQU8sVUFBVSxLQUFLLEdBQUc7QUFDckUsVUFBTSxJQUFJLHVCQUF1Qiw0Q0FBNEM7QUFBQSxFQUMvRTtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsbUJBQW1CLFlBQW9EO0FBQzlFLE1BQUksQ0FBQyxjQUFjLFdBQVcsV0FBVyxHQUFHO0FBQzFDLFVBQU0sSUFBSTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNBLE1BQUksV0FBVyxLQUFLLENBQUMsUUFBUSxDQUFDLE9BQU8sVUFBVSxHQUFHLEtBQUssTUFBTSxLQUFLLE1BQU0sQ0FBQyxHQUFHO0FBQzFFLFVBQU0sSUFBSTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxvQkFDUCxhQUNBLGtCQUNNO0FBQ04sUUFBTSxpQkFBaUIsQ0FBQyxDQUFDLGVBQWUsWUFBWSxTQUFTO0FBQzdELE1BQUksQ0FBQyxrQkFBa0IsQ0FBQyxrQkFBa0I7QUFDeEMsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsTUFDRSxrQkFDQSxZQUFhLEtBQUssQ0FBQyxRQUFRLENBQUMsT0FBTyxVQUFVLEdBQUcsS0FBSyxNQUFNLEtBQUssTUFBTSxFQUFFLEdBQ3hFO0FBQ0EsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLHFCQUFxQixjQUF1RDtBQUNuRixNQUNFLGlCQUFpQixVQUNqQixpQkFBaUIsUUFDakIsQ0FBQyxPQUFPLFVBQVUsWUFBWSxLQUM5QixlQUFlLEdBQ2Y7QUFDQSxVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVPLFNBQVMsa0JBQWtCLE9BQXVCO0FBQ3ZELFFBQU0sVUFBVSxNQUFNLEtBQUs7QUFDM0IsTUFBSSxDQUFDLFFBQVMsT0FBTSxJQUFJLGlCQUFpQixtQkFBbUI7QUFDNUQsTUFBSSxRQUFRLFNBQVMsSUFBSyxPQUFNLElBQUksaUJBQWlCLHNDQUFzQztBQUMzRixTQUFPO0FBQ1Q7QUFFTyxTQUFTLGtCQUFrQixPQUF1QjtBQUN2RCxTQUFPLG1CQUFtQixLQUFLO0FBQ2pDO0FBRU8sU0FBUyxpQkFBaUIsVUFBMEI7QUFDekQsTUFBSSxDQUFDLGdCQUFnQixTQUFTLFFBQVEsR0FBRztBQUN2QyxVQUFNLElBQUk7QUFBQSxNQUNSLDRCQUE0QixnQkFBZ0IsS0FBSyxJQUFJLENBQUM7QUFBQSxJQUN4RDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLG9CQUFvQixPQUF1QjtBQUN6RCxNQUFJLENBQUMsT0FBTyxTQUFTLEtBQUssS0FBSyxTQUFTLEdBQUc7QUFDekMsVUFBTSxJQUFJLGlCQUFpQix1Q0FBdUM7QUFBQSxFQUNwRTtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsa0JBQ2QsT0FDQSxVQUNpQjtBQUNqQixRQUFNLE9BQU8sU0FBUyxDQUFDO0FBQ3ZCLE1BQUksYUFBYSxhQUFhO0FBQzVCLFFBQUksS0FBSyxTQUFTLEdBQUc7QUFDbkIsWUFBTSxJQUFJLGlCQUFpQixvREFBb0Q7QUFBQSxJQUNqRjtBQUNBLFdBQU8sQ0FBQztBQUFBLEVBQ1Y7QUFDQSxNQUFJLEtBQUssV0FBVyxHQUFHO0FBQ3JCLFVBQU0sSUFBSSxpQkFBaUIsK0JBQStCO0FBQUEsRUFDNUQ7QUFDQSxhQUFXLFFBQVEsTUFBTTtBQUN2QixRQUFJLEtBQUssYUFBYSxZQUFZO0FBQ2hDLFVBQUksS0FBSyxjQUFjLE1BQU07QUFDM0IsY0FBTSxJQUFJLGlCQUFpQixtQ0FBbUM7QUFBQSxNQUNoRTtBQUNBLFVBQUksS0FBSyxXQUFXLE1BQU07QUFDeEIsY0FBTSxJQUFJLGlCQUFpQixxQ0FBcUM7QUFBQSxNQUNsRTtBQUFBLElBQ0YsV0FBVyxLQUFLLGFBQWEsU0FBUztBQUNwQyxVQUFJLEtBQUssV0FBVyxNQUFNO0FBQ3hCLGNBQU0sSUFBSSxpQkFBaUIsNkJBQTZCO0FBQUEsTUFDMUQ7QUFDQSxVQUFJLEtBQUssY0FBYyxNQUFNO0FBQzNCLGNBQU0sSUFBSSxpQkFBaUIscUNBQXFDO0FBQUEsTUFDbEU7QUFBQSxJQUNGLE9BQU87QUFDTCxZQUFNLElBQUksaUJBQWlCLG9DQUFvQztBQUFBLElBQ2pFO0FBQ0EsUUFBSSxLQUFLLFVBQVUsU0FBUyxDQUFDLE9BQU8sU0FBUyxLQUFLLE1BQU0sS0FBSyxLQUFLLFVBQVUsSUFBSTtBQUM5RSxZQUFNLElBQUksaUJBQWlCLHVDQUF1QztBQUFBLElBQ3BFO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMseUJBQ2QsTUFDQSxVQUN1QjtBQUN2QixRQUFNLE9BQU8sUUFBUSxDQUFDO0FBQ3RCLE1BQUksYUFBYSxlQUFlLEtBQUssV0FBVyxHQUFHO0FBQ2pELFVBQU0sSUFBSSxpQkFBaUIsaURBQWlEO0FBQUEsRUFDOUU7QUFDQSxhQUFXLE9BQU8sTUFBTTtBQUN0QixRQUFJLENBQUMsT0FBTyxVQUFVLElBQUksZUFBZSxLQUFLLElBQUksbUJBQW1CLEdBQUc7QUFDdEUsWUFBTSxJQUFJLGlCQUFpQiw0Q0FBNEM7QUFBQSxJQUN6RTtBQUNBLFFBQ0UsSUFBSSxlQUFlLFFBQ25CLElBQUksZ0JBQWdCLGNBQ3BCLElBQUksZ0JBQWdCLFlBQ3BCO0FBQ0EsWUFBTSxJQUFJLGlCQUFpQiwwQ0FBMEM7QUFBQSxJQUN2RTtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLHVCQUNkLFlBQzRCO0FBQzVCLE1BQUksY0FBYyxLQUFNLFFBQU87QUFDL0IsUUFBTSxVQUFVLENBQUMsVUFBVSxXQUFXLGFBQWEsY0FBYztBQUNqRSxNQUFJLENBQUMsUUFBUSxTQUFTLFdBQVcsTUFBTSxHQUFHO0FBQ3hDLFVBQU0sSUFBSSxpQkFBaUIsa0NBQWtDLFdBQVcsTUFBTSxFQUFFO0FBQUEsRUFDbEY7QUFDQSxNQUNFLFdBQVcsWUFBWSxTQUN0QixDQUFDLE9BQU8sVUFBVSxXQUFXLFFBQVEsS0FBSyxXQUFXLFdBQVcsSUFDakU7QUFDQSxVQUFNLElBQUksaUJBQWlCLDZDQUE2QztBQUFBLEVBQzFFO0FBQ0EsTUFDRSxXQUFXLGFBQWEsUUFDeEIsV0FBVyxjQUFjLFVBQ3pCLFdBQVcsY0FBYyxZQUN6QjtBQUNBLFVBQU0sSUFBSSxpQkFBaUIsb0NBQW9DO0FBQUEsRUFDakU7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLHFCQUNkLFVBQzBCO0FBQzFCLE1BQUksWUFBWSxLQUFNLFFBQU87QUFDN0IsTUFBSSxTQUFTLFNBQVMsWUFBWTtBQUNoQyxRQUFJLENBQUMsU0FBUyxRQUFRLENBQUMsUUFBUSxLQUFLLFNBQVMsSUFBSSxHQUFHO0FBQ2xELFlBQU0sSUFBSSxpQkFBaUIsNENBQTRDO0FBQUEsSUFDekU7QUFBQSxFQUNGLFdBQVcsU0FBUyxTQUFTLFlBQVk7QUFDdkMsUUFDRSxTQUFTLHVCQUF1QixRQUNoQyxDQUFDLE9BQU8sVUFBVSxTQUFTLG1CQUFtQixLQUM5QyxTQUFTLHNCQUFzQixHQUMvQjtBQUNBLFlBQU0sSUFBSTtBQUFBLFFBQ1I7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0YsT0FBTztBQUNMLFVBQU0sSUFBSSxpQkFBaUIsNENBQTRDO0FBQUEsRUFDekU7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxJQUFNLHdCQUF3QjtBQUd2QixTQUFTLGlCQUNkLFVBQ0EsTUFBWSxvQkFBSSxLQUFLLEdBQ1I7QUFDYixNQUFJLFlBQVksUUFBUSxhQUFhLEdBQUksUUFBTztBQUNoRCxRQUFNLFNBQVMsSUFBSSxLQUFLLFFBQVE7QUFDaEMsTUFBSSxPQUFPLE1BQU0sT0FBTyxRQUFRLENBQUMsR0FBRztBQUNsQyxVQUFNLElBQUksaUJBQWlCLDRDQUE0QztBQUFBLEVBQ3pFO0FBQ0EsUUFBTSxNQUFNLElBQUksS0FBSyxHQUFHO0FBQ3hCLE1BQUksZUFBZSxJQUFJLGVBQWUsSUFBSSxxQkFBcUI7QUFDL0QsTUFBSSxTQUFTLEtBQUs7QUFDaEIsVUFBTSxJQUFJO0FBQUEsTUFDUiwyQkFBMkIscUJBQXFCO0FBQUEsSUFDbEQ7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBR08sU0FBUyx5QkFDZCxVQUNBLFVBQ007QUFDTixNQUFJLENBQUMsWUFBWSxTQUFTLFNBQVMsY0FBYyxDQUFDLFNBQVMsS0FBTTtBQUNqRSxRQUFNLGFBQWEsb0JBQUksS0FBSyxTQUFTLE9BQU8sZ0JBQWdCO0FBQzVELE1BQUksYUFBYSxVQUFVO0FBQ3pCLFVBQU0sSUFBSSxpQkFBaUIsNkNBQTZDO0FBQUEsRUFDMUU7QUFDRjtBQUVPLFNBQVMsd0JBQ2QsT0FDQSxNQUFZLG9CQUFJLEtBQUssR0FDckI7QUFDQSxRQUFNLFFBQVEsa0JBQWtCLE1BQU0sS0FBSztBQUMzQyxRQUFNLFFBQVEsa0JBQWtCLE1BQU0sS0FBSztBQUMzQyxRQUFNLFdBQVcsaUJBQWlCLE1BQU0sUUFBUTtBQUNoRCxRQUFNLGNBQWMsb0JBQW9CLE1BQU0sV0FBVztBQUN6RCxNQUFJLE1BQU0sV0FBVyxXQUFXLE1BQU0sV0FBVyxZQUFZO0FBQzNELFVBQU0sSUFBSSxpQkFBaUIsa0NBQWtDO0FBQUEsRUFDL0Q7QUFDQSxRQUFNLFFBQVEsa0JBQWtCLE1BQU0sT0FBTyxRQUFRO0FBQ3JELFFBQU0sZUFBZSx5QkFBeUIsTUFBTSxjQUFjLFFBQVE7QUFDMUUsUUFBTSxhQUFhLHVCQUF1QixNQUFNLFVBQVU7QUFDMUQsUUFBTSxXQUFXLHFCQUFxQixNQUFNLFFBQVE7QUFDcEQsUUFBTSxXQUFXLGlCQUFpQixNQUFNLFVBQVUsR0FBRyxLQUFLO0FBQzFELDJCQUF5QixVQUFVLFFBQVE7QUFFM0MsTUFBSSxNQUFNLFFBQVEsY0FBYyxDQUFDLFFBQVEsS0FBSyxNQUFNLE9BQU8sVUFBVSxHQUFHO0FBQ3RFLFVBQU0sSUFBSSxpQkFBaUIsMEJBQTBCO0FBQUEsRUFDdkQ7QUFDQSxNQUFJLE1BQU0sUUFBUSxhQUFhLENBQUMsUUFBUSxLQUFLLE1BQU0sT0FBTyxTQUFTLEdBQUc7QUFDcEUsVUFBTSxJQUFJLGlCQUFpQix5QkFBeUI7QUFBQSxFQUN0RDtBQUVBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7QUFFTyxTQUFTLHdCQUNkLE9BQ0Esa0JBQ0EsTUFBWSxvQkFBSSxLQUFLLEdBQ3JCO0FBQ0EsUUFBTSxXQUFXLE1BQU0sWUFBWSxPQUMvQixpQkFBaUIsTUFBTSxRQUFRLElBQy9CO0FBRUosTUFBSSxNQUFNLFNBQVMsS0FBTSxtQkFBa0IsTUFBTSxLQUFLO0FBQ3RELE1BQUksTUFBTSxTQUFTLEtBQU0sbUJBQWtCLE1BQU0sS0FBSztBQUN0RCxNQUFJLE1BQU0sZUFBZSxLQUFNLHFCQUFvQixNQUFNLFdBQVc7QUFDcEUsTUFBSSxNQUFNLFVBQVUsUUFBUSxNQUFNLFdBQVcsV0FBVyxNQUFNLFdBQVcsWUFBWTtBQUNuRixVQUFNLElBQUksaUJBQWlCLGtDQUFrQztBQUFBLEVBQy9EO0FBQ0EsTUFBSSxNQUFNLFVBQVUsTUFBTTtBQUN4QixVQUFNLFVBQVUsQ0FBQyxVQUFVLFVBQVUsYUFBYSxZQUFZLFFBQVE7QUFDdEUsUUFBSSxDQUFDLFFBQVEsU0FBUyxNQUFNLE1BQU0sR0FBRztBQUNuQyxZQUFNLElBQUksaUJBQWlCLG1CQUFtQixNQUFNLE1BQU0sRUFBRTtBQUFBLElBQzlEO0FBQUEsRUFDRjtBQUVBLFFBQU0sUUFBUSxNQUFNLFVBQVUsU0FDMUIsa0JBQWtCLE1BQU0sT0FBTyxRQUFRLElBQ3ZDO0FBQ0osUUFBTSxlQUFlLE1BQU0saUJBQWlCLFNBQ3hDLHlCQUF5QixNQUFNLGNBQWMsUUFBUSxJQUNyRDtBQUNKLFFBQU0sYUFBYSxNQUFNLGVBQWUsU0FDcEMsdUJBQXVCLE1BQU0sVUFBVSxJQUN2QztBQUNKLFFBQU0sV0FBVyxNQUFNLGFBQWEsU0FDaEMscUJBQXFCLE1BQU0sUUFBUSxJQUNuQztBQUNKLFFBQU0sV0FBVyxNQUFNLGFBQWEsU0FDaEMsaUJBQWlCLE1BQU0sVUFBVSxHQUFHLElBQ3BDO0FBRUosU0FBTyxFQUFFLFVBQVUsT0FBTyxjQUFjLFlBQVksVUFBVSxTQUFTO0FBQ3pFO0FBTU8sU0FBUywyQkFDZCxPQUNBLFNBQ1M7QUFDVCxRQUFNLFdBQVcsb0JBQUksSUFBWTtBQUNqQyxRQUFNLFVBQVUsb0JBQUksSUFBWTtBQUVoQyxXQUFTLElBQUksTUFBdUI7QUFDbEMsUUFBSSxTQUFTLElBQUksSUFBSSxFQUFHLFFBQU87QUFDL0IsUUFBSSxRQUFRLElBQUksSUFBSSxFQUFHLFFBQU87QUFDOUIsYUFBUyxJQUFJLElBQUk7QUFDakIsZUFBVyxRQUFRLE1BQU0sSUFBSSxJQUFJLEtBQUssQ0FBQyxHQUFHO0FBQ3hDLFVBQUksSUFBSSxJQUFJLEVBQUcsUUFBTztBQUFBLElBQ3hCO0FBQ0EsYUFBUyxPQUFPLElBQUk7QUFDcEIsWUFBUSxJQUFJLElBQUk7QUFDaEIsV0FBTztBQUFBLEVBQ1Q7QUFFQSxTQUFPLElBQUksT0FBTztBQUNwQjs7O0FDdGJPLElBQU0sa0NBQWtDO0FBQ3hDLElBQU0sMkJBQTJCO0FBTWpDLFNBQVMsNkJBQ2QsU0FDVTtBQUNWLE1BQUksV0FBVyxLQUFNLFFBQU8sQ0FBQztBQUU3QixNQUFJLFFBQVEsU0FBUywwQkFBMEI7QUFDN0MsVUFBTSxJQUFJO0FBQUEsTUFDUix5Q0FBeUMsd0JBQXdCO0FBQUEsSUFDbkU7QUFBQSxFQUNGO0FBRUEsUUFBTSxPQUFPLG9CQUFJLElBQVk7QUFDN0IsUUFBTUMsVUFBbUIsQ0FBQztBQUUxQixhQUFXLE9BQU8sU0FBUztBQUN6QixRQUFJLE9BQU8sUUFBUSxZQUFZLENBQUMsT0FBTyxTQUFTLEdBQUcsS0FBSyxDQUFDLE9BQU8sVUFBVSxHQUFHLEdBQUc7QUFDOUUsWUFBTSxJQUFJO0FBQUEsUUFDUjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLEtBQUssTUFBTSxpQ0FBaUM7QUFDcEQsWUFBTSxJQUFJO0FBQUEsUUFDUiw2Q0FBNkMsK0JBQStCO0FBQUEsTUFDOUU7QUFBQSxJQUNGO0FBQ0EsUUFBSSxLQUFLLElBQUksR0FBRyxFQUFHO0FBQ25CLFNBQUssSUFBSSxHQUFHO0FBQ1osSUFBQUEsUUFBTyxLQUFLLEdBQUc7QUFBQSxFQUNqQjtBQUVBLEVBQUFBLFFBQU8sS0FBSyxDQUFDLEdBQUcsTUFBTSxJQUFJLENBQUM7QUFDM0IsU0FBT0E7QUFDVDs7O0FDekNPLFNBQVMsU0FBUyxPQUFnQixXQUFXLEdBQVc7QUFDN0QsTUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixRQUFNLElBQUksT0FBTyxVQUFVLFdBQVcsUUFBUSxPQUFPLEtBQUs7QUFDMUQsU0FBTyxPQUFPLFNBQVMsQ0FBQyxJQUFJLElBQUk7QUFDbEM7QUFFTyxTQUFTLGVBQWUsT0FBK0I7QUFDNUQsTUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixRQUFNLElBQUksT0FBTyxVQUFVLFdBQVcsUUFBUSxPQUFPLEtBQUs7QUFDMUQsU0FBTyxPQUFPLFNBQVMsQ0FBQyxJQUFJLElBQUk7QUFDbEM7OztBQ1ZBLFNBQVMsa0JBQWtCOzs7QUNtQjNCLFNBQVNDLFdBQWEsT0FBMEI7QUFDOUMsTUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFFBQUk7QUFDRixhQUFPLEtBQUssTUFBTSxLQUFLO0FBQUEsSUFDekIsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsUUFBUSxNQUFZLE1BQW9CO0FBQy9DLFFBQU0sSUFBSSxJQUFJLEtBQUssSUFBSTtBQUN2QixJQUFFLFdBQVcsRUFBRSxXQUFXLElBQUksSUFBSTtBQUNsQyxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFVBQVUsTUFBWSxRQUFzQjtBQUNuRCxRQUFNLElBQUksSUFBSSxLQUFLLElBQUk7QUFDdkIsSUFBRSxZQUFZLEVBQUUsWUFBWSxJQUFJLE1BQU07QUFDdEMsU0FBTztBQUNUO0FBRU8sU0FBUyxnQkFDZCxVQUNBLFlBQ2E7QUFDYixNQUFJLENBQUMsV0FBWSxRQUFPO0FBQ3hCLFFBQU0sV0FBVyxLQUFLLElBQUksR0FBRyxXQUFXLFlBQVksQ0FBQztBQUNyRCxVQUFRLFdBQVcsUUFBUTtBQUFBLElBQ3pCLEtBQUs7QUFDSCxhQUFPLFFBQVEsVUFBVSxJQUFJLFFBQVE7QUFBQSxJQUN2QyxLQUFLO0FBQ0gsYUFBTyxVQUFVLFVBQVUsUUFBUTtBQUFBLElBQ3JDLEtBQUs7QUFDSCxhQUFPLFVBQVUsVUFBVSxJQUFJLFFBQVE7QUFBQSxJQUN6QyxLQUFLO0FBQ0gsYUFBTyxRQUFRLFVBQVUsUUFBUTtBQUFBLElBQ25DO0FBQ0UsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQUVPLFNBQVMsa0JBQ2QsVUFDQSxVQUNhO0FBQ2IsTUFBSSxDQUFDLFNBQVUsUUFBTztBQUN0QixNQUFJLFNBQVMsU0FBUyxjQUFjLFNBQVMsTUFBTTtBQUNqRCxXQUFPLG9CQUFJLEtBQUssU0FBUyxPQUFPLGdCQUFnQjtBQUFBLEVBQ2xEO0FBQ0EsTUFBSSxTQUFTLFNBQVMsY0FBYyxTQUFTLDBCQUEwQixNQUFNO0FBQzNFLFdBQU8sUUFBUSxVQUFVLFNBQVMsc0JBQXNCO0FBQUEsRUFDMUQ7QUFDQSxTQUFPO0FBQ1Q7QUFJTyxTQUFTLGNBQ2QsT0FDQSxVQUNBLE1BQVksb0JBQUksS0FBSyxHQUNOO0FBQ2YsTUFBSSxDQUFDLE1BQU0sWUFBYSxRQUFPO0FBQy9CLFFBQU0sYUFBYSxJQUFJLEtBQUssTUFBTSxXQUFXO0FBQzdDLFFBQU0sUUFBUSxVQUFVLGNBQWM7QUFDdEMsUUFBTSxPQUFPLFVBQVUsYUFBYTtBQUNwQyxRQUFNLFdBQVcsUUFBUSxZQUFZLEtBQUs7QUFFMUMsTUFBSSxPQUFPLE1BQU0sYUFBYSxLQUFLLE9BQU8sTUFBTSxZQUFZLEdBQUc7QUFDN0QsV0FBTztBQUFBLEVBQ1Q7QUFDQSxNQUFJLE1BQU0sU0FBVSxRQUFPO0FBQzNCLE1BQUksTUFBTSxXQUFZLFFBQU87QUFDN0IsUUFBTSxZQUFZLFFBQVEsWUFBWSxDQUFDLElBQUk7QUFDM0MsTUFBSSxPQUFPLFVBQVcsUUFBTztBQUM3QixTQUFPO0FBQ1Q7QUFFQSxTQUFTLFlBQVksTUFBb0I7QUFDdkMsU0FBTyxLQUFLLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUN2QztBQUVBLGVBQWUsY0FDYkMsS0FDQSxPQUNBLE1BQ2U7QUFDZixRQUFNLFVBQVUsWUFBWSxJQUFJO0FBQ2hDLFFBQU1BLElBQ0gsV0FBVyx5QkFBeUIsRUFDcEMsT0FBTztBQUFBLElBQ04sZUFBZSxNQUFNO0FBQUEsSUFDckIsT0FBTztBQUFBLElBQ1AsT0FBTyxPQUFPLE1BQU0sYUFBYTtBQUFBLEVBQ25DLENBQUMsRUFDQTtBQUFBLElBQVcsQ0FBQyxPQUNYLEdBQUcsUUFBUSxDQUFDLGlCQUFpQixPQUFPLENBQUMsRUFBRSxZQUFZO0FBQUEsTUFDakQsT0FBTyxPQUFPLE1BQU0sYUFBYTtBQUFBLElBQ25DLENBQUM7QUFBQSxFQUNILEVBQ0MsUUFBUTtBQUNiO0FBTUEsZUFBc0IsbUJBQ3BCQSxLQUNBLE1BQ0EsTUFBWSxvQkFBSSxLQUFLLEdBQ0Q7QUFDcEIsUUFBTSxhQUFhRCxXQUFnQyxLQUFLLFVBQVU7QUFDbEUsUUFBTSxXQUFXQSxXQUE4QixLQUFLLFFBQVE7QUFDNUQsUUFBTSxXQUFXLElBQUksS0FBSyxLQUFLLFNBQVM7QUFDeEMsUUFBTSxTQUFTLGdCQUFnQixVQUFVLFVBQVU7QUFDbkQsUUFBTSxhQUFhLGtCQUFrQixVQUFVLFFBQVE7QUFFdkQsU0FBTyxNQUFNQyxJQUNWLFdBQVcsYUFBYSxFQUN4QixPQUFPO0FBQUEsSUFDTixTQUFTLEtBQUs7QUFBQSxJQUNkLGFBQWE7QUFBQSxJQUNiLFdBQVcsU0FBUyxZQUFZO0FBQUEsSUFDaEMsU0FBUyxTQUFTLE9BQU8sWUFBWSxJQUFJO0FBQUEsSUFDekMsYUFBYSxhQUFhLFdBQVcsWUFBWSxJQUFJO0FBQUEsSUFDckQsY0FBYyxPQUFPLEtBQUssWUFBWTtBQUFBLElBQ3RDLGVBQWU7QUFBQSxJQUNmLFFBQVE7QUFBQSxJQUNSLFlBQVk7QUFBQSxJQUNaLFlBQVksSUFBSSxZQUFZO0FBQUEsSUFDNUIsWUFBWSxJQUFJLFlBQVk7QUFBQSxFQUM5QixDQUFpQixFQUNoQixhQUFhLEVBQ2Isd0JBQXdCO0FBQzdCO0FBT0EsZUFBc0Isc0JBQ3BCQSxLQUNBLE1BQ0EsT0FDQSxVQUNBLE1BQVksb0JBQUksS0FBSyxHQUNEO0FBQ3BCLFFBQU0sYUFBYUQsV0FBZ0MsS0FBSyxVQUFVO0FBQ2xFLFFBQU0sV0FBV0EsV0FBOEIsS0FBSyxRQUFRO0FBQzVELFFBQU0sU0FBUyxnQkFBZ0IsVUFBVSxVQUFVO0FBQ25ELFFBQU0sYUFBYSxrQkFBa0IsVUFBVSxRQUFRO0FBRXZELFNBQU8sTUFBTUMsSUFDVixZQUFZLGFBQWEsRUFDekIsSUFBSTtBQUFBLElBQ0gsV0FBVyxTQUFTLFlBQVk7QUFBQSxJQUNoQyxTQUFTLFNBQVMsT0FBTyxZQUFZLElBQUk7QUFBQSxJQUN6QyxhQUFhLGFBQWEsV0FBVyxZQUFZLElBQUk7QUFBQSxJQUNyRCxjQUFjLE9BQU8sS0FBSyxZQUFZO0FBQUEsSUFDdEMsWUFBWSxJQUFJLFlBQVk7QUFBQSxFQUM5QixDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssTUFBTSxFQUFFLEVBQ3pCLGFBQWEsRUFDYix3QkFBd0I7QUFDN0I7QUFNQSxlQUFzQixpQkFDcEJBLEtBQ0EsTUFDQSxPQUNBLE1BQVksb0JBQUksS0FBSyxHQUNEO0FBRXBCLE1BQUksQ0FBQyxnQkFBZ0IsT0FBTyxHQUFHLEdBQUc7QUFDaEMsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLGFBQWFELFdBQWdDLEtBQUssVUFBVTtBQUNsRSxNQUFJLENBQUMsY0FBYyxDQUFDLE1BQU0sU0FBUztBQUVqQyxVQUFNRSxZQUFXRixXQUE4QixLQUFLLFFBQVE7QUFDNUQsVUFBTUcsU0FBUSxjQUFjLE9BQU9ELFdBQVUsR0FBRztBQUNoRCxRQUFJLE1BQU0sV0FBVyxZQUFZQyxXQUFVLFVBQVU7QUFDbkQsWUFBTSxVQUFVLE1BQU1GLElBQ25CLFlBQVksYUFBYSxFQUN6QixJQUFJO0FBQUEsUUFDSCxRQUFRO0FBQUEsUUFDUixZQUFZLElBQUksWUFBWTtBQUFBLE1BQzlCLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxNQUFNLEVBQUUsRUFDekIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixZQUFNQSxJQUNILFlBQVksT0FBTyxFQUNuQixJQUFJLEVBQUUsUUFBUSxVQUFVLFlBQVksSUFBSSxZQUFZLEVBQUUsQ0FBQyxFQUN2RCxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsUUFBUTtBQUNYLFlBQU0sY0FBY0EsS0FBSSxTQUFTLEdBQUc7QUFDcEMsYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksTUFBTSxXQUFXLFNBQVUsUUFBTztBQUN0QyxNQUFJLE1BQU0sSUFBSSxLQUFLLE1BQU0sT0FBTyxFQUFHLFFBQU87QUFHMUMsTUFBSSxTQUFTLE1BQU0sZUFBZUEsS0FBSSxNQUFNLEtBQUs7QUFDakQsUUFBTSxNQUFNLE9BQU8sT0FBTyxhQUFhLEtBQUssT0FBTyxPQUFPLFlBQVk7QUFDdEUsUUFBTSxXQUFXRCxXQUE4QixLQUFLLFFBQVE7QUFDNUQsUUFBTSxRQUFRLGNBQWMsUUFBUSxVQUFVLElBQUksS0FBSyxNQUFNLE9BQU8sQ0FBQztBQUVyRSxNQUFJLGNBQW1DLE1BQ25DLGNBQ0EsVUFBVSxZQUFZLFVBQVUsWUFDaEMsV0FDQTtBQUdKLE1BQUksY0FBYyxJQUFJLEtBQUssTUFBTSxTQUFTO0FBQzFDLE1BQUksWUFBWSxJQUFJLEtBQUssTUFBTSxPQUFPO0FBQ3RDLE1BQUksYUFBYSxNQUFNO0FBQ3ZCLE1BQUksUUFBUTtBQUVaLE1BQ0UsV0FBVyxlQUFlLGNBQzFCLE9BQU8sT0FBTyxhQUFhLElBQUksT0FBTyxPQUFPLFlBQVksR0FDekQ7QUFDQSxZQUFRLE9BQU8sT0FBTyxhQUFhLElBQUksT0FBTyxPQUFPLFlBQVk7QUFBQSxFQUNuRTtBQUVBLFdBQVMsTUFBTUMsSUFDWixZQUFZLGFBQWEsRUFDekIsSUFBSTtBQUFBLElBQ0gsUUFBUTtBQUFBLElBQ1IsWUFBWSxJQUFJLFlBQVk7QUFBQSxFQUM5QixDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUFFLEVBQzFCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsUUFBTSxjQUFjQSxLQUFJLFFBQVEsU0FBUztBQUl6QyxNQUFJLGdCQUFnQixlQUFlLE1BQU0sV0FBVyxhQUFhO0FBQy9ELFVBQU0sRUFBRSxpQ0FBQUcsaUNBQWdDLElBQUksTUFBTTtBQUdsRCxVQUFNQSxpQ0FBZ0NILEtBQUk7QUFBQSxNQUN4QyxRQUFRLEtBQUs7QUFBQSxNQUNiLFFBQVEsS0FBSztBQUFBLE1BQ2IsU0FBUyxPQUFPO0FBQUEsSUFDbEIsQ0FBQztBQUFBLEVBQ0g7QUFHQSxTQUFPLGFBQWEsS0FBSztBQUN2QixVQUFNLFlBQVk7QUFDbEIsVUFBTSxVQUFVLGdCQUFnQixXQUFXLFVBQVU7QUFDckQsUUFBSSxDQUFDLFFBQVM7QUFFZCxrQkFBYztBQUdkLFFBQUksV0FBVyxLQUFLO0FBQ2xCLFlBQU0saUJBQWlCLGtCQUFrQixXQUFXLFFBQVE7QUFDNUQsWUFBTSxTQUFTLE1BQU1BLElBQ2xCLFdBQVcsYUFBYSxFQUN4QixPQUFPO0FBQUEsUUFDTixTQUFTLEtBQUs7QUFBQSxRQUNkLGFBQWE7QUFBQSxRQUNiLFdBQVcsVUFBVSxZQUFZO0FBQUEsUUFDakMsU0FBUyxRQUFRLFlBQVk7QUFBQSxRQUM3QixhQUFhLGlCQUFpQixlQUFlLFlBQVksSUFBSTtBQUFBLFFBQzdELGNBQWMsT0FBTyxLQUFLLFlBQVk7QUFBQSxRQUN0QyxlQUFlO0FBQUEsUUFDZixRQUFRO0FBQUEsUUFDUixZQUFZO0FBQUEsUUFDWixZQUFZLElBQUksWUFBWTtBQUFBLFFBQzVCLFlBQVksSUFBSSxZQUFZO0FBQUEsTUFDOUIsQ0FBaUIsRUFDaEIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixZQUFNLGNBQWNBLEtBQUksUUFBUSxPQUFPO0FBQ3ZDLG9CQUFjO0FBQ2Qsa0JBQVk7QUFDWixjQUFRO0FBQ1I7QUFBQSxJQUNGO0FBR0EsVUFBTSxlQUFlLGtCQUFrQixXQUFXLFFBQVE7QUFDMUQsVUFBTSxPQUFPLE1BQU1BLElBQ2hCLFdBQVcsYUFBYSxFQUN4QixPQUFPO0FBQUEsTUFDTixTQUFTLEtBQUs7QUFBQSxNQUNkLGFBQWE7QUFBQSxNQUNiLFdBQVcsVUFBVSxZQUFZO0FBQUEsTUFDakMsU0FBUyxRQUFRLFlBQVk7QUFBQSxNQUM3QixhQUFhLGVBQWUsYUFBYSxZQUFZLElBQUk7QUFBQSxNQUN6RCxjQUFjLE9BQU8sS0FBSyxZQUFZO0FBQUEsTUFDdEMsZUFBZTtBQUFBLE1BQ2YsUUFBUTtBQUFBLE1BQ1IsWUFBWTtBQUFBLE1BQ1osWUFBWSxJQUFJLFlBQVk7QUFBQSxNQUM1QixZQUFZLElBQUksWUFBWTtBQUFBLElBQzlCLENBQWlCLEVBQ2hCLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsV0FBTyxNQUFNLGVBQWVBLEtBQUksTUFBTSxJQUFJO0FBQUEsRUFDNUM7QUFFQSxTQUFPO0FBQ1Q7QUFHQSxlQUFzQixrQkFDcEJBLEtBQ0EsUUFDQSxNQUFZLG9CQUFJLEtBQUssR0FDTjtBQUNmLFFBQU0sUUFBUSxNQUFNQSxJQUNqQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFVBQVUsTUFBTSxDQUFDLFVBQVUsUUFBUSxDQUFDLEVBQzFDLFVBQVUsRUFDVixRQUFRO0FBRVgsYUFBVyxRQUFRLE9BQU87QUFDeEIsUUFBSSxLQUFLLFdBQVcsU0FBVTtBQUM5QixVQUFNLFFBQVEsTUFBTUEsSUFDakIsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxFQUM3QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsUUFBSSxDQUFDLE1BQU87QUFDWixVQUFNLGlCQUFpQkEsS0FBSSxNQUFNLE9BQU8sR0FBRztBQUFBLEVBQzdDO0FBQ0Y7OztBQy9WQSxTQUFTLGNBQWMsT0FBMkM7QUFDaEUsTUFBSSxTQUFTLEtBQU0sUUFBTztBQUMxQixNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFFBQUk7QUFDRixhQUFPLEtBQUssTUFBTSxLQUFLO0FBQUEsSUFDekIsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLElBQU0scUJBQXFCO0FBT3BCLFNBQVMsZ0JBQ2QsT0FDQSxNQUFZLG9CQUFJLEtBQUssR0FDUjtBQUNiLFFBQU0sU0FBc0IsQ0FBQztBQUU3QixhQUFXLEVBQUUsTUFBTSxNQUFNLEtBQUssT0FBTztBQUNuQyxRQUFJLENBQUMsU0FBUyxLQUFLLFdBQVcsU0FBVTtBQUV4QyxVQUFNLFdBQVcsSUFBSSxLQUFLLEtBQUssU0FBUztBQUN4QyxRQUFJLFdBQVcsS0FBSztBQUNsQixZQUFNLFVBQVUsU0FBUyxRQUFRLElBQUksSUFBSSxRQUFRO0FBQ2pELFlBQU0sWUFBWSxXQUFXLEtBQUssS0FBSyxLQUFLO0FBQzVDLFVBQUksYUFBYSxvQkFBb0I7QUFDbkMsY0FBTSxZQUFZLEtBQUssSUFBSSxHQUFHLEtBQUssS0FBSyxTQUFTLENBQUM7QUFDbEQsZUFBTyxLQUFLO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTixRQUFRLEtBQUs7QUFBQSxVQUNiLE9BQU8sS0FBSztBQUFBLFVBQ1osU0FBUyxTQUFJLEtBQUssS0FBSyxvQkFBZSxTQUFTLE9BQzdDLGNBQWMsSUFBSSxLQUFLLEdBQ3pCO0FBQUEsVUFDQSxVQUFVO0FBQUEsUUFDWixDQUFDO0FBQUEsTUFDSDtBQUNBO0FBQUEsSUFDRjtBQUVBLFVBQU0sWUFDSixNQUFNLFdBQVcsZUFDaEIsT0FBTyxNQUFNLFlBQVksSUFBSSxLQUM1QixPQUFPLE1BQU0sYUFBYSxLQUFLLE9BQU8sTUFBTSxZQUFZO0FBQzVELFFBQUksV0FBVztBQUNiLGFBQU8sS0FBSztBQUFBLFFBQ1YsTUFBTTtBQUFBLFFBQ04sUUFBUSxLQUFLO0FBQUEsUUFDYixPQUFPLEtBQUs7QUFBQSxRQUNaLFNBQVMsdUJBQWtCLEtBQUssS0FBSztBQUFBLFFBQ3JDLFVBQVU7QUFBQSxNQUNaLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFdBQVcsY0FBYyxLQUFLLFFBQVE7QUFDNUMsVUFBTSxRQUFRLGNBQWMsT0FBTyxVQUFVLEdBQUc7QUFDaEQsUUFBSSxVQUFVLGVBQWU7QUFDM0IsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixRQUFRLEtBQUs7QUFBQSxRQUNiLE9BQU8sS0FBSztBQUFBLFFBQ1osU0FBUyxzQkFBaUIsS0FBSyxLQUFLO0FBQUEsUUFDcEMsVUFBVTtBQUFBLE1BQ1osQ0FBQztBQUFBLElBQ0gsV0FBVyxVQUFVLFdBQVc7QUFDOUIsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixRQUFRLEtBQUs7QUFBQSxRQUNiLE9BQU8sS0FBSztBQUFBLFFBQ1osU0FBUyxTQUFJLEtBQUssS0FBSztBQUFBLFFBQ3ZCLFVBQVU7QUFBQSxNQUNaLENBQUM7QUFBQSxJQUNIO0FBR0EsUUFBSSxNQUFNLFdBQVcsT0FBTyxNQUFNLFlBQVksSUFBSSxHQUFHO0FBQ25ELFlBQU0sUUFBUSxJQUFJLEtBQUssTUFBTSxTQUFTLEVBQUUsUUFBUTtBQUNoRCxZQUFNLE1BQU0sSUFBSSxLQUFLLE1BQU0sT0FBTyxFQUFFLFFBQVE7QUFDNUMsWUFBTSxPQUFPLEtBQUssSUFBSSxHQUFHLE1BQU0sS0FBSztBQUNwQyxZQUFNLFVBQVUsS0FBSyxJQUFJLEdBQUcsS0FBSyxJQUFJLElBQUksSUFBSSxRQUFRLElBQUksU0FBUyxJQUFJLENBQUM7QUFDdkUsWUFBTSxXQUFXLFVBQVUsT0FBTyxNQUFNLFlBQVk7QUFDcEQsWUFBTSxTQUFTLE9BQU8sTUFBTSxhQUFhO0FBQ3pDLFVBQUksV0FBVyxRQUFRLFNBQVMsV0FBVyxLQUFLO0FBQzlDLGVBQU8sS0FBSztBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ04sUUFBUSxLQUFLO0FBQUEsVUFDYixPQUFPLEtBQUs7QUFBQSxVQUNaLFNBQVMsU0FBSSxLQUFLLEtBQUs7QUFBQSxVQUN2QixVQUFVO0FBQUEsUUFDWixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUNUOzs7QUY1RUEsU0FBUyxnQkFBd0I7QUFDL0IsUUFBTSxTQUFTLFdBQVcsRUFBRSxJQUFJLFFBQVE7QUFDeEMsTUFBSSxPQUFPLFdBQVcsVUFBVTtBQUM5QixVQUFNLElBQUksTUFBTSxpQkFBaUI7QUFBQSxFQUNuQztBQUNBLFNBQU87QUFDVDtBQWtJQSxTQUFTSSxXQUFhLE9BQTBCO0FBQzlDLE1BQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsTUFBSSxPQUFPLFVBQVUsVUFBVTtBQUM3QixRQUFJO0FBQ0YsYUFBTyxLQUFLLE1BQU0sS0FBSztBQUFBLElBQ3pCLFFBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTLGdCQUF3QyxPQUFVO0FBQ3pELFNBQU87QUFBQSxJQUNMLEdBQUc7QUFBQSxJQUNILGNBQWMsU0FBUyxNQUFNLFlBQVk7QUFBQSxJQUN6QyxlQUFlLFNBQVMsTUFBTSxhQUFhO0FBQUEsSUFDM0MsWUFBWSxTQUFTLE1BQU0sVUFBVTtBQUFBLEVBQ3ZDO0FBQ0Y7QUFFQSxTQUFTLGVBQWUsTUFBbUI7QUFDekMsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsUUFBUSxTQUFTLEtBQUssUUFBUSxDQUFDO0FBQUEsRUFDakM7QUFDRjtBQUVBLFNBQVMscUJBQXFCLEtBQXdCO0FBQ3BELFNBQU87QUFBQSxJQUNMLEdBQUc7QUFBQSxJQUNILFdBQVcsZUFBZSxJQUFJLFNBQVM7QUFBQSxJQUN2QyxRQUFRLFNBQVMsSUFBSSxRQUFRLENBQUM7QUFBQSxFQUNoQztBQUNGO0FBRUEsU0FBUyxtQkFBbUIsVUFBMkI7QUFDckQsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsT0FBTyxTQUFTLFNBQVMsS0FBSztBQUFBLEVBQ2hDO0FBQ0Y7QUFFQSxTQUFTLGlCQUNQLE9BQzZCO0FBQzdCLE1BQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsU0FBTztBQUFBLElBQ0wsUUFBUSxNQUFNO0FBQUEsSUFDZCxVQUFVLE1BQU07QUFBQSxJQUNoQixRQUFRLE1BQU07QUFBQSxJQUNkLFlBQVksTUFBTTtBQUFBLElBQ2xCLE9BQU8sTUFBTTtBQUFBLEVBQ2Y7QUFDRjtBQUVBLFNBQVMsZUFDUCxPQUMyQjtBQUMzQixNQUFJLFNBQVMsS0FBTSxRQUFPO0FBQzFCLFNBQU87QUFBQSxJQUNMLE1BQU0sTUFBTTtBQUFBLElBQ1osTUFBTSxNQUFNO0FBQUEsSUFDWix3QkFBd0IsTUFBTTtBQUFBLElBQzlCLFlBQVksTUFBTTtBQUFBLElBQ2xCLFdBQVcsTUFBTTtBQUFBLEVBQ25CO0FBQ0Y7QUFFQSxTQUFTLGFBQ1AsT0FDWTtBQUNaLE1BQUksQ0FBQyxNQUFPLFFBQU8sQ0FBQztBQUNwQixTQUFPO0FBQUEsSUFDTCxnQkFBZ0IsTUFBTTtBQUFBLElBQ3RCLGdCQUFnQixNQUFNO0FBQUEsSUFDdEIsYUFBYSxNQUFNO0FBQUEsSUFDbkIsWUFBWSxNQUFNO0FBQUEsSUFDbEIsc0JBQXNCLE1BQU07QUFBQSxFQUM5QjtBQUNGO0FBRUEsZUFBZSxzQkFDYixLQUNBLFFBQ0EsYUFDQTtBQUNBLE1BQUksWUFBWSxXQUFXLEVBQUc7QUFDOUIsUUFBTSxPQUFPLE1BQU0sSUFDaEIsV0FBVyxZQUFZLEVBQ3ZCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxNQUFNLE1BQU0sV0FBVyxFQUM3QixPQUFPLElBQUksRUFDWCxRQUFRO0FBQ1gsTUFBSSxLQUFLLFdBQVcsWUFBWSxRQUFRO0FBQ3RDLFVBQU0sSUFBSSxpQkFBaUIsa0NBQWtDO0FBQUEsRUFDL0Q7QUFDRjtBQUVBLGVBQWUsa0JBQ2IsS0FDQSxRQUNBLFVBQ0E7QUFDQSxNQUFJLFNBQVMsV0FBVyxFQUFHO0FBQzNCLFFBQU0sT0FBTyxNQUFNLElBQ2hCLFdBQVcsUUFBUSxFQUNuQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sTUFBTSxNQUFNLFFBQVEsRUFDMUIsT0FBTyxJQUFJLEVBQ1gsUUFBUTtBQUNYLE1BQUksS0FBSyxXQUFXLFNBQVMsUUFBUTtBQUNuQyxVQUFNLElBQUksaUJBQWlCLDhCQUE4QjtBQUFBLEVBQzNEO0FBQ0Y7QUFFQSxlQUFlLGlCQUNiLEtBQ0EsUUFDQSxTQUNBO0FBQ0EsTUFBSSxRQUFRLFdBQVcsRUFBRztBQUMxQixRQUFNLE9BQU8sTUFBTSxJQUNoQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLE1BQU0sTUFBTSxPQUFPLEVBQ3pCLE9BQU8sSUFBSSxFQUNYLFFBQVE7QUFDWCxNQUFJLEtBQUssV0FBVyxRQUFRLFFBQVE7QUFDbEMsVUFBTSxJQUFJLGlCQUFpQix3Q0FBd0M7QUFBQSxFQUNyRTtBQUNGO0FBRUEsZUFBZSxhQUNiLEtBQ0EsUUFDQSxRQUNBLE9BQ0E7QUFDQSxRQUFNLElBQUksV0FBVyxZQUFZLEVBQUUsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUFFLFFBQVE7QUFDekUsUUFBTSxjQUFjLE1BQ2pCLE9BQU8sQ0FBQyxNQUFNLEVBQUUsYUFBYSxjQUFjLEVBQUUsY0FBYyxJQUFJLEVBQy9ELElBQUksQ0FBQyxNQUFNLEVBQUUsVUFBVztBQUMzQixRQUFNLFdBQVcsTUFDZCxPQUFPLENBQUMsTUFBTSxFQUFFLGFBQWEsV0FBVyxFQUFFLFdBQVcsSUFBSSxFQUN6RCxJQUFJLENBQUMsTUFBTSxFQUFFLE9BQVE7QUFDeEIsUUFBTSxzQkFBc0IsS0FBSyxRQUFRLFdBQVc7QUFDcEQsUUFBTSxrQkFBa0IsS0FBSyxRQUFRLFFBQVE7QUFFN0MsYUFBVyxRQUFRLE9BQU87QUFDeEIsVUFBTSxJQUNILFdBQVcsWUFBWSxFQUN2QixPQUFPO0FBQUEsTUFDTixTQUFTO0FBQUEsTUFDVCxXQUFXLEtBQUs7QUFBQSxNQUNoQixhQUFhLEtBQUssYUFBYSxhQUFhLEtBQUssY0FBYyxPQUFPO0FBQUEsTUFDdEUsVUFBVSxLQUFLLGFBQWEsVUFBVSxLQUFLLFdBQVcsT0FBTztBQUFBLE1BQzdELFFBQVEsS0FBSyxVQUFVO0FBQUEsSUFDekIsQ0FBZ0IsRUFDZixRQUFRO0FBQUEsRUFDYjtBQUNGO0FBRUEsZUFBZSxvQkFDYixLQUNBLFFBQ0EsUUFDQSxNQUNBO0FBQ0EsUUFBTSxTQUFTLEtBQUssSUFBSSxDQUFDLE1BQU0sRUFBRSxlQUFlO0FBQ2hELE1BQUksT0FBTyxTQUFTLE1BQU0sR0FBRztBQUMzQixVQUFNLElBQUksaUJBQWlCLGdDQUFnQztBQUFBLEVBQzdEO0FBQ0EsUUFBTSxpQkFBaUIsS0FBSyxRQUFRLE1BQU07QUFHMUMsUUFBTSxXQUFXLE1BQU0sSUFDcEIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsT0FBTyxJQUFJLEVBQ1gsUUFBUTtBQUNYLFFBQU0sV0FBVyxNQUFNLElBQ3BCLFdBQVcsbUJBQW1CLEVBQzlCLFVBQVUsU0FBUyxZQUFZLDJCQUEyQixFQUMxRCxNQUFNLGlCQUFpQixLQUFLLE1BQU0sRUFDbEMsT0FBTztBQUFBLElBQ047QUFBQSxJQUNBO0FBQUEsRUFDRixDQUFDLEVBQ0EsUUFBUTtBQUVYLFFBQU0sUUFBUSxvQkFBSSxJQUFzQjtBQUN4QyxhQUFXLEtBQUssU0FBVSxPQUFNLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztBQUM1QyxhQUFXLEtBQUssVUFBVTtBQUN4QixRQUFJLEVBQUUsWUFBWSxPQUFRO0FBQzFCLFVBQU0sSUFBSSxFQUFFLE9BQU8sR0FBRyxLQUFLLEVBQUUsa0JBQWtCO0FBQUEsRUFDakQ7QUFDQSxRQUFNLElBQUksUUFBUSxNQUFNO0FBRXhCLE1BQUksMkJBQTJCLE9BQU8sTUFBTSxHQUFHO0FBQzdDLFVBQU0sSUFBSSxpQkFBaUIsMkJBQTJCO0FBQUEsRUFDeEQ7QUFFQSxRQUFNLElBQUksV0FBVyxtQkFBbUIsRUFBRSxNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQUUsUUFBUTtBQUNoRixhQUFXLE9BQU8sTUFBTTtBQUN0QixVQUFNLElBQ0gsV0FBVyxtQkFBbUIsRUFDOUIsT0FBTztBQUFBLE1BQ04sU0FBUztBQUFBLE1BQ1Qsb0JBQW9CLElBQUk7QUFBQSxNQUN4QixhQUFhLElBQUksZUFBZTtBQUFBLE1BQ2hDLFdBQVcsSUFBSSxhQUFhO0FBQUEsTUFDNUIsUUFBUSxJQUFJLFVBQVU7QUFBQSxJQUN4QixDQUFzQixFQUNyQixRQUFRO0FBQUEsRUFDYjtBQUNGO0FBRUEsZUFBZSxnQkFDYixRQUNBLFFBQ2tCO0FBQ2xCLFFBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsbUJBQW1CLEVBQzlCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLFFBQVE7QUFDWCxNQUFJLEtBQUssV0FBVyxFQUFHLFFBQU87QUFFOUIsYUFBVyxPQUFPLE1BQU07QUFDdEIsVUFBTSxZQUFZLE1BQU0sR0FDckIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sTUFBTSxLQUFLLElBQUksa0JBQWtCLEVBQ3ZDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsVUFBVyxRQUFPO0FBRXZCLFVBQU0sUUFBUSxNQUFNLEdBQ2pCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxJQUFJLGtCQUFrQixFQUM1QyxRQUFRLGVBQWUsTUFBTSxFQUM3QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFFBQUksQ0FBQyxNQUFPLFFBQU87QUFFbkIsUUFBSSxJQUFJLGdCQUFnQixZQUFZO0FBQ2xDLFlBQU0sWUFDSixPQUFPLE1BQU0sWUFBWSxJQUFJLEtBQzdCLE9BQU8sTUFBTSxhQUFhLEtBQUssT0FBTyxNQUFNLFlBQVk7QUFDMUQsVUFDRSxNQUFNLFdBQVcsZUFDakIsVUFBVSxXQUFXLGVBQ3JCLENBQUMsV0FDRDtBQUNBLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRixPQUFPO0FBQ0wsWUFBTSxZQUFZLElBQUksYUFBYSxPQUFPLE1BQU0sWUFBWTtBQUM1RCxVQUFJLE9BQU8sTUFBTSxhQUFhLElBQUksT0FBTyxTQUFTLEVBQUcsUUFBTztBQUFBLElBQzlEO0FBQUEsRUFDRjtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsa0JBQWtCLE1BQXFCO0FBQzlDLFFBQU1DLFVBQVNELFdBQXNCLEtBQUssTUFBTSxLQUFLLENBQUM7QUFDdEQsUUFBTSxhQUFhQSxXQUFnQyxLQUFLLFVBQVU7QUFDbEUsUUFBTSxXQUFXQSxXQUE4QixLQUFLLFFBQVE7QUFDNUQsUUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFFckIsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsY0FBYyxTQUFTLEtBQUssWUFBWTtBQUFBLElBQ3hDLFVBQVUsSUFBSSxLQUFLLEtBQUssU0FBUyxFQUFFLFlBQVk7QUFBQSxJQUMvQyxnQkFBZ0IsZUFBZSxNQUFNLEdBQUc7QUFBQSxJQUN4QyxRQUFBQztBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQSxPQUFPLFlBQWlDO0FBQ3RDLFlBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsWUFBWSxFQUN2QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsVUFBVSxFQUNWLFFBQVE7QUFDWCxhQUFPLEtBQUssSUFBSSxDQUFDLFVBQW9CO0FBQUEsUUFDbkMsR0FBRyxlQUFlLElBQUk7QUFBQSxRQUN0QixVQUFVLFlBQTRDO0FBQ3BELGNBQUksS0FBSyxlQUFlLEtBQU0sUUFBTztBQUNyQyxpQkFBTyxNQUFNLEdBQ1YsV0FBVyxZQUFZLEVBQ3ZCLE1BQU0sTUFBTSxLQUFLLEtBQUssV0FBVyxFQUNqQyxVQUFVLEVBQ1YsaUJBQWlCLEtBQUs7QUFBQSxRQUMzQjtBQUFBLFFBQ0EsT0FBTyxZQUF5QztBQUM5QyxjQUFJLEtBQUssWUFBWSxLQUFNLFFBQU87QUFDbEMsaUJBQU8sTUFBTSxHQUNWLFdBQVcsUUFBUSxFQUNuQixNQUFNLE1BQU0sS0FBSyxLQUFLLFFBQVEsRUFDOUIsVUFBVSxFQUNWLGlCQUFpQixLQUFLO0FBQUEsUUFDM0I7QUFBQSxNQUNGLEVBQUU7QUFBQSxJQUNKO0FBQUEsSUFDQSxhQUFhLFlBQXlDO0FBQ3BELFVBQUksUUFBUSxNQUFNLEdBQ2YsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxFQUM3QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsVUFBSSxTQUFTLEtBQUssV0FBVyxVQUFVO0FBQ3JDLGdCQUFRLE1BQU0saUJBQWlCLElBQUksTUFBTSxLQUFLO0FBQUEsTUFDaEQ7QUFJQSxVQUFJLENBQUMsT0FBTztBQUNWLGNBQU0sU0FBUyxNQUFNLEdBQ2xCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsUUFBUSxlQUFlLE1BQU0sRUFDN0IsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixZQUNFLFVBQ0EsS0FBSyxXQUFXLFlBQ2hCLEtBQUssY0FBYyxRQUNuQixPQUFPLFdBQVcsZ0JBQ2pCLENBQUMsT0FBTyxXQUFXLE1BQU0sSUFBSSxLQUFLLE9BQU8sT0FBTyxJQUNqRDtBQUNBLGtCQUFRLE1BQU0sR0FDWCxZQUFZLGFBQWEsRUFDekIsSUFBSSxFQUFFLFFBQVEsVUFBVSxZQUFZLElBQUksWUFBWSxFQUFFLENBQUMsRUFDdkQsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUFFLEVBQzFCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxRQUM3QixPQUFPO0FBQ0wsa0JBQVE7QUFBQSxRQUNWO0FBQUEsTUFDRjtBQUNBLFVBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsWUFBTSxRQUFRLGNBQWMsT0FBTyxRQUFRO0FBQzNDLFlBQU0sU0FBUyxTQUFTLE1BQU0sWUFBWTtBQUMxQyxZQUFNLFVBQVUsU0FBUyxNQUFNLGFBQWE7QUFDNUMsYUFBTztBQUFBLFFBQ0wsR0FBRyxnQkFBZ0IsS0FBSztBQUFBLFFBQ3hCLGVBQWU7QUFBQSxRQUNmLGlCQUFpQixTQUFTLElBQUksS0FBSyxJQUFJLEdBQUcsVUFBVSxNQUFNLElBQUk7QUFBQSxRQUM5RCxXQUFXLEtBQUssSUFBSSxHQUFHLFNBQVMsT0FBTztBQUFBLE1BQ3pDO0FBQUEsSUFDRjtBQUFBLElBQ0EsUUFBUSxZQUFzQztBQUM1QyxZQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLGFBQWEsRUFDeEIsTUFBTSxXQUFXLEtBQUssS0FBSyxFQUFFLEVBQzdCLFFBQVEsZUFBZSxLQUFLLEVBQzVCLFVBQVUsRUFDVixRQUFRO0FBQ1gsYUFBTyxLQUFLLElBQUksZUFBZTtBQUFBLElBQ2pDO0FBQUEsSUFDQSxjQUFjLFlBQXVDO0FBQ25ELFlBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsbUJBQW1CLEVBQzlCLE1BQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxFQUM3QixVQUFVLEVBQ1YsUUFBUTtBQUNYLGFBQU8sS0FBSyxJQUFJLENBQUMsU0FBeUI7QUFBQSxRQUN4QyxHQUFHLHFCQUFxQixHQUFHO0FBQUEsUUFDM0IsV0FBVyxZQUFrQztBQUMzQyxnQkFBTSxJQUFJLE1BQU0sR0FDYixXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssSUFBSSxrQkFBa0IsRUFDdkMsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixpQkFBTyxJQUFJLGtCQUFrQixDQUFDLElBQUk7QUFBQSxRQUNwQztBQUFBLE1BQ0YsRUFBRTtBQUFBLElBQ0o7QUFBQSxJQUNBLFdBQVcsWUFBcUM7QUFDOUMsWUFBTSxRQUFRLE1BQU0sR0FDakIsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxFQUM3QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsVUFBSSxDQUFDLE1BQU8sUUFBTyxDQUFDO0FBQ3BCLFlBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcseUJBQXlCLEVBQ3BDLE1BQU0saUJBQWlCLEtBQUssTUFBTSxFQUFFLEVBQ3BDLFFBQVEsU0FBUyxLQUFLLEVBQ3RCLFVBQVUsRUFDVixRQUFRO0FBQ1gsYUFBTyxLQUFLLElBQUksa0JBQWtCO0FBQUEsSUFDcEM7QUFBQSxJQUNBLFVBQVUsWUFBOEI7QUFDdEMsVUFBSSxDQUFDQSxRQUFPLHFCQUFzQixRQUFPO0FBQ3pDLGFBQU8sQ0FBRSxNQUFNLGdCQUFnQixLQUFLLElBQUksS0FBSyxPQUFPO0FBQUEsSUFDdEQ7QUFBQSxFQUNGO0FBQ0Y7QUFFTyxJQUFNLFlBQVk7QUFBQSxFQUN2QixPQUFPLE9BQU8sU0FBZ0Q7QUFDNUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxrQkFBa0IsSUFBSSxNQUFNO0FBRWxDLFFBQUksUUFBUSxHQUNULFdBQVcsT0FBTyxFQUNsQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVEsWUFBWSxNQUFNLEVBQzFCLFFBQVEsY0FBYyxLQUFLLEVBQzNCLFFBQVEsTUFBTSxNQUFNLEVBQ3BCLFVBQVU7QUFFYixRQUFJLE1BQU0sUUFBUTtBQUNoQixjQUFRLE1BQU0sTUFBTSxVQUFVLEtBQUssS0FBSyxNQUEyQjtBQUFBLElBQ3JFO0FBRUEsVUFBTSxPQUFPLE1BQU0sTUFBTSxRQUFRO0FBQ2pDLFdBQU8sS0FBSyxJQUFJLGlCQUFpQjtBQUFBLEVBQ25DO0FBQUEsRUFFQSxNQUFNLE9BQU8sU0FBK0M7QUFDMUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxrQkFBa0IsSUFBSSxNQUFNO0FBQ2xDLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsV0FBTyxNQUFNLGtCQUFrQixHQUFHLElBQUk7QUFBQSxFQUN4QztBQUFBLEVBRUEsWUFBWSxPQUFPLFNBQWlDO0FBRWxELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sa0JBQWtCLElBQUksTUFBTTtBQUNsQyxVQUFNLFFBQVEsTUFBTSxHQUNqQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFVBQVUsRUFDVixRQUFRO0FBRVgsVUFBTSxRQUFRLENBQUM7QUFDZixlQUFXLFFBQVEsT0FBTztBQUN4QixZQUFNLFFBQVEsTUFBTSxHQUNqQixXQUFXLGFBQWEsRUFDeEIsTUFBTSxXQUFXLEtBQUssS0FBSyxFQUFFLEVBQzdCLE1BQU0sVUFBVSxLQUFLLFFBQVEsRUFDN0IsUUFBUSxlQUFlLE1BQU0sRUFDN0IsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixZQUFNLEtBQUssRUFBRSxNQUFNLE9BQU8sU0FBUyxLQUFLLENBQUM7QUFBQSxJQUMzQztBQUNBLFdBQU8sZ0JBQWdCLEtBQUs7QUFBQSxFQUM5QjtBQUFBLEVBRUEsZUFBZSxPQUFPLFNBQXFEO0FBQ3pFLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sT0FBTyxNQUFNLFNBQVEsb0JBQUksS0FBSyxHQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUUvRCxVQUFNLGNBQWMsTUFBTSxHQUN2QixXQUFXLHNCQUFzQixFQUNqQyxNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sbUJBQW1CLEtBQUssSUFBSSxFQUNsQyxVQUFVLEVBQ1YsUUFBUTtBQUVYLFVBQU0sYUFBYSxNQUFNLEdBQ3RCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sVUFBVSxLQUFLLFVBQVUsRUFDL0IsTUFBTSxtQkFBbUIsS0FBSyxJQUFJLEVBQ2xDLFVBQVUsRUFDVixRQUFRO0FBRVgsVUFBTSxlQUFlLFdBQVc7QUFBQSxNQUM5QixDQUFDLEtBQUssTUFBTSxNQUFNLE9BQU8sRUFBRSxNQUFNO0FBQUEsTUFDakM7QUFBQSxJQUNGO0FBR0EsUUFBSSxTQUFTO0FBQ2IsVUFBTSxTQUFTLG9CQUFJLEtBQUssT0FBTyxZQUFZO0FBQzNDLGFBQVMsSUFBSSxHQUFHLElBQUksS0FBSyxLQUFLO0FBQzVCLFlBQU0sTUFBTSxPQUFPLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUM1QyxZQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsc0JBQXNCLEVBQ2pDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxtQkFBbUIsS0FBSyxHQUFHLEVBQ2pDLE9BQU8sSUFBSSxFQUNYLGlCQUFpQjtBQUNwQixVQUFJLENBQUMsSUFBSztBQUNWO0FBQ0EsYUFBTyxXQUFXLE9BQU8sV0FBVyxJQUFJLENBQUM7QUFBQSxJQUMzQztBQUVBLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxnQkFBZ0IsWUFBWTtBQUFBLE1BQzVCO0FBQUEsTUFDQSxZQUFZO0FBQUEsTUFDWjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFFTyxJQUFNLGVBQWU7QUFBQSxFQUMxQixZQUFZLE9BQU8sU0FBb0Q7QUFDckUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxRQUFRLEtBQUs7QUFDbkIsVUFBTSxNQUFNLG9CQUFJLEtBQUs7QUFDckIsVUFBTSxZQUFZLHdCQUF3QixPQUFPLEdBQUc7QUFFcEQsVUFBTSxPQUFPLE1BQU0sR0FBRyxZQUFZLEVBQUUsUUFBUSxPQUFPLFFBQVE7QUFDekQsWUFBTSxVQUFVLE1BQU0sSUFDbkIsV0FBVyxPQUFPLEVBQ2xCLE9BQU87QUFBQSxRQUNOLFNBQVM7QUFBQSxRQUNULE9BQU8sVUFBVTtBQUFBLFFBQ2pCLGFBQWEsTUFBTSxlQUFlO0FBQUEsUUFDbEMsT0FBTyxVQUFVO0FBQUEsUUFDakIsTUFBTSxNQUFNLFFBQVE7QUFBQSxRQUNwQixXQUFXLFVBQVU7QUFBQSxRQUNyQixRQUFRLE1BQU07QUFBQSxRQUNkLGNBQWMsVUFBVTtBQUFBLFFBQ3hCLFFBQVEsS0FBSyxVQUFVLGFBQWEsTUFBTSxNQUFNLENBQUM7QUFBQSxRQUNqRCxRQUFRO0FBQUEsUUFDUixZQUFZLFVBQVUsYUFDbEIsS0FBSyxVQUFVLGlCQUFpQixVQUFVLFVBQVUsQ0FBQyxJQUNyRDtBQUFBLFFBQ0osVUFBVSxVQUFVLFdBQ2hCLEtBQUssVUFBVSxlQUFlLFVBQVUsUUFBUSxDQUFDLElBQ2pEO0FBQUEsUUFDSixVQUFVLE1BQU0sWUFBWTtBQUFBLFFBQzVCLFlBQVksTUFBTSxhQUFhO0FBQUEsUUFDL0IsV0FBVyxVQUFVLFNBQVMsWUFBWTtBQUFBLFFBQzFDLFlBQVksSUFBSSxZQUFZO0FBQUEsUUFDNUIsWUFBWSxJQUFJLFlBQVk7QUFBQSxNQUM5QixDQUFZLEVBQ1gsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixZQUFNLGFBQWEsS0FBSyxRQUFRLElBQUksUUFBUSxVQUFVLEtBQUs7QUFDM0QsWUFBTSxvQkFBb0IsS0FBSyxRQUFRLElBQUksUUFBUSxVQUFVLFlBQVk7QUFDekUsWUFBTSxtQkFBbUIsS0FBSyxTQUFTLEdBQUc7QUFDMUMsYUFBTztBQUFBLElBQ1QsQ0FBQztBQUVELFVBQU07QUFBQSxNQUNKO0FBQUEsTUFDQTtBQUFBLE1BQ0MsTUFBTSxHQUNKLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsVUFBVSxFQUNWLHdCQUF3QjtBQUFBLE1BQzNCO0FBQUEsSUFDRjtBQUVBLFdBQU87QUFBQSxNQUNMLE1BQU0sR0FDSCxXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLFVBQVUsRUFDVix3QkFBd0I7QUFBQSxJQUM3QjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLFlBQVksT0FDVixTQUNrQjtBQUNsQixVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxHQUNwQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLHdCQUF3QjtBQUUzQixVQUFNLFVBQVUsb0JBQUksS0FBSztBQUN6QixVQUFNLFlBQVk7QUFBQSxNQUNoQixLQUFLO0FBQUEsTUFDTCxTQUFTO0FBQUEsTUFDVDtBQUFBLElBQ0Y7QUFDQSxVQUFNLFFBQVEsS0FBSztBQUNuQixVQUFNLE1BQU0sUUFBUSxZQUFZO0FBRWhDLFVBQU0sY0FBYyxNQUFNLEdBQ3ZCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxTQUFTLEVBQUUsRUFDakMsTUFBTSxVQUFVLEtBQUssUUFBUSxFQUM3QixRQUFRLGVBQWUsTUFBTSxFQUM3QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLFFBQUk7QUFDSixRQUFJLFVBQVUsYUFBYSxRQUFXO0FBQ3BDLFVBQUksU0FBUyxXQUFXLGVBQWUsU0FBUyxXQUFXLFVBQVU7QUFDbkUsY0FBTSxJQUFJO0FBQUEsVUFDUjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0EsVUFBSSxVQUFVLFlBQVksTUFBTTtBQUM5QixjQUFNLElBQUksaUJBQWlCLHFEQUFxRDtBQUFBLE1BQ2xGO0FBQ0EscUJBQWUsVUFBVTtBQUV6QixZQUFNLGVBQWUsTUFBTSxHQUN4QixXQUFXLGFBQWEsRUFDeEIsTUFBTSxXQUFXLEtBQUssU0FBUyxFQUFFLEVBQ2pDLE1BQU0sVUFBVSxNQUFNLFFBQVEsRUFDOUIsT0FBTyxJQUFJLEVBQ1gsaUJBQWlCO0FBR3BCLFVBQUksZ0JBQWdCLE1BQU07QUFDeEIsY0FBTSxJQUFJO0FBQUEsVUFDUjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBRUEsWUFBTSxnQkFDSixlQUFlLFFBQVEsT0FBTyxZQUFZLGFBQWEsSUFBSTtBQUU3RCxVQUNFLGlCQUNBLGFBQWEsUUFBUSxJQUFJLElBQUksS0FBSyxTQUFTLFNBQVMsRUFBRSxRQUFRLEdBQzlEO0FBQ0EsWUFBSSxDQUFDLE1BQU0sdUJBQXVCO0FBQ2hDLGdCQUFNLElBQUk7QUFBQSxZQUNSO0FBQUEsVUFDRjtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUVBLFVBQU0sb0JBQW9CLGdCQUFnQixJQUFJLEtBQUssU0FBUyxTQUFTO0FBQ3JFLFVBQU0sb0JBQW9CLFVBQVUsYUFBYSxTQUM3QyxVQUFVLFlBQ1QsTUFBTTtBQUNQLFlBQU0sSUFBSUQsV0FBOEIsU0FBUyxRQUFRO0FBQ3pELFVBQUksQ0FBQyxFQUFHLFFBQU87QUFDZixhQUFPO0FBQUEsUUFDTCxNQUFNLEVBQUU7QUFBQSxRQUNSLE1BQU0sRUFBRTtBQUFBLFFBQ1IscUJBQXFCLEVBQUU7QUFBQSxRQUN2QixXQUFXLEVBQUU7QUFBQSxRQUNiLFVBQVUsRUFBRTtBQUFBLE1BQ2Q7QUFBQSxJQUNGLEdBQUc7QUFDTCw2QkFBeUIsbUJBQW1CLGlCQUFpQjtBQUU3RCxVQUFNLEdBQUcsWUFBWSxFQUFFLFFBQVEsT0FBTyxRQUFRO0FBQzVDLFlBQU0sSUFDSCxZQUFZLE9BQU8sRUFDbkIsSUFBSTtBQUFBLFFBQ0gsR0FBSSxNQUFNLFNBQVMsT0FDZixFQUFFLE9BQU8sa0JBQWtCLE1BQU0sS0FBSyxFQUFFLElBQ3hDLENBQUM7QUFBQSxRQUNMLEdBQUksTUFBTSxnQkFBZ0IsU0FDdEIsRUFBRSxhQUFhLE1BQU0sWUFBWSxJQUNqQyxDQUFDO0FBQUEsUUFDTCxHQUFJLE1BQU0sU0FBUyxPQUNmLEVBQUUsT0FBTyxrQkFBa0IsTUFBTSxLQUFLLEVBQUUsSUFDeEMsQ0FBQztBQUFBLFFBQ0wsR0FBSSxNQUFNLFNBQVMsU0FBWSxFQUFFLE1BQU0sTUFBTSxLQUFLLElBQUksQ0FBQztBQUFBLFFBQ3ZELEdBQUksTUFBTSxZQUFZLE9BQU8sRUFBRSxXQUFXLFVBQVUsU0FBUyxJQUFJLENBQUM7QUFBQSxRQUNsRSxHQUFJLE1BQU0sVUFBVSxPQUFPLEVBQUUsUUFBUSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsUUFDdkQsR0FBSSxNQUFNLGVBQWUsT0FDckIsRUFBRSxjQUFjLE1BQU0sWUFBWSxJQUNsQyxDQUFDO0FBQUEsUUFDTCxHQUFJLE1BQU0sV0FBVyxTQUNqQixFQUFFLFFBQVEsS0FBSyxVQUFVLGFBQWEsTUFBTSxNQUFNLENBQUMsRUFBRSxJQUNyRCxDQUFDO0FBQUEsUUFDTCxHQUFJLE1BQU0sVUFBVSxPQUFPLEVBQUUsUUFBUSxNQUFNLE9BQU8sSUFBSSxDQUFDO0FBQUEsUUFDdkQsR0FBSSxVQUFVLGVBQWUsU0FDekI7QUFBQSxVQUNBLFlBQVksVUFBVSxhQUNsQixLQUFLLFVBQVUsaUJBQWlCLFVBQVUsVUFBVSxDQUFDLElBQ3JEO0FBQUEsUUFDTixJQUNFLENBQUM7QUFBQSxRQUNMLEdBQUksVUFBVSxhQUFhLFNBQ3ZCO0FBQUEsVUFDQSxVQUFVLFVBQVUsV0FDaEIsS0FBSyxVQUFVLGVBQWUsVUFBVSxRQUFRLENBQUMsSUFDakQ7QUFBQSxRQUNOLElBQ0UsQ0FBQztBQUFBLFFBQ0wsR0FBSSxnQkFBZ0IsT0FDaEIsRUFBRSxXQUFXLGFBQWEsWUFBWSxFQUFFLElBQ3hDLENBQUM7QUFBQSxRQUNMLEdBQUksTUFBTSxZQUFZLE9BQU8sRUFBRSxVQUFVLE1BQU0sU0FBUyxJQUFJLENBQUM7QUFBQSxRQUM3RCxHQUFJLE1BQU0sYUFBYSxPQUFPLEVBQUUsWUFBWSxNQUFNLFVBQVUsSUFBSSxDQUFDO0FBQUEsUUFDakUsWUFBWTtBQUFBLE1BQ2QsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVE7QUFFWCxVQUFJLFVBQVUsT0FBTztBQUNuQixjQUFNLGFBQWEsS0FBSyxLQUFLLElBQUksUUFBUSxVQUFVLEtBQUs7QUFBQSxNQUMxRDtBQUNBLFVBQUksVUFBVSxjQUFjO0FBQzFCLGNBQU0sb0JBQW9CLEtBQUssS0FBSyxJQUFJLFFBQVEsVUFBVSxZQUFZO0FBQUEsTUFDeEU7QUFFQSxZQUFNLFlBQVksTUFBTSxJQUNyQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLFVBQVUsRUFDVix3QkFBd0I7QUFFM0IsWUFBTUUsU0FBUSxNQUFNLElBQ2pCLFdBQVcsYUFBYSxFQUN4QixNQUFNLFdBQVcsS0FBSyxLQUFLLEVBQUUsRUFDN0IsTUFBTSxVQUFVLEtBQUssUUFBUSxFQUM3QixRQUFRLGVBQWUsTUFBTSxFQUM3QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLFVBQUlBLFVBQVMsZ0JBQWdCLE1BQU07QUFDakMsY0FBTSxzQkFBc0IsS0FBSyxXQUFXQSxRQUFPLGNBQWMsT0FBTztBQUFBLE1BQzFFLFdBQVdBLFVBQVMsTUFBTSxlQUFlLE1BQU07QUFDN0MsY0FBTSxJQUNILFlBQVksYUFBYSxFQUN6QixJQUFJO0FBQUEsVUFDSCxjQUFjLE1BQU07QUFBQSxVQUNwQixZQUFZO0FBQUEsUUFDZCxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUtBLE9BQU0sRUFBRSxFQUN6QixRQUFRO0FBQUEsTUFDYixXQUNFQSxXQUNDLFVBQVUsYUFBYSxVQUFhLFVBQVUsZUFBZSxXQUM5RCxPQUFPQSxPQUFNLGFBQWEsTUFBTSxLQUNoQ0EsT0FBTSxnQkFBZ0IsR0FDdEI7QUFFQSxjQUFNO0FBQUEsVUFDSjtBQUFBLFVBQ0E7QUFBQSxVQUNBQTtBQUFBLFVBQ0EsSUFBSSxLQUFLLFVBQVUsU0FBUztBQUFBLFVBQzVCO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFFRCxVQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLFVBQVUsRUFDVix3QkFBd0I7QUFDM0IsVUFBTSxRQUFRLE1BQU0sR0FDakIsV0FBVyxhQUFhLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLEtBQUssRUFBRSxFQUM3QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsUUFBSSxNQUFPLE9BQU0sZUFBZSxJQUFJLE1BQU0sT0FBTyxPQUFPO0FBRXhELFdBQU8sa0JBQWtCLElBQUk7QUFBQSxFQUMvQjtBQUFBLEVBRUEsV0FBVyxPQUFPLFNBQXdDO0FBQ3hELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sT0FBTyxNQUFNLEdBQ2hCLFlBQVksT0FBTyxFQUNuQixJQUFJLEVBQUUsUUFBUSxVQUFVLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVksRUFBRSxDQUFDLEVBQzlELE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sVUFBVSxLQUFLLFFBQVEsRUFDN0IsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixXQUFPLGtCQUFrQixJQUFJO0FBQUEsRUFDL0I7QUFBQSxFQUVBLFlBQVksT0FBTyxTQUF3QztBQUN6RCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE9BQU8sTUFBTSxHQUNoQixZQUFZLE9BQU8sRUFDbkIsSUFBSSxFQUFFLFFBQVEsVUFBVSxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZLEVBQUUsQ0FBQyxFQUM5RCxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFVBQVUsS0FBSyxRQUFRLEVBQzdCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsV0FBTyxrQkFBa0IsSUFBSTtBQUFBLEVBQy9CO0FBQUEsRUFFQSxhQUFhLE9BQU8sU0FBd0M7QUFDMUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxPQUFPLE1BQU0sR0FDaEIsWUFBWSxPQUFPLEVBQ25CLElBQUksRUFBRSxRQUFRLFlBQVksYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLENBQUMsRUFDaEUsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixXQUFPLGtCQUFrQixJQUFJO0FBQUEsRUFDL0I7QUFBQSxFQUVBLFlBQVksT0FBTyxTQUF5QjtBQUMxQyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNQyxVQUFTLE1BQU0sR0FDbEIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVE7QUFDWCxXQUFPQSxRQUFPLFNBQVM7QUFBQSxFQUN6QjtBQUFBLEVBRUEsdUJBQXVCLE9BQU8sU0FBaUM7QUFFN0QsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxRQUFRLE1BQU0seUJBQXlCLElBQUksTUFBTTtBQUN2RCxXQUFPLEVBQUUsWUFBWSxNQUFNO0FBQUEsRUFDN0I7QUFDRjs7O0FHbC9CQSxTQUFTLGNBQUFDLG1CQUFrQjs7O0FDQzNCLGVBQXNCLFVBQVUsT0FBb0M7QUFDbEUsUUFBTSxTQUFTLE1BQU0sT0FBTyxPQUFPLE9BQU8sV0FBVyxLQUFLO0FBQzFELFNBQU8sTUFBTSxLQUFLLElBQUksV0FBVyxNQUFNLENBQUMsRUFDckMsSUFBSSxDQUFDLE1BQU0sRUFBRSxTQUFTLEVBQUUsRUFBRSxTQUFTLEdBQUcsR0FBRyxDQUFDLEVBQzFDLEtBQUssRUFBRTtBQUNaO0FBTU8sSUFBTSw2QkFBa0Q7QUFBQSxFQUM3RCxRQUFRO0FBQ1Y7OztBQ2RBLFNBQVMsWUFBWTtBQUNyQixTQUFTLE9BQU8sVUFBVSxRQUFRLGlCQUFpQjtBQUduRCxTQUFTLE1BQWM7QUFDckIsTUFBSSxPQUFPLFlBQVksZUFBZSxPQUFPLFFBQVEsUUFBUSxZQUFZO0FBQ3ZFLFdBQU8sUUFBUSxJQUFJO0FBQUEsRUFDckI7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGFBQXFCO0FBQzVCLFFBQU1DLE9BQ0gsT0FBTyxZQUFZLGVBQWUsUUFBUSxLQUFLLGNBQWU7QUFDakUsTUFBSUEsS0FBSyxRQUFPQTtBQUNoQixTQUFPLEtBQUssSUFBSSxHQUFHLFFBQVEsUUFBUTtBQUNyQztBQUVPLElBQU0sc0JBQU4sTUFBa0Q7QUFBQSxFQUN2RCxZQUE2QixPQUFlLFdBQVcsR0FBRztBQUE3QjtBQUFBLEVBQThCO0FBQUEsRUFFbkQsU0FBUyxLQUFxQjtBQUNwQyxVQUFNLE9BQU8sSUFBSSxRQUFRLFNBQVMsRUFBRSxFQUFFLFFBQVEsUUFBUSxFQUFFO0FBQ3hELFdBQU8sS0FBSyxLQUFLLE1BQU0sSUFBSTtBQUFBLEVBQzdCO0FBQUEsRUFFQSxNQUFNLE1BQ0osS0FDQSxPQUNBLGNBQ2U7QUFDZixVQUFNLE9BQU8sS0FBSyxTQUFTLEdBQUc7QUFDOUIsVUFBTSxNQUFNLEtBQUssTUFBTSxJQUFJO0FBQzNCLFVBQU0sTUFBTSxLQUFLLEVBQUUsV0FBVyxLQUFLLENBQUM7QUFDcEMsVUFBTSxVQUFVLE1BQU0sS0FBSztBQUFBLEVBQzdCO0FBQUEsRUFFQSxNQUFNLEtBQUssS0FBeUM7QUFDbEQsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLFNBQVMsS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUM5QyxhQUFPLElBQUksV0FBVyxJQUFJO0FBQUEsSUFDNUIsUUFBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxPQUFPLEtBQTRCO0FBQ3ZDLFFBQUk7QUFDRixZQUFNLE9BQU8sS0FBSyxTQUFTLEdBQUcsQ0FBQztBQUFBLElBQ2pDLFFBQVE7QUFBQSxJQUVSO0FBQUEsRUFDRjtBQUFBLEVBRUEsVUFBVSxNQUE2QjtBQUNyQyxXQUFPO0FBQUEsRUFDVDtBQUNGOzs7QUNoRE8sSUFBTSxpQkFBTixNQUE2QztBQUFBLEVBQ2pDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUVqQixZQUFZLE1BSVQ7QUFDRCxTQUFLLFNBQ0gsTUFBTSxXQUNKLE9BQU8sWUFBWSxlQUFlLFFBQVEsS0FBSyxvQkFDL0M7QUFDSixTQUFLLFNBQ0gsTUFBTSxXQUNKLE9BQU8sWUFBWSxlQUFlLFFBQVEsS0FBSyxvQkFDL0M7QUFDSixTQUFLLFdBQ0gsTUFBTSxhQUNKLE9BQU8sWUFBWSxlQUFlLFFBQVEsS0FBSyxzQkFDL0M7QUFBQSxFQUNOO0FBQUEsRUFFUSxtQkFBeUI7QUFDL0IsUUFBSSxDQUFDLEtBQUssUUFBUTtBQUNoQixZQUFNLElBQUk7QUFBQSxRQUNSO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLE1BQ0osS0FDQSxPQUNBLGFBQ2U7QUFDZixTQUFLLGlCQUFpQjtBQUN0QixVQUFNLE1BQU0sS0FBSyxVQUFVLEdBQUc7QUFDOUIsVUFBTSxNQUFNLE1BQU0sTUFBTSxLQUFLO0FBQUEsTUFDM0IsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ1AsZ0JBQWdCO0FBQUEsUUFDaEIsa0JBQWtCLE9BQU8sTUFBTSxVQUFVO0FBQUEsTUFDM0M7QUFBQSxNQUNBLE1BQU07QUFBQSxJQUNSLENBQUM7QUFDRCxRQUFJLENBQUMsSUFBSSxJQUFJO0FBQ1gsWUFBTSxJQUFJLE1BQU0sa0JBQWtCLElBQUksTUFBTSxJQUFJLE1BQU0sSUFBSSxLQUFLLENBQUMsRUFBRTtBQUFBLElBQ3BFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxLQUFLLEtBQXlDO0FBQ2xELFNBQUssaUJBQWlCO0FBQ3RCLFVBQU0sTUFBTSxNQUFNLE1BQU0sS0FBSyxVQUFVLEdBQUcsQ0FBQztBQUMzQyxRQUFJLElBQUksV0FBVyxJQUFLLFFBQU87QUFDL0IsUUFBSSxDQUFDLElBQUksSUFBSTtBQUNYLFlBQU0sSUFBSSxNQUFNLGtCQUFrQixJQUFJLE1BQU0sRUFBRTtBQUFBLElBQ2hEO0FBQ0EsV0FBTyxJQUFJLFdBQVcsTUFBTSxJQUFJLFlBQVksQ0FBQztBQUFBLEVBQy9DO0FBQUEsRUFFQSxNQUFNLE9BQU8sS0FBNEI7QUFDdkMsU0FBSyxpQkFBaUI7QUFDdEIsVUFBTSxNQUFNLEtBQUssVUFBVSxHQUFHLEdBQUcsRUFBRSxRQUFRLFNBQVMsQ0FBQztBQUFBLEVBQ3ZEO0FBQUEsRUFFQSxVQUFVLEtBQTRCO0FBQ3BDLFFBQUksQ0FBQyxLQUFLLE9BQVEsUUFBTztBQUN6QixXQUFPLEtBQUssVUFBVSxHQUFHO0FBQUEsRUFDM0I7QUFBQSxFQUVRLFVBQVUsS0FBcUI7QUFDckMsVUFBTSxPQUFPLElBQUksUUFBUSxRQUFRLEVBQUU7QUFDbkMsUUFBSSxLQUFLLFVBQVU7QUFDakIsYUFBTyxHQUFHLEtBQUssU0FBUyxRQUFRLE9BQU8sRUFBRSxDQUFDLElBQUksS0FBSyxNQUFNLElBQUksSUFBSTtBQUFBLElBQ25FO0FBQ0EsV0FBTyxXQUFXLEtBQUssTUFBTSxPQUFPLEtBQUssTUFBTSxrQkFBa0IsSUFBSTtBQUFBLEVBQ3ZFO0FBQ0Y7QUFHTyxTQUFTLDRCQUEwQztBQUN4RCxRQUFNLE9BQ0gsT0FBTyxZQUFZLGVBQWUsUUFBUSxLQUFLLGtCQUNoRDtBQUNGLE1BQUksU0FBUyxNQUFNO0FBQ2pCLFdBQU8sSUFBSSxlQUFlO0FBQUEsRUFDNUI7QUFDQSxTQUFPLElBQUksb0JBQW9CO0FBQ2pDOzs7QUN0Rk8sSUFBTSxzQkFBc0Isb0JBQUksSUFBSTtBQUFBLEVBQ3pDO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFDRixDQUFDO0FBRU0sSUFBTSxrQkFBa0IsSUFBSSxPQUFPO0FBRW5DLFNBQVMsd0JBQXdCLGFBQTZCO0FBQ25FLFVBQVEsYUFBYTtBQUFBLElBQ25CLEtBQUs7QUFDSCxhQUFPO0FBQUEsSUFDVCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNUO0FBQ0UsYUFBTztBQUFBLEVBQ1g7QUFDRjs7O0FDV08sSUFBTSxvQkFBTixNQUFtRDtBQUFBLEVBQ3hELFlBQ21CQyxLQUNBLFNBQ0EsVUFBK0IsNEJBQ2hEO0FBSGlCLGNBQUFBO0FBQ0E7QUFDQTtBQUFBLEVBQ2hCO0FBQUEsRUFFSCxNQUFNLElBQUksT0FLZTtBQUN2QixVQUFNLGNBQWMsTUFBTSxZQUFZLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxDQUFDLEVBQUUsS0FBSztBQUN2RSxRQUFJLENBQUMsb0JBQW9CLElBQUksV0FBVyxHQUFHO0FBQ3pDLFlBQU0sSUFBSTtBQUFBLFFBQ1IsNkJBQTZCLFdBQVc7QUFBQSxRQUN4QztBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQ0EsUUFBSSxNQUFNLE1BQU0sZUFBZSxHQUFHO0FBQ2hDLFlBQU0sSUFBSSxxQkFBcUIsY0FBYyxHQUFHO0FBQUEsSUFDbEQ7QUFDQSxRQUFJLE1BQU0sTUFBTSxhQUFhLGlCQUFpQjtBQUM1QyxZQUFNLElBQUkscUJBQXFCLGtCQUFrQixHQUFHO0FBQUEsSUFDdEQ7QUFFQSxVQUFNLFNBQVMsTUFBTSxLQUFLLFFBQVEsT0FBTyxNQUFNLEtBQUs7QUFDcEQsVUFBTSxXQUFXLE1BQU0sS0FBSyxHQUN6QixXQUFXLFFBQVEsRUFDbkIsTUFBTSxXQUFXLEtBQUssTUFBTSxNQUFNLEVBQ2xDLE1BQU0sVUFBVSxLQUFLLE1BQU0sRUFDM0IsVUFBVSxFQUNWLGlCQUFpQjtBQUdwQixRQUFJLFVBQVU7QUFDWixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sTUFBTSx3QkFBd0IsV0FBVztBQUMvQyxVQUFNLGFBQWEsR0FBRyxNQUFNLE1BQU0sSUFBSSxNQUFNLElBQUksR0FBRztBQUNuRCxVQUFNLEtBQUssUUFBUSxNQUFNLFlBQVksTUFBTSxPQUFPLFdBQVc7QUFHN0QsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxHQUNmLFdBQVcsUUFBUSxFQUNuQixPQUFPO0FBQUEsUUFDTixTQUFTLE1BQU07QUFBQSxRQUNmO0FBQUEsUUFDQSxjQUFjO0FBQUEsUUFDZCxXQUFXLE1BQU0sTUFBTTtBQUFBLFFBQ3ZCLGFBQWE7QUFBQSxRQUNiLFdBQVc7QUFBQSxRQUNYLFlBQVk7QUFBQSxRQUNaLGFBQWE7QUFBQSxNQUNmLENBQWEsRUFDWixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsSUFDN0IsU0FBUyxLQUFLO0FBQ1osWUFBTSxLQUFLLFFBQVEsT0FBTyxVQUFVO0FBQ3BDLFlBQU07QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxZQUNKLFNBQ0EsUUFDNkI7QUFDN0IsV0FBTyxNQUFNLEtBQUssR0FDZixXQUFXLFFBQVEsRUFDbkIsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUIsS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFFQSxNQUFNLFVBQ0osU0FDQSxRQUM0RDtBQUM1RCxVQUFNLE9BQU8sTUFBTSxLQUFLLFlBQVksU0FBUyxNQUFNO0FBQ25ELFFBQUksQ0FBQyxLQUFNLFFBQU87QUFDbEIsVUFBTSxRQUFRLE1BQU0sS0FBSyxRQUFRLEtBQUssS0FBSyxXQUFXO0FBQ3RELFFBQUksQ0FBQyxNQUFPLFFBQU87QUFDbkIsV0FBTyxFQUFFLE9BQU8sYUFBYSxLQUFLLGFBQWE7QUFBQSxFQUNqRDtBQUFBLEVBRUEsTUFBTSxPQUFPLFNBQWlCLFFBQStCO0FBQzNELFVBQU0sTUFBTSxNQUFNLEtBQUssWUFBWSxTQUFTLE1BQU07QUFDbEQsUUFBSSxDQUFDLElBQUssT0FBTSxJQUFJLHFCQUFxQixtQkFBbUIsR0FBRztBQUMvRCxVQUFNLEtBQUssR0FDUixZQUFZLFFBQVEsRUFDcEIsSUFBSTtBQUFBLE1BQ0gsV0FBVyxJQUFJLFlBQVk7QUFBQSxNQUMzQixhQUFhO0FBQUEsSUFDZixDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUN4QixRQUFRO0FBQUEsRUFDYjtBQUFBLEVBRUEsTUFBTSxRQUFRLFNBQWlCLFFBQStCO0FBQzVELFVBQU0sTUFBTSxNQUFNLEtBQUssWUFBWSxTQUFTLE1BQU07QUFDbEQsUUFBSSxDQUFDLElBQUs7QUFDVixVQUFNLE9BQU8sS0FBSyxJQUFJLEdBQUcsSUFBSSxZQUFZLENBQUM7QUFDMUMsVUFBTSxLQUFLLEdBQ1IsWUFBWSxRQUFRLEVBQ3BCLElBQUk7QUFBQSxNQUNILFdBQVc7QUFBQSxNQUNYLGFBQWEsU0FBUyxLQUFJLG9CQUFJLEtBQUssR0FBRSxZQUFZLElBQUk7QUFBQSxJQUN2RCxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUN4QixRQUFRO0FBQ1gsUUFBSSxTQUFTLEdBQUc7QUFDZCxZQUFNLEtBQUssY0FBYyxPQUFPO0FBQUEsSUFDbEM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLGNBQWMsU0FBbUM7QUFDckQsVUFBTSxNQUFNLE1BQU0sS0FBSyxHQUNwQixXQUFXLFFBQVEsRUFDbkIsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUN4QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFFBQUksQ0FBQyxPQUFPLElBQUksWUFBWSxFQUFHLFFBQU87QUFDdEMsVUFBTSxLQUFLLFFBQVEsT0FBTyxJQUFJLFdBQVc7QUFDekMsVUFBTSxLQUFLLEdBQUcsV0FBVyxRQUFRLEVBQUUsTUFBTSxNQUFNLEtBQUssT0FBTyxFQUFFLFFBQVE7QUFDckUsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLE1BQU0sV0FBVyxRQUFnQixRQUFRLElBQTRCO0FBQ25FLFdBQU8sTUFBTSxLQUFLLEdBQ2YsV0FBVyxRQUFRLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxhQUFhLEtBQUssQ0FBQyxFQUN6QixRQUFRLGNBQWMsTUFBTSxFQUM1QixNQUFNLEtBQUssRUFDWCxVQUFVLEVBQ1YsUUFBUTtBQUFBLEVBQ2I7QUFDRjtBQUVPLElBQU0sdUJBQU4sY0FBbUMsTUFBTTtBQUFBLEVBQzlDLFlBQ0UsU0FDUyxRQUNUO0FBQ0EsVUFBTSxPQUFPO0FBRko7QUFHVCxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFFTyxTQUFTLDZCQUNkQSxLQUNtQjtBQUNuQixRQUFNLFVBQVUsMEJBQTBCO0FBQzFDLFNBQU8sSUFBSSxrQkFBa0JBLEtBQUksT0FBTztBQUMxQztBQUVPLFNBQVMsZ0JBQWdCLFNBQXlCO0FBQ3ZELFNBQU8sV0FBVyxPQUFPO0FBQzNCOzs7QUwvTEE7QUFLQTtBQWNPLElBQU0scUJBQU4sY0FBaUMsTUFBTTtBQUFBLEVBQzVDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBRUEsU0FBU0MsaUJBQXdCO0FBQy9CLFFBQU0sU0FBU0MsWUFBVyxFQUFFLElBQUksUUFBUTtBQUN4QyxNQUFJLE9BQU8sV0FBVyxVQUFVO0FBQzlCLFVBQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUFBLEVBQ25DO0FBQ0EsU0FBTztBQUNUO0FBd0ZBLFNBQVMsVUFBVSxPQUEwQjtBQUMzQyxNQUFJLFNBQVMsS0FBTSxRQUFPLENBQUM7QUFDM0IsTUFBSSxNQUFNLFFBQVEsS0FBSyxFQUFHLFFBQU8sTUFBTSxJQUFJLE1BQU07QUFDakQsTUFBSSxPQUFPLFVBQVUsVUFBVTtBQUM3QixRQUFJO0FBQ0YsWUFBTSxTQUFTLEtBQUssTUFBTSxLQUFLO0FBQy9CLGFBQU8sTUFBTSxRQUFRLE1BQU0sSUFBSSxPQUFPLElBQUksTUFBTSxJQUFJLENBQUM7QUFBQSxJQUN2RCxRQUFRO0FBQ04sYUFBTyxDQUFDO0FBQUEsSUFDVjtBQUFBLEVBQ0Y7QUFDQSxTQUFPLENBQUM7QUFDVjtBQUVBLFNBQVNDLGFBQVksT0FBa0M7QUFDckQsTUFBSSxTQUFTLEtBQU0sUUFBTyxDQUFDO0FBQzNCLE1BQUksT0FBTyxVQUFVLFVBQVU7QUFDN0IsUUFBSTtBQUNGLGFBQU8sS0FBSyxNQUFNLEtBQUs7QUFBQSxJQUN6QixRQUFRO0FBQ04sYUFBTyxDQUFDO0FBQUEsSUFDVjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLHdCQUF3QixLQUE0QztBQUMzRSxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxNQUFNLFVBQVUsSUFBSSxJQUFJO0FBQUEsSUFDeEIsV0FBVyxJQUFJLGlCQUNYLGdCQUFnQixJQUFJLGNBQWMsSUFDbEM7QUFBQSxJQUNKLE9BQU8sWUFBeUM7QUFDOUMsVUFBSSxJQUFJLGtCQUFrQixLQUFNLFFBQU87QUFDdkMsWUFBTSxPQUFPLDZCQUE2QixFQUFFO0FBQzVDLFlBQU0sUUFBUSxNQUFNLEtBQUssWUFBWSxJQUFJLGdCQUFnQixJQUFJLE9BQU87QUFDcEUsVUFBSSxDQUFDLE1BQU8sUUFBTztBQUNuQixhQUFPO0FBQUEsUUFDTCxHQUFHO0FBQUEsUUFDSCxLQUFLLGdCQUFnQixNQUFNLEVBQUU7QUFBQSxNQUMvQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxTQUFTLHVCQUF1QixLQUE4QztBQUM1RSxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxZQUFZLFlBQThDO0FBQ3hELFlBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxNQUFNLEtBQUssSUFBSSxvQkFBb0IsRUFDekMsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixhQUFPLE1BQU0sd0JBQXdCLEdBQUcsSUFBSTtBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxrQkFBa0IsS0FBZ0M7QUFDekQsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsUUFBUUEsYUFBWSxJQUFJLE1BQU07QUFBQSxJQUM5QixZQUFZLFlBQThDO0FBQ3hELFlBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxNQUFNLEtBQUssSUFBSSxvQkFBb0IsRUFDekMsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixhQUFPLE1BQU0sd0JBQXdCLEdBQUcsSUFBSTtBQUFBLElBQzlDO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyxlQUFlLEtBQThDO0FBQ3BFLFNBQU87QUFBQSxJQUNMLEdBQUc7QUFBQSxJQUNILFVBQ0UsT0FBTyxJQUFJLGFBQWEsV0FDcEIsS0FBSyxNQUFNLElBQUksUUFBUSxJQUN2QixJQUFJO0FBQUEsRUFDWjtBQUNGO0FBRUEsU0FBUyxhQUFhLE1BQXNCO0FBQzFDLFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFFBQVMsT0FBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFDN0QsTUFBSSxRQUFRLFNBQVMsSUFBSyxPQUFNLElBQUksbUJBQW1CLGVBQWU7QUFDdEUsU0FBTztBQUNUO0FBRU8sSUFBTSxjQUFjO0FBQUEsRUFDekIsbUJBQW1CLE9BQU8sU0FFUztBQUNqQyxVQUFNLFNBQVNGLGVBQWM7QUFDN0IsVUFBTSxTQUFTLEtBQUssVUFBVSxDQUFDO0FBQy9CLFFBQUksSUFBSSxHQUNMLFdBQVcsb0JBQW9CLEVBQy9CLE1BQU0sV0FBVyxLQUFLLE1BQU07QUFFL0IsUUFBSSxDQUFDLE9BQU8saUJBQWlCO0FBQzNCLFVBQUksRUFBRSxNQUFNLGVBQWUsTUFBTSxJQUFJO0FBQUEsSUFDdkM7QUFDQSxRQUFJLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDekIsWUFBTSxPQUFPLElBQUksT0FBTyxPQUFPLEtBQUssRUFBRSxZQUFZLENBQUM7QUFDbkQsVUFBSSxFQUFFO0FBQUEsUUFBTSxDQUFDLE9BQ1gsR0FBRyxHQUFHO0FBQUEsVUFDSixHQUFHLFFBQVEsU0FBUyxJQUFJO0FBQUEsVUFDeEIsR0FBRyxlQUFlLFNBQVMsSUFBSTtBQUFBLFVBQy9CLEdBQUcsWUFBWSxTQUFTLElBQUk7QUFBQSxRQUM5QixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0Y7QUFDQSxRQUFJLE9BQU8sVUFBVSxLQUFLLEdBQUc7QUFDM0IsVUFBSSxFQUFFLE1BQU0sWUFBWSxLQUFLLE9BQU8sU0FBUyxLQUFLLENBQUM7QUFBQSxJQUNyRDtBQUVBLFVBQU0sUUFBUSxLQUFLLElBQUksS0FBSyxJQUFJLE9BQU8sU0FBUyxLQUFLLENBQUMsR0FBRyxHQUFHO0FBQzVELFVBQU0sU0FBUyxLQUFLLElBQUksT0FBTyxVQUFVLEdBQUcsQ0FBQztBQUU3QyxVQUFNLE9BQU8sTUFBTSxFQUNoQixRQUFRLGNBQWMsS0FBSyxFQUMzQixRQUFRLFFBQVEsS0FBSyxFQUNyQixNQUFNLEtBQUssRUFDWCxPQUFPLE1BQU0sRUFDYixVQUFVLEVBQ1YsUUFBUTtBQUVYLFdBQU8sS0FBSyxJQUFJLHVCQUF1QjtBQUFBLEVBQ3pDO0FBQUEsRUFFQSxrQkFBa0IsT0FBTyxTQUVlO0FBQ3RDLFVBQU0sU0FBU0EsZUFBYztBQUM3QixVQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsb0JBQW9CLEVBQy9CLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFDcEIsV0FBTyxNQUFNLHdCQUF3QixHQUFHLElBQUk7QUFBQSxFQUM5QztBQUFBLEVBRUEsaUJBQWlCLE9BQU8sU0FFYztBQUNwQyxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxTQUFTLEtBQUssVUFBVSxDQUFDO0FBQy9CLFFBQUksSUFBSSxHQUNMLFdBQVcsa0JBQWtCLEVBQzdCO0FBQUEsTUFDQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixFQUNDLE1BQU0sNEJBQTRCLEtBQUssTUFBTTtBQUVoRCxRQUFJLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDekIsWUFBTSxPQUFPLElBQUksT0FBTyxPQUFPLEtBQUssRUFBRSxZQUFZLENBQUM7QUFDbkQsVUFBSSxFQUFFLE1BQU0sMkJBQTJCLFNBQVMsSUFBSTtBQUFBLElBQ3REO0FBQ0EsUUFBSSxPQUFPLGVBQWU7QUFDeEIsVUFBSSxFQUFFLE1BQU0sZ0NBQWdDLEtBQUssSUFBSTtBQUFBLElBQ3ZEO0FBRUEsVUFBTSxPQUFPLE9BQU8sUUFBUTtBQUM1QixRQUFJLFNBQVMsUUFBUTtBQUNuQixVQUFJLEVBQUUsUUFBUSwyQkFBMkIsS0FBSztBQUFBLElBQ2hELFdBQVcsU0FBUyxZQUFZO0FBQzlCLFVBQUksRUFBRSxRQUFRLDZCQUE2QixNQUFNO0FBQUEsSUFDbkQsT0FBTztBQUNMLFVBQUksRUFBRSxRQUFRLG1DQUFtQyxNQUFNO0FBQUEsSUFDekQ7QUFFQSxVQUFNLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxPQUFPLFNBQVMsS0FBSyxDQUFDLEdBQUcsR0FBRztBQUM1RCxVQUFNLFNBQVMsS0FBSyxJQUFJLE9BQU8sVUFBVSxHQUFHLENBQUM7QUFFN0MsVUFBTSxPQUFPLE1BQU0sRUFDaEIsVUFBVSxrQkFBa0IsRUFDNUIsTUFBTSxLQUFLLEVBQ1gsT0FBTyxNQUFNLEVBQ2IsUUFBUTtBQUVYLFdBQU8sS0FBSyxJQUFJLHNCQUFzQjtBQUFBLEVBQ3hDO0FBQUEsRUFFQSxlQUFlLE9BQU8sU0FFYztBQUNsQyxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxTQUFTLEtBQUssVUFBVSxDQUFDO0FBQy9CLFFBQUksSUFBSSxHQUNMLFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sV0FBVyxLQUFLLE1BQU07QUFFL0IsUUFBSSxPQUFPLGdCQUFnQixNQUFNO0FBQy9CLFVBQUksRUFBRSxNQUFNLHdCQUF3QixLQUFLLE9BQU8sWUFBWTtBQUFBLElBQzlEO0FBQ0EsUUFBSSxPQUFPLE1BQU0sS0FBSyxHQUFHO0FBQ3ZCLFVBQUksRUFBRSxNQUFNLFFBQVEsS0FBSyxPQUFPLEtBQUssS0FBSyxDQUFVO0FBQUEsSUFDdEQ7QUFFQSxVQUFNLFFBQVEsS0FBSyxJQUFJLEtBQUssSUFBSSxPQUFPLFNBQVMsSUFBSSxDQUFDLEdBQUcsR0FBRztBQUMzRCxVQUFNLFNBQVMsS0FBSyxJQUFJLE9BQU8sVUFBVSxHQUFHLENBQUM7QUFFN0MsVUFBTSxPQUFPLE1BQU0sRUFDaEIsUUFBUSxjQUFjLE1BQU0sRUFDNUIsUUFBUSxNQUFNLE1BQU0sRUFDcEIsTUFBTSxLQUFLLEVBQ1gsT0FBTyxNQUFNLEVBQ2IsVUFBVSxFQUNWLFFBQVE7QUFFWCxXQUFPLEtBQUssSUFBSSxjQUFjO0FBQUEsRUFDaEM7QUFBQSxFQUVBLGFBQWEsT0FBTyxTQUdTO0FBQzNCLFVBQU0sU0FBU0EsZUFBYztBQUM3QixVQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLGNBQWMsRUFDekIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLGVBQWUsS0FBSyxLQUFLLFVBQVUsRUFDekMsTUFBTSxhQUFhLEtBQUssS0FBSyxRQUFRLEVBQ3JDLFVBQVUsRUFDVixRQUFRO0FBQ1gsV0FBTyxLQUFLLElBQUksaUJBQWlCO0FBQUEsRUFDbkM7QUFBQSxFQUVBLGNBQWMsT0FBTyxTQUFvQztBQUN2RCxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxPQUFPLDZCQUE2QixFQUFFO0FBQzVDLFVBQU0sT0FBTyxNQUFNLEtBQUs7QUFBQSxNQUN0QjtBQUFBLE1BQ0EsS0FBSyxJQUFJLEtBQUssSUFBSSxLQUFLLFNBQVMsSUFBSSxDQUFDLEdBQUcsRUFBRTtBQUFBLElBQzVDO0FBQ0EsV0FBTyxLQUFLLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLEtBQUssZ0JBQWdCLEVBQUUsRUFBRSxFQUFFLEVBQUU7QUFBQSxFQUMvRDtBQUFBLEVBRUEsY0FBYyxPQUFPLFVBQWtDO0FBQ3JELFVBQU0sU0FBU0EsZUFBYztBQUM3QixVQUFNLEVBQUUsbUJBQUFHLG1CQUFrQixJQUFJLE1BQU07QUFDcEMsVUFBTSxZQUFZLE1BQU0sR0FDckIsV0FBVyxrQkFBa0IsRUFDN0I7QUFBQSxNQUNDO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxJQUNGLEVBQ0MsTUFBTSw0QkFBNEIsS0FBSyxNQUFNLEVBQzdDLE9BQU87QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDLEVBQ0EsUUFBUTtBQUVYLFVBQU0sY0FBYyxNQUFNLEdBQ3ZCLFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxRQUFRLEtBQUssTUFBTSxFQUN6QixRQUFRLGNBQWMsTUFBTSxFQUM1QixNQUFNLEVBQUUsRUFDUixVQUFVLEVBQ1YsUUFBUTtBQUVYLFdBQU9BLG1CQUFrQjtBQUFBLE1BQ3ZCLFdBQVcsVUFBVSxJQUFJLENBQUMsT0FBTztBQUFBLFFBQy9CLElBQUksRUFBRTtBQUFBLFFBQ04sVUFBVSxFQUFFO0FBQUEsUUFDWixzQkFBc0IsRUFBRTtBQUFBLFFBQ3hCLE1BQU0sRUFBRTtBQUFBLE1BQ1YsRUFBRTtBQUFBLE1BQ0Y7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0Y7QUFFTyxJQUFNLGlCQUFpQjtBQUFBLEVBQzVCLHdCQUF3QixPQUFPLFNBRUU7QUFDL0IsVUFBTSxTQUFTSCxlQUFjO0FBQzdCLFVBQU0sRUFBRSxNQUFNLElBQUk7QUFDbEIsVUFBTSxPQUFPLGFBQWEsTUFBTSxJQUFJO0FBQ3BDLFVBQU0sUUFBUSxtQkFBbUIsTUFBTSxLQUFLO0FBQzVDLFVBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUVuQyxRQUFJLE1BQU0sZ0JBQWdCLE1BQU07QUFDOUIsWUFBTSxPQUFPLDZCQUE2QixFQUFFO0FBQzVDLFlBQU0sUUFBUSxNQUFNLEtBQUssWUFBWSxNQUFNLGNBQWMsTUFBTTtBQUMvRCxVQUFJLENBQUMsTUFBTyxPQUFNLElBQUksbUJBQW1CLHVCQUF1QjtBQUNoRSxZQUFNLEtBQUssT0FBTyxNQUFNLGNBQWMsTUFBTTtBQUFBLElBQzlDO0FBRUEsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLG9CQUFvQixFQUMvQixPQUFPO0FBQUEsTUFDTixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0EsYUFBYSxNQUFNLGFBQWEsS0FBSyxLQUFLO0FBQUEsTUFDMUMsT0FBTyxNQUFNLE9BQU8sS0FBSyxLQUFLO0FBQUEsTUFDOUIsVUFBVSxNQUFNLFVBQVUsS0FBSyxLQUFLO0FBQUEsTUFDcEMsTUFBTSxLQUFLLFVBQVUsTUFBTSxRQUFRLENBQUMsQ0FBQztBQUFBLE1BQ3JDO0FBQUEsTUFDQSxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUs7QUFBQSxNQUM1QixnQkFBZ0IsTUFBTSxnQkFBZ0I7QUFBQSxNQUN0QyxXQUFXLE1BQU0sYUFBYTtBQUFBLE1BQzlCLGtCQUFrQixLQUFLLElBQUksR0FBRyxNQUFNLG1CQUFtQixDQUFDO0FBQUEsTUFDeEQsWUFBWSxNQUFNLGFBQWE7QUFBQSxNQUMvQixhQUFhO0FBQUEsTUFDYixZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsSUFDZCxDQUF3QixFQUN2QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFdBQU8sd0JBQXdCLEdBQUc7QUFBQSxFQUNwQztBQUFBLEVBRUEsd0JBQXdCLE9BQU8sU0FHRTtBQUMvQixVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0sR0FDcEIsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsU0FBVSxPQUFNLElBQUksbUJBQW1CLHNCQUFzQjtBQUVsRSxVQUFNLFFBQVEsS0FBSztBQUNuQixVQUFNLFFBQWlDO0FBQUEsTUFDckMsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDO0FBRUEsUUFBSSxNQUFNLFFBQVEsS0FBTSxPQUFNLE9BQU8sYUFBYSxNQUFNLElBQUk7QUFDNUQsUUFBSSxNQUFNLGdCQUFnQixRQUFXO0FBQ25DLFlBQU0sY0FBYyxNQUFNLGFBQWEsS0FBSyxLQUFLO0FBQUEsSUFDbkQ7QUFDQSxRQUFJLE1BQU0sVUFBVSxRQUFXO0FBQzdCLFlBQU0sUUFBUSxNQUFNLE9BQU8sS0FBSyxLQUFLO0FBQUEsSUFDdkM7QUFDQSxRQUFJLE1BQU0sYUFBYSxRQUFXO0FBQ2hDLFlBQU0sV0FBVyxNQUFNLFVBQVUsS0FBSyxLQUFLO0FBQUEsSUFDN0M7QUFDQSxRQUFJLE1BQU0sU0FBUyxRQUFXO0FBQzVCLFlBQU0sT0FBTyxLQUFLLFVBQVUsTUFBTSxRQUFRLENBQUMsQ0FBQztBQUFBLElBQzlDO0FBQ0EsUUFBSSxNQUFNLFNBQVMsS0FBTSxPQUFNLFFBQVEsbUJBQW1CLE1BQU0sS0FBSztBQUNyRSxRQUFJLE1BQU0sU0FBUyxPQUFXLE9BQU0sT0FBTyxNQUFNLE1BQU0sS0FBSyxLQUFLO0FBQ2pFLFFBQUksTUFBTSxhQUFhLEtBQU0sT0FBTSxZQUFZLE1BQU07QUFDckQsUUFBSSxNQUFNLG1CQUFtQixNQUFNO0FBQ2pDLFlBQU0sbUJBQW1CLEtBQUssSUFBSSxHQUFHLE1BQU0sZUFBZTtBQUFBLElBQzVEO0FBQ0EsUUFBSSxNQUFNLGFBQWEsS0FBTSxPQUFNLGFBQWEsTUFBTTtBQUV0RCxRQUFJLE1BQU0saUJBQWlCLFFBQVc7QUFDcEMsWUFBTSxPQUFPLDZCQUE2QixFQUFFO0FBQzVDLFVBQUksTUFBTSxnQkFBZ0IsTUFBTTtBQUM5QixjQUFNLFFBQVEsTUFBTSxLQUFLLFlBQVksTUFBTSxjQUFjLE1BQU07QUFDL0QsWUFBSSxDQUFDLE1BQU8sT0FBTSxJQUFJLG1CQUFtQix1QkFBdUI7QUFDaEUsWUFBSSxTQUFTLG1CQUFtQixNQUFNLGNBQWM7QUFDbEQsZ0JBQU0sS0FBSyxPQUFPLE1BQU0sY0FBYyxNQUFNO0FBQzVDLGNBQUksU0FBUyxrQkFBa0IsTUFBTTtBQUNuQyxrQkFBTSxLQUFLLFFBQVEsU0FBUyxnQkFBZ0IsTUFBTTtBQUFBLFVBQ3BEO0FBQUEsUUFDRjtBQUFBLE1BQ0YsV0FBVyxTQUFTLGtCQUFrQixNQUFNO0FBQzFDLGNBQU0sS0FBSyxRQUFRLFNBQVMsZ0JBQWdCLE1BQU07QUFBQSxNQUNwRDtBQUNBLFlBQU0saUJBQWlCLE1BQU07QUFBQSxJQUMvQjtBQUVBLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxvQkFBb0IsRUFDaEMsSUFBSSxLQUFLLEVBQ1QsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixXQUFPLHdCQUF3QixHQUFHO0FBQUEsRUFDcEM7QUFBQSxFQUVBLHlCQUF5QixPQUFPLFNBRUM7QUFDL0IsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxvQkFBb0IsRUFDaEMsSUFBSTtBQUFBLE1BQ0gsY0FBYSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ3BDLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsSUFBSyxPQUFNLElBQUksbUJBQW1CLHNCQUFzQjtBQUM3RCxXQUFPLHdCQUF3QixHQUFHO0FBQUEsRUFDcEM7QUFBQSxFQUVBLDJCQUEyQixPQUFPLFNBRUQ7QUFDL0IsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxvQkFBb0IsRUFDaEMsSUFBSTtBQUFBLE1BQ0gsYUFBYTtBQUFBLE1BQ2IsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixhQUFhLEVBQ2IsaUJBQWlCO0FBQ3BCLFFBQUksQ0FBQyxJQUFLLE9BQU0sSUFBSSxtQkFBbUIsc0JBQXNCO0FBQzdELFdBQU8sd0JBQXdCLEdBQUc7QUFBQSxFQUNwQztBQUFBLEVBRUEsd0JBQXdCLE9BQU8sU0FBeUI7QUFDdEQsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxrQkFBa0IsRUFDN0IsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLHdCQUF3QixLQUFLLEtBQUssRUFBRSxFQUMxQyxPQUFPLElBQUksRUFDWCxpQkFBaUI7QUFDcEIsUUFBSSxLQUFLO0FBQ1AsWUFBTSxJQUFJO0FBQUEsUUFDUjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsVUFBTSxXQUFXLE1BQU0sR0FDcEIsV0FBVyxvQkFBb0IsRUFDL0IsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsU0FBVSxRQUFPO0FBRXRCLFVBQU0sR0FDSCxXQUFXLG9CQUFvQixFQUMvQixNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRO0FBRVgsUUFBSSxTQUFTLGtCQUFrQixNQUFNO0FBQ25DLFlBQU0sT0FBTyw2QkFBNkIsRUFBRTtBQUM1QyxZQUFNLEtBQUssUUFBUSxTQUFTLGdCQUFnQixNQUFNO0FBQUEsSUFDcEQ7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRUEsa0JBQWtCLE9BQU8sU0FBMkM7QUFDbEUsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sRUFBRSxNQUFNLElBQUk7QUFDbEIsVUFBTSxhQUFhLE1BQU0sV0FBVyxLQUFLO0FBQ3pDLFFBQUksQ0FBQyxXQUFZLE9BQU0sSUFBSSxtQkFBbUIsd0JBQXdCO0FBQ3RFLFFBQUksQ0FBQyxPQUFPLFNBQVMsTUFBTSxRQUFRLEdBQUc7QUFDcEMsWUFBTSxJQUFJLG1CQUFtQixzQkFBc0I7QUFBQSxJQUNyRDtBQUVBLFVBQU0sYUFBYSxNQUFNLEdBQ3RCLFdBQVcsb0JBQW9CLEVBQy9CLE1BQU0sTUFBTSxLQUFLLE1BQU0sa0JBQWtCLEVBQ3pDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsV0FBWSxPQUFNLElBQUksbUJBQW1CLHNCQUFzQjtBQUVwRSxRQUFJLGVBQWUsWUFBWTtBQUM3QixZQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxNQUFNLFFBQVEsRUFDL0IsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixPQUFPLElBQUksRUFDWCxpQkFBaUI7QUFDcEIsVUFBSSxDQUFDLElBQUssT0FBTSxJQUFJLG1CQUFtQixvQkFBb0I7QUFBQSxJQUM3RCxXQUFXLGVBQWUsUUFBUTtBQUNoQyxZQUFNLE9BQU8sTUFBTSxHQUNoQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxNQUFNLEtBQUssTUFBTSxRQUFRLEVBQy9CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsT0FBTyxJQUFJLEVBQ1gsaUJBQWlCO0FBQ3BCLFVBQUksQ0FBQyxLQUFNLE9BQU0sSUFBSSxtQkFBbUIsZ0JBQWdCO0FBQUEsSUFDMUQ7QUFFQSxRQUFJSSxVQUEyQixDQUFDO0FBQ2hDLFFBQUksTUFBTSxZQUFZLEtBQUssR0FBRztBQUM1QixVQUFJO0FBQ0YsUUFBQUEsVUFBUyxLQUFLLE1BQU0sTUFBTSxVQUFVO0FBQUEsTUFDdEMsUUFBUTtBQUNOLGNBQU0sSUFBSSxtQkFBbUIsK0JBQStCO0FBQUEsTUFDOUQ7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLE1BQU0sUUFBUTtBQUMzQixVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLGNBQWMsRUFDekIsT0FBTztBQUFBLE1BQ04sU0FBUztBQUFBLE1BQ1QsYUFBYTtBQUFBLE1BQ2IsV0FBVyxNQUFNO0FBQUEsTUFDakIsc0JBQXNCLE1BQU07QUFBQSxNQUM1QixVQUFVLEtBQUssSUFBSSxHQUFHLE1BQU0sWUFBWSxDQUFDO0FBQUEsTUFDekM7QUFBQSxNQUNBLFFBQVEsS0FBSyxVQUFVQSxPQUFNO0FBQUEsTUFDN0IsU0FBUyxNQUFNLFdBQVc7QUFBQSxNQUMxQixZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsSUFDZCxDQUFrQixFQUNqQixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFdBQU8sa0JBQWtCLEdBQUc7QUFBQSxFQUM5QjtBQUFBLEVBRUEsa0JBQWtCLE9BQU8sU0FBeUI7QUFDaEQsVUFBTSxTQUFTSixlQUFjO0FBQzdCLFVBQU1LLFVBQVMsTUFBTSxHQUNsQixXQUFXLGNBQWMsRUFDekIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUTtBQUNYLFdBQU9BLFFBQU8sU0FBUztBQUFBLEVBQ3pCO0FBQUEsRUFFQSxlQUFlLE9BQU8sU0FBd0M7QUFDNUQsVUFBTSxTQUFTTCxlQUFjO0FBQzdCLFVBQU0sV0FBVyxLQUFLLElBQUksR0FBRyxLQUFLLE1BQU0sWUFBWSxDQUFDO0FBQ3JELFVBQU0sVUFBVSxJQUFJLG1CQUFtQjtBQUN2QyxRQUFJO0FBQ0YsWUFBTSxFQUFFLFdBQVcsWUFBWSxJQUFJLE1BQU0sR0FDdEMsWUFBWSxFQUNaLFFBQVEsT0FBTyxRQUFRO0FBQ3RCLGVBQU8sTUFBTSxRQUFRO0FBQUEsVUFDbkI7QUFBQSxVQUNBO0FBQUEsVUFDQSxLQUFLLE1BQU07QUFBQSxVQUNYO0FBQUEsVUFDQSxLQUFLLE1BQU07QUFBQSxRQUNiO0FBQUEsTUFDRixDQUFDO0FBQ0gsYUFBTztBQUFBLFFBQ0wsV0FBVyxZQUFZLHVCQUF1QixTQUFTLElBQUk7QUFBQSxRQUMzRCxhQUFhLGVBQWUsV0FBVztBQUFBLE1BQ3pDO0FBQUEsSUFDRixTQUFTLEtBQUs7QUFDWixVQUFJLGVBQWUsZ0JBQWdCO0FBQ2pDLGNBQU0sSUFBSSxtQkFBbUIsSUFBSSxPQUFPO0FBQUEsTUFDMUM7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUF3QztBQUM1RCxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxXQUFXLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxZQUFZLENBQUM7QUFDckQsVUFBTSxVQUFVLElBQUksbUJBQW1CO0FBQ3ZDLFFBQUk7QUFDRixZQUFNLEVBQUUsV0FBVyxZQUFZLElBQUksTUFBTSxHQUN0QyxZQUFZLEVBQ1osUUFBUSxPQUFPLFFBQVE7QUFDdEIsZUFBTyxNQUFNLFFBQVE7QUFBQSxVQUNuQjtBQUFBLFVBQ0E7QUFBQSxVQUNBLEtBQUssTUFBTTtBQUFBLFVBQ1g7QUFBQSxRQUNGO0FBQUEsTUFDRixDQUFDO0FBQ0gsYUFBTztBQUFBLFFBQ0wsV0FBVyxZQUFZLHVCQUF1QixTQUFTLElBQUk7QUFBQSxRQUMzRCxhQUFhLGVBQWUsV0FBVztBQUFBLE1BQ3pDO0FBQUEsSUFDRixTQUFTLEtBQUs7QUFDWixVQUFJLGVBQWUsZ0JBQWdCO0FBQ2pDLGNBQU0sSUFBSSxtQkFBbUIsSUFBSSxPQUFPO0FBQUEsTUFDMUM7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUFvQztBQUN4RCxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxVQUFVLElBQUksbUJBQW1CO0FBQ3ZDLFFBQUk7QUFDRixZQUFNLEVBQUUsV0FBVyxZQUFZLElBQUksTUFBTSxHQUN0QyxZQUFZLEVBQ1osUUFBUSxPQUFPLFFBQVE7QUFDdEIsZUFBTyxNQUFNLFFBQVEsYUFBYSxLQUFLLFFBQVEsS0FBSyxhQUFhO0FBQUEsTUFDbkUsQ0FBQztBQUNILGFBQU87QUFBQSxRQUNMLFdBQVcsdUJBQXVCLFNBQVM7QUFBQSxRQUMzQyxhQUFhLGVBQWUsV0FBVztBQUFBLE1BQ3pDO0FBQUEsSUFDRixTQUFTLEtBQUs7QUFDWixVQUFJLGVBQWUsZ0JBQWdCO0FBQ2pDLGNBQU0sSUFBSSxtQkFBbUIsSUFBSSxPQUFPO0FBQUEsTUFDMUM7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLG1CQUFtQixPQUFPLFNBQTRDO0FBQ3BFLFVBQU0sU0FBU0EsZUFBYztBQUM3QixVQUFNLFdBQVcsS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLFlBQVksQ0FBQztBQUNyRCxVQUFNLGFBQWEsTUFBTSxHQUN0QixXQUFXLG9CQUFvQixFQUMvQixNQUFNLE1BQU0sS0FBSyxLQUFLLE1BQU0sa0JBQWtCLEVBQzlDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsV0FBWSxPQUFNLElBQUksbUJBQW1CLHNCQUFzQjtBQUVwRSxVQUFNLFVBQVUsTUFBTSxHQUFHLFlBQVksRUFBRSxRQUFRLE9BQU8sUUFBUTtBQUM1RCxhQUFPLE1BQU0sbUJBQW1CLE1BQU0sS0FBSyxRQUFRO0FBQUEsUUFDakQ7QUFBQSxVQUNFLFFBQVE7QUFBQSxVQUNSLGNBQWMsV0FBVztBQUFBLFVBQ3pCO0FBQUEsVUFDQSxZQUFZLFVBQVUsS0FBSyxJQUFJLENBQUMsSUFBSSxPQUFPLFdBQVcsQ0FBQztBQUFBLFVBQ3ZELFlBQVk7QUFBQSxVQUNaLFVBQVU7QUFBQSxRQUNaO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSCxDQUFDO0FBRUQsVUFBTSxLQUFLLFFBQVEsQ0FBQyxHQUFHO0FBQ3ZCLFdBQU8sS0FBSyxlQUFlLEVBQUUsSUFBSTtBQUFBLEVBQ25DO0FBQUEsRUFFQSwwQkFBMEIsWUFBWTtBQUNwQyxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSw2QkFBNkIsSUFBSSxNQUFNO0FBQzdDLFdBQU87QUFBQSxFQUNUO0FBQ0Y7OztBaEJydUJBO0FBR0E7QUFvRUEsU0FBU00saUJBQXdCO0FBQy9CLFFBQU0sU0FBU0MsWUFBVyxFQUFFLElBQUksUUFBUTtBQUN4QyxNQUFJLE9BQU8sV0FBVyxVQUFVO0FBQzlCLFVBQU0sSUFBSSxNQUFNLGlCQUFpQjtBQUFBLEVBQ25DO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBU0MsYUFBWUMsU0FBaUU7QUFDcEYsTUFBSTtBQUNGLFdBQU8sT0FBT0EsWUFBVyxXQUFXLEtBQUssTUFBTUEsT0FBTSxJQUFJQTtBQUFBLEVBQzNELFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRUEsZUFBZSx1QkFBdUIsWUFBb0I7QUFDeEQsU0FBTyxNQUFNLEdBQ1YsV0FBVyxxQkFBcUIsRUFDaEMsTUFBTSxlQUFlLEtBQUssVUFBVSxFQUNwQyxVQUFVLEVBQ1YsaUJBQWlCO0FBQ3RCO0FBRUEsZUFBZSxrQkFBa0IsU0FBaUIsUUFBZ0I7QUFDaEUsU0FBTyxNQUFNLEdBQ1YsV0FBVyxRQUFRLEVBQ25CLE1BQU0sTUFBTSxLQUFLLE9BQU8sRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3RCO0FBTUEsZUFBZSxlQUNiLFNBQ0EsUUFDb0M7QUFDcEMsTUFBSSxZQUFZLE9BQVcsUUFBTztBQUNsQyxNQUFJLFlBQVksS0FBTSxRQUFPO0FBRTdCLFFBQU0sUUFBUSxNQUFNLGtCQUFrQixTQUFTLE1BQU07QUFDckQsTUFBSSxDQUFDLE9BQU87QUFDVixVQUFNLElBQUksa0JBQWtCLGlCQUFpQjtBQUFBLEVBQy9DO0FBQ0EsU0FBTyxNQUFNO0FBQ2Y7QUFFQSxlQUFlLG1CQUFtQixZQUFvQixRQUFnQjtBQUNwRSxTQUFPLE1BQU0sR0FDVixXQUFXLFlBQVksRUFDdkIsTUFBTSxNQUFNLEtBQUssVUFBVSxFQUMzQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFDdEI7QUFLQSxTQUFTLHNCQUFzQixVQUFpQztBQUM5RCxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxtQkFBbUIsWUFBcUQ7QUFDdEUsVUFBSSxDQUFDLFNBQVMsYUFBYyxRQUFPO0FBQ25DLFlBQU0sVUFBVSxNQUFNLHVCQUF1QixTQUFTLEVBQUU7QUFDeEQsVUFBSSxDQUFDLFFBQVMsUUFBTztBQUNyQixZQUFNQSxVQUFTRCxhQUFZLFFBQVEsTUFBTTtBQUN6QyxVQUFJLENBQUNDLFFBQVEsUUFBTztBQUNwQixhQUFPLEVBQUUsR0FBRyxTQUFTLFFBQUFBLFFBQU87QUFBQSxJQUM5QjtBQUFBLElBQ0EsT0FBTyxZQUFtQztBQUN4QyxVQUFJLFNBQVMsWUFBWSxLQUFNLFFBQU87QUFDdEMsYUFBTyxNQUFNLEdBQ1YsV0FBVyxRQUFRLEVBQ25CLE1BQU0sTUFBTSxLQUFLLFNBQVMsUUFBUSxFQUNsQyxVQUFVLEVBQ1YsaUJBQWlCLEtBQUs7QUFBQSxJQUMzQjtBQUFBLEVBQ0Y7QUFDRjtBQUVPLElBQU0sUUFBUTtBQUFBLEVBQ25CLFFBQVEsT0FBTyxTQUFtRDtBQUVoRSxVQUFNLFNBQVNILGVBQWM7QUFDN0IsV0FBTyxNQUFNLEdBQ1YsV0FBVyxRQUFRLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUSxRQUFRLEtBQUssRUFDckIsVUFBVSxFQUNWLFFBQVE7QUFBQSxFQUNiO0FBQUEsRUFFQSxPQUFPLE9BQU8sU0FBZ0Q7QUFDNUQsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sRUFBRSxHQUFHLElBQUk7QUFDZixXQUFPLE1BQU0sR0FDVixXQUFXLFFBQVEsRUFDbkIsTUFBTSxNQUFNLEtBQUssRUFBRSxFQUNuQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUIsS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFFQSxZQUFZLE9BQU8sU0FBc0Q7QUFFdkUsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFVBQU0sT0FBTyxNQUFNLEdBQ2hCLFdBQVcsWUFBWSxFQUN2QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixRQUFRO0FBQ1gsV0FBTyxLQUFLLElBQUkscUJBQXFCO0FBQUEsRUFDdkM7QUFBQSxFQUVBLFVBQVUsT0FBTyxTQUFtRDtBQUNsRSxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxFQUFFLEdBQUcsSUFBSTtBQUNmLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxZQUFZLEVBQ3ZCLE1BQU0sTUFBTSxLQUFLLEVBQUUsRUFDbkIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFdBQU8sTUFBTSxzQkFBc0IsR0FBRyxJQUFJO0FBQUEsRUFDNUM7QUFBQSxFQUVBLHFCQUFxQixPQUFPLFNBSVM7QUFDbkMsVUFBTSxTQUFTQSxlQUFjO0FBQzdCLFFBQUksUUFBUSxHQUNULFdBQVcsc0JBQXNCLEVBQ2pDLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUSxtQkFBbUIsTUFBTSxFQUNqQyxVQUFVO0FBRWIsUUFBSSxNQUFNLGNBQWMsTUFBTTtBQUM1QixjQUFRLE1BQU0sTUFBTSxlQUFlLEtBQUssS0FBSyxVQUFVO0FBQUEsSUFDekQ7QUFDQSxRQUFJLE1BQU0sVUFBVTtBQUNsQixjQUFRLE1BQU0sTUFBTSxtQkFBbUIsTUFBTSxLQUFLLFFBQVE7QUFBQSxJQUM1RDtBQUNBLFFBQUksTUFBTSxRQUFRO0FBQ2hCLGNBQVEsTUFBTSxNQUFNLG1CQUFtQixNQUFNLEtBQUssTUFBTTtBQUFBLElBQzFEO0FBQ0EsV0FBTyxNQUFNLE1BQU0sUUFBUTtBQUFBLEVBQzdCO0FBQUEsRUFFQSxHQUFHO0FBQUEsRUFDSCxHQUFHO0FBQ0w7QUFFTyxJQUFNLFdBQVc7QUFBQSxFQUN0QixhQUFhLE9BQU8sU0FBc0Q7QUFDeEUsVUFBTSxFQUFFLE1BQU0sSUFBSTtBQUNsQixVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxPQUFPLGtCQUFrQixNQUFNLElBQUk7QUFDekMsVUFBTSxRQUFRLG1CQUFtQixNQUFNLEtBQUs7QUFDNUMsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFdBQU8sTUFBTSxHQUNWLFdBQVcsUUFBUSxFQUNuQixPQUFPO0FBQUEsTUFDTixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVk7QUFBQSxNQUNaLFlBQVk7QUFBQSxJQUNkLENBQWEsRUFDWixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsRUFDN0I7QUFBQSxFQUVBLGFBQWEsT0FDWCxTQUNtQjtBQUNuQixVQUFNLEVBQUUsSUFBSSxNQUFNLElBQUk7QUFDdEIsVUFBTSxTQUFTQSxlQUFjO0FBRTdCLFVBQU0sV0FBVyxNQUFNLEdBQ3BCLFdBQVcsUUFBUSxFQUNuQixNQUFNLE1BQU0sS0FBSyxFQUFFLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLHdCQUF3QjtBQUUzQixVQUFNLE9BQU8sTUFBTSxTQUFTLFNBQ3hCLGtCQUFrQixNQUFNLElBQUksSUFDNUIsU0FBUztBQUNiLFVBQU0sUUFBUSxNQUFNLFVBQVUsU0FDMUIsbUJBQW1CLE1BQU0sS0FBSyxJQUM5QixTQUFTO0FBRWIsV0FBTyxNQUFNLEdBQ1YsWUFBWSxRQUFRLEVBQ3BCLElBQUk7QUFBQSxNQUNIO0FBQUEsTUFDQTtBQUFBLE1BQ0EsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxFQUFFLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUFBLEVBQzdCO0FBQUEsRUFFQSxhQUFhLE9BQU8sU0FBeUI7QUFDM0MsVUFBTSxFQUFFLEdBQUcsSUFBSTtBQUNmLFVBQU0sU0FBU0EsZUFBYztBQUU3QixVQUFNSSxVQUFTLE1BQU0sR0FDbEIsV0FBVyxRQUFRLEVBQ25CLE1BQU0sTUFBTSxLQUFLLEVBQUUsRUFDbkIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRO0FBRVgsV0FBT0EsUUFBTyxTQUFTO0FBQUEsRUFDekI7QUFBQSxFQUVBLGdCQUFnQixPQUNkLFNBQ3NCO0FBQ3RCLFVBQU0sRUFBRSxNQUFNLElBQUk7QUFDbEIsVUFBTSxTQUFTSixlQUFjO0FBRTdCLDZCQUF5QjtBQUFBLE1BQ3ZCLGFBQWEsTUFBTTtBQUFBLE1BQ25CLE1BQU0sTUFBTTtBQUFBLE1BQ1osbUJBQW1CLE1BQU07QUFBQSxJQUMzQixDQUFDO0FBRUQsVUFBTSxzQkFBc0I7QUFBQSxNQUMxQixNQUFNO0FBQUEsSUFDUjtBQUNBLFVBQU0sVUFBVSxNQUFNLGVBQWUsTUFBTSxXQUFXLE1BQU0sTUFBTTtBQUVsRSxVQUFNLFdBQVcsTUFBTSxHQUFHLFlBQVksRUFBRSxRQUFRLE9BQU8sUUFBK0I7QUFDcEYsWUFBTUssWUFBVyxNQUFNLElBQ3BCLFdBQVcsWUFBWSxFQUN2QixPQUFPO0FBQUEsUUFDTixTQUFTO0FBQUEsUUFDVCxPQUFPLE1BQU07QUFBQSxRQUNiLGFBQWEsTUFBTTtBQUFBLFFBQ25CLFlBQVksTUFBTTtBQUFBLFFBQ2xCLFVBQVUsTUFBTTtBQUFBLFFBQ2hCLGNBQWMsTUFBTTtBQUFBLFFBQ3BCLE1BQU0sTUFBTSxjQUFjLE9BQVEsTUFBTSxRQUFRO0FBQUEsUUFDaEQsVUFBVSxXQUFXO0FBQUEsUUFDckIsc0JBQXNCO0FBQUEsTUFDeEIsQ0FBZ0IsRUFDZixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFVBQUksTUFBTSxlQUFlLE1BQU0sbUJBQW1CO0FBQ2hELGNBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUNuQyxjQUFNLElBQ0gsV0FBVyxxQkFBcUIsRUFDaEMsT0FBTztBQUFBLFVBQ04sYUFBYUEsVUFBUztBQUFBLFVBQ3RCLGlCQUFpQixNQUFNLGtCQUFrQjtBQUFBLFVBQ3pDLFFBQVEsS0FBSyxVQUFVLE1BQU0sa0JBQWtCLE1BQU07QUFBQSxVQUNyRCxZQUFZO0FBQUEsVUFDWixZQUFZO0FBQUEsUUFDZCxDQUF5QixFQUN4QixRQUFRO0FBQUEsTUFDYjtBQUVBLGFBQU9BO0FBQUEsSUFDVCxDQUFDO0FBRUQsV0FBTyxzQkFBc0IsUUFBUTtBQUFBLEVBQ3ZDO0FBQUEsRUFFQSxnQkFBZ0IsT0FDZCxTQUNzQjtBQUN0QixVQUFNLEVBQUUsSUFBSSxNQUFNLElBQUk7QUFDdEIsVUFBTSxTQUFTTCxlQUFjO0FBRTdCLFVBQU0sV0FBVyxNQUFNLEdBQ3BCLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxFQUFFLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLHdCQUF3QjtBQUUzQixVQUFNLGNBQWMsTUFBTSxlQUFlLFNBQVM7QUFDbEQsVUFBTSxPQUFPLE1BQU0sU0FBUyxTQUFZLE1BQU0sT0FBTyxTQUFTO0FBSTlELFFBQUksb0JBQStELE1BQU07QUFDekUsUUFBSSxlQUFlLENBQUMsbUJBQW1CO0FBQ3JDLFlBQU0sa0JBQWtCLE1BQU0sdUJBQXVCLEVBQUU7QUFDdkQsVUFBSSxpQkFBaUI7QUFDbkIsY0FBTUcsVUFBU0QsYUFBWSxnQkFBZ0IsTUFBTTtBQUNqRCw0QkFBb0JDLFVBQ2hCLEVBQUUsZ0JBQWdCLGdCQUFnQixpQkFBaUIsUUFBQUEsUUFBTyxJQUMxRDtBQUFBLE1BQ047QUFBQSxJQUNGO0FBRUEsNkJBQXlCLEVBQUUsYUFBYSxNQUFNLGtCQUFrQixDQUFDO0FBRWpFLFVBQU0sa0JBQWtCLE1BQU0sWUFBWSxTQUN0QyxNQUFNLGVBQWUsTUFBTSxTQUFTLE1BQU0sSUFDMUM7QUFFSixVQUFNLHNCQUFzQixNQUFNLHdCQUF3QixTQUN0RCw2QkFBNkIsTUFBTSxtQkFBbUIsSUFDdEQ7QUFFSixVQUFNLFdBQVcsTUFBTSxHQUFHLFlBQVksRUFBRSxRQUFRLE9BQU8sUUFBK0I7QUFDcEYsWUFBTUUsWUFBVyxNQUFNLElBQ3BCLFlBQVksWUFBWSxFQUN4QixJQUFJO0FBQUEsUUFDSCxPQUFPLE1BQU07QUFBQSxRQUNiLGFBQWEsTUFBTTtBQUFBLFFBQ25CLFlBQVksTUFBTTtBQUFBLFFBQ2xCLFVBQVUsTUFBTTtBQUFBLFFBQ2hCLGNBQWM7QUFBQSxRQUNkLE1BQU0sY0FBYyxPQUFRLFFBQVE7QUFBQSxRQUNwQyxHQUFJLG9CQUFvQixTQUFZLEVBQUUsVUFBVSxnQkFBZ0IsSUFBSSxDQUFDO0FBQUEsUUFDckUsR0FBSSx3QkFBd0IsU0FDeEIsRUFBRSxzQkFBc0Isb0JBQW9CLElBQzVDLENBQUM7QUFBQSxRQUNMLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxNQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssRUFBRSxFQUNuQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsVUFBSSxlQUFlLE1BQU0sbUJBQW1CO0FBQzFDLGNBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUNuQyxjQUFNLElBQ0gsV0FBVyxxQkFBcUIsRUFDaEMsT0FBTztBQUFBLFVBQ04sYUFBYUEsVUFBUztBQUFBLFVBQ3RCLGlCQUFpQixNQUFNLGtCQUFrQjtBQUFBLFVBQ3pDLFFBQVEsS0FBSyxVQUFVLE1BQU0sa0JBQWtCLE1BQU07QUFBQSxVQUNyRCxZQUFZO0FBQUEsVUFDWixZQUFZO0FBQUEsUUFDZCxDQUF5QixFQUN4QjtBQUFBLFVBQVcsQ0FBQyxPQUNYLEdBQUcsUUFBUSxDQUFDLGFBQWEsQ0FBQyxFQUFFLFlBQVk7QUFBQSxZQUN0QyxpQkFBaUIsTUFBTSxrQkFBbUI7QUFBQSxZQUMxQyxRQUFRLEtBQUssVUFBVSxNQUFNLGtCQUFtQixNQUFNO0FBQUEsWUFDdEQsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLFVBQ3JDLENBQUM7QUFBQSxRQUNILEVBQ0MsUUFBUTtBQUFBLE1BQ2IsV0FBVyxDQUFDLGFBQWE7QUFFdkIsY0FBTSxJQUNILFdBQVcscUJBQXFCLEVBQ2hDLE1BQU0sZUFBZSxLQUFLQSxVQUFTLEVBQUUsRUFDckMsUUFBUTtBQUFBLE1BQ2I7QUFFQSxhQUFPQTtBQUFBLElBQ1QsQ0FBQztBQUVELFdBQU8sc0JBQXNCLFFBQVE7QUFBQSxFQUN2QztBQUFBLEVBRUEsZ0JBQWdCLE9BQ2QsU0FDRztBQUNILFVBQU0sRUFBRSxHQUFHLElBQUk7QUFDZixVQUFNLFNBQVNMLGVBQWM7QUFFN0IsVUFBTUksVUFBUyxNQUFNLEdBQ2xCLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxFQUFFLEVBQ25CLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUTtBQUVYLFdBQU9BLFFBQU8sU0FBUztBQUFBLEVBQ3pCO0FBQUEsRUFFQSxrQkFBa0IsT0FBTyxTQUVjO0FBQ3JDLFVBQU0sU0FBU0osZUFBYztBQUM3QixVQUFNLEVBQUUsTUFBTSxJQUFJO0FBQ2xCLFVBQU0saUJBQWlCLHVCQUF1QixNQUFNLGNBQWM7QUFDbEUsVUFBTSxrQkFBa0Isd0JBQXdCLE1BQU0sZUFBZTtBQUVyRSxVQUFNLFdBQVcsTUFBTSxtQkFBbUIsTUFBTSxZQUFZLE1BQU07QUFDbEUsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUksdUJBQXVCLG9CQUFvQjtBQUFBLElBQ3ZEO0FBRUEsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sYUFBYSxNQUFNLEdBQUcsWUFBWSxFQUFFLFFBQVEsT0FBTyxRQUFRO0FBQy9ELFlBQU0sV0FBVyxNQUFNLElBQ3BCLFdBQVcsc0JBQXNCLEVBQ2pDLE1BQU0sZUFBZSxLQUFLLFNBQVMsRUFBRSxFQUNyQyxNQUFNLG1CQUFtQixLQUFLLGNBQWMsRUFDNUMsVUFBVSxFQUNWLGlCQUFpQjtBQUVwQixVQUFJLFVBQVU7QUFDWixjQUFNLElBQ0gsV0FBVyxhQUFhLEVBQ3hCLE1BQU0saUJBQWlCLEtBQUssU0FBUyxFQUFFLEVBQ3ZDLFFBQVE7QUFBQSxNQUNiO0FBRUEsWUFBTU0sY0FBYSxNQUFNLElBQ3RCLFdBQVcsc0JBQXNCLEVBQ2pDLE9BQU87QUFBQSxRQUNOLGFBQWEsU0FBUztBQUFBLFFBQ3RCLFNBQVM7QUFBQSxRQUNULGlCQUFpQjtBQUFBLFFBQ2pCLGtCQUFrQjtBQUFBLFFBQ2xCLGNBQWM7QUFBQSxRQUNkLFVBQVUsTUFBTSxRQUNaLEtBQUssVUFBVSxFQUFFLE9BQU8sTUFBTSxPQUFPLE9BQU8sU0FBUyxNQUFNLENBQUMsSUFDNUQsS0FBSyxVQUFVLEVBQUUsT0FBTyxTQUFTLE1BQU0sQ0FBQztBQUFBLE1BQzlDLENBQTBCLEVBQ3pCO0FBQUEsUUFBVyxDQUFDLE9BQ1gsR0FBRyxRQUFRLENBQUMsZUFBZSxpQkFBaUIsQ0FBQyxFQUFFLFlBQVk7QUFBQSxVQUN6RCxrQkFBa0I7QUFBQSxVQUNsQixjQUFjO0FBQUEsVUFDZCxVQUFVLE1BQU0sUUFDWixLQUFLLFVBQVUsRUFBRSxPQUFPLE1BQU0sT0FBTyxPQUFPLFNBQVMsTUFBTSxDQUFDLElBQzVELEtBQUssVUFBVSxFQUFFLE9BQU8sU0FBUyxNQUFNLENBQUM7QUFBQSxRQUM5QyxDQUFDO0FBQUEsTUFDSCxFQUNDLGFBQWEsRUFDYix3QkFBd0I7QUFHM0IsWUFBTSxJQUNILFdBQVcsYUFBYSxFQUN4QixPQUFPO0FBQUEsUUFDTixTQUFTO0FBQUEsUUFDVCxhQUFhO0FBQUEsUUFDYixhQUFhLFNBQVM7QUFBQSxRQUN0QixVQUFVLFNBQVM7QUFBQSxRQUNuQixlQUFlQSxZQUFXO0FBQUEsUUFDMUIsYUFBYTtBQUFBLFFBQ2IsaUJBQWlCO0FBQUEsUUFDakIsUUFBUTtBQUFBLFFBQ1IsUUFBUTtBQUFBLFFBQ1IsVUFBVTtBQUFBLFFBQ1YsWUFBWTtBQUFBLE1BQ2QsQ0FBaUIsRUFDaEIsUUFBUTtBQUdYLFVBQUksVUFBVTtBQUNkLFVBQUksV0FBVyxNQUFNO0FBRW5CLGNBQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxTQUFTLFdBQVcsTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNO0FBQzFELGNBQU0sQ0FBQyxJQUFJLEVBQUUsSUFBSSxTQUFTLFNBQVMsTUFBTSxHQUFHLEVBQUUsSUFBSSxNQUFNO0FBQ3hELGNBQU0sVUFBVyxLQUFLLEtBQUssTUFBTyxLQUFLLEtBQUs7QUFDNUMsWUFBSSxVQUFVLEVBQUcsV0FBVTtBQUFBLE1BQzdCO0FBQ0EsVUFBSSxXQUFXLFFBQVEsVUFBVSxHQUFHO0FBQ2xDLGNBQU0sSUFDSCxXQUFXLGFBQWEsRUFDeEIsT0FBTztBQUFBLFVBQ04sU0FBUztBQUFBLFVBQ1QsYUFBYTtBQUFBLFVBQ2IsYUFBYSxTQUFTO0FBQUEsVUFDdEIsVUFBVSxTQUFTO0FBQUEsVUFDbkIsZUFBZUEsWUFBVztBQUFBLFVBQzFCLGFBQWE7QUFBQSxVQUNiLGlCQUFpQjtBQUFBLFVBQ2pCLFFBQVE7QUFBQSxVQUNSLFFBQVE7QUFBQSxVQUNSLFVBQVU7QUFBQSxVQUNWLFlBQVk7QUFBQSxRQUNkLENBQWlCLEVBQ2hCLFFBQVE7QUFBQSxNQUNiO0FBRUEsYUFBT0E7QUFBQSxJQUNULENBQUM7QUFFRCxVQUFNLHdCQUF3QixJQUFJLFFBQVE7QUFBQSxNQUN4QyxZQUFZLFNBQVM7QUFBQSxNQUNyQixTQUFTLFNBQVM7QUFBQSxJQUNwQixDQUFDO0FBRUQsVUFBTSxVQUFVLE1BQU0sR0FBRyxZQUFZLEVBQUUsUUFBUSxPQUFPLFFBQVE7QUFDNUQsYUFBTyxNQUFNLGtDQUFrQyxLQUFLO0FBQUEsUUFDbEQ7QUFBQSxRQUNBLFlBQVksU0FBUztBQUFBLFFBQ3JCLGNBQWMsV0FBVztBQUFBLE1BQzNCLENBQUM7QUFBQSxJQUNILENBQUM7QUFFRCxXQUFPO0FBQUEsTUFDTCxHQUFHO0FBQUEsTUFDSCxnQkFBZ0IsUUFDYixPQUFPLENBQUMsTUFBTSxDQUFDLEVBQUUsV0FBVyxFQUFFLFdBQVcsRUFDekMsSUFBSSxDQUFDLE1BQU0sRUFBRSxXQUFXO0FBQUEsSUFDN0I7QUFBQSxFQUNGO0FBQUEsRUFFQSxnQkFBZ0IsT0FBTyxTQUF5QjtBQUM5QyxVQUFNLFNBQVNOLGVBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0sR0FDcEIsV0FBVyxzQkFBc0IsRUFDakMsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixRQUFJLENBQUMsU0FBVSxRQUFPO0FBRXRCLFVBQU0sV0FBVyxNQUFNLG1CQUFtQixTQUFTLGFBQWEsTUFBTTtBQUV0RSxVQUFNLEdBQUcsWUFBWSxFQUFFLFFBQVEsT0FBTyxRQUFRO0FBQzVDLFlBQU0sVUFBVSxJQUFJLG1CQUFtQjtBQUN2QyxZQUFNLFFBQVEsOEJBQThCLEtBQUssUUFBUSxTQUFTLEVBQUU7QUFDcEUsWUFBTSxJQUNILFdBQVcsYUFBYSxFQUN4QixNQUFNLGlCQUFpQixLQUFLLFNBQVMsRUFBRSxFQUN2QyxRQUFRO0FBQ1gsWUFBTSxJQUNILFdBQVcsc0JBQXNCLEVBQ2pDLE1BQU0sTUFBTSxLQUFLLFNBQVMsRUFBRSxFQUM1QixRQUFRO0FBQUEsSUFDYixDQUFDO0FBRUQsVUFBTSx3QkFBd0IsSUFBSSxRQUFRO0FBQUEsTUFDeEMsWUFBWSxTQUFTO0FBQUEsTUFDckIsU0FBUyxVQUFVLFlBQVk7QUFBQSxJQUNqQyxDQUFDO0FBRUQsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVBLFNBQVMsT0FBTyxTQUEwRDtBQUN4RSxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxFQUFFLE1BQU0sSUFBSTtBQUNsQixVQUFNLFVBQVUseUJBQXlCLE1BQU0sZUFBZTtBQUM5RCxVQUFNLGlCQUFpQjtBQUFBLE1BQ3JCLE1BQU0sbUJBQWtCLG9CQUFJLEtBQUssR0FBRSxZQUFZLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFBQSxJQUM5RDtBQUVBLFVBQU0sV0FBVyxNQUFNLG1CQUFtQixNQUFNLFlBQVksTUFBTTtBQUNsRSxRQUFJLENBQUMsVUFBVTtBQUNiLFlBQU0sSUFBSSx1QkFBdUIsb0JBQW9CO0FBQUEsSUFDdkQ7QUFFQSxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsVUFBTSxRQUFRLE1BQU0sR0FDakIsV0FBVyxhQUFhLEVBQ3hCLE9BQU87QUFBQSxNQUNOLFNBQVM7QUFBQSxNQUNULGFBQWE7QUFBQSxNQUNiLGFBQWEsU0FBUztBQUFBLE1BQ3RCLFVBQVUsU0FBUztBQUFBLE1BQ25CLGVBQWU7QUFBQSxNQUNmLGFBQWE7QUFBQSxNQUNiLGlCQUFpQjtBQUFBLE1BQ2pCLFFBQVE7QUFBQSxNQUNSLFFBQVE7QUFBQSxNQUNSLFVBQVUsTUFBTSxRQUNaLEtBQUssVUFBVSxFQUFFLE9BQU8sTUFBTSxNQUFNLENBQUMsSUFDckM7QUFBQSxNQUNKLFlBQVk7QUFBQSxJQUNkLENBQWlCLEVBQ2hCLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsVUFBTSx3QkFBd0IsSUFBSSxRQUFRO0FBQUEsTUFDeEMsWUFBWSxTQUFTO0FBQUEsTUFDckIsU0FBUyxTQUFTO0FBQUEsSUFDcEIsQ0FBQztBQUVELFdBQU87QUFBQSxNQUNMLEdBQUc7QUFBQSxNQUNILFFBQVEsU0FBUyxNQUFNLE1BQU07QUFBQSxJQUMvQjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLEdBQUc7QUFBQSxFQUNILEdBQUc7QUFBQSxFQUVILHFCQUFxQixPQUFPLFNBQThDO0FBQ3hFLFVBQU0sU0FBU0EsZUFBYztBQUM3QixVQUFNLFFBQVEsb0JBQW9CLEtBQUssS0FBSztBQUM1QyxVQUFNLFdBQVcsdUJBQXVCLEtBQUssUUFBUTtBQUNyRCxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFFbkMsVUFBTSxHQUNILFdBQVcsZUFBZSxFQUMxQixPQUFPO0FBQUEsTUFDTixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVk7QUFBQSxJQUNkLENBQW1CLEVBQ2xCO0FBQUEsTUFBVyxDQUFDLE9BQ1gsR0FBRyxPQUFPLE9BQU8sRUFBRSxZQUFZO0FBQUEsUUFDN0IsU0FBUztBQUFBLFFBQ1Q7QUFBQSxRQUNBLFlBQVk7QUFBQSxNQUNkLENBQUM7QUFBQSxJQUNILEVBQ0MsUUFBUTtBQUVYLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSx1QkFBdUIsT0FBTyxTQUE0QjtBQUN4RCxVQUFNLFNBQVNBLGVBQWM7QUFDN0IsVUFBTSxRQUFRLG9CQUFvQixLQUFLLEtBQUs7QUFDNUMsVUFBTUksVUFBUyxNQUFNLEdBQ2xCLFdBQVcsZUFBZSxFQUMxQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLE1BQU0sU0FBUyxLQUFLLEtBQUssRUFDekIsUUFBUTtBQUVYLFdBQU9BLFFBQU8sU0FBUyxLQUFLLE9BQU9BLFFBQU8sQ0FBQyxHQUFHLGtCQUFrQixDQUFDLElBQUk7QUFBQSxFQUN2RTtBQUNGO0FBRU8sSUFBTSxZQUFZO0FBQUEsRUFDdkI7QUFBQSxFQUNBO0FBQ0Y7OztBc0I1dUJBLFNBQVMsb0JBQW9CLGlCQUFpQjtBQUc5QyxJQUFNLGtCQUNILE9BQU8sWUFBWSxlQUFlLFFBQVEsS0FBSyxtQkFDaEQ7QUFDRixJQUFNLFdBQVcsR0FBRyxlQUFlO0FBRW5DLElBQU0sT0FBTyxtQkFBbUIsSUFBSSxJQUFJLFFBQVEsQ0FBQztBQU9qRCxlQUFzQixrQkFDcEIscUJBQzhCO0FBQzlCLE1BQUksQ0FBQyxxQkFBcUIsV0FBVyxTQUFTLEdBQUc7QUFDL0MsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQVEsb0JBQW9CLE1BQU0sVUFBVSxNQUFNLEVBQUUsS0FBSztBQUMvRCxNQUFJLENBQUMsT0FBTztBQUNWLFdBQU87QUFBQSxFQUNUO0FBRUEsTUFBSTtBQUNGLFVBQU0sRUFBRSxRQUFRLElBQUksTUFBTSxVQUFVLE9BQU8sTUFBTTtBQUFBLE1BQy9DLFlBQVksQ0FBQyxPQUFPO0FBQUEsSUFDdEIsQ0FBQztBQUVELFVBQU0sYUFBYSxPQUFPLFFBQVEsUUFBUSxXQUFXLFFBQVEsTUFBTTtBQUNuRSxRQUFJLENBQUMsWUFBWTtBQUNmLGFBQU87QUFBQSxJQUNUO0FBRUEsVUFBTSxRQUNKLE9BQU8sUUFBUSxVQUFVLFdBQVcsUUFBUSxRQUFRO0FBRXRELFdBQU8sRUFBRSxZQUFZLE1BQU07QUFBQSxFQUM3QixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQUVPLFNBQVMsdUJBQWlDO0FBQy9DLFNBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLE9BQU8sZUFBZSxDQUFDLEdBQUc7QUFBQSxJQUM3RCxRQUFRO0FBQUEsSUFDUixTQUFTO0FBQUEsTUFDUCxnQkFBZ0I7QUFBQSxNQUNoQiwrQkFBK0I7QUFBQSxNQUMvQixnQ0FDRTtBQUFBLE1BQ0YsZ0NBQWdDO0FBQUEsSUFDbEM7QUFBQSxFQUNGLENBQUM7QUFDSDtBQUdBLGVBQXNCLGVBQWUsS0FBYyxNQUEyQjtBQUM1RSxNQUFJLElBQUksSUFBSSxXQUFXLFdBQVc7QUFDaEMsV0FBTyxJQUFJLFNBQVMsTUFBTTtBQUFBLE1BQ3hCLFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNQLCtCQUErQjtBQUFBLFFBQy9CLGdDQUNFO0FBQUEsUUFDRixnQ0FBZ0M7QUFBQSxNQUNsQztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFFQSxRQUFNLEtBQUs7QUFFWCxNQUFJLElBQUksUUFBUSxJQUFJLCtCQUErQixHQUFHO0FBQ3RELE1BQUksSUFBSSxRQUFRO0FBQUEsSUFDZDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0EsTUFBSSxJQUFJLFFBQVE7QUFBQSxJQUNkO0FBQUEsSUFDQTtBQUFBLEVBQ0Y7QUFDRjs7O0FDNUVBLGVBQXNCLGlCQUNwQixLQUNBLE1BQ0E7QUFDQSxRQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUU7QUFDbEMsTUFBSSxTQUFTLGFBQWEsSUFBSSxJQUFJLFdBQVcsT0FBTztBQUNsRCxXQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxJQUFJLEtBQUssQ0FBQyxHQUFHO0FBQUEsTUFDaEQsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ1AsZ0JBQWdCO0FBQUEsUUFDaEIsK0JBQStCO0FBQUEsTUFDakM7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQ0EsUUFBTSxLQUFLO0FBQ2I7QUFpQk8sU0FBUyw0QkFDZEcsbUJBQ0E7QUFDQSxTQUFPLGVBQWUsc0JBQ3BCLEtBQ0EsTUFDQTtBQUNBLFFBQUksSUFBSSxJQUFJLFdBQVcsV0FBVztBQUNoQyxZQUFNLEtBQUs7QUFDWDtBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU8sSUFBSSxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUU7QUFFbEMsUUFDRSxTQUFTLGFBQ1IsU0FBUyxjQUFjLENBQUMsS0FBSyxTQUFTLFVBQVUsR0FDakQ7QUFDQSxZQUFNLEtBQUs7QUFDWDtBQUFBLElBQ0Y7QUFFQSxVQUFNLFdBQVcsTUFBTSxrQkFBa0IsSUFBSSxJQUFJLE9BQU8sZUFBZSxDQUFDO0FBQ3hFLFFBQUksQ0FBQyxVQUFVO0FBQ2IsYUFBTyxxQkFBcUI7QUFBQSxJQUM5QjtBQUVBLFVBQU0sWUFBWSxNQUFNQSxrQkFBaUIsUUFBUTtBQUVqRCxRQUFJLElBQUksY0FBYyxTQUFTLFVBQVU7QUFDekMsUUFBSSxTQUFTLE9BQU87QUFDbEIsVUFBSSxJQUFJLGFBQWEsU0FBUyxLQUFLO0FBQUEsSUFDckM7QUFDQSxRQUFJLElBQUksVUFBVSxVQUFVLEVBQUU7QUFFOUIsVUFBTSxLQUFLO0FBQUEsRUFDYjtBQUNGOzs7QUNqREEsZUFBc0IsaUJBQ3BCQyxLQUNBLFVBQ2tDO0FBQ2xDLFFBQU0sV0FBVyxNQUFNQSxJQUNwQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxnQkFBZ0IsS0FBSyxTQUFTLFVBQVUsRUFDOUMsVUFBVSxFQUNWLGlCQUFpQjtBQUVwQixNQUFJLFVBQVU7QUFDWixXQUFPO0FBQUEsRUFDVDtBQUVBLFFBQU0sUUFDSixTQUFTLE9BQU8sS0FBSyxLQUNyQixHQUFHLFNBQVMsVUFBVTtBQUN4QixRQUFNLE9BQ0osU0FBUyxNQUFNLEtBQUssS0FDcEIsTUFBTSxNQUFNLEdBQUcsRUFBRSxDQUFDLEtBQ2xCO0FBR0YsUUFBTSxVQUFVLE1BQU1BLElBQ25CLFdBQVcsT0FBTyxFQUNsQixNQUFNLFNBQVMsS0FBSyxLQUFLLEVBQ3pCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsTUFBSSxTQUFTO0FBQ1gsV0FBTyxNQUFNQSxJQUNWLFlBQVksT0FBTyxFQUNuQixJQUFJO0FBQUEsTUFDSCxjQUFjLFNBQVM7QUFBQSxNQUN2QixNQUFNLFFBQVEsUUFBUTtBQUFBLE1BQ3RCLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssUUFBUSxFQUFFLEVBQzNCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxFQUM3QjtBQUVBLFNBQU8sTUFBTUEsSUFDVixXQUFXLE9BQU8sRUFDbEIsT0FBTztBQUFBLElBQ047QUFBQSxJQUNBO0FBQUEsSUFDQSxjQUFjLFNBQVM7QUFBQSxJQUN2QixlQUFlO0FBQUEsRUFDakIsQ0FBQyxFQUNBLGFBQWEsRUFDYix3QkFBd0I7QUFDN0I7OztBQ3RFQSxlQUFzQkMsa0JBQWlCLFVBQXVDO0FBQzVFLFNBQU8saUJBQW9CLElBQUksUUFBUTtBQUN6Qzs7O0FDVEEsSUFBSSxhQUF5QixJQUFJLGVBQWU7QUFFekMsU0FBUyxjQUFjLFFBQTBCO0FBQ3RELGVBQWE7QUFDZjs7O0E5QjRKTSxTQUFRLFdBQVcsOEJBQTZCO0FBOUl0RCxJQUFNQyxjQUFhLE1BQU0sd0JBQXdCO0FBQ2pELGNBQWNBLFdBQVU7QUFFeEIsSUFBSSxJQUFJLGNBQWM7QUFDdEIsSUFBSSxJQUFJLGdCQUFnQjtBQUV4QixlQUFlLHlCQUNiLGVBQ3dCO0FBQ3hCLFFBQU0sV0FBVyxNQUFNLGtCQUFrQixhQUFhO0FBQ3RELE1BQUksQ0FBQyxTQUFVLFFBQU87QUFDdEIsUUFBTSxZQUFZLE1BQU1DLGtCQUFpQjtBQUFBLElBQ3ZDLFlBQVksU0FBUztBQUFBLElBQ3JCLE9BQU8sU0FBUztBQUFBLEVBQ2xCLENBQUM7QUFDRCxTQUFPLFVBQVU7QUFDbkI7QUFHQSxJQUFJLElBQUksT0FBTyxLQUFLLFNBQVM7QUFDM0IsTUFBSSxJQUFJLElBQUksV0FBVyxXQUFXO0FBQ2hDLFVBQU0sS0FBSztBQUNYO0FBQUEsRUFDRjtBQUVBLFFBQU0sT0FBTyxJQUFJLElBQUksSUFBSSxJQUFJLEdBQUcsRUFBRTtBQUVsQyxNQUFJLFNBQVMsYUFBYSxJQUFJLElBQUksV0FBVyxRQUFRO0FBQ25ELFVBQU0sU0FBUyxNQUFNO0FBQUEsTUFDbkIsSUFBSSxJQUFJLE9BQU8sZUFBZTtBQUFBLElBQ2hDO0FBQ0EsUUFBSSxVQUFVLEtBQU0sUUFBTyxxQkFBcUI7QUFFaEQsUUFBSTtBQUNGLFlBQU0sY0FDSixJQUFJLElBQUksT0FBTyxjQUFjLEdBQUcsWUFBWSxLQUFLO0FBQ25ELFVBQUk7QUFDSixVQUFJLE9BQU87QUFDWCxVQUFJO0FBRUosVUFBSSxZQUFZLFNBQVMscUJBQXFCLEdBQUc7QUFDL0MsY0FBTSxPQUFPLE1BQU0sSUFBSSxJQUFJLFNBQVM7QUFDcEMsY0FBTSxPQUFPLEtBQUssSUFBSSxNQUFNO0FBQzVCLFlBQUksQ0FBQyxRQUFRLE9BQU8sU0FBUyxVQUFVO0FBQ3JDLGlCQUFPLFVBQVUsdUJBQXVCLEdBQUc7QUFBQSxRQUM3QztBQUNBLGNBQU0sT0FBTztBQUNiLGVBQU8sS0FBSyxRQUFRO0FBQ3BCLG1CQUFXLEtBQUs7QUFDaEIsY0FBTSxNQUFNLE1BQU0sS0FBSyxZQUFZO0FBQ25DLGdCQUFRLElBQUksV0FBVyxHQUFHO0FBQUEsTUFDNUIsT0FBTztBQUNMLGVBQU8sWUFBWSxNQUFNLEdBQUcsRUFBRSxDQUFDLEVBQUUsS0FBSyxLQUFLO0FBQzNDLGNBQU0sTUFBTSxNQUFNLElBQUksSUFBSSxZQUFZO0FBQ3RDLGdCQUFRLElBQUksV0FBVyxHQUFHO0FBQUEsTUFDNUI7QUFFQSxVQUFJLE1BQU0sYUFBYSxpQkFBaUI7QUFDdEMsZUFBTyxVQUFVLGtCQUFrQixHQUFHO0FBQUEsTUFDeEM7QUFFQSxZQUFNLE9BQU8sNkJBQTZCLEVBQUU7QUFDNUMsWUFBTSxRQUFRLE1BQU0sS0FBSyxJQUFJO0FBQUEsUUFDM0I7QUFBQSxRQUNBO0FBQUEsUUFDQSxhQUFhO0FBQUEsUUFDYjtBQUFBLE1BQ0YsQ0FBQztBQUVELGFBQU8sSUFBSTtBQUFBLFFBQ1QsS0FBSyxVQUFVO0FBQUEsVUFDYixJQUFJLE1BQU07QUFBQSxVQUNWLFFBQVEsTUFBTTtBQUFBLFVBQ2QsYUFBYSxNQUFNO0FBQUEsVUFDbkIsVUFBVSxNQUFNO0FBQUEsVUFDaEIsS0FBSyxXQUFXLE1BQU0sRUFBRTtBQUFBLFFBQzFCLENBQUM7QUFBQSxRQUNEO0FBQUEsVUFDRSxRQUFRO0FBQUEsVUFDUixTQUFTO0FBQUEsWUFDUCxnQkFBZ0I7QUFBQSxZQUNoQiwrQkFBK0I7QUFBQSxVQUNqQztBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQUEsSUFDRixTQUFTLEtBQUs7QUFDWixVQUFJLGVBQWUsc0JBQXNCO0FBQ3ZDLGVBQU8sVUFBVSxJQUFJLFNBQVMsSUFBSSxNQUFNO0FBQUEsTUFDMUM7QUFDQSxjQUFRLE1BQU0sdUJBQXVCLEdBQUc7QUFDeEMsYUFBTyxVQUFVLGlCQUFpQixHQUFHO0FBQUEsSUFDdkM7QUFBQSxFQUNGO0FBRUEsUUFBTSxhQUFhLEtBQUssTUFBTSxtQkFBbUI7QUFDakQsTUFBSSxjQUFjLElBQUksSUFBSSxXQUFXLE9BQU87QUFDMUMsVUFBTSxTQUFTLE1BQU07QUFBQSxNQUNuQixJQUFJLElBQUksT0FBTyxlQUFlO0FBQUEsSUFDaEM7QUFDQSxRQUFJLFVBQVUsS0FBTSxRQUFPLHFCQUFxQjtBQUVoRCxVQUFNLFVBQVUsT0FBTyxXQUFXLENBQUMsQ0FBQztBQUNwQyxVQUFNLE9BQU8sNkJBQTZCLEVBQUU7QUFDNUMsVUFBTUMsVUFBUyxNQUFNLEtBQUssVUFBVSxTQUFTLE1BQU07QUFDbkQsUUFBSSxDQUFDQSxTQUFRO0FBQ1gsYUFBTyxVQUFVLGFBQWEsR0FBRztBQUFBLElBQ25DO0FBRUEsV0FBTyxJQUFJLFNBQVNBLFFBQU8sTUFBTSxPQUFPO0FBQUEsTUFDdENBLFFBQU8sTUFBTTtBQUFBLE1BQ2JBLFFBQU8sTUFBTSxhQUFhQSxRQUFPLE1BQU07QUFBQSxJQUN6QyxHQUFHO0FBQUEsTUFDRCxRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsUUFDUCxnQkFBZ0JBLFFBQU87QUFBQSxRQUN2QixpQkFBaUI7QUFBQSxRQUNqQiwrQkFBK0I7QUFBQSxNQUNqQztBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFFQSxRQUFNLEtBQUs7QUFDYixDQUFDO0FBRUQsSUFBSSxJQUFJLDRCQUE0QkQsaUJBQWdCLENBQUM7QUFFckQsU0FBUyxVQUFVLFNBQWlCLFFBQTBCO0FBQzVELFNBQU8sSUFBSSxTQUFTLEtBQUssVUFBVSxFQUFFLE9BQU8sUUFBUSxDQUFDLEdBQUc7QUFBQSxJQUN0RDtBQUFBLElBQ0EsU0FBUztBQUFBLE1BQ1AsZ0JBQWdCO0FBQUEsTUFDaEIsK0JBQStCO0FBQUEsSUFDakM7QUFBQSxFQUNGLENBQUM7QUFDSDtBQUVPLElBQU0sVUFBVTtBQUFBLEVBQ3JCLEdBQUc7QUFDTDtBQUVBLElBQU8sY0FBUTtBQUlULElBQUksd0JBQXdCO0FBRTVCLElBQUk7QUFDRiwwQkFBd0I7QUFDMUIsUUFBUTtBQUVSO0FBRUEsSUFBSSxJQUFJLHVCQUF1QjtBQUFBLEVBQzdCLFVBQVU7QUFBQSxFQUNWO0FBQUEsRUFDQSxXQUFXLENBQUM7QUFBQSxFQUNaLFFBQVE7QUFDVixDQUFDLENBQUM7IiwKICAibmFtZXMiOiBbImRiIiwgImludmVudG9yeSIsICJjb25maWciLCAiZGIiLCAiY29uZmlnIiwgImRiIiwgImRiIiwgInJlYWRGaWxlIiwgInJlc3VsdCIsICJnZXRDb250ZXh0IiwgImNvbmZpZyIsICJkYiIsICJncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzIiwgImNvbmZpZyIsICJyZXN1bHQiLCAicGFyc2VKc29uIiwgImRiIiwgImRlYWRsaW5lIiwgInN0YXRlIiwgImdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MiLCAicGFyc2VKc29uIiwgImNvbmZpZyIsICJjeWNsZSIsICJyZXN1bHQiLCAiZ2V0Q29udGV4dCIsICJlbnYiLCAiZGIiLCAicmVxdWlyZVVzZXJJZCIsICJnZXRDb250ZXh0IiwgInBhcnNlQ29uZmlnIiwgImJ1aWxkUmV3YXJkTnVkZ2VzIiwgImNvbmZpZyIsICJyZXN1bHQiLCAicmVxdWlyZVVzZXJJZCIsICJnZXRDb250ZXh0IiwgInBhcnNlQ29uZmlnIiwgImNvbmZpZyIsICJyZXN1bHQiLCAiYWN0aXZpdHkiLCAiY29tcGxldGlvbiIsICJyZXNvbHZlTG9jYWxVc2VyIiwgImRiIiwgInJlc29sdmVMb2NhbFVzZXIiLCAicHVzaFNlbmRlciIsICJyZXNvbHZlTG9jYWxVc2VyIiwgInJlc3VsdCJdCn0K
