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
  typeDefs: 'input ArgsInput {\n	filter: RewardDefinitionsFilterInput\n}\ninput RewardDefinitionsFilterInput {\n	includeArchived: Boolean\n	search: String\n	category: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	filter: RewardInventoryFilterInput\n}\ninput RewardInventoryFilterInput {\n	search: String\n	stackableOnly: Boolean\n	sort: NAME_RECENT_QUANTITYInput\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_3 {\n	filter: RewardHistoryFilterInput\n}\ninput RewardHistoryFilterInput {\n	definitionId: Number\n	type: String\n	limit: Number\n	offset: Number\n}\ninput ArgsInput_4 {\n	sourceType: String!\n	sourceId: Number!\n}\ninput ArgsInput_5 {\n	limit: Number\n}\ninput ArgsInput_6 {\n	status: String\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ninput ArgsInput_8 {\n	date: String\n}\ninput ArgsInput_9 {\n	id: Number!\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	activityId: Number\n	fromDate: String\n	toDate: String\n}\ninput ArgsInput_12 {\n	token: String!\n	platform: String!\n}\ninput ArgsInput_13 {\n	token: String!\n}\ninput ArgsInput_14 {\n	input: CreateRewardDefinitionInputInput!\n}\ninput CreateRewardDefinitionInputInput {\n	name: String!\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String!\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_15 {\n	id: Number!\n	input: UpdateRewardDefinitionInputInput!\n}\ninput UpdateRewardDefinitionInputInput {\n	name: String\n	description: String\n	notes: String\n	category: String\n	tags: [String!]\n	color: String\n	icon: String\n	imageAssetId: Number\n	stackable: Boolean\n	defaultQuantity: Number\n	sortOrder: Number\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ninput ArgsInput_17 {\n	id: Number!\n}\ninput ArgsInput_18 {\n	id: Number!\n}\ninput ArgsInput_19 {\n	input: AttachRewardRuleInputInput!\n}\ninput AttachRewardRuleInputInput {\n	sourceType: String!\n	sourceId: Number!\n	rewardDefinitionId: Number!\n	quantity: Number\n	mode: FIXED_PROBABILITY_RANDOM_POOLInput\n	configJson: String\n	enabled: Boolean\n}\ninput ArgsInput_20 {\n	id: Number!\n}\ninput ArgsInput_21 {\n	input: ConsumeRewardInputInput!\n}\ninput ConsumeRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_22 {\n	input: DiscardRewardInputInput!\n}\ninput DiscardRewardInputInput {\n	inventoryId: Number!\n	quantity: Number\n}\ninput ArgsInput_23 {\n	transactionId: Number!\n}\ninput ArgsInput_24 {\n	input: ManualGrantRewardInputInput!\n}\ninput ManualGrantRewardInputInput {\n	rewardDefinitionId: Number!\n	quantity: Number\n	note: String\n}\ninput ArgsInput_25 {\n	input: CreateGoalInputInput!\n}\ninput CreateGoalInputInput {\n	title: String!\n	description: String\n	color: String!\n	icon: String\n	ruleType: String!\n	metric: COUNT_DURATIONInput!\n	targetValue: Number!\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	priority: Number\n	sortOrder: Number\n}\ninput GoalConfigInputInput {\n	compositeMode: ALL_ANY_WEIGHTEDInput\n	countRequired: Number\n	beforeTime: String\n	afterTime: String\n	blockUntilUnlocked: Boolean\n}\ninput GoalLinkInputInput {\n	linkType: ACTIVITY_GROUPInput!\n	activityId: Number\n	groupId: Number\n	weight: Number\n}\ninput GoalDependencyInputInput {\n	dependsOnGoalId: Number!\n	requirement: COMPLETE_PROGRESSInput\n	threshold: Number\n	weight: Number\n}\ninput GoalRecurrenceInputInput {\n	period: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput!\n	interval: Number\n	anchor: String\n	carryOver: NONE_OVERFLOWInput\n	reset: String\n}\ninput GoalDeadlineInputInput {\n	kind: ABSOLUTE_RELATIVEInput!\n	date: String\n	daysAfterCycleStart: Number\n	graceDays: Number\n	warnDays: Number\n}\ninput ArgsInput_26 {\n	id: Number!\n	input: UpdateGoalInputInput!\n}\ninput UpdateGoalInputInput {\n	title: String\n	description: String\n	color: String\n	icon: String\n	ruleType: String\n	metric: COUNT_DURATIONInput\n	targetValue: Number\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	confirmStartsAtChange: Boolean\n	status: ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput\n	priority: Number\n	sortOrder: Number\n}\ninput ArgsInput_27 {\n	id: Number!\n}\ninput ArgsInput_28 {\n	id: Number!\n}\ninput ArgsInput_29 {\n	id: Number!\n}\ninput ArgsInput_30 {\n	id: Number!\n}\ninput ArgsInput_31 {\n	input: CreateGroupInputInput!\n}\ninput CreateGroupInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_32 {\n	id: Number!\n	input: UpdateGroupInputInput!\n}\ninput UpdateGroupInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_33 {\n	id: Number!\n}\ninput ArgsInput_34 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_35 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n	notificationOffsets: [Number!]\n}\ninput ArgsInput_36 {\n	id: Number!\n}\ninput ArgsInput_37 {\n	input: CompleteActivityInputInput!\n}\ninput CompleteActivityInputInput {\n	activityId: Number!\n	occurrenceDate: String!\n	durationMinutes: Number\n	notes: String\n}\ninput ArgsInput_38 {\n	id: Number!\n}\ninput ArgsInput_39 {\n	input: LogTimeInputInput!\n}\ninput LogTimeInputInput {\n	activityId: Number!\n	durationMinutes: Number!\n	occurrenceDate: String\n	notes: String\n}\ntype Query {\nrewardDefinitions(args: ArgsInput!): Any!\nrewardDefinition(args: ArgsInput_1!): RewardDefinition\nrewardInventory(args: ArgsInput_2!): Any!\nrewardHistory(args: ArgsInput_3!): Any!\nrewardRules(args: ArgsInput_4!): Any!\nrecentAssets(args: ArgsInput_5!): [RecentAssets!]!\nrewardNudges(_args: Object): [RewardNudge!]!\ngoals(args: ArgsInput_6): Any!\ngoal(args: ArgsInput_7!): Goal\ngoalNudges(args: Object): [GoalNudge!]!\ndailyProgress(args: ArgsInput_8): DailyProgress!\ngroups(args: Object): Any!\ngroup(args: ArgsInput_9!): Any!\nactivities(args: Object): Any!\nactivity(args: ArgsInput_10!): Activity\nactivityCompletions(args: ArgsInput_11): Any!\n}\ntype RewardDefinition {\ntags: [String!]!\nimage_url: String\nimage: Image\nuser_id: Number!\nsort_order: Number!\nname: String!\nid: Number!\ndescription: String\nnotes: String\ncategory: String\ncolor: String!\nicon: String\nimage_asset_id: Number\nstackable: Boolean!\ndefault_quantity: Number!\narchived_at: Date\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Image {\nurl: String!\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\norphaned_at: Date\n}\ntype RecentAssets {\nurl: String!\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nsha256: String!\ncontent_type: String!\nbyte_size: Number!\nstorage_key: String!\nref_count: Number!\norphaned_at: Date\n}\ntype RewardNudge {\nkind: RewardNudgeKind!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS!\ndefinitionId: Number\ninventoryId: Number\n}\ntype Goal {\ntarget_value: Number!\nstartsAt: String!\nlifecyclePhase: GoalLifecyclePhase!\nconfig: GoalConfig!\nrecurrence: GoalRecurrenceConfig\ndeadline: GoalDeadlineConfig\nlinks: Any!\nactiveCycle: Any!\ncycles: Any!\ndependencies: Any!\nsnapshots: Any!\nisLocked: Boolean!\nuser_id: Number!\nsort_order: Number!\nid: Number!\ndescription: String\ncolor: String!\nicon: String\ncreated_at: Date!\nupdated_at: Date!\npriority: Number!\ntitle: String!\nrule_type: String!\nmetric: GoalMetric!\nstatus: GoalStatus!\nstarts_at: Date!\n}\ntype GoalConfig {\ncomposite_mode: ALL_ANY_WEIGHTED\ncount_required: Number\nbefore_time: String\nafter_time: String\nblock_until_unlocked: Boolean\n}\ntype GoalRecurrenceConfig {\nperiod: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS!\ninterval: Number\nanchor: String\ncarry_over: NONE_OVERFLOW\nreset: String\n}\ntype GoalDeadlineConfig {\nkind: ABSOLUTE_RELATIVE!\ndate: String\ndays_after_cycle_start: Number\ngrace_days: Number\nwarn_days: Number\n}\ntype GoalNudge {\nkind: GoalNudgeKind!\ngoalId: Number!\ntitle: String!\nmessage: String!\nseverity: INFO_SUCCESS_WARNING!\n}\ntype DailyProgress {\ndate: String!\ncompletedCount: Any!\nminutesToday: Any!\nstreakDays: Number!\ncompletions: Any!\n}\ntype Activity {\nrecurrencePattern: ParsedRecurrencePattern\ngroup: Group\nuser_id: Number!\nid: Number!\ndescription: String\ncreated_at: Date!\nupdated_at: Date!\ntitle: String!\ngroup_id: Number\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\nnotification_offsets: [Number!]!\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype Group {\nuser_id: Number!\nname: String!\nid: Number!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Mutation {\nregisterDeviceToken(args: ArgsInput_12!): Boolean!\nunregisterDeviceToken(args: ArgsInput_13!): Boolean!\ncreateRewardDefinition(args: ArgsInput_14!): RewardDefinition!\nupdateRewardDefinition(args: ArgsInput_15!): RewardDefinition!\narchiveRewardDefinition(args: ArgsInput_16!): RewardDefinition!\nunarchiveRewardDefinition(args: ArgsInput_17!): RewardDefinition!\ndeleteRewardDefinition(args: ArgsInput_18!): Boolean!\nattachRewardRule(args: ArgsInput_19!): AttachRewardRule!\ndetachRewardRule(args: ArgsInput_20!): Boolean!\nconsumeReward(args: ArgsInput_21!): ConsumeReward!\ndiscardReward(args: ArgsInput_22!): DiscardReward!\nrestoreReward(args: ArgsInput_23!): RestoreReward!\nmanualGrantReward(args: ArgsInput_24!): ManualGrantReward\nrecomputeRewardInventory: Boolean!\ncreateGoal(args: ArgsInput_25!): Goal!\nupdateGoal(args: ArgsInput_26!): Goal!\npauseGoal(args: ArgsInput_27!): Goal!\nresumeGoal(args: ArgsInput_28!): Goal!\narchiveGoal(args: ArgsInput_29!): Goal!\ndeleteGoal(args: ArgsInput_30!): Boolean!\nrecomputeGoalProgress(args: Object): RecomputeGoalProgress!\ncreateGroup(args: ArgsInput_31!): Any!\nupdateGroup(args: ArgsInput_32!): Any!\ndeleteGroup(args: ArgsInput_33!): Boolean!\ncreateActivity(args: ArgsInput_34!): Activity!\nupdateActivity(args: ArgsInput_35!): Activity!\ndeleteActivity(args: ArgsInput_36!): Boolean!\ncompleteActivity(args: ArgsInput_37!): Any!\nundoCompletion(args: ArgsInput_38!): Boolean!\nlogTime(args: ArgsInput_39!): Any!\n}\ntype AttachRewardRule {\nconfig: RewardRuleConfig!\ndefinition: RewardDefinition\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nquantity: Number!\nsource_type: String!\nsource_id: Number!\nreward_definition_id: Number!\nmode: RewardRuleMode!\nenabled: Boolean!\n}\ntype RewardRuleConfig {\nonce: Boolean\ncooldown_hours: Number\nmax_grants_total: Number\nmax_grants_per_period: Number\nperiod_hours: Number\nprobability: Number\n"""\nPool of definition ids for random_pool mode.\n"""\npool: [Pool!]\n}\ntype Pool {\ndefinition_id: Number!\nweight: Number\nquantity: Number\n}\ntype ConsumeReward {\ninventory: Inventory\ntransaction: ManualGrantReward!\n}\ntype Inventory {\ndefinition: RewardDefinition\nuser_id: Number!\nid: Number!\nupdated_at: Date!\nquantity: Number!\nreward_definition_id: Number!\nstack_key: String\nfirst_earned_at: Date!\nlast_earned_at: Date!\n}\ntype ManualGrantReward {\nmetadata: Any!\nuser_id: Number!\nid: Number!\nimage_asset_id: Number\ncreated_at: Date!\nquantity: Number!\nsource_type: String\nsource_id: Number\nreward_definition_id: Number\ntype: RewardTransactionType!\ninventory_id: Number\ndefinition_name: String!\ndefinition_color: String!\ndefinition_icon: String\ntrigger_key: String\nrule_id: Number\nactivity_id: Number\ngoal_id: Number\ncompletion_id: Number\ncycle_id: Number\nnote: String\n}\ntype DiscardReward {\ninventory: Inventory\ntransaction: ManualGrantReward!\n}\ntype RestoreReward {\ninventory: Inventory!\ntransaction: ManualGrantReward!\n}\ntype RecomputeGoalProgress {\nrecomputed: Number!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum RewardNudgeKind {\n	inventory_available\n	recently_earned\n	unconsumed_stack\n}\nenum INFO_SUCCESS {\n	info\n	success\n}\nenum GoalLifecyclePhase {\n	active\n	paused\n	completed\n	archived\n	failed\n	scheduled\n}\nenum GoalMetric {\n	count\n	duration\n}\nenum GoalStatus {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum ALL_ANY_WEIGHTED {\n	all\n	any\n	weighted\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOW {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVE {\n	absolute\n	relative\n}\nenum GoalNudgeKind {\n	deadline_approaching\n	deadline_overdue\n	behind_pace\n	cycle_complete\n	dependency_unlocked\n	goal_starting_soon\n}\nenum INFO_SUCCESS_WARNING {\n	info\n	success\n	warning\n}\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum RewardRuleMode {\n	fixed\n	probability\n	random_pool\n}\nenum RewardTransactionType {\n	earn\n	consume\n	delete\n	restore\n	adjust\n}\nenum NAME_RECENT_QUANTITYInput {\n	name\n	recent\n	quantity\n}\nenum FIXED_PROBABILITY_RANDOM_POOLInput {\n	fixed\n	probability\n	random_pool\n}\nenum COUNT_DURATIONInput {\n	count\n	duration\n}\nenum ALL_ANY_WEIGHTEDInput {\n	all\n	any\n	weighted\n}\nenum ACTIVITY_GROUPInput {\n	activity\n	group\n}\nenum COMPLETE_PROGRESSInput {\n	complete\n	progress\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOWInput {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVEInput {\n	absolute\n	relative\n}\nenum ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n',
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL3Jld2FyZHMvaW52ZW50b3J5LnRzIiwgIi4uL3NyYy9yZXdhcmRzL3J1bGVzL2V2YWx1YXRlLnRzIiwgIi4uL3NyYy9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMiLCAiLi4vc3JjL3Jld2FyZHMvc291cmNlcy9pbmRleC50cyIsICIuLi9zcmMvcmV3YXJkcy9ob29rcy50cyIsICIuLi9zcmMvcmV3YXJkcy9udWRnZXMudHMiLCAiLi4vc3JjL2luZGV4LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvbm9vcF9zZW5kZXIudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvZmlyZWJhc2Vfc2VuZGVyLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3NzbC50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL3B1c2gvZGV2aWNlX3Rva2VuX3ZhbGlkYXRpb24udHMiLCAiLi4vc3JjL2dvYWxzL2xpZmVjeWNsZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ29hbHMvcHJvZ3Jlc3MudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9ncmFwaHFsL25vdGlmaWNhdGlvbl9vZmZzZXRzLnRzIiwgIi4uL3NyYy9ncmFwaHFsL251bWVyaWMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL2dvYWxzX3Jlc29sdmVycy50cyIsICIuLi9zcmMvZ29hbHMvY3ljbGVzLnRzIiwgIi4uL3NyYy9nb2Fscy9udWRnZXMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL3Jld2FyZHNfcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9hc3NldHMvaGFzaGluZy50cyIsICIuLi9zcmMvYXNzZXRzL3N0b3JhZ2UvbG9jYWxfZnMudHMiLCAiLi4vc3JjL2Fzc2V0cy9zdG9yYWdlL3MzLnRzIiwgIi4uL3NyYy9hc3NldHMvc3RvcmFnZS90eXBlcy50cyIsICIuLi9zcmMvYXNzZXRzL3JlcG9zaXRvcnkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvYXV0aC92ZXJpZnkudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvcHlsb24vbWlkZGxld2FyZS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiLCAiLi4vc3JjL3B1c2gvc2VuZGVyLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBOZXdSZXdhcmRJbnZlbnRvcnksXG4gIE5ld1Jld2FyZFRyYW5zYWN0aW9uLFxuICBSZXdhcmREZWZpbml0aW9uLFxuICBSZXdhcmRJbnZlbnRvcnksXG4gIFJld2FyZFRyYW5zYWN0aW9uLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgdHlwZSB7IEdyYW50SW5zdHJ1Y3Rpb24gfSBmcm9tICcuL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBJbnZlbnRvcnlNYW5hZ2VyIHtcbiAgYXBwbHlFYXJuKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24sXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlEaXNjYXJkKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgYXBwbHlSZXN0b3JlKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbnN1bWVUcmFuc2FjdGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeTsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+XG5cbiAgcmV2b2tlVW5jb25zdW1lZEZvckNvbXBsZXRpb24oXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29tcGxldGlvbklkOiBudW1iZXIsXG4gICk6IFByb21pc2U8bnVtYmVyPlxufVxuXG5mdW5jdGlvbiBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uKSB7XG4gIHJldHVybiB7XG4gICAgZGVmaW5pdGlvbl9uYW1lOiBkZWZpbml0aW9uLm5hbWUsXG4gICAgZGVmaW5pdGlvbl9jb2xvcjogZGVmaW5pdGlvbi5jb2xvcixcbiAgICBkZWZpbml0aW9uX2ljb246IGRlZmluaXRpb24uaWNvbixcbiAgICBpbWFnZV9hc3NldF9pZDogZGVmaW5pdGlvbi5pbWFnZV9hc3NldF9pZCxcbiAgfVxufVxuXG5mdW5jdGlvbiBuZXdTdGFja0tleSgpOiBzdHJpbmcge1xuICByZXR1cm4gY3J5cHRvLnJhbmRvbVVVSUQoKVxufVxuXG5leHBvcnQgY2xhc3MgRGJJbnZlbnRvcnlNYW5hZ2VyIGltcGxlbWVudHMgSW52ZW50b3J5TWFuYWdlciB7XG4gIGFzeW5jIGFwcGx5RWFybihcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBkZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uLFxuICAgIGluc3RydWN0aW9uOiBHcmFudEluc3RydWN0aW9uLFxuICApOiBQcm9taXNlPHsgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnk7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgc25hcCA9IHNuYXBzaG90RmllbGRzKGRlZmluaXRpb24pXG5cbiAgICBsZXQgaW52ZW50b3J5OiBSZXdhcmRJbnZlbnRvcnlcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgZGVmaW5pdGlvbi5pZClcbiAgICAgICAgLndoZXJlKCdzdGFja19rZXknLCAnaXMnLCBudWxsKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHF1YW50aXR5OiBleGlzdGluZy5xdWFudGl0eSArIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICAgIHF1YW50aXR5OiBpbnN0cnVjdGlvbi5xdWFudGl0eSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbnVsbCxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBOb24tc3RhY2thYmxlOiBvbmUgcm93IHBlciBncmFudGVkIHVuaXQgKHF1YW50aXR5IGFsd2F5cyAxIHBlciByb3cpLlxuICAgICAgLy8gSWYgaW5zdHJ1Y3Rpb24ucXVhbnRpdHkgPiAxLCBjcmVhdGUgbXVsdGlwbGUgcm93czsgcmV0dXJuIHRoZSBsYXN0LlxuICAgICAgbGV0IGxhc3QhOiBSZXdhcmRJbnZlbnRvcnlcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgaW5zdHJ1Y3Rpb24ucXVhbnRpdHk7IGkrKykge1xuICAgICAgICBsYXN0ID0gYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1Jld2FyZEludmVudG9yeSlcbiAgICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgfVxuICAgICAgaW52ZW50b3J5ID0gbGFzdFxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAnZWFybicsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogaW5zdHJ1Y3Rpb24uc291cmNlVHlwZSxcbiAgICAgICAgc291cmNlX2lkOiBpbnN0cnVjdGlvbi5zb3VyY2VJZCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IGluc3RydWN0aW9uLnRyaWdnZXJLZXksXG4gICAgICAgIHJ1bGVfaWQ6IGluc3RydWN0aW9uLnJ1bGVJZCxcbiAgICAgICAgYWN0aXZpdHlfaWQ6IGluc3RydWN0aW9uLmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICAgICAgZ29hbF9pZDogaW5zdHJ1Y3Rpb24uZ29hbElkID8/IG51bGwsXG4gICAgICAgIGNvbXBsZXRpb25faWQ6IGluc3RydWN0aW9uLmNvbXBsZXRpb25JZCA/PyBudWxsLFxuICAgICAgICBjeWNsZV9pZDogaW5zdHJ1Y3Rpb24uY3ljbGVJZCA/PyBudWxsLFxuICAgICAgICBub3RlOiBudWxsLFxuICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRUcmFuc2FjdGlvbilcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfVxuICB9XG5cbiAgYXN5bmMgYXBwbHlDb25zdW1lKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGludmVudG9yeUlkOiBudW1iZXIsXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgICBub3RlPzogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kZWNyZW1lbnQoXG4gICAgICB0cngsXG4gICAgICB1c2VySWQsXG4gICAgICBpbnZlbnRvcnlJZCxcbiAgICAgIHF1YW50aXR5LFxuICAgICAgJ2NvbnN1bWUnLFxuICAgICAgbm90ZSA/PyBudWxsLFxuICAgIClcbiAgfVxuXG4gIGFzeW5jIGFwcGx5RGlzY2FyZChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICk6IFByb21pc2U8eyBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGw7IHRyYW5zYWN0aW9uOiBSZXdhcmRUcmFuc2FjdGlvbiB9PiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgaW52ZW50b3J5SWQsXG4gICAgICBxdWFudGl0eSxcbiAgICAgICdkZWxldGUnLFxuICAgICAgbnVsbCxcbiAgICApXG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGRlY3JlbWVudChcbiAgICB0cng6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnZlbnRvcnlJZDogbnVtYmVyLFxuICAgIHF1YW50aXR5OiBudW1iZXIsXG4gICAgdHlwZTogJ2NvbnN1bWUnIHwgJ2RlbGV0ZScsXG4gICAgbm90ZTogc3RyaW5nIHwgbnVsbCxcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IHwgbnVsbDsgdHJhbnNhY3Rpb246IFJld2FyZFRyYW5zYWN0aW9uIH0+IHtcbiAgICBpZiAocXVhbnRpdHkgPCAxKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ3F1YW50aXR5IG11c3QgYmUgPj0gMScpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnZlbnRvcnlJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnZlbnRvcnkgaXRlbSBub3QgZm91bmQnKVxuICAgIGlmIChyb3cucXVhbnRpdHkgPCBxdWFudGl0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdpbnN1ZmZpY2llbnQgcXVhbnRpdHknKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9Jywgcm93LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBjb25zdCBzbmFwID0gZGVmaW5pdGlvblxuICAgICAgPyBzbmFwc2hvdEZpZWxkcyhkZWZpbml0aW9uKVxuICAgICAgOiB7XG4gICAgICAgICAgZGVmaW5pdGlvbl9uYW1lOiAnVW5rbm93biByZXdhcmQnLFxuICAgICAgICAgIGRlZmluaXRpb25fY29sb3I6ICcjNjQ3NDhCJyxcbiAgICAgICAgICBkZWZpbml0aW9uX2ljb246IG51bGwgYXMgc3RyaW5nIHwgbnVsbCxcbiAgICAgICAgICBpbWFnZV9hc3NldF9pZDogbnVsbCBhcyBudW1iZXIgfCBudWxsLFxuICAgICAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByZW1haW5pbmcgPSByb3cucXVhbnRpdHkgLSBxdWFudGl0eVxuICAgIGxldCBpbnZlbnRvcnk6IFJld2FyZEludmVudG9yeSB8IG51bGxcblxuICAgIGlmIChyZW1haW5pbmcgPT09IDApIHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIHJvdy5pZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgaW52ZW50b3J5ID0gbnVsbFxuICAgIH0gZWxzZSB7XG4gICAgICBpbnZlbnRvcnkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLnNldCh7IHF1YW50aXR5OiByZW1haW5pbmcsIHVwZGF0ZWRfYXQ6IG5vdyB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH1cblxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogcm93LnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IHJlbWFpbmluZyA9PT0gMCA/IG51bGwgOiByb3cuaWQsXG4gICAgICAgIHF1YW50aXR5LFxuICAgICAgICAuLi5zbmFwLFxuICAgICAgICBzb3VyY2VfdHlwZTogJ21hbnVhbCcsXG4gICAgICAgIHNvdXJjZV9pZDogbnVsbCxcbiAgICAgICAgdHJpZ2dlcl9rZXk6IG51bGwsXG4gICAgICAgIHJ1bGVfaWQ6IG51bGwsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBudWxsLFxuICAgICAgICBnb2FsX2lkOiBudWxsLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBudWxsLFxuICAgICAgICBjeWNsZV9pZDogbnVsbCxcbiAgICAgICAgbm90ZSxcbiAgICAgICAgbWV0YWRhdGE6IHJlbWFpbmluZyA9PT0gMFxuICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBjbGVhcmVkX2ludmVudG9yeV9pZDogcm93LmlkIH0pXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICBhc3luYyBhcHBseVJlc3RvcmUoXG4gICAgdHJ4OiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgY29uc3VtZVRyYW5zYWN0aW9uSWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5OyB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfT4ge1xuICAgIGNvbnN0IGNvbnN1bWVUeCA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVRyYW5zYWN0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2NvbnN1bWUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIWNvbnN1bWVUeCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdjb25zdW1lIHRyYW5zYWN0aW9uIG5vdCBmb3VuZCcpXG4gICAgaWYgKGNvbnN1bWVUeC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52ZW50b3J5RXJyb3IoJ2Nhbm5vdCByZXN0b3JlOiBkZWZpbml0aW9uIG1pc3NpbmcnKVxuICAgIH1cblxuICAgIC8vIFByZXZlbnQgZG91YmxlLXJlc3RvcmUuXG4gICAgY29uc3QgYWxyZWFkeSA9IGF3YWl0IHRyeFxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdyZXN0b3JlJylcbiAgICAgIC53aGVyZSgnbWV0YWRhdGEnLCAnaXMgbm90JywgbnVsbClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVzdG9yZWQgPSBhbHJlYWR5LnNvbWUoKHQpID0+IHtcbiAgICAgIGNvbnN0IG1ldGEgPVxuICAgICAgICB0eXBlb2YgdC5tZXRhZGF0YSA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UodC5tZXRhZGF0YSlcbiAgICAgICAgICA6IHQubWV0YWRhdGFcbiAgICAgIHJldHVybiBtZXRhICYmIG1ldGEucmVzdG9yZWRfZnJvbSA9PT0gY29uc3VtZVRyYW5zYWN0aW9uSWRcbiAgICB9KVxuICAgIGlmIChyZXN0b3JlZCkgdGhyb3cgbmV3IEludmVudG9yeUVycm9yKCdhbHJlYWR5IHJlc3RvcmVkJylcblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCB0cnhcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgY29uc3VtZVR4LnJld2FyZF9kZWZpbml0aW9uX2lkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgY29uc3QgaW5zdHJ1Y3Rpb246IEdyYW50SW5zdHJ1Y3Rpb24gPSB7XG4gICAgICBydWxlSWQ6IG51bGwsXG4gICAgICBkZWZpbml0aW9uSWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICBxdWFudGl0eTogY29uc3VtZVR4LnF1YW50aXR5LFxuICAgICAgdHJpZ2dlcktleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgc291cmNlVHlwZTogJ21hbnVhbCcsXG4gICAgICBzb3VyY2VJZDogMCxcbiAgICB9XG5cbiAgICAvLyBSZS1hcHBseSBhcyBlYXJuLWxpa2UgaW52ZW50b3J5IGJ1bXAsIHRoZW4gd3JpdGUgcmVzdG9yZSB0eC5cbiAgICBjb25zdCB7IGludmVudG9yeSB9ID0gYXdhaXQgdGhpcy5hcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgICAgdHJ4LFxuICAgICAgdXNlcklkLFxuICAgICAgZGVmaW5pdGlvbixcbiAgICAgIGluc3RydWN0aW9uLnF1YW50aXR5LFxuICAgIClcblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHRyYW5zYWN0aW9uID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0eXBlOiAncmVzdG9yZScsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBkZWZpbml0aW9uLmlkLFxuICAgICAgICBpbnZlbnRvcnlfaWQ6IGludmVudG9yeS5pZCxcbiAgICAgICAgcXVhbnRpdHk6IGNvbnN1bWVUeC5xdWFudGl0eSxcbiAgICAgICAgLi4uc25hcHNob3RGaWVsZHMoZGVmaW5pdGlvbiksXG4gICAgICAgIHNvdXJjZV90eXBlOiAnbWFudWFsJyxcbiAgICAgICAgc291cmNlX2lkOiBudWxsLFxuICAgICAgICB0cmlnZ2VyX2tleTogYHJlc3RvcmU6JHtjb25zdW1lVHJhbnNhY3Rpb25JZH1gLFxuICAgICAgICBydWxlX2lkOiBudWxsLFxuICAgICAgICBhY3Rpdml0eV9pZDogbnVsbCxcbiAgICAgICAgZ29hbF9pZDogbnVsbCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgY3ljbGVfaWQ6IG51bGwsXG4gICAgICAgIG5vdGU6IG51bGwsXG4gICAgICAgIG1ldGFkYXRhOiBKU09OLnN0cmluZ2lmeSh7IHJlc3RvcmVkX2Zyb206IGNvbnN1bWVUcmFuc2FjdGlvbklkIH0pLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZFRyYW5zYWN0aW9uKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9XG4gIH1cblxuICAvKiogSW52ZW50b3J5IGJ1bXAgd2l0aG91dCB3cml0aW5nIGFuIGVhcm4gbGVkZ2VyIHJvdyAodXNlZCBieSByZXN0b3JlKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyBhcHBseUVhcm5XaXRob3V0TGVkZ2VyKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGRlZmluaXRpb246IFJld2FyZERlZmluaXRpb24sXG4gICAgcXVhbnRpdHk6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGludmVudG9yeTogUmV3YXJkSW52ZW50b3J5IH0+IHtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBpZiAoZGVmaW5pdGlvbi5zdGFja2FibGUpIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGRlZmluaXRpb24uaWQpXG4gICAgICAgIC53aGVyZSgnc3RhY2tfa2V5JywgJ2lzJywgbnVsbClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGV4aXN0aW5nKSB7XG4gICAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnNldCh7XG4gICAgICAgICAgICBxdWFudGl0eTogZXhpc3RpbmcucXVhbnRpdHkgKyBxdWFudGl0eSxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGludmVudG9yeSA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgICBxdWFudGl0eSxcbiAgICAgICAgICBzdGFja19rZXk6IG51bGwsXG4gICAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gICAgfVxuXG4gICAgY29uc3QgaW52ZW50b3J5ID0gYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmaW5pdGlvbi5pZCxcbiAgICAgICAgcXVhbnRpdHk6IDEsXG4gICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgZmlyc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIGxhc3RfZWFybmVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB7IGludmVudG9yeSB9XG4gIH1cblxuICAvKipcbiAgICogUmV2b2tlIHVuY29uc3VtZWQgcG9ydGlvbiBvZiBlYXJucyB0aWVkIHRvIGEgY29tcGxldGlvbi5cbiAgICogTmV2ZXIgZHJpdmVzIGludmVudG9yeSBuZWdhdGl2ZS5cbiAgICovXG4gIGFzeW5jIHJldm9rZVVuY29uc3VtZWRGb3JDb21wbGV0aW9uKFxuICAgIHRyeDogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyLFxuICApOiBQcm9taXNlPG51bWJlcj4ge1xuICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgdHJ4XG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdjb21wbGV0aW9uX2lkJywgJz0nLCBjb21wbGV0aW9uSWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGxldCByZXZva2VkID0gMFxuICAgIGZvciAoY29uc3QgZWFybiBvZiBlYXJucykge1xuICAgICAgaWYgKGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQgPT0gbnVsbCkgY29udGludWVcblxuICAgICAgY29uc3QgaW52ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgncmV3YXJkX2RlZmluaXRpb25faWQnLCAnPScsIGVhcm4ucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGF2YWlsYWJsZSA9IGludi5yZWR1Y2UoKHMsIHIpID0+IHMgKyByLnF1YW50aXR5LCAwKVxuICAgICAgY29uc3QgdG9SZXZva2UgPSBNYXRoLm1pbihlYXJuLnF1YW50aXR5LCBhdmFpbGFibGUpXG4gICAgICBpZiAodG9SZXZva2UgPD0gMCkgY29udGludWVcblxuICAgICAgbGV0IHJlbWFpbmluZyA9IHRvUmV2b2tlXG4gICAgICBmb3IgKGNvbnN0IHJvdyBvZiBpbnYpIHtcbiAgICAgICAgaWYgKHJlbWFpbmluZyA8PSAwKSBicmVha1xuICAgICAgICBjb25zdCB0YWtlID0gTWF0aC5taW4ocm93LnF1YW50aXR5LCByZW1haW5pbmcpXG4gICAgICAgIGF3YWl0IHRoaXMuZGVjcmVtZW50KFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgcm93LmlkLFxuICAgICAgICAgIHRha2UsXG4gICAgICAgICAgJ2RlbGV0ZScsXG4gICAgICAgICAgYHJldm9rZWQ6Y29tcGxldGlvbjoke2NvbXBsZXRpb25JZH1gLFxuICAgICAgICApXG4gICAgICAgIHJlbWFpbmluZyAtPSB0YWtlXG4gICAgICAgIHJldm9rZWQgKz0gdGFrZVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gcmV2b2tlZFxuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZlbnRvcnlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52ZW50b3J5RXJyb3InXG4gIH1cbn1cblxuLyoqIFJlYnVpbGQgaW52ZW50b3J5IHF1YW50aXRpZXMgZnJvbSB0aGUgbGVkZ2VyIChyZXBhaXIpLiBEb2VzIG5vdCB3cml0ZSBsZWRnZXIgcm93cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVJbnZlbnRvcnlGcm9tTGVkZ2VyKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBkYlxuICAgIC5kZWxldGVGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgdHhzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnYXNjJylcbiAgICAub3JkZXJCeSgnaWQnLCAnYXNjJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgZGVmcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuICBjb25zdCBkZWZNYXAgPSBuZXcgTWFwKGRlZnMubWFwKChkKSA9PiBbZC5pZCwgZF0pKVxuXG4gIGNvbnN0IG5ldCA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KClcbiAgY29uc3QgZmlyc3RFYXJuID0gbmV3IE1hcDxudW1iZXIsIHN0cmluZz4oKVxuICBjb25zdCBsYXN0RWFybiA9IG5ldyBNYXA8bnVtYmVyLCBzdHJpbmc+KClcblxuICBmb3IgKGNvbnN0IHR4IG9mIHR4cykge1xuICAgIGlmICh0eC5yZXdhcmRfZGVmaW5pdGlvbl9pZCA9PSBudWxsKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZklkID0gdHgucmV3YXJkX2RlZmluaXRpb25faWRcbiAgICBjb25zdCBjdXIgPSBuZXQuZ2V0KGRlZklkKSA/PyAwXG4gICAgY29uc3QgY3JlYXRlZCA9XG4gICAgICB0eXBlb2YgdHguY3JlYXRlZF9hdCA9PT0gJ3N0cmluZydcbiAgICAgICAgPyB0eC5jcmVhdGVkX2F0XG4gICAgICAgIDogbmV3IERhdGUodHguY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuXG4gICAgaWYgKHR4LnR5cGUgPT09ICdlYXJuJyB8fCB0eC50eXBlID09PSAncmVzdG9yZScpIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIGN1ciArIHR4LnF1YW50aXR5KVxuICAgICAgaWYgKCFmaXJzdEVhcm4uaGFzKGRlZklkKSkgZmlyc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICAgIGxhc3RFYXJuLnNldChkZWZJZCwgY3JlYXRlZClcbiAgICB9IGVsc2UgaWYgKFxuICAgICAgdHgudHlwZSA9PT0gJ2NvbnN1bWUnIHx8XG4gICAgICB0eC50eXBlID09PSAnZGVsZXRlJyB8fFxuICAgICAgdHgudHlwZSA9PT0gJ2FkanVzdCdcbiAgICApIHtcbiAgICAgIG5ldC5zZXQoZGVmSWQsIE1hdGgubWF4KDAsIGN1ciAtIHR4LnF1YW50aXR5KSlcbiAgICB9XG4gIH1cblxuICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgZm9yIChjb25zdCBbZGVmSWQsIHF0eV0gb2YgbmV0KSB7XG4gICAgaWYgKHF0eSA8PSAwKSBjb250aW51ZVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBkZWZNYXAuZ2V0KGRlZklkKVxuICAgIGlmICghZGVmaW5pdGlvbikgY29udGludWVcblxuICAgIGlmIChkZWZpbml0aW9uLnN0YWNrYWJsZSkge1xuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcmV3YXJkX2RlZmluaXRpb25faWQ6IGRlZklkLFxuICAgICAgICAgIHF1YW50aXR5OiBxdHksXG4gICAgICAgICAgc3RhY2tfa2V5OiBudWxsLFxuICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgIGxhc3RfZWFybmVkX2F0OiBsYXN0RWFybi5nZXQoZGVmSWQpID8/IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgfSBlbHNlIHtcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcXR5OyBpKyspIHtcbiAgICAgICAgYXdhaXQgZGJcbiAgICAgICAgICAuaW5zZXJ0SW50bygncmV3YXJkX2ludmVudG9yeScpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgICByZXdhcmRfZGVmaW5pdGlvbl9pZDogZGVmSWQsXG4gICAgICAgICAgICBxdWFudGl0eTogMSxcbiAgICAgICAgICAgIHN0YWNrX2tleTogbmV3U3RhY2tLZXkoKSxcbiAgICAgICAgICAgIGZpcnN0X2Vhcm5lZF9hdDogZmlyc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgbGFzdF9lYXJuZWRfYXQ6IGxhc3RFYXJuLmdldChkZWZJZCkgPz8gbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmV3YXJkSW52ZW50b3J5KVxuICAgICAgICAgIC5leGVjdXRlKClcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIFJld2FyZFJ1bGUsXG4gIFJld2FyZFJ1bGVDb25maWcsXG4gIFJld2FyZFJ1bGVNb2RlLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRDb250ZXh0IHtcbiAgdXNlcklkOiBudW1iZXJcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgdHJpZ2dlcktleTogc3RyaW5nXG4gIGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsXG4gIGdvYWxJZD86IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBjeWNsZUlkPzogbnVtYmVyIHwgbnVsbFxuICAvKiogUHJpb3IgZWFybiBjb3VudCBmb3IgdGhpcyBydWxlIChmb3Igb25jZSAvIG1heF9ncmFudHMpLiAqL1xuICBwcmlvckVhcm5Db3VudDogbnVtYmVyXG4gIC8qKiBJU08gdGltZXN0YW1wIG9mIGxhc3QgZWFybiBmb3IgdGhpcyBydWxlLCBpZiBhbnkuICovXG4gIGxhc3RFYXJuQXQ6IHN0cmluZyB8IG51bGxcbiAgbm93PzogRGF0ZVxuICAvKiogUk5HIGZvciBwcm9iYWJpbGl0eSAvIHJhbmRvbV9wb29sIChpbmplY3RhYmxlIGZvciB0ZXN0cykuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdyYW50SW5zdHJ1Y3Rpb24ge1xuICBydWxlSWQ6IG51bWJlciB8IG51bGxcbiAgZGVmaW5pdGlvbklkOiBudW1iZXJcbiAgcXVhbnRpdHk6IG51bWJlclxuICB0cmlnZ2VyS2V5OiBzdHJpbmdcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIHNvdXJjZUlkOiBudW1iZXJcbiAgYWN0aXZpdHlJZD86IG51bWJlciB8IG51bGxcbiAgZ29hbElkPzogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uSWQ/OiBudW1iZXIgfCBudWxsXG4gIGN5Y2xlSWQ/OiBudW1iZXIgfCBudWxsXG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKGNvbmZpZzogUmV3YXJkUnVsZVsnY29uZmlnJ10pOiBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgaWYgKGNvbmZpZyA9PSBudWxsKSByZXR1cm4ge31cbiAgaWYgKHR5cGVvZiBjb25maWcgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKGNvbmZpZykgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHt9XG4gICAgfVxuICB9XG4gIHJldHVybiBjb25maWcgYXMgUmV3YXJkUnVsZUNvbmZpZ1xufVxuXG4vKipcbiAqIEV2YWx1YXRlIGEgc2luZ2xlIHJld2FyZCBydWxlIGFnYWluc3QgYSBncmFudCBjb250ZXh0LlxuICogUmV0dXJucyBudWxsIHdoZW4gdGhlIHJ1bGUgc2hvdWxkIG5vdCBncmFudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlUnVsZShcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4pOiBHcmFudEluc3RydWN0aW9uIHwgbnVsbCB7XG4gIGlmICghcnVsZS5lbmFibGVkKSByZXR1cm4gbnVsbFxuXG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHJ1bGUuY29uZmlnKVxuICBjb25zdCBub3cgPSBjdHgubm93ID8/IG5ldyBEYXRlKClcbiAgY29uc3QgcmFuZG9tID0gY3R4LnJhbmRvbSA/PyBNYXRoLnJhbmRvbVxuXG4gIGlmIChjb25maWcub25jZSAmJiBjdHgucHJpb3JFYXJuQ291bnQgPiAwKSByZXR1cm4gbnVsbFxuXG4gIGlmIChcbiAgICB0eXBlb2YgY29uZmlnLm1heF9ncmFudHNfdG90YWwgPT09ICdudW1iZXInICYmXG4gICAgY3R4LnByaW9yRWFybkNvdW50ID49IGNvbmZpZy5tYXhfZ3JhbnRzX3RvdGFsXG4gICkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBpZiAoXG4gICAgdHlwZW9mIGNvbmZpZy5jb29sZG93bl9ob3VycyA9PT0gJ251bWJlcicgJiZcbiAgICBjb25maWcuY29vbGRvd25faG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBjb25zdCBjb29sZG93bk1zID0gY29uZmlnLmNvb2xkb3duX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICBpZiAobm93LmdldFRpbWUoKSAtIGxhc3QgPCBjb29sZG93bk1zKSByZXR1cm4gbnVsbFxuICB9XG5cbiAgaWYgKFxuICAgIHR5cGVvZiBjb25maWcubWF4X2dyYW50c19wZXJfcGVyaW9kID09PSAnbnVtYmVyJyAmJlxuICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgIGNvbmZpZy5wZXJpb2RfaG91cnMgPiAwICYmXG4gICAgY3R4Lmxhc3RFYXJuQXRcbiAgKSB7XG4gICAgLy8gTGlnaHR3ZWlnaHQgcGVyaW9kIGNoZWNrOiBpZiBsYXN0IGVhcm4gaXMgd2l0aGluIHBlcmlvZCBhbmQgd2UndmVcbiAgICAvLyBhbHJlYWR5IGhpdCB0aGUgY2FwIHZpYSBwcmlvckVhcm5Db3VudCBhcHByb3hpbWF0aW9uLCBza2lwLlxuICAgIC8vIEZ1bGwgcGVyaW9kIGNvdW50aW5nIGlzIGhhbmRsZWQgYnkgY2FsbGVycyB0aGF0IHNldCBwcmlvckVhcm5Db3VudFxuICAgIC8vIHRvIHRoZSBjb3VudCB3aXRoaW4gdGhlIHBlcmlvZCB3aW5kb3cgd2hlbiBwZXJpb2RfaG91cnMgaXMgc2V0LlxuICAgIGNvbnN0IHBlcmlvZE1zID0gY29uZmlnLnBlcmlvZF9ob3VycyAqIDYwICogNjAgKiAxMDAwXG4gICAgY29uc3QgbGFzdCA9IG5ldyBEYXRlKGN0eC5sYXN0RWFybkF0KS5nZXRUaW1lKClcbiAgICBpZiAoXG4gICAgICBub3cuZ2V0VGltZSgpIC0gbGFzdCA8IHBlcmlvZE1zICYmXG4gICAgICBjdHgucHJpb3JFYXJuQ291bnQgPj0gY29uZmlnLm1heF9ncmFudHNfcGVyX3BlcmlvZFxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cblxuICBjb25zdCBtb2RlID0gcnVsZS5tb2RlIGFzIFJld2FyZFJ1bGVNb2RlXG5cbiAgaWYgKG1vZGUgPT09ICdwcm9iYWJpbGl0eScpIHtcbiAgICBjb25zdCBwID1cbiAgICAgIHR5cGVvZiBjb25maWcucHJvYmFiaWxpdHkgPT09ICdudW1iZXInID8gY29uZmlnLnByb2JhYmlsaXR5IDogMVxuICAgIGlmIChyYW5kb20oKSA+IHApIHJldHVybiBudWxsXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihydWxlLCBjdHgsIHJ1bGUucmV3YXJkX2RlZmluaXRpb25faWQsIHJ1bGUucXVhbnRpdHkpXG4gIH1cblxuICBpZiAobW9kZSA9PT0gJ3JhbmRvbV9wb29sJykge1xuICAgIGNvbnN0IHBvb2wgPSBjb25maWcucG9vbFxuICAgIGlmICghcG9vbCB8fCBwb29sLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG51bGxcbiAgICBjb25zdCB0b3RhbFdlaWdodCA9IHBvb2wucmVkdWNlKChzLCBlKSA9PiBzICsgKGUud2VpZ2h0ID8/IDEpLCAwKVxuICAgIGlmICh0b3RhbFdlaWdodCA8PSAwKSByZXR1cm4gbnVsbFxuICAgIGxldCByb2xsID0gcmFuZG9tKCkgKiB0b3RhbFdlaWdodFxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgcG9vbCkge1xuICAgICAgcm9sbCAtPSBlbnRyeS53ZWlnaHQgPz8gMVxuICAgICAgaWYgKHJvbGwgPD0gMCkge1xuICAgICAgICByZXR1cm4gYmFzZUluc3RydWN0aW9uKFxuICAgICAgICAgIHJ1bGUsXG4gICAgICAgICAgY3R4LFxuICAgICAgICAgIGVudHJ5LmRlZmluaXRpb25faWQsXG4gICAgICAgICAgZW50cnkucXVhbnRpdHkgPz8gcnVsZS5xdWFudGl0eSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH1cbiAgICBjb25zdCBsYXN0ID0gcG9vbFtwb29sLmxlbmd0aCAtIDFdXG4gICAgcmV0dXJuIGJhc2VJbnN0cnVjdGlvbihcbiAgICAgIHJ1bGUsXG4gICAgICBjdHgsXG4gICAgICBsYXN0LmRlZmluaXRpb25faWQsXG4gICAgICBsYXN0LnF1YW50aXR5ID8/IHJ1bGUucXVhbnRpdHksXG4gICAgKVxuICB9XG5cbiAgLy8gZml4ZWQgKGRlZmF1bHQpXG4gIHJldHVybiBiYXNlSW5zdHJ1Y3Rpb24oXG4gICAgcnVsZSxcbiAgICBjdHgsXG4gICAgcnVsZS5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICBydWxlLnF1YW50aXR5LFxuICApXG59XG5cbmZ1bmN0aW9uIGJhc2VJbnN0cnVjdGlvbihcbiAgcnVsZTogUmV3YXJkUnVsZSxcbiAgY3R4OiBHcmFudENvbnRleHQsXG4gIGRlZmluaXRpb25JZDogbnVtYmVyLFxuICBxdWFudGl0eTogbnVtYmVyLFxuKTogR3JhbnRJbnN0cnVjdGlvbiB7XG4gIHJldHVybiB7XG4gICAgcnVsZUlkOiBydWxlLmlkLFxuICAgIGRlZmluaXRpb25JZCxcbiAgICBxdWFudGl0eTogTWF0aC5tYXgoMSwgTWF0aC5mbG9vcihxdWFudGl0eSkpLFxuICAgIHRyaWdnZXJLZXk6IGN0eC50cmlnZ2VyS2V5LFxuICAgIHNvdXJjZVR5cGU6IGN0eC5zb3VyY2VUeXBlLFxuICAgIHNvdXJjZUlkOiBjdHguc291cmNlSWQsXG4gICAgYWN0aXZpdHlJZDogY3R4LmFjdGl2aXR5SWQgPz8gbnVsbCxcbiAgICBnb2FsSWQ6IGN0eC5nb2FsSWQgPz8gbnVsbCxcbiAgICBjb21wbGV0aW9uSWQ6IGN0eC5jb21wbGV0aW9uSWQgPz8gbnVsbCxcbiAgICBjeWNsZUlkOiBjdHguY3ljbGVJZCA/PyBudWxsLFxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgUmV3YXJkRGVmaW5pdGlvbixcbiAgUmV3YXJkUnVsZSxcbiAgUmV3YXJkVHJhbnNhY3Rpb24sXG59IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIERiSW52ZW50b3J5TWFuYWdlcixcbiAgdHlwZSBJbnZlbnRvcnlNYW5hZ2VyLFxufSBmcm9tICcuL2ludmVudG9yeS50cydcbmltcG9ydCB7XG4gIGV2YWx1YXRlUnVsZSxcbiAgdHlwZSBHcmFudENvbnRleHQsXG4gIHR5cGUgR3JhbnRJbnN0cnVjdGlvbixcbn0gZnJvbSAnLi9ydWxlcy9ldmFsdWF0ZS50cydcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+XG5cbmV4cG9ydCBpbnRlcmZhY2UgR3JhbnRSZXN1bHQge1xuICBpbnN0cnVjdGlvbjogR3JhbnRJbnN0cnVjdGlvblxuICB0cmFuc2FjdGlvbjogUmV3YXJkVHJhbnNhY3Rpb24gfCBudWxsXG4gIHNraXBwZWQ6IGJvb2xlYW5cbiAgcmVhc29uPzogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmV3YXJkR3JhbnRTZXJ2aWNlIHtcbiAgZ3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSxcbiAgKTogUHJvbWlzZTxHcmFudFJlc3VsdFtdPlxuXG4gIGNvbGxlY3RBbmRHcmFudChcbiAgICBkYjogRGJMaWtlLFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIHJ1bGVzOiBSZXdhcmRSdWxlW10sXG4gICAgYmFzZUN0eDogT21pdDxHcmFudENvbnRleHQsICdwcmlvckVhcm5Db3VudCcgfCAnbGFzdEVhcm5BdCcgfCAndXNlcklkJz4sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT5cbn1cblxuZXhwb3J0IGNsYXNzIERlZmF1bHRSZXdhcmRHcmFudFNlcnZpY2UgaW1wbGVtZW50cyBSZXdhcmRHcmFudFNlcnZpY2Uge1xuICBjb25zdHJ1Y3RvcihcbiAgICBwcml2YXRlIHJlYWRvbmx5IGludmVudG9yeTogSW52ZW50b3J5TWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKSxcbiAgKSB7fVxuXG4gIGFzeW5jIGdyYW50KFxuICAgIGRiOiBEYkxpa2UsXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgaW5zdHJ1Y3Rpb25zOiBHcmFudEluc3RydWN0aW9uW10sXG4gICk6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICAgIGNvbnN0IHJlc3VsdHM6IEdyYW50UmVzdWx0W10gPSBbXVxuXG4gICAgZm9yIChjb25zdCBpbnN0cnVjdGlvbiBvZiBpbnN0cnVjdGlvbnMpIHtcbiAgICAgIC8vIElkZW1wb3RlbmN5OiBza2lwIGlmIGVhcm4gYWxyZWFkeSBleGlzdHMuXG4gICAgICBsZXQgZXhpc3RpbmdRdWVyeSA9IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfdHJhbnNhY3Rpb25zJylcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgICAud2hlcmUoJ3RyaWdnZXJfa2V5JywgJz0nLCBpbnN0cnVjdGlvbi50cmlnZ2VyS2V5KVxuXG4gICAgICBpZiAoaW5zdHJ1Y3Rpb24ucnVsZUlkICE9IG51bGwpIHtcbiAgICAgICAgZXhpc3RpbmdRdWVyeSA9IGV4aXN0aW5nUXVlcnkud2hlcmUoJ3J1bGVfaWQnLCAnPScsIGluc3RydWN0aW9uLnJ1bGVJZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGV4aXN0aW5nUXVlcnkgPSBleGlzdGluZ1F1ZXJ5LndoZXJlKCdydWxlX2lkJywgJ2lzJywgbnVsbClcbiAgICAgIH1cblxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBleGlzdGluZ1F1ZXJ5LnNlbGVjdEFsbCgpLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgcmVzdWx0cy5wdXNoKHtcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICB0cmFuc2FjdGlvbjogZXhpc3RpbmcsXG4gICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICByZWFzb246ICdhbHJlYWR5X2dyYW50ZWQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBkZWZpbml0aW9uID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGluc3RydWN0aW9uLmRlZmluaXRpb25JZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIGlmICghZGVmaW5pdGlvbikge1xuICAgICAgICByZXN1bHRzLnB1c2goe1xuICAgICAgICAgIGluc3RydWN0aW9uLFxuICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgIHNraXBwZWQ6IHRydWUsXG4gICAgICAgICAgcmVhc29uOiAnZGVmaW5pdGlvbl9ub3RfZm91bmQnLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBjb25zdCB7IHRyYW5zYWN0aW9uIH0gPSBhd2FpdCB0aGlzLmludmVudG9yeS5hcHBseUVhcm4oXG4gICAgICAgICAgZGIsXG4gICAgICAgICAgdXNlcklkLFxuICAgICAgICAgIGRlZmluaXRpb24gYXMgUmV3YXJkRGVmaW5pdGlvbixcbiAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgKVxuICAgICAgICByZXN1bHRzLnB1c2goeyBpbnN0cnVjdGlvbiwgdHJhbnNhY3Rpb24sIHNraXBwZWQ6IGZhbHNlIH0pXG4gICAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgICAgLy8gVW5pcXVlIGNvbnN0cmFpbnQgcmFjZSBcdTIxOTIgdHJlYXQgYXMgYWxyZWFkeSBncmFudGVkLlxuICAgICAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpXG4gICAgICAgIGlmIChcbiAgICAgICAgICBtZXNzYWdlLmluY2x1ZGVzKCdyZXdhcmRfdHJhbnNhY3Rpb25zX2Vhcm5faWRlbXBvdGVuY3knKSB8fFxuICAgICAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoJ3VuaXF1ZScpXG4gICAgICAgICkge1xuICAgICAgICAgIHJlc3VsdHMucHVzaCh7XG4gICAgICAgICAgICBpbnN0cnVjdGlvbixcbiAgICAgICAgICAgIHRyYW5zYWN0aW9uOiBudWxsLFxuICAgICAgICAgICAgc2tpcHBlZDogdHJ1ZSxcbiAgICAgICAgICAgIHJlYXNvbjogJ2FscmVhZHlfZ3JhbnRlZCcsXG4gICAgICAgICAgfSlcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG4gICAgICAgIHRocm93IGVyclxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiByZXN1bHRzXG4gIH1cblxuICBhc3luYyBjb2xsZWN0QW5kR3JhbnQoXG4gICAgZGI6IERiTGlrZSxcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgICBydWxlczogUmV3YXJkUnVsZVtdLFxuICAgIGJhc2VDdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnIHwgJ3VzZXJJZCc+LFxuICApOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgICBjb25zdCBpbnN0cnVjdGlvbnM6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG5cbiAgICBmb3IgKGNvbnN0IHJ1bGUgb2YgcnVsZXMpIHtcbiAgICAgIGNvbnN0IGVhcm5zID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCd0eXBlJywgJz0nLCAnZWFybicpXG4gICAgICAgIC53aGVyZSgncnVsZV9pZCcsICc9JywgcnVsZS5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG5cbiAgICAgIGNvbnN0IGNvbmZpZyA9XG4gICAgICAgIHR5cGVvZiBydWxlLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IEpTT04ucGFyc2UocnVsZS5jb25maWcpXG4gICAgICAgICAgOiBydWxlLmNvbmZpZyA/PyB7fVxuXG4gICAgICBsZXQgcHJpb3JFYXJuQ291bnQgPSBlYXJucy5sZW5ndGhcbiAgICAgIGxldCBsYXN0RWFybkF0OiBzdHJpbmcgfCBudWxsID1cbiAgICAgICAgZWFybnNbMF0gIT0gbnVsbFxuICAgICAgICAgID8gdHlwZW9mIGVhcm5zWzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGVhcm5zWzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgIDogbmV3IERhdGUoZWFybnNbMF0uY3JlYXRlZF9hdCkudG9JU09TdHJpbmcoKVxuICAgICAgICAgIDogbnVsbFxuXG4gICAgICAvLyBXaGVuIHBlcmlvZF9ob3VycyBpcyBzZXQsIGNvdW50IG9ubHkgZWFybnMgaW5zaWRlIHRoZSB3aW5kb3cuXG4gICAgICBpZiAoXG4gICAgICAgIHR5cGVvZiBjb25maWcucGVyaW9kX2hvdXJzID09PSAnbnVtYmVyJyAmJlxuICAgICAgICBjb25maWcucGVyaW9kX2hvdXJzID4gMFxuICAgICAgKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IGJhc2VDdHgubm93ID8/IG5ldyBEYXRlKClcbiAgICAgICAgY29uc3Qgd2luZG93TXMgPSBjb25maWcucGVyaW9kX2hvdXJzICogNjAgKiA2MCAqIDEwMDBcbiAgICAgICAgY29uc3QgaW5XaW5kb3cgPSBlYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICAgICAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICAgICAgICByZXR1cm4gbm93LmdldFRpbWUoKSAtIHQgPCB3aW5kb3dNc1xuICAgICAgICB9KVxuICAgICAgICBwcmlvckVhcm5Db3VudCA9IGluV2luZG93Lmxlbmd0aFxuICAgICAgICBsYXN0RWFybkF0ID1cbiAgICAgICAgICBpbldpbmRvd1swXSAhPSBudWxsXG4gICAgICAgICAgICA/IHR5cGVvZiBpbldpbmRvd1swXS5jcmVhdGVkX2F0ID09PSAnc3RyaW5nJ1xuICAgICAgICAgICAgICA/IGluV2luZG93WzBdLmNyZWF0ZWRfYXRcbiAgICAgICAgICAgICAgOiBuZXcgRGF0ZShpbldpbmRvd1swXS5jcmVhdGVkX2F0KS50b0lTT1N0cmluZygpXG4gICAgICAgICAgICA6IG51bGxcbiAgICAgIH1cblxuICAgICAgY29uc3QgY3R4OiBHcmFudENvbnRleHQgPSB7XG4gICAgICAgIC4uLmJhc2VDdHgsXG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgcHJpb3JFYXJuQ291bnQsXG4gICAgICAgIGxhc3RFYXJuQXQsXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIGN0eClcbiAgICAgIGlmIChpbnN0cnVjdGlvbikgaW5zdHJ1Y3Rpb25zLnB1c2goaW5zdHJ1Y3Rpb24pXG4gICAgfVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZ3JhbnQoZGIsIHVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxuICB9XG59XG5cbmV4cG9ydCBjb25zdCByZXdhcmRHcmFudFNlcnZpY2UgPSBuZXcgRGVmYXVsdFJld2FyZEdyYW50U2VydmljZSgpXG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBEYXRhYmFzZSwgUmV3YXJkUnVsZSB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRJbnN0cnVjdGlvbiB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuaW1wb3J0IHsgZXZhbHVhdGVSdWxlLCB0eXBlIEdyYW50Q29udGV4dCB9IGZyb20gJy4uL3J1bGVzL2V2YWx1YXRlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRTb3VyY2VBZGFwdGVyIHtcbiAgc291cmNlVHlwZTogc3RyaW5nXG4gIGNvbGxlY3RHcmFudHMoXG4gICAgZGI6IERiTGlrZSxcbiAgICBjdHg6IE9taXQ8R3JhbnRDb250ZXh0LCAncHJpb3JFYXJuQ291bnQnIHwgJ2xhc3RFYXJuQXQnPixcbiAgKTogUHJvbWlzZTxHcmFudEluc3RydWN0aW9uW10+XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRSdWxlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIHNvdXJjZVR5cGU6IHN0cmluZyxcbiAgc291cmNlSWQ6IG51bWJlcixcbik6IFByb21pc2U8UmV3YXJkUnVsZVtdPiB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc291cmNlX3R5cGUnLCAnPScsIHNvdXJjZVR5cGUpXG4gICAgLndoZXJlKCdzb3VyY2VfaWQnLCAnPScsIHNvdXJjZUlkKVxuICAgIC53aGVyZSgnZW5hYmxlZCcsICc9JywgdHJ1ZSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVucmljaEFuZEV2YWx1YXRlKFxuICBkYjogRGJMaWtlLFxuICBydWxlczogUmV3YXJkUnVsZVtdLFxuICBiYXNlOiBPbWl0PEdyYW50Q29udGV4dCwgJ3ByaW9yRWFybkNvdW50JyB8ICdsYXN0RWFybkF0Jz4sXG4pOiBQcm9taXNlPEdyYW50SW5zdHJ1Y3Rpb25bXT4ge1xuICBjb25zdCBvdXQ6IEdyYW50SW5zdHJ1Y3Rpb25bXSA9IFtdXG4gIGZvciAoY29uc3QgcnVsZSBvZiBydWxlcykge1xuICAgIGNvbnN0IGxhc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBiYXNlLnVzZXJJZClcbiAgICAgIC53aGVyZSgndHlwZScsICc9JywgJ2Vhcm4nKVxuICAgICAgLndoZXJlKCdydWxlX2lkJywgJz0nLCBydWxlLmlkKVxuICAgICAgLm9yZGVyQnkoJ2NyZWF0ZWRfYXQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IGluc3RydWN0aW9uID0gZXZhbHVhdGVSdWxlKHJ1bGUsIHtcbiAgICAgIC4uLmJhc2UsXG4gICAgICBwcmlvckVhcm5Db3VudDogbGFzdC5sZW5ndGgsXG4gICAgICBsYXN0RWFybkF0OlxuICAgICAgICBsYXN0WzBdICE9IG51bGxcbiAgICAgICAgICA/IHR5cGVvZiBsYXN0WzBdLmNyZWF0ZWRfYXQgPT09ICdzdHJpbmcnXG4gICAgICAgICAgICA/IGxhc3RbMF0uY3JlYXRlZF9hdFxuICAgICAgICAgICAgOiBuZXcgRGF0ZShsYXN0WzBdLmNyZWF0ZWRfYXQpLnRvSVNPU3RyaW5nKClcbiAgICAgICAgICA6IG51bGwsXG4gICAgfSlcbiAgICBpZiAoaW5zdHJ1Y3Rpb24pIG91dC5wdXNoKGluc3RydWN0aW9uKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5UmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnYWN0aXZpdHknLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhkYiwgY3R4LnVzZXJJZCwgJ2FjdGl2aXR5JywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdvYWxSZXdhcmRTb3VyY2U6IFJld2FyZFNvdXJjZUFkYXB0ZXIgPSB7XG4gIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgYXN5bmMgY29sbGVjdEdyYW50cyhkYiwgY3R4KSB7XG4gICAgY29uc3QgcnVsZXMgPSBhd2FpdCBsb2FkUnVsZXMoZGIsIGN0eC51c2VySWQsICdnb2FsJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogc3RyZWFrLWJhc2VkIGdyYW50cyAoUGhhc2UgMyBzdHViIFx1MjAxNCByZWdpc3RlciB3aGVuIHN0cmVhayBldmVudHMgZXhpc3QpLiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha1Jld2FyZFNvdXJjZTogUmV3YXJkU291cmNlQWRhcHRlciA9IHtcbiAgc291cmNlVHlwZTogJ3N0cmVhaycsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKGRiLCBjdHgudXNlcklkLCAnc3RyZWFrJywgY3R4LnNvdXJjZUlkKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuLyoqIEZ1dHVyZTogZGFpbHkgY29tcGxldGlvbiBncmFudHMuICovXG5leHBvcnQgY29uc3QgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnZGFpbHlfY29tcGxldGlvbicsXG4gIGFzeW5jIGNvbGxlY3RHcmFudHMoZGIsIGN0eCkge1xuICAgIGNvbnN0IHJ1bGVzID0gYXdhaXQgbG9hZFJ1bGVzKFxuICAgICAgZGIsXG4gICAgICBjdHgudXNlcklkLFxuICAgICAgJ2RhaWx5X2NvbXBsZXRpb24nLFxuICAgICAgY3R4LnNvdXJjZUlkLFxuICAgIClcbiAgICByZXR1cm4gZW5yaWNoQW5kRXZhbHVhdGUoZGIsIHJ1bGVzLCBjdHgpXG4gIH0sXG59XG5cbi8qKiBGdXR1cmU6IHdlZWtseSBjb21wbGV0aW9uIGdyYW50cy4gKi9cbmV4cG9ydCBjb25zdCB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlOiBSZXdhcmRTb3VyY2VBZGFwdGVyID0ge1xuICBzb3VyY2VUeXBlOiAnd2Vla2x5X2NvbXBsZXRpb24nLFxuICBhc3luYyBjb2xsZWN0R3JhbnRzKGRiLCBjdHgpIHtcbiAgICBjb25zdCBydWxlcyA9IGF3YWl0IGxvYWRSdWxlcyhcbiAgICAgIGRiLFxuICAgICAgY3R4LnVzZXJJZCxcbiAgICAgICd3ZWVrbHlfY29tcGxldGlvbicsXG4gICAgICBjdHguc291cmNlSWQsXG4gICAgKVxuICAgIHJldHVybiBlbnJpY2hBbmRFdmFsdWF0ZShkYiwgcnVsZXMsIGN0eClcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IFJFV0FSRF9TT1VSQ0VfQURBUFRFUlM6IFJld2FyZFNvdXJjZUFkYXB0ZXJbXSA9IFtcbiAgYWN0aXZpdHlSZXdhcmRTb3VyY2UsXG4gIGdvYWxSZXdhcmRTb3VyY2UsXG4gIHN0cmVha1Jld2FyZFNvdXJjZSxcbiAgZGFpbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuICB3ZWVrbHlDb21wbGV0aW9uUmV3YXJkU291cmNlLFxuXVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UmV3YXJkU291cmNlQWRhcHRlcihcbiAgc291cmNlVHlwZTogc3RyaW5nLFxuKTogUmV3YXJkU291cmNlQWRhcHRlciB8IG51bGwge1xuICByZXR1cm4gKFxuICAgIFJFV0FSRF9TT1VSQ0VfQURBUFRFUlMuZmluZCgoYSkgPT4gYS5zb3VyY2VUeXBlID09PSBzb3VyY2VUeXBlKSA/PyBudWxsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknXG5pbXBvcnQgdHlwZSB7IERhdGFiYXNlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgcmV3YXJkR3JhbnRTZXJ2aWNlIH0gZnJvbSAnLi9ncmFudF9zZXJ2aWNlLnRzJ1xuaW1wb3J0IHsgZ2V0UmV3YXJkU291cmNlQWRhcHRlciB9IGZyb20gJy4vc291cmNlcy9pbmRleC50cydcbmltcG9ydCB0eXBlIHsgR3JhbnRSZXN1bHQgfSBmcm9tICcuL2dyYW50X3NlcnZpY2UudHMnXG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPlxuXG4vKiogR3JhbnQgcmV3YXJkcyBmb3IgYW4gYWN0aXZpdHkgY29tcGxldGlvbiAoaWRlbXBvdGVudCBwZXIgY29tcGxldGlvbitydWxlKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24oXG4gIGRiOiBEYkxpa2UsXG4gIG9wdHM6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGFjdGl2aXR5SWQ6IG51bWJlclxuICAgIGNvbXBsZXRpb25JZDogbnVtYmVyXG4gIH0sXG4pOiBQcm9taXNlPEdyYW50UmVzdWx0W10+IHtcbiAgY29uc3QgYWRhcHRlciA9IGdldFJld2FyZFNvdXJjZUFkYXB0ZXIoJ2FjdGl2aXR5JylcbiAgaWYgKCFhZGFwdGVyKSByZXR1cm4gW11cblxuICBjb25zdCB0cmlnZ2VyS2V5ID0gYGNvbXBsZXRpb246JHtvcHRzLmNvbXBsZXRpb25JZH1gXG4gIGNvbnN0IGluc3RydWN0aW9ucyA9IGF3YWl0IGFkYXB0ZXIuY29sbGVjdEdyYW50cyhkYiwge1xuICAgIHVzZXJJZDogb3B0cy51c2VySWQsXG4gICAgc291cmNlVHlwZTogJ2FjdGl2aXR5JyxcbiAgICBzb3VyY2VJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIHRyaWdnZXJLZXksXG4gICAgYWN0aXZpdHlJZDogb3B0cy5hY3Rpdml0eUlkLFxuICAgIGNvbXBsZXRpb25JZDogb3B0cy5jb21wbGV0aW9uSWQsXG4gIH0pXG5cbiAgcmV0dXJuIGF3YWl0IHJld2FyZEdyYW50U2VydmljZS5ncmFudChkYiwgb3B0cy51c2VySWQsIGluc3RydWN0aW9ucylcbn1cblxuLyoqIEdyYW50IHJld2FyZHMgd2hlbiBhIGdvYWwgY3ljbGUgdHJhbnNpdGlvbnMgdG8gc3VjY2VlZGVkIChlZGdlLXRyaWdnZXJlZCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyhcbiAgZGI6IERiTGlrZSxcbiAgb3B0czoge1xuICAgIHVzZXJJZDogbnVtYmVyXG4gICAgZ29hbElkOiBudW1iZXJcbiAgICBjeWNsZUlkOiBudW1iZXJcbiAgfSxcbik6IFByb21pc2U8R3JhbnRSZXN1bHRbXT4ge1xuICBjb25zdCBhZGFwdGVyID0gZ2V0UmV3YXJkU291cmNlQWRhcHRlcignZ29hbCcpXG4gIGlmICghYWRhcHRlcikgcmV0dXJuIFtdXG5cbiAgY29uc3QgdHJpZ2dlcktleSA9IGBjeWNsZToke29wdHMuY3ljbGVJZH06c3VjY2VlZGVkYFxuICBjb25zdCBpbnN0cnVjdGlvbnMgPSBhd2FpdCBhZGFwdGVyLmNvbGxlY3RHcmFudHMoZGIsIHtcbiAgICB1c2VySWQ6IG9wdHMudXNlcklkLFxuICAgIHNvdXJjZVR5cGU6ICdnb2FsJyxcbiAgICBzb3VyY2VJZDogb3B0cy5nb2FsSWQsXG4gICAgdHJpZ2dlcktleSxcbiAgICBnb2FsSWQ6IG9wdHMuZ29hbElkLFxuICAgIGN5Y2xlSWQ6IG9wdHMuY3ljbGVJZCxcbiAgfSlcblxuICByZXR1cm4gYXdhaXQgcmV3YXJkR3JhbnRTZXJ2aWNlLmdyYW50KGRiLCBvcHRzLnVzZXJJZCwgaW5zdHJ1Y3Rpb25zKVxufVxuIiwgImltcG9ydCB0eXBlIHsgUmV3YXJkSW52ZW50b3J5LCBSZXdhcmRUcmFuc2FjdGlvbiB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgUmV3YXJkTnVkZ2VLaW5kID1cbiAgfCAnaW52ZW50b3J5X2F2YWlsYWJsZSdcbiAgfCAncmVjZW50bHlfZWFybmVkJ1xuICB8ICd1bmNvbnN1bWVkX3N0YWNrJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZE51ZGdlIHtcbiAga2luZDogUmV3YXJkTnVkZ2VLaW5kXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnc3VjY2VzcydcbiAgZGVmaW5pdGlvbklkPzogbnVtYmVyIHwgbnVsbFxuICBpbnZlbnRvcnlJZD86IG51bWJlciB8IG51bGxcbn1cblxuLyoqXG4gKiBCdWlsZCBsaWdodHdlaWdodCByZXdhcmQgbnVkZ2VzIGZvciB0aGUgT3ZlcnZpZXcgc3VyZmFjZS5cbiAqIFB1cmUgXHUyMDE0IG5vIEkvTy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkUmV3YXJkTnVkZ2VzKGlucHV0OiB7XG4gIGludmVudG9yeTogQXJyYXk8XG4gICAgUGljazxSZXdhcmRJbnZlbnRvcnksICdpZCcgfCAncXVhbnRpdHknIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJz4gJiB7XG4gICAgICBuYW1lPzogc3RyaW5nXG4gICAgfVxuICA+XG4gIHJlY2VudEVhcm5zOiBBcnJheTxcbiAgICBQaWNrPFxuICAgICAgUmV3YXJkVHJhbnNhY3Rpb24sXG4gICAgICAnaWQnIHwgJ2RlZmluaXRpb25fbmFtZScgfCAncXVhbnRpdHknIHwgJ2NyZWF0ZWRfYXQnIHwgJ3Jld2FyZF9kZWZpbml0aW9uX2lkJ1xuICAgID5cbiAgPlxuICBub3c/OiBEYXRlXG59KTogUmV3YXJkTnVkZ2VbXSB7XG4gIGNvbnN0IG51ZGdlczogUmV3YXJkTnVkZ2VbXSA9IFtdXG4gIGNvbnN0IG5vdyA9IGlucHV0Lm5vdyA/PyBuZXcgRGF0ZSgpXG5cbiAgY29uc3QgdG90YWxRdHkgPSBpbnB1dC5pbnZlbnRvcnkucmVkdWNlKChzLCBpKSA9PiBzICsgaS5xdWFudGl0eSwgMClcbiAgaWYgKHRvdGFsUXR5ID4gMCkge1xuICAgIGNvbnN0IHRvcCA9IFsuLi5pbnB1dC5pbnZlbnRvcnldLnNvcnQoKGEsIGIpID0+IGIucXVhbnRpdHkgLSBhLnF1YW50aXR5KVswXVxuICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdpbnZlbnRvcnlfYXZhaWxhYmxlJyxcbiAgICAgIHRpdGxlOiAnUmV3YXJkcyByZWFkeScsXG4gICAgICBtZXNzYWdlOlxuICAgICAgICB0b3RhbFF0eSA9PT0gMVxuICAgICAgICAgID8gJ1lvdSBoYXZlIDEgcmV3YXJkIHdhaXRpbmcgdG8gYmUgZW5qb3llZC4nXG4gICAgICAgICAgOiBgWW91IGhhdmUgJHt0b3RhbFF0eX0gcmV3YXJkcyB3YWl0aW5nIHRvIGJlIGVuam95ZWQuYCxcbiAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICBkZWZpbml0aW9uSWQ6IHRvcD8ucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogdG9wPy5pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgZGF5QWdvID0gbm93LmdldFRpbWUoKSAtIDI0ICogNjAgKiA2MCAqIDEwMDBcbiAgY29uc3QgZnJlc2ggPSBpbnB1dC5yZWNlbnRFYXJucy5maWx0ZXIoKGUpID0+IHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5jcmVhdGVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBkYXlBZ29cbiAgfSlcbiAgZm9yIChjb25zdCBlYXJuIG9mIGZyZXNoLnNsaWNlKDAsIDMpKSB7XG4gICAgbnVkZ2VzLnB1c2goe1xuICAgICAga2luZDogJ3JlY2VudGx5X2Vhcm5lZCcsXG4gICAgICB0aXRsZTogJ1Jld2FyZCBlYXJuZWQnLFxuICAgICAgbWVzc2FnZTogYFlvdSBlYXJuZWQgJHtlYXJuLmRlZmluaXRpb25fbmFtZX0gXHUwMEQ3JHtlYXJuLnF1YW50aXR5fS5gLFxuICAgICAgc2V2ZXJpdHk6ICdzdWNjZXNzJyxcbiAgICAgIGRlZmluaXRpb25JZDogZWFybi5yZXdhcmRfZGVmaW5pdGlvbl9pZCxcbiAgICB9KVxuICB9XG5cbiAgY29uc3QgYmlnU3RhY2sgPSBpbnB1dC5pbnZlbnRvcnkuZmluZCgoaSkgPT4gaS5xdWFudGl0eSA+PSA1KVxuICBpZiAoYmlnU3RhY2spIHtcbiAgICBudWRnZXMucHVzaCh7XG4gICAgICBraW5kOiAndW5jb25zdW1lZF9zdGFjaycsXG4gICAgICB0aXRsZTogJ0dyb3dpbmcgc3RhY2snLFxuICAgICAgbWVzc2FnZTogYCR7YmlnU3RhY2submFtZSA/PyAnQSByZXdhcmQnfSBpcyBzdGFja2VkIFx1MDBENyR7YmlnU3RhY2sucXVhbnRpdHl9IFx1MjAxNCB0cmVhdCB5b3Vyc2VsZj9gLFxuICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgIGRlZmluaXRpb25JZDogYmlnU3RhY2sucmV3YXJkX2RlZmluaXRpb25faWQsXG4gICAgICBpbnZlbnRvcnlJZDogYmlnU3RhY2suaWQsXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBhcHAgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgY3JlYXRlUHVzaFNlbmRlckZyb21FbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvcHVzaC9tb2QudHMnXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7XG4gIGNvcnNNaWRkbGV3YXJlLFxuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG59IGZyb20gJ2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZSxcbiAgaGVhbHRoTWlkZGxld2FyZSxcbn0gZnJvbSAnZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB7XG4gIEFzc2V0VmFsaWRhdGlvbkVycm9yLFxuICBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5LFxufSBmcm9tICcuL2Fzc2V0cy9yZXBvc2l0b3J5LnRzJ1xuaW1wb3J0IHsgTUFYX0FTU0VUX0JZVEVTIH0gZnJvbSAnLi9hc3NldHMvc3RvcmFnZS90eXBlcy50cydcbmltcG9ydCB7IHNldFB1c2hTZW5kZXIgfSBmcm9tICcuL3B1c2gvc2VuZGVyLnRzJ1xuXG5jb25zdCBwdXNoU2VuZGVyID0gYXdhaXQgY3JlYXRlUHVzaFNlbmRlckZyb21FbnYoKVxuc2V0UHVzaFNlbmRlcihwdXNoU2VuZGVyKVxuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuYXBwLnVzZShoZWFsdGhNaWRkbGV3YXJlKVxuXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlVXNlcklkRnJvbVJlcXVlc3QoXG4gIGF1dGhvcml6YXRpb246IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8bnVtYmVyIHwgbnVsbD4ge1xuICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGF1dGhvcml6YXRpb24pXG4gIGlmICghdmVyaWZpZWQpIHJldHVybiBudWxsXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuICByZXR1cm4gbG9jYWxVc2VyLmlkXG59XG5cbi8qKiBBdXRoZW50aWNhdGVkIFJFU1QgZm9yIGFzc2V0IHVwbG9hZCAvIGRvd25sb2FkIChub3QgR3JhcGhRTCkuICovXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gIGlmIChwYXRoID09PSAnL2Fzc2V0cycgJiYgY3R4LnJlcS5tZXRob2QgPT09ICdQT1NUJykge1xuICAgIGNvbnN0IHVzZXJJZCA9IGF3YWl0IHJlc29sdmVVc2VySWRGcm9tUmVxdWVzdChcbiAgICAgIGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJyksXG4gICAgKVxuICAgIGlmICh1c2VySWQgPT0gbnVsbCkgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCBjb250ZW50VHlwZSA9XG4gICAgICAgIGN0eC5yZXEuaGVhZGVyKCdDb250ZW50LVR5cGUnKT8udG9Mb3dlckNhc2UoKSA/PyAnJ1xuICAgICAgbGV0IGJ5dGVzOiBVaW50OEFycmF5XG4gICAgICBsZXQgbWltZSA9ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nXG4gICAgICBsZXQgZmlsZW5hbWU6IHN0cmluZyB8IHVuZGVmaW5lZFxuXG4gICAgICBpZiAoY29udGVudFR5cGUuaW5jbHVkZXMoJ211bHRpcGFydC9mb3JtLWRhdGEnKSkge1xuICAgICAgICBjb25zdCBmb3JtID0gYXdhaXQgY3R4LnJlcS5mb3JtRGF0YSgpXG4gICAgICAgIGNvbnN0IGZpbGUgPSBmb3JtLmdldCgnZmlsZScpXG4gICAgICAgIGlmICghZmlsZSB8fCB0eXBlb2YgZmlsZSA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICByZXR1cm4ganNvbkVycm9yKCdmaWxlIGZpZWxkIHJlcXVpcmVkJywgNDAwKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGJsb2IgPSBmaWxlIGFzIEZpbGVcbiAgICAgICAgbWltZSA9IGJsb2IudHlwZSB8fCAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJ1xuICAgICAgICBmaWxlbmFtZSA9IGJsb2IubmFtZVxuICAgICAgICBjb25zdCBidWYgPSBhd2FpdCBibG9iLmFycmF5QnVmZmVyKClcbiAgICAgICAgYnl0ZXMgPSBuZXcgVWludDhBcnJheShidWYpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtaW1lID0gY29udGVudFR5cGUuc3BsaXQoJzsnKVswXS50cmltKCkgfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSdcbiAgICAgICAgY29uc3QgYnVmID0gYXdhaXQgY3R4LnJlcS5hcnJheUJ1ZmZlcigpXG4gICAgICAgIGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgICAgfVxuXG4gICAgICBpZiAoYnl0ZXMuYnl0ZUxlbmd0aCA+IE1BWF9BU1NFVF9CWVRFUykge1xuICAgICAgICByZXR1cm4ganNvbkVycm9yKCdmaWxlIHRvbyBsYXJnZScsIDQxMylcbiAgICAgIH1cblxuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8ucHV0KHtcbiAgICAgICAgdXNlcklkLFxuICAgICAgICBieXRlcyxcbiAgICAgICAgY29udGVudFR5cGU6IG1pbWUsXG4gICAgICAgIGZpbGVuYW1lLFxuICAgICAgfSlcblxuICAgICAgcmV0dXJuIG5ldyBSZXNwb25zZShcbiAgICAgICAgSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICAgIGlkOiBhc3NldC5pZCxcbiAgICAgICAgICBzaGEyNTY6IGFzc2V0LnNoYTI1NixcbiAgICAgICAgICBjb250ZW50VHlwZTogYXNzZXQuY29udGVudF90eXBlLFxuICAgICAgICAgIGJ5dGVTaXplOiBhc3NldC5ieXRlX3NpemUsXG4gICAgICAgICAgdXJsOiBgL2Fzc2V0cy8ke2Fzc2V0LmlkfWAsXG4gICAgICAgIH0pLFxuICAgICAgICB7XG4gICAgICAgICAgc3RhdHVzOiAyMDEsXG4gICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGlmIChlcnIgaW5zdGFuY2VvZiBBc3NldFZhbGlkYXRpb25FcnJvcikge1xuICAgICAgICByZXR1cm4ganNvbkVycm9yKGVyci5tZXNzYWdlLCBlcnIuc3RhdHVzKVxuICAgICAgfVxuICAgICAgY29uc29sZS5lcnJvcignYXNzZXQgdXBsb2FkIGZhaWxlZCcsIGVycilcbiAgICAgIHJldHVybiBqc29uRXJyb3IoJ3VwbG9hZCBmYWlsZWQnLCA1MDApXG4gICAgfVxuICB9XG5cbiAgY29uc3QgYXNzZXRNYXRjaCA9IHBhdGgubWF0Y2goL15cXC9hc3NldHNcXC8oXFxkKykkLylcbiAgaWYgKGFzc2V0TWF0Y2ggJiYgY3R4LnJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgY29uc3QgdXNlcklkID0gYXdhaXQgcmVzb2x2ZVVzZXJJZEZyb21SZXF1ZXN0KFxuICAgICAgY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSxcbiAgICApXG4gICAgaWYgKHVzZXJJZCA9PSBudWxsKSByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuXG4gICAgY29uc3QgYXNzZXRJZCA9IE51bWJlcihhc3NldE1hdGNoWzFdKVxuICAgIGNvbnN0IHJlcG8gPSBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KGRiKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHJlcG8ucmVhZEJ5dGVzKGFzc2V0SWQsIHVzZXJJZClcbiAgICBpZiAoIXJlc3VsdCkge1xuICAgICAgcmV0dXJuIGpzb25FcnJvcignbm90IGZvdW5kJywgNDA0KVxuICAgIH1cblxuICAgIHJldHVybiBuZXcgUmVzcG9uc2UocmVzdWx0LmJ5dGVzLmJ1ZmZlci5zbGljZShcbiAgICAgIHJlc3VsdC5ieXRlcy5ieXRlT2Zmc2V0LFxuICAgICAgcmVzdWx0LmJ5dGVzLmJ5dGVPZmZzZXQgKyByZXN1bHQuYnl0ZXMuYnl0ZUxlbmd0aCxcbiAgICApLCB7XG4gICAgICBzdGF0dXM6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6IHJlc3VsdC5jb250ZW50VHlwZSxcbiAgICAgICAgJ0NhY2hlLUNvbnRyb2wnOiAncHJpdmF0ZSwgbWF4LWFnZT0zNjAwJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxufSlcblxuYXBwLnVzZShjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUocmVzb2x2ZUxvY2FsVXNlcikpXG5cbmZ1bmN0aW9uIGpzb25FcnJvcihtZXNzYWdlOiBzdHJpbmcsIHN0YXR1czogbnVtYmVyKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6IG1lc3NhZ2UgfSksIHtcbiAgICBzdGF0dXMsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgfSxcbiAgfSlcbn1cblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQXJnc0lucHV0IHtcXG5cXHRmaWx0ZXI6IFJld2FyZERlZmluaXRpb25zRmlsdGVySW5wdXRcXG59XFxuaW5wdXQgUmV3YXJkRGVmaW5pdGlvbnNGaWx0ZXJJbnB1dCB7XFxuXFx0aW5jbHVkZUFyY2hpdmVkOiBCb29sZWFuXFxuXFx0c2VhcmNoOiBTdHJpbmdcXG5cXHRjYXRlZ29yeTogU3RyaW5nXFxuXFx0bGltaXQ6IE51bWJlclxcblxcdG9mZnNldDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZmlsdGVyOiBSZXdhcmRJbnZlbnRvcnlGaWx0ZXJJbnB1dFxcbn1cXG5pbnB1dCBSZXdhcmRJbnZlbnRvcnlGaWx0ZXJJbnB1dCB7XFxuXFx0c2VhcmNoOiBTdHJpbmdcXG5cXHRzdGFja2FibGVPbmx5OiBCb29sZWFuXFxuXFx0c29ydDogTkFNRV9SRUNFTlRfUVVBTlRJVFlJbnB1dFxcblxcdGxpbWl0OiBOdW1iZXJcXG5cXHRvZmZzZXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMyB7XFxuXFx0ZmlsdGVyOiBSZXdhcmRIaXN0b3J5RmlsdGVySW5wdXRcXG59XFxuaW5wdXQgUmV3YXJkSGlzdG9yeUZpbHRlcklucHV0IHtcXG5cXHRkZWZpbml0aW9uSWQ6IE51bWJlclxcblxcdHR5cGU6IFN0cmluZ1xcblxcdGxpbWl0OiBOdW1iZXJcXG5cXHRvZmZzZXQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0c291cmNlVHlwZTogU3RyaW5nIVxcblxcdHNvdXJjZUlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF81IHtcXG5cXHRsaW1pdDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF82IHtcXG5cXHRzdGF0dXM6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGRhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfOSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEwIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTEge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTIge1xcblxcdHRva2VuOiBTdHJpbmchXFxuXFx0cGxhdGZvcm06IFN0cmluZyFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEzIHtcXG5cXHR0b2tlbjogU3RyaW5nIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTQge1xcblxcdGlucHV0OiBDcmVhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0bm90ZXM6IFN0cmluZ1xcblxcdGNhdGVnb3J5OiBTdHJpbmdcXG5cXHR0YWdzOiBbU3RyaW5nIV1cXG5cXHRjb2xvcjogU3RyaW5nIVxcblxcdGljb246IFN0cmluZ1xcblxcdGltYWdlQXNzZXRJZDogTnVtYmVyXFxuXFx0c3RhY2thYmxlOiBCb29sZWFuXFxuXFx0ZGVmYXVsdFF1YW50aXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTUge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZVJld2FyZERlZmluaXRpb25JbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG5cXHRjYXRlZ29yeTogU3RyaW5nXFxuXFx0dGFnczogW1N0cmluZyFdXFxuXFx0Y29sb3I6IFN0cmluZ1xcblxcdGljb246IFN0cmluZ1xcblxcdGltYWdlQXNzZXRJZDogTnVtYmVyXFxuXFx0c3RhY2thYmxlOiBCb29sZWFuXFxuXFx0ZGVmYXVsdFF1YW50aXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTkge1xcblxcdGlucHV0OiBBdHRhY2hSZXdhcmRSdWxlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQXR0YWNoUmV3YXJkUnVsZUlucHV0SW5wdXQge1xcblxcdHNvdXJjZVR5cGU6IFN0cmluZyFcXG5cXHRzb3VyY2VJZDogTnVtYmVyIVxcblxcdHJld2FyZERlZmluaXRpb25JZDogTnVtYmVyIVxcblxcdHF1YW50aXR5OiBOdW1iZXJcXG5cXHRtb2RlOiBGSVhFRF9QUk9CQUJJTElUWV9SQU5ET01fUE9PTElucHV0XFxuXFx0Y29uZmlnSnNvbjogU3RyaW5nXFxuXFx0ZW5hYmxlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMSB7XFxuXFx0aW5wdXQ6IENvbnN1bWVSZXdhcmRJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDb25zdW1lUmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0aW52ZW50b3J5SWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMiB7XFxuXFx0aW5wdXQ6IERpc2NhcmRSZXdhcmRJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBEaXNjYXJkUmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0aW52ZW50b3J5SWQ6IE51bWJlciFcXG5cXHRxdWFudGl0eTogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yMyB7XFxuXFx0dHJhbnNhY3Rpb25JZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjQge1xcblxcdGlucHV0OiBNYW51YWxHcmFudFJld2FyZElucHV0SW5wdXQhXFxufVxcbmlucHV0IE1hbnVhbEdyYW50UmV3YXJkSW5wdXRJbnB1dCB7XFxuXFx0cmV3YXJkRGVmaW5pdGlvbklkOiBOdW1iZXIhXFxuXFx0cXVhbnRpdHk6IE51bWJlclxcblxcdG5vdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjUge1xcblxcdGlucHV0OiBDcmVhdGVHb2FsSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlR29hbElucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmchXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmchXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0cnVsZVR5cGU6IFN0cmluZyFcXG5cXHRtZXRyaWM6IENPVU5UX0RVUkFUSU9OSW5wdXQhXFxuXFx0dGFyZ2V0VmFsdWU6IE51bWJlciFcXG5cXHRjb25maWc6IEdvYWxDb25maWdJbnB1dElucHV0XFxuXFx0bGlua3M6IFtHb2FsTGlua0lucHV0SW5wdXQhXVxcblxcdGRlcGVuZGVuY2llczogW0dvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCFdXFxuXFx0cmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dElucHV0XFxuXFx0ZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0SW5wdXRcXG5cXHRzdGFydHNBdDogU3RyaW5nXFxuXFx0cHJpb3JpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxDb25maWdJbnB1dElucHV0IHtcXG5cXHRjb21wb3NpdGVNb2RlOiBBTExfQU5ZX1dFSUdIVEVESW5wdXRcXG5cXHRjb3VudFJlcXVpcmVkOiBOdW1iZXJcXG5cXHRiZWZvcmVUaW1lOiBTdHJpbmdcXG5cXHRhZnRlclRpbWU6IFN0cmluZ1xcblxcdGJsb2NrVW50aWxVbmxvY2tlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBHb2FsTGlua0lucHV0SW5wdXQge1xcblxcdGxpbmtUeXBlOiBBQ1RJVklUWV9HUk9VUElucHV0IVxcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGdyb3VwSWQ6IE51bWJlclxcblxcdHdlaWdodDogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCB7XFxuXFx0ZGVwZW5kc09uR29hbElkOiBOdW1iZXIhXFxuXFx0cmVxdWlyZW1lbnQ6IENPTVBMRVRFX1BST0dSRVNTSW5wdXRcXG5cXHR0aHJlc2hvbGQ6IE51bWJlclxcblxcdHdlaWdodDogTnVtYmVyXFxufVxcbmlucHV0IEdvYWxSZWN1cnJlbmNlSW5wdXRJbnB1dCB7XFxuXFx0cGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQhXFxuXFx0aW50ZXJ2YWw6IE51bWJlclxcblxcdGFuY2hvcjogU3RyaW5nXFxuXFx0Y2FycnlPdmVyOiBOT05FX09WRVJGTE9XSW5wdXRcXG5cXHRyZXNldDogU3RyaW5nXFxufVxcbmlucHV0IEdvYWxEZWFkbGluZUlucHV0SW5wdXQge1xcblxcdGtpbmQ6IEFCU09MVVRFX1JFTEFUSVZFSW5wdXQhXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0ZGF5c0FmdGVyQ3ljbGVTdGFydDogTnVtYmVyXFxuXFx0Z3JhY2VEYXlzOiBOdW1iZXJcXG5cXHR3YXJuRGF5czogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNiB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlR29hbElucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUdvYWxJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmdcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRydWxlVHlwZTogU3RyaW5nXFxuXFx0bWV0cmljOiBDT1VOVF9EVVJBVElPTklucHV0XFxuXFx0dGFyZ2V0VmFsdWU6IE51bWJlclxcblxcdGNvbmZpZzogR29hbENvbmZpZ0lucHV0SW5wdXRcXG5cXHRsaW5rczogW0dvYWxMaW5rSW5wdXRJbnB1dCFdXFxuXFx0ZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3lJbnB1dElucHV0IV1cXG5cXHRyZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXRcXG5cXHRkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXRJbnB1dFxcblxcdHN0YXJ0c0F0OiBTdHJpbmdcXG5cXHRjb25maXJtU3RhcnRzQXRDaGFuZ2U6IEJvb2xlYW5cXG5cXHRzdGF0dXM6IEFDVElWRV9QQVVTRURfQ09NUExFVEVEX0FSQ0hJVkVEX0ZBSUxFRElucHV0XFxuXFx0cHJpb3JpdHk6IE51bWJlclxcblxcdHNvcnRPcmRlcjogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8yNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzI4IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMjkge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzMxIHtcXG5cXHRpbnB1dDogQ3JlYXRlR3JvdXBJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVHcm91cElucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZyFcXG5cXHRjb2xvcjogU3RyaW5nIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzIge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlR3JvdXBJbnB1dElucHV0IHtcXG5cXHRuYW1lOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzM0IHtcXG5cXHRpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmchXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nIVxcblxcdGVuZFRpbWU6IFN0cmluZyFcXG5cXHRpc1JlY3VycmluZzogQm9vbGVhbiFcXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0bm90aWZpY2F0aW9uT2Zmc2V0czogW051bWJlciFdXFxufVxcbmlucHV0IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dCB7XFxuXFx0cmVjdXJyZW5jZVR5cGU6IFJlY3VycmVuY2VUeXBlSW5wdXQhXFxuXFx0Y29uZmlnOiBSZWN1cnJlbmNlQ29uZmlnSW5wdXQhXFxufVxcbmlucHV0IFJlY3VycmVuY2VDb25maWdJbnB1dCB7XFxuXFx0ZGF5c19vZl93ZWVrOiBbTnVtYmVyIV1cXG5cXHRkYXlzX29mX21vbnRoOiBbTnVtYmVyIV1cXG5cXHRpc19sYXN0X2RheV9vZl9tb250aDogQm9vbGVhblxcblxcdGludGVydmFsX2RheXM6IE51bWJlclxcblxcdHN0YXJ0X2RhdGU6IFN0cmluZyFcXG5cXHRlbmRfZGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zNSB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdHRpdGxlOiBTdHJpbmdcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmdcXG5cXHRlbmRUaW1lOiBTdHJpbmdcXG5cXHRpc1JlY3VycmluZzogQm9vbGVhblxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG5cXHRub3RpZmljYXRpb25PZmZzZXRzOiBbTnVtYmVyIV1cXG59XFxuaW5wdXQgQXJnc0lucHV0XzM2IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzcge1xcblxcdGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ29tcGxldGVBY3Rpdml0eUlucHV0SW5wdXQge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlciFcXG5cXHRvY2N1cnJlbmNlRGF0ZTogU3RyaW5nIVxcblxcdGR1cmF0aW9uTWludXRlczogTnVtYmVyXFxuXFx0bm90ZXM6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMzgge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zOSB7XFxuXFx0aW5wdXQ6IExvZ1RpbWVJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBMb2dUaW1lSW5wdXRJbnB1dCB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyIVxcblxcdGR1cmF0aW9uTWludXRlczogTnVtYmVyIVxcblxcdG9jY3VycmVuY2VEYXRlOiBTdHJpbmdcXG5cXHRub3RlczogU3RyaW5nXFxufVxcbnR5cGUgUXVlcnkge1xcbnJld2FyZERlZmluaXRpb25zKGFyZ3M6IEFyZ3NJbnB1dCEpOiBBbnkhXFxucmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMSEpOiBSZXdhcmREZWZpbml0aW9uXFxucmV3YXJkSW52ZW50b3J5KGFyZ3M6IEFyZ3NJbnB1dF8yISk6IEFueSFcXG5yZXdhcmRIaXN0b3J5KGFyZ3M6IEFyZ3NJbnB1dF8zISk6IEFueSFcXG5yZXdhcmRSdWxlcyhhcmdzOiBBcmdzSW5wdXRfNCEpOiBBbnkhXFxucmVjZW50QXNzZXRzKGFyZ3M6IEFyZ3NJbnB1dF81ISk6IFtSZWNlbnRBc3NldHMhXSFcXG5yZXdhcmROdWRnZXMoX2FyZ3M6IE9iamVjdCk6IFtSZXdhcmROdWRnZSFdIVxcbmdvYWxzKGFyZ3M6IEFyZ3NJbnB1dF82KTogQW55IVxcbmdvYWwoYXJnczogQXJnc0lucHV0XzchKTogR29hbFxcbmdvYWxOdWRnZXMoYXJnczogT2JqZWN0KTogW0dvYWxOdWRnZSFdIVxcbmRhaWx5UHJvZ3Jlc3MoYXJnczogQXJnc0lucHV0XzgpOiBEYWlseVByb2dyZXNzIVxcbmdyb3VwcyhhcmdzOiBPYmplY3QpOiBBbnkhXFxuZ3JvdXAoYXJnczogQXJnc0lucHV0XzkhKTogQW55IVxcbmFjdGl2aXRpZXMoYXJnczogT2JqZWN0KTogQW55IVxcbmFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xMCEpOiBBY3Rpdml0eVxcbmFjdGl2aXR5Q29tcGxldGlvbnMoYXJnczogQXJnc0lucHV0XzExKTogQW55IVxcbn1cXG50eXBlIFJld2FyZERlZmluaXRpb24ge1xcbnRhZ3M6IFtTdHJpbmchXSFcXG5pbWFnZV91cmw6IFN0cmluZ1xcbmltYWdlOiBJbWFnZVxcbnVzZXJfaWQ6IE51bWJlciFcXG5zb3J0X29yZGVyOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmlkOiBOdW1iZXIhXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbm5vdGVzOiBTdHJpbmdcXG5jYXRlZ29yeTogU3RyaW5nXFxuY29sb3I6IFN0cmluZyFcXG5pY29uOiBTdHJpbmdcXG5pbWFnZV9hc3NldF9pZDogTnVtYmVyXFxuc3RhY2thYmxlOiBCb29sZWFuIVxcbmRlZmF1bHRfcXVhbnRpdHk6IE51bWJlciFcXG5hcmNoaXZlZF9hdDogRGF0ZVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBJbWFnZSB7XFxudXJsOiBTdHJpbmchXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5zaGEyNTY6IFN0cmluZyFcXG5jb250ZW50X3R5cGU6IFN0cmluZyFcXG5ieXRlX3NpemU6IE51bWJlciFcXG5zdG9yYWdlX2tleTogU3RyaW5nIVxcbnJlZl9jb3VudDogTnVtYmVyIVxcbm9ycGhhbmVkX2F0OiBEYXRlXFxufVxcbnR5cGUgUmVjZW50QXNzZXRzIHtcXG51cmw6IFN0cmluZyFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnNoYTI1NjogU3RyaW5nIVxcbmNvbnRlbnRfdHlwZTogU3RyaW5nIVxcbmJ5dGVfc2l6ZTogTnVtYmVyIVxcbnN0b3JhZ2Vfa2V5OiBTdHJpbmchXFxucmVmX2NvdW50OiBOdW1iZXIhXFxub3JwaGFuZWRfYXQ6IERhdGVcXG59XFxudHlwZSBSZXdhcmROdWRnZSB7XFxua2luZDogUmV3YXJkTnVkZ2VLaW5kIVxcbnRpdGxlOiBTdHJpbmchXFxubWVzc2FnZTogU3RyaW5nIVxcbnNldmVyaXR5OiBJTkZPX1NVQ0NFU1MhXFxuZGVmaW5pdGlvbklkOiBOdW1iZXJcXG5pbnZlbnRvcnlJZDogTnVtYmVyXFxufVxcbnR5cGUgR29hbCB7XFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhcnRzQXQ6IFN0cmluZyFcXG5saWZlY3ljbGVQaGFzZTogR29hbExpZmVjeWNsZVBoYXNlIVxcbmNvbmZpZzogR29hbENvbmZpZyFcXG5yZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUNvbmZpZ1xcbmRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWdcXG5saW5rczogQW55IVxcbmFjdGl2ZUN5Y2xlOiBBbnkhXFxuY3ljbGVzOiBBbnkhXFxuZGVwZW5kZW5jaWVzOiBBbnkhXFxuc25hcHNob3RzOiBBbnkhXFxuaXNMb2NrZWQ6IEJvb2xlYW4hXFxudXNlcl9pZDogTnVtYmVyIVxcbnNvcnRfb3JkZXI6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jb2xvcjogU3RyaW5nIVxcbmljb246IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5wcmlvcml0eTogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxucnVsZV90eXBlOiBTdHJpbmchXFxubWV0cmljOiBHb2FsTWV0cmljIVxcbnN0YXR1czogR29hbFN0YXR1cyFcXG5zdGFydHNfYXQ6IERhdGUhXFxufVxcbnR5cGUgR29hbENvbmZpZyB7XFxuY29tcG9zaXRlX21vZGU6IEFMTF9BTllfV0VJR0hURURcXG5jb3VudF9yZXF1aXJlZDogTnVtYmVyXFxuYmVmb3JlX3RpbWU6IFN0cmluZ1xcbmFmdGVyX3RpbWU6IFN0cmluZ1xcbmJsb2NrX3VudGlsX3VubG9ja2VkOiBCb29sZWFuXFxufVxcbnR5cGUgR29hbFJlY3VycmVuY2VDb25maWcge1xcbnBlcmlvZDogV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZUyFcXG5pbnRlcnZhbDogTnVtYmVyXFxuYW5jaG9yOiBTdHJpbmdcXG5jYXJyeV9vdmVyOiBOT05FX09WRVJGTE9XXFxucmVzZXQ6IFN0cmluZ1xcbn1cXG50eXBlIEdvYWxEZWFkbGluZUNvbmZpZyB7XFxua2luZDogQUJTT0xVVEVfUkVMQVRJVkUhXFxuZGF0ZTogU3RyaW5nXFxuZGF5c19hZnRlcl9jeWNsZV9zdGFydDogTnVtYmVyXFxuZ3JhY2VfZGF5czogTnVtYmVyXFxud2Fybl9kYXlzOiBOdW1iZXJcXG59XFxudHlwZSBHb2FsTnVkZ2Uge1xcbmtpbmQ6IEdvYWxOdWRnZUtpbmQhXFxuZ29hbElkOiBOdW1iZXIhXFxudGl0bGU6IFN0cmluZyFcXG5tZXNzYWdlOiBTdHJpbmchXFxuc2V2ZXJpdHk6IElORk9fU1VDQ0VTU19XQVJOSU5HIVxcbn1cXG50eXBlIERhaWx5UHJvZ3Jlc3Mge1xcbmRhdGU6IFN0cmluZyFcXG5jb21wbGV0ZWRDb3VudDogQW55IVxcbm1pbnV0ZXNUb2RheTogQW55IVxcbnN0cmVha0RheXM6IE51bWJlciFcXG5jb21wbGV0aW9uczogQW55IVxcbn1cXG50eXBlIEFjdGl2aXR5IHtcXG5yZWN1cnJlbmNlUGF0dGVybjogUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm5cXG5ncm91cDogR3JvdXBcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnRpdGxlOiBTdHJpbmchXFxuZ3JvdXBfaWQ6IE51bWJlclxcbnN0YXJ0X3RpbWU6IFN0cmluZyFcXG5lbmRfdGltZTogU3RyaW5nIVxcbmlzX3JlY3VycmluZzogQm9vbGVhbiFcXG5kYXRlOiBTdHJpbmdcXG5ub3RpZmljYXRpb25fb2Zmc2V0czogW051bWJlciFdIVxcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5pZDogTnVtYmVyIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5yZWdpc3RlckRldmljZVRva2VuKGFyZ3M6IEFyZ3NJbnB1dF8xMiEpOiBCb29sZWFuIVxcbnVucmVnaXN0ZXJEZXZpY2VUb2tlbihhcmdzOiBBcmdzSW5wdXRfMTMhKTogQm9vbGVhbiFcXG5jcmVhdGVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xNCEpOiBSZXdhcmREZWZpbml0aW9uIVxcbnVwZGF0ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE1ISk6IFJld2FyZERlZmluaXRpb24hXFxuYXJjaGl2ZVJld2FyZERlZmluaXRpb24oYXJnczogQXJnc0lucHV0XzE2ISk6IFJld2FyZERlZmluaXRpb24hXFxudW5hcmNoaXZlUmV3YXJkRGVmaW5pdGlvbihhcmdzOiBBcmdzSW5wdXRfMTchKTogUmV3YXJkRGVmaW5pdGlvbiFcXG5kZWxldGVSZXdhcmREZWZpbml0aW9uKGFyZ3M6IEFyZ3NJbnB1dF8xOCEpOiBCb29sZWFuIVxcbmF0dGFjaFJld2FyZFJ1bGUoYXJnczogQXJnc0lucHV0XzE5ISk6IEF0dGFjaFJld2FyZFJ1bGUhXFxuZGV0YWNoUmV3YXJkUnVsZShhcmdzOiBBcmdzSW5wdXRfMjAhKTogQm9vbGVhbiFcXG5jb25zdW1lUmV3YXJkKGFyZ3M6IEFyZ3NJbnB1dF8yMSEpOiBDb25zdW1lUmV3YXJkIVxcbmRpc2NhcmRSZXdhcmQoYXJnczogQXJnc0lucHV0XzIyISk6IERpc2NhcmRSZXdhcmQhXFxucmVzdG9yZVJld2FyZChhcmdzOiBBcmdzSW5wdXRfMjMhKTogUmVzdG9yZVJld2FyZCFcXG5tYW51YWxHcmFudFJld2FyZChhcmdzOiBBcmdzSW5wdXRfMjQhKTogTWFudWFsR3JhbnRSZXdhcmRcXG5yZWNvbXB1dGVSZXdhcmRJbnZlbnRvcnk6IEJvb2xlYW4hXFxuY3JlYXRlR29hbChhcmdzOiBBcmdzSW5wdXRfMjUhKTogR29hbCFcXG51cGRhdGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yNiEpOiBHb2FsIVxcbnBhdXNlR29hbChhcmdzOiBBcmdzSW5wdXRfMjchKTogR29hbCFcXG5yZXN1bWVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yOCEpOiBHb2FsIVxcbmFyY2hpdmVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF8yOSEpOiBHb2FsIVxcbmRlbGV0ZUdvYWwoYXJnczogQXJnc0lucHV0XzMwISk6IEJvb2xlYW4hXFxucmVjb21wdXRlR29hbFByb2dyZXNzKGFyZ3M6IE9iamVjdCk6IFJlY29tcHV0ZUdvYWxQcm9ncmVzcyFcXG5jcmVhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMzEhKTogQW55IVxcbnVwZGF0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8zMiEpOiBBbnkhXFxuZGVsZXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzMzISk6IEJvb2xlYW4hXFxuY3JlYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzM0ISk6IEFjdGl2aXR5IVxcbnVwZGF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8zNSEpOiBBY3Rpdml0eSFcXG5kZWxldGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMzYhKTogQm9vbGVhbiFcXG5jb21wbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8zNyEpOiBBbnkhXFxudW5kb0NvbXBsZXRpb24oYXJnczogQXJnc0lucHV0XzM4ISk6IEJvb2xlYW4hXFxubG9nVGltZShhcmdzOiBBcmdzSW5wdXRfMzkhKTogQW55IVxcbn1cXG50eXBlIEF0dGFjaFJld2FyZFJ1bGUge1xcbmNvbmZpZzogUmV3YXJkUnVsZUNvbmZpZyFcXG5kZWZpbml0aW9uOiBSZXdhcmREZWZpbml0aW9uXFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnF1YW50aXR5OiBOdW1iZXIhXFxuc291cmNlX3R5cGU6IFN0cmluZyFcXG5zb3VyY2VfaWQ6IE51bWJlciFcXG5yZXdhcmRfZGVmaW5pdGlvbl9pZDogTnVtYmVyIVxcbm1vZGU6IFJld2FyZFJ1bGVNb2RlIVxcbmVuYWJsZWQ6IEJvb2xlYW4hXFxufVxcbnR5cGUgUmV3YXJkUnVsZUNvbmZpZyB7XFxub25jZTogQm9vbGVhblxcbmNvb2xkb3duX2hvdXJzOiBOdW1iZXJcXG5tYXhfZ3JhbnRzX3RvdGFsOiBOdW1iZXJcXG5tYXhfZ3JhbnRzX3Blcl9wZXJpb2Q6IE51bWJlclxcbnBlcmlvZF9ob3VyczogTnVtYmVyXFxucHJvYmFiaWxpdHk6IE51bWJlclxcblxcXCJcXFwiXFxcIlxcblBvb2wgb2YgZGVmaW5pdGlvbiBpZHMgZm9yIHJhbmRvbV9wb29sIG1vZGUuXFxuXFxcIlxcXCJcXFwiXFxucG9vbDogW1Bvb2whXVxcbn1cXG50eXBlIFBvb2wge1xcbmRlZmluaXRpb25faWQ6IE51bWJlciFcXG53ZWlnaHQ6IE51bWJlclxcbnF1YW50aXR5OiBOdW1iZXJcXG59XFxudHlwZSBDb25zdW1lUmV3YXJkIHtcXG5pbnZlbnRvcnk6IEludmVudG9yeVxcbnRyYW5zYWN0aW9uOiBNYW51YWxHcmFudFJld2FyZCFcXG59XFxudHlwZSBJbnZlbnRvcnkge1xcbmRlZmluaXRpb246IFJld2FyZERlZmluaXRpb25cXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbnF1YW50aXR5OiBOdW1iZXIhXFxucmV3YXJkX2RlZmluaXRpb25faWQ6IE51bWJlciFcXG5zdGFja19rZXk6IFN0cmluZ1xcbmZpcnN0X2Vhcm5lZF9hdDogRGF0ZSFcXG5sYXN0X2Vhcm5lZF9hdDogRGF0ZSFcXG59XFxudHlwZSBNYW51YWxHcmFudFJld2FyZCB7XFxubWV0YWRhdGE6IEFueSFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5pbWFnZV9hc3NldF9pZDogTnVtYmVyXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG5xdWFudGl0eTogTnVtYmVyIVxcbnNvdXJjZV90eXBlOiBTdHJpbmdcXG5zb3VyY2VfaWQ6IE51bWJlclxcbnJld2FyZF9kZWZpbml0aW9uX2lkOiBOdW1iZXJcXG50eXBlOiBSZXdhcmRUcmFuc2FjdGlvblR5cGUhXFxuaW52ZW50b3J5X2lkOiBOdW1iZXJcXG5kZWZpbml0aW9uX25hbWU6IFN0cmluZyFcXG5kZWZpbml0aW9uX2NvbG9yOiBTdHJpbmchXFxuZGVmaW5pdGlvbl9pY29uOiBTdHJpbmdcXG50cmlnZ2VyX2tleTogU3RyaW5nXFxucnVsZV9pZDogTnVtYmVyXFxuYWN0aXZpdHlfaWQ6IE51bWJlclxcbmdvYWxfaWQ6IE51bWJlclxcbmNvbXBsZXRpb25faWQ6IE51bWJlclxcbmN5Y2xlX2lkOiBOdW1iZXJcXG5ub3RlOiBTdHJpbmdcXG59XFxudHlwZSBEaXNjYXJkUmV3YXJkIHtcXG5pbnZlbnRvcnk6IEludmVudG9yeVxcbnRyYW5zYWN0aW9uOiBNYW51YWxHcmFudFJld2FyZCFcXG59XFxudHlwZSBSZXN0b3JlUmV3YXJkIHtcXG5pbnZlbnRvcnk6IEludmVudG9yeSFcXG50cmFuc2FjdGlvbjogTWFudWFsR3JhbnRSZXdhcmQhXFxufVxcbnR5cGUgUmVjb21wdXRlR29hbFByb2dyZXNzIHtcXG5yZWNvbXB1dGVkOiBOdW1iZXIhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gUmV3YXJkTnVkZ2VLaW5kIHtcXG5cXHRpbnZlbnRvcnlfYXZhaWxhYmxlXFxuXFx0cmVjZW50bHlfZWFybmVkXFxuXFx0dW5jb25zdW1lZF9zdGFja1xcbn1cXG5lbnVtIElORk9fU1VDQ0VTUyB7XFxuXFx0aW5mb1xcblxcdHN1Y2Nlc3NcXG59XFxuZW51bSBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxuXFx0c2NoZWR1bGVkXFxufVxcbmVudW0gR29hbE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxTdGF0dXMge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRCB7XFxuXFx0YWxsXFxuXFx0YW55XFxuXFx0d2VpZ2h0ZWRcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPVyB7XFxuXFx0bm9uZVxcblxcdG92ZXJmbG93XFxufVxcbmVudW0gQUJTT0xVVEVfUkVMQVRJVkUge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBHb2FsTnVkZ2VLaW5kIHtcXG5cXHRkZWFkbGluZV9hcHByb2FjaGluZ1xcblxcdGRlYWRsaW5lX292ZXJkdWVcXG5cXHRiZWhpbmRfcGFjZVxcblxcdGN5Y2xlX2NvbXBsZXRlXFxuXFx0ZGVwZW5kZW5jeV91bmxvY2tlZFxcblxcdGdvYWxfc3RhcnRpbmdfc29vblxcbn1cXG5lbnVtIElORk9fU1VDQ0VTU19XQVJOSU5HIHtcXG5cXHRpbmZvXFxuXFx0c3VjY2Vzc1xcblxcdHdhcm5pbmdcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9FVkVSWV9YX0RBWVMge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBSZXdhcmRSdWxlTW9kZSB7XFxuXFx0Zml4ZWRcXG5cXHRwcm9iYWJpbGl0eVxcblxcdHJhbmRvbV9wb29sXFxufVxcbmVudW0gUmV3YXJkVHJhbnNhY3Rpb25UeXBlIHtcXG5cXHRlYXJuXFxuXFx0Y29uc3VtZVxcblxcdGRlbGV0ZVxcblxcdHJlc3RvcmVcXG5cXHRhZGp1c3RcXG59XFxuZW51bSBOQU1FX1JFQ0VOVF9RVUFOVElUWUlucHV0IHtcXG5cXHRuYW1lXFxuXFx0cmVjZW50XFxuXFx0cXVhbnRpdHlcXG59XFxuZW51bSBGSVhFRF9QUk9CQUJJTElUWV9SQU5ET01fUE9PTElucHV0IHtcXG5cXHRmaXhlZFxcblxcdHByb2JhYmlsaXR5XFxuXFx0cmFuZG9tX3Bvb2xcXG59XFxuZW51bSBDT1VOVF9EVVJBVElPTklucHV0IHtcXG5cXHRjb3VudFxcblxcdGR1cmF0aW9uXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRElucHV0IHtcXG5cXHRhbGxcXG5cXHRhbnlcXG5cXHR3ZWlnaHRlZFxcbn1cXG5lbnVtIEFDVElWSVRZX0dST1VQSW5wdXQge1xcblxcdGFjdGl2aXR5XFxuXFx0Z3JvdXBcXG59XFxuZW51bSBDT01QTEVURV9QUk9HUkVTU0lucHV0IHtcXG5cXHRjb21wbGV0ZVxcblxcdHByb2dyZXNzXFxufVxcbmVudW0gV0VFS0xZX01PTlRITFlfUVVBUlRFUkxZX0VWRVJZX1hfREFZU0lucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPV0lucHV0IHtcXG5cXHRub25lXFxuXFx0b3ZlcmZsb3dcXG59XFxuZW51bSBBQlNPTFVURV9SRUxBVElWRUlucHV0IHtcXG5cXHRhYnNvbHV0ZVxcblxcdHJlbGF0aXZlXFxufVxcbmVudW0gQUNUSVZFX1BBVVNFRF9DT01QTEVURURfQVJDSElWRURfRkFJTEVESW5wdXQge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gUmVjdXJyZW5jZVR5cGVJbnB1dCB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB0eXBlIHsgUHVzaFBheWxvYWQsIFB1c2hTZW5kZXIsIFNlbmRUb1Rva2Vuc1Jlc3VsdCB9IGZyb20gJy4vdHlwZXMudHMnXG5cbi8qKiBOby1vcCBzZW5kZXIgdXNlZCB3aGVuIEZpcmViYXNlIGNyZWRlbnRpYWxzIGFyZSBub3QgY29uZmlndXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBOb09wUHVzaFNlbmRlciBpbXBsZW1lbnRzIFB1c2hTZW5kZXIge1xuICBhc3luYyBzZW5kVG9Ub2tlbnMoXG4gICAgX3Rva2Vuczogc3RyaW5nW10sXG4gICAgX3BheWxvYWQ6IFB1c2hQYXlsb2FkLFxuICApOiBQcm9taXNlPFNlbmRUb1Rva2Vuc1Jlc3VsdD4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3NDb3VudDogMCwgaW52YWxpZFRva2VuczogW10gfVxuICB9XG59XG4iLCAiLyoqIFJlYWQgYW4gZW52IHZhciBmcm9tIE5vZGUgYHByb2Nlc3MuZW52YCBvciBEZW5vLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudihuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5bbmFtZV0pIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbbmFtZV1cbiAgfVxuICB0cnkge1xuICAgIHJldHVybiBEZW5vLmVudi5nZXQobmFtZSlcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG59XG4iLCAiaW1wb3J0IHsgZW52IH0gZnJvbSAnLi4vZGIvZW52LnRzJ1xuaW1wb3J0IHsgTm9PcFB1c2hTZW5kZXIgfSBmcm9tICcuL25vb3Bfc2VuZGVyLnRzJ1xuaW1wb3J0IHR5cGUgeyBQdXNoUGF5bG9hZCwgUHVzaFNlbmRlciwgU2VuZFRvVG9rZW5zUmVzdWx0IH0gZnJvbSAnLi90eXBlcy50cydcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFRleHRGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmICh0eXBlb2YgRGVubyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIERlbm8ucmVhZFRleHRGaWxlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGF3YWl0IERlbm8ucmVhZFRleHRGaWxlKHBhdGgpXG4gIH1cbiAgY29uc3QgeyByZWFkRmlsZSB9ID0gYXdhaXQgaW1wb3J0KCdub2RlOmZzL3Byb21pc2VzJylcbiAgcmV0dXJuIGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGY4Jylcbn1cblxudHlwZSBTZXJ2aWNlQWNjb3VudCA9IHtcbiAgcHJvamVjdF9pZDogc3RyaW5nXG4gIGNsaWVudF9lbWFpbDogc3RyaW5nXG4gIHByaXZhdGVfa2V5OiBzdHJpbmdcbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG50eXBlIE1lc3NhZ2luZyA9IHtcbiAgc2VuZEVhY2hGb3JNdWx0aWNhc3Q6IChtZXNzYWdlOiB7XG4gICAgdG9rZW5zOiBzdHJpbmdbXVxuICAgIG5vdGlmaWNhdGlvbjogeyB0aXRsZTogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVxuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIH0pID0+IFByb21pc2U8e1xuICAgIHN1Y2Nlc3NDb3VudDogbnVtYmVyXG4gICAgcmVzcG9uc2VzOiBBcnJheTx7IHN1Y2Nlc3M6IGJvb2xlYW47IGVycm9yPzogeyBjb2RlPzogc3RyaW5nIH0gfT5cbiAgfT5cbn1cblxudHlwZSBGaXJlYmFzZUFkbWluTW9kdWxlID0ge1xuICBhcHBzOiB1bmtub3duW11cbiAgaW5pdGlhbGl6ZUFwcDogKG9wdGlvbnM6IHtcbiAgICBjcmVkZW50aWFsOiB1bmtub3duXG4gIH0pID0+IHVua25vd25cbiAgY3JlZGVudGlhbDoge1xuICAgIGNlcnQ6IChzZXJ2aWNlQWNjb3VudDogU2VydmljZUFjY291bnQpID0+IHVua25vd25cbiAgfVxuICBtZXNzYWdpbmc6ICgpID0+IE1lc3NhZ2luZ1xufVxuXG5jb25zdCBJTlZBTElEX1RPS0VOX0NPREVTID0gbmV3IFNldChbXG4gICdtZXNzYWdpbmcvaW52YWxpZC1yZWdpc3RyYXRpb24tdG9rZW4nLFxuICAnbWVzc2FnaW5nL3JlZ2lzdHJhdGlvbi10b2tlbi1ub3QtcmVnaXN0ZXJlZCcsXG5dKVxuXG4vKipcbiAqIEZpcmViYXNlIENsb3VkIE1lc3NhZ2luZyBzZW5kZXIgdmlhIGZpcmViYXNlLWFkbWluLlxuICpcbiAqIFByZWZlciBjb25zdHJ1Y3RpbmcgdGhyb3VnaCB7QGxpbmsgY3JlYXRlUHVzaFNlbmRlckZyb21FbnZ9IHNvIG1pc3NpbmdcbiAqIGNyZWRlbnRpYWxzIGRlZ3JhZGUgdG8gYSBuby1vcCBpbnN0ZWFkIG9mIGNyYXNoaW5nIHRoZSBBUEkuXG4gKi9cbmV4cG9ydCBjbGFzcyBGaXJlYmFzZVB1c2hTZW5kZXIgaW1wbGVtZW50cyBQdXNoU2VuZGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBtZXNzYWdpbmc6IE1lc3NhZ2luZykge31cblxuICBhc3luYyBzZW5kVG9Ub2tlbnMoXG4gICAgdG9rZW5zOiBzdHJpbmdbXSxcbiAgICBwYXlsb2FkOiBQdXNoUGF5bG9hZCxcbiAgKTogUHJvbWlzZTxTZW5kVG9Ub2tlbnNSZXN1bHQ+IHtcbiAgICBpZiAodG9rZW5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgc3VjY2Vzc0NvdW50OiAwLCBpbnZhbGlkVG9rZW5zOiBbXSB9XG4gICAgfVxuXG4gICAgY29uc3QgaW52YWxpZFRva2Vuczogc3RyaW5nW10gPSBbXVxuICAgIGxldCBzdWNjZXNzQ291bnQgPSAwXG5cbiAgICAvLyBGQ00gbXVsdGljYXN0IHN1cHBvcnRzIHVwIHRvIDUwMCB0b2tlbnMgcGVyIHJlcXVlc3QuXG4gICAgY29uc3QgY2h1bmtTaXplID0gNTAwXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpICs9IGNodW5rU2l6ZSkge1xuICAgICAgY29uc3QgY2h1bmsgPSB0b2tlbnMuc2xpY2UoaSwgaSArIGNodW5rU2l6ZSlcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubWVzc2FnaW5nLnNlbmRFYWNoRm9yTXVsdGljYXN0KHtcbiAgICAgICAgdG9rZW5zOiBjaHVuayxcbiAgICAgICAgbm90aWZpY2F0aW9uOiB7XG4gICAgICAgICAgdGl0bGU6IHBheWxvYWQudGl0bGUsXG4gICAgICAgICAgYm9keTogcGF5bG9hZC5ib2R5LFxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiBwYXlsb2FkLmRhdGEsXG4gICAgICB9KVxuICAgICAgc3VjY2Vzc0NvdW50ICs9IHJlc3VsdC5zdWNjZXNzQ291bnRcbiAgICAgIHJlc3VsdC5yZXNwb25zZXMuZm9yRWFjaCgocmVzcG9uc2UsIGluZGV4KSA9PiB7XG4gICAgICAgIGlmIChyZXNwb25zZS5zdWNjZXNzKSByZXR1cm5cbiAgICAgICAgY29uc3QgY29kZSA9IHJlc3BvbnNlLmVycm9yPy5jb2RlXG4gICAgICAgIGlmIChjb2RlICYmIElOVkFMSURfVE9LRU5fQ09ERVMuaGFzKGNvZGUpKSB7XG4gICAgICAgICAgaW52YWxpZFRva2Vucy5wdXNoKGNodW5rW2luZGV4XSEpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHsgc3VjY2Vzc0NvdW50LCBpbnZhbGlkVG9rZW5zIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVNlcnZpY2VBY2NvdW50SnNvbihyYXc6IHN0cmluZyk6IFNlcnZpY2VBY2NvdW50IHtcbiAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIFNlcnZpY2VBY2NvdW50XG4gIGlmIChcbiAgICB0eXBlb2YgcGFyc2VkLnByb2plY3RfaWQgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIHBhcnNlZC5jbGllbnRfZW1haWwgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIHBhcnNlZC5wcml2YXRlX2tleSAhPT0gJ3N0cmluZydcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0ZpcmViYXNlIHNlcnZpY2UgYWNjb3VudCBKU09OIG11c3QgaW5jbHVkZSBwcm9qZWN0X2lkLCBjbGllbnRfZW1haWwsIHByaXZhdGVfa2V5JyxcbiAgICApXG4gIH1cbiAgLy8gUHJpdmF0ZSBrZXlzIGluIGVudiB2YXJzIG9mdGVuIGhhdmUgZXNjYXBlZCBuZXdsaW5lcy5cbiAgcGFyc2VkLnByaXZhdGVfa2V5ID0gcGFyc2VkLnByaXZhdGVfa2V5LnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKVxuICByZXR1cm4gcGFyc2VkXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTZXJ2aWNlQWNjb3VudCgpOiBQcm9taXNlPFNlcnZpY2VBY2NvdW50IHwgbnVsbD4ge1xuICBjb25zdCBqc29uID0gZW52KCdGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTicpXG4gIGlmIChqc29uICYmIGpzb24udHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gcGFyc2VTZXJ2aWNlQWNjb3VudEpzb24oanNvbilcbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBlbnYoJ0ZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9QQVRIJylcbiAgaWYgKHBhdGggJiYgcGF0aC50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkVGV4dEZpbGUocGF0aClcbiAgICByZXR1cm4gcGFyc2VTZXJ2aWNlQWNjb3VudEpzb24odGV4dClcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRGaXJlYmFzZUFkbWluKCk6IFByb21pc2U8RmlyZWJhc2VBZG1pbk1vZHVsZT4ge1xuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyB0aGUga2l0IGltcG9ydGFibGUgaW4gdW5pdCB0ZXN0cyB3aXRob3V0IHJlc29sdmluZ1xuICAvLyBmaXJlYmFzZS1hZG1pbiB1bmxlc3MgYSByZWFsIHNlbmRlciBpcyBjb25zdHJ1Y3RlZC5cbiAgLy8gQnVuL05vZGUgQ0pTIGludGVyb3Agb2Z0ZW4gZXhwb3NlcyB0aGUgU0RLIG9uIGBkZWZhdWx0YC5cbiAgY29uc3QgbW9kID0gYXdhaXQgaW1wb3J0KCdmaXJlYmFzZS1hZG1pbicpIGFzIHtcbiAgICBkZWZhdWx0PzogRmlyZWJhc2VBZG1pbk1vZHVsZVxuICB9ICYgRmlyZWJhc2VBZG1pbk1vZHVsZVxuICByZXR1cm4gbW9kLmRlZmF1bHQgPz8gbW9kXG59XG5cbi8qKlxuICogQnVpbGRzIGEge0BsaW5rIFB1c2hTZW5kZXJ9IGZyb20gZW52LlxuICpcbiAqIC0gYEZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9KU09OYCBcdTIwMTQgcmF3IHNlcnZpY2UtYWNjb3VudCBKU09OIHN0cmluZ1xuICogLSBgRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX1BBVEhgIFx1MjAxNCBwYXRoIHRvIGEgc2VydmljZS1hY2NvdW50IEpTT04gZmlsZVxuICpcbiAqIFdoZW4gbmVpdGhlciBpcyBzZXQgKG9yIGluaXQgZmFpbHMpLCByZXR1cm5zIHtAbGluayBOb09wUHVzaFNlbmRlcn0uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVQdXNoU2VuZGVyRnJvbUVudigpOiBQcm9taXNlPFB1c2hTZW5kZXI+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgbG9hZFNlcnZpY2VBY2NvdW50KClcbiAgICBpZiAoIWFjY291bnQpIHtcbiAgICAgIGNvbnNvbGUuaW5mbyhcbiAgICAgICAgJ1twdXNoXSBGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTi9QQVRIIHVuc2V0OyB1c2luZyBuby1vcCBzZW5kZXInLFxuICAgICAgKVxuICAgICAgcmV0dXJuIG5ldyBOb09wUHVzaFNlbmRlcigpXG4gICAgfVxuXG4gICAgY29uc3QgYWRtaW4gPSBhd2FpdCBsb2FkRmlyZWJhc2VBZG1pbigpXG4gICAgaWYgKGFkbWluLmFwcHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhZG1pbi5pbml0aWFsaXplQXBwKHtcbiAgICAgICAgY3JlZGVudGlhbDogYWRtaW4uY3JlZGVudGlhbC5jZXJ0KGFjY291bnQpLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IEZpcmViYXNlUHVzaFNlbmRlcihhZG1pbi5tZXNzYWdpbmcoKSlcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcignW3B1c2hdIGZhaWxlZCB0byBpbml0IEZpcmViYXNlIHNlbmRlcjsgdXNpbmcgbm8tb3AnLCBlcnIpXG4gICAgcmV0dXJuIG5ldyBOb09wUHVzaFNlbmRlcigpXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBPbkNvbmZsaWN0QnVpbGRlciwgVHJhbnNhY3Rpb24gfSBmcm9tIFwia3lzZWx5XCI7XG5pbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSBcIkBnZXRjcm9uaXQvcHlsb25cIjtcbmltcG9ydCB7IGRiIH0gZnJvbSBcIi4uLy4uL2RiL2RhdGFiYXNlLnRzXCI7XG5pbXBvcnQgdHlwZSB7XG4gIEFjdGl2aXR5IGFzIEFjdGl2aXR5Um93LFxuICBEYXRhYmFzZSxcbiAgR3JvdXAgYXMgR3JvdXBSb3csXG4gIE5ld0FjdGl2aXR5LFxuICBOZXdBY3Rpdml0eUNvbXBsZXRpb24sXG4gIE5ld0RldmljZVRva2VuLFxuICBOZXdHb2FsRXZlbnQsXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7XG4gIHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0sXG4gIHZhbGlkYXRlRGV2aWNlVG9rZW4sXG59IGZyb20gXCIuLi8uLi9wdXNoL2RldmljZV90b2tlbl92YWxpZGF0aW9uLnRzXCI7XG5pbXBvcnQgeyByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyB9IGZyb20gXCIuLi8uLi9nb2Fscy9wcm9ncmVzcy50c1wiO1xuaW1wb3J0IHtcbiAgQ29tcGxldGVBY3Rpdml0eUlucHV0LFxuICBDcmVhdGVBY3Rpdml0eUlucHV0LFxuICBDcmVhdGVHcm91cElucHV0LFxuICBMb2dUaW1lSW5wdXQsXG4gIFJlY3VycmVuY2VDb25maWcsXG4gIFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQsXG4gIFVwZGF0ZUFjdGl2aXR5SW5wdXQsXG4gIFVwZGF0ZUdyb3VwSW5wdXQsXG59IGZyb20gXCIuLi90eXBlcy50c1wiO1xuaW1wb3J0IHtcbiAgSW52YWxpZENvbXBsZXRpb25FcnJvcixcbiAgSW52YWxpZEdyb3VwRXJyb3IsXG4gIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSxcbiAgdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMsXG4gIHZhbGlkYXRlR3JvdXBDb2xvcixcbiAgdmFsaWRhdGVHcm91cE5hbWUsXG4gIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUsXG4gIHZhbGlkYXRlUG9zaXRpdmVEdXJhdGlvbixcbn0gZnJvbSBcIi4uL3ZhbGlkYXRpb24udHNcIjtcbmltcG9ydCB7IG5vcm1hbGl6ZU5vdGlmaWNhdGlvbk9mZnNldHMgfSBmcm9tIFwiLi4vbm90aWZpY2F0aW9uX29mZnNldHMudHNcIjtcbmltcG9ydCB7IGFzTnVtYmVyIH0gZnJvbSBcIi4uL251bWVyaWMudHNcIjtcbmltcG9ydCB7IEdvYWxNdXRhdGlvbiwgR29hbFF1ZXJ5IH0gZnJvbSBcIi4vZ29hbHNfcmVzb2x2ZXJzLnRzXCI7XG5pbXBvcnQgeyBSZXdhcmRNdXRhdGlvbiwgUmV3YXJkUXVlcnkgfSBmcm9tIFwiLi9yZXdhcmRzX3Jlc29sdmVycy50c1wiO1xuaW1wb3J0IHtcbiAgZ3JhbnRSZXdhcmRzRm9yQWN0aXZpdHlDb21wbGV0aW9uLFxufSBmcm9tIFwiLi4vLi4vcmV3YXJkcy9ob29rcy50c1wiO1xuaW1wb3J0IHtcbiAgRGJJbnZlbnRvcnlNYW5hZ2VyLFxufSBmcm9tIFwiLi4vLi4vcmV3YXJkcy9pbnZlbnRvcnkudHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRBY3Rpdml0eShhY3Rpdml0eUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eUlkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vLyBQeWxvbiByZXNvbHZlcyBuZXN0ZWQgR3JhcGhRTCBmaWVsZHMgZnJvbSAocG9zc2libHkgYXN5bmMpIHByb3BlcnRpZXMgb25cbi8vIHRoZSByZXR1cm5lZCBvYmplY3QsIG5vdCBmcm9tIGEgc2VwYXJhdGUgcmVzb2x2ZXIgbWFwIFx1MjAxNCBzbyBuZXN0ZWQgZGF0YSBpc1xuLy8gYXR0YWNoZWQgaW5saW5lIGhlcmUgcmF0aGVyIHRoYW4gdmlhIGEgc3RhbmRhbG9uZSByZXNvbHZlciBleHBvcnQuXG5mdW5jdGlvbiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHk6IEFjdGl2aXR5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uYWN0aXZpdHksXG4gICAgcmVjdXJyZW5jZVBhdHRlcm46IGFzeW5jICgpOiBQcm9taXNlPFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKCFhY3Rpdml0eS5pc19yZWN1cnJpbmcpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgcGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkuaWQpO1xuICAgICAgaWYgKCFwYXR0ZXJuKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHBhdHRlcm4uY29uZmlnKTtcbiAgICAgIGlmICghY29uZmlnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IC4uLnBhdHRlcm4sIGNvbmZpZyB9O1xuICAgIH0sXG4gICAgZ3JvdXA6IGFzeW5jICgpOiBQcm9taXNlPEdyb3VwUm93IHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKGFjdGl2aXR5Lmdyb3VwX2lkID09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eS5ncm91cF9pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGdyb3VwczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwibmFtZVwiLCBcImFzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICB9LFxuXG4gIGdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgfSxcblxuICBhY3Rpdml0aWVzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEFjdGl2aXR5UmVsYXRpb25zKTtcbiAgfSxcblxuICBhY3Rpdml0eTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIHJldHVybiByb3cgPyB3aXRoQWN0aXZpdHlSZWxhdGlvbnMocm93KSA6IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdHlDb21wbGV0aW9uczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgYWN0aXZpdHlJZD86IG51bWJlcjtcbiAgICBmcm9tRGF0ZT86IHN0cmluZztcbiAgICB0b0RhdGU/OiBzdHJpbmc7XG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiZGVzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpO1xuXG4gICAgaWYgKGFyZ3M/LmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhcmdzLmFjdGl2aXR5SWQpO1xuICAgIH1cbiAgICBpZiAoYXJncz8uZnJvbURhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI+PVwiLCBhcmdzLmZyb21EYXRlKTtcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIjw9XCIsIGFyZ3MudG9EYXRlKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgfSxcblxuICAuLi5Hb2FsUXVlcnksXG4gIC4uLlJld2FyZFF1ZXJ5LFxufTtcblxuZXhwb3J0IGNvbnN0IE11dGF0aW9uID0ge1xuICBjcmVhdGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUdyb3VwSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKTtcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcik7XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50byhcImdyb3Vwc1wiKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY29sb3IsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdHcm91cClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgdXBkYXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVHcm91cElucHV0IH0pID0+IHtcbiAgICBjb25zdCB7IGlkLCBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IG5hbWUgPSBpbnB1dC5uYW1lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVHcm91cE5hbWUoaW5wdXQubmFtZSlcbiAgICAgIDogZXhpc3RpbmcubmFtZTtcbiAgICBjb25zdCBjb2xvciA9IGlucHV0LmNvbG9yICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKVxuICAgICAgOiBleGlzdGluZy5jb2xvcjtcblxuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKFwiZ3JvdXBzXCIpXG4gICAgICAuc2V0KHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY29sb3IsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9LFxuXG4gIGRlbGV0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKTtcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMDtcbiAgfSxcblxuICBjcmVhdGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUFjdGl2aXR5SW5wdXQgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoe1xuICAgICAgaXNSZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICAgIHJlY3VycmVuY2VQYXR0ZXJuOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybixcbiAgICB9KTtcblxuICAgIGNvbnN0IG5vdGlmaWNhdGlvbk9mZnNldHMgPSBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKFxuICAgICAgaW5wdXQubm90aWZpY2F0aW9uT2Zmc2V0cyxcbiAgICApO1xuICAgIGNvbnN0IGdyb3VwSWQgPSBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkID8/IG51bGwsIHVzZXJJZCk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpbnB1dC5pc1JlY3VycmluZyA/IG51bGwgOiAoaW5wdXQuZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICBncm91cF9pZDogZ3JvdXBJZCA/PyBudWxsLFxuICAgICAgICAgIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBub3RpZmljYXRpb25PZmZzZXRzLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpbnB1dC5pc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHkpO1xuICB9LFxuXG4gIHVwZGF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkLCBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBjb25zdCBpc1JlY3VycmluZyA9IGlucHV0LmlzUmVjdXJyaW5nID8/IGV4aXN0aW5nLmlzX3JlY3VycmluZztcbiAgICBjb25zdCBkYXRlID0gaW5wdXQuZGF0ZSAhPT0gdW5kZWZpbmVkID8gaW5wdXQuZGF0ZSA6IGV4aXN0aW5nLmRhdGU7XG5cbiAgICAvLyBJZiB0aGUgc2NoZWR1bGUgaXMgc3RpbGwgcmVjdXJyaW5nIGFuZCBubyBuZXcgcGF0dGVybiB3YXMgc3VwcGxpZWQsXG4gICAgLy8gdmFsaWRhdGUgYWdhaW5zdCB0aGUgcGF0dGVybiBhbHJlYWR5IG9uIGZpbGUuXG4gICAgbGV0IHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCA9IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuO1xuICAgIGlmIChpc1JlY3VycmluZyAmJiAhcmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICAgIGNvbnN0IGV4aXN0aW5nUGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oaWQpO1xuICAgICAgaWYgKGV4aXN0aW5nUGF0dGVybikge1xuICAgICAgICBjb25zdCBjb25maWcgPSBwYXJzZUNvbmZpZyhleGlzdGluZ1BhdHRlcm4uY29uZmlnKTtcbiAgICAgICAgcmVjdXJyZW5jZVBhdHRlcm4gPSBjb25maWdcbiAgICAgICAgICA/IHsgcmVjdXJyZW5jZVR5cGU6IGV4aXN0aW5nUGF0dGVybi5yZWN1cnJlbmNlX3R5cGUsIGNvbmZpZyB9XG4gICAgICAgICAgOiB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKHsgaXNSZWN1cnJpbmcsIGRhdGUsIHJlY3VycmVuY2VQYXR0ZXJuIH0pO1xuXG4gICAgY29uc3QgcmVzb2x2ZWRHcm91cElkID0gaW5wdXQuZ3JvdXBJZCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IGF3YWl0IHJlc29sdmVHcm91cElkKGlucHV0Lmdyb3VwSWQsIHVzZXJJZClcbiAgICAgIDogdW5kZWZpbmVkO1xuXG4gICAgY29uc3Qgbm90aWZpY2F0aW9uT2Zmc2V0cyA9IGlucHV0Lm5vdGlmaWNhdGlvbk9mZnNldHMgIT09IHVuZGVmaW5lZFxuICAgICAgPyBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKGlucHV0Lm5vdGlmaWNhdGlvbk9mZnNldHMpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlzUmVjdXJyaW5nID8gbnVsbCA6IChkYXRlID8/IG51bGwpLFxuICAgICAgICAgIC4uLihyZXNvbHZlZEdyb3VwSWQgIT09IHVuZGVmaW5lZCA/IHsgZ3JvdXBfaWQ6IHJlc29sdmVkR3JvdXBJZCB9IDoge30pLFxuICAgICAgICAgIC4uLihub3RpZmljYXRpb25PZmZzZXRzICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBub3RpZmljYXRpb25fb2Zmc2V0czogbm90aWZpY2F0aW9uT2Zmc2V0cyB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5vbkNvbmZsaWN0KChvYzogT25Db25mbGljdEJ1aWxkZXI8YW55LCBhbnk+KSA9PlxuICAgICAgICAgICAgb2MuY29sdW1ucyhbXCJhY3Rpdml0eV9pZFwiXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEuY29uZmlnKSxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH0gZWxzZSBpZiAoIWlzUmVjdXJyaW5nKSB7XG4gICAgICAgIC8vIENsZWFuIHVwIGFueSBzdGFsZSBwYXR0ZXJuIG9uY2UgYW4gYWN0aXZpdHkgc3RvcHMgcmVjdXJyaW5nLlxuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuZGVsZXRlRnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgZGVsZXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXIgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNvbXBsZXRlQWN0aXZpdHk6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShpbnB1dC5vY2N1cnJlbmNlRGF0ZSk7XG4gICAgY29uc3QgZHVyYXRpb25NaW51dGVzID0gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMoaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgIC53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIj1cIiwgb2NjdXJyZW5jZURhdGUpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgZHVyYXRpb25fbWludXRlczogZHVyYXRpb25NaW51dGVzLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcywgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pXG4gICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5Q29tcGxldGlvbilcbiAgICAgICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgICAgIG9jLmNvbHVtbnMoW1wiYWN0aXZpdHlfaWRcIiwgXCJvY2N1cnJlbmNlX2RhdGVcIl0pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgIGR1cmF0aW9uX21pbnV0ZXM6IGR1cmF0aW9uTWludXRlcyxcbiAgICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMsIHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KVxuICAgICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICAvLyBDb3VudCBldmVudFxuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHNvdXJjZV90eXBlOiBcImNvbXBsZXRpb25cIixcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgIGNvbXBsZXRpb25faWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgIG1ldHJpYzogXCJjb3VudFwiLFxuICAgICAgICAgIGFtb3VudDogMSxcbiAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgICAvLyBPcHRpb25hbCBkdXJhdGlvbiBldmVudCB3aGVuIG1pbnV0ZXMgcHJvdmlkZWQgb3IgZGVyaXZlZCBmcm9tIHNjaGVkdWxlLlxuICAgICAgbGV0IG1pbnV0ZXMgPSBkdXJhdGlvbk1pbnV0ZXM7XG4gICAgICBpZiAobWludXRlcyA9PSBudWxsKSB7XG4gICAgICAgIC8vIERlcml2ZSBmcm9tIHNjaGVkdWxlZCBzbG90IHdoZW4gcG9zc2libGUuXG4gICAgICAgIGNvbnN0IFtzaCwgc21dID0gYWN0aXZpdHkuc3RhcnRfdGltZS5zcGxpdChcIjpcIikubWFwKE51bWJlcik7XG4gICAgICAgIGNvbnN0IFtlaCwgZW1dID0gYWN0aXZpdHkuZW5kX3RpbWUuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgICAgICBjb25zdCBkZXJpdmVkID0gKGVoICogNjAgKyBlbSkgLSAoc2ggKiA2MCArIHNtKTtcbiAgICAgICAgaWYgKGRlcml2ZWQgPiAwKSBtaW51dGVzID0gZGVyaXZlZDtcbiAgICAgIH1cbiAgICAgIGlmIChtaW51dGVzICE9IG51bGwgJiYgbWludXRlcyA+IDApIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgc291cmNlX3R5cGU6IFwiY29tcGxldGlvblwiLFxuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgICAgY29tcGxldGlvbl9pZDogY29tcGxldGlvbi5pZCxcbiAgICAgICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICBhbW91bnQ6IG1pbnV0ZXMsXG4gICAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgICB9KTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgfSk7XG5cbiAgICBjb25zdCBncmFudGVkID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCBncmFudFJld2FyZHNGb3JBY3Rpdml0eUNvbXBsZXRpb24odHJ4LCB7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICAgIGNvbXBsZXRpb25JZDogY29tcGxldGlvbi5pZCxcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmNvbXBsZXRpb24sXG4gICAgICBncmFudGVkUmV3YXJkczogZ3JhbnRlZFxuICAgICAgICAuZmlsdGVyKChnKSA9PiAhZy5za2lwcGVkICYmIGcudHJhbnNhY3Rpb24pXG4gICAgICAgIC5tYXAoKGcpID0+IGcudHJhbnNhY3Rpb24pLFxuICAgIH07XG4gIH0sXG5cbiAgdW5kb0NvbXBsZXRpb246IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXR5X2NvbXBsZXRpb25zXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgYXJncy5pZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm4gZmFsc2U7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShleGlzdGluZy5hY3Rpdml0eV9pZCwgdXNlcklkKTtcblxuICAgIGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBtYW5hZ2VyID0gbmV3IERiSW52ZW50b3J5TWFuYWdlcigpO1xuICAgICAgYXdhaXQgbWFuYWdlci5yZXZva2VVbmNvbnN1bWVkRm9yQ29tcGxldGlvbih0cngsIHVzZXJJZCwgZXhpc3RpbmcuaWQpO1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5kZWxldGVGcm9tKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLndoZXJlKFwiY29tcGxldGlvbl9pZFwiLCBcIj1cIiwgZXhpc3RpbmcuaWQpXG4gICAgICAgIC5leGVjdXRlKCk7XG4gICAgICBhd2FpdCB0cnhcbiAgICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgZXhpc3RpbmcuaWQpXG4gICAgICAgIC5leGVjdXRlKCk7XG4gICAgfSk7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhkYiwgdXNlcklkLCB7XG4gICAgICBhY3Rpdml0eUlkOiBleGlzdGluZy5hY3Rpdml0eV9pZCxcbiAgICAgIGdyb3VwSWQ6IGFjdGl2aXR5Py5ncm91cF9pZCA/PyBudWxsLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cbiAgbG9nVGltZTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IExvZ1RpbWVJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgbWludXRlcyA9IHZhbGlkYXRlUG9zaXRpdmVEdXJhdGlvbihpbnB1dC5kdXJhdGlvbk1pbnV0ZXMpO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShcbiAgICAgIGlucHV0Lm9jY3VycmVuY2VEYXRlID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCksXG4gICAgKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGV2ZW50ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIHNvdXJjZV90eXBlOiBcInRpbWVfbG9nXCIsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICBjb21wbGV0aW9uX2lkOiBudWxsLFxuICAgICAgICBvY2N1cnJlZF9hdDogbm93LFxuICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICBtZXRyaWM6IFwiZHVyYXRpb25cIixcbiAgICAgICAgYW1vdW50OiBtaW51dGVzLFxuICAgICAgICBtZXRhZGF0YTogaW5wdXQubm90ZXNcbiAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHsgbm90ZXM6IGlucHV0Lm5vdGVzIH0pXG4gICAgICAgICAgOiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhkYiwgdXNlcklkLCB7XG4gICAgICBhY3Rpdml0eUlkOiBhY3Rpdml0eS5pZCxcbiAgICAgIGdyb3VwSWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgIH0pO1xuXG4gICAgcmV0dXJuIHtcbiAgICAgIC4uLmV2ZW50LFxuICAgICAgYW1vdW50OiBhc051bWJlcihldmVudC5hbW91bnQpLFxuICAgIH07XG4gIH0sXG5cbiAgLi4uR29hbE11dGF0aW9uLFxuICAuLi5SZXdhcmRNdXRhdGlvbixcblxuICByZWdpc3RlckRldmljZVRva2VuOiBhc3luYyAoYXJnczogeyB0b2tlbjogc3RyaW5nOyBwbGF0Zm9ybTogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgdG9rZW4gPSB2YWxpZGF0ZURldmljZVRva2VuKGFyZ3MudG9rZW4pO1xuICAgIGNvbnN0IHBsYXRmb3JtID0gdmFsaWRhdGVEZXZpY2VQbGF0Zm9ybShhcmdzLnBsYXRmb3JtKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oXCJkZXZpY2VfdG9rZW5zXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0b2tlbixcbiAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3RGV2aWNlVG9rZW4pXG4gICAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICAgIG9jLmNvbHVtbihcInRva2VuXCIpLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmV4ZWN1dGUoKTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIHVucmVnaXN0ZXJEZXZpY2VUb2tlbjogYXN5bmMgKGFyZ3M6IHsgdG9rZW46IHN0cmluZyB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHRva2VuID0gdmFsaWRhdGVEZXZpY2VUb2tlbihhcmdzLnRva2VuKTtcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJkZXZpY2VfdG9rZW5zXCIpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAud2hlcmUoXCJ0b2tlblwiLCBcIj1cIiwgdG9rZW4pXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwICYmIE51bWJlcihyZXN1bHRbMF0/Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMDtcbiAgfSxcbn07XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7XG4gIFF1ZXJ5LFxuICBNdXRhdGlvbixcbn07XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vLyBNYWluIERhdGFiYXNlIGludGVyZmFjZSB0aGF0IGRlc2NyaWJlcyBhbGwgdGFibGVzXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgZ3JvdXBzOiBHcm91cHNUYWJsZVxuICBhY3Rpdml0aWVzOiBBY3Rpdml0aWVzVGFibGVcbiAgcmVjdXJyZW5jZV9wYXR0ZXJuczogUmVjdXJyZW5jZVBhdHRlcm5zVGFibGVcbiAgYWN0aXZpdHlfY29tcGxldGlvbnM6IEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZVxuICBnb2FsX2V2ZW50czogR29hbEV2ZW50c1RhYmxlXG4gIGdvYWxzOiBHb2Fsc1RhYmxlXG4gIGdvYWxfbGlua3M6IEdvYWxMaW5rc1RhYmxlXG4gIGdvYWxfY3ljbGVzOiBHb2FsQ3ljbGVzVGFibGVcbiAgZ29hbF9kZXBlbmRlbmNpZXM6IEdvYWxEZXBlbmRlbmNpZXNUYWJsZVxuICBnb2FsX3Byb2dyZXNzX3NuYXBzaG90czogR29hbFByb2dyZXNzU25hcHNob3RzVGFibGVcbiAgYXNzZXRzOiBBc3NldHNUYWJsZVxuICByZXdhcmRfZGVmaW5pdGlvbnM6IFJld2FyZERlZmluaXRpb25zVGFibGVcbiAgcmV3YXJkX3J1bGVzOiBSZXdhcmRSdWxlc1RhYmxlXG4gIHJld2FyZF9pbnZlbnRvcnk6IFJld2FyZEludmVudG9yeVRhYmxlXG4gIHJld2FyZF90cmFuc2FjdGlvbnM6IFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlXG4gIGRldmljZV90b2tlbnM6IERldmljZVRva2Vuc1RhYmxlXG59XG5cbi8vIFVzZXJzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3VwZXJUb2tlbnMgdXNlciBpZCBcdTIwMTQgbGlua3MgU1NPIGlkZW50aXR5IHRvIGxvY2FsIHJvd3MuICovXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBHcm91cHMgdGFibGUgaW50ZXJmYWNlIFx1MjAxNCB1c2VyLXNjb3BlZCBhY3Rpdml0eSB0YXhvbm9teSB3aXRoIGRpc3BsYXkgY29sb3IuXG5leHBvcnQgaW50ZXJmYWNlIEdyb3Vwc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLy8gSGV4IGNvbG9yIGZyb20gdGhlIHNoYXJlZCBwcmVzZXQgcGFsZXR0ZSwgZS5nLiBcIiMwRjc2NkVcIlxuICBjb2xvcjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdGllcyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdGllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICAvLyBPcHRpb25hbCBncm91cCBhc3NpZ25tZW50LiBOdWxsIHdoZW4gdW5ncm91cGVkOyBjbGVhcmVkIGlmIHRoZSBncm91cFxuICAvLyBpcyBkZWxldGVkIChPTiBERUxFVEUgU0VUIE5VTEwpLlxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIHN0YXJ0X3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgZW5kX3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgaXNfcmVjdXJyaW5nOiBib29sZWFuXG4gIC8vIENhbGVuZGFyIGRhdGUgdGhlIGFjdGl2aXR5IG9jY3VycyBvbi4gUmVxdWlyZWQgd2hlbiBpc19yZWN1cnJpbmcgaXNcbiAgLy8gZmFsc2U7IG51bGwgd2hlbiBpc19yZWN1cnJpbmcgaXMgdHJ1ZSAoZGF0ZXMgbGl2ZSBpbiB0aGUgcmVjdXJyZW5jZVxuICAvLyBwYXR0ZXJuJ3MgY29uZmlnIGluc3RlYWQpLlxuICBkYXRlOiBzdHJpbmcgfCBudWxsXG4gIC8vIE1pbnV0ZXMgYmVmb3JlIHN0YXJ0X3RpbWUgdG8gZmlyZSBhIGxvY2FsIHJlbWluZGVyOyAwID0gYXQgc3RhcnQuXG4gIC8vIEVtcHR5IGFycmF5ID0gbm8gcmVtaW5kZXJzLiBNYXggOCB1bmlxdWUgdmFsdWVzIGluIFswLCAxMDA4MF0uXG4gIG5vdGlmaWNhdGlvbl9vZmZzZXRzOiBudW1iZXJbXVxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIFJlY3VycmVuY2UgcGF0dGVybnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgLy8gVHlwZSBvZiByZWN1cnJlbmNlOiB3ZWVrbHksIG1vbnRobHksIG9yIGV2ZXJ5IFggZGF5c1xuICByZWN1cnJlbmNlX3R5cGU6ICd3ZWVrbHknIHwgJ21vbnRobHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgLy8gSlNPTiBjb25maWd1cmF0aW9uIGZvciB0aGUgcmVjdXJyZW5jZVxuICBjb25maWc6IENvbHVtblR5cGU8e1xuICAgIC8vIEZvciB3ZWVrbHk6IGFycmF5IG9mIGRheXMgKDAtNiwgd2hlcmUgMCBpcyBTdW5kYXkpXG4gICAgZGF5c19vZl93ZWVrPzogbnVtYmVyW11cbiAgICAvLyBGb3IgbW9udGhseTogZGF5cyBvZiB0aGUgbW9udGggKDEtMzEpXG4gICAgZGF5c19vZl9tb250aD86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGFsc28gcmVwZWF0IG9uIHRoZSBsYXN0IGRheSBvZiB0aGUgbW9udGguIEtlcHQgYXMgaXRzXG4gICAgLy8gb3duIGJvb2xlYW4gKHJhdGhlciB0aGFuIGEgJ2xhc3QnIHNlbnRpbmVsIGluIGRheXNfb2ZfbW9udGgpIGJlY2F1c2VcbiAgICAvLyBQeWxvbi9HcmFwaFFMIGlucHV0IHR5cGVzIGNhbid0IHJlcHJlc2VudCBhIG51bWJlcnxzdHJpbmcgdW5pb24uXG4gICAgaXNfbGFzdF9kYXlfb2ZfbW9udGg/OiBib29sZWFuXG4gICAgLy8gRm9yIGV2ZXJ5X3hfZGF5czogcmVwZWF0IGV2ZXJ5IE4gZGF5cyAoPj0gMSlcbiAgICBpbnRlcnZhbF9kYXlzPzogbnVtYmVyXG4gICAgLy8gU3RhcnQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZVxuICAgIHN0YXJ0X2RhdGU6IHN0cmluZ1xuICAgIC8vIEVuZCBkYXRlIG9mIHRoZSByZWN1cnJlbmNlIChvcHRpb25hbClcbiAgICBlbmRfZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgfSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdHkgY29tcGxldGlvbnMgXHUyMDE0IG9uZSByb3cgcGVyIChhY3Rpdml0eSwgb2NjdXJyZW5jZV9kYXRlKVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgYWN0aXZpdHlfaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgb2NjdXJyZW5jZV9kYXRlOiBzdHJpbmdcbiAgZHVyYXRpb25fbWludXRlczogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBuZXZlcj5cbiAgLy8gU3RvcmUgYW55IGFkZGl0aW9uYWwgZGF0YSBhYm91dCB0aGUgY29tcGxldGlvblxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTx7XG4gICAgdGl0bGU/OiBzdHJpbmdcbiAgICBub3Rlcz86IHN0cmluZ1xuICAgIHRyaWdnZXJfZXZlbnRzPzogc3RyaW5nW11cbiAgfSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxFdmVudFNvdXJjZVR5cGUgPSAnY29tcGxldGlvbicgfCAndGltZV9sb2cnIHwgJ21hbnVhbCdcbmV4cG9ydCB0eXBlIEdvYWxFdmVudE1ldHJpYyA9ICdjb3VudCcgfCAnZHVyYXRpb24nXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEV2ZW50c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBzb3VyY2VfdHlwZTogR29hbEV2ZW50U291cmNlVHlwZVxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICBjb21wbGV0aW9uX2lkOiBudW1iZXIgfCBudWxsXG4gIG9jY3VycmVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nIHwgbnVsbFxuICBtZXRyaWM6IEdvYWxFdmVudE1ldHJpY1xuICBhbW91bnQ6IG51bWJlclxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTxSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IHR5cGUgR29hbFN0YXR1cyA9ICdhY3RpdmUnIHwgJ3BhdXNlZCcgfCAnY29tcGxldGVkJyB8ICdhcmNoaXZlZCcgfCAnZmFpbGVkJ1xuZXhwb3J0IHR5cGUgR29hbE1ldHJpYyA9ICdjb3VudCcgfCAnZHVyYXRpb24nXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbFJlY3VycmVuY2VDb25maWcge1xuICBwZXJpb2Q6ICd3ZWVrbHknIHwgJ21vbnRobHknIHwgJ3F1YXJ0ZXJseScgfCAnZXZlcnlfeF9kYXlzJ1xuICBpbnRlcnZhbD86IG51bWJlclxuICBhbmNob3I/OiBzdHJpbmdcbiAgY2Fycnlfb3Zlcj86ICdub25lJyB8ICdvdmVyZmxvdydcbiAgcmVzZXQ/OiAnaGFyZCdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRGVhZGxpbmVDb25maWcge1xuICBraW5kOiAnYWJzb2x1dGUnIHwgJ3JlbGF0aXZlJ1xuICBkYXRlPzogc3RyaW5nXG4gIGRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQ/OiBudW1iZXJcbiAgZ3JhY2VfZGF5cz86IG51bWJlclxuICB3YXJuX2RheXM/OiBudW1iZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsQ29uZmlnIHtcbiAgY29tcG9zaXRlX21vZGU/OiAnYWxsJyB8ICdhbnknIHwgJ3dlaWdodGVkJ1xuICBjb3VudF9yZXF1aXJlZD86IG51bWJlclxuICBiZWZvcmVfdGltZT86IHN0cmluZ1xuICBhZnRlcl90aW1lPzogc3RyaW5nXG4gIGJsb2NrX3VudGlsX3VubG9ja2VkPzogYm9vbGVhblxuICBba2V5OiBzdHJpbmddOiB1bmtub3duXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBjb2xvcjogc3RyaW5nXG4gIGljb246IHN0cmluZyB8IG51bGxcbiAgcnVsZV90eXBlOiBzdHJpbmdcbiAgbWV0cmljOiBHb2FsTWV0cmljXG4gIHRhcmdldF92YWx1ZTogbnVtYmVyXG4gIGNvbmZpZzogQ29sdW1uVHlwZTxHb2FsQ29uZmlnLCBzdHJpbmcgfCBHb2FsQ29uZmlnLCBzdHJpbmcgfCBHb2FsQ29uZmlnPlxuICBzdGF0dXM6IEdvYWxTdGF0dXNcbiAgcmVjdXJyZW5jZTogQ29sdW1uVHlwZTxcbiAgICBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbFxuICA+XG4gIGRlYWRsaW5lOiBDb2x1bW5UeXBlPFxuICAgIEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsXG4gID5cbiAgcHJpb3JpdHk6IG51bWJlclxuICBzb3J0X29yZGVyOiBudW1iZXJcbiAgLyoqIEVmZmVjdGl2ZSBzdGFydCBvZiB0aGUgZ29hbCAoc2VlZHMgY3ljbGUgMCkuIEFsd2F5cyBzZXQuICovXG4gIHN0YXJ0c19hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsTGlua1R5cGUgPSAnYWN0aXZpdHknIHwgJ2dyb3VwJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxMaW5rc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBsaW5rX3R5cGU6IEdvYWxMaW5rVHlwZVxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB3ZWlnaHQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxDeWNsZVN0YXR1cyA9ICdhY3RpdmUnIHwgJ3N1Y2NlZWRlZCcgfCAnZmFpbGVkJyB8ICdtaXNzZWQnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEN5Y2xlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBjeWNsZV9pbmRleDogbnVtYmVyXG4gIHN0YXJ0c19hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgZW5kc19hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgZGVhZGxpbmVfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIHRhcmdldF92YWx1ZTogbnVtYmVyXG4gIGN1cnJlbnRfdmFsdWU6IG51bWJlclxuICBzdGF0dXM6IEdvYWxDeWNsZVN0YXR1c1xuICBjYXJyeV9vdmVyOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50ID0gJ2NvbXBsZXRlJyB8ICdwcm9ncmVzcydcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRGVwZW5kZW5jaWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGRlcGVuZHNfb25fZ29hbF9pZDogbnVtYmVyXG4gIHJlcXVpcmVtZW50OiBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50XG4gIHRocmVzaG9sZDogbnVtYmVyIHwgbnVsbFxuICB3ZWlnaHQ6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbFByb2dyZXNzU25hcHNob3RzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9jeWNsZV9pZDogbnVtYmVyXG4gIGFzX29mOiBzdHJpbmdcbiAgdmFsdWU6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbi8vIEV4cG9ydCBjb252ZW5pZW5jZSB0eXBlcyBmb3IgZWFjaCB0YWJsZVxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1VzZXIgPSBJbnNlcnRhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBVc2VyVXBkYXRlID0gVXBkYXRlYWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHcm91cCA9IFNlbGVjdGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHcm91cCA9IEluc2VydGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBHcm91cFVwZGF0ZSA9IFVwZGF0ZWFibGU8R3JvdXBzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5ID0gU2VsZWN0YWJsZTxBY3Rpdml0aWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eSA9IEluc2VydGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlVcGRhdGUgPSBVcGRhdGVhYmxlPEFjdGl2aXRpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm4gPSBTZWxlY3RhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmVjdXJyZW5jZVBhdHRlcm4gPSBJbnNlcnRhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm5VcGRhdGUgPSBVcGRhdGVhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eUNvbXBsZXRpb24gPSBTZWxlY3RhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0FjdGl2aXR5Q29tcGxldGlvbiA9IEluc2VydGFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxFdmVudCA9IFNlbGVjdGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbEV2ZW50ID0gSW5zZXJ0YWJsZTxHb2FsRXZlbnRzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsRXZlbnRVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxFdmVudHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbCA9IFNlbGVjdGFibGU8R29hbHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWwgPSBJbnNlcnRhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsVXBkYXRlID0gVXBkYXRlYWJsZTxHb2Fsc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsTGluayA9IFNlbGVjdGFibGU8R29hbExpbmtzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsTGluayA9IEluc2VydGFibGU8R29hbExpbmtzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsTGlua1VwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbExpbmtzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxDeWNsZSA9IFNlbGVjdGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbEN5Y2xlID0gSW5zZXJ0YWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsQ3ljbGVVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxDeWNsZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3kgPSBTZWxlY3RhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxEZXBlbmRlbmN5ID0gSW5zZXJ0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsRGVwZW5kZW5jeVVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsUHJvZ3Jlc3NTbmFwc2hvdCA9IFNlbGVjdGFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsUHJvZ3Jlc3NTbmFwc2hvdCA9IEluc2VydGFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5leHBvcnQgdHlwZSBHb2FsUHJvZ3Jlc3NTbmFwc2hvdFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbFByb2dyZXNzU25hcHNob3RzVGFibGU+XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy8gQXNzZXRzICYgUmV3YXJkc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgQXNzZXRzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNoYTI1Njogc3RyaW5nXG4gIGNvbnRlbnRfdHlwZTogc3RyaW5nXG4gIGJ5dGVfc2l6ZTogbnVtYmVyXG4gIHN0b3JhZ2Vfa2V5OiBzdHJpbmdcbiAgcmVmX2NvdW50OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICBvcnBoYW5lZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmREZWZpbml0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgbm90ZXM6IHN0cmluZyB8IG51bGxcbiAgY2F0ZWdvcnk6IHN0cmluZyB8IG51bGxcbiAgdGFnczogQ29sdW1uVHlwZTxzdHJpbmdbXSwgc3RyaW5nIHwgc3RyaW5nW10sIHN0cmluZyB8IHN0cmluZ1tdPlxuICBjb2xvcjogc3RyaW5nXG4gIGljb246IHN0cmluZyB8IG51bGxcbiAgaW1hZ2VfYXNzZXRfaWQ6IG51bWJlciB8IG51bGxcbiAgc3RhY2thYmxlOiBib29sZWFuXG4gIGRlZmF1bHRfcXVhbnRpdHk6IG51bWJlclxuICBzb3J0X29yZGVyOiBudW1iZXJcbiAgYXJjaGl2ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgUmV3YXJkUnVsZU1vZGUgPSAnZml4ZWQnIHwgJ3Byb2JhYmlsaXR5JyB8ICdyYW5kb21fcG9vbCdcblxuZXhwb3J0IGludGVyZmFjZSBSZXdhcmRSdWxlQ29uZmlnIHtcbiAgb25jZT86IGJvb2xlYW5cbiAgY29vbGRvd25faG91cnM/OiBudW1iZXJcbiAgbWF4X2dyYW50c190b3RhbD86IG51bWJlclxuICBtYXhfZ3JhbnRzX3Blcl9wZXJpb2Q/OiBudW1iZXJcbiAgcGVyaW9kX2hvdXJzPzogbnVtYmVyXG4gIHByb2JhYmlsaXR5PzogbnVtYmVyXG4gIC8qKiBQb29sIG9mIGRlZmluaXRpb24gaWRzIGZvciByYW5kb21fcG9vbCBtb2RlLiAqL1xuICBwb29sPzogQXJyYXk8eyBkZWZpbml0aW9uX2lkOiBudW1iZXI7IHdlaWdodD86IG51bWJlcjsgcXVhbnRpdHk/OiBudW1iZXIgfT5cbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZFJ1bGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNvdXJjZV90eXBlOiBzdHJpbmdcbiAgc291cmNlX2lkOiBudW1iZXJcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlclxuICBxdWFudGl0eTogbnVtYmVyXG4gIG1vZGU6IFJld2FyZFJ1bGVNb2RlXG4gIGNvbmZpZzogQ29sdW1uVHlwZTxcbiAgICBSZXdhcmRSdWxlQ29uZmlnLFxuICAgIHN0cmluZyB8IFJld2FyZFJ1bGVDb25maWcsXG4gICAgc3RyaW5nIHwgUmV3YXJkUnVsZUNvbmZpZ1xuICA+XG4gIGVuYWJsZWQ6IGJvb2xlYW5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZEludmVudG9yeVRhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICByZXdhcmRfZGVmaW5pdGlvbl9pZDogbnVtYmVyXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgc3RhY2tfa2V5OiBzdHJpbmcgfCBudWxsXG4gIGZpcnN0X2Vhcm5lZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbiAgbGFzdF9lYXJuZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uVHlwZSA9XG4gIHwgJ2Vhcm4nXG4gIHwgJ2NvbnN1bWUnXG4gIHwgJ2RlbGV0ZSdcbiAgfCAncmVzdG9yZSdcbiAgfCAnYWRqdXN0J1xuXG5leHBvcnQgaW50ZXJmYWNlIFJld2FyZFRyYW5zYWN0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICB0eXBlOiBSZXdhcmRUcmFuc2FjdGlvblR5cGVcbiAgcmV3YXJkX2RlZmluaXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgaW52ZW50b3J5X2lkOiBudW1iZXIgfCBudWxsXG4gIHF1YW50aXR5OiBudW1iZXJcbiAgZGVmaW5pdGlvbl9uYW1lOiBzdHJpbmdcbiAgZGVmaW5pdGlvbl9jb2xvcjogc3RyaW5nXG4gIGRlZmluaXRpb25faWNvbjogc3RyaW5nIHwgbnVsbFxuICBpbWFnZV9hc3NldF9pZDogbnVtYmVyIHwgbnVsbFxuICBzb3VyY2VfdHlwZTogc3RyaW5nIHwgbnVsbFxuICBzb3VyY2VfaWQ6IG51bWJlciB8IG51bGxcbiAgdHJpZ2dlcl9rZXk6IHN0cmluZyB8IG51bGxcbiAgcnVsZV9pZDogbnVtYmVyIHwgbnVsbFxuICBhY3Rpdml0eV9pZDogbnVtYmVyIHwgbnVsbFxuICBnb2FsX2lkOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgY3ljbGVfaWQ6IG51bWJlciB8IG51bGxcbiAgbm90ZTogc3RyaW5nIHwgbnVsbFxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTxcbiAgICBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwsXG4gICAgc3RyaW5nIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBudWxsXG4gID5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBBc3NldCA9IFNlbGVjdGFibGU8QXNzZXRzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBc3NldCA9IEluc2VydGFibGU8QXNzZXRzVGFibGU+XG5leHBvcnQgdHlwZSBBc3NldFVwZGF0ZSA9IFVwZGF0ZWFibGU8QXNzZXRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZERlZmluaXRpb24gPSBTZWxlY3RhYmxlPFJld2FyZERlZmluaXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdSZXdhcmREZWZpbml0aW9uID0gSW5zZXJ0YWJsZTxSZXdhcmREZWZpbml0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmV3YXJkRGVmaW5pdGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkRGVmaW5pdGlvbnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmV3YXJkUnVsZSA9IFNlbGVjdGFibGU8UmV3YXJkUnVsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZFJ1bGUgPSBJbnNlcnRhYmxlPFJld2FyZFJ1bGVzVGFibGU+XG5leHBvcnQgdHlwZSBSZXdhcmRSdWxlVXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmRSdWxlc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBSZXdhcmRJbnZlbnRvcnkgPSBTZWxlY3RhYmxlPFJld2FyZEludmVudG9yeVRhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmV3YXJkSW52ZW50b3J5ID0gSW5zZXJ0YWJsZTxSZXdhcmRJbnZlbnRvcnlUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZEludmVudG9yeVVwZGF0ZSA9IFVwZGF0ZWFibGU8UmV3YXJkSW52ZW50b3J5VGFibGU+XG5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uID0gU2VsZWN0YWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1Jld2FyZFRyYW5zYWN0aW9uID0gSW5zZXJ0YWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJld2FyZFRyYW5zYWN0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxSZXdhcmRUcmFuc2FjdGlvbnNUYWJsZT5cblxuZXhwb3J0IGludGVyZmFjZSBEZXZpY2VUb2tlbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdG9rZW46IHN0cmluZ1xuICAvKiogJ2lvcycgfCAnYW5kcm9pZCcgfCAnd2ViJyAqL1xuICBwbGF0Zm9ybTogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIERldmljZVRva2VuID0gU2VsZWN0YWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0RldmljZVRva2VuID0gSW5zZXJ0YWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cbmV4cG9ydCB0eXBlIERldmljZVRva2VuVXBkYXRlID0gVXBkYXRlYWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cbiIsICJpbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBlbnYgfSBmcm9tICcuL2Vudi50cydcbmltcG9ydCB7XG4gIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zLFxuICBzc2xGb3JEYXRhYmFzZVVybCxcbn0gZnJvbSAnLi9zc2wudHMnXG5cbi8vIEtlZXAgUG9zdGdyZXMgYGRhdGVgIGFzIGBZWVlZLU1NLUREYCBzdHJpbmdzLiBUaGUgZGVmYXVsdCBwZyBwYXJzZXIgdHVybnNcbi8vIHRoZW0gaW50byBKUyBEYXRlIG9iamVjdHMsIHdoaWNoIEdyYXBoUUwgdGhlbiBzdHJpbmdpZmllcyBhcyBmdWxsIHRpbWVzdGFtcHNcbi8vIGFuZCBicmVha3MgRmx1dHRlcidzIGRhdGUtb25seSBwYXJzaW5nLlxudHlwZXMuc2V0VHlwZVBhcnNlcih0eXBlcy5idWlsdGlucy5EQVRFLCAodmFsdWU6IHN0cmluZykgPT4gdmFsdWUpXG5cbmV4cG9ydCB0eXBlIENyZWF0ZUt5c2VseU9wdGlvbnMgPSB7XG4gIC8qKiBGYWxsYmFjayB3aGVuIGBQR0RBVEFCQVNFYCAvIGBEQVRBQkFTRV9VUkxgIGFyZSB1bnNldC4gKi9cbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmdcbn1cblxuZnVuY3Rpb24gcG9vbENvbmZpZ0Zyb21FbnYoXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nLFxuKTogQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBQb29sPlswXSB7XG4gIGNvbnN0IGRhdGFiYXNlVXJsID0gZW52KCdEQVRBQkFTRV9VUkwnKVxuICBpZiAoZGF0YWJhc2VVcmwpIHtcbiAgICBjb25zdCBzc2wgPSBzc2xGb3JEYXRhYmFzZVVybChkYXRhYmFzZVVybClcbiAgICByZXR1cm4ge1xuICAgICAgY29ubmVjdGlvblN0cmluZzogY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmwpLFxuICAgICAgbWF4OiAxMCxcbiAgICAgIC4uLihzc2wgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBzc2wgfSksXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZTogZW52KCdQR0RBVEFCQVNFJykgPz8gZGVmYXVsdERhdGFiYXNlLFxuICAgIGhvc3Q6IGVudignUEdIT1NUJykgPz8gJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogZW52KCdQR1VTRVInKSA/PyAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiBlbnYoJ1BHUEFTU1dPUkQnKSA/PyAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IE51bWJlcihlbnYoJ1BHUE9SVCcpID8/ICc1NDMyJyksXG4gICAgbWF4OiAxMCxcbiAgfVxufVxuXG4vKiogQ3JlYXRlIGEgS3lzZWx5IGluc3RhbmNlIGZvciB0aGUgZ2l2ZW4gc2NoZW1hIHR5cGUgYW5kIGRlZmF1bHQgREIgbmFtZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVLeXNlbHk8REI+KG9wdGlvbnM6IENyZWF0ZUt5c2VseU9wdGlvbnMpOiBLeXNlbHk8REI+IHtcbiAgY29uc3QgZGlhbGVjdCA9IG5ldyBQb3N0Z3Jlc0RpYWxlY3Qoe1xuICAgIHBvb2w6IG5ldyBQb29sKHBvb2xDb25maWdGcm9tRW52KG9wdGlvbnMuZGVmYXVsdERhdGFiYXNlKSksXG4gIH0pXG4gIHJldHVybiBuZXcgS3lzZWx5PERCPih7IGRpYWxlY3QgfSlcbn1cbiIsICIvKiogVExTIG9wdGlvbnMgZm9yIGBwZ2AgZnJvbSBhIFBvc3RncmVzIFVSTC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzc2xGb3JEYXRhYmFzZVVybChcbiAgZGF0YWJhc2VVcmw6IHN0cmluZyxcbik6IGZhbHNlIHwgeyByZWplY3RVbmF1dGhvcml6ZWQ6IGJvb2xlYW4gfSB8IHVuZGVmaW5lZCB7XG4gIGxldCB1cmw6IFVSTFxuICB0cnkge1xuICAgIHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxuXG4gIGNvbnN0IG1vZGUgPSB1cmwuc2VhcmNoUGFyYW1zLmdldCgnc3NsbW9kZScpPy50b0xvd2VyQ2FzZSgpXG4gIGlmIChtb2RlID09PSAnZGlzYWJsZScpIHJldHVybiBmYWxzZVxuICBpZiAobW9kZSA9PT0gJ3JlcXVpcmUnIHx8IG1vZGUgPT09ICd2ZXJpZnktY2EnIHx8IG1vZGUgPT09ICd2ZXJpZnktZnVsbCcpIHtcbiAgICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbiAgfVxuXG4gIGNvbnN0IGhvc3QgPSB1cmwuaG9zdG5hbWVcbiAgaWYgKGhvc3QgPT09ICdsb2NhbGhvc3QnIHx8IGhvc3QgPT09ICcxMjcuMC4wLjEnKSByZXR1cm4gdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG59XG5cbi8qKlxuICogU3RyaXAgU1NMIHF1ZXJ5IHBhcmFtcyBmcm9tIGEgUG9zdGdyZXMgVVJMIGJlZm9yZSBwYXNzaW5nIGl0IHRvIGBwZ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICAgIGZvciAoY29uc3Qga2V5IG9mIFtcbiAgICAgICdzc2xtb2RlJyxcbiAgICAgICdzc2wnLFxuICAgICAgJ3NzbHJvb3RjZXJ0JyxcbiAgICAgICdzc2xjZXJ0JyxcbiAgICAgICdzc2xrZXknLFxuICAgIF0pIHtcbiAgICAgIHVybC5zZWFyY2hQYXJhbXMuZGVsZXRlKGtleSlcbiAgICB9XG4gICAgcmV0dXJuIHVybC50b1N0cmluZygpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBkYXRhYmFzZVVybFxuICB9XG59XG4iLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGNyZWF0ZUt5c2VseSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzJ1xuXG5leHBvcnQgeyBlbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgY29uc3QgZGIgPSBjcmVhdGVLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGVmYXVsdERhdGFiYXNlOiAndGltZW1hbmFnZXInLFxufSlcbiIsICJjb25zdCBERVZJQ0VfUExBVEZPUk1TID0gbmV3IFNldChbJ2lvcycsICdhbmRyb2lkJywgJ3dlYiddKVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEZXZpY2VQbGF0Zm9ybShwbGF0Zm9ybTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IHBsYXRmb3JtLnRyaW0oKS50b0xvd2VyQ2FzZSgpXG4gIGlmICghREVWSUNFX1BMQVRGT1JNUy5oYXMobm9ybWFsaXplZCkpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3BsYXRmb3JtIG11c3QgYmUgaW9zLCBhbmRyb2lkLCBvciB3ZWInKVxuICB9XG4gIHJldHVybiBub3JtYWxpemVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZURldmljZVRva2VuKHRva2VuOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gdG9rZW4udHJpbSgpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA8IDggfHwgdHJpbW1lZC5sZW5ndGggPiA0MDk2KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIGRldmljZSB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEdvYWwsIEdvYWxDeWNsZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgR29hbExpZmVjeWNsZVBoYXNlID1cbiAgfCAnc2NoZWR1bGVkJ1xuICB8ICdhY3RpdmUnXG4gIHwgJ3BhdXNlZCdcbiAgfCAnY29tcGxldGVkJ1xuICB8ICdhcmNoaXZlZCdcbiAgfCAnZmFpbGVkJ1xuXG4vKiogRGVyaXZlZCBVSS9BUEkgcGhhc2UgXHUyMDE0IHNjaGVkdWxlZCBpcyBub3QgYSBzdG9yZWQgc3RhdHVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxpZmVjeWNsZVBoYXNlKFxuICBnb2FsOiBQaWNrPEdvYWwsICdzdGF0dXMnIHwgJ3N0YXJ0c19hdCc+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbExpZmVjeWNsZVBoYXNlIHtcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgcmV0dXJuICdwYXVzZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpIHJldHVybiAnY29tcGxldGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhcmNoaXZlZCcpIHJldHVybiAnYXJjaGl2ZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHJldHVybiAnZmFpbGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnICYmIG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KSA+IG5vdykge1xuICAgIHJldHVybiAnc2NoZWR1bGVkJ1xuICB9XG4gIHJldHVybiAnYWN0aXZlJ1xufVxuXG4vKiogVHJ1ZSB3aGVuIHRoZSBjeWNsZSBldmFsdWF0aW9uIHdpbmRvdyBoYXMgYmVndW4uICovXG5leHBvcnQgZnVuY3Rpb24gY3ljbGVIYXNTdGFydGVkKFxuICBjeWNsZTogUGljazxHb2FsQ3ljbGUsICdzdGFydHNfYXQnPixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gbm93ID49IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbEV2ZW50LFxuICBHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlUmVzdWx0IHtcbiAgY3VycmVudFZhbHVlOiBudW1iZXJcbiAgZG9uZTogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlQ29udGV4dCB7XG4gIGdvYWw6IEdvYWxcbiAgY3ljbGU6IEdvYWxDeWNsZVxuICBsaW5rczogR29hbExpbmtbXVxuICBldmVudHM6IEdvYWxFdmVudFtdXG4gIC8qKiBBY3RpdmUgKG9yIGxhdGVzdCkgY2hpbGQgY3ljbGVzIGtleWVkIGJ5IGNoaWxkIGdvYWwgaWQsIGZvciBjb21wb3NpdGVzLiAqL1xuICBjaGlsZEN5Y2xlcz86IE1hcDxudW1iZXIsIEdvYWxDeWNsZT5cbiAgLyoqIENoaWxkIGRlcGVuZGVuY3kgd2VpZ2h0cyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLiAqL1xuICBjaGlsZFdlaWdodHM/OiBNYXA8bnVtYmVyLCBudW1iZXI+XG4gIC8qKiBGb3IgZ3JvdXBfYWxsX2NvbXBsZXRlOiBhY3Rpdml0eSBpZHMgdGhhdCBiZWxvbmcgdG8gbGlua2VkIGdyb3Vwcy4gKi9cbiAgZ3JvdXBBY3Rpdml0eUlkcz86IG51bWJlcltdXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEV2YWx1YXRvciB7XG4gIHJ1bGVUeXBlOiBzdHJpbmdcbiAgZXZhbHVhdGUoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdFxufVxuXG4vKiogRGVkdXBsaWNhdGUgZXZlbnRzIGJ5IChhY3Rpdml0eV9pZCwgb2NjdXJyZW5jZV9kYXRlKSwgcHJlZmVycmluZyBmaXJzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWR1cGVFdmVudHMoZXZlbnRzOiBHb2FsRXZlbnRbXSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIGNvbnN0IG91dDogR29hbEV2ZW50W10gPSBbXVxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgIGNvbnN0IGtleSA9IGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgZXZlbnQub2NjdXJyZW5jZV9kYXRlXG4gICAgICA/IGAke2V2ZW50LmFjdGl2aXR5X2lkfToke2V2ZW50Lm9jY3VycmVuY2VfZGF0ZX06JHtldmVudC5tZXRyaWN9YFxuICAgICAgOiBgaWQ6JHtldmVudC5pZH1gXG4gICAgaWYgKHNlZW4uaGFzKGtleSkpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQoa2V5KVxuICAgIG91dC5wdXNoKGV2ZW50KVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gZXZlbnRzSW5XaW5kb3coZXZlbnRzOiBHb2FsRXZlbnRbXSwgY3ljbGU6IEdvYWxDeWNsZSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICBjb25zdCBlbmQgPSBjeWNsZS5lbmRzX2F0ID8gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gIHJldHVybiBldmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGUub2NjdXJyZWRfYXQpLmdldFRpbWUoKVxuICAgIHJldHVybiB0ID49IHN0YXJ0ICYmIHQgPCBlbmRcbiAgfSlcbn1cblxuZnVuY3Rpb24gbGlua2VkQWN0aXZpdHlJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJiBsLmFjdGl2aXR5X2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmFjdGl2aXR5X2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gbGlua2VkR3JvdXBJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwX2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gd2VpZ2h0Rm9yRXZlbnQoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBudW1iZXIge1xuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlua3MpIHtcbiAgICBpZiAoXG4gICAgICBsaW5rLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJlxuICAgICAgbGluay5hY3Rpdml0eV9pZCAhPSBudWxsICYmXG4gICAgICBldmVudC5hY3Rpdml0eV9pZCA9PT0gbGluay5hY3Rpdml0eV9pZFxuICAgICkge1xuICAgICAgcmV0dXJuIE51bWJlcihsaW5rLndlaWdodClcbiAgICB9XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdncm91cCcgJiZcbiAgICAgIGxpbmsuZ3JvdXBfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuZ3JvdXBfaWQgPT09IGxpbmsuZ3JvdXBfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICB9XG4gIHJldHVybiAxXG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNMaW5rcyhldmVudDogR29hbEV2ZW50LCBsaW5rczogR29hbExpbmtbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBhY3Rpdml0aWVzID0gbGlua2VkQWN0aXZpdHlJZHMobGlua3MpXG4gIGNvbnN0IGdyb3VwcyA9IGxpbmtlZEdyb3VwSWRzKGxpbmtzKVxuICBpZiAoYWN0aXZpdGllcy5zaXplID09PSAwICYmIGdyb3Vwcy5zaXplID09PSAwKSByZXR1cm4gZmFsc2VcbiAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgYWN0aXZpdGllcy5oYXMoZXZlbnQuYWN0aXZpdHlfaWQpKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXZlbnQuZ3JvdXBfaWQgIT0gbnVsbCAmJiBncm91cHMuaGFzKGV2ZW50Lmdyb3VwX2lkKSkgcmV0dXJuIHRydWVcbiAgcmV0dXJuIGZhbHNlXG59XG5cbmZ1bmN0aW9uIHN1bVdlaWdodGVkKFxuICBldmVudHM6IEdvYWxFdmVudFtdLFxuICBsaW5rczogR29hbExpbmtbXSxcbiAgbWV0cmljOiAnY291bnQnIHwgJ2R1cmF0aW9uJyxcbik6IG51bWJlciB7XG4gIGxldCB0b3RhbCA9IDBcbiAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMoZXZlbnRzKSkge1xuICAgIGlmIChldmVudC5tZXRyaWMgIT09IG1ldHJpYykgY29udGludWVcbiAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgbGlua3MpKSBjb250aW51ZVxuICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGxpbmtzKVxuICB9XG4gIHJldHVybiB0b3RhbFxufVxuXG5mdW5jdGlvbiB3aXRoQ2FycnlPdmVyKHZhbHVlOiBudW1iZXIsIGN5Y2xlOiBHb2FsQ3ljbGUpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgdmFsdWUgKyBOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciB8fCAwKSlcbn1cblxuZnVuY3Rpb24gcmVzdWx0KHZhbHVlOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogRXZhbHVhdGVSZXN1bHQge1xuICBjb25zdCBjdXJyZW50VmFsdWUgPSBNYXRoLm1heCgwLCB2YWx1ZSlcbiAgcmV0dXJuIHtcbiAgICBjdXJyZW50VmFsdWUsXG4gICAgZG9uZTogdGFyZ2V0ID4gMCA/IGN1cnJlbnRWYWx1ZSA+PSB0YXJnZXQgOiBjdXJyZW50VmFsdWUgPiAwLFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdkdXJhdGlvbicpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBncm91cENvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuLyoqIENvdW50IGNvbXBsZXRpb25zIG9mIGFueSBhY3Rpdml0eSBpbiBsaW5rZWQgZ3JvdXBzLiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQW55Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYW55X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgcmV0dXJuIGdyb3VwQ291bnRFdmFsdWF0b3IuZXZhbHVhdGUoY3R4KVxuICB9LFxufVxuXG4vKipcbiAqIFByb2dyZXNzID0gbnVtYmVyIG9mIGRpc3RpbmN0IGxpbmtlZC1ncm91cCBhY3Rpdml0aWVzIGNvbXBsZXRlZCBhdCBsZWFzdFxuICogb25jZSBpbiB0aGUgY3ljbGUuIFRhcmdldCBpcyB0eXBpY2FsbHkgdGhlIHNpemUgb2YgdGhlIGdyb3VwLlxuICovXG5leHBvcnQgY29uc3QgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9hbGxfY29tcGxldGUnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBhY3Rpdml0eUlkcyA9IG5ldyBTZXQoY3R4Lmdyb3VwQWN0aXZpdHlJZHMgPz8gW10pXG4gICAgY29uc3QgY29tcGxldGVkID0gbmV3IFNldDxudW1iZXI+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoZXZlbnQuYWN0aXZpdHlfaWQgPT0gbnVsbCkgY29udGludWVcbiAgICAgIGlmIChhY3Rpdml0eUlkcy5zaXplID4gMCAmJiAhYWN0aXZpdHlJZHMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpICYmIGFjdGl2aXR5SWRzLnNpemUgPT09IDApIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgfHwgbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSB7XG4gICAgICAgIGNvbXBsZXRlZC5hZGQoZXZlbnQuYWN0aXZpdHlfaWQpXG4gICAgICB9XG4gICAgfVxuICAgIC8vIFByZWZlciBjb3VudGluZyBvbmx5IGFjdGl2aXRpZXMgdGhhdCBiZWxvbmcgdG8gdGhlIGdyb3VwLlxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIGFjdGl2aXR5SWRzLnNpemUgPiAwXG4gICAgICAgID8gWy4uLmNvbXBsZXRlZF0uZmlsdGVyKChpZCkgPT4gYWN0aXZpdHlJZHMuaGFzKGlkKSkubGVuZ3RoXG4gICAgICAgIDogY29tcGxldGVkLnNpemUsXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdtdWx0aV9hY3Rpdml0eV9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqIENvbnNlY3V0aXZlIGNhbGVuZGFyIGRheXMgd2l0aCBhdCBsZWFzdCBvbmUgbWF0Y2hpbmcgY291bnQgZXZlbnQuICovXG5leHBvcnQgY29uc3Qgc3RyZWFrRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ3N0cmVhaycsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IGRheXMgPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKHdpbmRvd2VkKSkge1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gJ2NvdW50JykgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSBjb250aW51ZVxuICAgICAgY29uc3QgZGF5ID0gZXZlbnQub2NjdXJyZW5jZV9kYXRlID8/XG4gICAgICAgIG5ldyBEYXRlKGV2ZW50Lm9jY3VycmVkX2F0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuICAgICAgZGF5cy5hZGQoZGF5KVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uZGF5c10uc29ydCgpXG4gICAgbGV0IGJlc3QgPSAwXG4gICAgbGV0IHJ1biA9IDBcbiAgICBsZXQgcHJldjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IGRheSBvZiBzb3J0ZWQpIHtcbiAgICAgIGlmIChwcmV2KSB7XG4gICAgICAgIGNvbnN0IHByZXZEYXRlID0gbmV3IERhdGUocHJldiArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgY3VyRGF0ZSA9IG5ldyBEYXRlKGRheSArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgZGlmZiA9IChjdXJEYXRlLmdldFRpbWUoKSAtIHByZXZEYXRlLmdldFRpbWUoKSkgLyA4Nl80MDBfMDAwXG4gICAgICAgIHJ1biA9IGRpZmYgPT09IDEgPyBydW4gKyAxIDogMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcnVuID0gMVxuICAgICAgfVxuICAgICAgYmVzdCA9IE1hdGgubWF4KGJlc3QsIHJ1bilcbiAgICAgIHByZXYgPSBkYXlcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKGJlc3QsIGN0eC5jeWNsZSlcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyB3aG9zZSBvY2N1cnJlbmNlIGxvY2FsIHRpbWUgaXMgYmVmb3JlIGNvbmZpZy5iZWZvcmVfdGltZS4gKi9cbmV4cG9ydCBjb25zdCB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICd0aW1lX29mX2RheV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IGJlZm9yZSA9IHR5cGVvZiBjb25maWcuYmVmb3JlX3RpbWUgPT09ICdzdHJpbmcnID8gY29uZmlnLmJlZm9yZV90aW1lIDogbnVsbFxuICAgIGNvbnN0IGFmdGVyID0gdHlwZW9mIGNvbmZpZy5hZnRlcl90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5hZnRlcl90aW1lIDogbnVsbFxuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGxldCB0b3RhbCA9IDBcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGhobW0gPSBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgxMSwgMTYpXG4gICAgICBpZiAoYmVmb3JlICYmIGhobW0gPj0gYmVmb3JlKSBjb250aW51ZVxuICAgICAgaWYgKGFmdGVyICYmIGhobW0gPCBhZnRlcikgY29udGludWVcbiAgICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGN0eC5saW5rcylcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdCh3aXRoQ2FycnlPdmVyKHRvdGFsLCBjdHguY3ljbGUpLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBjb21wb3NpdGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnY29tcG9zaXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3QgY29uZmlnID0gdHlwZW9mIGN0eC5nb2FsLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShjdHguZ29hbC5jb25maWcpXG4gICAgICA6IChjdHguZ29hbC5jb25maWcgPz8ge30pXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZy5jb21wb3NpdGVfbW9kZSA/PyAnYWxsJ1xuICAgIGNvbnN0IGNoaWxkcmVuID0gY3R4LmNoaWxkQ3ljbGVzXG4gICAgaWYgKCFjaGlsZHJlbiB8fCBjaGlsZHJlbi5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm4gcmVzdWx0KDAsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gWy4uLmNoaWxkcmVuLmVudHJpZXMoKV1cbiAgICBpZiAobW9kZSA9PT0gJ3dlaWdodGVkJykge1xuICAgICAgbGV0IHdlaWdodGVkU3VtID0gMFxuICAgICAgbGV0IHdlaWdodFRvdGFsID0gMFxuICAgICAgZm9yIChjb25zdCBbY2hpbGRJZCwgY3ljbGVdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgdyA9IE51bWJlcihjdHguY2hpbGRXZWlnaHRzPy5nZXQoY2hpbGRJZCkgPz8gMSlcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3MgPSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDBcbiAgICAgICAgICA/IE1hdGgubWluKDEsIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSAvIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgICAgICAgIDogKGN5Y2xlLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgPyAxIDogMClcbiAgICAgICAgd2VpZ2h0ZWRTdW0gKz0gcHJvZ3Jlc3MgKiB3XG4gICAgICAgIHdlaWdodFRvdGFsICs9IHdcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBjdCA9IHdlaWdodFRvdGFsID4gMCA/IHdlaWdodGVkU3VtIC8gd2VpZ2h0VG90YWwgOiAwXG4gICAgICAvLyBSZXByZXNlbnQgYXMgMFx1MjAxMzEwMCBwZXJjZW50IG9mIHRhcmdldC5cbiAgICAgIGNvbnN0IHZhbHVlID0gcGN0ICogTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29tcGxldGVkID0gZW50cmllcy5maWx0ZXIoKFssIGNdKSA9PlxuICAgICAgYy5zdGF0dXMgPT09ICdzdWNjZWVkZWQnIHx8XG4gICAgICAoTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSA+IDAgJiYgTnVtYmVyKGMuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSlcbiAgICApLmxlbmd0aFxuXG4gICAgaWYgKG1vZGUgPT09ICdhbnknKSB7XG4gICAgICBjb25zdCBuZWVkZWQgPSBNYXRoLm1heCgxLCBOdW1iZXIoY29uZmlnLmNvdW50X3JlcXVpcmVkID8/IDEpKVxuICAgICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIG5lZWRlZClcbiAgICB9XG5cbiAgICAvLyBhbGxcbiAgICByZXR1cm4gcmVzdWx0KGNvbXBsZXRlZCwgZW50cmllcy5sZW5ndGgpXG4gIH0sXG59XG5cbmNvbnN0IEVWQUxVQVRPUlM6IEdvYWxFdmFsdWF0b3JbXSA9IFtcbiAgYWN0aXZpdHlDb3VudEV2YWx1YXRvcixcbiAgYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbnlDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcixcbiAgbXVsdGlBY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLFxuICBzdHJlYWtFdmFsdWF0b3IsXG4gIHRpbWVPZkRheUNvdW50RXZhbHVhdG9yLFxuICBjb21wb3NpdGVFdmFsdWF0b3IsXG5dXG5cbmNvbnN0IFJFR0lTVFJZID0gbmV3IE1hcChFVkFMVUFUT1JTLm1hcCgoZSkgPT4gW2UucnVsZVR5cGUsIGVdKSlcblxuZXhwb3J0IGNvbnN0IEdPQUxfUlVMRV9UWVBFUyA9IEVWQUxVQVRPUlMubWFwKChlKSA9PiBlLnJ1bGVUeXBlKVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RXZhbHVhdG9yKHJ1bGVUeXBlOiBzdHJpbmcpOiBHb2FsRXZhbHVhdG9yIHtcbiAgY29uc3QgZXZhbHVhdG9yID0gUkVHSVNUUlkuZ2V0KHJ1bGVUeXBlKVxuICBpZiAoIWV2YWx1YXRvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBnb2FsIHJ1bGVfdHlwZTogJHtydWxlVHlwZX1gKVxuICB9XG4gIHJldHVybiBldmFsdWF0b3Jcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlR29hbChjdHg6IEV2YWx1YXRlQ29udGV4dCk6IEV2YWx1YXRlUmVzdWx0IHtcbiAgcmV0dXJuIGdldEV2YWx1YXRvcihjdHguZ29hbC5ydWxlX3R5cGUpLmV2YWx1YXRlKGN0eClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknO1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgR29hbCxcbiAgR29hbEN5Y2xlLFxuICBHb2FsRXZlbnQsXG4gIEdvYWxMaW5rLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnO1xuaW1wb3J0IHsgY3ljbGVIYXNTdGFydGVkIH0gZnJvbSAnLi9saWZlY3ljbGUudHMnO1xuaW1wb3J0IHsgZXZhbHVhdGVHb2FsIH0gZnJvbSAnLi9ldmFsdWF0b3JzL2luZGV4LnRzJztcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+O1xuXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24pOiBUIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge30gYXMgVDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh2YWx1ZSA/PyB7fSkgYXMgVDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoR29hbExpbmtzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8R29hbExpbmtbXT4ge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoRXZlbnRzRm9yVXNlcihcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIGZyb20/OiBEYXRlIHwgc3RyaW5nLFxuICB0bz86IERhdGUgfCBzdHJpbmcsXG4pOiBQcm9taXNlPEdvYWxFdmVudFtdPiB7XG4gIGxldCBxdWVyeSA9IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZXZlbnRzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKCk7XG5cbiAgaWYgKGZyb20pIHtcbiAgICBjb25zdCBmcm9tRGF0ZSA9IHR5cGVvZiBmcm9tID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKGZyb20pIDogZnJvbTtcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdvY2N1cnJlZF9hdCcsICc+PScsIGZyb21EYXRlIGFzIG5ldmVyKTtcbiAgfVxuICBpZiAodG8pIHtcbiAgICBjb25zdCB0b0RhdGUgPSB0eXBlb2YgdG8gPT09ICdzdHJpbmcnID8gbmV3IERhdGUodG8pIDogdG87XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnb2NjdXJyZWRfYXQnLCAnPCcsIHRvRGF0ZSBhcyBuZXZlcik7XG4gIH1cblxuICByZXR1cm4gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gIGRiOiBEYkxpa2UsXG4gIGxpbmtzOiBHb2FsTGlua1tdLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyW10+IHtcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua190eXBlID09PSAnZ3JvdXAnICYmIGwuZ3JvdXBfaWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISk7XG4gIGlmIChncm91cElkcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdncm91cF9pZCcsICdpbicsIGdyb3VwSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpO1xuICByZXR1cm4gcm93cy5tYXAoKHIpID0+IHIuaWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaENoaWxkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8eyBjeWNsZXM6IE1hcDxudW1iZXIsIEdvYWxDeWNsZT47IHdlaWdodHM6IE1hcDxudW1iZXIsIG51bWJlcj4gfT4ge1xuICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgY29uc3QgY3ljbGVzID0gbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKTtcbiAgY29uc3Qgd2VpZ2h0cyA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7XG5cbiAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgIHdlaWdodHMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIE51bWJlcihkZXAud2VpZ2h0KSk7XG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcblxuICAgIGlmIChjeWNsZSkge1xuICAgICAgY3ljbGVzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBjeWNsZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAobGF0ZXN0KSBjeWNsZXMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIGxhdGVzdCk7XG4gIH1cblxuICByZXR1cm4geyBjeWNsZXMsIHdlaWdodHMgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGhpdHRpbmcgdGhlIHRhcmdldCBzaG91bGQgY2xvc2UgdGhlIGN5Y2xlIGltbWVkaWF0ZWx5LlxuICogUmVjdXJyaW5nIGN5Y2xlcyBzdGF5IGBhY3RpdmVgIHVudGlsIHJvbGwtb3ZlciBhdCBlbmRzX2F0IHNvIHRoZSBVSSBrZWVwc1xuICogYW4gYWN0aXZlQ3ljbGUgKGFuZCBwcm9ncmVzcykgZm9yIHRoZSByZXN0IG9mIHRoZSB3aW5kb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoXG4gIGdvYWw6IFBpY2s8R29hbCwgJ3JlY3VycmVuY2UnPixcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gZ29hbC5yZWN1cnJlbmNlID09IG51bGw7XG59XG5cbi8qKlxuICogUmVjb21wdXRlIGFuZCBwZXJzaXN0IGN1cnJlbnRfdmFsdWUgZm9yIGEgc2luZ2xlIGN5Y2xlLlxuICogUmV0dXJucyB0aGUgdXBkYXRlZCBjeWNsZS5cbiAqIFNraXBzIGFjY3J1YWwgd2hpbGUgdGhlIGN5Y2xlIGhhcyBub3Qgc3RhcnRlZCAoa2VlcHMgY3VycmVudF92YWx1ZSBhdCAwLFxuICogbmV2ZXIgYXV0by1zdWNjZWVkcykgXHUyMDE0IGNvdmVycyBjb21wb3NpdGUgcGFyZW50cyBjb21wbGV0aW5nIGVhcmx5IHZpYSBjaGlsZHJlbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgaWYgKGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgIWN5Y2xlSGFzU3RhcnRlZChjeWNsZSwgbm93KSkge1xuICAgIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPT09IDApIHJldHVybiBjeWNsZTtcbiAgICBjb25zdCBzdGFtcGVkID0gbm93LnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgIC5zZXQoeyBjdXJyZW50X3ZhbHVlOiAwLCB1cGRhdGVkX2F0OiBzdGFtcGVkIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH1cblxuICBjb25zdCBsaW5rcyA9IGF3YWl0IGZldGNoR29hbExpbmtzKGRiLCBnb2FsLmlkKTtcbiAgY29uc3QgZXZlbnRzID0gYXdhaXQgZmV0Y2hFdmVudHNGb3JVc2VyKFxuICAgIGRiLFxuICAgIGdvYWwudXNlcl9pZCxcbiAgICBjeWNsZS5zdGFydHNfYXQsXG4gICAgY3ljbGUuZW5kc19hdCA/PyB1bmRlZmluZWQsXG4gICk7XG4gIGNvbnN0IGdyb3VwQWN0aXZpdHlJZHMgPSBhd2FpdCBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gICAgZGIsXG4gICAgbGlua3MsXG4gICAgZ29hbC51c2VyX2lkLFxuICApO1xuICBjb25zdCB7IGN5Y2xlczogY2hpbGRDeWNsZXMsIHdlaWdodHM6IGNoaWxkV2VpZ2h0cyB9ID1cbiAgICBnb2FsLnJ1bGVfdHlwZSA9PT0gJ2NvbXBvc2l0ZSdcbiAgICAgID8gYXdhaXQgZmV0Y2hDaGlsZEN5Y2xlcyhkYiwgZ29hbC5pZClcbiAgICAgIDoge1xuICAgICAgICAgIGN5Y2xlczogbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKSxcbiAgICAgICAgICB3ZWlnaHRzOiBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpLFxuICAgICAgICB9O1xuXG4gIGNvbnN0IHsgY3VycmVudFZhbHVlLCBkb25lIH0gPSBldmFsdWF0ZUdvYWwoe1xuICAgIGdvYWw6IHtcbiAgICAgIC4uLmdvYWwsXG4gICAgICBjb25maWc6IHBhcnNlSnNvbihnb2FsLmNvbmZpZyksXG4gICAgfSxcbiAgICBjeWNsZSxcbiAgICBsaW5rcyxcbiAgICBldmVudHMsXG4gICAgY2hpbGRDeWNsZXMsXG4gICAgY2hpbGRXZWlnaHRzLFxuICAgIGdyb3VwQWN0aXZpdHlJZHMsXG4gIH0pO1xuXG4gIGNvbnN0IG5vd0lzbyA9IG5vdy50b0lTT1N0cmluZygpO1xuICBsZXQgc3RhdHVzID0gY3ljbGUuc3RhdHVzO1xuICAvLyBPbmUtdGltZSBnb2FscyBjbG9zZSBhcyBzb29uIGFzIHRoZSB0YXJnZXQgaXMgbWV0LiBSZWN1cnJpbmcgY3ljbGVzIHN0YXlcbiAgLy8gYWN0aXZlIHVudGlsIHJvbGxPdmVySWZOZWVkZWQgY2xvc2VzIHRoZW0gYXQgZW5kc19hdCBcdTIwMTQgb3RoZXJ3aXNlXG4gIC8vIGFjdGl2ZUN5Y2xlIGdvZXMgbnVsbCBtaWQtd2luZG93IGFuZCB0aGUgY2xpZW50IHNob3dzIDAlIHByb2dyZXNzLlxuICBpZiAoXG4gICAgY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgIGRvbmUgJiZcbiAgICBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoZ29hbClcbiAgKSB7XG4gICAgc3RhdHVzID0gJ3N1Y2NlZWRlZCc7XG4gIH1cblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIGN1cnJlbnRfdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vd0lzbyxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gIC8vIERhaWx5IHNuYXBzaG90IGZvciBoaXN0b3J5IGNoYXJ0cyAodXBzZXJ0IGJ5IGFzX29mIGRhdGUpLlxuICBjb25zdCBhc09mID0gbm93SXNvLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogdXBkYXRlZC5pZCxcbiAgICAgIGFzX29mOiBhc09mLFxuICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICB9KVxuICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgIG9jLmNvbHVtbnMoWydnb2FsX2N5Y2xlX2lkJywgJ2FzX29mJ10pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIH0pLFxuICAgIClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIC8vIE1hcmsgcGFyZW50IGdvYWwgY29tcGxldGVkIHdoZW4gYSBvbmUtdGltZSBjeWNsZSBzdWNjZWVkcy5cbiAgaWYgKHN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgIWdvYWwucmVjdXJyZW5jZSAmJiBnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScpIHtcbiAgICBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAnY29tcGxldGVkJywgdXBkYXRlZF9hdDogbm93SXNvIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgfVxuXG4gIC8vIEVkZ2UtdHJpZ2dlciByZXdhcmQgZ3JhbnRzIHdoZW4gYSBjeWNsZSBuZXdseSBzdWNjZWVkcy5cbiAgaWYgKHN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgY3ljbGUuc3RhdHVzICE9PSAnc3VjY2VlZGVkJykge1xuICAgIGNvbnN0IHsgZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyB9ID0gYXdhaXQgaW1wb3J0KFxuICAgICAgJy4uL3Jld2FyZHMvaG9va3MudHMnXG4gICAgKTtcbiAgICBhd2FpdCBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzKGRiLCB7XG4gICAgICB1c2VySWQ6IGdvYWwudXNlcl9pZCxcbiAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlSWQ6IHVwZGF0ZWQuaWQsXG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gdXBkYXRlZDtcbn1cblxuLyoqIFJlY29tcHV0ZSBhbGwgYWN0aXZlIGN5Y2xlcyBsaW5rZWQgdG8gYW4gYWN0aXZpdHkgb3IgZ3JvdXAgdmlhIGdvYWxfbGlua3MuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBvcHRzOiB7IGFjdGl2aXR5SWQ/OiBudW1iZXIgfCBudWxsOyBncm91cElkPzogbnVtYmVyIHwgbnVsbCB9LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGdvYWxJZHMgPSBuZXcgU2V0PG51bWJlcj4oKTtcblxuICBpZiAob3B0cy5hY3Rpdml0eUlkICE9IG51bGwpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZ29hbF9saW5rcy5hY3Rpdml0eV9pZCcsICc9Jywgb3B0cy5hY3Rpdml0eUlkKVxuICAgICAgLnNlbGVjdCgnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCByIG9mIHJvd3MpIGdvYWxJZHMuYWRkKHIuZ29hbF9pZCk7XG4gIH1cblxuICBpZiAob3B0cy5ncm91cElkICE9IG51bGwpIHtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZ29hbF9saW5rcy5ncm91cF9pZCcsICc9Jywgb3B0cy5ncm91cElkKVxuICAgICAgLnNlbGVjdCgnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCByIG9mIHJvd3MpIGdvYWxJZHMuYWRkKHIuZ29hbF9pZCk7XG4gIH1cblxuICAvLyBBbHNvIHJlY29tcHV0ZSBjb21wb3NpdGVzIHRoYXQgZGVwZW5kIG9uIGFmZmVjdGVkIGdvYWxzLlxuICBpZiAoZ29hbElkcy5zaXplID4gMCkge1xuICAgIGNvbnN0IGRlcHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgIC53aGVyZSgnZGVwZW5kc19vbl9nb2FsX2lkJywgJ2luJywgWy4uLmdvYWxJZHNdKVxuICAgICAgLnNlbGVjdCgnZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgZCBvZiBkZXBzKSBnb2FsSWRzLmFkZChkLmdvYWxfaWQpO1xuICB9XG5cbiAgZm9yIChjb25zdCBnb2FsSWQgb2YgZ29hbElkcykge1xuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWxJZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghZ29hbCB8fCBnb2FsLnN0YXR1cyA9PT0gJ3BhdXNlZCcgfHwgZ29hbC5zdGF0dXMgPT09ICdhcmNoaXZlZCcpXG4gICAgICBjb250aW51ZTtcblxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWN5Y2xlKSBjb250aW51ZTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSk7XG4gIH1cbn1cblxuLyoqIEZ1bGwgcmVjb21wdXRlIG9mIGV2ZXJ5IGFjdGl2ZSBjeWNsZSBmb3IgYSB1c2VyIChyZXBhaXIgcGF0aCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyPiB7XG4gIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydhY3RpdmUnLCAnY29tcGxldGVkJywgJ2ZhaWxlZCddKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgbGV0IGNvdW50ID0gMDtcbiAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgY29uc3QgY3ljbGVzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCBjeWNsZSBvZiBjeWNsZXMpIHtcbiAgICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSk7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgfVxuICByZXR1cm4gY291bnQ7XG59XG4iLCAiLyoqXG4gKiBTaGFyZWQgcHJlc2V0IHBhbGV0dGUgZm9yIGFjdGl2aXR5IGdyb3Vwcy5cbiAqIEtlZXAgaW4gc3luYyB3aXRoIEZsdXR0ZXIgYGxpYi90aGVtZS90b2tlbnMvZ3JvdXBfcGFsZXR0ZS5kYXJ0YC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdST1VQX0NPTE9SX1BBTEVUVEUgPSBbXG4gICcjMEY3NjZFJywgLy8gdGVhbCAoYnJhbmQpXG4gICcjMjU2M0VCJywgLy8gYmx1ZVxuICAnIzdDM0FFRCcsIC8vIHZpb2xldFxuICAnI0RCMjc3NycsIC8vIHBpbmtcbiAgJyNEQzI2MjYnLCAvLyByZWRcbiAgJyNFQTU4MEMnLCAvLyBvcmFuZ2VcbiAgJyNDQThBMDQnLCAvLyB5ZWxsb3dcbiAgJyMxNkEzNEEnLCAvLyBncmVlblxuICAnIzA4OTFCMicsIC8vIGN5YW5cbiAgJyM0QjU1NjMnLCAvLyBncmF5XG5dIGFzIGNvbnN0XG5cbmV4cG9ydCB0eXBlIEdyb3VwQ29sb3IgPSAodHlwZW9mIEdST1VQX0NPTE9SX1BBTEVUVEUpW251bWJlcl1cblxuY29uc3QgSEVYX0NPTE9SX1JFID0gL14jWzAtOUEtRmEtZl17Nn0kL1xuXG5leHBvcnQgZnVuY3Rpb24gaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogY29sb3IgaXMgR3JvdXBDb2xvciB7XG4gIGlmICghSEVYX0NPTE9SX1JFLnRlc3QoY29sb3IpKSByZXR1cm4gZmFsc2VcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNvbG9yLnRvVXBwZXJDYXNlKClcbiAgcmV0dXJuIChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5zb21lKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQsXG4gIClcbn1cblxuLyoqIE5vcm1hbGl6ZSB0byBjYW5vbmljYWwgYCNSUkdHQkJgIHVwcGVyY2FzZSBmcm9tIHRoZSBhbGxvd2xpc3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogR3JvdXBDb2xvciB7XG4gIGNvbnN0IG1hdGNoID0gKEdST1VQX0NPTE9SX1BBTEVUVEUgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmZpbmQoXG4gICAgKGMpID0+IGMudG9VcHBlckNhc2UoKSA9PT0gY29sb3IudG9VcHBlckNhc2UoKSxcbiAgKVxuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyb3VwIGNvbG9yOiAke2NvbG9yfWApXG4gIH1cbiAgcmV0dXJuIG1hdGNoIGFzIEdyb3VwQ29sb3Jcbn1cbiIsICJpbXBvcnQgeyBSZWN1cnJlbmNlQ29uZmlnLCBSZWN1cnJlbmNlUGF0dGVybklucHV0IH0gZnJvbSAnLi90eXBlcy50cydcbmltcG9ydCB7IGlzQWxsb3dlZEdyb3VwQ29sb3IsIG5vcm1hbGl6ZUdyb3VwQ29sb3IgfSBmcm9tICcuL2dyb3VwX3BhbGV0dGUudHMnXG5pbXBvcnQgeyBHT0FMX1JVTEVfVFlQRVMgfSBmcm9tICcuLi9nb2Fscy9ldmFsdWF0b3JzL2luZGV4LnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDcmVhdGVHb2FsSW5wdXQsXG4gIEdvYWxEZWFkbGluZUlucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBHb2FsUmVjdXJyZW5jZUlucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4vdHlwZXMudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmV4cG9ydCBjbGFzcyBJbnZhbGlkR3JvdXBFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZENvbXBsZXRpb25FcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdvYWxFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmludGVyZmFjZSBBY3Rpdml0eVNjaGVkdWxlIHtcbiAgaXNSZWN1cnJpbmc6IGJvb2xlYW5cbiAgZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgcmVjdXJyZW5jZVBhdHRlcm4/OiBSZWN1cnJlbmNlUGF0dGVybklucHV0IHwgbnVsbFxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGF0IGFuIGFjdGl2aXR5J3Mgc2NoZWR1bGUgaXMgaW50ZXJuYWxseSBjb25zaXN0ZW50OlxuICogLSBOb24tcmVjdXJyaW5nIGFjdGl2aXRpZXMgbXVzdCBoYXZlIGEgYGRhdGVgIGFuZCBubyByZWN1cnJlbmNlIHBhdHRlcm4uXG4gKiAtIFJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIHJlY3VycmVuY2UgcGF0dGVybiAoYW5kIG5vIGBkYXRlYCksXG4gKiAgIHdpdGggY29uZmlnIGZpZWxkcyBtYXRjaGluZyB0aGUgY2hvc2VuIHJlY3VycmVuY2UgdHlwZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZShpbnB1dDogQWN0aXZpdHlTY2hlZHVsZSk6IHZvaWQge1xuICBpZiAoIWlucHV0LmlzUmVjdXJyaW5nKSB7XG4gICAgaWYgKCFpbnB1dC5kYXRlKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgJ2RhdGUgaXMgcmVxdWlyZWQgd2hlbiBpc1JlY3VycmluZyBpcyBmYWxzZScsXG4gICAgICApXG4gICAgfVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCFpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ3JlY3VycmVuY2VQYXR0ZXJuIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgdHJ1ZScsXG4gICAgKVxuICB9XG5cbiAgY29uc3QgeyByZWN1cnJlbmNlVHlwZSwgY29uZmlnIH0gPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVyblxuICBpZiAoIWNvbmZpZyB8fCAhY29uZmlnLnN0YXJ0X2RhdGUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybi5jb25maWcuc3RhcnRfZGF0ZSBpcyByZXF1aXJlZCcsXG4gICAgKVxuICB9XG5cbiAgc3dpdGNoIChyZWN1cnJlbmNlVHlwZSkge1xuICAgIGNhc2UgJ3dlZWtseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZldlZWsoY29uZmlnLmRheXNfb2Zfd2VlaylcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZk1vbnRoKGNvbmZpZy5kYXlzX29mX21vbnRoLCBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICB2YWxpZGF0ZUludGVydmFsRGF5cyhjb25maWcuaW50ZXJ2YWxfZGF5cylcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICBgVW5zdXBwb3J0ZWQgcmVjdXJyZW5jZVR5cGU6ICR7cmVjdXJyZW5jZVR5cGV9YCxcbiAgICAgIClcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIGdyb3VwIGNvbG9yIGFnYWluc3QgdGhlIHNoYXJlZCBoZXggYWxsb3dsaXN0LlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIHBhbGV0dGUgdmFsdWUgKGUuZy4gYCMwRjc2NkVgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFpc0FsbG93ZWRHcm91cENvbG9yKGNvbG9yKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcbiAgICAgICdjb2xvciBtdXN0IGJlIGEgaGV4IHZhbHVlIGZyb20gdGhlIGdyb3VwIHBhbGV0dGUgKGUuZy4gIzBGNzY2RSknLFxuICAgIClcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcilcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgZ3JvdXAgbmFtZSBpcyBub24tZW1wdHkgYWZ0ZXIgdHJpbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcignbmFtZSBtdXN0IGJlIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnMnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmNvbnN0IERBVEVfUkUgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9JC9cbmNvbnN0IFRJTUVfUkUgPSAvXlxcZHsyfTpcXGR7Mn0kL1xuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShkYXRlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIURBVEVfUkUudGVzdChkYXRlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKCdvY2N1cnJlbmNlRGF0ZSBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG4gIHJldHVybiBkYXRlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyh2YWx1ZTogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCk6IG51bWJlciB8IG51bGwge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCB8fCB2YWx1ZSA9PT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDwgMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24odmFsdWU6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8PSAwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKCdkdXJhdGlvbk1pbnV0ZXMgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURheXNPZldlZWsoZGF5c09mV2VlazogUmVjdXJyZW5jZUNvbmZpZ1snZGF5c19vZl93ZWVrJ10pOiB2b2lkIHtcbiAgaWYgKCFkYXlzT2ZXZWVrIHx8IGRheXNPZldlZWsubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2Zfd2VlayBpcyByZXF1aXJlZCBmb3Igd2Vla2x5IHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxuICBpZiAoZGF5c09mV2Vlay5zb21lKChkYXkpID0+ICFOdW1iZXIuaXNJbnRlZ2VyKGRheSkgfHwgZGF5IDwgMCB8fCBkYXkgPiA2KSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgbXVzdCBjb250YWluIGludGVnZXJzIGJldHdlZW4gMCAoU3VuZGF5KSBhbmQgNiAoU2F0dXJkYXkpJyxcbiAgICApXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZNb250aChcbiAgZGF5c09mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2ZfbW9udGgnXSxcbiAgaXNMYXN0RGF5T2ZNb250aDogUmVjdXJyZW5jZUNvbmZpZ1snaXNfbGFzdF9kYXlfb2ZfbW9udGgnXSxcbik6IHZvaWQge1xuICBjb25zdCBoYXNEYXlzT2ZNb250aCA9ICEhZGF5c09mTW9udGggJiYgZGF5c09mTW9udGgubGVuZ3RoID4gMFxuICBpZiAoIWhhc0RheXNPZk1vbnRoICYmICFpc0xhc3REYXlPZk1vbnRoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2ZfbW9udGggb3IgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoIGlzIHJlcXVpcmVkIGZvciBtb250aGx5IHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxuICBpZiAoXG4gICAgaGFzRGF5c09mTW9udGggJiZcbiAgICBkYXlzT2ZNb250aCEuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDEgfHwgZGF5ID4gMzEpXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDEgYW5kIDMxJyxcbiAgICApXG4gIH1cbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbERheXMoaW50ZXJ2YWxEYXlzOiBSZWN1cnJlbmNlQ29uZmlnWydpbnRlcnZhbF9kYXlzJ10pOiB2b2lkIHtcbiAgaWYgKFxuICAgIGludGVydmFsRGF5cyA9PT0gdW5kZWZpbmVkIHx8XG4gICAgaW50ZXJ2YWxEYXlzID09PSBudWxsIHx8XG4gICAgIU51bWJlci5pc0ludGVnZXIoaW50ZXJ2YWxEYXlzKSB8fFxuICAgIGludGVydmFsRGF5cyA8IDFcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmludGVydmFsX2RheXMgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEgZm9yIGV2ZXJ5X3hfZGF5cyByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbFRpdGxlKHRpdGxlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gdGl0bGUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIGlzIHJlcXVpcmVkJylcbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGl0bGUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbENvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdmFsaWRhdGVHcm91cENvbG9yKGNvbG9yKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVSdWxlVHlwZShydWxlVHlwZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFHT0FMX1JVTEVfVFlQRVMuaW5jbHVkZXMocnVsZVR5cGUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICBgcnVsZVR5cGUgbXVzdCBiZSBvbmUgb2Y6ICR7R09BTF9SVUxFX1RZUEVTLmpvaW4oJywgJyl9YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHJ1bGVUeXBlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVRhcmdldFZhbHVlKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0YXJnZXRWYWx1ZSBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbExpbmtzKFxuICBsaW5rczogR29hbExpbmtJbnB1dFtdIHwgdW5kZWZpbmVkLFxuICBydWxlVHlwZTogc3RyaW5nLFxuKTogR29hbExpbmtJbnB1dFtdIHtcbiAgY29uc3QgbGlzdCA9IGxpbmtzID8/IFtdXG4gIGlmIChydWxlVHlwZSA9PT0gJ2NvbXBvc2l0ZScpIHtcbiAgICBpZiAobGlzdC5sZW5ndGggPiAwKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignY29tcG9zaXRlIGdvYWxzIG11c3Qgbm90IGhhdmUgYWN0aXZpdHkvZ3JvdXAgbGlua3MnKVxuICAgIH1cbiAgICByZXR1cm4gW11cbiAgfVxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYXQgbGVhc3Qgb25lIGxpbmsgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGZvciAoY29uc3QgbGluayBvZiBsaXN0KSB7XG4gICAgaWYgKGxpbmsubGlua1R5cGUgPT09ICdhY3Rpdml0eScpIHtcbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWN0aXZpdHkgbGlua3MgcmVxdWlyZSBhY3Rpdml0eUlkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWN0aXZpdHkgbGlua3MgbXVzdCBub3Qgc2V0IGdyb3VwSWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSBpZiAobGluay5saW5rVHlwZSA9PT0gJ2dyb3VwJykge1xuICAgICAgaWYgKGxpbmsuZ3JvdXBJZCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdncm91cCBsaW5rcyByZXF1aXJlIGdyb3VwSWQnKVxuICAgICAgfVxuICAgICAgaWYgKGxpbmsuYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdncm91cCBsaW5rcyBtdXN0IG5vdCBzZXQgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdsaW5rVHlwZSBtdXN0IGJlIGFjdGl2aXR5IG9yIGdyb3VwJylcbiAgICB9XG4gICAgaWYgKGxpbmsud2VpZ2h0ICE9IG51bGwgJiYgKCFOdW1iZXIuaXNGaW5pdGUobGluay53ZWlnaHQpIHx8IGxpbmsud2VpZ2h0IDw9IDApKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGluayB3ZWlnaHQgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gICAgfVxuICB9XG4gIHJldHVybiBsaXN0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoXG4gIGRlcHM6IEdvYWxEZXBlbmRlbmN5SW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxEZXBlbmRlbmN5SW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBkZXBzID8/IFtdXG4gIGlmIChydWxlVHlwZSA9PT0gJ2NvbXBvc2l0ZScgJiYgbGlzdC5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignY29tcG9zaXRlIGdvYWxzIHJlcXVpcmUgYXQgbGVhc3Qgb25lIGRlcGVuZGVuY3knKVxuICB9XG4gIGZvciAoY29uc3QgZGVwIG9mIGxpc3QpIHtcbiAgICBpZiAoIU51bWJlci5pc0ludGVnZXIoZGVwLmRlcGVuZHNPbkdvYWxJZCkgfHwgZGVwLmRlcGVuZHNPbkdvYWxJZCA8PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVwZW5kc09uR29hbElkIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgICB9XG4gICAgaWYgKFxuICAgICAgZGVwLnJlcXVpcmVtZW50ICE9IG51bGwgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ2NvbXBsZXRlJyAmJlxuICAgICAgZGVwLnJlcXVpcmVtZW50ICE9PSAncHJvZ3Jlc3MnXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigncmVxdWlyZW1lbnQgbXVzdCBiZSBjb21wbGV0ZSBvciBwcm9ncmVzcycpXG4gICAgfVxuICB9XG4gIHJldHVybiBsaXN0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKFxuICByZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IEdvYWxSZWN1cnJlbmNlSW5wdXQgfCBudWxsIHtcbiAgaWYgKHJlY3VycmVuY2UgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgcGVyaW9kcyA9IFsnd2Vla2x5JywgJ21vbnRobHknLCAncXVhcnRlcmx5JywgJ2V2ZXJ5X3hfZGF5cyddXG4gIGlmICghcGVyaW9kcy5pbmNsdWRlcyhyZWN1cnJlbmNlLnBlcmlvZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihgdW5zdXBwb3J0ZWQgcmVjdXJyZW5jZSBwZXJpb2Q6ICR7cmVjdXJyZW5jZS5wZXJpb2R9YClcbiAgfVxuICBpZiAoXG4gICAgcmVjdXJyZW5jZS5pbnRlcnZhbCAhPSBudWxsICYmXG4gICAgKCFOdW1iZXIuaXNJbnRlZ2VyKHJlY3VycmVuY2UuaW50ZXJ2YWwpIHx8IHJlY3VycmVuY2UuaW50ZXJ2YWwgPCAxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigncmVjdXJyZW5jZS5pbnRlcnZhbCBtdXN0IGJlIGFuIGludGVnZXIgPj0gMScpXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9IG51bGwgJiZcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPT0gJ25vbmUnICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdvdmVyZmxvdydcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NhcnJ5T3ZlciBtdXN0IGJlIG5vbmUgb3Igb3ZlcmZsb3cnKVxuICB9XG4gIHJldHVybiByZWN1cnJlbmNlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxEZWFkbGluZShcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB7XG4gIGlmIChkZWFkbGluZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ2Fic29sdXRlJykge1xuICAgIGlmICghZGVhZGxpbmUuZGF0ZSB8fCAhREFURV9SRS50ZXN0KGRlYWRsaW5lLmRhdGUpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWJzb2x1dGUgZGVhZGxpbmUgcmVxdWlyZXMgZGF0ZSBZWVlZLU1NLUREJylcbiAgICB9XG4gIH0gZWxzZSBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ3JlbGF0aXZlJykge1xuICAgIGlmIChcbiAgICAgIGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQgPT0gbnVsbCB8fFxuICAgICAgIU51bWJlci5pc0ludGVnZXIoZGVhZGxpbmUuZGF5c0FmdGVyQ3ljbGVTdGFydCkgfHxcbiAgICAgIGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQgPCAwXG4gICAgKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgJ3JlbGF0aXZlIGRlYWRsaW5lIHJlcXVpcmVzIGRheXNBZnRlckN5Y2xlU3RhcnQgPj0gMCcsXG4gICAgICApXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZWFkbGluZS5raW5kIG11c3QgYmUgYWJzb2x1dGUgb3IgcmVsYXRpdmUnKVxuICB9XG4gIHJldHVybiBkZWFkbGluZVxufVxuXG5jb25zdCBNQVhfU1RBUlRfWUVBUlNfQUhFQUQgPSA1XG5cbi8qKiBQYXJzZSBhbmQgdmFsaWRhdGUgYW4gb3B0aW9uYWwgSVNPLTg2MDEgc3RhcnRzQXQuIFJldHVybnMgbnVsbCBpZiBvbWl0dGVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3RhcnRzQXQoXG4gIHN0YXJ0c0F0OiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoc3RhcnRzQXQgPT0gbnVsbCB8fCBzdGFydHNBdCA9PT0gJycpIHJldHVybiBudWxsXG4gIGNvbnN0IHBhcnNlZCA9IG5ldyBEYXRlKHN0YXJ0c0F0KVxuICBpZiAoTnVtYmVyLmlzTmFOKHBhcnNlZC5nZXRUaW1lKCkpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3N0YXJ0c0F0IG11c3QgYmUgYSB2YWxpZCBJU08tODYwMSBkYXRldGltZScpXG4gIH1cbiAgY29uc3QgbWF4ID0gbmV3IERhdGUobm93KVxuICBtYXguc2V0VVRDRnVsbFllYXIobWF4LmdldFVUQ0Z1bGxZZWFyKCkgKyBNQVhfU1RBUlRfWUVBUlNfQUhFQUQpXG4gIGlmIChwYXJzZWQgPiBtYXgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgIGBzdGFydHNBdCBtdXN0IGJlIHdpdGhpbiAke01BWF9TVEFSVF9ZRUFSU19BSEVBRH0geWVhcnMgZnJvbSBub3dgLFxuICAgIClcbiAgfVxuICByZXR1cm4gcGFyc2VkXG59XG5cbi8qKiBSZWplY3QgYWJzb2x1dGUgZGVhZGxpbmVzIHRoYXQgZW5kIGJlZm9yZSB0aGUgZ29hbCBzdGFydHMuICovXG5leHBvcnQgZnVuY3Rpb24gYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0KFxuICBzdGFydHNBdDogRGF0ZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0IHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IHZvaWQge1xuICBpZiAoIWRlYWRsaW5lIHx8IGRlYWRsaW5lLmtpbmQgIT09ICdhYnNvbHV0ZScgfHwgIWRlYWRsaW5lLmRhdGUpIHJldHVyblxuICBjb25zdCBkZWFkbGluZUF0ID0gbmV3IERhdGUoZGVhZGxpbmUuZGF0ZSArICdUMjM6NTk6NTkuOTk5WicpXG4gIGlmIChkZWFkbGluZUF0IDwgc3RhcnRzQXQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUgbXVzdCBiZSBvbiBvciBhZnRlciB0aGUgZ29hbCBzdGFydCcpXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ3JlYXRlR29hbElucHV0KFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKSB7XG4gIGNvbnN0IHRpdGxlID0gdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpXG4gIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHb2FsQ29sb3IoaW5wdXQuY29sb3IpXG4gIGNvbnN0IHJ1bGVUeXBlID0gdmFsaWRhdGVSdWxlVHlwZShpbnB1dC5ydWxlVHlwZSlcbiAgY29uc3QgdGFyZ2V0VmFsdWUgPSB2YWxpZGF0ZVRhcmdldFZhbHVlKGlucHV0LnRhcmdldFZhbHVlKVxuICBpZiAoaW5wdXQubWV0cmljICE9PSAnY291bnQnICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2R1cmF0aW9uJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdtZXRyaWMgbXVzdCBiZSBjb3VudCBvciBkdXJhdGlvbicpXG4gIH1cbiAgY29uc3QgbGlua3MgPSB2YWxpZGF0ZUdvYWxMaW5rcyhpbnB1dC5saW5rcywgcnVsZVR5cGUpXG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhpbnB1dC5kZXBlbmRlbmNpZXMsIHJ1bGVUeXBlKVxuICBjb25zdCByZWN1cnJlbmNlID0gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShpbnB1dC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHZhbGlkYXRlR29hbERlYWRsaW5lKGlucHV0LmRlYWRsaW5lKVxuICBjb25zdCBzdGFydHNBdCA9IHZhbGlkYXRlU3RhcnRzQXQoaW5wdXQuc3RhcnRzQXQsIG5vdykgPz8gbm93XG4gIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgaWYgKGlucHV0LmNvbmZpZz8uYmVmb3JlVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5iZWZvcmVUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdiZWZvcmVUaW1lIG11c3QgYmUgSEg6bW0nKVxuICB9XG4gIGlmIChpbnB1dC5jb25maWc/LmFmdGVyVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5hZnRlclRpbWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FmdGVyVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdGl0bGUsXG4gICAgY29sb3IsXG4gICAgcnVsZVR5cGUsXG4gICAgdGFyZ2V0VmFsdWUsXG4gICAgbGlua3MsXG4gICAgZGVwZW5kZW5jaWVzLFxuICAgIHJlY3VycmVuY2UsXG4gICAgZGVhZGxpbmUsXG4gICAgc3RhcnRzQXQsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVXBkYXRlR29hbElucHV0KFxuICBpbnB1dDogVXBkYXRlR29hbElucHV0LFxuICBleGlzdGluZ1J1bGVUeXBlOiBzdHJpbmcsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pIHtcbiAgY29uc3QgcnVsZVR5cGUgPSBpbnB1dC5ydWxlVHlwZSAhPSBudWxsXG4gICAgPyB2YWxpZGF0ZVJ1bGVUeXBlKGlucHV0LnJ1bGVUeXBlKVxuICAgIDogZXhpc3RpbmdSdWxlVHlwZVxuXG4gIGlmIChpbnB1dC50aXRsZSAhPSBudWxsKSB2YWxpZGF0ZUdvYWxUaXRsZShpbnB1dC50aXRsZSlcbiAgaWYgKGlucHV0LmNvbG9yICE9IG51bGwpIHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKVxuICBpZiAoaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbCkgdmFsaWRhdGVUYXJnZXRWYWx1ZShpbnB1dC50YXJnZXRWYWx1ZSlcbiAgaWYgKGlucHV0Lm1ldHJpYyAhPSBudWxsICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2NvdW50JyAmJiBpbnB1dC5tZXRyaWMgIT09ICdkdXJhdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbWV0cmljIG11c3QgYmUgY291bnQgb3IgZHVyYXRpb24nKVxuICB9XG4gIGlmIChpbnB1dC5zdGF0dXMgIT0gbnVsbCkge1xuICAgIGNvbnN0IGFsbG93ZWQgPSBbJ2FjdGl2ZScsICdwYXVzZWQnLCAnY29tcGxldGVkJywgJ2FyY2hpdmVkJywgJ2ZhaWxlZCddXG4gICAgaWYgKCFhbGxvd2VkLmluY2x1ZGVzKGlucHV0LnN0YXR1cykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKGBpbnZhbGlkIHN0YXR1czogJHtpbnB1dC5zdGF0dXN9YClcbiAgICB9XG4gIH1cblxuICBjb25zdCBsaW5rcyA9IGlucHV0LmxpbmtzICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbExpbmtzKGlucHV0LmxpbmtzLCBydWxlVHlwZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBkZXBlbmRlbmNpZXMgPSBpbnB1dC5kZXBlbmRlbmNpZXMgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKGlucHV0LmRlcGVuZGVuY2llcywgcnVsZVR5cGUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgcmVjdXJyZW5jZSA9IGlucHV0LnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShpbnB1dC5yZWN1cnJlbmNlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IGRlYWRsaW5lID0gaW5wdXQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsRGVhZGxpbmUoaW5wdXQuZGVhZGxpbmUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3Qgc3RhcnRzQXQgPSBpbnB1dC5zdGFydHNBdCAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZVN0YXJ0c0F0KGlucHV0LnN0YXJ0c0F0LCBub3cpXG4gICAgOiB1bmRlZmluZWRcblxuICByZXR1cm4geyBydWxlVHlwZSwgbGlua3MsIGRlcGVuZGVuY2llcywgcmVjdXJyZW5jZSwgZGVhZGxpbmUsIHN0YXJ0c0F0IH1cbn1cblxuLyoqXG4gKiBEZXRlY3RzIHdoZXRoZXIgYWRkaW5nIGVkZ2VzIHdvdWxkIGNyZWF0ZSBhIGN5Y2xlIGluIHRoZSBkZXBlbmRlbmN5IERBRy5cbiAqIGBlZGdlc2AgaXMgdGhlIGZ1bGwgYWRqYWNlbmN5IGxpc3QgYWZ0ZXIgdGhlIHByb3Bvc2VkIGNoYW5nZSAoZ29hbElkIC0+IGRlcHMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUoXG4gIGVkZ2VzOiBNYXA8bnVtYmVyLCBudW1iZXJbXT4sXG4gIHN0YXJ0SWQ6IG51bWJlcixcbik6IGJvb2xlYW4ge1xuICBjb25zdCB2aXNpdGluZyA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gIGNvbnN0IHZpc2l0ZWQgPSBuZXcgU2V0PG51bWJlcj4oKVxuXG4gIGZ1bmN0aW9uIGRmcyhub2RlOiBudW1iZXIpOiBib29sZWFuIHtcbiAgICBpZiAodmlzaXRpbmcuaGFzKG5vZGUpKSByZXR1cm4gdHJ1ZVxuICAgIGlmICh2aXNpdGVkLmhhcyhub2RlKSkgcmV0dXJuIGZhbHNlXG4gICAgdmlzaXRpbmcuYWRkKG5vZGUpXG4gICAgZm9yIChjb25zdCBuZXh0IG9mIGVkZ2VzLmdldChub2RlKSA/PyBbXSkge1xuICAgICAgaWYgKGRmcyhuZXh0KSkgcmV0dXJuIHRydWVcbiAgICB9XG4gICAgdmlzaXRpbmcuZGVsZXRlKG5vZGUpXG4gICAgdmlzaXRlZC5hZGQobm9kZSlcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiBkZnMoc3RhcnRJZClcbn1cbiIsICJpbXBvcnQgeyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIH0gZnJvbSAnLi92YWxpZGF0aW9uLnRzJ1xuXG4vKiogTWludXRlcyBiZWZvcmUgYWN0aXZpdHkgc3RhcnQ7IDAgPSBhdCBzdGFydC4gTWF4IGxvb2tiYWNrID0gNyBkYXlzLiAqL1xuZXhwb3J0IGNvbnN0IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVMgPSAxMDA4MFxuZXhwb3J0IGNvbnN0IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUUyA9IDhcblxuLyoqXG4gKiBOb3JtYWxpemVzIHJlbWluZGVyIG9mZnNldHM6IGNvZXJjZSB0byBpbnRzLCByZWplY3Qgb3V0LW9mLXJhbmdlLFxuICogZGVkdXBlLCBzb3J0IGFzY2VuZGluZy4gRW1wdHkvbnVsbCBcdTIxOTIgW10uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVOb3RpZmljYXRpb25PZmZzZXRzKFxuICBvZmZzZXRzOiBudW1iZXJbXSB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBudW1iZXJbXSB7XG4gIGlmIChvZmZzZXRzID09IG51bGwpIHJldHVybiBbXVxuXG4gIGlmIChvZmZzZXRzLmxlbmd0aCA+IE1BWF9OT1RJRklDQVRJT05fT0ZGU0VUUykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgYG5vdGlmaWNhdGlvbk9mZnNldHMgbXVzdCBoYXZlIGF0IG1vc3QgJHtNQVhfTk9USUZJQ0FUSU9OX09GRlNFVFN9IHZhbHVlc2AsXG4gICAgKVxuICB9XG5cbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gIGNvbnN0IHJlc3VsdDogbnVtYmVyW10gPSBbXVxuXG4gIGZvciAoY29uc3QgcmF3IG9mIG9mZnNldHMpIHtcbiAgICBpZiAodHlwZW9mIHJhdyAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShyYXcpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhdykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICAnbm90aWZpY2F0aW9uT2Zmc2V0cyBtdXN0IGJlIGludGVnZXJzJyxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHJhdyA8IDAgfHwgcmF3ID4gTUFYX05PVElGSUNBVElPTl9PRkZTRVRfTUlOVVRFUykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgIGBub3RpZmljYXRpb25PZmZzZXRzIG11c3QgYmUgYmV0d2VlbiAwIGFuZCAke01BWF9OT1RJRklDQVRJT05fT0ZGU0VUX01JTlVURVN9YCxcbiAgICAgIClcbiAgICB9XG4gICAgaWYgKHNlZW4uaGFzKHJhdykpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQocmF3KVxuICAgIHJlc3VsdC5wdXNoKHJhdylcbiAgfVxuXG4gIHJlc3VsdC5zb3J0KChhLCBiKSA9PiBhIC0gYilcbiAgcmV0dXJuIHJlc3VsdFxufVxuIiwgIi8qKiBQb3N0Z3JlcyBgbnVtZXJpY2AgYXJyaXZlcyBhcyBzdHJpbmcgdmlhIGBwZ2A7IEdyYXBoUUwgTnVtYmVyIHJlcXVpcmVzIEpTIG51bWJlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlcih2YWx1ZTogdW5rbm93biwgZmFsbGJhY2sgPSAwKTogbnVtYmVyIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxsYmFja1xuICBjb25zdCBuID0gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyA/IHZhbHVlIDogTnVtYmVyKHZhbHVlKVxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IGZhbGxiYWNrXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlck9yTnVsbCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgbiA9IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBudWxsXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwgYXMgR29hbFJvdyxcbiAgR29hbENvbmZpZyxcbiAgR29hbEN5Y2xlIGFzIEdvYWxDeWNsZVJvdyxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsRGVwZW5kZW5jeSBhcyBHb2FsRGVwZW5kZW5jeVJvdyxcbiAgR29hbExpbmsgYXMgR29hbExpbmtSb3csXG4gIEdvYWxQcm9ncmVzc1NuYXBzaG90IGFzIEdvYWxTbmFwc2hvdFJvdyxcbiAgR29hbFJlY3VycmVuY2VDb25maWcsXG4gIE5ld0dvYWwsXG4gIE5ld0dvYWxEZXBlbmRlbmN5LFxuICBOZXdHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlSW5pdGlhbEN5Y2xlLCBkZWFkbGluZVN0YXRlLCBsaWZlY3ljbGVQaGFzZSwgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlLCByb2xsT3ZlcklmTmVlZGVkLCByb2xsT3ZlclVzZXJHb2FscyB9IGZyb20gJy4uLy4uL2dvYWxzL2N5Y2xlcy50cydcbmltcG9ydCB7IGJ1aWxkR29hbE51ZGdlcyB9IGZyb20gJy4uLy4uL2dvYWxzL251ZGdlcy50cydcbmltcG9ydCB7IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcywgcmVjb21wdXRlQ3ljbGUgfSBmcm9tICcuLi8uLi9nb2Fscy9wcm9ncmVzcy50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0LFxuICBJbnZhbGlkR29hbEVycm9yLFxuICB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dCxcbiAgdmFsaWRhdGVHb2FsQ29sb3IsXG4gIHZhbGlkYXRlR29hbFRpdGxlLFxuICB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dCxcbiAgd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5pbXBvcnQgeyBhc051bWJlciwgYXNOdW1iZXJPck51bGwgfSBmcm9tICcuLi9udW1lcmljLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgVFxufVxuXG4vKiogUG9zdGdyZXMgYG51bWVyaWNgIGFycml2ZXMgYXMgc3RyaW5nIHZpYSBgcGdgOyBHcmFwaFFMIE51bWJlciByZXF1aXJlcyBKUyBudW1iZXIuICovXG5mdW5jdGlvbiBtYXBDeWNsZVNjYWxhcnM8VCBleHRlbmRzIEdvYWxDeWNsZVJvdz4oY3ljbGU6IFQpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5jeWNsZSxcbiAgICB0YXJnZXRfdmFsdWU6IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSksXG4gICAgY3VycmVudF92YWx1ZTogYXNOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgY2Fycnlfb3ZlcjogYXNOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwTGlua1NjYWxhcnMobGluazogR29hbExpbmtSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5saW5rLFxuICAgIHdlaWdodDogYXNOdW1iZXIobGluay53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcDogR29hbERlcGVuZGVuY3lSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5kZXAsXG4gICAgdGhyZXNob2xkOiBhc051bWJlck9yTnVsbChkZXAudGhyZXNob2xkKSxcbiAgICB3ZWlnaHQ6IGFzTnVtYmVyKGRlcC53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFNuYXBzaG90U2NhbGFycyhzbmFwc2hvdDogR29hbFNuYXBzaG90Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uc25hcHNob3QsXG4gICAgdmFsdWU6IGFzTnVtYmVyKHNuYXBzaG90LnZhbHVlKSxcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1JlY3VycmVuY2VKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydyZWN1cnJlbmNlJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ3JlY3VycmVuY2UnXSxcbik6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIHBlcmlvZDogaW5wdXQucGVyaW9kLFxuICAgIGludGVydmFsOiBpbnB1dC5pbnRlcnZhbCxcbiAgICBhbmNob3I6IGlucHV0LmFuY2hvcixcbiAgICBjYXJyeV9vdmVyOiBpbnB1dC5jYXJyeU92ZXIsXG4gICAgcmVzZXQ6IGlucHV0LnJlc2V0LFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvRGVhZGxpbmVKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydkZWFkbGluZSddIHwgVXBkYXRlR29hbElucHV0WydkZWFkbGluZSddLFxuKTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBpbnB1dC5kYXlzQWZ0ZXJDeWNsZVN0YXJ0LFxuICAgIGdyYWNlX2RheXM6IGlucHV0LmdyYWNlRGF5cyxcbiAgICB3YXJuX2RheXM6IGlucHV0Lndhcm5EYXlzLFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvQ29uZmlnSnNvbihcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dFsnY29uZmlnJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ2NvbmZpZyddLFxuKTogR29hbENvbmZpZyB7XG4gIGlmICghaW5wdXQpIHJldHVybiB7fVxuICByZXR1cm4ge1xuICAgIGNvbXBvc2l0ZV9tb2RlOiBpbnB1dC5jb21wb3NpdGVNb2RlLFxuICAgIGNvdW50X3JlcXVpcmVkOiBpbnB1dC5jb3VudFJlcXVpcmVkLFxuICAgIGJlZm9yZV90aW1lOiBpbnB1dC5iZWZvcmVUaW1lLFxuICAgIGFmdGVyX3RpbWU6IGlucHV0LmFmdGVyVGltZSxcbiAgICBibG9ja191bnRpbF91bmxvY2tlZDogaW5wdXQuYmxvY2tVbnRpbFVubG9ja2VkLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkQWN0aXZpdGllcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBhY3Rpdml0eUlkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGFjdGl2aXR5SWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdpZCcsICdpbicsIGFjdGl2aXR5SWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gYWN0aXZpdHlJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGFjdGl2aXRpZXMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEdyb3VwcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBncm91cElkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGdyb3VwSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ3JvdXBzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ3JvdXBJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBncm91cElkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgZ3JvdXBzIG5vdCBmb3VuZCcpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRHb2FscyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBnb2FsSWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoZ29hbElkcy5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCByb3dzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ29hbElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGdvYWxJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGRlcGVuZGVuY3kgZ29hbHMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXBsYWNlTGlua3MoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGxpbmtzOiBHb2FsTGlua0lucHV0W10sXG4pIHtcbiAgYXdhaXQgdHJ4LmRlbGV0ZUZyb20oJ2dvYWxfbGlua3MnKS53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKS5leGVjdXRlKClcbiAgY29uc3QgYWN0aXZpdHlJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eUlkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eUlkISlcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cElkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5ncm91cElkISlcbiAgYXdhaXQgYXNzZXJ0T3duZWRBY3Rpdml0aWVzKHRyeCwgdXNlcklkLCBhY3Rpdml0eUlkcylcbiAgYXdhaXQgYXNzZXJ0T3duZWRHcm91cHModHJ4LCB1c2VySWQsIGdyb3VwSWRzKVxuXG4gIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xuICAgIGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ2dvYWxfbGlua3MnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgbGlua190eXBlOiBsaW5rLmxpbmtUeXBlLFxuICAgICAgICBhY3Rpdml0eV9pZDogbGluay5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5JyA/IGxpbmsuYWN0aXZpdHlJZCA/PyBudWxsIDogbnVsbCxcbiAgICAgICAgZ3JvdXBfaWQ6IGxpbmsubGlua1R5cGUgPT09ICdncm91cCcgPyBsaW5rLmdyb3VwSWQgPz8gbnVsbCA6IG51bGwsXG4gICAgICAgIHdlaWdodDogbGluay53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbExpbmspXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVwbGFjZURlcGVuZGVuY2llcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbiAgZGVwczogR29hbERlcGVuZGVuY3lJbnB1dFtdLFxuKSB7XG4gIGNvbnN0IGRlcElkcyA9IGRlcHMubWFwKChkKSA9PiBkLmRlcGVuZHNPbkdvYWxJZClcbiAgaWYgKGRlcElkcy5pbmNsdWRlcyhnb2FsSWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2EgZ29hbCBjYW5ub3QgZGVwZW5kIG9uIGl0c2VsZicpXG4gIH1cbiAgYXdhaXQgYXNzZXJ0T3duZWRHb2Fscyh0cngsIHVzZXJJZCwgZGVwSWRzKVxuXG4gIC8vIEJ1aWxkIGFkamFjZW5jeSBmcm9tIGFsbCBleGlzdGluZyBkZXBzIGZvciB0aGlzIHVzZXIsIHJlcGxhY2luZyB0aGlzIGdvYWwncyBlZGdlcy5cbiAgY29uc3QgYWxsR29hbHMgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJylcbiAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0KFtcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJyxcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5kZXBlbmRzX29uX2dvYWxfaWQnLFxuICAgIF0pXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IGVkZ2VzID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcltdPigpXG4gIGZvciAoY29uc3QgZyBvZiBhbGxHb2FscykgZWRnZXMuc2V0KGcuaWQsIFtdKVxuICBmb3IgKGNvbnN0IGUgb2YgZXhpc3RpbmcpIHtcbiAgICBpZiAoZS5nb2FsX2lkID09PSBnb2FsSWQpIGNvbnRpbnVlXG4gICAgZWRnZXMuZ2V0KGUuZ29hbF9pZCk/LnB1c2goZS5kZXBlbmRzX29uX2dvYWxfaWQpXG4gIH1cbiAgZWRnZXMuc2V0KGdvYWxJZCwgZGVwSWRzKVxuXG4gIGlmICh3b3VsZENyZWF0ZURlcGVuZGVuY3lDeWNsZShlZGdlcywgZ29hbElkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZXBlbmRlbmN5IGN5Y2xlIGRldGVjdGVkJylcbiAgfVxuXG4gIGF3YWl0IHRyeC5kZWxldGVGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpLmV4ZWN1dGUoKVxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgZGVwZW5kc19vbl9nb2FsX2lkOiBkZXAuZGVwZW5kc09uR29hbElkLFxuICAgICAgICByZXF1aXJlbWVudDogZGVwLnJlcXVpcmVtZW50ID8/ICdjb21wbGV0ZScsXG4gICAgICAgIHRocmVzaG9sZDogZGVwLnRocmVzaG9sZCA/PyBudWxsLFxuICAgICAgICB3ZWlnaHQ6IGRlcC53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbERlcGVuZGVuY3kpXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZGVwZW5kZW5jaWVzTWV0KFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChkZXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWVcblxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgY29uc3QgY2hpbGRHb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWNoaWxkR29hbCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoZGVwLnJlcXVpcmVtZW50ID09PSAnY29tcGxldGUnKSB7XG4gICAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgICBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDAgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoXG4gICAgICAgIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgY2hpbGRHb2FsLnN0YXR1cyAhPT0gJ2NvbXBsZXRlZCcgJiZcbiAgICAgICAgIXRhcmdldE1ldFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB0aHJlc2hvbGQgPSBkZXAudGhyZXNob2xkID8/IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpIDwgTnVtYmVyKHRocmVzaG9sZCkpIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsOiBHb2FsUm93KSB7XG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlSnNvbjxHb2FsQ29uZmlnPihnb2FsLmNvbmZpZykgPz8ge31cbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcblxuICByZXR1cm4ge1xuICAgIC4uLmdvYWwsXG4gICAgdGFyZ2V0X3ZhbHVlOiBhc051bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgc3RhcnRzQXQ6IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KS50b0lTT1N0cmluZygpLFxuICAgIGxpZmVjeWNsZVBoYXNlOiBsaWZlY3ljbGVQaGFzZShnb2FsLCBub3cpLFxuICAgIGNvbmZpZyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIGxpbmtzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAoKGxpbmspID0+ICh7XG4gICAgICAgIC4uLm1hcExpbmtTY2FsYXJzKGxpbmspLFxuICAgICAgICBhY3Rpdml0eTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChsaW5rLmFjdGl2aXR5X2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmFjdGl2aXR5X2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgZ3JvdXA6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAobGluay5ncm91cF9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dyb3VwcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmdyb3VwX2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0sXG4gICAgYWN0aXZlQ3ljbGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGxldCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoY3ljbGUgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgIGN5Y2xlID0gYXdhaXQgcm9sbE92ZXJJZk5lZWRlZChkYiwgZ29hbCwgY3ljbGUpXG4gICAgICB9XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbGF0ZXN0IGN5Y2xlIHNvIGNvbXBsZXRlZCAvIG1pZC13aW5kb3cgc3VjY2VlZGVkIGN5Y2xlc1xuICAgICAgLy8gc3RpbGwgZXhwb3NlIHByb2dyZXNzLiBBbHNvIHJlcGFpciByZWN1cnJpbmcgY3ljbGVzIHRoYXQgd2VyZSBjbG9zZWRcbiAgICAgIC8vIGVhcmx5IChiZWZvcmUgZW5kc19hdCkgc28gdGhleSByZW1haW4gdGhlIGFjdGl2ZSB3aW5kb3cuXG4gICAgICBpZiAoIWN5Y2xlKSB7XG4gICAgICAgIGNvbnN0IGxhdGVzdCA9IGF3YWl0IGRiXG4gICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGxhdGVzdCAmJlxuICAgICAgICAgIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgICAgICAgIGdvYWwucmVjdXJyZW5jZSAhPSBudWxsICYmXG4gICAgICAgICAgbGF0ZXN0LnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgICAoIWxhdGVzdC5lbmRzX2F0IHx8IG5vdyA8IG5ldyBEYXRlKGxhdGVzdC5lbmRzX2F0KSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWN0aXZlJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxhdGVzdC5pZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjeWNsZSA9IGxhdGVzdFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWN5Y2xlKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ubWFwQ3ljbGVTY2FsYXJzKGN5Y2xlKSxcbiAgICAgICAgZGVhZGxpbmVTdGF0ZTogc3RhdGUsXG4gICAgICAgIHBlcmNlbnRDb21wbGV0ZTogdGFyZ2V0ID4gMCA/IE1hdGgubWluKDEsIGN1cnJlbnQgLyB0YXJnZXQpIDogMCxcbiAgICAgICAgcmVtYWluaW5nOiBNYXRoLm1heCgwLCB0YXJnZXQgLSBjdXJyZW50KSxcbiAgICAgIH1cbiAgICB9LFxuICAgIGN5Y2xlczogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2FzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAobWFwQ3ljbGVTY2FsYXJzKVxuICAgIH0sXG4gICAgZGVwZW5kZW5jaWVzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKChkZXApID0+ICh7XG4gICAgICAgIC4uLm1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcCksXG4gICAgICAgIGRlcGVuZHNPbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgICByZXR1cm4gZyA/IHdpdGhHb2FsUmVsYXRpb25zKGcpIDogbnVsbFxuICAgICAgICB9LFxuICAgICAgfSkpXG4gICAgfSxcbiAgICBzbmFwc2hvdHM6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghY3ljbGUpIHJldHVybiBbXVxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX3Byb2dyZXNzX3NuYXBzaG90cycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9jeWNsZV9pZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5vcmRlckJ5KCdhc19vZicsICdhc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKG1hcFNuYXBzaG90U2NhbGFycylcbiAgICB9LFxuICAgIGlzTG9ja2VkOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWNvbmZpZy5ibG9ja191bnRpbF91bmxvY2tlZCkgcmV0dXJuIGZhbHNlXG4gICAgICByZXR1cm4gIShhd2FpdCBkZXBlbmRlbmNpZXNNZXQoZ29hbC5pZCwgZ29hbC51c2VyX2lkKSlcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBHb2FsUXVlcnkgPSB7XG4gIGdvYWxzOiBhc3luYyAoYXJncz86IHsgc3RhdHVzPzogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdwcmlvcml0eScsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdzb3J0X29yZGVyJywgJ2FzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5zdGF0dXMpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3N0YXR1cycsICc9JywgYXJncy5zdGF0dXMgYXMgR29hbFJvd1snc3RhdHVzJ10pXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoR29hbFJlbGF0aW9ucylcbiAgfSxcblxuICBnb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIHJvdyA/IHdpdGhHb2FsUmVsYXRpb25zKHJvdykgOiBudWxsXG4gIH0sXG5cbiAgZ29hbE51ZGdlczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3NcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcGFpcnMgPSBbXVxuICAgIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcGFpcnMucHVzaCh7IGdvYWwsIGN5Y2xlOiBjeWNsZSA/PyBudWxsIH0pXG4gICAgfVxuICAgIHJldHVybiBidWlsZEdvYWxOdWRnZXMocGFpcnMpXG4gIH0sXG5cbiAgZGFpbHlQcm9ncmVzczogYXN5bmMgKGFyZ3M/OiB7IGRhdGU/OiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGRhdGUgPSBhcmdzPy5kYXRlID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcblxuICAgIGNvbnN0IGNvbXBsZXRpb25zID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0eV9jb21wbGV0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnb2NjdXJyZW5jZV9kYXRlJywgJz0nLCBkYXRlKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCB0aW1lRXZlbnRzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2V2ZW50cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnbWV0cmljJywgJz0nLCAnZHVyYXRpb24nKVxuICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRhdGUpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IG1pbnV0ZXNUb2RheSA9IHRpbWVFdmVudHMucmVkdWNlKFxuICAgICAgKHN1bSwgZSkgPT4gc3VtICsgTnVtYmVyKGUuYW1vdW50KSxcbiAgICAgIDAsXG4gICAgKVxuXG4gICAgLy8gU3RyZWFrOiBjb25zZWN1dGl2ZSBkYXlzIGVuZGluZyB0b2RheSB3aXRoID49IDEgY29tcGxldGlvbi5cbiAgICBsZXQgc3RyZWFrID0gMFxuICAgIGNvbnN0IGN1cnNvciA9IG5ldyBEYXRlKGRhdGUgKyAnVDAwOjAwOjAwWicpXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAzNjU7IGkrKykge1xuICAgICAgY29uc3QgZGF5ID0gY3Vyc29yLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdHlfY29tcGxldGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRheSlcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIXJvdykgYnJlYWtcbiAgICAgIHN0cmVhaysrXG4gICAgICBjdXJzb3Iuc2V0VVRDRGF0ZShjdXJzb3IuZ2V0VVRDRGF0ZSgpIC0gMSlcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGNvbXBsZXRlZENvdW50OiBjb21wbGV0aW9ucy5sZW5ndGgsXG4gICAgICBtaW51dGVzVG9kYXksXG4gICAgICBzdHJlYWtEYXlzOiBzdHJlYWssXG4gICAgICBjb21wbGV0aW9ucyxcbiAgICB9XG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBHb2FsTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChpbnB1dCwgbm93KVxuXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBjcmVhdGVkID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKCdnb2FscycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogdmFsaWRhdGVkLnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICAgIGNvbG9yOiB2YWxpZGF0ZWQuY29sb3IsXG4gICAgICAgICAgaWNvbjogaW5wdXQuaWNvbiA/PyBudWxsLFxuICAgICAgICAgIHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlLFxuICAgICAgICAgIG1ldHJpYzogaW5wdXQubWV0cmljLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogdmFsaWRhdGVkLnRhcmdldFZhbHVlLFxuICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkodG9Db25maWdKc29uKGlucHV0LmNvbmZpZykpLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgcmVjdXJyZW5jZTogdmFsaWRhdGVkLnJlY3VycmVuY2VcbiAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b0RlYWRsaW5lSnNvbih2YWxpZGF0ZWQuZGVhZGxpbmUpKVxuICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgIHByaW9yaXR5OiBpbnB1dC5wcmlvcml0eSA/PyAwLFxuICAgICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICAgIHN0YXJ0c19hdDogdmFsaWRhdGVkLnN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0gYXMgTmV3R29hbClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICAgIGF3YWl0IHJlcGxhY2VMaW5rcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmxpbmtzKVxuICAgICAgYXdhaXQgcmVwbGFjZURlcGVuZGVuY2llcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmRlcGVuZGVuY2llcylcbiAgICAgIGF3YWl0IGNyZWF0ZUluaXRpYWxDeWNsZSh0cngsIGNyZWF0ZWQsIG5vdylcbiAgICAgIHJldHVybiBjcmVhdGVkXG4gICAgfSlcblxuICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKFxuICAgICAgZGIsXG4gICAgICBnb2FsLFxuICAgICAgKGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpKSxcbiAgICAgIG5vdyxcbiAgICApXG5cbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoXG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCksXG4gICAgKVxuICB9LFxuXG4gIHVwZGF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBjb25zdCBub3dEYXRlID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlVXBkYXRlR29hbElucHV0KFxuICAgICAgYXJncy5pbnB1dCxcbiAgICAgIGV4aXN0aW5nLnJ1bGVfdHlwZSxcbiAgICAgIG5vd0RhdGUsXG4gICAgKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5vd0RhdGUudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgYWN0aXZlQ3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZXhpc3RpbmcuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGxldCBuZXh0U3RhcnRzQXQ6IERhdGUgfCB1bmRlZmluZWRcbiAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChleGlzdGluZy5zdGF0dXMgPT09ICdjb21wbGV0ZWQnIHx8IGV4aXN0aW5nLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICAgJ2Nhbm5vdCBjaGFuZ2Ugc3RhcnRzQXQgb24gYSBjb21wbGV0ZWQgb3IgZmFpbGVkIGdvYWwnLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3N0YXJ0c0F0IGNhbm5vdCBiZSBjbGVhcmVkOyBvbWl0IHRvIGxlYXZlIHVuY2hhbmdlZCcpXG4gICAgICB9XG4gICAgICBuZXh0U3RhcnRzQXQgPSB2YWxpZGF0ZWQuc3RhcnRzQXRcblxuICAgICAgY29uc3QgY2xvc2VkQ3ljbGVzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnIT0nLCAnYWN0aXZlJylcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIC8vIEFmdGVyIGN5Y2xlIDAgaGFzIGNsb3NlZCwgc3RhcnQgaXMgZnJvemVuLlxuICAgICAgaWYgKGNsb3NlZEN5Y2xlcyAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICdjYW5ub3QgY2hhbmdlIHN0YXJ0c0F0IGFmdGVyIHRoZSBmaXJzdCBjeWNsZSBoYXMgY2xvc2VkJyxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm9ncmVzc0JlZ3VuID1cbiAgICAgICAgYWN0aXZlQ3ljbGUgIT0gbnVsbCAmJiBOdW1iZXIoYWN0aXZlQ3ljbGUuY3VycmVudF92YWx1ZSkgPiAwXG5cbiAgICAgIGlmIChcbiAgICAgICAgcHJvZ3Jlc3NCZWd1biAmJlxuICAgICAgICBuZXh0U3RhcnRzQXQuZ2V0VGltZSgpID4gbmV3IERhdGUoZXhpc3Rpbmcuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgICAgICkge1xuICAgICAgICBpZiAoIWlucHV0LmNvbmZpcm1TdGFydHNBdENoYW5nZSkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICAgJ21vdmluZyBzdGFydHNBdCBsYXRlciBhZnRlciBwcm9ncmVzcyByZXF1aXJlcyBjb25maXJtU3RhcnRzQXRDaGFuZ2UnLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGVmZmVjdGl2ZVN0YXJ0c0F0ID0gbmV4dFN0YXJ0c0F0ID8/IG5ldyBEYXRlKGV4aXN0aW5nLnN0YXJ0c19hdClcbiAgICBjb25zdCBlZmZlY3RpdmVEZWFkbGluZSA9IHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgOiAoKCkgPT4ge1xuICAgICAgICBjb25zdCBkID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZXhpc3RpbmcuZGVhZGxpbmUpXG4gICAgICAgIGlmICghZCkgcmV0dXJuIG51bGxcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiBkLmtpbmQsXG4gICAgICAgICAgZGF0ZTogZC5kYXRlLFxuICAgICAgICAgIGRheXNBZnRlckN5Y2xlU3RhcnQ6IGQuZGF5c19hZnRlcl9jeWNsZV9zdGFydCxcbiAgICAgICAgICBncmFjZURheXM6IGQuZ3JhY2VfZGF5cyxcbiAgICAgICAgICB3YXJuRGF5czogZC53YXJuX2RheXMsXG4gICAgICAgIH1cbiAgICAgIH0pKClcbiAgICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoZWZmZWN0aXZlU3RhcnRzQXQsIGVmZmVjdGl2ZURlYWRsaW5lKVxuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgLi4uKGlucHV0LnRpdGxlICE9IG51bGxcbiAgICAgICAgICAgID8geyB0aXRsZTogdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5kZXNjcmlwdGlvbiAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5jb2xvciAhPSBudWxsXG4gICAgICAgICAgICA/IHsgY29sb3I6IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuaWNvbiAhPT0gdW5kZWZpbmVkID8geyBpY29uOiBpbnB1dC5pY29uIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnJ1bGVUeXBlICE9IG51bGwgPyB7IHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0Lm1ldHJpYyAhPSBudWxsID8geyBtZXRyaWM6IGlucHV0Lm1ldHJpYyB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsXG4gICAgICAgICAgICA/IHsgdGFyZ2V0X3ZhbHVlOiBpbnB1dC50YXJnZXRWYWx1ZSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuY29uZmlnICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBjb25maWc6IEpTT04uc3RyaW5naWZ5KHRvQ29uZmlnSnNvbihpbnB1dC5jb25maWcpKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc3RhdHVzICE9IG51bGwgPyB7IHN0YXR1czogaW5wdXQuc3RhdHVzIH0gOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICByZWN1cnJlbmNlOiB2YWxpZGF0ZWQucmVjdXJyZW5jZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9EZWFkbGluZUpzb24odmFsaWRhdGVkLmRlYWRsaW5lKSlcbiAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4obmV4dFN0YXJ0c0F0ICE9IG51bGxcbiAgICAgICAgICAgID8geyBzdGFydHNfYXQ6IG5leHRTdGFydHNBdC50b0lTT1N0cmluZygpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5wcmlvcml0eSAhPSBudWxsID8geyBwcmlvcml0eTogaW5wdXQucHJpb3JpdHkgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc29ydE9yZGVyICE9IG51bGwgPyB7IHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciB9IDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5leGVjdXRlKClcblxuICAgICAgaWYgKHZhbGlkYXRlZC5saW5rcykge1xuICAgICAgICBhd2FpdCByZXBsYWNlTGlua3ModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5saW5rcylcbiAgICAgIH1cbiAgICAgIGlmICh2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGF3YWl0IHJlcGxhY2VEZXBlbmRlbmNpZXModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5kZXBlbmRlbmNpZXMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGdvYWxBZnRlciA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGN5Y2xlICYmIG5leHRTdGFydHNBdCAhPSBudWxsKSB7XG4gICAgICAgIGF3YWl0IHJlc2NoZWR1bGVBY3RpdmVDeWNsZSh0cngsIGdvYWxBZnRlciwgY3ljbGUsIG5leHRTdGFydHNBdCwgbm93RGF0ZSlcbiAgICAgIH0gZWxzZSBpZiAoY3ljbGUgJiYgaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHRhcmdldF92YWx1ZTogaW5wdXQudGFyZ2V0VmFsdWUsXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSlcbiAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjeWNsZSAmJlxuICAgICAgICAodmFsaWRhdGVkLmRlYWRsaW5lICE9PSB1bmRlZmluZWQgfHwgdmFsaWRhdGVkLnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZCkgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID09PSAwICYmXG4gICAgICAgIGN5Y2xlLmN5Y2xlX2luZGV4ID09PSAwXG4gICAgICApIHtcbiAgICAgICAgLy8gUmVmcmVzaCBib3VuZHMgb24gdW5zdGFydGVkIGN5Y2xlIDAgd2hlbiBkZWFkbGluZS9yZWN1cnJlbmNlIGNoYW5nZS5cbiAgICAgICAgYXdhaXQgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICBnb2FsQWZ0ZXIsXG4gICAgICAgICAgY3ljbGUsXG4gICAgICAgICAgbmV3IERhdGUoZ29hbEFmdGVyLnN0YXJ0c19hdCksXG4gICAgICAgICAgbm93RGF0ZSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoY3ljbGUpIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSwgbm93RGF0ZSlcblxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIHBhdXNlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdwYXVzZWQnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICByZXN1bWVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FjdGl2ZScsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdwYXVzZWQnKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIGFyY2hpdmVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FyY2hpdmVkJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgZGVsZXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwXG4gIH0sXG5cbiAgcmVjb21wdXRlR29hbFByb2dyZXNzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJnc1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzKGRiLCB1c2VySWQpXG4gICAgcmV0dXJuIHsgcmVjb21wdXRlZDogY291bnQgfVxuICB9LFxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsUmVjdXJyZW5jZUNvbmZpZyxcbiAgTmV3R29hbEN5Y2xlLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjeWNsZUhhc1N0YXJ0ZWQgfSBmcm9tICcuL2xpZmVjeWNsZS50cydcbmltcG9ydCB7IHJlY29tcHV0ZUN5Y2xlIH0gZnJvbSAnLi9wcm9ncmVzcy50cydcblxuZXhwb3J0IHtcbiAgY3ljbGVIYXNTdGFydGVkLFxuICBsaWZlY3ljbGVQaGFzZSxcbiAgdHlwZSBHb2FsTGlmZWN5Y2xlUGhhc2UsXG59IGZyb20gJy4vbGlmZWN5Y2xlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBUXG59XG5cbmZ1bmN0aW9uIGFkZERheXMoZGF0ZTogRGF0ZSwgZGF5czogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlKVxuICBkLnNldFVUQ0RhdGUoZC5nZXRVVENEYXRlKCkgKyBkYXlzKVxuICByZXR1cm4gZFxufVxuXG5mdW5jdGlvbiBhZGRNb250aHMoZGF0ZTogRGF0ZSwgbW9udGhzOiBudW1iZXIpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGRhdGUpXG4gIGQuc2V0VVRDTW9udGgoZC5nZXRVVENNb250aCgpICsgbW9udGhzKVxuICByZXR1cm4gZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZUN5Y2xlRW5kKFxuICBzdGFydHNBdDogRGF0ZSxcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoIXJlY3VycmVuY2UpIHJldHVybiBudWxsXG4gIGNvbnN0IGludGVydmFsID0gTWF0aC5tYXgoMSwgcmVjdXJyZW5jZS5pbnRlcnZhbCA/PyAxKVxuICBzd2l0Y2ggKHJlY3VycmVuY2UucGVyaW9kKSB7XG4gICAgY2FzZSAnd2Vla2x5JzpcbiAgICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCA3ICogaW50ZXJ2YWwpXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICByZXR1cm4gYWRkTW9udGhzKHN0YXJ0c0F0LCBpbnRlcnZhbClcbiAgICBjYXNlICdxdWFydGVybHknOlxuICAgICAgcmV0dXJuIGFkZE1vbnRocyhzdGFydHNBdCwgMyAqIGludGVydmFsKVxuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgaW50ZXJ2YWwpXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVEZWFkbGluZUF0KFxuICBzdGFydHNBdDogRGF0ZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4pOiBEYXRlIHwgbnVsbCB7XG4gIGlmICghZGVhZGxpbmUpIHJldHVybiBudWxsXG4gIGlmIChkZWFkbGluZS5raW5kID09PSAnYWJzb2x1dGUnICYmIGRlYWRsaW5lLmRhdGUpIHtcbiAgICByZXR1cm4gbmV3IERhdGUoZGVhZGxpbmUuZGF0ZSArICdUMjM6NTk6NTkuOTk5WicpXG4gIH1cbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScgJiYgZGVhZGxpbmUuZGF5c19hZnRlcl9jeWNsZV9zdGFydCAhPSBudWxsKSB7XG4gICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIGRlYWRsaW5lLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQpXG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cblxuZXhwb3J0IHR5cGUgRGVhZGxpbmVTdGF0ZSA9ICdvbl90cmFjaycgfCAnYXBwcm9hY2hpbmcnIHwgJ292ZXJkdWUnIHwgJ2ZhaWxlZCdcblxuZXhwb3J0IGZ1bmN0aW9uIGRlYWRsaW5lU3RhdGUoXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogRGVhZGxpbmVTdGF0ZSB7XG4gIGlmICghY3ljbGUuZGVhZGxpbmVfYXQpIHJldHVybiAnb25fdHJhY2snXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBuZXcgRGF0ZShjeWNsZS5kZWFkbGluZV9hdClcbiAgY29uc3QgZ3JhY2UgPSBkZWFkbGluZT8uZ3JhY2VfZGF5cyA/PyAwXG4gIGNvbnN0IHdhcm4gPSBkZWFkbGluZT8ud2Fybl9kYXlzID8/IDNcbiAgY29uc3QgZ3JhY2VFbmQgPSBhZGREYXlzKGRlYWRsaW5lQXQsIGdyYWNlKVxuXG4gIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpIHtcbiAgICByZXR1cm4gJ29uX3RyYWNrJ1xuICB9XG4gIGlmIChub3cgPiBncmFjZUVuZCkgcmV0dXJuICdmYWlsZWQnXG4gIGlmIChub3cgPiBkZWFkbGluZUF0KSByZXR1cm4gJ292ZXJkdWUnXG4gIGNvbnN0IHdhcm5TdGFydCA9IGFkZERheXMoZGVhZGxpbmVBdCwgLXdhcm4pXG4gIGlmIChub3cgPj0gd2FyblN0YXJ0KSByZXR1cm4gJ2FwcHJvYWNoaW5nJ1xuICByZXR1cm4gJ29uX3RyYWNrJ1xufVxuXG5mdW5jdGlvbiBkYXRlT25seUlzbyhkYXRlOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVTbmFwc2hvdChcbiAgZGI6IERiTGlrZSxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgYXNPZjogRGF0ZSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhc09mU3RyID0gZGF0ZU9ubHlJc28oYXNPZilcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogY3ljbGUuaWQsXG4gICAgICBhc19vZjogYXNPZlN0cixcbiAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgfSlcbiAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICBvYy5jb2x1bW5zKFsnZ29hbF9jeWNsZV9pZCcsICdhc19vZiddKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgICB9KVxuICAgIClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbi8qKlxuICogQ3JlYXRlIHRoZSBmaXJzdCBjeWNsZSBmb3IgYSBuZXdseSBjcmVhdGVkIGdvYWwuXG4gKiBVc2VzIGdvYWwuc3RhcnRzX2F0IGFzIHRoZSBjeWNsZSB3aW5kb3cgc3RhcnQgKG5vdCB3YWxsLWNsb2NrIG5vdykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVJbml0aWFsQ3ljbGUoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgY29uc3QgZW5kc0F0ID0gY29tcHV0ZUN5Y2xlRW5kKHN0YXJ0c0F0LCByZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZUF0ID0gY29tcHV0ZURlYWRsaW5lQXQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgY3ljbGVfaW5kZXg6IDAsXG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgIGNhcnJ5X292ZXI6IDAsXG4gICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogUmV3cml0ZSBhbiBhY3RpdmUgY3ljbGUncyB3aW5kb3cgZnJvbSBhIG5ldyBzdGFydHNfYXQgKGFuZCBvcHRpb25hbFxuICogdXBkYXRlZCBnb2FsIHJlY3VycmVuY2UvZGVhZGxpbmUvdGFyZ2V0KS4gVXNlZCB3aGVuIGVkaXRpbmcgc3RhcnQgZGF0ZVxuICogYmVmb3JlIHByb2dyZXNzIC8gd2hlbiByZXNjaGVkdWxpbmcgYW4gdW5zdGFydGVkIGN5Y2xlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBzdGFydHNBdDogRGF0ZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBlbmRzQXQgPSBjb21wdXRlQ3ljbGVFbmQoc3RhcnRzQXQsIHJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBjb21wdXRlRGVhZGxpbmVBdChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogQ2xvc2UgYW4gYWN0aXZlIGN5Y2xlIGFuZCBvcGVuIHRoZSBuZXh0IG9uZSB3aGVuIHJlY3VycmVuY2UgYXBwbGllcy5cbiAqIFVzZXMgbGF6eS1vbi1yZWFkOiBjYWxsIGJlZm9yZSByZXR1cm5pbmcgZ29hbHMgdG8gdGhlIGNsaWVudC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvbGxPdmVySWZOZWVkZWQoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICAvLyBEbyBub3Qgcm9sbCBvdmVyLCBtaXNzLWJhY2tmaWxsLCBvciBmYWlsIGRlYWRsaW5lcyBiZWZvcmUgdGhlIGN5Y2xlIHN0YXJ0cy5cbiAgaWYgKCFjeWNsZUhhc1N0YXJ0ZWQoY3ljbGUsIG5vdykpIHtcbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgaWYgKCFyZWN1cnJlbmNlIHx8ICFjeWNsZS5lbmRzX2F0KSB7XG4gICAgLy8gT25lLXRpbWU6IG1heWJlIGZhaWwgb24gZGVhZGxpbmUgZ3JhY2UuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUsIG5vdylcbiAgICBpZiAoY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJiBzdGF0ZSA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdmYWlsZWQnLCB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCB1cGRhdGVkLCBub3cpXG4gICAgICByZXR1cm4gdXBkYXRlZFxuICAgIH1cbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGlmIChjeWNsZS5zdGF0dXMgIT09ICdhY3RpdmUnKSByZXR1cm4gY3ljbGVcbiAgaWYgKG5vdyA8IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpKSByZXR1cm4gY3ljbGVcblxuICAvLyBSZWNvbXB1dGUgb25lIGxhc3QgdGltZSBiZWZvcmUgY2xvc2luZy5cbiAgbGV0IGNsb3NlZCA9IGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSlcbiAgY29uc3QgbWV0ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY2xvc2VkLCBkZWFkbGluZSwgbmV3IERhdGUoY3ljbGUuZW5kc19hdCkpXG5cbiAgbGV0IGNsb3NlU3RhdHVzOiBHb2FsQ3ljbGVbJ3N0YXR1cyddID0gbWV0XG4gICAgPyAnc3VjY2VlZGVkJ1xuICAgIDogc3RhdGUgPT09ICdmYWlsZWQnIHx8IHN0YXRlID09PSAnb3ZlcmR1ZSdcbiAgICA/ICdmYWlsZWQnXG4gICAgOiAnbWlzc2VkJ1xuXG4gIC8vIEJhY2stZmlsbCBtaXNzZWQgaW50ZXJtZWRpYXRlIGN5Y2xlcyBpZiB3ZSBza2lwcGVkIG11bHRpcGxlIHdpbmRvd3MuXG4gIGxldCBjdXJzb3JTdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbiAgbGV0IGN1cnNvckVuZCA9IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpXG4gIGxldCBjeWNsZUluZGV4ID0gY3ljbGUuY3ljbGVfaW5kZXhcbiAgbGV0IGNhcnJ5ID0gMFxuXG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5X292ZXIgPT09ICdvdmVyZmxvdycgJiZcbiAgICBOdW1iZXIoY2xvc2VkLmN1cnJlbnRfdmFsdWUpID4gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gICkge1xuICAgIGNhcnJ5ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSAtIE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICB9XG5cbiAgY2xvc2VkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIHN0YXR1czogY2xvc2VTdGF0dXMsXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNsb3NlZC5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCBjbG9zZWQsIGN1cnNvckVuZClcblxuICAvLyBHcmFudCByZXdhcmRzIHdoZW4gYSByZWN1cnJpbmcgY3ljbGUgY2xvc2VzIGFzIHN1Y2NlZWRlZCAoZWRnZS10cmlnZ2VyKS5cbiAgLy8gT25lLXRpbWUgc3VjY2VzcyBpcyBhbHJlYWR5IGdyYW50ZWQgaW5zaWRlIHJlY29tcHV0ZUN5Y2xlLlxuICBpZiAoY2xvc2VTdGF0dXMgPT09ICdzdWNjZWVkZWQnICYmIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcpIHtcbiAgICBjb25zdCB7IGdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MgfSA9IGF3YWl0IGltcG9ydChcbiAgICAgICcuLi9yZXdhcmRzL2hvb2tzLnRzJ1xuICAgIClcbiAgICBhd2FpdCBncmFudFJld2FyZHNGb3JHb2FsQ3ljbGVTdWNjZXNzKGRiLCB7XG4gICAgICB1c2VySWQ6IGdvYWwudXNlcl9pZCxcbiAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgIGN5Y2xlSWQ6IGNsb3NlZC5pZCxcbiAgICB9KVxuICB9XG5cbiAgLy8gRmlsbCBnYXBzIHVudGlsIHdlIHJlYWNoIGEgY3ljbGUgdGhhdCBjb250YWlucyBgbm93YC5cbiAgd2hpbGUgKGN1cnNvckVuZCA8PSBub3cpIHtcbiAgICBjb25zdCBuZXh0U3RhcnQgPSBjdXJzb3JFbmRcbiAgICBjb25zdCBuZXh0RW5kID0gY29tcHV0ZUN5Y2xlRW5kKG5leHRTdGFydCwgcmVjdXJyZW5jZSlcbiAgICBpZiAoIW5leHRFbmQpIGJyZWFrXG5cbiAgICBjeWNsZUluZGV4ICs9IDFcblxuICAgIC8vIElmIHRoaXMgaW50ZXJtZWRpYXRlIHdpbmRvdyBpcyBhbHJlYWR5IGZ1bGx5IGluIHRoZSBwYXN0LCBtYXJrIG1pc3NlZC5cbiAgICBpZiAobmV4dEVuZCA8PSBub3cpIHtcbiAgICAgIGNvbnN0IG1pc3NlZERlYWRsaW5lID0gY29tcHV0ZURlYWRsaW5lQXQobmV4dFN0YXJ0LCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IG1pc3NlZCA9IGF3YWl0IGRiXG4gICAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIGdvYWxfaWQ6IGdvYWwuaWQsXG4gICAgICAgICAgY3ljbGVfaW5kZXg6IGN5Y2xlSW5kZXgsXG4gICAgICAgICAgc3RhcnRzX2F0OiBuZXh0U3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBlbmRzX2F0OiBuZXh0RW5kLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZGVhZGxpbmVfYXQ6IG1pc3NlZERlYWRsaW5lID8gbWlzc2VkRGVhZGxpbmUudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICAgICAgc3RhdHVzOiAnbWlzc2VkJyxcbiAgICAgICAgICBjYXJyeV9vdmVyOiAwLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCBtaXNzZWQsIG5leHRFbmQpXG4gICAgICBjdXJzb3JTdGFydCA9IG5leHRTdGFydFxuICAgICAgY3Vyc29yRW5kID0gbmV4dEVuZFxuICAgICAgY2FycnkgPSAwXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIC8vIEFjdGl2ZSBuZXh0IGN5Y2xlLlxuICAgIGNvbnN0IG5leHREZWFkbGluZSA9IGNvbXB1dGVEZWFkbGluZUF0KG5leHRTdGFydCwgZGVhZGxpbmUpXG4gICAgY29uc3QgbmV4dCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWwuaWQsXG4gICAgICAgIGN5Y2xlX2luZGV4OiBjeWNsZUluZGV4LFxuICAgICAgICBzdGFydHNfYXQ6IG5leHRTdGFydC50b0lTT1N0cmluZygpLFxuICAgICAgICBlbmRzX2F0OiBuZXh0RW5kLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGRlYWRsaW5lX2F0OiBuZXh0RGVhZGxpbmUgPyBuZXh0RGVhZGxpbmUudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgICAgY3VycmVudF92YWx1ZTogMCxcbiAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgY2Fycnlfb3ZlcjogY2FycnksXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBuZXh0KVxuICB9XG5cbiAgcmV0dXJuIGNsb3NlZFxufVxuXG4vKiogUm9sbCBvdmVyIGFsbCBhY3RpdmUgY3ljbGVzIGZvciBhIHVzZXIgKGxhenkgYmF0Y2gpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvbGxPdmVyVXNlckdvYWxzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3N0YXR1cycsICdpbicsIFsnYWN0aXZlJywgJ3BhdXNlZCddKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKClcblxuICBmb3IgKGNvbnN0IGdvYWwgb2YgZ29hbHMpIHtcbiAgICBpZiAoZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnKSBjb250aW51ZVxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWN5Y2xlKSBjb250aW51ZVxuICAgIGF3YWl0IHJvbGxPdmVySWZOZWVkZWQoZGIsIGdvYWwsIGN5Y2xlLCBub3cpXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IEdvYWwsIEdvYWxDeWNsZSwgR29hbERlYWRsaW5lQ29uZmlnIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgZGVhZGxpbmVTdGF0ZSB9IGZyb20gJy4vY3ljbGVzLnRzJ1xuXG5leHBvcnQgdHlwZSBHb2FsTnVkZ2VLaW5kID1cbiAgfCAnZGVhZGxpbmVfYXBwcm9hY2hpbmcnXG4gIHwgJ2RlYWRsaW5lX292ZXJkdWUnXG4gIHwgJ2JlaGluZF9wYWNlJ1xuICB8ICdjeWNsZV9jb21wbGV0ZSdcbiAgfCAnZGVwZW5kZW5jeV91bmxvY2tlZCdcbiAgfCAnZ29hbF9zdGFydGluZ19zb29uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxOdWRnZSB7XG4gIGtpbmQ6IEdvYWxOdWRnZUtpbmRcbiAgZ29hbElkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBtZXNzYWdlOiBzdHJpbmdcbiAgc2V2ZXJpdHk6ICdpbmZvJyB8ICd3YXJuaW5nJyB8ICdzdWNjZXNzJ1xufVxuXG5mdW5jdGlvbiBwYXJzZURlYWRsaW5lKHZhbHVlOiB1bmtub3duKTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgR29hbERlYWRsaW5lQ29uZmlnXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgR29hbERlYWRsaW5lQ29uZmlnXG59XG5cbmNvbnN0IFNUQVJUSU5HX1NPT05fREFZUyA9IDNcblxuLyoqXG4gKiBCdWlsZCBpbi1hcHAgbnVkZ2VzIGZvciBkYXNoYm9hcmQgLyBub3RpZmljYXRpb25zIHN1cmZhY2UuXG4gKiBQdXJlIGZ1bmN0aW9uIFx1MjAxNCBubyBJL08uXG4gKiBTa2lwcyBkZWFkbGluZS9iZWhpbmRfcGFjZSBmb3IgZ29hbHMgdGhhdCBoYXZlIG5vdCBzdGFydGVkIHlldC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkR29hbE51ZGdlcyhcbiAgZ29hbHM6IEFycmF5PHsgZ29hbDogR29hbDsgY3ljbGU6IEdvYWxDeWNsZSB8IG51bGwgfT4sXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBHb2FsTnVkZ2VbXSB7XG4gIGNvbnN0IG51ZGdlczogR29hbE51ZGdlW10gPSBbXVxuXG4gIGZvciAoY29uc3QgeyBnb2FsLCBjeWNsZSB9IG9mIGdvYWxzKSB7XG4gICAgaWYgKCFjeWNsZSB8fCBnb2FsLnN0YXR1cyAhPT0gJ2FjdGl2ZScpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBzdGFydHNBdCA9IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KVxuICAgIGlmIChzdGFydHNBdCA+IG5vdykge1xuICAgICAgY29uc3QgbXNVbnRpbCA9IHN0YXJ0c0F0LmdldFRpbWUoKSAtIG5vdy5nZXRUaW1lKClcbiAgICAgIGNvbnN0IGRheXNVbnRpbCA9IG1zVW50aWwgLyAoMjQgKiA2MCAqIDYwICogMTAwMClcbiAgICAgIGlmIChkYXlzVW50aWwgPD0gU1RBUlRJTkdfU09PTl9EQVlTKSB7XG4gICAgICAgIGNvbnN0IGRheXNMYWJlbCA9IE1hdGgubWF4KDEsIE1hdGguY2VpbChkYXlzVW50aWwpKVxuICAgICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2dvYWxfc3RhcnRpbmdfc29vbicsXG4gICAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIHN0YXJ0cyBpbiAke2RheXNMYWJlbH0gZGF5JHtcbiAgICAgICAgICAgIGRheXNMYWJlbCA9PT0gMSA/ICcnIDogJ3MnXG4gICAgICAgICAgfS5gLFxuICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHRhcmdldE1ldCA9XG4gICAgICBjeWNsZS5zdGF0dXMgPT09ICdzdWNjZWVkZWQnIHx8XG4gICAgICAoTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwICYmXG4gICAgICAgIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICBpZiAodGFyZ2V0TWV0KSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdjeWNsZV9jb21wbGV0ZScsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBZb3UgY29tcGxldGVkIFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgZm9yIHRoaXMgY3ljbGUuYCxcbiAgICAgICAgc2V2ZXJpdHk6ICdzdWNjZXNzJyxcbiAgICAgIH0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VEZWFkbGluZShnb2FsLmRlYWRsaW5lKVxuICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUsIG5vdylcbiAgICBpZiAoc3RhdGUgPT09ICdhcHByb2FjaGluZycpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlYWRsaW5lX2FwcHJvYWNoaW5nJyxcbiAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgbWVzc2FnZTogYERlYWRsaW5lIGZvciBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIGFwcHJvYWNoaW5nLmAsXG4gICAgICAgIHNldmVyaXR5OiAnd2FybmluZycsXG4gICAgICB9KVxuICAgIH0gZWxzZSBpZiAoc3RhdGUgPT09ICdvdmVyZHVlJykge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVhZGxpbmVfb3ZlcmR1ZScsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIHBhc3QgaXRzIGRlYWRsaW5lLmAsXG4gICAgICAgIHNldmVyaXR5OiAnd2FybmluZycsXG4gICAgICB9KVxuICAgIH1cblxuICAgIC8vIEJlaGluZC1wYWNlIGZvciByZWN1cnJpbmcgY3ljbGVzIHdpdGggYSBrbm93biBlbmQuXG4gICAgaWYgKGN5Y2xlLmVuZHNfYXQgJiYgTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwKSB7XG4gICAgICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdCkuZ2V0VGltZSgpXG4gICAgICBjb25zdCBlbmQgPSBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KS5nZXRUaW1lKClcbiAgICAgIGNvbnN0IHNwYW4gPSBNYXRoLm1heCgxLCBlbmQgLSBzdGFydClcbiAgICAgIGNvbnN0IGVsYXBzZWQgPSBNYXRoLm1pbigxLCBNYXRoLm1heCgwLCAobm93LmdldFRpbWUoKSAtIHN0YXJ0KSAvIHNwYW4pKVxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSBlbGFwc2VkICogTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGFjdHVhbCA9IE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgaWYgKGVsYXBzZWQgPj0gMC4zNSAmJiBhY3R1YWwgPCBleHBlY3RlZCAqIDAuNykge1xuICAgICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2JlaGluZF9wYWNlJyxcbiAgICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgICAgbWVzc2FnZTogYFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgaXMgYmVoaW5kIHBhY2UgdGhpcyBjeWNsZS5gLFxuICAgICAgICAgIHNldmVyaXR5OiAnaW5mbycsXG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIG51ZGdlc1xufVxuIiwgImltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHtcbiAgTmV3UmV3YXJkRGVmaW5pdGlvbixcbiAgTmV3UmV3YXJkUnVsZSxcbiAgUmV3YXJkRGVmaW5pdGlvbiBhcyBSZXdhcmREZWZpbml0aW9uUm93LFxuICBSZXdhcmRJbnZlbnRvcnkgYXMgUmV3YXJkSW52ZW50b3J5Um93LFxuICBSZXdhcmRSdWxlIGFzIFJld2FyZFJ1bGVSb3csXG4gIFJld2FyZFJ1bGVDb25maWcsXG4gIFJld2FyZFRyYW5zYWN0aW9uIGFzIFJld2FyZFRyYW5zYWN0aW9uUm93LFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQge1xuICBhc3NldFB1YmxpY1BhdGgsXG4gIGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnksXG59IGZyb20gJy4uLy4uL2Fzc2V0cy9yZXBvc2l0b3J5LnRzJ1xuaW1wb3J0IHtcbiAgRGJJbnZlbnRvcnlNYW5hZ2VyLFxuICBJbnZlbnRvcnlFcnJvcixcbiAgcmVjb21wdXRlSW52ZW50b3J5RnJvbUxlZGdlcixcbn0gZnJvbSAnLi4vLi4vcmV3YXJkcy9pbnZlbnRvcnkudHMnXG5pbXBvcnQgeyByZXdhcmRHcmFudFNlcnZpY2UgfSBmcm9tICcuLi8uLi9yZXdhcmRzL2dyYW50X3NlcnZpY2UudHMnXG5pbXBvcnQgeyB2YWxpZGF0ZUdyb3VwQ29sb3IgfSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBBdHRhY2hSZXdhcmRSdWxlSW5wdXQsXG4gIENvbnN1bWVSZXdhcmRJbnB1dCxcbiAgQ3JlYXRlUmV3YXJkRGVmaW5pdGlvbklucHV0LFxuICBEaXNjYXJkUmV3YXJkSW5wdXQsXG4gIE1hbnVhbEdyYW50UmV3YXJkSW5wdXQsXG4gIFJld2FyZERlZmluaXRpb25zRmlsdGVyLFxuICBSZXdhcmRIaXN0b3J5RmlsdGVyLFxuICBSZXdhcmRJbnZlbnRvcnlGaWx0ZXIsXG4gIFVwZGF0ZVJld2FyZERlZmluaXRpb25JbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkUmV3YXJkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRSZXdhcmRFcnJvcidcbiAgfVxufVxuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHBhcnNlVGFncyh2YWx1ZTogdW5rbm93bik6IHN0cmluZ1tdIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBbXVxuICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHJldHVybiB2YWx1ZS5tYXAoU3RyaW5nKVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKHZhbHVlKVxuICAgICAgcmV0dXJuIEFycmF5LmlzQXJyYXkocGFyc2VkKSA/IHBhcnNlZC5tYXAoU3RyaW5nKSA6IFtdXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gW11cbiAgICB9XG4gIH1cbiAgcmV0dXJuIFtdXG59XG5cbmZ1bmN0aW9uIHBhcnNlQ29uZmlnKHZhbHVlOiB1bmtub3duKTogUmV3YXJkUnVsZUNvbmZpZyB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4ge31cbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFJld2FyZFJ1bGVDb25maWdcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7fVxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgUmV3YXJkUnVsZUNvbmZpZ1xufVxuXG5mdW5jdGlvbiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3c6IFJld2FyZERlZmluaXRpb25Sb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgdGFnczogcGFyc2VUYWdzKHJvdy50YWdzKSxcbiAgICBpbWFnZV91cmw6IHJvdy5pbWFnZV9hc3NldF9pZFxuICAgICAgPyBhc3NldFB1YmxpY1BhdGgocm93LmltYWdlX2Fzc2V0X2lkKVxuICAgICAgOiBudWxsLFxuICAgIGltYWdlOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocm93LmltYWdlX2Fzc2V0X2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICAgIGNvbnN0IGFzc2V0ID0gYXdhaXQgcmVwby5nZXRNZXRhZGF0YShyb3cuaW1hZ2VfYXNzZXRfaWQsIHJvdy51c2VyX2lkKVxuICAgICAgaWYgKCFhc3NldCkgcmV0dXJuIG51bGxcbiAgICAgIHJldHVybiB7XG4gICAgICAgIC4uLmFzc2V0LFxuICAgICAgICB1cmw6IGFzc2V0UHVibGljUGF0aChhc3NldC5pZCksXG4gICAgICB9XG4gICAgfSxcbiAgfVxufVxuXG5mdW5jdGlvbiB3aXRoSW52ZW50b3J5UmVsYXRpb25zKHJvdzogUmV3YXJkSW52ZW50b3J5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIGRlZmluaXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gZGVmID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMoZGVmKSA6IG51bGxcbiAgICB9LFxuICB9XG59XG5cbmZ1bmN0aW9uIHdpdGhSdWxlUmVsYXRpb25zKHJvdzogUmV3YXJkUnVsZVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBjb25maWc6IHBhcnNlQ29uZmlnKHJvdy5jb25maWcpLFxuICAgIGRlZmluaXRpb246IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGRlZiA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCByb3cucmV3YXJkX2RlZmluaXRpb25faWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICByZXR1cm4gZGVmID8gd2l0aERlZmluaXRpb25SZWxhdGlvbnMoZGVmKSA6IG51bGxcbiAgICB9LFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFRyYW5zYWN0aW9uKHJvdzogUmV3YXJkVHJhbnNhY3Rpb25Sb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgbWV0YWRhdGE6XG4gICAgICB0eXBlb2Ygcm93Lm1ldGFkYXRhID09PSAnc3RyaW5nJ1xuICAgICAgICA/IEpTT04ucGFyc2Uocm93Lm1ldGFkYXRhKVxuICAgICAgICA6IHJvdy5tZXRhZGF0YSxcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignbmFtZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignbmFtZSB0b28gbG9uZycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBjb25zdCBSZXdhcmRRdWVyeSA9IHtcbiAgcmV3YXJkRGVmaW5pdGlvbnM6IGFzeW5jIChhcmdzOiB7XG4gICAgZmlsdGVyPzogUmV3YXJkRGVmaW5pdGlvbnNGaWx0ZXIgfCBudWxsXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmaWx0ZXIgPSBhcmdzLmZpbHRlciA/PyB7fVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG5cbiAgICBpZiAoIWZpbHRlci5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuc2VhcmNoPy50cmltKCkpIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBgJSR7ZmlsdGVyLnNlYXJjaC50cmltKCkudG9Mb3dlckNhc2UoKX0lYFxuICAgICAgcSA9IHEud2hlcmUoKGViKSA9PlxuICAgICAgICBlYi5vcihbXG4gICAgICAgICAgZWIoJ25hbWUnLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignZGVzY3JpcHRpb24nLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgICBlYignY2F0ZWdvcnknLCAnaWxpa2UnLCB0ZXJtKSxcbiAgICAgICAgXSksXG4gICAgICApXG4gICAgfVxuICAgIGlmIChmaWx0ZXIuY2F0ZWdvcnk/LnRyaW0oKSkge1xuICAgICAgcSA9IHEud2hlcmUoJ2NhdGVnb3J5JywgJz0nLCBmaWx0ZXIuY2F0ZWdvcnkudHJpbSgpKVxuICAgIH1cblxuICAgIGNvbnN0IGxpbWl0ID0gTWF0aC5taW4oTWF0aC5tYXgoZmlsdGVyLmxpbWl0ID8/IDEwMCwgMSksIDIwMClcbiAgICBjb25zdCBvZmZzZXQgPSBNYXRoLm1heChmaWx0ZXIub2Zmc2V0ID8/IDAsIDApXG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcVxuICAgICAgLm9yZGVyQnkoJ3NvcnRfb3JkZXInLCAnYXNjJylcbiAgICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgICAubGltaXQobGltaXQpXG4gICAgICAub2Zmc2V0KG9mZnNldClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKVxuICB9LFxuXG4gIHJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpIDogbnVsbFxuICB9LFxuXG4gIHJld2FyZEludmVudG9yeTogYXN5bmMgKGFyZ3M6IHtcbiAgICBmaWx0ZXI/OiBSZXdhcmRJbnZlbnRvcnlGaWx0ZXIgfCBudWxsXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmaWx0ZXIgPSBhcmdzLmZpbHRlciA/PyB7fVxuICAgIGxldCBxID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfaW52ZW50b3J5JylcbiAgICAgIC5pbm5lckpvaW4oXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMnLFxuICAgICAgICAncmV3YXJkX2RlZmluaXRpb25zLmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucmV3YXJkX2RlZmluaXRpb25faWQnLFxuICAgICAgKVxuICAgICAgLndoZXJlKCdyZXdhcmRfaW52ZW50b3J5LnVzZXJfaWQnLCAnPScsIHVzZXJJZClcblxuICAgIGlmIChmaWx0ZXIuc2VhcmNoPy50cmltKCkpIHtcbiAgICAgIGNvbnN0IHRlcm0gPSBgJSR7ZmlsdGVyLnNlYXJjaC50cmltKCkudG9Mb3dlckNhc2UoKX0lYFxuICAgICAgcSA9IHEud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9ucy5uYW1lJywgJ2lsaWtlJywgdGVybSlcbiAgICB9XG4gICAgaWYgKGZpbHRlci5zdGFja2FibGVPbmx5KSB7XG4gICAgICBxID0gcS53aGVyZSgncmV3YXJkX2RlZmluaXRpb25zLnN0YWNrYWJsZScsICc9JywgdHJ1ZSlcbiAgICB9XG5cbiAgICBjb25zdCBzb3J0ID0gZmlsdGVyLnNvcnQgPz8gJ3JlY2VudCdcbiAgICBpZiAoc29ydCA9PT0gJ25hbWUnKSB7XG4gICAgICBxID0gcS5vcmRlckJ5KCdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsICdhc2MnKVxuICAgIH0gZWxzZSBpZiAoc29ydCA9PT0gJ3F1YW50aXR5Jykge1xuICAgICAgcSA9IHEub3JkZXJCeSgncmV3YXJkX2ludmVudG9yeS5xdWFudGl0eScsICdkZXNjJylcbiAgICB9IGVsc2Uge1xuICAgICAgcSA9IHEub3JkZXJCeSgncmV3YXJkX2ludmVudG9yeS5sYXN0X2Vhcm5lZF9hdCcsICdkZXNjJylcbiAgICB9XG5cbiAgICBjb25zdCBsaW1pdCA9IE1hdGgubWluKE1hdGgubWF4KGZpbHRlci5saW1pdCA/PyAxMDAsIDEpLCAyMDApXG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoZmlsdGVyLm9mZnNldCA/PyAwLCAwKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHFcbiAgICAgIC5zZWxlY3RBbGwoJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEludmVudG9yeVJlbGF0aW9ucylcbiAgfSxcblxuICByZXdhcmRIaXN0b3J5OiBhc3luYyAoYXJnczogeyBmaWx0ZXI/OiBSZXdhcmRIaXN0b3J5RmlsdGVyIHwgbnVsbCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZmlsdGVyID0gYXJncy5maWx0ZXIgPz8ge31cbiAgICBsZXQgcSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgncmV3YXJkX3RyYW5zYWN0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcblxuICAgIGlmIChmaWx0ZXIuZGVmaW5pdGlvbklkICE9IG51bGwpIHtcbiAgICAgIHEgPSBxLndoZXJlKCdyZXdhcmRfZGVmaW5pdGlvbl9pZCcsICc9JywgZmlsdGVyLmRlZmluaXRpb25JZClcbiAgICB9XG4gICAgaWYgKGZpbHRlci50eXBlPy50cmltKCkpIHtcbiAgICAgIHEgPSBxLndoZXJlKCd0eXBlJywgJz0nLCBmaWx0ZXIudHlwZS50cmltKCkgYXMgbmV2ZXIpXG4gICAgfVxuXG4gICAgY29uc3QgbGltaXQgPSBNYXRoLm1pbihNYXRoLm1heChmaWx0ZXIubGltaXQgPz8gNTAsIDEpLCAyMDApXG4gICAgY29uc3Qgb2Zmc2V0ID0gTWF0aC5tYXgoZmlsdGVyLm9mZnNldCA/PyAwLCAwKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHFcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLm9yZGVyQnkoJ2lkJywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLm9mZnNldChvZmZzZXQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcChtYXBUcmFuc2FjdGlvbilcbiAgfSxcblxuICByZXdhcmRSdWxlczogYXN5bmMgKGFyZ3M6IHtcbiAgICBzb3VyY2VUeXBlOiBzdHJpbmdcbiAgICBzb3VyY2VJZDogbnVtYmVyXG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3NvdXJjZV90eXBlJywgJz0nLCBhcmdzLnNvdXJjZVR5cGUpXG4gICAgICAud2hlcmUoJ3NvdXJjZV9pZCcsICc9JywgYXJncy5zb3VyY2VJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoUnVsZVJlbGF0aW9ucylcbiAgfSxcblxuICByZWNlbnRBc3NldHM6IGFzeW5jIChhcmdzOiB7IGxpbWl0PzogbnVtYmVyIHwgbnVsbCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHJlcG8ubGlzdFJlY2VudChcbiAgICAgIHVzZXJJZCxcbiAgICAgIE1hdGgubWluKE1hdGgubWF4KGFyZ3MubGltaXQgPz8gMjAsIDEpLCA1MCksXG4gICAgKVxuICAgIHJldHVybiByb3dzLm1hcCgoYSkgPT4gKHsgLi4uYSwgdXJsOiBhc3NldFB1YmxpY1BhdGgoYS5pZCkgfSkpXG4gIH0sXG5cbiAgcmV3YXJkTnVkZ2VzOiBhc3luYyAoX2FyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB7IGJ1aWxkUmV3YXJkTnVkZ2VzIH0gPSBhd2FpdCBpbXBvcnQoJy4uLy4uL3Jld2FyZHMvbnVkZ2VzLnRzJylcbiAgICBjb25zdCBpbnZlbnRvcnkgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLmlubmVySm9pbihcbiAgICAgICAgJ3Jld2FyZF9kZWZpbml0aW9ucycsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMuaWQnLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICApXG4gICAgICAud2hlcmUoJ3Jld2FyZF9pbnZlbnRvcnkudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdChbXG4gICAgICAgICdyZXdhcmRfaW52ZW50b3J5LmlkJyxcbiAgICAgICAgJ3Jld2FyZF9pbnZlbnRvcnkucXVhbnRpdHknLFxuICAgICAgICAncmV3YXJkX2ludmVudG9yeS5yZXdhcmRfZGVmaW5pdGlvbl9pZCcsXG4gICAgICAgICdyZXdhcmRfZGVmaW5pdGlvbnMubmFtZScsXG4gICAgICBdKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcmVjZW50RWFybnMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF90cmFuc2FjdGlvbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3R5cGUnLCAnPScsICdlYXJuJylcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KDEwKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gYnVpbGRSZXdhcmROdWRnZXMoe1xuICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkubWFwKChyKSA9PiAoe1xuICAgICAgICBpZDogci5pZCxcbiAgICAgICAgcXVhbnRpdHk6IHIucXVhbnRpdHksXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiByLnJld2FyZF9kZWZpbml0aW9uX2lkLFxuICAgICAgICBuYW1lOiByLm5hbWUsXG4gICAgICB9KSksXG4gICAgICByZWNlbnRFYXJucyxcbiAgICB9KVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgUmV3YXJkTXV0YXRpb24gPSB7XG4gIGNyZWF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaW5wdXQ6IENyZWF0ZVJld2FyZERlZmluaXRpb25JbnB1dFxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJnc1xuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBjb25zdCBhc3NldCA9IGF3YWl0IHJlcG8uZ2V0TWV0YWRhdGEoaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgYXdhaXQgcmVwby5yZXRhaW4oaW5wdXQuaW1hZ2VBc3NldElkLCB1c2VySWQpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgbm90ZXM6IGlucHV0Lm5vdGVzPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgY2F0ZWdvcnk6IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgdGFnczogSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSksXG4gICAgICAgIGNvbG9yLFxuICAgICAgICBpY29uOiBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbCxcbiAgICAgICAgaW1hZ2VfYXNzZXRfaWQ6IGlucHV0LmltYWdlQXNzZXRJZCA/PyBudWxsLFxuICAgICAgICBzdGFja2FibGU6IGlucHV0LnN0YWNrYWJsZSA/PyB0cnVlLFxuICAgICAgICBkZWZhdWx0X3F1YW50aXR5OiBNYXRoLm1heCgxLCBpbnB1dC5kZWZhdWx0UXVhbnRpdHkgPz8gMSksXG4gICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld1Jld2FyZERlZmluaXRpb24pXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIHVwZGF0ZVJld2FyZERlZmluaXRpb246IGFzeW5jIChhcmdzOiB7XG4gICAgaWQ6IG51bWJlclxuICAgIGlucHV0OiBVcGRhdGVSZXdhcmREZWZpbml0aW9uSW5wdXRcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFleGlzdGluZykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3QgcGF0Y2g6IFJlY29yZDxzdHJpbmcsIHVua25vd24+ID0ge1xuICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgIH1cblxuICAgIGlmIChpbnB1dC5uYW1lICE9IG51bGwpIHBhdGNoLm5hbWUgPSB2YWxpZGF0ZU5hbWUoaW5wdXQubmFtZSlcbiAgICBpZiAoaW5wdXQuZGVzY3JpcHRpb24gIT09IHVuZGVmaW5lZCkge1xuICAgICAgcGF0Y2guZGVzY3JpcHRpb24gPSBpbnB1dC5kZXNjcmlwdGlvbj8udHJpbSgpIHx8IG51bGxcbiAgICB9XG4gICAgaWYgKGlucHV0Lm5vdGVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHBhdGNoLm5vdGVzID0gaW5wdXQubm90ZXM/LnRyaW0oKSB8fCBudWxsXG4gICAgfVxuICAgIGlmIChpbnB1dC5jYXRlZ29yeSAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC5jYXRlZ29yeSA9IGlucHV0LmNhdGVnb3J5Py50cmltKCkgfHwgbnVsbFxuICAgIH1cbiAgICBpZiAoaW5wdXQudGFncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwYXRjaC50YWdzID0gSlNPTi5zdHJpbmdpZnkoaW5wdXQudGFncyA/PyBbXSlcbiAgICB9XG4gICAgaWYgKGlucHV0LmNvbG9yICE9IG51bGwpIHBhdGNoLmNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKVxuICAgIGlmIChpbnB1dC5pY29uICE9PSB1bmRlZmluZWQpIHBhdGNoLmljb24gPSBpbnB1dC5pY29uPy50cmltKCkgfHwgbnVsbFxuICAgIGlmIChpbnB1dC5zdGFja2FibGUgIT0gbnVsbCkgcGF0Y2guc3RhY2thYmxlID0gaW5wdXQuc3RhY2thYmxlXG4gICAgaWYgKGlucHV0LmRlZmF1bHRRdWFudGl0eSAhPSBudWxsKSB7XG4gICAgICBwYXRjaC5kZWZhdWx0X3F1YW50aXR5ID0gTWF0aC5tYXgoMSwgaW5wdXQuZGVmYXVsdFF1YW50aXR5KVxuICAgIH1cbiAgICBpZiAoaW5wdXQuc29ydE9yZGVyICE9IG51bGwpIHBhdGNoLnNvcnRfb3JkZXIgPSBpbnB1dC5zb3J0T3JkZXJcblxuICAgIGlmIChpbnB1dC5pbWFnZUFzc2V0SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgcmVwbyA9IGNyZWF0ZURlZmF1bHRBc3NldFJlcG9zaXRvcnkoZGIpXG4gICAgICBpZiAoaW5wdXQuaW1hZ2VBc3NldElkICE9IG51bGwpIHtcbiAgICAgICAgY29uc3QgYXNzZXQgPSBhd2FpdCByZXBvLmdldE1ldGFkYXRhKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICBpZiAoIWFzc2V0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdpbWFnZSBhc3NldCBub3QgZm91bmQnKVxuICAgICAgICBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT09IGlucHV0LmltYWdlQXNzZXRJZCkge1xuICAgICAgICAgIGF3YWl0IHJlcG8ucmV0YWluKGlucHV0LmltYWdlQXNzZXRJZCwgdXNlcklkKVxuICAgICAgICAgIGlmIChleGlzdGluZy5pbWFnZV9hc3NldF9pZCAhPSBudWxsKSB7XG4gICAgICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSBpZiAoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCByZXBvLnJlbGVhc2UoZXhpc3RpbmcuaW1hZ2VfYXNzZXRfaWQsIHVzZXJJZClcbiAgICAgIH1cbiAgICAgIHBhdGNoLmltYWdlX2Fzc2V0X2lkID0gaW5wdXQuaW1hZ2VBc3NldElkXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQocGF0Y2gpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gd2l0aERlZmluaXRpb25SZWxhdGlvbnMocm93KVxuICB9LFxuXG4gIGFyY2hpdmVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdyZXdhcmRfZGVmaW5pdGlvbnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGFyY2hpdmVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdykgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuICAgIHJldHVybiB3aXRoRGVmaW5pdGlvblJlbGF0aW9ucyhyb3cpXG4gIH0sXG5cbiAgdW5hcmNoaXZlUmV3YXJkRGVmaW5pdGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghcm93KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdkZWZpbml0aW9uIG5vdCBmb3VuZCcpXG4gICAgcmV0dXJuIHdpdGhEZWZpbml0aW9uUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICBkZWxldGVSZXdhcmREZWZpbml0aW9uOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBpbnYgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9pbnZlbnRvcnknKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3Jld2FyZF9kZWZpbml0aW9uX2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmIChpbnYpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoXG4gICAgICAgICdjYW5ub3QgZGVsZXRlIGRlZmluaXRpb24gd2l0aCBpbnZlbnRvcnk7IGFyY2hpdmUgaW5zdGVhZCcsXG4gICAgICApXG4gICAgfVxuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWV4aXN0aW5nKSByZXR1cm4gZmFsc2VcblxuICAgIGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgncmV3YXJkX2RlZmluaXRpb25zJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGlmIChleGlzdGluZy5pbWFnZV9hc3NldF9pZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCByZXBvID0gY3JlYXRlRGVmYXVsdEFzc2V0UmVwb3NpdG9yeShkYilcbiAgICAgIGF3YWl0IHJlcG8ucmVsZWFzZShleGlzdGluZy5pbWFnZV9hc3NldF9pZCwgdXNlcklkKVxuICAgIH1cbiAgICByZXR1cm4gdHJ1ZVxuICB9LFxuXG4gIGF0dGFjaFJld2FyZFJ1bGU6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBBdHRhY2hSZXdhcmRSdWxlSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3NcbiAgICBjb25zdCBzb3VyY2VUeXBlID0gaW5wdXQuc291cmNlVHlwZS50cmltKClcbiAgICBpZiAoIXNvdXJjZVR5cGUpIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ3NvdXJjZVR5cGUgaXMgcmVxdWlyZWQnKVxuICAgIGlmICghTnVtYmVyLmlzRmluaXRlKGlucHV0LnNvdXJjZUlkKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignc291cmNlSWQgaXMgcmVxdWlyZWQnKVxuICAgIH1cblxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpbnB1dC5yZXdhcmREZWZpbml0aW9uSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghZGVmaW5pdGlvbikgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZGVmaW5pdGlvbiBub3QgZm91bmQnKVxuXG4gICAgaWYgKHNvdXJjZVR5cGUgPT09ICdhY3Rpdml0eScpIHtcbiAgICAgIGNvbnN0IGFjdCA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuc291cmNlSWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghYWN0KSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdhY3Rpdml0eSBub3QgZm91bmQnKVxuICAgIH0gZWxzZSBpZiAoc291cmNlVHlwZSA9PT0gJ2dvYWwnKSB7XG4gICAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgaW5wdXQuc291cmNlSWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghZ29hbCkgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcignZ29hbCBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGxldCBjb25maWc6IFJld2FyZFJ1bGVDb25maWcgPSB7fVxuICAgIGlmIChpbnB1dC5jb25maWdKc29uPy50cmltKCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbmZpZyA9IEpTT04ucGFyc2UoaW5wdXQuY29uZmlnSnNvbikgYXMgUmV3YXJkUnVsZUNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoJ2NvbmZpZ0pzb24gbXVzdCBiZSB2YWxpZCBKU09OJylcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBtb2RlID0gaW5wdXQubW9kZSA/PyAnZml4ZWQnXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdyZXdhcmRfcnVsZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgc291cmNlX3R5cGU6IHNvdXJjZVR5cGUsXG4gICAgICAgIHNvdXJjZV9pZDogaW5wdXQuc291cmNlSWQsXG4gICAgICAgIHJld2FyZF9kZWZpbml0aW9uX2lkOiBpbnB1dC5yZXdhcmREZWZpbml0aW9uSWQsXG4gICAgICAgIHF1YW50aXR5OiBNYXRoLm1heCgxLCBpbnB1dC5xdWFudGl0eSA/PyAxKSxcbiAgICAgICAgbW9kZSxcbiAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShjb25maWcpLFxuICAgICAgICBlbmFibGVkOiBpbnB1dC5lbmFibGVkID8/IHRydWUsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdSZXdhcmRSdWxlKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIHdpdGhSdWxlUmVsYXRpb25zKHJvdylcbiAgfSxcblxuICBkZXRhY2hSZXdhcmRSdWxlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ3Jld2FyZF9ydWxlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwXG4gIH0sXG5cbiAgY29uc3VtZVJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENvbnN1bWVSZXdhcmRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcXVhbnRpdHkgPSBNYXRoLm1heCgxLCBhcmdzLmlucHV0LnF1YW50aXR5ID8/IDEpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseUNvbnN1bWUoXG4gICAgICAgICAgICB0cngsXG4gICAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgICBhcmdzLmlucHV0LmludmVudG9yeUlkLFxuICAgICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgICBhcmdzLmlucHV0Lm5vdGUsXG4gICAgICAgICAgKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkgPyB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSkgOiBudWxsLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgZGlzY2FyZFJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IERpc2NhcmRSZXdhcmRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcXVhbnRpdHkgPSBNYXRoLm1heCgxLCBhcmdzLmlucHV0LnF1YW50aXR5ID8/IDEpXG4gICAgY29uc3QgbWFuYWdlciA9IG5ldyBEYkludmVudG9yeU1hbmFnZXIoKVxuICAgIHRyeSB7XG4gICAgICBjb25zdCB7IGludmVudG9yeSwgdHJhbnNhY3Rpb24gfSA9IGF3YWl0IGRiXG4gICAgICAgIC50cmFuc2FjdGlvbigpXG4gICAgICAgIC5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgICAgICByZXR1cm4gYXdhaXQgbWFuYWdlci5hcHBseURpc2NhcmQoXG4gICAgICAgICAgICB0cngsXG4gICAgICAgICAgICB1c2VySWQsXG4gICAgICAgICAgICBhcmdzLmlucHV0LmludmVudG9yeUlkLFxuICAgICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiBpbnZlbnRvcnkgPyB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSkgOiBudWxsLFxuICAgICAgICB0cmFuc2FjdGlvbjogbWFwVHJhbnNhY3Rpb24odHJhbnNhY3Rpb24pLFxuICAgICAgfVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgaWYgKGVyciBpbnN0YW5jZW9mIEludmVudG9yeUVycm9yKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkUmV3YXJkRXJyb3IoZXJyLm1lc3NhZ2UpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgcmVzdG9yZVJld2FyZDogYXN5bmMgKGFyZ3M6IHsgdHJhbnNhY3Rpb25JZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBtYW5hZ2VyID0gbmV3IERiSW52ZW50b3J5TWFuYWdlcigpXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHsgaW52ZW50b3J5LCB0cmFuc2FjdGlvbiB9ID0gYXdhaXQgZGJcbiAgICAgICAgLnRyYW5zYWN0aW9uKClcbiAgICAgICAgLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgICAgIHJldHVybiBhd2FpdCBtYW5hZ2VyLmFwcGx5UmVzdG9yZSh0cngsIHVzZXJJZCwgYXJncy50cmFuc2FjdGlvbklkKVxuICAgICAgICB9KVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgaW52ZW50b3J5OiB3aXRoSW52ZW50b3J5UmVsYXRpb25zKGludmVudG9yeSksXG4gICAgICAgIHRyYW5zYWN0aW9uOiBtYXBUcmFuc2FjdGlvbih0cmFuc2FjdGlvbiksXG4gICAgICB9XG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBpZiAoZXJyIGluc3RhbmNlb2YgSW52ZW50b3J5RXJyb3IpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRSZXdhcmRFcnJvcihlcnIubWVzc2FnZSlcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICBtYW51YWxHcmFudFJld2FyZDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IE1hbnVhbEdyYW50UmV3YXJkSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHF1YW50aXR5ID0gTWF0aC5tYXgoMSwgYXJncy5pbnB1dC5xdWFudGl0eSA/PyAxKVxuICAgIGNvbnN0IGRlZmluaXRpb24gPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ3Jld2FyZF9kZWZpbml0aW9ucycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlucHV0LnJld2FyZERlZmluaXRpb25JZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFkZWZpbml0aW9uKSB0aHJvdyBuZXcgSW52YWxpZFJld2FyZEVycm9yKCdkZWZpbml0aW9uIG5vdCBmb3VuZCcpXG5cbiAgICBjb25zdCByZXN1bHRzID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIHJldHVybiBhd2FpdCByZXdhcmRHcmFudFNlcnZpY2UuZ3JhbnQodHJ4LCB1c2VySWQsIFtcbiAgICAgICAge1xuICAgICAgICAgIHJ1bGVJZDogbnVsbCxcbiAgICAgICAgICBkZWZpbml0aW9uSWQ6IGRlZmluaXRpb24uaWQsXG4gICAgICAgICAgcXVhbnRpdHksXG4gICAgICAgICAgdHJpZ2dlcktleTogYG1hbnVhbDoke0RhdGUubm93KCl9OiR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gLFxuICAgICAgICAgIHNvdXJjZVR5cGU6ICdtYW51YWwnLFxuICAgICAgICAgIHNvdXJjZUlkOiAwLFxuICAgICAgICB9LFxuICAgICAgXSlcbiAgICB9KVxuXG4gICAgY29uc3QgdHggPSByZXN1bHRzWzBdPy50cmFuc2FjdGlvblxuICAgIHJldHVybiB0eCA/IG1hcFRyYW5zYWN0aW9uKHR4KSA6IG51bGxcbiAgfSxcblxuICByZWNvbXB1dGVSZXdhcmRJbnZlbnRvcnk6IGFzeW5jICgpID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByZWNvbXB1dGVJbnZlbnRvcnlGcm9tTGVkZ2VyKGRiLCB1c2VySWQpXG4gICAgcmV0dXJuIHRydWVcbiAgfSxcbn1cbiIsICIvKiogU0hBLTI1NiBoZXggZGlnZXN0IG9mIHJhdyBieXRlcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaGEyNTZIZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkaWdlc3QgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgnU0hBLTI1NicsIGJ5dGVzKVxuICByZXR1cm4gQXJyYXkuZnJvbShuZXcgVWludDhBcnJheShkaWdlc3QpKVxuICAgIC5tYXAoKGIpID0+IGIudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJykpXG4gICAgLmpvaW4oJycpXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSW1hZ2VIYXNoaW5nU2VydmljZSB7XG4gIHNoYTI1NihieXRlczogVWludDhBcnJheSk6IFByb21pc2U8c3RyaW5nPlxufVxuXG5leHBvcnQgY29uc3QgZGVmYXVsdEltYWdlSGFzaGluZ1NlcnZpY2U6IEltYWdlSGFzaGluZ1NlcnZpY2UgPSB7XG4gIHNoYTI1Njogc2hhMjU2SGV4LFxufVxuIiwgImltcG9ydCB7IGpvaW4gfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgeyBta2RpciwgcmVhZEZpbGUsIHVubGluaywgd3JpdGVGaWxlIH0gZnJvbSAnbm9kZTpmcy9wcm9taXNlcydcbmltcG9ydCB0eXBlIHsgQXNzZXRTdG9yYWdlIH0gZnJvbSAnLi90eXBlcy50cydcblxuZnVuY3Rpb24gY3dkKCk6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHByb2Nlc3MuY3dkID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIHByb2Nlc3MuY3dkKClcbiAgfVxuICByZXR1cm4gJy4nXG59XG5cbmZ1bmN0aW9uIGFzc2V0c1Jvb3QoKTogc3RyaW5nIHtcbiAgY29uc3QgZW52ID1cbiAgICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfRElSKSB8fCBudWxsXG4gIGlmIChlbnYpIHJldHVybiBlbnZcbiAgcmV0dXJuIGpvaW4oY3dkKCksICdkYXRhJywgJ2Fzc2V0cycpXG59XG5cbmV4cG9ydCBjbGFzcyBMb2NhbEZzQXNzZXRTdG9yYWdlIGltcGxlbWVudHMgQXNzZXRTdG9yYWdlIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSByb290OiBzdHJpbmcgPSBhc3NldHNSb290KCkpIHt9XG5cbiAgcHJpdmF0ZSBmdWxsUGF0aChrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgc2FmZSA9IGtleS5yZXBsYWNlKC9cXC5cXC4vZywgJycpLnJlcGxhY2UoL15cXC8rLywgJycpXG4gICAgcmV0dXJuIGpvaW4odGhpcy5yb290LCBzYWZlKVxuICB9XG5cbiAgYXN5bmMgd3JpdGUoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXksXG4gICAgX2NvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHBhdGggPSB0aGlzLmZ1bGxQYXRoKGtleSlcbiAgICBjb25zdCBkaXIgPSBqb2luKHBhdGgsICcuLicpXG4gICAgYXdhaXQgbWtkaXIoZGlyLCB7IHJlY3Vyc2l2ZTogdHJ1ZSB9KVxuICAgIGF3YWl0IHdyaXRlRmlsZShwYXRoLCBieXRlcylcbiAgfVxuXG4gIGFzeW5jIHJlYWQoa2V5OiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGRhdGEgPSBhd2FpdCByZWFkRmlsZSh0aGlzLmZ1bGxQYXRoKGtleSkpXG4gICAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoZGF0YSlcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHVubGluayh0aGlzLmZ1bGxQYXRoKGtleSkpXG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBBbHJlYWR5IGdvbmUuXG4gICAgfVxuICB9XG5cbiAgcHVibGljVXJsKF9rZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IEFzc2V0U3RvcmFnZSB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBMb2NhbEZzQXNzZXRTdG9yYWdlIH0gZnJvbSAnLi9sb2NhbF9mcy50cydcblxuLyoqXG4gKiBTMy1jb21wYXRpYmxlIGFzc2V0IHN0b3JhZ2UgKFBoYXNlIDMpLlxuICpcbiAqIEVudjogQVNTRVRTX1MzX0JVQ0tFVCwgQVNTRVRTX1MzX1JFR0lPTiwgQVNTRVRTX1MzX0VORFBPSU5ULFxuICogQVdTX0FDQ0VTU19LRVlfSUQgLyBBV1NfU0VDUkVUX0FDQ0VTU19LRVkuXG4gKi9cbmV4cG9ydCBjbGFzcyBTM0Fzc2V0U3RvcmFnZSBpbXBsZW1lbnRzIEFzc2V0U3RvcmFnZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYnVja2V0OiBzdHJpbmdcbiAgcHJpdmF0ZSByZWFkb25seSByZWdpb246IHN0cmluZ1xuICBwcml2YXRlIHJlYWRvbmx5IGVuZHBvaW50OiBzdHJpbmcgfCBudWxsXG5cbiAgY29uc3RydWN0b3Iob3B0cz86IHtcbiAgICBidWNrZXQ/OiBzdHJpbmdcbiAgICByZWdpb24/OiBzdHJpbmdcbiAgICBlbmRwb2ludD86IHN0cmluZyB8IG51bGxcbiAgfSkge1xuICAgIHRoaXMuYnVja2V0ID1cbiAgICAgIG9wdHM/LmJ1Y2tldCA/P1xuICAgICAgKCh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TM19CVUNLRVQpIHx8XG4gICAgICAgICcnKVxuICAgIHRoaXMucmVnaW9uID1cbiAgICAgIG9wdHM/LnJlZ2lvbiA/P1xuICAgICAgKCh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TM19SRUdJT04pIHx8XG4gICAgICAgICd1cy1lYXN0LTEnKVxuICAgIHRoaXMuZW5kcG9pbnQgPVxuICAgICAgb3B0cz8uZW5kcG9pbnQgPz9cbiAgICAgICgodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BU1NFVFNfUzNfRU5EUE9JTlQpIHx8XG4gICAgICAgIG51bGwpXG4gIH1cblxuICBwcml2YXRlIGFzc2VydENvbmZpZ3VyZWQoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmJ1Y2tldCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAnUzNBc3NldFN0b3JhZ2UgaXMgbm90IGNvbmZpZ3VyZWQgKHNldCBBU1NFVFNfUzNfQlVDS0VUKScsXG4gICAgICApXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgd3JpdGUoXG4gICAga2V5OiBzdHJpbmcsXG4gICAgYnl0ZXM6IFVpbnQ4QXJyYXksXG4gICAgY29udGVudFR5cGU6IHN0cmluZyxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBjb25zdCB1cmwgPSB0aGlzLm9iamVjdFVybChrZXkpXG4gICAgY29uc3QgcmVzID0gYXdhaXQgZmV0Y2godXJsLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQ29udGVudC1UeXBlJzogY29udGVudFR5cGUsXG4gICAgICAgICdDb250ZW50LUxlbmd0aCc6IFN0cmluZyhieXRlcy5ieXRlTGVuZ3RoKSxcbiAgICAgIH0sXG4gICAgICBib2R5OiBieXRlcyxcbiAgICB9KVxuICAgIGlmICghcmVzLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFMzIHB1dCBmYWlsZWQ6ICR7cmVzLnN0YXR1c30gJHthd2FpdCByZXMudGV4dCgpfWApXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVhZChrZXk6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IG51bGw+IHtcbiAgICB0aGlzLmFzc2VydENvbmZpZ3VyZWQoKVxuICAgIGNvbnN0IHJlcyA9IGF3YWl0IGZldGNoKHRoaXMub2JqZWN0VXJsKGtleSkpXG4gICAgaWYgKHJlcy5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIG51bGxcbiAgICBpZiAoIXJlcy5vaykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBTMyBnZXQgZmFpbGVkOiAke3Jlcy5zdGF0dXN9YClcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IHJlcy5hcnJheUJ1ZmZlcigpKVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlKGtleTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5hc3NlcnRDb25maWd1cmVkKClcbiAgICBhd2FpdCBmZXRjaCh0aGlzLm9iamVjdFVybChrZXkpLCB7IG1ldGhvZDogJ0RFTEVURScgfSlcbiAgfVxuXG4gIHB1YmxpY1VybChrZXk6IHN0cmluZyk6IHN0cmluZyB8IG51bGwge1xuICAgIGlmICghdGhpcy5idWNrZXQpIHJldHVybiBudWxsXG4gICAgcmV0dXJuIHRoaXMub2JqZWN0VXJsKGtleSlcbiAgfVxuXG4gIHByaXZhdGUgb2JqZWN0VXJsKGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBzYWZlID0ga2V5LnJlcGxhY2UoL15cXC8rLywgJycpXG4gICAgaWYgKHRoaXMuZW5kcG9pbnQpIHtcbiAgICAgIHJldHVybiBgJHt0aGlzLmVuZHBvaW50LnJlcGxhY2UoL1xcLyQvLCAnJyl9LyR7dGhpcy5idWNrZXR9LyR7c2FmZX1gXG4gICAgfVxuICAgIHJldHVybiBgaHR0cHM6Ly8ke3RoaXMuYnVja2V0fS5zMy4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tLyR7c2FmZX1gXG4gIH1cbn1cblxuLyoqIFBpY2sgc3RvcmFnZSBiYWNrZW5kIGZyb20gZW52OiBBU1NFVFNfU1RPUkFHRT1zMyB8IGxvY2FsIChkZWZhdWx0KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVBc3NldFN0b3JhZ2VGcm9tRW52KCk6IEFzc2V0U3RvcmFnZSB7XG4gIGNvbnN0IG1vZGUgPVxuICAgICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFTU0VUU19TVE9SQUdFKSB8fFxuICAgICdsb2NhbCdcbiAgaWYgKG1vZGUgPT09ICdzMycpIHtcbiAgICByZXR1cm4gbmV3IFMzQXNzZXRTdG9yYWdlKClcbiAgfVxuICByZXR1cm4gbmV3IExvY2FsRnNBc3NldFN0b3JhZ2UoKVxufVxuIiwgIi8qKiBQdXJlIGJsb2IgYmFja2VuZCBcdTIwMTQgbm8gREIuICovXG5leHBvcnQgaW50ZXJmYWNlIEFzc2V0U3RvcmFnZSB7XG4gIHdyaXRlKFxuICAgIGtleTogc3RyaW5nLFxuICAgIGJ5dGVzOiBVaW50OEFycmF5LFxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmcsXG4gICk6IFByb21pc2U8dm9pZD5cbiAgcmVhZChrZXk6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IG51bGw+XG4gIGRlbGV0ZShrZXk6IHN0cmluZyk6IFByb21pc2U8dm9pZD5cbiAgLyoqIE9wdGlvbmFsIHB1YmxpYy9zaWduZWQgVVJMIGZvciB0aGUga2V5LiAqL1xuICBwdWJsaWNVcmw/KGtleTogc3RyaW5nKTogc3RyaW5nIHwgbnVsbFxufVxuXG5leHBvcnQgY29uc3QgQUxMT1dFRF9JTUFHRV9UWVBFUyA9IG5ldyBTZXQoW1xuICAnaW1hZ2UvanBlZycsXG4gICdpbWFnZS9wbmcnLFxuICAnaW1hZ2Uvd2VicCcsXG5dKVxuXG5leHBvcnQgY29uc3QgTUFYX0FTU0VUX0JZVEVTID0gMiAqIDEwMjQgKiAxMDI0IC8vIDIgTUJcblxuZXhwb3J0IGZ1bmN0aW9uIGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlKGNvbnRlbnRUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBzd2l0Y2ggKGNvbnRlbnRUeXBlKSB7XG4gICAgY2FzZSAnaW1hZ2UvanBlZyc6XG4gICAgICByZXR1cm4gJ2pwZydcbiAgICBjYXNlICdpbWFnZS9wbmcnOlxuICAgICAgcmV0dXJuICdwbmcnXG4gICAgY2FzZSAnaW1hZ2Uvd2VicCc6XG4gICAgICByZXR1cm4gJ3dlYnAnXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiAnYmluJ1xuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUgeyBBc3NldCwgRGF0YWJhc2UsIE5ld0Fzc2V0IH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgZGVmYXVsdEltYWdlSGFzaGluZ1NlcnZpY2UsXG4gIHR5cGUgSW1hZ2VIYXNoaW5nU2VydmljZSxcbn0gZnJvbSAnLi9oYXNoaW5nLnRzJ1xuaW1wb3J0IHsgY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudiB9IGZyb20gJy4vc3RvcmFnZS9zMy50cydcbmltcG9ydCB7XG4gIEFMTE9XRURfSU1BR0VfVFlQRVMsXG4gIGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlLFxuICBNQVhfQVNTRVRfQllURVMsXG4gIHR5cGUgQXNzZXRTdG9yYWdlLFxufSBmcm9tICcuL3N0b3JhZ2UvdHlwZXMudHMnXG5cbmV4cG9ydCB0eXBlIEFzc2V0UmVjb3JkID0gQXNzZXRcblxuZXhwb3J0IGludGVyZmFjZSBBc3NldFJlcG9zaXRvcnkge1xuICBwdXQoaW5wdXQ6IHtcbiAgICB1c2VySWQ6IG51bWJlclxuICAgIGJ5dGVzOiBVaW50OEFycmF5XG4gICAgY29udGVudFR5cGU6IHN0cmluZ1xuICAgIGZpbGVuYW1lPzogc3RyaW5nXG4gIH0pOiBQcm9taXNlPEFzc2V0UmVjb3JkPlxuXG4gIGdldE1ldGFkYXRhKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxBc3NldFJlY29yZCB8IG51bGw+XG5cbiAgcmVhZEJ5dGVzKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGJ5dGVzOiBVaW50OEFycmF5OyBjb250ZW50VHlwZTogc3RyaW5nIH0gfCBudWxsPlxuXG4gIHJlbGVhc2UoYXNzZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcik6IFByb21pc2U8dm9pZD5cbiAgcmV0YWluKGFzc2V0SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+XG4gIHB1cmdlSWZPcnBoYW4oYXNzZXRJZDogbnVtYmVyKTogUHJvbWlzZTxib29sZWFuPlxuXG4gIGxpc3RSZWNlbnQodXNlcklkOiBudW1iZXIsIGxpbWl0PzogbnVtYmVyKTogUHJvbWlzZTxBc3NldFJlY29yZFtdPlxufVxuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZXhwb3J0IGNsYXNzIERiQXNzZXRSZXBvc2l0b3J5IGltcGxlbWVudHMgQXNzZXRSZXBvc2l0b3J5IHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBkYjogRGJMaWtlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgc3RvcmFnZTogQXNzZXRTdG9yYWdlLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgaGFzaGluZzogSW1hZ2VIYXNoaW5nU2VydmljZSA9IGRlZmF1bHRJbWFnZUhhc2hpbmdTZXJ2aWNlLFxuICApIHt9XG5cbiAgYXN5bmMgcHV0KGlucHV0OiB7XG4gICAgdXNlcklkOiBudW1iZXJcbiAgICBieXRlczogVWludDhBcnJheVxuICAgIGNvbnRlbnRUeXBlOiBzdHJpbmdcbiAgICBmaWxlbmFtZT86IHN0cmluZ1xuICB9KTogUHJvbWlzZTxBc3NldFJlY29yZD4ge1xuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gaW5wdXQuY29udGVudFR5cGUudG9Mb3dlckNhc2UoKS5zcGxpdCgnOycpWzBdLnRyaW0oKVxuICAgIGlmICghQUxMT1dFRF9JTUFHRV9UWVBFUy5oYXMoY29udGVudFR5cGUpKSB7XG4gICAgICB0aHJvdyBuZXcgQXNzZXRWYWxpZGF0aW9uRXJyb3IoXG4gICAgICAgIGB1bnN1cHBvcnRlZCBjb250ZW50IHR5cGU6ICR7Y29udGVudFR5cGV9YCxcbiAgICAgICAgNDE1LFxuICAgICAgKVxuICAgIH1cbiAgICBpZiAoaW5wdXQuYnl0ZXMuYnl0ZUxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKCdlbXB0eSBmaWxlJywgNDAwKVxuICAgIH1cbiAgICBpZiAoaW5wdXQuYnl0ZXMuYnl0ZUxlbmd0aCA+IE1BWF9BU1NFVF9CWVRFUykge1xuICAgICAgdGhyb3cgbmV3IEFzc2V0VmFsaWRhdGlvbkVycm9yKCdmaWxlIHRvbyBsYXJnZScsIDQxMylcbiAgICB9XG5cbiAgICBjb25zdCBzaGEyNTYgPSBhd2FpdCB0aGlzLmhhc2hpbmcuc2hhMjU2KGlucHV0LmJ5dGVzKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIGlucHV0LnVzZXJJZClcbiAgICAgIC53aGVyZSgnc2hhMjU2JywgJz0nLCBzaGEyNTYpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIC8vIERlZHVwIGhpdDogcmV0dXJuIGV4aXN0aW5nIG1ldGFkYXRhLiBDYWxsZXJzIHJldGFpbigpIG9uIGF0dGFjaC5cbiAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgIHJldHVybiBleGlzdGluZ1xuICAgIH1cblxuICAgIGNvbnN0IGV4dCA9IGV4dGVuc2lvbkZvckNvbnRlbnRUeXBlKGNvbnRlbnRUeXBlKVxuICAgIGNvbnN0IHN0b3JhZ2VLZXkgPSBgJHtpbnB1dC51c2VySWR9LyR7c2hhMjU2fS4ke2V4dH1gXG4gICAgYXdhaXQgdGhpcy5zdG9yYWdlLndyaXRlKHN0b3JhZ2VLZXksIGlucHV0LmJ5dGVzLCBjb250ZW50VHlwZSlcblxuICAgIC8vIE5ldyBibG9icyBzdGFydCBhdCByZWZfY291bnQgMDsgY2FsbGVycyByZXRhaW4oKSB3aGVuIGF0dGFjaGluZy5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgICAgLmluc2VydEludG8oJ2Fzc2V0cycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IGlucHV0LnVzZXJJZCxcbiAgICAgICAgICBzaGEyNTYsXG4gICAgICAgICAgY29udGVudF90eXBlOiBjb250ZW50VHlwZSxcbiAgICAgICAgICBieXRlX3NpemU6IGlucHV0LmJ5dGVzLmJ5dGVMZW5ndGgsXG4gICAgICAgICAgc3RvcmFnZV9rZXk6IHN0b3JhZ2VLZXksXG4gICAgICAgICAgcmVmX2NvdW50OiAwLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvcnBoYW5lZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0Fzc2V0KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGF3YWl0IHRoaXMuc3RvcmFnZS5kZWxldGUoc3RvcmFnZUtleSlcbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGdldE1ldGFkYXRhKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTxBc3NldFJlY29yZCB8IG51bGw+IHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5kYlxuICAgICAgLnNlbGVjdEZyb20oJ2Fzc2V0cycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbFxuICB9XG5cbiAgYXN5bmMgcmVhZEJ5dGVzKFxuICAgIGFzc2V0SWQ6IG51bWJlcixcbiAgICB1c2VySWQ6IG51bWJlcixcbiAgKTogUHJvbWlzZTx7IGJ5dGVzOiBVaW50OEFycmF5OyBjb250ZW50VHlwZTogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgY29uc3QgbWV0YSA9IGF3YWl0IHRoaXMuZ2V0TWV0YWRhdGEoYXNzZXRJZCwgdXNlcklkKVxuICAgIGlmICghbWV0YSkgcmV0dXJuIG51bGxcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuc3RvcmFnZS5yZWFkKG1ldGEuc3RvcmFnZV9rZXkpXG4gICAgaWYgKCFieXRlcykgcmV0dXJuIG51bGxcbiAgICByZXR1cm4geyBieXRlcywgY29udGVudFR5cGU6IG1ldGEuY29udGVudF90eXBlIH1cbiAgfVxuXG4gIGFzeW5jIHJldGFpbihhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5nZXRNZXRhZGF0YShhc3NldElkLCB1c2VySWQpXG4gICAgaWYgKCFyb3cpIHRocm93IG5ldyBBc3NldFZhbGlkYXRpb25FcnJvcignYXNzZXQgbm90IGZvdW5kJywgNDA0KVxuICAgIGF3YWl0IHRoaXMuZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYXNzZXRzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICByZWZfY291bnQ6IHJvdy5yZWZfY291bnQgKyAxLFxuICAgICAgICBvcnBoYW5lZF9hdDogbnVsbCxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhc3NldElkKVxuICAgICAgLmV4ZWN1dGUoKVxuICB9XG5cbiAgYXN5bmMgcmVsZWFzZShhc3NldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgdGhpcy5nZXRNZXRhZGF0YShhc3NldElkLCB1c2VySWQpXG4gICAgaWYgKCFyb3cpIHJldHVyblxuICAgIGNvbnN0IG5leHQgPSBNYXRoLm1heCgwLCByb3cucmVmX2NvdW50IC0gMSlcbiAgICBhd2FpdCB0aGlzLmRiXG4gICAgICAudXBkYXRlVGFibGUoJ2Fzc2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgcmVmX2NvdW50OiBuZXh0LFxuICAgICAgICBvcnBoYW5lZF9hdDogbmV4dCA9PT0gMCA/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXNzZXRJZClcbiAgICAgIC5leGVjdXRlKClcbiAgICBpZiAobmV4dCA9PT0gMCkge1xuICAgICAgYXdhaXQgdGhpcy5wdXJnZUlmT3JwaGFuKGFzc2V0SWQpXG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcHVyZ2VJZk9ycGhhbihhc3NldElkOiBudW1iZXIpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCByb3cgPSBhd2FpdCB0aGlzLmRiXG4gICAgICAuc2VsZWN0RnJvbSgnYXNzZXRzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIXJvdyB8fCByb3cucmVmX2NvdW50ID4gMCkgcmV0dXJuIGZhbHNlXG4gICAgYXdhaXQgdGhpcy5zdG9yYWdlLmRlbGV0ZShyb3cuc3RvcmFnZV9rZXkpXG4gICAgYXdhaXQgdGhpcy5kYi5kZWxldGVGcm9tKCdhc3NldHMnKS53aGVyZSgnaWQnLCAnPScsIGFzc2V0SWQpLmV4ZWN1dGUoKVxuICAgIHJldHVybiB0cnVlXG4gIH1cblxuICBhc3luYyBsaXN0UmVjZW50KHVzZXJJZDogbnVtYmVyLCBsaW1pdCA9IDIwKTogUHJvbWlzZTxBc3NldFJlY29yZFtdPiB7XG4gICAgcmV0dXJuIGF3YWl0IHRoaXMuZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhc3NldHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3JlZl9jb3VudCcsICc+JywgMClcbiAgICAgIC5vcmRlckJ5KCdjcmVhdGVkX2F0JywgJ2Rlc2MnKVxuICAgICAgLmxpbWl0KGxpbWl0KVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEFzc2V0VmFsaWRhdGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgc3RhdHVzOiBudW1iZXIsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0Fzc2V0VmFsaWRhdGlvbkVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVEZWZhdWx0QXNzZXRSZXBvc2l0b3J5KFxuICBkYjogRGJMaWtlLFxuKTogRGJBc3NldFJlcG9zaXRvcnkge1xuICBjb25zdCBzdG9yYWdlID0gY3JlYXRlQXNzZXRTdG9yYWdlRnJvbUVudigpXG4gIHJldHVybiBuZXcgRGJBc3NldFJlcG9zaXRvcnkoZGIsIHN0b3JhZ2UpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc3NldFB1YmxpY1BhdGgoYXNzZXRJZDogbnVtYmVyKTogc3RyaW5nIHtcbiAgcmV0dXJuIGAvYXNzZXRzLyR7YXNzZXRJZH1gXG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsXG4gICAgJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxuICB0eXBlIFZlcmlmaWVkQXV0aCxcbn0gZnJvbSAnLi4vYXV0aC92ZXJpZnkudHMnXG5cbi8qKiBQdWJsaWMgQUxCIC8gbG9hZC1iYWxhbmNlciBoZWFsdGggY2hlY2suICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGVhbHRoTWlkZGxld2FyZShcbiAgY3R4OiBDb250ZXh0LFxuICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuKSB7XG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCA9PT0gJy9oZWFsdGgnICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSB9KSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgYXdhaXQgbmV4dCgpXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlclJlZiA9IHtcbiAgaWQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBSZXNvbHZlTG9jYWxVc2VyRm4gPSAoXG4gIGlkZW50aXR5OiBWZXJpZmllZEF1dGgsXG4pID0+IFByb21pc2U8TG9jYWxVc2VyUmVmPlxuXG4vKipcbiAqIFJlcXVpcmUgYSB2YWxpZCBCZWFyZXIgSldUIG9uIGAvZ3JhcGhxbGAgYW5kIHNldCBQeWxvbiBjb250ZXh0IHZhcnM6XG4gKiBgdXNlcklkYCwgYGF1dGhVc2VySWRgLCBvcHRpb25hbCBgYXV0aEVtYWlsYC5cbiAqXG4gKiBDYWxsZXJzIHRoYXQgbmVlZCBhdXRoIGZvciBvdGhlciBwYXRocyAoZS5nLiBSRVNUIGFzc2V0cykgc2hvdWxkIGhhbmRsZVxuICogdGhvc2UgYmVmb3JlIHRoaXMgbWlkZGxld2FyZSBvciB1c2UgYHZlcmlmeUFjY2Vzc1Rva2VuYCBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgcmVzb2x2ZUxvY2FsVXNlcjogUmVzb2x2ZUxvY2FsVXNlckZuLFxuKSB7XG4gIHJldHVybiBhc3luYyBmdW5jdGlvbiBncmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gICAgY3R4OiBDb250ZXh0LFxuICAgIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gICAgaWYgKFxuICAgICAgcGF0aCA9PT0gJy9oZWFsdGgnIHx8XG4gICAgICAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSlcbiAgICApIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih2ZXJpZmllZClcblxuICAgIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICAgIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gICAgfVxuICAgIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICAgIGF3YWl0IG5leHQoKVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEt5c2VseSwgU2VsZWN0YWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLyoqIE1pbmltYWwgdXNlcnMgdGFibGUgc2hhcGUgcmVxdWlyZWQgYnkgcmVzb2x2ZUxvY2FsVXNlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFVzZXJzRGF0YWJhc2UgPSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcjxEQiBleHRlbmRzIFVzZXJzRGF0YWJhc2U+KFxuICBkYjogS3lzZWx5PERCPixcbiAgaWRlbnRpdHk6IEF1dGhJZGVudGl0eSxcbik6IFByb21pc2U8U2VsZWN0YWJsZTxEQlsndXNlcnMnXT4+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgYXMgcmVzb2x2ZUxvY2FsVXNlcktpdCB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXIoaWRlbnRpdHk6IEF1dGhJZGVudGl0eSk6IFByb21pc2U8VXNlcj4ge1xuICByZXR1cm4gcmVzb2x2ZUxvY2FsVXNlcktpdChkYiwgaWRlbnRpdHkpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBQdXNoU2VuZGVyIH0gZnJvbSAnZGVub19hcGlfa2l0L3B1c2gvbW9kLnRzJ1xuaW1wb3J0IHsgTm9PcFB1c2hTZW5kZXIgfSBmcm9tICdkZW5vX2FwaV9raXQvcHVzaC9tb2QudHMnXG5cbmxldCBwdXNoU2VuZGVyOiBQdXNoU2VuZGVyID0gbmV3IE5vT3BQdXNoU2VuZGVyKClcblxuZXhwb3J0IGZ1bmN0aW9uIHNldFB1c2hTZW5kZXIoc2VuZGVyOiBQdXNoU2VuZGVyKTogdm9pZCB7XG4gIHB1c2hTZW5kZXIgPSBzZW5kZXJcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFB1c2hTZW5kZXIoKTogUHVzaFNlbmRl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ZEZpbGUiLCAicmVzdWx0IiwgImdldENvbnRleHQiLCAiY29uZmlnIiwgImRiIiwgImdyYW50UmV3YXJkc0ZvckdvYWxDeWNsZVN1Y2Nlc3MiLCAiY29uZmlnIiwgInJlc3VsdCIsICJwYXJzZUpzb24iLCAiZGIiLCAiZGVhZGxpbmUiLCAic3RhdGUiLCAiZ3JhbnRSZXdhcmRzRm9yR29hbEN5Y2xlU3VjY2VzcyIsICJwYXJzZUpzb24iLCAiY29uZmlnIiwgImN5Y2xlIiwgInJlc3VsdCIsICJnZXRDb250ZXh0IiwgImVudiIsICJkYiIsICJyZXF1aXJlVXNlcklkIiwgImdldENvbnRleHQiLCAicGFyc2VDb25maWciLCAiYnVpbGRSZXdhcmROdWRnZXMiLCAiY29uZmlnIiwgInJlc3VsdCIsICJyZXF1aXJlVXNlcklkIiwgImdldENvbnRleHQiLCAicGFyc2VDb25maWciLCAiY29uZmlnIiwgInJlc3VsdCIsICJhY3Rpdml0eSIsICJjb21wbGV0aW9uIiwgInJlc29sdmVMb2NhbFVzZXIiLCAiZGIiLCAicmVzb2x2ZUxvY2FsVXNlciIsICJwdXNoU2VuZGVyIiwgInJlc29sdmVMb2NhbFVzZXIiLCAicmVzdWx0Il0KfQo=
