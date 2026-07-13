// src/index.ts
import { app } from "@getcronit/pylon";

// src/graphql/resolvers/resolvers.ts
import "kysely";
import { getContext as getContext2 } from "@getcronit/pylon";

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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsiLi4vc3JjL2luZGV4LnRzIiwgIi4uL3NyYy9ncmFwaHFsL3Jlc29sdmVycy9yZXNvbHZlcnMudHMiLCAiLi4vc3JjL2RiL3R5cGVzL3NjaGVtYS50cyIsICIuLi9zcmMvZGIvZGF0YWJhc2UudHMiLCAiLi4vc3JjL2dvYWxzL2xpZmVjeWNsZS50cyIsICIuLi9zcmMvZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cyIsICIuLi9zcmMvZ29hbHMvcHJvZ3Jlc3MudHMiLCAiLi4vc3JjL2dyYXBocWwvZ3JvdXBfcGFsZXR0ZS50cyIsICIuLi9zcmMvZ3JhcGhxbC92YWxpZGF0aW9uLnRzIiwgIi4uL3NyYy9ncmFwaHFsL251bWVyaWMudHMiLCAiLi4vc3JjL2dyYXBocWwvcmVzb2x2ZXJzL2dvYWxzX3Jlc29sdmVycy50cyIsICIuLi9zcmMvZ29hbHMvY3ljbGVzLnRzIiwgIi4uL3NyYy9nb2Fscy9udWRnZXMudHMiLCAiLi4vc3JjL2F1dGgvdmVyaWZ5LnRzIiwgIi4uL3NyYy9kYi91c2Vycy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYXBwIH0gZnJvbSAnQGdldGNyb25pdC9weWxvbidcbmltcG9ydCB7IHJlc29sdmVycyB9IGZyb20gJy4vZ3JhcGhxbC9yZXNvbHZlcnMvcmVzb2x2ZXJzLnRzJ1xuaW1wb3J0IHtcbiAgY29yc01pZGRsZXdhcmUsXG4gIHVuYXV0aG9yaXplZFJlc3BvbnNlLFxuICB2ZXJpZnlBY2Nlc3NUb2tlbixcbn0gZnJvbSAnLi9hdXRoL3ZlcmlmeS50cydcbmltcG9ydCB7IHJlc29sdmVMb2NhbFVzZXIgfSBmcm9tICcuL2RiL3VzZXJzLnRzJ1xuXG5hcHAudXNlKGNvcnNNaWRkbGV3YXJlKVxuXG5hcHAudXNlKGFzeW5jIChjdHgsIG5leHQpID0+IHtcbiAgaWYgKGN0eC5yZXEubWV0aG9kID09PSAnT1BUSU9OUycpIHtcbiAgICBhd2FpdCBuZXh0KClcbiAgICByZXR1cm5cbiAgfVxuXG4gIGNvbnN0IHBhdGggPSBuZXcgVVJMKGN0eC5yZXEudXJsKS5wYXRobmFtZVxuICBpZiAocGF0aCAhPT0gJy9ncmFwaHFsJyAmJiAhcGF0aC5lbmRzV2l0aCgnL2dyYXBocWwnKSkge1xuICAgIGF3YWl0IG5leHQoKVxuICAgIHJldHVyblxuICB9XG5cbiAgY29uc3QgdmVyaWZpZWQgPSBhd2FpdCB2ZXJpZnlBY2Nlc3NUb2tlbihjdHgucmVxLmhlYWRlcignQXV0aG9yaXphdGlvbicpKVxuICBpZiAoIXZlcmlmaWVkKSB7XG4gICAgcmV0dXJuIHVuYXV0aG9yaXplZFJlc3BvbnNlKClcbiAgfVxuXG4gIGNvbnN0IGxvY2FsVXNlciA9IGF3YWl0IHJlc29sdmVMb2NhbFVzZXIoe1xuICAgIGF1dGhVc2VySWQ6IHZlcmlmaWVkLmF1dGhVc2VySWQsXG4gICAgZW1haWw6IHZlcmlmaWVkLmVtYWlsLFxuICB9KVxuXG4gIGN0eC5zZXQoJ2F1dGhVc2VySWQnLCB2ZXJpZmllZC5hdXRoVXNlcklkKVxuICBpZiAodmVyaWZpZWQuZW1haWwpIHtcbiAgICBjdHguc2V0KCdhdXRoRW1haWwnLCB2ZXJpZmllZC5lbWFpbClcbiAgfVxuICBjdHguc2V0KCd1c2VySWQnLCBsb2NhbFVzZXIuaWQpXG5cbiAgYXdhaXQgbmV4dCgpXG59KVxuXG5leHBvcnQgY29uc3QgZ3JhcGhxbCA9IHtcbiAgLi4ucmVzb2x2ZXJzLFxufVxuXG5leHBvcnQgZGVmYXVsdCBhcHBcblxuICAgICAgaW1wb3J0IHtoYW5kbGVyIGFzIF9faW50ZXJuYWxQeWxvbkhhbmRsZXJ9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCJcblxuICAgICAgbGV0IF9faW50ZXJuYWxQeWxvbkNvbmZpZyA9IHVuZGVmaW5lZFxuXG4gICAgICB0cnkge1xuICAgICAgICBfX2ludGVybmFsUHlsb25Db25maWcgPSBjb25maWdcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICAvLyBjb25maWcgaXMgbm90IGRlY2xhcmVkLCBweWxvbkNvbmZpZyByZW1haW5zIHVuZGVmaW5lZFxuICAgICAgfVxuXG4gICAgICBhcHAudXNlKF9faW50ZXJuYWxQeWxvbkhhbmRsZXIoe1xuICAgICAgICB0eXBlRGVmczogXCJpbnB1dCBBcmdzSW5wdXQge1xcblxcdHN0YXR1czogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMiB7XFxuXFx0ZGF0ZTogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8zIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzUge1xcblxcdGFjdGl2aXR5SWQ6IE51bWJlclxcblxcdGZyb21EYXRlOiBTdHJpbmdcXG5cXHR0b0RhdGU6IFN0cmluZ1xcbn1cXG5pbnB1dCBBcmdzSW5wdXRfNiB7XFxuXFx0aW5wdXQ6IENyZWF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDcmVhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0Y29sb3I6IFN0cmluZyFcXG5cXHRpY29uOiBTdHJpbmdcXG5cXHRydWxlVHlwZTogU3RyaW5nIVxcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dCFcXG5cXHR0YXJnZXRWYWx1ZTogTnVtYmVyIVxcblxcdGNvbmZpZzogR29hbENvbmZpZ0lucHV0SW5wdXRcXG5cXHRsaW5rczogW0dvYWxMaW5rSW5wdXRJbnB1dCFdXFxuXFx0ZGVwZW5kZW5jaWVzOiBbR29hbERlcGVuZGVuY3lJbnB1dElucHV0IV1cXG5cXHRyZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUlucHV0SW5wdXRcXG5cXHRkZWFkbGluZTogR29hbERlYWRsaW5lSW5wdXRJbnB1dFxcblxcdHN0YXJ0c0F0OiBTdHJpbmdcXG5cXHRwcmlvcml0eTogTnVtYmVyXFxuXFx0c29ydE9yZGVyOiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbENvbmZpZ0lucHV0SW5wdXQge1xcblxcdGNvbXBvc2l0ZU1vZGU6IEFMTF9BTllfV0VJR0hURURJbnB1dFxcblxcdGNvdW50UmVxdWlyZWQ6IE51bWJlclxcblxcdGJlZm9yZVRpbWU6IFN0cmluZ1xcblxcdGFmdGVyVGltZTogU3RyaW5nXFxuXFx0YmxvY2tVbnRpbFVubG9ja2VkOiBCb29sZWFuXFxufVxcbmlucHV0IEdvYWxMaW5rSW5wdXRJbnB1dCB7XFxuXFx0bGlua1R5cGU6IEFDVElWSVRZX0dST1VQSW5wdXQhXFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyXFxuXFx0Z3JvdXBJZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbERlcGVuZGVuY3lJbnB1dElucHV0IHtcXG5cXHRkZXBlbmRzT25Hb2FsSWQ6IE51bWJlciFcXG5cXHRyZXF1aXJlbWVudDogQ09NUExFVEVfUFJPR1JFU1NJbnB1dFxcblxcdHRocmVzaG9sZDogTnVtYmVyXFxuXFx0d2VpZ2h0OiBOdW1iZXJcXG59XFxuaW5wdXQgR29hbFJlY3VycmVuY2VJbnB1dElucHV0IHtcXG5cXHRwZXJpb2Q6IFdFRUtMWV9NT05USExZX1FVQVJURVJMWV9FVkVSWV9YX0RBWVNJbnB1dCFcXG5cXHRpbnRlcnZhbDogTnVtYmVyXFxuXFx0YW5jaG9yOiBTdHJpbmdcXG5cXHRjYXJyeU92ZXI6IE5PTkVfT1ZFUkZMT1dJbnB1dFxcblxcdHJlc2V0OiBTdHJpbmdcXG59XFxuaW5wdXQgR29hbERlYWRsaW5lSW5wdXRJbnB1dCB7XFxuXFx0a2luZDogQUJTT0xVVEVfUkVMQVRJVkVJbnB1dCFcXG5cXHRkYXRlOiBTdHJpbmdcXG5cXHRkYXlzQWZ0ZXJDeWNsZVN0YXJ0OiBOdW1iZXJcXG5cXHRncmFjZURheXM6IE51bWJlclxcblxcdHdhcm5EYXlzOiBOdW1iZXJcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzcge1xcblxcdGlkOiBOdW1iZXIhXFxuXFx0aW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHb2FsSW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRjb2xvcjogU3RyaW5nXFxuXFx0aWNvbjogU3RyaW5nXFxuXFx0cnVsZVR5cGU6IFN0cmluZ1xcblxcdG1ldHJpYzogQ09VTlRfRFVSQVRJT05JbnB1dFxcblxcdHRhcmdldFZhbHVlOiBOdW1iZXJcXG5cXHRjb25maWc6IEdvYWxDb25maWdJbnB1dElucHV0XFxuXFx0bGlua3M6IFtHb2FsTGlua0lucHV0SW5wdXQhXVxcblxcdGRlcGVuZGVuY2llczogW0dvYWxEZXBlbmRlbmN5SW5wdXRJbnB1dCFdXFxuXFx0cmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dElucHV0XFxuXFx0ZGVhZGxpbmU6IEdvYWxEZWFkbGluZUlucHV0SW5wdXRcXG5cXHRzdGFydHNBdDogU3RyaW5nXFxuXFx0Y29uZmlybVN0YXJ0c0F0Q2hhbmdlOiBCb29sZWFuXFxuXFx0c3RhdHVzOiBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dFxcblxcdHByaW9yaXR5OiBOdW1iZXJcXG5cXHRzb3J0T3JkZXI6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfOCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0Xzkge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMCB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzExIHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTIge1xcblxcdGlucHV0OiBDcmVhdGVHcm91cElucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUdyb3VwSW5wdXRJbnB1dCB7XFxuXFx0bmFtZTogU3RyaW5nIVxcblxcdGNvbG9yOiBTdHJpbmchXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xMyB7XFxuXFx0aWQ6IE51bWJlciFcXG5cXHRpbnB1dDogVXBkYXRlR3JvdXBJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBVcGRhdGVHcm91cElucHV0SW5wdXQge1xcblxcdG5hbWU6IFN0cmluZ1xcblxcdGNvbG9yOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE0IHtcXG5cXHRpZDogTnVtYmVyIVxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTUge1xcblxcdGlucHV0OiBDcmVhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IENyZWF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZyFcXG5cXHRkZXNjcmlwdGlvbjogU3RyaW5nXFxuXFx0c3RhcnRUaW1lOiBTdHJpbmchXFxuXFx0ZW5kVGltZTogU3RyaW5nIVxcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuIVxcblxcdGRhdGU6IFN0cmluZ1xcblxcdHJlY3VycmVuY2VQYXR0ZXJuOiBSZWN1cnJlbmNlUGF0dGVybklucHV0SW5wdXRcXG5cXHRncm91cElkOiBOdW1iZXJcXG59XFxuaW5wdXQgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dElucHV0IHtcXG5cXHRyZWN1cnJlbmNlVHlwZTogUmVjdXJyZW5jZVR5cGVJbnB1dCFcXG5cXHRjb25maWc6IFJlY3VycmVuY2VDb25maWdJbnB1dCFcXG59XFxuaW5wdXQgUmVjdXJyZW5jZUNvbmZpZ0lucHV0IHtcXG5cXHRkYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcblxcdGRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcblxcdGlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuXFx0aW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuXFx0c3RhcnRfZGF0ZTogU3RyaW5nIVxcblxcdGVuZF9kYXRlOiBTdHJpbmdcXG59XFxuaW5wdXQgQXJnc0lucHV0XzE2IHtcXG5cXHRpZDogTnVtYmVyIVxcblxcdGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0SW5wdXQhXFxufVxcbmlucHV0IFVwZGF0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0dGl0bGU6IFN0cmluZ1xcblxcdGRlc2NyaXB0aW9uOiBTdHJpbmdcXG5cXHRzdGFydFRpbWU6IFN0cmluZ1xcblxcdGVuZFRpbWU6IFN0cmluZ1xcblxcdGlzUmVjdXJyaW5nOiBCb29sZWFuXFxuXFx0ZGF0ZTogU3RyaW5nXFxuXFx0cmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXRJbnB1dFxcblxcdGdyb3VwSWQ6IE51bWJlclxcbn1cXG5pbnB1dCBBcmdzSW5wdXRfMTcge1xcblxcdGlkOiBOdW1iZXIhXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOCB7XFxuXFx0aW5wdXQ6IENvbXBsZXRlQWN0aXZpdHlJbnB1dElucHV0IVxcbn1cXG5pbnB1dCBDb21wbGV0ZUFjdGl2aXR5SW5wdXRJbnB1dCB7XFxuXFx0YWN0aXZpdHlJZDogTnVtYmVyIVxcblxcdG9jY3VycmVuY2VEYXRlOiBTdHJpbmchXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXJcXG5cXHRub3RlczogU3RyaW5nXFxufVxcbmlucHV0IEFyZ3NJbnB1dF8xOSB7XFxuXFx0aWQ6IE51bWJlciFcXG59XFxuaW5wdXQgQXJnc0lucHV0XzIwIHtcXG5cXHRpbnB1dDogTG9nVGltZUlucHV0SW5wdXQhXFxufVxcbmlucHV0IExvZ1RpbWVJbnB1dElucHV0IHtcXG5cXHRhY3Rpdml0eUlkOiBOdW1iZXIhXFxuXFx0ZHVyYXRpb25NaW51dGVzOiBOdW1iZXIhXFxuXFx0b2NjdXJyZW5jZURhdGU6IFN0cmluZ1xcblxcdG5vdGVzOiBTdHJpbmdcXG59XFxudHlwZSBRdWVyeSB7XFxuZ29hbHMoYXJnczogQXJnc0lucHV0KTogW0dvYWxzIV0hXFxuZ29hbChhcmdzOiBBcmdzSW5wdXRfMSEpOiBHb2Fsc1xcbmdvYWxOdWRnZXMoYXJnczogT2JqZWN0KTogW0dvYWxOdWRnZSFdIVxcbmRhaWx5UHJvZ3Jlc3MoYXJnczogQXJnc0lucHV0XzIpOiBEYWlseVByb2dyZXNzIVxcbmdyb3VwcyhhcmdzOiBPYmplY3QpOiBbR3JvdXBzIV0hXFxuZ3JvdXAoYXJnczogQXJnc0lucHV0XzMhKTogR3JvdXBzXFxuYWN0aXZpdGllcyhhcmdzOiBPYmplY3QpOiBbQWN0aXZpdGllcyFdIVxcbmFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF80ISk6IEFjdGl2aXRpZXNcXG5hY3Rpdml0eUNvbXBsZXRpb25zKGFyZ3M6IEFyZ3NJbnB1dF81KTogW0FjdGl2aXR5Q29tcGxldGlvbnMhXSFcXG59XFxudHlwZSBHb2FscyB7XFxudGFyZ2V0X3ZhbHVlOiBOdW1iZXIhXFxuc3RhcnRzQXQ6IFN0cmluZyFcXG5saWZlY3ljbGVQaGFzZTogR29hbExpZmVjeWNsZVBoYXNlIVxcbmNvbmZpZzogR29hbENvbmZpZyFcXG5yZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUNvbmZpZ1xcbmRlYWRsaW5lOiBHb2FsRGVhZGxpbmVDb25maWdcXG5saW5rczogW0xpbmtzIV0hXFxuYWN0aXZlQ3ljbGU6IEFjdGl2ZUN5Y2xlXFxuY3ljbGVzOiBbQ3ljbGVzQW5kQ3ljbGVzXzEhXSFcXG5kZXBlbmRlbmNpZXM6IFtEZXBlbmRlbmNpZXMhXSFcXG5zbmFwc2hvdHM6IFtTbmFwc2hvdHMhXSFcXG5pc0xvY2tlZDogQm9vbGVhbiFcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jb2xvcjogU3RyaW5nIVxcbmljb246IFN0cmluZ1xcbnJ1bGVfdHlwZTogU3RyaW5nIVxcbm1ldHJpYzogR29hbE1ldHJpYyFcXG5zdGF0dXM6IEdvYWxTdGF0dXMhXFxucHJpb3JpdHk6IE51bWJlciFcXG5zb3J0X29yZGVyOiBOdW1iZXIhXFxuc3RhcnRzX2F0OiBEYXRlIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG59XFxudHlwZSBHb2FsQ29uZmlnIHtcXG5jb21wb3NpdGVfbW9kZTogQUxMX0FOWV9XRUlHSFRFRFxcbmNvdW50X3JlcXVpcmVkOiBOdW1iZXJcXG5iZWZvcmVfdGltZTogU3RyaW5nXFxuYWZ0ZXJfdGltZTogU3RyaW5nXFxuYmxvY2tfdW50aWxfdW5sb2NrZWQ6IEJvb2xlYW5cXG59XFxudHlwZSBHb2FsUmVjdXJyZW5jZUNvbmZpZyB7XFxucGVyaW9kOiBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIVxcbmludGVydmFsOiBOdW1iZXJcXG5hbmNob3I6IFN0cmluZ1xcbmNhcnJ5X292ZXI6IE5PTkVfT1ZFUkZMT1dcXG5yZXNldDogU3RyaW5nXFxufVxcbnR5cGUgR29hbERlYWRsaW5lQ29uZmlnIHtcXG5raW5kOiBBQlNPTFVURV9SRUxBVElWRSFcXG5kYXRlOiBTdHJpbmdcXG5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0OiBOdW1iZXJcXG5ncmFjZV9kYXlzOiBOdW1iZXJcXG53YXJuX2RheXM6IE51bWJlclxcbn1cXG50eXBlIExpbmtzIHtcXG5hY3Rpdml0eTogQWN0aXZpdHlcXG5ncm91cDogR3JvdXBzXFxud2VpZ2h0OiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXJcXG5nb2FsX2lkOiBOdW1iZXIhXFxubGlua190eXBlOiBHb2FsTGlua1R5cGUhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbn1cXG50eXBlIEFjdGl2aXR5IHtcXG51c2VyX2lkOiBOdW1iZXIhXFxuaWQ6IE51bWJlciFcXG50aXRsZTogU3RyaW5nIVxcbmRlc2NyaXB0aW9uOiBTdHJpbmdcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuZ3JvdXBfaWQ6IE51bWJlclxcbnN0YXJ0X3RpbWU6IFN0cmluZyFcXG5lbmRfdGltZTogU3RyaW5nIVxcbmlzX3JlY3VycmluZzogQm9vbGVhbiFcXG5kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cHMge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNvbG9yOiBTdHJpbmchXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbm5hbWU6IFN0cmluZyFcXG59XFxudHlwZSBBY3RpdmVDeWNsZSB7XFxuZGVhZGxpbmVTdGF0ZTogRGVhZGxpbmVTdGF0ZSFcXG5wZXJjZW50Q29tcGxldGU6IE51bWJlciFcXG5yZW1haW5pbmc6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbnRhcmdldF92YWx1ZTogTnVtYmVyIVxcbnN0YXR1czogR29hbEN5Y2xlU3RhdHVzIVxcbnN0YXJ0c19hdDogRGF0ZSFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbmN5Y2xlX2luZGV4OiBOdW1iZXIhXFxuZW5kc19hdDogRGF0ZVxcbmRlYWRsaW5lX2F0OiBEYXRlXFxuY3VycmVudF92YWx1ZTogTnVtYmVyIVxcbmNhcnJ5X292ZXI6IE51bWJlciFcXG59XFxudHlwZSBDeWNsZXNBbmRDeWNsZXNfMSB7XFxuaWQ6IE51bWJlciFcXG50YXJnZXRfdmFsdWU6IE51bWJlciFcXG5zdGF0dXM6IEdvYWxDeWNsZVN0YXR1cyFcXG5zdGFydHNfYXQ6IERhdGUhXFxuY3JlYXRlZF9hdDogRGF0ZSFcXG51cGRhdGVkX2F0OiBEYXRlIVxcbmdvYWxfaWQ6IE51bWJlciFcXG5jeWNsZV9pbmRleDogTnVtYmVyIVxcbmVuZHNfYXQ6IERhdGVcXG5kZWFkbGluZV9hdDogRGF0ZVxcbmN1cnJlbnRfdmFsdWU6IE51bWJlciFcXG5jYXJyeV9vdmVyOiBOdW1iZXIhXFxufVxcbnR5cGUgRGVwZW5kZW5jaWVzIHtcXG5kZXBlbmRzT246IEdvYWxzXFxudGhyZXNob2xkOiBOdW1iZXJcXG53ZWlnaHQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9pZDogTnVtYmVyIVxcbmRlcGVuZHNfb25fZ29hbF9pZDogTnVtYmVyIVxcbnJlcXVpcmVtZW50OiBHb2FsRGVwZW5kZW5jeVJlcXVpcmVtZW50IVxcbn1cXG50eXBlIFNuYXBzaG90cyB7XFxudmFsdWU6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuZ29hbF9jeWNsZV9pZDogTnVtYmVyIVxcbmFzX29mOiBTdHJpbmchXFxufVxcbnR5cGUgR29hbE51ZGdlIHtcXG5raW5kOiBHb2FsTnVkZ2VLaW5kIVxcbmdvYWxJZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxubWVzc2FnZTogU3RyaW5nIVxcbnNldmVyaXR5OiBJTkZPX1dBUk5JTkdfU1VDQ0VTUyFcXG59XFxudHlwZSBEYWlseVByb2dyZXNzIHtcXG5kYXRlOiBTdHJpbmchXFxuY29tcGxldGVkQ291bnQ6IE51bWJlciFcXG5taW51dGVzVG9kYXk6IE51bWJlciFcXG5zdHJlYWtEYXlzOiBOdW1iZXIhXFxuY29tcGxldGlvbnM6IFtBY3Rpdml0eUNvbXBsZXRpb25zIV0hXFxufVxcbnR5cGUgQWN0aXZpdHlDb21wbGV0aW9ucyB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5vY2N1cnJlbmNlX2RhdGU6IFN0cmluZyFcXG5kdXJhdGlvbl9taW51dGVzOiBOdW1iZXJcXG5jb21wbGV0ZWRfYXQ6IERhdGUhXFxubWV0YWRhdGE6IE1ldGFkYXRhXFxufVxcbnR5cGUgTWV0YWRhdGEge1xcbnRpdGxlOiBTdHJpbmdcXG5ub3RlczogU3RyaW5nXFxudHJpZ2dlcl9ldmVudHM6IFtTdHJpbmchXVxcbn1cXG50eXBlIEFjdGl2aXRpZXMge1xcbnJlY3VycmVuY2VQYXR0ZXJuOiBQYXJzZWRSZWN1cnJlbmNlUGF0dGVyblxcbmdyb3VwOiBHcm91cFxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbnRpdGxlOiBTdHJpbmchXFxuZGVzY3JpcHRpb246IFN0cmluZ1xcbmNyZWF0ZWRfYXQ6IERhdGUhXFxudXBkYXRlZF9hdDogRGF0ZSFcXG5ncm91cF9pZDogTnVtYmVyXFxuc3RhcnRfdGltZTogU3RyaW5nIVxcbmVuZF90aW1lOiBTdHJpbmchXFxuaXNfcmVjdXJyaW5nOiBCb29sZWFuIVxcbmRhdGU6IFN0cmluZ1xcbn1cXG50eXBlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHtcXG5jb25maWc6IFJlY3VycmVuY2VDb25maWchXFxuaWQ6IE51bWJlciFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlciFcXG5yZWN1cnJlbmNlX3R5cGU6IFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyFcXG59XFxudHlwZSBSZWN1cnJlbmNlQ29uZmlnIHtcXG5kYXlzX29mX3dlZWs6IFtOdW1iZXIhXVxcbmRheXNfb2ZfbW9udGg6IFtOdW1iZXIhXVxcbmlzX2xhc3RfZGF5X29mX21vbnRoOiBCb29sZWFuXFxuaW50ZXJ2YWxfZGF5czogTnVtYmVyXFxuc3RhcnRfZGF0ZTogU3RyaW5nIVxcbmVuZF9kYXRlOiBTdHJpbmdcXG59XFxudHlwZSBHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxubmFtZTogU3RyaW5nIVxcbn1cXG50eXBlIE11dGF0aW9uIHtcXG5jcmVhdGVHb2FsKGFyZ3M6IEFyZ3NJbnB1dF82ISk6IEdvYWxzIVxcbnVwZGF0ZUdvYWwoYXJnczogQXJnc0lucHV0XzchKTogR29hbHMhXFxucGF1c2VHb2FsKGFyZ3M6IEFyZ3NJbnB1dF84ISk6IEdvYWxzIVxcbnJlc3VtZUdvYWwoYXJnczogQXJnc0lucHV0XzkhKTogR29hbHMhXFxuYXJjaGl2ZUdvYWwoYXJnczogQXJnc0lucHV0XzEwISk6IEdvYWxzIVxcbmRlbGV0ZUdvYWwoYXJnczogQXJnc0lucHV0XzExISk6IEJvb2xlYW4hXFxucmVjb21wdXRlR29hbFByb2dyZXNzKGFyZ3M6IE9iamVjdCk6IFJlY29tcHV0ZUdvYWxQcm9ncmVzcyFcXG5jcmVhdGVHcm91cChhcmdzOiBBcmdzSW5wdXRfMTIhKTogQ3JlYXRlR3JvdXAhXFxudXBkYXRlR3JvdXAoYXJnczogQXJnc0lucHV0XzEzISk6IENyZWF0ZUdyb3VwIVxcbmRlbGV0ZUdyb3VwKGFyZ3M6IEFyZ3NJbnB1dF8xNCEpOiBCb29sZWFuIVxcbmNyZWF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNSEpOiBBY3Rpdml0aWVzIVxcbnVwZGF0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNiEpOiBBY3Rpdml0aWVzIVxcbmRlbGV0ZUFjdGl2aXR5KGFyZ3M6IEFyZ3NJbnB1dF8xNyEpOiBCb29sZWFuIVxcbmNvbXBsZXRlQWN0aXZpdHkoYXJnczogQXJnc0lucHV0XzE4ISk6IENvbXBsZXRlQWN0aXZpdHkhXFxudW5kb0NvbXBsZXRpb24oYXJnczogQXJnc0lucHV0XzE5ISk6IEJvb2xlYW4hXFxubG9nVGltZShhcmdzOiBBcmdzSW5wdXRfMjAhKTogTG9nVGltZSFcXG59XFxudHlwZSBSZWNvbXB1dGVHb2FsUHJvZ3Jlc3Mge1xcbnJlY29tcHV0ZWQ6IE51bWJlciFcXG59XFxudHlwZSBDcmVhdGVHcm91cCB7XFxudXNlcl9pZDogTnVtYmVyIVxcbmlkOiBOdW1iZXIhXFxuY29sb3I6IFN0cmluZyFcXG5jcmVhdGVkX2F0OiBEYXRlIVxcbnVwZGF0ZWRfYXQ6IERhdGUhXFxubmFtZTogU3RyaW5nIVxcbn1cXG50eXBlIENvbXBsZXRlQWN0aXZpdHkge1xcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbmFjdGl2aXR5X2lkOiBOdW1iZXIhXFxub2NjdXJyZW5jZV9kYXRlOiBTdHJpbmchXFxuZHVyYXRpb25fbWludXRlczogTnVtYmVyXFxuY29tcGxldGVkX2F0OiBEYXRlIVxcbm1ldGFkYXRhOiBNZXRhZGF0YVxcbn1cXG50eXBlIExvZ1RpbWUge1xcbmFtb3VudDogTnVtYmVyIVxcbnVzZXJfaWQ6IE51bWJlciFcXG5pZDogTnVtYmVyIVxcbm1ldHJpYzogR29hbEV2ZW50TWV0cmljIVxcbmNyZWF0ZWRfYXQ6IERhdGUhXFxuYWN0aXZpdHlfaWQ6IE51bWJlclxcbm9jY3VycmVuY2VfZGF0ZTogU3RyaW5nXFxubWV0YWRhdGE6IE9iamVjdFxcbmdyb3VwX2lkOiBOdW1iZXJcXG5zb3VyY2VfdHlwZTogR29hbEV2ZW50U291cmNlVHlwZSFcXG5jb21wbGV0aW9uX2lkOiBOdW1iZXJcXG5vY2N1cnJlZF9hdDogRGF0ZSFcXG59XFxuc2NhbGFyIElEXFxuc2NhbGFyIEludFxcbnNjYWxhciBGbG9hdFxcbnNjYWxhciBOdW1iZXJcXG5zY2FsYXIgQW55XFxuc2NhbGFyIFZvaWRcXG5zY2FsYXIgT2JqZWN0XFxuc2NhbGFyIEZpbGVcXG5zY2FsYXIgRGF0ZVxcbnNjYWxhciBKU09OXFxuc2NhbGFyIFN0cmluZ1xcbnNjYWxhciBCb29sZWFuXFxuZW51bSBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxuXFx0c2NoZWR1bGVkXFxufVxcbmVudW0gR29hbE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxTdGF0dXMge1xcblxcdGFjdGl2ZVxcblxcdHBhdXNlZFxcblxcdGNvbXBsZXRlZFxcblxcdGFyY2hpdmVkXFxuXFx0ZmFpbGVkXFxufVxcbmVudW0gQUxMX0FOWV9XRUlHSFRFRCB7XFxuXFx0YWxsXFxuXFx0YW55XFxuXFx0d2VpZ2h0ZWRcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTIHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0cXVhcnRlcmx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcbmVudW0gTk9ORV9PVkVSRkxPVyB7XFxuXFx0bm9uZVxcblxcdG92ZXJmbG93XFxufVxcbmVudW0gQUJTT0xVVEVfUkVMQVRJVkUge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBHb2FsTGlua1R5cGUge1xcblxcdGFjdGl2aXR5XFxuXFx0Z3JvdXBcXG59XFxuZW51bSBEZWFkbGluZVN0YXRlIHtcXG5cXHRmYWlsZWRcXG5cXHRvbl90cmFja1xcblxcdGFwcHJvYWNoaW5nXFxuXFx0b3ZlcmR1ZVxcbn1cXG5lbnVtIEdvYWxDeWNsZVN0YXR1cyB7XFxuXFx0YWN0aXZlXFxuXFx0ZmFpbGVkXFxuXFx0c3VjY2VlZGVkXFxuXFx0bWlzc2VkXFxufVxcbmVudW0gR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCB7XFxuXFx0Y29tcGxldGVcXG5cXHRwcm9ncmVzc1xcbn1cXG5lbnVtIEdvYWxOdWRnZUtpbmQge1xcblxcdGRlYWRsaW5lX2FwcHJvYWNoaW5nXFxuXFx0ZGVhZGxpbmVfb3ZlcmR1ZVxcblxcdGJlaGluZF9wYWNlXFxuXFx0Y3ljbGVfY29tcGxldGVcXG5cXHRkZXBlbmRlbmN5X3VubG9ja2VkXFxuXFx0Z29hbF9zdGFydGluZ19zb29uXFxufVxcbmVudW0gSU5GT19XQVJOSU5HX1NVQ0NFU1Mge1xcblxcdGluZm9cXG5cXHR3YXJuaW5nXFxuXFx0c3VjY2Vzc1xcbn1cXG5lbnVtIFdFRUtMWV9NT05USExZX0VWRVJZX1hfREFZUyB7XFxuXFx0d2Vla2x5XFxuXFx0bW9udGhseVxcblxcdGV2ZXJ5X3hfZGF5c1xcbn1cXG5lbnVtIEdvYWxFdmVudE1ldHJpYyB7XFxuXFx0Y291bnRcXG5cXHRkdXJhdGlvblxcbn1cXG5lbnVtIEdvYWxFdmVudFNvdXJjZVR5cGUge1xcblxcdGNvbXBsZXRpb25cXG5cXHR0aW1lX2xvZ1xcblxcdG1hbnVhbFxcbn1cXG5lbnVtIENPVU5UX0RVUkFUSU9OSW5wdXQge1xcblxcdGNvdW50XFxuXFx0ZHVyYXRpb25cXG59XFxuZW51bSBBTExfQU5ZX1dFSUdIVEVESW5wdXQge1xcblxcdGFsbFxcblxcdGFueVxcblxcdHdlaWdodGVkXFxufVxcbmVudW0gQUNUSVZJVFlfR1JPVVBJbnB1dCB7XFxuXFx0YWN0aXZpdHlcXG5cXHRncm91cFxcbn1cXG5lbnVtIENPTVBMRVRFX1BST0dSRVNTSW5wdXQge1xcblxcdGNvbXBsZXRlXFxuXFx0cHJvZ3Jlc3NcXG59XFxuZW51bSBXRUVLTFlfTU9OVEhMWV9RVUFSVEVSTFlfRVZFUllfWF9EQVlTSW5wdXQge1xcblxcdHdlZWtseVxcblxcdG1vbnRobHlcXG5cXHRxdWFydGVybHlcXG5cXHRldmVyeV94X2RheXNcXG59XFxuZW51bSBOT05FX09WRVJGTE9XSW5wdXQge1xcblxcdG5vbmVcXG5cXHRvdmVyZmxvd1xcbn1cXG5lbnVtIEFCU09MVVRFX1JFTEFUSVZFSW5wdXQge1xcblxcdGFic29sdXRlXFxuXFx0cmVsYXRpdmVcXG59XFxuZW51bSBBQ1RJVkVfUEFVU0VEX0NPTVBMRVRFRF9BUkNISVZFRF9GQUlMRURJbnB1dCB7XFxuXFx0YWN0aXZlXFxuXFx0cGF1c2VkXFxuXFx0Y29tcGxldGVkXFxuXFx0YXJjaGl2ZWRcXG5cXHRmYWlsZWRcXG59XFxuZW51bSBSZWN1cnJlbmNlVHlwZUlucHV0IHtcXG5cXHR3ZWVrbHlcXG5cXHRtb250aGx5XFxuXFx0ZXZlcnlfeF9kYXlzXFxufVxcblwiLFxuICAgICAgICBncmFwaHFsLFxuICAgICAgICByZXNvbHZlcnM6IHt9LFxuICAgICAgICBjb25maWc6IF9faW50ZXJuYWxQeWxvbkNvbmZpZ1xuICAgICAgfSkpXG4gICAgICAiLCAiaW1wb3J0IHsgT25Db25mbGljdEJ1aWxkZXIsIFRyYW5zYWN0aW9uIH0gZnJvbSBcImt5c2VseVwiO1xuaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gXCJAZ2V0Y3Jvbml0L3B5bG9uXCI7XG5pbXBvcnQgeyBkYiB9IGZyb20gXCIuLi8uLi9kYi9kYXRhYmFzZS50c1wiO1xuaW1wb3J0IHR5cGUge1xuICBBY3Rpdml0eSBhcyBBY3Rpdml0eVJvdyxcbiAgRGF0YWJhc2UsXG4gIEdyb3VwIGFzIEdyb3VwUm93LFxuICBOZXdBY3Rpdml0eSxcbiAgTmV3QWN0aXZpdHlDb21wbGV0aW9uLFxuICBOZXdHb2FsRXZlbnQsXG4gIE5ld0dyb3VwLFxuICBOZXdSZWN1cnJlbmNlUGF0dGVybixcbiAgUmVjdXJyZW5jZVBhdHRlcm4gYXMgUmVjdXJyZW5jZVBhdHRlcm5Sb3csXG59IGZyb20gXCIuLi8uLi9kYi90eXBlcy9zY2hlbWEudHNcIjtcbmltcG9ydCB7IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzIH0gZnJvbSBcIi4uLy4uL2dvYWxzL3Byb2dyZXNzLnRzXCI7XG5pbXBvcnQge1xuICBDb21wbGV0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUFjdGl2aXR5SW5wdXQsXG4gIENyZWF0ZUdyb3VwSW5wdXQsXG4gIExvZ1RpbWVJbnB1dCxcbiAgUmVjdXJyZW5jZUNvbmZpZyxcbiAgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCxcbiAgVXBkYXRlQWN0aXZpdHlJbnB1dCxcbiAgVXBkYXRlR3JvdXBJbnB1dCxcbn0gZnJvbSBcIi4uL3R5cGVzLnRzXCI7XG5pbXBvcnQge1xuICBJbnZhbGlkQ29tcGxldGlvbkVycm9yLFxuICBJbnZhbGlkR3JvdXBFcnJvcixcbiAgdmFsaWRhdGVBY3Rpdml0eVNjaGVkdWxlLFxuICB2YWxpZGF0ZUR1cmF0aW9uTWludXRlcyxcbiAgdmFsaWRhdGVHcm91cENvbG9yLFxuICB2YWxpZGF0ZUdyb3VwTmFtZSxcbiAgdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZSxcbiAgdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uLFxufSBmcm9tIFwiLi4vdmFsaWRhdGlvbi50c1wiO1xuaW1wb3J0IHsgYXNOdW1iZXIgfSBmcm9tIFwiLi4vbnVtZXJpYy50c1wiO1xuaW1wb3J0IHsgR29hbE11dGF0aW9uLCBHb2FsUXVlcnkgfSBmcm9tIFwiLi9nb2Fsc19yZXNvbHZlcnMudHNcIjtcblxuaW50ZXJmYWNlIFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIGV4dGVuZHMgT21pdDxSZWN1cnJlbmNlUGF0dGVyblJvdywgXCJjb25maWdcIj4ge1xuICBjb25maWc6IFJlY3VycmVuY2VDb25maWc7XG59XG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldChcInVzZXJJZFwiKTtcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09IFwibnVtYmVyXCIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXCJVbmF1dGhlbnRpY2F0ZWRcIik7XG4gIH1cbiAgcmV0dXJuIHVzZXJJZDtcbn1cblxuZnVuY3Rpb24gcGFyc2VDb25maWcoY29uZmlnOiBSZWN1cnJlbmNlUGF0dGVyblJvd1tcImNvbmZpZ1wiXSk6IFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHlwZW9mIGNvbmZpZyA9PT0gXCJzdHJpbmdcIiA/IEpTT04ucGFyc2UoY29uZmlnKSA6IGNvbmZpZztcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihhY3Rpdml0eUlkOiBudW1iZXIpIHtcbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgLndoZXJlKFwiYWN0aXZpdHlfaWRcIiwgXCI9XCIsIGFjdGl2aXR5SWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZDogbnVtYmVyLCB1c2VySWQ6IG51bWJlcikge1xuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbShcImdyb3Vwc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBncm91cElkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vKipcbiAqIFJlc29sdmVzIGEgZ3JvdXBJZCBmb3IgY3JlYXRlL3VwZGF0ZS4gVGhyb3dzIGlmIHRoZSBncm91cCBkb2VzIG5vdCBiZWxvbmdcbiAqIHRvIHRoZSB1c2VyLiBSZXR1cm5zIG51bGwgd2hlbiBjbGVhcmluZyBvciB3aGVuIG5vIGdyb3VwIGlzIGFzc2lnbmVkLlxuICovXG5hc3luYyBmdW5jdGlvbiByZXNvbHZlR3JvdXBJZChcbiAgZ3JvdXBJZDogbnVtYmVyIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQ+IHtcbiAgaWYgKGdyb3VwSWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgaWYgKGdyb3VwSWQgPT09IG51bGwpIHJldHVybiBudWxsO1xuXG4gIGNvbnN0IGdyb3VwID0gYXdhaXQgZmV0Y2hHcm91cEZvclVzZXIoZ3JvdXBJZCwgdXNlcklkKTtcbiAgaWYgKCFncm91cCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR3JvdXBFcnJvcihcImdyb3VwIG5vdCBmb3VuZFwiKTtcbiAgfVxuICByZXR1cm4gZ3JvdXAuaWQ7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoT3duZWRBY3Rpdml0eShhY3Rpdml0eUlkOiBudW1iZXIsIHVzZXJJZDogbnVtYmVyKSB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eUlkKVxuICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xufVxuXG4vLyBQeWxvbiByZXNvbHZlcyBuZXN0ZWQgR3JhcGhRTCBmaWVsZHMgZnJvbSAocG9zc2libHkgYXN5bmMpIHByb3BlcnRpZXMgb25cbi8vIHRoZSByZXR1cm5lZCBvYmplY3QsIG5vdCBmcm9tIGEgc2VwYXJhdGUgcmVzb2x2ZXIgbWFwIFx1MjAxNCBzbyBuZXN0ZWQgZGF0YSBpc1xuLy8gYXR0YWNoZWQgaW5saW5lIGhlcmUgcmF0aGVyIHRoYW4gdmlhIGEgc3RhbmRhbG9uZSByZXNvbHZlciBleHBvcnQuXG5mdW5jdGlvbiB3aXRoQWN0aXZpdHlSZWxhdGlvbnMoYWN0aXZpdHk6IEFjdGl2aXR5Um93KSB7XG4gIHJldHVybiB7XG4gICAgLi4uYWN0aXZpdHksXG4gICAgcmVjdXJyZW5jZVBhdHRlcm46IGFzeW5jICgpOiBQcm9taXNlPFBhcnNlZFJlY3VycmVuY2VQYXR0ZXJuIHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKCFhY3Rpdml0eS5pc19yZWN1cnJpbmcpIHJldHVybiBudWxsO1xuICAgICAgY29uc3QgcGF0dGVybiA9IGF3YWl0IGZldGNoUmVjdXJyZW5jZVBhdHRlcm4oYWN0aXZpdHkuaWQpO1xuICAgICAgaWYgKCFwYXR0ZXJuKSByZXR1cm4gbnVsbDtcbiAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKHBhdHRlcm4uY29uZmlnKTtcbiAgICAgIGlmICghY29uZmlnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IC4uLnBhdHRlcm4sIGNvbmZpZyB9O1xuICAgIH0sXG4gICAgZ3JvdXA6IGFzeW5jICgpOiBQcm9taXNlPEdyb3VwUm93IHwgbnVsbD4gPT4ge1xuICAgICAgaWYgKGFjdGl2aXR5Lmdyb3VwX2lkID09IG51bGwpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhY3Rpdml0eS5ncm91cF9pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgICB9LFxuICB9O1xufVxuXG5leHBvcnQgY29uc3QgUXVlcnkgPSB7XG4gIGdyb3VwczogYXN5bmMgKGFyZ3M/OiBSZWNvcmQ8c3RyaW5nLCBuZXZlcj4pID0+IHtcbiAgICB2b2lkIGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oXCJncm91cHNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwibmFtZVwiLCBcImFzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICB9LFxuXG4gIGdyb3VwOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbDtcbiAgfSxcblxuICBhY3Rpdml0aWVzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbShcImFjdGl2aXRpZXNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICByZXR1cm4gcm93cy5tYXAod2l0aEFjdGl2aXR5UmVsYXRpb25zKTtcbiAgfSxcblxuICBhY3Rpdml0eTogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIHJldHVybiByb3cgPyB3aXRoQWN0aXZpdHlSZWxhdGlvbnMocm93KSA6IG51bGw7XG4gIH0sXG5cbiAgYWN0aXZpdHlDb21wbGV0aW9uczogYXN5bmMgKGFyZ3M/OiB7XG4gICAgYWN0aXZpdHlJZD86IG51bWJlcjtcbiAgICBmcm9tRGF0ZT86IHN0cmluZztcbiAgICB0b0RhdGU/OiBzdHJpbmc7XG4gIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5vcmRlckJ5KFwib2NjdXJyZW5jZV9kYXRlXCIsIFwiZGVzY1wiKVxuICAgICAgLnNlbGVjdEFsbCgpO1xuXG4gICAgaWYgKGFyZ3M/LmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcImFjdGl2aXR5X2lkXCIsIFwiPVwiLCBhcmdzLmFjdGl2aXR5SWQpO1xuICAgIH1cbiAgICBpZiAoYXJncz8uZnJvbURhdGUpIHtcbiAgICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoXCJvY2N1cnJlbmNlX2RhdGVcIiwgXCI+PVwiLCBhcmdzLmZyb21EYXRlKTtcbiAgICB9XG4gICAgaWYgKGFyZ3M/LnRvRGF0ZSkge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIjw9XCIsIGFyZ3MudG9EYXRlKTtcbiAgICB9XG4gICAgcmV0dXJuIGF3YWl0IHF1ZXJ5LmV4ZWN1dGUoKTtcbiAgfSxcblxuICAuLi5Hb2FsUXVlcnksXG59O1xuXG5leHBvcnQgY29uc3QgTXV0YXRpb24gPSB7XG4gIGNyZWF0ZUdyb3VwOiBhc3luYyAoYXJnczogeyBpbnB1dDogQ3JlYXRlR3JvdXBJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgeyBpbnB1dCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG4gICAgY29uc3QgbmFtZSA9IHZhbGlkYXRlR3JvdXBOYW1lKGlucHV0Lm5hbWUpO1xuICAgIGNvbnN0IGNvbG9yID0gdmFsaWRhdGVHcm91cENvbG9yKGlucHV0LmNvbG9yKTtcbiAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG5cbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC5pbnNlcnRJbnRvKFwiZ3JvdXBzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICB1cGRhdGVkX2F0OiBub3csXG4gICAgICB9IGFzIE5ld0dyb3VwKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfSxcblxuICB1cGRhdGVHcm91cDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdyb3VwSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgY29uc3QgbmFtZSA9IGlucHV0Lm5hbWUgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwTmFtZShpbnB1dC5uYW1lKVxuICAgICAgOiBleGlzdGluZy5uYW1lO1xuICAgIGNvbnN0IGNvbG9yID0gaW5wdXQuY29sb3IgIT09IHVuZGVmaW5lZFxuICAgICAgPyB2YWxpZGF0ZUdyb3VwQ29sb3IoaW5wdXQuY29sb3IpXG4gICAgICA6IGV4aXN0aW5nLmNvbG9yO1xuXG4gICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoXCJncm91cHNcIilcbiAgICAgIC5zZXQoe1xuICAgICAgICBuYW1lLFxuICAgICAgICBjb2xvcixcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgIC53aGVyZShcInVzZXJfaWRcIiwgXCI9XCIsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG4gIH0sXG5cbiAgZGVsZXRlR3JvdXA6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHsgaWQgfSA9IGFyZ3M7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgZGJcbiAgICAgIC5kZWxldGVGcm9tKFwiZ3JvdXBzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNyZWF0ZUFjdGl2aXR5OiBhc3luYyAoXG4gICAgYXJnczogeyBpbnB1dDogQ3JlYXRlQWN0aXZpdHlJbnB1dCB9LFxuICApID0+IHtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIHZhbGlkYXRlQWN0aXZpdHlTY2hlZHVsZSh7XG4gICAgICBpc1JlY3VycmluZzogaW5wdXQuaXNSZWN1cnJpbmcsXG4gICAgICBkYXRlOiBpbnB1dC5kYXRlLFxuICAgICAgcmVjdXJyZW5jZVBhdHRlcm46IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLFxuICAgIH0pO1xuXG4gICAgY29uc3QgZ3JvdXBJZCA9IGF3YWl0IHJlc29sdmVHcm91cElkKGlucHV0Lmdyb3VwSWQgPz8gbnVsbCwgdXNlcklkKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPikgPT4ge1xuICAgICAgY29uc3QgYWN0aXZpdHkgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgIHVzZXJfaWQ6IHVzZXJJZCxcbiAgICAgICAgICB0aXRsZTogaW5wdXQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uLFxuICAgICAgICAgIHN0YXJ0X3RpbWU6IGlucHV0LnN0YXJ0VGltZSxcbiAgICAgICAgICBlbmRfdGltZTogaW5wdXQuZW5kVGltZSxcbiAgICAgICAgICBpc19yZWN1cnJpbmc6IGlucHV0LmlzUmVjdXJyaW5nLFxuICAgICAgICAgIGRhdGU6IGlucHV0LmlzUmVjdXJyaW5nID8gbnVsbCA6IChpbnB1dC5kYXRlID8/IG51bGwpLFxuICAgICAgICAgIGdyb3VwX2lkOiBncm91cElkID8/IG51bGwsXG4gICAgICAgIH0gYXMgTmV3QWN0aXZpdHkpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgICAgaWYgKGlucHV0LmlzUmVjdXJyaW5nICYmIGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJyZWN1cnJlbmNlX3BhdHRlcm5zXCIpXG4gICAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuLnJlY3VycmVuY2VUeXBlLFxuICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5jb25maWcpLFxuICAgICAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICAgIH0gYXMgTmV3UmVjdXJyZW5jZVBhdHRlcm4pXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgdXBkYXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXI7IGlucHV0OiBVcGRhdGVBY3Rpdml0eUlucHV0IH0sXG4gICkgPT4ge1xuICAgIGNvbnN0IHsgaWQsIGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcblxuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdGllc1wiKVxuICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcblxuICAgIGNvbnN0IGlzUmVjdXJyaW5nID0gaW5wdXQuaXNSZWN1cnJpbmcgPz8gZXhpc3RpbmcuaXNfcmVjdXJyaW5nO1xuICAgIGNvbnN0IGRhdGUgPSBpbnB1dC5kYXRlICE9PSB1bmRlZmluZWQgPyBpbnB1dC5kYXRlIDogZXhpc3RpbmcuZGF0ZTtcblxuICAgIC8vIElmIHRoZSBzY2hlZHVsZSBpcyBzdGlsbCByZWN1cnJpbmcgYW5kIG5vIG5ldyBwYXR0ZXJuIHdhcyBzdXBwbGllZCxcbiAgICAvLyB2YWxpZGF0ZSBhZ2FpbnN0IHRoZSBwYXR0ZXJuIGFscmVhZHkgb24gZmlsZS5cbiAgICBsZXQgcmVjdXJyZW5jZVBhdHRlcm46IFJlY3VycmVuY2VQYXR0ZXJuSW5wdXQgfCBudWxsIHwgdW5kZWZpbmVkID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm47XG4gICAgaWYgKGlzUmVjdXJyaW5nICYmICFyZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgY29uc3QgZXhpc3RpbmdQYXR0ZXJuID0gYXdhaXQgZmV0Y2hSZWN1cnJlbmNlUGF0dGVybihpZCk7XG4gICAgICBpZiAoZXhpc3RpbmdQYXR0ZXJuKSB7XG4gICAgICAgIGNvbnN0IGNvbmZpZyA9IHBhcnNlQ29uZmlnKGV4aXN0aW5nUGF0dGVybi5jb25maWcpO1xuICAgICAgICByZWN1cnJlbmNlUGF0dGVybiA9IGNvbmZpZ1xuICAgICAgICAgID8geyByZWN1cnJlbmNlVHlwZTogZXhpc3RpbmdQYXR0ZXJuLnJlY3VycmVuY2VfdHlwZSwgY29uZmlnIH1cbiAgICAgICAgICA6IHVuZGVmaW5lZDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoeyBpc1JlY3VycmluZywgZGF0ZSwgcmVjdXJyZW5jZVBhdHRlcm4gfSk7XG5cbiAgICBjb25zdCByZXNvbHZlZEdyb3VwSWQgPSBpbnB1dC5ncm91cElkICE9PSB1bmRlZmluZWRcbiAgICAgID8gYXdhaXQgcmVzb2x2ZUdyb3VwSWQoaW5wdXQuZ3JvdXBJZCwgdXNlcklkKVxuICAgICAgOiB1bmRlZmluZWQ7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGRiLnRyYW5zYWN0aW9uKCkuZXhlY3V0ZShhc3luYyAodHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4pID0+IHtcbiAgICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZShcImFjdGl2aXRpZXNcIilcbiAgICAgICAgLnNldCh7XG4gICAgICAgICAgdGl0bGU6IGlucHV0LnRpdGxlLFxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBpbnB1dC5kZXNjcmlwdGlvbixcbiAgICAgICAgICBzdGFydF90aW1lOiBpbnB1dC5zdGFydFRpbWUsXG4gICAgICAgICAgZW5kX3RpbWU6IGlucHV0LmVuZFRpbWUsXG4gICAgICAgICAgaXNfcmVjdXJyaW5nOiBpc1JlY3VycmluZyxcbiAgICAgICAgICBkYXRlOiBpc1JlY3VycmluZyA/IG51bGwgOiAoZGF0ZSA/PyBudWxsKSxcbiAgICAgICAgICAuLi4ocmVzb2x2ZWRHcm91cElkICE9PSB1bmRlZmluZWQgPyB7IGdyb3VwX2lkOiByZXNvbHZlZEdyb3VwSWQgfSA6IHt9KSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCksXG4gICAgICAgIH0pXG4gICAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBpZClcbiAgICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgICAgIGlmIChpc1JlY3VycmluZyAmJiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybikge1xuICAgICAgICBjb25zdCBub3cgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCk7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC5pbnNlcnRJbnRvKFwicmVjdXJyZW5jZV9wYXR0ZXJuc1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgcmVjdXJyZW5jZV90eXBlOiBpbnB1dC5yZWN1cnJlbmNlUGF0dGVybi5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgIGNvbmZpZzogSlNPTi5zdHJpbmdpZnkoaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnKSxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld1JlY3VycmVuY2VQYXR0ZXJuKVxuICAgICAgICAgIC5vbkNvbmZsaWN0KChvYzogT25Db25mbGljdEJ1aWxkZXI8YW55LCBhbnk+KSA9PlxuICAgICAgICAgICAgb2MuY29sdW1ucyhbXCJhY3Rpdml0eV9pZFwiXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICAgICAgICByZWN1cnJlbmNlX3R5cGU6IGlucHV0LnJlY3VycmVuY2VQYXR0ZXJuIS5yZWN1cnJlbmNlVHlwZSxcbiAgICAgICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeShpbnB1dC5yZWN1cnJlbmNlUGF0dGVybiEuY29uZmlnKSxcbiAgICAgICAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgICAgICAgfSlcbiAgICAgICAgICApXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH0gZWxzZSBpZiAoIWlzUmVjdXJyaW5nKSB7XG4gICAgICAgIC8vIENsZWFuIHVwIGFueSBzdGFsZSBwYXR0ZXJuIG9uY2UgYW4gYWN0aXZpdHkgc3RvcHMgcmVjdXJyaW5nLlxuICAgICAgICBhd2FpdCB0cnhcbiAgICAgICAgICAuZGVsZXRlRnJvbShcInJlY3VycmVuY2VfcGF0dGVybnNcIilcbiAgICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgICAgLmV4ZWN1dGUoKTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIGFjdGl2aXR5O1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIHdpdGhBY3Rpdml0eVJlbGF0aW9ucyhhY3Rpdml0eSk7XG4gIH0sXG5cbiAgZGVsZXRlQWN0aXZpdHk6IGFzeW5jIChcbiAgICBhcmdzOiB7IGlkOiBudW1iZXIgfSxcbiAgKSA9PiB7XG4gICAgY29uc3QgeyBpZCB9ID0gYXJncztcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKCk7XG5cbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oXCJhY3Rpdml0aWVzXCIpXG4gICAgICAud2hlcmUoXCJpZFwiLCBcIj1cIiwgaWQpXG4gICAgICAud2hlcmUoXCJ1c2VyX2lkXCIsIFwiPVwiLCB1c2VySWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgcmV0dXJuIHJlc3VsdC5sZW5ndGggPiAwO1xuICB9LFxuXG4gIGNvbXBsZXRlQWN0aXZpdHk6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBDb21wbGV0ZUFjdGl2aXR5SW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG9jY3VycmVuY2VEYXRlID0gdmFsaWRhdGVPY2N1cnJlbmNlRGF0ZShpbnB1dC5vY2N1cnJlbmNlRGF0ZSk7XG4gICAgY29uc3QgZHVyYXRpb25NaW51dGVzID0gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXMoaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGlucHV0LmFjdGl2aXR5SWQsIHVzZXJJZCk7XG4gICAgaWYgKCFhY3Rpdml0eSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoXCJhY3Rpdml0eSBub3QgZm91bmRcIik7XG4gICAgfVxuXG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKS50b0lTT1N0cmluZygpO1xuICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAgICAgLnNlbGVjdEZyb20oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAud2hlcmUoXCJhY3Rpdml0eV9pZFwiLCBcIj1cIiwgYWN0aXZpdHkuaWQpXG4gICAgICAgIC53aGVyZShcIm9jY3VycmVuY2VfZGF0ZVwiLCBcIj1cIiwgb2NjdXJyZW5jZURhdGUpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmRlbGV0ZUZyb20oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAgIC5leGVjdXRlKCk7XG4gICAgICB9XG5cbiAgICAgIGNvbnN0IGNvbXBsZXRpb24gPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oXCJhY3Rpdml0eV9jb21wbGV0aW9uc1wiKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIG9jY3VycmVuY2VfZGF0ZTogb2NjdXJyZW5jZURhdGUsXG4gICAgICAgICAgZHVyYXRpb25fbWludXRlczogZHVyYXRpb25NaW51dGVzLFxuICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgIG1ldGFkYXRhOiBpbnB1dC5ub3Rlc1xuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcywgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pXG4gICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICB9IGFzIE5ld0FjdGl2aXR5Q29tcGxldGlvbilcbiAgICAgICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgICAgIG9jLmNvbHVtbnMoW1wiYWN0aXZpdHlfaWRcIiwgXCJvY2N1cnJlbmNlX2RhdGVcIl0pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgICAgIGR1cmF0aW9uX21pbnV0ZXM6IGR1cmF0aW9uTWludXRlcyxcbiAgICAgICAgICAgIGNvbXBsZXRlZF9hdDogbm93LFxuICAgICAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgICAgID8gSlNPTi5zdHJpbmdpZnkoeyBub3RlczogaW5wdXQubm90ZXMsIHRpdGxlOiBhY3Rpdml0eS50aXRsZSB9KVxuICAgICAgICAgICAgICA6IEpTT04uc3RyaW5naWZ5KHsgdGl0bGU6IGFjdGl2aXR5LnRpdGxlIH0pLFxuICAgICAgICAgIH0pXG4gICAgICAgIClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgICAvLyBDb3VudCBldmVudFxuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5pbnNlcnRJbnRvKFwiZ29hbF9ldmVudHNcIilcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHNvdXJjZV90eXBlOiBcImNvbXBsZXRpb25cIixcbiAgICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgIGNvbXBsZXRpb25faWQ6IGNvbXBsZXRpb24uaWQsXG4gICAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgIG1ldHJpYzogXCJjb3VudFwiLFxuICAgICAgICAgIGFtb3VudDogMSxcbiAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3csXG4gICAgICAgIH0gYXMgTmV3R29hbEV2ZW50KVxuICAgICAgICAuZXhlY3V0ZSgpO1xuXG4gICAgICAvLyBPcHRpb25hbCBkdXJhdGlvbiBldmVudCB3aGVuIG1pbnV0ZXMgcHJvdmlkZWQgb3IgZGVyaXZlZCBmcm9tIHNjaGVkdWxlLlxuICAgICAgbGV0IG1pbnV0ZXMgPSBkdXJhdGlvbk1pbnV0ZXM7XG4gICAgICBpZiAobWludXRlcyA9PSBudWxsKSB7XG4gICAgICAgIC8vIERlcml2ZSBmcm9tIHNjaGVkdWxlZCBzbG90IHdoZW4gcG9zc2libGUuXG4gICAgICAgIGNvbnN0IFtzaCwgc21dID0gYWN0aXZpdHkuc3RhcnRfdGltZS5zcGxpdChcIjpcIikubWFwKE51bWJlcik7XG4gICAgICAgIGNvbnN0IFtlaCwgZW1dID0gYWN0aXZpdHkuZW5kX3RpbWUuc3BsaXQoXCI6XCIpLm1hcChOdW1iZXIpO1xuICAgICAgICBjb25zdCBkZXJpdmVkID0gKGVoICogNjAgKyBlbSkgLSAoc2ggKiA2MCArIHNtKTtcbiAgICAgICAgaWYgKGRlcml2ZWQgPiAwKSBtaW51dGVzID0gZGVyaXZlZDtcbiAgICAgIH1cbiAgICAgIGlmIChtaW51dGVzICE9IG51bGwgJiYgbWludXRlcyA+IDApIHtcbiAgICAgICAgYXdhaXQgdHJ4XG4gICAgICAgICAgLmluc2VydEludG8oXCJnb2FsX2V2ZW50c1wiKVxuICAgICAgICAgIC52YWx1ZXMoe1xuICAgICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgICAgc291cmNlX3R5cGU6IFwiY29tcGxldGlvblwiLFxuICAgICAgICAgICAgYWN0aXZpdHlfaWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgICAgICAgZ3JvdXBfaWQ6IGFjdGl2aXR5Lmdyb3VwX2lkLFxuICAgICAgICAgICAgY29tcGxldGlvbl9pZDogY29tcGxldGlvbi5pZCxcbiAgICAgICAgICAgIG9jY3VycmVkX2F0OiBub3csXG4gICAgICAgICAgICBvY2N1cnJlbmNlX2RhdGU6IG9jY3VycmVuY2VEYXRlLFxuICAgICAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgICAgICBhbW91bnQ6IG1pbnV0ZXMsXG4gICAgICAgICAgICBtZXRhZGF0YTogbnVsbCxcbiAgICAgICAgICAgIGNyZWF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9IGFzIE5ld0dvYWxFdmVudClcbiAgICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgICB9KTtcblxuICAgIGF3YWl0IHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKGRiLCB1c2VySWQsIHtcbiAgICAgIGFjdGl2aXR5SWQ6IGFjdGl2aXR5LmlkLFxuICAgICAgZ3JvdXBJZDogYWN0aXZpdHkuZ3JvdXBfaWQsXG4gICAgfSk7XG5cbiAgICByZXR1cm4gY29tcGxldGlvbjtcbiAgfSxcblxuICB1bmRvQ29tcGxldGlvbjogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlciB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpO1xuICAgIGNvbnN0IGV4aXN0aW5nID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgIC53aGVyZShcImlkXCIsIFwiPVwiLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKFwidXNlcl9pZFwiLCBcIj1cIiwgdXNlcklkKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmICghZXhpc3RpbmcpIHJldHVybiBmYWxzZTtcblxuICAgIGNvbnN0IGFjdGl2aXR5ID0gYXdhaXQgZmV0Y2hPd25lZEFjdGl2aXR5KGV4aXN0aW5nLmFjdGl2aXR5X2lkLCB1c2VySWQpO1xuXG4gICAgYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGF3YWl0IHRyeFxuICAgICAgICAuZGVsZXRlRnJvbShcImdvYWxfZXZlbnRzXCIpXG4gICAgICAgIC53aGVyZShcImNvbXBsZXRpb25faWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC5kZWxldGVGcm9tKFwiYWN0aXZpdHlfY29tcGxldGlvbnNcIilcbiAgICAgICAgLndoZXJlKFwiaWRcIiwgXCI9XCIsIGV4aXN0aW5nLmlkKVxuICAgICAgICAuZXhlY3V0ZSgpO1xuICAgIH0pO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogZXhpc3RpbmcuYWN0aXZpdHlfaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eT8uZ3JvdXBfaWQgPz8gbnVsbCxcbiAgICB9KTtcblxuICAgIHJldHVybiB0cnVlO1xuICB9LFxuXG4gIGxvZ1RpbWU6IGFzeW5jIChhcmdzOiB7IGlucHV0OiBMb2dUaW1lSW5wdXQgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKTtcbiAgICBjb25zdCB7IGlucHV0IH0gPSBhcmdzO1xuICAgIGNvbnN0IG1pbnV0ZXMgPSB2YWxpZGF0ZVBvc2l0aXZlRHVyYXRpb24oaW5wdXQuZHVyYXRpb25NaW51dGVzKTtcbiAgICBjb25zdCBvY2N1cnJlbmNlRGF0ZSA9IHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoXG4gICAgICBpbnB1dC5vY2N1cnJlbmNlRGF0ZSA/PyBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApLFxuICAgICk7XG5cbiAgICBjb25zdCBhY3Rpdml0eSA9IGF3YWl0IGZldGNoT3duZWRBY3Rpdml0eShpbnB1dC5hY3Rpdml0eUlkLCB1c2VySWQpO1xuICAgIGlmICghYWN0aXZpdHkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkQ29tcGxldGlvbkVycm9yKFwiYWN0aXZpdHkgbm90IGZvdW5kXCIpO1xuICAgIH1cblxuICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKTtcbiAgICBjb25zdCBldmVudCA9IGF3YWl0IGRiXG4gICAgICAuaW5zZXJ0SW50byhcImdvYWxfZXZlbnRzXCIpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICBzb3VyY2VfdHlwZTogXCJ0aW1lX2xvZ1wiLFxuICAgICAgICBhY3Rpdml0eV9pZDogYWN0aXZpdHkuaWQsXG4gICAgICAgIGdyb3VwX2lkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICAgICAgY29tcGxldGlvbl9pZDogbnVsbCxcbiAgICAgICAgb2NjdXJyZWRfYXQ6IG5vdyxcbiAgICAgICAgb2NjdXJyZW5jZV9kYXRlOiBvY2N1cnJlbmNlRGF0ZSxcbiAgICAgICAgbWV0cmljOiBcImR1cmF0aW9uXCIsXG4gICAgICAgIGFtb3VudDogbWludXRlcyxcbiAgICAgICAgbWV0YWRhdGE6IGlucHV0Lm5vdGVzXG4gICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh7IG5vdGVzOiBpbnB1dC5ub3RlcyB9KVxuICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgY3JlYXRlZF9hdDogbm93LFxuICAgICAgfSBhcyBOZXdHb2FsRXZlbnQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpO1xuXG4gICAgYXdhaXQgcmVjb21wdXRlQWZmZWN0ZWRDeWNsZXMoZGIsIHVzZXJJZCwge1xuICAgICAgYWN0aXZpdHlJZDogYWN0aXZpdHkuaWQsXG4gICAgICBncm91cElkOiBhY3Rpdml0eS5ncm91cF9pZCxcbiAgICB9KTtcblxuICAgIHJldHVybiB7XG4gICAgICAuLi5ldmVudCxcbiAgICAgIGFtb3VudDogYXNOdW1iZXIoZXZlbnQuYW1vdW50KSxcbiAgICB9O1xuICB9LFxuXG4gIC4uLkdvYWxNdXRhdGlvbixcbn07XG5cbmV4cG9ydCBjb25zdCByZXNvbHZlcnMgPSB7XG4gIFF1ZXJ5LFxuICBNdXRhdGlvbixcbn07XG4iLCAiaW1wb3J0IHsgQ29sdW1uVHlwZSwgR2VuZXJhdGVkLCBJbnNlcnRhYmxlLCBTZWxlY3RhYmxlLCBVcGRhdGVhYmxlIH0gZnJvbSAna3lzZWx5J1xuXG4vLyBNYWluIERhdGFiYXNlIGludGVyZmFjZSB0aGF0IGRlc2NyaWJlcyBhbGwgdGFibGVzXG5leHBvcnQgaW50ZXJmYWNlIERhdGFiYXNlIHtcbiAgdXNlcnM6IFVzZXJzVGFibGVcbiAgZ3JvdXBzOiBHcm91cHNUYWJsZVxuICBhY3Rpdml0aWVzOiBBY3Rpdml0aWVzVGFibGVcbiAgcmVjdXJyZW5jZV9wYXR0ZXJuczogUmVjdXJyZW5jZVBhdHRlcm5zVGFibGVcbiAgYWN0aXZpdHlfY29tcGxldGlvbnM6IEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZVxuICBnb2FsX2V2ZW50czogR29hbEV2ZW50c1RhYmxlXG4gIGdvYWxzOiBHb2Fsc1RhYmxlXG4gIGdvYWxfbGlua3M6IEdvYWxMaW5rc1RhYmxlXG4gIGdvYWxfY3ljbGVzOiBHb2FsQ3ljbGVzVGFibGVcbiAgZ29hbF9kZXBlbmRlbmNpZXM6IEdvYWxEZXBlbmRlbmNpZXNUYWJsZVxuICBnb2FsX3Byb2dyZXNzX3NuYXBzaG90czogR29hbFByb2dyZXNzU25hcHNob3RzVGFibGVcbn1cblxuLy8gVXNlcnMgdGFibGUgaW50ZXJmYWNlXG5leHBvcnQgaW50ZXJmYWNlIFVzZXJzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgZW1haWw6IHN0cmluZ1xuICBwYXNzd29yZF9oYXNoOiBzdHJpbmcgfCBudWxsXG4gIC8qKiBTdXBlclRva2VucyB1c2VyIGlkIFx1MjAxNCBsaW5rcyBTU08gaWRlbnRpdHkgdG8gbG9jYWwgcm93cy4gKi9cbiAgYXV0aF91c2VyX2lkOiBzdHJpbmcgfCBudWxsXG4gIG5hbWU6IHN0cmluZ1xuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEdyb3VwcyB0YWJsZSBpbnRlcmZhY2UgXHUyMDE0IHVzZXItc2NvcGVkIGFjdGl2aXR5IHRheG9ub215IHdpdGggZGlzcGxheSBjb2xvci5cbmV4cG9ydCBpbnRlcmZhY2UgR3JvdXBzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIG5hbWU6IHN0cmluZ1xuICAvLyBIZXggY29sb3IgZnJvbSB0aGUgc2hhcmVkIHByZXNldCBwYWxldHRlLCBlLmcuIFwiIzBGNzY2RVwiXG4gIGNvbG9yOiBzdHJpbmdcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBBY3Rpdml0aWVzIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBBY3Rpdml0aWVzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIC8vIE9wdGlvbmFsIGdyb3VwIGFzc2lnbm1lbnQuIE51bGwgd2hlbiB1bmdyb3VwZWQ7IGNsZWFyZWQgaWYgdGhlIGdyb3VwXG4gIC8vIGlzIGRlbGV0ZWQgKE9OIERFTEVURSBTRVQgTlVMTCkuXG4gIGdyb3VwX2lkOiBudW1iZXIgfCBudWxsXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgc3RhcnRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBlbmRfdGltZTogc3RyaW5nIC8vIFRpbWUgb2YgZGF5IGluIEhIOm1tIGZvcm1hdFxuICBpc19yZWN1cnJpbmc6IGJvb2xlYW5cbiAgLy8gQ2FsZW5kYXIgZGF0ZSB0aGUgYWN0aXZpdHkgb2NjdXJzIG9uLiBSZXF1aXJlZCB3aGVuIGlzX3JlY3VycmluZyBpc1xuICAvLyBmYWxzZTsgbnVsbCB3aGVuIGlzX3JlY3VycmluZyBpcyB0cnVlIChkYXRlcyBsaXZlIGluIHRoZSByZWN1cnJlbmNlXG4gIC8vIHBhdHRlcm4ncyBjb25maWcgaW5zdGVhZCkuXG4gIGRhdGU6IHN0cmluZyB8IG51bGxcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxuICB1cGRhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgc3RyaW5nPlxufVxuXG4vLyBSZWN1cnJlbmNlIHBhdHRlcm5zIHRhYmxlIGludGVyZmFjZVxuZXhwb3J0IGludGVyZmFjZSBSZWN1cnJlbmNlUGF0dGVybnNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBhY3Rpdml0eV9pZDogbnVtYmVyXG4gIC8vIFR5cGUgb2YgcmVjdXJyZW5jZTogd2Vla2x5LCBtb250aGx5LCBvciBldmVyeSBYIGRheXNcbiAgcmVjdXJyZW5jZV90eXBlOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdldmVyeV94X2RheXMnXG4gIC8vIEpTT04gY29uZmlndXJhdGlvbiBmb3IgdGhlIHJlY3VycmVuY2VcbiAgY29uZmlnOiBDb2x1bW5UeXBlPHtcbiAgICAvLyBGb3Igd2Vla2x5OiBhcnJheSBvZiBkYXlzICgwLTYsIHdoZXJlIDAgaXMgU3VuZGF5KVxuICAgIGRheXNfb2Zfd2Vlaz86IG51bWJlcltdXG4gICAgLy8gRm9yIG1vbnRobHk6IGRheXMgb2YgdGhlIG1vbnRoICgxLTMxKVxuICAgIGRheXNfb2ZfbW9udGg/OiBudW1iZXJbXVxuICAgIC8vIEZvciBtb250aGx5OiBhbHNvIHJlcGVhdCBvbiB0aGUgbGFzdCBkYXkgb2YgdGhlIG1vbnRoLiBLZXB0IGFzIGl0c1xuICAgIC8vIG93biBib29sZWFuIChyYXRoZXIgdGhhbiBhICdsYXN0JyBzZW50aW5lbCBpbiBkYXlzX29mX21vbnRoKSBiZWNhdXNlXG4gICAgLy8gUHlsb24vR3JhcGhRTCBpbnB1dCB0eXBlcyBjYW4ndCByZXByZXNlbnQgYSBudW1iZXJ8c3RyaW5nIHVuaW9uLlxuICAgIGlzX2xhc3RfZGF5X29mX21vbnRoPzogYm9vbGVhblxuICAgIC8vIEZvciBldmVyeV94X2RheXM6IHJlcGVhdCBldmVyeSBOIGRheXMgKD49IDEpXG4gICAgaW50ZXJ2YWxfZGF5cz86IG51bWJlclxuICAgIC8vIFN0YXJ0IGRhdGUgb2YgdGhlIHJlY3VycmVuY2VcbiAgICBzdGFydF9kYXRlOiBzdHJpbmdcbiAgICAvLyBFbmQgZGF0ZSBvZiB0aGUgcmVjdXJyZW5jZSAob3B0aW9uYWwpXG4gICAgZW5kX2RhdGU/OiBzdHJpbmcgfCBudWxsXG4gIH0sIHN0cmluZywgc3RyaW5nPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG4gIHVwZGF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG59XG5cbi8vIEFjdGl2aXR5IGNvbXBsZXRpb25zIFx1MjAxNCBvbmUgcm93IHBlciAoYWN0aXZpdHksIG9jY3VycmVuY2VfZGF0ZSlcbmV4cG9ydCBpbnRlcmZhY2UgQWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGFjdGl2aXR5X2lkOiBudW1iZXJcbiAgdXNlcl9pZDogbnVtYmVyXG4gIG9jY3VycmVuY2VfZGF0ZTogc3RyaW5nXG4gIGR1cmF0aW9uX21pbnV0ZXM6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZywgbmV2ZXI+XG4gIC8vIFN0b3JlIGFueSBhZGRpdGlvbmFsIGRhdGEgYWJvdXQgdGhlIGNvbXBsZXRpb25cbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8e1xuICAgIHRpdGxlPzogc3RyaW5nXG4gICAgbm90ZXM/OiBzdHJpbmdcbiAgICB0cmlnZ2VyX2V2ZW50cz86IHN0cmluZ1tdXG4gIH0gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRTb3VyY2VUeXBlID0gJ2NvbXBsZXRpb24nIHwgJ3RpbWVfbG9nJyB8ICdtYW51YWwnXG5leHBvcnQgdHlwZSBHb2FsRXZlbnRNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxFdmVudHNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICB1c2VyX2lkOiBudW1iZXJcbiAgc291cmNlX3R5cGU6IEdvYWxFdmVudFNvdXJjZVR5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgY29tcGxldGlvbl9pZDogbnVtYmVyIHwgbnVsbFxuICBvY2N1cnJlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIG5ldmVyPlxuICBvY2N1cnJlbmNlX2RhdGU6IHN0cmluZyB8IG51bGxcbiAgbWV0cmljOiBHb2FsRXZlbnRNZXRyaWNcbiAgYW1vdW50OiBudW1iZXJcbiAgbWV0YWRhdGE6IENvbHVtblR5cGU8UmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICBjcmVhdGVkX2F0OiBDb2x1bW5UeXBlPERhdGUsIHN0cmluZyB8IHVuZGVmaW5lZCwgbmV2ZXI+XG59XG5cbmV4cG9ydCB0eXBlIEdvYWxTdGF0dXMgPSAnYWN0aXZlJyB8ICdwYXVzZWQnIHwgJ2NvbXBsZXRlZCcgfCAnYXJjaGl2ZWQnIHwgJ2ZhaWxlZCdcbmV4cG9ydCB0eXBlIEdvYWxNZXRyaWMgPSAnY291bnQnIHwgJ2R1cmF0aW9uJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxSZWN1cnJlbmNlQ29uZmlnIHtcbiAgcGVyaW9kOiAnd2Vla2x5JyB8ICdtb250aGx5JyB8ICdxdWFydGVybHknIHwgJ2V2ZXJ5X3hfZGF5cydcbiAgaW50ZXJ2YWw/OiBudW1iZXJcbiAgYW5jaG9yPzogc3RyaW5nXG4gIGNhcnJ5X292ZXI/OiAnbm9uZScgfCAnb3ZlcmZsb3cnXG4gIHJlc2V0PzogJ2hhcmQnXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlYWRsaW5lQ29uZmlnIHtcbiAga2luZDogJ2Fic29sdXRlJyB8ICdyZWxhdGl2ZSdcbiAgZGF0ZT86IHN0cmluZ1xuICBkYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0PzogbnVtYmVyXG4gIGdyYWNlX2RheXM/OiBudW1iZXJcbiAgd2Fybl9kYXlzPzogbnVtYmVyXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbENvbmZpZyB7XG4gIGNvbXBvc2l0ZV9tb2RlPzogJ2FsbCcgfCAnYW55JyB8ICd3ZWlnaHRlZCdcbiAgY291bnRfcmVxdWlyZWQ/OiBudW1iZXJcbiAgYmVmb3JlX3RpbWU/OiBzdHJpbmdcbiAgYWZ0ZXJfdGltZT86IHN0cmluZ1xuICBibG9ja191bnRpbF91bmxvY2tlZD86IGJvb2xlYW5cbiAgW2tleTogc3RyaW5nXTogdW5rbm93blxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxzVGFibGUge1xuICBpZDogR2VuZXJhdGVkPG51bWJlcj5cbiAgdXNlcl9pZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgZGVzY3JpcHRpb246IHN0cmluZyB8IG51bGxcbiAgY29sb3I6IHN0cmluZ1xuICBpY29uOiBzdHJpbmcgfCBudWxsXG4gIHJ1bGVfdHlwZTogc3RyaW5nXG4gIG1ldHJpYzogR29hbE1ldHJpY1xuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjb25maWc6IENvbHVtblR5cGU8R29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZywgc3RyaW5nIHwgR29hbENvbmZpZz5cbiAgc3RhdHVzOiBHb2FsU3RhdHVzXG4gIHJlY3VycmVuY2U6IENvbHVtblR5cGU8XG4gICAgR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxSZWN1cnJlbmNlQ29uZmlnIHwgbnVsbCxcbiAgICBzdHJpbmcgfCBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGxcbiAgPlxuICBkZWFkbGluZTogQ29sdW1uVHlwZTxcbiAgICBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsLFxuICAgIHN0cmluZyB8IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gICAgc3RyaW5nIHwgR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbFxuICA+XG4gIHByaW9yaXR5OiBudW1iZXJcbiAgc29ydF9vcmRlcjogbnVtYmVyXG4gIC8qKiBFZmZlY3RpdmUgc3RhcnQgb2YgdGhlIGdvYWwgKHNlZWRzIGN5Y2xlIDApLiBBbHdheXMgc2V0LiAqL1xuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbExpbmtUeXBlID0gJ2FjdGl2aXR5JyB8ICdncm91cCdcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTGlua3NUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgbGlua190eXBlOiBHb2FsTGlua1R5cGVcbiAgYWN0aXZpdHlfaWQ6IG51bWJlciB8IG51bGxcbiAgZ3JvdXBfaWQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGVTdGF0dXMgPSAnYWN0aXZlJyB8ICdzdWNjZWVkZWQnIHwgJ2ZhaWxlZCcgfCAnbWlzc2VkJ1xuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxDeWNsZXNUYWJsZSB7XG4gIGlkOiBHZW5lcmF0ZWQ8bnVtYmVyPlxuICBnb2FsX2lkOiBudW1iZXJcbiAgY3ljbGVfaW5kZXg6IG51bWJlclxuICBzdGFydHNfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nLCBzdHJpbmc+XG4gIGVuZHNfYXQ6IENvbHVtblR5cGU8RGF0ZSB8IG51bGwsIHN0cmluZyB8IG51bGwsIHN0cmluZyB8IG51bGw+XG4gIGRlYWRsaW5lX2F0OiBDb2x1bW5UeXBlPERhdGUgfCBudWxsLCBzdHJpbmcgfCBudWxsLCBzdHJpbmcgfCBudWxsPlxuICB0YXJnZXRfdmFsdWU6IG51bWJlclxuICBjdXJyZW50X3ZhbHVlOiBudW1iZXJcbiAgc3RhdHVzOiBHb2FsQ3ljbGVTdGF0dXNcbiAgY2Fycnlfb3ZlcjogbnVtYmVyXG4gIGNyZWF0ZWRfYXQ6IENvbHVtblR5cGU8RGF0ZSwgc3RyaW5nIHwgdW5kZWZpbmVkLCBuZXZlcj5cbiAgdXBkYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcsIHN0cmluZz5cbn1cblxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudCA9ICdjb21wbGV0ZScgfCAncHJvZ3Jlc3MnXG5cbmV4cG9ydCBpbnRlcmZhY2UgR29hbERlcGVuZGVuY2llc1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfaWQ6IG51bWJlclxuICBkZXBlbmRzX29uX2dvYWxfaWQ6IG51bWJlclxuICByZXF1aXJlbWVudDogR29hbERlcGVuZGVuY3lSZXF1aXJlbWVudFxuICB0aHJlc2hvbGQ6IG51bWJlciB8IG51bGxcbiAgd2VpZ2h0OiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlIHtcbiAgaWQ6IEdlbmVyYXRlZDxudW1iZXI+XG4gIGdvYWxfY3ljbGVfaWQ6IG51bWJlclxuICBhc19vZjogc3RyaW5nXG4gIHZhbHVlOiBudW1iZXJcbiAgY3JlYXRlZF9hdDogQ29sdW1uVHlwZTxEYXRlLCBzdHJpbmcgfCB1bmRlZmluZWQsIG5ldmVyPlxufVxuXG4vLyBFeHBvcnQgY29udmVuaWVuY2UgdHlwZXMgZm9yIGVhY2ggdGFibGVcbmV4cG9ydCB0eXBlIFVzZXIgPSBTZWxlY3RhYmxlPFVzZXJzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdVc2VyID0gSW5zZXJ0YWJsZTxVc2Vyc1RhYmxlPlxuZXhwb3J0IHR5cGUgVXNlclVwZGF0ZSA9IFVwZGF0ZWFibGU8VXNlcnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR3JvdXAgPSBTZWxlY3RhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R3JvdXAgPSBJbnNlcnRhYmxlPEdyb3Vwc1RhYmxlPlxuZXhwb3J0IHR5cGUgR3JvdXBVcGRhdGUgPSBVcGRhdGVhYmxlPEdyb3Vwc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBBY3Rpdml0eSA9IFNlbGVjdGFibGU8QWN0aXZpdGllc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3QWN0aXZpdHkgPSBJbnNlcnRhYmxlPEFjdGl2aXRpZXNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5VXBkYXRlID0gVXBkYXRlYWJsZTxBY3Rpdml0aWVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuID0gU2VsZWN0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld1JlY3VycmVuY2VQYXR0ZXJuID0gSW5zZXJ0YWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cbmV4cG9ydCB0eXBlIFJlY3VycmVuY2VQYXR0ZXJuVXBkYXRlID0gVXBkYXRlYWJsZTxSZWN1cnJlbmNlUGF0dGVybnNUYWJsZT5cblxuZXhwb3J0IHR5cGUgQWN0aXZpdHlDb21wbGV0aW9uID0gU2VsZWN0YWJsZTxBY3Rpdml0eUNvbXBsZXRpb25zVGFibGU+XG5leHBvcnQgdHlwZSBOZXdBY3Rpdml0eUNvbXBsZXRpb24gPSBJbnNlcnRhYmxlPEFjdGl2aXR5Q29tcGxldGlvbnNUYWJsZT5cbmV4cG9ydCB0eXBlIEFjdGl2aXR5Q29tcGxldGlvblVwZGF0ZSA9IFVwZGF0ZWFibGU8QWN0aXZpdHlDb21wbGV0aW9uc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsRXZlbnQgPSBTZWxlY3RhYmxlPEdvYWxFdmVudHNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxFdmVudCA9IEluc2VydGFibGU8R29hbEV2ZW50c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEV2ZW50VXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsRXZlbnRzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWwgPSBTZWxlY3RhYmxlPEdvYWxzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsID0gSW5zZXJ0YWJsZTxHb2Fsc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFVwZGF0ZSA9IFVwZGF0ZWFibGU8R29hbHNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbExpbmsgPSBTZWxlY3RhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbExpbmsgPSBJbnNlcnRhYmxlPEdvYWxMaW5rc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbExpbmtVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxMaW5rc1RhYmxlPlxuXG5leHBvcnQgdHlwZSBHb2FsQ3ljbGUgPSBTZWxlY3RhYmxlPEdvYWxDeWNsZXNUYWJsZT5cbmV4cG9ydCB0eXBlIE5ld0dvYWxDeWNsZSA9IEluc2VydGFibGU8R29hbEN5Y2xlc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbEN5Y2xlVXBkYXRlID0gVXBkYXRlYWJsZTxHb2FsQ3ljbGVzVGFibGU+XG5cbmV4cG9ydCB0eXBlIEdvYWxEZXBlbmRlbmN5ID0gU2VsZWN0YWJsZTxHb2FsRGVwZW5kZW5jaWVzVGFibGU+XG5leHBvcnQgdHlwZSBOZXdHb2FsRGVwZW5kZW5jeSA9IEluc2VydGFibGU8R29hbERlcGVuZGVuY2llc1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbERlcGVuZGVuY3lVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxEZXBlbmRlbmNpZXNUYWJsZT5cblxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3QgPSBTZWxlY3RhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgTmV3R29hbFByb2dyZXNzU25hcHNob3QgPSBJbnNlcnRhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuZXhwb3J0IHR5cGUgR29hbFByb2dyZXNzU25hcHNob3RVcGRhdGUgPSBVcGRhdGVhYmxlPEdvYWxQcm9ncmVzc1NuYXBzaG90c1RhYmxlPlxuIiwgImltcG9ydCB7IERhdGFiYXNlIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBQb29sIH0gZnJvbSAncGcnXG5pbXBvcnQgeyBLeXNlbHksIFBvc3RncmVzRGlhbGVjdCB9IGZyb20gJ2t5c2VseSdcblxuY29uc3QgZGlhbGVjdCA9IG5ldyBQb3N0Z3Jlc0RpYWxlY3Qoe1xuICBwb29sOiBuZXcgUG9vbCh7XG4gICAgZGF0YWJhc2U6ICd0aW1lbWFuYWdlcicsXG4gICAgaG9zdDogJ2xvY2FsaG9zdCcsXG4gICAgdXNlcjogJ3Bvc3RncmVzJyxcbiAgICBwYXNzd29yZDogJ3Rlc3QxMjM0JyxcbiAgICBwb3J0OiA1NDMyLFxuICAgIG1heDogMTAsXG4gIH0pXG59KVxuXG4vLyBEYXRhYmFzZSBpbnRlcmZhY2UgaXMgcGFzc2VkIHRvIEt5c2VseSdzIGNvbnN0cnVjdG9yLCBhbmQgZnJvbSBub3cgb24sIEt5c2VseSBcbi8vIGtub3dzIHlvdXIgZGF0YWJhc2Ugc3RydWN0dXJlLlxuLy8gRGlhbGVjdCBpcyBwYXNzZWQgdG8gS3lzZWx5J3MgY29uc3RydWN0b3IsIGFuZCBmcm9tIG5vdyBvbiwgS3lzZWx5IGtub3dzIGhvdyBcbi8vIHRvIGNvbW11bmljYXRlIHdpdGggeW91ciBkYXRhYmFzZS5cbmV4cG9ydCBjb25zdCBkYiA9IG5ldyBLeXNlbHk8RGF0YWJhc2U+KHtcbiAgZGlhbGVjdCxcbn0pIiwgImltcG9ydCB0eXBlIHsgR29hbCwgR29hbEN5Y2xlIH0gZnJvbSAnLi4vZGIvdHlwZXMvc2NoZW1hLnRzJ1xuXG5leHBvcnQgdHlwZSBHb2FsTGlmZWN5Y2xlUGhhc2UgPVxuICB8ICdzY2hlZHVsZWQnXG4gIHwgJ2FjdGl2ZSdcbiAgfCAncGF1c2VkJ1xuICB8ICdjb21wbGV0ZWQnXG4gIHwgJ2FyY2hpdmVkJ1xuICB8ICdmYWlsZWQnXG5cbi8qKiBEZXJpdmVkIFVJL0FQSSBwaGFzZSBcdTIwMTQgc2NoZWR1bGVkIGlzIG5vdCBhIHN0b3JlZCBzdGF0dXMuICovXG5leHBvcnQgZnVuY3Rpb24gbGlmZWN5Y2xlUGhhc2UoXG4gIGdvYWw6IFBpY2s8R29hbCwgJ3N0YXR1cycgfCAnc3RhcnRzX2F0Jz4sXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBHb2FsTGlmZWN5Y2xlUGhhc2Uge1xuICBpZiAoZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnKSByZXR1cm4gJ3BhdXNlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnY29tcGxldGVkJykgcmV0dXJuICdjb21wbGV0ZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2FyY2hpdmVkJykgcmV0dXJuICdhcmNoaXZlZCdcbiAgaWYgKGdvYWwuc3RhdHVzID09PSAnZmFpbGVkJykgcmV0dXJuICdmYWlsZWQnXG4gIGlmIChnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScgJiYgbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpID4gbm93KSB7XG4gICAgcmV0dXJuICdzY2hlZHVsZWQnXG4gIH1cbiAgcmV0dXJuICdhY3RpdmUnXG59XG5cbi8qKiBUcnVlIHdoZW4gdGhlIGN5Y2xlIGV2YWx1YXRpb24gd2luZG93IGhhcyBiZWd1bi4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjeWNsZUhhc1N0YXJ0ZWQoXG4gIGN5Y2xlOiBQaWNrPEdvYWxDeWNsZSwgJ3N0YXJ0c19hdCc+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogYm9vbGVhbiB7XG4gIHJldHVybiBub3cgPj0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KVxufVxuIiwgImltcG9ydCB0eXBlIHtcbiAgR29hbCxcbiAgR29hbEN5Y2xlLFxuICBHb2FsRXZlbnQsXG4gIEdvYWxMaW5rLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZhbHVhdGVSZXN1bHQge1xuICBjdXJyZW50VmFsdWU6IG51bWJlclxuICBkb25lOiBib29sZWFuXG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgRXZhbHVhdGVDb250ZXh0IHtcbiAgZ29hbDogR29hbFxuICBjeWNsZTogR29hbEN5Y2xlXG4gIGxpbmtzOiBHb2FsTGlua1tdXG4gIGV2ZW50czogR29hbEV2ZW50W11cbiAgLyoqIEFjdGl2ZSAob3IgbGF0ZXN0KSBjaGlsZCBjeWNsZXMga2V5ZWQgYnkgY2hpbGQgZ29hbCBpZCwgZm9yIGNvbXBvc2l0ZXMuICovXG4gIGNoaWxkQ3ljbGVzPzogTWFwPG51bWJlciwgR29hbEN5Y2xlPlxuICAvKiogQ2hpbGQgZGVwZW5kZW5jeSB3ZWlnaHRzIGtleWVkIGJ5IGNoaWxkIGdvYWwgaWQuICovXG4gIGNoaWxkV2VpZ2h0cz86IE1hcDxudW1iZXIsIG51bWJlcj5cbiAgLyoqIEZvciBncm91cF9hbGxfY29tcGxldGU6IGFjdGl2aXR5IGlkcyB0aGF0IGJlbG9uZyB0byBsaW5rZWQgZ3JvdXBzLiAqL1xuICBncm91cEFjdGl2aXR5SWRzPzogbnVtYmVyW11cbn1cblxuZXhwb3J0IGludGVyZmFjZSBHb2FsRXZhbHVhdG9yIHtcbiAgcnVsZVR5cGU6IHN0cmluZ1xuICBldmFsdWF0ZShjdHg6IEV2YWx1YXRlQ29udGV4dCk6IEV2YWx1YXRlUmVzdWx0XG59XG5cbi8qKiBEZWR1cGxpY2F0ZSBldmVudHMgYnkgKGFjdGl2aXR5X2lkLCBvY2N1cnJlbmNlX2RhdGUpLCBwcmVmZXJyaW5nIGZpcnN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZHVwZUV2ZW50cyhldmVudHM6IEdvYWxFdmVudFtdKTogR29hbEV2ZW50W10ge1xuICBjb25zdCBzZWVuID0gbmV3IFNldDxzdHJpbmc+KClcbiAgY29uc3Qgb3V0OiBHb2FsRXZlbnRbXSA9IFtdXG4gIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XG4gICAgY29uc3Qga2V5ID0gZXZlbnQuYWN0aXZpdHlfaWQgIT0gbnVsbCAmJiBldmVudC5vY2N1cnJlbmNlX2RhdGVcbiAgICAgID8gYCR7ZXZlbnQuYWN0aXZpdHlfaWR9OiR7ZXZlbnQub2NjdXJyZW5jZV9kYXRlfToke2V2ZW50Lm1ldHJpY31gXG4gICAgICA6IGBpZDoke2V2ZW50LmlkfWBcbiAgICBpZiAoc2Vlbi5oYXMoa2V5KSkgY29udGludWVcbiAgICBzZWVuLmFkZChrZXkpXG4gICAgb3V0LnB1c2goZXZlbnQpXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiBldmVudHNJbldpbmRvdyhldmVudHM6IEdvYWxFdmVudFtdLCBjeWNsZTogR29hbEN5Y2xlKTogR29hbEV2ZW50W10ge1xuICBjb25zdCBzdGFydCA9IG5ldyBEYXRlKGN5Y2xlLnN0YXJ0c19hdCkuZ2V0VGltZSgpXG4gIGNvbnN0IGVuZCA9IGN5Y2xlLmVuZHNfYXQgPyBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KS5nZXRUaW1lKCkgOiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFlcbiAgcmV0dXJuIGV2ZW50cy5maWx0ZXIoKGUpID0+IHtcbiAgICBjb25zdCB0ID0gbmV3IERhdGUoZS5vY2N1cnJlZF9hdCkuZ2V0VGltZSgpXG4gICAgcmV0dXJuIHQgPj0gc3RhcnQgJiYgdCA8IGVuZFxuICB9KVxufVxuXG5mdW5jdGlvbiBsaW5rZWRBY3Rpdml0eUlkcyhsaW5rczogR29hbExpbmtbXSk6IFNldDxudW1iZXI+IHtcbiAgcmV0dXJuIG5ldyBTZXQoXG4gICAgbGlua3NcbiAgICAgIC5maWx0ZXIoKGwpID0+IGwubGlua190eXBlID09PSAnYWN0aXZpdHknICYmIGwuYWN0aXZpdHlfaWQgIT0gbnVsbClcbiAgICAgIC5tYXAoKGwpID0+IGwuYWN0aXZpdHlfaWQhKSxcbiAgKVxufVxuXG5mdW5jdGlvbiBsaW5rZWRHcm91cElkcyhsaW5rczogR29hbExpbmtbXSk6IFNldDxudW1iZXI+IHtcbiAgcmV0dXJuIG5ldyBTZXQoXG4gICAgbGlua3NcbiAgICAgIC5maWx0ZXIoKGwpID0+IGwubGlua190eXBlID09PSAnZ3JvdXAnICYmIGwuZ3JvdXBfaWQgIT0gbnVsbClcbiAgICAgIC5tYXAoKGwpID0+IGwuZ3JvdXBfaWQhKSxcbiAgKVxufVxuXG5mdW5jdGlvbiB3ZWlnaHRGb3JFdmVudChldmVudDogR29hbEV2ZW50LCBsaW5rczogR29hbExpbmtbXSk6IG51bWJlciB7XG4gIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xuICAgIGlmIChcbiAgICAgIGxpbmsubGlua190eXBlID09PSAnYWN0aXZpdHknICYmXG4gICAgICBsaW5rLmFjdGl2aXR5X2lkICE9IG51bGwgJiZcbiAgICAgIGV2ZW50LmFjdGl2aXR5X2lkID09PSBsaW5rLmFjdGl2aXR5X2lkXG4gICAgKSB7XG4gICAgICByZXR1cm4gTnVtYmVyKGxpbmsud2VpZ2h0KVxuICAgIH1cbiAgICBpZiAoXG4gICAgICBsaW5rLmxpbmtfdHlwZSA9PT0gJ2dyb3VwJyAmJlxuICAgICAgbGluay5ncm91cF9pZCAhPSBudWxsICYmXG4gICAgICBldmVudC5ncm91cF9pZCA9PT0gbGluay5ncm91cF9pZFxuICAgICkge1xuICAgICAgcmV0dXJuIE51bWJlcihsaW5rLndlaWdodClcbiAgICB9XG4gIH1cbiAgcmV0dXJuIDFcbn1cblxuZnVuY3Rpb24gbWF0Y2hlc0xpbmtzKGV2ZW50OiBHb2FsRXZlbnQsIGxpbmtzOiBHb2FsTGlua1tdKTogYm9vbGVhbiB7XG4gIGNvbnN0IGFjdGl2aXRpZXMgPSBsaW5rZWRBY3Rpdml0eUlkcyhsaW5rcylcbiAgY29uc3QgZ3JvdXBzID0gbGlua2VkR3JvdXBJZHMobGlua3MpXG4gIGlmIChhY3Rpdml0aWVzLnNpemUgPT09IDAgJiYgZ3JvdXBzLnNpemUgPT09IDApIHJldHVybiBmYWxzZVxuICBpZiAoZXZlbnQuYWN0aXZpdHlfaWQgIT0gbnVsbCAmJiBhY3Rpdml0aWVzLmhhcyhldmVudC5hY3Rpdml0eV9pZCkpIHJldHVybiB0cnVlXG4gIGlmIChldmVudC5ncm91cF9pZCAhPSBudWxsICYmIGdyb3Vwcy5oYXMoZXZlbnQuZ3JvdXBfaWQpKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gZmFsc2Vcbn1cblxuZnVuY3Rpb24gc3VtV2VpZ2h0ZWQoXG4gIGV2ZW50czogR29hbEV2ZW50W10sXG4gIGxpbmtzOiBHb2FsTGlua1tdLFxuICBtZXRyaWM6ICdjb3VudCcgfCAnZHVyYXRpb24nLFxuKTogbnVtYmVyIHtcbiAgbGV0IHRvdGFsID0gMFxuICBmb3IgKGNvbnN0IGV2ZW50IG9mIGRlZHVwZUV2ZW50cyhldmVudHMpKSB7XG4gICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gbWV0cmljKSBjb250aW51ZVxuICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBsaW5rcykpIGNvbnRpbnVlXG4gICAgdG90YWwgKz0gTnVtYmVyKGV2ZW50LmFtb3VudCkgKiB3ZWlnaHRGb3JFdmVudChldmVudCwgbGlua3MpXG4gIH1cbiAgcmV0dXJuIHRvdGFsXG59XG5cbmZ1bmN0aW9uIHdpdGhDYXJyeU92ZXIodmFsdWU6IG51bWJlciwgY3ljbGU6IEdvYWxDeWNsZSk6IG51bWJlciB7XG4gIHJldHVybiBNYXRoLm1heCgwLCB2YWx1ZSArIE51bWJlcihjeWNsZS5jYXJyeV9vdmVyIHx8IDApKVxufVxuXG5mdW5jdGlvbiByZXN1bHQodmFsdWU6IG51bWJlciwgdGFyZ2V0OiBudW1iZXIpOiBFdmFsdWF0ZVJlc3VsdCB7XG4gIGNvbnN0IGN1cnJlbnRWYWx1ZSA9IE1hdGgubWF4KDAsIHZhbHVlKVxuICByZXR1cm4ge1xuICAgIGN1cnJlbnRWYWx1ZSxcbiAgICBkb25lOiB0YXJnZXQgPiAwID8gY3VycmVudFZhbHVlID49IHRhcmdldCA6IGN1cnJlbnRWYWx1ZSA+IDAsXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IGFjdGl2aXR5Q291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnYWN0aXZpdHlfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnY291bnQnKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgYWN0aXZpdHlEdXJhdGlvbkV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdhY3Rpdml0eV9kdXJhdGlvbicsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IHZhbHVlID0gd2l0aENhcnJ5T3ZlcihcbiAgICAgIHN1bVdlaWdodGVkKHdpbmRvd2VkLCBjdHgubGlua3MsICdkdXJhdGlvbicpLFxuICAgICAgY3R4LmN5Y2xlLFxuICAgIClcbiAgICByZXR1cm4gcmVzdWx0KHZhbHVlLCBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gIH0sXG59XG5cbmV4cG9ydCBjb25zdCBncm91cER1cmF0aW9uRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2R1cmF0aW9uJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgc3VtV2VpZ2h0ZWQod2luZG93ZWQsIGN0eC5saW5rcywgJ2R1cmF0aW9uJyksXG4gICAgICBjdHguY3ljbGUsXG4gICAgKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGdyb3VwQ291bnRFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnZ3JvdXBfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCB3aW5kb3dlZCA9IGV2ZW50c0luV2luZG93KGN0eC5ldmVudHMsIGN0eC5jeWNsZSlcbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoXG4gICAgICBzdW1XZWlnaHRlZCh3aW5kb3dlZCwgY3R4LmxpbmtzLCAnY291bnQnKSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG4vKiogQ291bnQgY29tcGxldGlvbnMgb2YgYW55IGFjdGl2aXR5IGluIGxpbmtlZCBncm91cHMuICovXG5leHBvcnQgY29uc3QgZ3JvdXBBbnlDb3VudEV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdncm91cF9hbnlfY291bnQnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICByZXR1cm4gZ3JvdXBDb3VudEV2YWx1YXRvci5ldmFsdWF0ZShjdHgpXG4gIH0sXG59XG5cbi8qKlxuICogUHJvZ3Jlc3MgPSBudW1iZXIgb2YgZGlzdGluY3QgbGlua2VkLWdyb3VwIGFjdGl2aXRpZXMgY29tcGxldGVkIGF0IGxlYXN0XG4gKiBvbmNlIGluIHRoZSBjeWNsZS4gVGFyZ2V0IGlzIHR5cGljYWxseSB0aGUgc2l6ZSBvZiB0aGUgZ3JvdXAuXG4gKi9cbmV4cG9ydCBjb25zdCBncm91cEFsbENvbXBsZXRlRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ2dyb3VwX2FsbF9jb21wbGV0ZScsXG4gIGV2YWx1YXRlKGN0eCkge1xuICAgIGNvbnN0IHdpbmRvd2VkID0gZXZlbnRzSW5XaW5kb3coY3R4LmV2ZW50cywgY3R4LmN5Y2xlKVxuICAgIGNvbnN0IGFjdGl2aXR5SWRzID0gbmV3IFNldChjdHguZ3JvdXBBY3Rpdml0eUlkcyA/PyBbXSlcbiAgICBjb25zdCBjb21wbGV0ZWQgPSBuZXcgU2V0PG51bWJlcj4oKVxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKHdpbmRvd2VkKSkge1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gJ2NvdW50JykgY29udGludWVcbiAgICAgIGlmIChldmVudC5hY3Rpdml0eV9pZCA9PSBudWxsKSBjb250aW51ZVxuICAgICAgaWYgKGFjdGl2aXR5SWRzLnNpemUgPiAwICYmICFhY3Rpdml0eUlkcy5oYXMoZXZlbnQuYWN0aXZpdHlfaWQpKSBjb250aW51ZVxuICAgICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykgJiYgYWN0aXZpdHlJZHMuc2l6ZSA9PT0gMCkgY29udGludWVcbiAgICAgIGlmIChhY3Rpdml0eUlkcy5zaXplID4gMCB8fCBtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykpIHtcbiAgICAgICAgY29tcGxldGVkLmFkZChldmVudC5hY3Rpdml0eV9pZClcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gUHJlZmVyIGNvdW50aW5nIG9ubHkgYWN0aXZpdGllcyB0aGF0IGJlbG9uZyB0byB0aGUgZ3JvdXAuXG4gICAgY29uc3QgdmFsdWUgPSB3aXRoQ2FycnlPdmVyKFxuICAgICAgYWN0aXZpdHlJZHMuc2l6ZSA+IDBcbiAgICAgICAgPyBbLi4uY29tcGxldGVkXS5maWx0ZXIoKGlkKSA9PiBhY3Rpdml0eUlkcy5oYXMoaWQpKS5sZW5ndGhcbiAgICAgICAgOiBjb21wbGV0ZWQuc2l6ZSxcbiAgICAgIGN0eC5jeWNsZSxcbiAgICApXG4gICAgcmV0dXJuIHJlc3VsdCh2YWx1ZSwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICB9LFxufVxuXG5leHBvcnQgY29uc3QgbXVsdGlBY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ211bHRpX2FjdGl2aXR5X2R1cmF0aW9uJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgcmV0dXJuIGFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3IuZXZhbHVhdGUoY3R4KVxuICB9LFxufVxuXG4vKiogQ29uc2VjdXRpdmUgY2FsZW5kYXIgZGF5cyB3aXRoIGF0IGxlYXN0IG9uZSBtYXRjaGluZyBjb3VudCBldmVudC4gKi9cbmV4cG9ydCBjb25zdCBzdHJlYWtFdmFsdWF0b3I6IEdvYWxFdmFsdWF0b3IgPSB7XG4gIHJ1bGVUeXBlOiAnc3RyZWFrJyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgY29uc3QgZGF5cyA9IG5ldyBTZXQ8c3RyaW5nPigpXG4gICAgZm9yIChjb25zdCBldmVudCBvZiBkZWR1cGVFdmVudHMod2luZG93ZWQpKSB7XG4gICAgICBpZiAoZXZlbnQubWV0cmljICE9PSAnY291bnQnKSBjb250aW51ZVxuICAgICAgaWYgKCFtYXRjaGVzTGlua3MoZXZlbnQsIGN0eC5saW5rcykpIGNvbnRpbnVlXG4gICAgICBjb25zdCBkYXkgPSBldmVudC5vY2N1cnJlbmNlX2RhdGUgPz9cbiAgICAgICAgbmV3IERhdGUoZXZlbnQub2NjdXJyZWRfYXQpLnRvSVNPU3RyaW5nKCkuc2xpY2UoMCwgMTApXG4gICAgICBkYXlzLmFkZChkYXkpXG4gICAgfVxuICAgIGNvbnN0IHNvcnRlZCA9IFsuLi5kYXlzXS5zb3J0KClcbiAgICBsZXQgYmVzdCA9IDBcbiAgICBsZXQgcnVuID0gMFxuICAgIGxldCBwcmV2OiBzdHJpbmcgfCBudWxsID0gbnVsbFxuICAgIGZvciAoY29uc3QgZGF5IG9mIHNvcnRlZCkge1xuICAgICAgaWYgKHByZXYpIHtcbiAgICAgICAgY29uc3QgcHJldkRhdGUgPSBuZXcgRGF0ZShwcmV2ICsgJ1QwMDowMDowMFonKVxuICAgICAgICBjb25zdCBjdXJEYXRlID0gbmV3IERhdGUoZGF5ICsgJ1QwMDowMDowMFonKVxuICAgICAgICBjb25zdCBkaWZmID0gKGN1ckRhdGUuZ2V0VGltZSgpIC0gcHJldkRhdGUuZ2V0VGltZSgpKSAvIDg2XzQwMF8wMDBcbiAgICAgICAgcnVuID0gZGlmZiA9PT0gMSA/IHJ1biArIDEgOiAxXG4gICAgICB9IGVsc2Uge1xuICAgICAgICBydW4gPSAxXG4gICAgICB9XG4gICAgICBiZXN0ID0gTWF0aC5tYXgoYmVzdCwgcnVuKVxuICAgICAgcHJldiA9IGRheVxuICAgIH1cbiAgICBjb25zdCB2YWx1ZSA9IHdpdGhDYXJyeU92ZXIoYmVzdCwgY3R4LmN5Y2xlKVxuICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuLyoqIENvdW50IGNvbXBsZXRpb25zIHdob3NlIG9jY3VycmVuY2UgbG9jYWwgdGltZSBpcyBiZWZvcmUgY29uZmlnLmJlZm9yZV90aW1lLiAqL1xuZXhwb3J0IGNvbnN0IHRpbWVPZkRheUNvdW50RXZhbHVhdG9yOiBHb2FsRXZhbHVhdG9yID0ge1xuICBydWxlVHlwZTogJ3RpbWVfb2ZfZGF5X2NvdW50JyxcbiAgZXZhbHVhdGUoY3R4KSB7XG4gICAgY29uc3QgY29uZmlnID0gdHlwZW9mIGN0eC5nb2FsLmNvbmZpZyA9PT0gJ3N0cmluZydcbiAgICAgID8gSlNPTi5wYXJzZShjdHguZ29hbC5jb25maWcpXG4gICAgICA6IChjdHguZ29hbC5jb25maWcgPz8ge30pXG4gICAgY29uc3QgYmVmb3JlID0gdHlwZW9mIGNvbmZpZy5iZWZvcmVfdGltZSA9PT0gJ3N0cmluZycgPyBjb25maWcuYmVmb3JlX3RpbWUgOiBudWxsXG4gICAgY29uc3QgYWZ0ZXIgPSB0eXBlb2YgY29uZmlnLmFmdGVyX3RpbWUgPT09ICdzdHJpbmcnID8gY29uZmlnLmFmdGVyX3RpbWUgOiBudWxsXG4gICAgY29uc3Qgd2luZG93ZWQgPSBldmVudHNJbldpbmRvdyhjdHguZXZlbnRzLCBjdHguY3ljbGUpXG4gICAgbGV0IHRvdGFsID0gMFxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZGVkdXBlRXZlbnRzKHdpbmRvd2VkKSkge1xuICAgICAgaWYgKGV2ZW50Lm1ldHJpYyAhPT0gJ2NvdW50JykgY29udGludWVcbiAgICAgIGlmICghbWF0Y2hlc0xpbmtzKGV2ZW50LCBjdHgubGlua3MpKSBjb250aW51ZVxuICAgICAgY29uc3QgaGhtbSA9IG5ldyBEYXRlKGV2ZW50Lm9jY3VycmVkX2F0KS50b0lTT1N0cmluZygpLnNsaWNlKDExLCAxNilcbiAgICAgIGlmIChiZWZvcmUgJiYgaGhtbSA+PSBiZWZvcmUpIGNvbnRpbnVlXG4gICAgICBpZiAoYWZ0ZXIgJiYgaGhtbSA8IGFmdGVyKSBjb250aW51ZVxuICAgICAgdG90YWwgKz0gTnVtYmVyKGV2ZW50LmFtb3VudCkgKiB3ZWlnaHRGb3JFdmVudChldmVudCwgY3R4LmxpbmtzKVxuICAgIH1cbiAgICByZXR1cm4gcmVzdWx0KHdpdGhDYXJyeU92ZXIodG90YWwsIGN0eC5jeWNsZSksIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IGNvbXBvc2l0ZUV2YWx1YXRvcjogR29hbEV2YWx1YXRvciA9IHtcbiAgcnVsZVR5cGU6ICdjb21wb3NpdGUnLFxuICBldmFsdWF0ZShjdHgpIHtcbiAgICBjb25zdCBjb25maWcgPSB0eXBlb2YgY3R4LmdvYWwuY29uZmlnID09PSAnc3RyaW5nJ1xuICAgICAgPyBKU09OLnBhcnNlKGN0eC5nb2FsLmNvbmZpZylcbiAgICAgIDogKGN0eC5nb2FsLmNvbmZpZyA/PyB7fSlcbiAgICBjb25zdCBtb2RlID0gY29uZmlnLmNvbXBvc2l0ZV9tb2RlID8/ICdhbGwnXG4gICAgY29uc3QgY2hpbGRyZW4gPSBjdHguY2hpbGRDeWNsZXNcbiAgICBpZiAoIWNoaWxkcmVuIHx8IGNoaWxkcmVuLnNpemUgPT09IDApIHtcbiAgICAgIHJldHVybiByZXN1bHQoMCwgTnVtYmVyKGN0eC5jeWNsZS50YXJnZXRfdmFsdWUpKVxuICAgIH1cblxuICAgIGNvbnN0IGVudHJpZXMgPSBbLi4uY2hpbGRyZW4uZW50cmllcygpXVxuICAgIGlmIChtb2RlID09PSAnd2VpZ2h0ZWQnKSB7XG4gICAgICBsZXQgd2VpZ2h0ZWRTdW0gPSAwXG4gICAgICBsZXQgd2VpZ2h0VG90YWwgPSAwXG4gICAgICBmb3IgKGNvbnN0IFtjaGlsZElkLCBjeWNsZV0gb2YgZW50cmllcykge1xuICAgICAgICBjb25zdCB3ID0gTnVtYmVyKGN0eC5jaGlsZFdlaWdodHM/LmdldChjaGlsZElkKSA/PyAxKVxuICAgICAgICBjb25zdCBwcm9ncmVzcyA9IE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMFxuICAgICAgICAgID8gTWF0aC5taW4oMSwgTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpIC8gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgICAgICAgOiAoY3ljbGUuc3RhdHVzID09PSAnc3VjY2VlZGVkJyA/IDEgOiAwKVxuICAgICAgICB3ZWlnaHRlZFN1bSArPSBwcm9ncmVzcyAqIHdcbiAgICAgICAgd2VpZ2h0VG90YWwgKz0gd1xuICAgICAgfVxuICAgICAgY29uc3QgcGN0ID0gd2VpZ2h0VG90YWwgPiAwID8gd2VpZ2h0ZWRTdW0gLyB3ZWlnaHRUb3RhbCA6IDBcbiAgICAgIC8vIFJlcHJlc2VudCBhcyAwXHUyMDEzMTAwIHBlcmNlbnQgb2YgdGFyZ2V0LlxuICAgICAgY29uc3QgdmFsdWUgPSBwY3QgKiBOdW1iZXIoY3R4LmN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIHJldHVybiByZXN1bHQodmFsdWUsIE51bWJlcihjdHguY3ljbGUudGFyZ2V0X3ZhbHVlKSlcbiAgICB9XG5cbiAgICBjb25zdCBjb21wbGV0ZWQgPSBlbnRyaWVzLmZpbHRlcigoWywgY10pID0+XG4gICAgICBjLnN0YXR1cyA9PT0gJ3N1Y2NlZWRlZCcgfHxcbiAgICAgIChOdW1iZXIoYy50YXJnZXRfdmFsdWUpID4gMCAmJiBOdW1iZXIoYy5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoYy50YXJnZXRfdmFsdWUpKVxuICAgICkubGVuZ3RoXG5cbiAgICBpZiAobW9kZSA9PT0gJ2FueScpIHtcbiAgICAgIGNvbnN0IG5lZWRlZCA9IE1hdGgubWF4KDEsIE51bWJlcihjb25maWcuY291bnRfcmVxdWlyZWQgPz8gMSkpXG4gICAgICByZXR1cm4gcmVzdWx0KGNvbXBsZXRlZCwgbmVlZGVkKVxuICAgIH1cblxuICAgIC8vIGFsbFxuICAgIHJldHVybiByZXN1bHQoY29tcGxldGVkLCBlbnRyaWVzLmxlbmd0aClcbiAgfSxcbn1cblxuY29uc3QgRVZBTFVBVE9SUzogR29hbEV2YWx1YXRvcltdID0gW1xuICBhY3Rpdml0eUNvdW50RXZhbHVhdG9yLFxuICBhY3Rpdml0eUR1cmF0aW9uRXZhbHVhdG9yLFxuICBncm91cER1cmF0aW9uRXZhbHVhdG9yLFxuICBncm91cENvdW50RXZhbHVhdG9yLFxuICBncm91cEFueUNvdW50RXZhbHVhdG9yLFxuICBncm91cEFsbENvbXBsZXRlRXZhbHVhdG9yLFxuICBtdWx0aUFjdGl2aXR5RHVyYXRpb25FdmFsdWF0b3IsXG4gIHN0cmVha0V2YWx1YXRvcixcbiAgdGltZU9mRGF5Q291bnRFdmFsdWF0b3IsXG4gIGNvbXBvc2l0ZUV2YWx1YXRvcixcbl1cblxuY29uc3QgUkVHSVNUUlkgPSBuZXcgTWFwKEVWQUxVQVRPUlMubWFwKChlKSA9PiBbZS5ydWxlVHlwZSwgZV0pKVxuXG5leHBvcnQgY29uc3QgR09BTF9SVUxFX1RZUEVTID0gRVZBTFVBVE9SUy5tYXAoKGUpID0+IGUucnVsZVR5cGUpXG5cbmV4cG9ydCBmdW5jdGlvbiBnZXRFdmFsdWF0b3IocnVsZVR5cGU6IHN0cmluZyk6IEdvYWxFdmFsdWF0b3Ige1xuICBjb25zdCBldmFsdWF0b3IgPSBSRUdJU1RSWS5nZXQocnVsZVR5cGUpXG4gIGlmICghZXZhbHVhdG9yKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIGdvYWwgcnVsZV90eXBlOiAke3J1bGVUeXBlfWApXG4gIH1cbiAgcmV0dXJuIGV2YWx1YXRvclxufVxuXG5leHBvcnQgZnVuY3Rpb24gZXZhbHVhdGVHb2FsKGN0eDogRXZhbHVhdGVDb250ZXh0KTogRXZhbHVhdGVSZXN1bHQge1xuICByZXR1cm4gZ2V0RXZhbHVhdG9yKGN0eC5nb2FsLnJ1bGVfdHlwZSkuZXZhbHVhdGUoY3R4KVxufVxuIiwgImltcG9ydCB0eXBlIHsgS3lzZWx5LCBUcmFuc2FjdGlvbiB9IGZyb20gJ2t5c2VseSc7XG5pbXBvcnQgdHlwZSB7XG4gIERhdGFiYXNlLFxuICBHb2FsLFxuICBHb2FsQ3ljbGUsXG4gIEdvYWxFdmVudCxcbiAgR29hbExpbmssXG59IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cyc7XG5pbXBvcnQgeyBjeWNsZUhhc1N0YXJ0ZWQgfSBmcm9tICcuL2xpZmVjeWNsZS50cyc7XG5pbXBvcnQgeyBldmFsdWF0ZUdvYWwgfSBmcm9tICcuL2V2YWx1YXRvcnMvaW5kZXgudHMnO1xuXG50eXBlIERiTGlrZSA9IEt5c2VseTxEYXRhYmFzZT4gfCBUcmFuc2FjdGlvbjxEYXRhYmFzZT47XG5cbmZ1bmN0aW9uIHBhcnNlSnNvbjxUPih2YWx1ZTogdW5rbm93bik6IFQge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgVDtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB7fSBhcyBUO1xuICAgIH1cbiAgfVxuICByZXR1cm4gKHZhbHVlID8/IHt9KSBhcyBUO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hHb2FsTGlua3MoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWxJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxHb2FsTGlua1tdPiB7XG4gIHJldHVybiBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2xpbmtzJylcbiAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xufVxuXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hFdmVudHNGb3JVc2VyKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgZnJvbT86IERhdGUgfCBzdHJpbmcsXG4gIHRvPzogRGF0ZSB8IHN0cmluZyxcbik6IFByb21pc2U8R29hbEV2ZW50W10+IHtcbiAgbGV0IHF1ZXJ5ID0gZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9ldmVudHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3RBbGwoKTtcblxuICBpZiAoZnJvbSkge1xuICAgIGNvbnN0IGZyb21EYXRlID0gdHlwZW9mIGZyb20gPT09ICdzdHJpbmcnID8gbmV3IERhdGUoZnJvbSkgOiBmcm9tO1xuICAgIHF1ZXJ5ID0gcXVlcnkud2hlcmUoJ29jY3VycmVkX2F0JywgJz49JywgZnJvbURhdGUgYXMgbmV2ZXIpO1xuICB9XG4gIGlmICh0bykge1xuICAgIGNvbnN0IHRvRGF0ZSA9IHR5cGVvZiB0byA9PT0gJ3N0cmluZycgPyBuZXcgRGF0ZSh0bykgOiB0bztcbiAgICBxdWVyeSA9IHF1ZXJ5LndoZXJlKCdvY2N1cnJlZF9hdCcsICc8JywgdG9EYXRlIGFzIG5ldmVyKTtcbiAgfVxuXG4gIHJldHVybiBhd2FpdCBxdWVyeS5leGVjdXRlKCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGdyb3VwQWN0aXZpdHlJZHNGb3JMaW5rcyhcbiAgZGI6IERiTGlrZSxcbiAgbGlua3M6IEdvYWxMaW5rW10sXG4gIHVzZXJJZDogbnVtYmVyLFxuKTogUHJvbWlzZTxudW1iZXJbXT4ge1xuICBjb25zdCBncm91cElkcyA9IGxpbmtzXG4gICAgLmZpbHRlcigobCkgPT4gbC5saW5rX3R5cGUgPT09ICdncm91cCcgJiYgbC5ncm91cF9pZCAhPSBudWxsKVxuICAgIC5tYXAoKGwpID0+IGwuZ3JvdXBfaWQhKTtcbiAgaWYgKGdyb3VwSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIFtdO1xuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2dyb3VwX2lkJywgJ2luJywgZ3JvdXBJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKCk7XG4gIHJldHVybiByb3dzLm1hcCgocikgPT4gci5pZCk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGZldGNoQ2hpbGRDeWNsZXMoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWxJZDogbnVtYmVyLFxuKTogUHJvbWlzZTx7IGN5Y2xlczogTWFwPG51bWJlciwgR29hbEN5Y2xlPjsgd2VpZ2h0czogTWFwPG51bWJlciwgbnVtYmVyPiB9PiB7XG4gIGNvbnN0IGRlcHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgLnNlbGVjdEFsbCgpXG4gICAgLmV4ZWN1dGUoKTtcblxuICBjb25zdCBjeWNsZXMgPSBuZXcgTWFwPG51bWJlciwgR29hbEN5Y2xlPigpO1xuICBjb25zdCB3ZWlnaHRzID0gbmV3IE1hcDxudW1iZXIsIG51bWJlcj4oKTtcblxuICBmb3IgKGNvbnN0IGRlcCBvZiBkZXBzKSB7XG4gICAgd2VpZ2h0cy5zZXQoZGVwLmRlcGVuZHNfb25fZ29hbF9pZCwgTnVtYmVyKGRlcC53ZWlnaHQpKTtcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuXG4gICAgaWYgKGN5Y2xlKSB7XG4gICAgICBjeWNsZXMuc2V0KGRlcC5kZXBlbmRzX29uX2dvYWxfaWQsIGN5Y2xlKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cblxuICAgIGNvbnN0IGxhdGVzdCA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBkZXAuZGVwZW5kc19vbl9nb2FsX2lkKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpO1xuICAgIGlmIChsYXRlc3QpIGN5Y2xlcy5zZXQoZGVwLmRlcGVuZHNfb25fZ29hbF9pZCwgbGF0ZXN0KTtcbiAgfVxuXG4gIHJldHVybiB7IGN5Y2xlcywgd2VpZ2h0cyB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgaGl0dGluZyB0aGUgdGFyZ2V0IHNob3VsZCBjbG9zZSB0aGUgY3ljbGUgaW1tZWRpYXRlbHkuXG4gKiBSZWN1cnJpbmcgY3ljbGVzIHN0YXkgYGFjdGl2ZWAgdW50aWwgcm9sbC1vdmVyIGF0IGVuZHNfYXQgc28gdGhlIFVJIGtlZXBzXG4gKiBhbiBhY3RpdmVDeWNsZSAoYW5kIHByb2dyZXNzKSBmb3IgdGhlIHJlc3Qgb2YgdGhlIHdpbmRvdy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNob3VsZENsb3NlQ3ljbGVPblRhcmdldChcbiAgZ29hbDogUGljazxHb2FsLCAncmVjdXJyZW5jZSc+LFxuKTogYm9vbGVhbiB7XG4gIHJldHVybiBnb2FsLnJlY3VycmVuY2UgPT0gbnVsbDtcbn1cblxuLyoqXG4gKiBSZWNvbXB1dGUgYW5kIHBlcnNpc3QgY3VycmVudF92YWx1ZSBmb3IgYSBzaW5nbGUgY3ljbGUuXG4gKiBSZXR1cm5zIHRoZSB1cGRhdGVkIGN5Y2xlLlxuICogU2tpcHMgYWNjcnVhbCB3aGlsZSB0aGUgY3ljbGUgaGFzIG5vdCBzdGFydGVkIChrZWVwcyBjdXJyZW50X3ZhbHVlIGF0IDAsXG4gKiBuZXZlciBhdXRvLXN1Y2NlZWRzKSBcdTIwMTQgY292ZXJzIGNvbXBvc2l0ZSBwYXJlbnRzIGNvbXBsZXRpbmcgZWFybHkgdmlhIGNoaWxkcmVuLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVjb21wdXRlQ3ljbGUoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPEdvYWxDeWNsZT4ge1xuICBpZiAoY3ljbGUuc3RhdHVzID09PSAnYWN0aXZlJyAmJiAhY3ljbGVIYXNTdGFydGVkKGN5Y2xlLCBub3cpKSB7XG4gICAgaWYgKE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA9PT0gMCkgcmV0dXJuIGN5Y2xlO1xuICAgIGNvbnN0IHN0YW1wZWQgPSBub3cudG9JU09TdHJpbmcoKTtcbiAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLnNldCh7IGN1cnJlbnRfdmFsdWU6IDAsIHVwZGF0ZWRfYXQ6IHN0YW1wZWQgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKTtcbiAgfVxuXG4gIGNvbnN0IGxpbmtzID0gYXdhaXQgZmV0Y2hHb2FsTGlua3MoZGIsIGdvYWwuaWQpO1xuICBjb25zdCBldmVudHMgPSBhd2FpdCBmZXRjaEV2ZW50c0ZvclVzZXIoXG4gICAgZGIsXG4gICAgZ29hbC51c2VyX2lkLFxuICAgIGN5Y2xlLnN0YXJ0c19hdCxcbiAgICBjeWNsZS5lbmRzX2F0ID8/IHVuZGVmaW5lZCxcbiAgKTtcbiAgY29uc3QgZ3JvdXBBY3Rpdml0eUlkcyA9IGF3YWl0IGdyb3VwQWN0aXZpdHlJZHNGb3JMaW5rcyhcbiAgICBkYixcbiAgICBsaW5rcyxcbiAgICBnb2FsLnVzZXJfaWQsXG4gICk7XG4gIGNvbnN0IHsgY3ljbGVzOiBjaGlsZEN5Y2xlcywgd2VpZ2h0czogY2hpbGRXZWlnaHRzIH0gPVxuICAgIGdvYWwucnVsZV90eXBlID09PSAnY29tcG9zaXRlJ1xuICAgICAgPyBhd2FpdCBmZXRjaENoaWxkQ3ljbGVzKGRiLCBnb2FsLmlkKVxuICAgICAgOiB7XG4gICAgICAgICAgY3ljbGVzOiBuZXcgTWFwPG51bWJlciwgR29hbEN5Y2xlPigpLFxuICAgICAgICAgIHdlaWdodHM6IG5ldyBNYXA8bnVtYmVyLCBudW1iZXI+KCksXG4gICAgICAgIH07XG5cbiAgY29uc3QgeyBjdXJyZW50VmFsdWUsIGRvbmUgfSA9IGV2YWx1YXRlR29hbCh7XG4gICAgZ29hbDoge1xuICAgICAgLi4uZ29hbCxcbiAgICAgIGNvbmZpZzogcGFyc2VKc29uKGdvYWwuY29uZmlnKSxcbiAgICB9LFxuICAgIGN5Y2xlLFxuICAgIGxpbmtzLFxuICAgIGV2ZW50cyxcbiAgICBjaGlsZEN5Y2xlcyxcbiAgICBjaGlsZFdlaWdodHMsXG4gICAgZ3JvdXBBY3Rpdml0eUlkcyxcbiAgfSk7XG5cbiAgY29uc3Qgbm93SXNvID0gbm93LnRvSVNPU3RyaW5nKCk7XG4gIGxldCBzdGF0dXMgPSBjeWNsZS5zdGF0dXM7XG4gIC8vIE9uZS10aW1lIGdvYWxzIGNsb3NlIGFzIHNvb24gYXMgdGhlIHRhcmdldCBpcyBtZXQuIFJlY3VycmluZyBjeWNsZXMgc3RheVxuICAvLyBhY3RpdmUgdW50aWwgcm9sbE92ZXJJZk5lZWRlZCBjbG9zZXMgdGhlbSBhdCBlbmRzX2F0IFx1MjAxNCBvdGhlcndpc2VcbiAgLy8gYWN0aXZlQ3ljbGUgZ29lcyBudWxsIG1pZC13aW5kb3cgYW5kIHRoZSBjbGllbnQgc2hvd3MgMCUgcHJvZ3Jlc3MuXG4gIGlmIChcbiAgICBjeWNsZS5zdGF0dXMgPT09ICdhY3RpdmUnICYmXG4gICAgZG9uZSAmJlxuICAgIHNob3VsZENsb3NlQ3ljbGVPblRhcmdldChnb2FsKVxuICApIHtcbiAgICBzdGF0dXMgPSAnc3VjY2VlZGVkJztcbiAgfVxuXG4gIGNvbnN0IHVwZGF0ZWQgPSBhd2FpdCBkYlxuICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgIC5zZXQoe1xuICAgICAgY3VycmVudF92YWx1ZTogY3VycmVudFZhbHVlLFxuICAgICAgc3RhdHVzLFxuICAgICAgdXBkYXRlZF9hdDogbm93SXNvLFxuICAgIH0pXG4gICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCk7XG5cbiAgLy8gRGFpbHkgc25hcHNob3QgZm9yIGhpc3RvcnkgY2hhcnRzICh1cHNlcnQgYnkgYXNfb2YgZGF0ZSkuXG4gIGNvbnN0IGFzT2YgPSBub3dJc28uc2xpY2UoMCwgMTApO1xuICBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCdnb2FsX3Byb2dyZXNzX3NuYXBzaG90cycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBnb2FsX2N5Y2xlX2lkOiB1cGRhdGVkLmlkLFxuICAgICAgYXNfb2Y6IGFzT2YsXG4gICAgICB2YWx1ZTogY3VycmVudFZhbHVlLFxuICAgIH0pXG4gICAgLm9uQ29uZmxpY3QoKG9jKSA9PlxuICAgICAgb2MuY29sdW1ucyhbJ2dvYWxfY3ljbGVfaWQnLCAnYXNfb2YnXSkuZG9VcGRhdGVTZXQoe1xuICAgICAgICB2YWx1ZTogY3VycmVudFZhbHVlLFxuICAgICAgfSksXG4gICAgKVxuICAgIC5leGVjdXRlKCk7XG5cbiAgLy8gTWFyayBwYXJlbnQgZ29hbCBjb21wbGV0ZWQgd2hlbiBhIG9uZS10aW1lIGN5Y2xlIHN1Y2NlZWRzLlxuICBpZiAoc3RhdHVzID09PSAnc3VjY2VlZGVkJyAmJiAhZ29hbC5yZWN1cnJlbmNlICYmIGdvYWwuc3RhdHVzID09PSAnYWN0aXZlJykge1xuICAgIGF3YWl0IGRiXG4gICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgIC5zZXQoeyBzdGF0dXM6ICdjb21wbGV0ZWQnLCB1cGRhdGVkX2F0OiBub3dJc28gfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAuZXhlY3V0ZSgpO1xuICB9XG5cbiAgcmV0dXJuIHVwZGF0ZWQ7XG59XG5cbi8qKiBSZWNvbXB1dGUgYWxsIGFjdGl2ZSBjeWNsZXMgbGlua2VkIHRvIGFuIGFjdGl2aXR5IG9yIGdyb3VwIHZpYSBnb2FsX2xpbmtzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFmZmVjdGVkQ3ljbGVzKFxuICBkYjogRGJMaWtlLFxuICB1c2VySWQ6IG51bWJlcixcbiAgb3B0czogeyBhY3Rpdml0eUlkPzogbnVtYmVyIHwgbnVsbDsgZ3JvdXBJZD86IG51bWJlciB8IG51bGwgfSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBnb2FsSWRzID0gbmV3IFNldDxudW1iZXI+KCk7XG5cbiAgaWYgKG9wdHMuYWN0aXZpdHlJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuYWN0aXZpdHlfaWQnLCAnPScsIG9wdHMuYWN0aXZpdHlJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgaWYgKG9wdHMuZ3JvdXBJZCAhPSBudWxsKSB7XG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAuaW5uZXJKb2luKCdnb2FscycsICdnb2Fscy5pZCcsICdnb2FsX2xpbmtzLmdvYWxfaWQnKVxuICAgICAgLndoZXJlKCdnb2Fscy51c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ2dvYWxfbGlua3MuZ3JvdXBfaWQnLCAnPScsIG9wdHMuZ3JvdXBJZClcbiAgICAgIC5zZWxlY3QoJ2dvYWxfbGlua3MuZ29hbF9pZCcpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgciBvZiByb3dzKSBnb2FsSWRzLmFkZChyLmdvYWxfaWQpO1xuICB9XG5cbiAgLy8gQWxzbyByZWNvbXB1dGUgY29tcG9zaXRlcyB0aGF0IGRlcGVuZCBvbiBhZmZlY3RlZCBnb2Fscy5cbiAgaWYgKGdvYWxJZHMuc2l6ZSA+IDApIHtcbiAgICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAud2hlcmUoJ2RlcGVuZHNfb25fZ29hbF9pZCcsICdpbicsIFsuLi5nb2FsSWRzXSlcbiAgICAgIC5zZWxlY3QoJ2dvYWxfaWQnKVxuICAgICAgLmV4ZWN1dGUoKTtcbiAgICBmb3IgKGNvbnN0IGQgb2YgZGVwcykgZ29hbElkcy5hZGQoZC5nb2FsX2lkKTtcbiAgfVxuXG4gIGZvciAoY29uc3QgZ29hbElkIG9mIGdvYWxJZHMpIHtcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKTtcbiAgICBpZiAoIWdvYWwgfHwgZ29hbC5zdGF0dXMgPT09ICdwYXVzZWQnIHx8IGdvYWwuc3RhdHVzID09PSAnYXJjaGl2ZWQnKVxuICAgICAgY29udGludWU7XG5cbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCk7XG4gICAgaWYgKCFjeWNsZSkgY29udGludWU7XG5cbiAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICB9XG59XG5cbi8qKiBGdWxsIHJlY29tcHV0ZSBvZiBldmVyeSBhY3RpdmUgY3ljbGUgZm9yIGEgdXNlciAocmVwYWlyIHBhdGgpLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlY29tcHV0ZUFsbEFjdGl2ZUN5Y2xlcyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4pOiBQcm9taXNlPG51bWJlcj4ge1xuICBjb25zdCBnb2FscyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ3N0YXR1cycsICdpbicsIFsnYWN0aXZlJywgJ2NvbXBsZXRlZCcsICdmYWlsZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpO1xuXG4gIGxldCBjb3VudCA9IDA7XG4gIGZvciAoY29uc3QgZ29hbCBvZiBnb2Fscykge1xuICAgIGNvbnN0IGN5Y2xlcyA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpO1xuICAgIGZvciAoY29uc3QgY3ljbGUgb2YgY3ljbGVzKSB7XG4gICAgICBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgY3ljbGUpO1xuICAgICAgY291bnQrKztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGNvdW50O1xufVxuIiwgIi8qKlxuICogU2hhcmVkIHByZXNldCBwYWxldHRlIGZvciBhY3Rpdml0eSBncm91cHMuXG4gKiBLZWVwIGluIHN5bmMgd2l0aCBGbHV0dGVyIGBsaWIvdGhlbWUvdG9rZW5zL2dyb3VwX3BhbGV0dGUuZGFydGAuXG4gKi9cbmV4cG9ydCBjb25zdCBHUk9VUF9DT0xPUl9QQUxFVFRFID0gW1xuICAnIzBGNzY2RScsIC8vIHRlYWwgKGJyYW5kKVxuICAnIzI1NjNFQicsIC8vIGJsdWVcbiAgJyM3QzNBRUQnLCAvLyB2aW9sZXRcbiAgJyNEQjI3NzcnLCAvLyBwaW5rXG4gICcjREMyNjI2JywgLy8gcmVkXG4gICcjRUE1ODBDJywgLy8gb3JhbmdlXG4gICcjQ0E4QTA0JywgLy8geWVsbG93XG4gICcjMTZBMzRBJywgLy8gZ3JlZW5cbiAgJyMwODkxQjInLCAvLyBjeWFuXG4gICcjNEI1NTYzJywgLy8gZ3JheVxuXSBhcyBjb25zdFxuXG5leHBvcnQgdHlwZSBHcm91cENvbG9yID0gKHR5cGVvZiBHUk9VUF9DT0xPUl9QQUxFVFRFKVtudW1iZXJdXG5cbmNvbnN0IEhFWF9DT0xPUl9SRSA9IC9eI1swLTlBLUZhLWZdezZ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQWxsb3dlZEdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IGNvbG9yIGlzIEdyb3VwQ29sb3Ige1xuICBpZiAoIUhFWF9DT0xPUl9SRS50ZXN0KGNvbG9yKSkgcmV0dXJuIGZhbHNlXG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBjb2xvci50b1VwcGVyQ2FzZSgpXG4gIHJldHVybiAoR1JPVVBfQ09MT1JfUEFMRVRURSBhcyByZWFkb25seSBzdHJpbmdbXSkuc29tZShcbiAgICAoYykgPT4gYy50b1VwcGVyQ2FzZSgpID09PSBub3JtYWxpemVkLFxuICApXG59XG5cbi8qKiBOb3JtYWxpemUgdG8gY2Fub25pY2FsIGAjUlJHR0JCYCB1cHBlcmNhc2UgZnJvbSB0aGUgYWxsb3dsaXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IEdyb3VwQ29sb3Ige1xuICBjb25zdCBtYXRjaCA9IChHUk9VUF9DT0xPUl9QQUxFVFRFIGFzIHJlYWRvbmx5IHN0cmluZ1tdKS5maW5kKFxuICAgIChjKSA9PiBjLnRvVXBwZXJDYXNlKCkgPT09IGNvbG9yLnRvVXBwZXJDYXNlKCksXG4gIClcbiAgaWYgKCFtYXRjaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgSW52YWxpZCBncm91cCBjb2xvcjogJHtjb2xvcn1gKVxuICB9XG4gIHJldHVybiBtYXRjaCBhcyBHcm91cENvbG9yXG59XG4iLCAiaW1wb3J0IHsgUmVjdXJyZW5jZUNvbmZpZywgUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB9IGZyb20gJy4vdHlwZXMudHMnXG5pbXBvcnQgeyBpc0FsbG93ZWRHcm91cENvbG9yLCBub3JtYWxpemVHcm91cENvbG9yIH0gZnJvbSAnLi9ncm91cF9wYWxldHRlLnRzJ1xuaW1wb3J0IHsgR09BTF9SVUxFX1RZUEVTIH0gZnJvbSAnLi4vZ29hbHMvZXZhbHVhdG9ycy9pbmRleC50cydcbmltcG9ydCB0eXBlIHtcbiAgQ3JlYXRlR29hbElucHV0LFxuICBHb2FsRGVhZGxpbmVJbnB1dCxcbiAgR29hbERlcGVuZGVuY3lJbnB1dCxcbiAgR29hbExpbmtJbnB1dCxcbiAgR29hbFJlY3VycmVuY2VJbnB1dCxcbiAgVXBkYXRlR29hbElucHV0LFxufSBmcm9tICcuL3R5cGVzLnRzJ1xuXG5leHBvcnQgY2xhc3MgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvciBleHRlbmRzIEVycm9yIHt9XG5leHBvcnQgY2xhc3MgSW52YWxpZEdyb3VwRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRDb21wbGV0aW9uRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuZXhwb3J0IGNsYXNzIEludmFsaWRHb2FsRXJyb3IgZXh0ZW5kcyBFcnJvciB7fVxuXG5pbnRlcmZhY2UgQWN0aXZpdHlTY2hlZHVsZSB7XG4gIGlzUmVjdXJyaW5nOiBib29sZWFuXG4gIGRhdGU/OiBzdHJpbmcgfCBudWxsXG4gIHJlY3VycmVuY2VQYXR0ZXJuPzogUmVjdXJyZW5jZVBhdHRlcm5JbnB1dCB8IG51bGxcbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgdGhhdCBhbiBhY3Rpdml0eSdzIHNjaGVkdWxlIGlzIGludGVybmFsbHkgY29uc2lzdGVudDpcbiAqIC0gTm9uLXJlY3VycmluZyBhY3Rpdml0aWVzIG11c3QgaGF2ZSBhIGBkYXRlYCBhbmQgbm8gcmVjdXJyZW5jZSBwYXR0ZXJuLlxuICogLSBSZWN1cnJpbmcgYWN0aXZpdGllcyBtdXN0IGhhdmUgYSByZWN1cnJlbmNlIHBhdHRlcm4gKGFuZCBubyBgZGF0ZWApLFxuICogICB3aXRoIGNvbmZpZyBmaWVsZHMgbWF0Y2hpbmcgdGhlIGNob3NlbiByZWN1cnJlbmNlIHR5cGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUFjdGl2aXR5U2NoZWR1bGUoaW5wdXQ6IEFjdGl2aXR5U2NoZWR1bGUpOiB2b2lkIHtcbiAgaWYgKCFpbnB1dC5pc1JlY3VycmluZykge1xuICAgIGlmICghaW5wdXQuZGF0ZSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAgICdkYXRlIGlzIHJlcXVpcmVkIHdoZW4gaXNSZWN1cnJpbmcgaXMgZmFsc2UnLFxuICAgICAgKVxuICAgIH1cbiAgICByZXR1cm5cbiAgfVxuXG4gIGlmICghaW5wdXQucmVjdXJyZW5jZVBhdHRlcm4pIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdyZWN1cnJlbmNlUGF0dGVybiBpcyByZXF1aXJlZCB3aGVuIGlzUmVjdXJyaW5nIGlzIHRydWUnLFxuICAgIClcbiAgfVxuXG4gIGNvbnN0IHsgcmVjdXJyZW5jZVR5cGUsIGNvbmZpZyB9ID0gaW5wdXQucmVjdXJyZW5jZVBhdHRlcm5cbiAgaWYgKCFjb25maWcgfHwgIWNvbmZpZy5zdGFydF9kYXRlKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRBY3Rpdml0eVNjaGVkdWxlRXJyb3IoXG4gICAgICAncmVjdXJyZW5jZVBhdHRlcm4uY29uZmlnLnN0YXJ0X2RhdGUgaXMgcmVxdWlyZWQnLFxuICAgIClcbiAgfVxuXG4gIHN3aXRjaCAocmVjdXJyZW5jZVR5cGUpIHtcbiAgICBjYXNlICd3ZWVrbHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZXZWVrKGNvbmZpZy5kYXlzX29mX3dlZWspXG4gICAgICBicmVha1xuICAgIGNhc2UgJ21vbnRobHknOlxuICAgICAgdmFsaWRhdGVEYXlzT2ZNb250aChjb25maWcuZGF5c19vZl9tb250aCwgY29uZmlnLmlzX2xhc3RfZGF5X29mX21vbnRoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICdldmVyeV94X2RheXMnOlxuICAgICAgdmFsaWRhdGVJbnRlcnZhbERheXMoY29uZmlnLmludGVydmFsX2RheXMpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICAgYFVuc3VwcG9ydGVkIHJlY3VycmVuY2VUeXBlOiAke3JlY3VycmVuY2VUeXBlfWAsXG4gICAgICApXG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZXMgYSBncm91cCBjb2xvciBhZ2FpbnN0IHRoZSBzaGFyZWQgaGV4IGFsbG93bGlzdC5cbiAqIFJldHVybnMgdGhlIGNhbm9uaWNhbCBwYWxldHRlIHZhbHVlIChlLmcuIGAjMEY3NjZFYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwQ29sb3IoY29sb3I6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghaXNBbGxvd2VkR3JvdXBDb2xvcihjb2xvcikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoXG4gICAgICAnY29sb3IgbXVzdCBiZSBhIGhleCB2YWx1ZSBmcm9tIHRoZSBncm91cCBwYWxldHRlIChlLmcuICMwRjc2NkUpJyxcbiAgICApXG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZUdyb3VwQ29sb3IoY29sb3IpXG59XG5cbi8qKlxuICogVmFsaWRhdGVzIGdyb3VwIG5hbWUgaXMgbm9uLWVtcHR5IGFmdGVyIHRyaW0uXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdyb3VwTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKClcbiAgaWYgKCF0cmltbWVkKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHcm91cEVycm9yKCduYW1lIGlzIHJlcXVpcmVkJylcbiAgfVxuICBpZiAodHJpbW1lZC5sZW5ndGggPiAyNTUpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdyb3VwRXJyb3IoJ25hbWUgbXVzdCBiZSBhdCBtb3N0IDI1NSBjaGFyYWN0ZXJzJylcbiAgfVxuICByZXR1cm4gdHJpbW1lZFxufVxuXG5jb25zdCBEQVRFX1JFID0gL15cXGR7NH0tXFxkezJ9LVxcZHsyfSQvXG5jb25zdCBUSU1FX1JFID0gL15cXGR7Mn06XFxkezJ9JC9cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlT2NjdXJyZW5jZURhdGUoZGF0ZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgaWYgKCFEQVRFX1JFLnRlc3QoZGF0ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignb2NjdXJyZW5jZURhdGUgbXVzdCBiZSBZWVlZLU1NLUREJylcbiAgfVxuICByZXR1cm4gZGF0ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVEdXJhdGlvbk1pbnV0ZXModmFsdWU6IG51bWJlciB8IG51bGwgfCB1bmRlZmluZWQpOiBudW1iZXIgfCBudWxsIHtcbiAgaWYgKHZhbHVlID09PSB1bmRlZmluZWQgfHwgdmFsdWUgPT09IG51bGwpIHJldHVybiBudWxsXG4gIGlmICghTnVtYmVyLmlzRmluaXRlKHZhbHVlKSB8fCB2YWx1ZSA8IDAgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRDb21wbGV0aW9uRXJyb3IoJ2R1cmF0aW9uTWludXRlcyBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKVxuICB9XG4gIHJldHVybiB2YWx1ZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVQb3NpdGl2ZUR1cmF0aW9uKHZhbHVlOiBudW1iZXIpOiBudW1iZXIge1xuICBpZiAoIU51bWJlci5pc0Zpbml0ZSh2YWx1ZSkgfHwgdmFsdWUgPD0gMCB8fCAhTnVtYmVyLmlzSW50ZWdlcih2YWx1ZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZENvbXBsZXRpb25FcnJvcignZHVyYXRpb25NaW51dGVzIG11c3QgYmUgYSBwb3NpdGl2ZSBpbnRlZ2VyJylcbiAgfVxuICByZXR1cm4gdmFsdWVcbn1cblxuZnVuY3Rpb24gdmFsaWRhdGVEYXlzT2ZXZWVrKGRheXNPZldlZWs6IFJlY3VycmVuY2VDb25maWdbJ2RheXNfb2Zfd2VlayddKTogdm9pZCB7XG4gIGlmICghZGF5c09mV2VlayB8fCBkYXlzT2ZXZWVrLmxlbmd0aCA9PT0gMCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX3dlZWsgaXMgcmVxdWlyZWQgZm9yIHdlZWtseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKGRheXNPZldlZWsuc29tZSgoZGF5KSA9PiAhTnVtYmVyLmlzSW50ZWdlcihkYXkpIHx8IGRheSA8IDAgfHwgZGF5ID4gNikpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl93ZWVrIG11c3QgY29udGFpbiBpbnRlZ2VycyBiZXR3ZWVuIDAgKFN1bmRheSkgYW5kIDYgKFNhdHVyZGF5KScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlRGF5c09mTW9udGgoXG4gIGRheXNPZk1vbnRoOiBSZWN1cnJlbmNlQ29uZmlnWydkYXlzX29mX21vbnRoJ10sXG4gIGlzTGFzdERheU9mTW9udGg6IFJlY3VycmVuY2VDb25maWdbJ2lzX2xhc3RfZGF5X29mX21vbnRoJ10sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFzRGF5c09mTW9udGggPSAhIWRheXNPZk1vbnRoICYmIGRheXNPZk1vbnRoLmxlbmd0aCA+IDBcbiAgaWYgKCFoYXNEYXlzT2ZNb250aCAmJiAhaXNMYXN0RGF5T2ZNb250aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5kYXlzX29mX21vbnRoIG9yIGNvbmZpZy5pc19sYXN0X2RheV9vZl9tb250aCBpcyByZXF1aXJlZCBmb3IgbW9udGhseSByZWN1cnJlbmNlJyxcbiAgICApXG4gIH1cbiAgaWYgKFxuICAgIGhhc0RheXNPZk1vbnRoICYmXG4gICAgZGF5c09mTW9udGghLnNvbWUoKGRheSkgPT4gIU51bWJlci5pc0ludGVnZXIoZGF5KSB8fCBkYXkgPCAxIHx8IGRheSA+IDMxKVxuICApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEFjdGl2aXR5U2NoZWR1bGVFcnJvcihcbiAgICAgICdjb25maWcuZGF5c19vZl9tb250aCBtdXN0IGNvbnRhaW4gaW50ZWdlcnMgYmV0d2VlbiAxIGFuZCAzMScsXG4gICAgKVxuICB9XG59XG5cbmZ1bmN0aW9uIHZhbGlkYXRlSW50ZXJ2YWxEYXlzKGludGVydmFsRGF5czogUmVjdXJyZW5jZUNvbmZpZ1snaW50ZXJ2YWxfZGF5cyddKTogdm9pZCB7XG4gIGlmIChcbiAgICBpbnRlcnZhbERheXMgPT09IHVuZGVmaW5lZCB8fFxuICAgIGludGVydmFsRGF5cyA9PT0gbnVsbCB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKGludGVydmFsRGF5cykgfHxcbiAgICBpbnRlcnZhbERheXMgPCAxXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkQWN0aXZpdHlTY2hlZHVsZUVycm9yKFxuICAgICAgJ2NvbmZpZy5pbnRlcnZhbF9kYXlzIG11c3QgYmUgYW4gaW50ZWdlciA+PSAxIGZvciBldmVyeV94X2RheXMgcmVjdXJyZW5jZScsXG4gICAgKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxUaXRsZSh0aXRsZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdHJpbW1lZCA9IHRpdGxlLnRyaW0oKVxuICBpZiAoIXRyaW1tZWQpIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCd0aXRsZSBpcyByZXF1aXJlZCcpXG4gIGlmICh0cmltbWVkLmxlbmd0aCA+IDI1NSkgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3RpdGxlIG11c3QgYmUgYXQgbW9zdCAyNTUgY2hhcmFjdGVycycpXG4gIHJldHVybiB0cmltbWVkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxDb2xvcihjb2xvcjogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHZhbGlkYXRlR3JvdXBDb2xvcihjb2xvcilcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlUnVsZVR5cGUocnVsZVR5cGU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghR09BTF9SVUxFX1RZUEVTLmluY2x1ZGVzKHJ1bGVUeXBlKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKFxuICAgICAgYHJ1bGVUeXBlIG11c3QgYmUgb25lIG9mOiAke0dPQUxfUlVMRV9UWVBFUy5qb2luKCcsICcpfWAsXG4gICAgKVxuICB9XG4gIHJldHVybiBydWxlVHlwZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVUYXJnZXRWYWx1ZSh2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgaWYgKCFOdW1iZXIuaXNGaW5pdGUodmFsdWUpIHx8IHZhbHVlIDw9IDApIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcigndGFyZ2V0VmFsdWUgbXVzdCBiZSBhIHBvc2l0aXZlIG51bWJlcicpXG4gIH1cbiAgcmV0dXJuIHZhbHVlXG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUdvYWxMaW5rcyhcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSB8IHVuZGVmaW5lZCxcbiAgcnVsZVR5cGU6IHN0cmluZyxcbik6IEdvYWxMaW5rSW5wdXRbXSB7XG4gIGNvbnN0IGxpc3QgPSBsaW5rcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnKSB7XG4gICAgaWYgKGxpc3QubGVuZ3RoID4gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyBtdXN0IG5vdCBoYXZlIGFjdGl2aXR5L2dyb3VwIGxpbmtzJylcbiAgICB9XG4gICAgcmV0dXJuIFtdXG4gIH1cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2F0IGxlYXN0IG9uZSBsaW5rIGlzIHJlcXVpcmVkJylcbiAgfVxuICBmb3IgKGNvbnN0IGxpbmsgb2YgbGlzdCkge1xuICAgIGlmIChsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknKSB7XG4gICAgICBpZiAobGluay5hY3Rpdml0eUlkID09IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIHJlcXVpcmUgYWN0aXZpdHlJZCcpXG4gICAgICB9XG4gICAgICBpZiAobGluay5ncm91cElkICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2FjdGl2aXR5IGxpbmtzIG11c3Qgbm90IHNldCBncm91cElkJylcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxpbmsubGlua1R5cGUgPT09ICdncm91cCcpIHtcbiAgICAgIGlmIChsaW5rLmdyb3VwSWQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgcmVxdWlyZSBncm91cElkJylcbiAgICAgIH1cbiAgICAgIGlmIChsaW5rLmFjdGl2aXR5SWQgIT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZ3JvdXAgbGlua3MgbXVzdCBub3Qgc2V0IGFjdGl2aXR5SWQnKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbGlua1R5cGUgbXVzdCBiZSBhY3Rpdml0eSBvciBncm91cCcpXG4gICAgfVxuICAgIGlmIChsaW5rLndlaWdodCAhPSBudWxsICYmICghTnVtYmVyLmlzRmluaXRlKGxpbmsud2VpZ2h0KSB8fCBsaW5rLndlaWdodCA8PSAwKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2xpbmsgd2VpZ2h0IG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVwZW5kZW5jaWVzKFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10gfCB1bmRlZmluZWQsXG4gIHJ1bGVUeXBlOiBzdHJpbmcsXG4pOiBHb2FsRGVwZW5kZW5jeUlucHV0W10ge1xuICBjb25zdCBsaXN0ID0gZGVwcyA/PyBbXVxuICBpZiAocnVsZVR5cGUgPT09ICdjb21wb3NpdGUnICYmIGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2NvbXBvc2l0ZSBnb2FscyByZXF1aXJlIGF0IGxlYXN0IG9uZSBkZXBlbmRlbmN5JylcbiAgfVxuICBmb3IgKGNvbnN0IGRlcCBvZiBsaXN0KSB7XG4gICAgaWYgKCFOdW1iZXIuaXNJbnRlZ2VyKGRlcC5kZXBlbmRzT25Hb2FsSWQpIHx8IGRlcC5kZXBlbmRzT25Hb2FsSWQgPD0gMCkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZHNPbkdvYWxJZCBtdXN0IGJlIGEgcG9zaXRpdmUgaW50ZWdlcicpXG4gICAgfVxuICAgIGlmIChcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPSBudWxsICYmXG4gICAgICBkZXAucmVxdWlyZW1lbnQgIT09ICdjb21wbGV0ZScgJiZcbiAgICAgIGRlcC5yZXF1aXJlbWVudCAhPT0gJ3Byb2dyZXNzJ1xuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlcXVpcmVtZW50IG11c3QgYmUgY29tcGxldGUgb3IgcHJvZ3Jlc3MnKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbGlzdFxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsUmVjdXJyZW5jZShcbiAgcmVjdXJyZW5jZTogR29hbFJlY3VycmVuY2VJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsUmVjdXJyZW5jZUlucHV0IHwgbnVsbCB7XG4gIGlmIChyZWN1cnJlbmNlID09IG51bGwpIHJldHVybiBudWxsXG4gIGNvbnN0IHBlcmlvZHMgPSBbJ3dlZWtseScsICdtb250aGx5JywgJ3F1YXJ0ZXJseScsICdldmVyeV94X2RheXMnXVxuICBpZiAoIXBlcmlvZHMuaW5jbHVkZXMocmVjdXJyZW5jZS5wZXJpb2QpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoYHVuc3VwcG9ydGVkIHJlY3VycmVuY2UgcGVyaW9kOiAke3JlY3VycmVuY2UucGVyaW9kfWApXG4gIH1cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuaW50ZXJ2YWwgIT0gbnVsbCAmJlxuICAgICghTnVtYmVyLmlzSW50ZWdlcihyZWN1cnJlbmNlLmludGVydmFsKSB8fCByZWN1cnJlbmNlLmludGVydmFsIDwgMSlcbiAgKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ3JlY3VycmVuY2UuaW50ZXJ2YWwgbXVzdCBiZSBhbiBpbnRlZ2VyID49IDEnKVxuICB9XG4gIGlmIChcbiAgICByZWN1cnJlbmNlLmNhcnJ5T3ZlciAhPSBudWxsICYmXG4gICAgcmVjdXJyZW5jZS5jYXJyeU92ZXIgIT09ICdub25lJyAmJlxuICAgIHJlY3VycmVuY2UuY2FycnlPdmVyICE9PSAnb3ZlcmZsb3cnXG4gICkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdjYXJyeU92ZXIgbXVzdCBiZSBub25lIG9yIG92ZXJmbG93JylcbiAgfVxuICByZXR1cm4gcmVjdXJyZW5jZVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVHb2FsRGVhZGxpbmUoXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwge1xuICBpZiAoZGVhZGxpbmUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdhYnNvbHV0ZScpIHtcbiAgICBpZiAoIWRlYWRsaW5lLmRhdGUgfHwgIURBVEVfUkUudGVzdChkZWFkbGluZS5kYXRlKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2Fic29sdXRlIGRlYWRsaW5lIHJlcXVpcmVzIGRhdGUgWVlZWS1NTS1ERCcpXG4gICAgfVxuICB9IGVsc2UgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdyZWxhdGl2ZScpIHtcbiAgICBpZiAoXG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0ID09IG51bGwgfHxcbiAgICAgICFOdW1iZXIuaXNJbnRlZ2VyKGRlYWRsaW5lLmRheXNBZnRlckN5Y2xlU3RhcnQpIHx8XG4gICAgICBkZWFkbGluZS5kYXlzQWZ0ZXJDeWNsZVN0YXJ0IDwgMFxuICAgICkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICdyZWxhdGl2ZSBkZWFkbGluZSByZXF1aXJlcyBkYXlzQWZ0ZXJDeWNsZVN0YXJ0ID49IDAnLFxuICAgICAgKVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignZGVhZGxpbmUua2luZCBtdXN0IGJlIGFic29sdXRlIG9yIHJlbGF0aXZlJylcbiAgfVxuICByZXR1cm4gZGVhZGxpbmVcbn1cblxuY29uc3QgTUFYX1NUQVJUX1lFQVJTX0FIRUFEID0gNVxuXG4vKiogUGFyc2UgYW5kIHZhbGlkYXRlIGFuIG9wdGlvbmFsIElTTy04NjAxIHN0YXJ0c0F0LiBSZXR1cm5zIG51bGwgaWYgb21pdHRlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVN0YXJ0c0F0KFxuICBzdGFydHNBdDogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKHN0YXJ0c0F0ID09IG51bGwgfHwgc3RhcnRzQXQgPT09ICcnKSByZXR1cm4gbnVsbFxuICBjb25zdCBwYXJzZWQgPSBuZXcgRGF0ZShzdGFydHNBdClcbiAgaWYgKE51bWJlci5pc05hTihwYXJzZWQuZ2V0VGltZSgpKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdzdGFydHNBdCBtdXN0IGJlIGEgdmFsaWQgSVNPLTg2MDEgZGF0ZXRpbWUnKVxuICB9XG4gIGNvbnN0IG1heCA9IG5ldyBEYXRlKG5vdylcbiAgbWF4LnNldFVUQ0Z1bGxZZWFyKG1heC5nZXRVVENGdWxsWWVhcigpICsgTUFYX1NUQVJUX1lFQVJTX0FIRUFEKVxuICBpZiAocGFyc2VkID4gbWF4KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICBgc3RhcnRzQXQgbXVzdCBiZSB3aXRoaW4gJHtNQVhfU1RBUlRfWUVBUlNfQUhFQUR9IHllYXJzIGZyb20gbm93YCxcbiAgICApXG4gIH1cbiAgcmV0dXJuIHBhcnNlZFxufVxuXG4vKiogUmVqZWN0IGFic29sdXRlIGRlYWRsaW5lcyB0aGF0IGVuZCBiZWZvcmUgdGhlIGdvYWwgc3RhcnRzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChcbiAgc3RhcnRzQXQ6IERhdGUsXG4gIGRlYWRsaW5lOiBHb2FsRGVhZGxpbmVJbnB1dCB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiB2b2lkIHtcbiAgaWYgKCFkZWFkbGluZSB8fCBkZWFkbGluZS5raW5kICE9PSAnYWJzb2x1dGUnIHx8ICFkZWFkbGluZS5kYXRlKSByZXR1cm5cbiAgY29uc3QgZGVhZGxpbmVBdCA9IG5ldyBEYXRlKGRlYWRsaW5lLmRhdGUgKyAnVDIzOjU5OjU5Ljk5OVonKVxuICBpZiAoZGVhZGxpbmVBdCA8IHN0YXJ0c0F0KSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlYWRsaW5lIG11c3QgYmUgb24gb3IgYWZ0ZXIgdGhlIGdvYWwgc3RhcnQnKVxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNyZWF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbikge1xuICBjb25zdCB0aXRsZSA9IHZhbGlkYXRlR29hbFRpdGxlKGlucHV0LnRpdGxlKVxuICBjb25zdCBjb2xvciA9IHZhbGlkYXRlR29hbENvbG9yKGlucHV0LmNvbG9yKVxuICBjb25zdCBydWxlVHlwZSA9IHZhbGlkYXRlUnVsZVR5cGUoaW5wdXQucnVsZVR5cGUpXG4gIGNvbnN0IHRhcmdldFZhbHVlID0gdmFsaWRhdGVUYXJnZXRWYWx1ZShpbnB1dC50YXJnZXRWYWx1ZSlcbiAgaWYgKGlucHV0Lm1ldHJpYyAhPT0gJ2NvdW50JyAmJiBpbnB1dC5tZXRyaWMgIT09ICdkdXJhdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignbWV0cmljIG11c3QgYmUgY291bnQgb3IgZHVyYXRpb24nKVxuICB9XG4gIGNvbnN0IGxpbmtzID0gdmFsaWRhdGVHb2FsTGlua3MoaW5wdXQubGlua3MsIHJ1bGVUeXBlKVxuICBjb25zdCBkZXBlbmRlbmNpZXMgPSB2YWxpZGF0ZUdvYWxEZXBlbmRlbmNpZXMoaW5wdXQuZGVwZW5kZW5jaWVzLCBydWxlVHlwZSlcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSB2YWxpZGF0ZUdvYWxEZWFkbGluZShpbnB1dC5kZWFkbGluZSlcbiAgY29uc3Qgc3RhcnRzQXQgPSB2YWxpZGF0ZVN0YXJ0c0F0KGlucHV0LnN0YXJ0c0F0LCBub3cpID8/IG5vd1xuICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQoc3RhcnRzQXQsIGRlYWRsaW5lKVxuXG4gIGlmIChpbnB1dC5jb25maWc/LmJlZm9yZVRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYmVmb3JlVGltZSkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYmVmb3JlVGltZSBtdXN0IGJlIEhIOm1tJylcbiAgfVxuICBpZiAoaW5wdXQuY29uZmlnPy5hZnRlclRpbWUgJiYgIVRJTUVfUkUudGVzdChpbnB1dC5jb25maWcuYWZ0ZXJUaW1lKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdhZnRlclRpbWUgbXVzdCBiZSBISDptbScpXG4gIH1cblxuICByZXR1cm4ge1xuICAgIHRpdGxlLFxuICAgIGNvbG9yLFxuICAgIHJ1bGVUeXBlLFxuICAgIHRhcmdldFZhbHVlLFxuICAgIGxpbmtzLFxuICAgIGRlcGVuZGVuY2llcyxcbiAgICByZWN1cnJlbmNlLFxuICAgIGRlYWRsaW5lLFxuICAgIHN0YXJ0c0F0LFxuICB9XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZVVwZGF0ZUdvYWxJbnB1dChcbiAgaW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dCxcbiAgZXhpc3RpbmdSdWxlVHlwZTogc3RyaW5nLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKSB7XG4gIGNvbnN0IHJ1bGVUeXBlID0gaW5wdXQucnVsZVR5cGUgIT0gbnVsbFxuICAgID8gdmFsaWRhdGVSdWxlVHlwZShpbnB1dC5ydWxlVHlwZSlcbiAgICA6IGV4aXN0aW5nUnVsZVR5cGVcblxuICBpZiAoaW5wdXQudGl0bGUgIT0gbnVsbCkgdmFsaWRhdGVHb2FsVGl0bGUoaW5wdXQudGl0bGUpXG4gIGlmIChpbnB1dC5jb2xvciAhPSBudWxsKSB2YWxpZGF0ZUdvYWxDb2xvcihpbnB1dC5jb2xvcilcbiAgaWYgKGlucHV0LnRhcmdldFZhbHVlICE9IG51bGwpIHZhbGlkYXRlVGFyZ2V0VmFsdWUoaW5wdXQudGFyZ2V0VmFsdWUpXG4gIGlmIChpbnB1dC5tZXRyaWMgIT0gbnVsbCAmJiBpbnB1dC5tZXRyaWMgIT09ICdjb3VudCcgJiYgaW5wdXQubWV0cmljICE9PSAnZHVyYXRpb24nKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ21ldHJpYyBtdXN0IGJlIGNvdW50IG9yIGR1cmF0aW9uJylcbiAgfVxuICBpZiAoaW5wdXQuc3RhdHVzICE9IG51bGwpIHtcbiAgICBjb25zdCBhbGxvd2VkID0gWydhY3RpdmUnLCAncGF1c2VkJywgJ2NvbXBsZXRlZCcsICdhcmNoaXZlZCcsICdmYWlsZWQnXVxuICAgIGlmICghYWxsb3dlZC5pbmNsdWRlcyhpbnB1dC5zdGF0dXMpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihgaW52YWxpZCBzdGF0dXM6ICR7aW5wdXQuc3RhdHVzfWApXG4gICAgfVxuICB9XG5cbiAgY29uc3QgbGlua3MgPSBpbnB1dC5saW5rcyAhPT0gdW5kZWZpbmVkXG4gICAgPyB2YWxpZGF0ZUdvYWxMaW5rcyhpbnB1dC5saW5rcywgcnVsZVR5cGUpXG4gICAgOiB1bmRlZmluZWRcbiAgY29uc3QgZGVwZW5kZW5jaWVzID0gaW5wdXQuZGVwZW5kZW5jaWVzICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlcGVuZGVuY2llcyhpbnB1dC5kZXBlbmRlbmNpZXMsIHJ1bGVUeXBlKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHJlY3VycmVuY2UgPSBpbnB1dC5yZWN1cnJlbmNlICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbFJlY3VycmVuY2UoaW5wdXQucmVjdXJyZW5jZSlcbiAgICA6IHVuZGVmaW5lZFxuICBjb25zdCBkZWFkbGluZSA9IGlucHV0LmRlYWRsaW5lICE9PSB1bmRlZmluZWRcbiAgICA/IHZhbGlkYXRlR29hbERlYWRsaW5lKGlucHV0LmRlYWRsaW5lKVxuICAgIDogdW5kZWZpbmVkXG4gIGNvbnN0IHN0YXJ0c0F0ID0gaW5wdXQuc3RhcnRzQXQgIT09IHVuZGVmaW5lZFxuICAgID8gdmFsaWRhdGVTdGFydHNBdChpbnB1dC5zdGFydHNBdCwgbm93KVxuICAgIDogdW5kZWZpbmVkXG5cbiAgcmV0dXJuIHsgcnVsZVR5cGUsIGxpbmtzLCBkZXBlbmRlbmNpZXMsIHJlY3VycmVuY2UsIGRlYWRsaW5lLCBzdGFydHNBdCB9XG59XG5cbi8qKlxuICogRGV0ZWN0cyB3aGV0aGVyIGFkZGluZyBlZGdlcyB3b3VsZCBjcmVhdGUgYSBjeWNsZSBpbiB0aGUgZGVwZW5kZW5jeSBEQUcuXG4gKiBgZWRnZXNgIGlzIHRoZSBmdWxsIGFkamFjZW5jeSBsaXN0IGFmdGVyIHRoZSBwcm9wb3NlZCBjaGFuZ2UgKGdvYWxJZCAtPiBkZXBzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKFxuICBlZGdlczogTWFwPG51bWJlciwgbnVtYmVyW10+LFxuICBzdGFydElkOiBudW1iZXIsXG4pOiBib29sZWFuIHtcbiAgY29uc3QgdmlzaXRpbmcgPSBuZXcgU2V0PG51bWJlcj4oKVxuICBjb25zdCB2aXNpdGVkID0gbmV3IFNldDxudW1iZXI+KClcblxuICBmdW5jdGlvbiBkZnMobm9kZTogbnVtYmVyKTogYm9vbGVhbiB7XG4gICAgaWYgKHZpc2l0aW5nLmhhcyhub2RlKSkgcmV0dXJuIHRydWVcbiAgICBpZiAodmlzaXRlZC5oYXMobm9kZSkpIHJldHVybiBmYWxzZVxuICAgIHZpc2l0aW5nLmFkZChub2RlKVxuICAgIGZvciAoY29uc3QgbmV4dCBvZiBlZGdlcy5nZXQobm9kZSkgPz8gW10pIHtcbiAgICAgIGlmIChkZnMobmV4dCkpIHJldHVybiB0cnVlXG4gICAgfVxuICAgIHZpc2l0aW5nLmRlbGV0ZShub2RlKVxuICAgIHZpc2l0ZWQuYWRkKG5vZGUpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICByZXR1cm4gZGZzKHN0YXJ0SWQpXG59XG4iLCAiLyoqIFBvc3RncmVzIGBudW1lcmljYCBhcnJpdmVzIGFzIHN0cmluZyB2aWEgYHBnYDsgR3JhcGhRTCBOdW1iZXIgcmVxdWlyZXMgSlMgbnVtYmVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFzTnVtYmVyKHZhbHVlOiB1bmtub3duLCBmYWxsYmFjayA9IDApOiBudW1iZXIge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIGZhbGxiYWNrXG4gIGNvbnN0IG4gPSB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInID8gdmFsdWUgOiBOdW1iZXIodmFsdWUpXG4gIHJldHVybiBOdW1iZXIuaXNGaW5pdGUobikgPyBuIDogZmFsbGJhY2tcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGFzTnVtYmVyT3JOdWxsKHZhbHVlOiB1bmtub3duKTogbnVtYmVyIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBjb25zdCBuID0gdHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyA/IHZhbHVlIDogTnVtYmVyKHZhbHVlKVxuICByZXR1cm4gTnVtYmVyLmlzRmluaXRlKG4pID8gbiA6IG51bGxcbn1cbiIsICJpbXBvcnQgdHlwZSB7IFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHsgZ2V0Q29udGV4dCB9IGZyb20gJ0BnZXRjcm9uaXQvcHlsb24nXG5pbXBvcnQgeyBkYiB9IGZyb20gJy4uLy4uL2RiL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgR29hbCBhcyBHb2FsUm93LFxuICBHb2FsQ29uZmlnLFxuICBHb2FsQ3ljbGUgYXMgR29hbEN5Y2xlUm93LFxuICBHb2FsRGVhZGxpbmVDb25maWcsXG4gIEdvYWxEZXBlbmRlbmN5IGFzIEdvYWxEZXBlbmRlbmN5Um93LFxuICBHb2FsTGluayBhcyBHb2FsTGlua1JvdyxcbiAgR29hbFByb2dyZXNzU25hcHNob3QgYXMgR29hbFNuYXBzaG90Um93LFxuICBHb2FsUmVjdXJyZW5jZUNvbmZpZyxcbiAgTmV3R29hbCxcbiAgTmV3R29hbERlcGVuZGVuY3ksXG4gIE5ld0dvYWxMaW5rLFxufSBmcm9tICcuLi8uLi9kYi90eXBlcy9zY2hlbWEudHMnXG5pbXBvcnQgeyBjcmVhdGVJbml0aWFsQ3ljbGUsIGRlYWRsaW5lU3RhdGUsIGxpZmVjeWNsZVBoYXNlLCByZXNjaGVkdWxlQWN0aXZlQ3ljbGUsIHJvbGxPdmVySWZOZWVkZWQsIHJvbGxPdmVyVXNlckdvYWxzIH0gZnJvbSAnLi4vLi4vZ29hbHMvY3ljbGVzLnRzJ1xuaW1wb3J0IHsgYnVpbGRHb2FsTnVkZ2VzIH0gZnJvbSAnLi4vLi4vZ29hbHMvbnVkZ2VzLnRzJ1xuaW1wb3J0IHsgcmVjb21wdXRlQWxsQWN0aXZlQ3ljbGVzLCByZWNvbXB1dGVDeWNsZSB9IGZyb20gJy4uLy4uL2dvYWxzL3Byb2dyZXNzLnRzJ1xuaW1wb3J0IHR5cGUge1xuICBDcmVhdGVHb2FsSW5wdXQsXG4gIEdvYWxEZXBlbmRlbmN5SW5wdXQsXG4gIEdvYWxMaW5rSW5wdXQsXG4gIFVwZGF0ZUdvYWxJbnB1dCxcbn0gZnJvbSAnLi4vdHlwZXMudHMnXG5pbXBvcnQge1xuICBhc3NlcnREZWFkbGluZUFmdGVyU3RhcnQsXG4gIEludmFsaWRHb2FsRXJyb3IsXG4gIHZhbGlkYXRlQ3JlYXRlR29hbElucHV0LFxuICB2YWxpZGF0ZUdvYWxDb2xvcixcbiAgdmFsaWRhdGVHb2FsVGl0bGUsXG4gIHZhbGlkYXRlVXBkYXRlR29hbElucHV0LFxuICB3b3VsZENyZWF0ZURlcGVuZGVuY3lDeWNsZSxcbn0gZnJvbSAnLi4vdmFsaWRhdGlvbi50cydcbmltcG9ydCB7IGFzTnVtYmVyLCBhc051bWJlck9yTnVsbCB9IGZyb20gJy4uL251bWVyaWMudHMnXG5cbmZ1bmN0aW9uIHJlcXVpcmVVc2VySWQoKTogbnVtYmVyIHtcbiAgY29uc3QgdXNlcklkID0gZ2V0Q29udGV4dCgpLmdldCgndXNlcklkJylcbiAgaWYgKHR5cGVvZiB1c2VySWQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdVbmF1dGhlbnRpY2F0ZWQnKVxuICB9XG4gIHJldHVybiB1c2VySWRcbn1cblxuZnVuY3Rpb24gcGFyc2VKc29uPFQ+KHZhbHVlOiB1bmtub3duKTogVCB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIFRcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsXG4gICAgfVxuICB9XG4gIHJldHVybiB2YWx1ZSBhcyBUXG59XG5cbi8qKiBQb3N0Z3JlcyBgbnVtZXJpY2AgYXJyaXZlcyBhcyBzdHJpbmcgdmlhIGBwZ2A7IEdyYXBoUUwgTnVtYmVyIHJlcXVpcmVzIEpTIG51bWJlci4gKi9cbmZ1bmN0aW9uIG1hcEN5Y2xlU2NhbGFyczxUIGV4dGVuZHMgR29hbEN5Y2xlUm93PihjeWNsZTogVCkge1xuICByZXR1cm4ge1xuICAgIC4uLmN5Y2xlLFxuICAgIHRhcmdldF92YWx1ZTogYXNOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSxcbiAgICBjdXJyZW50X3ZhbHVlOiBhc051bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSxcbiAgICBjYXJyeV9vdmVyOiBhc051bWJlcihjeWNsZS5jYXJyeV9vdmVyKSxcbiAgfVxufVxuXG5mdW5jdGlvbiBtYXBMaW5rU2NhbGFycyhsaW5rOiBHb2FsTGlua1Jvdykge1xuICByZXR1cm4ge1xuICAgIC4uLmxpbmssXG4gICAgd2VpZ2h0OiBhc051bWJlcihsaW5rLndlaWdodCwgMSksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwRGVwZW5kZW5jeVNjYWxhcnMoZGVwOiBHb2FsRGVwZW5kZW5jeVJvdykge1xuICByZXR1cm4ge1xuICAgIC4uLmRlcCxcbiAgICB0aHJlc2hvbGQ6IGFzTnVtYmVyT3JOdWxsKGRlcC50aHJlc2hvbGQpLFxuICAgIHdlaWdodDogYXNOdW1iZXIoZGVwLndlaWdodCwgMSksXG4gIH1cbn1cblxuZnVuY3Rpb24gbWFwU25hcHNob3RTY2FsYXJzKHNuYXBzaG90OiBHb2FsU25hcHNob3RSb3cpIHtcbiAgcmV0dXJuIHtcbiAgICAuLi5zbmFwc2hvdCxcbiAgICB2YWx1ZTogYXNOdW1iZXIoc25hcHNob3QudmFsdWUpLFxuICB9XG59XG5cbmZ1bmN0aW9uIHRvUmVjdXJyZW5jZUpzb24oXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXRbJ3JlY3VycmVuY2UnXSB8IFVwZGF0ZUdvYWxJbnB1dFsncmVjdXJyZW5jZSddLFxuKTogR29hbFJlY3VycmVuY2VDb25maWcgfCBudWxsIHtcbiAgaWYgKGlucHV0ID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiB7XG4gICAgcGVyaW9kOiBpbnB1dC5wZXJpb2QsXG4gICAgaW50ZXJ2YWw6IGlucHV0LmludGVydmFsLFxuICAgIGFuY2hvcjogaW5wdXQuYW5jaG9yLFxuICAgIGNhcnJ5X292ZXI6IGlucHV0LmNhcnJ5T3ZlcixcbiAgICByZXNldDogaW5wdXQucmVzZXQsXG4gIH1cbn1cblxuZnVuY3Rpb24gdG9EZWFkbGluZUpzb24oXG4gIGlucHV0OiBDcmVhdGVHb2FsSW5wdXRbJ2RlYWRsaW5lJ10gfCBVcGRhdGVHb2FsSW5wdXRbJ2RlYWRsaW5lJ10sXG4pOiBHb2FsRGVhZGxpbmVDb25maWcgfCBudWxsIHtcbiAgaWYgKGlucHV0ID09IG51bGwpIHJldHVybiBudWxsXG4gIHJldHVybiB7XG4gICAga2luZDogaW5wdXQua2luZCxcbiAgICBkYXRlOiBpbnB1dC5kYXRlLFxuICAgIGRheXNfYWZ0ZXJfY3ljbGVfc3RhcnQ6IGlucHV0LmRheXNBZnRlckN5Y2xlU3RhcnQsXG4gICAgZ3JhY2VfZGF5czogaW5wdXQuZ3JhY2VEYXlzLFxuICAgIHdhcm5fZGF5czogaW5wdXQud2FybkRheXMsXG4gIH1cbn1cblxuZnVuY3Rpb24gdG9Db25maWdKc29uKFxuICBpbnB1dDogQ3JlYXRlR29hbElucHV0Wydjb25maWcnXSB8IFVwZGF0ZUdvYWxJbnB1dFsnY29uZmlnJ10sXG4pOiBHb2FsQ29uZmlnIHtcbiAgaWYgKCFpbnB1dCkgcmV0dXJuIHt9XG4gIHJldHVybiB7XG4gICAgY29tcG9zaXRlX21vZGU6IGlucHV0LmNvbXBvc2l0ZU1vZGUsXG4gICAgY291bnRfcmVxdWlyZWQ6IGlucHV0LmNvdW50UmVxdWlyZWQsXG4gICAgYmVmb3JlX3RpbWU6IGlucHV0LmJlZm9yZVRpbWUsXG4gICAgYWZ0ZXJfdGltZTogaW5wdXQuYWZ0ZXJUaW1lLFxuICAgIGJsb2NrX3VudGlsX3VubG9ja2VkOiBpbnB1dC5ibG9ja1VudGlsVW5sb2NrZWQsXG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gYXNzZXJ0T3duZWRBY3Rpdml0aWVzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGFjdGl2aXR5SWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoYWN0aXZpdHlJZHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAud2hlcmUoJ2lkJywgJ2luJywgYWN0aXZpdHlJZHMpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKHJvd3MubGVuZ3RoICE9PSBhY3Rpdml0eUlkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgYWN0aXZpdGllcyBub3QgZm91bmQnKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFzc2VydE93bmVkR3JvdXBzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGdyb3VwSWRzOiBudW1iZXJbXSxcbikge1xuICBpZiAoZ3JvdXBJZHMubGVuZ3RoID09PSAwKSByZXR1cm5cbiAgY29uc3Qgcm93cyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdncm91cHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnaWQnLCAnaW4nLCBncm91cElkcylcbiAgICAuc2VsZWN0KCdpZCcpXG4gICAgLmV4ZWN1dGUoKVxuICBpZiAocm93cy5sZW5ndGggIT09IGdyb3VwSWRzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkR29hbEVycm9yKCdvbmUgb3IgbW9yZSBncm91cHMgbm90IGZvdW5kJylcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBhc3NlcnRPd25lZEdvYWxzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgdXNlcklkOiBudW1iZXIsXG4gIGdvYWxJZHM6IG51bWJlcltdLFxuKSB7XG4gIGlmIChnb2FsSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG4gIGNvbnN0IHJvd3MgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC53aGVyZSgnaWQnLCAnaW4nLCBnb2FsSWRzKVxuICAgIC5zZWxlY3QoJ2lkJylcbiAgICAuZXhlY3V0ZSgpXG4gIGlmIChyb3dzLmxlbmd0aCAhPT0gZ29hbElkcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignb25lIG9yIG1vcmUgZGVwZW5kZW5jeSBnb2FscyBub3QgZm91bmQnKVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlcGxhY2VMaW5rcyhcbiAgdHJ4OiBUcmFuc2FjdGlvbjxEYXRhYmFzZT4sXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbiAgbGlua3M6IEdvYWxMaW5rSW5wdXRbXSxcbikge1xuICBhd2FpdCB0cnguZGVsZXRlRnJvbSgnZ29hbF9saW5rcycpLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsSWQpLmV4ZWN1dGUoKVxuICBjb25zdCBhY3Rpdml0eUlkcyA9IGxpbmtzXG4gICAgLmZpbHRlcigobCkgPT4gbC5saW5rVHlwZSA9PT0gJ2FjdGl2aXR5JyAmJiBsLmFjdGl2aXR5SWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmFjdGl2aXR5SWQhKVxuICBjb25zdCBncm91cElkcyA9IGxpbmtzXG4gICAgLmZpbHRlcigobCkgPT4gbC5saW5rVHlwZSA9PT0gJ2dyb3VwJyAmJiBsLmdyb3VwSWQgIT0gbnVsbClcbiAgICAubWFwKChsKSA9PiBsLmdyb3VwSWQhKVxuICBhd2FpdCBhc3NlcnRPd25lZEFjdGl2aXRpZXModHJ4LCB1c2VySWQsIGFjdGl2aXR5SWRzKVxuICBhd2FpdCBhc3NlcnRPd25lZEdyb3Vwcyh0cngsIHVzZXJJZCwgZ3JvdXBJZHMpXG5cbiAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XG4gICAgYXdhaXQgdHJ4XG4gICAgICAuaW5zZXJ0SW50bygnZ29hbF9saW5rcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgZ29hbF9pZDogZ29hbElkLFxuICAgICAgICBsaW5rX3R5cGU6IGxpbmsubGlua1R5cGUsXG4gICAgICAgIGFjdGl2aXR5X2lkOiBsaW5rLmxpbmtUeXBlID09PSAnYWN0aXZpdHknID8gbGluay5hY3Rpdml0eUlkID8/IG51bGwgOiBudWxsLFxuICAgICAgICBncm91cF9pZDogbGluay5saW5rVHlwZSA9PT0gJ2dyb3VwJyA/IGxpbmsuZ3JvdXBJZCA/PyBudWxsIDogbnVsbCxcbiAgICAgICAgd2VpZ2h0OiBsaW5rLndlaWdodCA/PyAxLFxuICAgICAgfSBhcyBOZXdHb2FsTGluaylcbiAgICAgIC5leGVjdXRlKClcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiByZXBsYWNlRGVwZW5kZW5jaWVzKFxuICB0cng6IFRyYW5zYWN0aW9uPERhdGFiYXNlPixcbiAgZ29hbElkOiBudW1iZXIsXG4gIHVzZXJJZDogbnVtYmVyLFxuICBkZXBzOiBHb2FsRGVwZW5kZW5jeUlucHV0W10sXG4pIHtcbiAgY29uc3QgZGVwSWRzID0gZGVwcy5tYXAoKGQpID0+IGQuZGVwZW5kc09uR29hbElkKVxuICBpZiAoZGVwSWRzLmluY2x1ZGVzKGdvYWxJZCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignYSBnb2FsIGNhbm5vdCBkZXBlbmQgb24gaXRzZWxmJylcbiAgfVxuICBhd2FpdCBhc3NlcnRPd25lZEdvYWxzKHRyeCwgdXNlcklkLCBkZXBJZHMpXG5cbiAgLy8gQnVpbGQgYWRqYWNlbmN5IGZyb20gYWxsIGV4aXN0aW5nIGRlcHMgZm9yIHRoaXMgdXNlciwgcmVwbGFjaW5nIHRoaXMgZ29hbCdzIGVkZ2VzLlxuICBjb25zdCBhbGxHb2FscyA9IGF3YWl0IHRyeFxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLnNlbGVjdCgnaWQnKVxuICAgIC5leGVjdXRlKClcbiAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCB0cnhcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC5pbm5lckpvaW4oJ2dvYWxzJywgJ2dvYWxzLmlkJywgJ2dvYWxfZGVwZW5kZW5jaWVzLmdvYWxfaWQnKVxuICAgIC53aGVyZSgnZ29hbHMudXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgIC5zZWxlY3QoW1xuICAgICAgJ2dvYWxfZGVwZW5kZW5jaWVzLmdvYWxfaWQnLFxuICAgICAgJ2dvYWxfZGVwZW5kZW5jaWVzLmRlcGVuZHNfb25fZ29hbF9pZCcsXG4gICAgXSlcbiAgICAuZXhlY3V0ZSgpXG5cbiAgY29uc3QgZWRnZXMgPSBuZXcgTWFwPG51bWJlciwgbnVtYmVyW10+KClcbiAgZm9yIChjb25zdCBnIG9mIGFsbEdvYWxzKSBlZGdlcy5zZXQoZy5pZCwgW10pXG4gIGZvciAoY29uc3QgZSBvZiBleGlzdGluZykge1xuICAgIGlmIChlLmdvYWxfaWQgPT09IGdvYWxJZCkgY29udGludWVcbiAgICBlZGdlcy5nZXQoZS5nb2FsX2lkKT8ucHVzaChlLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgfVxuICBlZGdlcy5zZXQoZ29hbElkLCBkZXBJZHMpXG5cbiAgaWYgKHdvdWxkQ3JlYXRlRGVwZW5kZW5jeUN5Y2xlKGVkZ2VzLCBnb2FsSWQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoJ2RlcGVuZGVuY3kgY3ljbGUgZGV0ZWN0ZWQnKVxuICB9XG5cbiAgYXdhaXQgdHJ4LmRlbGV0ZUZyb20oJ2dvYWxfZGVwZW5kZW5jaWVzJykud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWxJZCkuZXhlY3V0ZSgpXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICBhd2FpdCB0cnhcbiAgICAgIC5pbnNlcnRJbnRvKCdnb2FsX2RlcGVuZGVuY2llcycpXG4gICAgICAudmFsdWVzKHtcbiAgICAgICAgZ29hbF9pZDogZ29hbElkLFxuICAgICAgICBkZXBlbmRzX29uX2dvYWxfaWQ6IGRlcC5kZXBlbmRzT25Hb2FsSWQsXG4gICAgICAgIHJlcXVpcmVtZW50OiBkZXAucmVxdWlyZW1lbnQgPz8gJ2NvbXBsZXRlJyxcbiAgICAgICAgdGhyZXNob2xkOiBkZXAudGhyZXNob2xkID8/IG51bGwsXG4gICAgICAgIHdlaWdodDogZGVwLndlaWdodCA/PyAxLFxuICAgICAgfSBhcyBOZXdHb2FsRGVwZW5kZW5jeSlcbiAgICAgIC5leGVjdXRlKClcbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBkZXBlbmRlbmNpZXNNZXQoXG4gIGdvYWxJZDogbnVtYmVyLFxuICB1c2VySWQ6IG51bWJlcixcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBkZXBzID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbElkKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlKClcbiAgaWYgKGRlcHMubGVuZ3RoID09PSAwKSByZXR1cm4gdHJ1ZVxuXG4gIGZvciAoY29uc3QgZGVwIG9mIGRlcHMpIHtcbiAgICBjb25zdCBjaGlsZEdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmICghY2hpbGRHb2FsKSByZXR1cm4gZmFsc2VcblxuICAgIGNvbnN0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGRlcC5kZXBlbmRzX29uX2dvYWxfaWQpXG4gICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICBpZiAoIWN5Y2xlKSByZXR1cm4gZmFsc2VcblxuICAgIGlmIChkZXAucmVxdWlyZW1lbnQgPT09ICdjb21wbGV0ZScpIHtcbiAgICAgIGNvbnN0IHRhcmdldE1ldCA9XG4gICAgICAgIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGlmIChcbiAgICAgICAgY3ljbGUuc3RhdHVzICE9PSAnc3VjY2VlZGVkJyAmJlxuICAgICAgICBjaGlsZEdvYWwuc3RhdHVzICE9PSAnY29tcGxldGVkJyAmJlxuICAgICAgICAhdGFyZ2V0TWV0XG4gICAgICApIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlXG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGNvbnN0IHRocmVzaG9sZCA9IGRlcC50aHJlc2hvbGQgPz8gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSlcbiAgICAgIGlmIChOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPCBOdW1iZXIodGhyZXNob2xkKSkgcmV0dXJuIGZhbHNlXG4gICAgfVxuICB9XG4gIHJldHVybiB0cnVlXG59XG5cbmZ1bmN0aW9uIHdpdGhHb2FsUmVsYXRpb25zKGdvYWw6IEdvYWxSb3cpIHtcbiAgY29uc3QgY29uZmlnID0gcGFyc2VKc29uPEdvYWxDb25maWc+KGdvYWwuY29uZmlnKSA/PyB7fVxuICBjb25zdCByZWN1cnJlbmNlID0gcGFyc2VKc29uPEdvYWxSZWN1cnJlbmNlQ29uZmlnPihnb2FsLnJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lID0gcGFyc2VKc29uPEdvYWxEZWFkbGluZUNvbmZpZz4oZ29hbC5kZWFkbGluZSlcbiAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuXG4gIHJldHVybiB7XG4gICAgLi4uZ29hbCxcbiAgICB0YXJnZXRfdmFsdWU6IGFzTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICBzdGFydHNBdDogbmV3IERhdGUoZ29hbC5zdGFydHNfYXQpLnRvSVNPU3RyaW5nKCksXG4gICAgbGlmZWN5Y2xlUGhhc2U6IGxpZmVjeWNsZVBoYXNlKGdvYWwsIG5vdyksXG4gICAgY29uZmlnLFxuICAgIHJlY3VycmVuY2UsXG4gICAgZGVhZGxpbmUsXG4gICAgbGlua3M6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9saW5rcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcCgobGluaykgPT4gKHtcbiAgICAgICAgLi4ubWFwTGlua1NjYWxhcnMobGluayksXG4gICAgICAgIGFjdGl2aXR5OiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgaWYgKGxpbmsuYWN0aXZpdHlfaWQgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgICAgICAgICByZXR1cm4gYXdhaXQgZGJcbiAgICAgICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0aWVzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxpbmsuYWN0aXZpdHlfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbFxuICAgICAgICB9LFxuICAgICAgICBncm91cDogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGlmIChsaW5rLmdyb3VwX2lkID09IG51bGwpIHJldHVybiBudWxsXG4gICAgICAgICAgcmV0dXJuIGF3YWl0IGRiXG4gICAgICAgICAgICAuc2VsZWN0RnJvbSgnZ3JvdXBzJylcbiAgICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGxpbmsuZ3JvdXBfaWQpXG4gICAgICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KCkgPz8gbnVsbFxuICAgICAgICB9LFxuICAgICAgfSkpXG4gICAgfSxcbiAgICBhY3RpdmVDeWNsZTogYXN5bmMgKCkgPT4ge1xuICAgICAgbGV0IGN5Y2xlID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ2FjdGl2ZScpXG4gICAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmIChjeWNsZSAmJiBnb2FsLnN0YXR1cyA9PT0gJ2FjdGl2ZScpIHtcbiAgICAgICAgY3ljbGUgPSBhd2FpdCByb2xsT3ZlcklmTmVlZGVkKGRiLCBnb2FsLCBjeWNsZSlcbiAgICAgIH1cbiAgICAgIC8vIEZhbGwgYmFjayB0byBsYXRlc3QgY3ljbGUgc28gY29tcGxldGVkIC8gbWlkLXdpbmRvdyBzdWNjZWVkZWQgY3ljbGVzXG4gICAgICAvLyBzdGlsbCBleHBvc2UgcHJvZ3Jlc3MuIEFsc28gcmVwYWlyIHJlY3VycmluZyBjeWNsZXMgdGhhdCB3ZXJlIGNsb3NlZFxuICAgICAgLy8gZWFybHkgKGJlZm9yZSBlbmRzX2F0KSBzbyB0aGV5IHJlbWFpbiB0aGUgYWN0aXZlIHdpbmRvdy5cbiAgICAgIGlmICghY3ljbGUpIHtcbiAgICAgICAgY29uc3QgbGF0ZXN0ID0gYXdhaXQgZGJcbiAgICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgICBpZiAoXG4gICAgICAgICAgbGF0ZXN0ICYmXG4gICAgICAgICAgZ29hbC5zdGF0dXMgPT09ICdhY3RpdmUnICYmXG4gICAgICAgICAgZ29hbC5yZWN1cnJlbmNlICE9IG51bGwgJiZcbiAgICAgICAgICBsYXRlc3Quc3RhdHVzID09PSAnc3VjY2VlZGVkJyAmJlxuICAgICAgICAgICghbGF0ZXN0LmVuZHNfYXQgfHwgbm93IDwgbmV3IERhdGUobGF0ZXN0LmVuZHNfYXQpKVxuICAgICAgICApIHtcbiAgICAgICAgICBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgICAgIC5zZXQoeyBzdGF0dXM6ICdhY3RpdmUnLCB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSB9KVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgbGF0ZXN0LmlkKVxuICAgICAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGN5Y2xlID0gbGF0ZXN0XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIGlmICghY3ljbGUpIHJldHVybiBudWxsXG4gICAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lKVxuICAgICAgY29uc3QgdGFyZ2V0ID0gYXNOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKVxuICAgICAgY29uc3QgY3VycmVudCA9IGFzTnVtYmVyKGN5Y2xlLmN1cnJlbnRfdmFsdWUpXG4gICAgICByZXR1cm4ge1xuICAgICAgICAuLi5tYXBDeWNsZVNjYWxhcnMoY3ljbGUpLFxuICAgICAgICBkZWFkbGluZVN0YXRlOiBzdGF0ZSxcbiAgICAgICAgcGVyY2VudENvbXBsZXRlOiB0YXJnZXQgPiAwID8gTWF0aC5taW4oMSwgY3VycmVudCAvIHRhcmdldCkgOiAwLFxuICAgICAgICByZW1haW5pbmc6IE1hdGgubWF4KDAsIHRhcmdldCAtIGN1cnJlbnQpLFxuICAgICAgfVxuICAgIH0sXG4gICAgY3ljbGVzOiBhc3luYyAoKSA9PiB7XG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnYXNjJylcbiAgICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIHJldHVybiByb3dzLm1hcChtYXBDeWNsZVNjYWxhcnMpXG4gICAgfSxcbiAgICBkZXBlbmRlbmNpZXM6IGFzeW5jICgpID0+IHtcbiAgICAgIGNvbnN0IHJvd3MgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9kZXBlbmRlbmNpZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAoKGRlcCkgPT4gKHtcbiAgICAgICAgLi4ubWFwRGVwZW5kZW5jeVNjYWxhcnMoZGVwKSxcbiAgICAgICAgZGVwZW5kc09uOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgY29uc3QgZyA9IGF3YWl0IGRiXG4gICAgICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbHMnKVxuICAgICAgICAgICAgLndoZXJlKCdpZCcsICc9JywgZGVwLmRlcGVuZHNfb25fZ29hbF9pZClcbiAgICAgICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgICAgIHJldHVybiBnID8gd2l0aEdvYWxSZWxhdGlvbnMoZykgOiBudWxsXG4gICAgICAgIH0sXG4gICAgICB9KSlcbiAgICB9LFxuICAgIHNuYXBzaG90czogYXN5bmMgKCkgPT4ge1xuICAgICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgICAgaWYgKCFjeWNsZSkgcmV0dXJuIFtdXG4gICAgICBjb25zdCByb3dzID0gYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfcHJvZ3Jlc3Nfc25hcHNob3RzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2N5Y2xlX2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgLm9yZGVyQnkoJ2FzX29mJywgJ2FzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZSgpXG4gICAgICByZXR1cm4gcm93cy5tYXAobWFwU25hcHNob3RTY2FsYXJzKVxuICAgIH0sXG4gICAgaXNMb2NrZWQ6IGFzeW5jICgpID0+IHtcbiAgICAgIGlmICghY29uZmlnLmJsb2NrX3VudGlsX3VubG9ja2VkKSByZXR1cm4gZmFsc2VcbiAgICAgIHJldHVybiAhKGF3YWl0IGRlcGVuZGVuY2llc01ldChnb2FsLmlkLCBnb2FsLnVzZXJfaWQpKVxuICAgIH0sXG4gIH1cbn1cblxuZXhwb3J0IGNvbnN0IEdvYWxRdWVyeSA9IHtcbiAgZ29hbHM6IGFzeW5jIChhcmdzPzogeyBzdGF0dXM/OiBzdHJpbmcgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJvbGxPdmVyVXNlckdvYWxzKGRiLCB1c2VySWQpXG5cbiAgICBsZXQgcXVlcnkgPSBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLm9yZGVyQnkoJ3ByaW9yaXR5JywgJ2Rlc2MnKVxuICAgICAgLm9yZGVyQnkoJ3NvcnRfb3JkZXInLCAnYXNjJylcbiAgICAgIC5vcmRlckJ5KCdpZCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuXG4gICAgaWYgKGFyZ3M/LnN0YXR1cykge1xuICAgICAgcXVlcnkgPSBxdWVyeS53aGVyZSgnc3RhdHVzJywgJz0nLCBhcmdzLnN0YXR1cyBhcyBHb2FsUm93WydzdGF0dXMnXSlcbiAgICB9XG5cbiAgICBjb25zdCByb3dzID0gYXdhaXQgcXVlcnkuZXhlY3V0ZSgpXG4gICAgcmV0dXJuIHJvd3MubWFwKHdpdGhHb2FsUmVsYXRpb25zKVxuICB9LFxuXG4gIGdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJvbGxPdmVyVXNlckdvYWxzKGRiLCB1c2VySWQpXG4gICAgY29uc3Qgcm93ID0gYXdhaXQgZGJcbiAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICByZXR1cm4gcm93ID8gd2l0aEdvYWxSZWxhdGlvbnMocm93KSA6IG51bGxcbiAgfSxcblxuICBnb2FsTnVkZ2VzOiBhc3luYyAoYXJncz86IFJlY29yZDxzdHJpbmcsIG5ldmVyPikgPT4ge1xuICAgIHZvaWQgYXJnc1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGF3YWl0IHJvbGxPdmVyVXNlckdvYWxzKGRiLCB1c2VySWQpXG4gICAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZSgpXG5cbiAgICBjb25zdCBwYWlycyA9IFtdXG4gICAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FsX2N5Y2xlcycpXG4gICAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgICAub3JkZXJCeSgnY3ljbGVfaW5kZXgnLCAnZGVzYycpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgICBwYWlycy5wdXNoKHsgZ29hbCwgY3ljbGU6IGN5Y2xlID8/IG51bGwgfSlcbiAgICB9XG4gICAgcmV0dXJuIGJ1aWxkR29hbE51ZGdlcyhwYWlycylcbiAgfSxcblxuICBkYWlseVByb2dyZXNzOiBhc3luYyAoYXJncz86IHsgZGF0ZT86IHN0cmluZyB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZGF0ZSA9IGFyZ3M/LmRhdGUgPz8gbmV3IERhdGUoKS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxuXG4gICAgY29uc3QgY29tcGxldGlvbnMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2FjdGl2aXR5X2NvbXBsZXRpb25zJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdvY2N1cnJlbmNlX2RhdGUnLCAnPScsIGRhdGUpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlKClcblxuICAgIGNvbnN0IHRpbWVFdmVudHMgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfZXZlbnRzJylcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdtZXRyaWMnLCAnPScsICdkdXJhdGlvbicpXG4gICAgICAud2hlcmUoJ29jY3VycmVuY2VfZGF0ZScsICc9JywgZGF0ZSlcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgY29uc3QgbWludXRlc1RvZGF5ID0gdGltZUV2ZW50cy5yZWR1Y2UoXG4gICAgICAoc3VtLCBlKSA9PiBzdW0gKyBOdW1iZXIoZS5hbW91bnQpLFxuICAgICAgMCxcbiAgICApXG5cbiAgICAvLyBTdHJlYWs6IGNvbnNlY3V0aXZlIGRheXMgZW5kaW5nIHRvZGF5IHdpdGggPj0gMSBjb21wbGV0aW9uLlxuICAgIGxldCBzdHJlYWsgPSAwXG4gICAgY29uc3QgY3Vyc29yID0gbmV3IERhdGUoZGF0ZSArICdUMDA6MDA6MDBaJylcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IDM2NTsgaSsrKSB7XG4gICAgICBjb25zdCBkYXkgPSBjdXJzb3IudG9JU09TdHJpbmcoKS5zbGljZSgwLCAxMClcbiAgICAgIGNvbnN0IHJvdyA9IGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdhY3Rpdml0eV9jb21wbGV0aW9ucycpXG4gICAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgICAud2hlcmUoJ29jY3VycmVuY2VfZGF0ZScsICc9JywgZGF5KVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcbiAgICAgIGlmICghcm93KSBicmVha1xuICAgICAgc3RyZWFrKytcbiAgICAgIGN1cnNvci5zZXRVVENEYXRlKGN1cnNvci5nZXRVVENEYXRlKCkgLSAxKVxuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBkYXRlLFxuICAgICAgY29tcGxldGVkQ291bnQ6IGNvbXBsZXRpb25zLmxlbmd0aCxcbiAgICAgIG1pbnV0ZXNUb2RheSxcbiAgICAgIHN0cmVha0RheXM6IHN0cmVhayxcbiAgICAgIGNvbXBsZXRpb25zLFxuICAgIH1cbiAgfSxcbn1cblxuZXhwb3J0IGNvbnN0IEdvYWxNdXRhdGlvbiA9IHtcbiAgY3JlYXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaW5wdXQ6IENyZWF0ZUdvYWxJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKVxuICAgIGNvbnN0IHZhbGlkYXRlZCA9IHZhbGlkYXRlQ3JlYXRlR29hbElucHV0KGlucHV0LCBub3cpXG5cbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGIudHJhbnNhY3Rpb24oKS5leGVjdXRlKGFzeW5jICh0cngpID0+IHtcbiAgICAgIGNvbnN0IGNyZWF0ZWQgPSBhd2FpdCB0cnhcbiAgICAgICAgLmluc2VydEludG8oJ2dvYWxzJylcbiAgICAgICAgLnZhbHVlcyh7XG4gICAgICAgICAgdXNlcl9pZDogdXNlcklkLFxuICAgICAgICAgIHRpdGxlOiB2YWxpZGF0ZWQudGl0bGUsXG4gICAgICAgICAgZGVzY3JpcHRpb246IGlucHV0LmRlc2NyaXB0aW9uID8/IG51bGwsXG4gICAgICAgICAgY29sb3I6IHZhbGlkYXRlZC5jb2xvcixcbiAgICAgICAgICBpY29uOiBpbnB1dC5pY29uID8/IG51bGwsXG4gICAgICAgICAgcnVsZV90eXBlOiB2YWxpZGF0ZWQucnVsZVR5cGUsXG4gICAgICAgICAgbWV0cmljOiBpbnB1dC5tZXRyaWMsXG4gICAgICAgICAgdGFyZ2V0X3ZhbHVlOiB2YWxpZGF0ZWQudGFyZ2V0VmFsdWUsXG4gICAgICAgICAgY29uZmlnOiBKU09OLnN0cmluZ2lmeSh0b0NvbmZpZ0pzb24oaW5wdXQuY29uZmlnKSksXG4gICAgICAgICAgc3RhdHVzOiAnYWN0aXZlJyxcbiAgICAgICAgICByZWN1cnJlbmNlOiB2YWxpZGF0ZWQucmVjdXJyZW5jZVxuICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b1JlY3VycmVuY2VKc29uKHZhbGlkYXRlZC5yZWN1cnJlbmNlKSlcbiAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICBkZWFkbGluZTogdmFsaWRhdGVkLmRlYWRsaW5lXG4gICAgICAgICAgICA/IEpTT04uc3RyaW5naWZ5KHRvRGVhZGxpbmVKc29uKHZhbGlkYXRlZC5kZWFkbGluZSkpXG4gICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgcHJpb3JpdHk6IGlucHV0LnByaW9yaXR5ID8/IDAsXG4gICAgICAgICAgc29ydF9vcmRlcjogaW5wdXQuc29ydE9yZGVyID8/IDAsXG4gICAgICAgICAgc3RhcnRzX2F0OiB2YWxpZGF0ZWQuc3RhcnRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSBhcyBOZXdHb2FsKVxuICAgICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgICAgYXdhaXQgcmVwbGFjZUxpbmtzKHRyeCwgY3JlYXRlZC5pZCwgdXNlcklkLCB2YWxpZGF0ZWQubGlua3MpXG4gICAgICBhd2FpdCByZXBsYWNlRGVwZW5kZW5jaWVzKHRyeCwgY3JlYXRlZC5pZCwgdXNlcklkLCB2YWxpZGF0ZWQuZGVwZW5kZW5jaWVzKVxuICAgICAgYXdhaXQgY3JlYXRlSW5pdGlhbEN5Y2xlKHRyeCwgY3JlYXRlZCwgbm93KVxuICAgICAgcmV0dXJuIGNyZWF0ZWRcbiAgICB9KVxuXG4gICAgYXdhaXQgcmVjb21wdXRlQ3ljbGUoXG4gICAgICBkYixcbiAgICAgIGdvYWwsXG4gICAgICAoYXdhaXQgZGJcbiAgICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KCkpLFxuICAgICAgbm93LFxuICAgIClcblxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhcbiAgICAgIGF3YWl0IGRiXG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKSxcbiAgICApXG4gIH0sXG5cbiAgdXBkYXRlR29hbDogYXN5bmMgKGFyZ3M6IHsgaWQ6IG51bWJlcjsgaW5wdXQ6IFVwZGF0ZUdvYWxJbnB1dCB9KSA9PiB7XG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgZXhpc3RpbmcgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIGNvbnN0IG5vd0RhdGUgPSBuZXcgRGF0ZSgpXG4gICAgY29uc3QgdmFsaWRhdGVkID0gdmFsaWRhdGVVcGRhdGVHb2FsSW5wdXQoXG4gICAgICBhcmdzLmlucHV0LFxuICAgICAgZXhpc3RpbmcucnVsZV90eXBlLFxuICAgICAgbm93RGF0ZSxcbiAgICApXG4gICAgY29uc3QgaW5wdXQgPSBhcmdzLmlucHV0XG4gICAgY29uc3Qgbm93ID0gbm93RGF0ZS50b0lTT1N0cmluZygpXG5cbiAgICBjb25zdCBhY3RpdmVDeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBleGlzdGluZy5pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5vcmRlckJ5KCdjeWNsZV9pbmRleCcsICdkZXNjJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgbGV0IG5leHRTdGFydHNBdDogRGF0ZSB8IHVuZGVmaW5lZFxuICAgIGlmICh2YWxpZGF0ZWQuc3RhcnRzQXQgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGV4aXN0aW5nLnN0YXR1cyA9PT0gJ2NvbXBsZXRlZCcgfHwgZXhpc3Rpbmcuc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcihcbiAgICAgICAgICAnY2Fubm90IGNoYW5nZSBzdGFydHNBdCBvbiBhIGNvbXBsZXRlZCBvciBmYWlsZWQgZ29hbCcsXG4gICAgICAgIClcbiAgICAgIH1cbiAgICAgIGlmICh2YWxpZGF0ZWQuc3RhcnRzQXQgPT0gbnVsbCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZEdvYWxFcnJvcignc3RhcnRzQXQgY2Fubm90IGJlIGNsZWFyZWQ7IG9taXQgdG8gbGVhdmUgdW5jaGFuZ2VkJylcbiAgICAgIH1cbiAgICAgIG5leHRTdGFydHNBdCA9IHZhbGlkYXRlZC5zdGFydHNBdFxuXG4gICAgICBjb25zdCBjbG9zZWRDeWNsZXMgPSBhd2FpdCBkYlxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGV4aXN0aW5nLmlkKVxuICAgICAgICAud2hlcmUoJ3N0YXR1cycsICchPScsICdhY3RpdmUnKVxuICAgICAgICAuc2VsZWN0KCdpZCcpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICAgICAgLy8gQWZ0ZXIgY3ljbGUgMCBoYXMgY2xvc2VkLCBzdGFydCBpcyBmcm96ZW4uXG4gICAgICBpZiAoY2xvc2VkQ3ljbGVzICE9IG51bGwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICAgJ2Nhbm5vdCBjaGFuZ2Ugc3RhcnRzQXQgYWZ0ZXIgdGhlIGZpcnN0IGN5Y2xlIGhhcyBjbG9zZWQnLFxuICAgICAgICApXG4gICAgICB9XG5cbiAgICAgIGNvbnN0IHByb2dyZXNzQmVndW4gPVxuICAgICAgICBhY3RpdmVDeWNsZSAhPSBudWxsICYmIE51bWJlcihhY3RpdmVDeWNsZS5jdXJyZW50X3ZhbHVlKSA+IDBcblxuICAgICAgaWYgKFxuICAgICAgICBwcm9ncmVzc0JlZ3VuICYmXG4gICAgICAgIG5leHRTdGFydHNBdC5nZXRUaW1lKCkgPiBuZXcgRGF0ZShleGlzdGluZy5zdGFydHNfYXQpLmdldFRpbWUoKVxuICAgICAgKSB7XG4gICAgICAgIGlmICghaW5wdXQuY29uZmlybVN0YXJ0c0F0Q2hhbmdlKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEludmFsaWRHb2FsRXJyb3IoXG4gICAgICAgICAgICAnbW92aW5nIHN0YXJ0c0F0IGxhdGVyIGFmdGVyIHByb2dyZXNzIHJlcXVpcmVzIGNvbmZpcm1TdGFydHNBdENoYW5nZScsXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZWZmZWN0aXZlU3RhcnRzQXQgPSBuZXh0U3RhcnRzQXQgPz8gbmV3IERhdGUoZXhpc3Rpbmcuc3RhcnRzX2F0KVxuICAgIGNvbnN0IGVmZmVjdGl2ZURlYWRsaW5lID0gdmFsaWRhdGVkLmRlYWRsaW5lICE9PSB1bmRlZmluZWRcbiAgICAgID8gdmFsaWRhdGVkLmRlYWRsaW5lXG4gICAgICA6ICgoKSA9PiB7XG4gICAgICAgIGNvbnN0IGQgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihleGlzdGluZy5kZWFkbGluZSlcbiAgICAgICAgaWYgKCFkKSByZXR1cm4gbnVsbFxuICAgICAgICByZXR1cm4ge1xuICAgICAgICAgIGtpbmQ6IGQua2luZCxcbiAgICAgICAgICBkYXRlOiBkLmRhdGUsXG4gICAgICAgICAgZGF5c0FmdGVyQ3ljbGVTdGFydDogZC5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0LFxuICAgICAgICAgIGdyYWNlRGF5czogZC5ncmFjZV9kYXlzLFxuICAgICAgICAgIHdhcm5EYXlzOiBkLndhcm5fZGF5cyxcbiAgICAgICAgfVxuICAgICAgfSkoKVxuICAgIGFzc2VydERlYWRsaW5lQWZ0ZXJTdGFydChlZmZlY3RpdmVTdGFydHNBdCwgZWZmZWN0aXZlRGVhZGxpbmUpXG5cbiAgICBhd2FpdCBkYi50cmFuc2FjdGlvbigpLmV4ZWN1dGUoYXN5bmMgKHRyeCkgPT4ge1xuICAgICAgYXdhaXQgdHJ4XG4gICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICAuLi4oaW5wdXQudGl0bGUgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IHRpdGxlOiB2YWxpZGF0ZUdvYWxUaXRsZShpbnB1dC50aXRsZSkgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LmRlc2NyaXB0aW9uICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8geyBkZXNjcmlwdGlvbjogaW5wdXQuZGVzY3JpcHRpb24gfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LmNvbG9yICE9IG51bGxcbiAgICAgICAgICAgID8geyBjb2xvcjogdmFsaWRhdGVHb2FsQ29sb3IoaW5wdXQuY29sb3IpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5pY29uICE9PSB1bmRlZmluZWQgPyB7IGljb246IGlucHV0Lmljb24gfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQucnVsZVR5cGUgIT0gbnVsbCA/IHsgcnVsZV90eXBlOiB2YWxpZGF0ZWQucnVsZVR5cGUgfSA6IHt9KSxcbiAgICAgICAgICAuLi4oaW5wdXQubWV0cmljICE9IG51bGwgPyB7IG1ldHJpYzogaW5wdXQubWV0cmljIH0gOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnRhcmdldFZhbHVlICE9IG51bGxcbiAgICAgICAgICAgID8geyB0YXJnZXRfdmFsdWU6IGlucHV0LnRhcmdldFZhbHVlIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5jb25maWcgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7IGNvbmZpZzogSlNPTi5zdHJpbmdpZnkodG9Db25maWdKc29uKGlucHV0LmNvbmZpZykpIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5zdGF0dXMgIT0gbnVsbCA/IHsgc3RhdHVzOiBpbnB1dC5zdGF0dXMgfSA6IHt9KSxcbiAgICAgICAgICAuLi4odmFsaWRhdGVkLnJlY3VycmVuY2UgIT09IHVuZGVmaW5lZFxuICAgICAgICAgICAgPyB7XG4gICAgICAgICAgICAgIHJlY3VycmVuY2U6IHZhbGlkYXRlZC5yZWN1cnJlbmNlXG4gICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b1JlY3VycmVuY2VKc29uKHZhbGlkYXRlZC5yZWN1cnJlbmNlKSlcbiAgICAgICAgICAgICAgICA6IG51bGwsXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICA6IHt9KSxcbiAgICAgICAgICAuLi4odmFsaWRhdGVkLmRlYWRsaW5lICE9PSB1bmRlZmluZWRcbiAgICAgICAgICAgID8ge1xuICAgICAgICAgICAgICBkZWFkbGluZTogdmFsaWRhdGVkLmRlYWRsaW5lXG4gICAgICAgICAgICAgICAgPyBKU09OLnN0cmluZ2lmeSh0b0RlYWRsaW5lSnNvbih2YWxpZGF0ZWQuZGVhZGxpbmUpKVxuICAgICAgICAgICAgICAgIDogbnVsbCxcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIDoge30pLFxuICAgICAgICAgIC4uLihuZXh0U3RhcnRzQXQgIT0gbnVsbFxuICAgICAgICAgICAgPyB7IHN0YXJ0c19hdDogbmV4dFN0YXJ0c0F0LnRvSVNPU3RyaW5nKCkgfVxuICAgICAgICAgICAgOiB7fSksXG4gICAgICAgICAgLi4uKGlucHV0LnByaW9yaXR5ICE9IG51bGwgPyB7IHByaW9yaXR5OiBpbnB1dC5wcmlvcml0eSB9IDoge30pLFxuICAgICAgICAgIC4uLihpbnB1dC5zb3J0T3JkZXIgIT0gbnVsbCA/IHsgc29ydF9vcmRlcjogaW5wdXQuc29ydE9yZGVyIH0gOiB7fSksXG4gICAgICAgICAgdXBkYXRlZF9hdDogbm93LFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgICAgLmV4ZWN1dGUoKVxuXG4gICAgICBpZiAodmFsaWRhdGVkLmxpbmtzKSB7XG4gICAgICAgIGF3YWl0IHJlcGxhY2VMaW5rcyh0cngsIGFyZ3MuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmxpbmtzKVxuICAgICAgfVxuICAgICAgaWYgKHZhbGlkYXRlZC5kZXBlbmRlbmNpZXMpIHtcbiAgICAgICAgYXdhaXQgcmVwbGFjZURlcGVuZGVuY2llcyh0cngsIGFyZ3MuaWQsIHVzZXJJZCwgdmFsaWRhdGVkLmRlcGVuZGVuY2llcylcbiAgICAgIH1cblxuICAgICAgY29uc3QgZ29hbEFmdGVyID0gYXdhaXQgdHJ4XG4gICAgICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuXG4gICAgICBjb25zdCBjeWNsZSA9IGF3YWl0IHRyeFxuICAgICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAud2hlcmUoJ2dvYWxfaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgICAuc2VsZWN0QWxsKClcbiAgICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuXG4gICAgICBpZiAoY3ljbGUgJiYgbmV4dFN0YXJ0c0F0ICE9IG51bGwpIHtcbiAgICAgICAgYXdhaXQgcmVzY2hlZHVsZUFjdGl2ZUN5Y2xlKHRyeCwgZ29hbEFmdGVyLCBjeWNsZSwgbmV4dFN0YXJ0c0F0LCBub3dEYXRlKVxuICAgICAgfSBlbHNlIGlmIChjeWNsZSAmJiBpbnB1dC50YXJnZXRWYWx1ZSAhPSBudWxsKSB7XG4gICAgICAgIGF3YWl0IHRyeFxuICAgICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAgIC5zZXQoe1xuICAgICAgICAgICAgdGFyZ2V0X3ZhbHVlOiBpbnB1dC50YXJnZXRWYWx1ZSxcbiAgICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdyxcbiAgICAgICAgICB9KVxuICAgICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGN5Y2xlLmlkKVxuICAgICAgICAgIC5leGVjdXRlKClcbiAgICAgIH0gZWxzZSBpZiAoXG4gICAgICAgIGN5Y2xlICYmXG4gICAgICAgICh2YWxpZGF0ZWQuZGVhZGxpbmUgIT09IHVuZGVmaW5lZCB8fCB2YWxpZGF0ZWQucmVjdXJyZW5jZSAhPT0gdW5kZWZpbmVkKSAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPT09IDAgJiZcbiAgICAgICAgY3ljbGUuY3ljbGVfaW5kZXggPT09IDBcbiAgICAgICkge1xuICAgICAgICAvLyBSZWZyZXNoIGJvdW5kcyBvbiB1bnN0YXJ0ZWQgY3ljbGUgMCB3aGVuIGRlYWRsaW5lL3JlY3VycmVuY2UgY2hhbmdlLlxuICAgICAgICBhd2FpdCByZXNjaGVkdWxlQWN0aXZlQ3ljbGUoXG4gICAgICAgICAgdHJ4LFxuICAgICAgICAgIGdvYWxBZnRlcixcbiAgICAgICAgICBjeWNsZSxcbiAgICAgICAgICBuZXcgRGF0ZShnb2FsQWZ0ZXIuc3RhcnRzX2F0KSxcbiAgICAgICAgICBub3dEYXRlLFxuICAgICAgICApXG4gICAgICB9XG4gICAgfSlcblxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAuc2VsZWN0QWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgY29uc3QgY3ljbGUgPSBhd2FpdCBkYlxuICAgICAgLnNlbGVjdEZyb20oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC53aGVyZSgnZ29hbF9pZCcsICc9JywgZ29hbC5pZClcbiAgICAgIC53aGVyZSgnc3RhdHVzJywgJz0nLCAnYWN0aXZlJylcbiAgICAgIC5zZWxlY3RBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3QoKVxuICAgIGlmIChjeWNsZSkgYXdhaXQgcmVjb21wdXRlQ3ljbGUoZGIsIGdvYWwsIGN5Y2xlLCBub3dEYXRlKVxuXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgcGF1c2VHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCBnb2FsID0gYXdhaXQgZGJcbiAgICAgIC51cGRhdGVUYWJsZSgnZ29hbHMnKVxuICAgICAgLnNldCh7IHN0YXR1czogJ3BhdXNlZCcsIHVwZGF0ZWRfYXQ6IG5ldyBEYXRlKCkudG9JU09TdHJpbmcoKSB9KVxuICAgICAgLndoZXJlKCdpZCcsICc9JywgYXJncy5pZClcbiAgICAgIC53aGVyZSgndXNlcl9pZCcsICc9JywgdXNlcklkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgIHJldHVybiB3aXRoR29hbFJlbGF0aW9ucyhnb2FsKVxuICB9LFxuXG4gIHJlc3VtZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAnYWN0aXZlJywgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpIH0pXG4gICAgICAud2hlcmUoJ2lkJywgJz0nLCBhcmdzLmlkKVxuICAgICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgICAud2hlcmUoJ3N0YXR1cycsICc9JywgJ3BhdXNlZCcpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgcmV0dXJuIHdpdGhHb2FsUmVsYXRpb25zKGdvYWwpXG4gIH0sXG5cbiAgYXJjaGl2ZUdvYWw6IGFzeW5jIChhcmdzOiB7IGlkOiBudW1iZXIgfSkgPT4ge1xuICAgIGNvbnN0IHVzZXJJZCA9IHJlcXVpcmVVc2VySWQoKVxuICAgIGNvbnN0IGdvYWwgPSBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCdnb2FscycpXG4gICAgICAuc2V0KHsgc3RhdHVzOiAnYXJjaGl2ZWQnLCB1cGRhdGVkX2F0OiBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbiAgICByZXR1cm4gd2l0aEdvYWxSZWxhdGlvbnMoZ29hbClcbiAgfSxcblxuICBkZWxldGVHb2FsOiBhc3luYyAoYXJnczogeyBpZDogbnVtYmVyIH0pID0+IHtcbiAgICBjb25zdCB1c2VySWQgPSByZXF1aXJlVXNlcklkKClcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCBkYlxuICAgICAgLmRlbGV0ZUZyb20oJ2dvYWxzJylcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGFyZ3MuaWQpXG4gICAgICAud2hlcmUoJ3VzZXJfaWQnLCAnPScsIHVzZXJJZClcbiAgICAgIC5leGVjdXRlKClcbiAgICByZXR1cm4gcmVzdWx0Lmxlbmd0aCA+IDBcbiAgfSxcblxuICByZWNvbXB1dGVHb2FsUHJvZ3Jlc3M6IGFzeW5jIChhcmdzPzogUmVjb3JkPHN0cmluZywgbmV2ZXI+KSA9PiB7XG4gICAgdm9pZCBhcmdzXG4gICAgY29uc3QgdXNlcklkID0gcmVxdWlyZVVzZXJJZCgpXG4gICAgY29uc3QgY291bnQgPSBhd2FpdCByZWNvbXB1dGVBbGxBY3RpdmVDeWNsZXMoZGIsIHVzZXJJZClcbiAgICByZXR1cm4geyByZWNvbXB1dGVkOiBjb3VudCB9XG4gIH0sXG59XG4iLCAiaW1wb3J0IHR5cGUgeyBLeXNlbHksIFRyYW5zYWN0aW9uIH0gZnJvbSAna3lzZWx5J1xuaW1wb3J0IHR5cGUge1xuICBEYXRhYmFzZSxcbiAgR29hbCxcbiAgR29hbEN5Y2xlLFxuICBHb2FsRGVhZGxpbmVDb25maWcsXG4gIEdvYWxSZWN1cnJlbmNlQ29uZmlnLFxuICBOZXdHb2FsQ3ljbGUsXG59IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGN5Y2xlSGFzU3RhcnRlZCB9IGZyb20gJy4vbGlmZWN5Y2xlLnRzJ1xuaW1wb3J0IHsgcmVjb21wdXRlQ3ljbGUgfSBmcm9tICcuL3Byb2dyZXNzLnRzJ1xuXG5leHBvcnQge1xuICBjeWNsZUhhc1N0YXJ0ZWQsXG4gIGxpZmVjeWNsZVBoYXNlLFxuICB0eXBlIEdvYWxMaWZlY3ljbGVQaGFzZSxcbn0gZnJvbSAnLi9saWZlY3ljbGUudHMnXG5cbnR5cGUgRGJMaWtlID0gS3lzZWx5PERhdGFiYXNlPiB8IFRyYW5zYWN0aW9uPERhdGFiYXNlPlxuXG5mdW5jdGlvbiBwYXJzZUpzb248VD4odmFsdWU6IHVua25vd24pOiBUIHwgbnVsbCB7XG4gIGlmICh2YWx1ZSA9PSBudWxsKSByZXR1cm4gbnVsbFxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gSlNPTi5wYXJzZSh2YWx1ZSkgYXMgVFxuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIFRcbn1cblxuZnVuY3Rpb24gYWRkRGF5cyhkYXRlOiBEYXRlLCBkYXlzOiBudW1iZXIpOiBEYXRlIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKGRhdGUpXG4gIGQuc2V0VVRDRGF0ZShkLmdldFVUQ0RhdGUoKSArIGRheXMpXG4gIHJldHVybiBkXG59XG5cbmZ1bmN0aW9uIGFkZE1vbnRocyhkYXRlOiBEYXRlLCBtb250aHM6IG51bWJlcik6IERhdGUge1xuICBjb25zdCBkID0gbmV3IERhdGUoZGF0ZSlcbiAgZC5zZXRVVENNb250aChkLmdldFVUQ01vbnRoKCkgKyBtb250aHMpXG4gIHJldHVybiBkXG59XG5cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlQ3ljbGVFbmQoXG4gIHN0YXJ0c0F0OiBEYXRlLFxuICByZWN1cnJlbmNlOiBHb2FsUmVjdXJyZW5jZUNvbmZpZyB8IG51bGwsXG4pOiBEYXRlIHwgbnVsbCB7XG4gIGlmICghcmVjdXJyZW5jZSkgcmV0dXJuIG51bGxcbiAgY29uc3QgaW50ZXJ2YWwgPSBNYXRoLm1heCgxLCByZWN1cnJlbmNlLmludGVydmFsID8/IDEpXG4gIHN3aXRjaCAocmVjdXJyZW5jZS5wZXJpb2QpIHtcbiAgICBjYXNlICd3ZWVrbHknOlxuICAgICAgcmV0dXJuIGFkZERheXMoc3RhcnRzQXQsIDcgKiBpbnRlcnZhbClcbiAgICBjYXNlICdtb250aGx5JzpcbiAgICAgIHJldHVybiBhZGRNb250aHMoc3RhcnRzQXQsIGludGVydmFsKVxuICAgIGNhc2UgJ3F1YXJ0ZXJseSc6XG4gICAgICByZXR1cm4gYWRkTW9udGhzKHN0YXJ0c0F0LCAzICogaW50ZXJ2YWwpXG4gICAgY2FzZSAnZXZlcnlfeF9kYXlzJzpcbiAgICAgIHJldHVybiBhZGREYXlzKHN0YXJ0c0F0LCBpbnRlcnZhbClcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZURlYWRsaW5lQXQoXG4gIHN0YXJ0c0F0OiBEYXRlLFxuICBkZWFkbGluZTogR29hbERlYWRsaW5lQ29uZmlnIHwgbnVsbCxcbik6IERhdGUgfCBudWxsIHtcbiAgaWYgKCFkZWFkbGluZSkgcmV0dXJuIG51bGxcbiAgaWYgKGRlYWRsaW5lLmtpbmQgPT09ICdhYnNvbHV0ZScgJiYgZGVhZGxpbmUuZGF0ZSkge1xuICAgIHJldHVybiBuZXcgRGF0ZShkZWFkbGluZS5kYXRlICsgJ1QyMzo1OTo1OS45OTlaJylcbiAgfVxuICBpZiAoZGVhZGxpbmUua2luZCA9PT0gJ3JlbGF0aXZlJyAmJiBkZWFkbGluZS5kYXlzX2FmdGVyX2N5Y2xlX3N0YXJ0ICE9IG51bGwpIHtcbiAgICByZXR1cm4gYWRkRGF5cyhzdGFydHNBdCwgZGVhZGxpbmUuZGF5c19hZnRlcl9jeWNsZV9zdGFydClcbiAgfVxuICByZXR1cm4gbnVsbFxufVxuXG5leHBvcnQgdHlwZSBEZWFkbGluZVN0YXRlID0gJ29uX3RyYWNrJyB8ICdhcHByb2FjaGluZycgfCAnb3ZlcmR1ZScgfCAnZmFpbGVkJ1xuXG5leHBvcnQgZnVuY3Rpb24gZGVhZGxpbmVTdGF0ZShcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgZGVhZGxpbmU6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBEZWFkbGluZVN0YXRlIHtcbiAgaWYgKCFjeWNsZS5kZWFkbGluZV9hdCkgcmV0dXJuICdvbl90cmFjaydcbiAgY29uc3QgZGVhZGxpbmVBdCA9IG5ldyBEYXRlKGN5Y2xlLmRlYWRsaW5lX2F0KVxuICBjb25zdCBncmFjZSA9IGRlYWRsaW5lPy5ncmFjZV9kYXlzID8/IDBcbiAgY29uc3Qgd2FybiA9IGRlYWRsaW5lPy53YXJuX2RheXMgPz8gM1xuICBjb25zdCBncmFjZUVuZCA9IGFkZERheXMoZGVhZGxpbmVBdCwgZ3JhY2UpXG5cbiAgaWYgKE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSA+PSBOdW1iZXIoY3ljbGUudGFyZ2V0X3ZhbHVlKSkge1xuICAgIHJldHVybiAnb25fdHJhY2snXG4gIH1cbiAgaWYgKG5vdyA+IGdyYWNlRW5kKSByZXR1cm4gJ2ZhaWxlZCdcbiAgaWYgKG5vdyA+IGRlYWRsaW5lQXQpIHJldHVybiAnb3ZlcmR1ZSdcbiAgY29uc3Qgd2FyblN0YXJ0ID0gYWRkRGF5cyhkZWFkbGluZUF0LCAtd2FybilcbiAgaWYgKG5vdyA+PSB3YXJuU3RhcnQpIHJldHVybiAnYXBwcm9hY2hpbmcnXG4gIHJldHVybiAnb25fdHJhY2snXG59XG5cbmZ1bmN0aW9uIGRhdGVPbmx5SXNvKGRhdGU6IERhdGUpOiBzdHJpbmcge1xuICByZXR1cm4gZGF0ZS50b0lTT1N0cmluZygpLnNsaWNlKDAsIDEwKVxufVxuXG5hc3luYyBmdW5jdGlvbiB3cml0ZVNuYXBzaG90KFxuICBkYjogRGJMaWtlLFxuICBjeWNsZTogR29hbEN5Y2xlLFxuICBhc09mOiBEYXRlLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGFzT2ZTdHIgPSBkYXRlT25seUlzbyhhc09mKVxuICBhd2FpdCBkYlxuICAgIC5pbnNlcnRJbnRvKCdnb2FsX3Byb2dyZXNzX3NuYXBzaG90cycpXG4gICAgLnZhbHVlcyh7XG4gICAgICBnb2FsX2N5Y2xlX2lkOiBjeWNsZS5pZCxcbiAgICAgIGFzX29mOiBhc09mU3RyLFxuICAgICAgdmFsdWU6IE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSxcbiAgICB9KVxuICAgIC5vbkNvbmZsaWN0KChvYykgPT5cbiAgICAgIG9jLmNvbHVtbnMoWydnb2FsX2N5Y2xlX2lkJywgJ2FzX29mJ10pLmRvVXBkYXRlU2V0KHtcbiAgICAgICAgdmFsdWU6IE51bWJlcihjeWNsZS5jdXJyZW50X3ZhbHVlKSxcbiAgICAgIH0pXG4gICAgKVxuICAgIC5leGVjdXRlKClcbn1cblxuLyoqXG4gKiBDcmVhdGUgdGhlIGZpcnN0IGN5Y2xlIGZvciBhIG5ld2x5IGNyZWF0ZWQgZ29hbC5cbiAqIFVzZXMgZ29hbC5zdGFydHNfYXQgYXMgdGhlIGN5Y2xlIHdpbmRvdyBzdGFydCAobm90IHdhbGwtY2xvY2sgbm93KS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNyZWF0ZUluaXRpYWxDeWNsZShcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIGNvbnN0IHJlY3VycmVuY2UgPSBwYXJzZUpzb248R29hbFJlY3VycmVuY2VDb25maWc+KGdvYWwucmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmUgPSBwYXJzZUpzb248R29hbERlYWRsaW5lQ29uZmlnPihnb2FsLmRlYWRsaW5lKVxuICBjb25zdCBzdGFydHNBdCA9IG5ldyBEYXRlKGdvYWwuc3RhcnRzX2F0KVxuICBjb25zdCBlbmRzQXQgPSBjb21wdXRlQ3ljbGVFbmQoc3RhcnRzQXQsIHJlY3VycmVuY2UpXG4gIGNvbnN0IGRlYWRsaW5lQXQgPSBjb21wdXRlRGVhZGxpbmVBdChzdGFydHNBdCwgZGVhZGxpbmUpXG5cbiAgcmV0dXJuIGF3YWl0IGRiXG4gICAgLmluc2VydEludG8oJ2dvYWxfY3ljbGVzJylcbiAgICAudmFsdWVzKHtcbiAgICAgIGdvYWxfaWQ6IGdvYWwuaWQsXG4gICAgICBjeWNsZV9pbmRleDogMCxcbiAgICAgIHN0YXJ0c19hdDogc3RhcnRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgIGVuZHNfYXQ6IGVuZHNBdCA/IGVuZHNBdC50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgIGRlYWRsaW5lX2F0OiBkZWFkbGluZUF0ID8gZGVhZGxpbmVBdC50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICBzdGF0dXM6ICdhY3RpdmUnLFxuICAgICAgY2Fycnlfb3ZlcjogMCxcbiAgICAgIGNyZWF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgfSBhcyBOZXdHb2FsQ3ljbGUpXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cblxuLyoqXG4gKiBSZXdyaXRlIGFuIGFjdGl2ZSBjeWNsZSdzIHdpbmRvdyBmcm9tIGEgbmV3IHN0YXJ0c19hdCAoYW5kIG9wdGlvbmFsXG4gKiB1cGRhdGVkIGdvYWwgcmVjdXJyZW5jZS9kZWFkbGluZS90YXJnZXQpLiBVc2VkIHdoZW4gZWRpdGluZyBzdGFydCBkYXRlXG4gKiBiZWZvcmUgcHJvZ3Jlc3MgLyB3aGVuIHJlc2NoZWR1bGluZyBhbiB1bnN0YXJ0ZWQgY3ljbGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXNjaGVkdWxlQWN0aXZlQ3ljbGUoXG4gIGRiOiBEYkxpa2UsXG4gIGdvYWw6IEdvYWwsXG4gIGN5Y2xlOiBHb2FsQ3ljbGUsXG4gIHN0YXJ0c0F0OiBEYXRlLFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogUHJvbWlzZTxHb2FsQ3ljbGU+IHtcbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IGVuZHNBdCA9IGNvbXB1dGVDeWNsZUVuZChzdGFydHNBdCwgcmVjdXJyZW5jZSlcbiAgY29uc3QgZGVhZGxpbmVBdCA9IGNvbXB1dGVEZWFkbGluZUF0KHN0YXJ0c0F0LCBkZWFkbGluZSlcblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAudXBkYXRlVGFibGUoJ2dvYWxfY3ljbGVzJylcbiAgICAuc2V0KHtcbiAgICAgIHN0YXJ0c19hdDogc3RhcnRzQXQudG9JU09TdHJpbmcoKSxcbiAgICAgIGVuZHNfYXQ6IGVuZHNBdCA/IGVuZHNBdC50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgIGRlYWRsaW5lX2F0OiBkZWFkbGluZUF0ID8gZGVhZGxpbmVBdC50b0lTT1N0cmluZygpIDogbnVsbCxcbiAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgIH0pXG4gICAgLndoZXJlKCdpZCcsICc9JywgY3ljbGUuaWQpXG4gICAgLnJldHVybmluZ0FsbCgpXG4gICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcbn1cblxuLyoqXG4gKiBDbG9zZSBhbiBhY3RpdmUgY3ljbGUgYW5kIG9wZW4gdGhlIG5leHQgb25lIHdoZW4gcmVjdXJyZW5jZSBhcHBsaWVzLlxuICogVXNlcyBsYXp5LW9uLXJlYWQ6IGNhbGwgYmVmb3JlIHJldHVybmluZyBnb2FscyB0byB0aGUgY2xpZW50LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcm9sbE92ZXJJZk5lZWRlZChcbiAgZGI6IERiTGlrZSxcbiAgZ29hbDogR29hbCxcbiAgY3ljbGU6IEdvYWxDeWNsZSxcbiAgbm93OiBEYXRlID0gbmV3IERhdGUoKSxcbik6IFByb21pc2U8R29hbEN5Y2xlPiB7XG4gIC8vIERvIG5vdCByb2xsIG92ZXIsIG1pc3MtYmFja2ZpbGwsIG9yIGZhaWwgZGVhZGxpbmVzIGJlZm9yZSB0aGUgY3ljbGUgc3RhcnRzLlxuICBpZiAoIWN5Y2xlSGFzU3RhcnRlZChjeWNsZSwgbm93KSkge1xuICAgIHJldHVybiBjeWNsZVxuICB9XG5cbiAgY29uc3QgcmVjdXJyZW5jZSA9IHBhcnNlSnNvbjxHb2FsUmVjdXJyZW5jZUNvbmZpZz4oZ29hbC5yZWN1cnJlbmNlKVxuICBpZiAoIXJlY3VycmVuY2UgfHwgIWN5Y2xlLmVuZHNfYXQpIHtcbiAgICAvLyBPbmUtdGltZTogbWF5YmUgZmFpbCBvbiBkZWFkbGluZSBncmFjZS5cbiAgICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gICAgY29uc3Qgc3RhdGUgPSBkZWFkbGluZVN0YXRlKGN5Y2xlLCBkZWFkbGluZSwgbm93KVxuICAgIGlmIChjeWNsZS5zdGF0dXMgPT09ICdhY3RpdmUnICYmIHN0YXRlID09PSAnZmFpbGVkJykge1xuICAgICAgY29uc3QgdXBkYXRlZCA9IGF3YWl0IGRiXG4gICAgICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgICAgICAuc2V0KHtcbiAgICAgICAgICBzdGF0dXM6ICdmYWlsZWQnLFxuICAgICAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgICAgICB9KVxuICAgICAgICAud2hlcmUoJ2lkJywgJz0nLCBjeWNsZS5pZClcbiAgICAgICAgLnJldHVybmluZ0FsbCgpXG4gICAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gICAgICBhd2FpdCBkYlxuICAgICAgICAudXBkYXRlVGFibGUoJ2dvYWxzJylcbiAgICAgICAgLnNldCh7IHN0YXR1czogJ2ZhaWxlZCcsIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpIH0pXG4gICAgICAgIC53aGVyZSgnaWQnLCAnPScsIGdvYWwuaWQpXG4gICAgICAgIC5leGVjdXRlKClcbiAgICAgIGF3YWl0IHdyaXRlU25hcHNob3QoZGIsIHVwZGF0ZWQsIG5vdylcbiAgICAgIHJldHVybiB1cGRhdGVkXG4gICAgfVxuICAgIHJldHVybiBjeWNsZVxuICB9XG5cbiAgaWYgKGN5Y2xlLnN0YXR1cyAhPT0gJ2FjdGl2ZScpIHJldHVybiBjeWNsZVxuICBpZiAobm93IDwgbmV3IERhdGUoY3ljbGUuZW5kc19hdCkpIHJldHVybiBjeWNsZVxuXG4gIC8vIFJlY29tcHV0ZSBvbmUgbGFzdCB0aW1lIGJlZm9yZSBjbG9zaW5nLlxuICBsZXQgY2xvc2VkID0gYXdhaXQgcmVjb21wdXRlQ3ljbGUoZGIsIGdvYWwsIGN5Y2xlKVxuICBjb25zdCBtZXQgPSBOdW1iZXIoY2xvc2VkLmN1cnJlbnRfdmFsdWUpID49IE51bWJlcihjbG9zZWQudGFyZ2V0X3ZhbHVlKVxuICBjb25zdCBkZWFkbGluZSA9IHBhcnNlSnNvbjxHb2FsRGVhZGxpbmVDb25maWc+KGdvYWwuZGVhZGxpbmUpXG4gIGNvbnN0IHN0YXRlID0gZGVhZGxpbmVTdGF0ZShjbG9zZWQsIGRlYWRsaW5lLCBuZXcgRGF0ZShjeWNsZS5lbmRzX2F0KSlcblxuICBsZXQgY2xvc2VTdGF0dXM6IEdvYWxDeWNsZVsnc3RhdHVzJ10gPSBtZXRcbiAgICA/ICdzdWNjZWVkZWQnXG4gICAgOiBzdGF0ZSA9PT0gJ2ZhaWxlZCcgfHwgc3RhdGUgPT09ICdvdmVyZHVlJ1xuICAgID8gJ2ZhaWxlZCdcbiAgICA6ICdtaXNzZWQnXG5cbiAgLy8gQmFjay1maWxsIG1pc3NlZCBpbnRlcm1lZGlhdGUgY3ljbGVzIGlmIHdlIHNraXBwZWQgbXVsdGlwbGUgd2luZG93cy5cbiAgbGV0IGN1cnNvclN0YXJ0ID0gbmV3IERhdGUoY3ljbGUuc3RhcnRzX2F0KVxuICBsZXQgY3Vyc29yRW5kID0gbmV3IERhdGUoY3ljbGUuZW5kc19hdClcbiAgbGV0IGN5Y2xlSW5kZXggPSBjeWNsZS5jeWNsZV9pbmRleFxuICBsZXQgY2FycnkgPSAwXG5cbiAgaWYgKFxuICAgIHJlY3VycmVuY2UuY2Fycnlfb3ZlciA9PT0gJ292ZXJmbG93JyAmJlxuICAgIE51bWJlcihjbG9zZWQuY3VycmVudF92YWx1ZSkgPiBOdW1iZXIoY2xvc2VkLnRhcmdldF92YWx1ZSlcbiAgKSB7XG4gICAgY2FycnkgPSBOdW1iZXIoY2xvc2VkLmN1cnJlbnRfdmFsdWUpIC0gTnVtYmVyKGNsb3NlZC50YXJnZXRfdmFsdWUpXG4gIH1cblxuICBjbG9zZWQgPSBhd2FpdCBkYlxuICAgIC51cGRhdGVUYWJsZSgnZ29hbF9jeWNsZXMnKVxuICAgIC5zZXQoe1xuICAgICAgc3RhdHVzOiBjbG9zZVN0YXR1cyxcbiAgICAgIHVwZGF0ZWRfYXQ6IG5vdy50b0lTT1N0cmluZygpLFxuICAgIH0pXG4gICAgLndoZXJlKCdpZCcsICc9JywgY2xvc2VkLmlkKVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gIGF3YWl0IHdyaXRlU25hcHNob3QoZGIsIGNsb3NlZCwgY3Vyc29yRW5kKVxuXG4gIC8vIEZpbGwgZ2FwcyB1bnRpbCB3ZSByZWFjaCBhIGN5Y2xlIHRoYXQgY29udGFpbnMgYG5vd2AuXG4gIHdoaWxlIChjdXJzb3JFbmQgPD0gbm93KSB7XG4gICAgY29uc3QgbmV4dFN0YXJ0ID0gY3Vyc29yRW5kXG4gICAgY29uc3QgbmV4dEVuZCA9IGNvbXB1dGVDeWNsZUVuZChuZXh0U3RhcnQsIHJlY3VycmVuY2UpXG4gICAgaWYgKCFuZXh0RW5kKSBicmVha1xuXG4gICAgY3ljbGVJbmRleCArPSAxXG5cbiAgICAvLyBJZiB0aGlzIGludGVybWVkaWF0ZSB3aW5kb3cgaXMgYWxyZWFkeSBmdWxseSBpbiB0aGUgcGFzdCwgbWFyayBtaXNzZWQuXG4gICAgaWYgKG5leHRFbmQgPD0gbm93KSB7XG4gICAgICBjb25zdCBtaXNzZWREZWFkbGluZSA9IGNvbXB1dGVEZWFkbGluZUF0KG5leHRTdGFydCwgZGVhZGxpbmUpXG4gICAgICBjb25zdCBtaXNzZWQgPSBhd2FpdCBkYlxuICAgICAgICAuaW5zZXJ0SW50bygnZ29hbF9jeWNsZXMnKVxuICAgICAgICAudmFsdWVzKHtcbiAgICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICAgIGN5Y2xlX2luZGV4OiBjeWNsZUluZGV4LFxuICAgICAgICAgIHN0YXJ0c19hdDogbmV4dFN0YXJ0LnRvSVNPU3RyaW5nKCksXG4gICAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICAgIGRlYWRsaW5lX2F0OiBtaXNzZWREZWFkbGluZSA/IG1pc3NlZERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICAgIHRhcmdldF92YWx1ZTogTnVtYmVyKGdvYWwudGFyZ2V0X3ZhbHVlKSxcbiAgICAgICAgICBjdXJyZW50X3ZhbHVlOiAwLFxuICAgICAgICAgIHN0YXR1czogJ21pc3NlZCcsXG4gICAgICAgICAgY2Fycnlfb3ZlcjogMCxcbiAgICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgICB1cGRhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgfSBhcyBOZXdHb2FsQ3ljbGUpXG4gICAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgICAuZXhlY3V0ZVRha2VGaXJzdE9yVGhyb3coKVxuICAgICAgYXdhaXQgd3JpdGVTbmFwc2hvdChkYiwgbWlzc2VkLCBuZXh0RW5kKVxuICAgICAgY3Vyc29yU3RhcnQgPSBuZXh0U3RhcnRcbiAgICAgIGN1cnNvckVuZCA9IG5leHRFbmRcbiAgICAgIGNhcnJ5ID0gMFxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICAvLyBBY3RpdmUgbmV4dCBjeWNsZS5cbiAgICBjb25zdCBuZXh0RGVhZGxpbmUgPSBjb21wdXRlRGVhZGxpbmVBdChuZXh0U3RhcnQsIGRlYWRsaW5lKVxuICAgIGNvbnN0IG5leHQgPSBhd2FpdCBkYlxuICAgICAgLmluc2VydEludG8oJ2dvYWxfY3ljbGVzJylcbiAgICAgIC52YWx1ZXMoe1xuICAgICAgICBnb2FsX2lkOiBnb2FsLmlkLFxuICAgICAgICBjeWNsZV9pbmRleDogY3ljbGVJbmRleCxcbiAgICAgICAgc3RhcnRzX2F0OiBuZXh0U3RhcnQudG9JU09TdHJpbmcoKSxcbiAgICAgICAgZW5kc19hdDogbmV4dEVuZC50b0lTT1N0cmluZygpLFxuICAgICAgICBkZWFkbGluZV9hdDogbmV4dERlYWRsaW5lID8gbmV4dERlYWRsaW5lLnRvSVNPU3RyaW5nKCkgOiBudWxsLFxuICAgICAgICB0YXJnZXRfdmFsdWU6IE51bWJlcihnb2FsLnRhcmdldF92YWx1ZSksXG4gICAgICAgIGN1cnJlbnRfdmFsdWU6IDAsXG4gICAgICAgIHN0YXR1czogJ2FjdGl2ZScsXG4gICAgICAgIGNhcnJ5X292ZXI6IGNhcnJ5LFxuICAgICAgICBjcmVhdGVkX2F0OiBub3cudG9JU09TdHJpbmcoKSxcbiAgICAgICAgdXBkYXRlZF9hdDogbm93LnRvSVNPU3RyaW5nKCksXG4gICAgICB9IGFzIE5ld0dvYWxDeWNsZSlcbiAgICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgICAgLmV4ZWN1dGVUYWtlRmlyc3RPclRocm93KClcblxuICAgIHJldHVybiBhd2FpdCByZWNvbXB1dGVDeWNsZShkYiwgZ29hbCwgbmV4dClcbiAgfVxuXG4gIHJldHVybiBjbG9zZWRcbn1cblxuLyoqIFJvbGwgb3ZlciBhbGwgYWN0aXZlIGN5Y2xlcyBmb3IgYSB1c2VyIChsYXp5IGJhdGNoKS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByb2xsT3ZlclVzZXJHb2FscyhcbiAgZGI6IERiTGlrZSxcbiAgdXNlcklkOiBudW1iZXIsXG4gIG5vdzogRGF0ZSA9IG5ldyBEYXRlKCksXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgZ29hbHMgPSBhd2FpdCBkYlxuICAgIC5zZWxlY3RGcm9tKCdnb2FscycpXG4gICAgLndoZXJlKCd1c2VyX2lkJywgJz0nLCB1c2VySWQpXG4gICAgLndoZXJlKCdzdGF0dXMnLCAnaW4nLCBbJ2FjdGl2ZScsICdwYXVzZWQnXSlcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZSgpXG5cbiAgZm9yIChjb25zdCBnb2FsIG9mIGdvYWxzKSB7XG4gICAgaWYgKGdvYWwuc3RhdHVzID09PSAncGF1c2VkJykgY29udGludWVcbiAgICBjb25zdCBjeWNsZSA9IGF3YWl0IGRiXG4gICAgICAuc2VsZWN0RnJvbSgnZ29hbF9jeWNsZXMnKVxuICAgICAgLndoZXJlKCdnb2FsX2lkJywgJz0nLCBnb2FsLmlkKVxuICAgICAgLndoZXJlKCdzdGF0dXMnLCAnPScsICdhY3RpdmUnKVxuICAgICAgLm9yZGVyQnkoJ2N5Y2xlX2luZGV4JywgJ2Rlc2MnKVxuICAgICAgLnNlbGVjdEFsbCgpXG4gICAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG4gICAgaWYgKCFjeWNsZSkgY29udGludWVcbiAgICBhd2FpdCByb2xsT3ZlcklmTmVlZGVkKGRiLCBnb2FsLCBjeWNsZSwgbm93KVxuICB9XG59XG4iLCAiaW1wb3J0IHR5cGUgeyBHb2FsLCBHb2FsQ3ljbGUsIEdvYWxEZWFkbGluZUNvbmZpZyB9IGZyb20gJy4uL2RiL3R5cGVzL3NjaGVtYS50cydcbmltcG9ydCB7IGRlYWRsaW5lU3RhdGUgfSBmcm9tICcuL2N5Y2xlcy50cydcblxuZXhwb3J0IHR5cGUgR29hbE51ZGdlS2luZCA9XG4gIHwgJ2RlYWRsaW5lX2FwcHJvYWNoaW5nJ1xuICB8ICdkZWFkbGluZV9vdmVyZHVlJ1xuICB8ICdiZWhpbmRfcGFjZSdcbiAgfCAnY3ljbGVfY29tcGxldGUnXG4gIHwgJ2RlcGVuZGVuY3lfdW5sb2NrZWQnXG4gIHwgJ2dvYWxfc3RhcnRpbmdfc29vbidcblxuZXhwb3J0IGludGVyZmFjZSBHb2FsTnVkZ2Uge1xuICBraW5kOiBHb2FsTnVkZ2VLaW5kXG4gIGdvYWxJZDogbnVtYmVyXG4gIHRpdGxlOiBzdHJpbmdcbiAgbWVzc2FnZTogc3RyaW5nXG4gIHNldmVyaXR5OiAnaW5mbycgfCAnd2FybmluZycgfCAnc3VjY2Vzcydcbn1cblxuZnVuY3Rpb24gcGFyc2VEZWFkbGluZSh2YWx1ZTogdW5rbm93bik6IEdvYWxEZWFkbGluZUNvbmZpZyB8IG51bGwge1xuICBpZiAodmFsdWUgPT0gbnVsbCkgcmV0dXJuIG51bGxcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIEpTT04ucGFyc2UodmFsdWUpIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGxcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHZhbHVlIGFzIEdvYWxEZWFkbGluZUNvbmZpZ1xufVxuXG5jb25zdCBTVEFSVElOR19TT09OX0RBWVMgPSAzXG5cbi8qKlxuICogQnVpbGQgaW4tYXBwIG51ZGdlcyBmb3IgZGFzaGJvYXJkIC8gbm90aWZpY2F0aW9ucyBzdXJmYWNlLlxuICogUHVyZSBmdW5jdGlvbiBcdTIwMTQgbm8gSS9PLlxuICogU2tpcHMgZGVhZGxpbmUvYmVoaW5kX3BhY2UgZm9yIGdvYWxzIHRoYXQgaGF2ZSBub3Qgc3RhcnRlZCB5ZXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZEdvYWxOdWRnZXMoXG4gIGdvYWxzOiBBcnJheTx7IGdvYWw6IEdvYWw7IGN5Y2xlOiBHb2FsQ3ljbGUgfCBudWxsIH0+LFxuICBub3c6IERhdGUgPSBuZXcgRGF0ZSgpLFxuKTogR29hbE51ZGdlW10ge1xuICBjb25zdCBudWRnZXM6IEdvYWxOdWRnZVtdID0gW11cblxuICBmb3IgKGNvbnN0IHsgZ29hbCwgY3ljbGUgfSBvZiBnb2Fscykge1xuICAgIGlmICghY3ljbGUgfHwgZ29hbC5zdGF0dXMgIT09ICdhY3RpdmUnKSBjb250aW51ZVxuXG4gICAgY29uc3Qgc3RhcnRzQXQgPSBuZXcgRGF0ZShnb2FsLnN0YXJ0c19hdClcbiAgICBpZiAoc3RhcnRzQXQgPiBub3cpIHtcbiAgICAgIGNvbnN0IG1zVW50aWwgPSBzdGFydHNBdC5nZXRUaW1lKCkgLSBub3cuZ2V0VGltZSgpXG4gICAgICBjb25zdCBkYXlzVW50aWwgPSBtc1VudGlsIC8gKDI0ICogNjAgKiA2MCAqIDEwMDApXG4gICAgICBpZiAoZGF5c1VudGlsIDw9IFNUQVJUSU5HX1NPT05fREFZUykge1xuICAgICAgICBjb25zdCBkYXlzTGFiZWwgPSBNYXRoLm1heCgxLCBNYXRoLmNlaWwoZGF5c1VudGlsKSlcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdnb2FsX3N0YXJ0aW5nX3Nvb24nLFxuICAgICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgICB0aXRsZTogZ29hbC50aXRsZSxcbiAgICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBzdGFydHMgaW4gJHtkYXlzTGFiZWx9IGRheSR7XG4gICAgICAgICAgICBkYXlzTGFiZWwgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0uYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCB0YXJnZXRNZXQgPVxuICAgICAgY3ljbGUuc3RhdHVzID09PSAnc3VjY2VlZGVkJyB8fFxuICAgICAgKE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCAmJlxuICAgICAgICBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSkgPj0gTnVtYmVyKGN5Y2xlLnRhcmdldF92YWx1ZSkpXG4gICAgaWYgKHRhcmdldE1ldCkge1xuICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICBraW5kOiAnY3ljbGVfY29tcGxldGUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgWW91IGNvbXBsZXRlZCBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGZvciB0aGlzIGN5Y2xlLmAsXG4gICAgICAgIHNldmVyaXR5OiAnc3VjY2VzcycsXG4gICAgICB9KVxuICAgICAgY29udGludWVcbiAgICB9XG5cbiAgICBjb25zdCBkZWFkbGluZSA9IHBhcnNlRGVhZGxpbmUoZ29hbC5kZWFkbGluZSlcbiAgICBjb25zdCBzdGF0ZSA9IGRlYWRsaW5lU3RhdGUoY3ljbGUsIGRlYWRsaW5lLCBub3cpXG4gICAgaWYgKHN0YXRlID09PSAnYXBwcm9hY2hpbmcnKSB7XG4gICAgICBudWRnZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdkZWFkbGluZV9hcHByb2FjaGluZycsXG4gICAgICAgIGdvYWxJZDogZ29hbC5pZCxcbiAgICAgICAgdGl0bGU6IGdvYWwudGl0bGUsXG4gICAgICAgIG1lc3NhZ2U6IGBEZWFkbGluZSBmb3IgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBhcHByb2FjaGluZy5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9IGVsc2UgaWYgKHN0YXRlID09PSAnb3ZlcmR1ZScpIHtcbiAgICAgIG51ZGdlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlYWRsaW5lX292ZXJkdWUnLFxuICAgICAgICBnb2FsSWQ6IGdvYWwuaWQsXG4gICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICBtZXNzYWdlOiBgXHUyMDFDJHtnb2FsLnRpdGxlfVx1MjAxRCBpcyBwYXN0IGl0cyBkZWFkbGluZS5gLFxuICAgICAgICBzZXZlcml0eTogJ3dhcm5pbmcnLFxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBCZWhpbmQtcGFjZSBmb3IgcmVjdXJyaW5nIGN5Y2xlcyB3aXRoIGEga25vd24gZW5kLlxuICAgIGlmIChjeWNsZS5lbmRzX2F0ICYmIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpID4gMCkge1xuICAgICAgY29uc3Qgc3RhcnQgPSBuZXcgRGF0ZShjeWNsZS5zdGFydHNfYXQpLmdldFRpbWUoKVxuICAgICAgY29uc3QgZW5kID0gbmV3IERhdGUoY3ljbGUuZW5kc19hdCkuZ2V0VGltZSgpXG4gICAgICBjb25zdCBzcGFuID0gTWF0aC5tYXgoMSwgZW5kIC0gc3RhcnQpXG4gICAgICBjb25zdCBlbGFwc2VkID0gTWF0aC5taW4oMSwgTWF0aC5tYXgoMCwgKG5vdy5nZXRUaW1lKCkgLSBzdGFydCkgLyBzcGFuKSlcbiAgICAgIGNvbnN0IGV4cGVjdGVkID0gZWxhcHNlZCAqIE51bWJlcihjeWNsZS50YXJnZXRfdmFsdWUpXG4gICAgICBjb25zdCBhY3R1YWwgPSBOdW1iZXIoY3ljbGUuY3VycmVudF92YWx1ZSlcbiAgICAgIGlmIChlbGFwc2VkID49IDAuMzUgJiYgYWN0dWFsIDwgZXhwZWN0ZWQgKiAwLjcpIHtcbiAgICAgICAgbnVkZ2VzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdiZWhpbmRfcGFjZScsXG4gICAgICAgICAgZ29hbElkOiBnb2FsLmlkLFxuICAgICAgICAgIHRpdGxlOiBnb2FsLnRpdGxlLFxuICAgICAgICAgIG1lc3NhZ2U6IGBcdTIwMUMke2dvYWwudGl0bGV9XHUyMDFEIGlzIGJlaGluZCBwYWNlIHRoaXMgY3ljbGUuYCxcbiAgICAgICAgICBzZXZlcml0eTogJ2luZm8nLFxuICAgICAgICB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBudWRnZXNcbn1cbiIsICJpbXBvcnQgeyBjcmVhdGVSZW1vdGVKV0tTZXQsIGp3dFZlcmlmeSB9IGZyb20gJ2pvc2UnXG5pbXBvcnQgdHlwZSB7IENvbnRleHQgfSBmcm9tICdAZ2V0Y3Jvbml0L3B5bG9uJ1xuXG4vLyBQeWxvbiBzZXJ2ZXMgdGhlIGJ1aWx0IGFwcCB3aXRoIEJ1bi9Ob2RlIFx1MjAxNCB1c2UgcHJvY2Vzcy5lbnYsIG5vdCBEZW5vLmVudi5cbmNvbnN0IEFVVEhfQVBJX0RPTUFJTiA9XG4gICh0eXBlb2YgcHJvY2VzcyAhPT0gJ3VuZGVmaW5lZCcgJiYgcHJvY2Vzcy5lbnY/LkFVVEhfQVBJX0RPTUFJTikgfHxcbiAgJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMSdcbmNvbnN0IEpXS1NfVVJMID0gYCR7QVVUSF9BUElfRE9NQUlOfS9hdXRoL2p3dC9qd2tzLmpzb25gXG5cbmNvbnN0IGp3a3MgPSBjcmVhdGVSZW1vdGVKV0tTZXQobmV3IFVSTChKV0tTX1VSTCkpXG5cbmV4cG9ydCB0eXBlIFZlcmlmaWVkQXV0aCA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiB2ZXJpZnlBY2Nlc3NUb2tlbihcbiAgYXV0aG9yaXphdGlvbkhlYWRlcjogc3RyaW5nIHwgdW5kZWZpbmVkLFxuKTogUHJvbWlzZTxWZXJpZmllZEF1dGggfCBudWxsPiB7XG4gIGlmICghYXV0aG9yaXphdGlvbkhlYWRlcj8uc3RhcnRzV2l0aCgnQmVhcmVyICcpKSB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxuXG4gIGNvbnN0IHRva2VuID0gYXV0aG9yaXphdGlvbkhlYWRlci5zbGljZSgnQmVhcmVyICcubGVuZ3RoKS50cmltKClcbiAgaWYgKCF0b2tlbikge1xuICAgIHJldHVybiBudWxsXG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IHsgcGF5bG9hZCB9ID0gYXdhaXQgand0VmVyaWZ5KHRva2VuLCBqd2tzLCB7XG4gICAgICBhbGdvcml0aG1zOiBbJ1JTMjU2J10sXG4gICAgfSlcblxuICAgIGNvbnN0IGF1dGhVc2VySWQgPSB0eXBlb2YgcGF5bG9hZC5zdWIgPT09ICdzdHJpbmcnID8gcGF5bG9hZC5zdWIgOiBudWxsXG4gICAgaWYgKCFhdXRoVXNlcklkKSB7XG4gICAgICByZXR1cm4gbnVsbFxuICAgIH1cblxuICAgIGNvbnN0IGVtYWlsID1cbiAgICAgIHR5cGVvZiBwYXlsb2FkLmVtYWlsID09PSAnc3RyaW5nJyA/IHBheWxvYWQuZW1haWwgOiB1bmRlZmluZWRcblxuICAgIHJldHVybiB7IGF1dGhVc2VySWQsIGVtYWlsIH1cbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGxcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gdW5hdXRob3JpemVkUmVzcG9uc2UoKTogUmVzcG9uc2Uge1xuICByZXR1cm4gbmV3IFJlc3BvbnNlKEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdVbmF1dGhvcml6ZWQnIH0pLCB7XG4gICAgc3RhdHVzOiA0MDEsXG4gICAgaGVhZGVyczoge1xuICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6XG4gICAgICAgICdDb250ZW50LVR5cGUsIEF1dGhvcml6YXRpb24sIHN0LWF1dGgtbW9kZScsXG4gICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgIH0sXG4gIH0pXG59XG5cbi8qKiBDT1JTIHByZWZsaWdodCAvIHNpbXBsZSByZXNwb25zZXMgZm9yIGJyb3dzZXIgR3JhcGhRTCBjbGllbnRzLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcnNNaWRkbGV3YXJlKGN0eDogQ29udGV4dCwgbmV4dDogKCkgPT4gUHJvbWlzZTx2b2lkPikge1xuICBpZiAoY3R4LnJlcS5tZXRob2QgPT09ICdPUFRJT05TJykge1xuICAgIHJldHVybiBuZXcgUmVzcG9uc2UobnVsbCwge1xuICAgICAgc3RhdHVzOiAyMDQsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzpcbiAgICAgICAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICAgICAgICAnQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6ICdHRVQsIFBPU1QsIE9QVElPTlMnLFxuICAgICAgfSxcbiAgICB9KVxuICB9XG5cbiAgYXdhaXQgbmV4dCgpXG5cbiAgY3R4LnJlcy5oZWFkZXJzLnNldCgnQWNjZXNzLUNvbnRyb2wtQWxsb3ctT3JpZ2luJywgJyonKVxuICBjdHgucmVzLmhlYWRlcnMuc2V0KFxuICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJyxcbiAgICAnQ29udGVudC1UeXBlLCBBdXRob3JpemF0aW9uLCBzdC1hdXRoLW1vZGUnLFxuICApXG59XG4iLCAiaW1wb3J0IHsgZGIgfSBmcm9tICcuL2RhdGFiYXNlLnRzJ1xuaW1wb3J0IHR5cGUgeyBVc2VyIH0gZnJvbSAnLi90eXBlcy9zY2hlbWEudHMnXG5cbmV4cG9ydCB0eXBlIEF1dGhJZGVudGl0eSA9IHtcbiAgYXV0aFVzZXJJZDogc3RyaW5nXG4gIGVtYWlsPzogc3RyaW5nXG4gIG5hbWU/OiBzdHJpbmdcbn1cblxuLyoqXG4gKiBSZXNvbHZlIChvciBjcmVhdGUpIHRoZSBsb2NhbCBgdXNlcnNgIHJvdyBmb3IgYSBTdXBlclRva2VucyBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlc29sdmVMb2NhbFVzZXIoaWRlbnRpdHk6IEF1dGhJZGVudGl0eSk6IFByb21pc2U8VXNlcj4ge1xuICBjb25zdCBleGlzdGluZyA9IGF3YWl0IGRiXG4gICAgLnNlbGVjdEZyb20oJ3VzZXJzJylcbiAgICAud2hlcmUoJ2F1dGhfdXNlcl9pZCcsICc9JywgaWRlbnRpdHkuYXV0aFVzZXJJZClcbiAgICAuc2VsZWN0QWxsKClcbiAgICAuZXhlY3V0ZVRha2VGaXJzdCgpXG5cbiAgaWYgKGV4aXN0aW5nKSB7XG4gICAgcmV0dXJuIGV4aXN0aW5nXG4gIH1cblxuICBjb25zdCBlbWFpbCA9XG4gICAgaWRlbnRpdHkuZW1haWw/LnRyaW0oKSB8fFxuICAgIGAke2lkZW50aXR5LmF1dGhVc2VySWR9QHVzZXJzLmxvY2FsYFxuICBjb25zdCBuYW1lID1cbiAgICBpZGVudGl0eS5uYW1lPy50cmltKCkgfHxcbiAgICBlbWFpbC5zcGxpdCgnQCcpWzBdIHx8XG4gICAgJ1VzZXInXG5cbiAgLy8gUHJlZmVyIGxpbmtpbmcgYW4gZXhpc3RpbmcgZW1haWwgcm93IChlLmcuIHNlZWRlZCBkZXYgdXNlcikgd2hlbiBwcmVzZW50LlxuICBjb25zdCBieUVtYWlsID0gYXdhaXQgZGJcbiAgICAuc2VsZWN0RnJvbSgndXNlcnMnKVxuICAgIC53aGVyZSgnZW1haWwnLCAnPScsIGVtYWlsKVxuICAgIC5zZWxlY3RBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0KClcblxuICBpZiAoYnlFbWFpbCkge1xuICAgIHJldHVybiBhd2FpdCBkYlxuICAgICAgLnVwZGF0ZVRhYmxlKCd1c2VycycpXG4gICAgICAuc2V0KHtcbiAgICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgICBuYW1lOiBieUVtYWlsLm5hbWUgfHwgbmFtZSxcbiAgICAgICAgdXBkYXRlZF9hdDogbmV3IERhdGUoKS50b0lTT1N0cmluZygpLFxuICAgICAgfSlcbiAgICAgIC53aGVyZSgnaWQnLCAnPScsIGJ5RW1haWwuaWQpXG4gICAgICAucmV0dXJuaW5nQWxsKClcbiAgICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG4gIH1cblxuICByZXR1cm4gYXdhaXQgZGJcbiAgICAuaW5zZXJ0SW50bygndXNlcnMnKVxuICAgIC52YWx1ZXMoe1xuICAgICAgZW1haWwsXG4gICAgICBuYW1lLFxuICAgICAgYXV0aF91c2VyX2lkOiBpZGVudGl0eS5hdXRoVXNlcklkLFxuICAgICAgcGFzc3dvcmRfaGFzaDogbnVsbCxcbiAgICB9KVxuICAgIC5yZXR1cm5pbmdBbGwoKVxuICAgIC5leGVjdXRlVGFrZUZpcnN0T3JUaHJvdygpXG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQUEsU0FBUyxXQUFXOzs7QUNBcEIsT0FBK0M7QUFDL0MsU0FBUyxjQUFBQSxtQkFBa0I7OztBQ0QzQixPQUEwRTs7O0FDQzFFLFNBQVMsWUFBWTtBQUNyQixTQUFTLFFBQVEsdUJBQXVCO0FBRXhDLElBQU0sVUFBVSxJQUFJLGdCQUFnQjtBQUFBLEVBQ2xDLE1BQU0sSUFBSSxLQUFLO0FBQUEsSUFDYixVQUFVO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixVQUFVO0FBQUEsSUFDVixNQUFNO0FBQUEsSUFDTixLQUFLO0FBQUEsRUFDUCxDQUFDO0FBQ0gsQ0FBQztBQU1NLElBQU0sS0FBSyxJQUFJLE9BQWlCO0FBQUEsRUFDckM7QUFDRixDQUFDOzs7QUNWTSxTQUFTLGVBQ2QsTUFDQSxNQUFZLG9CQUFJLEtBQUssR0FDRDtBQUNwQixNQUFJLEtBQUssV0FBVyxTQUFVLFFBQU87QUFDckMsTUFBSSxLQUFLLFdBQVcsWUFBYSxRQUFPO0FBQ3hDLE1BQUksS0FB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LFVBQVU7QUFDYixXQUFPLHFCQUFxQjtBQUFBLEVBQzlCO0FBRUEsUUFBTSxZQUFZLE1BQU0saUJBQWlCO0FBQUEsSUFDdkMsWUFBWSxTQUFTO0FBQUEsSUFDckIsT0FBTyxTQUFTO0FBQUEsRUFDbEIsQ0FBQztBQUVELE1BQUksSUFBSSxjQUFjLFNBQVMsVUFBVTtBQUN6QyxNQUFJLFNBQVMsT0FBTztBQUNsQixRQUFJLElBQUksYUFBYSxTQUFTLEtBQUs7QUFBQSxFQUNyQztBQUNBLE1BQUksSUFBSSxVQUFVLFVBQVUsRUFBRTtBQUU5QixRQUFNLEtBQUs7QUFDYixDQUFDO0FBRU0sSUFBTSxVQUFVO0FBQUEsRUFDckIsR0FBRztBQUNMO0FBRUEsSUFBTyxjQUFRO0FBSVQsSUFBSSx3QkFBd0I7QUFFNUIsSUFBSTtBQUNGLDBCQUF3QjtBQUMxQixRQUFRO0FBRVI7QUFFQSxJQUFJLElBQUksdUJBQXVCO0FBQUEsRUFDN0IsVUFBVTtBQUFBLEVBQ1Y7QUFBQSxFQUNBLFdBQVcsQ0FBQztBQUFBLEVBQ1osUUFBUTtBQUNWLENBQUMsQ0FBQzsiLAogICJuYW1lcyI6IFsiZ2V0Q29udGV4dCIsICJjb25maWciLCAiZGIiLCAiY29uZmlnIiwgInBhcnNlSnNvbiIsICJkYiIsICJkZWFkbGluZSIsICJzdGF0ZSIsICJwYXJzZUpzb24iLCAiY29uZmlnIiwgImN5Y2xlIiwgInJlc3VsdCIsICJyZXF1aXJlVXNlcklkIiwgImdldENvbnRleHQiLCAiY29uZmlnIiwgInJlc3VsdCIsICJhY3Rpdml0eSIsICJjb21wbGV0aW9uIl0KfQo=
