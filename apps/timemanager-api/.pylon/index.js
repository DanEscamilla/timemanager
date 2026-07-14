// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import "kysely";
import { getContext as getContext2 } from "@getcronit/pylon";

// src/db/types/schema.ts
import "kysely";

// src/db/database.ts
import { Pool, types } from "pg";
import { Kysely, PostgresDialect } from "kysely";
types.setTypeParser(types.builtins.DATE, (value) => value);
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

// src/graphql/resolvers/resolvers.ts
function requireUserId2() {
  const userId = getContext2().get("userId");
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
    const userId = requireUserId2();
    return await db.selectFrom("groups").where("user_id", "=", userId).orderBy("name", "asc").selectAll().execute();
  },
  group: async (args) => {
    const userId = requireUserId2();
    const { id } = args;
    return await db.selectFrom("groups").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst() ?? null;
  },
  activities: async (args) => {
    const userId = requireUserId2();
    const rows = await db.selectFrom("activities").where("user_id", "=", userId).selectAll().execute();
    return rows.map(withActivityRelations);
  },
  activity: async (args) => {
    const userId = requireUserId2();
    const { id } = args;
    const row = await db.selectFrom("activities").where("id", "=", id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    return row ? withActivityRelations(row) : null;
  },
  activityCompletions: async (args) => {
    const userId = requireUserId2();
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
  ...GoalQuery
};
var Mutation = {
  createGroup: async (args) => {
    const { input } = args;
    const userId = requireUserId2();
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
    const userId = requireUserId2();
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
    const userId = requireUserId2();
    const result2 = await db.deleteFrom("groups").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  createActivity: async (args) => {
    const { input } = args;
    const userId = requireUserId2();
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
    const userId = requireUserId2();
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
    const userId = requireUserId2();
    const result2 = await db.deleteFrom("activities").where("id", "=", id).where("user_id", "=", userId).execute();
    return result2.length > 0;
  },
  completeActivity: async (args) => {
    const userId = requireUserId2();
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
    return completion;
  },
  undoCompletion: async (args) => {
    const userId = requireUserId2();
    const existing = await db.selectFrom("activity_completions").where("id", "=", args.id).where("user_id", "=", userId).selectAll().executeTakeFirst();
    if (!existing) return false;
    const activity = await fetchOwnedActivity(existing.activity_id, userId);
    await db.transaction().execute(async (trx) => {
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
    const userId = requireUserId2();
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
  ...GoalMutation
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
  typeDefs: "input ArgsInput {\n	status: String\n}\ninput ArgsInput_1 {\n	id: Number!\n}\ninput ArgsInput_2 {\n	date: String\n}\ninput ArgsInput_3 {\n	id: Number!\n}\ninput ArgsInput_4 {\n	id: Number!\n}\ninput ArgsInput_5 {\n	activityId: Number\n	fromDate: String\n	toDate: String\n}\ninput ArgsInput_6 {\n	input: CreateGoalInputInput!\n}\ninput CreateGoalInputInput {\n	title: String!\n	description: String\n	color: String!\n	icon: String\n	ruleType: String!\n	metric: COUNT_DURATIONInput!\n	targetValue: Number!\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	priority: Number\n	sortOrder: Number\n}\ninput GoalConfigInputInput {\n	compositeMode: ALL_ANY_WEIGHTEDInput\n	countRequired: Number\n	beforeTime: String\n	afterTime: String\n	blockUntilUnlocked: Boolean\n}\ninput GoalLinkInputInput {\n	linkType: ACTIVITY_GROUPInput!\n	activityId: Number\n	groupId: Number\n	weight: Number\n}\ninput GoalDependencyInputInput {\n	dependsOnGoalId: Number!\n	requirement: COMPLETE_PROGRESSInput\n	threshold: Number\n	weight: Number\n}\ninput GoalRecurrenceInputInput {\n	period: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput!\n	interval: Number\n	anchor: String\n	carryOver: NONE_OVERFLOWInput\n	reset: String\n}\ninput GoalDeadlineInputInput {\n	kind: ABSOLUTE_RELATIVEInput!\n	date: String\n	daysAfterCycleStart: Number\n	graceDays: Number\n	warnDays: Number\n}\ninput ArgsInput_7 {\n	id: Number!\n	input: UpdateGoalInputInput!\n}\ninput UpdateGoalInputInput {\n	title: String\n	description: String\n	color: String\n	icon: String\n	ruleType: String\n	metric: COUNT_DURATIONInput\n	targetValue: Number\n	config: GoalConfigInputInput\n	links: [GoalLinkInputInput!]\n	dependencies: [GoalDependencyInputInput!]\n	recurrence: GoalRecurrenceInputInput\n	deadline: GoalDeadlineInputInput\n	startsAt: String\n	confirmStartsAtChange: Boolean\n	status: ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput\n	priority: Number\n	sortOrder: Number\n}\ninput ArgsInput_8 {\n	id: Number!\n}\ninput ArgsInput_9 {\n	id: Number!\n}\ninput ArgsInput_10 {\n	id: Number!\n}\ninput ArgsInput_11 {\n	id: Number!\n}\ninput ArgsInput_12 {\n	input: CreateGroupInputInput!\n}\ninput CreateGroupInputInput {\n	name: String!\n	color: String!\n}\ninput ArgsInput_13 {\n	id: Number!\n	input: UpdateGroupInputInput!\n}\ninput UpdateGroupInputInput {\n	name: String\n	color: String\n}\ninput ArgsInput_14 {\n	id: Number!\n}\ninput ArgsInput_15 {\n	input: CreateActivityInputInput!\n}\ninput CreateActivityInputInput {\n	title: String!\n	description: String\n	startTime: String!\n	endTime: String!\n	isRecurring: Boolean!\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n}\ninput RecurrencePatternInputInput {\n	recurrenceType: RecurrenceTypeInput!\n	config: RecurrenceConfigInput!\n}\ninput RecurrenceConfigInput {\n	days_of_week: [Number!]\n	days_of_month: [Number!]\n	is_last_day_of_month: Boolean\n	interval_days: Number\n	start_date: String!\n	end_date: String\n}\ninput ArgsInput_16 {\n	id: Number!\n	input: UpdateActivityInputInput!\n}\ninput UpdateActivityInputInput {\n	title: String\n	description: String\n	startTime: String\n	endTime: String\n	isRecurring: Boolean\n	date: String\n	recurrencePattern: RecurrencePatternInputInput\n	groupId: Number\n}\ninput ArgsInput_17 {\n	id: Number!\n}\ninput ArgsInput_18 {\n	input: CompleteActivityInputInput!\n}\ninput CompleteActivityInputInput {\n	activityId: Number!\n	occurrenceDate: String!\n	durationMinutes: Number\n	notes: String\n}\ninput ArgsInput_19 {\n	id: Number!\n}\ninput ArgsInput_20 {\n	input: LogTimeInputInput!\n}\ninput LogTimeInputInput {\n	activityId: Number!\n	durationMinutes: Number!\n	occurrenceDate: String\n	notes: String\n}\ntype Query {\ngoals(args: ArgsInput): [Goals!]!\ngoal(args: ArgsInput_1!): Goals\ngoalNudges(args: Object): [GoalNudge!]!\ndailyProgress(args: ArgsInput_2): DailyProgress!\ngroups(args: Object): [Groups!]!\ngroup(args: ArgsInput_3!): Groups\nactivities(args: Object): [Activities!]!\nactivity(args: ArgsInput_4!): Activities\nactivityCompletions(args: ArgsInput_5): [ActivityCompletions!]!\n}\ntype Goals {\ntarget_value: Number!\nstartsAt: String!\nlifecyclePhase: GoalLifecyclePhase!\nconfig: GoalConfig!\nrecurrence: GoalRecurrenceConfig\ndeadline: GoalDeadlineConfig\nlinks: [Links!]!\nactiveCycle: ActiveCycle\ncycles: [CyclesAndCycles_1!]!\ndependencies: [Dependencies!]!\nsnapshots: [Snapshots!]!\nisLocked: Boolean!\nuser_id: Number!\nid: Number!\ntitle: String!\ndescription: String\ncolor: String!\nicon: String\nrule_type: String!\nmetric: GoalMetric!\nstatus: GoalStatus!\npriority: Number!\nsort_order: Number!\nstarts_at: Date!\ncreated_at: Date!\nupdated_at: Date!\n}\ntype GoalConfig {\ncomposite_mode: ALL_ANY_WEIGHTED\ncount_required: Number\nbefore_time: String\nafter_time: String\nblock_until_unlocked: Boolean\n}\ntype GoalRecurrenceConfig {\nperiod: WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS!\ninterval: Number\nanchor: String\ncarry_over: NONE_OVERFLOW\nreset: String\n}\ntype GoalDeadlineConfig {\nkind: ABSOLUTE_RELATIVE!\ndate: String\ndays_after_cycle_start: Number\ngrace_days: Number\nwarn_days: Number\n}\ntype Links {\nactivity: Activity\ngroup: Groups\nweight: Number!\nid: Number!\ncreated_at: Date!\nactivity_id: Number\ngoal_id: Number!\nlink_type: GoalLinkType!\ngroup_id: Number\n}\ntype Activity {\nuser_id: Number!\nid: Number!\ntitle: String!\ndescription: String\ncreated_at: Date!\nupdated_at: Date!\ngroup_id: Number\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\n}\ntype Groups {\nuser_id: Number!\nid: Number!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\nname: String!\n}\ntype ActiveCycle {\ndeadlineState: DeadlineState!\npercentComplete: Number!\nremaining: Number!\nid: Number!\ntarget_value: Number!\nstatus: GoalCycleStatus!\nstarts_at: Date!\ncreated_at: Date!\nupdated_at: Date!\ngoal_id: Number!\ncycle_index: Number!\nends_at: Date\ndeadline_at: Date\ncurrent_value: Number!\ncarry_over: Number!\n}\ntype CyclesAndCycles_1 {\nid: Number!\ntarget_value: Number!\nstatus: GoalCycleStatus!\nstarts_at: Date!\ncreated_at: Date!\nupdated_at: Date!\ngoal_id: Number!\ncycle_index: Number!\nends_at: Date\ndeadline_at: Date\ncurrent_value: Number!\ncarry_over: Number!\n}\ntype Dependencies {\ndependsOn: Goals\nthreshold: Number\nweight: Number!\nid: Number!\ncreated_at: Date!\ngoal_id: Number!\ndepends_on_goal_id: Number!\nrequirement: GoalDependencyRequirement!\n}\ntype Snapshots {\nvalue: Number!\nid: Number!\ncreated_at: Date!\ngoal_cycle_id: Number!\nas_of: String!\n}\ntype GoalNudge {\nkind: GoalNudgeKind!\ngoalId: Number!\ntitle: String!\nmessage: String!\nseverity: INFO_WARNING_SUCCESS!\n}\ntype DailyProgress {\ndate: String!\ncompletedCount: Number!\nminutesToday: Number!\nstreakDays: Number!\ncompletions: [ActivityCompletions!]!\n}\ntype ActivityCompletions {\nuser_id: Number!\nid: Number!\nactivity_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata\n}\ntype Metadata {\ntitle: String\nnotes: String\ntrigger_events: [String!]\n}\ntype Activities {\nrecurrencePattern: ParsedRecurrencePattern\ngroup: Group\nuser_id: Number!\nid: Number!\ntitle: String!\ndescription: String\ncreated_at: Date!\nupdated_at: Date!\ngroup_id: Number\nstart_time: String!\nend_time: String!\nis_recurring: Boolean!\ndate: String\n}\ntype ParsedRecurrencePattern {\nconfig: RecurrenceConfig!\nid: Number!\ncreated_at: Date!\nupdated_at: Date!\nactivity_id: Number!\nrecurrence_type: WEEKLY_MONTHLY_EVERY_X_DAYS!\n}\ntype RecurrenceConfig {\ndays_of_week: [Number!]\ndays_of_month: [Number!]\nis_last_day_of_month: Boolean\ninterval_days: Number\nstart_date: String!\nend_date: String\n}\ntype Group {\nuser_id: Number!\nid: Number!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\nname: String!\n}\ntype Mutation {\ncreateGoal(args: ArgsInput_6!): Goals!\nupdateGoal(args: ArgsInput_7!): Goals!\npauseGoal(args: ArgsInput_8!): Goals!\nresumeGoal(args: ArgsInput_9!): Goals!\narchiveGoal(args: ArgsInput_10!): Goals!\ndeleteGoal(args: ArgsInput_11!): Boolean!\nrecomputeGoalProgress(args: Object): RecomputeGoalProgress!\ncreateGroup(args: ArgsInput_12!): CreateGroup!\nupdateGroup(args: ArgsInput_13!): CreateGroup!\ndeleteGroup(args: ArgsInput_14!): Boolean!\ncreateActivity(args: ArgsInput_15!): Activities!\nupdateActivity(args: ArgsInput_16!): Activities!\ndeleteActivity(args: ArgsInput_17!): Boolean!\ncompleteActivity(args: ArgsInput_18!): CompleteActivity!\nundoCompletion(args: ArgsInput_19!): Boolean!\nlogTime(args: ArgsInput_20!): LogTime!\n}\ntype RecomputeGoalProgress {\nrecomputed: Number!\n}\ntype CreateGroup {\nuser_id: Number!\nid: Number!\ncolor: String!\ncreated_at: Date!\nupdated_at: Date!\nname: String!\n}\ntype CompleteActivity {\nuser_id: Number!\nid: Number!\nactivity_id: Number!\noccurrence_date: String!\nduration_minutes: Number\ncompleted_at: Date!\nmetadata: Metadata\n}\ntype LogTime {\namount: Number!\nuser_id: Number!\nid: Number!\nmetric: GoalEventMetric!\ncreated_at: Date!\nactivity_id: Number\noccurrence_date: String\nmetadata: Object\ngroup_id: Number\nsource_type: GoalEventSourceType!\ncompletion_id: Number\noccurred_at: Date!\n}\nscalar ID\nscalar Int\nscalar Float\nscalar Number\nscalar Any\nscalar Void\nscalar Object\nscalar File\nscalar Date\nscalar JSON\nscalar String\nscalar Boolean\nenum GoalLifecyclePhase {\n	active\n	paused\n	completed\n	archived\n	failed\n	scheduled\n}\nenum GoalMetric {\n	count\n	duration\n}\nenum GoalStatus {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum ALL_ANY_WEIGHTED {\n	all\n	any\n	weighted\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOW {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVE {\n	absolute\n	relative\n}\nenum GoalLinkType {\n	activity\n	group\n}\nenum DeadlineState {\n	failed\n	on_track\n	approaching\n	overdue\n}\nenum GoalCycleStatus {\n	active\n	failed\n	succeeded\n	missed\n}\nenum GoalDependencyRequirement {\n	complete\n	progress\n}\nenum GoalNudgeKind {\n	deadline_approaching\n	deadline_overdue\n	behind_pace\n	cycle_complete\n	dependency_unlocked\n	goal_starting_soon\n}\nenum INFO_WARNING_SUCCESS {\n	info\n	warning\n	success\n}\nenum WEEKLY_MONTHLY_EVERY_X_DAYS {\n	weekly\n	monthly\n	every_x_days\n}\nenum GoalEventMetric {\n	count\n	duration\n}\nenum GoalEventSourceType {\n	completion\n	time_log\n	manual\n}\nenum COUNT_DURATIONInput {\n	count\n	duration\n}\nenum ALL_ANY_WEIGHTEDInput {\n	all\n	any\n	weighted\n}\nenum ACTIVITY_GROUPInput {\n	activity\n	group\n}\nenum COMPLETE_PROGRESSInput {\n	complete\n	progress\n}\nenum WEEKLY_MONTHLY_QUARTERLY_EVERY_X_DAYSInput {\n	weekly\n	monthly\n	quarterly\n	every_x_days\n}\nenum NONE_OVERFLOWInput {\n	none\n	overflow\n}\nenum ABSOLUTE_RELATIVEInput {\n	absolute\n	relative\n}\nenum ACTIVE_PAUSED_COMPLETED_ARCHIVED_FAILEDInput {\n	active\n	paused\n	completed\n	archived\n	failed\n}\nenum RecurrenceTypeInput {\n	weekly\n	monthly\n	every_x_days\n}\n",
  graphql,
  resolvers: {},
  config: __internalPylonConfig
}));
export {
  src_default as default,
  graphql
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dvYWxzL2xpZmVjeWNsZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ29hbHMvcHJvZ3Jlc3MudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9ncmFwaHFsL251bWVyaWMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL2dvYWxzX3Jlc29sdmVycy50cyIsICIuLi9zcmMvZ29hbHMvY3ljbGVzLnRzIiwgIi4uL3NyYy9nb2Fscy9udWRnZXMudHMiLCAiLi4vc3JjL2F1dGgvdmVyaWZ5LnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHtcbiAgY29yc01pZGRsZXdhcmUsXG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbn0gZnJvbSAnLi9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgfSBmcm9tICcuL2RiL3VzZXJzLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSkge1xuICAgIGF3YWl0IG5leHQoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcbiAgfVxuXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuXG4gIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICBjdHguc2V0KCdhdXRoRW1haWwnLCB2ZXJpZmllZC5lbWFpbClcbiAgfVxuICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgYXdhaXQgbmV4dCgpXG59KVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdHN0YXR1czogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNiB7XFxuXFx0aW5wdXQ6IENyZWF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZyFcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRydWxlVHlwZTogU3RyaW5nIVxcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dCFcXG5cXHR0YXJnZXRWYWx1ZTogTnVtYmVyIVxcblxcdGNvbmZpZzogR29hbENvbmZpZ0lucHV0SW5wdXRcXG5cXHRsaW5rczogW0dvYWxMaW5rSW5wdXRJbnB1dCFdXFxuXFx0ZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3lJbnB1dElucHV0IV1cXG5cXHRyZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXRcXG5cXHRkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXRJbnB1dFxcblxcdHN0YXJ0c0F0OiBTdHJpbmdcXG5cXHRwcmlvcml0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbENvbmZpZ0lucHV0SW5wdXQge1xcblxcdGNvbXBvc2l0ZU1vZGU6IEFMTF9BTllfV0VJR0hURURJbnB1dFxcblxcdGNvdW50UmVxdWlyZWQ6IE51bWJlclxcblxcdGJlZm9yZVRpbWU6IFN0cmluZ1xcblxcdGFmdGVyVGltZTogU3RyaW5nXFxuXFx0YmxvY2tVbnRpbFVubG9ja2VkOiBCb29sZWFuXFxufVxcbmlucHV0IEdvYWxMaW5rSW5wdXRJbnB1dCB7XFxuXFx0bGlua1R5cGU6IEFDVElWSVRZX0dST1VQSW5wdXQhXFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyXFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbERlcGVuZGVuY3lJbnB1dElucHV0IHtcXG5cXHRkZXBlbmRzT25Hb2FsSWQ6IE51bWJlciFcXG5cXHRyZXF1aXJlbWVudDogQ09NUExFVEVfUFJPR1JFU1NJbnB1dFxcblxcdHRocmVzaG9sZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbFJlY3VycmVuY2VJbnB1dElucHV0IHtcXG5cXHRwZXJpb2Q6IFdFRUtMWV9NT05USExZX1FVQVJURVJMWV9FVkVSWV9YX0RBWVNJbnB1dCFcXG5cXHRpbnRlcnZhbDogTnVtYmVyXFxuXFx0YW5jaG9yOiBTdHJpbmdcXG5cXHRjYXJyeU92ZXI6IE5PTkVfT1ZFUkZMT1dJbnB1dFxcblxcdHJlc2V0OiBTdHJpbmdcXG59XFxuaW5wdXQgR29hbERlYWRsaW5lSW5wdXRJbnB1dCB7XFxuXFx0a2luZDogQUJTT0xVVEVfUkVMQVRJVkVJbnB1dCFcXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRkYXlzQWZ0ZXJDeWNsZVN0YXJ0OiBOdW1iZXJcXG5cXHRncmFjZURheXM6IE51bWJlclxcblxcdHdhcm5EYXlzOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzcge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0cnVsZVR5cGU6IFN0cmluZ1xcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dFxcblxcdHRhcmdldFZhbHVlOiBOdW1iZXJcXG5cXHRjb25maWc6IEdvYWxDb25maWdJbnB1dElucHV0XFxuXFx0bGlua3M6IFtHb2FsTGlua0lucHV0SW5wdXQhXVxcblxcdGRlcGVuZGVuY2llczogW0dvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCFdXFxuXFx0cmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dElucHV0XFxuXFx0ZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0SW5wdXRcXG5cXHRzdGFydHNBdDogU3RyaW5nXFxuXFx0Y29uZmlybVN0YXJ0c0F0Q2hhbmdlOiBCb29sZWFuXFxuXFx0c3RhdHVzOiBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dFxcblxcdHByaW9yaXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfOCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzkge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzExIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTIge1xcblxcdGlucHV0OiBDcmVhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlR3JvdXBJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHcm91cElucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTUge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE2IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRzdGFydFRpbWU6IFN0cmluZ1xcblxcdGVuZFRpbWU6IFN0cmluZ1xcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0cmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dFxcblxcdGdyb3VwSWQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTcge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOCB7XFxuXFx0aW5wdXQ6IENvbXBsZXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDb21wbGV0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyIVxcblxcdG9jY3VycmVuY2VEYXRlOiBTdHJpbmchXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXJcXG5cXHRub3RlczogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIwIHtcXG5cXHRpbnB1dDogTG9nVGltZUlucHV0SW5wdXQhXFxufVxcbmlucHV0IExvZ1RpbWVJbnB1dElucHV0IHtcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXIhXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXIhXFxuXFx0b2NjdXJyZW5jZURhdGU6IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxuZ29hbHMoYXJnczogQXJnc0lucHV0KTogW0dvYWxzIV0hXFxuZ29hbChhcmdzOiBBcmdzSW5wdXRfMSEpOiBHb2Fsc1xcbmdvYWxOdWRnZXMoYXJnczogT2JqZWN0KTogW0dvYWxOdWRnZSFdIVxcbmRhaWx5UHJvZ3Jlc3MoYXJnczogQXJnc0lucHV0XzIpOiBEYWlseVByb2dyZXNzIVxcbmdyb3VwcyhhcmdzOiBPYmplY3QpOiBbR3JvdXBzIV0hXFxuZ3JvdXAoYXJnczogQXJnc0lucHV0XzMhKTogR3JvdXBzXFxuYWN0aXZpdGllcyhhcmdzOiBPYmplY3QpOiBbQWN0aXZpdGllcyFdIVxcbmFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF80ISk6IEFjdGl2aXRpZXNcXG5hY3Rpdml0eUNvbXBsZXRpb25zKGFyZ3M6IEFyZ3NJbnB1dF81KTogW0FjdGl2aXR5Q29tcGxldGlvbnMhXSFcXG59XFxudHlwZSBHb2FscyB7XFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhcnRzQXQ6IFN0cmluZyFcXG5saWZlY3ljbGVQaGFzZTogR29hbExpZmVjeWNsZVBoYXNlIVxcbmNvbmZpZzogR29hbENvbmZpZyFcXG5yZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUNvbmZpZ1xcbmRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWdcXG5saW5rczogW0xpbmtzIV0hXFxuYWN0aXZlQ3ljbGU6IEFjdGl2ZUN5Y2xlXFxuY3ljbGVzOiBbQ3ljbGVzQW5kQ3ljbGVzXzEhXSFcXG5kZXBlbmRlbmNpZXM6IFtEZXBlbmRlbmNpZXMhXSFcXG5zbmFwc2hvdHM6IFtTbmFwc2hvdHMhXSFcXG5pc0xvY2tlZDogQm9vbGVhbiFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jb2xvcjogU3RyaW5nIVxcbmljb246IFN0cmluZ1xcbnJ1bGVfdHlwZTogU3RyaW5nIVxcbm1ldHJpYzogR29hbE1ldHJpYyFcXG5zdGF0dXM6IEdvYWxTdGF0dXMhXFxucHJpb3JpdHk6IE51bWJlciFcXG5zb3J0X29yZGVyOiBOdW1iZXIhXFxuc3RhcnRzX2F0OiBEYXRlIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsQ29uZmlnIHtcXG5jb21wb3NpdGVfbW9kZTogQUxMX0FOWV9XRUlHSFRFRFxcbmNvdW50X3JlcXVpcmVkOiBOdW1iZXJcXG5iZWZvcmVfdGltZTogU3RyaW5nXFxuYWZ0ZXJfdGltZTogU3RyaW5nXFxuYmxvY2tfdW50aWxfdW5sb2NrZWQ6IEJvb2xlYW5cXG59XFxudHlwZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XFxucGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIVxcbmludGVydmFsOiBOdW1iZXJcXG5hbmNob3I6IFN0cmluZ1xcbmNhcnJ5X292ZXI6IE5PTkVfT1ZFUkZMT1dcXG5yZXNldDogU3RyaW5nXFxufVxcbnR5cGUgR29hbERlYWRsaW5lQ29uZmlnIHtcXG5raW5kOiBBQlNPTFVURV9SRUxBVElWRSFcXG5kYXRlOiBTdHJpbmdcXG5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBOdW1iZXJcXG5ncmFjZV9kYXlzOiBOdW1iZXJcXG53YXJuX2RheXM6IE51bWJlclxcbn1cXG50eXBlIExpbmtzIHtcXG5hY3Rpdml0eTogQWN0aXZpdHlcXG5ncm91cDogR3JvdXBzXFxud2VpZ2h0OiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXJcXG5nb2FsX2lkOiBOdW1iZXIhXFxubGlua190eXBlOiBHb2FsTGlua1R5cGUhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbn1cXG50eXBlIEFjdGl2aXR5IHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbnN0YXJ0X3RpbWU6IFN0cmluZyFcXG5lbmRfdGltZTogU3RyaW5nIVxcbmlzX3JlY3VycmluZzogQm9vbGVhbiFcXG5kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cHMge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbm5hbWU6IFN0cmluZyFcXG59XFxudHlwZSBBY3RpdmVDeWNsZSB7XFxuZGVhZGxpbmVTdGF0ZTogRGVhZGxpbmVTdGF0ZSFcXG5wZXJjZW50Q29tcGxldGU6IE51bWJlciFcXG5yZW1haW5pbmc6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbnRhcmdldF92YWx1ZTogTnVtYmVyIVxcbnN0YXR1czogR29hbEN5Y2xlU3RhdHVzIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbmN5Y2xlX2luZGV4OiBOdW1iZXIhXFxuZW5kc19hdDogRGF0ZVxcbmRlYWRsaW5lX2F0OiBEYXRlXFxuY3VycmVudF92YWx1ZTogTnVtYmVyIVxcbmNhcnJ5X292ZXI6IE51bWJlciFcXG59XFxudHlwZSBDeWNsZXNBbmRDeWNsZXNfMSB7XFxuaWQ6IE51bWJlciFcXG50YXJnZXRfdmFsdWU6IE51bWJlciFcXG5zdGF0dXM6IEdvYWxDeWNsZVN0YXR1cyFcXG5zdGFydHNfYXQ6IERhdGUhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbmdvYWxfaWQ6IE51bWJlciFcXG5jeWNsZV9pbmRleDogTnVtYmVyIVxcbmVuZHNfYXQ6IERhdGVcXG5kZWFkbGluZV9hdDogRGF0ZVxcbmN1cnJlbnRfdmFsdWU6IE51bWJlciFcXG5jYXJyeV9vdmVyOiBOdW1iZXIhXFxufVxcbnR5cGUgRGVwZW5kZW5jaWVzIHtcXG5kZXBlbmRzT246IEdvYWxzXFxudGhyZXNob2xkOiBOdW1iZXJcXG53ZWlnaHQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbmRlcGVuZHNfb25fZ29hbF9pZDogTnVtYmVyIVxcbnJlcXVpcmVtZW50OiBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50IVxcbn1cXG50eXBlIFNuYXBzaG90cyB7XFxudmFsdWU6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9jeWNsZV9pZDogTnVtYmVyIVxcbmFzX29mOiBTdHJpbmchXFxufVxcbnR5cGUgR29hbE51ZGdlIHtcXG5raW5kOiBHb2FsTnVkZ2VLaW5kIVxcbmdvYWxJZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxubWVzc2FnZTogU3RyaW5nIVxcbnNldmVyaXR5OiBJTkZPX1dBUk5JTkdfU1VDQ0VTUyFcXG59XFxudHlwZSBEYWlseVByb2dyZXNzIHtcXG5kYXRlOiBTdHJpbmchXFxuY29tcGxldGVkQ291bnQ6IE51bWJlciFcXG5taW51dGVzVG9kYXk6IE51bWJlciFcXG5zdHJlYWtEYXlzOiBOdW1iZXIhXFxuY29tcGxldGlvbnM6IFtBY3Rpdml0eUNvbXBsZXRpb25zIV0hXFxufVxcbnR5cGUgQWN0aXZpdHlDb21wbGV0aW9ucyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXFxufVxcbnR5cGUgTWV0YWRhdGEge1xcbnRpdGxlOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxudHJpZ2dlcl9ldmVudHM6IFtTdHJpbmchXVxcbn1cXG50eXBlIEFjdGl2aXRpZXMge1xcbnJlY3VycmVuY2VQYXR0ZXJuOiBQYXJzZWRSZWN1cnJlbmNlUGF0dGVyblxcbmdyb3VwOiBHcm91cFxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5ncm91cF9pZDogTnVtYmVyXFxuc3RhcnRfdGltZTogU3RyaW5nIVxcbmVuZF90aW1lOiBTdHJpbmchXFxuaXNfcmVjdXJyaW5nOiBCb29sZWFuIVxcbmRhdGU6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxubmFtZTogU3RyaW5nIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF82ISk6IEdvYWxzIVxcbnVwZGF0ZUdvYWwoYXJnczogQXJnc0lucHV0XzchKTogR29hbHMhXFxucGF1c2VHb2FsKGFyZ3M6IEFyZ3NJbnB1dF84ISk6IEdvYWxzIVxcbnJlc3VtZUdvYWwoYXJnczogQXJnc0lucHV0XzkhKTogR29hbHMhXFxuYXJjaGl2ZUdvYWwoYXJnczogQXJnc0lucHV0XzEwISk6IEdvYWxzIVxcbmRlbGV0ZUdvYWwoYXJnczogQXJnc0lucHV0XzExISk6IEJvb2xlYW4hXFxucmVjb21wdXRlR29hbFByb2dyZXNzKGFyZ3M6IE9iamVjdCk6IFJlY29tcHV0ZUdvYWxQcm9ncmVzcyFcXG5jcmVhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMTIhKTogQ3JlYXRlR3JvdXAhXFxudXBkYXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzEzISk6IENyZWF0ZUdyb3VwIVxcbmRlbGV0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8xNCEpOiBCb29sZWFuIVxcbmNyZWF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNSEpOiBBY3Rpdml0aWVzIVxcbnVwZGF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNiEpOiBBY3Rpdml0aWVzIVxcbmRlbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNyEpOiBCb29sZWFuIVxcbmNvbXBsZXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzE4ISk6IENvbXBsZXRlQWN0aXZpdHkhXFxudW5kb0NvbXBsZXRpb24oYXJnczogQXJnc0lucHV0XzE5ISk6IEJvb2xlYW4hXFxubG9nVGltZShhcmdzOiBBcmdzSW5wdXRfMjAhKTogTG9nVGltZSFcXG59XFxudHlwZSBSZWNvbXB1dGVHb2FsUHJvZ3Jlc3Mge1xcbnJlY29tcHV0ZWQ6IE51bWJlciFcXG59XFxudHlwZSBDcmVhdGVHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxubmFtZTogU3RyaW5nIVxcbn1cXG50eXBlIENvbXBsZXRlQWN0aXZpdHkge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXIhXFxub2NjdXJyZW5jZV9kYXRlOiBTdHJpbmchXFxuZHVyYXRpb25fbWludXRlczogTnVtYmVyXFxuY29tcGxldGVkX2F0OiBEYXRlIVxcbm1ldGFkYXRhOiBNZXRhZGF0YVxcbn1cXG50eXBlIExvZ1RpbWUge1xcbmFtb3VudDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbm1ldHJpYzogR29hbEV2ZW50TWV0cmljIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlclxcbm9jY3VycmVuY2VfZGF0ZTogU3RyaW5nXFxubWV0YWRhdGE6IE9iamVjdFxcbmdyb3VwX2lkOiBOdW1iZXJcXG5zb3VyY2VfdHlwZTogR29hbEV2ZW50U291cmNlVHlwZSFcXG5jb21wbGV0aW9uX2lkOiBOdW1iZXJcXG5vY2N1cnJlZF9hdDogRGF0ZSFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuZW51bSBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxuXFx0c2NoZWR1bGVkXFxufVxcbmVudW0gR29hbE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxTdGF0dXMge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRCB7XFxuXFx0YWxsXFxuXFx0YW55XFxuXFx0d2VpZ2h0ZWRcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPVyB7XFxuXFx0bm9uZVxcblxcdG92ZXJmbG93XFxufVxcbmVudW0gQUJTT0xVVEVfUkVMQVRJVkUge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBHb2FsTGlua1R5cGUge1xcblxcdGFjdGl2aXR5XFxuXFx0Z3JvdXBcXG59XFxuZW51bSBEZWFkbGluZVN0YXRlIHtcXG5cXHRmYWlsZWRcXG5cXHRvbl90cmFja1xcblxcdGFwcHJvYWNoaW5nXFxuXFx0b3ZlcmR1ZVxcbn1cXG5lbnVtIEdvYWxDeWNsZVN0YXR1cyB7XFxuXFx0YWN0aXZlXFxuXFx0ZmFpbGVkXFxuXFx0c3VjY2VlZGVkXFxuXFx0bWlzc2VkXFxufVxcbmVudW0gR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCB7XFxuXFx0Y29tcGxldGVcXG5cXHRwcm9ncmVzc1xcbn1cXG5lbnVtIEdvYWxOdWRnZUtpbmQge1xcblxcdGRlYWRsaW5lX2FwcHJvYWNoaW5nXFxuXFx0ZGVhZGxpbmVfb3ZlcmR1ZVxcblxcdGJlaGluZF9wYWNlXFxuXFx0Y3ljbGVfY29tcGxldGVcXG5cXHRkZXBlbmRlbmN5X3VubG9ja2VkXFxuXFx0Z29hbF9zdGFydGluZ19zb29uXFxufVxcbmVudW0gSU5GT19XQVJOSU5HX1NVQ0NFU1Mge1xcblxcdGluZm9cXG5cXHR3YXJuaW5nXFxuXFx0c3VjY2Vzc1xcbn1cXG5lbnVtIFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5lbnVtIEdvYWxFdmVudE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxFdmVudFNvdXJjZVR5cGUge1xcblxcdGNvbXBsZXRpb25cXG5cXHR0aW1lX2xvZ1xcblxcdG1hbnVhbFxcbn1cXG5lbnVtIENPVU5UX0RVUkFUSU9OSW5wdXQge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBBTExfQU5ZX1dFSUdIVEVESW5wdXQge1xcblxcdGFsbFxcblxcdGFueVxcblxcdHdlaWdodGVkXFxufVxcbmVudW0gQUNUSVZJVFlfR1JPVVBJbnB1dCB7XFxuXFx0YWN0aXZpdHlcXG5cXHRncm91cFxcbn1cXG5lbnVtIENPTVBMRVRFX1BST0dSRVNTSW5wdXQge1xcblxcdGNvbXBsZXRlXFxuXFx0cHJvZ3Jlc3NcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRxdWFydGVybHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBOT05FX09WRVJGTE9XSW5wdXQge1xcblxcdG5vbmVcXG5cXHRvdmVyZmxvd1xcbn1cXG5lbnVtIEFCU09MVVRFX1JFTEFUSVZFSW5wdXQge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dCB7XFxuXFx0YWN0aXZlXFxuXFx0cGF1c2VkXFxuXFx0Y29tcGxldGVkXFxuXFx0YXJjaGl2ZWRcXG5cXHRmYWlsZWRcXG59XFxuZW51bSBSZWN1cnJlbmNlVHlwZUlucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgT25Db25mbGljdEJ1aWxkZXIsIFRyYW5zYWN0aW9uIH0gZnJvbSBcImt5c2VseVwiO1xuaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCI7XG5pbXBvcnQgeyBkYiB9IGZyb20gXCIuLi8uLi9kYi9kYXRhYmFzZS50c1wiO1xuaW1wb3J0IHR5cGUge1xuICBBY3Rpdml0eSBhcyBBY3Rpdml0eVJvdyxcbiAgRGF0YWJhc2UsXG4gIEdyb3VwIGFzIEdyb3VwUm93LFxuICBOZXdBY3Rpdml0eSxcbiAgTmV3QWN0aXZpdHlDb21wbGV0aW9uLFxuICBOZXdHb2FsRXZlbnQsXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzIH0gZnJvbSBcIi4uLy4uL2dvYWxzL3Byb2dyZXNzLnRzXCI7XG5pbXBvcnQge1xuICBDb21wbGV0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUdyb3VwSW5wdXQsXG4gIExvZ1RpbWVJbnB1dCxcbiAgUmVjdXJyZW5jZUNvbmZpZyxcbiAgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCxcbiAgVXBkYXRlQWN0aXZpdHlJbnB1dCxcbiAgVXBkYXRlR3JvdXBJbnB1dCxcbn0gZnJvbSBcIi4uL3R5cGVzLnRzXCI7XG5pbXBvcnQge1xuICBJbnZhbGlkQ29tcGxldGlvbkVycm9yLFxuICBJbnZhbGlkR3JvdXBFcnJvcixcbiAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlLFxuICB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyxcbiAgdmFsaWRhdGVHcm91cENvbG9yLFxuICB2YWxpZGF0ZUdyb3VwTmFtZSxcbiAgdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZSxcbiAgdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uLFxufSBmcm9tIFwiLi4vdmFsaWRhdGlvbi50c1wiO1xuaW1wb3J0IHsgYXNOdW1iZXIgfSBmcm9tIFwiLi4vbnVtZXJpYy50c1wiO1xuaW1wb3J0IHsgR29hbE11dGF0aW9uLCBHb2FsUXVlcnkgfSBmcm9tIFwiLi9nb2Fsc19yZXNvbHZlcnMudHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRBY3Rpdml0eShhY3Rpdml0eUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eUlkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vLyBQeWxvbiByZXNvbHZlcyBuZXN0ZWQgR3JhcGhRTCBmaWVsZHMgZnJvbSAocG9zc2libHkgYXN5bmMpIHByb3BlcnRpZXMgb25cbi8vIHRoZSByZXR1cm5lZCBvYmplY3QsIG5vdCBmcm9tIGEgc2VwYXJhdGUgcmVzb2x2ZXIgbWFwIFx1MjAxNCBzbyBuZXN0ZWQgZGF0YSBpc1xuLy8gYXR0YWNoZWQgaW5saW5lIGhlcmUgcmF0aGVyIHRoYW4gdmlhIGEgc3RhbmRhbG9uZSByZXNvbHZlciBleHBvcnQuXG5mdW5jdGlvbiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHk6IEFjdGl2aXR5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uYWN0aXZpdHksXG4gICAgcmVjdXJyZW5jZVBhdHRlcm46IGFzeW5jICgpOiBQcm9taXNlPFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKCFhY3Rpdml0eS5pc19yZWN1cnJpbmcpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgcGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkuaWQpO1xuICAgICAgaWYgKCFwYXR0ZXJuKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHBhdHRlcm4uY29uZmlnKTtcbiAgICAgIGlmICghY29uZmlnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IC4uLnBhdHRlcm4sIGNvbmZpZyB9O1xuICAgIH0sXG4gICAgZ3JvdXA6IGFzeW5jICgpOiBQcm9taXNlPEdyb3VwUm93IHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKGFjdGl2aXR5Lmdyb3VwX2lkID09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eS5ncm91cF9pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGdyb3VwczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwibmFtZVwiLCBcImFzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICB9LFxuXG4gIGdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgfSxcblxuICBhY3Rpdml0aWVzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEFjdGl2aXR5UmVsYXRpb25zKTtcbiAgfSxcblxuICBhY3Rpdml0eTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIHJldHVybiByb3cgPyB3aXRoQWN0aXZpdHlSZWxhdGlvbnMocm93KSA6IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdHlDb21wbGV0aW9uczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgYWN0aXZpdHlJZD86IG51bWJlcjtcbiAgICBmcm9tRGF0ZT86IHN0cmluZztcbiAgICB0b0RhdGU/OiBzdHJpbmc7XG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiZGVzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpO1xuXG4gICAgaWYgKGFyZ3M/LmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhcmdzLmFjdGl2aXR5SWQpO1xuICAgIH1cbiAgICBpZiAoYXJncz8uZnJvbURhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI+PVwiLCBhcmdzLmZyb21EYXRlKTtcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIjw9XCIsIGFyZ3MudG9EYXRlKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgfSxcblxuICAuLi5Hb2FsUXVlcnksXG59O1xuXG5leHBvcnQgY29uc3QgTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlR3JvdXBJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpO1xuICAgIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ3JvdXBzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dyb3VwKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICB1cGRhdGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgbmFtZSA9IGlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lO1xuICAgIGNvbnN0IGNvbG9yID0gaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpXG4gICAgICA6IGV4aXN0aW5nLmNvbG9yO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoXCJncm91cHNcIilcbiAgICAgIC5zZXQoe1xuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgZGVsZXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNyZWF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7XG4gICAgICBpc1JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICBkYXRlOiBpbnB1dC5kYXRlLFxuICAgICAgcmVjdXJyZW5jZVBhdHRlcm46IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IHJlc29sdmVHcm91cElkKGlucHV0Lmdyb3VwSWQgPz8gbnVsbCwgdXNlcklkKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlucHV0LmlzUmVjdXJyaW5nID8gbnVsbCA6IChpbnB1dC5kYXRlID8/IG51bGwpLFxuICAgICAgICAgIGdyb3VwX2lkOiBncm91cElkID8/IG51bGwsXG4gICAgICAgIH0gYXMgTmV3QWN0aXZpdHkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlucHV0LmlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgdXBkYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IGlzUmVjdXJyaW5nID0gaW5wdXQuaXNSZWN1cnJpbmcgPz8gZXhpc3RpbmcuaXNfcmVjdXJyaW5nO1xuICAgIGNvbnN0IGRhdGUgPSBpbnB1dC5kYXRlICE9PSB1bmRlZmluZWQgPyBpbnB1dC5kYXRlIDogZXhpc3RpbmcuZGF0ZTtcblxuICAgIC8vIElmIHRoZSBzY2hlZHVsZSBpcyBzdGlsbCByZWN1cnJpbmcgYW5kIG5vIG5ldyBwYXR0ZXJuIHdhcyBzdXBwbGllZCxcbiAgICAvLyB2YWxpZGF0ZSBhZ2FpbnN0IHRoZSBwYXR0ZXJuIGFscmVhZHkgb24gZmlsZS5cbiAgICBsZXQgcmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm47XG4gICAgaWYgKGlzUmVjdXJyaW5nICYmICFyZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgY29uc3QgZXhpc3RpbmdQYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihpZCk7XG4gICAgICBpZiAoZXhpc3RpbmdQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKGV4aXN0aW5nUGF0dGVybi5jb25maWcpO1xuICAgICAgICByZWN1cnJlbmNlUGF0dGVybiA9IGNvbmZpZ1xuICAgICAgICAgID8geyByZWN1cnJlbmNlVHlwZTogZXhpc3RpbmdQYXR0ZXJuLnJlY3VycmVuY2VfdHlwZSwgY29uZmlnIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoeyBpc1JlY3VycmluZywgZGF0ZSwgcmVjdXJyZW5jZVBhdHRlcm4gfSk7XG5cbiAgICBjb25zdCByZXNvbHZlZEdyb3VwSWQgPSBpbnB1dC5ncm91cElkICE9PSB1bmRlZmluZWRcbiAgICAgID8gYXdhaXQgcmVzb2x2ZUdyb3VwSWQoaW5wdXQuZ3JvdXBJZCwgdXNlcklkKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZShcImFjdGl2aXRpZXNcIilcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpc1JlY3VycmluZyA/IG51bGwgOiAoZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICAuLi4ocmVzb2x2ZWRHcm91cElkICE9PSB1bmRlZmluZWQgPyB7IGdyb3VwX2lkOiByZXNvbHZlZEdyb3VwSWQgfSA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5vbkNvbmZsaWN0KChvYzogT25Db25mbGljdEJ1aWxkZXI8YW55LCBhbnk+KSA9PlxuICAgICAgICAgICAgb2MuY29sdW1ucyhbXCJhY3Rpdml0eV9pZFwiXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEuY29uZmlnKSxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH0gZWxzZSBpZiAoIWlzUmVjdXJyaW5nKSB7XG4gICAgICAgIC8vIENsZWFuIHVwIGFueSBzdGFsZSBwYXR0ZXJuIG9uY2UgYW4gYWN0aXZpdHkgc3RvcHMgcmVjdXJyaW5nLlxuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuZGVsZXRlRnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgZGVsZXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXIgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNvbXBsZXRlQWN0aXZpdHk6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShpbnB1dC5vY2N1cnJlbmNlRGF0ZSk7XG4gICAgY29uc3QgZHVyYXRpb25NaW51dGVzID0gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMoaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgIC53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIj1cIiwgb2NjdXJyZW5jZURhdGUpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgZHVyYXRpb25fbWludXRlczogZHVyYXRpb25NaW51dGVzLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcywgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pXG4gICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5Q29tcGxldGlvbilcbiAgICAgICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgICAgIG9jLmNvbHVtbnMoW1wiYWN0aXZpdHlfaWRcIiwgXCJvY2N1cnJlbmNlX2RhdGVcIl0pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgIGR1cmF0aW9uX21pbnV0ZXM6IGR1cmF0aW9uTWludXRlcyxcbiAgICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMsIHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KVxuICAgICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICAvLyBDb3VudCBldmVudFxuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHNvdXJjZV90eXBlOiBcImNvbXBsZXRpb25cIixcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgIGNvbXBsZXRpb25faWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgIG1ldHJpYzogXCJjb3VudFwiLFxuICAgICAgICAgIGFtb3VudDogMSxcbiAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgICAvLyBPcHRpb25hbCBkdXJhdGlvbiBldmVudCB3aGVuIG1pbnV0ZXMgcHJvdmlkZWQgb3IgZGVyaXZlZCBmcm9tIHNjaGVkdWxlLlxuICAgICAgbGV0IG1pbnV0ZXMgPSBkdXJhdGlvbk1pbnV0ZXM7XG4gICAgICBpZiAobWludXRlcyA9PSBudWxsKSB7XG4gICAgICAgIC8vIERlcml2ZSBmcm9tIHNjaGVkdWxlZCBzbG90IHdoZW4gcG9zc2libGUuXG4gICAgICAgIGNvbnN0IFtzaCwgc21dID0gYWN0aXZpdHkuc3RhcnRfdGltZS5zcGxpdChcIjpcIikubWFwKE51bWJlcik7XG4gICAgICAgIGNvbnN0IFtlaCwgZW1dID0gYWN0aXZpdHkuZW5kX3RpbWUuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgICAgICBjb25zdCBkZXJpdmVkID0gKGVoICogNjAgKyBlbSkgLSAoc2ggKiA2MCArIHNtKTtcbiAgICAgICAgaWYgKGRlcml2ZWQgPiAwKSBtaW51dGVzID0gZGVyaXZlZDtcbiAgICAgIH1cbiAgICAgIGlmIChtaW51dGVzICE9IG51bGwgJiYgbWludXRlcyA+IDApIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgc291cmNlX3R5cGU6IFwiY29tcGxldGlvblwiLFxuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgICAgY29tcGxldGlvbl9pZDogY29tcGxldGlvbi5pZCxcbiAgICAgICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICBhbW91bnQ6IG1pbnV0ZXMsXG4gICAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgICB9KTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgfSxcblxuICB1bmRvQ29tcGxldGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghZXhpc3RpbmcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGV4aXN0aW5nLmFjdGl2aXR5X2lkLCB1c2VySWQpO1xuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbShcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5kZWxldGVGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgIH0pO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogZXhpc3RpbmcuYWN0aXZpdHlfaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eT8uZ3JvdXBfaWQgPz8gbnVsbCxcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIGxvZ1RpbWU6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBMb2dUaW1lSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG1pbnV0ZXMgPSB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24oaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcbiAgICBjb25zdCBvY2N1cnJlbmNlRGF0ZSA9IHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoXG4gICAgICBpbnB1dC5vY2N1cnJlbmNlRGF0ZSA/PyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShpbnB1dC5hY3Rpdml0eUlkLCB1c2VySWQpO1xuICAgIGlmICghYWN0aXZpdHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKFwiYWN0aXZpdHkgbm90IGZvdW5kXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBldmVudCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50byhcImdvYWxfZXZlbnRzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBzb3VyY2VfdHlwZTogXCJ0aW1lX2xvZ1wiLFxuICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgIGdyb3VwX2lkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgIGFtb3VudDogbWludXRlcyxcbiAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcyB9KVxuICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdHb2FsRXZlbnQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGFtb3VudDogYXNOdW1iZXIoZXZlbnQuYW1vdW50KSxcbiAgICB9O1xuICB9LFxuXG4gIC4uLkdvYWxNdXRhdGlvbixcbn07XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7XG4gIFF1ZXJ5LFxuICBNdXRhdGlvbixcbn07XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vLyBNYWluIERhdGFiYXNlIGludGVyZmFjZSB0aGF0IGRlc2NyaWJlcyBhbGwgdGFibGVzXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgZ3JvdXBzOiBHcm91cHNUYWJsZVxuICBhY3Rpdml0aWVzOiBBY3Rpdml0aWVzVGFibGVcbiAgcmVjdXJyZW5jZV9wYXR0ZXJuczogUmVjdXJyZW5jZVBhdHRlcm5zVGFibGVcbiAgYWN0aXZpdHlfY29tcGxldGlvbnM6IEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZVxuICBnb2FsX2V2ZW50czogR29hbEV2ZW50c1RhYmxlXG4gIGdvYWxzOiBHb2Fsc1RhYmxlXG4gIGdvYWxfbGlua3M6IEdvYWxMaW5rc1RhYmxlXG4gIGdvYWxfY3ljbGVzOiBHb2FsQ3ljbGVzVGFibGVcbiAgZ29hbF9kZXBlbmRlbmNpZXM6IEdvYWxEZXBlbmRlbmNpZXNUYWJsZVxuICBnb2FsX3Byb2dyZXNzX3NuYXBzaG90czogR29hbFByb2dyZXNzU25hcHNob3RzVGFibGVcbn1cblxuLy8gVXNlcnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEdyb3VwcyB0YWJsZSBpbnRlcmZhY2UgXHUyMDE0IHVzZXItc2NvcGVkIGFjdGl2aXR5IHRheG9ub215IHdpdGggZGlzcGxheSBjb2xvci5cbmV4cG9ydCBpbnRlcmZhY2UgR3JvdXBzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICAvLyBIZXggY29sb3IgZnJvbSB0aGUgc2hhcmVkIHByZXNldCBwYWxldHRlLCBlLmcuIFwiIzBGNzY2RVwiXG4gIGNvbG9yOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0aWVzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0aWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIC8vIE9wdGlvbmFsIGdyb3VwIGFzc2lnbm1lbnQuIE51bGwgd2hlbiB1bmdyb3VwZWQ7IGNsZWFyZWQgaWYgdGhlIGdyb3VwXG4gIC8vIGlzIGRlbGV0ZWQgKE9OIERFTEVURSBTRVQgTlVMTCkuXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgc3RhcnRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBlbmRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBpc19yZWN1cnJpbmc6IGJvb2xlYW5cbiAgLy8gQ2FsZW5kYXIgZGF0ZSB0aGUgYWN0aXZpdHkgb2NjdXJzIG9uLiBSZXF1aXJlZCB3aGVuIGlzX3JlY3VycmluZyBpc1xuICAvLyBmYWxzZTsgbnVsbCB3aGVuIGlzX3JlY3VycmluZyBpcyB0cnVlIChkYXRlcyBsaXZlIGluIHRoZSByZWN1cnJlbmNlXG4gIC8vIHBhdHRlcm4ncyBjb25maWcgaW5zdGVhZCkuXG4gIGRhdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBSZWN1cnJlbmNlIHBhdHRlcm5zIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBSZWN1cnJlbmNlUGF0dGVybnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIC8vIFR5cGUgb2YgcmVjdXJyZW5jZTogd2Vla2x5LCBtb250aGx5LCBvciBldmVyeSBYIGRheXNcbiAgcmVjdXJyZW5jZV90eXBlOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdldmVyeV94X2RheXMnXG4gIC8vIEpTT04gY29uZmlndXJhdGlvbiBmb3IgdGhlIHJlY3VycmVuY2VcbiAgY29uZmlnOiBDb2x1bW5UeXBlPHtcbiAgICAvLyBGb3Igd2Vla2x5OiBhcnJheSBvZiBkYXlzICgwLTYsIHdoZXJlIDAgaXMgU3VuZGF5KVxuICAgIGRheXNfb2Zfd2Vlaz86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGRheXMgb2YgdGhlIG1vbnRoICgxLTMxKVxuICAgIGRheXNfb2ZfbW9udGg/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBhbHNvIHJlcGVhdCBvbiB0aGUgbGFzdCBkYXkgb2YgdGhlIG1vbnRoLiBLZXB0IGFzIGl0c1xuICAgIC8vIG93biBib29sZWFuIChyYXRoZXIgdGhhbiBhICdsYXN0JyBzZW50aW5lbCBpbiBkYXlzX29mX21vbnRoKSBiZWNhdXNlXG4gICAgLy8gUHlsb24vR3JhcGhRTCBpbnB1dCB0eXBlcyBjYW4ndCByZXByZXNlbnQgYSBudW1iZXJ8c3RyaW5nIHVuaW9uLlxuICAgIGlzX2xhc3RfZGF5X29mX21vbnRoPzogYm9vbGVhblxuICAgIC8vIEZvciBldmVyeV94X2RheXM6IHJlcGVhdCBldmVyeSBOIGRheXMgKD49IDEpXG4gICAgaW50ZXJ2YWxfZGF5cz86IG51bWJlclxuICAgIC8vIFN0YXJ0IGRhdGUgb2YgdGhlIHJlY3VycmVuY2VcbiAgICBzdGFydF9kYXRlOiBzdHJpbmdcbiAgICAvLyBFbmQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZSAob3B0aW9uYWwpXG4gICAgZW5kX2RhdGU/OiBzdHJpbmcgfCBudWxsXG4gIH0sIHN0cmluZywgc3RyaW5nPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXR5IGNvbXBsZXRpb25zIFx1MjAxNCBvbmUgcm93IHBlciAoYWN0aXZpdHksIG9jY3VycmVuY2VfZGF0ZSlcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nXG4gIGR1cmF0aW9uX21pbnV0ZXM6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIC8vIFN0b3JlIGFueSBhZGRpdGlvbmFsIGRhdGEgYWJvdXQgdGhlIGNvbXBsZXRpb25cbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8e1xuICAgIHRpdGxlPzogc3RyaW5nXG4gICAgbm90ZXM/OiBzdHJpbmdcbiAgICB0cmlnZ2VyX2V2ZW50cz86IHN0cmluZ1tdXG4gIH0gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRTb3VyY2VUeXBlID0gJ2NvbXBsZXRpb24nIHwgJ3RpbWVfbG9nJyB8ICdtYW51YWwnXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmVudHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgc291cmNlX3R5cGU6IEdvYWxFdmVudFNvdXJjZVR5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbl9pZDogbnVtYmVyIHwgbnVsbFxuICBvY2N1cnJlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZyB8IG51bGxcbiAgbWV0cmljOiBHb2FsRXZlbnRNZXRyaWNcbiAgYW1vdW50OiBudW1iZXJcbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8UmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxTdGF0dXMgPSAnYWN0aXZlJyB8ICdwYXVzZWQnIHwgJ2NvbXBsZXRlZCcgfCAnYXJjaGl2ZWQnIHwgJ2ZhaWxlZCdcbmV4cG9ydCB0eXBlIEdvYWxNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxSZWN1cnJlbmNlQ29uZmlnIHtcbiAgcGVyaW9kOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdxdWFydGVybHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgaW50ZXJ2YWw/OiBudW1iZXJcbiAgYW5jaG9yPzogc3RyaW5nXG4gIGNhcnJ5X292ZXI/OiAnbm9uZScgfCAnb3ZlcmZsb3cnXG4gIHJlc2V0PzogJ2hhcmQnXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlYWRsaW5lQ29uZmlnIHtcbiAga2luZDogJ2Fic29sdXRlJyB8ICdyZWxhdGl2ZSdcbiAgZGF0ZT86IHN0cmluZ1xuICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0PzogbnVtYmVyXG4gIGdyYWNlX2RheXM/OiBudW1iZXJcbiAgd2Fybl9kYXlzPzogbnVtYmVyXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbENvbmZpZyB7XG4gIGNvbXBvc2l0ZV9tb2RlPzogJ2FsbCcgfCAnYW55JyB8ICd3ZWlnaHRlZCdcbiAgY291bnRfcmVxdWlyZWQ/OiBudW1iZXJcbiAgYmVmb3JlX3RpbWU/OiBzdHJpbmdcbiAgYWZ0ZXJfdGltZT86IHN0cmluZ1xuICBibG9ja191bnRpbF91bmxvY2tlZD86IGJvb2xlYW5cbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgY29sb3I6IHN0cmluZ1xuICBpY29uOiBzdHJpbmcgfCBudWxsXG4gIHJ1bGVfdHlwZTogc3RyaW5nXG4gIG1ldHJpYzogR29hbE1ldHJpY1xuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjb25maWc6IENvbHVtblR5cGU8R29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZz5cbiAgc3RhdHVzOiBHb2FsU3RhdHVzXG4gIHJlY3VycmVuY2U6IENvbHVtblR5cGU8XG4gICAgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGxcbiAgPlxuICBkZWFkbGluZTogQ29sdW1uVHlwZTxcbiAgICBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbFxuICA+XG4gIHByaW9yaXR5OiBudW1iZXJcbiAgc29ydF9vcmRlcjogbnVtYmVyXG4gIC8qKiBFZmZlY3RpdmUgc3RhcnQgb2YgdGhlIGdvYWwgKHNlZWRzIGN5Y2xlIDApLiBBbHdheXMgc2V0LiAqL1xuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbExpbmtUeXBlID0gJ2FjdGl2aXR5JyB8ICdncm91cCdcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTGlua3NUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgbGlua190eXBlOiBHb2FsTGlua1R5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGVTdGF0dXMgPSAnYWN0aXZlJyB8ICdzdWNjZWVkZWQnIHwgJ2ZhaWxlZCcgfCAnbWlzc2VkJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxDeWNsZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgY3ljbGVfaW5kZXg6IG51bWJlclxuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGVuZHNfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGRlYWRsaW5lX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjdXJyZW50X3ZhbHVlOiBudW1iZXJcbiAgc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXNcbiAgY2Fycnlfb3ZlcjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCA9ICdjb21wbGV0ZScgfCAncHJvZ3Jlc3MnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlcGVuZGVuY2llc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBkZXBlbmRzX29uX2dvYWxfaWQ6IG51bWJlclxuICByZXF1aXJlbWVudDogR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudFxuICB0aHJlc2hvbGQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfY3ljbGVfaWQ6IG51bWJlclxuICBhc19vZjogc3RyaW5nXG4gIHZhbHVlOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG4vLyBFeHBvcnQgY29udmVuaWVuY2UgdHlwZXMgZm9yIGVhY2ggdGFibGVcbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdVc2VyID0gSW5zZXJ0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgVXNlclVwZGF0ZSA9IFVwZGF0ZWFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR3JvdXAgPSBTZWxlY3RhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R3JvdXAgPSBJbnNlcnRhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgR3JvdXBVcGRhdGUgPSBVcGRhdGVhYmxlPEdyb3Vwc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eSA9IFNlbGVjdGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QWN0aXZpdHkgPSBJbnNlcnRhYmxlPEFjdGl2aXRpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5VXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0aWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuID0gU2VsZWN0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1JlY3VycmVuY2VQYXR0ZXJuID0gSW5zZXJ0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuVXBkYXRlID0gVXBkYXRlYWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uID0gU2VsZWN0YWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eUNvbXBsZXRpb24gPSBJbnNlcnRhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5Q29tcGxldGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnQgPSBTZWxlY3RhYmxlPEdvYWxFdmVudHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxFdmVudCA9IEluc2VydGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEV2ZW50VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsRXZlbnRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWwgPSBTZWxlY3RhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsID0gSW5zZXJ0YWJsZTxHb2Fsc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbExpbmsgPSBTZWxlY3RhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbExpbmsgPSBJbnNlcnRhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbExpbmtVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxMaW5rc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGUgPSBTZWxlY3RhYmxlPEdvYWxDeWNsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxDeWNsZSA9IEluc2VydGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlVXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5ID0gU2VsZWN0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsRGVwZW5kZW5jeSA9IEluc2VydGFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3QgPSBTZWxlY3RhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbFByb2dyZXNzU25hcHNob3QgPSBJbnNlcnRhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3RVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBQb29sLCB0eXBlcyB9IGZyb20gJ3BnJ1xuaW1wb3J0IHsgS3lzZWx5LCBQb3N0Z3Jlc0RpYWxlY3QgfSBmcm9tICdreXNlbHknXG5cbi8vIEtlZXAgUG9zdGdyZXMgYGRhdGVgIGFzIGBZWVlZLU1NLUREYCBzdHJpbmdzLiBUaGUgZGVmYXVsdCBwZyBwYXJzZXIgdHVybnNcbi8vIHRoZW0gaW50byBKUyBEYXRlIG9iamVjdHMsIHdoaWNoIEdyYXBoUUwgdGhlbiBzdHJpbmdpZmllcyBhcyBmdWxsIHRpbWVzdGFtcHNcbi8vIChvciBEYXRlLnRvU3RyaW5nKCkpIGFuZCBicmVha3MgRmx1dHRlcidzIGRhdGUtb25seSBwYXJzaW5nLlxudHlwZXMuc2V0VHlwZVBhcnNlcih0eXBlcy5idWlsdGlucy5EQVRFLCAodmFsdWU6IHN0cmluZykgPT4gdmFsdWUpXG5cbmNvbnN0IGRpYWxlY3QgPSBuZXcgUG9zdGdyZXNEaWFsZWN0KHtcbiAgcG9vbDogbmV3IFBvb2woe1xuICAgIGRhdGFiYXNlOiAndGltZW1hbmFnZXInLFxuICAgIGhvc3Q6ICdsb2NhbGhvc3QnLFxuICAgIHVzZXI6ICdwb3N0Z3JlcycsXG4gICAgcGFzc3dvcmQ6ICd0ZXN0MTIzNCcsXG4gICAgcG9ydDogNTQzMixcbiAgICBtYXg6IDEwLFxuICB9KVxufSlcblxuLy8gRGF0YWJhc2UgaW50ZXJmYWNlIGlzIHBhc3NlZCB0byBLeXNlbHkncyBjb25zdHJ1Y3RvciwgYW5kIGZyb20gbm93IG9uLCBLeXNlbHkgXG4vLyBrbm93cyB5b3VyIGRhdGFiYXNlIHN0cnVjdHVyZS5cbi8vIERpYWxlY3QgaXMgcGFzc2VkIHRvIEt5c2VseSdzIGNvbnN0cnVjdG9yLCBhbmQgZnJvbSBub3cgb24sIEt5c2VseSBrbm93cyBob3cgXG4vLyB0byBjb21tdW5pY2F0ZSB3aXRoIHlvdXIgZGF0YWJhc2UuXG5leHBvcnQgY29uc3QgZGIgPSBuZXcgS3lzZWx5PERhdGFiYXNlPih7XG4gIGRpYWxlY3QsXG59KSIsICJpbXBvcnQgdHlwZSB7IEdvYWwsIEdvYWxDeWNsZSB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcblxuZXhwb3J0IHR5cGUgR29hbExpZmVjeWNsZVBoYXNlID1cbiAgfCAnc2NoZWR1bGVkJ1xuICB8ICdhY3RpdmUnXG4gIHwgJ3BhdXNlZCdcbiAgfCAnY29tcGxldGVkJ1xuICB8ICdhcmNoaXZlZCdcbiAgfCAnZmFpbGVkJ1xuXG4vKiogRGVyaXZlZCBVSS9BUEkgcGhhc2UgXHUyMDE0IHNjaGVkdWxlZCBpcyBub3QgYSBzdG9yZWQgc3RhdHVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGxpZmVjeWNsZVBoYXNlKFxuICBnb2FsOiBQaWNrPEdvYWwsICdzdGF0dXMnIHwgJ3N0YXJ0c19hdCc+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbExpZmVjeWNsZVBoYXNlIHtcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgcmV0dXJuICdwYXVzZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcpIHJldHVybiAnY29tcGxldGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhcmNoaXZlZCcpIHJldHVybiAnYXJjaGl2ZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHJldHVybiAnZmFpbGVkJ1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnICYmIG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KSA+IG5vdykge1xuICAgIHJldHVybiAnc2NoZWR1bGVkJ1xuICB9XG4gIHJldHVybiAnYWN0aXZlJ1xufVxuXG4vKiogVHJ1ZSB3aGVuIHRoZSBjeWNsZSBldmFsdWF0aW9uIHdpbmRvdyBoYXMgYmVndW4uICovXG5leHBvcnQgZnVuY3Rpb24gY3ljbGVIYXNTdGFydGVkKFxuICBjeWNsZTogUGljazxHb2FsQ3ljbGUsICdzdGFydHNfYXQnPixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gbm93ID49IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbn1cbiIsICJpbXBvcnQgdHlwZSB7XG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbEV2ZW50LFxuICBHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlUmVzdWx0IHtcbiAgY3VycmVudFZhbHVlOiBudW1iZXJcbiAgZG9uZTogYm9vbGVhblxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEV2YWx1YXRlQ29udGV4dCB7XG4gIGdvYWw6IEdvYWxcbiAgY3ljbGU6IEdvYWxDeWNsZVxuICBsaW5rczogR29hbExpbmtbXVxuICBldmVudHM6IEdvYWxFdmVudFtdXG4gIC8qKiBBY3RpdmUgKG9yIGxhdGVzdCkgY2hpbGQgY3ljbGVzIGtleWVkIGJ5IGNoaWxkIGdvYWwgaWQsIGZvciBjb21wb3NpdGVzLiAqL1xuICBjaGlsZEN5Y2xlcz86IE1hcDxudW1iZXIsIEdvYWxDeWNsZT5cbiAgLyoqIENoaWxkIGRlcGVuZGVuY3kgd2VpZ2h0cyBrZXllZCBieSBjaGlsZCBnb2FsIGlkLiAqL1xuICBjaGlsZFdlaWdodHM/OiBNYXA8bnVtYmVyLCBudW1iZXI+XG4gIC8qKiBGb3IgZ3JvdXBfYWxsX2NvbXBsZXRlOiBhY3Rpdml0eSBpZHMgdGhhdCBiZWxvbmcgdG8gbGlua2VkIGdyb3Vwcy4gKi9cbiAgZ3JvdXBBY3Rpdml0eUlkcz86IG51bWJlcltdXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbEV2YWx1YXRvciB7XG4gIHJ1bGVUeXBlOiBzdHJpbmdcbiAgZXZhbHVhdGUoY3R4OiBFdmFsdWF0ZUNvbnRleHQpOiBFdmFsdWF0ZVJlc3VsdFxufVxuXG4vKiogRGVkdXBsaWNhdGUgZXZlbnRzIGJ5IChhY3Rpdml0eV9pZCwgb2NjdXJyZW5jZV9kYXRlKSwgcHJlZmVycmluZyBmaXJzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWR1cGVFdmVudHMoZXZlbnRzOiBHb2FsRXZlbnRbXSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc2VlbiA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gIGNvbnN0IG91dDogR29hbEV2ZW50W10gPSBbXVxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xuICAgIGNvbnN0IGtleSA9IGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgZXZlbnQub2NjdXJyZW5jZV9kYXRlXG4gICAgICA/IGAke2V2ZW50LmFjdGl2aXR5X2lkfToke2V2ZW50Lm9jY3VycmVuY2VfZGF0ZX06JHtldmVudC5tZXRyaWN9YFxuICAgICAgOiBgaWQ6JHtldmVudC5pZH1gXG4gICAgaWYgKHNlZW4uaGFzKGtleSkpIGNvbnRpbnVlXG4gICAgc2Vlbi5hZGQoa2V5KVxuICAgIG91dC5wdXNoKGV2ZW50KVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gZXZlbnRzSW5XaW5kb3coZXZlbnRzOiBHb2FsRXZlbnRbXSwgY3ljbGU6IEdvYWxDeWNsZSk6IEdvYWxFdmVudFtdIHtcbiAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICBjb25zdCBlbmQgPSBjeWNsZS5lbmRzX2F0ID8gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpIDogTnVtYmVyLlBPU0lUSVZFX0lORklOSVRZXG4gIHJldHVybiBldmVudHMuZmlsdGVyKChlKSA9PiB7XG4gICAgY29uc3QgdCA9IG5ldyBEYXRlKGUub2NjdXJyZWRfYXQpLmdldFRpbWUoKVxuICAgIHJldHVybiB0ID49IHN0YXJ0ICYmIHQgPCBlbmRcbiAgfSlcbn1cblxuZnVuY3Rpb24gbGlua2VkQWN0aXZpdHlJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJiBsLmFjdGl2aXR5X2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmFjdGl2aXR5X2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gbGlua2VkR3JvdXBJZHMobGlua3M6IEdvYWxMaW5rW10pOiBTZXQ8bnVtYmVyPiB7XG4gIHJldHVybiBuZXcgU2V0KFxuICAgIGxpbmtzXG4gICAgICAuZmlsdGVyKChsKSA9PiBsLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwX2lkICE9IG51bGwpXG4gICAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISksXG4gIClcbn1cblxuZnVuY3Rpb24gd2VpZ2h0Rm9yRXZlbnQoZXZlbnQ6IEdvYWxFdmVudCwgbGlua3M6IEdvYWxMaW5rW10pOiBudW1iZXIge1xuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlua3MpIHtcbiAgICBpZiAoXG4gICAgICBsaW5rLmxpbmtfdHlwZSA9PT0gJ2FjdGl2aXR5JyAmJlxuICAgICAgbGluay5hY3Rpdml0eV9pZCAhPSBudWxsICYmXG4gICAgICBldmVudC5hY3Rpdml0eV9pZCA9PT0gbGluay5hY3Rpdml0eV9pZFxuICAgICkge1xuICAgICAgcmV0dXJuIE51bWJlcihsaW5rLndlaWdodClcbiAgICB9XG4gICAgaWYgKFxuICAgICAgbGluay5saW5rX3R5cGUgPT09ICdncm91cCcgJiZcbiAgICAgIGxpbmsuZ3JvdXBfaWQgIT0gbnVsbCAmJlxuICAgICAgZXZlbnQuZ3JvdXBfaWQgPT09IGxpbmsuZ3JvdXBfaWRcbiAgICApIHtcbiAgICAgIHJldHVybiBOdW1iZXIobGluay53ZWlnaHQpXG4gICAgfVxuICB9XG4gIHJldHVybiAxXG59XG5cbmZ1bmN0aW9uIG1hdGNoZXNMaW5rcyhldmVudDogR29hbEV2ZW50LCBsaW5rczogR29hbExpbmtbXSk6IGJvb2xlYW4ge1xuICBjb25zdCBhY3Rpdml0aWVzID0gbGlua2VkQWN0aXZpdHlJZHMobGlua3MpXG4gIGNvbnN0IGdyb3VwcyA9IGxpbmtlZEdyb3VwSWRzKGxpbmtzKVxuICBpZiAoYWN0aXZpdGllcy5zaXplID09PSAwICYmIGdyb3Vwcy5zaXplID09PSAwKSByZXR1cm4gZmFsc2VcbiAgaWYgKGV2ZW50LmFjdGl2aXR5X2lkICE9IG51bGwgJiYgYWN0aXZpdGllcy5oYXMoZXZlbnQuYWN0aXZpdHlfaWQpKSByZXR1cm4gdHJ1ZVxuICBpZiAoZXZlbnQuZ3JvdXBfaWQgIT0gbnVsbCAmJiBncm91cHMuaGFzKGV2ZW50Lmdyb3VwX2lkKSkgcmV0dXJuIHRydWVcbiAgcmV0dXJuIGZhbHNlXG59XG5cbmZ1bmN0aW9uIHN1bVdlaWdodGVkKFxuICBldmVudHM6IEdvYWxFdmVudFtdLFxuICBsaW5rczogR29hbExpbmtbXSxcbiAgbWV0cmljOiAnY291bnQnIHwgJ2R1cmF0aW9uJyxcbik6IG51bWJlciB7XG4gIGxldCB0b3RhbCA9IDBcbiAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMoZXZlbnRzKSkge1xuICAgIGlmIChldmVudC5tZXRyaWMgIT09IG1ldHJpYykgY29udGludWVcbiAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgbGlua3MpKSBjb250aW51ZVxuICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGxpbmtzKVxuICB9XG4gIHJldHVybiB0b3RhbFxufVxuXG5mdW5jdGlvbiB3aXRoQ2FycnlPdmVyKHZhbHVlOiBudW1iZXIsIGN5Y2xlOiBHb2FsQ3ljbGUpOiBudW1iZXIge1xuICByZXR1cm4gTWF0aC5tYXgoMCwgdmFsdWUgKyBOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciB8fCAwKSlcbn1cblxuZnVuY3Rpb24gcmVzdWx0KHZhbHVlOiBudW1iZXIsIHRhcmdldDogbnVtYmVyKTogRXZhbHVhdGVSZXN1bHQge1xuICBjb25zdCBjdXJyZW50VmFsdWUgPSBNYXRoLm1heCgwLCB2YWx1ZSlcbiAgcmV0dXJuIHtcbiAgICBjdXJyZW50VmFsdWUsXG4gICAgZG9uZTogdGFyZ2V0ID4gMCA/IGN1cnJlbnRWYWx1ZSA+PSB0YXJnZXQgOiBjdXJyZW50VmFsdWUgPiAwLFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBhY3Rpdml0eUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2FjdGl2aXR5X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnYWN0aXZpdHlfZHVyYXRpb24nLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnZHVyYXRpb24nKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdkdXJhdGlvbicpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBncm91cENvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2NvdW50JyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuLyoqIENvdW50IGNvbXBsZXRpb25zIG9mIGFueSBhY3Rpdml0eSBpbiBsaW5rZWQgZ3JvdXBzLiAqL1xuZXhwb3J0IGNvbnN0IGdyb3VwQW55Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfYW55X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgcmV0dXJuIGdyb3VwQ291bnRFdmFsdWF0b3IuZXZhbHVhdGUoY3R4KVxuICB9LFxufVxuXG4vKipcbiAqIFByb2dyZXNzID0gbnVtYmVyIG9mIGRpc3RpbmN0IGxpbmtlZC1ncm91cCBhY3Rpdml0aWVzIGNvbXBsZXRlZCBhdCBsZWFzdFxuICogb25jZSBpbiB0aGUgY3ljbGUuIFRhcmdldCBpcyB0eXBpY2FsbHkgdGhlIHNpemUgb2YgdGhlIGdyb3VwLlxuICovXG5leHBvcnQgY29uc3QgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9hbGxfY29tcGxldGUnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCBhY3Rpdml0eUlkcyA9IG5ldyBTZXQoY3R4Lmdyb3VwQWN0aXZpdHlJZHMgPz8gW10pXG4gICAgY29uc3QgY29tcGxldGVkID0gbmV3IFNldDxudW1iZXI+KClcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoZXZlbnQuYWN0aXZpdHlfaWQgPT0gbnVsbCkgY29udGludWVcbiAgICAgIGlmIChhY3Rpdml0eUlkcy5zaXplID4gMCAmJiAhYWN0aXZpdHlJZHMuaGFzKGV2ZW50LmFjdGl2aXR5X2lkKSkgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpICYmIGFjdGl2aXR5SWRzLnNpemUgPT09IDApIGNvbnRpbnVlXG4gICAgICBpZiAoYWN0aXZpdHlJZHMuc2l6ZSA+IDAgfHwgbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSB7XG4gICAgICAgIGNvbXBsZXRlZC5hZGQoZXZlbnQuYWN0aXZpdHlfaWQpXG4gICAgICB9XG4gICAgfVxuICAgIC8vIFByZWZlciBjb3VudGluZyBvbmx5IGFjdGl2aXRpZXMgdGhhdCBiZWxvbmcgdG8gdGhlIGdyb3VwLlxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIGFjdGl2aXR5SWRzLnNpemUgPiAwXG4gICAgICAgID8gWy4uLmNvbXBsZXRlZF0uZmlsdGVyKChpZCkgPT4gYWN0aXZpdHlJZHMuaGFzKGlkKSkubGVuZ3RoXG4gICAgICAgIDogY29tcGxldGVkLnNpemUsXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IG11bHRpQWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdtdWx0aV9hY3Rpdml0eV9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIHJldHVybiBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLmV2YWx1YXRlKGN0eClcbiAgfSxcbn1cblxuLyoqIENvbnNlY3V0aXZlIGNhbGVuZGFyIGRheXMgd2l0aCBhdCBsZWFzdCBvbmUgbWF0Y2hpbmcgY291bnQgZXZlbnQuICovXG5leHBvcnQgY29uc3Qgc3RyZWFrRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ3N0cmVhaycsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IGRheXMgPSBuZXcgU2V0PHN0cmluZz4oKVxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKHdpbmRvd2VkKSkge1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gJ2NvdW50JykgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSBjb250aW51ZVxuICAgICAgY29uc3QgZGF5ID0gZXZlbnQub2NjdXJyZW5jZV9kYXRlID8/XG4gICAgICAgIG5ldyBEYXRlKGV2ZW50Lm9jY3VycmVkX2F0KS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuICAgICAgZGF5cy5hZGQoZGF5KVxuICAgIH1cbiAgICBjb25zdCBzb3J0ZWQgPSBbLi4uZGF5c10uc29ydCgpXG4gICAgbGV0IGJlc3QgPSAwXG4gICAgbGV0IHJ1biA9IDBcbiAgICBsZXQgcHJldjogc3RyaW5nIHwgbnVsbCA9IG51bGxcbiAgICBmb3IgKGNvbnN0IGRheSBvZiBzb3J0ZWQpIHtcbiAgICAgIGlmIChwcmV2KSB7XG4gICAgICAgIGNvbnN0IHByZXZEYXRlID0gbmV3IERhdGUocHJldiArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgY3VyRGF0ZSA9IG5ldyBEYXRlKGRheSArICdUMDA6MDA6MDBaJylcbiAgICAgICAgY29uc3QgZGlmZiA9IChjdXJEYXRlLmdldFRpbWUoKSAtIHByZXZEYXRlLmdldFRpbWUoKSkgLyA4Nl80MDBfMDAwXG4gICAgICAgIHJ1biA9IGRpZmYgPT09IDEgPyBydW4gKyAxIDogMVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcnVuID0gMVxuICAgICAgfVxuICAgICAgYmVzdCA9IE1hdGgubWF4KGJlc3QsIHJ1bilcbiAgICAgIHByZXYgPSBkYXlcbiAgICB9XG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKGJlc3QsIGN0eC5jeWNsZSlcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbi8qKiBDb3VudCBjb21wbGV0aW9ucyB3aG9zZSBvY2N1cnJlbmNlIGxvY2FsIHRpbWUgaXMgYmVmb3JlIGNvbmZpZy5iZWZvcmVfdGltZS4gKi9cbmV4cG9ydCBjb25zdCB0aW1lT2ZEYXlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICd0aW1lX29mX2RheV9jb3VudCcsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IGNvbmZpZyA9IHR5cGVvZiBjdHguZ29hbC5jb25maWcgPT09ICdzdHJpbmcnXG4gICAgICA/IEpTT04ucGFyc2UoY3R4LmdvYWwuY29uZmlnKVxuICAgICAgOiAoY3R4LmdvYWwuY29uZmlnID8/IHt9KVxuICAgIGNvbnN0IGJlZm9yZSA9IHR5cGVvZiBjb25maWcuYmVmb3JlX3RpbWUgPT09ICdzdHJpbmcnID8gY29uZmlnLmJlZm9yZV90aW1lIDogbnVsbFxuICAgIGNvbnN0IGFmdGVyID0gdHlwZW9mIGNvbmZpZy5hZnRlcl90aW1lID09PSAnc3RyaW5nJyA/IGNvbmZpZy5hZnRlcl90aW1lIDogbnVsbFxuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGxldCB0b3RhbCA9IDBcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyh3aW5kb3dlZCkpIHtcbiAgICAgIGlmIChldmVudC5tZXRyaWMgIT09ICdjb3VudCcpIGNvbnRpbnVlXG4gICAgICBpZiAoIW1hdGNoZXNMaW5rcyhldmVudCwgY3R4LmxpbmtzKSkgY29udGludWVcbiAgICAgIGNvbnN0IGhobW0gPSBuZXcgRGF0ZShldmVudC5vY2N1cnJlZF9hdCkudG9JU09TdHJpbmcoKS5zbGljZSgxMSwgMTYpXG4gICAgICBpZiAoYmVmb3JlICYmIGhobW0gPj0gYmVmb3JlKSBjb250aW51ZVxuICAgICAgaWYgKGFmdGVyICYmIGhobW0gPCBhZnRlcikgY29udGludWVcbiAgICAgIHRvdGFsICs9IE51bWJlcihldmVudC5hbW91bnQpICogd2VpZ2h0Rm9yRXZlbnQoZXZlbnQsIGN0eC5saW5rcylcbiAgICB9XG4gICAgcmV0dXJuIHJlc3VsdCh3aXRoQ2FycnlPdmVyKHRvdGFsLCBjdHguY3ljbGUpLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBjb21wb3NpdGVFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnY29tcG9zaXRlJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3QgY29uZmlnID0gdHlwZW9mIGN0eC5nb2FsLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShjdHguZ29hbC5jb25maWcpXG4gICAgICA6IChjdHguZ29hbC5jb25maWcgPz8ge30pXG4gICAgY29uc3QgbW9kZSA9IGNvbmZpZy5jb21wb3NpdGVfbW9kZSA/PyAnYWxsJ1xuICAgIGNvbnN0IGNoaWxkcmVuID0gY3R4LmNoaWxkQ3ljbGVzXG4gICAgaWYgKCFjaGlsZHJlbiB8fCBjaGlsZHJlbi5zaXplID09PSAwKSB7XG4gICAgICByZXR1cm4gcmVzdWx0KDAsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICB9XG5cbiAgICBjb25zdCBlbnRyaWVzID0gWy4uLmNoaWxkcmVuLmVudHJpZXMoKV1cbiAgICBpZiAobW9kZSA9PT0gJ3dlaWdodGVkJykge1xuICAgICAgbGV0IHdlaWdodGVkU3VtID0gMFxuICAgICAgbGV0IHdlaWdodFRvdGFsID0gMFxuICAgICAgZm9yIChjb25zdCBbY2hpbGRJZCwgY3ljbGVdIG9mIGVudHJpZXMpIHtcbiAgICAgICAgY29uc3QgdyA9IE51bWJlcihjdHguY2hpbGRXZWlnaHRzPy5nZXQoY2hpbGRJZCkgPz8gMSlcbiAgICAgICAgY29uc3QgcHJvZ3Jlc3MgPSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDBcbiAgICAgICAgICA/IE1hdGgubWluKDEsIE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSAvIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgICAgICAgIDogKGN5Y2xlLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgPyAxIDogMClcbiAgICAgICAgd2VpZ2h0ZWRTdW0gKz0gcHJvZ3Jlc3MgKiB3XG4gICAgICAgIHdlaWdodFRvdGFsICs9IHdcbiAgICAgIH1cbiAgICAgIGNvbnN0IHBjdCA9IHdlaWdodFRvdGFsID4gMCA/IHdlaWdodGVkU3VtIC8gd2VpZ2h0VG90YWwgOiAwXG4gICAgICAvLyBSZXByZXNlbnQgYXMgMFx1MjAxMzEwMCBwZXJjZW50IG9mIHRhcmdldC5cbiAgICAgIGNvbnN0IHZhbHVlID0gcGN0ICogTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgfVxuXG4gICAgY29uc3QgY29tcGxldGVkID0gZW50cmllcy5maWx0ZXIoKFssIGNdKSA9PlxuICAgICAgYy5zdGF0dXMgPT09ICdzdWNjZWVkZWQnIHx8XG4gICAgICAoTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSA+IDAgJiYgTnVtYmVyKGMuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGMudGFyZ2V0X3ZhbHVlKSlcbiAgICApLmxlbmd0aFxuXG4gICAgaWYgKG1vZGUgPT09ICdhbnknKSB7XG4gICAgICBjb25zdCBuZWVkZWQgPSBNYXRoLm1heCgxLCBOdW1iZXIoY29uZmlnLmNvdW50X3JlcXVpcmVkID8/IDEpKVxuICAgICAgcmV0dXJuIHJlc3VsdChjb21wbGV0ZWQsIG5lZWRlZClcbiAgICB9XG5cbiAgICAvLyBhbGxcbiAgICByZXR1cm4gcmVzdWx0KGNvbXBsZXRlZCwgZW50cmllcy5sZW5ndGgpXG4gIH0sXG59XG5cbmNvbnN0IEVWQUxVQVRPUlM6IEdvYWxFdmFsdWF0b3JbXSA9IFtcbiAgYWN0aXZpdHlDb3VudEV2YWx1YXRvcixcbiAgYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBEdXJhdGlvbkV2YWx1YXRvcixcbiAgZ3JvdXBDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbnlDb3VudEV2YWx1YXRvcixcbiAgZ3JvdXBBbGxDb21wbGV0ZUV2YWx1YXRvcixcbiAgbXVsdGlBY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLFxuICBzdHJlYWtFdmFsdWF0b3IsXG4gIHRpbWVPZkRheUNvdW50RXZhbHVhdG9yLFxuICBjb21wb3NpdGVFdmFsdWF0b3IsXG5dXG5cbmNvbnN0IFJFR0lTVFJZID0gbmV3IE1hcChFVkFMVUFUT1JTLm1hcCgoZSkgPT4gW2UucnVsZVR5cGUsIGVdKSlcblxuZXhwb3J0IGNvbnN0IEdPQUxfUlVMRV9UWVBFUyA9IEVWQUxVQVRPUlMubWFwKChlKSA9PiBlLnJ1bGVUeXBlKVxuXG5leHBvcnQgZnVuY3Rpb24gZ2V0RXZhbHVhdG9yKHJ1bGVUeXBlOiBzdHJpbmcpOiBHb2FsRXZhbHVhdG9yIHtcbiAgY29uc3QgZXZhbHVhdG9yID0gUkVHSVNUUlkuZ2V0KHJ1bGVUeXBlKVxuICBpZiAoIWV2YWx1YXRvcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBnb2FsIHJ1bGVfdHlwZTogJHtydWxlVHlwZX1gKVxuICB9XG4gIHJldHVybiBldmFsdWF0b3Jcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGV2YWx1YXRlR29hbChjdHg6IEV2YWx1YXRlQ29udGV4dCk6IEV2YWx1YXRlUmVzdWx0IHtcbiAgcmV0dXJuIGdldEV2YWx1YXRvcihjdHguZ29hbC5ydWxlX3R5cGUpLmV2YWx1YXRlKGN0eClcbn1cbiIsICJpbXBvcnQgdHlwZSB7IEt5c2VseSwgVHJhbnNhY3Rpb24gfSBmcm9tICdreXNlbHknO1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgR29hbCxcbiAgR29hbEN5Y2xlLFxuICBHb2FsRXZlbnQsXG4gIEdvYWxMaW5rLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnO1xuaW1wb3J0IHsgY3ljbGVIYXNTdGFydGVkIH0gZnJvbSAnLi9saWZlY3ljbGUudHMnO1xuaW1wb3J0IHsgZXZhbHVhdGVHb2FsIH0gZnJvbSAnLi9ldmFsdWF0b3JzL2luZGV4LnRzJztcblxudHlwZSBEYkxpa2UgPSBLeXNlbHk8RGF0YWJhc2U+IHwgVHJhbnNhY3Rpb248RGF0YWJhc2U+O1xuXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24pOiBUIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFQ7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4ge30gYXMgVDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICh2YWx1ZSA/PyB7fSkgYXMgVDtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoR29hbExpbmtzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8R29hbExpbmtbXT4ge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoRXZlbnRzRm9yVXNlcihcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIGZyb20/OiBEYXRlIHwgc3RyaW5nLFxuICB0bz86IERhdGUgfCBzdHJpbmcsXG4pOiBQcm9taXNlPEdvYWxFdmVudFtdPiB7XG4gIGxldCBxdWVyeSA9IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZXZlbnRzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKCk7XG5cbiAgaWYgKGZyb20pIHtcbiAgICBjb25zdCBmcm9tRGF0ZSA9IHR5cGVvZiBmcm9tID09PSAnc3RyaW5nJyA/IG5ldyBEYXRlKGZyb20pIDogZnJvbTtcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdvY2N1cnJlZF9hdCcsICc+PScsIGZyb21EYXRlIGFzIG5ldmVyKTtcbiAgfVxuICBpZiAodG8pIHtcbiAgICBjb25zdCB0b0RhdGUgPSB0eXBlb2YgdG8gPT09ICdzdHJpbmcnID8gbmV3IERhdGUodG8pIDogdG87XG4gICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnb2NjdXJyZWRfYXQnLCAnPCcsIHRvRGF0ZSBhcyBuZXZlcik7XG4gIH1cblxuICByZXR1cm4gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gIGRiOiBEYkxpa2UsXG4gIGxpbmtzOiBHb2FsTGlua1tdLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8bnVtYmVyW10+IHtcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua190eXBlID09PSAnZ3JvdXAnICYmIGwuZ3JvdXBfaWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmdyb3VwX2lkISk7XG4gIGlmIChncm91cElkcy5sZW5ndGggPT09IDApIHJldHVybiBbXTtcblxuICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdncm91cF9pZCcsICdpbicsIGdyb3VwSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpO1xuICByZXR1cm4gcm93cy5tYXAoKHIpID0+IHIuaWQpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBmZXRjaENoaWxkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICBnb2FsSWQ6IG51bWJlcixcbik6IFByb21pc2U8eyBjeWNsZXM6IE1hcDxudW1iZXIsIEdvYWxDeWNsZT47IHdlaWdodHM6IE1hcDxudW1iZXIsIG51bWJlcj4gfT4ge1xuICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgY29uc3QgY3ljbGVzID0gbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKTtcbiAgY29uc3Qgd2VpZ2h0cyA9IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCk7XG5cbiAgZm9yIChjb25zdCBkZXAgb2YgZGVwcykge1xuICAgIHdlaWdodHMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIE51bWJlcihkZXAud2VpZ2h0KSk7XG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcblxuICAgIGlmIChjeWNsZSkge1xuICAgICAgY3ljbGVzLnNldChkZXAuZGVwZW5kc19vbl9nb2FsX2lkLCBjeWNsZSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICBjb25zdCBsYXRlc3QgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAobGF0ZXN0KSBjeWNsZXMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIGxhdGVzdCk7XG4gIH1cblxuICByZXR1cm4geyBjeWNsZXMsIHdlaWdodHMgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGhpdHRpbmcgdGhlIHRhcmdldCBzaG91bGQgY2xvc2UgdGhlIGN5Y2xlIGltbWVkaWF0ZWx5LlxuICogUmVjdXJyaW5nIGN5Y2xlcyBzdGF5IGBhY3RpdmVgIHVudGlsIHJvbGwtb3ZlciBhdCBlbmRzX2F0IHNvIHRoZSBVSSBrZWVwc1xuICogYW4gYWN0aXZlQ3ljbGUgKGFuZCBwcm9ncmVzcykgZm9yIHRoZSByZXN0IG9mIHRoZSB3aW5kb3cuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoXG4gIGdvYWw6IFBpY2s8R29hbCwgJ3JlY3VycmVuY2UnPixcbik6IGJvb2xlYW4ge1xuICByZXR1cm4gZ29hbC5yZWN1cnJlbmNlID09IG51bGw7XG59XG5cbi8qKlxuICogUmVjb21wdXRlIGFuZCBwZXJzaXN0IGN1cnJlbnRfdmFsdWUgZm9yIGEgc2luZ2xlIGN5Y2xlLlxuICogUmV0dXJucyB0aGUgdXBkYXRlZCBjeWNsZS5cbiAqIFNraXBzIGFjY3J1YWwgd2hpbGUgdGhlIGN5Y2xlIGhhcyBub3Qgc3RhcnRlZCAoa2VlcHMgY3VycmVudF92YWx1ZSBhdCAwLFxuICogbmV2ZXIgYXV0by1zdWNjZWVkcykgXHUyMDE0IGNvdmVycyBjb21wb3NpdGUgcGFyZW50cyBjb21wbGV0aW5nIGVhcmx5IHZpYSBjaGlsZHJlbi5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgaWYgKGN5Y2xlLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgIWN5Y2xlSGFzU3RhcnRlZChjeWNsZSwgbm93KSkge1xuICAgIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPT09IDApIHJldHVybiBjeWNsZTtcbiAgICBjb25zdCBzdGFtcGVkID0gbm93LnRvSVNPU3RyaW5nKCk7XG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgIC5zZXQoeyBjdXJyZW50X3ZhbHVlOiAwLCB1cGRhdGVkX2F0OiBzdGFtcGVkIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH1cblxuICBjb25zdCBsaW5rcyA9IGF3YWl0IGZldGNoR29hbExpbmtzKGRiLCBnb2FsLmlkKTtcbiAgY29uc3QgZXZlbnRzID0gYXdhaXQgZmV0Y2hFdmVudHNGb3JVc2VyKFxuICAgIGRiLFxuICAgIGdvYWwudXNlcl9pZCxcbiAgICBjeWNsZS5zdGFydHNfYXQsXG4gICAgY3ljbGUuZW5kc19hdCA/PyB1bmRlZmluZWQsXG4gICk7XG4gIGNvbnN0IGdyb3VwQWN0aXZpdHlJZHMgPSBhd2FpdCBncm91cEFjdGl2aXR5SWRzRm9yTGlua3MoXG4gICAgZGIsXG4gICAgbGlua3MsXG4gICAgZ29hbC51c2VyX2lkLFxuICApO1xuICBjb25zdCB7IGN5Y2xlczogY2hpbGRDeWNsZXMsIHdlaWdodHM6IGNoaWxkV2VpZ2h0cyB9ID1cbiAgICBnb2FsLnJ1bGVfdHlwZSA9PT0gJ2NvbXBvc2l0ZSdcbiAgICAgID8gYXdhaXQgZmV0Y2hDaGlsZEN5Y2xlcyhkYiwgZ29hbC5pZClcbiAgICAgIDoge1xuICAgICAgICAgIGN5Y2xlczogbmV3IE1hcDxudW1iZXIsIEdvYWxDeWNsZT4oKSxcbiAgICAgICAgICB3ZWlnaHRzOiBuZXcgTWFwPG51bWJlciwgbnVtYmVyPigpLFxuICAgICAgICB9O1xuXG4gIGNvbnN0IHsgY3VycmVudFZhbHVlLCBkb25lIH0gPSBldmFsdWF0ZUdvYWwoe1xuICAgIGdvYWw6IHtcbiAgICAgIC4uLmdvYWwsXG4gICAgICBjb25maWc6IHBhcnNlSnNvbihnb2FsLmNvbmZpZyksXG4gICAgfSxcbiAgICBjeWNsZSxcbiAgICBsaW5rcyxcbiAgICBldmVudHMsXG4gICAgY2hpbGRDeWNsZXMsXG4gICAgY2hpbGRXZWlnaHRzLFxuICAgIGdyb3VwQWN0aXZpdHlJZHMsXG4gIH0pO1xuXG4gIGNvbnN0IG5vd0lzbyA9IG5vdy50b0lTT1N0cmluZygpO1xuICBsZXQgc3RhdHVzID0gY3ljbGUuc3RhdHVzO1xuICAvLyBPbmUtdGltZSBnb2FscyBjbG9zZSBhcyBzb29uIGFzIHRoZSB0YXJnZXQgaXMgbWV0LiBSZWN1cnJpbmcgY3ljbGVzIHN0YXlcbiAgLy8gYWN0aXZlIHVudGlsIHJvbGxPdmVySWZOZWVkZWQgY2xvc2VzIHRoZW0gYXQgZW5kc19hdCBcdTIwMTQgb3RoZXJ3aXNlXG4gIC8vIGFjdGl2ZUN5Y2xlIGdvZXMgbnVsbCBtaWQtd2luZG93IGFuZCB0aGUgY2xpZW50IHNob3dzIDAlIHByb2dyZXNzLlxuICBpZiAoXG4gICAgY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgIGRvbmUgJiZcbiAgICBzaG91bGRDbG9zZUN5Y2xlT25UYXJnZXQoZ29hbClcbiAgKSB7XG4gICAgc3RhdHVzID0gJ3N1Y2NlZWRlZCc7XG4gIH1cblxuICBjb25zdCB1cGRhdGVkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIGN1cnJlbnRfdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIHN0YXR1cyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vd0lzbyxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gIC8vIERhaWx5IHNuYXBzaG90IGZvciBoaXN0b3J5IGNoYXJ0cyAodXBzZXJ0IGJ5IGFzX29mIGRhdGUpLlxuICBjb25zdCBhc09mID0gbm93SXNvLnNsaWNlKDAsIDEwKTtcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogdXBkYXRlZC5pZCxcbiAgICAgIGFzX29mOiBhc09mLFxuICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICB9KVxuICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgIG9jLmNvbHVtbnMoWydnb2FsX2N5Y2xlX2lkJywgJ2FzX29mJ10pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgdmFsdWU6IGN1cnJlbnRWYWx1ZSxcbiAgICAgIH0pLFxuICAgIClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIC8vIE1hcmsgcGFyZW50IGdvYWwgY29tcGxldGVkIHdoZW4gYSBvbmUtdGltZSBjeWNsZSBzdWNjZWVkcy5cbiAgaWYgKHN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiYgIWdvYWwucmVjdXJyZW5jZSAmJiBnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScpIHtcbiAgICBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAnY29tcGxldGVkJywgdXBkYXRlZF9hdDogbm93SXNvIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgfVxuXG4gIHJldHVybiB1cGRhdGVkO1xufVxuXG4vKiogUmVjb21wdXRlIGFsbCBhY3RpdmUgY3ljbGVzIGxpbmtlZCB0byBhbiBhY3Rpdml0eSBvciBncm91cCB2aWEgZ29hbF9saW5rcy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVBZmZlY3RlZEN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIG9wdHM6IHsgYWN0aXZpdHlJZD86IG51bWJlciB8IG51bGw7IGdyb3VwSWQ/OiBudW1iZXIgfCBudWxsIH0sXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgZ29hbElkcyA9IG5ldyBTZXQ8bnVtYmVyPigpO1xuXG4gIGlmIChvcHRzLmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgICAgLmlubmVySm9pbignZ29hbHMnLCAnZ29hbHMuaWQnLCAnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC53aGVyZSgnZ29hbHMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdnb2FsX2xpbmtzLmFjdGl2aXR5X2lkJywgJz0nLCBvcHRzLmFjdGl2aXR5SWQpXG4gICAgICAuc2VsZWN0KCdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IHIgb2Ygcm93cykgZ29hbElkcy5hZGQoci5nb2FsX2lkKTtcbiAgfVxuXG4gIGlmIChvcHRzLmdyb3VwSWQgIT0gbnVsbCkge1xuICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgICAgLmlubmVySm9pbignZ29hbHMnLCAnZ29hbHMuaWQnLCAnZ29hbF9saW5rcy5nb2FsX2lkJylcbiAgICAgIC53aGVyZSgnZ29hbHMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdnb2FsX2xpbmtzLmdyb3VwX2lkJywgJz0nLCBvcHRzLmdyb3VwSWQpXG4gICAgICAuc2VsZWN0KCdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IHIgb2Ygcm93cykgZ29hbElkcy5hZGQoci5nb2FsX2lkKTtcbiAgfVxuXG4gIC8vIEFsc28gcmVjb21wdXRlIGNvbXBvc2l0ZXMgdGhhdCBkZXBlbmQgb24gYWZmZWN0ZWQgZ29hbHMuXG4gIGlmIChnb2FsSWRzLnNpemUgPiAwKSB7XG4gICAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgLndoZXJlKCdkZXBlbmRzX29uX2dvYWxfaWQnLCAnaW4nLCBbLi4uZ29hbElkc10pXG4gICAgICAuc2VsZWN0KCdnb2FsX2lkJylcbiAgICAgIC5leGVjdXRlKCk7XG4gICAgZm9yIChjb25zdCBkIG9mIGRlcHMpIGdvYWxJZHMuYWRkKGQuZ29hbF9pZCk7XG4gIH1cblxuICBmb3IgKGNvbnN0IGdvYWxJZCBvZiBnb2FsSWRzKSB7XG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgZ29hbElkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKCFnb2FsIHx8IGdvYWwuc3RhdHVzID09PSAncGF1c2VkJyB8fCBnb2FsLnN0YXR1cyA9PT0gJ2FyY2hpdmVkJylcbiAgICAgIGNvbnRpbnVlO1xuXG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghY3ljbGUpIGNvbnRpbnVlO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQ3ljbGUoZGIsIGdvYWwsIGN5Y2xlKTtcbiAgfVxufVxuXG4vKiogRnVsbCByZWNvbXB1dGUgb2YgZXZlcnkgYWN0aXZlIGN5Y2xlIGZvciBhIHVzZXIgKHJlcGFpciBwYXRoKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWNvbXB1dGVBbGxBY3RpdmVDeWNsZXMoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxudW1iZXI+IHtcbiAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ2FjdGl2ZScsICdjb21wbGV0ZWQnLCAnZmFpbGVkJ10pXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKTtcblxuICBsZXQgY291bnQgPSAwO1xuICBmb3IgKGNvbnN0IGdvYWwgb2YgZ29hbHMpIHtcbiAgICBjb25zdCBjeWNsZXMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IGN5Y2xlIG9mIGN5Y2xlcykge1xuICAgICAgYXdhaXQgcmVjb21wdXRlQ3ljbGUoZGIsIGdvYWwsIGN5Y2xlKTtcbiAgICAgIGNvdW50Kys7XG4gICAgfVxuICB9XG4gIHJldHVybiBjb3VudDtcbn1cbiIsICIvKipcbiAqIFNoYXJlZCBwcmVzZXQgcGFsZXR0ZSBmb3IgYWN0aXZpdHkgZ3JvdXBzLlxuICogS2VlcCBpbiBzeW5jIHdpdGggRmx1dHRlciBgbGliL3RoZW1lL3Rva2Vucy9ncm91cF9wYWxldHRlLmRhcnRgLlxuICovXG5leHBvcnQgY29uc3QgR1JPVVBfQ09MT1JfUEFMRVRURSA9IFtcbiAgJyMwRjc2NkUnLCAvLyB0ZWFsIChicmFuZClcbiAgJyMyNTYzRUInLCAvLyBibHVlXG4gICcjN0MzQUVEJywgLy8gdmlvbGV0XG4gICcjREIyNzc3JywgLy8gcGlua1xuICAnI0RDMjYyNicsIC8vIHJlZFxuICAnI0VBNTgwQycsIC8vIG9yYW5nZVxuICAnI0NBOEEwNCcsIC8vIHllbGxvd1xuICAnIzE2QTM0QScsIC8vIGdyZWVuXG4gICcjMDg5MUIyJywgLy8gY3lhblxuICAnIzRCNTU2MycsIC8vIGdyYXlcbl0gYXMgY29uc3RcblxuZXhwb3J0IHR5cGUgR3JvdXBDb2xvciA9ICh0eXBlb2YgR1JPVVBfQ09MT1JfUEFMRVRURSlbbnVtYmVyXVxuXG5jb25zdCBIRVhfQ09MT1JfUkUgPSAvXiNbMC05QS1GYS1mXXs2fSQvXG5cbmV4cG9ydCBmdW5jdGlvbiBpc0FsbG93ZWRHcm91cENvbG9yKGNvbG9yOiBzdHJpbmcpOiBjb2xvciBpcyBHcm91cENvbG9yIHtcbiAgaWYgKCFIRVhfQ09MT1JfUkUudGVzdChjb2xvcikpIHJldHVybiBmYWxzZVxuICBjb25zdCBub3JtYWxpemVkID0gY29sb3IudG9VcHBlckNhc2UoKVxuICByZXR1cm4gKEdST1VQX0NPTE9SX1BBTEVUVEUgYXMgcmVhZG9ubHkgc3RyaW5nW10pLnNvbWUoXG4gICAgKGMpID0+IGMudG9VcHBlckNhc2UoKSA9PT0gbm9ybWFsaXplZCxcbiAgKVxufVxuXG4vKiogTm9ybWFsaXplIHRvIGNhbm9uaWNhbCBgI1JSR0dCQmAgdXBwZXJjYXNlIGZyb20gdGhlIGFsbG93bGlzdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVHcm91cENvbG9yKGNvbG9yOiBzdHJpbmcpOiBHcm91cENvbG9yIHtcbiAgY29uc3QgbWF0Y2ggPSAoR1JPVVBfQ09MT1JfUEFMRVRURSBhcyByZWFkb25seSBzdHJpbmdbXSkuZmluZChcbiAgICAoYykgPT4gYy50b1VwcGVyQ2FzZSgpID09PSBjb2xvci50b1VwcGVyQ2FzZSgpLFxuICApXG4gIGlmICghbWF0Y2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYEludmFsaWQgZ3JvdXAgY29sb3I6ICR7Y29sb3J9YClcbiAgfVxuICByZXR1cm4gbWF0Y2ggYXMgR3JvdXBDb2xvclxufVxuIiwgImltcG9ydCB7IFJlY3VycmVuY2VDb25maWcsIFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfSBmcm9tICcuL3R5cGVzLnRzJ1xuaW1wb3J0IHsgaXNBbGxvd2VkR3JvdXBDb2xvciwgbm9ybWFsaXplR3JvdXBDb2xvciB9IGZyb20gJy4vZ3JvdXBfcGFsZXR0ZS50cydcbmltcG9ydCB7IEdPQUxfUlVMRV9UWVBFUyB9IGZyb20gJy4uL2dvYWxzL2V2YWx1YXRvcnMvaW5kZXgudHMnXG5pbXBvcnQgdHlwZSB7XG4gIENyZWF0ZUdvYWxJbnB1dCxcbiAgR29hbERlYWRsaW5lSW5wdXQsXG4gIEdvYWxEZXBlbmRlbmN5SW5wdXQsXG4gIEdvYWxMaW5rSW5wdXQsXG4gIEdvYWxSZWN1cnJlbmNlSW5wdXQsXG4gIFVwZGF0ZUdvYWxJbnB1dCxcbn0gZnJvbSAnLi90eXBlcy50cydcblxuZXhwb3J0IGNsYXNzIEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRHcm91cEVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmV4cG9ydCBjbGFzcyBJbnZhbGlkQ29tcGxldGlvbkVycm9yIGV4dGVuZHMgRXJyb3Ige31cbmV4cG9ydCBjbGFzcyBJbnZhbGlkR29hbEVycm9yIGV4dGVuZHMgRXJyb3Ige31cblxuaW50ZXJmYWNlIEFjdGl2aXR5U2NoZWR1bGUge1xuICBpc1JlY3VycmluZzogYm9vbGVhblxuICBkYXRlPzogc3RyaW5nIHwgbnVsbFxuICByZWN1cnJlbmNlUGF0dGVybj86IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIHRoYXQgYW4gYWN0aXZpdHkncyBzY2hlZHVsZSBpcyBpbnRlcm5hbGx5IGNvbnNpc3RlbnQ6XG4gKiAtIE5vbi1yZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSBgZGF0ZWAgYW5kIG5vIHJlY3VycmVuY2UgcGF0dGVybi5cbiAqIC0gUmVjdXJyaW5nIGFjdGl2aXRpZXMgbXVzdCBoYXZlIGEgcmVjdXJyZW5jZSBwYXR0ZXJuIChhbmQgbm8gYGRhdGVgKSxcbiAqICAgd2l0aCBjb25maWcgZmllbGRzIG1hdGNoaW5nIHRoZSBjaG9zZW4gcmVjdXJyZW5jZSB0eXBlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlKGlucHV0OiBBY3Rpdml0eVNjaGVkdWxlKTogdm9pZCB7XG4gIGlmICghaW5wdXQuaXNSZWN1cnJpbmcpIHtcbiAgICBpZiAoIWlucHV0LmRhdGUpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgICAnZGF0ZSBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIGZhbHNlJyxcbiAgICAgIClcbiAgICB9XG4gICAgcmV0dXJuXG4gIH1cblxuICBpZiAoIWlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4gaXMgcmVxdWlyZWQgd2hlbiBpc1JlY3VycmluZyBpcyB0cnVlJyxcbiAgICApXG4gIH1cblxuICBjb25zdCB7IHJlY3VycmVuY2VUeXBlLCBjb25maWcgfSA9IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuXG4gIGlmICghY29uZmlnIHx8ICFjb25maWcuc3RhcnRfZGF0ZSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ3JlY3VycmVuY2VQYXR0ZXJuLmNvbmZpZy5zdGFydF9kYXRlIGlzIHJlcXVpcmVkJyxcbiAgICApXG4gIH1cblxuICBzd2l0Y2ggKHJlY3VycmVuY2VUeXBlKSB7XG4gICAgY2FzZSAnd2Vla2x5JzpcbiAgICAgIHZhbGlkYXRlRGF5c09mV2Vlayhjb25maWcuZGF5c19vZl93ZWVrKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdtb250aGx5JzpcbiAgICAgIHZhbGlkYXRlRGF5c09mTW9udGgoY29uZmlnLmRheXNfb2ZfbW9udGgsIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnZXZlcnlfeF9kYXlzJzpcbiAgICAgIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGNvbmZpZy5pbnRlcnZhbF9kYXlzKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgIGBVbnN1cHBvcnRlZCByZWN1cnJlbmNlVHlwZTogJHtyZWN1cnJlbmNlVHlwZX1gLFxuICAgICAgKVxuICB9XG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGEgZ3JvdXAgY29sb3IgYWdhaW5zdCB0aGUgc2hhcmVkIGhleCBhbGxvd2xpc3QuXG4gKiBSZXR1cm5zIHRoZSBjYW5vbmljYWwgcGFsZXR0ZSB2YWx1ZSAoZS5nLiBgIzBGNzY2RWApLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHcm91cENvbG9yKGNvbG9yOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIWlzQWxsb3dlZEdyb3VwQ29sb3IoY29sb3IpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKFxuICAgICAgJ2NvbG9yIG11c3QgYmUgYSBoZXggdmFsdWUgZnJvbSB0aGUgZ3JvdXAgcGFsZXR0ZSAoZS5nLiAjMEY3NjZFKScsXG4gICAgKVxuICB9XG4gIHJldHVybiBub3JtYWxpemVHcm91cENvbG9yKGNvbG9yKVxufVxuXG4vKipcbiAqIFZhbGlkYXRlcyBncm91cCBuYW1lIGlzIG5vbi1lbXB0eSBhZnRlciB0cmltLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHcm91cE5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpXG4gIGlmICghdHJpbW1lZCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcignbmFtZSBpcyByZXF1aXJlZCcpXG4gIH1cbiAgaWYgKHRyaW1tZWQubGVuZ3RoID4gMjU1KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKCduYW1lIG11c3QgYmUgYXQgbW9zdCAyNTUgY2hhcmFjdGVycycpXG4gIH1cbiAgcmV0dXJuIHRyaW1tZWRcbn1cblxuY29uc3QgREFURV9SRSA9IC9eXFxkezR9LVxcZHsyfS1cXGR7Mn0kL1xuY29uc3QgVElNRV9SRSA9IC9eXFxkezJ9OlxcZHsyfSQvXG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU9jY3VycmVuY2VEYXRlKGRhdGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghREFURV9SRS50ZXN0KGRhdGUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ29jY3VycmVuY2VEYXRlIG11c3QgYmUgWVlZWS1NTS1ERCcpXG4gIH1cbiAgcmV0dXJuIGRhdGVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlRHVyYXRpb25NaW51dGVzKHZhbHVlOiBudW1iZXIgfCBudWxsIHwgdW5kZWZpbmVkKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PT0gdW5kZWZpbmVkIHx8IHZhbHVlID09PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPCAwIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKCdkdXJhdGlvbk1pbnV0ZXMgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUG9zaXRpdmVEdXJhdGlvbih2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDAgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ2R1cmF0aW9uTWludXRlcyBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mV2VlayhkYXlzT2ZXZWVrOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX3dlZWsnXSk6IHZvaWQge1xuICBpZiAoIWRheXNPZldlZWsgfHwgZGF5c09mV2Vlay5sZW5ndGggPT09IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIGlzIHJlcXVpcmVkIGZvciB3ZWVrbHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChkYXlzT2ZXZWVrLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAwIHx8IGRheSA+IDYpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2Zfd2VlayBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAwIChTdW5kYXkpIGFuZCA2IChTYXR1cmRheSknLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZURheXNPZk1vbnRoKFxuICBkYXlzT2ZNb250aDogUmVjdXJyZW5jZUNvbmZpZ1snZGF5c19vZl9tb250aCddLFxuICBpc0xhc3REYXlPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydpc19sYXN0X2RheV9vZl9tb250aCddLFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhc0RheXNPZk1vbnRoID0gISFkYXlzT2ZNb250aCAmJiBkYXlzT2ZNb250aC5sZW5ndGggPiAwXG4gIGlmICghaGFzRGF5c09mTW9udGggJiYgIWlzTGFzdERheU9mTW9udGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBvciBjb25maWcuaXNfbGFzdF9kYXlfb2ZfbW9udGggaXMgcmVxdWlyZWQgZm9yIG1vbnRobHkgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG4gIGlmIChcbiAgICBoYXNEYXlzT2ZNb250aCAmJlxuICAgIGRheXNPZk1vbnRoIS5zb21lKChkYXkpID0+ICFOdW1iZXIuaXNJbnRlZ2VyKGRheSkgfHwgZGF5IDwgMSB8fCBkYXkgPiAzMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAnY29uZmlnLmRheXNfb2ZfbW9udGggbXVzdCBjb250YWluIGludGVnZXJzIGJldHdlZW4gMSBhbmQgMzEnLFxuICAgIClcbiAgfVxufVxuXG5mdW5jdGlvbiB2YWxpZGF0ZUludGVydmFsRGF5cyhpbnRlcnZhbERheXM6IFJlY3VycmVuY2VDb25maWdbJ2ludGVydmFsX2RheXMnXSk6IHZvaWQge1xuICBpZiAoXG4gICAgaW50ZXJ2YWxEYXlzID09PSB1bmRlZmluZWQgfHxcbiAgICBpbnRlcnZhbERheXMgPT09IG51bGwgfHxcbiAgICAhTnVtYmVyLmlzSW50ZWdlcihpbnRlcnZhbERheXMpIHx8XG4gICAgaW50ZXJ2YWxEYXlzIDwgMVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuaW50ZXJ2YWxfZGF5cyBtdXN0IGJlIGFuIGludGVnZXIgPj0gMSBmb3IgZXZlcnlfeF9kYXlzIHJlY3VycmVuY2UnLFxuICAgIClcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsVGl0bGUodGl0bGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHRyaW1tZWQgPSB0aXRsZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGl0bGUgaXMgcmVxdWlyZWQnKVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0aXRsZSBtdXN0IGJlIGF0IG1vc3QgMjU1IGNoYXJhY3RlcnMnKVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB2YWxpZGF0ZUdyb3VwQ29sb3IoY29sb3IpXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVJ1bGVUeXBlKHJ1bGVUeXBlOiBzdHJpbmcpOiBzdHJpbmcge1xuICBpZiAoIUdPQUxfUlVMRV9UWVBFUy5pbmNsdWRlcyhydWxlVHlwZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgIGBydWxlVHlwZSBtdXN0IGJlIG9uZSBvZjogJHtHT0FMX1JVTEVfVFlQRVMuam9pbignLCAnKX1gLFxuICAgIClcbiAgfVxuICByZXR1cm4gcnVsZVR5cGVcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlVGFyZ2V0VmFsdWUodmFsdWU6IG51bWJlcik6IG51bWJlciB7XG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RhcmdldFZhbHVlIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsTGlua3MoXG4gIGxpbmtzOiBHb2FsTGlua0lucHV0W10gfCB1bmRlZmluZWQsXG4gIHJ1bGVUeXBlOiBzdHJpbmcsXG4pOiBHb2FsTGlua0lucHV0W10ge1xuICBjb25zdCBsaXN0ID0gbGlua3MgPz8gW11cbiAgaWYgKHJ1bGVUeXBlID09PSAnY29tcG9zaXRlJykge1xuICAgIGlmIChsaXN0Lmxlbmd0aCA+IDApIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjb21wb3NpdGUgZ29hbHMgbXVzdCBub3QgaGF2ZSBhY3Rpdml0eS9ncm91cCBsaW5rcycpXG4gICAgfVxuICAgIHJldHVybiBbXVxuICB9XG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhdCBsZWFzdCBvbmUgbGluayBpcyByZXF1aXJlZCcpXG4gIH1cbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpc3QpIHtcbiAgICBpZiAobGluay5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5Jykge1xuICAgICAgaWYgKGxpbmsuYWN0aXZpdHlJZCA9PSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhY3Rpdml0eSBsaW5rcyByZXF1aXJlIGFjdGl2aXR5SWQnKVxuICAgICAgfVxuICAgICAgaWYgKGxpbmsuZ3JvdXBJZCAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhY3Rpdml0eSBsaW5rcyBtdXN0IG5vdCBzZXQgZ3JvdXBJZCcpXG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChsaW5rLmxpbmtUeXBlID09PSAnZ3JvdXAnKSB7XG4gICAgICBpZiAobGluay5ncm91cElkID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2dyb3VwIGxpbmtzIHJlcXVpcmUgZ3JvdXBJZCcpXG4gICAgICB9XG4gICAgICBpZiAobGluay5hY3Rpdml0eUlkICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2dyb3VwIGxpbmtzIG11c3Qgbm90IHNldCBhY3Rpdml0eUlkJylcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2xpbmtUeXBlIG11c3QgYmUgYWN0aXZpdHkgb3IgZ3JvdXAnKVxuICAgIH1cbiAgICBpZiAobGluay53ZWlnaHQgIT0gbnVsbCAmJiAoIU51bWJlci5pc0Zpbml0ZShsaW5rLndlaWdodCkgfHwgbGluay53ZWlnaHQgPD0gMCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdsaW5rIHdlaWdodCBtdXN0IGJlIGEgcG9zaXRpdmUgbnVtYmVyJylcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxpc3Rcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhcbiAgZGVwczogR29hbERlcGVuZGVuY3lJbnB1dFtdIHwgdW5kZWZpbmVkLFxuICBydWxlVHlwZTogc3RyaW5nLFxuKTogR29hbERlcGVuZGVuY3lJbnB1dFtdIHtcbiAgY29uc3QgbGlzdCA9IGRlcHMgPz8gW11cbiAgaWYgKHJ1bGVUeXBlID09PSAnY29tcG9zaXRlJyAmJiBsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjb21wb3NpdGUgZ29hbHMgcmVxdWlyZSBhdCBsZWFzdCBvbmUgZGVwZW5kZW5jeScpXG4gIH1cbiAgZm9yIChjb25zdCBkZXAgb2YgbGlzdCkge1xuICAgIGlmICghTnVtYmVyLmlzSW50ZWdlcihkZXAuZGVwZW5kc09uR29hbElkKSB8fCBkZXAuZGVwZW5kc09uR29hbElkIDw9IDApIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZXBlbmRzT25Hb2FsSWQgbXVzdCBiZSBhIHBvc2l0aXZlIGludGVnZXInKVxuICAgIH1cbiAgICBpZiAoXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT0gbnVsbCAmJlxuICAgICAgZGVwLnJlcXVpcmVtZW50ICE9PSAnY29tcGxldGUnICYmXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT09ICdwcm9ncmVzcydcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdyZXF1aXJlbWVudCBtdXN0IGJlIGNvbXBsZXRlIG9yIHByb2dyZXNzJylcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGxpc3Rcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbFJlY3VycmVuY2UoXG4gIHJlY3VycmVuY2U6IEdvYWxSZWN1cnJlbmNlSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogR29hbFJlY3VycmVuY2VJbnB1dCB8IG51bGwge1xuICBpZiAocmVjdXJyZW5jZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBjb25zdCBwZXJpb2RzID0gWyd3ZWVrbHknLCAnbW9udGhseScsICdxdWFydGVybHknLCAnZXZlcnlfeF9kYXlzJ11cbiAgaWYgKCFwZXJpb2RzLmluY2x1ZGVzKHJlY3VycmVuY2UucGVyaW9kKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKGB1bnN1cHBvcnRlZCByZWN1cnJlbmNlIHBlcmlvZDogJHtyZWN1cnJlbmNlLnBlcmlvZH1gKVxuICB9XG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmludGVydmFsICE9IG51bGwgJiZcbiAgICAoIU51bWJlci5pc0ludGVnZXIocmVjdXJyZW5jZS5pbnRlcnZhbCkgfHwgcmVjdXJyZW5jZS5pbnRlcnZhbCA8IDEpXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdyZWN1cnJlbmNlLmludGVydmFsIG11c3QgYmUgYW4gaW50ZWdlciA+PSAxJylcbiAgfVxuICBpZiAoXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT0gbnVsbCAmJlxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9PSAnbm9uZScgJiZcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPT0gJ292ZXJmbG93J1xuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignY2FycnlPdmVyIG11c3QgYmUgbm9uZSBvciBvdmVyZmxvdycpXG4gIH1cbiAgcmV0dXJuIHJlY3VycmVuY2Vcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlR29hbERlYWRsaW5lKFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogR29hbERlYWRsaW5lSW5wdXQgfCBudWxsIHtcbiAgaWYgKGRlYWRsaW5lID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmIChkZWFkbGluZS5raW5kID09PSAnYWJzb2x1dGUnKSB7XG4gICAgaWYgKCFkZWFkbGluZS5kYXRlIHx8ICFEQVRFX1JFLnRlc3QoZGVhZGxpbmUuZGF0ZSkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhYnNvbHV0ZSBkZWFkbGluZSByZXF1aXJlcyBkYXRlIFlZWVktTU0tREQnKVxuICAgIH1cbiAgfSBlbHNlIGlmIChkZWFkbGluZS5raW5kID09PSAncmVsYXRpdmUnKSB7XG4gICAgaWYgKFxuICAgICAgZGVhZGxpbmUuZGF5c0FmdGVyQ3ljbGVTdGFydCA9PSBudWxsIHx8XG4gICAgICAhTnVtYmVyLmlzSW50ZWdlcihkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0KSB8fFxuICAgICAgZGVhZGxpbmUuZGF5c0FmdGVyQ3ljbGVTdGFydCA8IDBcbiAgICApIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAncmVsYXRpdmUgZGVhZGxpbmUgcmVxdWlyZXMgZGF5c0FmdGVyQ3ljbGVTdGFydCA+PSAwJyxcbiAgICAgIClcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlYWRsaW5lLmtpbmQgbXVzdCBiZSBhYnNvbHV0ZSBvciByZWxhdGl2ZScpXG4gIH1cbiAgcmV0dXJuIGRlYWRsaW5lXG59XG5cbmNvbnN0IE1BWF9TVEFSVF9ZRUFSU19BSEVBRCA9IDVcblxuLyoqIFBhcnNlIGFuZCB2YWxpZGF0ZSBhbiBvcHRpb25hbCBJU08tODYwMSBzdGFydHNBdC4gUmV0dXJucyBudWxsIGlmIG9taXR0ZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVTdGFydHNBdChcbiAgc3RhcnRzQXQ6IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBEYXRlIHwgbnVsbCB7XG4gIGlmIChzdGFydHNBdCA9PSBudWxsIHx8IHN0YXJ0c0F0ID09PSAnJykgcmV0dXJuIG51bGxcbiAgY29uc3QgcGFyc2VkID0gbmV3IERhdGUoc3RhcnRzQXQpXG4gIGlmIChOdW1iZXIuaXNOYU4ocGFyc2VkLmdldFRpbWUoKSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignc3RhcnRzQXQgbXVzdCBiZSBhIHZhbGlkIElTTy04NjAxIGRhdGV0aW1lJylcbiAgfVxuICBjb25zdCBtYXggPSBuZXcgRGF0ZShub3cpXG4gIG1heC5zZXRVVENGdWxsWWVhcihtYXguZ2V0VVRDRnVsbFllYXIoKSArIE1BWF9TVEFSVF9ZRUFSU19BSEVBRClcbiAgaWYgKHBhcnNlZCA+IG1heCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgYHN0YXJ0c0F0IG11c3QgYmUgd2l0aGluICR7TUFYX1NUQVJUX1lFQVJTX0FIRUFEfSB5ZWFycyBmcm9tIG5vd2AsXG4gICAgKVxuICB9XG4gIHJldHVybiBwYXJzZWRcbn1cblxuLyoqIFJlamVjdCBhYnNvbHV0ZSBkZWFkbGluZXMgdGhhdCBlbmQgYmVmb3JlIHRoZSBnb2FsIHN0YXJ0cy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoXG4gIHN0YXJ0c0F0OiBEYXRlLFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogdm9pZCB7XG4gIGlmICghZGVhZGxpbmUgfHwgZGVhZGxpbmUua2luZCAhPT0gJ2Fic29sdXRlJyB8fCAhZGVhZGxpbmUuZGF0ZSkgcmV0dXJuXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBuZXcgRGF0ZShkZWFkbGluZS5kYXRlICsgJ1QyMzo1OTo1OS45OTlaJylcbiAgaWYgKGRlYWRsaW5lQXQgPCBzdGFydHNBdCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZWFkbGluZSBtdXN0IGJlIG9uIG9yIGFmdGVyIHRoZSBnb2FsIHN0YXJ0JylcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDcmVhdGVHb2FsSW5wdXQoXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXQsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pIHtcbiAgY29uc3QgdGl0bGUgPSB2YWxpZGF0ZUdvYWxUaXRsZShpbnB1dC50aXRsZSlcbiAgY29uc3QgY29sb3IgPSB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcilcbiAgY29uc3QgcnVsZVR5cGUgPSB2YWxpZGF0ZVJ1bGVUeXBlKGlucHV0LnJ1bGVUeXBlKVxuICBjb25zdCB0YXJnZXRWYWx1ZSA9IHZhbGlkYXRlVGFyZ2V0VmFsdWUoaW5wdXQudGFyZ2V0VmFsdWUpXG4gIGlmIChpbnB1dC5tZXRyaWMgIT09ICdjb3VudCcgJiYgaW5wdXQubWV0cmljICE9PSAnZHVyYXRpb24nKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ21ldHJpYyBtdXN0IGJlIGNvdW50IG9yIGR1cmF0aW9uJylcbiAgfVxuICBjb25zdCBsaW5rcyA9IHZhbGlkYXRlR29hbExpbmtzKGlucHV0LmxpbmtzLCBydWxlVHlwZSlcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKGlucHV0LmRlcGVuZGVuY2llcywgcnVsZVR5cGUpXG4gIGNvbnN0IHJlY3VycmVuY2UgPSB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKGlucHV0LnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gdmFsaWRhdGVHb2FsRGVhZGxpbmUoaW5wdXQuZGVhZGxpbmUpXG4gIGNvbnN0IHN0YXJ0c0F0ID0gdmFsaWRhdGVTdGFydHNBdChpbnB1dC5zdGFydHNBdCwgbm93KSA/PyBub3dcbiAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0KHN0YXJ0c0F0LCBkZWFkbGluZSlcblxuICBpZiAoaW5wdXQuY29uZmlnPy5iZWZvcmVUaW1lICYmICFUSU1FX1JFLnRlc3QoaW5wdXQuY29uZmlnLmJlZm9yZVRpbWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2JlZm9yZVRpbWUgbXVzdCBiZSBISDptbScpXG4gIH1cbiAgaWYgKGlucHV0LmNvbmZpZz8uYWZ0ZXJUaW1lICYmICFUSU1FX1JFLnRlc3QoaW5wdXQuY29uZmlnLmFmdGVyVGltZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYWZ0ZXJUaW1lIG11c3QgYmUgSEg6bW0nKVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICB0aXRsZSxcbiAgICBjb2xvcixcbiAgICBydWxlVHlwZSxcbiAgICB0YXJnZXRWYWx1ZSxcbiAgICBsaW5rcyxcbiAgICBkZXBlbmRlbmNpZXMsXG4gICAgcmVjdXJyZW5jZSxcbiAgICBkZWFkbGluZSxcbiAgICBzdGFydHNBdCxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVVcGRhdGVHb2FsSW5wdXQoXG4gIGlucHV0OiBVcGRhdGVHb2FsSW5wdXQsXG4gIGV4aXN0aW5nUnVsZVR5cGU6IHN0cmluZyxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbikge1xuICBjb25zdCBydWxlVHlwZSA9IGlucHV0LnJ1bGVUeXBlICE9IG51bGxcbiAgICA/IHZhbGlkYXRlUnVsZVR5cGUoaW5wdXQucnVsZVR5cGUpXG4gICAgOiBleGlzdGluZ1J1bGVUeXBlXG5cbiAgaWYgKGlucHV0LnRpdGxlICE9IG51bGwpIHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKVxuICBpZiAoaW5wdXQuY29sb3IgIT0gbnVsbCkgdmFsaWRhdGVHb2FsQ29sb3IoaW5wdXQuY29sb3IpXG4gIGlmIChpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsKSB2YWxpZGF0ZVRhcmdldFZhbHVlKGlucHV0LnRhcmdldFZhbHVlKVxuICBpZiAoaW5wdXQubWV0cmljICE9IG51bGwgJiYgaW5wdXQubWV0cmljICE9PSAnY291bnQnICYmIGlucHV0Lm1ldHJpYyAhPT0gJ2R1cmF0aW9uJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdtZXRyaWMgbXVzdCBiZSBjb3VudCBvciBkdXJhdGlvbicpXG4gIH1cbiAgaWYgKGlucHV0LnN0YXR1cyAhPSBudWxsKSB7XG4gICAgY29uc3QgYWxsb3dlZCA9IFsnYWN0aXZlJywgJ3BhdXNlZCcsICdjb21wbGV0ZWQnLCAnYXJjaGl2ZWQnLCAnZmFpbGVkJ11cbiAgICBpZiAoIWFsbG93ZWQuaW5jbHVkZXMoaW5wdXQuc3RhdHVzKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYGludmFsaWQgc3RhdHVzOiAke2lucHV0LnN0YXR1c31gKVxuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGxpbmtzID0gaW5wdXQubGlua3MgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVHb2FsTGlua3MoaW5wdXQubGlua3MsIHJ1bGVUeXBlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IGRlcGVuZGVuY2llcyA9IGlucHV0LmRlcGVuZGVuY2llcyAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoaW5wdXQuZGVwZW5kZW5jaWVzLCBydWxlVHlwZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCByZWN1cnJlbmNlID0gaW5wdXQucmVjdXJyZW5jZSAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxSZWN1cnJlbmNlKGlucHV0LnJlY3VycmVuY2UpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgZGVhZGxpbmUgPSBpbnB1dC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxEZWFkbGluZShpbnB1dC5kZWFkbGluZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBzdGFydHNBdCA9IGlucHV0LnN0YXJ0c0F0ICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlU3RhcnRzQXQoaW5wdXQuc3RhcnRzQXQsIG5vdylcbiAgICA6IHVuZGVmaW5lZFxuXG4gIHJldHVybiB7IHJ1bGVUeXBlLCBsaW5rcywgZGVwZW5kZW5jaWVzLCByZWN1cnJlbmNlLCBkZWFkbGluZSwgc3RhcnRzQXQgfVxufVxuXG4vKipcbiAqIERldGVjdHMgd2hldGhlciBhZGRpbmcgZWRnZXMgd291bGQgY3JlYXRlIGEgY3ljbGUgaW4gdGhlIGRlcGVuZGVuY3kgREFHLlxuICogYGVkZ2VzYCBpcyB0aGUgZnVsbCBhZGphY2VuY3kgbGlzdCBhZnRlciB0aGUgcHJvcG9zZWQgY2hhbmdlIChnb2FsSWQgLT4gZGVwcykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3b3VsZENyZWF0ZURlcGVuZGVuY3lDeWNsZShcbiAgZWRnZXM6IE1hcDxudW1iZXIsIG51bWJlcltdPixcbiAgc3RhcnRJZDogbnVtYmVyLFxuKTogYm9vbGVhbiB7XG4gIGNvbnN0IHZpc2l0aW5nID0gbmV3IFNldDxudW1iZXI+KClcbiAgY29uc3QgdmlzaXRlZCA9IG5ldyBTZXQ8bnVtYmVyPigpXG5cbiAgZnVuY3Rpb24gZGZzKG5vZGU6IG51bWJlcik6IGJvb2xlYW4ge1xuICAgIGlmICh2aXNpdGluZy5oYXMobm9kZSkpIHJldHVybiB0cnVlXG4gICAgaWYgKHZpc2l0ZWQuaGFzKG5vZGUpKSByZXR1cm4gZmFsc2VcbiAgICB2aXNpdGluZy5hZGQobm9kZSlcbiAgICBmb3IgKGNvbnN0IG5leHQgb2YgZWRnZXMuZ2V0KG5vZGUpID8/IFtdKSB7XG4gICAgICBpZiAoZGZzKG5leHQpKSByZXR1cm4gdHJ1ZVxuICAgIH1cbiAgICB2aXNpdGluZy5kZWxldGUobm9kZSlcbiAgICB2aXNpdGVkLmFkZChub2RlKVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgcmV0dXJuIGRmcyhzdGFydElkKVxufVxuIiwgIi8qKiBQb3N0Z3JlcyBgbnVtZXJpY2AgYXJyaXZlcyBhcyBzdHJpbmcgdmlhIGBwZ2A7IEdyYXBoUUwgTnVtYmVyIHJlcXVpcmVzIEpTIG51bWJlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlcih2YWx1ZTogdW5rbm93biwgZmFsbGJhY2sgPSAwKTogbnVtYmVyIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBmYWxsYmFja1xuICBjb25zdCBuID0gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyA/IHZhbHVlIDogTnVtYmVyKHZhbHVlKVxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IGZhbGxiYWNrXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBhc051bWJlck9yTnVsbCh2YWx1ZTogdW5rbm93bik6IG51bWJlciB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgY29uc3QgbiA9IHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgPyB2YWx1ZSA6IE51bWJlcih2YWx1ZSlcbiAgcmV0dXJuIE51bWJlci5pc0Zpbml0ZShuKSA/IG4gOiBudWxsXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB7IGdldENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuaW1wb3J0IHsgZGIgfSBmcm9tICcuLi8uLi9kYi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwgYXMgR29hbFJvdyxcbiAgR29hbENvbmZpZyxcbiAgR29hbEN5Y2xlIGFzIEdvYWxDeWNsZVJvdyxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsRGVwZW5kZW5jeSBhcyBHb2FsRGVwZW5kZW5jeVJvdyxcbiAgR29hbExpbmsgYXMgR29hbExpbmtSb3csXG4gIEdvYWxQcm9ncmVzc1NuYXBzaG90IGFzIEdvYWxTbmFwc2hvdFJvdyxcbiAgR29hbFJlY3VycmVuY2VDb25maWcsXG4gIE5ld0dvYWwsXG4gIE5ld0dvYWxEZXBlbmRlbmN5LFxuICBOZXdHb2FsTGluayxcbn0gZnJvbSAnLi4vLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuaW1wb3J0IHsgY3JlYXRlSW5pdGlhbEN5Y2xlLCBkZWFkbGluZVN0YXRlLCBsaWZlY3ljbGVQaGFzZSwgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlLCByb2xsT3ZlcklmTmVlZGVkLCByb2xsT3ZlclVzZXJHb2FscyB9IGZyb20gJy4uLy4uL2dvYWxzL2N5Y2xlcy50cydcbmltcG9ydCB7IGJ1aWxkR29hbE51ZGdlcyB9IGZyb20gJy4uLy4uL2dvYWxzL251ZGdlcy50cydcbmltcG9ydCB7IHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcywgcmVjb21wdXRlQ3ljbGUgfSBmcm9tICcuLi8uLi9nb2Fscy9wcm9ncmVzcy50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVwZW5kZW5jeUlucHV0LFxuICBHb2FsTGlua0lucHV0LFxuICBVcGRhdGVHb2FsSW5wdXQsXG59IGZyb20gJy4uL3R5cGVzLnRzJ1xuaW1wb3J0IHtcbiAgYXNzZXJ0RGVhZGxpbmVBZnRlclN0YXJ0LFxuICBJbnZhbGlkR29hbEVycm9yLFxuICB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dCxcbiAgdmFsaWRhdGVHb2FsQ29sb3IsXG4gIHZhbGlkYXRlR29hbFRpdGxlLFxuICB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dCxcbiAgd291bGRDcmVhdGVEZXBlbmRlbmN5Q3ljbGUsXG59IGZyb20gJy4uL3ZhbGlkYXRpb24udHMnXG5pbXBvcnQgeyBhc051bWJlciwgYXNOdW1iZXJPck51bGwgfSBmcm9tICcuLi9udW1lcmljLnRzJ1xuXG5mdW5jdGlvbiByZXF1aXJlVXNlcklkKCk6IG51bWJlciB7XG4gIGNvbnN0IHVzZXJJZCA9IGdldENvbnRleHQoKS5nZXQoJ3VzZXJJZCcpXG4gIGlmICh0eXBlb2YgdXNlcklkICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBFcnJvcignVW5hdXRoZW50aWNhdGVkJylcbiAgfVxuICByZXR1cm4gdXNlcklkXG59XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBUXG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cbiAgfVxuICByZXR1cm4gdmFsdWUgYXMgVFxufVxuXG4vKiogUG9zdGdyZXMgYG51bWVyaWNgIGFycml2ZXMgYXMgc3RyaW5nIHZpYSBgcGdgOyBHcmFwaFFMIE51bWJlciByZXF1aXJlcyBKUyBudW1iZXIuICovXG5mdW5jdGlvbiBtYXBDeWNsZVNjYWxhcnM8VCBleHRlbmRzIEdvYWxDeWNsZVJvdz4oY3ljbGU6IFQpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5jeWNsZSxcbiAgICB0YXJnZXRfdmFsdWU6IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSksXG4gICAgY3VycmVudF92YWx1ZTogYXNOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgY2Fycnlfb3ZlcjogYXNOdW1iZXIoY3ljbGUuY2Fycnlfb3ZlciksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwTGlua1NjYWxhcnMobGluazogR29hbExpbmtSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5saW5rLFxuICAgIHdlaWdodDogYXNOdW1iZXIobGluay53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcDogR29hbERlcGVuZGVuY3lSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5kZXAsXG4gICAgdGhyZXNob2xkOiBhc051bWJlck9yTnVsbChkZXAudGhyZXNob2xkKSxcbiAgICB3ZWlnaHQ6IGFzTnVtYmVyKGRlcC53ZWlnaHQsIDEpLFxuICB9XG59XG5cbmZ1bmN0aW9uIG1hcFNuYXBzaG90U2NhbGFycyhzbmFwc2hvdDogR29hbFNuYXBzaG90Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uc25hcHNob3QsXG4gICAgdmFsdWU6IGFzTnVtYmVyKHNuYXBzaG90LnZhbHVlKSxcbiAgfVxufVxuXG5mdW5jdGlvbiB0b1JlY3VycmVuY2VKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydyZWN1cnJlbmNlJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ3JlY3VycmVuY2UnXSxcbik6IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIHBlcmlvZDogaW5wdXQucGVyaW9kLFxuICAgIGludGVydmFsOiBpbnB1dC5pbnRlcnZhbCxcbiAgICBhbmNob3I6IGlucHV0LmFuY2hvcixcbiAgICBjYXJyeV9vdmVyOiBpbnB1dC5jYXJyeU92ZXIsXG4gICAgcmVzZXQ6IGlucHV0LnJlc2V0LFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvRGVhZGxpbmVKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0WydkZWFkbGluZSddIHwgVXBkYXRlR29hbElucHV0WydkZWFkbGluZSddLFxuKTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCB7XG4gIGlmIChpbnB1dCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICByZXR1cm4ge1xuICAgIGtpbmQ6IGlucHV0LmtpbmQsXG4gICAgZGF0ZTogaW5wdXQuZGF0ZSxcbiAgICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBpbnB1dC5kYXlzQWZ0ZXJDeWNsZVN0YXJ0LFxuICAgIGdyYWNlX2RheXM6IGlucHV0LmdyYWNlRGF5cyxcbiAgICB3YXJuX2RheXM6IGlucHV0Lndhcm5EYXlzLFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvQ29uZmlnSnNvbihcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dFsnY29uZmlnJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ2NvbmZpZyddLFxuKTogR29hbENvbmZpZyB7XG4gIGlmICghaW5wdXQpIHJldHVybiB7fVxuICByZXR1cm4ge1xuICAgIGNvbXBvc2l0ZV9tb2RlOiBpbnB1dC5jb21wb3NpdGVNb2RlLFxuICAgIGNvdW50X3JlcXVpcmVkOiBpbnB1dC5jb3VudFJlcXVpcmVkLFxuICAgIGJlZm9yZV90aW1lOiBpbnB1dC5iZWZvcmVUaW1lLFxuICAgIGFmdGVyX3RpbWU6IGlucHV0LmFmdGVyVGltZSxcbiAgICBibG9ja191bnRpbF91bmxvY2tlZDogaW5wdXQuYmxvY2tVbnRpbFVubG9ja2VkLFxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkQWN0aXZpdGllcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBhY3Rpdml0eUlkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGFjdGl2aXR5SWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdpZCcsICdpbicsIGFjdGl2aXR5SWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gYWN0aXZpdHlJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGFjdGl2aXRpZXMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEdyb3VwcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBncm91cElkczogbnVtYmVyW10sXG4pIHtcbiAgaWYgKGdyb3VwSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ3JvdXBzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ3JvdXBJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBncm91cElkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgZ3JvdXBzIG5vdCBmb3VuZCcpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRHb2FscyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIHVzZXJJZDogbnVtYmVyLFxuICBnb2FsSWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoZ29hbElkcy5sZW5ndGggPT09IDApIHJldHVyblxuICBjb25zdCByb3dzID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgZ29hbElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGdvYWxJZHMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ29uZSBvciBtb3JlIGRlcGVuZGVuY3kgZ29hbHMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXBsYWNlTGlua3MoXG4gIHRyeDogVHJhbnNhY3Rpb248RGF0YWJhc2U+LFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGxpbmtzOiBHb2FsTGlua0lucHV0W10sXG4pIHtcbiAgYXdhaXQgdHJ4LmRlbGV0ZUZyb20oJ2dvYWxfbGlua3MnKS53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKS5leGVjdXRlKClcbiAgY29uc3QgYWN0aXZpdHlJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdhY3Rpdml0eScgJiYgbC5hY3Rpdml0eUlkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5hY3Rpdml0eUlkISlcbiAgY29uc3QgZ3JvdXBJZHMgPSBsaW5rc1xuICAgIC5maWx0ZXIoKGwpID0+IGwubGlua1R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cElkICE9IG51bGwpXG4gICAgLm1hcCgobCkgPT4gbC5ncm91cElkISlcbiAgYXdhaXQgYXNzZXJ0T3duZWRBY3Rpdml0aWVzKHRyeCwgdXNlcklkLCBhY3Rpdml0eUlkcylcbiAgYXdhaXQgYXNzZXJ0T3duZWRHcm91cHModHJ4LCB1c2VySWQsIGdyb3VwSWRzKVxuXG4gIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xuICAgIGF3YWl0IHRyeFxuICAgICAgLmluc2VydEludG8oJ2dvYWxfbGlua3MnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgbGlua190eXBlOiBsaW5rLmxpbmtUeXBlLFxuICAgICAgICBhY3Rpdml0eV9pZDogbGluay5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5JyA/IGxpbmsuYWN0aXZpdHlJZCA/PyBudWxsIDogbnVsbCxcbiAgICAgICAgZ3JvdXBfaWQ6IGxpbmsubGlua1R5cGUgPT09ICdncm91cCcgPyBsaW5rLmdyb3VwSWQgPz8gbnVsbCA6IG51bGwsXG4gICAgICAgIHdlaWdodDogbGluay53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbExpbmspXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gcmVwbGFjZURlcGVuZGVuY2llcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbiAgZGVwczogR29hbERlcGVuZGVuY3lJbnB1dFtdLFxuKSB7XG4gIGNvbnN0IGRlcElkcyA9IGRlcHMubWFwKChkKSA9PiBkLmRlcGVuZHNPbkdvYWxJZClcbiAgaWYgKGRlcElkcy5pbmNsdWRlcyhnb2FsSWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2EgZ29hbCBjYW5ub3QgZGVwZW5kIG9uIGl0c2VsZicpXG4gIH1cbiAgYXdhaXQgYXNzZXJ0T3duZWRHb2Fscyh0cngsIHVzZXJJZCwgZGVwSWRzKVxuXG4gIC8vIEJ1aWxkIGFkamFjZW5jeSBmcm9tIGFsbCBleGlzdGluZyBkZXBzIGZvciB0aGlzIHVzZXIsIHJlcGxhY2luZyB0aGlzIGdvYWwncyBlZGdlcy5cbiAgY29uc3QgYWxsR29hbHMgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgdHJ4XG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJylcbiAgICAud2hlcmUoJ2dvYWxzLnVzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAuc2VsZWN0KFtcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5nb2FsX2lkJyxcbiAgICAgICdnb2FsX2RlcGVuZGVuY2llcy5kZXBlbmRzX29uX2dvYWxfaWQnLFxuICAgIF0pXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGNvbnN0IGVkZ2VzID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcltdPigpXG4gIGZvciAoY29uc3QgZyBvZiBhbGxHb2FscykgZWRnZXMuc2V0KGcuaWQsIFtdKVxuICBmb3IgKGNvbnN0IGUgb2YgZXhpc3RpbmcpIHtcbiAgICBpZiAoZS5nb2FsX2lkID09PSBnb2FsSWQpIGNvbnRpbnVlXG4gICAgZWRnZXMuZ2V0KGUuZ29hbF9pZCk/LnB1c2goZS5kZXBlbmRzX29uX2dvYWxfaWQpXG4gIH1cbiAgZWRnZXMuc2V0KGdvYWxJZCwgZGVwSWRzKVxuXG4gIGlmICh3b3VsZENyZWF0ZURlcGVuZGVuY3lDeWNsZShlZGdlcywgZ29hbElkKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdkZXBlbmRlbmN5IGN5Y2xlIGRldGVjdGVkJylcbiAgfVxuXG4gIGF3YWl0IHRyeC5kZWxldGVGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpLmV4ZWN1dGUoKVxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgLnZhbHVlcyh7XG4gICAgICAgIGdvYWxfaWQ6IGdvYWxJZCxcbiAgICAgICAgZGVwZW5kc19vbl9nb2FsX2lkOiBkZXAuZGVwZW5kc09uR29hbElkLFxuICAgICAgICByZXF1aXJlbWVudDogZGVwLnJlcXVpcmVtZW50ID8/ICdjb21wbGV0ZScsXG4gICAgICAgIHRocmVzaG9sZDogZGVwLnRocmVzaG9sZCA/PyBudWxsLFxuICAgICAgICB3ZWlnaHQ6IGRlcC53ZWlnaHQgPz8gMSxcbiAgICAgIH0gYXMgTmV3R29hbERlcGVuZGVuY3kpXG4gICAgICAuZXhlY3V0ZSgpXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZGVwZW5kZW5jaWVzTWV0KFxuICBnb2FsSWQ6IG51bWJlcixcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgZGVwcyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChkZXBzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWVcblxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgY29uc3QgY2hpbGRHb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWNoaWxkR29hbCkgcmV0dXJuIGZhbHNlXG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgcmV0dXJuIGZhbHNlXG5cbiAgICBpZiAoZGVwLnJlcXVpcmVtZW50ID09PSAnY29tcGxldGUnKSB7XG4gICAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgICBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDAgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoXG4gICAgICAgIGN5Y2xlLnN0YXR1cyAhPT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgY2hpbGRHb2FsLnN0YXR1cyAhPT0gJ2NvbXBsZXRlZCcgJiZcbiAgICAgICAgIXRhcmdldE1ldFxuICAgICAgKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBjb25zdCB0aHJlc2hvbGQgPSBkZXAudGhyZXNob2xkID8/IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBpZiAoTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpIDwgTnVtYmVyKHRocmVzaG9sZCkpIHJldHVybiBmYWxzZVxuICAgIH1cbiAgfVxuICByZXR1cm4gdHJ1ZVxufVxuXG5mdW5jdGlvbiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsOiBHb2FsUm93KSB7XG4gIGNvbnN0IGNvbmZpZyA9IHBhcnNlSnNvbjxHb2FsQ29uZmlnPihnb2FsLmNvbmZpZykgPz8ge31cbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcblxuICByZXR1cm4ge1xuICAgIC4uLmdvYWwsXG4gICAgdGFyZ2V0X3ZhbHVlOiBhc051bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgc3RhcnRzQXQ6IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KS50b0lTT1N0cmluZygpLFxuICAgIGxpZmVjeWNsZVBoYXNlOiBsaWZlY3ljbGVQaGFzZShnb2FsLCBub3cpLFxuICAgIGNvbmZpZyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIGxpbmtzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfbGlua3MnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAoKGxpbmspID0+ICh7XG4gICAgICAgIC4uLm1hcExpbmtTY2FsYXJzKGxpbmspLFxuICAgICAgICBhY3Rpdml0eTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChsaW5rLmFjdGl2aXR5X2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdGllcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmFjdGl2aXR5X2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgICAgZ3JvdXA6IGFzeW5jICgpID0+IHtcbiAgICAgICAgICBpZiAobGluay5ncm91cF9pZCA9PSBudWxsKSByZXR1cm4gbnVsbFxuICAgICAgICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dyb3VwcycpXG4gICAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBsaW5rLmdyb3VwX2lkKVxuICAgICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpID8/IG51bGxcbiAgICAgICAgfSxcbiAgICAgIH0pKVxuICAgIH0sXG4gICAgYWN0aXZlQ3ljbGU6IGFzeW5jICgpID0+IHtcbiAgICAgIGxldCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoY3ljbGUgJiYgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnKSB7XG4gICAgICAgIGN5Y2xlID0gYXdhaXQgcm9sbE92ZXJJZk5lZWRlZChkYiwgZ29hbCwgY3ljbGUpXG4gICAgICB9XG4gICAgICAvLyBGYWxsIGJhY2sgdG8gbGF0ZXN0IGN5Y2xlIHNvIGNvbXBsZXRlZCAvIG1pZC13aW5kb3cgc3VjY2VlZGVkIGN5Y2xlc1xuICAgICAgLy8gc3RpbGwgZXhwb3NlIHByb2dyZXNzLiBBbHNvIHJlcGFpciByZWN1cnJpbmcgY3ljbGVzIHRoYXQgd2VyZSBjbG9zZWRcbiAgICAgIC8vIGVhcmx5IChiZWZvcmUgZW5kc19hdCkgc28gdGhleSByZW1haW4gdGhlIGFjdGl2ZSB3aW5kb3cuXG4gICAgICBpZiAoIWN5Y2xlKSB7XG4gICAgICAgIGNvbnN0IGxhdGVzdCA9IGF3YWl0IGRiXG4gICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgaWYgKFxuICAgICAgICAgIGxhdGVzdCAmJlxuICAgICAgICAgIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJyAmJlxuICAgICAgICAgIGdvYWwucmVjdXJyZW5jZSAhPSBudWxsICYmXG4gICAgICAgICAgbGF0ZXN0LnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgJiZcbiAgICAgICAgICAoIWxhdGVzdC5lbmRzX2F0IHx8IG5vdyA8IG5ldyBEYXRlKGxhdGVzdC5lbmRzX2F0KSlcbiAgICAgICAgKSB7XG4gICAgICAgICAgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgICAgICAuc2V0KHsgc3RhdHVzOiAnYWN0aXZlJywgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxhdGVzdC5pZClcbiAgICAgICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBjeWNsZSA9IGxhdGVzdFxuICAgICAgICB9XG4gICAgICB9XG4gICAgICBpZiAoIWN5Y2xlKSByZXR1cm4gbnVsbFxuICAgICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSlcbiAgICAgIGNvbnN0IHRhcmdldCA9IGFzTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGNvbnN0IGN1cnJlbnQgPSBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKVxuICAgICAgcmV0dXJuIHtcbiAgICAgICAgLi4ubWFwQ3ljbGVTY2FsYXJzKGN5Y2xlKSxcbiAgICAgICAgZGVhZGxpbmVTdGF0ZTogc3RhdGUsXG4gICAgICAgIHBlcmNlbnRDb21wbGV0ZTogdGFyZ2V0ID4gMCA/IE1hdGgubWluKDEsIGN1cnJlbnQgLyB0YXJnZXQpIDogMCxcbiAgICAgICAgcmVtYWluaW5nOiBNYXRoLm1heCgwLCB0YXJnZXQgLSBjdXJyZW50KSxcbiAgICAgIH1cbiAgICB9LFxuICAgIGN5Y2xlczogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2FzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAobWFwQ3ljbGVTY2FsYXJzKVxuICAgIH0sXG4gICAgZGVwZW5kZW5jaWVzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKChkZXApID0+ICh7XG4gICAgICAgIC4uLm1hcERlcGVuZGVuY3lTY2FsYXJzKGRlcCksXG4gICAgICAgIGRlcGVuZHNPbjogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGNvbnN0IGcgPSBhd2FpdCBkYlxuICAgICAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgICAgICByZXR1cm4gZyA/IHdpdGhHb2FsUmVsYXRpb25zKGcpIDogbnVsbFxuICAgICAgICB9LFxuICAgICAgfSkpXG4gICAgfSxcbiAgICBzbmFwc2hvdHM6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghY3ljbGUpIHJldHVybiBbXVxuICAgICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX3Byb2dyZXNzX3NuYXBzaG90cycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9jeWNsZV9pZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5vcmRlckJ5KCdhc19vZicsICdhc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGUoKVxuICAgICAgcmV0dXJuIHJvd3MubWFwKG1hcFNuYXBzaG90U2NhbGFycylcbiAgICB9LFxuICAgIGlzTG9ja2VkOiBhc3luYyAoKSA9PiB7XG4gICAgICBpZiAoIWNvbmZpZy5ibG9ja191bnRpbF91bmxvY2tlZCkgcmV0dXJuIGZhbHNlXG4gICAgICByZXR1cm4gIShhd2FpdCBkZXBlbmRlbmNpZXNNZXQoZ29hbC5pZCwgZ29hbC51c2VyX2lkKSlcbiAgICB9LFxuICB9XG59XG5cbmV4cG9ydCBjb25zdCBHb2FsUXVlcnkgPSB7XG4gIGdvYWxzOiBhc3luYyAoYXJncz86IHsgc3RhdHVzPzogc3RyaW5nIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuXG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KCdwcmlvcml0eScsICdkZXNjJylcbiAgICAgIC5vcmRlckJ5KCdzb3J0X29yZGVyJywgJ2FzYycpXG4gICAgICAub3JkZXJCeSgnaWQnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcblxuICAgIGlmIChhcmdzPy5zdGF0dXMpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ3N0YXR1cycsICc9JywgYXJncy5zdGF0dXMgYXMgR29hbFJvd1snc3RhdHVzJ10pXG4gICAgfVxuXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKVxuICAgIHJldHVybiByb3dzLm1hcCh3aXRoR29hbFJlbGF0aW9ucylcbiAgfSxcblxuICBnb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgcmV0dXJuIHJvdyA/IHdpdGhHb2FsUmVsYXRpb25zKHJvdykgOiBudWxsXG4gIH0sXG5cbiAgZ29hbE51ZGdlczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3NcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBhd2FpdCByb2xsT3ZlclVzZXJHb2FscyhkYiwgdXNlcklkKVxuICAgIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgcGFpcnMgPSBbXVxuICAgIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgcGFpcnMucHVzaCh7IGdvYWwsIGN5Y2xlOiBjeWNsZSA/PyBudWxsIH0pXG4gICAgfVxuICAgIHJldHVybiBidWlsZEdvYWxOdWRnZXMocGFpcnMpXG4gIH0sXG5cbiAgZGFpbHlQcm9ncmVzczogYXN5bmMgKGFyZ3M/OiB7IGRhdGU/OiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGRhdGUgPSBhcmdzPy5kYXRlID8/IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcblxuICAgIGNvbnN0IGNvbXBsZXRpb25zID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0eV9jb21wbGV0aW9ucycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnb2NjdXJyZW5jZV9kYXRlJywgJz0nLCBkYXRlKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCB0aW1lRXZlbnRzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2V2ZW50cycpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnbWV0cmljJywgJz0nLCAnZHVyYXRpb24nKVxuICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRhdGUpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IG1pbnV0ZXNUb2RheSA9IHRpbWVFdmVudHMucmVkdWNlKFxuICAgICAgKHN1bSwgZSkgPT4gc3VtICsgTnVtYmVyKGUuYW1vdW50KSxcbiAgICAgIDAsXG4gICAgKVxuXG4gICAgLy8gU3RyZWFrOiBjb25zZWN1dGl2ZSBkYXlzIGVuZGluZyB0b2RheSB3aXRoID49IDEgY29tcGxldGlvbi5cbiAgICBsZXQgc3RyZWFrID0gMFxuICAgIGNvbnN0IGN1cnNvciA9IG5ldyBEYXRlKGRhdGUgKyAnVDAwOjAwOjAwWicpXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCAzNjU7IGkrKykge1xuICAgICAgY29uc3QgZGF5ID0gY3Vyc29yLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG4gICAgICBjb25zdCByb3cgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnYWN0aXZpdHlfY29tcGxldGlvbnMnKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRheSlcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBpZiAoIXJvdykgYnJlYWtcbiAgICAgIHN0cmVhaysrXG4gICAgICBjdXJzb3Iuc2V0VVRDRGF0ZShjdXJzb3IuZ2V0VVRDRGF0ZSgpIC0gMSlcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgZGF0ZSxcbiAgICAgIGNvbXBsZXRlZENvdW50OiBjb21wbGV0aW9ucy5sZW5ndGgsXG4gICAgICBtaW51dGVzVG9kYXksXG4gICAgICBzdHJlYWtEYXlzOiBzdHJlYWssXG4gICAgICBjb21wbGV0aW9ucyxcbiAgICB9XG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBHb2FsTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDcmVhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKClcbiAgICBjb25zdCB2YWxpZGF0ZWQgPSB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChpbnB1dCwgbm93KVxuXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4KSA9PiB7XG4gICAgICBjb25zdCBjcmVhdGVkID0gYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKCdnb2FscycpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogdmFsaWRhdGVkLnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbiA/PyBudWxsLFxuICAgICAgICAgIGNvbG9yOiB2YWxpZGF0ZWQuY29sb3IsXG4gICAgICAgICAgaWNvbjogaW5wdXQuaWNvbiA/PyBudWxsLFxuICAgICAgICAgIHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlLFxuICAgICAgICAgIG1ldHJpYzogaW5wdXQubWV0cmljLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogdmFsaWRhdGVkLnRhcmdldFZhbHVlLFxuICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkodG9Db25maWdKc29uKGlucHV0LmNvbmZpZykpLFxuICAgICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgICAgcmVjdXJyZW5jZTogdmFsaWRhdGVkLnJlY3VycmVuY2VcbiAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b0RlYWRsaW5lSnNvbih2YWxpZGF0ZWQuZGVhZGxpbmUpKVxuICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgIHByaW9yaXR5OiBpbnB1dC5wcmlvcml0eSA/PyAwLFxuICAgICAgICAgIHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciA/PyAwLFxuICAgICAgICAgIHN0YXJ0c19hdDogdmFsaWRhdGVkLnN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0gYXMgTmV3R29hbClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICAgIGF3YWl0IHJlcGxhY2VMaW5rcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmxpbmtzKVxuICAgICAgYXdhaXQgcmVwbGFjZURlcGVuZGVuY2llcyh0cngsIGNyZWF0ZWQuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmRlcGVuZGVuY2llcylcbiAgICAgIGF3YWl0IGNyZWF0ZUluaXRpYWxDeWNsZSh0cngsIGNyZWF0ZWQsIG5vdylcbiAgICAgIHJldHVybiBjcmVhdGVkXG4gICAgfSlcblxuICAgIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKFxuICAgICAgZGIsXG4gICAgICBnb2FsLFxuICAgICAgKGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpKSxcbiAgICAgIG5vdyxcbiAgICApXG5cbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoXG4gICAgICBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCksXG4gICAgKVxuICB9LFxuXG4gIHVwZGF0ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVHb2FsSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICBjb25zdCBub3dEYXRlID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlVXBkYXRlR29hbElucHV0KFxuICAgICAgYXJncy5pbnB1dCxcbiAgICAgIGV4aXN0aW5nLnJ1bGVfdHlwZSxcbiAgICAgIG5vd0RhdGUsXG4gICAgKVxuICAgIGNvbnN0IGlucHV0ID0gYXJncy5pbnB1dFxuICAgIGNvbnN0IG5vdyA9IG5vd0RhdGUudG9JU09TdHJpbmcoKVxuXG4gICAgY29uc3QgYWN0aXZlQ3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZXhpc3RpbmcuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgIGxldCBuZXh0U3RhcnRzQXQ6IERhdGUgfCB1bmRlZmluZWRcbiAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChleGlzdGluZy5zdGF0dXMgPT09ICdjb21wbGV0ZWQnIHx8IGV4aXN0aW5nLnN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICAgJ2Nhbm5vdCBjaGFuZ2Ugc3RhcnRzQXQgb24gYSBjb21wbGV0ZWQgb3IgZmFpbGVkIGdvYWwnLFxuICAgICAgICApXG4gICAgICB9XG4gICAgICBpZiAodmFsaWRhdGVkLnN0YXJ0c0F0ID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3N0YXJ0c0F0IGNhbm5vdCBiZSBjbGVhcmVkOyBvbWl0IHRvIGxlYXZlIHVuY2hhbmdlZCcpXG4gICAgICB9XG4gICAgICBuZXh0U3RhcnRzQXQgPSB2YWxpZGF0ZWQuc3RhcnRzQXRcblxuICAgICAgY29uc3QgY2xvc2VkQ3ljbGVzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnIT0nLCAnYWN0aXZlJylcbiAgICAgICAgLnNlbGVjdCgnaWQnKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgICAgIC8vIEFmdGVyIGN5Y2xlIDAgaGFzIGNsb3NlZCwgc3RhcnQgaXMgZnJvemVuLlxuICAgICAgaWYgKGNsb3NlZEN5Y2xlcyAhPSBudWxsKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICdjYW5ub3QgY2hhbmdlIHN0YXJ0c0F0IGFmdGVyIHRoZSBmaXJzdCBjeWNsZSBoYXMgY2xvc2VkJyxcbiAgICAgICAgKVxuICAgICAgfVxuXG4gICAgICBjb25zdCBwcm9ncmVzc0JlZ3VuID1cbiAgICAgICAgYWN0aXZlQ3ljbGUgIT0gbnVsbCAmJiBOdW1iZXIoYWN0aXZlQ3ljbGUuY3VycmVudF92YWx1ZSkgPiAwXG5cbiAgICAgIGlmIChcbiAgICAgICAgcHJvZ3Jlc3NCZWd1biAmJlxuICAgICAgICBuZXh0U3RhcnRzQXQuZ2V0VGltZSgpID4gbmV3IERhdGUoZXhpc3Rpbmcuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgICAgICkge1xuICAgICAgICBpZiAoIWlucHV0LmNvbmZpcm1TdGFydHNBdENoYW5nZSkge1xuICAgICAgICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgICAgICAgJ21vdmluZyBzdGFydHNBdCBsYXRlciBhZnRlciBwcm9ncmVzcyByZXF1aXJlcyBjb25maXJtU3RhcnRzQXRDaGFuZ2UnLFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGNvbnN0IGVmZmVjdGl2ZVN0YXJ0c0F0ID0gbmV4dFN0YXJ0c0F0ID8/IG5ldyBEYXRlKGV4aXN0aW5nLnN0YXJ0c19hdClcbiAgICBjb25zdCBlZmZlY3RpdmVEZWFkbGluZSA9IHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgOiAoKCkgPT4ge1xuICAgICAgICBjb25zdCBkID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZXhpc3RpbmcuZGVhZGxpbmUpXG4gICAgICAgIGlmICghZCkgcmV0dXJuIG51bGxcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBraW5kOiBkLmtpbmQsXG4gICAgICAgICAgZGF0ZTogZC5kYXRlLFxuICAgICAgICAgIGRheXNBZnRlckN5Y2xlU3RhcnQ6IGQuZGF5c19hZnRlcl9jeWNsZV9zdGFydCxcbiAgICAgICAgICBncmFjZURheXM6IGQuZ3JhY2VfZGF5cyxcbiAgICAgICAgICB3YXJuRGF5czogZC53YXJuX2RheXMsXG4gICAgICAgIH1cbiAgICAgIH0pKClcbiAgICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoZWZmZWN0aXZlU3RhcnRzQXQsIGVmZmVjdGl2ZURlYWRsaW5lKVxuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgLi4uKGlucHV0LnRpdGxlICE9IG51bGxcbiAgICAgICAgICAgID8geyB0aXRsZTogdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5kZXNjcmlwdGlvbiAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHsgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5jb2xvciAhPSBudWxsXG4gICAgICAgICAgICA/IHsgY29sb3I6IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuaWNvbiAhPT0gdW5kZWZpbmVkID8geyBpY29uOiBpbnB1dC5pY29uIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnJ1bGVUeXBlICE9IG51bGwgPyB7IHJ1bGVfdHlwZTogdmFsaWRhdGVkLnJ1bGVUeXBlIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0Lm1ldHJpYyAhPSBudWxsID8geyBtZXRyaWM6IGlucHV0Lm1ldHJpYyB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsXG4gICAgICAgICAgICA/IHsgdGFyZ2V0X3ZhbHVlOiBpbnB1dC50YXJnZXRWYWx1ZSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuY29uZmlnICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBjb25maWc6IEpTT04uc3RyaW5naWZ5KHRvQ29uZmlnSnNvbihpbnB1dC5jb25maWcpKSB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc3RhdHVzICE9IG51bGwgPyB7IHN0YXR1czogaW5wdXQuc3RhdHVzIH0gOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICByZWN1cnJlbmNlOiB2YWxpZGF0ZWQucmVjdXJyZW5jZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9SZWN1cnJlbmNlSnNvbih2YWxpZGF0ZWQucmVjdXJyZW5jZSkpXG4gICAgICAgICAgICAgICAgOiBudWxsLFxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKHZhbGlkYXRlZC5kZWFkbGluZSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgICA/IHtcbiAgICAgICAgICAgICAgZGVhZGxpbmU6IHZhbGlkYXRlZC5kZWFkbGluZVxuICAgICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkodG9EZWFkbGluZUpzb24odmFsaWRhdGVkLmRlYWRsaW5lKSlcbiAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4obmV4dFN0YXJ0c0F0ICE9IG51bGxcbiAgICAgICAgICAgID8geyBzdGFydHNfYXQ6IG5leHRTdGFydHNBdC50b0lTT1N0cmluZygpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5wcmlvcml0eSAhPSBudWxsID8geyBwcmlvcml0eTogaW5wdXQucHJpb3JpdHkgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQuc29ydE9yZGVyICE9IG51bGwgPyB7IHNvcnRfb3JkZXI6IGlucHV0LnNvcnRPcmRlciB9IDoge30pLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAgIC5leGVjdXRlKClcblxuICAgICAgaWYgKHZhbGlkYXRlZC5saW5rcykge1xuICAgICAgICBhd2FpdCByZXBsYWNlTGlua3ModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5saW5rcylcbiAgICAgIH1cbiAgICAgIGlmICh2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKSB7XG4gICAgICAgIGF3YWl0IHJlcGxhY2VEZXBlbmRlbmNpZXModHJ4LCBhcmdzLmlkLCB1c2VySWQsIHZhbGlkYXRlZC5kZXBlbmRlbmNpZXMpXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGdvYWxBZnRlciA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgaWYgKGN5Y2xlICYmIG5leHRTdGFydHNBdCAhPSBudWxsKSB7XG4gICAgICAgIGF3YWl0IHJlc2NoZWR1bGVBY3RpdmVDeWNsZSh0cngsIGdvYWxBZnRlciwgY3ljbGUsIG5leHRTdGFydHNBdCwgbm93RGF0ZSlcbiAgICAgIH0gZWxzZSBpZiAoY3ljbGUgJiYgaW5wdXQudGFyZ2V0VmFsdWUgIT0gbnVsbCkge1xuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAuc2V0KHtcbiAgICAgICAgICAgIHRhcmdldF92YWx1ZTogaW5wdXQudGFyZ2V0VmFsdWUsXG4gICAgICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICAgICAgfSlcbiAgICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICB9IGVsc2UgaWYgKFxuICAgICAgICBjeWNsZSAmJlxuICAgICAgICAodmFsaWRhdGVkLmRlYWRsaW5lICE9PSB1bmRlZmluZWQgfHwgdmFsaWRhdGVkLnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZCkgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID09PSAwICYmXG4gICAgICAgIGN5Y2xlLmN5Y2xlX2luZGV4ID09PSAwXG4gICAgICApIHtcbiAgICAgICAgLy8gUmVmcmVzaCBib3VuZHMgb24gdW5zdGFydGVkIGN5Y2xlIDAgd2hlbiBkZWFkbGluZS9yZWN1cnJlbmNlIGNoYW5nZS5cbiAgICAgICAgYXdhaXQgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICAgICAgICAgIHRyeCxcbiAgICAgICAgICBnb2FsQWZ0ZXIsXG4gICAgICAgICAgY3ljbGUsXG4gICAgICAgICAgbmV3IERhdGUoZ29hbEFmdGVyLnN0YXJ0c19hdCksXG4gICAgICAgICAgbm93RGF0ZSxcbiAgICAgICAgKVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoY3ljbGUpIGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSwgbm93RGF0ZSlcblxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIHBhdXNlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZ29hbCA9IGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdwYXVzZWQnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICByZXN1bWVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FjdGl2ZScsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdwYXVzZWQnKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIGFyY2hpdmVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ2FyY2hpdmVkJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgZGVsZXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwXG4gIH0sXG5cbiAgcmVjb21wdXRlR29hbFByb2dyZXNzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJnc1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGNvdW50ID0gYXdhaXQgcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzKGRiLCB1c2VySWQpXG4gICAgcmV0dXJuIHsgcmVjb21wdXRlZDogY291bnQgfVxuICB9LFxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSdcbmltcG9ydCB0eXBlIHtcbiAgRGF0YWJhc2UsXG4gIEdvYWwsXG4gIEdvYWxDeWNsZSxcbiAgR29hbERlYWRsaW5lQ29uZmlnLFxuICBHb2FsUmVjdXJyZW5jZUNvbmZpZyxcbiAgTmV3R29hbEN5Y2xlLFxufSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjeWNsZUhhc1N0YXJ0ZWQgfSBmcm9tICcuL2xpZmVjeWNsZS50cydcbmltcG9ydCB7IHJlY29tcHV0ZUN5Y2xlIH0gZnJvbSAnLi9wcm9ncmVzcy50cydcblxuZXhwb3J0IHtcbiAgY3ljbGVIYXNTdGFydGVkLFxuICBsaWZlY3ljbGVQaGFzZSxcbiAgdHlwZSBHb2FsTGlmZWN5Y2xlUGhhc2UsXG59IGZyb20gJy4vbGlmZWN5Y2xlLnRzJ1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT5cblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBUXG59XG5cbmZ1bmN0aW9uIGFkZERheXMoZGF0ZTogRGF0ZSwgZGF5czogbnVtYmVyKTogRGF0ZSB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShkYXRlKVxuICBkLnNldFVUQ0RhdGUoZC5nZXRVVENEYXRlKCkgKyBkYXlzKVxuICByZXR1cm4gZFxufVxuXG5mdW5jdGlvbiBhZGRNb250aHMoZGF0ZTogRGF0ZSwgbW9udGhzOiBudW1iZXIpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGRhdGUpXG4gIGQuc2V0VVRDTW9udGgoZC5nZXRVVENNb250aCgpICsgbW9udGhzKVxuICByZXR1cm4gZFxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZUN5Y2xlRW5kKFxuICBzdGFydHNBdDogRGF0ZSxcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuKTogRGF0ZSB8IG51bGwge1xuICBpZiAoIXJlY3VycmVuY2UpIHJldHVybiBudWxsXG4gIGNvbnN0IGludGVydmFsID0gTWF0aC5tYXgoMSwgcmVjdXJyZW5jZS5pbnRlcnZhbCA/PyAxKVxuICBzd2l0Y2ggKHJlY3VycmVuY2UucGVyaW9kKSB7XG4gICAgY2FzZSAnd2Vla2x5JzpcbiAgICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCA3ICogaW50ZXJ2YWwpXG4gICAgY2FzZSAnbW9udGhseSc6XG4gICAgICByZXR1cm4gYWRkTW9udGhzKHN0YXJ0c0F0LCBpbnRlcnZhbClcbiAgICBjYXNlICdxdWFydGVybHknOlxuICAgICAgcmV0dXJuIGFkZE1vbnRocyhzdGFydHNBdCwgMyAqIGludGVydmFsKVxuICAgIGNhc2UgJ2V2ZXJ5X3hfZGF5cyc6XG4gICAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgaW50ZXJ2YWwpXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVEZWFkbGluZUF0KFxuICBzdGFydHNBdDogRGF0ZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4pOiBEYXRlIHwgbnVsbCB7XG4gIGlmICghZGVhZGxpbmUpIHJldHVybiBudWxsXG4gIGlmIChkZWFkbGluZS5raW5kID09PSAnYWJzb2x1dGUnICYmIGRlYWRsaW5lLmRhdGUpIHtcbiAgICByZXR1cm4gbmV3IERhdGUoZGVhZGxpbmUuZGF0ZSArICdUMjM6NTk6NTkuOTk5WicpXG4gIH1cbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScgJiYgZGVhZGxpbmUuZGF5c19hZnRlcl9jeWNsZV9zdGFydCAhPSBudWxsKSB7XG4gICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIGRlYWRsaW5lLmRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQpXG4gIH1cbiAgcmV0dXJuIG51bGxcbn1cblxuZXhwb3J0IHR5cGUgRGVhZGxpbmVTdGF0ZSA9ICdvbl90cmFjaycgfCAnYXBwcm9hY2hpbmcnIHwgJ292ZXJkdWUnIHwgJ2ZhaWxlZCdcblxuZXhwb3J0IGZ1bmN0aW9uIGRlYWRsaW5lU3RhdGUoXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogRGVhZGxpbmVTdGF0ZSB7XG4gIGlmICghY3ljbGUuZGVhZGxpbmVfYXQpIHJldHVybiAnb25fdHJhY2snXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBuZXcgRGF0ZShjeWNsZS5kZWFkbGluZV9hdClcbiAgY29uc3QgZ3JhY2UgPSBkZWFkbGluZT8uZ3JhY2VfZGF5cyA/PyAwXG4gIGNvbnN0IHdhcm4gPSBkZWFkbGluZT8ud2Fybl9kYXlzID8/IDNcbiAgY29uc3QgZ3JhY2VFbmQgPSBhZGREYXlzKGRlYWRsaW5lQXQsIGdyYWNlKVxuXG4gIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpIHtcbiAgICByZXR1cm4gJ29uX3RyYWNrJ1xuICB9XG4gIGlmIChub3cgPiBncmFjZUVuZCkgcmV0dXJuICdmYWlsZWQnXG4gIGlmIChub3cgPiBkZWFkbGluZUF0KSByZXR1cm4gJ292ZXJkdWUnXG4gIGNvbnN0IHdhcm5TdGFydCA9IGFkZERheXMoZGVhZGxpbmVBdCwgLXdhcm4pXG4gIGlmIChub3cgPj0gd2FyblN0YXJ0KSByZXR1cm4gJ2FwcHJvYWNoaW5nJ1xuICByZXR1cm4gJ29uX3RyYWNrJ1xufVxuXG5mdW5jdGlvbiBkYXRlT25seUlzbyhkYXRlOiBEYXRlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGRhdGUudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbn1cblxuYXN5bmMgZnVuY3Rpb24gd3JpdGVTbmFwc2hvdChcbiAgZGI6IERiTGlrZSxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgYXNPZjogRGF0ZSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBhc09mU3RyID0gZGF0ZU9ubHlJc28oYXNPZilcbiAgYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygnZ29hbF9wcm9ncmVzc19zbmFwc2hvdHMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZ29hbF9jeWNsZV9pZDogY3ljbGUuaWQsXG4gICAgICBhc19vZjogYXNPZlN0cixcbiAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgfSlcbiAgICAub25Db25mbGljdCgob2MpID0+XG4gICAgICBvYy5jb2x1bW5zKFsnZ29hbF9jeWNsZV9pZCcsICdhc19vZiddKS5kb1VwZGF0ZVNldCh7XG4gICAgICAgIHZhbHVlOiBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSksXG4gICAgICB9KVxuICAgIClcbiAgICAuZXhlY3V0ZSgpXG59XG5cbi8qKlxuICogQ3JlYXRlIHRoZSBmaXJzdCBjeWNsZSBmb3IgYSBuZXdseSBjcmVhdGVkIGdvYWwuXG4gKiBVc2VzIGdvYWwuc3RhcnRzX2F0IGFzIHRoZSBjeWNsZSB3aW5kb3cgc3RhcnQgKG5vdCB3YWxsLWNsb2NrIG5vdykuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjcmVhdGVJbml0aWFsQ3ljbGUoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgY29uc3QgZW5kc0F0ID0gY29tcHV0ZUN5Y2xlRW5kKHN0YXJ0c0F0LCByZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZUF0ID0gY29tcHV0ZURlYWRsaW5lQXQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgY3ljbGVfaW5kZXg6IDAsXG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgIGNhcnJ5X292ZXI6IDAsXG4gICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogUmV3cml0ZSBhbiBhY3RpdmUgY3ljbGUncyB3aW5kb3cgZnJvbSBhIG5ldyBzdGFydHNfYXQgKGFuZCBvcHRpb25hbFxuICogdXBkYXRlZCBnb2FsIHJlY3VycmVuY2UvZGVhZGxpbmUvdGFyZ2V0KS4gVXNlZCB3aGVuIGVkaXRpbmcgc3RhcnQgZGF0ZVxuICogYmVmb3JlIHByb2dyZXNzIC8gd2hlbiByZXNjaGVkdWxpbmcgYW4gdW5zdGFydGVkIGN5Y2xlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKFxuICBkYjogRGJMaWtlLFxuICBnb2FsOiBHb2FsLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBzdGFydHNBdDogRGF0ZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBlbmRzQXQgPSBjb21wdXRlQ3ljbGVFbmQoc3RhcnRzQXQsIHJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBjb21wdXRlRGVhZGxpbmVBdChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnVwZGF0ZVRhYmxlKCdnb2FsX2N5Y2xlcycpXG4gICAgLnNldCh7XG4gICAgICBzdGFydHNfYXQ6IHN0YXJ0c0F0LnRvSVNPU3RyaW5nKCksXG4gICAgICBlbmRzX2F0OiBlbmRzQXQgPyBlbmRzQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICBkZWFkbGluZV9hdDogZGVhZGxpbmVBdCA/IGRlYWRsaW5lQXQudG9JU09TdHJpbmcoKSA6IG51bGwsXG4gICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG5cbi8qKlxuICogQ2xvc2UgYW4gYWN0aXZlIGN5Y2xlIGFuZCBvcGVuIHRoZSBuZXh0IG9uZSB3aGVuIHJlY3VycmVuY2UgYXBwbGllcy5cbiAqIFVzZXMgbGF6eS1vbi1yZWFkOiBjYWxsIGJlZm9yZSByZXR1cm5pbmcgZ29hbHMgdG8gdGhlIGNsaWVudC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJvbGxPdmVySWZOZWVkZWQoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICAvLyBEbyBub3Qgcm9sbCBvdmVyLCBtaXNzLWJhY2tmaWxsLCBvciBmYWlsIGRlYWRsaW5lcyBiZWZvcmUgdGhlIGN5Y2xlIHN0YXJ0cy5cbiAgaWYgKCFjeWNsZUhhc1N0YXJ0ZWQoY3ljbGUsIG5vdykpIHtcbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgaWYgKCFyZWN1cnJlbmNlIHx8ICFjeWNsZS5lbmRzX2F0KSB7XG4gICAgLy8gT25lLXRpbWU6IG1heWJlIGZhaWwgb24gZGVhZGxpbmUgZ3JhY2UuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICAgIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjeWNsZSwgZGVhZGxpbmUsIG5vdylcbiAgICBpZiAoY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJiBzdGF0ZSA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgc3RhdHVzOiAnZmFpbGVkJyxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSlcbiAgICAgICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgZGJcbiAgICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAgIC5zZXQoeyBzdGF0dXM6ICdmYWlsZWQnLCB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCB1cGRhdGVkLCBub3cpXG4gICAgICByZXR1cm4gdXBkYXRlZFxuICAgIH1cbiAgICByZXR1cm4gY3ljbGVcbiAgfVxuXG4gIGlmIChjeWNsZS5zdGF0dXMgIT09ICdhY3RpdmUnKSByZXR1cm4gY3ljbGVcbiAgaWYgKG5vdyA8IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpKSByZXR1cm4gY3ljbGVcblxuICAvLyBSZWNvbXB1dGUgb25lIGxhc3QgdGltZSBiZWZvcmUgY2xvc2luZy5cbiAgbGV0IGNsb3NlZCA9IGF3YWl0IHJlY29tcHV0ZUN5Y2xlKGRiLCBnb2FsLCBjeWNsZSlcbiAgY29uc3QgbWV0ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY2xvc2VkLCBkZWFkbGluZSwgbmV3IERhdGUoY3ljbGUuZW5kc19hdCkpXG5cbiAgbGV0IGNsb3NlU3RhdHVzOiBHb2FsQ3ljbGVbJ3N0YXR1cyddID0gbWV0XG4gICAgPyAnc3VjY2VlZGVkJ1xuICAgIDogc3RhdGUgPT09ICdmYWlsZWQnIHx8IHN0YXRlID09PSAnb3ZlcmR1ZSdcbiAgICA/ICdmYWlsZWQnXG4gICAgOiAnbWlzc2VkJ1xuXG4gIC8vIEJhY2stZmlsbCBtaXNzZWQgaW50ZXJtZWRpYXRlIGN5Y2xlcyBpZiB3ZSBza2lwcGVkIG11bHRpcGxlIHdpbmRvd3MuXG4gIGxldCBjdXJzb3JTdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdClcbiAgbGV0IGN1cnNvckVuZCA9IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpXG4gIGxldCBjeWNsZUluZGV4ID0gY3ljbGUuY3ljbGVfaW5kZXhcbiAgbGV0IGNhcnJ5ID0gMFxuXG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5X292ZXIgPT09ICdvdmVyZmxvdycgJiZcbiAgICBOdW1iZXIoY2xvc2VkLmN1cnJlbnRfdmFsdWUpID4gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gICkge1xuICAgIGNhcnJ5ID0gTnVtYmVyKGNsb3NlZC5jdXJyZW50X3ZhbHVlKSAtIE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICB9XG5cbiAgY2xvc2VkID0gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIHN0YXR1czogY2xvc2VTdGF0dXMsXG4gICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICB9KVxuICAgIC53aGVyZSgnaWQnLCAnPScsIGNsb3NlZC5pZClcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICBhd2FpdCB3cml0ZVNuYXBzaG90KGRiLCBjbG9zZWQsIGN1cnNvckVuZClcblxuICAvLyBGaWxsIGdhcHMgdW50aWwgd2UgcmVhY2ggYSBjeWNsZSB0aGF0IGNvbnRhaW5zIGBub3dgLlxuICB3aGlsZSAoY3Vyc29yRW5kIDw9IG5vdykge1xuICAgIGNvbnN0IG5leHRTdGFydCA9IGN1cnNvckVuZFxuICAgIGNvbnN0IG5leHRFbmQgPSBjb21wdXRlQ3ljbGVFbmQobmV4dFN0YXJ0LCByZWN1cnJlbmNlKVxuICAgIGlmICghbmV4dEVuZCkgYnJlYWtcblxuICAgIGN5Y2xlSW5kZXggKz0gMVxuXG4gICAgLy8gSWYgdGhpcyBpbnRlcm1lZGlhdGUgd2luZG93IGlzIGFscmVhZHkgZnVsbHkgaW4gdGhlIHBhc3QsIG1hcmsgbWlzc2VkLlxuICAgIGlmIChuZXh0RW5kIDw9IG5vdykge1xuICAgICAgY29uc3QgbWlzc2VkRGVhZGxpbmUgPSBjb21wdXRlRGVhZGxpbmVBdChuZXh0U3RhcnQsIGRlYWRsaW5lKVxuICAgICAgY29uc3QgbWlzc2VkID0gYXdhaXQgZGJcbiAgICAgICAgLmluc2VydEludG8oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgZ29hbF9pZDogZ29hbC5pZCxcbiAgICAgICAgICBjeWNsZV9pbmRleDogY3ljbGVJbmRleCxcbiAgICAgICAgICBzdGFydHNfYXQ6IG5leHRTdGFydC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGVuZHNfYXQ6IG5leHRFbmQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBkZWFkbGluZV9hdDogbWlzc2VkRGVhZGxpbmUgPyBtaXNzZWREZWFkbGluZS50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICAgICAgY3VycmVudF92YWx1ZTogMCxcbiAgICAgICAgICBzdGF0dXM6ICdtaXNzZWQnLFxuICAgICAgICAgIGNhcnJ5X292ZXI6IDAsXG4gICAgICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0gYXMgTmV3R29hbEN5Y2xlKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICAgIGF3YWl0IHdyaXRlU25hcHNob3QoZGIsIG1pc3NlZCwgbmV4dEVuZClcbiAgICAgIGN1cnNvclN0YXJ0ID0gbmV4dFN0YXJ0XG4gICAgICBjdXJzb3JFbmQgPSBuZXh0RW5kXG4gICAgICBjYXJyeSA9IDBcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgLy8gQWN0aXZlIG5leHQgY3ljbGUuXG4gICAgY29uc3QgbmV4dERlYWRsaW5lID0gY29tcHV0ZURlYWRsaW5lQXQobmV4dFN0YXJ0LCBkZWFkbGluZSlcbiAgICBjb25zdCBuZXh0ID0gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2N5Y2xlcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgZ29hbF9pZDogZ29hbC5pZCxcbiAgICAgICAgY3ljbGVfaW5kZXg6IGN5Y2xlSW5kZXgsXG4gICAgICAgIHN0YXJ0c19hdDogbmV4dFN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIGVuZHNfYXQ6IG5leHRFbmQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgZGVhZGxpbmVfYXQ6IG5leHREZWFkbGluZSA/IG5leHREZWFkbGluZS50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgICAgdGFyZ2V0X3ZhbHVlOiBOdW1iZXIoZ29hbC50YXJnZXRfdmFsdWUpLFxuICAgICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgICBjYXJyeV9vdmVyOiBjYXJyeSxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgfSBhcyBOZXdHb2FsQ3ljbGUpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG5cbiAgICByZXR1cm4gYXdhaXQgcmVjb21wdXRlQ3ljbGUoZGIsIGdvYWwsIG5leHQpXG4gIH1cblxuICByZXR1cm4gY2xvc2VkXG59XG5cbi8qKiBSb2xsIG92ZXIgYWxsIGFjdGl2ZSBjeWNsZXMgZm9yIGEgdXNlciAobGF6eSBiYXRjaCkuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcm9sbE92ZXJVc2VyR29hbHMoXG4gIGRiOiBEYkxpa2UsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGdvYWxzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnc3RhdHVzJywgJ2luJywgWydhY3RpdmUnLCAncGF1c2VkJ10pXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKVxuXG4gIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgIGlmIChnb2FsLnN0YXR1cyA9PT0gJ3BhdXNlZCcpIGNvbnRpbnVlXG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghY3ljbGUpIGNvbnRpbnVlXG4gICAgYXdhaXQgcm9sbE92ZXJJZk5lZWRlZChkYiwgZ29hbCwgY3ljbGUsIG5vdylcbiAgfVxufVxuIiwgImltcG9ydCB0eXBlIHsgR29hbCwgR29hbEN5Y2xlLCBHb2FsRGVhZGxpbmVDb25maWcgfSBmcm9tICcuLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBkZWFkbGluZVN0YXRlIH0gZnJvbSAnLi9jeWNsZXMudHMnXG5cbmV4cG9ydCB0eXBlIEdvYWxOdWRnZUtpbmQgPVxuICB8ICdkZWFkbGluZV9hcHByb2FjaGluZydcbiAgfCAnZGVhZGxpbmVfb3ZlcmR1ZSdcbiAgfCAnYmVoaW5kX3BhY2UnXG4gIHwgJ2N5Y2xlX2NvbXBsZXRlJ1xuICB8ICdkZXBlbmRlbmN5X3VubG9ja2VkJ1xuICB8ICdnb2FsX3N0YXJ0aW5nX3Nvb24nXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbE51ZGdlIHtcbiAga2luZDogR29hbE51ZGdlS2luZFxuICBnb2FsSWQ6IG51bWJlclxuICB0aXRsZTogc3RyaW5nXG4gIG1lc3NhZ2U6IHN0cmluZ1xuICBzZXZlcml0eTogJ2luZm8nIHwgJ3dhcm5pbmcnIHwgJ3N1Y2Nlc3MnXG59XG5cbmZ1bmN0aW9uIHBhcnNlRGVhZGxpbmUodmFsdWU6IHVua25vd24pOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBKU09OLnBhcnNlKHZhbHVlKSBhcyBHb2FsRGVhZGxpbmVDb25maWdcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBHb2FsRGVhZGxpbmVDb25maWdcbn1cblxuY29uc3QgU1RBUlRJTkdfU09PTl9EQVlTID0gM1xuXG4vKipcbiAqIEJ1aWxkIGluLWFwcCBudWRnZXMgZm9yIGRhc2hib2FyZCAvIG5vdGlmaWNhdGlvbnMgc3VyZmFjZS5cbiAqIFB1cmUgZnVuY3Rpb24gXHUyMDE0IG5vIEkvTy5cbiAqIFNraXBzIGRlYWRsaW5lL2JlaGluZF9wYWNlIGZvciBnb2FscyB0aGF0IGhhdmUgbm90IHN0YXJ0ZWQgeWV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRHb2FsTnVkZ2VzKFxuICBnb2FsczogQXJyYXk8eyBnb2FsOiBHb2FsOyBjeWNsZTogR29hbEN5Y2xlIHwgbnVsbCB9PixcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IEdvYWxOdWRnZVtdIHtcbiAgY29uc3QgbnVkZ2VzOiBHb2FsTnVkZ2VbXSA9IFtdXG5cbiAgZm9yIChjb25zdCB7IGdvYWwsIGN5Y2xlIH0gb2YgZ29hbHMpIHtcbiAgICBpZiAoIWN5Y2xlIHx8IGdvYWwuc3RhdHVzICE9PSAnYWN0aXZlJykgY29udGludWVcblxuICAgIGNvbnN0IHN0YXJ0c0F0ID0gbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpXG4gICAgaWYgKHN0YXJ0c0F0ID4gbm93KSB7XG4gICAgICBjb25zdCBtc1VudGlsID0gc3RhcnRzQXQuZ2V0VGltZSgpIC0gbm93LmdldFRpbWUoKVxuICAgICAgY29uc3QgZGF5c1VudGlsID0gbXNVbnRpbCAvICgyNCAqIDYwICogNjAgKiAxMDAwKVxuICAgICAgaWYgKGRheXNVbnRpbCA8PSBTVEFSVElOR19TT09OX0RBWVMpIHtcbiAgICAgICAgY29uc3QgZGF5c0xhYmVsID0gTWF0aC5tYXgoMSwgTWF0aC5jZWlsKGRheXNVbnRpbCkpXG4gICAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZ29hbF9zdGFydGluZ19zb29uJyxcbiAgICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgICAgbWVzc2FnZTogYFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgc3RhcnRzIGluICR7ZGF5c0xhYmVsfSBkYXkke1xuICAgICAgICAgICAgZGF5c0xhYmVsID09PSAxID8gJycgOiAncydcbiAgICAgICAgICB9LmAsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgdGFyZ2V0TWV0ID1cbiAgICAgIGN5Y2xlLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgfHxcbiAgICAgIChOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDAgJiZcbiAgICAgICAgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgIGlmICh0YXJnZXRNZXQpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2N5Y2xlX2NvbXBsZXRlJyxcbiAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgbWVzc2FnZTogYFlvdSBjb21wbGV0ZWQgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBmb3IgdGhpcyBjeWNsZS5gLFxuICAgICAgICBzZXZlcml0eTogJ3N1Y2Nlc3MnLFxuICAgICAgfSlcbiAgICAgIGNvbnRpbnVlXG4gICAgfVxuXG4gICAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZURlYWRsaW5lKGdvYWwuZGVhZGxpbmUpXG4gICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSwgbm93KVxuICAgIGlmIChzdGF0ZSA9PT0gJ2FwcHJvYWNoaW5nJykge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVhZGxpbmVfYXBwcm9hY2hpbmcnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgRGVhZGxpbmUgZm9yIFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgaXMgYXBwcm9hY2hpbmcuYCxcbiAgICAgICAgc2V2ZXJpdHk6ICd3YXJuaW5nJyxcbiAgICAgIH0pXG4gICAgfSBlbHNlIGlmIChzdGF0ZSA9PT0gJ292ZXJkdWUnKSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdkZWFkbGluZV9vdmVyZHVlJyxcbiAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgbWVzc2FnZTogYFx1MjAxQyR7Z29hbC50aXRsZX1cdTIwMUQgaXMgcGFzdCBpdHMgZGVhZGxpbmUuYCxcbiAgICAgICAgc2V2ZXJpdHk6ICd3YXJuaW5nJyxcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gQmVoaW5kLXBhY2UgZm9yIHJlY3VycmluZyBjeWNsZXMgd2l0aCBhIGtub3duIGVuZC5cbiAgICBpZiAoY3ljbGUuZW5kc19hdCAmJiBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSA+IDApIHtcbiAgICAgIGNvbnN0IHN0YXJ0ID0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KS5nZXRUaW1lKClcbiAgICAgIGNvbnN0IGVuZCA9IG5ldyBEYXRlKGN5Y2xlLmVuZHNfYXQpLmdldFRpbWUoKVxuICAgICAgY29uc3Qgc3BhbiA9IE1hdGgubWF4KDEsIGVuZCAtIHN0YXJ0KVxuICAgICAgY29uc3QgZWxhcHNlZCA9IE1hdGgubWluKDEsIE1hdGgubWF4KDAsIChub3cuZ2V0VGltZSgpIC0gc3RhcnQpIC8gc3BhbikpXG4gICAgICBjb25zdCBleHBlY3RlZCA9IGVsYXBzZWQgKiBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgY29uc3QgYWN0dWFsID0gTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpXG4gICAgICBpZiAoZWxhcHNlZCA+PSAwLjM1ICYmIGFjdHVhbCA8IGV4cGVjdGVkICogMC43KSB7XG4gICAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnYmVoaW5kX3BhY2UnLFxuICAgICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBiZWhpbmQgcGFjZSB0aGlzIGN5Y2xlLmAsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdpbmZvJyxcbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gbnVkZ2VzXG59XG4iLCAiaW1wb3J0IHsgY3JlYXRlUmVtb3RlSldLU2V0LCBqd3RWZXJpZnkgfSBmcm9tICdqb3NlJ1xuaW1wb3J0IHR5cGUgeyBDb250ZXh0IH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcblxuLy8gUHlsb24gc2VydmVzIHRoZSBidWlsdCBhcHAgd2l0aCBCdW4vTm9kZSBcdTIwMTQgdXNlIHByb2Nlc3MuZW52LCBub3QgRGVuby5lbnYuXG5jb25zdCBBVVRIX0FQSV9ET01BSU4gPVxuICAodHlwZW9mIHByb2Nlc3MgIT09ICd1bmRlZmluZWQnICYmIHByb2Nlc3MuZW52Py5BVVRIX0FQSV9ET01BSU4pIHx8XG4gICdodHRwOi8vbG9jYWxob3N0OjMwMDEnXG5jb25zdCBKV0tTX1VSTCA9IGAke0FVVEhfQVBJX0RPTUFJTn0vYXV0aC9qd3Qvandrcy5qc29uYFxuXG5jb25zdCBqd2tzID0gY3JlYXRlUmVtb3RlSldLU2V0KG5ldyBVUkwoSldLU19VUkwpKVxuXG5leHBvcnQgdHlwZSBWZXJpZmllZEF1dGggPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gdmVyaWZ5QWNjZXNzVG9rZW4oXG4gIGF1dGhvcml6YXRpb25IZWFkZXI6IHN0cmluZyB8IHVuZGVmaW5lZCxcbik6IFByb21pc2U8VmVyaWZpZWRBdXRoIHwgbnVsbD4ge1xuICBpZiAoIWF1dGhvcml6YXRpb25IZWFkZXI/LnN0YXJ0c1dpdGgoJ0JlYXJlciAnKSkge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICBjb25zdCB0b2tlbiA9IGF1dGhvcml6YXRpb25IZWFkZXIuc2xpY2UoJ0JlYXJlciAnLmxlbmd0aCkudHJpbSgpXG4gIGlmICghdG9rZW4pIHtcbiAgICByZXR1cm4gbnVsbFxuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCB7IHBheWxvYWQgfSA9IGF3YWl0IGp3dFZlcmlmeSh0b2tlbiwgandrcywge1xuICAgICAgYWxnb3JpdGhtczogWydSUzI1NiddLFxuICAgIH0pXG5cbiAgICBjb25zdCBhdXRoVXNlcklkID0gdHlwZW9mIHBheWxvYWQuc3ViID09PSAnc3RyaW5nJyA/IHBheWxvYWQuc3ViIDogbnVsbFxuICAgIGlmICghYXV0aFVzZXJJZCkge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG5cbiAgICBjb25zdCBlbWFpbCA9XG4gICAgICB0eXBlb2YgcGF5bG9hZC5lbWFpbCA9PT0gJ3N0cmluZycgPyBwYXlsb2FkLmVtYWlsIDogdW5kZWZpbmVkXG5cbiAgICByZXR1cm4geyBhdXRoVXNlcklkLCBlbWFpbCB9XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsXG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHVuYXV0aG9yaXplZFJlc3BvbnNlKCk6IFJlc3BvbnNlIHtcbiAgcmV0dXJuIG5ldyBSZXNwb25zZShKU09OLnN0cmluZ2lmeSh7IGVycm9yOiAnVW5hdXRob3JpemVkJyB9KSwge1xuICAgIHN0YXR1czogNDAxLFxuICAgIGhlYWRlcnM6IHtcbiAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LUhlYWRlcnMnOlxuICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICB9LFxuICB9KVxufVxuXG4vKiogQ09SUyBwcmVmbGlnaHQgLyBzaW1wbGUgcmVzcG9uc2VzIGZvciBicm93c2VyIEdyYXBoUUwgY2xpZW50cy4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3JzTWlkZGxld2FyZShjdHg6IENvbnRleHQsIG5leHQ6ICgpID0+IFByb21pc2U8dm9pZD4pIHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICByZXR1cm4gbmV3IFJlc3BvbnNlKG51bGwsIHtcbiAgICAgIHN0YXR1czogMjA0LFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJzogJyonLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgICAgICAgJ0FjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiAnR0VULCBQT1NULCBPUFRJT05TJyxcbiAgICAgIH0sXG4gICAgfSlcbiAgfVxuXG4gIGF3YWl0IG5leHQoKVxuXG4gIGN0eC5yZXMuaGVhZGVycy5zZXQoJ0FjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbicsICcqJylcbiAgY3R4LnJlcy5oZWFkZXJzLnNldChcbiAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycycsXG4gICAgJ0NvbnRlbnQtVHlwZSwgQXV0aG9yaXphdGlvbiwgc3QtYXV0aC1tb2RlJyxcbiAgKVxufVxuIiwgImltcG9ydCB7IGRiIH0gZnJvbSAnLi9kYXRhYmFzZS50cydcbmltcG9ydCB0eXBlIHsgVXNlciB9IGZyb20gJy4vdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSBBdXRoSWRlbnRpdHkgPSB7XG4gIGF1dGhVc2VySWQ6IHN0cmluZ1xuICBlbWFpbD86IHN0cmluZ1xuICBuYW1lPzogc3RyaW5nXG59XG5cbi8qKlxuICogUmVzb2x2ZSAob3IgY3JlYXRlKSB0aGUgbG9jYWwgYHVzZXJzYCByb3cgZm9yIGEgU3VwZXJUb2tlbnMgaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNvbHZlTG9jYWxVc2VyKGlkZW50aXR5OiBBdXRoSWRlbnRpdHkpOiBQcm9taXNlPFVzZXI+IHtcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCd1c2VycycpXG4gICAgLndoZXJlKCdhdXRoX3VzZXJfaWQnLCAnPScsIGlkZW50aXR5LmF1dGhVc2VySWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gIGlmIChleGlzdGluZykge1xuICAgIHJldHVybiBleGlzdGluZ1xuICB9XG5cbiAgY29uc3QgZW1haWwgPVxuICAgIGlkZW50aXR5LmVtYWlsPy50cmltKCkgfHxcbiAgICBgJHtpZGVudGl0eS5hdXRoVXNlcklkfUB1c2Vycy5sb2NhbGBcbiAgY29uc3QgbmFtZSA9XG4gICAgaWRlbnRpdHkubmFtZT8udHJpbSgpIHx8XG4gICAgZW1haWwuc3BsaXQoJ0AnKVswXSB8fFxuICAgICdVc2VyJ1xuXG4gIC8vIFByZWZlciBsaW5raW5nIGFuIGV4aXN0aW5nIGVtYWlsIHJvdyAoZS5nLiBzZWVkZWQgZGV2IHVzZXIpIHdoZW4gcHJlc2VudC5cbiAgY29uc3QgYnlFbWFpbCA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2VtYWlsJywgJz0nLCBlbWFpbClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGJ5RW1haWwpIHtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgndXNlcnMnKVxuICAgICAgLnNldCh7XG4gICAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgICAgbmFtZTogYnlFbWFpbC5uYW1lIHx8IG5hbWUsXG4gICAgICAgIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSxcbiAgICAgIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBieUVtYWlsLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ3VzZXJzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGVtYWlsLFxuICAgICAgbmFtZSxcbiAgICAgIGF1dGhfdXNlcl9pZDogaWRlbnRpdHkuYXV0aFVzZXJJZCxcbiAgICAgIHBhc3N3b3JkX2hhc2g6IG51bGwsXG4gICAgfSlcbiAgICAucmV0dXJuaW5nQWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFBLFNBQVMsV0FBVzs7O0FDQXBCLE9BQStDO0FBQy9DLFNBQVMsY0FBQUEsbUJBQWtCOzs7QUNEM0IsT0FBMEU7OztBQ0MxRSxTQUFTLE1BQU0sYUFBYTtBQUM1QixTQUFTLFFBQVEsdUJBQXVCO0FBS3hDLE1BQU0sY0FBYyxNQUFNLFNBQVMsTUFB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
