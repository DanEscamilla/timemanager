// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";
import { sql } from "kysely";

// src/budgets/period.ts
function parseDateOnly(value) {
  const d = /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
    throw new Error(`invalid date: ${value}`);
  }
  return d;
}
function formatDateOnly(d) {
  return d.toISOString().slice(0, 10);
}
function daysBetweenUtc(from, to) {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1e3));
}
function addMonthsUtc(date, months) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
function addInterval(dateOnly, unit, count) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("interval count must be a positive integer");
  }
  const d = parseDateOnly(dateOnly);
  if (unit === "day") {
    d.setUTCDate(d.getUTCDate() + count);
    return formatDateOnly(d);
  }
  if (unit === "week") {
    d.setUTCDate(d.getUTCDate() + count * 7);
    return formatDateOnly(d);
  }
  return formatDateOnly(addMonthsUtc(d, count));
}
function currentPeriod(args) {
  const { anchorDate, intervalUnit, intervalCount, asOf } = args;
  if (asOf < anchorDate) return null;
  if (intervalUnit === "day" || intervalUnit === "week") {
    const periodDays = intervalUnit === "day" ? intervalCount : intervalCount * 7;
    const anchor = parseDateOnly(anchorDate);
    const asOfDate = parseDateOnly(asOf);
    const elapsed = daysBetweenUtc(anchor, asOfDate);
    const index = Math.floor(elapsed / periodDays);
    const startDate = new Date(anchor);
    startDate.setUTCDate(startDate.getUTCDate() + index * periodDays);
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + periodDays);
    return {
      start: formatDateOnly(startDate),
      endExclusive: formatDateOnly(endDate)
    };
  }
  let start = anchorDate;
  let endExclusive = addInterval(start, "month", intervalCount);
  for (let i = 0; i < 2e3; i++) {
    if (asOf >= start && asOf < endExclusive) {
      return { start, endExclusive };
    }
    start = endExclusive;
    endExclusive = addInterval(start, "month", intervalCount);
  }
  throw new Error("failed to resolve monthly period");
}

// src/db/types/schema.ts
import "kysely";

// src/db/database.ts
import { createKysely } from "deno_api_kit/db/create_kysely.ts";
import { env } from "deno_api_kit/db/env.ts";
var db = createKysely({
  defaultDatabase: "spendmanager"
});

// src/graphql/validation.ts
var InvalidCategoryError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidCategoryError";
  }
};
var InvalidExpenseError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidExpenseError";
  }
};
var InvalidBudgetError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidBudgetError";
  }
};
var HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
var CURRENCY = /^[A-Z]{3}$/;
var INTERVAL_UNITS = /* @__PURE__ */ new Set(["day", "week", "month"]);
function validateCategoryName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidCategoryError("name is required");
  }
  if (trimmed.length > 255) {
    throw new InvalidCategoryError("name is too long");
  }
  return trimmed;
}
function validateCategoryColor(color) {
  const trimmed = color.trim();
  if (!HEX_COLOR.test(trimmed)) {
    throw new InvalidCategoryError("color must be a hex value like #0F766E");
  }
  return trimmed.toUpperCase();
}
function validateAmountCents(amountCents) {
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
    throw new InvalidExpenseError("amount_cents must be an integer");
  }
  if (amountCents <= 0) {
    throw new InvalidExpenseError("amount_cents must be positive");
  }
  return amountCents;
}
function validateCurrency(currency) {
  const trimmed = currency.trim().toUpperCase();
  if (!CURRENCY.test(trimmed)) {
    throw new InvalidExpenseError("currency must be a 3-letter ISO code");
  }
  return trimmed;
}
function validateSpentOn(spentOn) {
  const trimmed = spentOn.trim();
  if (!DATE_ONLY.test(trimmed)) {
    throw new InvalidExpenseError("spent_on must be YYYY-MM-DD");
  }
  const d = /* @__PURE__ */ new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== trimmed) {
    throw new InvalidExpenseError("spent_on is not a valid date");
  }
  return trimmed;
}
function validateNote(note) {
  if (note == null) return null;
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}
function validateBudgetName(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidBudgetError("name is required");
  }
  if (trimmed.length > 255) {
    throw new InvalidBudgetError("name is too long");
  }
  return trimmed;
}
function validateBudgetAmountCents(amountCents) {
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
    throw new InvalidBudgetError("amount_cents must be an integer");
  }
  if (amountCents <= 0) {
    throw new InvalidBudgetError("amount_cents must be positive");
  }
  return amountCents;
}
function validateIntervalUnit(unit) {
  const trimmed = unit.trim().toLowerCase();
  if (!INTERVAL_UNITS.has(trimmed)) {
    throw new InvalidBudgetError("interval_unit must be day, week, or month");
  }
  return trimmed;
}
function validateIntervalCount(count) {
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
    throw new InvalidBudgetError("interval_count must be an integer >= 1");
  }
  return count;
}
function validateAlertPercent(percent) {
  if (!Number.isFinite(percent) || !Number.isInteger(percent)) {
    throw new InvalidBudgetError("alert_percent must be an integer");
  }
  if (percent < 1 || percent > 100) {
    throw new InvalidBudgetError("alert_percent must be between 1 and 100");
  }
  return percent;
}
function validateAnchorDate(anchorDate) {
  try {
    return validateSpentOn(anchorDate);
  } catch {
    throw new InvalidBudgetError("anchor_date must be YYYY-MM-DD");
  }
}

// src/graphql/resolvers/resolvers.ts
function requireUserId() {
  const userId = getContext().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function asNumber(value) {
  if (typeof value === "number") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new InvalidExpenseError("invalid amount");
  }
  return n;
}
function todayUtc() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function mapExpense(row) {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents)
  };
}
function mapBudget(row) {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents)
  };
}
async function fetchOwnedCategory(categoryId, userId) {
  return await db.selectFrom("categories").where("id", "=", categoryId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
async function fetchOwnedBudget(budgetId, userId) {
  return await db.selectFrom("budgets").where("id", "=", budgetId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
async function sumExpensesInPeriod(args) {
  let query = db.selectFrom("expenses").where("user_id", "=", args.userId).where("currency", "=", args.currency).where("spent_on", ">=", args.fromDate).where("spent_on", "<", args.toDateExclusive).select(sql`coalesce(sum(amount_cents), 0)`.as("total_cents"));
  if (args.categoryId != null) {
    query = query.where("category_id", "=", args.categoryId);
  }
  const row = await query.executeTakeFirstOrThrow();
  return asNumber(row.total_cents);
}
var Query = {
  categories: async (args) => {
    const userId = requireUserId();
    let query = db.selectFrom("categories").where("user_id", "=", userId).orderBy("name", "asc").selectAll();
    if (!args?.includeArchived) {
      query = query.where("archived_at", "is", null);
    }
    return await query.execute();
  },
  category: async (args) => {
    const userId = requireUserId();
    return await db.selectFrom("categories").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst() ?? null;
  },
  expenses: async (args) => {
    const userId = requireUserId();
    let query = db.selectFrom("expenses").where("user_id", "=", userId).orderBy("spent_on", "desc").orderBy("id", "desc").selectAll();
    if (args?.fromDate) {
      query = query.where("spent_on", ">=", validateSpentOn(args.fromDate));
    }
    if (args?.toDate) {
      query = query.where("spent_on", "<=", validateSpentOn(args.toDate));
    }
    if (args?.categoryId != null) {
      query = query.where("category_id", "=", args.categoryId);
    }
    const rows = await query.execute();
    return rows.map(mapExpense);
  },
  expense: async (args) => {
    const userId = requireUserId();
    const row = await db.selectFrom("expenses").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? mapExpense(row) : null;
  },
  expenseTotals: async (args) => {
    const userId = requireUserId();
    const fromDate = validateSpentOn(args.fromDate);
    const toDate = validateSpentOn(args.toDate);
    const rows = await db.selectFrom("expenses").innerJoin("categories", "categories.id", "expenses.category_id").where("expenses.user_id", "=", userId).where("expenses.spent_on", ">=", fromDate).where("expenses.spent_on", "<=", toDate).select([
      "expenses.category_id",
      "categories.name as category_name",
      "categories.color as category_color",
      "expenses.currency",
      sql`sum(expenses.amount_cents)`.as("total_cents")
    ]).groupBy([
      "expenses.category_id",
      "categories.name",
      "categories.color",
      "expenses.currency"
    ]).orderBy("total_cents", "desc").execute();
    return rows.map((row) => ({
      category_id: row.category_id,
      category_name: row.category_name,
      category_color: row.category_color,
      currency: row.currency,
      total_cents: asNumber(row.total_cents)
    }));
  },
  budgets: async (args) => {
    const userId = requireUserId();
    let query = db.selectFrom("budgets").where("user_id", "=", userId).orderBy("name", "asc").selectAll();
    if (!args?.includeArchived) {
      query = query.where("archived_at", "is", null);
    }
    const rows = await query.execute();
    return rows.map(mapBudget);
  },
  budget: async (args) => {
    const userId = requireUserId();
    const row = await fetchOwnedBudget(args.id, userId);
    return row ? mapBudget(row) : null;
  },
  budgetStatuses: async (args) => {
    const userId = requireUserId();
    const asOf = args?.asOf != null ? validateSpentOn(args.asOf) : todayUtc();
    const budgets = await db.selectFrom("budgets").where("user_id", "=", userId).where("archived_at", "is", null).orderBy("name", "asc").selectAll().execute();
    const statuses = [];
    for (const budget of budgets) {
      const amountCents = asNumber(budget.amount_cents);
      const period = currentPeriod({
        anchorDate: budget.anchor_date,
        intervalUnit: budget.interval_unit,
        intervalCount: budget.interval_count,
        asOf
      });
      if (!period) {
        statuses.push({
          budget_id: budget.id,
          budget_name: budget.name,
          category_id: budget.category_id,
          currency: budget.currency,
          amount_cents: amountCents,
          spent_cents: 0,
          percent_used: 0,
          alert_percent: budget.alert_percent,
          alert_triggered: false,
          period_start: null,
          period_end_exclusive: null
        });
        continue;
      }
      const spentCents = await sumExpensesInPeriod({
        userId,
        categoryId: budget.category_id,
        currency: budget.currency,
        fromDate: period.start,
        toDateExclusive: period.endExclusive
      });
      const percentUsed = amountCents > 0 ? Math.floor(spentCents * 100 / amountCents) : 0;
      const alertTriggered = percentUsed >= budget.alert_percent;
      statuses.push({
        budget_id: budget.id,
        budget_name: budget.name,
        category_id: budget.category_id,
        currency: budget.currency,
        amount_cents: amountCents,
        spent_cents: spentCents,
        percent_used: percentUsed,
        alert_percent: budget.alert_percent,
        alert_triggered: alertTriggered,
        period_start: period.start,
        period_end_exclusive: period.endExclusive
      });
    }
    return statuses;
  }
};
var Mutation = {
  createCategory: async (args) => {
    const userId = requireUserId();
    const name = validateCategoryName(args.input.name);
    const color = validateCategoryColor(args.input.color);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      return await db.insertInto("categories").values({
        user_id: userId,
        name,
        color,
        archived_at: null,
        created_at: now,
        updated_at: now
      }).returningAll().executeTakeFirstOrThrow();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("categories_user_id_lower_name_active_unique")) {
        throw new InvalidCategoryError("a category with this name already exists");
      }
      throw err;
    }
  },
  updateCategory: async (args) => {
    const userId = requireUserId();
    const existing = await fetchOwnedCategory(args.id, userId);
    if (!existing) {
      throw new InvalidCategoryError("category not found");
    }
    if (existing.archived_at != null) {
      throw new InvalidCategoryError("cannot update an archived category");
    }
    const name = args.input.name !== void 0 ? validateCategoryName(args.input.name) : existing.name;
    const color = args.input.color !== void 0 ? validateCategoryColor(args.input.color) : existing.color;
    try {
      return await db.updateTable("categories").set({
        name,
        color,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (message.includes("categories_user_id_lower_name_active_unique")) {
        throw new InvalidCategoryError("a category with this name already exists");
      }
      throw err;
    }
  },
  archiveCategory: async (args) => {
    const userId = requireUserId();
    const existing = await fetchOwnedCategory(args.id, userId);
    if (!existing) {
      throw new InvalidCategoryError("category not found");
    }
    if (existing.archived_at != null) {
      return existing;
    }
    return await db.updateTable("categories").set({
      archived_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
  },
  createExpense: async (args) => {
    const userId = requireUserId();
    const category = await fetchOwnedCategory(args.input.categoryId, userId);
    if (!category || category.archived_at != null) {
      throw new InvalidExpenseError("category not found");
    }
    const amountCents = validateAmountCents(args.input.amountCents);
    const spentOn = validateSpentOn(args.input.spentOn);
    const currency = validateCurrency(args.input.currency ?? "USD");
    const note = validateNote(args.input.note);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.insertInto("expenses").values({
      user_id: userId,
      category_id: category.id,
      amount_cents: amountCents,
      currency,
      spent_on: spentOn,
      note,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return mapExpense(row);
  },
  updateExpense: async (args) => {
    const userId = requireUserId();
    const existing = await db.selectFrom("expenses").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!existing) {
      throw new InvalidExpenseError("expense not found");
    }
    let categoryId = existing.category_id;
    if (args.input.categoryId !== void 0) {
      const category = await fetchOwnedCategory(args.input.categoryId, userId);
      if (!category || category.archived_at != null) {
        throw new InvalidExpenseError("category not found");
      }
      categoryId = category.id;
    }
    const amountCents = args.input.amountCents !== void 0 ? validateAmountCents(args.input.amountCents) : asNumber(existing.amount_cents);
    const spentOn = args.input.spentOn !== void 0 ? validateSpentOn(args.input.spentOn) : existing.spent_on;
    const currency = args.input.currency !== void 0 ? validateCurrency(args.input.currency) : existing.currency;
    const note = args.input.note !== void 0 ? validateNote(args.input.note) : existing.note;
    const row = await db.updateTable("expenses").set({
      category_id: categoryId,
      amount_cents: amountCents,
      currency,
      spent_on: spentOn,
      note,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapExpense(row);
  },
  deleteExpense: async (args) => {
    const userId = requireUserId();
    const result = await db.deleteFrom("expenses").where("id", "=", args.id).where("user_id", "=", userId).execute();
    return result.length > 0 && Number(result[0]?.numDeletedRows ?? 0) > 0;
  },
  createBudget: async (args) => {
    const userId = requireUserId();
    const name = validateBudgetName(args.input.name);
    const amountCents = validateBudgetAmountCents(args.input.amountCents);
    const intervalUnit = validateIntervalUnit(args.input.intervalUnit);
    const intervalCount = validateIntervalCount(args.input.intervalCount);
    const anchorDate = validateAnchorDate(args.input.anchorDate);
    const alertPercent = validateAlertPercent(args.input.alertPercent);
    const currency = validateCurrency(args.input.currency ?? "USD");
    let categoryId = null;
    if (args.input.categoryId != null) {
      const category = await fetchOwnedCategory(args.input.categoryId, userId);
      if (!category || category.archived_at != null) {
        throw new InvalidBudgetError("category not found");
      }
      categoryId = category.id;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const row = await db.insertInto("budgets").values({
      user_id: userId,
      name,
      category_id: categoryId,
      amount_cents: amountCents,
      currency,
      interval_unit: intervalUnit,
      interval_count: intervalCount,
      anchor_date: anchorDate,
      alert_percent: alertPercent,
      archived_at: null,
      created_at: now,
      updated_at: now
    }).returningAll().executeTakeFirstOrThrow();
    return mapBudget(row);
  },
  updateBudget: async (args) => {
    const userId = requireUserId();
    const existing = await fetchOwnedBudget(args.id, userId);
    if (!existing) {
      throw new InvalidBudgetError("budget not found");
    }
    if (existing.archived_at != null) {
      throw new InvalidBudgetError("cannot update an archived budget");
    }
    const name = args.input.name !== void 0 ? validateBudgetName(args.input.name) : existing.name;
    const amountCents = args.input.amountCents !== void 0 ? validateBudgetAmountCents(args.input.amountCents) : asNumber(existing.amount_cents);
    const intervalUnit = args.input.intervalUnit !== void 0 ? validateIntervalUnit(args.input.intervalUnit) : validateIntervalUnit(existing.interval_unit);
    const intervalCount = args.input.intervalCount !== void 0 ? validateIntervalCount(args.input.intervalCount) : existing.interval_count;
    const anchorDate = args.input.anchorDate !== void 0 ? validateAnchorDate(args.input.anchorDate) : existing.anchor_date;
    const alertPercent = args.input.alertPercent !== void 0 ? validateAlertPercent(args.input.alertPercent) : existing.alert_percent;
    const currency = args.input.currency !== void 0 ? validateCurrency(args.input.currency) : existing.currency;
    let categoryId = existing.category_id;
    if (args.input.categoryId !== void 0) {
      if (args.input.categoryId == null) {
        categoryId = null;
      } else {
        const category = await fetchOwnedCategory(args.input.categoryId, userId);
        if (!category || category.archived_at != null) {
          throw new InvalidBudgetError("category not found");
        }
        categoryId = category.id;
      }
    }
    const row = await db.updateTable("budgets").set({
      name,
      category_id: categoryId,
      amount_cents: amountCents,
      currency,
      interval_unit: intervalUnit,
      interval_count: intervalCount,
      anchor_date: anchorDate,
      alert_percent: alertPercent,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapBudget(row);
  },
  archiveBudget: async (args) => {
    const userId = requireUserId();
    const existing = await fetchOwnedBudget(args.id, userId);
    if (!existing) {
      throw new InvalidBudgetError("budget not found");
    }
    if (existing.archived_at != null) {
      return mapBudget(existing);
    }
    const row = await db.updateTable("budgets").set({
      archived_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapBudget(row);
  }
};
var resolvers = {
  Query,
  Mutation
};

// src/index.ts
import { corsMiddleware } from "deno_api_kit/auth/verify.ts";
import {
  createGraphQLAuthMiddleware,
  healthMiddleware
} from "deno_api_kit/pylon/middleware.ts";

// src/db/users.ts
import { resolveLocalUser as resolveLocalUserKit } from "deno_api_kit/db/users.ts";
async function resolveLocalUser(identity) {
  return resolveLocalUserKit(db, identity);
}

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
app.use(corsMiddleware);
app.use(healthMiddleware);
app.use(createGraphQLAuthMiddleware(resolveLocalUser));
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
  typeDefs: "input ArgsInput {\n	includeArchived: Boolean\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	fromDate: String\n	toDate: String\n	categoryId: Number\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	fromDate: String!\n	toDate: String!\n}\ninput ArgsInput_5 {\n	includeArchived: Boolean\n}\ninput ArgsInput_6 {\n	id: Number!\n}\ninput ArgsInput_7 {\n	asOf: String\n}\ninput ArgsInput_8 {\n	input: CreateCategoryInputInput!\n}\ninput CreateCategoryInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_9 {\n	id: Number!\n	input: UpdateCategoryInputInput!\n}\ninput UpdateCategoryInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	input: CreateExpenseInputInput!\n}\ninput CreateExpenseInputInput {\n	categoryId: Number!\n	amountCents: Number!\n	spentOn: String!\n	currency: String\n	note: String\n}\ninput ArgsInput_12 {\n	id: Number!\n	input: UpdateExpenseInputInput!\n}\ninput UpdateExpenseInputInput {\n	categoryId: Number\n	amountCents: Number\n	spentOn: String\n	currency: String\n	note: String\n}\ninput ArgsInput_13 {\n	id: Number!\n}\ninput ArgsInput_14 {\n	input: CreateBudgetInputInput!\n}\ninput CreateBudgetInputInput {\n	name: String!\n	amountCents: Number!\n	intervalUnit: String!\n	intervalCount: Number!\n	anchorDate: String!\n	alertPercent: Number!\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_15 {\n	id: Number!\n	input: UpdateBudgetInputInput!\n}\ninput UpdateBudgetInputInput {\n	name: String\n	amountCents: Number\n	intervalUnit: String\n	intervalCount: Number\n	anchorDate: String\n	alertPercent: Number\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ntype Query {\ncategories(args: ArgsInput): Any!\ncategory(args: ArgsInput_1!): Any!\nexpenses(args: ArgsInput_2): Any!\nexpense(args: ArgsInput_3!): Expense\nexpenseTotals(args: ArgsInput_4!): Any!\nbudgets(args: ArgsInput_5): Any!\nbudget(args: ArgsInput_6!): Budget\nbudgetStatuses(args: ArgsInput_7): [BudgetStatusesOrBudgetStatuses_1!]!\n}\ntype Expense {\namount_cents: Number!\nid: Number!\nuser_id: Number!\ncategory_id: Number!\ncurrency: String!\nspent_on: String!\nnote: String\ncreated_at: String!\nupdated_at: String!\n}\ntype Budget {\namount_cents: Number!\nid: Number!\nuser_id: Number!\nname: String!\ncategory_id: Number\ncurrency: String!\ninterval_unit: String!\ninterval_count: Number!\nanchor_date: String!\nalert_percent: Number!\narchived_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype BudgetStatuses implements BudgetStatusesOrBudgetStatuses_1 {\nbudget_id: Any!\nbudget_name: Any!\ncategory_id: Any!\ncurrency: Any!\namount_cents: Number!\nspent_cents: Number!\npercent_used: Number!\nalert_percent: Any!\nalert_triggered: Boolean!\n}\ntype BudgetStatuses_1 implements BudgetStatusesOrBudgetStatuses_1 {\nbudget_id: Any!\nbudget_name: Any!\ncategory_id: Any!\ncurrency: Any!\namount_cents: Number!\nspent_cents: Number!\npercent_used: Number!\nalert_percent: Any!\nalert_triggered: Boolean!\nperiod_start: String!\nperiod_end_exclusive: String!\n}\ntype Mutation {\ncreateCategory(args: ArgsInput_8!): Any!\nupdateCategory(args: ArgsInput_9!): Any!\narchiveCategory(args: ArgsInput_10!): Any!\ncreateExpense(args: ArgsInput_11!): Expense!\nupdateExpense(args: ArgsInput_12!): Expense!\ndeleteExpense(args: ArgsInput_13!): Boolean!\ncreateBudget(args: ArgsInput_14!): Budget!\nupdateBudget(args: ArgsInput_15!): Budget!\narchiveBudget(args: ArgsInput_16!): Budget!\n}\ninterface BudgetStatusesOrBudgetStatuses_1 {\nbudget_id: Any!\nbudget_name: Any!\ncategory_id: Any!\ncurrency: Any!\namount_cents: Number!\nspent_cents: Number!\npercent_used: Number!\nalert_percent: Any!\nalert_triggered: Boolean!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: { BudgetStatusesOrBudgetStatuses_1: { __resolveType: function resolveType(node) {
    if (node && typeof node === "object") {
      if ("budget_id" in node && "budget_name" in node && "category_id" in node && "currency" in node && "amount_cents" in node && "spent_cents" in node && "percent_used" in node && "alert_percent" in node && "alert_triggered" in node && "period_start" in node && "period_end_exclusive" in node) {
        return "BudgetStatuses_1";
      }
      ;
      if ("budget_id" in node && "budget_name" in node && "category_id" in node && "currency" in node && "amount_cents" in node && "spent_cents" in node && "percent_used" in node && "alert_percent" in node && "alert_triggered" in node) {
        return "BudgetStatuses";
      }
      ;
    }
  } } },
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2J1ZGdldHMvcGVyaW9kLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vc3JjL2RiL2RhdGFiYXNlLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3ZhbGlkYXRpb24udHMiLCAiLi4vc3JjL2RiL3VzZXJzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBhcHAgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgcmVzb2x2ZXJzIH0gZnJvbSAnLi9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMnXG5pbXBvcnQgeyBjb3JzTWlkZGxld2FyZSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZSxcbiAgaGVhbHRoTWlkZGxld2FyZSxcbn0gZnJvbSAnZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcbmFwcC51c2UoaGVhbHRoTWlkZGxld2FyZSlcbmFwcC51c2UoY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKHJlc29sdmVMb2NhbFVzZXIpKVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdGluY2x1ZGVBcmNoaXZlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzQge1xcblxcdGZyb21EYXRlOiBTdHJpbmchXFxuXFx0dG9EYXRlOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF81IHtcXG5cXHRpbmNsdWRlQXJjaGl2ZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRhc09mOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMSB7XFxuXFx0aW5wdXQ6IENyZWF0ZUV4cGVuc2VJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCB7XFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0c3BlbnRPbjogU3RyaW5nIVxcblxcdGN1cnJlbmN5OiBTdHJpbmdcXG5cXHRub3RlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEyIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcblxcdGFtb3VudENlbnRzOiBOdW1iZXJcXG5cXHRzcGVudE9uOiBTdHJpbmdcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpbnB1dDogQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0aW50ZXJ2YWxVbml0OiBTdHJpbmchXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyIVxcblxcdGFuY2hvckRhdGU6IFN0cmluZyFcXG5cXHRhbGVydFBlcmNlbnQ6IE51bWJlciFcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNSB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0YW1vdW50Q2VudHM6IE51bWJlclxcblxcdGludGVydmFsVW5pdDogU3RyaW5nXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyXFxuXFx0YW5jaG9yRGF0ZTogU3RyaW5nXFxuXFx0YWxlcnRQZXJjZW50OiBOdW1iZXJcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxudHlwZSBRdWVyeSB7XFxuY2F0ZWdvcmllcyhhcmdzOiBBcmdzSW5wdXQpOiBBbnkhXFxuY2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzEhKTogQW55IVxcbmV4cGVuc2VzKGFyZ3M6IEFyZ3NJbnB1dF8yKTogQW55IVxcbmV4cGVuc2UoYXJnczogQXJnc0lucHV0XzMhKTogRXhwZW5zZVxcbmV4cGVuc2VUb3RhbHMoYXJnczogQXJnc0lucHV0XzQhKTogQW55IVxcbmJ1ZGdldHMoYXJnczogQXJnc0lucHV0XzUpOiBBbnkhXFxuYnVkZ2V0KGFyZ3M6IEFyZ3NJbnB1dF82ISk6IEJ1ZGdldFxcbmJ1ZGdldFN0YXR1c2VzKGFyZ3M6IEFyZ3NJbnB1dF83KTogW0J1ZGdldFN0YXR1c2VzT3JCdWRnZXRTdGF0dXNlc18xIV0hXFxufVxcbnR5cGUgRXhwZW5zZSB7XFxuYW1vdW50X2NlbnRzOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxuY2F0ZWdvcnlfaWQ6IE51bWJlciFcXG5jdXJyZW5jeTogU3RyaW5nIVxcbnNwZW50X29uOiBTdHJpbmchXFxubm90ZTogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBCdWRnZXQge1xcbmFtb3VudF9jZW50czogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5jYXRlZ29yeV9pZDogTnVtYmVyXFxuY3VycmVuY3k6IFN0cmluZyFcXG5pbnRlcnZhbF91bml0OiBTdHJpbmchXFxuaW50ZXJ2YWxfY291bnQ6IE51bWJlciFcXG5hbmNob3JfZGF0ZTogU3RyaW5nIVxcbmFsZXJ0X3BlcmNlbnQ6IE51bWJlciFcXG5hcmNoaXZlZF9hdDogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBCdWRnZXRTdGF0dXNlcyBpbXBsZW1lbnRzIEJ1ZGdldFN0YXR1c2VzT3JCdWRnZXRTdGF0dXNlc18xIHtcXG5idWRnZXRfaWQ6IEFueSFcXG5idWRnZXRfbmFtZTogQW55IVxcbmNhdGVnb3J5X2lkOiBBbnkhXFxuY3VycmVuY3k6IEFueSFcXG5hbW91bnRfY2VudHM6IE51bWJlciFcXG5zcGVudF9jZW50czogTnVtYmVyIVxcbnBlcmNlbnRfdXNlZDogTnVtYmVyIVxcbmFsZXJ0X3BlcmNlbnQ6IEFueSFcXG5hbGVydF90cmlnZ2VyZWQ6IEJvb2xlYW4hXFxufVxcbnR5cGUgQnVkZ2V0U3RhdHVzZXNfMSBpbXBsZW1lbnRzIEJ1ZGdldFN0YXR1c2VzT3JCdWRnZXRTdGF0dXNlc18xIHtcXG5idWRnZXRfaWQ6IEFueSFcXG5idWRnZXRfbmFtZTogQW55IVxcbmNhdGVnb3J5X2lkOiBBbnkhXFxuY3VycmVuY3k6IEFueSFcXG5hbW91bnRfY2VudHM6IE51bWJlciFcXG5zcGVudF9jZW50czogTnVtYmVyIVxcbnBlcmNlbnRfdXNlZDogTnVtYmVyIVxcbmFsZXJ0X3BlcmNlbnQ6IEFueSFcXG5hbGVydF90cmlnZ2VyZWQ6IEJvb2xlYW4hXFxucGVyaW9kX3N0YXJ0OiBTdHJpbmchXFxucGVyaW9kX2VuZF9leGNsdXNpdmU6IFN0cmluZyFcXG59XFxudHlwZSBNdXRhdGlvbiB7XFxuY3JlYXRlQ2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzghKTogQW55IVxcbnVwZGF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF85ISk6IEFueSFcXG5hcmNoaXZlQ2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzEwISk6IEFueSFcXG5jcmVhdGVFeHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8xMSEpOiBFeHBlbnNlIVxcbnVwZGF0ZUV4cGVuc2UoYXJnczogQXJnc0lucHV0XzEyISk6IEV4cGVuc2UhXFxuZGVsZXRlRXhwZW5zZShhcmdzOiBBcmdzSW5wdXRfMTMhKTogQm9vbGVhbiFcXG5jcmVhdGVCdWRnZXQoYXJnczogQXJnc0lucHV0XzE0ISk6IEJ1ZGdldCFcXG51cGRhdGVCdWRnZXQoYXJnczogQXJnc0lucHV0XzE1ISk6IEJ1ZGdldCFcXG5hcmNoaXZlQnVkZ2V0KGFyZ3M6IEFyZ3NJbnB1dF8xNiEpOiBCdWRnZXQhXFxufVxcbmludGVyZmFjZSBCdWRnZXRTdGF0dXNlc09yQnVkZ2V0U3RhdHVzZXNfMSB7XFxuYnVkZ2V0X2lkOiBBbnkhXFxuYnVkZ2V0X25hbWU6IEFueSFcXG5jYXRlZ29yeV9pZDogQW55IVxcbmN1cnJlbmN5OiBBbnkhXFxuYW1vdW50X2NlbnRzOiBOdW1iZXIhXFxuc3BlbnRfY2VudHM6IE51bWJlciFcXG5wZXJjZW50X3VzZWQ6IE51bWJlciFcXG5hbGVydF9wZXJjZW50OiBBbnkhXFxuYWxlcnRfdHJpZ2dlcmVkOiBCb29sZWFuIVxcbn1cXG5zY2FsYXIgSURcXG5zY2FsYXIgSW50XFxuc2NhbGFyIEZsb2F0XFxuc2NhbGFyIE51bWJlclxcbnNjYWxhciBBbnlcXG5zY2FsYXIgVm9pZFxcbnNjYWxhciBPYmplY3RcXG5zY2FsYXIgRmlsZVxcbnNjYWxhciBEYXRlXFxuc2NhbGFyIEpTT05cXG5zY2FsYXIgU3RyaW5nXFxuc2NhbGFyIEJvb2xlYW5cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7QnVkZ2V0U3RhdHVzZXNPckJ1ZGdldFN0YXR1c2VzXzE6e19fcmVzb2x2ZVR5cGU6ZnVuY3Rpb24gcmVzb2x2ZVR5cGUobm9kZSkgeyBpZiAobm9kZSAmJiB0eXBlb2Ygbm9kZSA9PT0gJ29iamVjdCcpIHsgaWYgKFwiYnVkZ2V0X2lkXCIgaW4gbm9kZSAmJiBcImJ1ZGdldF9uYW1lXCIgaW4gbm9kZSAmJiBcImNhdGVnb3J5X2lkXCIgaW4gbm9kZSAmJiBcImN1cnJlbmN5XCIgaW4gbm9kZSAmJiBcImFtb3VudF9jZW50c1wiIGluIG5vZGUgJiYgXCJzcGVudF9jZW50c1wiIGluIG5vZGUgJiYgXCJwZXJjZW50X3VzZWRcIiBpbiBub2RlICYmIFwiYWxlcnRfcGVyY2VudFwiIGluIG5vZGUgJiYgXCJhbGVydF90cmlnZ2VyZWRcIiBpbiBub2RlICYmIFwicGVyaW9kX3N0YXJ0XCIgaW4gbm9kZSAmJiBcInBlcmlvZF9lbmRfZXhjbHVzaXZlXCIgaW4gbm9kZSkge3JldHVybiAnQnVkZ2V0U3RhdHVzZXNfMSd9OyBpZiAoXCJidWRnZXRfaWRcIiBpbiBub2RlICYmIFwiYnVkZ2V0X25hbWVcIiBpbiBub2RlICYmIFwiY2F0ZWdvcnlfaWRcIiBpbiBub2RlICYmIFwiY3VycmVuY3lcIiBpbiBub2RlICYmIFwiYW1vdW50X2NlbnRzXCIgaW4gbm9kZSAmJiBcInNwZW50X2NlbnRzXCIgaW4gbm9kZSAmJiBcInBlcmNlbnRfdXNlZFwiIGluIG5vZGUgJiYgXCJhbGVydF9wZXJjZW50XCIgaW4gbm9kZSAmJiBcImFsZXJ0X3RyaWdnZXJlZFwiIGluIG5vZGUpIHtyZXR1cm4gJ0J1ZGdldFN0YXR1c2VzJ307IH0gfX19LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyBzcWwgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBjdXJyZW50UGVyaW9kLCB0eXBlIEludGVydmFsVW5pdCB9IGZyb20gJy4uLy4uL2J1ZGdldHMvcGVyaW9kLnRzJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgTmV3QnVkZ2V0LCBOZXdDYXRlZ29yeSwgTmV3RXhwZW5zZSB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIENyZWF0ZUJ1ZGdldElucHV0LFxuICBDcmVhdGVDYXRlZ29yeUlucHV0LFxuICBDcmVhdGVFeHBlbnNlSW5wdXQsXG4gIFVwZGF0ZUJ1ZGdldElucHV0LFxuICBVcGRhdGVDYXRlZ29yeUlucHV0LFxuICBVcGRhdGVFeHBlbnNlSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgSW52YWxpZEJ1ZGdldEVycm9yLFxuICBJbnZhbGlkQ2F0ZWdvcnlFcnJvcixcbiAgSW52YWxpZEV4cGVuc2VFcnJvcixcbiAgdmFsaWRhdGVBbGVydFBlcmNlbnQsXG4gIHZhbGlkYXRlQW1vdW50Q2VudHMsXG4gIHZhbGlkYXRlQW5jaG9yRGF0ZSxcbiAgdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyxcbiAgdmFsaWRhdGVCdWRnZXROYW1lLFxuICB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlOYW1lLFxuICB2YWxpZGF0ZUN1cnJlbmN5LFxuICB2YWxpZGF0ZUludGVydmFsQ291bnQsXG4gIHZhbGlkYXRlSW50ZXJ2YWxVbml0LFxuICB2YWxpZGF0ZU5vdGUsXG4gIHZhbGlkYXRlU3BlbnRPbixcbn0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG4vKiogcGcgcmV0dXJucyBiaWdpbnQgYXMgc3RyaW5nOyBub3JtYWxpemUgZm9yIEdyYXBoUUwgY2xpZW50cy4gKi9cbmZ1bmN0aW9uIGFzTnVtYmVyKHZhbHVlOiBudW1iZXIgfCBzdHJpbmcpOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIHZhbHVlXG4gIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKG4pKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2ludmFsaWQgYW1vdW50JylcbiAgfVxuICByZXR1cm4gblxufVxuXG5mdW5jdGlvbiB0b2RheVV0YygpOiBzdHJpbmcge1xuICByZXR1cm4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxufVxuXG5mdW5jdGlvbiBtYXBFeHBlbnNlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBjYXRlZ29yeV9pZDogbnVtYmVyXG4gIGFtb3VudF9jZW50czogbnVtYmVyIHwgc3RyaW5nXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgc3BlbnRfb246IHN0cmluZ1xuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBhbW91bnRfY2VudHM6IGFzTnVtYmVyKHJvdy5hbW91bnRfY2VudHMpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcEJ1ZGdldChyb3c6IHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGNhdGVnb3J5X2lkOiBudW1iZXIgfCBudWxsXG4gIGFtb3VudF9jZW50czogbnVtYmVyIHwgc3RyaW5nXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgaW50ZXJ2YWxfdW5pdDogc3RyaW5nXG4gIGludGVydmFsX2NvdW50OiBudW1iZXJcbiAgYW5jaG9yX2RhdGU6IHN0cmluZ1xuICBhbGVydF9wZXJjZW50OiBudW1iZXJcbiAgYXJjaGl2ZWRfYXQ6IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBhbW91bnRfY2VudHM6IGFzTnVtYmVyKHJvdy5hbW91bnRfY2VudHMpLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRDYXRlZ29yeShjYXRlZ29yeUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjYXRlZ29yeUlkKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hPd25lZEJ1ZGdldChidWRnZXRJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnYnVkZ2V0cycpXG4gICAgLndoZXJlKCdpZCcsICc9JywgYnVkZ2V0SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxufVxuXG5hc3luYyBmdW5jdGlvbiBzdW1FeHBlbnNlc0luUGVyaW9kKGFyZ3M6IHtcbiAgdXNlcklkOiBudW1iZXJcbiAgY2F0ZWdvcnlJZDogbnVtYmVyIHwgbnVsbFxuICBjdXJyZW5jeTogc3RyaW5nXG4gIGZyb21EYXRlOiBzdHJpbmdcbiAgdG9EYXRlRXhjbHVzaXZlOiBzdHJpbmdcbn0pOiBQcm9taXNlPG51bWJlcj4ge1xuICBsZXQgcXVlcnkgPSBkYlxuICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBhcmdzLnVzZXJJZClcbiAgICAud2hlcmUoJ2N1cnJlbmN5JywgJz0nLCBhcmdzLmN1cnJlbmN5KVxuICAgIC53aGVyZSgnc3BlbnRfb24nLCAnPj0nLCBhcmdzLmZyb21EYXRlKVxuICAgIC53aGVyZSgnc3BlbnRfb24nLCAnPCcsIGFyZ3MudG9EYXRlRXhjbHVzaXZlKVxuICAgIC5zZWxlY3Qoc3FsPHN0cmluZz5gY29hbGVzY2Uoc3VtKGFtb3VudF9jZW50cyksIDApYC5hcygndG90YWxfY2VudHMnKSlcblxuICBpZiAoYXJncy5jYXRlZ29yeUlkICE9IG51bGwpIHtcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdjYXRlZ29yeV9pZCcsICc9JywgYXJncy5jYXRlZ29yeUlkKVxuICB9XG5cbiAgY29uc3Qgcm93ID0gYXdhaXQgcXVlcnkuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICByZXR1cm4gYXNOdW1iZXIocm93LnRvdGFsX2NlbnRzKVxufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGNhdGVnb3JpZXM6IGFzeW5jIChhcmdzPzogeyBpbmNsdWRlQXJjaGl2ZWQ/OiBib29sZWFuIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2NhdGVnb3JpZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnbmFtZScsICdhc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG5cbiAgICBpZiAoIWFyZ3M/LmluY2x1ZGVBcmNoaXZlZCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgfSxcblxuICBjYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgcmV0dXJuIChcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgKSA/PyBudWxsXG4gIH0sXG5cbiAgZXhwZW5zZXM6IGFzeW5jIChhcmdzPzoge1xuICAgIGZyb21EYXRlPzogc3RyaW5nXG4gICAgdG9EYXRlPzogc3RyaW5nXG4gICAgY2F0ZWdvcnlJZD86IG51bWJlclxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdzcGVudF9vbicsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKGFyZ3M/LmZyb21EYXRlKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdzcGVudF9vbicsICc+PScsIHZhbGlkYXRlU3BlbnRPbihhcmdzLmZyb21EYXRlKSlcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3BlbnRfb24nLCAnPD0nLCB2YWxpZGF0ZVNwZW50T24oYXJncy50b0RhdGUpKVxuICAgIH1cbiAgICBpZiAoYXJncz8uY2F0ZWdvcnlJZCAhPSBudWxsKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdjYXRlZ29yeV9pZCcsICc9JywgYXJncy5jYXRlZ29yeUlkKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwRXhwZW5zZSlcbiAgfSxcblxuICBleHBlbnNlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyBtYXBFeHBlbnNlKHJvdykgOiBudWxsXG4gIH0sXG5cbiAgZXhwZW5zZVRvdGFsczogYXN5bmMgKGFyZ3M6IHsgZnJvbURhdGU6IHN0cmluZzsgdG9EYXRlOiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZyb21EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MuZnJvbURhdGUpXG4gICAgY29uc3QgdG9EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLmlubmVySm9pbignY2F0ZWdvcmllcycsICdjYXRlZ29yaWVzLmlkJywgJ2V4cGVuc2VzLmNhdGVnb3J5X2lkJylcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc+PScsIGZyb21EYXRlKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc8PScsIHRvRGF0ZSlcbiAgICAgIC5zZWxlY3QoW1xuICAgICAgICAnZXhwZW5zZXMuY2F0ZWdvcnlfaWQnLFxuICAgICAgICAnY2F0ZWdvcmllcy5uYW1lIGFzIGNhdGVnb3J5X25hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvciBhcyBjYXRlZ29yeV9jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICAgIHNxbDxzdHJpbmc+YHN1bShleHBlbnNlcy5hbW91bnRfY2VudHMpYC5hcygndG90YWxfY2VudHMnKSxcbiAgICAgIF0pXG4gICAgICAuZ3JvdXBCeShbXG4gICAgICAgICdleHBlbnNlcy5jYXRlZ29yeV9pZCcsXG4gICAgICAgICdjYXRlZ29yaWVzLm5hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICBdKVxuICAgICAgLm9yZGVyQnkoJ3RvdGFsX2NlbnRzJywgJ2Rlc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+ICh7XG4gICAgICBjYXRlZ29yeV9pZDogcm93LmNhdGVnb3J5X2lkLFxuICAgICAgY2F0ZWdvcnlfbmFtZTogcm93LmNhdGVnb3J5X25hbWUsXG4gICAgICBjYXRlZ29yeV9jb2xvcjogcm93LmNhdGVnb3J5X2NvbG9yLFxuICAgICAgY3VycmVuY3k6IHJvdy5jdXJyZW5jeSxcbiAgICAgIHRvdGFsX2NlbnRzOiBhc051bWJlcihyb3cudG90YWxfY2VudHMpLFxuICAgIH0pKVxuICB9LFxuXG4gIGJ1ZGdldHM6IGFzeW5jIChhcmdzPzogeyBpbmNsdWRlQXJjaGl2ZWQ/OiBib29sZWFuIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2J1ZGdldHMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnbmFtZScsICdhc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG5cbiAgICBpZiAoIWFyZ3M/LmluY2x1ZGVBcmNoaXZlZCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwQnVkZ2V0KVxuICB9LFxuXG4gIGJ1ZGdldDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZmV0Y2hPd25lZEJ1ZGdldChhcmdzLmlkLCB1c2VySWQpXG4gICAgcmV0dXJuIHJvdyA/IG1hcEJ1ZGdldChyb3cpIDogbnVsbFxuICB9LFxuXG4gIGJ1ZGdldFN0YXR1c2VzOiBhc3luYyAoYXJncz86IHsgYXNPZj86IHN0cmluZyB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgYXNPZiA9IGFyZ3M/LmFzT2YgIT0gbnVsbCA/IHZhbGlkYXRlU3BlbnRPbihhcmdzLmFzT2YpIDogdG9kYXlVdGMoKVxuXG4gICAgY29uc3QgYnVkZ2V0cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnYnVkZ2V0cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgICAgLm9yZGVyQnkoJ25hbWUnLCAnYXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3Qgc3RhdHVzZXMgPSBbXVxuICAgIGZvciAoY29uc3QgYnVkZ2V0IG9mIGJ1ZGdldHMpIHtcbiAgICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXNOdW1iZXIoYnVkZ2V0LmFtb3VudF9jZW50cylcbiAgICAgIGNvbnN0IHBlcmlvZCA9IGN1cnJlbnRQZXJpb2Qoe1xuICAgICAgICBhbmNob3JEYXRlOiBidWRnZXQuYW5jaG9yX2RhdGUsXG4gICAgICAgIGludGVydmFsVW5pdDogYnVkZ2V0LmludGVydmFsX3VuaXQgYXMgSW50ZXJ2YWxVbml0LFxuICAgICAgICBpbnRlcnZhbENvdW50OiBidWRnZXQuaW50ZXJ2YWxfY291bnQsXG4gICAgICAgIGFzT2YsXG4gICAgICB9KVxuXG4gICAgICBpZiAoIXBlcmlvZCkge1xuICAgICAgICBzdGF0dXNlcy5wdXNoKHtcbiAgICAgICAgICBidWRnZXRfaWQ6IGJ1ZGdldC5pZCxcbiAgICAgICAgICBidWRnZXRfbmFtZTogYnVkZ2V0Lm5hbWUsXG4gICAgICAgICAgY2F0ZWdvcnlfaWQ6IGJ1ZGdldC5jYXRlZ29yeV9pZCxcbiAgICAgICAgICBjdXJyZW5jeTogYnVkZ2V0LmN1cnJlbmN5LFxuICAgICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgICAgc3BlbnRfY2VudHM6IDAsXG4gICAgICAgICAgcGVyY2VudF91c2VkOiAwLFxuICAgICAgICAgIGFsZXJ0X3BlcmNlbnQ6IGJ1ZGdldC5hbGVydF9wZXJjZW50LFxuICAgICAgICAgIGFsZXJ0X3RyaWdnZXJlZDogZmFsc2UsXG4gICAgICAgICAgcGVyaW9kX3N0YXJ0OiBudWxsLFxuICAgICAgICAgIHBlcmlvZF9lbmRfZXhjbHVzaXZlOiBudWxsLFxuICAgICAgICB9KVxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICBjb25zdCBzcGVudENlbnRzID0gYXdhaXQgc3VtRXhwZW5zZXNJblBlcmlvZCh7XG4gICAgICAgIHVzZXJJZCxcbiAgICAgICAgY2F0ZWdvcnlJZDogYnVkZ2V0LmNhdGVnb3J5X2lkLFxuICAgICAgICBjdXJyZW5jeTogYnVkZ2V0LmN1cnJlbmN5LFxuICAgICAgICBmcm9tRGF0ZTogcGVyaW9kLnN0YXJ0LFxuICAgICAgICB0b0RhdGVFeGNsdXNpdmU6IHBlcmlvZC5lbmRFeGNsdXNpdmUsXG4gICAgICB9KVxuICAgICAgY29uc3QgcGVyY2VudFVzZWQgPSBhbW91bnRDZW50cyA+IDBcbiAgICAgICAgPyBNYXRoLmZsb29yKChzcGVudENlbnRzICogMTAwKSAvIGFtb3VudENlbnRzKVxuICAgICAgICA6IDBcbiAgICAgIGNvbnN0IGFsZXJ0VHJpZ2dlcmVkID0gcGVyY2VudFVzZWQgPj0gYnVkZ2V0LmFsZXJ0X3BlcmNlbnRcblxuICAgICAgc3RhdHVzZXMucHVzaCh7XG4gICAgICAgIGJ1ZGdldF9pZDogYnVkZ2V0LmlkLFxuICAgICAgICBidWRnZXRfbmFtZTogYnVkZ2V0Lm5hbWUsXG4gICAgICAgIGNhdGVnb3J5X2lkOiBidWRnZXQuY2F0ZWdvcnlfaWQsXG4gICAgICAgIGN1cnJlbmN5OiBidWRnZXQuY3VycmVuY3ksXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIHNwZW50X2NlbnRzOiBzcGVudENlbnRzLFxuICAgICAgICBwZXJjZW50X3VzZWQ6IHBlcmNlbnRVc2VkLFxuICAgICAgICBhbGVydF9wZXJjZW50OiBidWRnZXQuYWxlcnRfcGVyY2VudCxcbiAgICAgICAgYWxlcnRfdHJpZ2dlcmVkOiBhbGVydFRyaWdnZXJlZCxcbiAgICAgICAgcGVyaW9kX3N0YXJ0OiBwZXJpb2Quc3RhcnQsXG4gICAgICAgIHBlcmlvZF9lbmRfZXhjbHVzaXZlOiBwZXJpb2QuZW5kRXhjbHVzaXZlLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gc3RhdHVzZXNcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IE11dGF0aW9uID0ge1xuICBjcmVhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2NhdGVnb3JpZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0NhdGVnb3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICB1cGRhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2Nhbm5vdCB1cGRhdGUgYW4gYXJjaGl2ZWQgY2F0ZWdvcnknKVxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSBhcmdzLmlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgICA6IGV4aXN0aW5nLm5hbWVcbiAgICBjb25zdCBjb2xvciA9IGFyZ3MuaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICAgIDogZXhpc3RpbmcuY29sb3JcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdjYXRlZ29yaWVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICBhcmNoaXZlQ2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gZXhpc3RpbmdcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnY2F0ZWdvcmllcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfSxcblxuICBjcmVhdGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlRXhwZW5zZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICBpZiAoIWNhdGVnb3J5IHx8IGNhdGVnb3J5LmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gdmFsaWRhdGVBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgIGNvbnN0IGN1cnJlbmN5ID0gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5ID8/ICdVU0QnKVxuICAgIGNvbnN0IG5vdGUgPSB2YWxpZGF0ZU5vdGUoYXJncy5pbnB1dC5ub3RlKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdleHBlbnNlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnkuaWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBzcGVudF9vbjogc3BlbnRPbixcbiAgICAgICAgbm90ZSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0V4cGVuc2UpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwRXhwZW5zZShyb3cpXG4gIH0sXG5cbiAgdXBkYXRlRXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUV4cGVuc2VJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2V4cGVuc2Ugbm90IGZvdW5kJylcbiAgICB9XG5cbiAgICBsZXQgY2F0ZWdvcnlJZCA9IGV4aXN0aW5nLmNhdGVnb3J5X2lkXG4gICAgaWYgKGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICAgIH1cbiAgICAgIGNhdGVnb3J5SWQgPSBjYXRlZ29yeS5pZFxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXJncy5pbnB1dC5hbW91bnRDZW50cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICAgIDogYXNOdW1iZXIoZXhpc3RpbmcuYW1vdW50X2NlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSBhcmdzLmlucHV0LnNwZW50T24gIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgICAgOiBleGlzdGluZy5zcGVudF9vblxuICAgIGNvbnN0IGN1cnJlbmN5ID0gYXJncy5pbnB1dC5jdXJyZW5jeSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSlcbiAgICAgIDogZXhpc3RpbmcuY3VycmVuY3lcbiAgICBjb25zdCBub3RlID0gYXJncy5pbnB1dC5ub3RlICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVOb3RlKGFyZ3MuaW5wdXQubm90ZSlcbiAgICAgIDogZXhpc3Rpbmcubm90ZVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZXhwZW5zZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeUlkLFxuICAgICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgICBjdXJyZW5jeSxcbiAgICAgICAgc3BlbnRfb246IHNwZW50T24sXG4gICAgICAgIG5vdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwRXhwZW5zZShyb3cpXG4gIH0sXG5cbiAgZGVsZXRlRXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDAgJiYgTnVtYmVyKHJlc3VsdFswXT8ubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG5cbiAgY3JlYXRlQnVkZ2V0OiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlQnVkZ2V0SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUJ1ZGdldE5hbWUoYXJncy5pbnB1dC5uYW1lKVxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgIGNvbnN0IGludGVydmFsVW5pdCA9IHZhbGlkYXRlSW50ZXJ2YWxVbml0KGFyZ3MuaW5wdXQuaW50ZXJ2YWxVbml0KVxuICAgIGNvbnN0IGludGVydmFsQ291bnQgPSB2YWxpZGF0ZUludGVydmFsQ291bnQoYXJncy5pbnB1dC5pbnRlcnZhbENvdW50KVxuICAgIGNvbnN0IGFuY2hvckRhdGUgPSB2YWxpZGF0ZUFuY2hvckRhdGUoYXJncy5pbnB1dC5hbmNob3JEYXRlKVxuICAgIGNvbnN0IGFsZXJ0UGVyY2VudCA9IHZhbGlkYXRlQWxlcnRQZXJjZW50KGFyZ3MuaW5wdXQuYWxlcnRQZXJjZW50KVxuICAgIGNvbnN0IGN1cnJlbmN5ID0gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5ID8/ICdVU0QnKVxuXG4gICAgbGV0IGNhdGVnb3J5SWQ6IG51bWJlciB8IG51bGwgPSBudWxsXG4gICAgaWYgKGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCAhPSBudWxsKSB7XG4gICAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgICAgfVxuICAgICAgY2F0ZWdvcnlJZCA9IGNhdGVnb3J5LmlkXG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdidWRnZXRzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeUlkLFxuICAgICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgICBjdXJyZW5jeSxcbiAgICAgICAgaW50ZXJ2YWxfdW5pdDogaW50ZXJ2YWxVbml0LFxuICAgICAgICBpbnRlcnZhbF9jb3VudDogaW50ZXJ2YWxDb3VudCxcbiAgICAgICAgYW5jaG9yX2RhdGU6IGFuY2hvckRhdGUsXG4gICAgICAgIGFsZXJ0X3BlcmNlbnQ6IGFsZXJ0UGVyY2VudCxcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG51bGwsXG4gICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdCdWRnZXQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwQnVkZ2V0KHJvdylcbiAgfSxcblxuICB1cGRhdGVCdWRnZXQ6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVCdWRnZXRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQnVkZ2V0KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdidWRnZXQgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2Nhbm5vdCB1cGRhdGUgYW4gYXJjaGl2ZWQgYnVkZ2V0JylcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lID0gYXJncy5pbnB1dC5uYW1lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVCdWRnZXROYW1lKGFyZ3MuaW5wdXQubmFtZSlcbiAgICAgIDogZXhpc3RpbmcubmFtZVxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXJncy5pbnB1dC5hbW91bnRDZW50cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQnVkZ2V0QW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICAgIDogYXNOdW1iZXIoZXhpc3RpbmcuYW1vdW50X2NlbnRzKVxuICAgIGNvbnN0IGludGVydmFsVW5pdCA9IGFyZ3MuaW5wdXQuaW50ZXJ2YWxVbml0ICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVJbnRlcnZhbFVuaXQoYXJncy5pbnB1dC5pbnRlcnZhbFVuaXQpXG4gICAgICA6IHZhbGlkYXRlSW50ZXJ2YWxVbml0KGV4aXN0aW5nLmludGVydmFsX3VuaXQpXG4gICAgY29uc3QgaW50ZXJ2YWxDb3VudCA9IGFyZ3MuaW5wdXQuaW50ZXJ2YWxDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlSW50ZXJ2YWxDb3VudChhcmdzLmlucHV0LmludGVydmFsQ291bnQpXG4gICAgICA6IGV4aXN0aW5nLmludGVydmFsX2NvdW50XG4gICAgY29uc3QgYW5jaG9yRGF0ZSA9IGFyZ3MuaW5wdXQuYW5jaG9yRGF0ZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQW5jaG9yRGF0ZShhcmdzLmlucHV0LmFuY2hvckRhdGUpXG4gICAgICA6IGV4aXN0aW5nLmFuY2hvcl9kYXRlXG4gICAgY29uc3QgYWxlcnRQZXJjZW50ID0gYXJncy5pbnB1dC5hbGVydFBlcmNlbnQgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUFsZXJ0UGVyY2VudChhcmdzLmlucHV0LmFsZXJ0UGVyY2VudClcbiAgICAgIDogZXhpc3RpbmcuYWxlcnRfcGVyY2VudFxuICAgIGNvbnN0IGN1cnJlbmN5ID0gYXJncy5pbnB1dC5jdXJyZW5jeSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSlcbiAgICAgIDogZXhpc3RpbmcuY3VycmVuY3lcblxuICAgIGxldCBjYXRlZ29yeUlkID0gZXhpc3RpbmcuY2F0ZWdvcnlfaWRcbiAgICBpZiAoYXJncy5pbnB1dC5jYXRlZ29yeUlkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChhcmdzLmlucHV0LmNhdGVnb3J5SWQgPT0gbnVsbCkge1xuICAgICAgICBjYXRlZ29yeUlkID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pbnB1dC5jYXRlZ29yeUlkLCB1c2VySWQpXG4gICAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgICAgIH1cbiAgICAgICAgY2F0ZWdvcnlJZCA9IGNhdGVnb3J5LmlkXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYnVkZ2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY2F0ZWdvcnlfaWQ6IGNhdGVnb3J5SWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBpbnRlcnZhbF91bml0OiBpbnRlcnZhbFVuaXQsXG4gICAgICAgIGludGVydmFsX2NvdW50OiBpbnRlcnZhbENvdW50LFxuICAgICAgICBhbmNob3JfZGF0ZTogYW5jaG9yRGF0ZSxcbiAgICAgICAgYWxlcnRfcGVyY2VudDogYWxlcnRQZXJjZW50LFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgcmV0dXJuIG1hcEJ1ZGdldChyb3cpXG4gIH0sXG5cbiAgYXJjaGl2ZUJ1ZGdldDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQnVkZ2V0KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdidWRnZXQgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHJldHVybiBtYXBCdWRnZXQoZXhpc3RpbmcpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYnVkZ2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBtYXBCdWRnZXQocm93KVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59XG4iLCAiLyoqIFJvbGxpbmcgYnVkZ2V0IHBlcmlvZCBoZWxwZXJzIChhbmNob3ItYmFzZWQpLiAqL1xuXG5leHBvcnQgdHlwZSBJbnRlcnZhbFVuaXQgPSAnZGF5JyB8ICd3ZWVrJyB8ICdtb250aCdcblxuZXhwb3J0IGludGVyZmFjZSBQZXJpb2RXaW5kb3cge1xuICAvKiogSW5jbHVzaXZlIHN0YXJ0IGRhdGUgKFlZWVktTU0tREQpLiAqL1xuICBzdGFydDogc3RyaW5nXG4gIC8qKiBFeGNsdXNpdmUgZW5kIGRhdGUgKFlZWVktTU0tREQpLiAqL1xuICBlbmRFeGNsdXNpdmU6IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwYXJzZURhdGVPbmx5KHZhbHVlOiBzdHJpbmcpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGAke3ZhbHVlfVQwMDowMDowMFpgKVxuICBpZiAoTnVtYmVyLmlzTmFOKGQuZ2V0VGltZSgpKSB8fCBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICE9PSB2YWx1ZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgaW52YWxpZCBkYXRlOiAke3ZhbHVlfWApXG4gIH1cbiAgcmV0dXJuIGRcbn1cblxuZnVuY3Rpb24gZm9ybWF0RGF0ZU9ubHkoZDogRGF0ZSk6IHN0cmluZyB7XG4gIHJldHVybiBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbmZ1bmN0aW9uIGRheXNCZXR3ZWVuVXRjKGZyb206IERhdGUsIHRvOiBEYXRlKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGguZmxvb3IoKHRvLmdldFRpbWUoKSAtIGZyb20uZ2V0VGltZSgpKSAvICgyNCAqIDYwICogNjAgKiAxMDAwKSlcbn1cblxuLyoqIEFkZCBjYWxlbmRhciBtb250aHMsIGNsYW1waW5nIHRvIHRoZSBsYXN0IGRheSBvZiB0aGUgdGFyZ2V0IG1vbnRoLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZE1vbnRoc1V0YyhkYXRlOiBEYXRlLCBtb250aHM6IG51bWJlcik6IERhdGUge1xuICBjb25zdCB5ZWFyID0gZGF0ZS5nZXRVVENGdWxsWWVhcigpXG4gIGNvbnN0IG1vbnRoID0gZGF0ZS5nZXRVVENNb250aCgpXG4gIGNvbnN0IGRheSA9IGRhdGUuZ2V0VVRDRGF0ZSgpXG4gIGNvbnN0IHRhcmdldCA9IG5ldyBEYXRlKERhdGUuVVRDKHllYXIsIG1vbnRoICsgbW9udGhzLCAxKSlcbiAgY29uc3QgbGFzdERheSA9IG5ldyBEYXRlKFxuICAgIERhdGUuVVRDKHRhcmdldC5nZXRVVENGdWxsWWVhcigpLCB0YXJnZXQuZ2V0VVRDTW9udGgoKSArIDEsIDApLFxuICApLmdldFVUQ0RhdGUoKVxuICB0YXJnZXQuc2V0VVRDRGF0ZShNYXRoLm1pbihkYXksIGxhc3REYXkpKVxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRJbnRlcnZhbChcbiAgZGF0ZU9ubHk6IHN0cmluZyxcbiAgdW5pdDogSW50ZXJ2YWxVbml0LFxuICBjb3VudDogbnVtYmVyLFxuKTogc3RyaW5nIHtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2ludGVydmFsIGNvdW50IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICBjb25zdCBkID0gcGFyc2VEYXRlT25seShkYXRlT25seSlcbiAgaWYgKHVuaXQgPT09ICdkYXknKSB7XG4gICAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgY291bnQpXG4gICAgcmV0dXJuIGZvcm1hdERhdGVPbmx5KGQpXG4gIH1cbiAgaWYgKHVuaXQgPT09ICd3ZWVrJykge1xuICAgIGQuc2V0VVRDRGF0ZShkLmdldFVUQ0RhdGUoKSArIGNvdW50ICogNylcbiAgICByZXR1cm4gZm9ybWF0RGF0ZU9ubHkoZClcbiAgfVxuICByZXR1cm4gZm9ybWF0RGF0ZU9ubHkoYWRkTW9udGhzVXRjKGQsIGNvdW50KSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByb2xsaW5nIHBlcmlvZCBjb250YWluaW5nIFthc09mXSwgb3IgbnVsbCB3aGVuIFthc09mXSBpcyBiZWZvcmVcbiAqIHRoZSBhbmNob3IgKG5vIHNwZW5kIGNvdW50ZWQgYmVmb3JlIHRoZSBidWRnZXQgc3RhcnRzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGN1cnJlbnRQZXJpb2QoYXJnczoge1xuICBhbmNob3JEYXRlOiBzdHJpbmdcbiAgaW50ZXJ2YWxVbml0OiBJbnRlcnZhbFVuaXRcbiAgaW50ZXJ2YWxDb3VudDogbnVtYmVyXG4gIGFzT2Y6IHN0cmluZ1xufSk6IFBlcmlvZFdpbmRvdyB8IG51bGwge1xuICBjb25zdCB7IGFuY2hvckRhdGUsIGludGVydmFsVW5pdCwgaW50ZXJ2YWxDb3VudCwgYXNPZiB9ID0gYXJnc1xuICBpZiAoYXNPZiA8IGFuY2hvckRhdGUpIHJldHVybiBudWxsXG5cbiAgaWYgKGludGVydmFsVW5pdCA9PT0gJ2RheScgfHwgaW50ZXJ2YWxVbml0ID09PSAnd2VlaycpIHtcbiAgICBjb25zdCBwZXJpb2REYXlzID1cbiAgICAgIGludGVydmFsVW5pdCA9PT0gJ2RheScgPyBpbnRlcnZhbENvdW50IDogaW50ZXJ2YWxDb3VudCAqIDdcbiAgICBjb25zdCBhbmNob3IgPSBwYXJzZURhdGVPbmx5KGFuY2hvckRhdGUpXG4gICAgY29uc3QgYXNPZkRhdGUgPSBwYXJzZURhdGVPbmx5KGFzT2YpXG4gICAgY29uc3QgZWxhcHNlZCA9IGRheXNCZXR3ZWVuVXRjKGFuY2hvciwgYXNPZkRhdGUpXG4gICAgY29uc3QgaW5kZXggPSBNYXRoLmZsb29yKGVsYXBzZWQgLyBwZXJpb2REYXlzKVxuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IG5ldyBEYXRlKGFuY2hvcilcbiAgICBzdGFydERhdGUuc2V0VVRDRGF0ZShzdGFydERhdGUuZ2V0VVRDRGF0ZSgpICsgaW5kZXggKiBwZXJpb2REYXlzKVxuICAgIGNvbnN0IGVuZERhdGUgPSBuZXcgRGF0ZShzdGFydERhdGUpXG4gICAgZW5kRGF0ZS5zZXRVVENEYXRlKGVuZERhdGUuZ2V0VVRDRGF0ZSgpICsgcGVyaW9kRGF5cylcbiAgICByZXR1cm4ge1xuICAgICAgc3RhcnQ6IGZvcm1hdERhdGVPbmx5KHN0YXJ0RGF0ZSksXG4gICAgICBlbmRFeGNsdXNpdmU6IGZvcm1hdERhdGVPbmx5KGVuZERhdGUpLFxuICAgIH1cbiAgfVxuXG4gIC8vIE1vbnRoczogd2FsayBmb3J3YXJkIGZyb20gYW5jaG9yIHVudGlsIGFzT2YgZmFsbHMgaW4gW3N0YXJ0LCBlbmQpLlxuICBsZXQgc3RhcnQgPSBhbmNob3JEYXRlXG4gIGxldCBlbmRFeGNsdXNpdmUgPSBhZGRJbnRlcnZhbChzdGFydCwgJ21vbnRoJywgaW50ZXJ2YWxDb3VudClcbiAgLy8gQ2FwIGl0ZXJhdGlvbnMgZm9yIHNhZmV0eSAoZS5nLiB+MTAwIHllYXJzIG9mIG1vbnRobHkgcGVyaW9kcykuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjAwMDsgaSsrKSB7XG4gICAgaWYgKGFzT2YgPj0gc3RhcnQgJiYgYXNPZiA8IGVuZEV4Y2x1c2l2ZSkge1xuICAgICAgcmV0dXJuIHsgc3RhcnQsIGVuZEV4Y2x1c2l2ZSB9XG4gICAgfVxuICAgIHN0YXJ0ID0gZW5kRXhjbHVzaXZlXG4gICAgZW5kRXhjbHVzaXZlID0gYWRkSW50ZXJ2YWwoc3RhcnQsICdtb250aCcsIGludGVydmFsQ291bnQpXG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKCdmYWlsZWQgdG8gcmVzb2x2ZSBtb250aGx5IHBlcmlvZCcpXG59XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgY2F0ZWdvcmllczogQ2F0ZWdvcmllc1RhYmxlXG4gIGV4cGVuc2VzOiBFeHBlbnNlc1RhYmxlXG4gIGJ1ZGdldHM6IEJ1ZGdldHNUYWJsZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0ZWdvcmllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLyoqIEhleCBjb2xvciBmcm9tIGEgc2hhcmVkIHBhbGV0dGUsIGUuZy4gXCIjMEY3NjZFXCIuICovXG4gIGNvbG9yOiBzdHJpbmdcbiAgLyoqIFNvZnQtYXJjaGl2ZSB0aW1lc3RhbXA7IG51bGwgd2hlbiBhY3RpdmUuICovXG4gIGFyY2hpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXhwZW5zZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgY2F0ZWdvcnlfaWQ6IG51bWJlclxuICAvKiogQW1vdW50IGluIG1pbm9yIGN1cnJlbmN5IHVuaXRzIChlLmcuIGNlbnRzKS4gKi9cbiAgYW1vdW50X2NlbnRzOiBudW1iZXJcbiAgLyoqIElTTyA0MjE3IGN1cnJlbmN5IGNvZGUuICovXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgLyoqIENhbGVuZGFyIGRheSBvZiB0aGUgc3BlbmQgKFlZWVktTU0tREQpLiAqL1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3VXNlciA9IEluc2VydGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIFVzZXJVcGRhdGUgPSBVcGRhdGVhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIENhdGVnb3J5ID0gU2VsZWN0YWJsZTxDYXRlZ29yaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdDYXRlZ29yeSA9IEluc2VydGFibGU8Q2F0ZWdvcmllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQ2F0ZWdvcnlVcGRhdGUgPSBVcGRhdGVhYmxlPENhdGVnb3JpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgRXhwZW5zZSA9IFNlbGVjdGFibGU8RXhwZW5zZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0V4cGVuc2UgPSBJbnNlcnRhYmxlPEV4cGVuc2VzVGFibGU+XG5leHBvcnQgdHlwZSBFeHBlbnNlVXBkYXRlID0gVXBkYXRlYWJsZTxFeHBlbnNlc1RhYmxlPlxuXG5leHBvcnQgaW50ZXJmYWNlIEJ1ZGdldHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIC8qKiBOdWxsID0gdG90YWwgYnVkZ2V0OyBzZXQgPSBwZXItY2F0ZWdvcnkgYnVkZ2V0LiAqL1xuICBjYXRlZ29yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBhbW91bnRfY2VudHM6IG51bWJlclxuICBjdXJyZW5jeTogc3RyaW5nXG4gIC8qKiAnZGF5JyB8ICd3ZWVrJyB8ICdtb250aCcgKi9cbiAgaW50ZXJ2YWxfdW5pdDogc3RyaW5nXG4gIGludGVydmFsX2NvdW50OiBudW1iZXJcbiAgLyoqIFN0YXJ0IG9mIHBlcmlvZCAwIChZWVlZLU1NLUREKS4gKi9cbiAgYW5jaG9yX2RhdGU6IHN0cmluZ1xuICAvKiogTm90aWZ5IHdoZW4gc3BlbnQgPj0gdGhpcyBwZXJjZW50IG9mIGFtb3VudCAoMVx1MjAxMzEwMCkuICovXG4gIGFsZXJ0X3BlcmNlbnQ6IG51bWJlclxuICBhcmNoaXZlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBCdWRnZXQgPSBTZWxlY3RhYmxlPEJ1ZGdldHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0J1ZGdldCA9IEluc2VydGFibGU8QnVkZ2V0c1RhYmxlPlxuZXhwb3J0IHR5cGUgQnVkZ2V0VXBkYXRlID0gVXBkYXRlYWJsZTxCdWRnZXRzVGFibGU+XG4iLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGNyZWF0ZUt5c2VseSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9jcmVhdGVfa3lzZWx5LnRzJ1xuXG5leHBvcnQgeyBlbnYgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvZW52LnRzJ1xuXG5leHBvcnQgY29uc3QgZGIgPSBjcmVhdGVLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGVmYXVsdERhdGFiYXNlOiAnc3BlbmRtYW5hZ2VyJyxcbn0pXG4iLCAiaW1wb3J0IHR5cGUgeyBJbnRlcnZhbFVuaXQgfSBmcm9tICcuLi9idWRnZXRzL3BlcmlvZC50cydcblxuZXhwb3J0IGNsYXNzIEludmFsaWRDYXRlZ29yeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkQ2F0ZWdvcnlFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW52YWxpZEV4cGVuc2VFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZEV4cGVuc2VFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW52YWxpZEJ1ZGdldEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkQnVkZ2V0RXJyb3InXG4gIH1cbn1cblxuY29uc3QgSEVYX0NPTE9SID0gL14jWzAtOUEtRmEtZl17Nn0kL1xuY29uc3QgREFURV9PTkxZID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBDVVJSRU5DWSA9IC9eW0EtWl17M30kL1xuY29uc3QgSU5URVJWQUxfVU5JVFMgPSBuZXcgU2V0PEludGVydmFsVW5pdD4oWydkYXknLCAnd2VlaycsICdtb250aCddKVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDYXRlZ29yeU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignbmFtZSBpcyByZXF1aXJlZCcpXG4gIH1cbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCduYW1lIGlzIHRvbyBsb25nJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDYXRlZ29yeUNvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gY29sb3IudHJpbSgpXG4gIGlmICghSEVYX0NPTE9SLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NvbG9yIG11c3QgYmUgYSBoZXggdmFsdWUgbGlrZSAjMEY3NjZFJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZC50b1VwcGVyQ2FzZSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFtb3VudENlbnRzKGFtb3VudENlbnRzOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShhbW91bnRDZW50cykgfHwgIU51bWJlci5pc0ludGVnZXIoYW1vdW50Q2VudHMpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChhbW91bnRDZW50cyA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIHBvc2l0aXZlJylcbiAgfVxuICByZXR1cm4gYW1vdW50Q2VudHNcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ3VycmVuY3koY3VycmVuY3k6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBjdXJyZW5jeS50cmltKCkudG9VcHBlckNhc2UoKVxuICBpZiAoIUNVUlJFTkNZLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignY3VycmVuY3kgbXVzdCBiZSBhIDMtbGV0dGVyIElTTyBjb2RlJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTcGVudE9uKHNwZW50T246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzcGVudE9uLnRyaW0oKVxuICBpZiAoIURBVEVfT05MWS50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ3NwZW50X29uIG11c3QgYmUgWVlZWS1NTS1ERCcpXG4gIH1cbiAgY29uc3QgZCA9IG5ldyBEYXRlKGAke3RyaW1tZWR9VDAwOjAwOjAwWmApXG4gIGlmIChOdW1iZXIuaXNOYU4oZC5nZXRUaW1lKCkpIHx8IGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgIT09IHRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignc3BlbnRfb24gaXMgbm90IGEgdmFsaWQgZGF0ZScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTm90ZShub3RlOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChub3RlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHRyaW1tZWQgPSBub3RlLnRyaW0oKVxuICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPT09IDAgPyBudWxsIDogdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVCdWRnZXROYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCduYW1lIGlzIHRvbyBsb25nJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyhhbW91bnRDZW50czogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoYW1vdW50Q2VudHMpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudENlbnRzKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChhbW91bnRDZW50cyA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYW1vdW50X2NlbnRzIG11c3QgYmUgcG9zaXRpdmUnKVxuICB9XG4gIHJldHVybiBhbW91bnRDZW50c1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbFVuaXQodW5pdDogc3RyaW5nKTogSW50ZXJ2YWxVbml0IHtcbiAgY29uc3QgdHJpbW1lZCA9IHVuaXQudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFJTlRFUlZBTF9VTklUUy5oYXModHJpbW1lZCBhcyBJbnRlcnZhbFVuaXQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignaW50ZXJ2YWxfdW5pdCBtdXN0IGJlIGRheSwgd2Vlaywgb3IgbW9udGgnKVxuICB9XG4gIHJldHVybiB0cmltbWVkIGFzIEludGVydmFsVW5pdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbENvdW50KGNvdW50OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShjb3VudCkgfHwgIU51bWJlci5pc0ludGVnZXIoY291bnQpIHx8IGNvdW50IDwgMSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2ludGVydmFsX2NvdW50IG11c3QgYmUgYW4gaW50ZWdlciA+PSAxJylcbiAgfVxuICByZXR1cm4gY291bnRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQWxlcnRQZXJjZW50KHBlcmNlbnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHBlcmNlbnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHBlcmNlbnQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYWxlcnRfcGVyY2VudCBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChwZXJjZW50IDwgMSB8fCBwZXJjZW50ID4gMTAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYWxlcnRfcGVyY2VudCBtdXN0IGJlIGJldHdlZW4gMSBhbmQgMTAwJylcbiAgfVxuICByZXR1cm4gcGVyY2VudFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbmNob3JEYXRlKGFuY2hvckRhdGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlU3BlbnRPbihhbmNob3JEYXRlKVxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdhbmNob3JfZGF0ZSBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG59XG4iLCAiaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciBhcyByZXNvbHZlTG9jYWxVc2VyS2l0IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIHJldHVybiByZXNvbHZlTG9jYWxVc2VyS2l0KGRiLCBpZGVudGl0eSlcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLFdBQVc7OztBQ0FwQixTQUFTLGtCQUFrQjtBQUMzQixTQUFTLFdBQVc7OztBQ1VwQixTQUFTLGNBQWMsT0FBcUI7QUFDMUMsUUFBTSxJQUFJLG9CQUFJLEtBQUssR0FBRyxLQUFLLFlBQVk7QUFDdkMsTUFBSSxPQUFPLE1BQU0sRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxNQUFNLE9BQU87QUFDdkUsVUFBTSxJQUFJLE1BQU0saUJBQWlCLEtBQUssRUFBRTtBQUFBLEVBQzFDO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLEdBQWlCO0FBQ3ZDLFNBQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFDcEM7QUFFQSxTQUFTLGVBQWUsTUFBWSxJQUFrQjtBQUNwRCxTQUFPLEtBQUssT0FBTyxHQUFHLFFBQVEsSUFBSSxLQUFLLFFBQVEsTUFBTSxLQUFLLEtBQUssS0FBSyxJQUFLO0FBQzNFO0FBR08sU0FBUyxhQUFhLE1BQVksUUFBc0I7QUFDN0QsUUFBTSxPQUFPLEtBQUssZUFBZTtBQUNqQyxRQUFNLFFBQVEsS0FBSyxZQUFZO0FBQy9CLFFBQU0sTUFBTSxLQUFLLFdBQVc7QUFDNUIsUUFBTSxTQUFTLElBQUksS0FBSyxLQUFLLElBQUksTUFBTSxRQUFRLFFBQVEsQ0FBQyxDQUFDO0FBQ3pELFFBQU0sVUFBVSxJQUFJO0FBQUEsSUFDbEIsS0FBSyxJQUFJLE9BQU8sZUFBZSxHQUFHLE9BQU8sWUFBWSxJQUFJLEdBQUcsQ0FBQztBQUFBLEVBQy9ELEVBQUUsV0FBVztBQUNiLFNBQU8sV0FBVyxLQUFLLElBQUksS0FBSyxPQUFPLENBQUM7QUFDeEMsU0FBTztBQUNUO0FBRU8sU0FBUyxZQUNkLFVBQ0EsTUFDQSxPQUNRO0FBQ1IsTUFBSSxDQUFDLE9BQU8sVUFBVSxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQ3pDLFVBQU0sSUFBSSxNQUFNLDJDQUEyQztBQUFBLEVBQzdEO0FBQ0EsUUFBTSxJQUFJLGNBQWMsUUFBUTtBQUNoQyxNQUFJLFNBQVMsT0FBTztBQUNsQixNQUFFLFdBQVcsRUFBRSxXQUFXLElBQUksS0FBSztBQUNuQyxXQUFPLGVBQWUsQ0FBQztBQUFBLEVBQ3pCO0FBQ0EsTUFBSSxTQUFTLFFBQVE7QUFDbkIsTUFBRSxXQUFXLEVBQUUsV0FBVyxJQUFJLFFBQVEsQ0FBQztBQUN2QyxXQUFPLGVBQWUsQ0FBQztBQUFBLEVBQ3pCO0FBQ0EsU0FBTyxlQUFlLGFBQWEsR0FBRyxLQUFLLENBQUM7QUFDOUM7QUFNTyxTQUFTLGNBQWMsTUFLTjtBQUN0QixRQUFNLEVBQUUsWUFBWSxjQUFjLGVBQWUsS0FBSyxJQUFJO0FBQzFELE1BQUksT0FBTyxXQUFZLFFBQU87QUFFOUIsTUFBSSxpQkFBaUIsU0FBUyxpQkFBaUIsUUFBUTtBQUNyRCxVQUFNLGFBQ0osaUJBQWlCLFFBQVEsZ0JBQWdCLGdCQUFnQjtBQUMzRCxVQUFNLFNBQVMsY0FBYyxVQUFVO0FBQ3ZDLFVBQU0sV0FBVyxjQUFjLElBQUk7QUFDbkMsVUFBTSxVQUFVLGVBQWUsUUFBUSxRQUFRO0FBQy9DLFVBQU0sUUFBUSxLQUFLLE1BQU0sVUFBVSxVQUFVO0FBQzdDLFVBQU0sWUFBWSxJQUFJLEtBQUssTUFBTTtBQUNqQyxjQUFVLFdBQVcsVUFBVSxXQUFXLElBQUksUUFBUSxVQUFVO0FBQ2hFLFVBQU0sVUFBVSxJQUFJLEtBQUssU0FBUztBQUNsQyxZQUFRLFdBQVcsUUFBUSxXQUFXLElBQUksVUFBVTtBQUNwRCxXQUFPO0FBQUEsTUFDTCxPQUFPLGVBQWUsU0FBUztBQUFBLE1BQy9CLGNBQWMsZUFBZSxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBR0EsTUFBSSxRQUFRO0FBQ1osTUFBSSxlQUFlLFlBQVksT0FBTyxTQUFTLGFBQWE7QUFFNUQsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFNLEtBQUs7QUFDN0IsUUFBSSxRQUFRLFNBQVMsT0FBTyxjQUFjO0FBQ3hDLGFBQU8sRUFBRSxPQUFPLGFBQWE7QUFBQSxJQUMvQjtBQUNBLFlBQVE7QUFDUixtQkFBZSxZQUFZLE9BQU8sU0FBUyxhQUFhO0FBQUEsRUFDMUQ7QUFDQSxRQUFNLElBQUksTUFBTSxrQ0FBa0M7QUFDcEQ7OztBQ3RHQSxPQUEwRTs7O0FDQzFFLFNBQVMsb0JBQW9CO0FBRTdCLFNBQVMsV0FBVztBQUViLElBQU0sS0FBSyxhQUF1QjtBQUFBLEVBQ3ZDLGlCQUFpQjtBQUNuQixDQUFDOzs7QUNMTSxJQUFNLHVCQUFOLGNBQW1DLE1BQU07QUFBQSxFQUM5QyxZQUFZLFNBQWlCO0FBQzNCLFVBQU0sT0FBTztBQUNiLFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQUVPLElBQU0sc0JBQU4sY0FBa0MsTUFBTTtBQUFBLEVBQzdDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBRU8sSUFBTSxxQkFBTixjQUFpQyxNQUFNO0FBQUEsRUFDNUMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFFQSxJQUFNLFlBQVk7QUFDbEIsSUFBTSxZQUFZO0FBQ2xCLElBQU0sV0FBVztBQUNqQixJQUFNLGlCQUFpQixvQkFBSSxJQUFrQixDQUFDLE9BQU8sUUFBUSxPQUFPLENBQUM7QUFFOUQsU0FBUyxxQkFBcUIsTUFBc0I7QUFDekQsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixNQUFJLENBQUMsU0FBUztBQUNaLFVBQU0sSUFBSSxxQkFBcUIsa0JBQWtCO0FBQUEsRUFDbkQ7QUFDQSxNQUFJLFFBQVEsU0FBUyxLQUFLO0FBQ3hCLFVBQU0sSUFBSSxxQkFBcUIsa0JBQWtCO0FBQUEsRUFDbkQ7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLHNCQUFzQixPQUF1QjtBQUMzRCxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBQzNCLE1BQUksQ0FBQyxVQUFVLEtBQUssT0FBTyxHQUFHO0FBQzVCLFVBQU0sSUFBSSxxQkFBcUIsd0NBQXdDO0FBQUEsRUFDekU7QUFDQSxTQUFPLFFBQVEsWUFBWTtBQUM3QjtBQUVPLFNBQVMsb0JBQW9CLGFBQTZCO0FBQy9ELE1BQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxLQUFLLENBQUMsT0FBTyxVQUFVLFdBQVcsR0FBRztBQUNuRSxVQUFNLElBQUksb0JBQW9CLGlDQUFpQztBQUFBLEVBQ2pFO0FBQ0EsTUFBSSxlQUFlLEdBQUc7QUFDcEIsVUFBTSxJQUFJLG9CQUFvQiwrQkFBK0I7QUFBQSxFQUMvRDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsaUJBQWlCLFVBQTBCO0FBQ3pELFFBQU0sVUFBVSxTQUFTLEtBQUssRUFBRSxZQUFZO0FBQzVDLE1BQUksQ0FBQyxTQUFTLEtBQUssT0FBTyxHQUFHO0FBQzNCLFVBQU0sSUFBSSxvQkFBb0Isc0NBQXNDO0FBQUEsRUFDdEU7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLGdCQUFnQixTQUF5QjtBQUN2RCxRQUFNLFVBQVUsUUFBUSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxVQUFVLEtBQUssT0FBTyxHQUFHO0FBQzVCLFVBQU0sSUFBSSxvQkFBb0IsNkJBQTZCO0FBQUEsRUFDN0Q7QUFDQSxRQUFNLElBQUksb0JBQUksS0FBSyxHQUFHLE9BQU8sWUFBWTtBQUN6QyxNQUFJLE9BQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFLE1BQU0sU0FBUztBQUN6RSxVQUFNLElBQUksb0JBQW9CLDhCQUE4QjtBQUFBLEVBQzlEO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxhQUFhLE1BQWdEO0FBQzNFLE1BQUksUUFBUSxLQUFNLFFBQU87QUFDekIsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixTQUFPLFFBQVEsV0FBVyxJQUFJLE9BQU87QUFDdkM7QUFFTyxTQUFTLG1CQUFtQixNQUFzQjtBQUN2RCxRQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLE1BQUksQ0FBQyxTQUFTO0FBQ1osVUFBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFBQSxFQUNqRDtBQUNBLE1BQUksUUFBUSxTQUFTLEtBQUs7QUFDeEIsVUFBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFBQSxFQUNqRDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsMEJBQTBCLGFBQTZCO0FBQ3JFLE1BQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxLQUFLLENBQUMsT0FBTyxVQUFVLFdBQVcsR0FBRztBQUNuRSxVQUFNLElBQUksbUJBQW1CLGlDQUFpQztBQUFBLEVBQ2hFO0FBQ0EsTUFBSSxlQUFlLEdBQUc7QUFDcEIsVUFBTSxJQUFJLG1CQUFtQiwrQkFBK0I7QUFBQSxFQUM5RDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMscUJBQXFCLE1BQTRCO0FBQy9ELFFBQU0sVUFBVSxLQUFLLEtBQUssRUFBRSxZQUFZO0FBQ3hDLE1BQUksQ0FBQyxlQUFlLElBQUksT0FBdUIsR0FBRztBQUNoRCxVQUFNLElBQUksbUJBQW1CLDJDQUEyQztBQUFBLEVBQzFFO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxzQkFBc0IsT0FBdUI7QUFDM0QsTUFBSSxDQUFDLE9BQU8sU0FBUyxLQUFLLEtBQUssQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUFLLFFBQVEsR0FBRztBQUNwRSxVQUFNLElBQUksbUJBQW1CLHdDQUF3QztBQUFBLEVBQ3ZFO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxxQkFBcUIsU0FBeUI7QUFDNUQsTUFBSSxDQUFDLE9BQU8sU0FBUyxPQUFPLEtBQUssQ0FBQyxPQUFPLFVBQVUsT0FBTyxHQUFHO0FBQzNELFVBQU0sSUFBSSxtQkFBbUIsa0NBQWtDO0FBQUEsRUFDakU7QUFDQSxNQUFJLFVBQVUsS0FBSyxVQUFVLEtBQUs7QUFDaEMsVUFBTSxJQUFJLG1CQUFtQix5Q0FBeUM7QUFBQSxFQUN4RTtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsbUJBQW1CLFlBQTRCO0FBQzdELE1BQUk7QUFDRixXQUFPLGdCQUFnQixVQUFVO0FBQUEsRUFDbkMsUUFBUTtBQUNOLFVBQU0sSUFBSSxtQkFBbUIsZ0NBQWdDO0FBQUEsRUFDL0Q7QUFDRjs7O0FKeEdBLFNBQVMsZ0JBQXdCO0FBQy9CLFFBQU0sU0FBUyxXQUFXLEVBQUUsSUFBSSxRQUFRO0FBQ3hDLE1BQUksT0FBTyxXQUFXLFVBQVU7QUFDOUIsVUFBTSxJQUFJLE1BQU0saUJBQWlCO0FBQUEsRUFDbkM7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTLFNBQVMsT0FBZ0M7QUFDaEQsTUFBSSxPQUFPLFVBQVUsU0FBVSxRQUFPO0FBQ3RDLFFBQU0sSUFBSSxPQUFPLEtBQUs7QUFDdEIsTUFBSSxDQUFDLE9BQU8sU0FBUyxDQUFDLEdBQUc7QUFDdkIsVUFBTSxJQUFJLG9CQUFvQixnQkFBZ0I7QUFBQSxFQUNoRDtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsV0FBbUI7QUFDMUIsVUFBTyxvQkFBSSxLQUFLLEdBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFO0FBQzdDO0FBRUEsU0FBUyxXQUFXLEtBVWpCO0FBQ0QsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsY0FBYyxTQUFTLElBQUksWUFBWTtBQUFBLEVBQ3pDO0FBQ0Y7QUFFQSxTQUFTLFVBQVUsS0FjaEI7QUFDRCxTQUFPO0FBQUEsSUFDTCxHQUFHO0FBQUEsSUFDSCxjQUFjLFNBQVMsSUFBSSxZQUFZO0FBQUEsRUFDekM7QUFDRjtBQUVBLGVBQWUsbUJBQW1CLFlBQW9CLFFBQWdCO0FBQ3BFLFNBQU8sTUFBTSxHQUNWLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxVQUFVLEVBQzNCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUN0QjtBQUVBLGVBQWUsaUJBQWlCLFVBQWtCLFFBQWdCO0FBQ2hFLFNBQU8sTUFBTSxHQUNWLFdBQVcsU0FBUyxFQUNwQixNQUFNLE1BQU0sS0FBSyxRQUFRLEVBQ3pCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUN0QjtBQUVBLGVBQWUsb0JBQW9CLE1BTWY7QUFDbEIsTUFBSSxRQUFRLEdBQ1QsV0FBVyxVQUFVLEVBQ3JCLE1BQU0sV0FBVyxLQUFLLEtBQUssTUFBTSxFQUNqQyxNQUFNLFlBQVksS0FBSyxLQUFLLFFBQVEsRUFDcEMsTUFBTSxZQUFZLE1BQU0sS0FBSyxRQUFRLEVBQ3JDLE1BQU0sWUFBWSxLQUFLLEtBQUssZUFBZSxFQUMzQyxPQUFPLG9DQUE0QyxHQUFHLGFBQWEsQ0FBQztBQUV2RSxNQUFJLEtBQUssY0FBYyxNQUFNO0FBQzNCLFlBQVEsTUFBTSxNQUFNLGVBQWUsS0FBSyxLQUFLLFVBQVU7QUFBQSxFQUN6RDtBQUVBLFFBQU0sTUFBTSxNQUFNLE1BQU0sd0JBQXdCO0FBQ2hELFNBQU8sU0FBUyxJQUFJLFdBQVc7QUFDakM7QUFFTyxJQUFNLFFBQVE7QUFBQSxFQUNuQixZQUFZLE9BQU8sU0FBeUM7QUFDMUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsUUFBSSxRQUFRLEdBQ1QsV0FBVyxZQUFZLEVBQ3ZCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUSxRQUFRLEtBQUssRUFDckIsVUFBVTtBQUViLFFBQUksQ0FBQyxNQUFNLGlCQUFpQjtBQUMxQixjQUFRLE1BQU0sTUFBTSxlQUFlLE1BQU0sSUFBSTtBQUFBLElBQy9DO0FBRUEsV0FBTyxNQUFNLE1BQU0sUUFBUTtBQUFBLEVBQzdCO0FBQUEsRUFFQSxVQUFVLE9BQU8sU0FBeUI7QUFDeEMsVUFBTSxTQUFTLGNBQWM7QUFDN0IsV0FDRSxNQUFNLEdBQ0gsV0FBVyxZQUFZLEVBQ3ZCLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUIsS0FDakI7QUFBQSxFQUNQO0FBQUEsRUFFQSxVQUFVLE9BQU8sU0FJWDtBQUNKLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFFBQUksUUFBUSxHQUNULFdBQVcsVUFBVSxFQUNyQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVEsWUFBWSxNQUFNLEVBQzFCLFFBQVEsTUFBTSxNQUFNLEVBQ3BCLFVBQVU7QUFFYixRQUFJLE1BQU0sVUFBVTtBQUNsQixjQUFRLE1BQU0sTUFBTSxZQUFZLE1BQU0sZ0JBQWdCLEtBQUssUUFBUSxDQUFDO0FBQUEsSUFDdEU7QUFDQSxRQUFJLE1BQU0sUUFBUTtBQUNoQixjQUFRLE1BQU0sTUFBTSxZQUFZLE1BQU0sZ0JBQWdCLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDcEU7QUFDQSxRQUFJLE1BQU0sY0FBYyxNQUFNO0FBQzVCLGNBQVEsTUFBTSxNQUFNLGVBQWUsS0FBSyxLQUFLLFVBQVU7QUFBQSxJQUN6RDtBQUVBLFVBQU0sT0FBTyxNQUFNLE1BQU0sUUFBUTtBQUNqQyxXQUFPLEtBQUssSUFBSSxVQUFVO0FBQUEsRUFDNUI7QUFBQSxFQUVBLFNBQVMsT0FBTyxTQUF5QjtBQUN2QyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsVUFBVSxFQUNyQixNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFdBQU8sTUFBTSxXQUFXLEdBQUcsSUFBSTtBQUFBLEVBQ2pDO0FBQUEsRUFFQSxlQUFlLE9BQU8sU0FBK0M7QUFDbkUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLGdCQUFnQixLQUFLLFFBQVE7QUFDOUMsVUFBTSxTQUFTLGdCQUFnQixLQUFLLE1BQU07QUFFMUMsVUFBTSxPQUFPLE1BQU0sR0FDaEIsV0FBVyxVQUFVLEVBQ3JCLFVBQVUsY0FBYyxpQkFBaUIsc0JBQXNCLEVBQy9ELE1BQU0sb0JBQW9CLEtBQUssTUFBTSxFQUNyQyxNQUFNLHFCQUFxQixNQUFNLFFBQVEsRUFDekMsTUFBTSxxQkFBcUIsTUFBTSxNQUFNLEVBQ3ZDLE9BQU87QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxnQ0FBd0MsR0FBRyxhQUFhO0FBQUEsSUFDMUQsQ0FBQyxFQUNBLFFBQVE7QUFBQSxNQUNQO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixDQUFDLEVBQ0EsUUFBUSxlQUFlLE1BQU0sRUFDN0IsUUFBUTtBQUVYLFdBQU8sS0FBSyxJQUFJLENBQUMsU0FBUztBQUFBLE1BQ3hCLGFBQWEsSUFBSTtBQUFBLE1BQ2pCLGVBQWUsSUFBSTtBQUFBLE1BQ25CLGdCQUFnQixJQUFJO0FBQUEsTUFDcEIsVUFBVSxJQUFJO0FBQUEsTUFDZCxhQUFhLFNBQVMsSUFBSSxXQUFXO0FBQUEsSUFDdkMsRUFBRTtBQUFBLEVBQ0o7QUFBQSxFQUVBLFNBQVMsT0FBTyxTQUF5QztBQUN2RCxVQUFNLFNBQVMsY0FBYztBQUM3QixRQUFJLFFBQVEsR0FDVCxXQUFXLFNBQVMsRUFDcEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRLFFBQVEsS0FBSyxFQUNyQixVQUFVO0FBRWIsUUFBSSxDQUFDLE1BQU0saUJBQWlCO0FBQzFCLGNBQVEsTUFBTSxNQUFNLGVBQWUsTUFBTSxJQUFJO0FBQUEsSUFDL0M7QUFFQSxVQUFNLE9BQU8sTUFBTSxNQUFNLFFBQVE7QUFDakMsV0FBTyxLQUFLLElBQUksU0FBUztBQUFBLEVBQzNCO0FBQUEsRUFFQSxRQUFRLE9BQU8sU0FBeUI7QUFDdEMsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxNQUFNLE1BQU0saUJBQWlCLEtBQUssSUFBSSxNQUFNO0FBQ2xELFdBQU8sTUFBTSxVQUFVLEdBQUcsSUFBSTtBQUFBLEVBQ2hDO0FBQUEsRUFFQSxnQkFBZ0IsT0FBTyxTQUE2QjtBQUNsRCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE9BQU8sTUFBTSxRQUFRLE9BQU8sZ0JBQWdCLEtBQUssSUFBSSxJQUFJLFNBQVM7QUFFeEUsVUFBTSxVQUFVLE1BQU0sR0FDbkIsV0FBVyxTQUFTLEVBQ3BCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxlQUFlLE1BQU0sSUFBSSxFQUMvQixRQUFRLFFBQVEsS0FBSyxFQUNyQixVQUFVLEVBQ1YsUUFBUTtBQUVYLFVBQU0sV0FBVyxDQUFDO0FBQ2xCLGVBQVcsVUFBVSxTQUFTO0FBQzVCLFlBQU0sY0FBYyxTQUFTLE9BQU8sWUFBWTtBQUNoRCxZQUFNLFNBQVMsY0FBYztBQUFBLFFBQzNCLFlBQVksT0FBTztBQUFBLFFBQ25CLGNBQWMsT0FBTztBQUFBLFFBQ3JCLGVBQWUsT0FBTztBQUFBLFFBQ3RCO0FBQUEsTUFDRixDQUFDO0FBRUQsVUFBSSxDQUFDLFFBQVE7QUFDWCxpQkFBUyxLQUFLO0FBQUEsVUFDWixXQUFXLE9BQU87QUFBQSxVQUNsQixhQUFhLE9BQU87QUFBQSxVQUNwQixhQUFhLE9BQU87QUFBQSxVQUNwQixVQUFVLE9BQU87QUFBQSxVQUNqQixjQUFjO0FBQUEsVUFDZCxhQUFhO0FBQUEsVUFDYixjQUFjO0FBQUEsVUFDZCxlQUFlLE9BQU87QUFBQSxVQUN0QixpQkFBaUI7QUFBQSxVQUNqQixjQUFjO0FBQUEsVUFDZCxzQkFBc0I7QUFBQSxRQUN4QixDQUFDO0FBQ0Q7QUFBQSxNQUNGO0FBRUEsWUFBTSxhQUFhLE1BQU0sb0JBQW9CO0FBQUEsUUFDM0M7QUFBQSxRQUNBLFlBQVksT0FBTztBQUFBLFFBQ25CLFVBQVUsT0FBTztBQUFBLFFBQ2pCLFVBQVUsT0FBTztBQUFBLFFBQ2pCLGlCQUFpQixPQUFPO0FBQUEsTUFDMUIsQ0FBQztBQUNELFlBQU0sY0FBYyxjQUFjLElBQzlCLEtBQUssTUFBTyxhQUFhLE1BQU8sV0FBVyxJQUMzQztBQUNKLFlBQU0saUJBQWlCLGVBQWUsT0FBTztBQUU3QyxlQUFTLEtBQUs7QUFBQSxRQUNaLFdBQVcsT0FBTztBQUFBLFFBQ2xCLGFBQWEsT0FBTztBQUFBLFFBQ3BCLGFBQWEsT0FBTztBQUFBLFFBQ3BCLFVBQVUsT0FBTztBQUFBLFFBQ2pCLGNBQWM7QUFBQSxRQUNkLGFBQWE7QUFBQSxRQUNiLGNBQWM7QUFBQSxRQUNkLGVBQWUsT0FBTztBQUFBLFFBQ3RCLGlCQUFpQjtBQUFBLFFBQ2pCLGNBQWMsT0FBTztBQUFBLFFBQ3JCLHNCQUFzQixPQUFPO0FBQUEsTUFDL0IsQ0FBQztBQUFBLElBQ0g7QUFFQSxXQUFPO0FBQUEsRUFDVDtBQUNGO0FBRU8sSUFBTSxXQUFXO0FBQUEsRUFDdEIsZ0JBQWdCLE9BQU8sU0FBeUM7QUFDOUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxPQUFPLHFCQUFxQixLQUFLLE1BQU0sSUFBSTtBQUNqRCxVQUFNLFFBQVEsc0JBQXNCLEtBQUssTUFBTSxLQUFLO0FBQ3BELFVBQU0sT0FBTSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUVuQyxRQUFJO0FBQ0YsYUFBTyxNQUFNLEdBQ1YsV0FBVyxZQUFZLEVBQ3ZCLE9BQU87QUFBQSxRQUNOLFNBQVM7QUFBQSxRQUNUO0FBQUEsUUFDQTtBQUFBLFFBQ0EsYUFBYTtBQUFBLFFBQ2IsWUFBWTtBQUFBLFFBQ1osWUFBWTtBQUFBLE1BQ2QsQ0FBZ0IsRUFDZixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsSUFDN0IsU0FBUyxLQUFLO0FBQ1osWUFBTSxVQUFVLGVBQWUsUUFBUSxJQUFJLFVBQVU7QUFDckQsVUFBSSxRQUFRLFNBQVMsNkNBQTZDLEdBQUc7QUFDbkUsY0FBTSxJQUFJLHFCQUFxQiwwQ0FBMEM7QUFBQSxNQUMzRTtBQUNBLFlBQU07QUFBQSxJQUNSO0FBQUEsRUFDRjtBQUFBLEVBRUEsZ0JBQWdCLE9BQU8sU0FBcUQ7QUFDMUUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0sbUJBQW1CLEtBQUssSUFBSSxNQUFNO0FBQ3pELFFBQUksQ0FBQyxVQUFVO0FBQ2IsWUFBTSxJQUFJLHFCQUFxQixvQkFBb0I7QUFBQSxJQUNyRDtBQUNBLFFBQUksU0FBUyxlQUFlLE1BQU07QUFDaEMsWUFBTSxJQUFJLHFCQUFxQixvQ0FBb0M7QUFBQSxJQUNyRTtBQUVBLFVBQU0sT0FBTyxLQUFLLE1BQU0sU0FBUyxTQUM3QixxQkFBcUIsS0FBSyxNQUFNLElBQUksSUFDcEMsU0FBUztBQUNiLFVBQU0sUUFBUSxLQUFLLE1BQU0sVUFBVSxTQUMvQixzQkFBc0IsS0FBSyxNQUFNLEtBQUssSUFDdEMsU0FBUztBQUViLFFBQUk7QUFDRixhQUFPLE1BQU0sR0FDVixZQUFZLFlBQVksRUFDeEIsSUFBSTtBQUFBLFFBQ0g7QUFBQSxRQUNBO0FBQUEsUUFDQSxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDckMsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxJQUM3QixTQUFTLEtBQUs7QUFDWixZQUFNLFVBQVUsZUFBZSxRQUFRLElBQUksVUFBVTtBQUNyRCxVQUFJLFFBQVEsU0FBUyw2Q0FBNkMsR0FBRztBQUNuRSxjQUFNLElBQUkscUJBQXFCLDBDQUEwQztBQUFBLE1BQzNFO0FBQ0EsWUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBQUEsRUFFQSxpQkFBaUIsT0FBTyxTQUF5QjtBQUMvQyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxtQkFBbUIsS0FBSyxJQUFJLE1BQU07QUFDekQsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUkscUJBQXFCLG9CQUFvQjtBQUFBLElBQ3JEO0FBQ0EsUUFBSSxTQUFTLGVBQWUsTUFBTTtBQUNoQyxhQUFPO0FBQUEsSUFDVDtBQUVBLFdBQU8sTUFBTSxHQUNWLFlBQVksWUFBWSxFQUN4QixJQUFJO0FBQUEsTUFDSCxjQUFhLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDcEMsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsRUFDN0I7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUF3QztBQUM1RCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxtQkFBbUIsS0FBSyxNQUFNLFlBQVksTUFBTTtBQUN2RSxRQUFJLENBQUMsWUFBWSxTQUFTLGVBQWUsTUFBTTtBQUM3QyxZQUFNLElBQUksb0JBQW9CLG9CQUFvQjtBQUFBLElBQ3BEO0FBRUEsVUFBTSxjQUFjLG9CQUFvQixLQUFLLE1BQU0sV0FBVztBQUM5RCxVQUFNLFVBQVUsZ0JBQWdCLEtBQUssTUFBTSxPQUFPO0FBQ2xELFVBQU0sV0FBVyxpQkFBaUIsS0FBSyxNQUFNLFlBQVksS0FBSztBQUM5RCxVQUFNLE9BQU8sYUFBYSxLQUFLLE1BQU0sSUFBSTtBQUN6QyxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFFbkMsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLFVBQVUsRUFDckIsT0FBTztBQUFBLE1BQ04sU0FBUztBQUFBLE1BQ1QsYUFBYSxTQUFTO0FBQUEsTUFDdEIsY0FBYztBQUFBLE1BQ2Q7QUFBQSxNQUNBLFVBQVU7QUFBQSxNQUNWO0FBQUEsTUFDQSxZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsSUFDZCxDQUFlLEVBQ2QsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixXQUFPLFdBQVcsR0FBRztBQUFBLEVBQ3ZCO0FBQUEsRUFFQSxlQUFlLE9BQU8sU0FBb0Q7QUFDeEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0sR0FDcEIsV0FBVyxVQUFVLEVBQ3JCLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUksb0JBQW9CLG1CQUFtQjtBQUFBLElBQ25EO0FBRUEsUUFBSSxhQUFhLFNBQVM7QUFDMUIsUUFBSSxLQUFLLE1BQU0sZUFBZSxRQUFXO0FBQ3ZDLFlBQU0sV0FBVyxNQUFNLG1CQUFtQixLQUFLLE1BQU0sWUFBWSxNQUFNO0FBQ3ZFLFVBQUksQ0FBQyxZQUFZLFNBQVMsZUFBZSxNQUFNO0FBQzdDLGNBQU0sSUFBSSxvQkFBb0Isb0JBQW9CO0FBQUEsTUFDcEQ7QUFDQSxtQkFBYSxTQUFTO0FBQUEsSUFDeEI7QUFFQSxVQUFNLGNBQWMsS0FBSyxNQUFNLGdCQUFnQixTQUMzQyxvQkFBb0IsS0FBSyxNQUFNLFdBQVcsSUFDMUMsU0FBUyxTQUFTLFlBQVk7QUFDbEMsVUFBTSxVQUFVLEtBQUssTUFBTSxZQUFZLFNBQ25DLGdCQUFnQixLQUFLLE1BQU0sT0FBTyxJQUNsQyxTQUFTO0FBQ2IsVUFBTSxXQUFXLEtBQUssTUFBTSxhQUFhLFNBQ3JDLGlCQUFpQixLQUFLLE1BQU0sUUFBUSxJQUNwQyxTQUFTO0FBQ2IsVUFBTSxPQUFPLEtBQUssTUFBTSxTQUFTLFNBQzdCLGFBQWEsS0FBSyxNQUFNLElBQUksSUFDNUIsU0FBUztBQUViLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxVQUFVLEVBQ3RCLElBQUk7QUFBQSxNQUNILGFBQWE7QUFBQSxNQUNiLGNBQWM7QUFBQSxNQUNkO0FBQUEsTUFDQSxVQUFVO0FBQUEsTUFDVjtBQUFBLE1BQ0EsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFdBQU8sV0FBVyxHQUFHO0FBQUEsRUFDdkI7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUF5QjtBQUM3QyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFNBQVMsTUFBTSxHQUNsQixXQUFXLFVBQVUsRUFDckIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsUUFBUTtBQUVYLFdBQU8sT0FBTyxTQUFTLEtBQUssT0FBTyxPQUFPLENBQUMsR0FBRyxrQkFBa0IsQ0FBQyxJQUFJO0FBQUEsRUFDdkU7QUFBQSxFQUVBLGNBQWMsT0FBTyxTQUF1QztBQUMxRCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE9BQU8sbUJBQW1CLEtBQUssTUFBTSxJQUFJO0FBQy9DLFVBQU0sY0FBYywwQkFBMEIsS0FBSyxNQUFNLFdBQVc7QUFDcEUsVUFBTSxlQUFlLHFCQUFxQixLQUFLLE1BQU0sWUFBWTtBQUNqRSxVQUFNLGdCQUFnQixzQkFBc0IsS0FBSyxNQUFNLGFBQWE7QUFDcEUsVUFBTSxhQUFhLG1CQUFtQixLQUFLLE1BQU0sVUFBVTtBQUMzRCxVQUFNLGVBQWUscUJBQXFCLEtBQUssTUFBTSxZQUFZO0FBQ2pFLFVBQU0sV0FBVyxpQkFBaUIsS0FBSyxNQUFNLFlBQVksS0FBSztBQUU5RCxRQUFJLGFBQTRCO0FBQ2hDLFFBQUksS0FBSyxNQUFNLGNBQWMsTUFBTTtBQUNqQyxZQUFNLFdBQVcsTUFBTSxtQkFBbUIsS0FBSyxNQUFNLFlBQVksTUFBTTtBQUN2RSxVQUFJLENBQUMsWUFBWSxTQUFTLGVBQWUsTUFBTTtBQUM3QyxjQUFNLElBQUksbUJBQW1CLG9CQUFvQjtBQUFBLE1BQ25EO0FBQ0EsbUJBQWEsU0FBUztBQUFBLElBQ3hCO0FBRUEsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQ25DLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxTQUFTLEVBQ3BCLE9BQU87QUFBQSxNQUNOLFNBQVM7QUFBQSxNQUNUO0FBQUEsTUFDQSxhQUFhO0FBQUEsTUFDYixjQUFjO0FBQUEsTUFDZDtBQUFBLE1BQ0EsZUFBZTtBQUFBLE1BQ2YsZ0JBQWdCO0FBQUEsTUFDaEIsYUFBYTtBQUFBLE1BQ2IsZUFBZTtBQUFBLE1BQ2YsYUFBYTtBQUFBLE1BQ2IsWUFBWTtBQUFBLE1BQ1osWUFBWTtBQUFBLElBQ2QsQ0FBYyxFQUNiLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsV0FBTyxVQUFVLEdBQUc7QUFBQSxFQUN0QjtBQUFBLEVBRUEsY0FBYyxPQUFPLFNBQW1EO0FBQ3RFLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sV0FBVyxNQUFNLGlCQUFpQixLQUFLLElBQUksTUFBTTtBQUN2RCxRQUFJLENBQUMsVUFBVTtBQUNiLFlBQU0sSUFBSSxtQkFBbUIsa0JBQWtCO0FBQUEsSUFDakQ7QUFDQSxRQUFJLFNBQVMsZUFBZSxNQUFNO0FBQ2hDLFlBQU0sSUFBSSxtQkFBbUIsa0NBQWtDO0FBQUEsSUFDakU7QUFFQSxVQUFNLE9BQU8sS0FBSyxNQUFNLFNBQVMsU0FDN0IsbUJBQW1CLEtBQUssTUFBTSxJQUFJLElBQ2xDLFNBQVM7QUFDYixVQUFNLGNBQWMsS0FBSyxNQUFNLGdCQUFnQixTQUMzQywwQkFBMEIsS0FBSyxNQUFNLFdBQVcsSUFDaEQsU0FBUyxTQUFTLFlBQVk7QUFDbEMsVUFBTSxlQUFlLEtBQUssTUFBTSxpQkFBaUIsU0FDN0MscUJBQXFCLEtBQUssTUFBTSxZQUFZLElBQzVDLHFCQUFxQixTQUFTLGFBQWE7QUFDL0MsVUFBTSxnQkFBZ0IsS0FBSyxNQUFNLGtCQUFrQixTQUMvQyxzQkFBc0IsS0FBSyxNQUFNLGFBQWEsSUFDOUMsU0FBUztBQUNiLFVBQU0sYUFBYSxLQUFLLE1BQU0sZUFBZSxTQUN6QyxtQkFBbUIsS0FBSyxNQUFNLFVBQVUsSUFDeEMsU0FBUztBQUNiLFVBQU0sZUFBZSxLQUFLLE1BQU0saUJBQWlCLFNBQzdDLHFCQUFxQixLQUFLLE1BQU0sWUFBWSxJQUM1QyxTQUFTO0FBQ2IsVUFBTSxXQUFXLEtBQUssTUFBTSxhQUFhLFNBQ3JDLGlCQUFpQixLQUFLLE1BQU0sUUFBUSxJQUNwQyxTQUFTO0FBRWIsUUFBSSxhQUFhLFNBQVM7QUFDMUIsUUFBSSxLQUFLLE1BQU0sZUFBZSxRQUFXO0FBQ3ZDLFVBQUksS0FBSyxNQUFNLGNBQWMsTUFBTTtBQUNqQyxxQkFBYTtBQUFBLE1BQ2YsT0FBTztBQUNMLGNBQU0sV0FBVyxNQUFNLG1CQUFtQixLQUFLLE1BQU0sWUFBWSxNQUFNO0FBQ3ZFLFlBQUksQ0FBQyxZQUFZLFNBQVMsZUFBZSxNQUFNO0FBQzdDLGdCQUFNLElBQUksbUJBQW1CLG9CQUFvQjtBQUFBLFFBQ25EO0FBQ0EscUJBQWEsU0FBUztBQUFBLE1BQ3hCO0FBQUEsSUFDRjtBQUVBLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxTQUFTLEVBQ3JCLElBQUk7QUFBQSxNQUNIO0FBQUEsTUFDQSxhQUFhO0FBQUEsTUFDYixjQUFjO0FBQUEsTUFDZDtBQUFBLE1BQ0EsZUFBZTtBQUFBLE1BQ2YsZ0JBQWdCO0FBQUEsTUFDaEIsYUFBYTtBQUFBLE1BQ2IsZUFBZTtBQUFBLE1BQ2YsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFdBQU8sVUFBVSxHQUFHO0FBQUEsRUFDdEI7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUF5QjtBQUM3QyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxpQkFBaUIsS0FBSyxJQUFJLE1BQU07QUFDdkQsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUksbUJBQW1CLGtCQUFrQjtBQUFBLElBQ2pEO0FBQ0EsUUFBSSxTQUFTLGVBQWUsTUFBTTtBQUNoQyxhQUFPLFVBQVUsUUFBUTtBQUFBLElBQzNCO0FBRUEsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLFNBQVMsRUFDckIsSUFBSTtBQUFBLE1BQ0gsY0FBYSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ3BDLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixXQUFPLFVBQVUsR0FBRztBQUFBLEVBQ3RCO0FBQ0Y7QUFFTyxJQUFNLFlBQVk7QUFBQSxFQUN2QjtBQUFBLEVBQ0E7QUFDRjs7O0FEcG9CQSxTQUFTLHNCQUFzQjtBQUMvQjtBQUFBLEVBQ0U7QUFBQSxFQUNBO0FBQUEsT0FDSzs7O0FNTFAsU0FBUyxvQkFBb0IsMkJBQTJCO0FBU3hELGVBQXNCLGlCQUFpQixVQUF1QztBQUM1RSxTQUFPLG9CQUFvQixJQUFJLFFBQVE7QUFDekM7OztBTk9NLFNBQVEsV0FBVyw4QkFBNkI7QUFWdEQsSUFBSSxJQUFJLGNBQWM7QUFDdEIsSUFBSSxJQUFJLGdCQUFnQjtBQUN4QixJQUFJLElBQUksNEJBQTRCLGdCQUFnQixDQUFDO0FBRTlDLElBQU0sVUFBVTtBQUFBLEVBQ3JCLEdBQUc7QUFDTDtBQUVBLElBQU8sY0FBUTtBQUlULElBQUksd0JBQXdCO0FBRTVCLElBQUk7QUFDRiwwQkFBd0I7QUFDMUIsUUFBUTtBQUVSO0FBRUEsSUFBSSxJQUFJLHVCQUF1QjtBQUFBLEVBQzdCLFVBQVU7QUFBQSxFQUNWO0FBQUEsRUFDQSxXQUFXLEVBQUMsa0NBQWlDLEVBQUMsZUFBYyxTQUFTLFlBQVksTUFBTTtBQUFFLFFBQUksUUFBUSxPQUFPLFNBQVMsVUFBVTtBQUFFLFVBQUksZUFBZSxRQUFRLGlCQUFpQixRQUFRLGlCQUFpQixRQUFRLGNBQWMsUUFBUSxrQkFBa0IsUUFBUSxpQkFBaUIsUUFBUSxrQkFBa0IsUUFBUSxtQkFBbUIsUUFBUSxxQkFBcUIsUUFBUSxrQkFBa0IsUUFBUSwwQkFBMEIsTUFBTTtBQUFDLGVBQU87QUFBQSxNQUFrQjtBQUFDO0FBQUUsVUFBSSxlQUFlLFFBQVEsaUJBQWlCLFFBQVEsaUJBQWlCLFFBQVEsY0FBYyxRQUFRLGtCQUFrQixRQUFRLGlCQUFpQixRQUFRLGtCQUFrQixRQUFRLG1CQUFtQixRQUFRLHFCQUFxQixNQUFNO0FBQUMsZUFBTztBQUFBLE1BQWdCO0FBQUM7QUFBQSxJQUFFO0FBQUEsRUFBRSxFQUFDLEVBQUM7QUFBQSxFQUNyc0IsUUFBUTtBQUNWLENBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
