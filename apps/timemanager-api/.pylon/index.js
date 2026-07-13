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
    const result2 = await db.deleteFrom("groups").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
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
    const result2 = await db.deleteFrom("activities").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9hdXRoL3ZlcmlmeS50cyIsICIuLi9zcmMvZGIvdXNlcnMudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImltcG9ydCB7IGFwcCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyByZXNvbHZlcnMgfSBmcm9tICcuL2dyYXBocWwvcmVzb2x2ZXJzL3Jlc29sdmVycy50cydcbmltcG9ydCB7XG4gIGNvcnNNaWRkbGV3YXJlLFxuICB1bmF1dGhvcml6ZWRSZXNwb25zZSxcbiAgdmVyaWZ5QWNjZXNzVG9rZW4sXG59IGZyb20gJy4vYXV0aC92ZXJpZnkudHMnXG5pbXBvcnQgeyByZXNvbHZlTG9jYWxVc2VyIH0gZnJvbSAnLi9kYi91c2Vycy50cydcblxuYXBwLnVzZShjb3JzTWlkZGxld2FyZSlcblxuYXBwLnVzZShhc3luYyAoY3R4LCBuZXh0KSA9PiB7XG4gIGlmIChjdHgucmVxLm1ldGhvZCA9PT0gJ09QVElPTlMnKSB7XG4gICAgYXdhaXQgbmV4dCgpXG4gICAgcmV0dXJuXG4gIH1cblxuICBjb25zdCBwYXRoID0gbmV3IFVSTChjdHgucmVxLnVybCkucGF0aG5hbWVcbiAgaWYgKHBhdGggIT09ICcvZ3JhcGhxbCcgJiYgIXBhdGguZW5kc1dpdGgoJy9ncmFwaHFsJykpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHZlcmlmaWVkID0gYXdhaXQgdmVyaWZ5QWNjZXNzVG9rZW4oY3R4LnJlcS5oZWFkZXIoJ0F1dGhvcml6YXRpb24nKSlcbiAgaWYgKCF2ZXJpZmllZCkge1xuICAgIHJldHVybiB1bmF1dGhvcml6ZWRSZXNwb25zZSgpXG4gIH1cblxuICBjb25zdCBsb2NhbFVzZXIgPSBhd2FpdCByZXNvbHZlTG9jYWxVc2VyKHtcbiAgICBhdXRoVXNlcklkOiB2ZXJpZmllZC5hdXRoVXNlcklkLFxuICAgIGVtYWlsOiB2ZXJpZmllZC5lbWFpbCxcbiAgfSlcblxuICBjdHguc2V0KCdhdXRoVXNlcklkJywgdmVyaWZpZWQuYXV0aFVzZXJJZClcbiAgaWYgKHZlcmlmaWVkLmVtYWlsKSB7XG4gICAgY3R4LnNldCgnYXV0aEVtYWlsJywgdmVyaWZpZWQuZW1haWwpXG4gIH1cbiAgY3R4LnNldCgndXNlcklkJywgbG9jYWxVc2VyLmlkKVxuXG4gIGF3YWl0IG5leHQoKVxufSlcblxuZXhwb3J0IGNvbnN0IGdyYXBocWwgPSB7XG4gIC4uLnJlc29sdmVycyxcbn1cblxuZXhwb3J0IGRlZmF1bHQgYXBwXG5cbiAgICAgIGltcG9ydCB7aGFuZGxlciBhcyBfX2ludGVybmFsUHlsb25IYW5kbGVyfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiXG5cbiAgICAgIGxldCBfX2ludGVybmFsUHlsb25Db25maWcgPSB1bmRlZmluZWRcblxuICAgICAgdHJ5IHtcbiAgICAgICAgX19pbnRlcm5hbFB5bG9uQ29uZmlnID0gY29uZmlnXG4gICAgICB9IGNhdGNoIHtcbiAgICAgICAgLy8gY29uZmlnIGlzIG5vdCBkZWNsYXJlZCwgcHlsb25Db25maWcgcmVtYWlucyB1bmRlZmluZWRcbiAgICAgIH1cblxuICAgICAgYXBwLnVzZShfX2ludGVybmFsUHlsb25IYW5kbGVyKHtcbiAgICAgICAgdHlwZURlZnM6IFwiaW5wdXQgQXJnc0lucHV0IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIge1xcblxcdGlucHV0OiBDcmVhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzYge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCFcXG59XFxuaW5wdXQgVXBkYXRlQWN0aXZpdHlJbnB1dElucHV0IHtcXG5cXHR0aXRsZTogU3RyaW5nXFxuXFx0ZGVzY3JpcHRpb246IFN0cmluZ1xcblxcdHN0YXJ0VGltZTogU3RyaW5nXFxuXFx0ZW5kVGltZTogU3RyaW5nXFxuXFx0aXNSZWN1cnJpbmc6IEJvb2xlYW5cXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRyZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0XFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxufVxcbmlucHV0IEFyZ3NJbnB1dF83IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG50eXBlIFF1ZXJ5IHtcXG5ncm91cHMoYXJnczogT2JqZWN0KTogW0dyb3VwcyFdIVxcbmdyb3VwKGFyZ3M6IEFyZ3NJbnB1dCEpOiBHcm91cHNcXG5hY3Rpdml0aWVzKGFyZ3M6IE9iamVjdCk6IFtBY3Rpdml0aWVzIV0hXFxuYWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzEhKTogQWN0aXZpdGllc1xcbn1cXG50eXBlIEdyb3VwcyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIEFjdGl2aXRpZXMge1xcbnJlY3VycmVuY2VQYXR0ZXJuOiBQYXJzZWRSZWN1cnJlbmNlUGF0dGVyblxcbmdyb3VwOiBHcm91cFxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5ncm91cF9pZDogTnVtYmVyXFxudGl0bGU6IFN0cmluZyFcXG5kZXNjcmlwdGlvbjogU3RyaW5nXFxuc3RhcnRfdGltZTogU3RyaW5nIVxcbmVuZF90aW1lOiBTdHJpbmchXFxuaXNfcmVjdXJyaW5nOiBCb29sZWFuIVxcbmRhdGU6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxubmFtZTogU3RyaW5nIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMiEpOiBDcmVhdGVHcm91cCFcXG51cGRhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMyEpOiBDcmVhdGVHcm91cCFcXG5kZWxldGVHcm91cChhcmdzOiBBcmdzSW5wdXRfNCEpOiBCb29sZWFuIVxcbmNyZWF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF81ISk6IEFjdGl2aXRpZXMhXFxudXBkYXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzYhKTogQWN0aXZpdGllcyFcXG5kZWxldGVBY3Rpdml0eShhcmdzOiBBcmdzSW5wdXRfNyEpOiBCb29sZWFuIVxcbn1cXG50eXBlIENyZWF0ZUdyb3VwIHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5uYW1lOiBTdHJpbmchXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxufVxcbnNjYWxhciBJRFxcbnNjYWxhciBJbnRcXG5zY2FsYXIgRmxvYXRcXG5zY2FsYXIgTnVtYmVyXFxuc2NhbGFyIEFueVxcbnNjYWxhciBWb2lkXFxuc2NhbGFyIE9iamVjdFxcbnNjYWxhciBGaWxlXFxuc2NhbGFyIERhdGVcXG5zY2FsYXIgSlNPTlxcbnNjYWxhciBTdHJpbmdcXG5zY2FsYXIgQm9vbGVhblxcbmVudW0gV0VFS0xZX01PTlRITFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gUmVjdXJyZW5jZVR5cGVJbnB1dCB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5cIixcbiAgICAgICAgZ3JhcGhxbCxcbiAgICAgICAgcmVzb2x2ZXJzOiB7fSxcbiAgICAgICAgY29uZmlnOiBfX2ludGVybmFsUHlsb25Db25maWdcbiAgICAgIH0pKVxuICAgICAgIiwgImltcG9ydCB7IE9uQ29uZmxpY3RCdWlsZGVyLCBUcmFuc2FjdGlvbiB9IGZyb20gXCJreXNlbHlcIjtcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tIFwiQGdldGNyb25pdC9weWxvblwiO1xuaW1wb3J0IHsgZGIgfSBmcm9tIFwiLi4vLi4vZGIvZGF0YWJhc2UudHNcIjtcbmltcG9ydCB0eXBlIHtcbiAgQWN0aXZpdHkgYXMgQWN0aXZpdHlSb3csXG4gIERhdGFiYXNlLFxuICBHcm91cCBhcyBHcm91cFJvdyxcbiAgTmV3QWN0aXZpdHksXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7XG4gIENyZWF0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUdyb3VwSW5wdXQsXG4gIFJlY3VycmVuY2VDb25maWcsXG4gIFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQsXG4gIFVwZGF0ZUFjdGl2aXR5SW5wdXQsXG4gIFVwZGF0ZUdyb3VwSW5wdXQsXG59IGZyb20gXCIuLi90eXBlcy50c1wiO1xuaW1wb3J0IHtcbiAgSW52YWxpZEdyb3VwRXJyb3IsXG4gIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSxcbiAgdmFsaWRhdGVHcm91cENvbG9yLFxuICB2YWxpZGF0ZUdyb3VwTmFtZSxcbn0gZnJvbSBcIi4uL3ZhbGlkYXRpb24udHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbi8vIFB5bG9uIHJlc29sdmVzIG5lc3RlZCBHcmFwaFFMIGZpZWxkcyBmcm9tIChwb3NzaWJseSBhc3luYykgcHJvcGVydGllcyBvblxuLy8gdGhlIHJldHVybmVkIG9iamVjdCwgbm90IGZyb20gYSBzZXBhcmF0ZSByZXNvbHZlciBtYXAgXHUyMDE0IHNvIG5lc3RlZCBkYXRhIGlzXG4vLyBhdHRhY2hlZCBpbmxpbmUgaGVyZSByYXRoZXIgdGhhbiB2aWEgYSBzdGFuZGFsb25lIHJlc29sdmVyIGV4cG9ydC5cbmZ1bmN0aW9uIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eTogQWN0aXZpdHlSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5hY3Rpdml0eSxcbiAgICByZWN1cnJlbmNlUGF0dGVybjogYXN5bmMgKCk6IFByb21pc2U8UGFyc2VkUmVjdXJyZW5jZVBhdHRlcm4gfCBudWxsPiA9PiB7XG4gICAgICBpZiAoIWFjdGl2aXR5LmlzX3JlY3VycmluZykgcmV0dXJuIG51bGw7XG4gICAgICBjb25zdCBwYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eS5pZCk7XG4gICAgICBpZiAoIXBhdHRlcm4pIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcocGF0dGVybi5jb25maWcpO1xuICAgICAgaWYgKCFjb25maWcpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgLi4ucGF0dGVybiwgY29uZmlnIH07XG4gICAgfSxcbiAgICBncm91cDogYXN5bmMgKCk6IFByb21pc2U8R3JvdXBSb3cgfCBudWxsPiA9PiB7XG4gICAgICBpZiAoYWN0aXZpdHkuZ3JvdXBfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGFjdGl2aXR5Lmdyb3VwX2lkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICAgIH0sXG4gIH07XG59XG5cbmV4cG9ydCBjb25zdCBRdWVyeSA9IHtcbiAgZ3JvdXBzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoXCJuYW1lXCIsIFwiYXNjXCIpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKCk7XG4gIH0sXG5cbiAgZ3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKSA/PyBudWxsO1xuICB9LFxuXG4gIGFjdGl2aXRpZXM6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIHJldHVybiByb3dzLm1hcCh3aXRoQWN0aXZpdHlSZWxhdGlvbnMpO1xuICB9LFxuXG4gIGFjdGl2aXR5OiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgcmV0dXJuIHJvdyA/IHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhyb3cpIDogbnVsbDtcbiAgfSxcbn07XG5cbmV4cG9ydCBjb25zdCBNdXRhdGlvbiA9IHtcbiAgY3JlYXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHcm91cElucHV0IH0pID0+IHtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCBuYW1lID0gdmFsaWRhdGVHcm91cE5hbWUoaW5wdXQubmFtZSk7XG4gICAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpO1xuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcblxuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oXCJncm91cHNcIilcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICB1c2VyX2lkOiB1c2VySWQsXG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvbG9yLFxuICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgIH0gYXMgTmV3R3JvdXApXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuICB9LFxuXG4gIHVwZGF0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyOyBpbnB1dDogVXBkYXRlR3JvdXBJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgeyBpZCwgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICBjb25zdCBuYW1lID0gaW5wdXQubmFtZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpXG4gICAgICA6IGV4aXN0aW5nLm5hbWU7XG4gICAgY29uc3QgY29sb3IgPSBpbnB1dC5jb2xvciAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlR3JvdXBDb2xvcihpbnB1dC5jb2xvcilcbiAgICAgIDogZXhpc3RpbmcuY29sb3I7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZShcImdyb3Vwc1wiKVxuICAgICAgLnNldCh7XG4gICAgICAgIG5hbWUsXG4gICAgICAgIGNvbG9yLFxuICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICB9KVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICBkZWxldGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDA7XG4gIH0sXG5cbiAgY3JlYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKHtcbiAgICAgIGlzUmVjdXJyaW5nOiBpbnB1dC5pc1JlY3VycmluZyxcbiAgICAgIGRhdGU6IGlucHV0LmRhdGUsXG4gICAgICByZWN1cnJlbmNlUGF0dGVybjogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4sXG4gICAgfSk7XG5cbiAgICBjb25zdCBncm91cElkID0gYXdhaXQgcmVzb2x2ZUdyb3VwSWQoaW5wdXQuZ3JvdXBJZCA/PyBudWxsLCB1c2VySWQpO1xuXG4gICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+KSA9PiB7XG4gICAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IHRyeFxuICAgICAgICAuaW5zZXJ0SW50byhcImFjdGl2aXRpZXNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHRpdGxlOiBpbnB1dC50aXRsZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24sXG4gICAgICAgICAgc3RhcnRfdGltZTogaW5wdXQuc3RhcnRUaW1lLFxuICAgICAgICAgIGVuZF90aW1lOiBpbnB1dC5lbmRUaW1lLFxuICAgICAgICAgIGlzX3JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICAgICAgZGF0ZTogaW5wdXQuaXNSZWN1cnJpbmcgPyBudWxsIDogKGlucHV0LmRhdGUgPz8gbnVsbCksXG4gICAgICAgICAgZ3JvdXBfaWQ6IGdyb3VwSWQgPz8gbnVsbCxcbiAgICAgICAgfSBhcyBOZXdBY3Rpdml0eSlcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICBpZiAoaW5wdXQuaXNSZWN1cnJpbmcgJiYgaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuaW5zZXJ0SW50byhcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICAgIGFjdGl2aXR5X2lkOiBhY3Rpdml0eS5pZCxcbiAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4ucmVjdXJyZW5jZVR5cGUsXG4gICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLmNvbmZpZyksXG4gICAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSBhcyBOZXdSZWN1cnJlbmNlUGF0dGVybilcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0aXZpdHk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5KTtcbiAgfSxcblxuICB1cGRhdGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUFjdGl2aXR5SW5wdXQgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCwgaW5wdXQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgaXNSZWN1cnJpbmcgPSBpbnB1dC5pc1JlY3VycmluZyA/PyBleGlzdGluZy5pc19yZWN1cnJpbmc7XG4gICAgY29uc3QgZGF0ZSA9IGlucHV0LmRhdGUgIT09IHVuZGVmaW5lZCA/IGlucHV0LmRhdGUgOiBleGlzdGluZy5kYXRlO1xuXG4gICAgLy8gSWYgdGhlIHNjaGVkdWxlIGlzIHN0aWxsIHJlY3VycmluZyBhbmQgbm8gbmV3IHBhdHRlcm4gd2FzIHN1cHBsaWVkLFxuICAgIC8vIHZhbGlkYXRlIGFnYWluc3QgdGhlIHBhdHRlcm4gYWxyZWFkeSBvbiBmaWxlLlxuICAgIGxldCByZWN1cnJlbmNlUGF0dGVybjogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGwgfCB1bmRlZmluZWQgPSBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybjtcbiAgICBpZiAoaXNSZWN1cnJpbmcgJiYgIXJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICBjb25zdCBleGlzdGluZ1BhdHRlcm4gPSBhd2FpdCBmZXRjaFJlY3VycmVuY2VQYXR0ZXJuKGlkKTtcbiAgICAgIGlmIChleGlzdGluZ1BhdHRlcm4pIHtcbiAgICAgICAgY29uc3QgY29uZmlnID0gcGFyc2VDb25maWcoZXhpc3RpbmdQYXR0ZXJuLmNvbmZpZyk7XG4gICAgICAgIHJlY3VycmVuY2VQYXR0ZXJuID0gY29uZmlnXG4gICAgICAgICAgPyB7IHJlY3VycmVuY2VUeXBlOiBleGlzdGluZ1BhdHRlcm4ucmVjdXJyZW5jZV90eXBlLCBjb25maWcgfVxuICAgICAgICAgIDogdW5kZWZpbmVkO1xuICAgICAgfVxuICAgIH1cblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7IGlzUmVjdXJyaW5nLCBkYXRlLCByZWN1cnJlbmNlUGF0dGVybiB9KTtcblxuICAgIGNvbnN0IHJlc29sdmVkR3JvdXBJZCA9IGlucHV0Lmdyb3VwSWQgIT09IHVuZGVmaW5lZFxuICAgICAgPyBhd2FpdCByZXNvbHZlR3JvdXBJZChpbnB1dC5ncm91cElkLCB1c2VySWQpXG4gICAgICA6IHVuZGVmaW5lZDtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLnVwZGF0ZVRhYmxlKFwiYWN0aXZpdGllc1wiKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlzUmVjdXJyaW5nID8gbnVsbCA6IChkYXRlID8/IG51bGwpLFxuICAgICAgICAgIC4uLihyZXNvbHZlZEdyb3VwSWQgIT09IHVuZGVmaW5lZCA/IHsgZ3JvdXBfaWQ6IHJlc29sdmVkR3JvdXBJZCB9IDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLm9uQ29uZmxpY3QoKG9jOiBPbkNvbmZsaWN0QnVpbGRlcjxhbnksIGFueT4pID0+XG4gICAgICAgICAgICBvYy5jb2x1bW5zKFtcImFjdGl2aXR5X2lkXCJdKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgICAgICAgIHJlY3VycmVuY2VfdHlwZTogaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4hLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgICBjb25maWc6IEpTT04uc3RyaW5naWZ5KGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5jb25maWcpLFxuICAgICAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgICB9KVxuICAgICAgICAgIClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfSBlbHNlIGlmICghaXNSZWN1cnJpbmcpIHtcbiAgICAgICAgLy8gQ2xlYW4gdXAgYW55IHN0YWxlIHBhdHRlcm4gb25jZSBhbiBhY3Rpdml0eSBzdG9wcyByZWN1cnJpbmcuXG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5kZWxldGVGcm9tKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhY3Rpdml0eS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gYWN0aXZpdHk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gd2l0aEFjdGl2aXR5UmVsYXRpb25zKGFjdGl2aXR5KTtcbiAgfSxcblxuICBkZWxldGVBY3Rpdml0eTogYXN5bmMgKFxuICAgIGFyZ3M6IHsgaWQ6IG51bWJlciB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlkIH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IGRiXG4gICAgICAuZGVsZXRlRnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKCk7XG5cbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDA7XG4gIH0sXG59O1xuXG5leHBvcnQgY29uc3QgcmVzb2x2ZXJzID0ge1xuICBRdWVyeSxcbiAgTXV0YXRpb24sXG59O1xuIiwgImltcG9ydCB7IENvbHVtblR5cGUsIEdlbmVyYXRlZCwgSW5zZXJ0YWJsZSwgU2VsZWN0YWJsZSwgVXBkYXRlYWJsZSB9IGZyb20gJ2t5c2VseSdcblxuLy8gTWFpbiBEYXRhYmFzZSBpbnRlcmZhY2UgdGhhdCBkZXNjcmliZXMgYWxsIHRhYmxlc1xuZXhwb3J0IGludGVyZmFjZSBEYXRhYmFzZSB7XG4gIHVzZXJzOiBVc2Vyc1RhYmxlXG4gIGdyb3VwczogR3JvdXBzVGFibGVcbiAgYWN0aXZpdGllczogQWN0aXZpdGllc1RhYmxlXG4gIHJlY3VycmVuY2VfcGF0dGVybnM6IFJlY3VycmVuY2VQYXR0ZXJuc1RhYmxlXG4gIGFjdGl2aXR5X2NvbXBsZXRpb25zOiBBY3Rpdml0eUNvbXBsZXRpb25zVGFibGVcbiAgZ29hbF9ldmVudHM6IEdvYWxFdmVudHNUYWJsZVxuICBnb2FsczogR29hbHNUYWJsZVxuICBnb2FsX2xpbmtzOiBHb2FsTGlua3NUYWJsZVxuICBnb2FsX2N5Y2xlczogR29hbEN5Y2xlc1RhYmxlXG4gIGdvYWxfZGVwZW5kZW5jaWVzOiBHb2FsRGVwZW5kZW5jaWVzVGFibGVcbiAgZ29hbF9wcm9ncmVzc19zbmFwc2hvdHM6IEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlXG59XG5cbi8vIFVzZXJzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBVc2Vyc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGVtYWlsOiBzdHJpbmdcbiAgcGFzc3dvcmRfaGFzaDogc3RyaW5nIHwgbnVsbFxuICAvKiogU3VwZXJUb2tlbnMgdXNlciBpZCBcdTIwMTQgbGlua3MgU1NPIGlkZW50aXR5IHRvIGxvY2FsIHJvd3MuICovXG4gIGF1dGhfdXNlcl9pZDogc3RyaW5nIHwgbnVsbFxuICBuYW1lOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBHcm91cHMgdGFibGUgaW50ZXJmYWNlIFx1MjAxNCB1c2VyLXNjb3BlZCBhY3Rpdml0eSB0YXhvbm9teSB3aXRoIGRpc3BsYXkgY29sb3IuXG5leHBvcnQgaW50ZXJmYWNlIEdyb3Vwc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICBuYW1lOiBzdHJpbmdcbiAgLy8gSGV4IGNvbG9yIGZyb20gdGhlIHNoYXJlZCBwcmVzZXQgcGFsZXR0ZSwgZS5nLiBcIiMwRjc2NkVcIlxuICBjb2xvcjogc3RyaW5nXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gQWN0aXZpdGllcyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdGllc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICAvLyBPcHRpb25hbCBncm91cCBhc3NpZ25tZW50LiBOdWxsIHdoZW4gdW5ncm91cGVkOyBjbGVhcmVkIGlmIHRoZSBncm91cFxuICAvLyBpcyBkZWxldGVkIChPTiBERUxFVEUgU0VUIE5VTEwpLlxuICBncm91cF9pZDogbnVtYmVyIHwgbnVsbFxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIHN0YXJ0X3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgZW5kX3RpbWU6IHN0cmluZyAvLyBUaW1lIG9mIGRheSBpbiBISDptbSBmb3JtYXRcbiAgaXNfcmVjdXJyaW5nOiBib29sZWFuXG4gIC8vIENhbGVuZGFyIGRhdGUgdGhlIGFjdGl2aXR5IG9jY3VycyBvbi4gUmVxdWlyZWQgd2hlbiBpc19yZWN1cnJpbmcgaXNcbiAgLy8gZmFsc2U7IG51bGwgd2hlbiBpc19yZWN1cnJpbmcgaXMgdHJ1ZSAoZGF0ZXMgbGl2ZSBpbiB0aGUgcmVjdXJyZW5jZVxuICAvLyBwYXR0ZXJuJ3MgY29uZmlnIGluc3RlYWQpLlxuICBkYXRlOiBzdHJpbmcgfCBudWxsXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuLy8gUmVjdXJyZW5jZSBwYXR0ZXJucyB0YWJsZSBpbnRlcmZhY2VcbmV4cG9ydCBpbnRlcmZhY2UgUmVjdXJyZW5jZVBhdHRlcm5zVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgYWN0aXZpdHlfaWQ6IG51bWJlclxuICAvLyBUeXBlIG9mIHJlY3VycmVuY2U6IHdlZWtseSwgbW9udGhseSwgb3IgZXZlcnkgWCBkYXlzXG4gIHJlY3VycmVuY2VfdHlwZTogJ3dlZWtseScgfCAnbW9udGhseScgfCAnZXZlcnlfeF9kYXlzJ1xuICAvLyBKU09OIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSByZWN1cnJlbmNlXG4gIGNvbmZpZzogQ29sdW1uVHlwZTx7XG4gICAgLy8gRm9yIHdlZWtseTogYXJyYXkgb2YgZGF5cyAoMC02LCB3aGVyZSAwIGlzIFN1bmRheSlcbiAgICBkYXlzX29mX3dlZWs/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBkYXlzIG9mIHRoZSBtb250aCAoMS0zMSlcbiAgICBkYXlzX29mX21vbnRoPzogbnVtYmVyW11cbiAgICAvLyBGb3IgbW9udGhseTogYWxzbyByZXBlYXQgb24gdGhlIGxhc3QgZGF5IG9mIHRoZSBtb250aC4gS2VwdCBhcyBpdHNcbiAgICAvLyBvd24gYm9vbGVhbiAocmF0aGVyIHRoYW4gYSAnbGFzdCcgc2VudGluZWwgaW4gZGF5c19vZl9tb250aCkgYmVjYXVzZVxuICAgIC8vIFB5bG9uL0dyYXBoUUwgaW5wdXQgdHlwZXMgY2FuJ3QgcmVwcmVzZW50IGEgbnVtYmVyfHN0cmluZyB1bmlvbi5cbiAgICBpc19sYXN0X2RheV9vZl9tb250aD86IGJvb2xlYW5cbiAgICAvLyBGb3IgZXZlcnlfeF9kYXlzOiByZXBlYXQgZXZlcnkgTiBkYXlzICg+PSAxKVxuICAgIGludGVydmFsX2RheXM/OiBudW1iZXJcbiAgICAvLyBTdGFydCBkYXRlIG9mIHRoZSByZWN1cnJlbmNlXG4gICAgc3RhcnRfZGF0ZTogc3RyaW5nXG4gICAgLy8gRW5kIGRhdGUgb2YgdGhlIHJlY3VycmVuY2UgKG9wdGlvbmFsKVxuICAgIGVuZF9kYXRlPzogc3RyaW5nIHwgbnVsbFxuICB9LCBzdHJpbmcsIHN0cmluZz5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0eSBjb21wbGV0aW9ucyBcdTIwMTQgb25lIHJvdyBwZXIgKGFjdGl2aXR5LCBvY2N1cnJlbmNlX2RhdGUpXG5leHBvcnQgaW50ZXJmYWNlIEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIHVzZXJfaWQ6IG51bWJlclxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZ1xuICBkdXJhdGlvbl9taW51dGVzOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICAvLyBTdG9yZSBhbnkgYWRkaXRpb25hbCBkYXRhIGFib3V0IHRoZSBjb21wbGV0aW9uXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPHtcbiAgICB0aXRsZT86IHN0cmluZ1xuICAgIG5vdGVzPzogc3RyaW5nXG4gICAgdHJpZ2dlcl9ldmVudHM/OiBzdHJpbmdbXVxuICB9IHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbn1cblxuZXhwb3J0IHR5cGUgR29hbEV2ZW50U291cmNlVHlwZSA9ICdjb21wbGV0aW9uJyB8ICd0aW1lX2xvZycgfCAnbWFudWFsJ1xuZXhwb3J0IHR5cGUgR29hbEV2ZW50TWV0cmljID0gJ2NvdW50JyB8ICdkdXJhdGlvbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRXZlbnRzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHNvdXJjZV90eXBlOiBHb2FsRXZlbnRTb3VyY2VUeXBlXG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIGNvbXBsZXRpb25faWQ6IG51bWJlciB8IG51bGxcbiAgb2NjdXJyZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBuZXZlcj5cbiAgb2NjdXJyZW5jZV9kYXRlOiBzdHJpbmcgfCBudWxsXG4gIG1ldHJpYzogR29hbEV2ZW50TWV0cmljXG4gIGFtb3VudDogbnVtYmVyXG4gIG1ldGFkYXRhOiBDb2x1bW5UeXBlPFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCwgc3RyaW5nIHwgbnVsbCwgc3RyaW5nIHwgbnVsbD5cbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsU3RhdHVzID0gJ2FjdGl2ZScgfCAncGF1c2VkJyB8ICdjb21wbGV0ZWQnIHwgJ2FyY2hpdmVkJyB8ICdmYWlsZWQnXG5leHBvcnQgdHlwZSBHb2FsTWV0cmljID0gJ2NvdW50JyB8ICdkdXJhdGlvbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XG4gIHBlcmlvZDogJ3dlZWtseScgfCAnbW9udGhseScgfCAncXVhcnRlcmx5JyB8ICdldmVyeV94X2RheXMnXG4gIGludGVydmFsPzogbnVtYmVyXG4gIGFuY2hvcj86IHN0cmluZ1xuICBjYXJyeV9vdmVyPzogJ25vbmUnIHwgJ292ZXJmbG93J1xuICByZXNldD86ICdoYXJkJ1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxEZWFkbGluZUNvbmZpZyB7XG4gIGtpbmQ6ICdhYnNvbHV0ZScgfCAncmVsYXRpdmUnXG4gIGRhdGU/OiBzdHJpbmdcbiAgZGF5c19hZnRlcl9jeWNsZV9zdGFydD86IG51bWJlclxuICBncmFjZV9kYXlzPzogbnVtYmVyXG4gIHdhcm5fZGF5cz86IG51bWJlclxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxDb25maWcge1xuICBjb21wb3NpdGVfbW9kZT86ICdhbGwnIHwgJ2FueScgfCAnd2VpZ2h0ZWQnXG4gIGNvdW50X3JlcXVpcmVkPzogbnVtYmVyXG4gIGJlZm9yZV90aW1lPzogc3RyaW5nXG4gIGFmdGVyX3RpbWU/OiBzdHJpbmdcbiAgYmxvY2tfdW50aWxfdW5sb2NrZWQ/OiBib29sZWFuXG4gIFtrZXk6IHN0cmluZ106IHVua25vd25cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2Fsc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIHVzZXJfaWQ6IG51bWJlclxuICB0aXRsZTogc3RyaW5nXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmcgfCBudWxsXG4gIGNvbG9yOiBzdHJpbmdcbiAgaWNvbjogc3RyaW5nIHwgbnVsbFxuICBydWxlX3R5cGU6IHN0cmluZ1xuICBtZXRyaWM6IEdvYWxNZXRyaWNcbiAgdGFyZ2V0X3ZhbHVlOiBudW1iZXJcbiAgY29uZmlnOiBDb2x1bW5UeXBlPEdvYWxDb25maWcsIHN0cmluZyB8IEdvYWxDb25maWcsIHN0cmluZyB8IEdvYWxDb25maWc+XG4gIHN0YXR1czogR29hbFN0YXR1c1xuICByZWN1cnJlbmNlOiBDb2x1bW5UeXBlPFxuICAgIEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsXG4gID5cbiAgZGVhZGxpbmU6IENvbHVtblR5cGU8XG4gICAgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGxcbiAgPlxuICBwcmlvcml0eTogbnVtYmVyXG4gIHNvcnRfb3JkZXI6IG51bWJlclxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxMaW5rVHlwZSA9ICdhY3Rpdml0eScgfCAnZ3JvdXAnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbExpbmtzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGxpbmtfdHlwZTogR29hbExpbmtUeXBlXG4gIGFjdGl2aXR5X2lkOiBudW1iZXIgfCBudWxsXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHdlaWdodDogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbn1cblxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlU3RhdHVzID0gJ2FjdGl2ZScgfCAnc3VjY2VlZGVkJyB8ICdmYWlsZWQnIHwgJ21pc3NlZCdcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsQ3ljbGVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZ29hbF9pZDogbnVtYmVyXG4gIGN5Y2xlX2luZGV4OiBudW1iZXJcbiAgc3RhcnRzX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIGVuZHNfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGRlYWRsaW5lX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjdXJyZW50X3ZhbHVlOiBudW1iZXJcbiAgc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXNcbiAgY2Fycnlfb3ZlcjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCA9ICdjb21wbGV0ZScgfCAncHJvZ3Jlc3MnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlcGVuZGVuY2llc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBkZXBlbmRzX29uX2dvYWxfaWQ6IG51bWJlclxuICByZXF1aXJlbWVudDogR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudFxuICB0aHJlc2hvbGQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfY3ljbGVfaWQ6IG51bWJlclxuICBhc19vZjogc3RyaW5nXG4gIHZhbHVlOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG4vLyBFeHBvcnQgY29udmVuaWVuY2UgdHlwZXMgZm9yIGVhY2ggdGFibGVcbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdVc2VyID0gSW5zZXJ0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgVXNlclVwZGF0ZSA9IFVwZGF0ZWFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR3JvdXAgPSBTZWxlY3RhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R3JvdXAgPSBJbnNlcnRhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgR3JvdXBVcGRhdGUgPSBVcGRhdGVhYmxlPEdyb3Vwc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eSA9IFNlbGVjdGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QWN0aXZpdHkgPSBJbnNlcnRhYmxlPEFjdGl2aXRpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5VXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0aWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuID0gU2VsZWN0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1JlY3VycmVuY2VQYXR0ZXJuID0gSW5zZXJ0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuVXBkYXRlID0gVXBkYXRlYWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uID0gU2VsZWN0YWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eUNvbXBsZXRpb24gPSBJbnNlcnRhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5Q29tcGxldGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnQgPSBTZWxlY3RhYmxlPEdvYWxFdmVudHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxFdmVudCA9IEluc2VydGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEV2ZW50VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsRXZlbnRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWwgPSBTZWxlY3RhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsID0gSW5zZXJ0YWJsZTxHb2Fsc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbExpbmsgPSBTZWxlY3RhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbExpbmsgPSBJbnNlcnRhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbExpbmtVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxMaW5rc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGUgPSBTZWxlY3RhYmxlPEdvYWxDeWNsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxDeWNsZSA9IEluc2VydGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlVXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5ID0gU2VsZWN0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsRGVwZW5kZW5jeSA9IEluc2VydGFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3QgPSBTZWxlY3RhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbFByb2dyZXNzU25hcHNob3QgPSBJbnNlcnRhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3RVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBQb29sIH0gZnJvbSAncGcnXG5pbXBvcnQgeyBLeXNlbHksIFBvc3RncmVzRGlhbGVjdCB9IGZyb20gJ2t5c2VseSdcblxuY29uc3QgZGlhbGVjdCA9IG5ldyBQb3N0Z3Jlc0RpYWxlY3Qoe1xuICBwb29sOiBuZXcgUG9vbCh7XG4gICAgZGF0YWJhc2U6ICd0aW1lbWFuYWdlcicsXG4gICAgaG9zdDogJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogJ3Bvc3RncmVzJyxcbiAgICBwYXNzd29yZDogJ3Rlc3QxMjM0JyxcbiAgICBwb3J0OiA1NDMyLFxuICAgIG1heDogMTAsXG4gIH0pXG59KVxuXG4vLyBEYXRhYmFzZSBpbnRlcmZhY2UgaXMgcGFzc2VkIHRvIEt5c2VseSdzIGNvbnN0cnVjdG9yLCBhbmQgZnJvbSBub3cgb24sIEt5c2VseSBcbi8vIGtub3dzIHlvdXIgZGF0YWJhc2Ugc3RydWN0dXJlLlxuLy8gRGlhbGVjdCBpcyBwYXNzZWQgdG8gS3lzZWx5J3MgY29uc3RydWN0b3IsIGFuZCBmcm9tIG5vdyBvbiwgS3lzZWx5IGtub3dzIGhvdyBcbi8vIHRvIGNvbW11bmljYXRlIHdpdGggeW91ciBkYXRhYmFzZS5cbmV4cG9ydCBjb25zdCBkYiA9IG5ldyBLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGlhbGVjdCxcbn0pIiwgIi8qKlxuICogU2hhcmVkIHByZXNldCBwYWxldHRlIGZvciBhY3Rpdml0eSBncm91cHMuXG4gKiBLZWVwIGluIHN5bmMgd2l0aCBGbHV0dGVyIGBsaWIvdGhlbWUvdG9rZW5zL2dyb3VwX3BhbGV0dGUuZGFydGAuXG4gKi9cbmV4cG9ydCBjb25zdCBHUk9VUF9DT0xPUl9QQUxFVFRFID0gW1xuICAnIzBGNzY2RScsIC8vIHRlYWwgKGJyYW5kKVxuICAnIzI1NjNFQicsIC8vIGJsdWVcbiAgJyM3QzNBRUQnLCAvLyB2aW9sZXRcbiAgJyNEQjI3NzcnLCAvLyBwaW5rXG4gICcjREMyNjI2JywgLy8gcmVkXG4gICcjRUE1ODBDJywgLy8gb3JhbmdlXG4gICcjQ0E4QTA0JywgLy8geWVsbG93XG4gICcjMTZBMzRBJywgLy8gZ3JlZW5cbiAgJyMwODkxQjInLCAvLyBjeWFuXG4gICcjNEI1NTYzJywgLy8gZ3JheVxuXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBHcm91cENvbG9yID0gKHR5cGVvZiBHUk9VUF9DT0xPUl9QQUxFVFRFKVtudW1iZXJdXG5cbmNvbnN0IEhFWF9DT0xPUl9SRSA9IC9eI1swLTlBLUZhLWZdezZ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQWxsb3dlZEdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IGNvbG9yIGlzIEdyb3VwQ29sb3Ige1xuICBpZiAoIUhFWF9DT0xPUl9SRS50ZXN0KGNvbG9yKSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjb2xvci50b1VwcGVyQ2FzZSgpXG4gIHJldHVybiAoR1JPVVBfQ09MT1JfUEFMRVRURSBhcyByZWFkb25seSBzdHJpbmdbXSkuc29tZShcbiAgICAoYykgPT4gYy50b1VwcGVyQ2FzZSgpID09PSBub3JtYWxpemVkLFxuICApXG59XG5cbi8qKiBOb3JtYWxpemUgdG8gY2Fub25pY2FsIGAjUlJHR0JCYCB1cHBlcmNhc2UgZnJvbSB0aGUgYWxsb3dsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IEdyb3VwQ29sb3Ige1xuICBjb25zdCBtYXRjaCA9IChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5maW5kKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IGNvbG9yLnRvVXBwZXJDYXNlKCksXG4gIClcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncm91cCBjb2xvcjogJHtjb2xvcn1gKVxuICB9XG4gIHJldHVybiBtYXRjaCBhcyBHcm91cENvbG9yXG59XG4iLCAiaW1wb3J0IHR5cGUge1xuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxFdmVudCxcbiAgR29hbExpbmssXG59IGZyb20gJy4uLy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZVJlc3VsdCB7XG4gIGN1cnJlbnRWYWx1ZTogbnVtYmVyXG4gIGRvbmU6IGJvb2xlYW5cbn1cblxuZXhwb3J0IGludGVyZmFjZSBFdmFsdWF0ZUNvbnRleHQge1xuICBnb2FsOiBHb2FsXG4gIGN5Y2xlOiBHb2FsQ3ljbGVcbiAgbGlua3M6IEdvYWxMaW5rW11cbiAgZXZlbnRzOiBHb2FsRXZlbnRbXVxuICAvKiogQWN0aXZlIChvciBsYXRlc3QpIGNoaWxkIGN5Y2xlcyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLCBmb3IgY29tcG9zaXRlcy4gKi9cbiAgY2hpbGRDeWNsZXM/OiBNYXA8bnVtYmVyLCBHb2FsQ3ljbGU+XG4gIC8qKiBDaGlsZCBkZXBlbmRlbmN5IHdlaWdodHMga2V5ZWQgYnkgY2hpbGQgZ29hbCBpZC4gKi9cbiAgY2hpbGRXZWlnaHRzPzogTWFwPG51bWJlciwgbnVtYmVyPlxuICAvKiogRm9yIGdyb3VwX2FsbF9jb21wbGV0ZTogYWN0aXZpdHkgaWRzIHRoYXQgYmVsb25nIHRvIGxpbmtlZCBncm91cHMuICovXG4gIGdyb3VwQWN0aXZpdHlJZHM/OiBudW1iZXJbXVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmFsdWF0b3Ige1xuICBydWxlVHlwZTogc3RyaW5nXG4gIGV2YWx1YXRlKGN0eDogRXZhbHVhdGVDb250ZXh0KTogRXZhbHVhdGVSZXN1bHRcbn1cblxuLyoqIERlZHVwbGljYXRlIGV2ZW50cyBieSAoYWN0aXZpdHlfaWQsIG9jY3VycmVuY2VfZGF0ZSksIHByZWZlcnJpbmcgZmlyc3QuICovXG5leHBvcnQgZnVuY3Rpb24gZGVkdXBlRXZlbnRzKGV2ZW50czogR29hbEV2ZW50W10pOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHNlZW4gPSBuZXcgU2V0PHN0cmluZz4oKVxuICBjb25zdCBvdXQ6IEdvYWxFdmVudFtdID0gW11cbiAgZm9yIChjb25zdCBldmVudCBvZiBldmVudHMpIHtcbiAgICBjb25zdCBrZXkgPSBldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGV2ZW50Lm9jY3VycmVuY2VfZGF0ZVxuICAgICAgPyBgJHtldmVudC5hY3Rpdml0eV9pZH06JHtldmVudC5vY2N1cnJlbmNlX2RhdGV9OiR7ZXZlbnQubWV0cmljfWBcbiAgICAgIDogYGlkOiR7ZXZlbnQuaWR9YFxuICAgIGlmIChzZWVuLmhhcyhrZXkpKSBjb250aW51ZVxuICAgIHNlZW4uYWRkKGtleSlcbiAgICBvdXQucHVzaChldmVudClcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIGV2ZW50c0luV2luZG93KGV2ZW50czogR29hbEV2ZW50W10sIGN5Y2xlOiBHb2FsQ3ljbGUpOiBHb2FsRXZlbnRbXSB7XG4gIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgY29uc3QgZW5kID0gY3ljbGUuZW5kc19hdCA/IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpLmdldFRpbWUoKSA6IE51bWJlci5QT1NJVElWRV9JTkZJTklUWVxuICByZXR1cm4gZXZlbnRzLmZpbHRlcigoZSkgPT4ge1xuICAgIGNvbnN0IHQgPSBuZXcgRGF0ZShlLm9jY3VycmVkX2F0KS5nZXRUaW1lKClcbiAgICByZXR1cm4gdCA+PSBzdGFydCAmJiB0IDwgZW5kXG4gIH0pXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eV9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eV9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIGxpbmtlZEdyb3VwSWRzKGxpbmtzOiBHb2FsTGlua1tdKTogU2V0PG51bWJlcj4ge1xuICByZXR1cm4gbmV3IFNldChcbiAgICBsaW5rc1xuICAgICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cF9pZCAhPSBudWxsKVxuICAgICAgLm1hcCgobCkgPT4gbC5ncm91cF9pZCEpLFxuICApXG59XG5cbmZ1bmN0aW9uIHdlaWdodEZvckV2ZW50KGV2ZW50OiBHb2FsRXZlbnQsIGxpbmtzOiBHb2FsTGlua1tdKTogbnVtYmVyIHtcbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdhY3Rpdml0eScgJiZcbiAgICAgIGxpbmsuYWN0aXZpdHlfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuYWN0aXZpdHlfaWQgPT09IGxpbmsuYWN0aXZpdHlfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGxpbmsubGlua190eXBlID09PSAnZ3JvdXAnICYmXG4gICAgICBsaW5rLmdyb3VwX2lkICE9IG51bGwgJiZcbiAgICAgIGV2ZW50Lmdyb3VwX2lkID09PSBsaW5rLmdyb3VwX2lkXG4gICAgKSB7XG4gICAgICByZXR1cm4gTnVtYmVyKGxpbmsud2VpZ2h0KVxuICAgIH1cbiAgfVxuICByZXR1cm4gMVxufVxuXG5mdW5jdGlvbiBtYXRjaGVzTGlua3MoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBib29sZWFuIHtcbiAgY29uc3QgYWN0aXZpdGllcyA9IGxpbmtlZEFjdGl2aXR5SWRzKGxpbmtzKVxuICBjb25zdCBncm91cHMgPSBsaW5rZWRHcm91cElkcyhsaW5rcylcbiAgaWYgKGFjdGl2aXRpZXMuc2l6ZSA9PT0gMCAmJiBncm91cHMuc2l6ZSA9PT0gMCkgcmV0dXJuIGZhbHNlXG4gIGlmIChldmVudC5hY3Rpdml0eV9pZCAhPSBudWxsICYmIGFjdGl2aXRpZXMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgcmV0dXJuIHRydWVcbiAgaWYgKGV2ZW50Lmdyb3VwX2lkICE9IG51bGwgJiYgZ3JvdXBzLmhhcyhldmVudC5ncm91cF9pZCkpIHJldHVybiB0cnVlXG4gIHJldHVybiBmYWxzZVxufVxuXG5mdW5jdGlvbiBzdW1XZWlnaHRlZChcbiAgZXZlbnRzOiBHb2FsRXZlbnRbXSxcbiAgbGlua3M6IEdvYWxMaW5rW10sXG4gIG1ldHJpYzogJ2NvdW50JyB8ICdkdXJhdGlvbicsXG4pOiBudW1iZXIge1xuICBsZXQgdG90YWwgPSAwXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKGV2ZW50cykpIHtcbiAgICBpZiAoZXZlbnQubWV0cmljICE9PSBtZXRyaWMpIGNvbnRpbnVlXG4gICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGxpbmtzKSkgY29udGludWVcbiAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBsaW5rcylcbiAgfVxuICByZXR1cm4gdG90YWxcbn1cblxuZnVuY3Rpb24gd2l0aENhcnJ5T3Zlcih2YWx1ZTogbnVtYmVyLCBjeWNsZTogR29hbEN5Y2xlKTogbnVtYmVyIHtcbiAgcmV0dXJuIE1hdGgubWF4KDAsIHZhbHVlICsgTnVtYmVyKGN5Y2xlLmNhcnJ5X292ZXIgfHwgMCkpXG59XG5cbmZ1bmN0aW9uIHJlc3VsdCh2YWx1ZTogbnVtYmVyLCB0YXJnZXQ6IG51bWJlcik6IEV2YWx1YXRlUmVzdWx0IHtcbiAgY29uc3QgY3VycmVudFZhbHVlID0gTWF0aC5tYXgoMCwgdmFsdWUpXG4gIHJldHVybiB7XG4gICAgY3VycmVudFZhbHVlLFxuICAgIGRvbmU6IHRhcmdldCA+IDAgPyBjdXJyZW50VmFsdWUgPj0gdGFyZ2V0IDogY3VycmVudFZhbHVlID4gMCxcbiAgfVxufVxuXG5leHBvcnQgY29uc3QgYWN0aXZpdHlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdhY3Rpdml0eV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2R1cmF0aW9uJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2R1cmF0aW9uJyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdyb3VwRHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdjb3VudCcpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyBvZiBhbnkgYWN0aXZpdHkgaW4gbGlua2VkIGdyb3Vwcy4gKi9cbmV4cG9ydCBjb25zdCBncm91cEFueUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2FueV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBncm91cENvdW50RXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqXG4gKiBQcm9ncmVzcyA9IG51bWJlciBvZiBkaXN0aW5jdCBsaW5rZWQtZ3JvdXAgYWN0aXZpdGllcyBjb21wbGV0ZWQgYXQgbGVhc3RcbiAqIG9uY2UgaW4gdGhlIGN5Y2xlLiBUYXJnZXQgaXMgdHlwaWNhbGx5IHRoZSBzaXplIG9mIHRoZSBncm91cC5cbiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYWxsX2NvbXBsZXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgYWN0aXZpdHlJZHMgPSBuZXcgU2V0KGN0eC5ncm91cEFjdGl2aXR5SWRzID8/IFtdKVxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkID09IG51bGwpIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgJiYgIWFjdGl2aXR5SWRzLmhhcyhldmVudC5hY3Rpdml0eV9pZCkpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSAmJiBhY3Rpdml0eUlkcy5zaXplID09PSAwKSBjb250aW51ZVxuICAgICAgaWYgKGFjdGl2aXR5SWRzLnNpemUgPiAwIHx8IG1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkge1xuICAgICAgICBjb21wbGV0ZWQuYWRkKGV2ZW50LmFjdGl2aXR5X2lkKVxuICAgICAgfVxuICAgIH1cbiAgICAvLyBQcmVmZXIgY291bnRpbmcgb25seSBhY3Rpdml0aWVzIHRoYXQgYmVsb25nIHRvIHRoZSBncm91cC5cbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBhY3Rpdml0eUlkcy5zaXplID4gMFxuICAgICAgICA/IFsuLi5jb21wbGV0ZWRdLmZpbHRlcigoaWQpID0+IGFjdGl2aXR5SWRzLmhhcyhpZCkpLmxlbmd0aFxuICAgICAgICA6IGNvbXBsZXRlZC5zaXplLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBtdWx0aUFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnbXVsdGlfYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICByZXR1cm4gYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvci5ldmFsdWF0ZShjdHgpXG4gIH0sXG59XG5cbi8qKiBDb25zZWN1dGl2ZSBjYWxlbmRhciBkYXlzIHdpdGggYXQgbGVhc3Qgb25lIG1hdGNoaW5nIGNvdW50IGV2ZW50LiAqL1xuZXhwb3J0IGNvbnN0IHN0cmVha0V2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdzdHJlYWsnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBkYXlzID0gbmV3IFNldDxzdHJpbmc+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGRheSA9IGV2ZW50Lm9jY3VycmVuY2VfZGF0ZSA/P1xuICAgICAgICBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbiAgICAgIGRheXMuYWRkKGRheSlcbiAgICB9XG4gICAgY29uc3Qgc29ydGVkID0gWy4uLmRheXNdLnNvcnQoKVxuICAgIGxldCBiZXN0ID0gMFxuICAgIGxldCBydW4gPSAwXG4gICAgbGV0IHByZXY6IHN0cmluZyB8IG51bGwgPSBudWxsXG4gICAgZm9yIChjb25zdCBkYXkgb2Ygc29ydGVkKSB7XG4gICAgICBpZiAocHJldikge1xuICAgICAgICBjb25zdCBwcmV2RGF0ZSA9IG5ldyBEYXRlKHByZXYgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGN1ckRhdGUgPSBuZXcgRGF0ZShkYXkgKyAnVDAwOjAwOjAwWicpXG4gICAgICAgIGNvbnN0IGRpZmYgPSAoY3VyRGF0ZS5nZXRUaW1lKCkgLSBwcmV2RGF0ZS5nZXRUaW1lKCkpIC8gODZfNDAwXzAwMFxuICAgICAgICBydW4gPSBkaWZmID09PSAxID8gcnVuICsgMSA6IDFcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJ1biA9IDFcbiAgICAgIH1cbiAgICAgIGJlc3QgPSBNYXRoLm1heChiZXN0LCBydW4pXG4gICAgICBwcmV2ID0gZGF5XG4gICAgfVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihiZXN0LCBjdHguY3ljbGUpXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG4vKiogQ291bnQgY29tcGxldGlvbnMgd2hvc2Ugb2NjdXJyZW5jZSBsb2NhbCB0aW1lIGlzIGJlZm9yZSBjb25maWcuYmVmb3JlX3RpbWUuICovXG5leHBvcnQgY29uc3QgdGltZU9mRGF5Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAndGltZV9vZl9kYXlfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCBjb25maWcgPSB0eXBlb2YgY3R4LmdvYWwuY29uZmlnID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKGN0eC5nb2FsLmNvbmZpZylcbiAgICAgIDogKGN0eC5nb2FsLmNvbmZpZyA/PyB7fSlcbiAgICBjb25zdCBiZWZvcmUgPSB0eXBlb2YgY29uZmlnLmJlZm9yZV90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5iZWZvcmVfdGltZSA6IG51bGxcbiAgICBjb25zdCBhZnRlciA9IHR5cGVvZiBjb25maWcuYWZ0ZXJfdGltZSA9PT0gJ3N0cmluZycgPyBjb25maWcuYWZ0ZXJfdGltZSA6IG51bGxcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBsZXQgdG90YWwgPSAwXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykpIGNvbnRpbnVlXG4gICAgICBjb25zdCBoaG1tID0gbmV3IERhdGUoZXZlbnQub2NjdXJyZWRfYXQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMTEsIDE2KVxuICAgICAgaWYgKGJlZm9yZSAmJiBoaG1tID49IGJlZm9yZSkgY29udGludWVcbiAgICAgIGlmIChhZnRlciAmJiBoaG1tIDwgYWZ0ZXIpIGNvbnRpbnVlXG4gICAgICB0b3RhbCArPSBOdW1iZXIoZXZlbnQuYW1vdW50KSAqIHdlaWdodEZvckV2ZW50KGV2ZW50LCBjdHgubGlua3MpXG4gICAgfVxuICAgIHJldHVybiByZXN1bHQod2l0aENhcnJ5T3Zlcih0b3RhbCwgY3R4LmN5Y2xlKSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgY29tcG9zaXRlRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2NvbXBvc2l0ZScsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IG1vZGUgPSBjb25maWcuY29tcG9zaXRlX21vZGUgPz8gJ2FsbCdcbiAgICBjb25zdCBjaGlsZHJlbiA9IGN0eC5jaGlsZEN5Y2xlc1xuICAgIGlmICghY2hpbGRyZW4gfHwgY2hpbGRyZW4uc2l6ZSA9PT0gMCkge1xuICAgICAgcmV0dXJuIHJlc3VsdCgwLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgZW50cmllcyA9IFsuLi5jaGlsZHJlbi5lbnRyaWVzKCldXG4gICAgaWYgKG1vZGUgPT09ICd3ZWlnaHRlZCcpIHtcbiAgICAgIGxldCB3ZWlnaHRlZFN1bSA9IDBcbiAgICAgIGxldCB3ZWlnaHRUb3RhbCA9IDBcbiAgICAgIGZvciAoY29uc3QgW2NoaWxkSWQsIGN5Y2xlXSBvZiBlbnRyaWVzKSB7XG4gICAgICAgIGNvbnN0IHcgPSBOdW1iZXIoY3R4LmNoaWxkV2VpZ2h0cz8uZ2V0KGNoaWxkSWQpID8/IDEpXG4gICAgICAgIGNvbnN0IHByb2dyZXNzID0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkgPiAwXG4gICAgICAgICAgPyBNYXRoLm1pbigxLCBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgLyBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICAgICAgICA6IChjeWNsZS5zdGF0dXMgPT09ICdzdWNjZWVkZWQnID8gMSA6IDApXG4gICAgICAgIHdlaWdodGVkU3VtICs9IHByb2dyZXNzICogd1xuICAgICAgICB3ZWlnaHRUb3RhbCArPSB3XG4gICAgICB9XG4gICAgICBjb25zdCBwY3QgPSB3ZWlnaHRUb3RhbCA+IDAgPyB3ZWlnaHRlZFN1bSAvIHdlaWdodFRvdGFsIDogMFxuICAgICAgLy8gUmVwcmVzZW50IGFzIDBcdTIwMTMxMDAgcGVyY2VudCBvZiB0YXJnZXQuXG4gICAgICBjb25zdCB2YWx1ZSA9IHBjdCAqIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGNvbXBsZXRlZCA9IGVudHJpZXMuZmlsdGVyKChbLCBjXSkgPT5cbiAgICAgIGMuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjLnRhcmdldF92YWx1ZSkgPiAwICYmIE51bWJlcihjLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjLnRhcmdldF92YWx1ZSkpXG4gICAgKS5sZW5ndGhcblxuICAgIGlmIChtb2RlID09PSAnYW55Jykge1xuICAgICAgY29uc3QgbmVlZGVkID0gTWF0aC5tYXgoMSwgTnVtYmVyKGNvbmZpZy5jb3VudF9yZXF1aXJlZCA/PyAxKSlcbiAgICAgIHJldHVybiByZXN1bHQoY29tcGxldGVkLCBuZWVkZWQpXG4gICAgfVxuXG4gICAgLy8gYWxsXG4gICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIGVudHJpZXMubGVuZ3RoKVxuICB9LFxufVxuXG5jb25zdCBFVkFMVUFUT1JTOiBHb2FsRXZhbHVhdG9yW10gPSBbXG4gIGFjdGl2aXR5Q291bnRFdmFsdWF0b3IsXG4gIGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwRHVyYXRpb25FdmFsdWF0b3IsXG4gIGdyb3VwQ291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQW55Q291bnRFdmFsdWF0b3IsXG4gIGdyb3VwQWxsQ29tcGxldGVFdmFsdWF0b3IsXG4gIG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgc3RyZWFrRXZhbHVhdG9yLFxuICB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcixcbiAgY29tcG9zaXRlRXZhbHVhdG9yLFxuXVxuXG5jb25zdCBSRUdJU1RSWSA9IG5ldyBNYXAoRVZBTFVBVE9SUy5tYXAoKGUpID0+IFtlLnJ1bGVUeXBlLCBlXSkpXG5cbmV4cG9ydCBjb25zdCBHT0FMX1JVTEVfVFlQRVMgPSBFVkFMVUFUT1JTLm1hcCgoZSkgPT4gZS5ydWxlVHlwZSlcblxuZXhwb3J0IGZ1bmN0aW9uIGdldEV2YWx1YXRvcihydWxlVHlwZTogc3RyaW5nKTogR29hbEV2YWx1YXRvciB7XG4gIGNvbnN0IGV2YWx1YXRvciA9IFJFR0lTVFJZLmdldChydWxlVHlwZSlcbiAgaWYgKCFldmFsdWF0b3IpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gZ29hbCBydWxlX3R5cGU6ICR7cnVsZVR5cGV9YClcbiAgfVxuICByZXR1cm4gZXZhbHVhdG9yXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBldmFsdWF0ZUdvYWwoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdCB7XG4gIHJldHVybiBnZXRFdmFsdWF0b3IoY3R4LmdvYWwucnVsZV90eXBlKS5ldmFsdWF0ZShjdHgpXG59XG4iLCAiaW1wb3J0IHsgUmVjdXJyZW5jZUNvbmZpZywgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBpc0FsbG93ZWRHcm91cENvbG9yLCBub3JtYWxpemVHcm91cENvbG9yIH0gZnJvbSAnLi9ncm91cF9wYWxldHRlLnRzJ1xuaW1wb3J0IHsgR09BTF9SVUxFX1RZUEVTIH0gZnJvbSAnLi4vZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVhZGxpbmVJbnB1dCxcbiAgR29hbERlcGVuZGVuY3lJbnB1dCxcbiAgR29hbExpbmtJbnB1dCxcbiAgR29hbFJlY3VycmVuY2VJbnB1dCxcbiAgVXBkYXRlR29hbElucHV0LFxufSBmcm9tICcuL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdyb3VwRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRDb21wbGV0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRHb2FsRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5pbnRlcmZhY2UgQWN0aXZpdHlTY2hlZHVsZSB7XG4gIGlzUmVjdXJyaW5nOiBib29sZWFuXG4gIGRhdGU/OiBzdHJpbmcgfCBudWxsXG4gIHJlY3VycmVuY2VQYXR0ZXJuPzogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGxcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhbiBhY3Rpdml0eSdzIHNjaGVkdWxlIGlzIGludGVybmFsbHkgY29uc2lzdGVudDpcbiAqIC0gTm9uLXJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIGBkYXRlYCBhbmQgbm8gcmVjdXJyZW5jZSBwYXR0ZXJuLlxuICogLSBSZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSByZWN1cnJlbmNlIHBhdHRlcm4gKGFuZCBubyBgZGF0ZWApLFxuICogICB3aXRoIGNvbmZpZyBmaWVsZHMgbWF0Y2hpbmcgdGhlIGNob3NlbiByZWN1cnJlbmNlIHR5cGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoaW5wdXQ6IEFjdGl2aXR5U2NoZWR1bGUpOiB2b2lkIHtcbiAgaWYgKCFpbnB1dC5pc1JlY3VycmluZykge1xuICAgIGlmICghaW5wdXQuZGF0ZSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgICdkYXRlIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgZmFsc2UnLFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybiBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIHRydWUnLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHsgcmVjdXJyZW5jZVR5cGUsIGNvbmZpZyB9ID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm5cbiAgaWYgKCFjb25maWcgfHwgIWNvbmZpZy5zdGFydF9kYXRlKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnLnN0YXJ0X2RhdGUgaXMgcmVxdWlyZWQnLFxuICAgIClcbiAgfVxuXG4gIHN3aXRjaCAocmVjdXJyZW5jZVR5cGUpIHtcbiAgICBjYXNlICd3ZWVrbHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZXZWVrKGNvbmZpZy5kYXlzX29mX3dlZWspXG4gICAgICBicmVha1xuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZNb250aChjb25maWcuZGF5c19vZl9tb250aCwgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgdmFsaWRhdGVJbnRlcnZhbERheXMoY29uZmlnLmludGVydmFsX2RheXMpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgYFVuc3VwcG9ydGVkIHJlY3VycmVuY2VUeXBlOiAke3JlY3VycmVuY2VUeXBlfWAsXG4gICAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBncm91cCBjb2xvciBhZ2FpbnN0IHRoZSBzaGFyZWQgaGV4IGFsbG93bGlzdC5cbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBwYWxldHRlIHZhbHVlIChlLmcuIGAjMEY3NjZFYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoXG4gICAgICAnY29sb3IgbXVzdCBiZSBhIGhleCB2YWx1ZSBmcm9tIHRoZSBncm91cCBwYWxldHRlIChlLmcuICMwRjc2NkUpJyxcbiAgICApXG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3IpXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGdyb3VwIG5hbWUgaXMgbm9uLWVtcHR5IGFmdGVyIHRyaW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5jb25zdCBEQVRFX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBUSU1FX1JFID0gL15cXGR7Mn06XFxkezJ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoZGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFEQVRFX1JFLnRlc3QoZGF0ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignb2NjdXJyZW5jZURhdGUgbXVzdCBiZSBZWVlZLU1NLUREJylcbiAgfVxuICByZXR1cm4gZGF0ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXModmFsdWU6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8IDAgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ2R1cmF0aW9uTWludXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZXZWVrKGRheXNPZldlZWs6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2Zfd2VlayddKTogdm9pZCB7XG4gIGlmICghZGF5c09mV2VlayB8fCBkYXlzT2ZXZWVrLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgaXMgcmVxdWlyZWQgZm9yIHdlZWtseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKGRheXNPZldlZWsuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDAgfHwgZGF5ID4gNikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDAgKFN1bmRheSkgYW5kIDYgKFNhdHVyZGF5KScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mTW9udGgoXG4gIGRheXNPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX21vbnRoJ10sXG4gIGlzTGFzdERheU9mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2lzX2xhc3RfZGF5X29mX21vbnRoJ10sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFzRGF5c09mTW9udGggPSAhIWRheXNPZk1vbnRoICYmIGRheXNPZk1vbnRoLmxlbmd0aCA+IDBcbiAgaWYgKCFoYXNEYXlzT2ZNb250aCAmJiAhaXNMYXN0RGF5T2ZNb250aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG9yIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aCBpcyByZXF1aXJlZCBmb3IgbW9udGhseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKFxuICAgIGhhc0RheXNPZk1vbnRoICYmXG4gICAgZGF5c09mTW9udGghLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAxIHx8IGRheSA+IDMxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAxIGFuZCAzMScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGludGVydmFsRGF5czogUmVjdXJyZW5jZUNvbmZpZ1snaW50ZXJ2YWxfZGF5cyddKTogdm9pZCB7XG4gIGlmIChcbiAgICBpbnRlcnZhbERheXMgPT09IHVuZGVmaW5lZCB8fFxuICAgIGludGVydmFsRGF5cyA9PT0gbnVsbCB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGludGVydmFsRGF5cykgfHxcbiAgICBpbnRlcnZhbERheXMgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5pbnRlcnZhbF9kYXlzIG11c3QgYmUgYW4gaW50ZWdlciA+PSAxIGZvciBldmVyeV94X2RheXMgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxUaXRsZSh0aXRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHRpdGxlLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0aXRsZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIG11c3QgYmUgYXQgbW9zdCAyNTUgY2hhcmFjdGVycycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUnVsZVR5cGUocnVsZVR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghR09BTF9SVUxFX1RZUEVTLmluY2x1ZGVzKHJ1bGVUeXBlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgYHJ1bGVUeXBlIG11c3QgYmUgb25lIG9mOiAke0dPQUxfUlVMRV9UWVBFUy5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiBydWxlVHlwZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUYXJnZXRWYWx1ZSh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGFyZ2V0VmFsdWUgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxMaW5rcyhcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxMaW5rSW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBsaW5rcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnKSB7XG4gICAgaWYgKGxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyBtdXN0IG5vdCBoYXZlIGFjdGl2aXR5L2dyb3VwIGxpbmtzJylcbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2F0IGxlYXN0IG9uZSBsaW5rIGlzIHJlcXVpcmVkJylcbiAgfVxuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlzdCkge1xuICAgIGlmIChsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBpZiAobGluay5hY3Rpdml0eUlkID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIHJlcXVpcmUgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgICBpZiAobGluay5ncm91cElkICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIG11c3Qgbm90IHNldCBncm91cElkJylcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxpbmsubGlua1R5cGUgPT09ICdncm91cCcpIHtcbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgcmVxdWlyZSBncm91cElkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgbXVzdCBub3Qgc2V0IGFjdGl2aXR5SWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGlua1R5cGUgbXVzdCBiZSBhY3Rpdml0eSBvciBncm91cCcpXG4gICAgfVxuICAgIGlmIChsaW5rLndlaWdodCAhPSBudWxsICYmICghTnVtYmVyLmlzRmluaXRlKGxpbmsud2VpZ2h0KSB8fCBsaW5rLndlaWdodCA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2xpbmsgd2VpZ2h0IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10gfCB1bmRlZmluZWQsXG4gIHJ1bGVUeXBlOiBzdHJpbmcsXG4pOiBHb2FsRGVwZW5kZW5jeUlucHV0W10ge1xuICBjb25zdCBsaXN0ID0gZGVwcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnICYmIGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyByZXF1aXJlIGF0IGxlYXN0IG9uZSBkZXBlbmRlbmN5JylcbiAgfVxuICBmb3IgKGNvbnN0IGRlcCBvZiBsaXN0KSB7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGRlcC5kZXBlbmRzT25Hb2FsSWQpIHx8IGRlcC5kZXBlbmRzT25Hb2FsSWQgPD0gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZHNPbkdvYWxJZCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPSBudWxsICYmXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT09ICdjb21wbGV0ZScgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ3Byb2dyZXNzJ1xuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlcXVpcmVtZW50IG11c3QgYmUgY29tcGxldGUgb3IgcHJvZ3Jlc3MnKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB7XG4gIGlmIChyZWN1cnJlbmNlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHBlcmlvZHMgPSBbJ3dlZWtseScsICdtb250aGx5JywgJ3F1YXJ0ZXJseScsICdldmVyeV94X2RheXMnXVxuICBpZiAoIXBlcmlvZHMuaW5jbHVkZXMocmVjdXJyZW5jZS5wZXJpb2QpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYHVuc3VwcG9ydGVkIHJlY3VycmVuY2UgcGVyaW9kOiAke3JlY3VycmVuY2UucGVyaW9kfWApXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuaW50ZXJ2YWwgIT0gbnVsbCAmJlxuICAgICghTnVtYmVyLmlzSW50ZWdlcihyZWN1cnJlbmNlLmludGVydmFsKSB8fCByZWN1cnJlbmNlLmludGVydmFsIDwgMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlY3VycmVuY2UuaW50ZXJ2YWwgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEnKVxuICB9XG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPSBudWxsICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdub25lJyAmJlxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9PSAnb3ZlcmZsb3cnXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjYXJyeU92ZXIgbXVzdCBiZSBub25lIG9yIG92ZXJmbG93JylcbiAgfVxuICByZXR1cm4gcmVjdXJyZW5jZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVhZGxpbmUoXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwge1xuICBpZiAoZGVhZGxpbmUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdhYnNvbHV0ZScpIHtcbiAgICBpZiAoIWRlYWRsaW5lLmRhdGUgfHwgIURBVEVfUkUudGVzdChkZWFkbGluZS5kYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2Fic29sdXRlIGRlYWRsaW5lIHJlcXVpcmVzIGRhdGUgWVlZWS1NTS1ERCcpXG4gICAgfVxuICB9IGVsc2UgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScpIHtcbiAgICBpZiAoXG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0ID09IG51bGwgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQpIHx8XG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0IDwgMFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICdyZWxhdGl2ZSBkZWFkbGluZSByZXF1aXJlcyBkYXlzQWZ0ZXJDeWNsZVN0YXJ0ID49IDAnLFxuICAgICAgKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUua2luZCBtdXN0IGJlIGFic29sdXRlIG9yIHJlbGF0aXZlJylcbiAgfVxuICByZXR1cm4gZGVhZGxpbmVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ3JlYXRlR29hbElucHV0KGlucHV0OiBDcmVhdGVHb2FsSW5wdXQpIHtcbiAgY29uc3QgdGl0bGUgPSB2YWxpZGF0ZUdvYWxUaXRsZShpbnB1dC50aXRsZSlcbiAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcilcbiAgY29uc3QgcnVsZVR5cGUgPSB2YWxpZGF0ZVJ1bGVUeXBlKGlucHV0LnJ1bGVUeXBlKVxuICBjb25zdCB0YXJnZXRWYWx1ZSA9IHZhbGlkYXRlVGFyZ2V0VmFsdWUoaW5wdXQudGFyZ2V0VmFsdWUpXG4gIGlmIChpbnB1dC5tZXRyaWMgIT09ICdjb3VudCcgJiYgaW5wdXQubWV0cmljICE9PSAnZHVyYXRpb24nKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ21ldHJpYyBtdXN0IGJlIGNvdW50IG9yIGR1cmF0aW9uJylcbiAgfVxuICBjb25zdCBsaW5rcyA9IHZhbGlkYXRlR29hbExpbmtzKGlucHV0LmxpbmtzLCBydWxlVHlwZSlcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKGlucHV0LmRlcGVuZGVuY2llcywgcnVsZVR5cGUpXG4gIGNvbnN0IHJlY3VycmVuY2UgPSB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKGlucHV0LnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gdmFsaWRhdGVHb2FsRGVhZGxpbmUoaW5wdXQuZGVhZGxpbmUpXG5cbiAgaWYgKGlucHV0LmNvbmZpZz8uYmVmb3JlVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5iZWZvcmVUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdiZWZvcmVUaW1lIG11c3QgYmUgSEg6bW0nKVxuICB9XG4gIGlmIChpbnB1dC5jb25maWc/LmFmdGVyVGltZSAmJiAhVElNRV9SRS50ZXN0KGlucHV0LmNvbmZpZy5hZnRlclRpbWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FmdGVyVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuXG4gIHJldHVybiB7XG4gICAgdGl0bGUsXG4gICAgY29sb3IsXG4gICAgcnVsZVR5cGUsXG4gICAgdGFyZ2V0VmFsdWUsXG4gICAgbGlua3MsXG4gICAgZGVwZW5kZW5jaWVzLFxuICAgIHJlY3VycmVuY2UsXG4gICAgZGVhZGxpbmUsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVXBkYXRlR29hbElucHV0KGlucHV0OiBVcGRhdGVHb2FsSW5wdXQsIGV4aXN0aW5nUnVsZVR5cGU6IHN0cmluZykge1xuICBjb25zdCBydWxlVHlwZSA9IGlucHV0LnJ1bGVUeXBlICE9IG51bGxcbiAgICA/IHZhbGlkYXRlUnVsZVR5cGUoaW5wdXQucnVsZVR5cGUpXG4gICAgOiBleGlzdGluZ1J1bGVUeXBlXG5cbiAgaWYgKGlucHV0LnRpdGxlICE9IG51bGwpIHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKVxuICBpZiAoaW5wdXQuY29sb3IgIT0gbnVsbCkgdmFsaWRhdGVHb2FsQ29sb3IoaW5wdXQuY29sb3IpXG4gIGlmIChpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsKSB2YWxpZGF0ZVRhcmdldFZhbHVlKGlucHV0LnRhcmdldFZhbHVlKVxuICBpZiAoaW5wdXQubWV0cmljICE9IG51bGwgJiYgaW5wdXQubWV0cmljICE9PSAnY291bnQnICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2R1cmF0aW9uJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdtZXRyaWMgbXVzdCBiZSBjb3VudCBvciBkdXJhdGlvbicpXG4gIH1cbiAgaWYgKGlucHV0LnN0YXR1cyAhPSBudWxsKSB7XG4gICAgY29uc3QgYWxsb3dlZCA9IFsnYWN0aXZlJywgJ3BhdXNlZCcsICdjb21wbGV0ZWQnLCAnYXJjaGl2ZWQnLCAnZmFpbGVkJ11cbiAgICBpZiAoIWFsbG93ZWQuaW5jbHVkZXMoaW5wdXQuc3RhdHVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYGludmFsaWQgc3RhdHVzOiAke2lucHV0LnN0YXR1c31gKVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxpbmtzID0gaW5wdXQubGlua3MgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsTGlua3MoaW5wdXQubGlua3MsIHJ1bGVUeXBlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IGlucHV0LmRlcGVuZGVuY2llcyAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoaW5wdXQuZGVwZW5kZW5jaWVzLCBydWxlVHlwZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCByZWN1cnJlbmNlID0gaW5wdXQucmVjdXJyZW5jZSAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKGlucHV0LnJlY3VycmVuY2UpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgZGVhZGxpbmUgPSBpbnB1dC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxEZWFkbGluZShpbnB1dC5kZWFkbGluZSlcbiAgICA6IHVuZGVmaW5lZFxuXG4gIHJldHVybiB7IHJ1bGVUeXBlLCBsaW5rcywgZGVwZW5kZW5jaWVzLCByZWN1cnJlbmNlLCBkZWFkbGluZSB9XG59XG5cbi8qKlxuICogRGV0ZWN0cyB3aGV0aGVyIGFkZGluZyBlZGdlcyB3b3VsZCBjcmVhdGUgYSBjeWNsZSBpbiB0aGUgZGVwZW5kZW5jeSBEQUcuXG4gKiBgZWRnZXNgIGlzIHRoZSBmdWxsIGFkamFjZW5jeSBsaXN0IGFmdGVyIHRoZSBwcm9wb3NlZCBjaGFuZ2UgKGdvYWxJZCAtPiBkZXBzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKFxuICBlZGdlczogTWFwPG51bWJlciwgbnVtYmVyW10+LFxuICBzdGFydElkOiBudW1iZXIsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgdmlzaXRpbmcgPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCB2aXNpdGVkID0gbmV3IFNldDxudW1iZXI+KClcblxuICBmdW5jdGlvbiBkZnMobm9kZTogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgaWYgKHZpc2l0aW5nLmhhcyhub2RlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmlzaXRlZC5oYXMobm9kZSkpIHJldHVybiBmYWxzZVxuICAgIHZpc2l0aW5nLmFkZChub2RlKVxuICAgIGZvciAoY29uc3QgbmV4dCBvZiBlZGdlcy5nZXQobm9kZSkgPz8gW10pIHtcbiAgICAgIGlmIChkZnMobmV4dCkpIHJldHVybiB0cnVlXG4gICAgfVxuICAgIHZpc2l0aW5nLmRlbGV0ZShub2RlKVxuICAgIHZpc2l0ZWQuYWRkKG5vZGUpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gZGZzKHN0YXJ0SWQpXG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuLy8gUHlsb24gc2VydmVzIHRoZSBidWlsdCBhcHAgd2l0aCBCdW4vTm9kZSBcdTIwMTQgdXNlIHByb2Nlc3MuZW52LCBub3QgRGVuby5lbnYuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLFNBQVMsV0FBVzs7O0FDQXBCLE9BQStDO0FBQy9DLFNBQVMsa0JBQWtCOzs7QUNEM0IsT0FBMEU7OztBQ0MxRSxTQUFTLFlBQVk7QUFDckIsU0FBUyxRQUFRLHVCQUF1QjtBQUV4QyxJQUFNLFVBQVUsSUFBSSxnQkFBZ0I7QUFBQSxFQUNsQyxNQUFNLElBQUksS0FBSztBQUFBLElBQ2IsVUFBVTtBQUFBLElBQ1YsTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sVUFBVTtBQUFBLElBQ1YsTUFBTTtBQUFBLElBQ04sS0FBSztBQUFBLEVBQ1AsQ0FBQztBQUNILENBQUM7QUFNTSxJQUFNLEtBQUssSUFBSSxPQUFpQjtBQUFBLEVBQ3JDO0FBQ0YsQ0FBQzs7O0FDakJNLElBQU0sc0JBQXNCO0FBQUEsRUFDakM7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUFBLEVBQ0E7QUFBQTtBQUNGO0FBSUEsSUFBTSxlQUFlO0FBRWQsU0FBUyxvQkFBb0IsT0FBb0M7QUFDdEUsTUFBSSxDQUFDLGFBQWEsS0FBSyxLQUFLLEVBQUcsUUFBTztBQUN0QyxRQUFNLGFBQWEsTUFBTSxZ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QUN2QyxZQUFZLFNBQVM7QUFBQSxJQUNyQixPQUFPLFNBQVM7QUFBQSxFQUNsQixDQUFDO0FBRUQsTUFBSSxJQUFJLGNBQWMsU0FBUyxVQUFVO0FBQ3pDLE1BQUksU0FBUyxPQUFPO0FBQ2xCLFFBQUksSUFBSSxhQUFhLFNBQVMsS0FBSztBQUFBLEVBQ3JDO0FBQ0EsTUFBSSxJQUFJLFVBQVUsVUFBVSxFQUFFO0FBRTlCLFFBQU0sS0FBSztBQUNiLENBQUM7QUFFTSxJQUFNLFVBQVU7QUFBQSxFQUNyQixHQUFHO0FBQ0w7QUFFQSxJQUFPLGNBQVE7QUFJVCxJQUFJLHdCQUF3QjtBQUU1QixJQUFJO0FBQ0YsMEJBQXdCO0FBQzFCLFFBQVE7QUFFUjtBQUVBLElBQUksSUFBSSx1QkFBdUI7QUFBQSxFQUM3QixVQUFVO0FBQUEsRUFDVjtBQUFBLEVBQ0EsV0FBVyxDQUFDO0FBQUEsRUFDWixRQUFRO0FBQ1YsQ0FBQyxDQUFDOyIsCiAgIm5hbWVzIjogWyJjb25maWciLCAiY29uZmlnIiwgImNvbmZpZyIsICJyZXN1bHQiLCAiYWN0aXZpdHkiXQp9Cg==
