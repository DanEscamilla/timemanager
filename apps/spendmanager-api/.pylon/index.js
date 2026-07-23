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
  typeDefs: "input ArgsInput {\n	includeArchived: Boolean\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	fromDate: String\n	toDate: String\n	categoryId: Number\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	fromDate: String!\n	toDate: String!\n}\ninput ArgsInput_5 {\n	includeArchived: Boolean\n}\ninput ArgsInput_6 {\n	id: Number!\n}\ninput ArgsInput_7 {\n	asOf: String\n}\ninput ArgsInput_8 {\n	input: CreateCategoryInputInput!\n}\ninput CreateCategoryInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_9 {\n	id: Number!\n	input: UpdateCategoryInputInput!\n}\ninput UpdateCategoryInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	input: CreateExpenseInputInput!\n}\ninput CreateExpenseInputInput {\n	categoryId: Number!\n	amountCents: Number!\n	spentOn: String!\n	currency: String\n	note: String\n}\ninput ArgsInput_12 {\n	id: Number!\n	input: UpdateExpenseInputInput!\n}\ninput UpdateExpenseInputInput {\n	categoryId: Number\n	amountCents: Number\n	spentOn: String\n	currency: String\n	note: String\n}\ninput ArgsInput_13 {\n	id: Number!\n}\ninput ArgsInput_14 {\n	input: CreateBudgetInputInput!\n}\ninput CreateBudgetInputInput {\n	name: String!\n	amountCents: Number!\n	intervalUnit: String!\n	intervalCount: Number!\n	anchorDate: String!\n	alertPercent: Number!\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_15 {\n	id: Number!\n	input: UpdateBudgetInputInput!\n}\ninput UpdateBudgetInputInput {\n	name: String\n	amountCents: Number\n	intervalUnit: String\n	intervalCount: Number\n	anchorDate: String\n	alertPercent: Number\n	categoryId: Number\n	currency: String\n}\ninput ArgsInput_16 {\n	id: Number!\n}\ninput ArgsInput_17 {\n	token: String!\n	platform: String!\n}\ninput ArgsInput_18 {\n	token: String!\n}\ntype Query {\ncategories(args: ArgsInput): [Category!]!\ncategory(args: ArgsInput_1!): Category\nexpenses(args: ArgsInput_2): [Expense!]!\nexpense(args: ArgsInput_3!): Expense\nexpenseTotals(args: ArgsInput_4!): [ExpenseTotal!]!\nbudgets(args: ArgsInput_5): [Budget!]!\nbudget(args: ArgsInput_6!): Budget\nbudgetStatuses(args: ArgsInput_7): [BudgetStatusRow!]!\n}\ntype Category {\nid: Number!\nuser_id: Number!\nname: String!\ncolor: String!\narchived_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype Expense {\nid: Number!\nuser_id: Number!\ncategory_id: Number!\namount_cents: Number!\ncurrency: String!\nspent_on: String!\nnote: String\ncreated_at: String!\nupdated_at: String!\n}\ntype ExpenseTotal {\ncategory_id: Number!\ncategory_name: String!\ncategory_color: String!\ncurrency: String!\ntotal_cents: Number!\n}\ntype Budget {\nid: Number!\nuser_id: Number!\nname: String!\ncategory_id: Number\namount_cents: Number!\ncurrency: String!\ninterval_unit: String!\ninterval_count: Number!\nanchor_date: String!\nalert_percent: Number!\narchived_at: String\ncreated_at: String!\nupdated_at: String!\n}\ntype BudgetStatusRow {\nbudget_id: Number!\nbudget_name: String!\ncategory_id: Number\ncurrency: String!\namount_cents: Number!\nspent_cents: Number!\npercent_used: Number!\nalert_percent: Number!\nalert_triggered: Boolean!\nperiod_start: String\nperiod_end_exclusive: String\n}\ntype Mutation {\ncreateCategory(args: ArgsInput_8!): Category!\nupdateCategory(args: ArgsInput_9!): Category!\narchiveCategory(args: ArgsInput_10!): Category!\ncreateExpense(args: ArgsInput_11!): Expense!\nupdateExpense(args: ArgsInput_12!): Expense!\ndeleteExpense(args: ArgsInput_13!): Boolean!\ncreateBudget(args: ArgsInput_14!): Budget!\nupdateBudget(args: ArgsInput_15!): Budget!\narchiveBudget(args: ArgsInput_16!): Budget!\nregisterDeviceToken(args: ArgsInput_17!): Boolean!\nunregisterDeviceToken(args: ArgsInput_18!): Boolean!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvbm9vcF9zZW5kZXIudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvZW52LnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L3B1c2gvZmlyZWJhc2Vfc2VuZGVyLnRzIiwgIi4uL3NyYy9kYi90eXBlcy9zY2hlbWEudHMiLCAiLi4vLi4vLi4vbGlicy9kZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9kYi9zc2wudHMiLCAiLi4vc3JjL2RiL2RhdGFiYXNlLnRzIiwgIi4uL3NyYy9idWRnZXRzL3N0YXR1cy50cyIsICIuLi9zcmMvYnVkZ2V0cy9wZXJpb2QudHMiLCAiLi4vc3JjL2J1ZGdldHMvYWxlcnRfcHVzaC50cyIsICIuLi9zcmMvZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzIiwgIi4uL3NyYy9ncmFwaHFsL3RpbWVzdGFtcHMudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cyIsICIuLi8uLi8uLi9saWJzL2Rlbm9fYXBpX2tpdC9weWxvbi9taWRkbGV3YXJlLnRzIiwgIi4uLy4uLy4uL2xpYnMvZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52IH0gZnJvbSAnZGVub19hcGlfa2l0L3B1c2gvbW9kLnRzJ1xuaW1wb3J0IHsgc2V0UHVzaFNlbmRlciB9IGZyb20gJy4vYnVkZ2V0cy9hbGVydF9wdXNoLnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZXJzIH0gZnJvbSAnLi9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMnXG5pbXBvcnQgeyBjb3JzTWlkZGxld2FyZSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7XG4gIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZSxcbiAgaGVhbHRoTWlkZGxld2FyZSxcbn0gZnJvbSAnZGVub19hcGlfa2l0L3B5bG9uL21pZGRsZXdhcmUudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuY29uc3QgcHVzaFNlbmRlciA9IGF3YWl0IGNyZWF0ZVB1c2hTZW5kZXJGcm9tRW52KClcbnNldFB1c2hTZW5kZXIocHVzaFNlbmRlcilcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcbmFwcC51c2UoaGVhbHRoTWlkZGxld2FyZSlcbmFwcC51c2UoY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlKHJlc29sdmVMb2NhbFVzZXIpKVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdGluY2x1ZGVBcmNoaXZlZDogQm9vbGVhblxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzQge1xcblxcdGZyb21EYXRlOiBTdHJpbmchXFxuXFx0dG9EYXRlOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF81IHtcXG5cXHRpbmNsdWRlQXJjaGl2ZWQ6IEJvb2xlYW5cXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRhc09mOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTAge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMSB7XFxuXFx0aW5wdXQ6IENyZWF0ZUV4cGVuc2VJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCB7XFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0c3BlbnRPbjogU3RyaW5nIVxcblxcdGN1cnJlbmN5OiBTdHJpbmdcXG5cXHRub3RlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEyIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcblxcdGFtb3VudENlbnRzOiBOdW1iZXJcXG5cXHRzcGVudE9uOiBTdHJpbmdcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpbnB1dDogQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGFtb3VudENlbnRzOiBOdW1iZXIhXFxuXFx0aW50ZXJ2YWxVbml0OiBTdHJpbmchXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyIVxcblxcdGFuY2hvckRhdGU6IFN0cmluZyFcXG5cXHRhbGVydFBlcmNlbnQ6IE51bWJlciFcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNSB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQnVkZ2V0SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0YW1vdW50Q2VudHM6IE51bWJlclxcblxcdGludGVydmFsVW5pdDogU3RyaW5nXFxuXFx0aW50ZXJ2YWxDb3VudDogTnVtYmVyXFxuXFx0YW5jaG9yRGF0ZTogU3RyaW5nXFxuXFx0YWxlcnRQZXJjZW50OiBOdW1iZXJcXG5cXHRjYXRlZ29yeUlkOiBOdW1iZXJcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xNiB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE3IHtcXG5cXHR0b2tlbjogU3RyaW5nIVxcblxcdHBsYXRmb3JtOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOCB7XFxuXFx0dG9rZW46IFN0cmluZyFcXG59XFxudHlwZSBRdWVyeSB7XFxuY2F0ZWdvcmllcyhhcmdzOiBBcmdzSW5wdXQpOiBbQ2F0ZWdvcnkhXSFcXG5jYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfMSEpOiBDYXRlZ29yeVxcbmV4cGVuc2VzKGFyZ3M6IEFyZ3NJbnB1dF8yKTogW0V4cGVuc2UhXSFcXG5leHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8zISk6IEV4cGVuc2VcXG5leHBlbnNlVG90YWxzKGFyZ3M6IEFyZ3NJbnB1dF80ISk6IFtFeHBlbnNlVG90YWwhXSFcXG5idWRnZXRzKGFyZ3M6IEFyZ3NJbnB1dF81KTogW0J1ZGdldCFdIVxcbmJ1ZGdldChhcmdzOiBBcmdzSW5wdXRfNiEpOiBCdWRnZXRcXG5idWRnZXRTdGF0dXNlcyhhcmdzOiBBcmdzSW5wdXRfNyk6IFtCdWRnZXRTdGF0dXNSb3chXSFcXG59XFxudHlwZSBDYXRlZ29yeSB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuYXJjaGl2ZWRfYXQ6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRXhwZW5zZSB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxuY2F0ZWdvcnlfaWQ6IE51bWJlciFcXG5hbW91bnRfY2VudHM6IE51bWJlciFcXG5jdXJyZW5jeTogU3RyaW5nIVxcbnNwZW50X29uOiBTdHJpbmchXFxubm90ZTogU3RyaW5nXFxuY3JlYXRlZF9hdDogU3RyaW5nIVxcbnVwZGF0ZWRfYXQ6IFN0cmluZyFcXG59XFxudHlwZSBFeHBlbnNlVG90YWwge1xcbmNhdGVnb3J5X2lkOiBOdW1iZXIhXFxuY2F0ZWdvcnlfbmFtZTogU3RyaW5nIVxcbmNhdGVnb3J5X2NvbG9yOiBTdHJpbmchXFxuY3VycmVuY3k6IFN0cmluZyFcXG50b3RhbF9jZW50czogTnVtYmVyIVxcbn1cXG50eXBlIEJ1ZGdldCB7XFxuaWQ6IE51bWJlciFcXG51c2VyX2lkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNhdGVnb3J5X2lkOiBOdW1iZXJcXG5hbW91bnRfY2VudHM6IE51bWJlciFcXG5jdXJyZW5jeTogU3RyaW5nIVxcbmludGVydmFsX3VuaXQ6IFN0cmluZyFcXG5pbnRlcnZhbF9jb3VudDogTnVtYmVyIVxcbmFuY2hvcl9kYXRlOiBTdHJpbmchXFxuYWxlcnRfcGVyY2VudDogTnVtYmVyIVxcbmFyY2hpdmVkX2F0OiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBTdHJpbmchXFxudXBkYXRlZF9hdDogU3RyaW5nIVxcbn1cXG50eXBlIEJ1ZGdldFN0YXR1c1JvdyB7XFxuYnVkZ2V0X2lkOiBOdW1iZXIhXFxuYnVkZ2V0X25hbWU6IFN0cmluZyFcXG5jYXRlZ29yeV9pZDogTnVtYmVyXFxuY3VycmVuY3k6IFN0cmluZyFcXG5hbW91bnRfY2VudHM6IE51bWJlciFcXG5zcGVudF9jZW50czogTnVtYmVyIVxcbnBlcmNlbnRfdXNlZDogTnVtYmVyIVxcbmFsZXJ0X3BlcmNlbnQ6IE51bWJlciFcXG5hbGVydF90cmlnZ2VyZWQ6IEJvb2xlYW4hXFxucGVyaW9kX3N0YXJ0OiBTdHJpbmdcXG5wZXJpb2RfZW5kX2V4Y2x1c2l2ZTogU3RyaW5nXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF84ISk6IENhdGVnb3J5IVxcbnVwZGF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF85ISk6IENhdGVnb3J5IVxcbmFyY2hpdmVDYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfMTAhKTogQ2F0ZWdvcnkhXFxuY3JlYXRlRXhwZW5zZShhcmdzOiBBcmdzSW5wdXRfMTEhKTogRXhwZW5zZSFcXG51cGRhdGVFeHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8xMiEpOiBFeHBlbnNlIVxcbmRlbGV0ZUV4cGVuc2UoYXJnczogQXJnc0lucHV0XzEzISk6IEJvb2xlYW4hXFxuY3JlYXRlQnVkZ2V0KGFyZ3M6IEFyZ3NJbnB1dF8xNCEpOiBCdWRnZXQhXFxudXBkYXRlQnVkZ2V0KGFyZ3M6IEFyZ3NJbnB1dF8xNSEpOiBCdWRnZXQhXFxuYXJjaGl2ZUJ1ZGdldChhcmdzOiBBcmdzSW5wdXRfMTYhKTogQnVkZ2V0IVxcbnJlZ2lzdGVyRGV2aWNlVG9rZW4oYXJnczogQXJnc0lucHV0XzE3ISk6IEJvb2xlYW4hXFxudW5yZWdpc3RlckRldmljZVRva2VuKGFyZ3M6IEFyZ3NJbnB1dF8xOCEpOiBCb29sZWFuIVxcbn1cXG5zY2FsYXIgSURcXG5zY2FsYXIgSW50XFxuc2NhbGFyIEZsb2F0XFxuc2NhbGFyIE51bWJlclxcbnNjYWxhciBBbnlcXG5zY2FsYXIgVm9pZFxcbnNjYWxhciBPYmplY3RcXG5zY2FsYXIgRmlsZVxcbnNjYWxhciBEYXRlXFxuc2NhbGFyIEpTT05cXG5zY2FsYXIgU3RyaW5nXFxuc2NhbGFyIEJvb2xlYW5cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB0eXBlIHsgUHVzaFBheWxvYWQsIFB1c2hTZW5kZXIsIFNlbmRUb1Rva2Vuc1Jlc3VsdCB9IGZyb20gJy4vdHlwZXMudHMnXG5cbi8qKiBOby1vcCBzZW5kZXIgdXNlZCB3aGVuIEZpcmViYXNlIGNyZWRlbnRpYWxzIGFyZSBub3QgY29uZmlndXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBOb09wUHVzaFNlbmRlciBpbXBsZW1lbnRzIFB1c2hTZW5kZXIge1xuICBhc3luYyBzZW5kVG9Ub2tlbnMoXG4gICAgX3Rva2Vuczogc3RyaW5nW10sXG4gICAgX3BheWxvYWQ6IFB1c2hQYXlsb2FkLFxuICApOiBQcm9taXNlPFNlbmRUb1Rva2Vuc1Jlc3VsdD4ge1xuICAgIHJldHVybiB7IHN1Y2Nlc3NDb3VudDogMCwgaW52YWxpZFRva2VuczogW10gfVxuICB9XG59XG4iLCAiLyoqIFJlYWQgYW4gZW52IHZhciBmcm9tIE5vZGUgYHByb2Nlc3MuZW52YCBvciBEZW5vLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGVudihuYW1lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBpZiAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5bbmFtZV0pIHtcbiAgICByZXR1cm4gcHJvY2Vzcy5lbnZbbmFtZV1cbiAgfVxuICB0cnkge1xuICAgIHJldHVybiBEZW5vLmVudi5nZXQobmFtZSlcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG59XG4iLCAiaW1wb3J0IHsgZW52IH0gZnJvbSAnLi4vZGIvZW52LnRzJ1xuaW1wb3J0IHsgTm9PcFB1c2hTZW5kZXIgfSBmcm9tICcuL25vb3Bfc2VuZGVyLnRzJ1xuaW1wb3J0IHR5cGUgeyBQdXNoUGF5bG9hZCwgUHVzaFNlbmRlciwgU2VuZFRvVG9rZW5zUmVzdWx0IH0gZnJvbSAnLi90eXBlcy50cydcblxuYXN5bmMgZnVuY3Rpb24gcmVhZFRleHRGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGlmICh0eXBlb2YgRGVubyAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIERlbm8ucmVhZFRleHRGaWxlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGF3YWl0IERlbm8ucmVhZFRleHRGaWxlKHBhdGgpXG4gIH1cbiAgY29uc3QgeyByZWFkRmlsZSB9ID0gYXdhaXQgaW1wb3J0KCdub2RlOmZzL3Byb21pc2VzJylcbiAgcmV0dXJuIGF3YWl0IHJlYWRGaWxlKHBhdGgsICd1dGY4Jylcbn1cblxudHlwZSBTZXJ2aWNlQWNjb3VudCA9IHtcbiAgcHJvamVjdF9pZDogc3RyaW5nXG4gIGNsaWVudF9lbWFpbDogc3RyaW5nXG4gIHByaXZhdGVfa2V5OiBzdHJpbmdcbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG50eXBlIE1lc3NhZ2luZyA9IHtcbiAgc2VuZEVhY2hGb3JNdWx0aWNhc3Q6IChtZXNzYWdlOiB7XG4gICAgdG9rZW5zOiBzdHJpbmdbXVxuICAgIG5vdGlmaWNhdGlvbjogeyB0aXRsZTogc3RyaW5nOyBib2R5OiBzdHJpbmcgfVxuICAgIGRhdGE/OiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+XG4gIH0pID0+IFByb21pc2U8e1xuICAgIHN1Y2Nlc3NDb3VudDogbnVtYmVyXG4gICAgcmVzcG9uc2VzOiBBcnJheTx7IHN1Y2Nlc3M6IGJvb2xlYW47IGVycm9yPzogeyBjb2RlPzogc3RyaW5nIH0gfT5cbiAgfT5cbn1cblxudHlwZSBGaXJlYmFzZUFkbWluTW9kdWxlID0ge1xuICBhcHBzOiB1bmtub3duW11cbiAgaW5pdGlhbGl6ZUFwcDogKG9wdGlvbnM6IHtcbiAgICBjcmVkZW50aWFsOiB1bmtub3duXG4gIH0pID0+IHVua25vd25cbiAgY3JlZGVudGlhbDoge1xuICAgIGNlcnQ6IChzZXJ2aWNlQWNjb3VudDogU2VydmljZUFjY291bnQpID0+IHVua25vd25cbiAgfVxuICBtZXNzYWdpbmc6ICgpID0+IE1lc3NhZ2luZ1xufVxuXG5jb25zdCBJTlZBTElEX1RPS0VOX0NPREVTID0gbmV3IFNldChbXG4gICdtZXNzYWdpbmcvaW52YWxpZC1yZWdpc3RyYXRpb24tdG9rZW4nLFxuICAnbWVzc2FnaW5nL3JlZ2lzdHJhdGlvbi10b2tlbi1ub3QtcmVnaXN0ZXJlZCcsXG5dKVxuXG4vKipcbiAqIEZpcmViYXNlIENsb3VkIE1lc3NhZ2luZyBzZW5kZXIgdmlhIGZpcmViYXNlLWFkbWluLlxuICpcbiAqIFByZWZlciBjb25zdHJ1Y3RpbmcgdGhyb3VnaCB7QGxpbmsgY3JlYXRlUHVzaFNlbmRlckZyb21FbnZ9IHNvIG1pc3NpbmdcbiAqIGNyZWRlbnRpYWxzIGRlZ3JhZGUgdG8gYSBuby1vcCBpbnN0ZWFkIG9mIGNyYXNoaW5nIHRoZSBBUEkuXG4gKi9cbmV4cG9ydCBjbGFzcyBGaXJlYmFzZVB1c2hTZW5kZXIgaW1wbGVtZW50cyBQdXNoU2VuZGVyIHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBtZXNzYWdpbmc6IE1lc3NhZ2luZykge31cblxuICBhc3luYyBzZW5kVG9Ub2tlbnMoXG4gICAgdG9rZW5zOiBzdHJpbmdbXSxcbiAgICBwYXlsb2FkOiBQdXNoUGF5bG9hZCxcbiAgKTogUHJvbWlzZTxTZW5kVG9Ub2tlbnNSZXN1bHQ+IHtcbiAgICBpZiAodG9rZW5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIHsgc3VjY2Vzc0NvdW50OiAwLCBpbnZhbGlkVG9rZW5zOiBbXSB9XG4gICAgfVxuXG4gICAgY29uc3QgaW52YWxpZFRva2Vuczogc3RyaW5nW10gPSBbXVxuICAgIGxldCBzdWNjZXNzQ291bnQgPSAwXG5cbiAgICAvLyBGQ00gbXVsdGljYXN0IHN1cHBvcnRzIHVwIHRvIDUwMCB0b2tlbnMgcGVyIHJlcXVlc3QuXG4gICAgY29uc3QgY2h1bmtTaXplID0gNTAwXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0b2tlbnMubGVuZ3RoOyBpICs9IGNodW5rU2l6ZSkge1xuICAgICAgY29uc3QgY2h1bmsgPSB0b2tlbnMuc2xpY2UoaSwgaSArIGNodW5rU2l6ZSlcbiAgICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubWVzc2FnaW5nLnNlbmRFYWNoRm9yTXVsdGljYXN0KHtcbiAgICAgICAgdG9rZW5zOiBjaHVuayxcbiAgICAgICAgbm90aWZpY2F0aW9uOiB7XG4gICAgICAgICAgdGl0bGU6IHBheWxvYWQudGl0bGUsXG4gICAgICAgICAgYm9keTogcGF5bG9hZC5ib2R5LFxuICAgICAgICB9LFxuICAgICAgICBkYXRhOiBwYXlsb2FkLmRhdGEsXG4gICAgICB9KVxuICAgICAgc3VjY2Vzc0NvdW50ICs9IHJlc3VsdC5zdWNjZXNzQ291bnRcbiAgICAgIHJlc3VsdC5yZXNwb25zZXMuZm9yRWFjaCgocmVzcG9uc2UsIGluZGV4KSA9PiB7XG4gICAgICAgIGlmIChyZXNwb25zZS5zdWNjZXNzKSByZXR1cm5cbiAgICAgICAgY29uc3QgY29kZSA9IHJlc3BvbnNlLmVycm9yPy5jb2RlXG4gICAgICAgIGlmIChjb2RlICYmIElOVkFMSURfVE9LRU5fQ09ERVMuaGFzKGNvZGUpKSB7XG4gICAgICAgICAgaW52YWxpZFRva2Vucy5wdXNoKGNodW5rW2luZGV4XSEpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmV0dXJuIHsgc3VjY2Vzc0NvdW50LCBpbnZhbGlkVG9rZW5zIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBwYXJzZVNlcnZpY2VBY2NvdW50SnNvbihyYXc6IHN0cmluZyk6IFNlcnZpY2VBY2NvdW50IHtcbiAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpIGFzIFNlcnZpY2VBY2NvdW50XG4gIGlmIChcbiAgICB0eXBlb2YgcGFyc2VkLnByb2plY3RfaWQgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIHBhcnNlZC5jbGllbnRfZW1haWwgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIHBhcnNlZC5wcml2YXRlX2tleSAhPT0gJ3N0cmluZydcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgJ0ZpcmViYXNlIHNlcnZpY2UgYWNjb3VudCBKU09OIG11c3QgaW5jbHVkZSBwcm9qZWN0X2lkLCBjbGllbnRfZW1haWwsIHByaXZhdGVfa2V5JyxcbiAgICApXG4gIH1cbiAgLy8gUHJpdmF0ZSBrZXlzIGluIGVudiB2YXJzIG9mdGVuIGhhdmUgZXNjYXBlZCBuZXdsaW5lcy5cbiAgcGFyc2VkLnByaXZhdGVfa2V5ID0gcGFyc2VkLnByaXZhdGVfa2V5LnJlcGxhY2UoL1xcXFxuL2csICdcXG4nKVxuICByZXR1cm4gcGFyc2VkXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRTZXJ2aWNlQWNjb3VudCgpOiBQcm9taXNlPFNlcnZpY2VBY2NvdW50IHwgbnVsbD4ge1xuICBjb25zdCBqc29uID0gZW52KCdGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTicpXG4gIGlmIChqc29uICYmIGpzb24udHJpbSgpLmxlbmd0aCA+IDApIHtcbiAgICByZXR1cm4gcGFyc2VTZXJ2aWNlQWNjb3VudEpzb24oanNvbilcbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBlbnYoJ0ZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9QQVRIJylcbiAgaWYgKHBhdGggJiYgcGF0aC50cmltKCkubGVuZ3RoID4gMCkge1xuICAgIGNvbnN0IHRleHQgPSBhd2FpdCByZWFkVGV4dEZpbGUocGF0aClcbiAgICByZXR1cm4gcGFyc2VTZXJ2aWNlQWNjb3VudEpzb24odGV4dClcbiAgfVxuXG4gIHJldHVybiBudWxsXG59XG5cbmFzeW5jIGZ1bmN0aW9uIGxvYWRGaXJlYmFzZUFkbWluKCk6IFByb21pc2U8RmlyZWJhc2VBZG1pbk1vZHVsZT4ge1xuICAvLyBEeW5hbWljIGltcG9ydCBrZWVwcyB0aGUga2l0IGltcG9ydGFibGUgaW4gdW5pdCB0ZXN0cyB3aXRob3V0IHJlc29sdmluZ1xuICAvLyBmaXJlYmFzZS1hZG1pbiB1bmxlc3MgYSByZWFsIHNlbmRlciBpcyBjb25zdHJ1Y3RlZC5cbiAgLy8gQnVuL05vZGUgQ0pTIGludGVyb3Agb2Z0ZW4gZXhwb3NlcyB0aGUgU0RLIG9uIGBkZWZhdWx0YC5cbiAgY29uc3QgbW9kID0gYXdhaXQgaW1wb3J0KCdmaXJlYmFzZS1hZG1pbicpIGFzIHtcbiAgICBkZWZhdWx0PzogRmlyZWJhc2VBZG1pbk1vZHVsZVxuICB9ICYgRmlyZWJhc2VBZG1pbk1vZHVsZVxuICByZXR1cm4gbW9kLmRlZmF1bHQgPz8gbW9kXG59XG5cbi8qKlxuICogQnVpbGRzIGEge0BsaW5rIFB1c2hTZW5kZXJ9IGZyb20gZW52LlxuICpcbiAqIC0gYEZJUkVCQVNFX1NFUlZJQ0VfQUNDT1VOVF9KU09OYCBcdTIwMTQgcmF3IHNlcnZpY2UtYWNjb3VudCBKU09OIHN0cmluZ1xuICogLSBgRklSRUJBU0VfU0VSVklDRV9BQ0NPVU5UX1BBVEhgIFx1MjAxNCBwYXRoIHRvIGEgc2VydmljZS1hY2NvdW50IEpTT04gZmlsZVxuICpcbiAqIFdoZW4gbmVpdGhlciBpcyBzZXQgKG9yIGluaXQgZmFpbHMpLCByZXR1cm5zIHtAbGluayBOb09wUHVzaFNlbmRlcn0uXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVQdXNoU2VuZGVyRnJvbUVudigpOiBQcm9taXNlPFB1c2hTZW5kZXI+IHtcbiAgdHJ5IHtcbiAgICBjb25zdCBhY2NvdW50ID0gYXdhaXQgbG9hZFNlcnZpY2VBY2NvdW50KClcbiAgICBpZiAoIWFjY291bnQpIHtcbiAgICAgIGNvbnNvbGUuaW5mbyhcbiAgICAgICAgJ1twdXNoXSBGSVJFQkFTRV9TRVJWSUNFX0FDQ09VTlRfSlNPTi9QQVRIIHVuc2V0OyB1c2luZyBuby1vcCBzZW5kZXInLFxuICAgICAgKVxuICAgICAgcmV0dXJuIG5ldyBOb09wUHVzaFNlbmRlcigpXG4gICAgfVxuXG4gICAgY29uc3QgYWRtaW4gPSBhd2FpdCBsb2FkRmlyZWJhc2VBZG1pbigpXG4gICAgaWYgKGFkbWluLmFwcHMubGVuZ3RoID09PSAwKSB7XG4gICAgICBhZG1pbi5pbml0aWFsaXplQXBwKHtcbiAgICAgICAgY3JlZGVudGlhbDogYWRtaW4uY3JlZGVudGlhbC5jZXJ0KGFjY291bnQpLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gbmV3IEZpcmViYXNlUHVzaFNlbmRlcihhZG1pbi5tZXNzYWdpbmcoKSlcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc29sZS5lcnJvcignW3B1c2hdIGZhaWxlZCB0byBpbml0IEZpcmViYXNlIHNlbmRlcjsgdXNpbmcgbm8tb3AnLCBlcnIpXG4gICAgcmV0dXJuIG5ldyBOb09wUHVzaFNlbmRlcigpXG4gIH1cbn1cbiIsICJpbXBvcnQgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEluc2VydGFibGUsIFNlbGVjdGFibGUsIFVwZGF0ZWFibGUgfSBmcm9tICdreXNlbHknXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2Uge1xuICB1c2VyczogVXNlcnNUYWJsZVxuICBjYXRlZ29yaWVzOiBDYXRlZ29yaWVzVGFibGVcbiAgZXhwZW5zZXM6IEV4cGVuc2VzVGFibGVcbiAgYnVkZ2V0czogQnVkZ2V0c1RhYmxlXG4gIGRldmljZV90b2tlbnM6IERldmljZVRva2Vuc1RhYmxlXG4gIGJ1ZGdldF9hbGVydF9zZW5kczogQnVkZ2V0QWxlcnRTZW5kc1RhYmxlXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgLyoqIFN1cGVyVG9rZW5zIHVzZXIgaWQgXHUyMDE0IGxpbmtzIFNTTyBpZGVudGl0eSB0byBsb2NhbCByb3dzLiAqL1xuICBhdXRoX3VzZXJfaWQ6IHN0cmluZyB8IG51bGxcbiAgbmFtZTogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBDYXRlZ29yaWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICAvKiogSGV4IGNvbG9yIGZyb20gYSBzaGFyZWQgcGFsZXR0ZSwgZS5nLiBcIiMwRjc2NkVcIi4gKi9cbiAgY29sb3I6IHN0cmluZ1xuICAvKiogU29mdC1hcmNoaXZlIHRpbWVzdGFtcDsgbnVsbCB3aGVuIGFjdGl2ZS4gKi9cbiAgYXJjaGl2ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsIHN0cmluZyB8IG51bGw+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHBlbnNlc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBjYXRlZ29yeV9pZDogbnVtYmVyXG4gIC8qKiBBbW91bnQgaW4gbWlub3IgY3VycmVuY3kgdW5pdHMgKGUuZy4gY2VudHMpLiAqL1xuICBhbW91bnRfY2VudHM6IG51bWJlclxuICAvKiogSVNPIDQyMTcgY3VycmVuY3kgY29kZS4gKi9cbiAgY3VycmVuY3k6IHN0cmluZ1xuICAvKiogQ2FsZW5kYXIgZGF5IG9mIHRoZSBzcGVuZCAoWVlZWS1NTS1ERCkuICovXG4gIHNwZW50X29uOiBzdHJpbmdcbiAgbm90ZTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdVc2VyID0gSW5zZXJ0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgVXNlclVwZGF0ZSA9IFVwZGF0ZWFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQ2F0ZWdvcnkgPSBTZWxlY3RhYmxlPENhdGVnb3JpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0NhdGVnb3J5ID0gSW5zZXJ0YWJsZTxDYXRlZ29yaWVzVGFibGU+XG5leHBvcnQgdHlwZSBDYXRlZ29yeVVwZGF0ZSA9IFVwZGF0ZWFibGU8Q2F0ZWdvcmllc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBFeHBlbnNlID0gU2VsZWN0YWJsZTxFeHBlbnNlc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3RXhwZW5zZSA9IEluc2VydGFibGU8RXhwZW5zZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEV4cGVuc2VVcGRhdGUgPSBVcGRhdGVhYmxlPEV4cGVuc2VzVGFibGU+XG5cbmV4cG9ydCBpbnRlcmZhY2UgQnVkZ2V0c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLyoqIE51bGwgPSB0b3RhbCBidWRnZXQ7IHNldCA9IHBlci1jYXRlZ29yeSBidWRnZXQuICovXG4gIGNhdGVnb3J5X2lkOiBudW1iZXIgfCBudWxsXG4gIGFtb3VudF9jZW50czogbnVtYmVyXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgLyoqICdkYXknIHwgJ3dlZWsnIHwgJ21vbnRoJyAqL1xuICBpbnRlcnZhbF91bml0OiBzdHJpbmdcbiAgaW50ZXJ2YWxfY291bnQ6IG51bWJlclxuICAvKiogU3RhcnQgb2YgcGVyaW9kIDAgKFlZWVktTU0tREQpLiAqL1xuICBhbmNob3JfZGF0ZTogc3RyaW5nXG4gIC8qKiBOb3RpZnkgd2hlbiBzcGVudCA+PSB0aGlzIHBlcmNlbnQgb2YgYW1vdW50ICgxXHUyMDEzMTAwKS4gKi9cbiAgYWxlcnRfcGVyY2VudDogbnVtYmVyXG4gIGFyY2hpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIEJ1ZGdldCA9IFNlbGVjdGFibGU8QnVkZ2V0c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QnVkZ2V0ID0gSW5zZXJ0YWJsZTxCdWRnZXRzVGFibGU+XG5leHBvcnQgdHlwZSBCdWRnZXRVcGRhdGUgPSBVcGRhdGVhYmxlPEJ1ZGdldHNUYWJsZT5cblxuZXhwb3J0IGludGVyZmFjZSBEZXZpY2VUb2tlbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdG9rZW46IHN0cmluZ1xuICAvKiogJ2lvcycgfCAnYW5kcm9pZCcgfCAnd2ViJyAqL1xuICBwbGF0Zm9ybTogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIERldmljZVRva2VuID0gU2VsZWN0YWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0RldmljZVRva2VuID0gSW5zZXJ0YWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cbmV4cG9ydCB0eXBlIERldmljZVRva2VuVXBkYXRlID0gVXBkYXRlYWJsZTxEZXZpY2VUb2tlbnNUYWJsZT5cblxuZXhwb3J0IGludGVyZmFjZSBCdWRnZXRBbGVydFNlbmRzVGFibGUge1xuICBidWRnZXRfaWQ6IG51bWJlclxuICAvKiogUGVyaW9kIHN0YXJ0IGRhdGUgKFlZWVktTU0tREQpLiAqL1xuICBwZXJpb2Rfc3RhcnQ6IHN0cmluZ1xuICBzZW50X2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEJ1ZGdldEFsZXJ0U2VuZCA9IFNlbGVjdGFibGU8QnVkZ2V0QWxlcnRTZW5kc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QnVkZ2V0QWxlcnRTZW5kID0gSW5zZXJ0YWJsZTxCdWRnZXRBbGVydFNlbmRzVGFibGU+XG4iLCAiaW1wb3J0IHsgUG9vbCwgdHlwZXMgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgZW52IH0gZnJvbSAnLi9lbnYudHMnXG5pbXBvcnQge1xuICBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyxcbiAgc3NsRm9yRGF0YWJhc2VVcmwsXG59IGZyb20gJy4vc3NsLnRzJ1xuXG4vLyBLZWVwIFBvc3RncmVzIGBkYXRlYCBhcyBgWVlZWS1NTS1ERGAgc3RyaW5ncy4gVGhlIGRlZmF1bHQgcGcgcGFyc2VyIHR1cm5zXG4vLyB0aGVtIGludG8gSlMgRGF0ZSBvYmplY3RzLCB3aGljaCBHcmFwaFFMIHRoZW4gc3RyaW5naWZpZXMgYXMgZnVsbCB0aW1lc3RhbXBzXG4vLyBhbmQgYnJlYWtzIEZsdXR0ZXIncyBkYXRlLW9ubHkgcGFyc2luZy5cbnR5cGVzLnNldFR5cGVQYXJzZXIodHlwZXMuYnVpbHRpbnMuREFURSwgKHZhbHVlOiBzdHJpbmcpID0+IHZhbHVlKVxuXG5leHBvcnQgdHlwZSBDcmVhdGVLeXNlbHlPcHRpb25zID0ge1xuICAvKiogRmFsbGJhY2sgd2hlbiBgUEdEQVRBQkFTRWAgLyBgREFUQUJBU0VfVVJMYCBhcmUgdW5zZXQuICovXG4gIGRlZmF1bHREYXRhYmFzZTogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHBvb2xDb25maWdGcm9tRW52KFxuICBkZWZhdWx0RGF0YWJhc2U6IHN0cmluZyxcbik6IENvbnN0cnVjdG9yUGFyYW1ldGVyczx0eXBlb2YgUG9vbD5bMF0ge1xuICBjb25zdCBkYXRhYmFzZVVybCA9IGVudignREFUQUJBU0VfVVJMJylcbiAgaWYgKGRhdGFiYXNlVXJsKSB7XG4gICAgY29uc3Qgc3NsID0gc3NsRm9yRGF0YWJhc2VVcmwoZGF0YWJhc2VVcmwpXG4gICAgcmV0dXJuIHtcbiAgICAgIGNvbm5lY3Rpb25TdHJpbmc6IGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsKSxcbiAgICAgIG1heDogMTAsXG4gICAgICAuLi4oc3NsID09PSB1bmRlZmluZWQgPyB7fSA6IHsgc3NsIH0pLFxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgZGF0YWJhc2U6IGVudignUEdEQVRBQkFTRScpID8/IGRlZmF1bHREYXRhYmFzZSxcbiAgICBob3N0OiBlbnYoJ1BHSE9TVCcpID8/ICdsb2NhbGhvc3QnLFxuICAgIHVzZXI6IGVudignUEdVU0VSJykgPz8gJ3Bvc3RncmVzJyxcbiAgICBwYXNzd29yZDogZW52KCdQR1BBU1NXT1JEJykgPz8gJ3Rlc3QxMjM0JyxcbiAgICBwb3J0OiBOdW1iZXIoZW52KCdQR1BPUlQnKSA/PyAnNTQzMicpLFxuICAgIG1heDogMTAsXG4gIH1cbn1cblxuLyoqIENyZWF0ZSBhIEt5c2VseSBpbnN0YW5jZSBmb3IgdGhlIGdpdmVuIHNjaGVtYSB0eXBlIGFuZCBkZWZhdWx0IERCIG5hbWUuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlS3lzZWx5PERCPihvcHRpb25zOiBDcmVhdGVLeXNlbHlPcHRpb25zKTogS3lzZWx5PERCPiB7XG4gIGNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgICBwb29sOiBuZXcgUG9vbChwb29sQ29uZmlnRnJvbUVudihvcHRpb25zLmRlZmF1bHREYXRhYmFzZSkpLFxuICB9KVxuICByZXR1cm4gbmV3IEt5c2VseTxEQj4oeyBkaWFsZWN0IH0pXG59XG4iLCAiLyoqIFRMUyBvcHRpb25zIGZvciBgcGdgIGZyb20gYSBQb3N0Z3JlcyBVUkwuICovXG5leHBvcnQgZnVuY3Rpb24gc3NsRm9yRGF0YWJhc2VVcmwoXG4gIGRhdGFiYXNlVXJsOiBzdHJpbmcsXG4pOiBmYWxzZSB8IHsgcmVqZWN0VW5hdXRob3JpemVkOiBib29sZWFuIH0gfCB1bmRlZmluZWQge1xuICBsZXQgdXJsOiBVUkxcbiAgdHJ5IHtcbiAgICB1cmwgPSBuZXcgVVJMKGRhdGFiYXNlVXJsKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cblxuICBjb25zdCBtb2RlID0gdXJsLnNlYXJjaFBhcmFtcy5nZXQoJ3NzbG1vZGUnKT8udG9Mb3dlckNhc2UoKVxuICBpZiAobW9kZSA9PT0gJ2Rpc2FibGUnKSByZXR1cm4gZmFsc2VcbiAgaWYgKG1vZGUgPT09ICdyZXF1aXJlJyB8fCBtb2RlID09PSAndmVyaWZ5LWNhJyB8fCBtb2RlID09PSAndmVyaWZ5LWZ1bGwnKSB7XG4gICAgcmV0dXJuIHsgcmVqZWN0VW5hdXRob3JpemVkOiBmYWxzZSB9XG4gIH1cblxuICBjb25zdCBob3N0ID0gdXJsLmhvc3RuYW1lXG4gIGlmIChob3N0ID09PSAnbG9jYWxob3N0JyB8fCBob3N0ID09PSAnMTI3LjAuMC4xJykgcmV0dXJuIHVuZGVmaW5lZFxuXG4gIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxufVxuXG4vKipcbiAqIFN0cmlwIFNTTCBxdWVyeSBwYXJhbXMgZnJvbSBhIFBvc3RncmVzIFVSTCBiZWZvcmUgcGFzc2luZyBpdCB0byBgcGdgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgY29uc3QgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgICBmb3IgKGNvbnN0IGtleSBvZiBbXG4gICAgICAnc3NsbW9kZScsXG4gICAgICAnc3NsJyxcbiAgICAgICdzc2xyb290Y2VydCcsXG4gICAgICAnc3NsY2VydCcsXG4gICAgICAnc3Nsa2V5JyxcbiAgICBdKSB7XG4gICAgICB1cmwuc2VhcmNoUGFyYW1zLmRlbGV0ZShrZXkpXG4gICAgfVxuICAgIHJldHVybiB1cmwudG9TdHJpbmcoKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZGF0YWJhc2VVcmxcbiAgfVxufVxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjcmVhdGVLeXNlbHkgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvY3JlYXRlX2t5c2VseS50cydcblxuZXhwb3J0IHsgZW52IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2Vudi50cydcblxuZXhwb3J0IGNvbnN0IGRiID0gY3JlYXRlS3lzZWx5PERhdGFiYXNlPih7XG4gIGRlZmF1bHREYXRhYmFzZTogJ3NwZW5kbWFuYWdlcicsXG59KVxuIiwgImltcG9ydCB7IHNxbCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgeyBjdXJyZW50UGVyaW9kLCB0eXBlIEludGVydmFsVW5pdCB9IGZyb20gJy4vcGVyaW9kLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEJ1ZGdldFN0YXR1c1JvdyB7XG4gIGJ1ZGdldF9pZDogbnVtYmVyXG4gIGJ1ZGdldF9uYW1lOiBzdHJpbmdcbiAgY2F0ZWdvcnlfaWQ6IG51bWJlciB8IG51bGxcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBhbW91bnRfY2VudHM6IG51bWJlclxuICBzcGVudF9jZW50czogbnVtYmVyXG4gIHBlcmNlbnRfdXNlZDogbnVtYmVyXG4gIGFsZXJ0X3BlcmNlbnQ6IG51bWJlclxuICBhbGVydF90cmlnZ2VyZWQ6IGJvb2xlYW5cbiAgcGVyaW9kX3N0YXJ0OiBzdHJpbmcgfCBudWxsXG4gIHBlcmlvZF9lbmRfZXhjbHVzaXZlOiBzdHJpbmcgfCBudWxsXG59XG5cbi8qKiBwZyByZXR1cm5zIGJpZ2ludCBhcyBzdHJpbmc7IG5vcm1hbGl6ZSBmb3IgR3JhcGhRTCBjbGllbnRzLiAqL1xuZnVuY3Rpb24gYXNOdW1iZXIodmFsdWU6IG51bWJlciB8IHN0cmluZyk6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gdmFsdWVcbiAgY29uc3QgbiA9IE51bWJlcih2YWx1ZSlcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobikpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ2ludmFsaWQgYW1vdW50JylcbiAgfVxuICByZXR1cm4gblxufVxuXG5hc3luYyBmdW5jdGlvbiBzdW1FeHBlbnNlc0luUGVyaW9kKGFyZ3M6IHtcbiAgdXNlcklkOiBudW1iZXJcbiAgY2F0ZWdvcnlJZDogbnVtYmVyIHwgbnVsbFxuICBjdXJyZW5jeTogc3RyaW5nXG4gIGZyb21EYXRlOiBzdHJpbmdcbiAgdG9EYXRlRXhjbHVzaXZlOiBzdHJpbmdcbn0pOiBQcm9taXNlPG51bWJlcj4ge1xuICBsZXQgcXVlcnkgPSBkYlxuICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCBhcmdzLnVzZXJJZClcbiAgICAud2hlcmUoJ2N1cnJlbmN5JywgJz0nLCBhcmdzLmN1cnJlbmN5KVxuICAgIC53aGVyZSgnc3BlbnRfb24nLCAnPj0nLCBhcmdzLmZyb21EYXRlKVxuICAgIC53aGVyZSgnc3BlbnRfb24nLCAnPCcsIGFyZ3MudG9EYXRlRXhjbHVzaXZlKVxuICAgIC5zZWxlY3Qoc3FsPHN0cmluZz5gY29hbGVzY2Uoc3VtKGFtb3VudF9jZW50cyksIDApYC5hcygndG90YWxfY2VudHMnKSlcblxuICBpZiAoYXJncy5jYXRlZ29yeUlkICE9IG51bGwpIHtcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdjYXRlZ29yeV9pZCcsICc9JywgYXJncy5jYXRlZ29yeUlkKVxuICB9XG5cbiAgY29uc3Qgcm93ID0gYXdhaXQgcXVlcnkuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICByZXR1cm4gYXNOdW1iZXIocm93LnRvdGFsX2NlbnRzKVxufVxuXG4vKiogQ29tcHV0ZSBidWRnZXQgc3RhdHVzZXMgZm9yIGEgdXNlciBhcyBvZiBhIGNhbGVuZGFyIGRheSAoWVlZWS1NTS1ERCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29tcHV0ZUJ1ZGdldFN0YXR1c2VzKFxuICB1c2VySWQ6IG51bWJlcixcbiAgYXNPZjogc3RyaW5nLFxuKTogUHJvbWlzZTxCdWRnZXRTdGF0dXNSb3dbXT4ge1xuICBjb25zdCBidWRnZXRzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnYnVkZ2V0cycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgLm9yZGVyQnkoJ25hbWUnLCAnYXNjJylcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3Qgc3RhdHVzZXM6IEJ1ZGdldFN0YXR1c1Jvd1tdID0gW11cbiAgZm9yIChjb25zdCBidWRnZXQgb2YgYnVkZ2V0cykge1xuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXNOdW1iZXIoYnVkZ2V0LmFtb3VudF9jZW50cylcbiAgICBjb25zdCBwZXJpb2QgPSBjdXJyZW50UGVyaW9kKHtcbiAgICAgIGFuY2hvckRhdGU6IGJ1ZGdldC5hbmNob3JfZGF0ZSxcbiAgICAgIGludGVydmFsVW5pdDogYnVkZ2V0LmludGVydmFsX3VuaXQgYXMgSW50ZXJ2YWxVbml0LFxuICAgICAgaW50ZXJ2YWxDb3VudDogYnVkZ2V0LmludGVydmFsX2NvdW50LFxuICAgICAgYXNPZixcbiAgICB9KVxuXG4gICAgaWYgKCFwZXJpb2QpIHtcbiAgICAgIHN0YXR1c2VzLnB1c2goe1xuICAgICAgICBidWRnZXRfaWQ6IGJ1ZGdldC5pZCxcbiAgICAgICAgYnVkZ2V0X25hbWU6IGJ1ZGdldC5uYW1lLFxuICAgICAgICBjYXRlZ29yeV9pZDogYnVkZ2V0LmNhdGVnb3J5X2lkLFxuICAgICAgICBjdXJyZW5jeTogYnVkZ2V0LmN1cnJlbmN5LFxuICAgICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgICBzcGVudF9jZW50czogMCxcbiAgICAgICAgcGVyY2VudF91c2VkOiAwLFxuICAgICAgICBhbGVydF9wZXJjZW50OiBidWRnZXQuYWxlcnRfcGVyY2VudCxcbiAgICAgICAgYWxlcnRfdHJpZ2dlcmVkOiBmYWxzZSxcbiAgICAgICAgcGVyaW9kX3N0YXJ0OiBudWxsLFxuICAgICAgICBwZXJpb2RfZW5kX2V4Y2x1c2l2ZTogbnVsbCxcbiAgICAgIH0pXG4gICAgICBjb250aW51ZVxuICAgIH1cblxuICAgIGNvbnN0IHNwZW50Q2VudHMgPSBhd2FpdCBzdW1FeHBlbnNlc0luUGVyaW9kKHtcbiAgICAgIHVzZXJJZCxcbiAgICAgIGNhdGVnb3J5SWQ6IGJ1ZGdldC5jYXRlZ29yeV9pZCxcbiAgICAgIGN1cnJlbmN5OiBidWRnZXQuY3VycmVuY3ksXG4gICAgICBmcm9tRGF0ZTogcGVyaW9kLnN0YXJ0LFxuICAgICAgdG9EYXRlRXhjbHVzaXZlOiBwZXJpb2QuZW5kRXhjbHVzaXZlLFxuICAgIH0pXG4gICAgY29uc3QgcGVyY2VudFVzZWQgPSBhbW91bnRDZW50cyA+IDBcbiAgICAgID8gTWF0aC5mbG9vcigoc3BlbnRDZW50cyAqIDEwMCkgLyBhbW91bnRDZW50cylcbiAgICAgIDogMFxuICAgIGNvbnN0IGFsZXJ0VHJpZ2dlcmVkID0gcGVyY2VudFVzZWQgPj0gYnVkZ2V0LmFsZXJ0X3BlcmNlbnRcblxuICAgIHN0YXR1c2VzLnB1c2goe1xuICAgICAgYnVkZ2V0X2lkOiBidWRnZXQuaWQsXG4gICAgICBidWRnZXRfbmFtZTogYnVkZ2V0Lm5hbWUsXG4gICAgICBjYXRlZ29yeV9pZDogYnVkZ2V0LmNhdGVnb3J5X2lkLFxuICAgICAgY3VycmVuY3k6IGJ1ZGdldC5jdXJyZW5jeSxcbiAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICBzcGVudF9jZW50czogc3BlbnRDZW50cyxcbiAgICAgIHBlcmNlbnRfdXNlZDogcGVyY2VudFVzZWQsXG4gICAgICBhbGVydF9wZXJjZW50OiBidWRnZXQuYWxlcnRfcGVyY2VudCxcbiAgICAgIGFsZXJ0X3RyaWdnZXJlZDogYWxlcnRUcmlnZ2VyZWQsXG4gICAgICBwZXJpb2Rfc3RhcnQ6IHBlcmlvZC5zdGFydCxcbiAgICAgIHBlcmlvZF9lbmRfZXhjbHVzaXZlOiBwZXJpb2QuZW5kRXhjbHVzaXZlLFxuICAgIH0pXG4gIH1cblxuICByZXR1cm4gc3RhdHVzZXNcbn1cbiIsICIvKiogUm9sbGluZyBidWRnZXQgcGVyaW9kIGhlbHBlcnMgKGFuY2hvci1iYXNlZCkuICovXG5cbmV4cG9ydCB0eXBlIEludGVydmFsVW5pdCA9ICdkYXknIHwgJ3dlZWsnIHwgJ21vbnRoJ1xuXG5leHBvcnQgaW50ZXJmYWNlIFBlcmlvZFdpbmRvdyB7XG4gIC8qKiBJbmNsdXNpdmUgc3RhcnQgZGF0ZSAoWVlZWS1NTS1ERCkuICovXG4gIHN0YXJ0OiBzdHJpbmdcbiAgLyoqIEV4Y2x1c2l2ZSBlbmQgZGF0ZSAoWVlZWS1NTS1ERCkuICovXG4gIGVuZEV4Y2x1c2l2ZTogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIHBhcnNlRGF0ZU9ubHkodmFsdWU6IHN0cmluZyk6IERhdGUge1xuICBjb25zdCBkID0gbmV3IERhdGUoYCR7dmFsdWV9VDAwOjAwOjAwWmApXG4gIGlmIChOdW1iZXIuaXNOYU4oZC5nZXRUaW1lKCkpIHx8IGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgIT09IHZhbHVlKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBpbnZhbGlkIGRhdGU6ICR7dmFsdWV9YClcbiAgfVxuICByZXR1cm4gZFxufVxuXG5mdW5jdGlvbiBmb3JtYXREYXRlT25seShkOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuZnVuY3Rpb24gZGF5c0JldHdlZW5VdGMoZnJvbTogRGF0ZSwgdG86IERhdGUpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5mbG9vcigodG8uZ2V0VGltZSgpIC0gZnJvbS5nZXRUaW1lKCkpIC8gKDI0ICogNjAgKiA2MCAqIDEwMDApKVxufVxuXG4vKiogQWRkIGNhbGVuZGFyIG1vbnRocywgY2xhbXBpbmcgdG8gdGhlIGxhc3QgZGF5IG9mIHRoZSB0YXJnZXQgbW9udGguICovXG5leHBvcnQgZnVuY3Rpb24gYWRkTW9udGhzVXRjKGRhdGU6IERhdGUsIG1vbnRoczogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IHllYXIgPSBkYXRlLmdldFVUQ0Z1bGxZZWFyKClcbiAgY29uc3QgbW9udGggPSBkYXRlLmdldFVUQ01vbnRoKClcbiAgY29uc3QgZGF5ID0gZGF0ZS5nZXRVVENEYXRlKClcbiAgY29uc3QgdGFyZ2V0ID0gbmV3IERhdGUoRGF0ZS5VVEMoeWVhciwgbW9udGggKyBtb250aHMsIDEpKVxuICBjb25zdCBsYXN0RGF5ID0gbmV3IERhdGUoXG4gICAgRGF0ZS5VVEModGFyZ2V0LmdldFVUQ0Z1bGxZZWFyKCksIHRhcmdldC5nZXRVVENNb250aCgpICsgMSwgMCksXG4gICkuZ2V0VVRDRGF0ZSgpXG4gIHRhcmdldC5zZXRVVENEYXRlKE1hdGgubWluKGRheSwgbGFzdERheSkpXG4gIHJldHVybiB0YXJnZXRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFkZEludGVydmFsKFxuICBkYXRlT25seTogc3RyaW5nLFxuICB1bml0OiBJbnRlcnZhbFVuaXQsXG4gIGNvdW50OiBudW1iZXIsXG4pOiBzdHJpbmcge1xuICBpZiAoIU51bWJlci5pc0ludGVnZXIoY291bnQpIHx8IGNvdW50IDwgMSkge1xuICAgIHRocm93IG5ldyBFcnJvcignaW50ZXJ2YWwgY291bnQgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXInKVxuICB9XG4gIGNvbnN0IGQgPSBwYXJzZURhdGVPbmx5KGRhdGVPbmx5KVxuICBpZiAodW5pdCA9PT0gJ2RheScpIHtcbiAgICBkLnNldFVUQ0RhdGUoZC5nZXRVVENEYXRlKCkgKyBjb3VudClcbiAgICByZXR1cm4gZm9ybWF0RGF0ZU9ubHkoZClcbiAgfVxuICBpZiAodW5pdCA9PT0gJ3dlZWsnKSB7XG4gICAgZC5zZXRVVENEYXRlKGQuZ2V0VVRDRGF0ZSgpICsgY291bnQgKiA3KVxuICAgIHJldHVybiBmb3JtYXREYXRlT25seShkKVxuICB9XG4gIHJldHVybiBmb3JtYXREYXRlT25seShhZGRNb250aHNVdGMoZCwgY291bnQpKVxufVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHJvbGxpbmcgcGVyaW9kIGNvbnRhaW5pbmcgW2FzT2ZdLCBvciBudWxsIHdoZW4gW2FzT2ZdIGlzIGJlZm9yZVxuICogdGhlIGFuY2hvciAobm8gc3BlbmQgY291bnRlZCBiZWZvcmUgdGhlIGJ1ZGdldCBzdGFydHMpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY3VycmVudFBlcmlvZChhcmdzOiB7XG4gIGFuY2hvckRhdGU6IHN0cmluZ1xuICBpbnRlcnZhbFVuaXQ6IEludGVydmFsVW5pdFxuICBpbnRlcnZhbENvdW50OiBudW1iZXJcbiAgYXNPZjogc3RyaW5nXG59KTogUGVyaW9kV2luZG93IHwgbnVsbCB7XG4gIGNvbnN0IHsgYW5jaG9yRGF0ZSwgaW50ZXJ2YWxVbml0LCBpbnRlcnZhbENvdW50LCBhc09mIH0gPSBhcmdzXG4gIGlmIChhc09mIDwgYW5jaG9yRGF0ZSkgcmV0dXJuIG51bGxcblxuICBpZiAoaW50ZXJ2YWxVbml0ID09PSAnZGF5JyB8fCBpbnRlcnZhbFVuaXQgPT09ICd3ZWVrJykge1xuICAgIGNvbnN0IHBlcmlvZERheXMgPVxuICAgICAgaW50ZXJ2YWxVbml0ID09PSAnZGF5JyA/IGludGVydmFsQ291bnQgOiBpbnRlcnZhbENvdW50ICogN1xuICAgIGNvbnN0IGFuY2hvciA9IHBhcnNlRGF0ZU9ubHkoYW5jaG9yRGF0ZSlcbiAgICBjb25zdCBhc09mRGF0ZSA9IHBhcnNlRGF0ZU9ubHkoYXNPZilcbiAgICBjb25zdCBlbGFwc2VkID0gZGF5c0JldHdlZW5VdGMoYW5jaG9yLCBhc09mRGF0ZSlcbiAgICBjb25zdCBpbmRleCA9IE1hdGguZmxvb3IoZWxhcHNlZCAvIHBlcmlvZERheXMpXG4gICAgY29uc3Qgc3RhcnREYXRlID0gbmV3IERhdGUoYW5jaG9yKVxuICAgIHN0YXJ0RGF0ZS5zZXRVVENEYXRlKHN0YXJ0RGF0ZS5nZXRVVENEYXRlKCkgKyBpbmRleCAqIHBlcmlvZERheXMpXG4gICAgY29uc3QgZW5kRGF0ZSA9IG5ldyBEYXRlKHN0YXJ0RGF0ZSlcbiAgICBlbmREYXRlLnNldFVUQ0RhdGUoZW5kRGF0ZS5nZXRVVENEYXRlKCkgKyBwZXJpb2REYXlzKVxuICAgIHJldHVybiB7XG4gICAgICBzdGFydDogZm9ybWF0RGF0ZU9ubHkoc3RhcnREYXRlKSxcbiAgICAgIGVuZEV4Y2x1c2l2ZTogZm9ybWF0RGF0ZU9ubHkoZW5kRGF0ZSksXG4gICAgfVxuICB9XG5cbiAgLy8gTW9udGhzOiB3YWxrIGZvcndhcmQgZnJvbSBhbmNob3IgdW50aWwgYXNPZiBmYWxscyBpbiBbc3RhcnQsIGVuZCkuXG4gIGxldCBzdGFydCA9IGFuY2hvckRhdGVcbiAgbGV0IGVuZEV4Y2x1c2l2ZSA9IGFkZEludGVydmFsKHN0YXJ0LCAnbW9udGgnLCBpbnRlcnZhbENvdW50KVxuICAvLyBDYXAgaXRlcmF0aW9ucyBmb3Igc2FmZXR5IChlLmcuIH4xMDAgeWVhcnMgb2YgbW9udGhseSBwZXJpb2RzKS5cbiAgZm9yIChsZXQgaSA9IDA7IGkgPCAyMDAwOyBpKyspIHtcbiAgICBpZiAoYXNPZiA+PSBzdGFydCAmJiBhc09mIDwgZW5kRXhjbHVzaXZlKSB7XG4gICAgICByZXR1cm4geyBzdGFydCwgZW5kRXhjbHVzaXZlIH1cbiAgICB9XG4gICAgc3RhcnQgPSBlbmRFeGNsdXNpdmVcbiAgICBlbmRFeGNsdXNpdmUgPSBhZGRJbnRlcnZhbChzdGFydCwgJ21vbnRoJywgaW50ZXJ2YWxDb3VudClcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoJ2ZhaWxlZCB0byByZXNvbHZlIG1vbnRobHkgcGVyaW9kJylcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFB1c2hTZW5kZXIgfSBmcm9tICdkZW5vX2FwaV9raXQvcHVzaC9tb2QudHMnXG5pbXBvcnQgeyBOb09wUHVzaFNlbmRlciB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9wdXNoL21vZC50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQge1xuICBjb21wdXRlQnVkZ2V0U3RhdHVzZXMsXG4gIHR5cGUgQnVkZ2V0U3RhdHVzUm93LFxufSBmcm9tICcuL3N0YXR1cy50cydcblxubGV0IHB1c2hTZW5kZXI6IFB1c2hTZW5kZXIgPSBuZXcgTm9PcFB1c2hTZW5kZXIoKVxuXG4vKiogV2lyZSB0aGUgcHJvY2Vzcy13aWRlIHNlbmRlciAoZnJvbSBpbmRleCBvciB0ZXN0cykuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0UHVzaFNlbmRlcihzZW5kZXI6IFB1c2hTZW5kZXIpOiB2b2lkIHtcbiAgcHVzaFNlbmRlciA9IHNlbmRlclxufVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0UHVzaFNlbmRlcigpOiBQdXNoU2VuZGVyIHtcbiAgcmV0dXJuIHB1c2hTZW5kZXJcbn1cblxuZXhwb3J0IGludGVyZmFjZSBBbGVydFB1c2hEZXBzIHtcbiAgY29tcHV0ZVN0YXR1c2VzOiAoXG4gICAgdXNlcklkOiBudW1iZXIsXG4gICAgYXNPZjogc3RyaW5nLFxuICApID0+IFByb21pc2U8QnVkZ2V0U3RhdHVzUm93W10+XG4gIHRyeUNsYWltU2VuZDogKFxuICAgIGJ1ZGdldElkOiBudW1iZXIsXG4gICAgcGVyaW9kU3RhcnQ6IHN0cmluZyxcbiAgKSA9PiBQcm9taXNlPGJvb2xlYW4+XG4gIGxpc3RUb2tlbnM6ICh1c2VySWQ6IG51bWJlcikgPT4gUHJvbWlzZTxzdHJpbmdbXT5cbiAgZGVsZXRlVG9rZW5zOiAodG9rZW5zOiBzdHJpbmdbXSkgPT4gUHJvbWlzZTx2b2lkPlxuICBzZW5kZXI6IFB1c2hTZW5kZXJcbiAgZm9ybWF0Qm9keT86IChzdGF0dXM6IEJ1ZGdldFN0YXR1c1JvdykgPT4gc3RyaW5nXG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRCb2R5KHN0YXR1czogQnVkZ2V0U3RhdHVzUm93KTogc3RyaW5nIHtcbiAgcmV0dXJuIGAke3N0YXR1cy5wZXJjZW50X3VzZWR9JSBvZiBidWRnZXQgdXNlZGBcbn1cblxuLyoqXG4gKiBQdXJlLWlzaCBvcmNoZXN0cmF0aW9uOiBmb3IgZWFjaCBuZXdseSB0cmlnZ2VyZWQgYnVkZ2V0K3BlcmlvZCwgY2xhaW1cbiAqIGRlZHVwZSByb3cgdGhlbiBzZW5kLiBJbmplY3RhYmxlIGZvciB1bml0IHRlc3RzLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXNXaXRoRGVwcyhcbiAgdXNlcklkOiBudW1iZXIsXG4gIGFzT2Y6IHN0cmluZyxcbiAgZGVwczogQWxlcnRQdXNoRGVwcyxcbik6IFByb21pc2U8bnVtYmVyPiB7XG4gIGNvbnN0IHN0YXR1c2VzID0gYXdhaXQgZGVwcy5jb21wdXRlU3RhdHVzZXModXNlcklkLCBhc09mKVxuICBjb25zdCB0cmlnZ2VyZWQgPSBzdGF0dXNlcy5maWx0ZXIoXG4gICAgKHMpID0+IHMuYWxlcnRfdHJpZ2dlcmVkICYmIHMucGVyaW9kX3N0YXJ0ICE9IG51bGwsXG4gIClcbiAgaWYgKHRyaWdnZXJlZC5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgY29uc3QgdG9rZW5zID0gYXdhaXQgZGVwcy5saXN0VG9rZW5zKHVzZXJJZClcbiAgaWYgKHRva2Vucy5sZW5ndGggPT09IDApIHtcbiAgICAvLyBTdGlsbCBjbGFpbSBzZW5kcyBzbyB3ZSBkb24ndCBzcGFtIG9uY2UgYSB0b2tlbiBhcHBlYXJzIG1pZC1wZXJpb2RcbiAgICAvLyBhZnRlciB0aGUgdXNlciBhbHJlYWR5IHNhdyAvIHdvdWxkIGhhdmUgc2VlbiB0aGUgYWxlcnQgdmlhIGFub3RoZXIgcGF0aC5cbiAgICAvLyBBY3R1YWxseTogaWYgbm8gdG9rZW5zLCB3ZSBzaG91bGQgTk9UIGNsYWltIFx1MjAxNCBzbyB3aGVuIHRoZXkgcmVnaXN0ZXIgbGF0ZXJcbiAgICAvLyBpbiB0aGUgc2FtZSBwZXJpb2Qgd2UgY2FuIHN0aWxsIHB1c2guIFBsYW46IG9ubHkgY2xhaW0gb24gc3VjY2Vzc2Z1bFxuICAgIC8vIGluc2VydCBhdHRlbXB0IGJlZm9yZSBzZW5kOyBpZiBubyB0b2tlbnMsIHNraXAgY2xhaW0uXG4gICAgcmV0dXJuIDBcbiAgfVxuXG4gIGxldCBzZW50ID0gMFxuICBmb3IgKGNvbnN0IHN0YXR1cyBvZiB0cmlnZ2VyZWQpIHtcbiAgICBjb25zdCBwZXJpb2RTdGFydCA9IHN0YXR1cy5wZXJpb2Rfc3RhcnQhXG4gICAgY29uc3QgY2xhaW1lZCA9IGF3YWl0IGRlcHMudHJ5Q2xhaW1TZW5kKHN0YXR1cy5idWRnZXRfaWQsIHBlcmlvZFN0YXJ0KVxuICAgIGlmICghY2xhaW1lZCkgY29udGludWVcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRlcHMuc2VuZGVyLnNlbmRUb1Rva2Vucyh0b2tlbnMsIHtcbiAgICAgIHRpdGxlOiBzdGF0dXMuYnVkZ2V0X25hbWUsXG4gICAgICBib2R5OiAoZGVwcy5mb3JtYXRCb2R5ID8/IGRlZmF1bHRCb2R5KShzdGF0dXMpLFxuICAgICAgZGF0YToge1xuICAgICAgICB0eXBlOiAnYnVkZ2V0X2FsZXJ0JyxcbiAgICAgICAgYnVkZ2V0X2lkOiBTdHJpbmcoc3RhdHVzLmJ1ZGdldF9pZCksXG4gICAgICAgIHBlcmlvZF9zdGFydDogcGVyaW9kU3RhcnQsXG4gICAgICAgIHBlcmNlbnRfdXNlZDogU3RyaW5nKHN0YXR1cy5wZXJjZW50X3VzZWQpLFxuICAgICAgfSxcbiAgICB9KVxuICAgIHNlbnQgKz0gcmVzdWx0LnN1Y2Nlc3NDb3VudFxuICAgIGlmIChyZXN1bHQuaW52YWxpZFRva2Vucy5sZW5ndGggPiAwKSB7XG4gICAgICBhd2FpdCBkZXBzLmRlbGV0ZVRva2VucyhyZXN1bHQuaW52YWxpZFRva2VucylcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHNlbnRcbn1cblxuYXN5bmMgZnVuY3Rpb24gdHJ5Q2xhaW1TZW5kKFxuICBidWRnZXRJZDogbnVtYmVyLFxuICBwZXJpb2RTdGFydDogc3RyaW5nLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdidWRnZXRfYWxlcnRfc2VuZHMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGJ1ZGdldF9pZDogYnVkZ2V0SWQsXG4gICAgICAgIHBlcmlvZF9zdGFydDogcGVyaW9kU3RhcnQsXG4gICAgICAgIHNlbnRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHRydWVcbiAgfSBjYXRjaCAoZXJyKSB7XG4gICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBTdHJpbmcoZXJyKVxuICAgIC8vIFVuaXF1ZSB2aW9sYXRpb24gXHUyMTkyIGFscmVhZHkgc2VudCB0aGlzIHBlcmlvZC5cbiAgICBpZiAoXG4gICAgICBtZXNzYWdlLmluY2x1ZGVzKCdidWRnZXRfYWxlcnRfc2VuZHNfcGtleScpIHx8XG4gICAgICBtZXNzYWdlLmluY2x1ZGVzKCdkdXBsaWNhdGUga2V5JykgfHxcbiAgICAgIG1lc3NhZ2UuaW5jbHVkZXMoJ3VuaXF1ZScpXG4gICAgKSB7XG4gICAgICByZXR1cm4gZmFsc2VcbiAgICB9XG4gICAgdGhyb3cgZXJyXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gbGlzdFRva2Vucyh1c2VySWQ6IG51bWJlcik6IFByb21pc2U8c3RyaW5nW10+IHtcbiAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2RldmljZV90b2tlbnMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoJ3Rva2VuJylcbiAgICAuZXhlY3V0ZSgpXG4gIHJldHVybiByb3dzLm1hcCgocikgPT4gci50b2tlbilcbn1cblxuYXN5bmMgZnVuY3Rpb24gZGVsZXRlVG9rZW5zKHRva2Vuczogc3RyaW5nW10pOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKHRva2Vucy5sZW5ndGggPT09IDApIHJldHVyblxuICBhd2FpdCBkYlxuICAgIC5kZWxldGVGcm9tKCdkZXZpY2VfdG9rZW5zJylcbiAgICAud2hlcmUoJ3Rva2VuJywgJ2luJywgdG9rZW5zKVxuICAgIC5leGVjdXRlKClcbn1cblxuLyoqIEFmdGVyIGV4cGVuc2UvYnVkZ2V0IHdyaXRlczogcHVzaCBmb3IgbmV3bHkgY3Jvc3NlZCB0aHJlc2hvbGRzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzKFxuICB1c2VySWQ6IG51bWJlcixcbiAgYXNPZjogc3RyaW5nLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIHRyeSB7XG4gICAgYXdhaXQgbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXNXaXRoRGVwcyh1c2VySWQsIGFzT2YsIHtcbiAgICAgIGNvbXB1dGVTdGF0dXNlczogY29tcHV0ZUJ1ZGdldFN0YXR1c2VzLFxuICAgICAgdHJ5Q2xhaW1TZW5kLFxuICAgICAgbGlzdFRva2VucyxcbiAgICAgIGRlbGV0ZVRva2VucyxcbiAgICAgIHNlbmRlcjogcHVzaFNlbmRlcixcbiAgICB9KVxuICB9IGNhdGNoIChlcnIpIHtcbiAgICAvLyBCZXN0LWVmZm9ydDogbmV2ZXIgZmFpbCB0aGUgR3JhcGhRTCBtdXRhdGlvbiBiZWNhdXNlIG9mIHB1c2guXG4gICAgY29uc29sZS5lcnJvcignW3B1c2hdIGJ1ZGdldCBhbGVydCBzZW5kIGZhaWxlZCcsIGVycilcbiAgfVxufVxuIiwgImltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgc3FsIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXMgfSBmcm9tICcuLi8uLi9idWRnZXRzL2FsZXJ0X3B1c2gudHMnXG5pbXBvcnQgeyBjb21wdXRlQnVkZ2V0U3RhdHVzZXMgfSBmcm9tICcuLi8uLi9idWRnZXRzL3N0YXR1cy50cydcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7XG4gIE5ld0J1ZGdldCxcbiAgTmV3Q2F0ZWdvcnksXG4gIE5ld0RldmljZVRva2VuLFxuICBOZXdFeHBlbnNlLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBhc0lzb1RpbWVzdGFtcCwgYXNJc29UaW1lc3RhbXBPck51bGwgfSBmcm9tICcuLi90aW1lc3RhbXBzLnRzJ1xuaW1wb3J0IHtcbiAgQ3JlYXRlQnVkZ2V0SW5wdXQsXG4gIENyZWF0ZUNhdGVnb3J5SW5wdXQsXG4gIENyZWF0ZUV4cGVuc2VJbnB1dCxcbiAgVXBkYXRlQnVkZ2V0SW5wdXQsXG4gIFVwZGF0ZUNhdGVnb3J5SW5wdXQsXG4gIFVwZGF0ZUV4cGVuc2VJbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5pbXBvcnQge1xuICBJbnZhbGlkQnVkZ2V0RXJyb3IsXG4gIEludmFsaWRDYXRlZ29yeUVycm9yLFxuICBJbnZhbGlkRXhwZW5zZUVycm9yLFxuICB2YWxpZGF0ZUFsZXJ0UGVyY2VudCxcbiAgdmFsaWRhdGVBbW91bnRDZW50cyxcbiAgdmFsaWRhdGVBbmNob3JEYXRlLFxuICB2YWxpZGF0ZUJ1ZGdldEFtb3VudENlbnRzLFxuICB2YWxpZGF0ZUJ1ZGdldE5hbWUsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcixcbiAgdmFsaWRhdGVDYXRlZ29yeU5hbWUsXG4gIHZhbGlkYXRlQ3VycmVuY3ksXG4gIHZhbGlkYXRlSW50ZXJ2YWxDb3VudCxcbiAgdmFsaWRhdGVJbnRlcnZhbFVuaXQsXG4gIHZhbGlkYXRlTm90ZSxcbiAgdmFsaWRhdGVTcGVudE9uLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbi8qKiBwZyByZXR1cm5zIGJpZ2ludCBhcyBzdHJpbmc7IG5vcm1hbGl6ZSBmb3IgR3JhcGhRTCBjbGllbnRzLiAqL1xuZnVuY3Rpb24gYXNOdW1iZXIodmFsdWU6IG51bWJlciB8IHN0cmluZyk6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gdmFsdWVcbiAgY29uc3QgbiA9IE51bWJlcih2YWx1ZSlcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignaW52YWxpZCBhbW91bnQnKVxuICB9XG4gIHJldHVybiBuXG59XG5cbmZ1bmN0aW9uIHRvZGF5VXRjKCk6IHN0cmluZyB7XG4gIHJldHVybiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG59XG5cbi8qKiBOYW1lZCByZXR1cm4gc2hhcGVzIHNvIFB5bG9uIGNhbiBlbWl0IEdyYXBoUUwgb2JqZWN0IHR5cGVzIChub3QgYEFueSFgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0ZWdvcnkge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgY29sb3I6IHN0cmluZ1xuICBhcmNoaXZlZF9hdDogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBzdHJpbmdcbiAgdXBkYXRlZF9hdDogc3RyaW5nXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXhwZW5zZSB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIGNhdGVnb3J5X2lkOiBudW1iZXJcbiAgYW1vdW50X2NlbnRzOiBudW1iZXJcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogc3RyaW5nXG4gIHVwZGF0ZWRfYXQ6IHN0cmluZ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEJ1ZGdldCB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICBjYXRlZ29yeV9pZDogbnVtYmVyIHwgbnVsbFxuICBhbW91bnRfY2VudHM6IG51bWJlclxuICBjdXJyZW5jeTogc3RyaW5nXG4gIGludGVydmFsX3VuaXQ6IHN0cmluZ1xuICBpbnRlcnZhbF9jb3VudDogbnVtYmVyXG4gIGFuY2hvcl9kYXRlOiBzdHJpbmdcbiAgYWxlcnRfcGVyY2VudDogbnVtYmVyXG4gIGFyY2hpdmVkX2F0OiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBzdHJpbmdcbn1cblxuZXhwb3J0IGludGVyZmFjZSBFeHBlbnNlVG90YWwge1xuICBjYXRlZ29yeV9pZDogbnVtYmVyXG4gIGNhdGVnb3J5X25hbWU6IHN0cmluZ1xuICBjYXRlZ29yeV9jb2xvcjogc3RyaW5nXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgdG90YWxfY2VudHM6IG51bWJlclxufVxuXG5mdW5jdGlvbiBtYXBDYXRlZ29yeShyb3c6IHtcbiAgaWQ6IG51bWJlclxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIGNvbG9yOiBzdHJpbmdcbiAgYXJjaGl2ZWRfYXQ6IERhdGUgfCBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IENhdGVnb3J5IHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgYXJjaGl2ZWRfYXQ6IGFzSXNvVGltZXN0YW1wT3JOdWxsKHJvdy5hcmNoaXZlZF9hdCksXG4gICAgY3JlYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LmNyZWF0ZWRfYXQpLFxuICAgIHVwZGF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy51cGRhdGVkX2F0KSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBFeHBlbnNlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBjYXRlZ29yeV9pZDogbnVtYmVyXG4gIGFtb3VudF9jZW50czogbnVtYmVyIHwgc3RyaW5nXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgc3BlbnRfb246IHN0cmluZ1xuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSk6IEV4cGVuc2Uge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBhbW91bnRfY2VudHM6IGFzTnVtYmVyKHJvdy5hbW91bnRfY2VudHMpLFxuICAgIGNyZWF0ZWRfYXQ6IGFzSXNvVGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KSxcbiAgICB1cGRhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cudXBkYXRlZF9hdCksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwQnVkZ2V0KHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgY2F0ZWdvcnlfaWQ6IG51bWJlciB8IG51bGxcbiAgYW1vdW50X2NlbnRzOiBudW1iZXIgfCBzdHJpbmdcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBpbnRlcnZhbF91bml0OiBzdHJpbmdcbiAgaW50ZXJ2YWxfY291bnQ6IG51bWJlclxuICBhbmNob3JfZGF0ZTogc3RyaW5nXG4gIGFsZXJ0X3BlcmNlbnQ6IG51bWJlclxuICBhcmNoaXZlZF9hdDogRGF0ZSB8IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KTogQnVkZ2V0IHtcbiAgcmV0dXJuIHtcbiAgICAuLi5yb3csXG4gICAgYW1vdW50X2NlbnRzOiBhc051bWJlcihyb3cuYW1vdW50X2NlbnRzKSxcbiAgICBhcmNoaXZlZF9hdDogYXNJc29UaW1lc3RhbXBPck51bGwocm93LmFyY2hpdmVkX2F0KSxcbiAgICBjcmVhdGVkX2F0OiBhc0lzb1RpbWVzdGFtcChyb3cuY3JlYXRlZF9hdCksXG4gICAgdXBkYXRlZF9hdDogYXNJc29UaW1lc3RhbXAocm93LnVwZGF0ZWRfYXQpLFxuICB9XG59XG5cbmNvbnN0IERFVklDRV9QTEFURk9STVMgPSBuZXcgU2V0KFsnaW9zJywgJ2FuZHJvaWQnLCAnd2ViJ10pXG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0ocGxhdGZvcm06IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBwbGF0Zm9ybS50cmltKCkudG9Mb3dlckNhc2UoKVxuICBpZiAoIURFVklDRV9QTEFURk9STVMuaGFzKG5vcm1hbGl6ZWQpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwbGF0Zm9ybSBtdXN0IGJlIGlvcywgYW5kcm9pZCwgb3Igd2ViJylcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplZFxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURldmljZVRva2VuKHRva2VuOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gdG9rZW4udHJpbSgpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA8IDggfHwgdHJpbW1lZC5sZW5ndGggPiA0MDk2KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIGRldmljZSB0b2tlbicpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hPd25lZENhdGVnb3J5KGNhdGVnb3J5SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2NhdGVnb3JpZXMnKVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNhdGVnb3J5SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaE93bmVkQnVkZ2V0KGJ1ZGdldElkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdidWRnZXRzJylcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBidWRnZXRJZClcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgY2F0ZWdvcmllczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgaW5jbHVkZUFyY2hpdmVkPzogYm9vbGVhblxuICB9KTogUHJvbWlzZTxDYXRlZ29yeVtdPiA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ25hbWUnLCAnYXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKCFhcmdzPy5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ2FyY2hpdmVkX2F0JywgJ2lzJywgbnVsbClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcENhdGVnb3J5KVxuICB9LFxuXG4gIGNhdGVnb3J5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pOiBQcm9taXNlPENhdGVnb3J5IHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnY2F0ZWdvcmllcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gbWFwQ2F0ZWdvcnkocm93KSA6IG51bGxcbiAgfSxcblxuICBleHBlbnNlczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgZnJvbURhdGU/OiBzdHJpbmdcbiAgICB0b0RhdGU/OiBzdHJpbmdcbiAgICBjYXRlZ29yeUlkPzogbnVtYmVyXG4gIH0pOiBQcm9taXNlPEV4cGVuc2VbXT4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnc3BlbnRfb24nLCAnZGVzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5mcm9tRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3BlbnRfb24nLCAnPj0nLCB2YWxpZGF0ZVNwZW50T24oYXJncy5mcm9tRGF0ZSkpXG4gICAgfVxuICAgIGlmIChhcmdzPy50b0RhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3NwZW50X29uJywgJzw9JywgdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKSlcbiAgICB9XG4gICAgaWYgKGFyZ3M/LmNhdGVnb3J5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnY2F0ZWdvcnlfaWQnLCAnPScsIGFyZ3MuY2F0ZWdvcnlJZClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcEV4cGVuc2UpXG4gIH0sXG5cbiAgZXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KTogUHJvbWlzZTxFeHBlbnNlIHwgbnVsbD4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIHJvdyA/IG1hcEV4cGVuc2Uocm93KSA6IG51bGxcbiAgfSxcblxuICBleHBlbnNlVG90YWxzOiBhc3luYyAoYXJnczoge1xuICAgIGZyb21EYXRlOiBzdHJpbmdcbiAgICB0b0RhdGU6IHN0cmluZ1xuICB9KTogUHJvbWlzZTxFeHBlbnNlVG90YWxbXT4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZyb21EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MuZnJvbURhdGUpXG4gICAgY29uc3QgdG9EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLmlubmVySm9pbignY2F0ZWdvcmllcycsICdjYXRlZ29yaWVzLmlkJywgJ2V4cGVuc2VzLmNhdGVnb3J5X2lkJylcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc+PScsIGZyb21EYXRlKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc8PScsIHRvRGF0ZSlcbiAgICAgIC5zZWxlY3QoW1xuICAgICAgICAnZXhwZW5zZXMuY2F0ZWdvcnlfaWQnLFxuICAgICAgICAnY2F0ZWdvcmllcy5uYW1lIGFzIGNhdGVnb3J5X25hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvciBhcyBjYXRlZ29yeV9jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICAgIHNxbDxzdHJpbmc+YHN1bShleHBlbnNlcy5hbW91bnRfY2VudHMpYC5hcygndG90YWxfY2VudHMnKSxcbiAgICAgIF0pXG4gICAgICAuZ3JvdXBCeShbXG4gICAgICAgICdleHBlbnNlcy5jYXRlZ29yeV9pZCcsXG4gICAgICAgICdjYXRlZ29yaWVzLm5hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICBdKVxuICAgICAgLm9yZGVyQnkoJ3RvdGFsX2NlbnRzJywgJ2Rlc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpOiBFeHBlbnNlVG90YWwgPT4gKHtcbiAgICAgIGNhdGVnb3J5X2lkOiByb3cuY2F0ZWdvcnlfaWQsXG4gICAgICBjYXRlZ29yeV9uYW1lOiByb3cuY2F0ZWdvcnlfbmFtZSxcbiAgICAgIGNhdGVnb3J5X2NvbG9yOiByb3cuY2F0ZWdvcnlfY29sb3IsXG4gICAgICBjdXJyZW5jeTogcm93LmN1cnJlbmN5LFxuICAgICAgdG90YWxfY2VudHM6IGFzTnVtYmVyKHJvdy50b3RhbF9jZW50cyksXG4gICAgfSkpXG4gIH0sXG5cbiAgYnVkZ2V0czogYXN5bmMgKGFyZ3M/OiB7XG4gICAgaW5jbHVkZUFyY2hpdmVkPzogYm9vbGVhblxuICB9KTogUHJvbWlzZTxCdWRnZXRbXT4gPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnYnVkZ2V0cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCduYW1lJywgJ2FzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmICghYXJncz8uaW5jbHVkZUFyY2hpdmVkKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdhcmNoaXZlZF9hdCcsICdpcycsIG51bGwpXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcChtYXBCdWRnZXQpXG4gIH0sXG5cbiAgYnVkZ2V0OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pOiBQcm9taXNlPEJ1ZGdldCB8IG51bGw+ID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBmZXRjaE93bmVkQnVkZ2V0KGFyZ3MuaWQsIHVzZXJJZClcbiAgICByZXR1cm4gcm93ID8gbWFwQnVkZ2V0KHJvdykgOiBudWxsXG4gIH0sXG5cbiAgYnVkZ2V0U3RhdHVzZXM6IGFzeW5jIChhcmdzPzogeyBhc09mPzogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBhc09mID0gYXJncz8uYXNPZiAhPSBudWxsID8gdmFsaWRhdGVTcGVudE9uKGFyZ3MuYXNPZikgOiB0b2RheVV0YygpXG4gICAgcmV0dXJuIGF3YWl0IGNvbXB1dGVCdWRnZXRTdGF0dXNlcyh1c2VySWQsIGFzT2YpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBNdXRhdGlvbiA9IHtcbiAgY3JlYXRlQ2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVDYXRlZ29yeU5hbWUoYXJncy5pbnB1dC5uYW1lKVxuICAgIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVDYXRlZ29yeUNvbG9yKGFyZ3MuaW5wdXQuY29sb3IpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2NhdGVnb3JpZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0NhdGVnb3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBDYXRlZ29yeShyb3cpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6ICcnXG4gICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcygnY2F0ZWdvcmllc191c2VyX2lkX2xvd2VyX25hbWVfYWN0aXZlX3VuaXF1ZScpKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignYSBjYXRlZ29yeSB3aXRoIHRoaXMgbmFtZSBhbHJlYWR5IGV4aXN0cycpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgdXBkYXRlQ2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlkLCB1c2VySWQpXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgIH1cbiAgICBpZiAoZXhpc3RpbmcuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdjYW5ub3QgdXBkYXRlIGFuIGFyY2hpdmVkIGNhdGVnb3J5JylcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lID0gYXJncy5pbnB1dC5uYW1lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVDYXRlZ29yeU5hbWUoYXJncy5pbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lXG4gICAgY29uc3QgY29sb3IgPSBhcmdzLmlucHV0LmNvbG9yICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVDYXRlZ29yeUNvbG9yKGFyZ3MuaW5wdXQuY29sb3IpXG4gICAgICA6IGV4aXN0aW5nLmNvbG9yXG5cbiAgICB0cnkge1xuICAgICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdjYXRlZ29yaWVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIHJldHVybiBtYXBDYXRlZ29yeShyb3cpXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICBjb25zdCBtZXNzYWdlID0gZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6ICcnXG4gICAgICBpZiAobWVzc2FnZS5pbmNsdWRlcygnY2F0ZWdvcmllc191c2VyX2lkX2xvd2VyX25hbWVfYWN0aXZlX3VuaXF1ZScpKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignYSBjYXRlZ29yeSB3aXRoIHRoaXMgbmFtZSBhbHJlYWR5IGV4aXN0cycpXG4gICAgICB9XG4gICAgICB0aHJvdyBlcnJcbiAgICB9XG4gIH0sXG5cbiAgYXJjaGl2ZUNhdGVnb3J5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlkLCB1c2VySWQpXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgIH1cbiAgICBpZiAoZXhpc3RpbmcuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgcmV0dXJuIG1hcENhdGVnb3J5KGV4aXN0aW5nKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2NhdGVnb3JpZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGFyY2hpdmVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIG1hcENhdGVnb3J5KHJvdylcbiAgfSxcblxuICBjcmVhdGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlRXhwZW5zZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICBpZiAoIWNhdGVnb3J5IHx8IGNhdGVnb3J5LmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gdmFsaWRhdGVBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgIGNvbnN0IGN1cnJlbmN5ID0gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5ID8/ICdVU0QnKVxuICAgIGNvbnN0IG5vdGUgPSB2YWxpZGF0ZU5vdGUoYXJncy5pbnB1dC5ub3RlKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdleHBlbnNlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnkuaWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBzcGVudF9vbjogc3BlbnRPbixcbiAgICAgICAgbm90ZSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0V4cGVuc2UpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBhd2FpdCBtYXliZVNlbmRCdWRnZXRBbGVydFB1c2hlcyh1c2VySWQsIHRvZGF5VXRjKCkpXG4gICAgcmV0dXJuIG1hcEV4cGVuc2Uocm93KVxuICB9LFxuXG4gIHVwZGF0ZUV4cGVuc2U6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdleHBlbnNlIG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgbGV0IGNhdGVnb3J5SWQgPSBleGlzdGluZy5jYXRlZ29yeV9pZFxuICAgIGlmIChhcmdzLmlucHV0LmNhdGVnb3J5SWQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgY29uc3QgY2F0ZWdvcnkgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pbnB1dC5jYXRlZ29yeUlkLCB1c2VySWQpXG4gICAgICBpZiAoIWNhdGVnb3J5IHx8IGNhdGVnb3J5LmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgICB9XG4gICAgICBjYXRlZ29yeUlkID0gY2F0ZWdvcnkuaWRcbiAgICB9XG5cbiAgICBjb25zdCBhbW91bnRDZW50cyA9IGFyZ3MuaW5wdXQuYW1vdW50Q2VudHMgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUFtb3VudENlbnRzKGFyZ3MuaW5wdXQuYW1vdW50Q2VudHMpXG4gICAgICA6IGFzTnVtYmVyKGV4aXN0aW5nLmFtb3VudF9jZW50cylcbiAgICBjb25zdCBzcGVudE9uID0gYXJncy5pbnB1dC5zcGVudE9uICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVTcGVudE9uKGFyZ3MuaW5wdXQuc3BlbnRPbilcbiAgICAgIDogZXhpc3Rpbmcuc3BlbnRfb25cbiAgICBjb25zdCBjdXJyZW5jeSA9IGFyZ3MuaW5wdXQuY3VycmVuY3kgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUN1cnJlbmN5KGFyZ3MuaW5wdXQuY3VycmVuY3kpXG4gICAgICA6IGV4aXN0aW5nLmN1cnJlbmN5XG4gICAgY29uc3Qgbm90ZSA9IGFyZ3MuaW5wdXQubm90ZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlTm90ZShhcmdzLmlucHV0Lm5vdGUpXG4gICAgICA6IGV4aXN0aW5nLm5vdGVcblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2V4cGVuc2VzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnlJZCxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIHNwZW50X29uOiBzcGVudE9uLFxuICAgICAgICBub3RlLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgYXdhaXQgbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXModXNlcklkLCB0b2RheVV0YygpKVxuICAgIHJldHVybiBtYXBFeHBlbnNlKHJvdylcbiAgfSxcblxuICBkZWxldGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMCAmJiBOdW1iZXIocmVzdWx0WzBdPy5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcblxuICBjcmVhdGVCdWRnZXQ6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVCdWRnZXRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlQnVkZ2V0TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSB2YWxpZGF0ZUJ1ZGdldEFtb3VudENlbnRzKGFyZ3MuaW5wdXQuYW1vdW50Q2VudHMpXG4gICAgY29uc3QgaW50ZXJ2YWxVbml0ID0gdmFsaWRhdGVJbnRlcnZhbFVuaXQoYXJncy5pbnB1dC5pbnRlcnZhbFVuaXQpXG4gICAgY29uc3QgaW50ZXJ2YWxDb3VudCA9IHZhbGlkYXRlSW50ZXJ2YWxDb3VudChhcmdzLmlucHV0LmludGVydmFsQ291bnQpXG4gICAgY29uc3QgYW5jaG9yRGF0ZSA9IHZhbGlkYXRlQW5jaG9yRGF0ZShhcmdzLmlucHV0LmFuY2hvckRhdGUpXG4gICAgY29uc3QgYWxlcnRQZXJjZW50ID0gdmFsaWRhdGVBbGVydFBlcmNlbnQoYXJncy5pbnB1dC5hbGVydFBlcmNlbnQpXG4gICAgY29uc3QgY3VycmVuY3kgPSB2YWxpZGF0ZUN1cnJlbmN5KGFyZ3MuaW5wdXQuY3VycmVuY3kgPz8gJ1VTRCcpXG5cbiAgICBsZXQgY2F0ZWdvcnlJZDogbnVtYmVyIHwgbnVsbCA9IG51bGxcbiAgICBpZiAoYXJncy5pbnB1dC5jYXRlZ29yeUlkICE9IG51bGwpIHtcbiAgICAgIGNvbnN0IGNhdGVnb3J5ID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCwgdXNlcklkKVxuICAgICAgaWYgKCFjYXRlZ29yeSB8fCBjYXRlZ29yeS5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgICB9XG4gICAgICBjYXRlZ29yeUlkID0gY2F0ZWdvcnkuaWRcbiAgICB9XG5cbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2J1ZGdldHMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY2F0ZWdvcnlfaWQ6IGNhdGVnb3J5SWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBpbnRlcnZhbF91bml0OiBpbnRlcnZhbFVuaXQsXG4gICAgICAgIGludGVydmFsX2NvdW50OiBpbnRlcnZhbENvdW50LFxuICAgICAgICBhbmNob3JfZGF0ZTogYW5jaG9yRGF0ZSxcbiAgICAgICAgYWxlcnRfcGVyY2VudDogYWxlcnRQZXJjZW50LFxuICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0J1ZGdldClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGF3YWl0IG1heWJlU2VuZEJ1ZGdldEFsZXJ0UHVzaGVzKHVzZXJJZCwgdG9kYXlVdGMoKSlcbiAgICByZXR1cm4gbWFwQnVkZ2V0KHJvdylcbiAgfSxcblxuICB1cGRhdGVCdWRnZXQ6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVCdWRnZXRJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQnVkZ2V0KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdidWRnZXQgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2Nhbm5vdCB1cGRhdGUgYW4gYXJjaGl2ZWQgYnVkZ2V0JylcbiAgICB9XG5cbiAgICBjb25zdCBuYW1lID0gYXJncy5pbnB1dC5uYW1lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVCdWRnZXROYW1lKGFyZ3MuaW5wdXQubmFtZSlcbiAgICAgIDogZXhpc3RpbmcubmFtZVxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXJncy5pbnB1dC5hbW91bnRDZW50cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQnVkZ2V0QW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICAgIDogYXNOdW1iZXIoZXhpc3RpbmcuYW1vdW50X2NlbnRzKVxuICAgIGNvbnN0IGludGVydmFsVW5pdCA9IGFyZ3MuaW5wdXQuaW50ZXJ2YWxVbml0ICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVJbnRlcnZhbFVuaXQoYXJncy5pbnB1dC5pbnRlcnZhbFVuaXQpXG4gICAgICA6IHZhbGlkYXRlSW50ZXJ2YWxVbml0KGV4aXN0aW5nLmludGVydmFsX3VuaXQpXG4gICAgY29uc3QgaW50ZXJ2YWxDb3VudCA9IGFyZ3MuaW5wdXQuaW50ZXJ2YWxDb3VudCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlSW50ZXJ2YWxDb3VudChhcmdzLmlucHV0LmludGVydmFsQ291bnQpXG4gICAgICA6IGV4aXN0aW5nLmludGVydmFsX2NvdW50XG4gICAgY29uc3QgYW5jaG9yRGF0ZSA9IGFyZ3MuaW5wdXQuYW5jaG9yRGF0ZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQW5jaG9yRGF0ZShhcmdzLmlucHV0LmFuY2hvckRhdGUpXG4gICAgICA6IGV4aXN0aW5nLmFuY2hvcl9kYXRlXG4gICAgY29uc3QgYWxlcnRQZXJjZW50ID0gYXJncy5pbnB1dC5hbGVydFBlcmNlbnQgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUFsZXJ0UGVyY2VudChhcmdzLmlucHV0LmFsZXJ0UGVyY2VudClcbiAgICAgIDogZXhpc3RpbmcuYWxlcnRfcGVyY2VudFxuICAgIGNvbnN0IGN1cnJlbmN5ID0gYXJncy5pbnB1dC5jdXJyZW5jeSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSlcbiAgICAgIDogZXhpc3RpbmcuY3VycmVuY3lcblxuICAgIGxldCBjYXRlZ29yeUlkID0gZXhpc3RpbmcuY2F0ZWdvcnlfaWRcbiAgICBpZiAoYXJncy5pbnB1dC5jYXRlZ29yeUlkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChhcmdzLmlucHV0LmNhdGVnb3J5SWQgPT0gbnVsbCkge1xuICAgICAgICBjYXRlZ29yeUlkID0gbnVsbFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc3QgY2F0ZWdvcnkgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pbnB1dC5jYXRlZ29yeUlkLCB1c2VySWQpXG4gICAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgICAgIH1cbiAgICAgICAgY2F0ZWdvcnlJZCA9IGNhdGVnb3J5LmlkXG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnYnVkZ2V0cycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgbmFtZSxcbiAgICAgICAgY2F0ZWdvcnlfaWQ6IGNhdGVnb3J5SWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBpbnRlcnZhbF91bml0OiBpbnRlcnZhbFVuaXQsXG4gICAgICAgIGludGVydmFsX2NvdW50OiBpbnRlcnZhbENvdW50LFxuICAgICAgICBhbmNob3JfZGF0ZTogYW5jaG9yRGF0ZSxcbiAgICAgICAgYWxlcnRfcGVyY2VudDogYWxlcnRQZXJjZW50LFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgYXdhaXQgbWF5YmVTZW5kQnVkZ2V0QWxlcnRQdXNoZXModXNlcklkLCB0b2RheVV0YygpKVxuICAgIHJldHVybiBtYXBCdWRnZXQocm93KVxuICB9LFxuXG4gIGFyY2hpdmVCdWRnZXQ6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZEJ1ZGdldChhcmdzLmlkLCB1c2VySWQpXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYnVkZ2V0IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gbWFwQnVkZ2V0KGV4aXN0aW5nKVxuICAgIH1cblxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2J1ZGdldHMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGFyY2hpdmVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwQnVkZ2V0KHJvdylcbiAgfSxcblxuICByZWdpc3RlckRldmljZVRva2VuOiBhc3luYyAoYXJnczogeyB0b2tlbjogc3RyaW5nOyBwbGF0Zm9ybTogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB0b2tlbiA9IHZhbGlkYXRlRGV2aWNlVG9rZW4oYXJncy50b2tlbilcbiAgICBjb25zdCBwbGF0Zm9ybSA9IHZhbGlkYXRlRGV2aWNlUGxhdGZvcm0oYXJncy5wbGF0Zm9ybSlcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50bygnZGV2aWNlX3Rva2VucycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICB0b2tlbixcbiAgICAgICAgcGxhdGZvcm0sXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3RGV2aWNlVG9rZW4pXG4gICAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICAgIG9jLmNvbHVtbigndG9rZW4nKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHBsYXRmb3JtLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSlcbiAgICAgIClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiB0cnVlXG4gIH0sXG5cbiAgdW5yZWdpc3RlckRldmljZVRva2VuOiBhc3luYyAoYXJnczogeyB0b2tlbjogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCB0b2tlbiA9IHZhbGlkYXRlRGV2aWNlVG9rZW4oYXJncy50b2tlbilcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ2RldmljZV90b2tlbnMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3Rva2VuJywgJz0nLCB0b2tlbilcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMCAmJiBOdW1iZXIocmVzdWx0WzBdPy5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IHJlc29sdmVycyA9IHtcbiAgUXVlcnksXG4gIE11dGF0aW9uLFxufVxuIiwgIi8qKlxuICogcGcgcmV0dXJucyBKUyBEYXRlIGZvciB0aW1lc3RhbXBzOyBHcmFwaFFMIHRoZW4gb2Z0ZW4gZXhwb3NlcyB0aGVtIGFzIGVwb2NoXG4gKiBtaWxsaXMgKG9yIGRpZ2l0IHN0cmluZ3MpLCB3aGljaCBicmVha3MgRmx1dHRlcidzIERhdGVUaW1lLnBhcnNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXNJc29UaW1lc3RhbXAodmFsdWU6IERhdGUgfCBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSByZXR1cm4gdmFsdWUudG9JU09TdHJpbmcoKVxuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpXG4gIGlmICgvXlxcZHsxMCx9JC8udGVzdCh0cmltbWVkKSkge1xuICAgIGNvbnN0IG4gPSBOdW1iZXIodHJpbW1lZClcbiAgICBjb25zdCBtcyA9IHRyaW1tZWQubGVuZ3RoIDw9IDEwID8gbiAqIDEwMDAgOiBuXG4gICAgcmV0dXJuIG5ldyBEYXRlKG1zKS50b0lTT1N0cmluZygpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc0lzb1RpbWVzdGFtcE9yTnVsbChcbiAgdmFsdWU6IERhdGUgfCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4gYXNJc29UaW1lc3RhbXAodmFsdWUpXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBJbnRlcnZhbFVuaXQgfSBmcm9tICcuLi9idWRnZXRzL3BlcmlvZC50cydcblxuZXhwb3J0IGNsYXNzIEludmFsaWRDYXRlZ29yeUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkQ2F0ZWdvcnlFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW52YWxpZEV4cGVuc2VFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSlcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZEV4cGVuc2VFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgSW52YWxpZEJ1ZGdldEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkQnVkZ2V0RXJyb3InXG4gIH1cbn1cblxuY29uc3QgSEVYX0NPTE9SID0gL14jWzAtOUEtRmEtZl17Nn0kL1xuY29uc3QgREFURV9PTkxZID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBDVVJSRU5DWSA9IC9eW0EtWl17M30kL1xuY29uc3QgSU5URVJWQUxfVU5JVFMgPSBuZXcgU2V0PEludGVydmFsVW5pdD4oWydkYXknLCAnd2VlaycsICdtb250aCddKVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDYXRlZ29yeU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignbmFtZSBpcyByZXF1aXJlZCcpXG4gIH1cbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCduYW1lIGlzIHRvbyBsb25nJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDYXRlZ29yeUNvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gY29sb3IudHJpbSgpXG4gIGlmICghSEVYX0NPTE9SLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NvbG9yIG11c3QgYmUgYSBoZXggdmFsdWUgbGlrZSAjMEY3NjZFJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZC50b1VwcGVyQ2FzZSgpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFtb3VudENlbnRzKGFtb3VudENlbnRzOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShhbW91bnRDZW50cykgfHwgIU51bWJlci5pc0ludGVnZXIoYW1vdW50Q2VudHMpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChhbW91bnRDZW50cyA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIHBvc2l0aXZlJylcbiAgfVxuICByZXR1cm4gYW1vdW50Q2VudHNcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ3VycmVuY3koY3VycmVuY3k6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBjdXJyZW5jeS50cmltKCkudG9VcHBlckNhc2UoKVxuICBpZiAoIUNVUlJFTkNZLnRlc3QodHJpbW1lZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignY3VycmVuY3kgbXVzdCBiZSBhIDMtbGV0dGVyIElTTyBjb2RlJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTcGVudE9uKHNwZW50T246IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBzcGVudE9uLnRyaW0oKVxuICBpZiAoIURBVEVfT05MWS50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ3NwZW50X29uIG11c3QgYmUgWVlZWS1NTS1ERCcpXG4gIH1cbiAgY29uc3QgZCA9IG5ldyBEYXRlKGAke3RyaW1tZWR9VDAwOjAwOjAwWmApXG4gIGlmIChOdW1iZXIuaXNOYU4oZC5nZXRUaW1lKCkpIHx8IGQudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMCkgIT09IHRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignc3BlbnRfb24gaXMgbm90IGEgdmFsaWQgZGF0ZScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTm90ZShub3RlOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkKTogc3RyaW5nIHwgbnVsbCB7XG4gIGlmIChub3RlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHRyaW1tZWQgPSBub3RlLnRyaW0oKVxuICByZXR1cm4gdHJpbW1lZC5sZW5ndGggPT09IDAgPyBudWxsIDogdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVCdWRnZXROYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCduYW1lIGlzIHRvbyBsb25nJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVCdWRnZXRBbW91bnRDZW50cyhhbW91bnRDZW50czogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoYW1vdW50Q2VudHMpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudENlbnRzKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2Ftb3VudF9jZW50cyBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChhbW91bnRDZW50cyA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYW1vdW50X2NlbnRzIG11c3QgYmUgcG9zaXRpdmUnKVxuICB9XG4gIHJldHVybiBhbW91bnRDZW50c1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbFVuaXQodW5pdDogc3RyaW5nKTogSW50ZXJ2YWxVbml0IHtcbiAgY29uc3QgdHJpbW1lZCA9IHVuaXQudHJpbSgpLnRvTG93ZXJDYXNlKClcbiAgaWYgKCFJTlRFUlZBTF9VTklUUy5oYXModHJpbW1lZCBhcyBJbnRlcnZhbFVuaXQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignaW50ZXJ2YWxfdW5pdCBtdXN0IGJlIGRheSwgd2Vlaywgb3IgbW9udGgnKVxuICB9XG4gIHJldHVybiB0cmltbWVkIGFzIEludGVydmFsVW5pdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVJbnRlcnZhbENvdW50KGNvdW50OiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZShjb3VudCkgfHwgIU51bWJlci5pc0ludGVnZXIoY291bnQpIHx8IGNvdW50IDwgMSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQnVkZ2V0RXJyb3IoJ2ludGVydmFsX2NvdW50IG11c3QgYmUgYW4gaW50ZWdlciA+PSAxJylcbiAgfVxuICByZXR1cm4gY291bnRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQWxlcnRQZXJjZW50KHBlcmNlbnQ6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHBlcmNlbnQpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHBlcmNlbnQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYWxlcnRfcGVyY2VudCBtdXN0IGJlIGFuIGludGVnZXInKVxuICB9XG4gIGlmIChwZXJjZW50IDwgMSB8fCBwZXJjZW50ID4gMTAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRCdWRnZXRFcnJvcignYWxlcnRfcGVyY2VudCBtdXN0IGJlIGJldHdlZW4gMSBhbmQgMTAwJylcbiAgfVxuICByZXR1cm4gcGVyY2VudFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbmNob3JEYXRlKGFuY2hvckRhdGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHZhbGlkYXRlU3BlbnRPbihhbmNob3JEYXRlKVxuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEJ1ZGdldEVycm9yKCdhbmNob3JfZGF0ZSBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcycsXG4gICAgJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gIClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHtcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxuICB0eXBlIFZlcmlmaWVkQXV0aCxcbn0gZnJvbSAnLi4vYXV0aC92ZXJpZnkudHMnXG5cbi8qKiBQdWJsaWMgQUxCIC8gbG9hZC1iYWxhbmNlciBoZWFsdGggY2hlY2suICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gaGVhbHRoTWlkZGxld2FyZShcbiAgY3R4OiBDb250ZXh0LFxuICBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+LFxuKSB7XG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCA9PT0gJy9oZWFsdGgnICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSB9KSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgYXdhaXQgbmV4dCgpXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlclJlZiA9IHtcbiAgaWQ6IG51bWJlclxufVxuXG5leHBvcnQgdHlwZSBSZXNvbHZlTG9jYWxVc2VyRm4gPSAoXG4gIGlkZW50aXR5OiBWZXJpZmllZEF1dGgsXG4pID0+IFByb21pc2U8TG9jYWxVc2VyUmVmPlxuXG4vKipcbiAqIFJlcXVpcmUgYSB2YWxpZCBCZWFyZXIgSldUIG9uIGAvZ3JhcGhxbGAgYW5kIHNldCBQeWxvbiBjb250ZXh0IHZhcnM6XG4gKiBgdXNlcklkYCwgYGF1dGhVc2VySWRgLCBvcHRpb25hbCBgYXV0aEVtYWlsYC5cbiAqXG4gKiBDYWxsZXJzIHRoYXQgbmVlZCBhdXRoIGZvciBvdGhlciBwYXRocyAoZS5nLiBSRVNUIGFzc2V0cykgc2hvdWxkIGhhbmRsZVxuICogdGhvc2UgYmVmb3JlIHRoaXMgbWlkZGxld2FyZSBvciB1c2UgYHZlcmlmeUFjY2Vzc1Rva2VuYCBkaXJlY3RseS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZUdyYXBoUUxBdXRoTWlkZGxld2FyZShcbiAgcmVzb2x2ZUxvY2FsVXNlcjogUmVzb2x2ZUxvY2FsVXNlckZuLFxuKSB7XG4gIHJldHVybiBhc3luYyBmdW5jdGlvbiBncmFwaFFMQXV0aE1pZGRsZXdhcmUoXG4gICAgY3R4OiBDb250ZXh0LFxuICAgIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4sXG4gICkge1xuICAgIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgICBhd2FpdCBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gICAgaWYgKFxuICAgICAgcGF0aCA9PT0gJy9oZWFsdGgnIHx8XG4gICAgICAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSlcbiAgICApIHtcbiAgICAgIGF3YWl0IG5leHQoKVxuICAgICAgcmV0dXJuXG4gICAgfVxuXG4gICAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICAgIGlmICghdmVyaWZpZWQpIHtcbiAgICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gICAgfVxuXG4gICAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih2ZXJpZmllZClcblxuICAgIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICAgIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gICAgfVxuICAgIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICAgIGF3YWl0IG5leHQoKVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEt5c2VseSwgU2VsZWN0YWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLyoqIE1pbmltYWwgdXNlcnMgdGFibGUgc2hhcGUgcmVxdWlyZWQgYnkgcmVzb2x2ZUxvY2FsVXNlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVXNlcnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBlbWFpbDogc3RyaW5nXG4gIHBhc3N3b3JkX2hhc2g6IHN0cmluZyB8IG51bGxcbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIFVzZXJzRGF0YWJhc2UgPSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG59XG5cbmV4cG9ydCB0eXBlIExvY2FsVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcjxEQiBleHRlbmRzIFVzZXJzRGF0YWJhc2U+KFxuICBkYjogS3lzZWx5PERCPixcbiAgaWRlbnRpdHk6IEF1dGhJZGVudGl0eSxcbik6IFByb21pc2U8U2VsZWN0YWJsZTxEQlsndXNlcnMnXT4+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgYXMgcmVzb2x2ZUxvY2FsVXNlcktpdCB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL3VzZXJzLnRzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIHsgQXV0aElkZW50aXR5IH1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXIoaWRlbnRpdHk6IEF1dGhJZGVudGl0eSk6IFByb21pc2U8VXNlcj4ge1xuICByZXR1cm4gcmVzb2x2ZUxvY2FsVXNlcktpdChkYiwgaWRlbnRpdHkpXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsU0FBUyxXQUFXOzs7QUNHYixJQUFNLGlCQUFOLE1BQTJDO0FBQUEsRUFDaEQsTUFBTSxhQUNKLFNBQ0EsVUFDNkI7QUFDN0IsV0FBTyxFQUFFLGNBQWMsR0FBRyxlQUFlLENBQUMsRUFBRTtBQUFBLEVBQzlDO0FBQ0Y7OztBQ1RPLFNBQVMsSUFBSSxNQUFrQztBQUNwRCxNQUFJLE9BQU8sWUFBWSxlQUFlLFFBQVEsTUFBTSxJQUFJLEdBQUc7QUFDekQsV0FBTyxRQUFRLElBQUksSUFBSTtBQUFBLEVBQ3pCO0FBQ0EsTUFBSTtBQUNGLFdBQU8sS0FBSyxJQUFJLElBQUksSUFBSTtBQUFBLEVBQzFCLFFBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGOzs7QUNOQSxlQUFlLGFBQWEsTUFBK0I7QUFDekQsTUFBSSxPQUFPLFNBQVMsZUFBZSxPQUFPLEtBQUssaUJBQWlCLFlBQVk7QUFDMUUsV0FBTyxNQUFNLEtBQUssYUFBYSxJQUFJO0FBQUEsRUFDckM7QUFDQSxRQUFNLEVBQUUsU0FBUyxJQUFJLE1BQU0sT0FBTyxrQkFBa0I7QUFDcEQsU0FBTyxNQUFNLFNBQVMsTUFBTSxNQUFNO0FBQ3BDO0FBK0JBLElBQU0sc0JBQXNCLG9CQUFJLElBQUk7QUFBQSxFQUNsQztBQUFBLEVBQ0E7QUFDRixDQUFDO0FBUU0sSUFBTSxxQkFBTixNQUErQztBQUFBLEVBQ3BELFlBQTZCLFdBQXNCO0FBQXRCO0FBQUEsRUFBdUI7QUFBQSxFQUVwRCxNQUFNLGFBQ0osUUFDQSxTQUM2QjtBQUM3QixRQUFJLE9BQU8sV0FBVyxHQUFHO0FBQ3ZCLGFBQU8sRUFBRSxjQUFjLEdBQUcsZUFBZSxDQUFDLEVBQUU7QUFBQSxJQUM5QztBQUVBLFVBQU0sZ0JBQTBCLENBQUM7QUFDakMsUUFBSSxlQUFlO0FBR25CLFVBQU0sWUFBWTtBQUNsQixhQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sUUFBUSxLQUFLLFdBQVc7QUFDakQsWUFBTSxRQUFRLE9BQU8sTUFBTSxHQUFHLElBQUksU0FBUztBQUMzQyxZQUFNLFNBQVMsTUFBTSxLQUFLLFVBQVUscUJBQXFCO0FBQUEsUUFDdkQsUUFBUTtBQUFBLFFBQ1IsY0FBYztBQUFBLFVBQ1osT0FBTyxRQUFRO0FBQUEsVUFDZixNQUFNLFFBQVE7QUFBQSxRQUNoQjtBQUFBLFFBQ0EsTUFBTSxRQUFRO0FBQUEsTUFDaEIsQ0FBQztBQUNELHNCQUFnQixPQUFPO0FBQ3ZCLGFBQU8sVUFBVSxRQUFRLENBQUMsVUFBVSxVQUFVO0FBQzVDLFlBQUksU0FBUyxRQUFTO0FBQ3RCLGNBQU0sT0FBTyxTQUFTLE9BQU87QUFDN0IsWUFBSSxRQUFRLG9CQUFvQixJQUFJLElBQUksR0FBRztBQUN6Qyx3QkFBYyxLQUFLLE1BQU0sS0FBSyxDQUFFO0FBQUEsUUFDbEM7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNIO0FBRUEsV0FBTyxFQUFFLGNBQWMsY0FBYztBQUFBLEVBQ3ZDO0FBQ0Y7QUFFQSxTQUFTLHdCQUF3QixLQUE2QjtBQUM1RCxRQUFNLFNBQVMsS0FBSyxNQUFNLEdBQUc7QUFDN0IsTUFDRSxPQUFPLE9BQU8sZUFBZSxZQUM3QixPQUFPLE9BQU8saUJBQWlCLFlBQy9CLE9BQU8sT0FBTyxnQkFBZ0IsVUFDOUI7QUFDQSxVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxTQUFPLGNBQWMsT0FBTyxZQUFZLFFBQVEsUUFBUSxJQUFJO0FBQzVELFNBQU87QUFDVDtBQUVBLGVBQWUscUJBQXFEO0FBQ2xFLFFBQU0sT0FBTyxJQUFJLCtCQUErQjtBQUNoRCxNQUFJLFFBQVEsS0FBSyxLQUFLLEVBQUUsU0FBUyxHQUFHO0FBQ2xDLFdBQU8sd0JBQXdCLElBQUk7QUFBQSxFQUNyQztBQUVBLFFBQU0sT0FBTyxJQUFJLCtCQUErQjtBQUNoRCxNQUFJLFFBQVEsS0FBSyxLQUFLLEVBQUUsU0FBUyxHQUFHO0FBQ2xDLFVBQU0sT0FBTyxNQUFNLGFBQWEsSUFBSTtBQUNwQyxXQUFPLHdCQUF3QixJQUFJO0FBQUEsRUFDckM7QUFFQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLG9CQUFrRDtBQUkvRCxRQUFNLE1BQU0sTUFBTSxPQUFPLGdCQUFnQjtBQUd6QyxTQUFPLElBQUksV0FBVztBQUN4QjtBQVVBLGVBQXNCLDBCQUErQztBQUNuRSxNQUFJO0FBQ0YsVUFBTSxVQUFVLE1BQU0sbUJBQW1CO0FBQ3pDLFFBQUksQ0FBQyxTQUFTO0FBQ1osY0FBUTtBQUFBLFFBQ047QUFBQSxNQUNGO0FBQ0EsYUFBTyxJQUFJLGVBQWU7QUFBQSxJQUM1QjtBQUVBLFVBQU0sUUFBUSxNQUFNLGtCQUFrQjtBQUN0QyxRQUFJLE1BQU0sS0FBSyxXQUFXLEdBQUc7QUFDM0IsWUFBTSxjQUFjO0FBQUEsUUFDbEIsWUFBWSxNQUFNLFdBQVcsS0FBSyxPQUFPO0FBQUEsTUFDM0MsQ0FBQztBQUFBLElBQ0g7QUFFQSxXQUFPLElBQUksbUJBQW1CLE1BQU0sVUFBVSxDQUFDO0FBQUEsRUFDakQsU0FBUyxLQUFLO0FBQ1osWUFBUSxNQUFNLHNEQUFzRCxHQUFHO0FBQ3ZFLFdBQU8sSUFBSSxlQUFlO0FBQUEsRUFDNUI7QUFDRjs7O0FDbktBLE9BQTBFOzs7QUNBMUUsU0FBUyxNQUFNLGFBQWE7QUFDNUIsU0FBUyxRQUFRLHVCQUF1Qjs7O0FDQWpDLFNBQVMsa0JBQ2QsYUFDcUQ7QUFDckQsTUFBSTtBQUNKLE1BQUk7QUFDRixVQUFNLElBQUksSUFBSSxXQUFXO0FBQUEsRUFDM0IsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxPQUFPLElBQUksYUFBYSxJQUFJLFNBQVMsR0FBRyxZQUFZO0FBQzFELE1BQUksU0FBUyxVQUFXLFFBQU87QUFDL0IsTUFBSSxTQUFTLGFBQWEsU0FBUyxlQUFlLFNBQVMsZUFBZTtBQUN4RSxXQUFPLEVBQUUsb0JBQW9CLE1BQU07QUFBQSxFQUNyQztBQUVBLFFBQU0sT0FBTyxJQUFJO0FBQ2pCLE1BQUksU0FBUyxlQUFlLFNBQVMsWUFBYSxRQUFPO0FBRXpELFNBQU8sRUFBRSxvQkFBb0IsTUFBTTtBQUNyQztBQUtPLFNBQVMsaUNBQWlDLGFBQTZCO0FBQzVFLE1BQUk7QUFDRixVQUFNLE1BQU0sSUFBSSxJQUFJLFdBQVc7QUFDL0IsZUFBVyxPQUFPO0FBQUEsTUFDaEI7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsSUFDRixHQUFHO0FBQ0QsVUFBSSxhQUFhLE9BQU8sR0FBRztBQUFBLElBQzdCO0FBQ0EsV0FBTyxJQUFJLFNBQVM7QUFBQSxFQUN0QixRQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjs7O0FEL0JBLE1BQU0sY0FBYyxNQUFNLFNBQVMsTUFBTSxDQUFDLFVBQWtCLEtBQUs7QUFPakUsU0FBUyxrQkFDUCxpQkFDdUM7QUFDdkMsUUFBTSxjQUFjLElBQUksY0FBYztBQUN0QyxNQUFJLGFBQWE7QUFDZixVQUFNLE1BQU0sa0JBQWtCLFdBQVc7QUFDekMsV0FBTztBQUFBLE1BQ0wsa0JBQWtCLGlDQUFpQyxXQUFXO0FBQUEsTUFDOUQsS0FBSztBQUFBLE1BQ0wsR0FBSSxRQUFRLFNBQVksQ0FBQyxJQUFJLEVBQUUsSUFBSTtBQUFBLElBQ3JDO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMLFVBQVUsSUFBSSxZQUFZLEtBQUs7QUFBQSxJQUMvQixNQUFNLElBQUksUUFBUSxLQUFLO0FBQUEsSUFDdkIsTUFBTSxJQUFJLFFBQVEsS0FBSztBQUFBLElBQ3ZCLFVBQVUsSUFBSSxZQUFZLEtBQUs7QUFBQSxJQUMvQixNQUFNLE9BQU8sSUFBSSxRQUFRLEtBQUssTUFBTTtBQUFBLElBQ3BDLEtBQUs7QUFBQSxFQUNQO0FBQ0Y7QUFHTyxTQUFTLGFBQWlCLFNBQTBDO0FBQ3pFLFFBQU0sVUFBVSxJQUFJLGdCQUFnQjtBQUFBLElBQ2xDLE1BQU0sSUFBSSxLQUFLLGtCQUFrQixRQUFRLGVBQWUsQ0FBQztBQUFBLEVBQzNELENBQUM7QUFDRCxTQUFPLElBQUksT0FBVyxFQUFFLFFBQVEsQ0FBQztBQUNuQzs7O0FFMUNPLElBQU0sS0FBSyxhQUF1QjtBQUFBLEVBQ3ZDLGlCQUFpQjtBQUNuQixDQUFDOzs7QUNQRCxTQUFTLFdBQVc7OztBQ1dwQixTQUFTLGNBQWMsT0FBcUI7QUFDMUMsUUFBTSxJQUFJLG9CQUFJLEtBQUssR0FBRyxLQUFLLFlBQVk7QUFDdkMsTUFBSSxPQUFPLE1BQU0sRUFBRSxRQUFRLENBQUMsS0FBSyxFQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRSxNQUFNLE9BQU87QUFDdkUsVUFBTSxJQUFJLE1BQU0saUJBQWlCLEtBQUssRUFBRTtBQUFBLEVBQzFDO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxlQUFlLEdBQWlCO0FBQ3ZDLFNBQU8sRUFBRSxZQUFZLEVBQUUsTUFBTSxHQUFHLEVBQUU7QUFDcEM7QUFFQSxTQUFTLGVBQWUsTUFBWSxJQUFrQjtBQUNwRCxTQUFPLEtBQUssT0FBTyxHQUFHLFFBQVEsSUFBSSxLQUFLLFFBQVEsTUFBTSxLQUFLLEtBQUssS0FBSyxJQUFLO0FBQzNFO0FBR08sU0FBUyxhQUFhLE1BQVksUUFBc0I7QUFDN0QsUUFBTSxPQUFPLEtBQUssZUFBZTtBQUNqQyxRQUFNLFFBQVEsS0FBSyxZQUFZO0FBQy9CLFFBQU0sTUFBTSxLQUFLLFdBQVc7QUFDNUIsUUFBTSxTQUFTLElBQUksS0FBSyxLQUFLLElBQUksTUFBTSxRQUFRLFFBQVEsQ0FBQyxDQUFDO0FBQ3pELFFBQU0sVUFBVSxJQUFJO0FBQUEsSUFDbEIsS0FBSyxJQUFJLE9BQU8sZUFBZSxHQUFHLE9BQU8sWUFBWSxJQUFJLEdBQUcsQ0FBQztBQUFBLEVBQy9ELEVBQUUsV0FBVztBQUNiLFNBQU8sV0FBVyxLQUFLLElBQUksS0FBSyxPQUFPLENBQUM7QUFDeEMsU0FBTztBQUNUO0FBRU8sU0FBUyxZQUNkLFVBQ0EsTUFDQSxPQUNRO0FBQ1IsTUFBSSxDQUFDLE9BQU8sVUFBVSxLQUFLLEtBQUssUUFBUSxHQUFHO0FBQ3pDLFVBQU0sSUFBSSxNQUFNLDJDQUEyQztBQUFBLEVBQzdEO0FBQ0EsUUFBTSxJQUFJLGNBQWMsUUFBUTtBQUNoQyxNQUFJLFNBQVMsT0FBTztBQUNsQixNQUFFLFdBQVcsRUFBRSxXQUFXLElBQUksS0FBSztBQUNuQyxXQUFPLGVBQWUsQ0FBQztBQUFBLEVBQ3pCO0FBQ0EsTUFBSSxTQUFTLFFBQVE7QUFDbkIsTUFBRSxXQUFXLEVBQUUsV0FBVyxJQUFJLFFBQVEsQ0FBQztBQUN2QyxXQUFPLGVBQWUsQ0FBQztBQUFBLEVBQ3pCO0FBQ0EsU0FBTyxlQUFlLGFBQWEsR0FBRyxLQUFLLENBQUM7QUFDOUM7QUFNTyxTQUFTLGNBQWMsTUFLTjtBQUN0QixRQUFNLEVBQUUsWUFBWSxjQUFjLGVBQWUsS0FBSyxJQUFJO0FBQzFELE1BQUksT0FBTyxXQUFZLFFBQU87QUFFOUIsTUFBSSxpQkFBaUIsU0FBUyxpQkFBaUIsUUFBUTtBQUNyRCxVQUFNLGFBQ0osaUJBQWlCLFFBQVEsZ0JBQWdCLGdCQUFnQjtBQUMzRCxVQUFNLFNBQVMsY0FBYyxVQUFVO0FBQ3ZDLFVBQU0sV0FBVyxjQUFjLElBQUk7QUFDbkMsVUFBTSxVQUFVLGVBQWUsUUFBUSxRQUFRO0FBQy9DLFVBQU0sUUFBUSxLQUFLLE1BQU0sVUFBVSxVQUFVO0FBQzdDLFVBQU0sWUFBWSxJQUFJLEtBQUssTUFBTTtBQUNqQyxjQUFVLFdBQVcsVUFBVSxXQUFXLElBQUksUUFBUSxVQUFVO0FBQ2hFLFVBQU0sVUFBVSxJQUFJLEtBQUssU0FBUztBQUNsQyxZQUFRLFdBQVcsUUFBUSxXQUFXLElBQUksVUFBVTtBQUNwRCxXQUFPO0FBQUEsTUFDTCxPQUFPLGVBQWUsU0FBUztBQUFBLE1BQy9CLGNBQWMsZUFBZSxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBR0EsTUFBSSxRQUFRO0FBQ1osTUFBSSxlQUFlLFlBQVksT0FBTyxTQUFTLGFBQWE7QUFFNUQsV0FBUyxJQUFJLEdBQUcsSUFBSSxLQUFNLEtBQUs7QUFDN0IsUUFBSSxRQUFRLFNBQVMsT0FBTyxjQUFjO0FBQ3hDLGFBQU8sRUFBRSxPQUFPLGFBQWE7QUFBQSxJQUMvQjtBQUNBLFlBQVE7QUFDUixtQkFBZSxZQUFZLE9BQU8sU0FBUyxhQUFhO0FBQUEsRUFDMUQ7QUFDQSxRQUFNLElBQUksTUFBTSxrQ0FBa0M7QUFDcEQ7OztBRG5GQSxTQUFTLFNBQVMsT0FBZ0M7QUFDaEQsTUFBSSxPQUFPLFVBQVUsU0FBVSxRQUFPO0FBQ3RDLFFBQU0sSUFBSSxPQUFPLEtBQUs7QUFDdEIsTUFBSSxDQUFDLE9BQU8sU0FBUyxDQUFDLEdBQUc7QUFDdkIsVUFBTSxJQUFJLE1BQU0sZ0JBQWdCO0FBQUEsRUFDbEM7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLG9CQUFvQixNQU1mO0FBQ2xCLE1BQUksUUFBUSxHQUNULFdBQVcsVUFBVSxFQUNyQixNQUFNLFdBQVcsS0FBSyxLQUFLLE1BQU0sRUFDakMsTUFBTSxZQUFZLEtBQUssS0FBSyxRQUFRLEVBQ3BDLE1BQU0sWUFBWSxNQUFNLEtBQUssUUFBUSxFQUNyQyxNQUFNLFlBQVksS0FBSyxLQUFLLGVBQWUsRUFDM0MsT0FBTyxvQ0FBNEMsR0FBRyxhQUFhLENBQUM7QUFFdkUsTUFBSSxLQUFLLGNBQWMsTUFBTTtBQUMzQixZQUFRLE1BQU0sTUFBTSxlQUFlLEtBQUssS0FBSyxVQUFVO0FBQUEsRUFDekQ7QUFFQSxRQUFNLE1BQU0sTUFBTSxNQUFNLHdCQUF3QjtBQUNoRCxTQUFPLFNBQVMsSUFBSSxXQUFXO0FBQ2pDO0FBR0EsZUFBc0Isc0JBQ3BCLFFBQ0EsTUFDNEI7QUFDNUIsUUFBTSxVQUFVLE1BQU0sR0FDbkIsV0FBVyxTQUFTLEVBQ3BCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsTUFBTSxlQUFlLE1BQU0sSUFBSSxFQUMvQixRQUFRLFFBQVEsS0FBSyxFQUNyQixVQUFVLEVBQ1YsUUFBUTtBQUVYLFFBQU0sV0FBOEIsQ0FBQztBQUNyQyxhQUFXLFVBQVUsU0FBUztBQUM1QixVQUFNLGNBQWMsU0FBUyxPQUFPLFlBQVk7QUFDaEQsVUFBTSxTQUFTLGNBQWM7QUFBQSxNQUMzQixZQUFZLE9BQU87QUFBQSxNQUNuQixjQUFjLE9BQU87QUFBQSxNQUNyQixlQUFlLE9BQU87QUFBQSxNQUN0QjtBQUFBLElBQ0YsQ0FBQztBQUVELFFBQUksQ0FBQyxRQUFRO0FBQ1gsZUFBUyxLQUFLO0FBQUEsUUFDWixXQUFXLE9BQU87QUFBQSxRQUNsQixhQUFhLE9BQU87QUFBQSxRQUNwQixhQUFhLE9BQU87QUFBQSxRQUNwQixVQUFVLE9BQU87QUFBQSxRQUNqQixjQUFjO0FBQUEsUUFDZCxhQUFhO0FBQUEsUUFDYixjQUFjO0FBQUEsUUFDZCxlQUFlLE9BQU87QUFBQSxRQUN0QixpQkFBaUI7QUFBQSxRQUNqQixjQUFjO0FBQUEsUUFDZCxzQkFBc0I7QUFBQSxNQUN4QixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsVUFBTSxhQUFhLE1BQU0sb0JBQW9CO0FBQUEsTUFDM0M7QUFBQSxNQUNBLFlBQVksT0FBTztBQUFBLE1BQ25CLFVBQVUsT0FBTztBQUFBLE1BQ2pCLFVBQVUsT0FBTztBQUFBLE1BQ2pCLGlCQUFpQixPQUFPO0FBQUEsSUFDMUIsQ0FBQztBQUNELFVBQU0sY0FBYyxjQUFjLElBQzlCLEtBQUssTUFBTyxhQUFhLE1BQU8sV0FBVyxJQUMzQztBQUNKLFVBQU0saUJBQWlCLGVBQWUsT0FBTztBQUU3QyxhQUFTLEtBQUs7QUFBQSxNQUNaLFdBQVcsT0FBTztBQUFBLE1BQ2xCLGFBQWEsT0FBTztBQUFBLE1BQ3BCLGFBQWEsT0FBTztBQUFBLE1BQ3BCLFVBQVUsT0FBTztBQUFBLE1BQ2pCLGNBQWM7QUFBQSxNQUNkLGFBQWE7QUFBQSxNQUNiLGNBQWM7QUFBQSxNQUNkLGVBQWUsT0FBTztBQUFBLE1BQ3RCLGlCQUFpQjtBQUFBLE1BQ2pCLGNBQWMsT0FBTztBQUFBLE1BQ3JCLHNCQUFzQixPQUFPO0FBQUEsSUFDL0IsQ0FBQztBQUFBLEVBQ0g7QUFFQSxTQUFPO0FBQ1Q7OztBRS9HQSxJQUFJLGFBQXlCLElBQUksZUFBZTtBQUd6QyxTQUFTLGNBQWMsUUFBMEI7QUFDdEQsZUFBYTtBQUNmO0FBcUJBLFNBQVMsWUFBWSxRQUFpQztBQUNwRCxTQUFPLEdBQUcsT0FBTyxZQUFZO0FBQy9CO0FBTUEsZUFBc0IsbUNBQ3BCLFFBQ0EsTUFDQSxNQUNpQjtBQUNqQixRQUFNLFdBQVcsTUFBTSxLQUFLLGdCQUFnQixRQUFRLElBQUk7QUFDeEQsUUFBTSxZQUFZLFNBQVM7QUFBQSxJQUN6QixDQUFDLE1BQU0sRUFBRSxtQkFBbUIsRUFBRSxnQkFBZ0I7QUFBQSxFQUNoRDtBQUNBLE1BQUksVUFBVSxXQUFXLEVBQUcsUUFBTztBQUVuQyxRQUFNLFNBQVMsTUFBTSxLQUFLLFdBQVcsTUFBTTtBQUMzQyxNQUFJLE9BQU8sV0FBVyxHQUFHO0FBTXZCLFdBQU87QUFBQSxFQUNUO0FBRUEsTUFBSSxPQUFPO0FBQ1gsYUFBVyxVQUFVLFdBQVc7QUFDOUIsVUFBTSxjQUFjLE9BQU87QUFDM0IsVUFBTSxVQUFVLE1BQU0sS0FBSyxhQUFhLE9BQU8sV0FBVyxXQUFXO0FBQ3JFLFFBQUksQ0FBQyxRQUFTO0FBRWQsVUFBTSxTQUFTLE1BQU0sS0FBSyxPQUFPLGFBQWEsUUFBUTtBQUFBLE1BQ3BELE9BQU8sT0FBTztBQUFBLE1BQ2QsT0FBTyxLQUFLLGNBQWMsYUFBYSxNQUFNO0FBQUEsTUFDN0MsTUFBTTtBQUFBLFFBQ0osTUFBTTtBQUFBLFFBQ04sV0FBVyxPQUFPLE9BQU8sU0FBUztBQUFBLFFBQ2xDLGNBQWM7QUFBQSxRQUNkLGNBQWMsT0FBTyxPQUFPLFlBQVk7QUFBQSxNQUMxQztBQUFBLElBQ0YsQ0FBQztBQUNELFlBQVEsT0FBTztBQUNmLFFBQUksT0FBTyxjQUFjLFNBQVMsR0FBRztBQUNuQyxZQUFNLEtBQUssYUFBYSxPQUFPLGFBQWE7QUFBQSxJQUM5QztBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxlQUFlLGFBQ2IsVUFDQSxhQUNrQjtBQUNsQixNQUFJO0FBQ0YsVUFBTSxHQUNILFdBQVcsb0JBQW9CLEVBQy9CLE9BQU87QUFBQSxNQUNOLFdBQVc7QUFBQSxNQUNYLGNBQWM7QUFBQSxNQUNkLFVBQVMsb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNsQyxDQUFDLEVBQ0EsUUFBUTtBQUNYLFdBQU87QUFBQSxFQUNULFNBQVMsS0FBSztBQUNaLFVBQU0sVUFBVSxlQUFlLFFBQVEsSUFBSSxVQUFVLE9BQU8sR0FBRztBQUUvRCxRQUNFLFFBQVEsU0FBUyx5QkFBeUIsS0FDMUMsUUFBUSxTQUFTLGVBQWUsS0FDaEMsUUFBUSxTQUFTLFFBQVEsR0FDekI7QUFDQSxhQUFPO0FBQUEsSUFDVDtBQUNBLFVBQU07QUFBQSxFQUNSO0FBQ0Y7QUFFQSxlQUFlLFdBQVcsUUFBbUM7QUFDM0QsUUFBTSxPQUFPLE1BQU0sR0FDaEIsV0FBVyxlQUFlLEVBQzFCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsT0FBTyxPQUFPLEVBQ2QsUUFBUTtBQUNYLFNBQU8sS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLEtBQUs7QUFDaEM7QUFFQSxlQUFlLGFBQWEsUUFBaUM7QUFDM0QsTUFBSSxPQUFPLFdBQVcsRUFBRztBQUN6QixRQUFNLEdBQ0gsV0FBVyxlQUFlLEVBQzFCLE1BQU0sU0FBUyxNQUFNLE1BQU0sRUFDM0IsUUFBUTtBQUNiO0FBR0EsZUFBc0IsMkJBQ3BCLFFBQ0EsTUFDZTtBQUNmLE1BQUk7QUFDRixVQUFNLG1DQUFtQyxRQUFRLE1BQU07QUFBQSxNQUNyRCxpQkFBaUI7QUFBQSxNQUNqQjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxRQUFRO0FBQUEsSUFDVixDQUFDO0FBQUEsRUFDSCxTQUFTLEtBQUs7QUFFWixZQUFRLE1BQU0sbUNBQW1DLEdBQUc7QUFBQSxFQUN0RDtBQUNGOzs7QUNySkEsU0FBUyxrQkFBa0I7QUFDM0IsU0FBUyxPQUFBQSxZQUFXOzs7QUNHYixTQUFTLGVBQWUsT0FBOEI7QUFDM0QsTUFBSSxpQkFBaUIsS0FBTSxRQUFPLE1BQU0sWUFBWTtBQUNwRCxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBQzNCLE1BQUksWUFBWSxLQUFLLE9BQU8sR0FBRztBQUM3QixVQUFNLElBQUksT0FBTyxPQUFPO0FBQ3hCLFVBQU0sS0FBSyxRQUFRLFVBQVUsS0FBSyxJQUFJLE1BQU87QUFDN0MsV0FBTyxJQUFJLEtBQUssRUFBRSxFQUFFLFlBQVk7QUFBQSxFQUNsQztBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMscUJBQ2QsT0FDZTtBQUNmLE1BQUksU0FBUyxLQUFNLFFBQU87QUFDMUIsU0FBTyxlQUFlLEtBQUs7QUFDN0I7OztBQ2xCTyxJQUFNLHVCQUFOLGNBQW1DLE1BQU07QUFBQSxFQUM5QyxZQUFZLFNBQWlCO0FBQzNCLFVBQU0sT0FBTztBQUNiLFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQUVPLElBQU0sc0JBQU4sY0FBa0MsTUFBTTtBQUFBLEVBQzdDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBRU8sSUFBTSxxQkFBTixjQUFpQyxNQUFNO0FBQUEsRUFDNUMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFFQSxJQUFNLFlBQVk7QUFDbEIsSUFBTSxZQUFZO0FBQ2xCLElBQU0sV0FBVztBQUNqQixJQUFNLGlCQUFpQixvQkFBSSxJQUFrQixDQUFDLE9BQU8sUUFBUSxPQUFPLENBQUM7QUFFOUQsU0FBUyxxQkFBcUIsTUFBc0I7QUFDekQsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixNQUFJLENBQUMsU0FBUztBQUNaLFVBQU0sSUFBSSxxQkFBcUIsa0JBQWtCO0FBQUEsRUFDbkQ7QUFDQSxNQUFJLFFBQVEsU0FBUyxLQUFLO0FBQ3hCLFVBQU0sSUFBSSxxQkFBcUIsa0JBQWtCO0FBQUEsRUFDbkQ7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLHNCQUFzQixPQUF1QjtBQUMzRCxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBQzNCLE1BQUksQ0FBQyxVQUFVLEtBQUssT0FBTyxHQUFHO0FBQzVCLFVBQU0sSUFBSSxxQkFBcUIsd0NBQXdDO0FBQUEsRUFDekU7QUFDQSxTQUFPLFFBQVEsWUFBWTtBQUM3QjtBQUVPLFNBQVMsb0JBQW9CLGFBQTZCO0FBQy9ELE1BQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxLQUFLLENBQUMsT0FBTyxVQUFVLFdBQVcsR0FBRztBQUNuRSxVQUFNLElBQUksb0JBQW9CLGlDQUFpQztBQUFBLEVBQ2pFO0FBQ0EsTUFBSSxlQUFlLEdBQUc7QUFDcEIsVUFBTSxJQUFJLG9CQUFvQiwrQkFBK0I7QUFBQSxFQUMvRDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsaUJBQWlCLFVBQTBCO0FBQ3pELFFBQU0sVUFBVSxTQUFTLEtBQUssRUFBRSxZQUFZO0FBQzVDLE1BQUksQ0FBQyxTQUFTLEtBQUssT0FBTyxHQUFHO0FBQzNCLFVBQU0sSUFBSSxvQkFBb0Isc0NBQXNDO0FBQUEsRUFDdEU7QUFDQSxTQUFPO0FBQ1Q7QUFFTyxTQUFTLGdCQUFnQixTQUF5QjtBQUN2RCxRQUFNLFVBQVUsUUFBUSxLQUFLO0FBQzdCLE1BQUksQ0FBQyxVQUFVLEtBQUssT0FBTyxHQUFHO0FBQzVCLFVBQU0sSUFBSSxvQkFBb0IsNkJBQTZCO0FBQUEsRUFDN0Q7QUFDQSxRQUFNLElBQUksb0JBQUksS0FBSyxHQUFHLE9BQU8sWUFBWTtBQUN6QyxNQUFJLE9BQU8sTUFBTSxFQUFFLFFBQVEsQ0FBQyxLQUFLLEVBQUUsWUFBWSxFQUFFLE1BQU0sR0FBRyxFQUFFLE1BQU0sU0FBUztBQUN6RSxVQUFNLElBQUksb0JBQW9CLDhCQUE4QjtBQUFBLEVBQzlEO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxhQUFhLE1BQWdEO0FBQzNFLE1BQUksUUFBUSxLQUFNLFFBQU87QUFDekIsUUFBTSxVQUFVLEtBQUssS0FBSztBQUMxQixTQUFPLFFBQVEsV0FBVyxJQUFJLE9BQU87QUFDdkM7QUFFTyxTQUFTLG1CQUFtQixNQUFzQjtBQUN2RCxRQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLE1BQUksQ0FBQyxTQUFTO0FBQ1osVUFBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFBQSxFQUNqRDtBQUNBLE1BQUksUUFBUSxTQUFTLEtBQUs7QUFDeEIsVUFBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFBQSxFQUNqRDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsMEJBQTBCLGFBQTZCO0FBQ3JFLE1BQUksQ0FBQyxPQUFPLFNBQVMsV0FBVyxLQUFLLENBQUMsT0FBTyxVQUFVLFdBQVcsR0FBRztBQUNuRSxVQUFNLElBQUksbUJBQW1CLGlDQUFpQztBQUFBLEVBQ2hFO0FBQ0EsTUFBSSxlQUFlLEdBQUc7QUFDcEIsVUFBTSxJQUFJLG1CQUFtQiwrQkFBK0I7QUFBQSxFQUM5RDtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMscUJBQXFCLE1BQTRCO0FBQy9ELFFBQU0sVUFBVSxLQUFLLEtBQUssRUFBRSxZQUFZO0FBQ3hDLE1BQUksQ0FBQyxlQUFlLElBQUksT0FBdUIsR0FBRztBQUNoRCxVQUFNLElBQUksbUJBQW1CLDJDQUEyQztBQUFBLEVBQzFFO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxzQkFBc0IsT0FBdUI7QUFDM0QsTUFBSSxDQUFDLE9BQU8sU0FBUyxLQUFLLEtBQUssQ0FBQyxPQUFPLFVBQVUsS0FBSyxLQUFLLFFBQVEsR0FBRztBQUNwRSxVQUFNLElBQUksbUJBQW1CLHdDQUF3QztBQUFBLEVBQ3ZFO0FBQ0EsU0FBTztBQUNUO0FBRU8sU0FBUyxxQkFBcUIsU0FBeUI7QUFDNUQsTUFBSSxDQUFDLE9BQU8sU0FBUyxPQUFPLEtBQUssQ0FBQyxPQUFPLFVBQVUsT0FBTyxHQUFHO0FBQzNELFVBQU0sSUFBSSxtQkFBbUIsa0NBQWtDO0FBQUEsRUFDakU7QUFDQSxNQUFJLFVBQVUsS0FBSyxVQUFVLEtBQUs7QUFDaEMsVUFBTSxJQUFJLG1CQUFtQix5Q0FBeUM7QUFBQSxFQUN4RTtBQUNBLFNBQU87QUFDVDtBQUVPLFNBQVMsbUJBQW1CLFlBQTRCO0FBQzdELE1BQUk7QUFDRixXQUFPLGdCQUFnQixVQUFVO0FBQUEsRUFDbkMsUUFBUTtBQUNOLFVBQU0sSUFBSSxtQkFBbUIsZ0NBQWdDO0FBQUEsRUFDL0Q7QUFDRjs7O0FGakdBLFNBQVMsZ0JBQXdCO0FBQy9CLFFBQU0sU0FBUyxXQUFXLEVBQUUsSUFBSSxRQUFRO0FBQ3hDLE1BQUksT0FBTyxXQUFXLFVBQVU7QUFDOUIsVUFBTSxJQUFJLE1BQU0saUJBQWlCO0FBQUEsRUFDbkM7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTQyxVQUFTLE9BQWdDO0FBQ2hELE1BQUksT0FBTyxVQUFVLFNBQVUsUUFBTztBQUN0QyxRQUFNLElBQUksT0FBTyxLQUFLO0FBQ3RCLE1BQUksQ0FBQyxPQUFPLFNBQVMsQ0FBQyxHQUFHO0FBQ3ZCLFVBQU0sSUFBSSxvQkFBb0IsZ0JBQWdCO0FBQUEsRUFDaEQ7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFdBQW1CO0FBQzFCLFVBQU8sb0JBQUksS0FBSyxHQUFFLFlBQVksRUFBRSxNQUFNLEdBQUcsRUFBRTtBQUM3QztBQWlEQSxTQUFTLFlBQVksS0FRUjtBQUNYLFNBQU87QUFBQSxJQUNMLEdBQUc7QUFBQSxJQUNILGFBQWEscUJBQXFCLElBQUksV0FBVztBQUFBLElBQ2pELFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxJQUN6QyxZQUFZLGVBQWUsSUFBSSxVQUFVO0FBQUEsRUFDM0M7QUFDRjtBQUVBLFNBQVMsV0FBVyxLQVVSO0FBQ1YsU0FBTztBQUFBLElBQ0wsR0FBRztBQUFBLElBQ0gsY0FBY0EsVUFBUyxJQUFJLFlBQVk7QUFBQSxJQUN2QyxZQUFZLGVBQWUsSUFBSSxVQUFVO0FBQUEsSUFDekMsWUFBWSxlQUFlLElBQUksVUFBVTtBQUFBLEVBQzNDO0FBQ0Y7QUFFQSxTQUFTLFVBQVUsS0FjUjtBQUNULFNBQU87QUFBQSxJQUNMLEdBQUc7QUFBQSxJQUNILGNBQWNBLFVBQVMsSUFBSSxZQUFZO0FBQUEsSUFDdkMsYUFBYSxxQkFBcUIsSUFBSSxXQUFXO0FBQUEsSUFDakQsWUFBWSxlQUFlLElBQUksVUFBVTtBQUFBLElBQ3pDLFlBQVksZUFBZSxJQUFJLFVBQVU7QUFBQSxFQUMzQztBQUNGO0FBRUEsSUFBTSxtQkFBbUIsb0JBQUksSUFBSSxDQUFDLE9BQU8sV0FBVyxLQUFLLENBQUM7QUFFMUQsU0FBUyx1QkFBdUIsVUFBMEI7QUFDeEQsUUFBTSxhQUFhLFNBQVMsS0FBSyxFQUFFLFlBQVk7QUFDL0MsTUFBSSxDQUFDLGlCQUFpQixJQUFJLFVBQVUsR0FBRztBQUNyQyxVQUFNLElBQUksTUFBTSx1Q0FBdUM7QUFBQSxFQUN6RDtBQUNBLFNBQU87QUFDVDtBQUVBLFNBQVMsb0JBQW9CLE9BQXVCO0FBQ2xELFFBQU0sVUFBVSxNQUFNLEtBQUs7QUFDM0IsTUFBSSxRQUFRLFNBQVMsS0FBSyxRQUFRLFNBQVMsTUFBTTtBQUMvQyxVQUFNLElBQUksTUFBTSxzQkFBc0I7QUFBQSxFQUN4QztBQUNBLFNBQU87QUFDVDtBQUVBLGVBQWUsbUJBQW1CLFlBQW9CLFFBQWdCO0FBQ3BFLFNBQU8sTUFBTSxHQUNWLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxVQUFVLEVBQzNCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUN0QjtBQUVBLGVBQWUsaUJBQWlCLFVBQWtCLFFBQWdCO0FBQ2hFLFNBQU8sTUFBTSxHQUNWLFdBQVcsU0FBUyxFQUNwQixNQUFNLE1BQU0sS0FBSyxRQUFRLEVBQ3pCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUN0QjtBQUVPLElBQU0sUUFBUTtBQUFBLEVBQ25CLFlBQVksT0FBTyxTQUVRO0FBQ3pCLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFFBQUksUUFBUSxHQUNULFdBQVcsWUFBWSxFQUN2QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVEsUUFBUSxLQUFLLEVBQ3JCLFVBQVU7QUFFYixRQUFJLENBQUMsTUFBTSxpQkFBaUI7QUFDMUIsY0FBUSxNQUFNLE1BQU0sZUFBZSxNQUFNLElBQUk7QUFBQSxJQUMvQztBQUVBLFVBQU0sT0FBTyxNQUFNLE1BQU0sUUFBUTtBQUNqQyxXQUFPLEtBQUssSUFBSSxXQUFXO0FBQUEsRUFDN0I7QUFBQSxFQUVBLFVBQVUsT0FBTyxTQUFtRDtBQUNsRSxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsWUFBWSxFQUN2QixNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBQ3BCLFdBQU8sTUFBTSxZQUFZLEdBQUcsSUFBSTtBQUFBLEVBQ2xDO0FBQUEsRUFFQSxVQUFVLE9BQU8sU0FJUztBQUN4QixVQUFNLFNBQVMsY0FBYztBQUM3QixRQUFJLFFBQVEsR0FDVCxXQUFXLFVBQVUsRUFDckIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRLFlBQVksTUFBTSxFQUMxQixRQUFRLE1BQU0sTUFBTSxFQUNwQixVQUFVO0FBRWIsUUFBSSxNQUFNLFVBQVU7QUFDbEIsY0FBUSxNQUFNLE1BQU0sWUFBWSxNQUFNLGdCQUFnQixLQUFLLFFBQVEsQ0FBQztBQUFBLElBQ3RFO0FBQ0EsUUFBSSxNQUFNLFFBQVE7QUFDaEIsY0FBUSxNQUFNLE1BQU0sWUFBWSxNQUFNLGdCQUFnQixLQUFLLE1BQU0sQ0FBQztBQUFBLElBQ3BFO0FBQ0EsUUFBSSxNQUFNLGNBQWMsTUFBTTtBQUM1QixjQUFRLE1BQU0sTUFBTSxlQUFlLEtBQUssS0FBSyxVQUFVO0FBQUEsSUFDekQ7QUFFQSxVQUFNLE9BQU8sTUFBTSxNQUFNLFFBQVE7QUFDakMsV0FBTyxLQUFLLElBQUksVUFBVTtBQUFBLEVBQzVCO0FBQUEsRUFFQSxTQUFTLE9BQU8sU0FBa0Q7QUFDaEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLFVBQVUsRUFDckIsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsVUFBVSxFQUNWLGlCQUFpQjtBQUNwQixXQUFPLE1BQU0sV0FBVyxHQUFHLElBQUk7QUFBQSxFQUNqQztBQUFBLEVBRUEsZUFBZSxPQUFPLFNBR1M7QUFDN0IsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLGdCQUFnQixLQUFLLFFBQVE7QUFDOUMsVUFBTSxTQUFTLGdCQUFnQixLQUFLLE1BQU07QUFFMUMsVUFBTSxPQUFPLE1BQU0sR0FDaEIsV0FBVyxVQUFVLEVBQ3JCLFVBQVUsY0FBYyxpQkFBaUIsc0JBQXNCLEVBQy9ELE1BQU0sb0JBQW9CLEtBQUssTUFBTSxFQUNyQyxNQUFNLHFCQUFxQixNQUFNLFFBQVEsRUFDekMsTUFBTSxxQkFBcUIsTUFBTSxNQUFNLEVBQ3ZDLE9BQU87QUFBQSxNQUNOO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQUMsaUNBQXdDLEdBQUcsYUFBYTtBQUFBLElBQzFELENBQUMsRUFDQSxRQUFRO0FBQUEsTUFDUDtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLElBQ0YsQ0FBQyxFQUNBLFFBQVEsZUFBZSxNQUFNLEVBQzdCLFFBQVE7QUFFWCxXQUFPLEtBQUssSUFBSSxDQUFDLFNBQXVCO0FBQUEsTUFDdEMsYUFBYSxJQUFJO0FBQUEsTUFDakIsZUFBZSxJQUFJO0FBQUEsTUFDbkIsZ0JBQWdCLElBQUk7QUFBQSxNQUNwQixVQUFVLElBQUk7QUFBQSxNQUNkLGFBQWFELFVBQVMsSUFBSSxXQUFXO0FBQUEsSUFDdkMsRUFBRTtBQUFBLEVBQ0o7QUFBQSxFQUVBLFNBQVMsT0FBTyxTQUVTO0FBQ3ZCLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFFBQUksUUFBUSxHQUNULFdBQVcsU0FBUyxFQUNwQixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLFFBQVEsUUFBUSxLQUFLLEVBQ3JCLFVBQVU7QUFFYixRQUFJLENBQUMsTUFBTSxpQkFBaUI7QUFDMUIsY0FBUSxNQUFNLE1BQU0sZUFBZSxNQUFNLElBQUk7QUFBQSxJQUMvQztBQUVBLFVBQU0sT0FBTyxNQUFNLE1BQU0sUUFBUTtBQUNqQyxXQUFPLEtBQUssSUFBSSxTQUFTO0FBQUEsRUFDM0I7QUFBQSxFQUVBLFFBQVEsT0FBTyxTQUFpRDtBQUM5RCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE1BQU0sTUFBTSxpQkFBaUIsS0FBSyxJQUFJLE1BQU07QUFDbEQsV0FBTyxNQUFNLFVBQVUsR0FBRyxJQUFJO0FBQUEsRUFDaEM7QUFBQSxFQUVBLGdCQUFnQixPQUFPLFNBQTZCO0FBQ2xELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sT0FBTyxNQUFNLFFBQVEsT0FBTyxnQkFBZ0IsS0FBSyxJQUFJLElBQUksU0FBUztBQUN4RSxXQUFPLE1BQU0sc0JBQXNCLFFBQVEsSUFBSTtBQUFBLEVBQ2pEO0FBQ0Y7QUFFTyxJQUFNLFdBQVc7QUFBQSxFQUN0QixnQkFBZ0IsT0FBTyxTQUF5QztBQUM5RCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLE9BQU8scUJBQXFCLEtBQUssTUFBTSxJQUFJO0FBQ2pELFVBQU0sUUFBUSxzQkFBc0IsS0FBSyxNQUFNLEtBQUs7QUFDcEQsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFFBQUk7QUFDRixZQUFNLE1BQU0sTUFBTSxHQUNmLFdBQVcsWUFBWSxFQUN2QixPQUFPO0FBQUEsUUFDTixTQUFTO0FBQUEsUUFDVDtBQUFBLFFBQ0E7QUFBQSxRQUNBLGFBQWE7QUFBQSxRQUNiLFlBQVk7QUFBQSxRQUNaLFlBQVk7QUFBQSxNQUNkLENBQWdCLEVBQ2YsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixhQUFPLFlBQVksR0FBRztBQUFBLElBQ3hCLFNBQVMsS0FBSztBQUNaLFlBQU0sVUFBVSxlQUFlLFFBQVEsSUFBSSxVQUFVO0FBQ3JELFVBQUksUUFBUSxTQUFTLDZDQUE2QyxHQUFHO0FBQ25FLGNBQU0sSUFBSSxxQkFBcUIsMENBQTBDO0FBQUEsTUFDM0U7QUFDQSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLGdCQUFnQixPQUFPLFNBQXFEO0FBQzFFLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sV0FBVyxNQUFNLG1CQUFtQixLQUFLLElBQUksTUFBTTtBQUN6RCxRQUFJLENBQUMsVUFBVTtBQUNiLFlBQU0sSUFBSSxxQkFBcUIsb0JBQW9CO0FBQUEsSUFDckQ7QUFDQSxRQUFJLFNBQVMsZUFBZSxNQUFNO0FBQ2hDLFlBQU0sSUFBSSxxQkFBcUIsb0NBQW9DO0FBQUEsSUFDckU7QUFFQSxVQUFNLE9BQU8sS0FBSyxNQUFNLFNBQVMsU0FDN0IscUJBQXFCLEtBQUssTUFBTSxJQUFJLElBQ3BDLFNBQVM7QUFDYixVQUFNLFFBQVEsS0FBSyxNQUFNLFVBQVUsU0FDL0Isc0JBQXNCLEtBQUssTUFBTSxLQUFLLElBQ3RDLFNBQVM7QUFFYixRQUFJO0FBQ0YsWUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLFlBQVksRUFDeEIsSUFBSTtBQUFBLFFBQ0g7QUFBQSxRQUNBO0FBQUEsUUFDQSxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsTUFDckMsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFDM0IsYUFBTyxZQUFZLEdBQUc7QUFBQSxJQUN4QixTQUFTLEtBQUs7QUFDWixZQUFNLFVBQVUsZUFBZSxRQUFRLElBQUksVUFBVTtBQUNyRCxVQUFJLFFBQVEsU0FBUyw2Q0FBNkMsR0FBRztBQUNuRSxjQUFNLElBQUkscUJBQXFCLDBDQUEwQztBQUFBLE1BQzNFO0FBQ0EsWUFBTTtBQUFBLElBQ1I7QUFBQSxFQUNGO0FBQUEsRUFFQSxpQkFBaUIsT0FBTyxTQUF5QjtBQUMvQyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxtQkFBbUIsS0FBSyxJQUFJLE1BQU07QUFDekQsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUkscUJBQXFCLG9CQUFvQjtBQUFBLElBQ3JEO0FBQ0EsUUFBSSxTQUFTLGVBQWUsTUFBTTtBQUNoQyxhQUFPLFlBQVksUUFBUTtBQUFBLElBQzdCO0FBRUEsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLFlBQVksRUFDeEIsSUFBSTtBQUFBLE1BQ0gsY0FBYSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ3BDLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUMzQixXQUFPLFlBQVksR0FBRztBQUFBLEVBQ3hCO0FBQUEsRUFFQSxlQUFlLE9BQU8sU0FBd0M7QUFDNUQsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0sbUJBQW1CLEtBQUssTUFBTSxZQUFZLE1BQU07QUFDdkUsUUFBSSxDQUFDLFlBQVksU0FBUyxlQUFlLE1BQU07QUFDN0MsWUFBTSxJQUFJLG9CQUFvQixvQkFBb0I7QUFBQSxJQUNwRDtBQUVBLFVBQU0sY0FBYyxvQkFBb0IsS0FBSyxNQUFNLFdBQVc7QUFDOUQsVUFBTSxVQUFVLGdCQUFnQixLQUFLLE1BQU0sT0FBTztBQUNsRCxVQUFNLFdBQVcsaUJBQWlCLEtBQUssTUFBTSxZQUFZLEtBQUs7QUFDOUQsVUFBTSxPQUFPLGFBQWEsS0FBSyxNQUFNLElBQUk7QUFDekMsVUFBTSxPQUFNLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBRW5DLFVBQU0sTUFBTSxNQUFNLEdBQ2YsV0FBVyxVQUFVLEVBQ3JCLE9BQU87QUFBQSxNQUNOLFNBQVM7QUFBQSxNQUNULGFBQWEsU0FBUztBQUFBLE1BQ3RCLGNBQWM7QUFBQSxNQUNkO0FBQUEsTUFDQSxVQUFVO0FBQUEsTUFDVjtBQUFBLE1BQ0EsWUFBWTtBQUFBLE1BQ1osWUFBWTtBQUFBLElBQ2QsQ0FBZSxFQUNkLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsVUFBTSwyQkFBMkIsUUFBUSxTQUFTLENBQUM7QUFDbkQsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsZUFBZSxPQUFPLFNBQW9EO0FBQ3hFLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sV0FBVyxNQUFNLEdBQ3BCLFdBQVcsVUFBVSxFQUNyQixNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLFFBQUksQ0FBQyxVQUFVO0FBQ2IsWUFBTSxJQUFJLG9CQUFvQixtQkFBbUI7QUFBQSxJQUNuRDtBQUVBLFFBQUksYUFBYSxTQUFTO0FBQzFCLFFBQUksS0FBSyxNQUFNLGVBQWUsUUFBVztBQUN2QyxZQUFNLFdBQVcsTUFBTSxtQkFBbUIsS0FBSyxNQUFNLFlBQVksTUFBTTtBQUN2RSxVQUFJLENBQUMsWUFBWSxTQUFTLGVBQWUsTUFBTTtBQUM3QyxjQUFNLElBQUksb0JBQW9CLG9CQUFvQjtBQUFBLE1BQ3BEO0FBQ0EsbUJBQWEsU0FBUztBQUFBLElBQ3hCO0FBRUEsVUFBTSxjQUFjLEtBQUssTUFBTSxnQkFBZ0IsU0FDM0Msb0JBQW9CLEtBQUssTUFBTSxXQUFXLElBQzFDQSxVQUFTLFNBQVMsWUFBWTtBQUNsQyxVQUFNLFVBQVUsS0FBSyxNQUFNLFlBQVksU0FDbkMsZ0JBQWdCLEtBQUssTUFBTSxPQUFPLElBQ2xDLFNBQVM7QUFDYixVQUFNLFdBQVcsS0FBSyxNQUFNLGFBQWEsU0FDckMsaUJBQWlCLEtBQUssTUFBTSxRQUFRLElBQ3BDLFNBQVM7QUFDYixVQUFNLE9BQU8sS0FBSyxNQUFNLFNBQVMsU0FDN0IsYUFBYSxLQUFLLE1BQU0sSUFBSSxJQUM1QixTQUFTO0FBRWIsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLFVBQVUsRUFDdEIsSUFBSTtBQUFBLE1BQ0gsYUFBYTtBQUFBLE1BQ2IsY0FBYztBQUFBLE1BQ2Q7QUFBQSxNQUNBLFVBQVU7QUFBQSxNQUNWO0FBQUEsTUFDQSxhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsSUFDckMsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLEtBQUssRUFBRSxFQUN4QixNQUFNLFdBQVcsS0FBSyxNQUFNLEVBQzVCLGFBQWEsRUFDYix3QkFBd0I7QUFFM0IsVUFBTSwyQkFBMkIsUUFBUSxTQUFTLENBQUM7QUFDbkQsV0FBTyxXQUFXLEdBQUc7QUFBQSxFQUN2QjtBQUFBLEVBRUEsZUFBZSxPQUFPLFNBQXlCO0FBQzdDLFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sU0FBUyxNQUFNLEdBQ2xCLFdBQVcsVUFBVSxFQUNyQixNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixRQUFRO0FBRVgsV0FBTyxPQUFPLFNBQVMsS0FBSyxPQUFPLE9BQU8sQ0FBQyxHQUFHLGtCQUFrQixDQUFDLElBQUk7QUFBQSxFQUN2RTtBQUFBLEVBRUEsY0FBYyxPQUFPLFNBQXVDO0FBQzFELFVBQU0sU0FBUyxjQUFjO0FBQzdCLFVBQU0sT0FBTyxtQkFBbUIsS0FBSyxNQUFNLElBQUk7QUFDL0MsVUFBTSxjQUFjLDBCQUEwQixLQUFLLE1BQU0sV0FBVztBQUNwRSxVQUFNLGVBQWUscUJBQXFCLEtBQUssTUFBTSxZQUFZO0FBQ2pFLFVBQU0sZ0JBQWdCLHNCQUFzQixLQUFLLE1BQU0sYUFBYTtBQUNwRSxVQUFNLGFBQWEsbUJBQW1CLEtBQUssTUFBTSxVQUFVO0FBQzNELFVBQU0sZUFBZSxxQkFBcUIsS0FBSyxNQUFNLFlBQVk7QUFDakUsVUFBTSxXQUFXLGlCQUFpQixLQUFLLE1BQU0sWUFBWSxLQUFLO0FBRTlELFFBQUksYUFBNEI7QUFDaEMsUUFBSSxLQUFLLE1BQU0sY0FBYyxNQUFNO0FBQ2pDLFlBQU0sV0FBVyxNQUFNLG1CQUFtQixLQUFLLE1BQU0sWUFBWSxNQUFNO0FBQ3ZFLFVBQUksQ0FBQyxZQUFZLFNBQVMsZUFBZSxNQUFNO0FBQzdDLGNBQU0sSUFBSSxtQkFBbUIsb0JBQW9CO0FBQUEsTUFDbkQ7QUFDQSxtQkFBYSxTQUFTO0FBQUEsSUFDeEI7QUFFQSxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFDbkMsVUFBTSxNQUFNLE1BQU0sR0FDZixXQUFXLFNBQVMsRUFDcEIsT0FBTztBQUFBLE1BQ04sU0FBUztBQUFBLE1BQ1Q7QUFBQSxNQUNBLGFBQWE7QUFBQSxNQUNiLGNBQWM7QUFBQSxNQUNkO0FBQUEsTUFDQSxlQUFlO0FBQUEsTUFDZixnQkFBZ0I7QUFBQSxNQUNoQixhQUFhO0FBQUEsTUFDYixlQUFlO0FBQUEsTUFDZixhQUFhO0FBQUEsTUFDYixZQUFZO0FBQUEsTUFDWixZQUFZO0FBQUEsSUFDZCxDQUFjLEVBQ2IsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixVQUFNLDJCQUEyQixRQUFRLFNBQVMsQ0FBQztBQUNuRCxXQUFPLFVBQVUsR0FBRztBQUFBLEVBQ3RCO0FBQUEsRUFFQSxjQUFjLE9BQU8sU0FBbUQ7QUFDdEUsVUFBTSxTQUFTLGNBQWM7QUFDN0IsVUFBTSxXQUFXLE1BQU0saUJBQWlCLEtBQUssSUFBSSxNQUFNO0FBQ3ZELFFBQUksQ0FBQyxVQUFVO0FBQ2IsWUFBTSxJQUFJLG1CQUFtQixrQkFBa0I7QUFBQSxJQUNqRDtBQUNBLFFBQUksU0FBUyxlQUFlLE1BQU07QUFDaEMsWUFBTSxJQUFJLG1CQUFtQixrQ0FBa0M7QUFBQSxJQUNqRTtBQUVBLFVBQU0sT0FBTyxLQUFLLE1BQU0sU0FBUyxTQUM3QixtQkFBbUIsS0FBSyxNQUFNLElBQUksSUFDbEMsU0FBUztBQUNiLFVBQU0sY0FBYyxLQUFLLE1BQU0sZ0JBQWdCLFNBQzNDLDBCQUEwQixLQUFLLE1BQU0sV0FBVyxJQUNoREEsVUFBUyxTQUFTLFlBQVk7QUFDbEMsVUFBTSxlQUFlLEtBQUssTUFBTSxpQkFBaUIsU0FDN0MscUJBQXFCLEtBQUssTUFBTSxZQUFZLElBQzVDLHFCQUFxQixTQUFTLGFBQWE7QUFDL0MsVUFBTSxnQkFBZ0IsS0FBSyxNQUFNLGtCQUFrQixTQUMvQyxzQkFBc0IsS0FBSyxNQUFNLGFBQWEsSUFDOUMsU0FBUztBQUNiLFVBQU0sYUFBYSxLQUFLLE1BQU0sZUFBZSxTQUN6QyxtQkFBbUIsS0FBSyxNQUFNLFVBQVUsSUFDeEMsU0FBUztBQUNiLFVBQU0sZUFBZSxLQUFLLE1BQU0saUJBQWlCLFNBQzdDLHFCQUFxQixLQUFLLE1BQU0sWUFBWSxJQUM1QyxTQUFTO0FBQ2IsVUFBTSxXQUFXLEtBQUssTUFBTSxhQUFhLFNBQ3JDLGlCQUFpQixLQUFLLE1BQU0sUUFBUSxJQUNwQyxTQUFTO0FBRWIsUUFBSSxhQUFhLFNBQVM7QUFDMUIsUUFBSSxLQUFLLE1BQU0sZUFBZSxRQUFXO0FBQ3ZDLFVBQUksS0FBSyxNQUFNLGNBQWMsTUFBTTtBQUNqQyxxQkFBYTtBQUFBLE1BQ2YsT0FBTztBQUNMLGNBQU0sV0FBVyxNQUFNLG1CQUFtQixLQUFLLE1BQU0sWUFBWSxNQUFNO0FBQ3ZFLFlBQUksQ0FBQyxZQUFZLFNBQVMsZUFBZSxNQUFNO0FBQzdDLGdCQUFNLElBQUksbUJBQW1CLG9CQUFvQjtBQUFBLFFBQ25EO0FBQ0EscUJBQWEsU0FBUztBQUFBLE1BQ3hCO0FBQUEsSUFDRjtBQUVBLFVBQU0sTUFBTSxNQUFNLEdBQ2YsWUFBWSxTQUFTLEVBQ3JCLElBQUk7QUFBQSxNQUNIO0FBQUEsTUFDQSxhQUFhO0FBQUEsTUFDYixjQUFjO0FBQUEsTUFDZDtBQUFBLE1BQ0EsZUFBZTtBQUFBLE1BQ2YsZ0JBQWdCO0FBQUEsTUFDaEIsYUFBYTtBQUFBLE1BQ2IsZUFBZTtBQUFBLE1BQ2YsYUFBWSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLElBQ3JDLENBQUMsRUFDQSxNQUFNLE1BQU0sS0FBSyxLQUFLLEVBQUUsRUFDeEIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixhQUFhLEVBQ2Isd0JBQXdCO0FBRTNCLFVBQU0sMkJBQTJCLFFBQVEsU0FBUyxDQUFDO0FBQ25ELFdBQU8sVUFBVSxHQUFHO0FBQUEsRUFDdEI7QUFBQSxFQUVBLGVBQWUsT0FBTyxTQUF5QjtBQUM3QyxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFdBQVcsTUFBTSxpQkFBaUIsS0FBSyxJQUFJLE1BQU07QUFDdkQsUUFBSSxDQUFDLFVBQVU7QUFDYixZQUFNLElBQUksbUJBQW1CLGtCQUFrQjtBQUFBLElBQ2pEO0FBQ0EsUUFBSSxTQUFTLGVBQWUsTUFBTTtBQUNoQyxhQUFPLFVBQVUsUUFBUTtBQUFBLElBQzNCO0FBRUEsVUFBTSxNQUFNLE1BQU0sR0FDZixZQUFZLFNBQVMsRUFDckIsSUFBSTtBQUFBLE1BQ0gsY0FBYSxvQkFBSSxLQUFLLEdBQUUsWUFBWTtBQUFBLE1BQ3BDLGFBQVksb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFBQSxJQUNyQyxDQUFDLEVBQ0EsTUFBTSxNQUFNLEtBQUssS0FBSyxFQUFFLEVBQ3hCLE1BQU0sV0FBVyxLQUFLLE1BQU0sRUFDNUIsYUFBYSxFQUNiLHdCQUF3QjtBQUUzQixXQUFPLFVBQVUsR0FBRztBQUFBLEVBQ3RCO0FBQUEsRUFFQSxxQkFBcUIsT0FBTyxTQUE4QztBQUN4RSxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFFBQVEsb0JBQW9CLEtBQUssS0FBSztBQUM1QyxVQUFNLFdBQVcsdUJBQXVCLEtBQUssUUFBUTtBQUNyRCxVQUFNLE9BQU0sb0JBQUksS0FBSyxHQUFFLFlBQVk7QUFFbkMsVUFBTSxHQUNILFdBQVcsZUFBZSxFQUMxQixPQUFPO0FBQUEsTUFDTixTQUFTO0FBQUEsTUFDVDtBQUFBLE1BQ0E7QUFBQSxNQUNBLFlBQVk7QUFBQSxJQUNkLENBQW1CLEVBQ2xCO0FBQUEsTUFBVyxDQUFDLE9BQ1gsR0FBRyxPQUFPLE9BQU8sRUFBRSxZQUFZO0FBQUEsUUFDN0IsU0FBUztBQUFBLFFBQ1Q7QUFBQSxRQUNBLFlBQVk7QUFBQSxNQUNkLENBQUM7QUFBQSxJQUNILEVBQ0MsUUFBUTtBQUVYLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSx1QkFBdUIsT0FBTyxTQUE0QjtBQUN4RCxVQUFNLFNBQVMsY0FBYztBQUM3QixVQUFNLFFBQVEsb0JBQW9CLEtBQUssS0FBSztBQUM1QyxVQUFNLFNBQVMsTUFBTSxHQUNsQixXQUFXLGVBQWUsRUFDMUIsTUFBTSxXQUFXLEtBQUssTUFBTSxFQUM1QixNQUFNLFNBQVMsS0FBSyxLQUFLLEVBQ3pCLFFBQVE7QUFFWCxXQUFPLE9BQU8sU0FBUyxLQUFLLE9BQU8sT0FBTyxDQUFDLEdBQUcsa0JBQWtCLENBQUMsSUFBSTtBQUFBLEVBQ3ZFO0FBQ0Y7QUFFTyxJQUFNLFlBQVk7QUFBQSxFQUN2QjtBQUFBLEVBQ0E7QUFDRjs7O0FHbHNCQSxTQUFTLG9CQUFvQixpQkFBaUI7QUFHOUMsSUFBTSxrQkFDSCxPQUFPLFlBQVksZUFBZSxRQUFRLEtBQUssbUJBQ2hEO0FBQ0YsSUFBTSxXQUFXLEdBQUcsZUFBZTtBQUVuQyxJQUFNLE9BQU8sbUJBQW1CLElBQUksSUFBSSxRQUFRLENBQUM7QUFPakQsZUFBc0Isa0JBQ3BCLHFCQUM4QjtBQUM5QixNQUFJLENBQUMscUJBQXFCLFdBQVcsU0FBUyxHQUFHO0FBQy9DLFdBQU87QUFBQSxFQUNUO0FBRUEsUUFBTSxRQUFRLG9CQUFvQixNQUFNLFVBQVUsTUFBTSxFQUFFLEtBQUs7QUFDL0QsTUFBSSxDQUFDLE9BQU87QUFDVixXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUk7QUFDRixVQUFNLEVBQUUsUUFBUSxJQUFJLE1BQU0sVUFBVSxPQUFPLE1BQU07QUFBQSxNQUMvQyxZQUFZLENBQUMsT0FBTztBQUFBLElBQ3RCLENBQUM7QUFFRCxVQUFNLGFBQWEsT0FBTyxRQUFRLFFBQVEsV0FBVyxRQUFRLE1BQU07QUFDbkUsUUFBSSxDQUFDLFlBQVk7QUFDZixhQUFPO0FBQUEsSUFDVDtBQUVBLFVBQU0sUUFDSixPQUFPLFFBQVEsVUFBVSxXQUFXLFFBQVEsUUFBUTtBQUV0RCxXQUFPLEVBQUUsWUFBWSxNQUFNO0FBQUEsRUFDN0IsUUFBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFFTyxTQUFTLHVCQUFpQztBQUMvQyxTQUFPLElBQUksU0FBUyxLQUFLLFVBQVUsRUFBRSxPQUFPLGVBQWUsQ0FBQyxHQUFHO0FBQUEsSUFDN0QsUUFBUTtBQUFBLElBQ1IsU0FBUztBQUFBLE1BQ1AsZ0JBQWdCO0FBQUEsTUFDaEIsK0JBQStCO0FBQUEsTUFDL0IsZ0NBQ0U7QUFBQSxNQUNGLGdDQUFnQztBQUFBLElBQ2xDO0FBQUEsRUFDRixDQUFDO0FBQ0g7QUFHQSxlQUFzQixlQUFlLEtBQWMsTUFBMkI7QUFDNUUsTUFBSSxJQUFJLElBQUksV0FBVyxXQUFXO0FBQ2hDLFdBQU8sSUFBSSxTQUFTLE1BQU07QUFBQSxNQUN4QixRQUFRO0FBQUEsTUFDUixTQUFTO0FBQUEsUUFDUCwrQkFBK0I7QUFBQSxRQUMvQixnQ0FDRTtBQUFBLFFBQ0YsZ0NBQWdDO0FBQUEsTUFDbEM7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBRUEsUUFBTSxLQUFLO0FBRVgsTUFBSSxJQUFJLFFBQVEsSUFBSSwrQkFBK0IsR0FBRztBQUN0RCxNQUFJLElBQUksUUFBUTtBQUFBLElBQ2Q7QUFBQSxJQUNBO0FBQUEsRUFDRjtBQUNBLE1BQUksSUFBSSxRQUFRO0FBQUEsSUFDZDtBQUFBLElBQ0E7QUFBQSxFQUNGO0FBQ0Y7OztBQzVFQSxlQUFzQixpQkFDcEIsS0FDQSxNQUNBO0FBQ0EsUUFBTSxPQUFPLElBQUksSUFBSSxJQUFJLElBQUksR0FBRyxFQUFFO0FBQ2xDLE1BQUksU0FBUyxhQUFhLElBQUksSUFBSSxXQUFXLE9BQU87QUFDbEQsV0FBTyxJQUFJLFNBQVMsS0FBSyxVQUFVLEVBQUUsSUFBSSxLQUFLLENBQUMsR0FBRztBQUFBLE1BQ2hELFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNQLGdCQUFnQjtBQUFBLFFBQ2hCLCtCQUErQjtBQUFBLE1BQ2pDO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUNBLFFBQU0sS0FBSztBQUNiO0FBaUJPLFNBQVMsNEJBQ2RFLG1CQUNBO0FBQ0EsU0FBTyxlQUFlLHNCQUNwQixLQUNBLE1BQ0E7QUFDQSxRQUFJLElBQUksSUFBSSxXQUFXLFdBQVc7QUFDaEMsWUFBTSxLQUFLO0FBQ1g7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLElBQUksSUFBSSxJQUFJLElBQUksR0FBRyxFQUFFO0FBRWxDLFFBQ0UsU0FBUyxhQUNSLFNBQVMsY0FBYyxDQUFDLEtBQUssU0FBUyxVQUFVLEdBQ2pEO0FBQ0EsWUFBTSxLQUFLO0FBQ1g7QUFBQSxJQUNGO0FBRUEsVUFBTSxXQUFXLE1BQU0sa0JBQWtCLElBQUksSUFBSSxPQUFPLGVBQWUsQ0FBQztBQUN4RSxRQUFJLENBQUMsVUFBVTtBQUNiLGFBQU8scUJBQXFCO0FBQUEsSUFDOUI7QUFFQSxVQUFNLFlBQVksTUFBTUEsa0JBQWlCLFFBQVE7QUFFakQsUUFBSSxJQUFJLGNBQWMsU0FBUyxVQUFVO0FBQ3pDLFFBQUksU0FBUyxPQUFPO0FBQ2xCLFVBQUksSUFBSSxhQUFhLFNBQVMsS0FBSztBQUFBLElBQ3JDO0FBQ0EsUUFBSSxJQUFJLFVBQVUsVUFBVSxFQUFFO0FBRTlCLFVBQU0sS0FBSztBQUFBLEVBQ2I7QUFDRjs7O0FDakRBLGVBQXNCLGlCQUNwQkMsS0FDQSxVQUNrQztBQUNsQyxRQUFNLFdBQVcsTUFBTUEsSUFDcEIsV0FBVyxPQUFPLEVBQ2xCLE1BQU0sZ0JBQWdCLEtBQUssU0FBUyxVQUFVLEVBQzlDLFVBQVUsRUFDVixpQkFBaUI7QUFFcEIsTUFBSSxVQUFVO0FBQ1osV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFFBQ0osU0FBUyxPQUFPLEtBQUssS0FDckIsR0FBRyxTQUFTLFVBQVU7QUFDeEIsUUFBTSxPQUNKLFNBQVMsTUFBTSxLQUFLLEtBQ3BCLE1BQU0sTUFBTSxHQUFHLEVBQUUsQ0FBQyxLQUNsQjtBQUdGLFFBQU0sVUFBVSxNQUFNQSxJQUNuQixXQUFXLE9BQU8sRUFDbEIsTUFBTSxTQUFTLEtBQUssS0FBSyxFQUN6QixVQUFVLEVBQ1YsaUJBQWlCO0FBRXBCLE1BQUksU0FBUztBQUNYLFdBQU8sTUFBTUEsSUFDVixZQUFZLE9BQU8sRUFDbkIsSUFBSTtBQUFBLE1BQ0gsY0FBYyxTQUFTO0FBQUEsTUFDdkIsTUFBTSxRQUFRLFFBQVE7QUFBQSxNQUN0QixhQUFZLG9CQUFJLEtBQUssR0FBRSxZQUFZO0FBQUEsSUFDckMsQ0FBQyxFQUNBLE1BQU0sTUFBTSxLQUFLLFFBQVEsRUFBRSxFQUMzQixhQUFhLEVBQ2Isd0JBQXdCO0FBQUEsRUFDN0I7QUFFQSxTQUFPLE1BQU1BLElBQ1YsV0FBVyxPQUFPLEVBQ2xCLE9BQU87QUFBQSxJQUNOO0FBQUEsSUFDQTtBQUFBLElBQ0EsY0FBYyxTQUFTO0FBQUEsSUFDdkIsZUFBZTtBQUFBLEVBQ2pCLENBQUMsRUFDQSxhQUFhLEVBQ2Isd0JBQXdCO0FBQzdCOzs7QUN0RUEsZUFBc0JDLGtCQUFpQixVQUF1QztBQUM1RSxTQUFPLGlCQUFvQixJQUFJLFFBQVE7QUFDekM7OztBakJZTSxTQUFRLFdBQVcsOEJBQTZCO0FBYnRELElBQU1DLGNBQWEsTUFBTSx3QkFBd0I7QUFDakQsY0FBY0EsV0FBVTtBQUV4QixJQUFJLElBQUksY0FBYztBQUN0QixJQUFJLElBQUksZ0JBQWdCO0FBQ3hCLElBQUksSUFBSSw0QkFBNEJDLGlCQUFnQixDQUFDO0FBRTlDLElBQU0sVUFBVTtBQUFBLEVBQ3JCLEdBQUc7QUFDTDtBQUVBLElBQU8sY0FBUTtBQUlULElBQUksd0JBQXdCO0FBRTVCLElBQUk7QUFDRiwwQkFBd0I7QUFDMUIsUUFBUTtBQUVSO0FBRUEsSUFBSSxJQUFJLHVCQUF1QjtBQUFBLEVBQzdCLFVBQVU7QUFBQSxFQUNWO0FBQUEsRUFDQSxXQUFXLENBQUM7QUFBQSxFQUNaLFFBQVE7QUFDVixDQUFDLENBQUM7IiwKICAibmFtZXMiOiBbInNxbCIsICJhc051bWJlciIsICJzcWwiLCAicmVzb2x2ZUxvY2FsVXNlciIsICJkYiIsICJyZXNvbHZlTG9jYWxVc2VyIiwgInB1c2hTZW5kZXIiLCAicmVzb2x2ZUxvY2FsVXNlciJdCn0K
