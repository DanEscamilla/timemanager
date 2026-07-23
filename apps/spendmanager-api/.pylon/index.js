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
  const { readFile } = await import("node:fs/promises");
  return await readFile(path, "utf8");
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
      const result = await this.messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data: payload.data
      });
      successCount += result.successCount;
      result.responses.forEach((response, index) => {
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
  defaultDatabase: "spendmanager"
});

// src/budgets/status.ts
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

// src/budgets/status.ts
function asNumber(value) {
  if (typeof value === "number") return value;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error("invalid amount");
  }
  return n;
}
async function sumExpensesInPeriod(args) {
  let query = db.selectFrom("expenses").where("user_id", "=", args.userId).where("currency", "=", args.currency).where("spent_on", ">=", args.fromDate).where("spent_on", "<", args.toDateExclusive).select(sql`coalesce(sum(amount_cents), 0)`.as("total_cents"));
  if (args.categoryId != null) {
    query = query.where("category_id", "=", args.categoryId);
  }
  const row = await query.executeTakeFirstOrThrow();
  return asNumber(row.total_cents);
}
async function computeBudgetStatuses(userId, asOf) {
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

// src/budgets/alert_push.ts
var pushSender = new NoOpPushSender();
function setPushSender(sender) {
  pushSender = sender;
}
function defaultBody(status) {
  return `${status.percent_used}% of budget used`;
}
async function maybeSendBudgetAlertPushesWithDeps(userId, asOf, deps) {
  const statuses = await deps.computeStatuses(userId, asOf);
  const triggered = statuses.filter(
    (s) => s.alert_triggered && s.period_start != null
  );
  if (triggered.length === 0) return 0;
  const tokens = await deps.listTokens(userId);
  if (tokens.length === 0) {
    return 0;
  }
  let sent = 0;
  for (const status of triggered) {
    const periodStart = status.period_start;
    const claimed = await deps.tryClaimSend(status.budget_id, periodStart);
    if (!claimed) continue;
    const result = await deps.sender.sendToTokens(tokens, {
      title: status.budget_name,
      body: (deps.formatBody ?? defaultBody)(status),
      data: {
        type: "budget_alert",
        budget_id: String(status.budget_id),
        period_start: periodStart,
        percent_used: String(status.percent_used)
      }
    });
    sent += result.successCount;
    if (result.invalidTokens.length > 0) {
      await deps.deleteTokens(result.invalidTokens);
    }
  }
  return sent;
}
async function tryClaimSend(budgetId, periodStart) {
  try {
    await db.insertInto("budget_alert_sends").values({
      budget_id: budgetId,
      period_start: periodStart,
      sent_at: (/* @__PURE__ */ new Date()).toISOString()
    }).execute();
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("budget_alert_sends_pkey") || message.includes("duplicate key") || message.includes("unique")) {
      return false;
    }
    throw err;
  }
}
async function listTokens(userId) {
  const rows = await db.selectFrom("device_tokens").where("user_id", "=", userId).select("token").execute();
  return rows.map((r) => r.token);
}
async function deleteTokens(tokens) {
  if (tokens.length === 0) return;
  await db.deleteFrom("device_tokens").where("token", "in", tokens).execute();
}
async function maybeSendBudgetAlertPushes(userId, asOf) {
  try {
    await maybeSendBudgetAlertPushesWithDeps(userId, asOf, {
      computeStatuses: computeBudgetStatuses,
      tryClaimSend,
      listTokens,
      deleteTokens,
      sender: pushSender
    });
  } catch (err) {
    console.error("[push] budget alert send failed", err);
  }
}

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";
import { sql as sql2 } from "kysely";

// src/graphql/timestamps.ts
function asIsoTimestamp(value) {
  if (value instanceof Date) return value.toISOString();
  const trimmed = value.trim();
  if (/^\d{10,}$/.test(trimmed)) {
    const n = Number(trimmed);
    const ms = trimmed.length <= 10 ? n * 1e3 : n;
    return new Date(ms).toISOString();
  }
  return value;
}
function asIsoTimestampOrNull(value) {
  if (value == null) return null;
  return asIsoTimestamp(value);
}

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
function asNumber2(value) {
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
function mapCategory(row) {
  return {
    ...row,
    archived_at: asIsoTimestampOrNull(row.archived_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
function mapExpense(row) {
  return {
    ...row,
    amount_cents: asNumber2(row.amount_cents),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
function mapBudget(row) {
  return {
    ...row,
    amount_cents: asNumber2(row.amount_cents),
    archived_at: asIsoTimestampOrNull(row.archived_at),
    created_at: asIsoTimestamp(row.created_at),
    updated_at: asIsoTimestamp(row.updated_at)
  };
}
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
async function fetchOwnedCategory(categoryId, userId) {
  return await db.selectFrom("categories").where("id", "=", categoryId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
async function fetchOwnedBudget(budgetId, userId) {
  return await db.selectFrom("budgets").where("id", "=", budgetId).where("user_id", "=", userId).selectAll().executeTakeFirst();
}
var Query = {
  categories: async (args) => {
    const userId = requireUserId();
    let query = db.selectFrom("categories").where("user_id", "=", userId).orderBy("name", "asc").selectAll();
    if (!args?.includeArchived) {
      query = query.where("archived_at", "is", null);
    }
    const rows = await query.execute();
    return rows.map(mapCategory);
  },
  category: async (args) => {
    const userId = requireUserId();
    const row = await db.selectFrom("categories").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? mapCategory(row) : null;
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
      sql2`sum(expenses.amount_cents)`.as("total_cents")
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
      total_cents: asNumber2(row.total_cents)
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
    return await computeBudgetStatuses(userId, asOf);
  }
};
var Mutation = {
  createCategory: async (args) => {
    const userId = requireUserId();
    const name = validateCategoryName(args.input.name);
    const color = validateCategoryColor(args.input.color);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    try {
      const row = await db.insertInto("categories").values({
        user_id: userId,
        name,
        color,
        archived_at: null,
        created_at: now,
        updated_at: now
      }).returningAll().executeTakeFirstOrThrow();
      return mapCategory(row);
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
      const row = await db.updateTable("categories").set({
        name,
        color,
        updated_at: (/* @__PURE__ */ new Date()).toISOString()
      }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
      return mapCategory(row);
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
      return mapCategory(existing);
    }
    const row = await db.updateTable("categories").set({
      archived_at: (/* @__PURE__ */ new Date()).toISOString(),
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).where("id", "=", args.id).where("user_id", "=", userId).returningAll().executeTakeFirstOrThrow();
    return mapCategory(row);
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
    await maybeSendBudgetAlertPushes(userId, todayUtc());
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
    const amountCents = args.input.amountCents !== void 0 ? validateAmountCents(args.input.amountCents) : asNumber2(existing.amount_cents);
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
    await maybeSendBudgetAlertPushes(userId, todayUtc());
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
    await maybeSendBudgetAlertPushes(userId, todayUtc());
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
    const amountCents = args.input.amountCents !== void 0 ? validateBudgetAmountCents(args.input.amountCents) : asNumber2(existing.amount_cents);
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
    await maybeSendBudgetAlertPushes(userId, todayUtc());
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
  },
  registerDeviceToken: async (args) => {
    const userId = requireUserId();
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
    const userId = requireUserId();
    const token = validateDeviceToken(args.token);
    const result = await db.deleteFrom("device_tokens").where("user_id", "=", userId).where("token", "=", token).execute();
    return result.length > 0 && Number(result[0]?.numDeletedRows ?? 0) > 0;
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

// src/index.ts
import { handler as __internalPylonHandler } from "@getcronit/pylon";
var pushSender2 = await createPushSenderFromEnv();
setPushSender(pushSender2);
app.use(corsMiddleware);
app.use(healthMiddleware);
app.use(createGraphQLAuthMiddleware(resolveLocalUser2));
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
  typeDefs: "input ArgsInput {\n	includeArchived: Boolean\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	fromDate: String\n	toDate: String\n	categoryId: Number\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	fromDate: String!\n	toDate: String!\n}\ninput ArgsInput_5 {\n	includeArchived: Boolean\n}\ninput ArgsInput_6 {\n	id: Number!\n}\ninput ArgsInput_7 {\n	asOf: String\n}\ninput ArgsInput_8 {\n	input: CreateCategoryInputInput!\n}\ninput CreateCategoryInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_9 {\n	id: Number!\n	input: UpdateCategoryInputInput!\n}\ninput UpdateCategoryInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	input: CreateExpenseInputInput!\n}\ninput CreateExpenseInputInput {\n	categoryId: Number!\n	amountCents: Number!\n	spentOn: String!\n	currency: String\n	note: String\n}\ninput ArgsInput_12 {\n	id: Number!\n	input: UpdateExpenseInputInput!\n}\ninput UpdateExpenseInputInput {\n	categoryId: Number\n	amountCents: Number\n	spentOn: String\n	currency: String\n	note: String\n}\ninput ArgsInput_13 {\n	id: Number!\n}\ninput ArgsInput_14 {\n	input: CreateBudgetInputInput!\n}\ninput CreateBudgetInputInput {\n	name: String!\n	amountCents: Number!\n	intervalUnit: String!\n	intervalCount: Number!\n	anchorDate: String!\n	alertPercent: Number!\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_15 {\n	id: Number!\n	input: UpdateBudgetInputInput!\n}\ninput UpdateBudgetInputInput {\n	name: String\n	amountCents: Number\n	intervalUnit: String\n	intervalCount: Number\n	anchorDate: String\n	alertPercent: Number\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ninput ArgsInput_17 {\n	token: String!\n	platform: String!\n}\ninput ArgsInput_18 {\n	token: String!\n}\ntype Query {\ncategories(args: ArgsInput): Any!\ncategory(args: ArgsInput_1!): Category\nexpenses(args: ArgsInput_2): Any!\nexpense(args: ArgsInput_3!): Expense\nexpenseTotals(args: ArgsInput_4!): Any!\nbudgets(args: ArgsInput_5): Any!\nbudget(args: ArgsInput_6!): Budget\nbudgetStatuses(args: ArgsInput_7): [BudgetStatusRow!]!\n}\ntype Category {\narchived_at: String\ncreated_at: String!\nupdated_at: String!\nid: Number!\nuser_id: Number!\nname: String!\ncolor: String!\n}\ntype Expense {\namount_cents: Number!\ncreated_at: String!\nupdated_at: String!\nid: Number!\nuser_id: Number!\ncategory_id: Number!\ncurrency: String!\nspent_on: String!\nnote: String\n}\ntype Budget {\namount_cents: Number!\narchived_at: String\ncreated_at: String!\nupdated_at: String!\nid: Number!\nuser_id: Number!\nname: String!\ncategory_id: Number\ncurrency: String!\ninterval_unit: String!\ninterval_count: Number!\nanchor_date: String!\nalert_percent: Number!\n}\ntype BudgetStatusRow {\nbudget_id: Number!\nbudget_name: String!\ncategory_id: Number\ncurrency: String!\namount_cents: Number!\nspent_cents: Number!\npercent_used: Number!\nalert_percent: Number!\nalert_triggered: Boolean!\nperiod_start: String\nperiod_end_exclusive: String\n}\ntype Mutation {\ncreateCategory(args: ArgsInput_8!): Category!\nupdateCategory(args: ArgsInput_9!): Category!\narchiveCategory(args: ArgsInput_10!): Category!\ncreateExpense(args: ArgsInput_11!): Expense!\nupdateExpense(args: ArgsInput_12!): Expense!\ndeleteExpense(args: ArgsInput_13!): Boolean!\ncreateBudget(args: ArgsInput_14!): Budget!\nupdateBudget(args: ArgsInput_15!): Budget!\narchiveBudget(args: ArgsInput_16!): Budget!\nregisterDeviceToken(args: ArgsInput_17!): Boolean!\nunregisterDeviceToken(args: ArgsInput_18!): Boolean!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvbm9vcF9zZW5kZXIudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvZmlyZWJhc2Vfc2VuZGVyLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9zc2wudHMiLCAiLi4vc3JjL2RiL2RhdGFiYXNlLnRzIiwgIi4uL3NyYy9idWRnZXRzL3N0YXR1cy50cyIsICIuLi9zcmMvYnVkZ2V0cy9wZXJpb2QudHMiLCAiLi4vc3JjL2J1ZGdldHMvYWxlcnRfcHVzaC50cyIsICIuLi9zcmMvZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3RpbWVzdGFtcHMudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52IH0gZnJvbSAnZGVub19hcGlfa2l0L3B1c2gvbW9kLnRzJ1xuaW1wb3J0IHsgc2V0UHVzaFNlbmRlciB9IGZyb20gJy4vYnVkZ2V0cy9hbGVydF9wdXNoLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZXJzIH0gZnJvbSAnLi9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMnXG5pbXBvcnQgeyBjb3JzTWlkZGxld2FyZSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZSxcbiAgaGVhbHRoTWlkZGxld2FyZSxcbn0gZnJvbSAnZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuY29uc3QgcHVzaFNlbmRlciA9IGF3YWl0IGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52KClcbnNldFB1c2hTZW5kZXIocHVzaFNlbmRlcilcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcbmFwcC51c2UoaGVhbHRoTWlkZGxld2FyZSlcbmFwcC51c2UoY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKHJlc29sdmVMb2NhbFVzZXIpKVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdGluY2x1ZGVBcmNoaXZlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzQge1xcblxcdGZyb21EYXRlOiBTdHJpbmchXFxuXFx0dG9EYXRlOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF81IHtcXG5cXHRpbmNsdWRlQXJjaGl2ZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRhc09mOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMSB7XFxuXFx0aW5wdXQ6IENyZWF0ZUV4cGVuc2VJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCB7XFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0c3BlbnRPbjogU3RyaW5nIVxcblxcdGN1cnJlbmN5OiBTdHJpbmdcXG5cXHRub3RlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEyIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcblxcdGFtb3VudENlbnRzOiBOdW1iZXJcXG5cXHRzcGVudE9uOiBTdHJpbmdcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpbnB1dDogQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0aW50ZXJ2YWxVbml0OiBTdHJpbmchXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyIVxcblxcdGFuY2hvckRhdGU6IFN0cmluZyFcXG5cXHRhbGVydFBlcmNlbnQ6IE51bWJlciFcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNSB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0YW1vdW50Q2VudHM6IE51bWJlclxcblxcdGludGVydmFsVW5pdDogU3RyaW5nXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyXFxuXFx0YW5jaG9yRGF0ZTogU3RyaW5nXFxuXFx0YWxlcnRQZXJjZW50OiBOdW1iZXJcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE3IHtcXG5cXHR0b2tlbjogU3RyaW5nIVxcblxcdHBsYXRmb3JtOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOCB7XFxuXFx0dG9rZW46IFN0cmluZyFcXG59XFxudHlwZSBRdWVyeSB7XFxuY2F0ZWdvcmllcyhhcmdzOiBBcmdzSW5wdXQpOiBBbnkhXFxuY2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzEhKTogQ2F0ZWdvcnlcXG5leHBlbnNlcyhhcmdzOiBBcmdzSW5wdXRfMik6IEFueSFcXG5leHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8zISk6IEV4cGVuc2VcXG5leHBlbnNlVG90YWxzKGFyZ3M6IEFyZ3NJbnB1dF80ISk6IEFueSFcXG5idWRnZXRzKGFyZ3M6IEFyZ3NJbnB1dF81KTogQW55IVxcbmJ1ZGdldChhcmdzOiBBcmdzSW5wdXRfNiEpOiBCdWRnZXRcXG5idWRnZXRTdGF0dXNlcyhhcmdzOiBBcmdzSW5wdXRfNyk6IFtCdWRnZXRTdGF0dXNSb3chXSFcXG59XFxudHlwZSBDYXRlZ29yeSB7XFxuYXJjaGl2ZWRfYXQ6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxufVxcbnR5cGUgRXhwZW5zZSB7XFxuYW1vdW50X2NlbnRzOiBOdW1iZXIhXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG5pZDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5jYXRlZ29yeV9pZDogTnVtYmVyIVxcbmN1cnJlbmN5OiBTdHJpbmchXFxuc3BlbnRfb246IFN0cmluZyFcXG5ub3RlOiBTdHJpbmdcXG59XFxudHlwZSBCdWRnZXQge1xcbmFtb3VudF9jZW50czogTnVtYmVyIVxcbmFyY2hpdmVkX2F0OiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbm5hbWU6IFN0cmluZyFcXG5jYXRlZ29yeV9pZDogTnVtYmVyXFxuY3VycmVuY3k6IFN0cmluZyFcXG5pbnRlcnZhbF91bml0OiBTdHJpbmchXFxuaW50ZXJ2YWxfY291bnQ6IE51bWJlciFcXG5hbmNob3JfZGF0ZTogU3RyaW5nIVxcbmFsZXJ0X3BlcmNlbnQ6IE51bWJlciFcXG59XFxudHlwZSBCdWRnZXRTdGF0dXNSb3cge1xcbmJ1ZGdldF9pZDogTnVtYmVyIVxcbmJ1ZGdldF9uYW1lOiBTdHJpbmchXFxuY2F0ZWdvcnlfaWQ6IE51bWJlclxcbmN1cnJlbmN5OiBTdHJpbmchXFxuYW1vdW50X2NlbnRzOiBOdW1iZXIhXFxuc3BlbnRfY2VudHM6IE51bWJlciFcXG5wZXJjZW50X3VzZWQ6IE51bWJlciFcXG5hbGVydF9wZXJjZW50OiBOdW1iZXIhXFxuYWxlcnRfdHJpZ2dlcmVkOiBCb29sZWFuIVxcbnBlcmlvZF9zdGFydDogU3RyaW5nXFxucGVyaW9kX2VuZF9leGNsdXNpdmU6IFN0cmluZ1xcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVDYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfOCEpOiBDYXRlZ29yeSFcXG51cGRhdGVDYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfOSEpOiBDYXRlZ29yeSFcXG5hcmNoaXZlQ2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzEwISk6IENhdGVnb3J5IVxcbmNyZWF0ZUV4cGVuc2UoYXJnczogQXJnc0lucHV0XzExISk6IEV4cGVuc2UhXFxudXBkYXRlRXhwZW5zZShhcmdzOiBBcmdzSW5wdXRfMTIhKTogRXhwZW5zZSFcXG5kZWxldGVFeHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8xMyEpOiBCb29sZWFuIVxcbmNyZWF0ZUJ1ZGdldChhcmdzOiBBcmdzSW5wdXRfMTQhKTogQnVkZ2V0IVxcbnVwZGF0ZUJ1ZGdldChhcmdzOiBBcmdzSW5wdXRfMTUhKTogQnVkZ2V0IVxcbmFyY2hpdmVCdWRnZXQoYXJnczogQXJnc0lucHV0XzE2ISk6IEJ1ZGdldCFcXG5yZWdpc3RlckRldmljZVRva2VuKGFyZ3M6IEFyZ3NJbnB1dF8xNyEpOiBCb29sZWFuIVxcbnVucmVnaXN0ZXJEZXZpY2VUb2tlbihhcmdzOiBBcmdzSW5wdXRfMTghKTogQm9vbGVhbiFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuXCIsXG4gICAgICAgIGdyYXBocWwsXG4gICAgICAgIHJlc29sdmVyczoge30sXG4gICAgICAgIGNvbmZpZzogX19pbnRlcm5hbFB5bG9uQ29uZmlnXG4gICAgICB9KSlcbiAgICAgICIsICJpbXBvcnQgdHlwZSB7IFB1c2hQYXlsb2FkLCBQdXNoU2VuZGVyLCBTZW5kVG9Ub2tlbnNSZXN1bHQgfSBmcm9tICcuL3R5cGVzLnRzJ1xuXG4vKiogTm8tb3Agc2VuZGVyIHVzZWQgd2hlbiBGaXJlYmFzZSBjcmVkZW50aWFscyBhcmUgbm90IGNvbmZpZ3VyZWQuICovXG5leHBvcnQgY2xhc3MgTm9PcFB1c2hTZW5kZXIgaW1wbGVtZW50cyBQdXNoU2VuZGVyIHtcbiAgYXN5bmMgc2VuZFRvVG9rZW5zKFxuICAgIF90b2tlbnM6IHN0cmluZ1tdLFxuICAgIF9wYXlsb2FkOiBQdXNoUGF5bG9hZCxcbiAgKTogUHJvbWlzZTxTZW5kVG9Ub2tlbnNSZXN1bHQ+IHtcbiAgICByZXR1cm4geyBzdWNjZXNzQ291bnQ6IDAsIGludmFsaWRUb2tlbnM6IFtdIH1cbiAgfVxufVxuIiwgIi8qKiBSZWFkIGFuIGVudiB2YXIgZnJvbSBOb2RlIGBwcm9jZXNzLmVudmAgb3IgRGVuby4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbnYobmFtZTogc3RyaW5nKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgaWYgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uW25hbWVdKSB7XG4gICAgcmV0dXJuIHByb2Nlc3MuZW52W25hbWVdXG4gIH1cbiAgdHJ5IHtcbiAgICByZXR1cm4gRGVuby5lbnYuZ2V0KG5hbWUpXG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB1bmRlZmluZWRcbiAgfVxufVxuIiwgImltcG9ydCB7IGVudiB9IGZyb20gJy4uL2RiL2Vudi50cydcbmltcG9ydCB7IE5vT3BQdXNoU2VuZGVyIH0gZnJvbSAnLi9ub29wX3NlbmRlci50cydcbmltcG9ydCB0eXBlIHsgUHVzaFBheWxvYWQsIFB1c2hTZW5kZXIsIFNlbmRUb1Rva2Vuc1Jlc3VsdCB9IGZyb20gJy4vdHlwZXMudHMnXG5cbmFzeW5jIGZ1bmN0aW9uIHJlYWRUZXh0RmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBpZiAodHlwZW9mIERlbm8gIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBEZW5vLnJlYWRUZXh0RmlsZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBhd2FpdCBEZW5vLnJlYWRUZXh0RmlsZShwYXRoKVxuICB9XG4gIGNvbnN0IHsgcmVhZEZpbGUgfSA9IGF3YWl0IGltcG9ydCgnbm9kZTpmcy9wcm9taXNlcycpXG4gIHJldHVybiBhd2FpdCByZWFkRmlsZShwYXRoLCAndXRmOCcpXG59XG5cbnR5cGUgU2VydmljZUFjY291bnQgPSB7XG4gIHByb2plY3RfaWQ6IHN0cmluZ1xuICBjbGllbnRfZW1haWw6IHN0cmluZ1xuICBwcml2YXRlX2tleTogc3RyaW5nXG4gIFtrZXk6IHN0cmluZ106IHVua25vd25cbn1cblxudHlwZSBNZXNzYWdpbmcgPSB7XG4gIHNlbmRFYWNoRm9yTXVsdGljYXN0OiAobWVzc2FnZToge1xuICAgIHRva2Vuczogc3RyaW5nW11cbiAgICBub3RpZmljYXRpb246IHsgdGl0bGU6IHN0cmluZzsgYm9keTogc3RyaW5nIH1cbiAgICBkYXRhPzogUmVjb3JkPHN0cmluZywgc3RyaW5nPlxuICB9KSA9PiBQcm9taXNlPHtcbiAgICBzdWNjZXNzQ291bnQ6IG51bWJlclxuICAgIHJlc3BvbnNlczogQXJyYXk8eyBzdWNjZXNzOiBib29sZWFuOyBlcnJvcj86IHsgY29kZT86IHN0cmluZyB9IH0+XG4gIH0+XG59XG5cbnR5cGUgRmlyZWJhc2VBZG1pbk1vZHVsZSA9IHtcbiAgYXBwczogdW5rbm93bltdXG4gIGluaXRpYWxpemVBcHA6IChvcHRpb25zOiB7XG4gICAgY3JlZGVudGlhbDogdW5rbm93blxuICB9KSA9PiB1bmtub3duXG4gIGNyZWRlbnRpYWw6IHtcbiAgICBjZXJ0OiAoc2VydmljZUFjY291bnQ6IFNlcnZpY2VBY2NvdW50KSA9PiB1bmtub3duXG4gIH1cbiAgbWVzc2FnaW5nOiAoKSA9PiBNZXNzYWdpbmdcbn1cblxuY29uc3QgSU5WQUxJRF9UT0tFTl9DT0RFUyA9IG5ldyBTZXQoW1xuICAnbWVzc2FnaW5nL2ludmFsaWQtcmVnaXN0cmF0aW9uLXRva2VuJyxcbiAgJ21lc3NhZ2luZy9yZWdpc3RyYXRpb24tdG9rZW4tbm90LXJlZ2lzdGVyZWQnLFxuXSlcblxuLyoqXG4gKiBGaXJlYmFzZSBDbG91ZCBNZXNzYWdpbmcgc2VuZGVyIHZpYSBmaXJlYmFzZS1hZG1pbi5cbiAqXG4gKiBQcmVmZXIgY29uc3RydWN0aW5nIHRocm91Z2gge0BsaW5rIGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52fSBzbyBtaXNzaW5nXG4gKiBjcmVkZW50aWFscyBkZWdyYWRlIHRvIGEgbm8tb3AgaW5zdGVhZCBvZiBjcmFzaGluZyB0aGUgQVBJLlxuICovXG5leHBvcnQgY2xhc3MgRmlyZWJhc2VQdXNoU2VuZGVyIGltcGxlbWVudHMgUHVzaFNlbmRlciB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgbWVzc2FnaW5nOiBNZXNzYWdpbmcpIHt9XG5cbiAgYXN5bmMgc2VuZFRvVG9rZW5zKFxuICAgIHRva2Vuczogc3RyaW5nW10sXG4gICAgcGF5bG9hZDogUHVzaFBheWxvYWQsXG4gICk6IFByb21pc2U8U2VuZFRvVG9rZW5zUmVzdWx0PiB7XG4gICAgaWYgKHRva2Vucy5sZW5ndGggPT09IDApIHtcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3NDb3VudDogMCwgaW52YWxpZFRva2VuczogW10gfVxuICAgIH1cblxuICAgIGNvbnN0IGludmFsaWRUb2tlbnM6IHN0cmluZ1tdID0gW11cbiAgICBsZXQgc3VjY2Vzc0NvdW50ID0gMFxuXG4gICAgLy8gRkNNIG11bHRpY2FzdCBzdXBwb3J0cyB1cCB0byA1MDAgdG9rZW5zIHBlciByZXF1ZXN0LlxuICAgIGNvbnN0IGNodW5rU2l6ZSA9IDUwMFxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdG9rZW5zLmxlbmd0aDsgaSArPSBjaHVua1NpemUpIHtcbiAgICAgIGNvbnN0IGNodW5rID0gdG9rZW5zLnNsaWNlKGksIGkgKyBjaHVua1NpemUpXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLm1lc3NhZ2luZy5zZW5kRWFjaEZvck11bHRpY2FzdCh7XG4gICAgICAgIHRva2VuczogY2h1bmssXG4gICAgICAgIG5vdGlmaWNhdGlvbjoge1xuICAgICAgICAgIHRpdGxlOiBwYXlsb2FkLnRpdGxlLFxuICAgICAgICAgIGJvZHk6IHBheWxvYWQuYm9keSxcbiAgICAgICAgfSxcbiAgICAgICAgZGF0YTogcGF5bG9hZC5kYXRhLFxuICAgICAgfSlcbiAgICAgIHN1Y2Nlc3NDb3VudCArPSByZXN1bHQuc3VjY2Vzc0NvdW50XG4gICAgICByZXN1bHQucmVzcG9uc2VzLmZvckVhY2goKHJlc3BvbnNlLCBpbmRleCkgPT4ge1xuICAgICAgICBpZiAocmVzcG9uc2Uuc3VjY2VzcykgcmV0dXJuXG4gICAgICAgIGNvbnN0IGNvZGUgPSByZXNwb25zZS5lcnJvcj8uY29kZVxuICAgICAgICBpZiAoY29kZSAmJiBJTlZBTElEX1RPS0VOX0NPREVTLmhhcyhjb2RlKSkge1xuICAgICAgICAgIGludmFsaWRUb2tlbnMucHVzaChjaHVua1tpbmRleF0hKVxuICAgICAgICB9XG4gICAgICB9KVxuICAgIH1cblxuICAgIHJldHVybiB7IHN1Y2Nlc3NDb3VudCwgaW52YWxpZFRva2VucyB9XG4gIH1cbn1cblxuZnVuY3Rpb24gcGFyc2VTZXJ2aWNlQWNjb3VudEpzb24ocmF3OiBzdHJpbmcpOiBTZXJ2aWNlQWNjb3VudCB7XG4gIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KSBhcyBTZXJ2aWNlQWNjb3VudFxuICBpZiAoXG4gICAgdHlwZW9mIHBhcnNlZC5wcm9qZWN0X2lkICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBwYXJzZWQuY2xpZW50X2VtYWlsICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBwYXJzZWQucHJpdmF0ZV9rZXkgIT09ICdzdHJpbmcnXG4gICkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgICdGaXJlYmFzZSBzZXJ2aWNlIGFjY291bnQgSlNPTiBtdXN0IGluY2x1ZGUgcHJvamVjdF9pZCwgY2xpZW50X2VtYWlsLCBwcml2YXRlX2tleScsXG4gICAgKVxuICB9XG4gIC8vIFByaXZhdGUga2V5cyBpbiBlbnYgdmFycyBvZnRlbiBoYXZlIGVzY2FwZWQgbmV3bGluZXMuXG4gIHBhcnNlZC5wcml2YXRlX2tleSA9IHBhcnNlZC5wcml2YXRlX2tleS5yZXBsYWNlKC9cXFxcbi9nLCAnXFxuJylcbiAgcmV0dXJuIHBhcnNlZFxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkU2VydmljZUFjY291bnQoKTogUHJvbWlzZTxTZXJ2aWNlQWNjb3VudCB8IG51bGw+IHtcbiAgY29uc3QganNvbiA9IGVudignRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX0pTT04nKVxuICBpZiAoanNvbiAmJiBqc29uLnRyaW0oKS5sZW5ndGggPiAwKSB7XG4gICAgcmV0dXJuIHBhcnNlU2VydmljZUFjY291bnRKc29uKGpzb24pXG4gIH1cblxuICBjb25zdCBwYXRoID0gZW52KCdGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfUEFUSCcpXG4gIGlmIChwYXRoICYmIHBhdGgudHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICBjb25zdCB0ZXh0ID0gYXdhaXQgcmVhZFRleHRGaWxlKHBhdGgpXG4gICAgcmV0dXJuIHBhcnNlU2VydmljZUFjY291bnRKc29uKHRleHQpXG4gIH1cblxuICByZXR1cm4gbnVsbFxufVxuXG5hc3luYyBmdW5jdGlvbiBsb2FkRmlyZWJhc2VBZG1pbigpOiBQcm9taXNlPEZpcmViYXNlQWRtaW5Nb2R1bGU+IHtcbiAgLy8gRHluYW1pYyBpbXBvcnQga2VlcHMgdGhlIGtpdCBpbXBvcnRhYmxlIGluIHVuaXQgdGVzdHMgd2l0aG91dCByZXNvbHZpbmdcbiAgLy8gZmlyZWJhc2UtYWRtaW4gdW5sZXNzIGEgcmVhbCBzZW5kZXIgaXMgY29uc3RydWN0ZWQuXG4gIC8vIEJ1bi9Ob2RlIENKUyBpbnRlcm9wIG9mdGVuIGV4cG9zZXMgdGhlIFNESyBvbiBgZGVmYXVsdGAuXG4gIGNvbnN0IG1vZCA9IGF3YWl0IGltcG9ydCgnZmlyZWJhc2UtYWRtaW4nKSBhcyB7XG4gICAgZGVmYXVsdD86IEZpcmViYXNlQWRtaW5Nb2R1bGVcbiAgfSAmIEZpcmViYXNlQWRtaW5Nb2R1bGVcbiAgcmV0dXJuIG1vZC5kZWZhdWx0ID8/IG1vZFxufVxuXG4vKipcbiAqIEJ1aWxkcyBhIHtAbGluayBQdXNoU2VuZGVyfSBmcm9tIGVudi5cbiAqXG4gKiAtIGBGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTmAgXHUyMDE0IHJhdyBzZXJ2aWNlLWFjY291bnQgSlNPTiBzdHJpbmdcbiAqIC0gYEZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9QQVRIYCBcdTIwMTQgcGF0aCB0byBhIHNlcnZpY2UtYWNjb3VudCBKU09OIGZpbGVcbiAqXG4gKiBXaGVuIG5laXRoZXIgaXMgc2V0IChvciBpbml0IGZhaWxzKSwgcmV0dXJucyB7QGxpbmsgTm9PcFB1c2hTZW5kZXJ9LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY3JlYXRlUHVzaFNlbmRlckZyb21FbnYoKTogUHJvbWlzZTxQdXNoU2VuZGVyPiB7XG4gIHRyeSB7XG4gICAgY29uc3QgYWNjb3VudCA9IGF3YWl0IGxvYWRTZXJ2aWNlQWNjb3VudCgpXG4gICAgaWYgKCFhY2NvdW50KSB7XG4gICAgICBjb25zb2xlLmluZm8oXG4gICAgICAgICdbcHVzaF0gRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX0pTT04vUEFUSCB1bnNldDsgdXNpbmcgbm8tb3Agc2VuZGVyJyxcbiAgICAgIClcbiAgICAgIHJldHVybiBuZXcgTm9PcFB1c2hTZW5kZXIoKVxuICAgIH1cblxuICAgIGNvbnN0IGFkbWluID0gYXdhaXQgbG9hZEZpcmViYXNlQWRtaW4oKVxuICAgIGlmIChhZG1pbi5hcHBzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgYWRtaW4uaW5pdGlhbGl6ZUFwcCh7XG4gICAgICAgIGNyZWRlbnRpYWw6IGFkbWluLmNyZWRlbnRpYWwuY2VydChhY2NvdW50KSxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ldyBGaXJlYmFzZVB1c2hTZW5kZXIoYWRtaW4ubWVzc2FnaW5nKCkpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnNvbGUuZXJyb3IoJ1twdXNoXSBmYWlsZWQgdG8gaW5pdCBGaXJlYmFzZSBzZW5kZXI7IHVzaW5nIG5vLW9wJywgZXJyKVxuICAgIHJldHVybiBuZXcgTm9PcFB1c2hTZW5kZXIoKVxuICB9XG59XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgY2F0ZWdvcmllczogQ2F0ZWdvcmllc1RhYmxlXG4gIGV4cGVuc2VzOiBFeHBlbnNlc1RhYmxlXG4gIGJ1ZGdldHM6IEJ1ZGdldHNUYWJsZVxuICBkZXZpY2VfdG9rZW5zOiBEZXZpY2VUb2tlbnNUYWJsZVxuICBidWRnZXRfYWxlcnRfc2VuZHM6IEJ1ZGdldEFsZXJ0U2VuZHNUYWJsZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0ZWdvcmllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLyoqIEhleCBjb2xvciBmcm9tIGEgc2hhcmVkIHBhbGV0dGUsIGUuZy4gXCIjMEY3NjZFXCIuICovXG4gIGNvbG9yOiBzdHJpbmdcbiAgLyoqIFNvZnQtYXJjaGl2ZSB0aW1lc3RhbXA7IG51bGwgd2hlbiBhY3RpdmUuICovXG4gIGFyY2hpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXhwZW5zZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgY2F0ZWdvcnlfaWQ6IG51bWJlclxuICAvKiogQW1vdW50IGluIG1pbm9yIGN1cnJlbmN5IHVuaXRzIChlLmcuIGNlbnRzKS4gKi9cbiAgYW1vdW50X2NlbnRzOiBudW1iZXJcbiAgLyoqIElTTyA0MjE3IGN1cnJlbmN5IGNvZGUuICovXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgLyoqIENhbGVuZGFyIGRheSBvZiB0aGUgc3BlbmQgKFlZWVktTU0tREQpLiAqL1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3VXNlciA9IEluc2VydGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIFVzZXJVcGRhdGUgPSBVcGRhdGVhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIENhdGVnb3J5ID0gU2VsZWN0YWJsZTxDYXRlZ29yaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdDYXRlZ29yeSA9IEluc2VydGFibGU8Q2F0ZWdvcmllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQ2F0ZWdvcnlVcGRhdGUgPSBVcGRhdGVhYmxlPENhdGVnb3JpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgRXhwZW5zZSA9IFNlbGVjdGFibGU8RXhwZW5zZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0V4cGVuc2UgPSBJbnNlcnRhYmxlPEV4cGVuc2VzVGFibGU+XG5leHBvcnQgdHlwZSBFeHBlbnNlVXBkYXRlID0gVXBkYXRlYWJsZTxFeHBlbnNlc1RhYmxlPlxuXG5leHBvcnQgaW50ZXJmYWNlIEJ1ZGdldHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIC8qKiBOdWxsID0gdG90YWwgYnVkZ2V0OyBzZXQgPSBwZXItY2F0ZWdvcnkgYnVkZ2V0LiAqL1xuICBjYXRlZ29yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBhbW91bnRfY2VudHM6IG51bWJlclxuICBjdXJyZW5jeTogc3RyaW5nXG4gIC8qKiAnZGF5JyB8ICd3ZWVrJyB8ICdtb250aCcgKi9cbiAgaW50ZXJ2YWxfdW5pdDogc3RyaW5nXG4gIGludGVydmFsX2NvdW50OiBudW1iZXJcbiAgLyoqIFN0YXJ0IG9mIHBlcmlvZCAwIChZWVlZLU1NLUREKS4gKi9cbiAgYW5jaG9yX2RhdGU6IHN0cmluZ1xuICAvKiogTm90aWZ5IHdoZW4gc3BlbnQgPj0gdGhpcyBwZXJjZW50IG9mIGFtb3VudCAoMVx1MjAxMzEwMCkuICovXG4gIGFsZXJ0X3BlcmNlbnQ6IG51bWJlclxuICBhcmNoaXZlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBCdWRnZXQgPSBTZWxlY3RhYmxlPEJ1ZGdldHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0J1ZGdldCA9IEluc2VydGFibGU8QnVkZ2V0c1RhYmxlPlxuZXhwb3J0IHR5cGUgQnVkZ2V0VXBkYXRlID0gVXBkYXRlYWJsZTxCdWRnZXRzVGFibGU+XG5cbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlVG9rZW5zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHRva2VuOiBzdHJpbmdcbiAgLyoqICdpb3MnIHwgJ2FuZHJvaWQnIHwgJ3dlYicgKi9cbiAgcGxhdGZvcm06IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBEZXZpY2VUb2tlbiA9IFNlbGVjdGFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdEZXZpY2VUb2tlbiA9IEluc2VydGFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG5leHBvcnQgdHlwZSBEZXZpY2VUb2tlblVwZGF0ZSA9IFVwZGF0ZWFibGU8RGV2aWNlVG9rZW5zVGFibGU+XG5cbmV4cG9ydCBpbnRlcmZhY2UgQnVkZ2V0QWxlcnRTZW5kc1RhYmxlIHtcbiAgYnVkZ2V0X2lkOiBudW1iZXJcbiAgLyoqIFBlcmlvZCBzdGFydCBkYXRlIChZWVlZLU1NLUREKS4gKi9cbiAgcGVyaW9kX3N0YXJ0OiBzdHJpbmdcbiAgc2VudF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBCdWRnZXRBbGVydFNlbmQgPSBTZWxlY3RhYmxlPEJ1ZGdldEFsZXJ0U2VuZHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0J1ZGdldEFsZXJ0U2VuZCA9IEluc2VydGFibGU8QnVkZ2V0QWxlcnRTZW5kc1RhYmxlPlxuIiwgImltcG9ydCB7IFBvb2wsIHR5cGVzIH0gZnJvbSAncGcnXG5pbXBvcnQgeyBLeXNlbHksIFBvc3RncmVzRGlhbGVjdCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGVudiB9IGZyb20gJy4vZW52LnRzJ1xuaW1wb3J0IHtcbiAgY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMsXG4gIHNzbEZvckRhdGFiYXNlVXJsLFxufSBmcm9tICcuL3NzbC50cydcblxuLy8gS2VlcCBQb3N0Z3JlcyBgZGF0ZWAgYXMgYFlZWVktTU0tRERgIHN0cmluZ3MuIFRoZSBkZWZhdWx0IHBnIHBhcnNlciB0dXJuc1xuLy8gdGhlbSBpbnRvIEpTIERhdGUgb2JqZWN0cywgd2hpY2ggR3JhcGhRTCB0aGVuIHN0cmluZ2lmaWVzIGFzIGZ1bGwgdGltZXN0YW1wc1xuLy8gYW5kIGJyZWFrcyBGbHV0dGVyJ3MgZGF0ZS1vbmx5IHBhcnNpbmcuXG50eXBlcy5zZXRUeXBlUGFyc2VyKHR5cGVzLmJ1aWx0aW5zLkRBVEUsICh2YWx1ZTogc3RyaW5nKSA9PiB2YWx1ZSlcblxuZXhwb3J0IHR5cGUgQ3JlYXRlS3lzZWx5T3B0aW9ucyA9IHtcbiAgLyoqIEZhbGxiYWNrIHdoZW4gYFBHREFUQUJBU0VgIC8gYERBVEFCQVNFX1VSTGAgYXJlIHVuc2V0LiAqL1xuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwb29sQ29uZmlnRnJvbUVudihcbiAgZGVmYXVsdERhdGFiYXNlOiBzdHJpbmcsXG4pOiBDb25zdHJ1Y3RvclBhcmFtZXRlcnM8dHlwZW9mIFBvb2w+WzBdIHtcbiAgY29uc3QgZGF0YWJhc2VVcmwgPSBlbnYoJ0RBVEFCQVNFX1VSTCcpXG4gIGlmIChkYXRhYmFzZVVybCkge1xuICAgIGNvbnN0IHNzbCA9IHNzbEZvckRhdGFiYXNlVXJsKGRhdGFiYXNlVXJsKVxuICAgIHJldHVybiB7XG4gICAgICBjb25uZWN0aW9uU3RyaW5nOiBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyhkYXRhYmFzZVVybCksXG4gICAgICBtYXg6IDEwLFxuICAgICAgLi4uKHNzbCA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHNzbCB9KSxcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIGRhdGFiYXNlOiBlbnYoJ1BHREFUQUJBU0UnKSA/PyBkZWZhdWx0RGF0YWJhc2UsXG4gICAgaG9zdDogZW52KCdQR0hPU1QnKSA/PyAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiBlbnYoJ1BHVVNFUicpID8/ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6IGVudignUEdQQVNTV09SRCcpID8/ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogTnVtYmVyKGVudignUEdQT1JUJykgPz8gJzU0MzInKSxcbiAgICBtYXg6IDEwLFxuICB9XG59XG5cbi8qKiBDcmVhdGUgYSBLeXNlbHkgaW5zdGFuY2UgZm9yIHRoZSBnaXZlbiBzY2hlbWEgdHlwZSBhbmQgZGVmYXVsdCBEQiBuYW1lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUt5c2VseTxEQj4ob3B0aW9uczogQ3JlYXRlS3lzZWx5T3B0aW9ucyk6IEt5c2VseTxEQj4ge1xuICBjb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gICAgcG9vbDogbmV3IFBvb2wocG9vbENvbmZpZ0Zyb21FbnYob3B0aW9ucy5kZWZhdWx0RGF0YWJhc2UpKSxcbiAgfSlcbiAgcmV0dXJuIG5ldyBLeXNlbHk8REI+KHsgZGlhbGVjdCB9KVxufVxuIiwgIi8qKiBUTFMgb3B0aW9ucyBmb3IgYHBnYCBmcm9tIGEgUG9zdGdyZXMgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNzbEZvckRhdGFiYXNlVXJsKFxuICBkYXRhYmFzZVVybDogc3RyaW5nLFxuKTogZmFsc2UgfCB7IHJlamVjdFVuYXV0aG9yaXplZDogYm9vbGVhbiB9IHwgdW5kZWZpbmVkIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzc2xtb2RlJyk/LnRvTG93ZXJDYXNlKClcbiAgaWYgKG1vZGUgPT09ICdkaXNhYmxlJykgcmV0dXJuIGZhbHNlXG4gIGlmIChtb2RlID09PSAncmVxdWlyZScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1jYScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1mdWxsJykge1xuICAgIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxuICB9XG5cbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZVxuICBpZiAoaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdCA9PT0gJzEyNy4wLjAuMScpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbn1cblxuLyoqXG4gKiBTdHJpcCBTU0wgcXVlcnkgcGFyYW1zIGZyb20gYSBQb3N0Z3JlcyBVUkwgYmVmb3JlIHBhc3NpbmcgaXQgdG8gYHBnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gICAgZm9yIChjb25zdCBrZXkgb2YgW1xuICAgICAgJ3NzbG1vZGUnLFxuICAgICAgJ3NzbCcsXG4gICAgICAnc3Nscm9vdGNlcnQnLFxuICAgICAgJ3NzbGNlcnQnLFxuICAgICAgJ3NzbGtleScsXG4gICAgXSkge1xuICAgICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoa2V5KVxuICAgIH1cbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGRhdGFiYXNlVXJsXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBEYXRhYmFzZSB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlS3lzZWx5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMnXG5cbmV4cG9ydCB7IGVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5cbmV4cG9ydCBjb25zdCBkYiA9IGNyZWF0ZUt5c2VseTxEYXRhYmFzZT4oe1xuICBkZWZhdWx0RGF0YWJhc2U6ICdzcGVuZG1hbmFnZXInLFxufSlcbiIsICJpbXBvcnQgeyBzcWwgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHsgY3VycmVudFBlcmlvZCwgdHlwZSBJbnRlcnZhbFVuaXQgfSBmcm9tICcuL3BlcmlvZC50cydcblxuZXhwb3J0IGludGVyZmFjZSBCdWRnZXRTdGF0dXNSb3cge1xuICBidWRnZXRfaWQ6IG51bWJlclxuICBidWRnZXRfbmFtZTogc3RyaW5nXG4gIGNhdGVnb3J5X2lkOiBudW1iZXIgfCBudWxsXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgYW1vdW50X2NlbnRzOiBudW1iZXJcbiAgc3BlbnRfY2VudHM6IG51bWJlclxuICBwZXJjZW50X3VzZWQ6IG51bWJlclxuICBhbGVydF9wZXJjZW50OiBudW1iZXJcbiAgYWxlcnRfdHJpZ2dlcmVkOiBib29sZWFuXG4gIHBlcmlvZF9zdGFydDogc3RyaW5nIHwgbnVsbFxuICBwZXJpb2RfZW5kX2V4Y2x1c2l2ZTogc3RyaW5nIHwgbnVsbFxufVxuXG4vKiogcGcgcmV0dXJucyBiaWdpbnQgYXMgc3RyaW5nOyBub3JtYWxpemUgZm9yIEdyYXBoUUwgY2xpZW50cy4gKi9cbmZ1bmN0aW9uIGFzTnVtYmVyKHZhbHVlOiBudW1iZXIgfCBzdHJpbmcpOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIHZhbHVlXG4gIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKG4pKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIGFtb3VudCcpXG4gIH1cbiAgcmV0dXJuIG5cbn1cblxuYXN5bmMgZnVuY3Rpb24gc3VtRXhwZW5zZXNJblBlcmlvZChhcmdzOiB7XG4gIHVzZXJJZDogbnVtYmVyXG4gIGNhdGVnb3J5SWQ6IG51bWJlciB8IG51bGxcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBmcm9tRGF0ZTogc3RyaW5nXG4gIHRvRGF0ZUV4Y2x1c2l2ZTogc3RyaW5nXG59KTogUHJvbWlzZTxudW1iZXI+IHtcbiAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgYXJncy51c2VySWQpXG4gICAgLndoZXJlKCdjdXJyZW5jeScsICc9JywgYXJncy5jdXJyZW5jeSlcbiAgICAud2hlcmUoJ3NwZW50X29uJywgJz49JywgYXJncy5mcm9tRGF0ZSlcbiAgICAud2hlcmUoJ3NwZW50X29uJywgJzwnLCBhcmdzLnRvRGF0ZUV4Y2x1c2l2ZSlcbiAgICAuc2VsZWN0KHNxbDxzdHJpbmc+YGNvYWxlc2NlKHN1bShhbW91bnRfY2VudHMpLCAwKWAuYXMoJ3RvdGFsX2NlbnRzJykpXG5cbiAgaWYgKGFyZ3MuY2F0ZWdvcnlJZCAhPSBudWxsKSB7XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnY2F0ZWdvcnlfaWQnLCAnPScsIGFyZ3MuY2F0ZWdvcnlJZClcbiAgfVxuXG4gIGNvbnN0IHJvdyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgcmV0dXJuIGFzTnVtYmVyKHJvdy50b3RhbF9jZW50cylcbn1cblxuLyoqIENvbXB1dGUgYnVkZ2V0IHN0YXR1c2VzIGZvciBhIHVzZXIgYXMgb2YgYSBjYWxlbmRhciBkYXkgKFlZWVktTU0tREQpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbXB1dGVCdWRnZXRTdGF0dXNlcyhcbiAgdXNlcklkOiBudW1iZXIsXG4gIGFzT2Y6IHN0cmluZyxcbik6IFByb21pc2U8QnVkZ2V0U3RhdHVzUm93W10+IHtcbiAgY29uc3QgYnVkZ2V0cyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2J1ZGdldHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IHN0YXR1c2VzOiBCdWRnZXRTdGF0dXNSb3dbXSA9IFtdXG4gIGZvciAoY29uc3QgYnVkZ2V0IG9mIGJ1ZGdldHMpIHtcbiAgICBjb25zdCBhbW91bnRDZW50cyA9IGFzTnVtYmVyKGJ1ZGdldC5hbW91bnRfY2VudHMpXG4gICAgY29uc3QgcGVyaW9kID0gY3VycmVudFBlcmlvZCh7XG4gICAgICBhbmNob3JEYXRlOiBidWRnZXQuYW5jaG9yX2RhdGUsXG4gICAgICBpbnRlcnZhbFVuaXQ6IGJ1ZGdldC5pbnRlcnZhbF91bml0IGFzIEludGVydmFsVW5pdCxcbiAgICAgIGludGVydmFsQ291bnQ6IGJ1ZGdldC5pbnRlcnZhbF9jb3VudCxcbiAgICAgIGFzT2YsXG4gICAgfSlcblxuICAgIGlmICghcGVyaW9kKSB7XG4gICAgICBzdGF0dXNlcy5wdXNoKHtcbiAgICAgICAgYnVkZ2V0X2lkOiBidWRnZXQuaWQsXG4gICAgICAgIGJ1ZGdldF9uYW1lOiBidWRnZXQubmFtZSxcbiAgICAgICAgY2F0ZWdvcnlfaWQ6IGJ1ZGdldC5jYXRlZ29yeV9pZCxcbiAgICAgICAgY3VycmVuY3k6IGJ1ZGdldC5jdXJyZW5jeSxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgc3BlbnRfY2VudHM6IDAsXG4gICAgICAgIHBlcmNlbnRfdXNlZDogMCxcbiAgICAgICAgYWxlcnRfcGVyY2VudDogYnVkZ2V0LmFsZXJ0X3BlcmNlbnQsXG4gICAgICAgIGFsZXJ0X3RyaWdnZXJlZDogZmFsc2UsXG4gICAgICAgIHBlcmlvZF9zdGFydDogbnVsbCxcbiAgICAgICAgcGVyaW9kX2VuZF9leGNsdXNpdmU6IG51bGwsXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCBzcGVudENlbnRzID0gYXdhaXQgc3VtRXhwZW5zZXNJblBlcmlvZCh7XG4gICAgICB1c2VySWQsXG4gICAgICBjYXRlZ29yeUlkOiBidWRnZXQuY2F0ZWdvcnlfaWQsXG4gICAgICBjdXJyZW5jeTogYnVkZ2V0LmN1cnJlbmN5LFxuICAgICAgZnJvbURhdGU6IHBlcmlvZC5zdGFydCxcbiAgICAgIHRvRGF0ZUV4Y2x1c2l2ZTogcGVyaW9kLmVuZEV4Y2x1c2l2ZSxcbiAgICB9KVxuICAgIGNvbnN0IHBlcmNlbnRVc2VkID0gYW1vdW50Q2VudHMgPiAwXG4gICAgICA/IE1hdGguZmxvb3IoKHNwZW50Q2VudHMgKiAxMDApIC8gYW1vdW50Q2VudHMpXG4gICAgICA6IDBcbiAgICBjb25zdCBhbGVydFRyaWdnZXJlZCA9IHBlcmNlbnRVc2VkID49IGJ1ZGdldC5hbGVydF9wZXJjZW50XG5cbiAgICBzdGF0dXNlcy5wdXNoKHtcbiAgICAgIGJ1ZGdldF9pZDogYnVkZ2V0LmlkLFxuICAgICAgYnVkZ2V0X25hbWU6IGJ1ZGdldC5uYW1lLFxuICAgICAgY2F0ZWdvcnlfaWQ6IGJ1ZGdldC5jYXRlZ29yeV9pZCxcbiAgICAgIGN1cnJlbmN5OiBidWRnZXQuY3VycmVuY3ksXG4gICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgc3BlbnRfY2VudHM6IHNwZW50Q2VudHMsXG4gICAgICBwZXJjZW50X3VzZWQ6IHBlcmNlbnRVc2VkLFxuICAgICAgYWxlcnRfcGVyY2VudDogYnVkZ2V0LmFsZXJ0X3BlcmNlbnQsXG4gICAgICBhbGVydF90cmlnZ2VyZWQ6IGFsZXJ0VHJpZ2dlcmVkLFxuICAgICAgcGVyaW9kX3N0YXJ0OiBwZXJpb2Quc3RhcnQsXG4gICAgICBwZXJpb2RfZW5kX2V4Y2x1c2l2ZTogcGVyaW9kLmVuZEV4Y2x1c2l2ZSxcbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIHN0YXR1c2VzXG59XG4iLCAiLyoqIFJvbGxpbmcgYnVkZ2V0IHBlcmlvZCBoZWxwZXJzIChhbmNob3ItYmFzZWQpLiAqL1xuXG5leHBvcnQgdHlwZSBJbnRlcnZhbFVuaXQgPSAnZGF5JyB8ICd3ZWVrJyB8ICdtb250aCdcblxuZXhwb3J0IGludGVyZmFjZSBQZXJpb2RXaW5kb3cge1xuICAvKiogSW5jbHVzaXZlIHN0YXJ0IGRhdGUgKFlZWVktTU0tREQpLiAqL1xuICBzdGFydDogc3RyaW5nXG4gIC8qKiBFeGNsdXNpdmUgZW5kIGRhdGUgKFlZWVktTU0tREQpLiAqL1xuICBlbmRFeGNsdXNpdmU6IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBwYXJzZURhdGVPbmx5KHZhbHVlOiBzdHJpbmcpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGAke3ZhbHVlfVQwMDowMDowMFpgKVxuICBpZiAoTnVtYmVyLmlzTmFOKGQuZ2V0VGltZSgpKSB8fCBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICE9PSB2YWx1ZSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgaW52YWxpZCBkYXRlOiAke3ZhbHVlfWApXG4gIH1cbiAgcmV0dXJuIGRcbn1cblxuZnVuY3Rpb24gZm9ybWF0RGF0ZU9ubHkoZDogRGF0ZSk6IHN0cmluZyB7XG4gIHJldHVybiBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbmZ1bmN0aW9uIGRheXNCZXR3ZWVuVXRjKGZyb206IERhdGUsIHRvOiBEYXRlKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGguZmxvb3IoKHRvLmdldFRpbWUoKSAtIGZyb20uZ2V0VGltZSgpKSAvICgyNCAqIDYwICogNjAgKiAxMDAwKSlcbn1cblxuLyoqIEFkZCBjYWxlbmRhciBtb250aHMsIGNsYW1waW5nIHRvIHRoZSBsYXN0IGRheSBvZiB0aGUgdGFyZ2V0IG1vbnRoLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFkZE1vbnRoc1V0YyhkYXRlOiBEYXRlLCBtb250aHM6IG51bWJlcik6IERhdGUge1xuICBjb25zdCB5ZWFyID0gZGF0ZS5nZXRVVENGdWxsWWVhcigpXG4gIGNvbnN0IG1vbnRoID0gZGF0ZS5nZXRVVENNb250aCgpXG4gIGNvbnN0IGRheSA9IGRhdGUuZ2V0VVRDRGF0ZSgpXG4gIGNvbnN0IHRhcmdldCA9IG5ldyBEYXRlKERhdGUuVVRDKHllYXIsIG1vbnRoICsgbW9udGhzLCAxKSlcbiAgY29uc3QgbGFzdERheSA9IG5ldyBEYXRlKFxuICAgIERhdGUuVVRDKHRhcmdldC5nZXRVVENGdWxsWWVhcigpLCB0YXJnZXQuZ2V0VVRDTW9udGgoKSArIDEsIDApLFxuICApLmdldFVUQ0RhdGUoKVxuICB0YXJnZXQuc2V0VVRDRGF0ZShNYXRoLm1pbihkYXksIGxhc3REYXkpKVxuICByZXR1cm4gdGFyZ2V0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhZGRJbnRlcnZhbChcbiAgZGF0ZU9ubHk6IHN0cmluZyxcbiAgdW5pdDogSW50ZXJ2YWxVbml0LFxuICBjb3VudDogbnVtYmVyLFxuKTogc3RyaW5nIHtcbiAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGNvdW50KSB8fCBjb3VudCA8IDEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2ludGVydmFsIGNvdW50IG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICBjb25zdCBkID0gcGFyc2VEYXRlT25seShkYXRlT25seSlcbiAgaWYgKHVuaXQgPT09ICdkYXknKSB7XG4gICAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgY291bnQpXG4gICAgcmV0dXJuIGZvcm1hdERhdGVPbmx5KGQpXG4gIH1cbiAgaWYgKHVuaXQgPT09ICd3ZWVrJykge1xuICAgIGQuc2V0VVRDRGF0ZShkLmdldFVUQ0RhdGUoKSArIGNvdW50ICogNylcbiAgICByZXR1cm4gZm9ybWF0RGF0ZU9ubHkoZClcbiAgfVxuICByZXR1cm4gZm9ybWF0RGF0ZU9ubHkoYWRkTW9udGhzVXRjKGQsIGNvdW50KSlcbn1cblxuLyoqXG4gKiBSZXR1cm5zIHRoZSByb2xsaW5nIHBlcmlvZCBjb250YWluaW5nIFthc09mXSwgb3IgbnVsbCB3aGVuIFthc09mXSBpcyBiZWZvcmVcbiAqIHRoZSBhbmNob3IgKG5vIHNwZW5kIGNvdW50ZWQgYmVmb3JlIHRoZSBidWRnZXQgc3RhcnRzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGN1cnJlbnRQZXJpb2QoYXJnczoge1xuICBhbmNob3JEYXRlOiBzdHJpbmdcbiAgaW50ZXJ2YWxVbml0OiBJbnRlcnZhbFVuaXRcbiAgaW50ZXJ2YWxDb3VudDogbnVtYmVyXG4gIGFzT2Y6IHN0cmluZ1xufSk6IFBlcmlvZFdpbmRvdyB8IG51bGwge1xuICBjb25zdCB7IGFuY2hvckRhdGUsIGludGVydmFsVW5pdCwgaW50ZXJ2YWxDb3VudCwgYXNPZiB9ID0gYXJnc1xuICBpZiAoYXNPZiA8IGFuY2hvckRhdGUpIHJldHVybiBudWxsXG5cbiAgaWYgKGludGVydmFsVW5pdCA9PT0gJ2RheScgfHwgaW50ZXJ2YWxVbml0ID09PSAnd2VlaycpIHtcbiAgICBjb25zdCBwZXJpb2REYXlzID1cbiAgICAgIGludGVydmFsVW5pdCA9PT0gJ2RheScgPyBpbnRlcnZhbENvdW50IDogaW50ZXJ2YWxDb3VudCAqIDdcbiAgICBjb25zdCBhbmNob3IgPSBwYXJzZURhdGVPbmx5KGFuY2hvckRhdGUpXG4gICAgY29uc3QgYXNPZkRhdGUgPSBwYXJzZURhdGVPbmx5KGFzT2YpXG4gICAgY29uc3QgZWxhcHNlZCA9IGRheXNCZXR3ZWVuVXRjKGFuY2hvciwgYXNPZkRhdGUpXG4gICAgY29uc3QgaW5kZXggPSBNYXRoLmZsb29yKGVsYXBzZWQgLyBwZXJpb2REYXlzKVxuICAgIGNvbnN0IHN0YXJ0RGF0ZSA9IG5ldyBEYXRlKGFuY2hvcilcbiAgICBzdGFydERhdGUuc2V0VVRDRGF0ZShzdGFydERhdGUuZ2V0VVRDRGF0ZSgpICsgaW5kZXggKiBwZXJpb2REYXlzKVxuICAgIGNvbnN0IGVuZERhdGUgPSBuZXcgRGF0ZShzdGFydERhdGUpXG4gICAgZW5kRGF0ZS5zZXRVVENEYXRlKGVuZERhdGUuZ2V0VVRDRGF0ZSgpICsgcGVyaW9kRGF5cylcbiAgICByZXR1cm4ge1xuICAgICAgc3RhcnQ6IGZvcm1hdERhdGVPbmx5KHN0YXJ0RGF0ZSksXG4gICAgICBlbmRFeGNsdXNpdmU6IGZvcm1hdERhdGVPbmx5KGVuZERhdGUpLFxuICAgIH1cbiAgfVxuXG4gIC8vIE1vbnRoczogd2FsayBmb3J3YXJkIGZyb20gYW5jaG9yIHVudGlsIGFzT2YgZmFsbHMgaW4gW3N0YXJ0LCBlbmQpLlxuICBsZXQgc3RhcnQgPSBhbmNob3JEYXRlXG4gIGxldCBlbmRFeGNsdXNpdmUgPSBhZGRJbnRlcnZhbChzdGFydCwgJ21vbnRoJywgaW50ZXJ2YWxDb3VudClcbiAgLy8gQ2FwIGl0ZXJhdGlvbnMgZm9yIHNhZmV0eSAoZS5nLiB+MTAwIHllYXJzIG9mIG1vbnRobHkgcGVyaW9kcykuXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgMjAwMDsgaSsrKSB7XG4gICAgaWYgKGFzT2YgPj0gc3RhcnQgJiYgYXNPZiA8IGVuZEV4Y2x1c2l2ZSkge1xuICAgICAgcmV0dXJuIHsgc3RhcnQsIGVuZEV4Y2x1c2l2ZSB9XG4gICAgfVxuICAgIHN0YXJ0ID0gZW5kRXhjbHVzaXZlXG4gICAgZW5kRXhjbHVzaXZlID0gYWRkSW50ZXJ2YWwoc3RhcnQsICdtb250aCcsIGludGVydmFsQ291bnQpXG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKCdmYWlsZWQgdG8gcmVzb2x2ZSBtb250aGx5IHBlcmlvZCcpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBQdXNoU2VuZGVyIH0gZnJvbSAnZGVub19hcGlfa2l0L3B1c2gvbW9kLnRzJ1xuaW1wb3J0IHsgTm9PcFB1c2hTZW5kZXIgfSBmcm9tICdkZW5vX2FwaV9raXQvcHVzaC9tb2QudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHtcbiAgY29tcHV0ZUJ1ZGdldFN0YXR1c2VzLFxuICB0eXBlIEJ1ZGdldFN0YXR1c1Jvdyxcbn0gZnJvbSAnLi9zdGF0dXMudHMnXG5cbmxldCBwdXNoU2VuZGVyOiBQdXNoU2VuZGVyID0gbmV3IE5vT3BQdXNoU2VuZGVyKClcblxuLyoqIFdpcmUgdGhlIHByb2Nlc3Mtd2lkZSBzZW5kZXIgKGZyb20gaW5kZXggb3IgdGVzdHMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNldFB1c2hTZW5kZXIoc2VuZGVyOiBQdXNoU2VuZGVyKTogdm9pZCB7XG4gIHB1c2hTZW5kZXIgPSBzZW5kZXJcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGdldFB1c2hTZW5kZXIoKTogUHVzaFNlbmRlciB7XG4gIHJldHVybiBwdXNoU2VuZGVyXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQWxlcnRQdXNoRGVwcyB7XG4gIGNvbXB1dGVTdGF0dXNlczogKFxuICAgIHVzZXJJZDogbnVtYmVyLFxuICAgIGFzT2Y6IHN0cmluZyxcbiAgKSA9PiBQcm9taXNlPEJ1ZGdldFN0YXR1c1Jvd1tdPlxuICB0cnlDbGFpbVNlbmQ6IChcbiAgICBidWRnZXRJZDogbnVtYmVyLFxuICAgIHBlcmlvZFN0YXJ0OiBzdHJpbmcsXG4gICkgPT4gUHJvbWlzZTxib29sZWFuPlxuICBsaXN0VG9rZW5zOiAodXNlcklkOiBudW1iZXIpID0+IFByb21pc2U8c3RyaW5nW10+XG4gIGRlbGV0ZVRva2VuczogKHRva2Vuczogc3RyaW5nW10pID0+IFByb21pc2U8dm9pZD5cbiAgc2VuZGVyOiBQdXNoU2VuZGVyXG4gIGZvcm1hdEJvZHk/OiAoc3RhdHVzOiBCdWRnZXRTdGF0dXNSb3cpID0+IHN0cmluZ1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0Qm9keShzdGF0dXM6IEJ1ZGdldFN0YXR1c1Jvdyk6IHN0cmluZyB7XG4gIHJldHVybiBgJHtzdGF0dXMucGVyY2VudF91c2VkfSUgb2YgYnVkZ2V0IHVzZWRgXG59XG5cbi8qKlxuICogUHVyZS1pc2ggb3JjaGVzdHJhdGlvbjogZm9yIGVhY2ggbmV3bHkgdHJpZ2dlcmVkIGJ1ZGdldCtwZXJpb2QsIGNsYWltXG4gKiBkZWR1cGUgcm93IHRoZW4gc2VuZC4gSW5qZWN0YWJsZSBmb3IgdW5pdCB0ZXN0cy5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzV2l0aERlcHMoXG4gIHVzZXJJZDogbnVtYmVyLFxuICBhc09mOiBzdHJpbmcsXG4gIGRlcHM6IEFsZXJ0UHVzaERlcHMsXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBzdGF0dXNlcyA9IGF3YWl0IGRlcHMuY29tcHV0ZVN0YXR1c2VzKHVzZXJJZCwgYXNPZilcbiAgY29uc3QgdHJpZ2dlcmVkID0gc3RhdHVzZXMuZmlsdGVyKFxuICAgIChzKSA9PiBzLmFsZXJ0X3RyaWdnZXJlZCAmJiBzLnBlcmlvZF9zdGFydCAhPSBudWxsLFxuICApXG4gIGlmICh0cmlnZ2VyZWQubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIGNvbnN0IHRva2VucyA9IGF3YWl0IGRlcHMubGlzdFRva2Vucyh1c2VySWQpXG4gIGlmICh0b2tlbnMubGVuZ3RoID09PSAwKSB7XG4gICAgLy8gU3RpbGwgY2xhaW0gc2VuZHMgc28gd2UgZG9uJ3Qgc3BhbSBvbmNlIGEgdG9rZW4gYXBwZWFycyBtaWQtcGVyaW9kXG4gICAgLy8gYWZ0ZXIgdGhlIHVzZXIgYWxyZWFkeSBzYXcgLyB3b3VsZCBoYXZlIHNlZW4gdGhlIGFsZXJ0IHZpYSBhbm90aGVyIHBhdGguXG4gICAgLy8gQWN0dWFsbHk6IGlmIG5vIHRva2Vucywgd2Ugc2hvdWxkIE5PVCBjbGFpbSBcdTIwMTQgc28gd2hlbiB0aGV5IHJlZ2lzdGVyIGxhdGVyXG4gICAgLy8gaW4gdGhlIHNhbWUgcGVyaW9kIHdlIGNhbiBzdGlsbCBwdXNoLiBQbGFuOiBvbmx5IGNsYWltIG9uIHN1Y2Nlc3NmdWxcbiAgICAvLyBpbnNlcnQgYXR0ZW1wdCBiZWZvcmUgc2VuZDsgaWYgbm8gdG9rZW5zLCBza2lwIGNsYWltLlxuICAgIHJldHVybiAwXG4gIH1cblxuICBsZXQgc2VudCA9IDBcbiAgZm9yIChjb25zdCBzdGF0dXMgb2YgdHJpZ2dlcmVkKSB7XG4gICAgY29uc3QgcGVyaW9kU3RhcnQgPSBzdGF0dXMucGVyaW9kX3N0YXJ0IVxuICAgIGNvbnN0IGNsYWltZWQgPSBhd2FpdCBkZXBzLnRyeUNsYWltU2VuZChzdGF0dXMuYnVkZ2V0X2lkLCBwZXJpb2RTdGFydClcbiAgICBpZiAoIWNsYWltZWQpIGNvbnRpbnVlXG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkZXBzLnNlbmRlci5zZW5kVG9Ub2tlbnModG9rZW5zLCB7XG4gICAgICB0aXRsZTogc3RhdHVzLmJ1ZGdldF9uYW1lLFxuICAgICAgYm9keTogKGRlcHMuZm9ybWF0Qm9keSA/PyBkZWZhdWx0Qm9keSkoc3RhdHVzKSxcbiAgICAgIGRhdGE6IHtcbiAgICAgICAgdHlwZTogJ2J1ZGdldF9hbGVydCcsXG4gICAgICAgIGJ1ZGdldF9pZDogU3RyaW5nKHN0YXR1cy5idWRnZXRfaWQpLFxuICAgICAgICBwZXJpb2Rfc3RhcnQ6IHBlcmlvZFN0YXJ0LFxuICAgICAgICBwZXJjZW50X3VzZWQ6IFN0cmluZyhzdGF0dXMucGVyY2VudF91c2VkKSxcbiAgICAgIH0sXG4gICAgfSlcbiAgICBzZW50ICs9IHJlc3VsdC5zdWNjZXNzQ291bnRcbiAgICBpZiAocmVzdWx0LmludmFsaWRUb2tlbnMubGVuZ3RoID4gMCkge1xuICAgICAgYXdhaXQgZGVwcy5kZWxldGVUb2tlbnMocmVzdWx0LmludmFsaWRUb2tlbnMpXG4gICAgfVxuICB9XG4gIHJldHVybiBzZW50XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHRyeUNsYWltU2VuZChcbiAgYnVkZ2V0SWQ6IG51bWJlcixcbiAgcGVyaW9kU3RhcnQ6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICB0cnkge1xuICAgIGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnYnVkZ2V0X2FsZXJ0X3NlbmRzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBidWRnZXRfaWQ6IGJ1ZGdldElkLFxuICAgICAgICBwZXJpb2Rfc3RhcnQ6IHBlcmlvZFN0YXJ0LFxuICAgICAgICBzZW50X2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLmV4ZWN1dGUoKVxuICAgIHJldHVybiB0cnVlXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycilcbiAgICAvLyBVbmlxdWUgdmlvbGF0aW9uIFx1MjE5MiBhbHJlYWR5IHNlbnQgdGhpcyBwZXJpb2QuXG4gICAgaWYgKFxuICAgICAgbWVzc2FnZS5pbmNsdWRlcygnYnVkZ2V0X2FsZXJ0X3NlbmRzX3BrZXknKSB8fFxuICAgICAgbWVzc2FnZS5pbmNsdWRlcygnZHVwbGljYXRlIGtleScpIHx8XG4gICAgICBtZXNzYWdlLmluY2x1ZGVzKCd1bmlxdWUnKVxuICAgICkge1xuICAgICAgcmV0dXJuIGZhbHNlXG4gICAgfVxuICAgIHRocm93IGVyclxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxpc3RUb2tlbnModXNlcklkOiBudW1iZXIpOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdkZXZpY2VfdG9rZW5zJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0KCd0b2tlbicpXG4gICAgLmV4ZWN1dGUoKVxuICByZXR1cm4gcm93cy5tYXAoKHIpID0+IHIudG9rZW4pXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGRlbGV0ZVRva2Vucyh0b2tlbnM6IHN0cmluZ1tdKTogUHJvbWlzZTx2b2lkPiB7XG4gIGlmICh0b2tlbnMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgYXdhaXQgZGJcbiAgICAuZGVsZXRlRnJvbSgnZGV2aWNlX3Rva2VucycpXG4gICAgLndoZXJlKCd0b2tlbicsICdpbicsIHRva2VucylcbiAgICAuZXhlY3V0ZSgpXG59XG5cbi8qKiBBZnRlciBleHBlbnNlL2J1ZGdldCB3cml0ZXM6IHB1c2ggZm9yIG5ld2x5IGNyb3NzZWQgdGhyZXNob2xkcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBtYXliZVNlbmRCdWRnZXRBbGVydFB1c2hlcyhcbiAgdXNlcklkOiBudW1iZXIsXG4gIGFzT2Y6IHN0cmluZyxcbik6IFByb21pc2U8dm9pZD4ge1xuICB0cnkge1xuICAgIGF3YWl0IG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzV2l0aERlcHModXNlcklkLCBhc09mLCB7XG4gICAgICBjb21wdXRlU3RhdHVzZXM6IGNvbXB1dGVCdWRnZXRTdGF0dXNlcyxcbiAgICAgIHRyeUNsYWltU2VuZCxcbiAgICAgIGxpc3RUb2tlbnMsXG4gICAgICBkZWxldGVUb2tlbnMsXG4gICAgICBzZW5kZXI6IHB1c2hTZW5kZXIsXG4gICAgfSlcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgLy8gQmVzdC1lZmZvcnQ6IG5ldmVyIGZhaWwgdGhlIEdyYXBoUUwgbXV0YXRpb24gYmVjYXVzZSBvZiBwdXNoLlxuICAgIGNvbnNvbGUuZXJyb3IoJ1twdXNoXSBidWRnZXQgYWxlcnQgc2VuZCBmYWlsZWQnLCBlcnIpXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHNxbCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzIH0gZnJvbSAnLi4vLi4vYnVkZ2V0cy9hbGVydF9wdXNoLnRzJ1xuaW1wb3J0IHsgY29tcHV0ZUJ1ZGdldFN0YXR1c2VzIH0gZnJvbSAnLi4vLi4vYnVkZ2V0cy9zdGF0dXMudHMnXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uLy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBOZXdCdWRnZXQsXG4gIE5ld0NhdGVnb3J5LFxuICBOZXdEZXZpY2VUb2tlbixcbiAgTmV3RXhwZW5zZSxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgYXNJc29UaW1lc3RhbXAsIGFzSXNvVGltZXN0YW1wT3JOdWxsIH0gZnJvbSAnLi4vdGltZXN0YW1wcy50cydcbmltcG9ydCB7XG4gIENyZWF0ZUJ1ZGdldElucHV0LFxuICBDcmVhdGVDYXRlZ29yeUlucHV0LFxuICBDcmVhdGVFeHBlbnNlSW5wdXQsXG4gIFVwZGF0ZUJ1ZGdldElucHV0LFxuICBVcGRhdGVDYXRlZ29yeUlucHV0LFxuICBVcGRhdGVFeHBlbnNlSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgSW52YWxpZEJ1ZGdldEVycm9yLFxuICBJbnZhbGlkQ2F0ZWdvcnlFcnJvcixcbiAgSW52YWxpZEV4cGVuc2VFcnJvcixcbiAgdmFsaWRhdGVBbGVydFBlcmNlbnQsXG4gIHZhbGlkYXRlQW1vdW50Q2VudHMsXG4gIHZhbGlkYXRlQW5jaG9yRGF0ZSxcbiAgdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyxcbiAgdmFsaWRhdGVCdWRnZXROYW1lLFxuICB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlOYW1lLFxuICB2YWxpZGF0ZUN1cnJlbmN5LFxuICB2YWxpZGF0ZUludGVydmFsQ291bnQsXG4gIHZhbGlkYXRlSW50ZXJ2YWxVbml0LFxuICB2YWxpZGF0ZU5vdGUsXG4gIHZhbGlkYXRlU3BlbnRPbixcbn0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG4vKiogcGcgcmV0dXJucyBiaWdpbnQgYXMgc3RyaW5nOyBub3JtYWxpemUgZm9yIEdyYXBoUUwgY2xpZW50cy4gKi9cbmZ1bmN0aW9uIGFzTnVtYmVyKHZhbHVlOiBudW1iZXIgfCBzdHJpbmcpOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIHZhbHVlXG4gIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKG4pKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2ludmFsaWQgYW1vdW50JylcbiAgfVxuICByZXR1cm4gblxufVxuXG5mdW5jdGlvbiB0b2RheVV0YygpOiBzdHJpbmcge1xuICByZXR1cm4gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxufVxuXG5mdW5jdGlvbiBtYXBDYXRlZ29yeShyb3c6IHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGNvbG9yOiBzdHJpbmdcbiAgYXJjaGl2ZWRfYXQ6IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBhcmNoaXZlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LmFyY2hpdmVkX2F0KSxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcEV4cGVuc2Uocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIGNhdGVnb3J5X2lkOiBudW1iZXJcbiAgYW1vdW50X2NlbnRzOiBudW1iZXIgfCBzdHJpbmdcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIGFtb3VudF9jZW50czogYXNOdW1iZXIocm93LmFtb3VudF9jZW50cyksXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBCdWRnZXQocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBjYXRlZ29yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBhbW91bnRfY2VudHM6IG51bWJlciB8IHN0cmluZ1xuICBjdXJyZW5jeTogc3RyaW5nXG4gIGludGVydmFsX3VuaXQ6IHN0cmluZ1xuICBpbnRlcnZhbF9jb3VudDogbnVtYmVyXG4gIGFuY2hvcl9kYXRlOiBzdHJpbmdcbiAgYWxlcnRfcGVyY2VudDogbnVtYmVyXG4gIGFyY2hpdmVkX2F0OiBEYXRlIHwgc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbn0pIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgYW1vdW50X2NlbnRzOiBhc051bWJlcihyb3cuYW1vdW50X2NlbnRzKSxcbiAgICBhcmNoaXZlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LmFyY2hpdmVkX2F0KSxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmNvbnN0IERFVklDRV9QTEFURk9STVMgPSBuZXcgU2V0KFsnaW9zJywgJ2FuZHJvaWQnLCAnd2ViJ10pXG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0ocGxhdGZvcm06IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBwbGF0Zm9ybS50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIURFVklDRV9QTEFURk9STVMuaGFzKG5vcm1hbGl6ZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwbGF0Zm9ybSBtdXN0IGJlIGlvcywgYW5kcm9pZCwgb3Igd2ViJylcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURldmljZVRva2VuKHRva2VuOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gdG9rZW4udHJpbSgpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA8IDggfHwgdHJpbW1lZC5sZW5ndGggPiA0MDk2KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIGRldmljZSB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hPd25lZENhdGVnb3J5KGNhdGVnb3J5SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2NhdGVnb3JpZXMnKVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNhdGVnb3J5SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaE93bmVkQnVkZ2V0KGJ1ZGdldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdidWRnZXRzJylcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBidWRnZXRJZClcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgY2F0ZWdvcmllczogYXN5bmMgKGFyZ3M/OiB7IGluY2x1ZGVBcmNoaXZlZD86IGJvb2xlYW4gfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnY2F0ZWdvcmllcycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmICghYXJncz8uaW5jbHVkZUFyY2hpdmVkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBDYXRlZ29yeSlcbiAgfSxcblxuICBjYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyBtYXBDYXRlZ29yeShyb3cpIDogbnVsbFxuICB9LFxuXG4gIGV4cGVuc2VzOiBhc3luYyAoYXJncz86IHtcbiAgICBmcm9tRGF0ZT86IHN0cmluZ1xuICAgIHRvRGF0ZT86IHN0cmluZ1xuICAgIGNhdGVnb3J5SWQ/OiBudW1iZXJcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnc3BlbnRfb24nLCAnZGVzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5mcm9tRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3BlbnRfb24nLCAnPj0nLCB2YWxpZGF0ZVNwZW50T24oYXJncy5mcm9tRGF0ZSkpXG4gICAgfVxuICAgIGlmIChhcmdzPy50b0RhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3NwZW50X29uJywgJzw9JywgdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKSlcbiAgICB9XG4gICAgaWYgKGFyZ3M/LmNhdGVnb3J5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnY2F0ZWdvcnlfaWQnLCAnPScsIGFyZ3MuY2F0ZWdvcnlJZClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcEV4cGVuc2UpXG4gIH0sXG5cbiAgZXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gbWFwRXhwZW5zZShyb3cpIDogbnVsbFxuICB9LFxuXG4gIGV4cGVuc2VUb3RhbHM6IGFzeW5jIChhcmdzOiB7IGZyb21EYXRlOiBzdHJpbmc7IHRvRGF0ZTogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmcm9tRGF0ZSA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLmZyb21EYXRlKVxuICAgIGNvbnN0IHRvRGF0ZSA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLnRvRGF0ZSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC5pbm5lckpvaW4oJ2NhdGVnb3JpZXMnLCAnY2F0ZWdvcmllcy5pZCcsICdleHBlbnNlcy5jYXRlZ29yeV9pZCcpXG4gICAgICAud2hlcmUoJ2V4cGVuc2VzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMuc3BlbnRfb24nLCAnPj0nLCBmcm9tRGF0ZSlcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMuc3BlbnRfb24nLCAnPD0nLCB0b0RhdGUpXG4gICAgICAuc2VsZWN0KFtcbiAgICAgICAgJ2V4cGVuc2VzLmNhdGVnb3J5X2lkJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMubmFtZSBhcyBjYXRlZ29yeV9uYW1lJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMuY29sb3IgYXMgY2F0ZWdvcnlfY29sb3InLFxuICAgICAgICAnZXhwZW5zZXMuY3VycmVuY3knLFxuICAgICAgICBzcWw8c3RyaW5nPmBzdW0oZXhwZW5zZXMuYW1vdW50X2NlbnRzKWAuYXMoJ3RvdGFsX2NlbnRzJyksXG4gICAgICBdKVxuICAgICAgLmdyb3VwQnkoW1xuICAgICAgICAnZXhwZW5zZXMuY2F0ZWdvcnlfaWQnLFxuICAgICAgICAnY2F0ZWdvcmllcy5uYW1lJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMuY29sb3InLFxuICAgICAgICAnZXhwZW5zZXMuY3VycmVuY3knLFxuICAgICAgXSlcbiAgICAgIC5vcmRlckJ5KCd0b3RhbF9jZW50cycsICdkZXNjJylcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiAoe1xuICAgICAgY2F0ZWdvcnlfaWQ6IHJvdy5jYXRlZ29yeV9pZCxcbiAgICAgIGNhdGVnb3J5X25hbWU6IHJvdy5jYXRlZ29yeV9uYW1lLFxuICAgICAgY2F0ZWdvcnlfY29sb3I6IHJvdy5jYXRlZ29yeV9jb2xvcixcbiAgICAgIGN1cnJlbmN5OiByb3cuY3VycmVuY3ksXG4gICAgICB0b3RhbF9jZW50czogYXNOdW1iZXIocm93LnRvdGFsX2NlbnRzKSxcbiAgICB9KSlcbiAgfSxcblxuICBidWRnZXRzOiBhc3luYyAoYXJncz86IHsgaW5jbHVkZUFyY2hpdmVkPzogYm9vbGVhbiB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdidWRnZXRzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ25hbWUnLCAnYXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKCFhcmdzPy5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ2FyY2hpdmVkX2F0JywgJ2lzJywgbnVsbClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcEJ1ZGdldClcbiAgfSxcblxuICBidWRnZXQ6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGZldGNoT3duZWRCdWRnZXQoYXJncy5pZCwgdXNlcklkKVxuICAgIHJldHVybiByb3cgPyBtYXBCdWRnZXQocm93KSA6IG51bGxcbiAgfSxcblxuICBidWRnZXRTdGF0dXNlczogYXN5bmMgKGFyZ3M/OiB7IGFzT2Y/OiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGFzT2YgPSBhcmdzPy5hc09mICE9IG51bGwgPyB2YWxpZGF0ZVNwZW50T24oYXJncy5hc09mKSA6IHRvZGF5VXRjKClcbiAgICByZXR1cm4gYXdhaXQgY29tcHV0ZUJ1ZGdldFN0YXR1c2VzKHVzZXJJZCwgYXNPZilcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IE11dGF0aW9uID0ge1xuICBjcmVhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnY2F0ZWdvcmllcycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbG9yLFxuICAgICAgICAgIGFyY2hpdmVkX2F0OiBudWxsLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3Q2F0ZWdvcnkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgcmV0dXJuIG1hcENhdGVnb3J5KHJvdylcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICB1cGRhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2Nhbm5vdCB1cGRhdGUgYW4gYXJjaGl2ZWQgY2F0ZWdvcnknKVxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSBhcmdzLmlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgICA6IGV4aXN0aW5nLm5hbWVcbiAgICBjb25zdCBjb2xvciA9IGFyZ3MuaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICAgIDogZXhpc3RpbmcuY29sb3JcblxuICAgIHRyeSB7XG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2NhdGVnb3JpZXMnKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbG9yLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgcmV0dXJuIG1hcENhdGVnb3J5KHJvdylcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICBhcmNoaXZlQ2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gbWFwQ2F0ZWdvcnkoZXhpc3RpbmcpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnY2F0ZWdvcmllcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gbWFwQ2F0ZWdvcnkocm93KVxuICB9LFxuXG4gIGNyZWF0ZUV4cGVuc2U6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGNhdGVnb3J5ID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCwgdXNlcklkKVxuICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSB2YWxpZGF0ZUFtb3VudENlbnRzKGFyZ3MuaW5wdXQuYW1vdW50Q2VudHMpXG4gICAgY29uc3Qgc3BlbnRPbiA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLmlucHV0LnNwZW50T24pXG4gICAgY29uc3QgY3VycmVuY3kgPSB2YWxpZGF0ZUN1cnJlbmN5KGFyZ3MuaW5wdXQuY3VycmVuY3kgPz8gJ1VTRCcpXG4gICAgY29uc3Qgbm90ZSA9IHZhbGlkYXRlTm90ZShhcmdzLmlucHV0Lm5vdGUpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2V4cGVuc2VzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeS5pZCxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIHNwZW50X29uOiBzcGVudE9uLFxuICAgICAgICBub3RlLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3RXhwZW5zZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGF3YWl0IG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzKHVzZXJJZCwgdG9kYXlVdGMoKSlcbiAgICByZXR1cm4gbWFwRXhwZW5zZShyb3cpXG4gIH0sXG5cbiAgdXBkYXRlRXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUV4cGVuc2VJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2V4cGVuc2Ugbm90IGZvdW5kJylcbiAgICB9XG5cbiAgICBsZXQgY2F0ZWdvcnlJZCA9IGV4aXN0aW5nLmNhdGVnb3J5X2lkXG4gICAgaWYgKGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICAgIH1cbiAgICAgIGNhdGVnb3J5SWQgPSBjYXRlZ29yeS5pZFxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXJncy5pbnB1dC5hbW91bnRDZW50cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICAgIDogYXNOdW1iZXIoZXhpc3RpbmcuYW1vdW50X2NlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSBhcmdzLmlucHV0LnNwZW50T24gIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgICAgOiBleGlzdGluZy5zcGVudF9vblxuICAgIGNvbnN0IGN1cnJlbmN5ID0gYXJncy5pbnB1dC5jdXJyZW5jeSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSlcbiAgICAgIDogZXhpc3RpbmcuY3VycmVuY3lcbiAgICBjb25zdCBub3RlID0gYXJncy5pbnB1dC5ub3RlICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVOb3RlKGFyZ3MuaW5wdXQubm90ZSlcbiAgICAgIDogZXhpc3Rpbmcubm90ZVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZXhwZW5zZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeUlkLFxuICAgICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgICBjdXJyZW5jeSxcbiAgICAgICAgc3BlbnRfb246IHNwZW50T24sXG4gICAgICAgIG5vdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBtYXliZVNlbmRCdWRnZXRBbGVydFB1c2hlcyh1c2VySWQsIHRvZGF5VXRjKCkpXG4gICAgcmV0dXJuIG1hcEV4cGVuc2Uocm93KVxuICB9LFxuXG4gIGRlbGV0ZUV4cGVuc2U6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwICYmIE51bWJlcihyZXN1bHRbMF0/Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMFxuICB9LFxuXG4gIGNyZWF0ZUJ1ZGdldDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUJ1ZGdldElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVCdWRnZXROYW1lKGFyZ3MuaW5wdXQubmFtZSlcbiAgICBjb25zdCBhbW91bnRDZW50cyA9IHZhbGlkYXRlQnVkZ2V0QW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICBjb25zdCBpbnRlcnZhbFVuaXQgPSB2YWxpZGF0ZUludGVydmFsVW5pdChhcmdzLmlucHV0LmludGVydmFsVW5pdClcbiAgICBjb25zdCBpbnRlcnZhbENvdW50ID0gdmFsaWRhdGVJbnRlcnZhbENvdW50KGFyZ3MuaW5wdXQuaW50ZXJ2YWxDb3VudClcbiAgICBjb25zdCBhbmNob3JEYXRlID0gdmFsaWRhdGVBbmNob3JEYXRlKGFyZ3MuaW5wdXQuYW5jaG9yRGF0ZSlcbiAgICBjb25zdCBhbGVydFBlcmNlbnQgPSB2YWxpZGF0ZUFsZXJ0UGVyY2VudChhcmdzLmlucHV0LmFsZXJ0UGVyY2VudClcbiAgICBjb25zdCBjdXJyZW5jeSA9IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSA/PyAnVVNEJylcblxuICAgIGxldCBjYXRlZ29yeUlkOiBudW1iZXIgfCBudWxsID0gbnVsbFxuICAgIGlmIChhcmdzLmlucHV0LmNhdGVnb3J5SWQgIT0gbnVsbCkge1xuICAgICAgY29uc3QgY2F0ZWdvcnkgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pbnB1dC5jYXRlZ29yeUlkLCB1c2VySWQpXG4gICAgICBpZiAoIWNhdGVnb3J5IHx8IGNhdGVnb3J5LmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICAgIH1cbiAgICAgIGNhdGVnb3J5SWQgPSBjYXRlZ29yeS5pZFxuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnYnVkZ2V0cycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnlJZCxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIGludGVydmFsX3VuaXQ6IGludGVydmFsVW5pdCxcbiAgICAgICAgaW50ZXJ2YWxfY291bnQ6IGludGVydmFsQ291bnQsXG4gICAgICAgIGFuY2hvcl9kYXRlOiBhbmNob3JEYXRlLFxuICAgICAgICBhbGVydF9wZXJjZW50OiBhbGVydFBlcmNlbnQsXG4gICAgICAgIGFyY2hpdmVkX2F0OiBudWxsLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3QnVkZ2V0KVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgYXdhaXQgbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXModXNlcklkLCB0b2RheVV0YygpKVxuICAgIHJldHVybiBtYXBCdWRnZXQocm93KVxuICB9LFxuXG4gIHVwZGF0ZUJ1ZGdldDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUJ1ZGdldElucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGZldGNoT3duZWRCdWRnZXQoYXJncy5pZCwgdXNlcklkKVxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2J1ZGdldCBub3QgZm91bmQnKVxuICAgIH1cbiAgICBpZiAoZXhpc3RpbmcuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignY2Fubm90IHVwZGF0ZSBhbiBhcmNoaXZlZCBidWRnZXQnKVxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSBhcmdzLmlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUJ1ZGdldE5hbWUoYXJncy5pbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSBhcmdzLmlucHV0LmFtb3VudENlbnRzICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgICAgOiBhc051bWJlcihleGlzdGluZy5hbW91bnRfY2VudHMpXG4gICAgY29uc3QgaW50ZXJ2YWxVbml0ID0gYXJncy5pbnB1dC5pbnRlcnZhbFVuaXQgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUludGVydmFsVW5pdChhcmdzLmlucHV0LmludGVydmFsVW5pdClcbiAgICAgIDogdmFsaWRhdGVJbnRlcnZhbFVuaXQoZXhpc3RpbmcuaW50ZXJ2YWxfdW5pdClcbiAgICBjb25zdCBpbnRlcnZhbENvdW50ID0gYXJncy5pbnB1dC5pbnRlcnZhbENvdW50ICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVJbnRlcnZhbENvdW50KGFyZ3MuaW5wdXQuaW50ZXJ2YWxDb3VudClcbiAgICAgIDogZXhpc3RpbmcuaW50ZXJ2YWxfY291bnRcbiAgICBjb25zdCBhbmNob3JEYXRlID0gYXJncy5pbnB1dC5hbmNob3JEYXRlICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVBbmNob3JEYXRlKGFyZ3MuaW5wdXQuYW5jaG9yRGF0ZSlcbiAgICAgIDogZXhpc3RpbmcuYW5jaG9yX2RhdGVcbiAgICBjb25zdCBhbGVydFBlcmNlbnQgPSBhcmdzLmlucHV0LmFsZXJ0UGVyY2VudCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQWxlcnRQZXJjZW50KGFyZ3MuaW5wdXQuYWxlcnRQZXJjZW50KVxuICAgICAgOiBleGlzdGluZy5hbGVydF9wZXJjZW50XG4gICAgY29uc3QgY3VycmVuY3kgPSBhcmdzLmlucHV0LmN1cnJlbmN5ICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5KVxuICAgICAgOiBleGlzdGluZy5jdXJyZW5jeVxuXG4gICAgbGV0IGNhdGVnb3J5SWQgPSBleGlzdGluZy5jYXRlZ29yeV9pZFxuICAgIGlmIChhcmdzLmlucHV0LmNhdGVnb3J5SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCA9PSBudWxsKSB7XG4gICAgICAgIGNhdGVnb3J5SWQgPSBudWxsXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICAgICAgaWYgKCFjYXRlZ29yeSB8fCBjYXRlZ29yeS5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICAgICAgfVxuICAgICAgICBjYXRlZ29yeUlkID0gY2F0ZWdvcnkuaWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdidWRnZXRzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBuYW1lLFxuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnlJZCxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIGludGVydmFsX3VuaXQ6IGludGVydmFsVW5pdCxcbiAgICAgICAgaW50ZXJ2YWxfY291bnQ6IGludGVydmFsQ291bnQsXG4gICAgICAgIGFuY2hvcl9kYXRlOiBhbmNob3JEYXRlLFxuICAgICAgICBhbGVydF9wZXJjZW50OiBhbGVydFBlcmNlbnQsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBtYXliZVNlbmRCdWRnZXRBbGVydFB1c2hlcyh1c2VySWQsIHRvZGF5VXRjKCkpXG4gICAgcmV0dXJuIG1hcEJ1ZGdldChyb3cpXG4gIH0sXG5cbiAgYXJjaGl2ZUJ1ZGdldDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQnVkZ2V0KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdidWRnZXQgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHJldHVybiBtYXBCdWRnZXQoZXhpc3RpbmcpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYnVkZ2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBtYXBCdWRnZXQocm93KVxuICB9LFxuXG4gIHJlZ2lzdGVyRGV2aWNlVG9rZW46IGFzeW5jIChhcmdzOiB7IHRva2VuOiBzdHJpbmc7IHBsYXRmb3JtOiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHRva2VuID0gdmFsaWRhdGVEZXZpY2VUb2tlbihhcmdzLnRva2VuKVxuICAgIGNvbnN0IHBsYXRmb3JtID0gdmFsaWRhdGVEZXZpY2VQbGF0Zm9ybShhcmdzLnBsYXRmb3JtKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdkZXZpY2VfdG9rZW5zJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIHRva2VuLFxuICAgICAgICBwbGF0Zm9ybSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdEZXZpY2VUb2tlbilcbiAgICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgICAgb2MuY29sdW1uKCd0b2tlbicpLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9KVxuICAgICAgKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHRydWVcbiAgfSxcblxuICB1bnJlZ2lzdGVyRGV2aWNlVG9rZW46IGFzeW5jIChhcmdzOiB7IHRva2VuOiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHRva2VuID0gdmFsaWRhdGVEZXZpY2VUb2tlbihhcmdzLnRva2VuKVxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbSgnZGV2aWNlX3Rva2VucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgndG9rZW4nLCAnPScsIHRva2VuKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwICYmIE51bWJlcihyZXN1bHRbMF0/Lm51bURlbGV0ZWRSb3dzID8/IDApID4gMFxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59XG4iLCAiLyoqXG4gKiBwZyByZXR1cm5zIEpTIERhdGUgZm9yIHRpbWVzdGFtcHM7IEdyYXBoUUwgdGhlbiBvZnRlbiBleHBvc2VzIHRoZW0gYXMgZXBvY2hcbiAqIG1pbGxpcyAob3IgZGlnaXQgc3RyaW5ncyksIHdoaWNoIGJyZWFrcyBGbHV0dGVyJ3MgRGF0ZVRpbWUucGFyc2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc0lzb1RpbWVzdGFtcCh2YWx1ZTogRGF0ZSB8IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpIHJldHVybiB2YWx1ZS50b0lTT1N0cmluZygpXG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKClcbiAgaWYgKC9eXFxkezEwLH0kLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgY29uc3QgbiA9IE51bWJlcih0cmltbWVkKVxuICAgIGNvbnN0IG1zID0gdHJpbW1lZC5sZW5ndGggPD0gMTAgPyBuICogMTAwMCA6IG5cbiAgICByZXR1cm4gbmV3IERhdGUobXMpLnRvSVNPU3RyaW5nKClcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzSXNvVGltZXN0YW1wT3JOdWxsKFxuICB2YWx1ZTogRGF0ZSB8IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiBhc0lzb1RpbWVzdGFtcCh2YWx1ZSlcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEludGVydmFsVW5pdCB9IGZyb20gJy4uL2J1ZGdldHMvcGVyaW9kLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZENhdGVnb3J5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRDYXRlZ29yeUVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkRXhwZW5zZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkRXhwZW5zZUVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQnVkZ2V0RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRCdWRnZXRFcnJvcidcbiAgfVxufVxuXG5jb25zdCBIRVhfQ09MT1IgPSAvXiNbMC05QS1GYS1mXXs2fSQvXG5jb25zdCBEQVRFX09OTFkgPSAvXlxcZHs0fS1cXGR7Mn0tXFxkezJ9JC9cbmNvbnN0IENVUlJFTkNZID0gL15bQS1aXXszfSQvXG5jb25zdCBJTlRFUlZBTF9VTklUUyA9IG5ldyBTZXQ8SW50ZXJ2YWxVbml0PihbJ2RheScsICd3ZWVrJywgJ21vbnRoJ10pXG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNhdGVnb3J5TmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ25hbWUgaXMgdG9vIGxvbmcnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBjb2xvci50cmltKClcbiAgaWYgKCFIRVhfQ09MT1IudGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignY29sb3IgbXVzdCBiZSBhIGhleCB2YWx1ZSBsaWtlICMwRjc2NkUnKVxuICB9XG4gIHJldHVybiB0cmltbWVkLnRvVXBwZXJDYXNlKClcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQW1vdW50Q2VudHMoYW1vdW50Q2VudHM6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKGFtb3VudENlbnRzKSB8fCAhTnVtYmVyLmlzSW50ZWdlcihhbW91bnRDZW50cykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignYW1vdW50X2NlbnRzIG11c3QgYmUgYW4gaW50ZWdlcicpXG4gIH1cbiAgaWYgKGFtb3VudENlbnRzIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignYW1vdW50X2NlbnRzIG11c3QgYmUgcG9zaXRpdmUnKVxuICB9XG4gIHJldHVybiBhbW91bnRDZW50c1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDdXJyZW5jeShjdXJyZW5jeTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGN1cnJlbmN5LnRyaW0oKS50b1VwcGVyQ2FzZSgpXG4gIGlmICghQ1VSUkVOQ1kudGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdjdXJyZW5jeSBtdXN0IGJlIGEgMy1sZXR0ZXIgSVNPIGNvZGUnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVNwZW50T24oc3BlbnRPbjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHNwZW50T24udHJpbSgpXG4gIGlmICghREFURV9PTkxZLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignc3BlbnRfb24gbXVzdCBiZSBZWVlZLU1NLUREJylcbiAgfVxuICBjb25zdCBkID0gbmV3IERhdGUoYCR7dHJpbW1lZH1UMDA6MDA6MDBaYClcbiAgaWYgKE51bWJlci5pc05hTihkLmdldFRpbWUoKSkgfHwgZC50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKSAhPT0gdHJpbW1lZCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdzcGVudF9vbiBpcyBub3QgYSB2YWxpZCBkYXRlJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVOb3RlKG5vdGU6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQpOiBzdHJpbmcgfCBudWxsIHtcbiAgaWYgKG5vdGUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgdHJpbW1lZCA9IG5vdGUudHJpbSgpXG4gIHJldHVybiB0cmltbWVkLmxlbmd0aCA9PT0gMCA/IG51bGwgOiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUJ1ZGdldE5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ25hbWUgaXMgdG9vIGxvbmcnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUJ1ZGdldEFtb3VudENlbnRzKGFtb3VudENlbnRzOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShhbW91bnRDZW50cykgfHwgIU51bWJlci5pc0ludGVnZXIoYW1vdW50Q2VudHMpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYW1vdW50X2NlbnRzIG11c3QgYmUgYW4gaW50ZWdlcicpXG4gIH1cbiAgaWYgKGFtb3VudENlbnRzIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdhbW91bnRfY2VudHMgbXVzdCBiZSBwb3NpdGl2ZScpXG4gIH1cbiAgcmV0dXJuIGFtb3VudENlbnRzXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUludGVydmFsVW5pdCh1bml0OiBzdHJpbmcpOiBJbnRlcnZhbFVuaXQge1xuICBjb25zdCB0cmltbWVkID0gdW5pdC50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIUlOVEVSVkFMX1VOSVRTLmhhcyh0cmltbWVkIGFzIEludGVydmFsVW5pdCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdpbnRlcnZhbF91bml0IG11c3QgYmUgZGF5LCB3ZWVrLCBvciBtb250aCcpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQgYXMgSW50ZXJ2YWxVbml0XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUludGVydmFsQ291bnQoY291bnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKGNvdW50KSB8fCAhTnVtYmVyLmlzSW50ZWdlcihjb3VudCkgfHwgY291bnQgPCAxKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignaW50ZXJ2YWxfY291bnQgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEnKVxuICB9XG4gIHJldHVybiBjb3VudFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbGVydFBlcmNlbnQocGVyY2VudDogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUocGVyY2VudCkgfHwgIU51bWJlci5pc0ludGVnZXIocGVyY2VudCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdhbGVydF9wZXJjZW50IG11c3QgYmUgYW4gaW50ZWdlcicpXG4gIH1cbiAgaWYgKHBlcmNlbnQgPCAxIHx8IHBlcmNlbnQgPiAxMDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdhbGVydF9wZXJjZW50IG11c3QgYmUgYmV0d2VlbiAxIGFuZCAxMDAnKVxuICB9XG4gIHJldHVybiBwZXJjZW50XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFuY2hvckRhdGUoYW5jaG9yRGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdmFsaWRhdGVTcGVudE9uKGFuY2hvckRhdGUpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2FuY2hvcl9kYXRlIG11c3QgYmUgWVlZWS1NTS1ERCcpXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVSZW1vdGVKV0tTZXQsIGp3dFZlcmlmeSB9IGZyb20gJ2pvc2UnXG5pbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJyxcbiAgICAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgKVxufVxuIiwgImltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQge1xuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG4gIHR5cGUgVmVyaWZpZWRBdXRoLFxufSBmcm9tICcuLi9hdXRoL3ZlcmlmeS50cydcblxuLyoqIFB1YmxpYyBBTEIgLyBsb2FkLWJhbGFuY2VyIGhlYWx0aCBjaGVjay4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBoZWFsdGhNaWRkbGV3YXJlKFxuICBjdHg6IENvbnRleHQsXG4gIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4pIHtcbiAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG4gIGlmIChwYXRoID09PSAnL2hlYWx0aCcgJiYgY3R4LnJlcS5tZXRob2QgPT09ICdHRVQnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IG9rOiB0cnVlIH0pLCB7XG4gICAgICBzdGF0dXM6IDIwMCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuICBhd2FpdCBuZXh0KClcbn1cblxuZXhwb3J0IHR5cGUgTG9jYWxVc2VyUmVmID0ge1xuICBpZDogbnVtYmVyXG59XG5cbmV4cG9ydCB0eXBlIFJlc29sdmVMb2NhbFVzZXJGbiA9IChcbiAgaWRlbnRpdHk6IFZlcmlmaWVkQXV0aCxcbikgPT4gUHJvbWlzZTxMb2NhbFVzZXJSZWY+XG5cbi8qKlxuICogUmVxdWlyZSBhIHZhbGlkIEJlYXJlciBKV1Qgb24gYC9ncmFwaHFsYCBhbmQgc2V0IFB5bG9uIGNvbnRleHQgdmFyczpcbiAqIGB1c2VySWRgLCBgYXV0aFVzZXJJZGAsIG9wdGlvbmFsIGBhdXRoRW1haWxgLlxuICpcbiAqIENhbGxlcnMgdGhhdCBuZWVkIGF1dGggZm9yIG90aGVyIHBhdGhzIChlLmcuIFJFU1QgYXNzZXRzKSBzaG91bGQgaGFuZGxlXG4gKiB0aG9zZSBiZWZvcmUgdGhpcyBtaWRkbGV3YXJlIG9yIHVzZSBgdmVyaWZ5QWNjZXNzVG9rZW5gIGRpcmVjdGx5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKFxuICByZXNvbHZlTG9jYWxVc2VyOiBSZXNvbHZlTG9jYWxVc2VyRm4sXG4pIHtcbiAgcmV0dXJuIGFzeW5jIGZ1bmN0aW9uIGdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgICBjdHg6IENvbnRleHQsXG4gICAgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPixcbiAgKSB7XG4gICAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG5cbiAgICBpZiAoXG4gICAgICBwYXRoID09PSAnL2hlYWx0aCcgfHxcbiAgICAgIChwYXRoICE9PSAnL2dyYXBocWwnICYmICFwYXRoLmVuZHNXaXRoKCcvZ3JhcGhxbCcpKVxuICAgICkge1xuICAgICAgYXdhaXQgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG5cbiAgICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJykpXG4gICAgaWYgKCF2ZXJpZmllZCkge1xuICAgICAgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcbiAgICB9XG5cbiAgICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHZlcmlmaWVkKVxuXG4gICAgY3R4LnNldCgnYXV0aFVzZXJJZCcsIHZlcmlmaWVkLmF1dGhVc2VySWQpXG4gICAgaWYgKHZlcmlmaWVkLmVtYWlsKSB7XG4gICAgICBjdHguc2V0KCdhdXRoRW1haWwnLCB2ZXJpZmllZC5lbWFpbClcbiAgICB9XG4gICAgY3R4LnNldCgndXNlcklkJywgbG9jYWxVc2VyLmlkKVxuXG4gICAgYXdhaXQgbmV4dCgpXG4gIH1cbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgS3lzZWx5LCBTZWxlY3RhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vKiogTWluaW1hbCB1c2VycyB0YWJsZSBzaGFwZSByZXF1aXJlZCBieSByZXNvbHZlTG9jYWxVc2VyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgVXNlcnNEYXRhYmFzZSA9IHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbn1cblxuZXhwb3J0IHR5cGUgTG9jYWxVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyPERCIGV4dGVuZHMgVXNlcnNEYXRhYmFzZT4oXG4gIGRiOiBLeXNlbHk8REI+LFxuICBpZGVudGl0eTogQXV0aElkZW50aXR5LFxuKTogUHJvbWlzZTxTZWxlY3RhYmxlPERCWyd1c2VycyddPj4ge1xuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2F1dGhfdXNlcl9pZCcsICc9JywgaWRlbnRpdHkuYXV0aFVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICBjb25zdCBlbWFpbCA9XG4gICAgaWRlbnRpdHkuZW1haWw/LnRyaW0oKSB8fFxuICAgIGAke2lkZW50aXR5LmF1dGhVc2VySWR9QHVzZXJzLmxvY2FsYFxuICBjb25zdCBuYW1lID1cbiAgICBpZGVudGl0eS5uYW1lPy50cmltKCkgfHxcbiAgICBlbWFpbC5zcGxpdCgnQCcpWzBdIHx8XG4gICAgJ1VzZXInXG5cbiAgLy8gUHJlZmVyIGxpbmtpbmcgYW4gZXhpc3RpbmcgZW1haWwgcm93IChlLmcuIHNlZWRlZCBkZXYgdXNlcikgd2hlbiBwcmVzZW50LlxuICBjb25zdCBieUVtYWlsID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnZW1haWwnLCAnPScsIGVtYWlsKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoYnlFbWFpbCkge1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCd1c2VycycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgICBuYW1lOiBieUVtYWlsLm5hbWUgfHwgbmFtZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGJ5RW1haWwuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gIH1cblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygndXNlcnMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZW1haWwsXG4gICAgICBuYW1lLFxuICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgcGFzc3dvcmRfaGFzaDogbnVsbCxcbiAgICB9KVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG4iLCAiaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciBhcyByZXNvbHZlTG9jYWxVc2VyS2l0IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgeyBBdXRoSWRlbnRpdHkgfVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIHJldHVybiByZXNvbHZlTG9jYWxVc2VyS2l0KGRiLCBpZGVudGl0eSlcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLFdBQVc7OztBQ0diLElBQU0saUJBQU4sTUFBMkM7QUFBQSxFQUNoRCxNQUFNLGFBQ0osU0FDQSxVQUM2QjtBQUM3QixXQUFPLEVBQUUsY0FBYyxHQUFHLGVBQWUsQ0FBQyxFQUFFO0FBQUEsRUFDOUM7QUFDRjs7O0FDVE8sU0FBUyxJQUFJLE1BQWtDO0FBQ3BELE1BQUksT0FBTyxZQUFZLGVBQWUsUUFBUSxNQUFNLElBQUksR0FBRztBQUN6RCxXQUFPLFFBQVEsSUFBSSxJQUFJO0FBQUEsRUFDekI7QUFDQSxNQUFJO0FBQ0YsV0FBTyxLQUFLLElBQUksSUFBSSxJQUFJO0FBQUEsRUFDMUIsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7OztBQ05BLGVBQWUsYUFBYSxNQUErQjtBQUN6RCxNQUFJLE9BQU8sU0FBUyxlQUFlLE9BQU8sS0FBSyxpQkFBaUIsWUFBWTtBQUMxRSxXQUFPLE1BQU0sS0FBSyxhQUFhLElBQUk7QUFBQSxFQUNyQztBQUNBLFFBQU0sRUFBRSxTQUFTLElBQUksTUFBTSxPQUFPLGtCQUFrQjtBQUNwRCxTQUFPLE1BQU0sU0FBUyxNQUFNLE1BQU07QUFDcEM7QUErQkEsSUFBTSxzQkFBc0Isb0JBQUksSUFBSTtBQUFBLEVBQ2xDO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFRTSxJQUFNLHFCQUFOLE1BQStDO0FBQUEsRUFDcEQsWUFBNkIsV0FBc0I7QUFBdEI7QUFBQSxFQUF1QjtBQUFBLEVBRXBELE1BQU0sYUFDSixRQUNBLFNBQzZCO0FBQzdCLFFBQUksT0FBTyxXQUFXLEdBQUc7QUFDdkIsYUFBTyxFQUFFLGNBQWMsR0FBRyxlQUFlLENBQUMsRUFBRTtBQUFBLElBQzlDO0FBRUEs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LEtBQUssUUFBUSxFQUFFLEVBQzNCLGFBQWEsRUFDYix3QkFBd0I7QUFBQSxFQUM3QjtBQUVBLFNBQU8sTUFBTUEsSUFDVixXQUFXLE9BQU8sRUFDbEIsT0FBTztBQUFBLElBQ047QUFBQSxJQUNBO0FBQUEsSUFDQSxjQUFjLFNBQVM7QUFBQSxJQUN2QixlQUFlO0FBQUEsRUFDakIsQ0FBQyxFQUNBLGFBQWEsRUFDYix3QkFBd0I7QUFDN0I7OztBQ3RFQSxlQUFzQkMsa0JBQWlCLFVBQXVDO0FBQzVFLFNBQU8saUJBQW9CLElBQUksUUFBUTtBQUN6Qzs7O0FqQllNLFNBQVEsV0FBVyw4QkFBNkI7QUFidEQsSUFBTUMsY0FBYSxNQUFNLHdCQUF3QjtBQUNqRCxjQUFjQSxXQUFVO0FBRXhCLElBQUksSUFBSSxjQUFjO0FBQ3RCLElBQUksSUFBSSxnQkFBZ0I7QUFDeEIsSUFBSSxJQUFJLDRCQUE0QkMsaUJBQWdCLENBQUM7QUFFOUMsSUFBTSxVQUFVO0FBQUEsRUFDckIsR0FBRztBQUNMO0FBRUEsSUFBTyxjQUFRO0FBSVQsSUFBSSx3QkFBd0I7QUFFNUIsSUFBSTtBQUNGLDBCQUF3QjtBQUMxQixRQUFRO0FBRVI7QUFFQSxJQUFJLElBQUksdUJBQXVCO0FBQUEsRUFDN0IsVUFBVTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFdBQVcsQ0FBQztBQUFBLEVBQ1osUUFBUTtBQUNWLENBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFsic3FsIiwgImFzTnVtYmVyIiwgInNxbCIsICJyZXNvbHZlTG9jYWxVc2VyIiwgImRiIiwgInJlc29sdmVMb2NhbFVzZXIiLCAicHVzaFNlbmRlciIsICJyZXNvbHZlTG9jYWxVc2VyIl0KfQo=
