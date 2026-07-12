// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import "kysely";
import { getContext } from "@getcronit/pylon";

// src/db/types/schema.ts
import "kysely";

// src/db/database.ts
import { Pool } from "pg";
import { Kysely, PostgresDialect } from "kysely";
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

// src/graphql/validation.ts
var InvalidActivityScheduleError = class extends Error {
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

// src/graphql/resolvers/resolvers.ts
function requireUserId() {
  const userId = getContext().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}
function parseConfig(config2) {
  try {
    return typeof config2 === "string" ? JSON.parse(config2) : config2;
  } catch {
    return null;
  }
}
async function fetchRecurrencePattern(activityId) {
  return await db.selectFrom("recurrence_patterns").where("activity_id", "=", activityId).selectAll().executeTakeFirst();
}
function withRecurrencePattern(activity) {
  return {
    ...activity,
    recurrencePattern: async () => {
      if (!activity.is_recurring) return null;
      const pattern = await fetchRecurrencePattern(activity.id);
      if (!pattern) return null;
      const config2 = parseConfig(pattern.config);
      if (!config2) return null;
      return { ...pattern, config: config2 };
    }
  };
}
var Query = {
  activities: async (args) => {
    const userId = requireUserId();
    const rows = await db.selectFrom("activities").where("user_id", "=", userId).selectAll().execute();
    return rows.map(withRecurrencePattern);
  },
  activity: async (args) => {
    const userId = requireUserId();
    const { id } = args;
    const row = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withRecurrencePattern(row) : null;
  }
};
var Mutation = {
  createActivity: async (args) => {
    const { input } = args;
    const userId = requireUserId();
    validateActivitySchedule({
      isRecurring: input.isRecurring,
      date: input.date,
      recurrencePattern: input.recurrencePattern
    });
    const activity = await db.transaction().execute(async (trx) => {
      const activity2 = await trx.insertInto("activities").values({
        user_id: userId,
        title: input.title,
        description: input.description,
        start_time: input.startTime,
        end_time: input.endTime,
        is_recurring: input.isRecurring,
        date: input.isRecurring ? null : input.date ?? null
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
    return withRecurrencePattern(activity);
  },
  updateActivity: async (args) => {
    const { id, input } = args;
    const userId = requireUserId();
    const existing = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirstOrThrow();
    const isRecurring = input.isRecurring ?? existing.is_recurring;
    const date = input.date !== void 0 ? input.date : existing.date;
    let recurrencePattern = input.recurrencePattern;
    if (isRecurring && !recurrencePattern) {
      const existingPattern = await fetchRecurrencePattern(id);
      if (existingPattern) {
        const config2 = parseConfig(existingPattern.config);
        recurrencePattern = config2 ? { recurrenceType: existingPattern.recurrence_type, config: config2 } : void 0;
      }
    }
    validateActivitySchedule({ isRecurring, date, recurrencePattern });
    const activity = await db.transaction().execute(async (trx) => {
      const activity2 = await trx.updateTable("activities").set({
        title: input.title,
        description: input.description,
        start_time: input.startTime,
        end_time: input.endTime,
        is_recurring: isRecurring,
        date: isRecurring ? null : date ?? null,
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
    return withRecurrencePattern(activity);
  },
  deleteActivity: async (args) => {
    const { id } = args;
    const userId = requireUserId();
    const result = await db.deleteFrom("activities").where("id", "=", id).where("user_id", "=", userId).execute();
    return result.length > 0;
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
  if (ctx.req.method === "OPTIONS") {
    await next();
    return;
  }
  const path = new URL(ctx.req.url).pathname;
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
  typeDefs: "input ArgsInput {\n	id: Number!\n}\ninput ArgsInput_1 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_2 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ntype Query {\nactivities(args: Object): [Activities!]!\nactivity(args: ArgsInput!): Activities\n}\ntype Activities {\nrecurrencePattern: ParsedRecurrencePattern\nuser_id: Number!\nid: Number!\ntitle: String!\ndescription: String\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\ncreated_at: Date!\nupdated_at: Date!\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype Mutation {\ncreateActivity(args: ArgsInput_1!): Activities!\nupdateActivity(args: ArgsInput_2!): Activities!\ndeleteActivity(args: ArgsInput_3!): Boolean!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dyYXBocWwvdmFsaWRhdGlvbi50cyIsICIuLi9zcmMvYXV0aC92ZXJpZnkudHMiLCAiLi4vc3JjL2RiL3VzZXJzLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBhcHAgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgcmVzb2x2ZXJzIH0gZnJvbSAnLi9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMnXG5pbXBvcnQge1xuICBjb3JzTWlkZGxld2FyZSxcbiAgdW5hdXRob3JpemVkUmVzcG9uc2UsXG4gIHZlcmlmeUFjY2Vzc1Rva2VuLFxufSBmcm9tICcuL2F1dGgvdmVyaWZ5LnRzJ1xuaW1wb3J0IHsgcmVzb2x2ZUxvY2FsVXNlciB9IGZyb20gJy4vZGIvdXNlcnMudHMnXG5cbmFwcC51c2UoY29yc01pZGRsZXdhcmUpXG5cbmFwcC51c2UoYXN5bmMgKGN0eCwgbmV4dCkgPT4ge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIGF3YWl0IG5leHQoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgcGF0aCA9IG5ldyBVUkwoY3R4LnJlcS51cmwpLnBhdGhuYW1lXG4gIGlmIChwYXRoICE9PSAnL2dyYXBocWwnICYmICFwYXRoLmVuZHNXaXRoKCcvZ3JhcGhxbCcpKSB7XG4gICAgYXdhaXQgbmV4dCgpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCB2ZXJpZmllZCA9IGF3YWl0IHZlcmlmeUFjY2Vzc1Rva2VuKGN0eC5yZXEuaGVhZGVyKCdBdXRob3JpemF0aW9uJykpXG4gIGlmICghdmVyaWZpZWQpIHtcbiAgICByZXR1cm4gdW5hdXRob3JpemVkUmVzcG9uc2UoKVxuICB9XG5cbiAgY29uc3QgbG9jYWxVc2VyID0gYXdhaXQgcmVzb2x2ZUxvY2FsVXNlcih7XG4gICAgYXV0aFVzZXJJZDogdmVyaWZpZWQuYXV0aFVzZXJJZCxcbiAgICBlbWFpbDogdmVyaWZpZWQuZW1haWwsXG4gIH0pXG5cbiAgY3R4LnNldCgnYXV0aFVzZXJJZCcsIHZlcmlmaWVkLmF1dGhVc2VySWQpXG4gIGlmICh2ZXJpZmllZC5lbWFpbCkge1xuICAgIGN0eC5zZXQoJ2F1dGhFbWFpbCcsIHZlcmlmaWVkLmVtYWlsKVxuICB9XG4gIGN0eC5zZXQoJ3VzZXJJZCcsIGxvY2FsVXNlci5pZClcblxuICBhd2FpdCBuZXh0KClcbn0pXG5cbmV4cG9ydCBjb25zdCBncmFwaHFsID0ge1xuICAuLi5yZXNvbHZlcnMsXG59XG5cbmV4cG9ydCBkZWZhdWx0IGFwcFxuXG4gICAgICBpbXBvcnQge2hhbmRsZXIgYXMgX19pbnRlcm5hbFB5bG9uSGFuZGxlcn0gZnJvbSBcIkBnZXRjcm9uaXQvcHlsb25cIlxuXG4gICAgICBsZXQgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gdW5kZWZpbmVkXG5cbiAgICAgIHRyeSB7XG4gICAgICAgIF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IGNvbmZpZ1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIC8vIGNvbmZpZyBpcyBub3QgZGVjbGFyZWQsIHB5bG9uQ29uZmlnIHJlbWFpbnMgdW5kZWZpbmVkXG4gICAgICB9XG5cbiAgICAgIGFwcC51c2UoX19pbnRlcm5hbFB5bG9uSGFuZGxlcih7XG4gICAgICAgIHR5cGVEZWZzOiBcImlucHV0IEFyZ3NJbnB1dCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzEge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nXFxuXFx0ZW5kVGltZTogU3RyaW5nXFxuXFx0aXNSZWN1cnJpbmc6IEJvb2xlYW5cXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG50eXBlIFF1ZXJ5IHtcXG5hY3Rpdml0aWVzKGFyZ3M6IE9iamVjdCk6IFtBY3Rpdml0aWVzIV0hXFxuYWN0aXZpdHkoYXJnczogQXJnc0lucHV0ISk6IEFjdGl2aXRpZXNcXG59XFxudHlwZSBBY3Rpdml0aWVzIHtcXG5yZWN1cnJlbmNlUGF0dGVybjogUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm5cXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5zdGFydF90aW1lOiBTdHJpbmchXFxuZW5kX3RpbWU6IFN0cmluZyFcXG5pc19yZWN1cnJpbmc6IEJvb2xlYW4hXFxuZGF0ZTogU3RyaW5nXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBNdXRhdGlvbiB7XFxuY3JlYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzEhKTogQWN0aXZpdGllcyFcXG51cGRhdGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfMiEpOiBBY3Rpdml0aWVzIVxcbmRlbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8zISk6IEJvb2xlYW4hXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gV0VFS0xZX01PTlRITFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gUmVjdXJyZW5jZVR5cGVJbnB1dCB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IE9uQ29uZmxpY3RCdWlsZGVyLCBUcmFuc2FjdGlvbiB9IGZyb20gXCJreXNlbHlcIjtcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiO1xuaW1wb3J0IHsgZGIgfSBmcm9tIFwiLi4vLi4vZGIvZGF0YWJhc2UudHNcIjtcbmltcG9ydCB0eXBlIHtcbiAgQWN0aXZpdHkgYXMgQWN0aXZpdHlSb3csXG4gIERhdGFiYXNlLFxuICBOZXdBY3Rpdml0eSxcbiAgTmV3UmVjdXJyZW5jZVBhdHRlcm4sXG4gIFJlY3VycmVuY2VQYXR0ZXJuIGFzIFJlY3VycmVuY2VQYXR0ZXJuUm93LFxufSBmcm9tIFwiLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzXCI7XG5pbXBvcnQgeyBDcmVhdGVBY3Rpdml0eUlucHV0LCBSZWN1cnJlbmNlQ29uZmlnLCBSZWN1cnJlbmNlUGF0dGVybklucHV0LCBVcGRhdGVBY3Rpdml0eUlucHV0IH0gZnJvbSBcIi4uL3R5cGVzLnRzXCI7XG5pbXBvcnQgeyB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUgfSBmcm9tIFwiLi4vdmFsaWRhdGlvbi50c1wiO1xuXG5pbnRlcmZhY2UgUGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gZXh0ZW5kcyBPbWl0PFJlY3VycmVuY2VQYXR0ZXJuUm93LCBcImNvbmZpZ1wiPiB7XG4gIGNvbmZpZzogUmVjdXJyZW5jZUNvbmZpZztcbn1cblxuZnVuY3Rpb24gcmVxdWlyZVVzZXJJZCgpOiBudW1iZXIge1xuICBjb25zdCB1c2VySWQgPSBnZXRDb250ZXh0KCkuZ2V0KFwidXNlcklkXCIpO1xuICBpZiAodHlwZW9mIHVzZXJJZCAhPT0gXCJudW1iZXJcIikge1xuICAgIHRocm93IG5ldyBFcnJvcihcIlVuYXV0aGVudGljYXRlZFwiKTtcbiAgfVxuICByZXR1cm4gdXNlcklkO1xufVxuXG5mdW5jdGlvbiBwYXJzZUNvbmZpZyhjb25maWc6IFJlY3VycmVuY2VQYXR0ZXJuUm93W1wiY29uZmlnXCJdKTogUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwge1xuICB0cnkge1xuICAgIHJldHVybiB0eXBlb2YgY29uZmlnID09PSBcInN0cmluZ1wiID8gSlNPTi5wYXJzZShjb25maWcpIDogY29uZmlnO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGFjdGl2aXR5SWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHlJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vLyBQeWxvbiByZXNvbHZlcyBuZXN0ZWQgR3JhcGhRTCBmaWVsZHMgZnJvbSAocG9zc2libHkgYXN5bmMpIHByb3BlcnRpZXMgb25cbi8vIHRoZSByZXR1cm5lZCBvYmplY3QsIG5vdCBmcm9tIGEgc2VwYXJhdGUgcmVzb2x2ZXIgbWFwIFx1MjAxNCBzbyByZWN1cnJlbmNlIGRhdGFcbi8vIGlzIGF0dGFjaGVkIGlubGluZSBoZXJlIHJhdGhlciB0aGFuIHZpYSBhIHN0YW5kYWxvbmUgcmVzb2x2ZXIgZXhwb3J0LlxuZnVuY3Rpb24gd2l0aFJlY3VycmVuY2VQYXR0ZXJuKGFjdGl2aXR5OiBBY3Rpdml0eVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLmFjdGl2aXR5LFxuICAgIHJlY3VycmVuY2VQYXR0ZXJuOiBhc3luYyAoKTogUHJvbWlzZTxQYXJzZWRSZWN1cnJlbmNlUGF0dGVybiB8IG51bGw+ID0+IHtcbiAgICAgIGlmICghYWN0aXZpdHkuaXNfcmVjdXJyaW5nKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IHBhdHRlcm4gPSBhd2FpdCBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGFjdGl2aXR5LmlkKTtcbiAgICAgIGlmICghcGF0dGVybikgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBjb25maWcgPSBwYXJzZUNvbmZpZyhwYXR0ZXJuLmNvbmZpZyk7XG4gICAgICBpZiAoIWNvbmZpZykgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyAuLi5wYXR0ZXJuLCBjb25maWcgfTtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGFjdGl2aXRpZXM6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhSZWN1cnJlbmNlUGF0dGVybik7XG4gIH0sXG4gIGFjdGl2aXR5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2FjdGl2aXRpZXMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIHJldHVybiByb3cgPyB3aXRoUmVjdXJyZW5jZVBhdHRlcm4ocm93KSA6IG51bGw7XG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBNdXRhdGlvbiA9IHtcbiAgY3JlYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKHtcbiAgICAgIGlzUmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgIGRhdGU6IGlucHV0LmRhdGUsXG4gICAgICByZWN1cnJlbmNlUGF0dGVybjogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4sXG4gICAgfSk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKCdhY3Rpdml0aWVzJylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgc3RhcnRfdGltZTogaW5wdXQuc3RhcnRUaW1lLFxuICAgICAgICAgIGVuZF90aW1lOiBpbnB1dC5lbmRUaW1lLFxuICAgICAgICAgIGlzX3JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICAgICAgZGF0ZTogaW5wdXQuaXNSZWN1cnJpbmcgPyBudWxsIDogKGlucHV0LmRhdGUgPz8gbnVsbCksXG4gICAgICAgIH0gYXMgTmV3QWN0aXZpdHkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlucHV0LmlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3JlY3VycmVuY2VfcGF0dGVybnMnKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkpO1xuICB9LFxuXG4gIHVwZGF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkLCBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBpZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IGlzUmVjdXJyaW5nID0gaW5wdXQuaXNSZWN1cnJpbmcgPz8gZXhpc3RpbmcuaXNfcmVjdXJyaW5nO1xuICAgIGNvbnN0IGRhdGUgPSBpbnB1dC5kYXRlICE9PSB1bmRlZmluZWQgPyBpbnB1dC5kYXRlIDogZXhpc3RpbmcuZGF0ZTtcblxuICAgIC8vIElmIHRoZSBzY2hlZHVsZSBpcyBzdGlsbCByZWN1cnJpbmcgYW5kIG5vIG5ldyBwYXR0ZXJuIHdhcyBzdXBwbGllZCxcbiAgICAvLyB2YWxpZGF0ZSBhZ2FpbnN0IHRoZSBwYXR0ZXJuIGFscmVhZHkgb24gZmlsZS5cbiAgICBsZXQgcmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm47XG4gICAgaWYgKGlzUmVjdXJyaW5nICYmICFyZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgY29uc3QgZXhpc3RpbmdQYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihpZCk7XG4gICAgICBpZiAoZXhpc3RpbmdQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKGV4aXN0aW5nUGF0dGVybi5jb25maWcpO1xuICAgICAgICByZWN1cnJlbmNlUGF0dGVybiA9IGNvbmZpZ1xuICAgICAgICAgID8geyByZWN1cnJlbmNlVHlwZTogZXhpc3RpbmdQYXR0ZXJuLnJlY3VycmVuY2VfdHlwZSwgY29uZmlnIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoeyBpc1JlY3VycmluZywgZGF0ZSwgcmVjdXJyZW5jZVBhdHRlcm4gfSk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZSgnYWN0aXZpdGllcycpXG4gICAgICAgIC5zZXQoe1xuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgc3RhcnRfdGltZTogaW5wdXQuc3RhcnRUaW1lLFxuICAgICAgICAgIGVuZF90aW1lOiBpbnB1dC5lbmRUaW1lLFxuICAgICAgICAgIGlzX3JlY3VycmluZzogaXNSZWN1cnJpbmcsXG4gICAgICAgICAgZGF0ZTogaXNSZWN1cnJpbmcgPyBudWxsIDogKGRhdGUgPz8gbnVsbCksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBpZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oJ3JlY3VycmVuY2VfcGF0dGVybnMnKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5vbkNvbmZsaWN0KChvYzogT25Db25mbGljdEJ1aWxkZXI8YW55LCBhbnk+KSA9PlxuICAgICAgICAgICAgb2MuY29sdW1ucyhbJ2FjdGl2aXR5X2lkJ10pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEucmVjdXJyZW5jZVR5cGUsXG4gICAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4hLmNvbmZpZyksXG4gICAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9IGVsc2UgaWYgKCFpc1JlY3VycmluZykge1xuICAgICAgICAvLyBDbGVhbiB1cCBhbnkgc3RhbGUgcGF0dGVybiBvbmNlIGFuIGFjdGl2aXR5IHN0b3BzIHJlY3VycmluZy5cbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oJ3JlY3VycmVuY2VfcGF0dGVybnMnKVxuICAgICAgICAgIC53aGVyZSgnYWN0aXZpdHlfaWQnLCAnPScsIGFjdGl2aXR5LmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBhY3Rpdml0eTtcbiAgICB9KTtcblxuICAgIHJldHVybiB3aXRoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkpO1xuICB9LFxuXG4gIGRlbGV0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpZDogbnVtYmVyIH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxufVxuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vLyBNYWluIERhdGFiYXNlIGludGVyZmFjZSB0aGF0IGRlc2NyaWJlcyBhbGwgdGFibGVzXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgYWN0aXZpdGllczogQWN0aXZpdGllc1RhYmxlXG4gIHJlY3VycmVuY2VfcGF0dGVybnM6IFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlXG4gIGFjdGl2aXR5X2NvbXBsZXRpb25zOiBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGVcbn1cblxuLy8gVXNlcnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXRpZXMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIEFjdGl2aXRpZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgdGl0bGU6IHN0cmluZ1xuICBkZXNjcmlwdGlvbjogc3RyaW5nIHwgbnVsbFxuICBzdGFydF90aW1lOiBzdHJpbmcgLy8gVGltZSBvZiBkYXkgaW4gSEg6bW0gZm9ybWF0XG4gIGVuZF90aW1lOiBzdHJpbmcgLy8gVGltZSBvZiBkYXkgaW4gSEg6bW0gZm9ybWF0XG4gIGlzX3JlY3VycmluZzogYm9vbGVhblxuICAvLyBDYWxlbmRhciBkYXRlIHRoZSBhY3Rpdml0eSBvY2N1cnMgb24uIFJlcXVpcmVkIHdoZW4gaXNfcmVjdXJyaW5nIGlzXG4gIC8vIGZhbHNlOyBudWxsIHdoZW4gaXNfcmVjdXJyaW5nIGlzIHRydWUgKGRhdGVzIGxpdmUgaW4gdGhlIHJlY3VycmVuY2VcbiAgLy8gcGF0dGVybidzIGNvbmZpZyBpbnN0ZWFkKS5cbiAgZGF0ZTogc3RyaW5nIHwgbnVsbFxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIFJlY3VycmVuY2UgcGF0dGVybnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgLy8gVHlwZSBvZiByZWN1cnJlbmNlOiB3ZWVrbHksIG1vbnRobHksIG9yIGV2ZXJ5IFggZGF5c1xuICByZWN1cnJlbmNlX3R5cGU6ICd3ZWVrbHknIHwgJ21vbnRobHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgLy8gSlNPTiBjb25maWd1cmF0aW9uIGZvciB0aGUgcmVjdXJyZW5jZVxuICBjb25maWc6IENvbHVtblR5cGU8e1xuICAgIC8vIEZvciB3ZWVrbHk6IGFycmF5IG9mIGRheXMgKDAtNiwgd2hlcmUgMCBpcyBTdW5kYXkpXG4gICAgZGF5c19vZl93ZWVrPzogbnVtYmVyW11cbiAgICAvLyBGb3IgbW9udGhseTogZGF5cyBvZiB0aGUgbW9udGggKDEtMzEpXG4gICAgZGF5c19vZl9tb250aD86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGFsc28gcmVwZWF0IG9uIHRoZSBsYXN0IGRheSBvZiB0aGUgbW9udGguIEtlcHQgYXMgaXRzXG4gICAgLy8gb3duIGJvb2xlYW4gKHJhdGhlciB0aGFuIGEgJ2xhc3QnIHNlbnRpbmVsIGluIGRheXNfb2ZfbW9udGgpIGJlY2F1c2VcbiAgICAvLyBQeWxvbi9HcmFwaFFMIGlucHV0IHR5cGVzIGNhbid0IHJlcHJlc2VudCBhIG51bWJlcnxzdHJpbmcgdW5pb24uXG4gICAgaXNfbGFzdF9kYXlfb2ZfbW9udGg/OiBib29sZWFuXG4gICAgLy8gRm9yIGV2ZXJ5X3hfZGF5czogcmVwZWF0IGV2ZXJ5IE4gZGF5cyAoPj0gMSlcbiAgICBpbnRlcnZhbF9kYXlzPzogbnVtYmVyXG4gICAgLy8gU3RhcnQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZVxuICAgIHN0YXJ0X2RhdGU6IHN0cmluZ1xuICAgIC8vIEVuZCBkYXRlIG9mIHRoZSByZWN1cnJlbmNlIChvcHRpb25hbClcbiAgICBlbmRfZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgfSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdHkgY29tcGxldGlvbnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIGNvbXBsZXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICAvLyBTdG9yZSBhbnkgYWRkaXRpb25hbCBkYXRhIGFib3V0IHRoZSBjb21wbGV0aW9uXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPHtcbiAgICB0aXRsZTogc3RyaW5nXG4gICAgbm90ZXM/OiBzdHJpbmdcbiAgICBkdXJhdGlvbj86IG51bWJlciAvLyBhY3R1YWwgZHVyYXRpb24gaW4gbWludXRlc1xuICAgIHRyaWdnZXJfZXZlbnRzPzogc3RyaW5nW10gLy8gYXJyYXkgb2YgZXZlbnQgaWRlbnRpZmllcnMgdGhhdCB3ZXJlIHRyaWdnZXJlZFxuICB9IHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbn1cblxuLy8gRXhwb3J0IGNvbnZlbmllbmNlIHR5cGVzIGZvciBlYWNoIHRhYmxlXG5leHBvcnQgdHlwZSBVc2VyID0gU2VsZWN0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3VXNlciA9IEluc2VydGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIFVzZXJVcGRhdGUgPSBVcGRhdGVhYmxlPFVzZXJzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5ID0gU2VsZWN0YWJsZTxBY3Rpdml0aWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eSA9IEluc2VydGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlVcGRhdGUgPSBVcGRhdGVhYmxlPEFjdGl2aXRpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm4gPSBTZWxlY3RhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmVjdXJyZW5jZVBhdHRlcm4gPSBJbnNlcnRhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm5VcGRhdGUgPSBVcGRhdGVhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eUNvbXBsZXRpb24gPSBTZWxlY3RhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0FjdGl2aXR5Q29tcGxldGlvbiA9IEluc2VydGFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+ICAiLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IFBvb2wgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuXG5jb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gIHBvb2w6IG5ldyBQb29sKHtcbiAgICBkYXRhYmFzZTogJ3RpbWVtYW5hZ2VyJyxcbiAgICBob3N0OiAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IDU0MzIsXG4gICAgbWF4OiAxMCxcbiAgfSlcbn0pXG5cbi8vIERhdGFiYXNlIGludGVyZmFjZSBpcyBwYXNzZWQgdG8gS3lzZWx5J3MgY29uc3RydWN0b3IsIGFuZCBmcm9tIG5vdyBvbiwgS3lzZWx5IFxuLy8ga25vd3MgeW91ciBkYXRhYmFzZSBzdHJ1Y3R1cmUuXG4vLyBEaWFsZWN0IGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLCBLeXNlbHkga25vd3MgaG93IFxuLy8gdG8gY29tbXVuaWNhdGUgd2l0aCB5b3VyIGRhdGFiYXNlLlxuZXhwb3J0IGNvbnN0IGRiID0gbmV3IEt5c2VseTxEYXRhYmFzZT4oe1xuICBkaWFsZWN0LFxufSkiLCAiaW1wb3J0IHsgUmVjdXJyZW5jZUNvbmZpZywgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB9IGZyb20gJy4vdHlwZXMudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuaW50ZXJmYWNlIEFjdGl2aXR5U2NoZWR1bGUge1xuICBpc1JlY3VycmluZzogYm9vbGVhblxuICBkYXRlPzogc3RyaW5nIHwgbnVsbFxuICByZWN1cnJlbmNlUGF0dGVybj86IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoYXQgYW4gYWN0aXZpdHkncyBzY2hlZHVsZSBpcyBpbnRlcm5hbGx5IGNvbnNpc3RlbnQ6XG4gKiAtIE5vbi1yZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSBgZGF0ZWAgYW5kIG5vIHJlY3VycmVuY2UgcGF0dGVybi5cbiAqIC0gUmVjdXJyaW5nIGFjdGl2aXRpZXMgbXVzdCBoYXZlIGEgcmVjdXJyZW5jZSBwYXR0ZXJuIChhbmQgbm8gYGRhdGVgKSxcbiAqICAgd2l0aCBjb25maWcgZmllbGRzIG1hdGNoaW5nIHRoZSBjaG9zZW4gcmVjdXJyZW5jZSB0eXBlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKGlucHV0OiBBY3Rpdml0eVNjaGVkdWxlKTogdm9pZCB7XG4gIGlmICghaW5wdXQuaXNSZWN1cnJpbmcpIHtcbiAgICBpZiAoIWlucHV0LmRhdGUpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICAnZGF0ZSBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIGZhbHNlJyxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoIWlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4gaXMgcmVxdWlyZWQgd2hlbiBpc1JlY3VycmluZyBpcyB0cnVlJyxcbiAgICApXG4gIH1cblxuICBjb25zdCB7IHJlY3VycmVuY2VUeXBlLCBjb25maWcgfSA9IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuXG4gIGlmICghY29uZmlnIHx8ICFjb25maWcuc3RhcnRfZGF0ZSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ3JlY3VycmVuY2VQYXR0ZXJuLmNvbmZpZy5zdGFydF9kYXRlIGlzIHJlcXVpcmVkJyxcbiAgICApXG4gIH1cblxuICBzd2l0Y2ggKHJlY3VycmVuY2VUeXBlKSB7XG4gICAgY2FzZSAnd2Vla2x5JzpcbiAgICAgIHZhbGlkYXRlRGF5c09mV2Vlayhjb25maWcuZGF5c19vZl93ZWVrKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdtb250aGx5JzpcbiAgICAgIHZhbGlkYXRlRGF5c09mTW9udGgoY29uZmlnLmRheXNfb2ZfbW9udGgsIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnZXZlcnlfeF9kYXlzJzpcbiAgICAgIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGNvbmZpZy5pbnRlcnZhbF9kYXlzKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgIGBVbnN1cHBvcnRlZCByZWN1cnJlbmNlVHlwZTogJHtyZWN1cnJlbmNlVHlwZX1gLFxuICAgICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mV2VlayhkYXlzT2ZXZWVrOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX3dlZWsnXSk6IHZvaWQge1xuICBpZiAoIWRheXNPZldlZWsgfHwgZGF5c09mV2Vlay5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIGlzIHJlcXVpcmVkIGZvciB3ZWVrbHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChkYXlzT2ZXZWVrLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAwIHx8IGRheSA+IDYpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2Zfd2VlayBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAwIChTdW5kYXkpIGFuZCA2IChTYXR1cmRheSknLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURheXNPZk1vbnRoKFxuICBkYXlzT2ZNb250aDogUmVjdXJyZW5jZUNvbmZpZ1snZGF5c19vZl9tb250aCddLFxuICBpc0xhc3REYXlPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydpc19sYXN0X2RheV9vZl9tb250aCddLFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhc0RheXNPZk1vbnRoID0gISFkYXlzT2ZNb250aCAmJiBkYXlzT2ZNb250aC5sZW5ndGggPiAwXG4gIGlmICghaGFzRGF5c09mTW9udGggJiYgIWlzTGFzdERheU9mTW9udGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBvciBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGggaXMgcmVxdWlyZWQgZm9yIG1vbnRobHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChcbiAgICBoYXNEYXlzT2ZNb250aCAmJlxuICAgIGRheXNPZk1vbnRoIS5zb21lKChkYXkpID0+ICFOdW1iZXIuaXNJbnRlZ2VyKGRheSkgfHwgZGF5IDwgMSB8fCBkYXkgPiAzMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2ZfbW9udGggbXVzdCBjb250YWluIGludGVnZXJzIGJldHdlZW4gMSBhbmQgMzEnLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUludGVydmFsRGF5cyhpbnRlcnZhbERheXM6IFJlY3VycmVuY2VDb25maWdbJ2ludGVydmFsX2RheXMnXSk6IHZvaWQge1xuICBpZiAoXG4gICAgaW50ZXJ2YWxEYXlzID09PSB1bmRlZmluZWQgfHxcbiAgICBpbnRlcnZhbERheXMgPT09IG51bGwgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihpbnRlcnZhbERheXMpIHx8XG4gICAgaW50ZXJ2YWxEYXlzIDwgMVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuaW50ZXJ2YWxfZGF5cyBtdXN0IGJlIGFuIGludGVnZXIgPj0gMSBmb3IgZXZlcnlfeF9kYXlzIHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbi8vIFB5bG9uIHNlcnZlcyB0aGUgYnVpbHQgYXBwIHdpdGggQnVuL05vZGUgXHUyMDE0IHVzZSBwcm9jZXNzLmVudiwgbm90IERlbm8uZW52LlxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLFdBQVc7OztBQ0FwQixPQUErQztBQUMvQyxTQUFTLGtCQUFrQjs7O0FDRDNCLE9BQTBFOzs7QUNDMUUsU0FBUyxZQUFZO0FBQ3JCLFNBQVMsUUFBUSx1QkFBdUI7QUFFeEMsSUFBTSxVQUFVLElBQUksZ0JBQWdCO0FBQUEsRUFDbEMsTUFBTSxJQUFJLEtBQUs7QUFBQSxJQUNiLFVBQVU7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFVBQVU7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLEtBQUs7QUFBQSxFQUNQLENBQUM7QUFDSCxDQUFDO0FBTU0sSUFBTSxLQUFLLElBQUksT0FBaUI7QUFBQSxFQUNyQztBQUNGLENBQUM7OztBQ25CTSxJQUFNLCtCQUFOLGNBQTJDLE1BQU07QUFBQztBQWNsRCxTQUFTLHlCQUF5QixPQUErQjtBQUN0RSxNQUFJLENBQUMsTUFBTSxhQUFhO0FBQ3RCLFFBQUksQ0FBQyxNQUFNLE1BQU07QUFDZixZQUFNLElBQUk7QUFBQSxRQUNSO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFDQTtBQUFBLEVBQ0Y7QUFFQSxNQUFJLENBQUMsTUFBTSxtQkFBbUI7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBRUEsUUFBTSxFQUFFLGdCQUFnQixRQUFBQSxRQUFPLElBQUksTUFBTTtBQUN6QyxNQUFJLENBQUNBLFdBQVUsQ0FBQ0EsUUFBTyxZQUFZO0FBQ2pDLFVBQU0sSUFBSTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUVBLFVBQVEsZ0JBQWdCO0FBQUEsSUFDdEIsS0FBSztB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
