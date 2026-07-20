// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";
import { sql } from "kysely";

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
      connectionString: connectionStringWithoutSslParams(databaseUrl),
      max: 10,
      ...ssl === void 0 ? {} : { ssl }
    };
  }
  return {
    database: env("PGDATABASE") ?? "spendmanager",
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
var HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
var CURRENCY = /^[A-Z]{3}$/;
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
function mapExpense(row) {
  return {
    ...row,
    amount_cents: asNumber(row.amount_cents)
  };
}
async function fetchOwnedCategory(categoryId, userId) {
  return await db.selectFrom("categories").where("id", "=", categoryId).where("user_id", "=", userId).selectAll().executeTakeFirst();
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
  }
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
app.use(async (ctx, next) => {
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
  typeDefs: "input ArgsInput {\n	includeArchived: Boolean\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	fromDate: String\n	toDate: String\n	categoryId: Number\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	fromDate: String!\n	toDate: String!\n}\ninput ArgsInput_5 {\n	input: CreateCategoryInputInput!\n}\ninput CreateCategoryInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_6 {\n	id: Number!\n	input: UpdateCategoryInputInput!\n}\ninput UpdateCategoryInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ninput ArgsInput_8 {\n	input: CreateExpenseInputInput!\n}\ninput CreateExpenseInputInput {\n	categoryId: Number!\n	amountCents: Number!\n	spentOn: String!\n	currency: String\n	note: String\n}\ninput ArgsInput_9 {\n	id: Number!\n	input: UpdateExpenseInputInput!\n}\ninput UpdateExpenseInputInput {\n	categoryId: Number\n	amountCents: Number\n	spentOn: String\n	currency: String\n	note: String\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ntype Query {\ncategories(args: ArgsInput): [Categories!]!\ncategory(args: ArgsInput_1!): Categories\nexpenses(args: ArgsInput_2): [Expenses!]!\nexpense(args: ArgsInput_3!): Expenses\nexpenseTotals(args: ArgsInput_4!): [ExpenseTotals!]!\n}\ntype Categories {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\narchived_at: Date\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Expenses {\namount_cents: Number!\nid: Number!\nuser_id: Number!\ncategory_id: Number!\ncurrency: String!\nspent_on: String!\nnote: String\ncreated_at: String!\nupdated_at: String!\n}\ntype ExpenseTotals {\ncategory_id: Number!\ncategory_name: String!\ncategory_color: String!\ncurrency: String!\ntotal_cents: Number!\n}\ntype Mutation {\ncreateCategory(args: ArgsInput_5!): CreateCategory!\nupdateCategory(args: ArgsInput_6!): CreateCategory!\narchiveCategory(args: ArgsInput_7!): Categories!\ncreateExpense(args: ArgsInput_8!): Expenses!\nupdateExpense(args: ArgsInput_9!): Expenses!\ndeleteExpense(args: ArgsInput_10!): Boolean!\n}\ntype CreateCategory {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\narchived_at: Date\ncreated_at: Date!\nupdated_at: Date!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2RiL3NzbC50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9hdXRoL3ZlcmlmeS50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGFwcCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7XG4gIGNvcnNNaWRkbGV3YXJlLFxuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG59IGZyb20gJy4vYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcblxuYXBwLnVzZShhc3luYyAoY3R4LCBuZXh0KSA9PiB7XG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCA9PT0gJy9oZWFsdGgnICYmIGN0eC5yZXEubWV0aG9kID09PSAnR0VUJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBvazogdHJ1ZSB9KSwge1xuICAgICAgc3RhdHVzOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgYXdhaXQgbmV4dCgpXG59KVxuXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuXG4gIGlmIChwYXRoID09PSAnL2hlYWx0aCcgfHwgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpKSB7XG4gICAgYXdhaXQgbmV4dCgpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJykpXG4gIGlmICghdmVyaWZpZWQpIHtcbiAgICByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuICB9XG5cbiAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih7XG4gICAgYXV0aFVzZXJJZDogdmVyaWZpZWQuYXV0aFVzZXJJZCxcbiAgICBlbWFpbDogdmVyaWZpZWQuZW1haWwsXG4gIH0pXG5cbiAgY3R4LnNldCgnYXV0aFVzZXJJZCcsIHZlcmlmaWVkLmF1dGhVc2VySWQpXG4gIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgIGN0eC5zZXQoJ2F1dGhFbWFpbCcsIHZlcmlmaWVkLmVtYWlsKVxuICB9XG4gIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICBhd2FpdCBuZXh0KClcbn0pXG5cbmV4cG9ydCBjb25zdCBncmFwaHFsID0ge1xuICAuLi5yZXNvbHZlcnMsXG59XG5cbmV4cG9ydCBkZWZhdWx0IGFwcFxuXG4gICAgICBpbXBvcnQge2hhbmRsZXIgYXMgX19pbnRlcm5hbFB5bG9uSGFuZGxlcn0gZnJvbSBcIkBnZXRjcm9uaXQvcHlsb25cIlxuXG4gICAgICBsZXQgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gdW5kZWZpbmVkXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IGNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGNvbmZpZyBpcyBub3QgZGVjbGFyZWQsIHB5bG9uQ29uZmlnIHJlbWFpbnMgdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGFwcC51c2UoX19pbnRlcm5hbFB5bG9uSGFuZGxlcih7XG4gICAgICAgIHR5cGVEZWZzOiBcImlucHV0IEFyZ3NJbnB1dCB7XFxuXFx0aW5jbHVkZUFyY2hpdmVkOiBCb29sZWFuXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZnJvbURhdGU6IFN0cmluZ1xcblxcdHRvRGF0ZTogU3RyaW5nXFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0ZnJvbURhdGU6IFN0cmluZyFcXG5cXHR0b0RhdGU6IFN0cmluZyFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF82IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlciFcXG5cXHRhbW91bnRDZW50czogTnVtYmVyIVxcblxcdHNwZW50T246IFN0cmluZyFcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcblxcdGFtb3VudENlbnRzOiBOdW1iZXJcXG5cXHRzcGVudE9uOiBTdHJpbmdcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxudHlwZSBRdWVyeSB7XFxuY2F0ZWdvcmllcyhhcmdzOiBBcmdzSW5wdXQpOiBbQ2F0ZWdvcmllcyFdIVxcbmNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF8xISk6IENhdGVnb3JpZXNcXG5leHBlbnNlcyhhcmdzOiBBcmdzSW5wdXRfMik6IFtFeHBlbnNlcyFdIVxcbmV4cGVuc2UoYXJnczogQXJnc0lucHV0XzMhKTogRXhwZW5zZXNcXG5leHBlbnNlVG90YWxzKGFyZ3M6IEFyZ3NJbnB1dF80ISk6IFtFeHBlbnNlVG90YWxzIV0hXFxufVxcbnR5cGUgQ2F0ZWdvcmllcyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuYXJjaGl2ZWRfYXQ6IERhdGVcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnR5cGUgRXhwZW5zZXMge1xcbmFtb3VudF9jZW50czogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbmNhdGVnb3J5X2lkOiBOdW1iZXIhXFxuY3VycmVuY3k6IFN0cmluZyFcXG5zcGVudF9vbjogU3RyaW5nIVxcbm5vdGU6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgRXhwZW5zZVRvdGFscyB7XFxuY2F0ZWdvcnlfaWQ6IE51bWJlciFcXG5jYXRlZ29yeV9uYW1lOiBTdHJpbmchXFxuY2F0ZWdvcnlfY29sb3I6IFN0cmluZyFcXG5jdXJyZW5jeTogU3RyaW5nIVxcbnRvdGFsX2NlbnRzOiBOdW1iZXIhXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF81ISk6IENyZWF0ZUNhdGVnb3J5IVxcbnVwZGF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF82ISk6IENyZWF0ZUNhdGVnb3J5IVxcbmFyY2hpdmVDYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfNyEpOiBDYXRlZ29yaWVzIVxcbmNyZWF0ZUV4cGVuc2UoYXJnczogQXJnc0lucHV0XzghKTogRXhwZW5zZXMhXFxudXBkYXRlRXhwZW5zZShhcmdzOiBBcmdzSW5wdXRfOSEpOiBFeHBlbnNlcyFcXG5kZWxldGVFeHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF8xMCEpOiBCb29sZWFuIVxcbn1cXG50eXBlIENyZWF0ZUNhdGVnb3J5IHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5hcmNoaXZlZF9hdDogRGF0ZVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuXCIsXG4gICAgICAgIGdyYXBocWwsXG4gICAgICAgIHJlc29sdmVyczoge30sXG4gICAgICAgIGNvbmZpZzogX19pbnRlcm5hbFB5bG9uQ29uZmlnXG4gICAgICB9KSlcbiAgICAgICIsICJpbXBvcnQgeyBnZXRDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHNxbCB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGRiIH0gZnJvbSAnLi4vLi4vZGIvZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IE5ld0NhdGVnb3J5LCBOZXdFeHBlbnNlIH0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHtcbiAgQ3JlYXRlQ2F0ZWdvcnlJbnB1dCxcbiAgQ3JlYXRlRXhwZW5zZUlucHV0LFxuICBVcGRhdGVDYXRlZ29yeUlucHV0LFxuICBVcGRhdGVFeHBlbnNlSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgSW52YWxpZENhdGVnb3J5RXJyb3IsXG4gIEludmFsaWRFeHBlbnNlRXJyb3IsXG4gIHZhbGlkYXRlQW1vdW50Q2VudHMsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcixcbiAgdmFsaWRhdGVDYXRlZ29yeU5hbWUsXG4gIHZhbGlkYXRlQ3VycmVuY3ksXG4gIHZhbGlkYXRlTm90ZSxcbiAgdmFsaWRhdGVTcGVudE9uLFxufSBmcm9tICcuLi92YWxpZGF0aW9uLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbi8qKiBwZyByZXR1cm5zIGJpZ2ludCBhcyBzdHJpbmc7IG5vcm1hbGl6ZSBmb3IgR3JhcGhRTCBjbGllbnRzLiAqL1xuZnVuY3Rpb24gYXNOdW1iZXIodmFsdWU6IG51bWJlciB8IHN0cmluZyk6IG51bWJlciB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gdmFsdWVcbiAgY29uc3QgbiA9IE51bWJlcih2YWx1ZSlcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUobikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignaW52YWxpZCBhbW91bnQnKVxuICB9XG4gIHJldHVybiBuXG59XG5cbmZ1bmN0aW9uIG1hcEV4cGVuc2Uocm93OiB7XG4gIGlkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIGNhdGVnb3J5X2lkOiBudW1iZXJcbiAgYW1vdW50X2NlbnRzOiBudW1iZXIgfCBzdHJpbmdcbiAgY3VycmVuY3k6IHN0cmluZ1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xuICB1cGRhdGVkX2F0OiBEYXRlIHwgc3RyaW5nXG59KSB7XG4gIHJldHVybiB7XG4gICAgLi4ucm93LFxuICAgIGFtb3VudF9jZW50czogYXNOdW1iZXIocm93LmFtb3VudF9jZW50cyksXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hPd25lZENhdGVnb3J5KGNhdGVnb3J5SWQ6IG51bWJlciwgdXNlcklkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2NhdGVnb3JpZXMnKVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNhdGVnb3J5SWQpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGNhdGVnb3JpZXM6IGFzeW5jIChhcmdzPzogeyBpbmNsdWRlQXJjaGl2ZWQ/OiBib29sZWFuIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2NhdGVnb3JpZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnbmFtZScsICdhc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG5cbiAgICBpZiAoIWFyZ3M/LmluY2x1ZGVBcmNoaXZlZCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnYXJjaGl2ZWRfYXQnLCAnaXMnLCBudWxsKVxuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgfSxcblxuICBjYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgcmV0dXJuIChcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgKSA/PyBudWxsXG4gIH0sXG5cbiAgZXhwZW5zZXM6IGFzeW5jIChhcmdzPzoge1xuICAgIGZyb21EYXRlPzogc3RyaW5nXG4gICAgdG9EYXRlPzogc3RyaW5nXG4gICAgY2F0ZWdvcnlJZD86IG51bWJlclxuICB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdzcGVudF9vbicsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKGFyZ3M/LmZyb21EYXRlKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdzcGVudF9vbicsICc+PScsIHZhbGlkYXRlU3BlbnRPbihhcmdzLmZyb21EYXRlKSlcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3BlbnRfb24nLCAnPD0nLCB2YWxpZGF0ZVNwZW50T24oYXJncy50b0RhdGUpKVxuICAgIH1cbiAgICBpZiAoYXJncz8uY2F0ZWdvcnlJZCAhPSBudWxsKSB7XG4gICAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdjYXRlZ29yeV9pZCcsICc9JywgYXJncy5jYXRlZ29yeUlkKVxuICAgIH1cblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBxdWVyeS5leGVjdXRlKClcbiAgICByZXR1cm4gcm93cy5tYXAobWFwRXhwZW5zZSlcbiAgfSxcblxuICBleHBlbnNlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyBtYXBFeHBlbnNlKHJvdykgOiBudWxsXG4gIH0sXG5cbiAgZXhwZW5zZVRvdGFsczogYXN5bmMgKGFyZ3M6IHsgZnJvbURhdGU6IHN0cmluZzsgdG9EYXRlOiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGZyb21EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MuZnJvbURhdGUpXG4gICAgY29uc3QgdG9EYXRlID0gdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLmlubmVySm9pbignY2F0ZWdvcmllcycsICdjYXRlZ29yaWVzLmlkJywgJ2V4cGVuc2VzLmNhdGVnb3J5X2lkJylcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc+PScsIGZyb21EYXRlKVxuICAgICAgLndoZXJlKCdleHBlbnNlcy5zcGVudF9vbicsICc8PScsIHRvRGF0ZSlcbiAgICAgIC5zZWxlY3QoW1xuICAgICAgICAnZXhwZW5zZXMuY2F0ZWdvcnlfaWQnLFxuICAgICAgICAnY2F0ZWdvcmllcy5uYW1lIGFzIGNhdGVnb3J5X25hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvciBhcyBjYXRlZ29yeV9jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICAgIHNxbDxzdHJpbmc+YHN1bShleHBlbnNlcy5hbW91bnRfY2VudHMpYC5hcygndG90YWxfY2VudHMnKSxcbiAgICAgIF0pXG4gICAgICAuZ3JvdXBCeShbXG4gICAgICAgICdleHBlbnNlcy5jYXRlZ29yeV9pZCcsXG4gICAgICAgICdjYXRlZ29yaWVzLm5hbWUnLFxuICAgICAgICAnY2F0ZWdvcmllcy5jb2xvcicsXG4gICAgICAgICdleHBlbnNlcy5jdXJyZW5jeScsXG4gICAgICBdKVxuICAgICAgLm9yZGVyQnkoJ3RvdGFsX2NlbnRzJywgJ2Rlc2MnKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgcmV0dXJuIHJvd3MubWFwKChyb3cpID0+ICh7XG4gICAgICBjYXRlZ29yeV9pZDogcm93LmNhdGVnb3J5X2lkLFxuICAgICAgY2F0ZWdvcnlfbmFtZTogcm93LmNhdGVnb3J5X25hbWUsXG4gICAgICBjYXRlZ29yeV9jb2xvcjogcm93LmNhdGVnb3J5X2NvbG9yLFxuICAgICAgY3VycmVuY3k6IHJvdy5jdXJyZW5jeSxcbiAgICAgIHRvdGFsX2NlbnRzOiBhc051bWJlcihyb3cudG90YWxfY2VudHMpLFxuICAgIH0pKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUNhdGVnb3J5OiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlQ2F0ZWdvcnlJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlQ2F0ZWdvcnlOYW1lKGFyZ3MuaW5wdXQubmFtZSlcbiAgICBjb25zdCBjb2xvciA9IHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcihhcmdzLmlucHV0LmNvbG9yKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnY2F0ZWdvcmllcycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbG9yLFxuICAgICAgICAgIGFyY2hpdmVkX2F0OiBudWxsLFxuICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3Q2F0ZWdvcnkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnJ1xuICAgICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoJ2NhdGVnb3JpZXNfdXNlcl9pZF9sb3dlcl9uYW1lX2FjdGl2ZV91bmlxdWUnKSkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2EgY2F0ZWdvcnkgd2l0aCB0aGlzIG5hbWUgYWxyZWFkeSBleGlzdHMnKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIHVwZGF0ZUNhdGVnb3J5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlQ2F0ZWdvcnlJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pZCwgdXNlcklkKVxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignY2Fubm90IHVwZGF0ZSBhbiBhcmNoaXZlZCBjYXRlZ29yeScpXG4gICAgfVxuXG4gICAgY29uc3QgbmFtZSA9IGFyZ3MuaW5wdXQubmFtZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ2F0ZWdvcnlOYW1lKGFyZ3MuaW5wdXQubmFtZSlcbiAgICAgIDogZXhpc3RpbmcubmFtZVxuICAgIGNvbnN0IGNvbG9yID0gYXJncy5pbnB1dC5jb2xvciAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcihhcmdzLmlucHV0LmNvbG9yKVxuICAgICAgOiBleGlzdGluZy5jb2xvclxuXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2NhdGVnb3JpZXMnKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICBuYW1lLFxuICAgICAgICAgIGNvbG9yLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgY29uc3QgbWVzc2FnZSA9IGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiAnJ1xuICAgICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoJ2NhdGVnb3JpZXNfdXNlcl9pZF9sb3dlcl9uYW1lX2FjdGl2ZV91bmlxdWUnKSkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2EgY2F0ZWdvcnkgd2l0aCB0aGlzIG5hbWUgYWxyZWFkeSBleGlzdHMnKVxuICAgICAgfVxuICAgICAgdGhyb3cgZXJyXG4gICAgfVxuICB9LFxuXG4gIGFyY2hpdmVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBmZXRjaE93bmVkQ2F0ZWdvcnkoYXJncy5pZCwgdXNlcklkKVxuICAgIGlmICghZXhpc3RpbmcpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICB9XG4gICAgaWYgKGV4aXN0aW5nLmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHJldHVybiBleGlzdGluZ1xuICAgIH1cblxuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdjYXRlZ29yaWVzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhcmNoaXZlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9LFxuXG4gIGNyZWF0ZUV4cGVuc2U6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGNhdGVnb3J5ID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCwgdXNlcklkKVxuICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSB2YWxpZGF0ZUFtb3VudENlbnRzKGFyZ3MuaW5wdXQuYW1vdW50Q2VudHMpXG4gICAgY29uc3Qgc3BlbnRPbiA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLmlucHV0LnNwZW50T24pXG4gICAgY29uc3QgY3VycmVuY3kgPSB2YWxpZGF0ZUN1cnJlbmN5KGFyZ3MuaW5wdXQuY3VycmVuY3kgPz8gJ1VTRCcpXG4gICAgY29uc3Qgbm90ZSA9IHZhbGlkYXRlTm90ZShhcmdzLmlucHV0Lm5vdGUpXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2V4cGVuc2VzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeS5pZCxcbiAgICAgICAgYW1vdW50X2NlbnRzOiBhbW91bnRDZW50cyxcbiAgICAgICAgY3VycmVuY3ksXG4gICAgICAgIHNwZW50X29uOiBzcGVudE9uLFxuICAgICAgICBub3RlLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3RXhwZW5zZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBtYXBFeHBlbnNlKHJvdylcbiAgfSxcblxuICB1cGRhdGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlRXhwZW5zZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignZXhwZW5zZSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGxldCBjYXRlZ29yeUlkID0gZXhpc3RpbmcuY2F0ZWdvcnlfaWRcbiAgICBpZiAoYXJncy5pbnB1dC5jYXRlZ29yeUlkICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGNvbnN0IGNhdGVnb3J5ID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCwgdXNlcklkKVxuICAgICAgaWYgKCFjYXRlZ29yeSB8fCBjYXRlZ29yeS5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgICAgfVxuICAgICAgY2F0ZWdvcnlJZCA9IGNhdGVnb3J5LmlkXG4gICAgfVxuXG4gICAgY29uc3QgYW1vdW50Q2VudHMgPSBhcmdzLmlucHV0LmFtb3VudENlbnRzICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgICAgOiBhc051bWJlcihleGlzdGluZy5hbW91bnRfY2VudHMpXG4gICAgY29uc3Qgc3BlbnRPbiA9IGFyZ3MuaW5wdXQuc3BlbnRPbiAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlU3BlbnRPbihhcmdzLmlucHV0LnNwZW50T24pXG4gICAgICA6IGV4aXN0aW5nLnNwZW50X29uXG4gICAgY29uc3QgY3VycmVuY3kgPSBhcmdzLmlucHV0LmN1cnJlbmN5ICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5KVxuICAgICAgOiBleGlzdGluZy5jdXJyZW5jeVxuICAgIGNvbnN0IG5vdGUgPSBhcmdzLmlucHV0Lm5vdGUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZU5vdGUoYXJncy5pbnB1dC5ub3RlKVxuICAgICAgOiBleGlzdGluZy5ub3RlXG5cbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdleHBlbnNlcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgY2F0ZWdvcnlfaWQ6IGNhdGVnb3J5SWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBzcGVudF9vbjogc3BlbnRPbixcbiAgICAgICAgbm90ZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBtYXBFeHBlbnNlKHJvdylcbiAgfSxcblxuICBkZWxldGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByZXN1bHQubGVuZ3RoID4gMCAmJiBOdW1iZXIocmVzdWx0WzBdPy5udW1EZWxldGVkUm93cyA/PyAwKSA+IDBcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IHJlc29sdmVycyA9IHtcbiAgUXVlcnksXG4gIE11dGF0aW9uLFxufVxuIiwgImltcG9ydCB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgSW5zZXJ0YWJsZSwgU2VsZWN0YWJsZSwgVXBkYXRlYWJsZSB9IGZyb20gJ2t5c2VseSdcblxuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG4gIGNhdGVnb3JpZXM6IENhdGVnb3JpZXNUYWJsZVxuICBleHBlbnNlczogRXhwZW5zZXNUYWJsZVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgQ2F0ZWdvcmllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLyoqIEhleCBjb2xvciBmcm9tIGEgc2hhcmVkIHBhbGV0dGUsIGUuZy4gXCIjMEY3NjZFXCIuICovXG4gIGNvbG9yOiBzdHJpbmdcbiAgLyoqIFNvZnQtYXJjaGl2ZSB0aW1lc3RhbXA7IG51bGwgd2hlbiBhY3RpdmUuICovXG4gIGFyY2hpdmVkX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXhwZW5zZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgY2F0ZWdvcnlfaWQ6IG51bWJlclxuICAvKiogQW1vdW50IGluIG1pbm9yIGN1cnJlbmN5IHVuaXRzIChlLmcuIGNlbnRzKS4gKi9cbiAgYW1vdW50X2NlbnRzOiBudW1iZXJcbiAgLyoqIElTTyA0MjE3IGN1cnJlbmN5IGNvZGUuICovXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgLyoqIENhbGVuZGFyIGRheSBvZiB0aGUgc3BlbmQgKFlZWVktTU0tREQpLiAqL1xuICBzcGVudF9vbjogc3RyaW5nXG4gIG5vdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3VXNlciA9IEluc2VydGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIFVzZXJVcGRhdGUgPSBVcGRhdGVhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIENhdGVnb3J5ID0gU2VsZWN0YWJsZTxDYXRlZ29yaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdDYXRlZ29yeSA9IEluc2VydGFibGU8Q2F0ZWdvcmllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQ2F0ZWdvcnlVcGRhdGUgPSBVcGRhdGVhYmxlPENhdGVnb3JpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgRXhwZW5zZSA9IFNlbGVjdGFibGU8RXhwZW5zZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0V4cGVuc2UgPSBJbnNlcnRhYmxlPEV4cGVuc2VzVGFibGU+XG5leHBvcnQgdHlwZSBFeHBlbnNlVXBkYXRlID0gVXBkYXRlYWJsZTxFeHBlbnNlc1RhYmxlPlxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5pbXBvcnQge1xuICBjb25uZWN0aW9uU3RyaW5nV2l0aG91dFNzbFBhcmFtcyxcbiAgc3NsRm9yRGF0YWJhc2VVcmwsXG59IGZyb20gJy4vc3NsLnRzJ1xuXG4vLyBLZWVwIFBvc3RncmVzIGBkYXRlYCBhcyBgWVlZWS1NTS1ERGAgc3RyaW5ncy5cbnR5cGVzLnNldFR5cGVQYXJzZXIodHlwZXMuYnVpbHRpbnMuREFURSwgKHZhbHVlOiBzdHJpbmcpID0+IHZhbHVlKVxuXG5leHBvcnQgZnVuY3Rpb24gZW52KG5hbWU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGlmICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LltuYW1lXSkge1xuICAgIHJldHVybiBwcm9jZXNzLmVudltuYW1lXVxuICB9XG4gIHRyeSB7XG4gICAgcmV0dXJuIERlbm8uZW52LmdldChuYW1lKVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gdW5kZWZpbmVkXG4gIH1cbn1cblxuZnVuY3Rpb24gcG9vbENvbmZpZ0Zyb21FbnYoKTogQ29uc3RydWN0b3JQYXJhbWV0ZXJzPHR5cGVvZiBQb29sPlswXSB7XG4gIGNvbnN0IGRhdGFiYXNlVXJsID0gZW52KCdEQVRBQkFTRV9VUkwnKVxuICBpZiAoZGF0YWJhc2VVcmwpIHtcbiAgICBjb25zdCBzc2wgPSBzc2xGb3JEYXRhYmFzZVVybChkYXRhYmFzZVVybClcbiAgICByZXR1cm4ge1xuICAgICAgY29ubmVjdGlvblN0cmluZzogY29ubmVjdGlvblN0cmluZ1dpdGhvdXRTc2xQYXJhbXMoZGF0YWJhc2VVcmwpLFxuICAgICAgbWF4OiAxMCxcbiAgICAgIC4uLihzc2wgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBzc2wgfSksXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBkYXRhYmFzZTogZW52KCdQR0RBVEFCQVNFJykgPz8gJ3NwZW5kbWFuYWdlcicsXG4gICAgaG9zdDogZW52KCdQR0hPU1QnKSA/PyAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiBlbnYoJ1BHVVNFUicpID8/ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6IGVudignUEdQQVNTV09SRCcpID8/ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogTnVtYmVyKGVudignUEdQT1JUJykgPz8gJzU0MzInKSxcbiAgICBtYXg6IDEwLFxuICB9XG59XG5cbmNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgcG9vbDogbmV3IFBvb2wocG9vbENvbmZpZ0Zyb21FbnYoKSksXG59KVxuXG5leHBvcnQgY29uc3QgZGIgPSBuZXcgS3lzZWx5PERhdGFiYXNlPih7XG4gIGRpYWxlY3QsXG59KVxuIiwgIi8qKiBUTFMgb3B0aW9ucyBmb3IgYHBnYCBmcm9tIGEgUG9zdGdyZXMgVVJMLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNzbEZvckRhdGFiYXNlVXJsKFxuICBkYXRhYmFzZVVybDogc3RyaW5nLFxuKTogZmFsc2UgfCB7IHJlamVjdFVuYXV0aG9yaXplZDogYm9vbGVhbiB9IHwgdW5kZWZpbmVkIHtcbiAgbGV0IHVybDogVVJMXG4gIHRyeSB7XG4gICAgdXJsID0gbmV3IFVSTChkYXRhYmFzZVVybClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHVuZGVmaW5lZFxuICB9XG5cbiAgY29uc3QgbW9kZSA9IHVybC5zZWFyY2hQYXJhbXMuZ2V0KCdzc2xtb2RlJyk/LnRvTG93ZXJDYXNlKClcbiAgaWYgKG1vZGUgPT09ICdkaXNhYmxlJykgcmV0dXJuIGZhbHNlXG4gIGlmIChtb2RlID09PSAncmVxdWlyZScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1jYScgfHwgbW9kZSA9PT0gJ3ZlcmlmeS1mdWxsJykge1xuICAgIHJldHVybiB7IHJlamVjdFVuYXV0aG9yaXplZDogZmFsc2UgfVxuICB9XG5cbiAgY29uc3QgaG9zdCA9IHVybC5ob3N0bmFtZVxuICBpZiAoaG9zdCA9PT0gJ2xvY2FsaG9zdCcgfHwgaG9zdCA9PT0gJzEyNy4wLjAuMScpIHJldHVybiB1bmRlZmluZWRcblxuICByZXR1cm4geyByZWplY3RVbmF1dGhvcml6ZWQ6IGZhbHNlIH1cbn1cblxuLyoqXG4gKiBTdHJpcCBTU0wgcXVlcnkgcGFyYW1zIGZyb20gYSBQb3N0Z3JlcyBVUkwgYmVmb3JlIHBhc3NpbmcgaXQgdG8gYHBnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbm5lY3Rpb25TdHJpbmdXaXRob3V0U3NsUGFyYW1zKGRhdGFiYXNlVXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoZGF0YWJhc2VVcmwpXG4gICAgZm9yIChjb25zdCBrZXkgb2YgW1xuICAgICAgJ3NzbG1vZGUnLFxuICAgICAgJ3NzbCcsXG4gICAgICAnc3Nscm9vdGNlcnQnLFxuICAgICAgJ3NzbGNlcnQnLFxuICAgICAgJ3NzbGtleScsXG4gICAgXSkge1xuICAgICAgdXJsLnNlYXJjaFBhcmFtcy5kZWxldGUoa2V5KVxuICAgIH1cbiAgICByZXR1cm4gdXJsLnRvU3RyaW5nKClcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGRhdGFiYXNlVXJsXG4gIH1cbn1cbiIsICJleHBvcnQgY2xhc3MgSW52YWxpZENhdGVnb3J5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRDYXRlZ29yeUVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkRXhwZW5zZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkRXhwZW5zZUVycm9yJ1xuICB9XG59XG5cbmNvbnN0IEhFWF9DT0xPUiA9IC9eI1swLTlBLUZhLWZdezZ9JC9cbmNvbnN0IERBVEVfT05MWSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kL1xuY29uc3QgQ1VSUkVOQ1kgPSAvXltBLVpdezN9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignbmFtZSBpcyB0b28gbG9uZycpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGNvbG9yLnRyaW0oKVxuICBpZiAoIUhFWF9DT0xPUi50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdjb2xvciBtdXN0IGJlIGEgaGV4IHZhbHVlIGxpa2UgIzBGNzY2RScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQudG9VcHBlckNhc2UoKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbW91bnRDZW50cyhhbW91bnRDZW50czogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoYW1vdW50Q2VudHMpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudENlbnRzKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdhbW91bnRfY2VudHMgbXVzdCBiZSBhbiBpbnRlZ2VyJylcbiAgfVxuICBpZiAoYW1vdW50Q2VudHMgPD0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdhbW91bnRfY2VudHMgbXVzdCBiZSBwb3NpdGl2ZScpXG4gIH1cbiAgcmV0dXJuIGFtb3VudENlbnRzXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUN1cnJlbmN5KGN1cnJlbmN5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gY3VycmVuY3kudHJpbSgpLnRvVXBwZXJDYXNlKClcbiAgaWYgKCFDVVJSRU5DWS50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2N1cnJlbmN5IG11c3QgYmUgYSAzLWxldHRlciBJU08gY29kZScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3BlbnRPbihzcGVudE9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gc3BlbnRPbi50cmltKClcbiAgaWYgKCFEQVRFX09OTFkudGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdzcGVudF9vbiBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShgJHt0cmltbWVkfVQwMDowMDowMFpgKVxuICBpZiAoTnVtYmVyLmlzTmFOKGQuZ2V0VGltZSgpKSB8fCBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICE9PSB0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ3NwZW50X29uIGlzIG5vdCBhIHZhbGlkIGRhdGUnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU5vdGUobm90ZTogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAobm90ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cmltbWVkID0gbm90ZS50cmltKClcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID09PSAwID8gbnVsbCA6IHRyaW1tZWRcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVSZW1vdGVKV0tTZXQsIGp3dFZlcmlmeSB9IGZyb20gJ2pvc2UnXG5pbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJyxcbiAgICAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmly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
