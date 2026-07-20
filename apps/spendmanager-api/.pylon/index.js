// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import { getContext } from "@getcronit/pylon";
import { sql } from "kysely";

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
  typeDefs: "input ArgsInput {\n	includeArchived: Boolean\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	fromDate: String\n	toDate: String\n	categoryId: Number\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	fromDate: String!\n	toDate: String!\n}\ninput ArgsInput_5 {\n	input: CreateCategoryInputInput!\n}\ninput CreateCategoryInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_6 {\n	id: Number!\n	input: UpdateCategoryInputInput!\n}\ninput UpdateCategoryInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ninput ArgsInput_8 {\n	input: CreateExpenseInputInput!\n}\ninput CreateExpenseInputInput {\n	categoryId: Number!\n	amountCents: Number!\n	spentOn: String!\n	currency: String\n	note: String\n}\ninput ArgsInput_9 {\n	id: Number!\n	input: UpdateExpenseInputInput!\n}\ninput UpdateExpenseInputInput {\n	categoryId: Number\n	amountCents: Number\n	spentOn: String\n	currency: String\n	note: String\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ntype Query {\ncategories(args: ArgsInput): Any!\ncategory(args: ArgsInput_1!): Any!\nexpenses(args: ArgsInput_2): Any!\nexpense(args: ArgsInput_3!): Expense\nexpenseTotals(args: ArgsInput_4!): Any!\n}\ntype Expense {\namount_cents: Number!\nid: Number!\nuser_id: Number!\ncategory_id: Number!\ncurrency: String!\nspent_on: String!\nnote: String\ncreated_at: String!\nupdated_at: String!\n}\ntype Mutation {\ncreateCategory(args: ArgsInput_5!): Any!\nupdateCategory(args: ArgsInput_6!): Any!\narchiveCategory(args: ArgsInput_7!): Any!\ncreateExpense(args: ArgsInput_8!): Expense!\nupdateExpense(args: ArgsInput_9!): Expense!\ndeleteExpense(args: ArgsInput_10!): Boolean!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGFwcCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7IGNvcnNNaWRkbGV3YXJlIH0gZnJvbSAnZGVub19hcGlfa2l0L2F1dGgvdmVyaWZ5LnRzJ1xuaW1wb3J0IHtcbiAgY3JlYXRlR3JhcGhRTEF1dGhNaWRkbGV3YXJlLFxuICBoZWFsdGhNaWRkbGV3YXJlLFxufSBmcm9tICdkZW5vX2FwaV9raXQvcHlsb24vbWlkZGxld2FyZS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgfSBmcm9tICcuL2RiL3VzZXJzLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuYXBwLnVzZShoZWFsdGhNaWRkbGV3YXJlKVxuYXBwLnVzZShjcmVhdGVHcmFwaFFMQXV0aE1pZGRsZXdhcmUocmVzb2x2ZUxvY2FsVXNlcikpXG5cbmV4cG9ydCBjb25zdCBncmFwaHFsID0ge1xuICAuLi5yZXNvbHZlcnMsXG59XG5cbmV4cG9ydCBkZWZhdWx0IGFwcFxuXG4gICAgICBpbXBvcnQge2hhbmRsZXIgYXMgX19pbnRlcm5hbFB5bG9uSGFuZGxlcn0gZnJvbSBcIkBnZXRjcm9uaXQvcHlsb25cIlxuXG4gICAgICBsZXQgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gdW5kZWZpbmVkXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IGNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGNvbmZpZyBpcyBub3QgZGVjbGFyZWQsIHB5bG9uQ29uZmlnIHJlbWFpbnMgdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGFwcC51c2UoX19pbnRlcm5hbFB5bG9uSGFuZGxlcih7XG4gICAgICAgIHR5cGVEZWZzOiBcImlucHV0IEFyZ3NJbnB1dCB7XFxuXFx0aW5jbHVkZUFyY2hpdmVkOiBCb29sZWFuXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZnJvbURhdGU6IFN0cmluZ1xcblxcdHRvRGF0ZTogU3RyaW5nXFxuXFx0Y2F0ZWdvcnlJZDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0ZnJvbURhdGU6IFN0cmluZyFcXG5cXHR0b0RhdGU6IFN0cmluZyFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGlucHV0OiBDcmVhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF82IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVDYXRlZ29yeUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUNhdGVnb3J5SW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNyB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzgge1xcblxcdGlucHV0OiBDcmVhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgQ3JlYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlciFcXG5cXHRhbW91bnRDZW50czogTnVtYmVyIVxcblxcdHNwZW50T246IFN0cmluZyFcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF85IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVFeHBlbnNlSW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlRXhwZW5zZUlucHV0SW5wdXQge1xcblxcdGNhdGVnb3J5SWQ6IE51bWJlclxcblxcdGFtb3VudENlbnRzOiBOdW1iZXJcXG5cXHRzcGVudE9uOiBTdHJpbmdcXG5cXHRjdXJyZW5jeTogU3RyaW5nXFxuXFx0bm90ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxudHlwZSBRdWVyeSB7XFxuY2F0ZWdvcmllcyhhcmdzOiBBcmdzSW5wdXQpOiBBbnkhXFxuY2F0ZWdvcnkoYXJnczogQXJnc0lucHV0XzEhKTogQW55IVxcbmV4cGVuc2VzKGFyZ3M6IEFyZ3NJbnB1dF8yKTogQW55IVxcbmV4cGVuc2UoYXJnczogQXJnc0lucHV0XzMhKTogRXhwZW5zZVxcbmV4cGVuc2VUb3RhbHMoYXJnczogQXJnc0lucHV0XzQhKTogQW55IVxcbn1cXG50eXBlIEV4cGVuc2Uge1xcbmFtb3VudF9jZW50czogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxudXNlcl9pZDogTnVtYmVyIVxcbmNhdGVnb3J5X2lkOiBOdW1iZXIhXFxuY3VycmVuY3k6IFN0cmluZyFcXG5zcGVudF9vbjogU3RyaW5nIVxcbm5vdGU6IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IFN0cmluZyFcXG51cGRhdGVkX2F0OiBTdHJpbmchXFxufVxcbnR5cGUgTXV0YXRpb24ge1xcbmNyZWF0ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF81ISk6IEFueSFcXG51cGRhdGVDYXRlZ29yeShhcmdzOiBBcmdzSW5wdXRfNiEpOiBBbnkhXFxuYXJjaGl2ZUNhdGVnb3J5KGFyZ3M6IEFyZ3NJbnB1dF83ISk6IEFueSFcXG5jcmVhdGVFeHBlbnNlKGFyZ3M6IEFyZ3NJbnB1dF84ISk6IEV4cGVuc2UhXFxudXBkYXRlRXhwZW5zZShhcmdzOiBBcmdzSW5wdXRfOSEpOiBFeHBlbnNlIVxcbmRlbGV0ZUV4cGVuc2UoYXJnczogQXJnc0lucHV0XzEwISk6IEJvb2xlYW4hXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyBzcWwgfSBmcm9tICdreXNlbHknXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uLy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBOZXdDYXRlZ29yeSwgTmV3RXhwZW5zZSB9IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7XG4gIENyZWF0ZUNhdGVnb3J5SW5wdXQsXG4gIENyZWF0ZUV4cGVuc2VJbnB1dCxcbiAgVXBkYXRlQ2F0ZWdvcnlJbnB1dCxcbiAgVXBkYXRlRXhwZW5zZUlucHV0LFxufSBmcm9tICcuLi90eXBlcy50cydcbmltcG9ydCB7XG4gIEludmFsaWRDYXRlZ29yeUVycm9yLFxuICBJbnZhbGlkRXhwZW5zZUVycm9yLFxuICB2YWxpZGF0ZUFtb3VudENlbnRzLFxuICB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IsXG4gIHZhbGlkYXRlQ2F0ZWdvcnlOYW1lLFxuICB2YWxpZGF0ZUN1cnJlbmN5LFxuICB2YWxpZGF0ZU5vdGUsXG4gIHZhbGlkYXRlU3BlbnRPbixcbn0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KCd1c2VySWQnKVxuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ1VuYXV0aGVudGljYXRlZCcpXG4gIH1cbiAgcmV0dXJuIHVzZXJJZFxufVxuXG4vKiogcGcgcmV0dXJucyBiaWdpbnQgYXMgc3RyaW5nOyBub3JtYWxpemUgZm9yIEdyYXBoUUwgY2xpZW50cy4gKi9cbmZ1bmN0aW9uIGFzTnVtYmVyKHZhbHVlOiBudW1iZXIgfCBzdHJpbmcpOiBudW1iZXIge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIHZhbHVlXG4gIGNvbnN0IG4gPSBOdW1iZXIodmFsdWUpXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKG4pKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2ludmFsaWQgYW1vdW50JylcbiAgfVxuICByZXR1cm4gblxufVxuXG5mdW5jdGlvbiBtYXBFeHBlbnNlKHJvdzoge1xuICBpZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBjYXRlZ29yeV9pZDogbnVtYmVyXG4gIGFtb3VudF9jZW50czogbnVtYmVyIHwgc3RyaW5nXG4gIGN1cnJlbmN5OiBzdHJpbmdcbiAgc3BlbnRfb246IHN0cmluZ1xuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IERhdGUgfCBzdHJpbmdcbiAgdXBkYXRlZF9hdDogRGF0ZSB8IHN0cmluZ1xufSkge1xuICByZXR1cm4ge1xuICAgIC4uLnJvdyxcbiAgICBhbW91bnRfY2VudHM6IGFzTnVtYmVyKHJvdy5hbW91bnRfY2VudHMpLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRDYXRlZ29yeShjYXRlZ29yeUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAud2hlcmUoJ2lkJywgJz0nLCBjYXRlZ29yeUlkKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbn1cblxuZXhwb3J0IGNvbnN0IFF1ZXJ5ID0ge1xuICBjYXRlZ29yaWVzOiBhc3luYyAoYXJncz86IHsgaW5jbHVkZUFyY2hpdmVkPzogYm9vbGVhbiB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdjYXRlZ29yaWVzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ25hbWUnLCAnYXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKCFhcmdzPy5pbmNsdWRlQXJjaGl2ZWQpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ2FyY2hpdmVkX2F0JywgJ2lzJywgbnVsbClcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gIH0sXG5cbiAgY2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIHJldHVybiAoXG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnY2F0ZWdvcmllcycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICkgPz8gbnVsbFxuICB9LFxuXG4gIGV4cGVuc2VzOiBhc3luYyAoYXJncz86IHtcbiAgICBmcm9tRGF0ZT86IHN0cmluZ1xuICAgIHRvRGF0ZT86IHN0cmluZ1xuICAgIGNhdGVnb3J5SWQ/OiBudW1iZXJcbiAgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGxldCBxdWVyeSA9IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZXhwZW5zZXMnKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAub3JkZXJCeSgnc3BlbnRfb24nLCAnZGVzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5mcm9tRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3BlbnRfb24nLCAnPj0nLCB2YWxpZGF0ZVNwZW50T24oYXJncy5mcm9tRGF0ZSkpXG4gICAgfVxuICAgIGlmIChhcmdzPy50b0RhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3NwZW50X29uJywgJzw9JywgdmFsaWRhdGVTcGVudE9uKGFyZ3MudG9EYXRlKSlcbiAgICB9XG4gICAgaWYgKGFyZ3M/LmNhdGVnb3J5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnY2F0ZWdvcnlfaWQnLCAnPScsIGFyZ3MuY2F0ZWdvcnlJZClcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKG1hcEV4cGVuc2UpXG4gIH0sXG5cbiAgZXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gbWFwRXhwZW5zZShyb3cpIDogbnVsbFxuICB9LFxuXG4gIGV4cGVuc2VUb3RhbHM6IGFzeW5jIChhcmdzOiB7IGZyb21EYXRlOiBzdHJpbmc7IHRvRGF0ZTogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBmcm9tRGF0ZSA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLmZyb21EYXRlKVxuICAgIGNvbnN0IHRvRGF0ZSA9IHZhbGlkYXRlU3BlbnRPbihhcmdzLnRvRGF0ZSlcblxuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC5pbm5lckpvaW4oJ2NhdGVnb3JpZXMnLCAnY2F0ZWdvcmllcy5pZCcsICdleHBlbnNlcy5jYXRlZ29yeV9pZCcpXG4gICAgICAud2hlcmUoJ2V4cGVuc2VzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMuc3BlbnRfb24nLCAnPj0nLCBmcm9tRGF0ZSlcbiAgICAgIC53aGVyZSgnZXhwZW5zZXMuc3BlbnRfb24nLCAnPD0nLCB0b0RhdGUpXG4gICAgICAuc2VsZWN0KFtcbiAgICAgICAgJ2V4cGVuc2VzLmNhdGVnb3J5X2lkJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMubmFtZSBhcyBjYXRlZ29yeV9uYW1lJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMuY29sb3IgYXMgY2F0ZWdvcnlfY29sb3InLFxuICAgICAgICAnZXhwZW5zZXMuY3VycmVuY3knLFxuICAgICAgICBzcWw8c3RyaW5nPmBzdW0oZXhwZW5zZXMuYW1vdW50X2NlbnRzKWAuYXMoJ3RvdGFsX2NlbnRzJyksXG4gICAgICBdKVxuICAgICAgLmdyb3VwQnkoW1xuICAgICAgICAnZXhwZW5zZXMuY2F0ZWdvcnlfaWQnLFxuICAgICAgICAnY2F0ZWdvcmllcy5uYW1lJyxcbiAgICAgICAgJ2NhdGVnb3JpZXMuY29sb3InLFxuICAgICAgICAnZXhwZW5zZXMuY3VycmVuY3knLFxuICAgICAgXSlcbiAgICAgIC5vcmRlckJ5KCd0b3RhbF9jZW50cycsICdkZXNjJylcbiAgICAgIC5leGVjdXRlKClcblxuICAgIHJldHVybiByb3dzLm1hcCgocm93KSA9PiAoe1xuICAgICAgY2F0ZWdvcnlfaWQ6IHJvdy5jYXRlZ29yeV9pZCxcbiAgICAgIGNhdGVnb3J5X25hbWU6IHJvdy5jYXRlZ29yeV9uYW1lLFxuICAgICAgY2F0ZWdvcnlfY29sb3I6IHJvdy5jYXRlZ29yeV9jb2xvcixcbiAgICAgIGN1cnJlbmN5OiByb3cuY3VycmVuY3ksXG4gICAgICB0b3RhbF9jZW50czogYXNOdW1iZXIocm93LnRvdGFsX2NlbnRzKSxcbiAgICB9KSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IE11dGF0aW9uID0ge1xuICBjcmVhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IG5hbWUgPSB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKClcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2NhdGVnb3JpZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICBhcmNoaXZlZF9hdDogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9IGFzIE5ld0NhdGVnb3J5KVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICB1cGRhdGVDYXRlZ29yeTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUNhdGVnb3J5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2Nhbm5vdCB1cGRhdGUgYW4gYXJjaGl2ZWQgY2F0ZWdvcnknKVxuICAgIH1cblxuICAgIGNvbnN0IG5hbWUgPSBhcmdzLmlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5TmFtZShhcmdzLmlucHV0Lm5hbWUpXG4gICAgICA6IGV4aXN0aW5nLm5hbWVcbiAgICBjb25zdCBjb2xvciA9IGFyZ3MuaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUNhdGVnb3J5Q29sb3IoYXJncy5pbnB1dC5jb2xvcilcbiAgICAgIDogZXhpc3RpbmcuY29sb3JcblxuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdjYXRlZ29yaWVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgbmFtZSxcbiAgICAgICAgICBjb2xvcixcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogJydcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKCdjYXRlZ29yaWVzX3VzZXJfaWRfbG93ZXJfbmFtZV9hY3RpdmVfdW5pcXVlJykpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdhIGNhdGVnb3J5IHdpdGggdGhpcyBuYW1lIGFscmVhZHkgZXhpc3RzJylcbiAgICAgIH1cbiAgICAgIHRocm93IGVyclxuICAgIH1cbiAgfSxcblxuICBhcmNoaXZlQ2F0ZWdvcnk6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZmV0Y2hPd25lZENhdGVnb3J5KGFyZ3MuaWQsIHVzZXJJZClcbiAgICBpZiAoIWV4aXN0aW5nKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ2NhdGVnb3J5IG5vdCBmb3VuZCcpXG4gICAgfVxuICAgIGlmIChleGlzdGluZy5hcmNoaXZlZF9hdCAhPSBudWxsKSB7XG4gICAgICByZXR1cm4gZXhpc3RpbmdcbiAgICB9XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnY2F0ZWdvcmllcycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXJjaGl2ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfSxcblxuICBjcmVhdGVFeHBlbnNlOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlRXhwZW5zZUlucHV0IH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICBpZiAoIWNhdGVnb3J5IHx8IGNhdGVnb3J5LmFyY2hpdmVkX2F0ICE9IG51bGwpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdjYXRlZ29yeSBub3QgZm91bmQnKVxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gdmFsaWRhdGVBbW91bnRDZW50cyhhcmdzLmlucHV0LmFtb3VudENlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgIGNvbnN0IGN1cnJlbmN5ID0gdmFsaWRhdGVDdXJyZW5jeShhcmdzLmlucHV0LmN1cnJlbmN5ID8/ICdVU0QnKVxuICAgIGNvbnN0IG5vdGUgPSB2YWxpZGF0ZU5vdGUoYXJncy5pbnB1dC5ub3RlKVxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdleHBlbnNlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBjYXRlZ29yeV9pZDogY2F0ZWdvcnkuaWQsXG4gICAgICAgIGFtb3VudF9jZW50czogYW1vdW50Q2VudHMsXG4gICAgICAgIGN1cnJlbmN5LFxuICAgICAgICBzcGVudF9vbjogc3BlbnRPbixcbiAgICAgICAgbm90ZSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0V4cGVuc2UpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwRXhwZW5zZShyb3cpXG4gIH0sXG5cbiAgdXBkYXRlRXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUV4cGVuc2VJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2V4cGVuc2VzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgaWYgKCFleGlzdGluZykge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2V4cGVuc2Ugbm90IGZvdW5kJylcbiAgICB9XG5cbiAgICBsZXQgY2F0ZWdvcnlJZCA9IGV4aXN0aW5nLmNhdGVnb3J5X2lkXG4gICAgaWYgKGFyZ3MuaW5wdXQuY2F0ZWdvcnlJZCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBjb25zdCBjYXRlZ29yeSA9IGF3YWl0IGZldGNoT3duZWRDYXRlZ29yeShhcmdzLmlucHV0LmNhdGVnb3J5SWQsIHVzZXJJZClcbiAgICAgIGlmICghY2F0ZWdvcnkgfHwgY2F0ZWdvcnkuYXJjaGl2ZWRfYXQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEV4cGVuc2VFcnJvcignY2F0ZWdvcnkgbm90IGZvdW5kJylcbiAgICAgIH1cbiAgICAgIGNhdGVnb3J5SWQgPSBjYXRlZ29yeS5pZFxuICAgIH1cblxuICAgIGNvbnN0IGFtb3VudENlbnRzID0gYXJncy5pbnB1dC5hbW91bnRDZW50cyAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQW1vdW50Q2VudHMoYXJncy5pbnB1dC5hbW91bnRDZW50cylcbiAgICAgIDogYXNOdW1iZXIoZXhpc3RpbmcuYW1vdW50X2NlbnRzKVxuICAgIGNvbnN0IHNwZW50T24gPSBhcmdzLmlucHV0LnNwZW50T24gIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZVNwZW50T24oYXJncy5pbnB1dC5zcGVudE9uKVxuICAgICAgOiBleGlzdGluZy5zcGVudF9vblxuICAgIGNvbnN0IGN1cnJlbmN5ID0gYXJncy5pbnB1dC5jdXJyZW5jeSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlQ3VycmVuY3koYXJncy5pbnB1dC5jdXJyZW5jeSlcbiAgICAgIDogZXhpc3RpbmcuY3VycmVuY3lcbiAgICBjb25zdCBub3RlID0gYXJncy5pbnB1dC5ub3RlICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVOb3RlKGFyZ3MuaW5wdXQubm90ZSlcbiAgICAgIDogZXhpc3Rpbmcubm90ZVxuXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZXhwZW5zZXMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGNhdGVnb3J5X2lkOiBjYXRlZ29yeUlkLFxuICAgICAgICBhbW91bnRfY2VudHM6IGFtb3VudENlbnRzLFxuICAgICAgICBjdXJyZW5jeSxcbiAgICAgICAgc3BlbnRfb246IHNwZW50T24sXG4gICAgICAgIG5vdGUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gbWFwRXhwZW5zZShyb3cpXG4gIH0sXG5cbiAgZGVsZXRlRXhwZW5zZTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdleHBlbnNlcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDAgJiYgTnVtYmVyKHJlc3VsdFswXT8ubnVtRGVsZXRlZFJvd3MgPz8gMCkgPiAwXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7XG4gIFF1ZXJ5LFxuICBNdXRhdGlvbixcbn1cbiIsICJpbXBvcnQgeyBDb2x1bW5UeXBlLCBHZW5lcmF0ZWQsIEluc2VydGFibGUsIFNlbGVjdGFibGUsIFVwZGF0ZWFibGUgfSBmcm9tICdreXNlbHknXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGF0YWJhc2Uge1xuICB1c2VyczogVXNlcnNUYWJsZVxuICBjYXRlZ29yaWVzOiBDYXRlZ29yaWVzVGFibGVcbiAgZXhwZW5zZXM6IEV4cGVuc2VzVGFibGVcbn1cblxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3VwZXJUb2tlbnMgdXNlciBpZCBcdTIwMTQgbGlua3MgU1NPIGlkZW50aXR5IHRvIGxvY2FsIHJvd3MuICovXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIENhdGVnb3JpZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgbmFtZTogc3RyaW5nXG4gIC8qKiBIZXggY29sb3IgZnJvbSBhIHNoYXJlZCBwYWxldHRlLCBlLmcuIFwiIzBGNzY2RVwiLiAqL1xuICBjb2xvcjogc3RyaW5nXG4gIC8qKiBTb2Z0LWFyY2hpdmUgdGltZXN0YW1wOyBudWxsIHdoZW4gYWN0aXZlLiAqL1xuICBhcmNoaXZlZF9hdDogQ29sdW1uVHlwZTxEYXRlIHwgbnVsbCwgc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEV4cGVuc2VzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIGNhdGVnb3J5X2lkOiBudW1iZXJcbiAgLyoqIEFtb3VudCBpbiBtaW5vciBjdXJyZW5jeSB1bml0cyAoZS5nLiBjZW50cykuICovXG4gIGFtb3VudF9jZW50czogbnVtYmVyXG4gIC8qKiBJU08gNDIxNyBjdXJyZW5jeSBjb2RlLiAqL1xuICBjdXJyZW5jeTogc3RyaW5nXG4gIC8qKiBDYWxlbmRhciBkYXkgb2YgdGhlIHNwZW5kIChZWVlZLU1NLUREKS4gKi9cbiAgc3BlbnRfb246IHN0cmluZ1xuICBub3RlOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1VzZXIgPSBJbnNlcnRhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBVc2VyVXBkYXRlID0gVXBkYXRlYWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBDYXRlZ29yeSA9IFNlbGVjdGFibGU8Q2F0ZWdvcmllc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3Q2F0ZWdvcnkgPSBJbnNlcnRhYmxlPENhdGVnb3JpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIENhdGVnb3J5VXBkYXRlID0gVXBkYXRlYWJsZTxDYXRlZ29yaWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEV4cGVuc2UgPSBTZWxlY3RhYmxlPEV4cGVuc2VzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdFeHBlbnNlID0gSW5zZXJ0YWJsZTxFeHBlbnNlc1RhYmxlPlxuZXhwb3J0IHR5cGUgRXhwZW5zZVVwZGF0ZSA9IFVwZGF0ZWFibGU8RXhwZW5zZXNUYWJsZT5cbiIsICJpbXBvcnQgeyBEYXRhYmFzZSB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlS3lzZWx5IH0gZnJvbSAnZGVub19hcGlfa2l0L2RiL2NyZWF0ZV9reXNlbHkudHMnXG5cbmV4cG9ydCB7IGVudiB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi9lbnYudHMnXG5cbmV4cG9ydCBjb25zdCBkYiA9IGNyZWF0ZUt5c2VseTxEYXRhYmFzZT4oe1xuICBkZWZhdWx0RGF0YWJhc2U6ICdzcGVuZG1hbmFnZXInLFxufSlcbiIsICJleHBvcnQgY2xhc3MgSW52YWxpZENhdGVnb3J5RXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpXG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRDYXRlZ29yeUVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkRXhwZW5zZUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKVxuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkRXhwZW5zZUVycm9yJ1xuICB9XG59XG5cbmNvbnN0IEhFWF9DT0xPUiA9IC9eI1swLTlBLUZhLWZdezZ9JC9cbmNvbnN0IERBVEVfT05MWSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kL1xuY29uc3QgQ1VSUkVOQ1kgPSAvXltBLVpdezN9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENhdGVnb3J5RXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ2F0ZWdvcnlFcnJvcignbmFtZSBpcyB0b28gbG9uZycpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2F0ZWdvcnlDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IGNvbG9yLnRyaW0oKVxuICBpZiAoIUhFWF9DT0xPUi50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDYXRlZ29yeUVycm9yKCdjb2xvciBtdXN0IGJlIGEgaGV4IHZhbHVlIGxpa2UgIzBGNzY2RScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQudG9VcHBlckNhc2UoKVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBbW91bnRDZW50cyhhbW91bnRDZW50czogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUoYW1vdW50Q2VudHMpIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKGFtb3VudENlbnRzKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdhbW91bnRfY2VudHMgbXVzdCBiZSBhbiBpbnRlZ2VyJylcbiAgfVxuICBpZiAoYW1vdW50Q2VudHMgPD0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdhbW91bnRfY2VudHMgbXVzdCBiZSBwb3NpdGl2ZScpXG4gIH1cbiAgcmV0dXJuIGFtb3VudENlbnRzXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUN1cnJlbmN5KGN1cnJlbmN5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gY3VycmVuY3kudHJpbSgpLnRvVXBwZXJDYXNlKClcbiAgaWYgKCFDVVJSRU5DWS50ZXN0KHRyaW1tZWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ2N1cnJlbmN5IG11c3QgYmUgYSAzLWxldHRlciBJU08gY29kZScpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlU3BlbnRPbihzcGVudE9uOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gc3BlbnRPbi50cmltKClcbiAgaWYgKCFEQVRFX09OTFkudGVzdCh0cmltbWVkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkRXhwZW5zZUVycm9yKCdzcGVudF9vbiBtdXN0IGJlIFlZWVktTU0tREQnKVxuICB9XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShgJHt0cmltbWVkfVQwMDowMDowMFpgKVxuICBpZiAoTnVtYmVyLmlzTmFOKGQuZ2V0VGltZSgpKSB8fCBkLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApICE9PSB0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRFeHBlbnNlRXJyb3IoJ3NwZW50X29uIGlzIG5vdCBhIHZhbGlkIGRhdGUnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU5vdGUobm90ZTogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCk6IHN0cmluZyB8IG51bGwge1xuICBpZiAobm90ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBjb25zdCB0cmltbWVkID0gbm90ZS50cmltKClcbiAgcmV0dXJuIHRyaW1tZWQubGVuZ3RoID09PSAwID8gbnVsbCA6IHRyaW1tZWRcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIGFzIHJlc29sdmVMb2NhbFVzZXJLaXQgfSBmcm9tICdkZW5vX2FwaV9raXQvZGIvdXNlcnMudHMnXG5pbXBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9IGZyb20gJ2Rlbm9fYXBpX2tpdC9kYi91c2Vycy50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSB7IEF1dGhJZGVudGl0eSB9XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgcmV0dXJuIHJlc29sdmVMb2NhbFVzZXJLaXQoZGIsIGlkZW50aXR5KVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLFNBQVMsV0FBVzs7O0FDQXBCLFNBQVMsa0JBQWtCO0FBQzNCLFNBQVMsV0FBVzs7O0FDRHBCLE9BQTBFOzs7QUNDMUUsU0FBUyxvQkFBb0I7QUFFN0IsU0FBUyxXQUFXO0FBRWIsSUFBTSxLQUFLLGFBQXVCO0FBQUEsRUFDdkMsaUJBQWlCO0FBQ25CLENBQUM7OztBQ1BNLElBQU0sdUJBQU4sY0FBbUMsTUFBTTtBQUFBLEVBQzlDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBRU8sSUFBTSxzQkFBTixjQUFrQyxNQUFNO0FBQUEsRUFDN0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFFQSxJQUFNLFlBQVk7QUFDbEIsSUFBTSxZQUFZO0FBQ2xCLElBQU0sV0FBVztBQUVWLFNBQVMscUJBQXFCLE1BQXNCO0FBQ3pELFFBQU0sVUFBVSxLQUFLLEtBQUs7QUFDMUIsTUFBSSxDQUFDLFNBQVM7QUFDWixVQUFNLElBQUkscUJBQXFCLGtCQUFrQjtBQUFBLEVBQ25EO0FBQ0EsTUFBSSxRQUFRLFNBQVMsS0FBSztBQUN4QixVQUFNLElBQUkscUJBQXFCLGtCQUFrQjtBQUFBLEVBQ25EO0FBQ0EsU0FBTztBQUNUO0FB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
