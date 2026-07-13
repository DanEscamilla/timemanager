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
function withActivityRelations(activity) {
  return {
    ...activity,
    recurrencePattern: async () => {
      if (!activity.is_recurring) return null;
      const pattern = await fetchRecurrencePattern(activity.id);
      if (!pattern) return null;
      const config2 = parseConfig(pattern.config);
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
    const userId = requireUserId();
    return await db.selectFrom("groups").where("user_id", "=", userId).orderBy("name", "asc").selectAll().execute();
  },
  group: async (args) => {
    const userId = requireUserId();
    const { id } = args;
    return await db.selectFrom("groups").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst() ?? null;
  },
  activities: async (args) => {
    const userId = requireUserId();
    const rows = await db.selectFrom("activities").where("user_id", "=", userId).selectAll().execute();
    return rows.map(withActivityRelations);
  },
  activity: async (args) => {
    const userId = requireUserId();
    const { id } = args;
    const row = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withActivityRelations(row) : null;
  }
};
var Mutation = {
  createGroup: async (args) => {
    const { input } = args;
    const userId = requireUserId();
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
    const userId = requireUserId();
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
    const userId = requireUserId();
    const result = await db.deleteFrom("groups").where("id", "=", id).where("user_id", "=", userId).execute();
    return result.length > 0;
  },
  createActivity: async (args) => {
    const { input } = args;
    const userId = requireUserId();
    validateActivitySchedule({
      isRecurring: input.isRecurring,
      date: input.date,
      recurrencePattern: input.recurrencePattern
    });
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
        group_id: groupId ?? null
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
    const resolvedGroupId = input.groupId !== void 0 ? await resolveGroupId(input.groupId, userId) : void 0;
    const activity = await db.transaction().execute(async (trx) => {
      const activity2 = await trx.updateTable("activities").set({
        title: input.title,
        description: input.description,
        start_time: input.startTime,
        end_time: input.endTime,
        is_recurring: isRecurring,
        date: isRecurring ? null : date ?? null,
        ...resolvedGroupId !== void 0 ? { group_id: resolvedGroupId } : {},
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
  typeDefs: "input ArgsInput {\n	id: Number!\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	input: CreateGroupInputInput!\n}\ninput CreateGroupInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_3 {\n	id: Number!\n	input: UpdateGroupInputInput!\n}\ninput UpdateGroupInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_4 {\n	id: Number!\n}\ninput ArgsInput_5 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_6 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n}\ninput ArgsInput_7 {\n	id: Number!\n}\ntype Query {\ngroups(args: Object): [Groups!]!\ngroup(args: ArgsInput!): Groups\nactivities(args: Object): [Activities!]!\nactivity(args: ArgsInput_1!): Activities\n}\ntype Groups {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Activities {\nrecurrencePattern: ParsedRecurrencePattern\ngroup: Group\nuser_id: Number!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\ngroup_id: Number\ntitle: String!\ndescription: String\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype Group {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype Mutation {\ncreateGroup(args: ArgsInput_2!): CreateGroup!\nupdateGroup(args: ArgsInput_3!): CreateGroup!\ndeleteGroup(args: ArgsInput_4!): Boolean!\ncreateActivity(args: ArgsInput_5!): Activities!\nupdateActivity(args: ArgsInput_6!): Activities!\ndeleteActivity(args: ArgsInput_7!): Boolean!\n}\ntype CreateGroup {\nuser_id: Number!\nid: Number!\nname: String!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9hdXRoL3ZlcmlmeS50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGFwcCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7XG4gIGNvcnNNaWRkbGV3YXJlLFxuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG59IGZyb20gJy4vYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcblxuYXBwLnVzZShhc3luYyAoY3R4LCBuZXh0KSA9PiB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgYXdhaXQgbmV4dCgpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgaWYgKCF2ZXJpZmllZCkge1xuICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gIH1cblxuICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHtcbiAgICBhdXRoVXNlcklkOiB2ZXJpZmllZC5hdXRoVXNlcklkLFxuICAgIGVtYWlsOiB2ZXJpZmllZC5lbWFpbCxcbiAgfSlcblxuICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgaWYgKHZlcmlmaWVkLmVtYWlsKSB7XG4gICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gIH1cbiAgY3R4LnNldCgndXNlcklkJywgbG9jYWxVc2VyLmlkKVxuXG4gIGF3YWl0IG5leHQoKVxufSlcblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQXJnc0lucHV0IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGlucHV0OiBDcmVhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nXFxuXFx0ZW5kVGltZTogU3RyaW5nXFxuXFx0aXNSZWN1cnJpbmc6IEJvb2xlYW5cXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG50eXBlIFF1ZXJ5IHtcXG5ncm91cHMoYXJnczogT2JqZWN0KTogW0dyb3VwcyFdIVxcbmdyb3VwKGFyZ3M6IEFyZ3NJbnB1dCEpOiBHcm91cHNcXG5hY3Rpdml0aWVzKGFyZ3M6IE9iamVjdCk6IFtBY3Rpdml0aWVzIV0hXFxuYWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzEhKTogQWN0aXZpdGllc1xcbn1cXG50eXBlIEdyb3VwcyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIEFjdGl2aXRpZXMge1xcbnJlY3VycmVuY2VQYXR0ZXJuOiBQYXJzZWRSZWN1cnJlbmNlUGF0dGVyblxcbmdyb3VwOiBHcm91cFxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5ncm91cF9pZDogTnVtYmVyXFxudGl0bGU6IFN0cmluZyFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxuc3RhcnRfdGltZTogU3RyaW5nIVxcbmVuZF90aW1lOiBTdHJpbmchXFxuaXNfcmVjdXJyaW5nOiBCb29sZWFuIVxcbmRhdGU6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMiEpOiBDcmVhdGVHcm91cCFcXG51cGRhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMyEpOiBDcmVhdGVHcm91cCFcXG5kZWxldGVHcm91cChhcmdzOiBBcmdzSW5wdXRfNCEpOiBCb29sZWFuIVxcbmNyZWF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF81ISk6IEFjdGl2aXRpZXMhXFxudXBkYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzYhKTogQWN0aXZpdGllcyFcXG5kZWxldGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfNyEpOiBCb29sZWFuIVxcbn1cXG50eXBlIENyZWF0ZUdyb3VwIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gV0VFS0xZX01PTlRITFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gUmVjdXJyZW5jZVR5cGVJbnB1dCB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IE9uQ29uZmxpY3RCdWlsZGVyLCBUcmFuc2FjdGlvbiB9IGZyb20gXCJreXNlbHlcIjtcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiO1xuaW1wb3J0IHsgZGIgfSBmcm9tIFwiLi4vLi4vZGIvZGF0YWJhc2UudHNcIjtcbmltcG9ydCB0eXBlIHtcbiAgQWN0aXZpdHkgYXMgQWN0aXZpdHlSb3csXG4gIERhdGFiYXNlLFxuICBHcm91cCBhcyBHcm91cFJvdyxcbiAgTmV3QWN0aXZpdHksXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7XG4gIENyZWF0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUdyb3VwSW5wdXQsXG4gIFJlY3VycmVuY2VDb25maWcsXG4gIFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQsXG4gIFVwZGF0ZUFjdGl2aXR5SW5wdXQsXG4gIFVwZGF0ZUdyb3VwSW5wdXQsXG59IGZyb20gXCIuLi90eXBlcy50c1wiO1xuaW1wb3J0IHtcbiAgSW52YWxpZEdyb3VwRXJyb3IsXG4gIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSxcbiAgdmFsaWRhdGVHcm91cENvbG9yLFxuICB2YWxpZGF0ZUdyb3VwTmFtZSxcbn0gZnJvbSBcIi4uL3ZhbGlkYXRpb24udHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbi8vIFB5bG9uIHJlc29sdmVzIG5lc3RlZCBHcmFwaFFMIGZpZWxkcyBmcm9tIChwb3NzaWJseSBhc3luYykgcHJvcGVydGllcyBvblxuLy8gdGhlIHJldHVybmVkIG9iamVjdCwgbm90IGZyb20gYSBzZXBhcmF0ZSByZXNvbHZlciBtYXAgXHUyMDE0IHNvIG5lc3RlZCBkYXRhIGlzXG4vLyBhdHRhY2hlZCBpbmxpbmUgaGVyZSByYXRoZXIgdGhhbiB2aWEgYSBzdGFuZGFsb25lIHJlc29sdmVyIGV4cG9ydC5cbmZ1bmN0aW9uIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eTogQWN0aXZpdHlSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5hY3Rpdml0eSxcbiAgICByZWN1cnJlbmNlUGF0dGVybjogYXN5bmMgKCk6IFByb21pc2U8UGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gfCBudWxsPiA9PiB7XG4gICAgICBpZiAoIWFjdGl2aXR5LmlzX3JlY3VycmluZykgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBwYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eS5pZCk7XG4gICAgICBpZiAoIXBhdHRlcm4pIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcocGF0dGVybi5jb25maWcpO1xuICAgICAgaWYgKCFjb25maWcpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgLi4ucGF0dGVybiwgY29uZmlnIH07XG4gICAgfSxcbiAgICBncm91cDogYXN5bmMgKCk6IFByb21pc2U8R3JvdXBSb3cgfCBudWxsPiA9PiB7XG4gICAgICBpZiAoYWN0aXZpdHkuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFjdGl2aXR5Lmdyb3VwX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgZ3JvdXBzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoXCJuYW1lXCIsIFwiYXNjXCIpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH0sXG5cbiAgZ3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICB9LFxuXG4gIGFjdGl2aXRpZXM6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIHJldHVybiByb3dzLm1hcCh3aXRoQWN0aXZpdHlSZWxhdGlvbnMpO1xuICB9LFxuXG4gIGFjdGl2aXR5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgcmV0dXJuIHJvdyA/IHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhyb3cpIDogbnVsbDtcbiAgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBNdXRhdGlvbiA9IHtcbiAgY3JlYXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHcm91cElucHV0IH0pID0+IHtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVHcm91cE5hbWUoaW5wdXQubmFtZSk7XG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpO1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oXCJncm91cHNcIilcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvbG9yLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3R3JvdXApXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9LFxuXG4gIHVwZGF0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlR3JvdXBJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgeyBpZCwgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBjb25zdCBuYW1lID0gaW5wdXQubmFtZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpXG4gICAgICA6IGV4aXN0aW5nLm5hbWU7XG4gICAgY29uc3QgY29sb3IgPSBpbnB1dC5jb2xvciAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICAgIDogZXhpc3RpbmcuY29sb3I7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZShcImdyb3Vwc1wiKVxuICAgICAgLnNldCh7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvbG9yLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICBkZWxldGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDA7XG4gIH0sXG5cbiAgY3JlYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKHtcbiAgICAgIGlzUmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgIGRhdGU6IGlucHV0LmRhdGUsXG4gICAgICByZWN1cnJlbmNlUGF0dGVybjogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4sXG4gICAgfSk7XG5cbiAgICBjb25zdCBncm91cElkID0gYXdhaXQgcmVzb2x2ZUdyb3VwSWQoaW5wdXQuZ3JvdXBJZCA/PyBudWxsLCB1c2VySWQpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+KSA9PiB7XG4gICAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50byhcImFjdGl2aXRpZXNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgc3RhcnRfdGltZTogaW5wdXQuc3RhcnRUaW1lLFxuICAgICAgICAgIGVuZF90aW1lOiBpbnB1dC5lbmRUaW1lLFxuICAgICAgICAgIGlzX3JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICAgICAgZGF0ZTogaW5wdXQuaXNSZWN1cnJpbmcgPyBudWxsIDogKGlucHV0LmRhdGUgPz8gbnVsbCksXG4gICAgICAgICAgZ3JvdXBfaWQ6IGdyb3VwSWQgPz8gbnVsbCxcbiAgICAgICAgfSBhcyBOZXdBY3Rpdml0eSlcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICBpZiAoaW5wdXQuaXNSZWN1cnJpbmcgJiYgaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50byhcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4ucmVjdXJyZW5jZVR5cGUsXG4gICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLmNvbmZpZyksXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdSZWN1cnJlbmNlUGF0dGVybilcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0aXZpdHk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5KTtcbiAgfSxcblxuICB1cGRhdGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXQgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCwgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgaXNSZWN1cnJpbmcgPSBpbnB1dC5pc1JlY3VycmluZyA/PyBleGlzdGluZy5pc19yZWN1cnJpbmc7XG4gICAgY29uc3QgZGF0ZSA9IGlucHV0LmRhdGUgIT09IHVuZGVmaW5lZCA/IGlucHV0LmRhdGUgOiBleGlzdGluZy5kYXRlO1xuXG4gICAgLy8gSWYgdGhlIHNjaGVkdWxlIGlzIHN0aWxsIHJlY3VycmluZyBhbmQgbm8gbmV3IHBhdHRlcm4gd2FzIHN1cHBsaWVkLFxuICAgIC8vIHZhbGlkYXRlIGFnYWluc3QgdGhlIHBhdHRlcm4gYWxyZWFkeSBvbiBmaWxlLlxuICAgIGxldCByZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGwgfCB1bmRlZmluZWQgPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybjtcbiAgICBpZiAoaXNSZWN1cnJpbmcgJiYgIXJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1BhdHRlcm4gPSBhd2FpdCBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGlkKTtcbiAgICAgIGlmIChleGlzdGluZ1BhdHRlcm4pIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcoZXhpc3RpbmdQYXR0ZXJuLmNvbmZpZyk7XG4gICAgICAgIHJlY3VycmVuY2VQYXR0ZXJuID0gY29uZmlnXG4gICAgICAgICAgPyB7IHJlY3VycmVuY2VUeXBlOiBleGlzdGluZ1BhdHRlcm4ucmVjdXJyZW5jZV90eXBlLCBjb25maWcgfVxuICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7IGlzUmVjdXJyaW5nLCBkYXRlLCByZWN1cnJlbmNlUGF0dGVybiB9KTtcblxuICAgIGNvbnN0IHJlc29sdmVkR3JvdXBJZCA9IGlucHV0Lmdyb3VwSWQgIT09IHVuZGVmaW5lZFxuICAgICAgPyBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkLCB1c2VySWQpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlzUmVjdXJyaW5nID8gbnVsbCA6IChkYXRlID8/IG51bGwpLFxuICAgICAgICAgIC4uLihyZXNvbHZlZEdyb3VwSWQgIT09IHVuZGVmaW5lZCA/IHsgZ3JvdXBfaWQ6IHJlc29sdmVkR3JvdXBJZCB9IDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLm9uQ29uZmxpY3QoKG9jOiBPbkNvbmZsaWN0QnVpbGRlcjxhbnksIGFueT4pID0+XG4gICAgICAgICAgICBvYy5jb2x1bW5zKFtcImFjdGl2aXR5X2lkXCJdKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4hLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5jb25maWcpLFxuICAgICAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfSBlbHNlIGlmICghaXNSZWN1cnJpbmcpIHtcbiAgICAgICAgLy8gQ2xlYW4gdXAgYW55IHN0YWxlIHBhdHRlcm4gb25jZSBhbiBhY3Rpdml0eSBzdG9wcyByZWN1cnJpbmcuXG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5kZWxldGVGcm9tKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhY3Rpdml0eS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0aXZpdHk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5KTtcbiAgfSxcblxuICBkZWxldGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlciB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDA7XG4gIH0sXG59O1xuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59O1xuIiwgImltcG9ydCB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgSW5zZXJ0YWJsZSwgU2VsZWN0YWJsZSwgVXBkYXRlYWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLy8gTWFpbiBEYXRhYmFzZSBpbnRlcmZhY2UgdGhhdCBkZXNjcmliZXMgYWxsIHRhYmxlc1xuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG4gIGdyb3VwczogR3JvdXBzVGFibGVcbiAgYWN0aXZpdGllczogQWN0aXZpdGllc1RhYmxlXG4gIHJlY3VycmVuY2VfcGF0dGVybnM6IFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlXG4gIGFjdGl2aXR5X2NvbXBsZXRpb25zOiBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGVcbn1cblxuLy8gVXNlcnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEdyb3VwcyB0YWJsZSBpbnRlcmZhY2UgXHUyMDE0IHVzZXItc2NvcGVkIGFjdGl2aXR5IHRheG9ub215IHdpdGggZGlzcGxheSBjb2xvci5cbmV4cG9ydCBpbnRlcmZhY2UgR3JvdXBzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICAvLyBIZXggY29sb3IgZnJvbSB0aGUgc2hhcmVkIHByZXNldCBwYWxldHRlLCBlLmcuIFwiIzBGNzY2RVwiXG4gIGNvbG9yOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0aWVzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0aWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIC8vIE9wdGlvbmFsIGdyb3VwIGFzc2lnbm1lbnQuIE51bGwgd2hlbiB1bmdyb3VwZWQ7IGNsZWFyZWQgaWYgdGhlIGdyb3VwXG4gIC8vIGlzIGRlbGV0ZWQgKE9OIERFTEVURSBTRVQgTlVMTCkuXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgc3RhcnRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBlbmRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBpc19yZWN1cnJpbmc6IGJvb2xlYW5cbiAgLy8gQ2FsZW5kYXIgZGF0ZSB0aGUgYWN0aXZpdHkgb2NjdXJzIG9uLiBSZXF1aXJlZCB3aGVuIGlzX3JlY3VycmluZyBpc1xuICAvLyBmYWxzZTsgbnVsbCB3aGVuIGlzX3JlY3VycmluZyBpcyB0cnVlIChkYXRlcyBsaXZlIGluIHRoZSByZWN1cnJlbmNlXG4gIC8vIHBhdHRlcm4ncyBjb25maWcgaW5zdGVhZCkuXG4gIGRhdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBSZWN1cnJlbmNlIHBhdHRlcm5zIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBSZWN1cnJlbmNlUGF0dGVybnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIC8vIFR5cGUgb2YgcmVjdXJyZW5jZTogd2Vla2x5LCBtb250aGx5LCBvciBldmVyeSBYIGRheXNcbiAgcmVjdXJyZW5jZV90eXBlOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdldmVyeV94X2RheXMnXG4gIC8vIEpTT04gY29uZmlndXJhdGlvbiBmb3IgdGhlIHJlY3VycmVuY2VcbiAgY29uZmlnOiBDb2x1bW5UeXBlPHtcbiAgICAvLyBGb3Igd2Vla2x5OiBhcnJheSBvZiBkYXlzICgwLTYsIHdoZXJlIDAgaXMgU3VuZGF5KVxuICAgIGRheXNfb2Zfd2Vlaz86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGRheXMgb2YgdGhlIG1vbnRoICgxLTMxKVxuICAgIGRheXNfb2ZfbW9udGg/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBhbHNvIHJlcGVhdCBvbiB0aGUgbGFzdCBkYXkgb2YgdGhlIG1vbnRoLiBLZXB0IGFzIGl0c1xuICAgIC8vIG93biBib29sZWFuIChyYXRoZXIgdGhhbiBhICdsYXN0JyBzZW50aW5lbCBpbiBkYXlzX29mX21vbnRoKSBiZWNhdXNlXG4gICAgLy8gUHlsb24vR3JhcGhRTCBpbnB1dCB0eXBlcyBjYW4ndCByZXByZXNlbnQgYSBudW1iZXJ8c3RyaW5nIHVuaW9uLlxuICAgIGlzX2xhc3RfZGF5X29mX21vbnRoPzogYm9vbGVhblxuICAgIC8vIEZvciBldmVyeV94X2RheXM6IHJlcGVhdCBldmVyeSBOIGRheXMgKD49IDEpXG4gICAgaW50ZXJ2YWxfZGF5cz86IG51bWJlclxuICAgIC8vIFN0YXJ0IGRhdGUgb2YgdGhlIHJlY3VycmVuY2VcbiAgICBzdGFydF9kYXRlOiBzdHJpbmdcbiAgICAvLyBFbmQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZSAob3B0aW9uYWwpXG4gICAgZW5kX2RhdGU/OiBzdHJpbmcgfCBudWxsXG4gIH0sIHN0cmluZywgc3RyaW5nPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXR5IGNvbXBsZXRpb25zIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgYWN0aXZpdHlfaWQ6IG51bWJlclxuICBjb21wbGV0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBuZXZlcj5cbiAgLy8gU3RvcmUgYW55IGFkZGl0aW9uYWwgZGF0YSBhYm91dCB0aGUgY29tcGxldGlvblxuICBtZXRhZGF0YTogQ29sdW1uVHlwZTx7XG4gICAgdGl0bGU6IHN0cmluZ1xuICAgIG5vdGVzPzogc3RyaW5nXG4gICAgZHVyYXRpb24/OiBudW1iZXIgLy8gYWN0dWFsIGR1cmF0aW9uIGluIG1pbnV0ZXNcbiAgICB0cmlnZ2VyX2V2ZW50cz86IHN0cmluZ1tdIC8vIGFycmF5IG9mIGV2ZW50IGlkZW50aWZpZXJzIHRoYXQgd2VyZSB0cmlnZ2VyZWRcbiAgfSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG59XG5cbi8vIEV4cG9ydCBjb252ZW5pZW5jZSB0eXBlcyBmb3IgZWFjaCB0YWJsZVxuZXhwb3J0IHR5cGUgVXNlciA9IFNlbGVjdGFibGU8VXNlcnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1VzZXIgPSBJbnNlcnRhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBVc2VyVXBkYXRlID0gVXBkYXRlYWJsZTxVc2Vyc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHcm91cCA9IFNlbGVjdGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHcm91cCA9IEluc2VydGFibGU8R3JvdXBzVGFibGU+XG5leHBvcnQgdHlwZSBHcm91cFVwZGF0ZSA9IFVwZGF0ZWFibGU8R3JvdXBzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5ID0gU2VsZWN0YWJsZTxBY3Rpdml0aWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eSA9IEluc2VydGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlVcGRhdGUgPSBVcGRhdGVhYmxlPEFjdGl2aXRpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm4gPSBTZWxlY3RhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3UmVjdXJyZW5jZVBhdHRlcm4gPSBJbnNlcnRhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuZXhwb3J0IHR5cGUgUmVjdXJyZW5jZVBhdHRlcm5VcGRhdGUgPSBVcGRhdGVhYmxlPFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eUNvbXBsZXRpb24gPSBTZWxlY3RhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0FjdGl2aXR5Q29tcGxldGlvbiA9IEluc2VydGFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uVXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+ICAiLCAiaW1wb3J0IHsgRGF0YWJhc2UgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IFBvb2wgfSBmcm9tICdwZydcbmltcG9ydCB7IEt5c2VseSwgUG9zdGdyZXNEaWFsZWN0IH0gZnJvbSAna3lzZWx5J1xuXG5jb25zdCBkaWFsZWN0ID0gbmV3IFBvc3RncmVzRGlhbGVjdCh7XG4gIHBvb2w6IG5ldyBQb29sKHtcbiAgICBkYXRhYmFzZTogJ3RpbWVtYW5hZ2VyJyxcbiAgICBob3N0OiAnbG9jYWxob3N0JyxcbiAgICB1c2VyOiAncG9zdGdyZXMnLFxuICAgIHBhc3N3b3JkOiAndGVzdDEyMzQnLFxuICAgIHBvcnQ6IDU0MzIsXG4gICAgbWF4OiAxMCxcbiAgfSlcbn0pXG5cbi8vIERhdGFiYXNlIGludGVyZmFjZSBpcyBwYXNzZWQgdG8gS3lzZWx5J3MgY29uc3RydWN0b3IsIGFuZCBmcm9tIG5vdyBvbiwgS3lzZWx5IFxuLy8ga25vd3MgeW91ciBkYXRhYmFzZSBzdHJ1Y3R1cmUuXG4vLyBEaWFsZWN0IGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLCBLeXNlbHkga25vd3MgaG93IFxuLy8gdG8gY29tbXVuaWNhdGUgd2l0aCB5b3VyIGRhdGFiYXNlLlxuZXhwb3J0IGNvbnN0IGRiID0gbmV3IEt5c2VseTxEYXRhYmFzZT4oe1xuICBkaWFsZWN0LFxufSkiLCAiLyoqXG4gKiBTaGFyZWQgcHJlc2V0IHBhbGV0dGUgZm9yIGFjdGl2aXR5IGdyb3Vwcy5cbiAqIEtlZXAgaW4gc3luYyB3aXRoIEZsdXR0ZXIgYGxpYi90aGVtZS90b2tlbnMvZ3JvdXBfcGFsZXR0ZS5kYXJ0YC5cbiAqL1xuZXhwb3J0IGNvbnN0IEdST1VQX0NPTE9SX1BBTEVUVEUgPSBbXG4gICcjMEY3NjZFJywgLy8gdGVhbCAoYnJhbmQpXG4gICcjMjU2M0VCJywgLy8gYmx1ZVxuICAnIzdDM0FFRCcsIC8vIHZpb2xldFxuICAnI0RCMjc3NycsIC8vIHBpbmtcbiAgJyNEQzI2MjYnLCAvLyByZWRcbiAgJyNFQTU4MEMnLCAvLyBvcmFuZ2VcbiAgJyNDQThBMDQnLCAvLyB5ZWxsb3dcbiAgJyMxNkEzNEEnLCAvLyBncmVlblxuICAnIzA4OTFCMicsIC8vIGN5YW5cbiAgJyM0QjU1NjMnLCAvLyBncmF5XG5dIGFzIGNvbnN0XG5cbmV4cG9ydCB0eXBlIEdyb3VwQ29sb3IgPSAodHlwZW9mIEdST1VQX0NPTE9SX1BBTEVUVEUpW251bWJlcl1cblxuY29uc3QgSEVYX0NPTE9SX1JFID0gL14jWzAtOUEtRmEtZl17Nn0kL1xuXG5leHBvcnQgZnVuY3Rpb24gaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogY29sb3IgaXMgR3JvdXBDb2xvciB7XG4gIGlmICghSEVYX0NPTE9SX1JFLnRlc3QoY29sb3IpKSByZXR1cm4gZmFsc2VcbiAgY29uc3Qgbm9ybWFsaXplZCA9IGNvbG9yLnRvVXBwZXJDYXNlKClcbiAgcmV0dXJuIChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5zb21lKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IG5vcm1hbGl6ZWQsXG4gIClcbn1cblxuLyoqIE5vcm1hbGl6ZSB0byBjYW5vbmljYWwgYCNSUkdHQkJgIHVwcGVyY2FzZSBmcm9tIHRoZSBhbGxvd2xpc3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogR3JvdXBDb2xvciB7XG4gIGNvbnN0IG1hdGNoID0gKEdST1VQX0NPTE9SX1BBTEVUVEUgYXMgcmVhZG9ubHkgc3RyaW5nW10pLmZpbmQoXG4gICAgKGMpID0+IGMudG9VcHBlckNhc2UoKSA9PT0gY29sb3IudG9VcHBlckNhc2UoKSxcbiAgKVxuICBpZiAoIW1hdGNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIGdyb3VwIGNvbG9yOiAke2NvbG9yfWApXG4gIH1cbiAgcmV0dXJuIG1hdGNoIGFzIEdyb3VwQ29sb3Jcbn1cbiIsICJpbXBvcnQgeyBSZWN1cnJlbmNlQ29uZmlnLCBSZWN1cnJlbmNlUGF0dGVybklucHV0IH0gZnJvbSAnLi90eXBlcy50cydcbmltcG9ydCB7IGlzQWxsb3dlZEdyb3VwQ29sb3IsIG5vcm1hbGl6ZUdyb3VwQ29sb3IgfSBmcm9tICcuL2dyb3VwX3BhbGV0dGUudHMnXG5cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmV4cG9ydCBjbGFzcyBJbnZhbGlkR3JvdXBFcnJvciBleHRlbmRzIEVycm9yIHt9XG5cbmludGVyZmFjZSBBY3Rpdml0eVNjaGVkdWxlIHtcbiAgaXNSZWN1cnJpbmc6IGJvb2xlYW5cbiAgZGF0ZT86IHN0cmluZyB8IG51bGxcbiAgcmVjdXJyZW5jZVBhdHRlcm4/OiBSZWN1cnJlbmNlUGF0dGVybklucHV0IHwgbnVsbFxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyB0aGF0IGFuIGFjdGl2aXR5J3Mgc2NoZWR1bGUgaXMgaW50ZXJuYWxseSBjb25zaXN0ZW50OlxuICogLSBOb24tcmVjdXJyaW5nIGFjdGl2aXRpZXMgbXVzdCBoYXZlIGEgYGRhdGVgIGFuZCBubyByZWN1cnJlbmNlIHBhdHRlcm4uXG4gKiAtIFJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIHJlY3VycmVuY2UgcGF0dGVybiAoYW5kIG5vIGBkYXRlYCksXG4gKiAgIHdpdGggY29uZmlnIGZpZWxkcyBtYXRjaGluZyB0aGUgY2hvc2VuIHJlY3VycmVuY2UgdHlwZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZShpbnB1dDogQWN0aXZpdHlTY2hlZHVsZSk6IHZvaWQge1xuICBpZiAoIWlucHV0LmlzUmVjdXJyaW5nKSB7XG4gICAgaWYgKCFpbnB1dC5kYXRlKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgJ2RhdGUgaXMgcmVxdWlyZWQgd2hlbiBpc1JlY3VycmluZyBpcyBmYWxzZScsXG4gICAgICApXG4gICAgfVxuICAgIHJldHVyblxuICB9XG5cbiAgaWYgKCFpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ3JlY3VycmVuY2VQYXR0ZXJuIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgdHJ1ZScsXG4gICAgKVxuICB9XG5cbiAgY29uc3QgeyByZWN1cnJlbmNlVHlwZSwgY29uZmlnIH0gPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVyblxuICBpZiAoIWNvbmZpZyB8fCAhY29uZmlnLnN0YXJ0X2RhdGUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybi5jb25maWcuc3RhcnRfZGF0ZSBpcyByZXF1aXJlZCcsXG4gICAgKVxuICB9XG5cbiAgc3dpdGNoIChyZWN1cnJlbmNlVHlwZSkge1xuICAgIGNhc2UgJ3dlZWtseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZldlZWsoY29uZmlnLmRheXNfb2Zfd2VlaylcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICB2YWxpZGF0ZURheXNPZk1vbnRoKGNvbmZpZy5kYXlzX29mX21vbnRoLCBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICB2YWxpZGF0ZUludGVydmFsRGF5cyhjb25maWcuaW50ZXJ2YWxfZGF5cylcbiAgICAgIGJyZWFrXG4gICAgZGVmYXVsdDpcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICBgVW5zdXBwb3J0ZWQgcmVjdXJyZW5jZVR5cGU6ICR7cmVjdXJyZW5jZVR5cGV9YCxcbiAgICAgIClcbiAgfVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBhIGdyb3VwIGNvbG9yIGFnYWluc3QgdGhlIHNoYXJlZCBoZXggYWxsb3dsaXN0LlxuICogUmV0dXJucyB0aGUgY2Fub25pY2FsIHBhbGV0dGUgdmFsdWUgKGUuZy4gYCMwRjc2NkVgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFpc0FsbG93ZWRHcm91cENvbG9yKGNvbG9yKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcbiAgICAgICdjb2xvciBtdXN0IGJlIGEgaGV4IHZhbHVlIGZyb20gdGhlIGdyb3VwIHBhbGV0dGUgKGUuZy4gIzBGNzY2RSknLFxuICAgIClcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplR3JvdXBDb2xvcihjb2xvcilcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgZ3JvdXAgbmFtZSBpcyBub24tZW1wdHkgYWZ0ZXIgdHJpbS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR3JvdXBOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgaXMgcmVxdWlyZWQnKVxuICB9XG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcignbmFtZSBtdXN0IGJlIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnMnKVxuICB9XG4gIHJldHVybiB0cmltbWVkXG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mV2VlayhkYXlzT2ZXZWVrOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX3dlZWsnXSk6IHZvaWQge1xuICBpZiAoIWRheXNPZldlZWsgfHwgZGF5c09mV2Vlay5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIGlzIHJlcXVpcmVkIGZvciB3ZWVrbHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChkYXlzT2ZXZWVrLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAwIHx8IGRheSA+IDYpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2Zfd2VlayBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAwIChTdW5kYXkpIGFuZCA2IChTYXR1cmRheSknLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURheXNPZk1vbnRoKFxuICBkYXlzT2ZNb250aDogUmVjdXJyZW5jZUNvbmZpZ1snZGF5c19vZl9tb250aCddLFxuICBpc0xhc3REYXlPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydpc19sYXN0X2RheV9vZl9tb250aCddLFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhc0RheXNPZk1vbnRoID0gISFkYXlzT2ZNb250aCAmJiBkYXlzT2ZNb250aC5sZW5ndGggPiAwXG4gIGlmICghaGFzRGF5c09mTW9udGggJiYgIWlzTGFzdERheU9mTW9udGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBvciBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGggaXMgcmVxdWlyZWQgZm9yIG1vbnRobHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChcbiAgICBoYXNEYXlzT2ZNb250aCAmJlxuICAgIGRheXNPZk1vbnRoIS5zb21lKChkYXkpID0+ICFOdW1iZXIuaXNJbnRlZ2VyKGRheSkgfHwgZGF5IDwgMSB8fCBkYXkgPiAzMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2ZfbW9udGggbXVzdCBjb250YWluIGludGVnZXJzIGJldHdlZW4gMSBhbmQgMzEnLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUludGVydmFsRGF5cyhpbnRlcnZhbERheXM6IFJlY3VycmVuY2VDb25maWdbJ2ludGVydmFsX2RheXMnXSk6IHZvaWQge1xuICBpZiAoXG4gICAgaW50ZXJ2YWxEYXlzID09PSB1bmRlZmluZWQgfHxcbiAgICBpbnRlcnZhbERheXMgPT09IG51bGwgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihpbnRlcnZhbERheXMpIHx8XG4gICAgaW50ZXJ2YWxEYXlzIDwgMVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuaW50ZXJ2YWxfZGF5cyBtdXN0IGJlIGFuIGludGVnZXIgPj0gMSBmb3IgZXZlcnlfeF9kYXlzIHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxufVxuIiwgImltcG9ydCB7IGNyZWF0ZVJlbW90ZUpXS1NldCwgand0VmVyaWZ5IH0gZnJvbSAnam9zZSdcbmltcG9ydCB0eXBlIHsgQ29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5cbi8vIFB5bG9uIHNlcnZlcyB0aGUgYnVpbHQgYXBwIHdpdGggQnVuL05vZGUgXHUyMDE0IHVzZSBwcm9jZXNzLmVudiwgbm90IERlbm8uZW52LlxuY29uc3QgQVVUSF9BUElfRE9NQUlOID1cbiAgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJyAmJiBwcm9jZXNzLmVudj8uQVVUSF9BUElfRE9NQUlOKSB8fFxuICAnaHR0cDovL2xvY2FsaG9zdDozMDAxJ1xuY29uc3QgSldLU19VUkwgPSBgJHtBVVRIX0FQSV9ET01BSU59L2F1dGgvand0L2p3a3MuanNvbmBcblxuY29uc3QgandrcyA9IGNyZWF0ZVJlbW90ZUpXS1NldChuZXcgVVJMKEpXS1NfVVJMKSlcblxuZXhwb3J0IHR5cGUgVmVyaWZpZWRBdXRoID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHZlcmlmeUFjY2Vzc1Rva2VuKFxuICBhdXRob3JpemF0aW9uSGVhZGVyOiBzdHJpbmcgfCB1bmRlZmluZWQsXG4pOiBQcm9taXNlPFZlcmlmaWVkQXV0aCB8IG51bGw+IHtcbiAgaWYgKCFhdXRob3JpemF0aW9uSGVhZGVyPy5zdGFydHNXaXRoKCdCZWFyZXIgJykpIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgY29uc3QgdG9rZW4gPSBhdXRob3JpemF0aW9uSGVhZGVyLnNsaWNlKCdCZWFyZXIgJy5sZW5ndGgpLnRyaW0oKVxuICBpZiAoIXRva2VuKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgeyBwYXlsb2FkIH0gPSBhd2FpdCBqd3RWZXJpZnkodG9rZW4sIGp3a3MsIHtcbiAgICAgIGFsZ29yaXRobXM6IFsnUlMyNTYnXSxcbiAgICB9KVxuXG4gICAgY29uc3QgYXV0aFVzZXJJZCA9IHR5cGVvZiBwYXlsb2FkLnN1YiA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLnN1YiA6IG51bGxcbiAgICBpZiAoIWF1dGhVc2VySWQpIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuXG4gICAgY29uc3QgZW1haWwgPVxuICAgICAgdHlwZW9mIHBheWxvYWQuZW1haWwgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5lbWFpbCA6IHVuZGVmaW5lZFxuXG4gICAgcmV0dXJuIHsgYXV0aFVzZXJJZCwgZW1haWwgfVxuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpOiBSZXNwb25zZSB7XG4gIHJldHVybiBuZXcgUmVzcG9uc2UoSlNPTi5zdHJpbmdpZnkoeyBlcnJvcjogJ1VuYXV0aG9yaXplZCcgfSksIHtcbiAgICBzdGF0dXM6IDQwMSxcbiAgICBoZWFkZXJzOiB7XG4gICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgfSxcbiAgfSlcbn1cblxuLyoqIENPUlMgcHJlZmxpZ2h0IC8gc2ltcGxlIHJlc3BvbnNlcyBmb3IgYnJvd3NlciBHcmFwaFFMIGNsaWVudHMuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29yc01pZGRsZXdhcmUoY3R4OiBDb250ZXh0LCBuZXh0OiAoKSA9PiBQcm9taXNlPHZvaWQ+KSB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgcmV0dXJuIG5ldyBSZXNwb25zZShudWxsLCB7XG4gICAgICBzdGF0dXM6IDIwNCxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6ICcqJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1NZXRob2RzJzogJ0dFVCwgUE9TVCwgT1BUSU9OUycsXG4gICAgICB9LFxuICAgIH0pXG4gIH1cblxuICBhd2FpdCBuZXh0KClcblxuICBjdHgucmVzLmhlYWRlcnMuc2V0KCdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nLCAnKicpXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoXG4gICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnLFxuICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gIClcbn1cbiIsICJpbXBvcnQgeyBkYiB9IGZyb20gJy4vZGF0YWJhc2UudHMnXG5pbXBvcnQgdHlwZSB7IFVzZXIgfSBmcm9tICcuL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgQXV0aElkZW50aXR5ID0ge1xuICBhdXRoVXNlcklkOiBzdHJpbmdcbiAgZW1haWw/OiBzdHJpbmdcbiAgbmFtZT86IHN0cmluZ1xufVxuXG4vKipcbiAqIFJlc29sdmUgKG9yIGNyZWF0ZSkgdGhlIGxvY2FsIGB1c2Vyc2Agcm93IGZvciBhIFN1cGVyVG9rZW5zIGlkZW50aXR5LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzb2x2ZUxvY2FsVXNlcihpZGVudGl0eTogQXV0aElkZW50aXR5KTogUHJvbWlzZTxVc2VyPiB7XG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnYXV0aF91c2VyX2lkJywgJz0nLCBpZGVudGl0eS5hdXRoVXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoZXhpc3RpbmcpIHtcbiAgICByZXR1cm4gZXhpc3RpbmdcbiAgfVxuXG4gIGNvbnN0IGVtYWlsID1cbiAgICBpZGVudGl0eS5lbWFpbD8udHJpbSgpIHx8XG4gICAgYCR7aWRlbnRpdHkuYXV0aFVzZXJJZH1AdXNlcnMubG9jYWxgXG4gIGNvbnN0IG5hbWUgPVxuICAgIGlkZW50aXR5Lm5hbWU/LnRyaW0oKSB8fFxuICAgIGVtYWlsLnNwbGl0KCdAJylbMF0gfHxcbiAgICAnVXNlcidcblxuICAvLyBQcmVmZXIgbGlua2luZyBhbiBleGlzdGluZyBlbWFpbCByb3cgKGUuZy4gc2VlZGVkIGRldiB1c2VyKSB3aGVuIHByZXNlbnQuXG4gIGNvbnN0IGJ5RW1haWwgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdlbWFpbCcsICc9JywgZW1haWwpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChieUVtYWlsKSB7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ3VzZXJzJylcbiAgICAgIC5zZXQoe1xuICAgICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICAgIG5hbWU6IGJ5RW1haWwubmFtZSB8fCBuYW1lLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYnlFbWFpbC5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCd1c2VycycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBlbWFpbCxcbiAgICAgIG5hbWUsXG4gICAgICBhdXRoX3VzZXJfaWQ6IGlkZW50aXR5LmF1dGhVc2VySWQsXG4gICAgICBwYXNzd29yZF9oYXNoOiBudWxsLFxuICAgIH0pXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBQSxTQUFTLFdBQVc7OztBQ0FwQixPQUErQztBQUMvQyxTQUFTLGtCQUFrQjs7O0FDRDNCLE9BQTBFOzs7QUNDMUUsU0FBUyxZQUFZO0FBQ3JCLFNBQVMsUUFBUSx1QkFBdUI7QUFFeEMsSUFBTSxVQUFVLElBQUksZ0JBQWdCO0FBQUEsRUFDbEMsTUFBTSxJQUFJLEtBQUs7QUFBQSxJQUNiLFVBQVU7QUFBQSxJQUNWLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLFVB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
