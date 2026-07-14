import { OnConflictBuilder, Transaction } from "kysely";
import { getContext } from "@getcronit/pylon";
import { db } from "../../db/database.ts";
import type {
  Activity as ActivityRow,
  Database,
  Group as GroupRow,
  NewActivity,
  NewActivityCompletion,
  NewGoalEvent,
  NewGroup,
  NewRecurrencePattern,
  RecurrencePattern as RecurrencePatternRow,
} from "../../db/types/schema.ts";
import { recomputeAffectedCycles } from "../../goals/progress.ts";
import {
  CompleteActivityInput,
  CreateActivityInput,
  CreateGroupInput,
  LogTimeInput,
  RecurrenceConfig,
  RecurrencePatternInput,
  UpdateActivityInput,
  UpdateGroupInput,
} from "../types.ts";
import {
  InvalidCompletionError,
  InvalidGroupError,
  validateActivitySchedule,
  validateDurationMinutes,
  validateGroupColor,
  validateGroupName,
  validateOccurrenceDate,
  validatePositiveDuration,
} from "../validation.ts";
import { asNumber } from "../numeric.ts";
import { GoalMutation, GoalQuery } from "./goals_resolvers.ts";
import { RewardMutation, RewardQuery } from "./rewards_resolvers.ts";
import {
  grantRewardsForActivityCompletion,
} from "../../rewards/hooks.ts";
import {
  DbInventoryManager,
} from "../../rewards/inventory.ts";

interface ParsedRecurrencePattern extends Omit<RecurrencePatternRow, "config"> {
  config: RecurrenceConfig;
}

function requireUserId(): number {
  const userId = getContext().get("userId");
  if (typeof userId !== "number") {
    throw new Error("Unauthenticated");
  }
  return userId;
}

function parseConfig(config: RecurrencePatternRow["config"]): RecurrenceConfig | null {
  try {
    return typeof config === "string" ? JSON.parse(config) : config;
  } catch {
    return null;
  }
}

async function fetchRecurrencePattern(activityId: number) {
  return await db
    .selectFrom("recurrence_patterns")
    .where("activity_id", "=", activityId)
    .selectAll()
    .executeTakeFirst();
}

async function fetchGroupForUser(groupId: number, userId: number) {
  return await db
    .selectFrom("groups")
    .where("id", "=", groupId)
    .where("user_id", "=", userId)
    .selectAll()
    .executeTakeFirst();
}

/**
 * Resolves a groupId for create/update. Throws if the group does not belong
 * to the user. Returns null when clearing or when no group is assigned.
 */
async function resolveGroupId(
  groupId: number | null | undefined,
  userId: number,
): Promise<number | null | undefined> {
  if (groupId === undefined) return undefined;
  if (groupId === null) return null;

  const group = await fetchGroupForUser(groupId, userId);
  if (!group) {
    throw new InvalidGroupError("group not found");
  }
  return group.id;
}

async function fetchOwnedActivity(activityId: number, userId: number) {
  return await db
    .selectFrom("activities")
    .where("id", "=", activityId)
    .where("user_id", "=", userId)
    .selectAll()
    .executeTakeFirst();
}

// Pylon resolves nested GraphQL fields from (possibly async) properties on
// the returned object, not from a separate resolver map — so nested data is
// attached inline here rather than via a standalone resolver export.
function withActivityRelations(activity: ActivityRow) {
  return {
    ...activity,
    recurrencePattern: async (): Promise<ParsedRecurrencePattern | null> => {
      if (!activity.is_recurring) return null;
      const pattern = await fetchRecurrencePattern(activity.id);
      if (!pattern) return null;
      const config = parseConfig(pattern.config);
      if (!config) return null;
      return { ...pattern, config };
    },
    group: async (): Promise<GroupRow | null> => {
      if (activity.group_id == null) return null;
      return await db
        .selectFrom("groups")
        .where("id", "=", activity.group_id)
        .selectAll()
        .executeTakeFirst() ?? null;
    },
  };
}

export const Query = {
  groups: async (args?: Record<string, never>) => {
    void args;
    const userId = requireUserId();
    return await db
      .selectFrom("groups")
      .where("user_id", "=", userId)
      .orderBy("name", "asc")
      .selectAll()
      .execute();
  },

  group: async (args: { id: number }) => {
    const userId = requireUserId();
    const { id } = args;
    return await db
      .selectFrom("groups")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .selectAll()
      .executeTakeFirst() ?? null;
  },

  activities: async (args?: Record<string, never>) => {
    void args;
    const userId = requireUserId();
    const rows = await db
      .selectFrom("activities")
      .where("user_id", "=", userId)
      .selectAll()
      .execute();
    return rows.map(withActivityRelations);
  },

  activity: async (args: { id: number }) => {
    const userId = requireUserId();
    const { id } = args;
    const row = await db
      .selectFrom("activities")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .selectAll()
      .executeTakeFirst();
    return row ? withActivityRelations(row) : null;
  },

  activityCompletions: async (args?: {
    activityId?: number;
    fromDate?: string;
    toDate?: string;
  }) => {
    const userId = requireUserId();
    let query = db
      .selectFrom("activity_completions")
      .where("user_id", "=", userId)
      .orderBy("occurrence_date", "desc")
      .selectAll();

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

  ...GoalQuery,
  ...RewardQuery,
};

export const Mutation = {
  createGroup: async (args: { input: CreateGroupInput }) => {
    const { input } = args;
    const userId = requireUserId();
    const name = validateGroupName(input.name);
    const color = validateGroupColor(input.color);
    const now = new Date().toISOString();

    return await db
      .insertInto("groups")
      .values({
        user_id: userId,
        name,
        color,
        created_at: now,
        updated_at: now,
      } as NewGroup)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  updateGroup: async (args: { id: number; input: UpdateGroupInput }) => {
    const { id, input } = args;
    const userId = requireUserId();

    const existing = await db
      .selectFrom("groups")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .selectAll()
      .executeTakeFirstOrThrow();

    const name = input.name !== undefined
      ? validateGroupName(input.name)
      : existing.name;
    const color = input.color !== undefined
      ? validateGroupColor(input.color)
      : existing.color;

    return await db
      .updateTable("groups")
      .set({
        name,
        color,
        updated_at: new Date().toISOString(),
      })
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .returningAll()
      .executeTakeFirstOrThrow();
  },

  deleteGroup: async (args: { id: number }) => {
    const { id } = args;
    const userId = requireUserId();

    const result = await db
      .deleteFrom("groups")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .execute();

    return result.length > 0;
  },

  createActivity: async (
    args: { input: CreateActivityInput },
  ) => {
    const { input } = args;
    const userId = requireUserId();

    validateActivitySchedule({
      isRecurring: input.isRecurring,
      date: input.date,
      recurrencePattern: input.recurrencePattern,
    });

    const groupId = await resolveGroupId(input.groupId ?? null, userId);

    const activity = await db.transaction().execute(async (trx: Transaction<Database>) => {
      const activity = await trx
        .insertInto("activities")
        .values({
          user_id: userId,
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: input.isRecurring,
          date: input.isRecurring ? null : (input.date ?? null),
          group_id: groupId ?? null,
        } as NewActivity)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.isRecurring && input.recurrencePattern) {
        const now = new Date().toISOString();
        await trx
          .insertInto("recurrence_patterns")
          .values({
            activity_id: activity.id,
            recurrence_type: input.recurrencePattern.recurrenceType,
            config: JSON.stringify(input.recurrencePattern.config),
            created_at: now,
            updated_at: now,
          } as NewRecurrencePattern)
          .execute();
      }

      return activity;
    });

    return withActivityRelations(activity);
  },

  updateActivity: async (
    args: { id: number; input: UpdateActivityInput },
  ) => {
    const { id, input } = args;
    const userId = requireUserId();

    const existing = await db
      .selectFrom("activities")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .selectAll()
      .executeTakeFirstOrThrow();

    const isRecurring = input.isRecurring ?? existing.is_recurring;
    const date = input.date !== undefined ? input.date : existing.date;

    // If the schedule is still recurring and no new pattern was supplied,
    // validate against the pattern already on file.
    let recurrencePattern: RecurrencePatternInput | null | undefined = input.recurrencePattern;
    if (isRecurring && !recurrencePattern) {
      const existingPattern = await fetchRecurrencePattern(id);
      if (existingPattern) {
        const config = parseConfig(existingPattern.config);
        recurrencePattern = config
          ? { recurrenceType: existingPattern.recurrence_type, config }
          : undefined;
      }
    }

    validateActivitySchedule({ isRecurring, date, recurrencePattern });

    const resolvedGroupId = input.groupId !== undefined
      ? await resolveGroupId(input.groupId, userId)
      : undefined;

    const activity = await db.transaction().execute(async (trx: Transaction<Database>) => {
      const activity = await trx
        .updateTable("activities")
        .set({
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: isRecurring,
          date: isRecurring ? null : (date ?? null),
          ...(resolvedGroupId !== undefined ? { group_id: resolvedGroupId } : {}),
          updated_at: new Date().toISOString(),
        })
        .where("id", "=", id)
        .where("user_id", "=", userId)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (isRecurring && input.recurrencePattern) {
        const now = new Date().toISOString();
        await trx
          .insertInto("recurrence_patterns")
          .values({
            activity_id: activity.id,
            recurrence_type: input.recurrencePattern.recurrenceType,
            config: JSON.stringify(input.recurrencePattern.config),
            created_at: now,
            updated_at: now,
          } as NewRecurrencePattern)
          .onConflict((oc: OnConflictBuilder<any, any>) =>
            oc.columns(["activity_id"]).doUpdateSet({
              recurrence_type: input.recurrencePattern!.recurrenceType,
              config: JSON.stringify(input.recurrencePattern!.config),
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      } else if (!isRecurring) {
        // Clean up any stale pattern once an activity stops recurring.
        await trx
          .deleteFrom("recurrence_patterns")
          .where("activity_id", "=", activity.id)
          .execute();
      }

      return activity;
    });

    return withActivityRelations(activity);
  },

  deleteActivity: async (
    args: { id: number },
  ) => {
    const { id } = args;
    const userId = requireUserId();

    const result = await db
      .deleteFrom("activities")
      .where("id", "=", id)
      .where("user_id", "=", userId)
      .execute();

    return result.length > 0;
  },

  completeActivity: async (args: { input: CompleteActivityInput }) => {
    const userId = requireUserId();
    const { input } = args;
    const occurrenceDate = validateOccurrenceDate(input.occurrenceDate);
    const durationMinutes = validateDurationMinutes(input.durationMinutes);

    const activity = await fetchOwnedActivity(input.activityId, userId);
    if (!activity) {
      throw new InvalidCompletionError("activity not found");
    }

    const now = new Date().toISOString();
    const completion = await db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom("activity_completions")
        .where("activity_id", "=", activity.id)
        .where("occurrence_date", "=", occurrenceDate)
        .selectAll()
        .executeTakeFirst();

      if (existing) {
        await trx
          .deleteFrom("goal_events")
          .where("completion_id", "=", existing.id)
          .execute();
      }

      const completion = await trx
        .insertInto("activity_completions")
        .values({
          activity_id: activity.id,
          user_id: userId,
          occurrence_date: occurrenceDate,
          duration_minutes: durationMinutes,
          completed_at: now,
          metadata: input.notes
            ? JSON.stringify({ notes: input.notes, title: activity.title })
            : JSON.stringify({ title: activity.title }),
        } as NewActivityCompletion)
        .onConflict((oc) =>
          oc.columns(["activity_id", "occurrence_date"]).doUpdateSet({
            duration_minutes: durationMinutes,
            completed_at: now,
            metadata: input.notes
              ? JSON.stringify({ notes: input.notes, title: activity.title })
              : JSON.stringify({ title: activity.title }),
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      // Count event
      await trx
        .insertInto("goal_events")
        .values({
          user_id: userId,
          source_type: "completion",
          activity_id: activity.id,
          group_id: activity.group_id,
          completion_id: completion.id,
          occurred_at: now,
          occurrence_date: occurrenceDate,
          metric: "count",
          amount: 1,
          metadata: null,
          created_at: now,
        } as NewGoalEvent)
        .execute();

      // Optional duration event when minutes provided or derived from schedule.
      let minutes = durationMinutes;
      if (minutes == null) {
        // Derive from scheduled slot when possible.
        const [sh, sm] = activity.start_time.split(":").map(Number);
        const [eh, em] = activity.end_time.split(":").map(Number);
        const derived = (eh * 60 + em) - (sh * 60 + sm);
        if (derived > 0) minutes = derived;
      }
      if (minutes != null && minutes > 0) {
        await trx
          .insertInto("goal_events")
          .values({
            user_id: userId,
            source_type: "completion",
            activity_id: activity.id,
            group_id: activity.group_id,
            completion_id: completion.id,
            occurred_at: now,
            occurrence_date: occurrenceDate,
            metric: "duration",
            amount: minutes,
            metadata: null,
            created_at: now,
          } as NewGoalEvent)
          .execute();
      }

      return completion;
    });

    await recomputeAffectedCycles(db, userId, {
      activityId: activity.id,
      groupId: activity.group_id,
    });

    const granted = await db.transaction().execute(async (trx) => {
      return await grantRewardsForActivityCompletion(trx, {
        userId,
        activityId: activity.id,
        completionId: completion.id,
      });
    });

    return {
      ...completion,
      grantedRewards: granted
        .filter((g) => !g.skipped && g.transaction)
        .map((g) => g.transaction),
    };
  },

  undoCompletion: async (args: { id: number }) => {
    const userId = requireUserId();
    const existing = await db
      .selectFrom("activity_completions")
      .where("id", "=", args.id)
      .where("user_id", "=", userId)
      .selectAll()
      .executeTakeFirst();
    if (!existing) return false;

    const activity = await fetchOwnedActivity(existing.activity_id, userId);

    await db.transaction().execute(async (trx) => {
      const manager = new DbInventoryManager();
      await manager.revokeUnconsumedForCompletion(trx, userId, existing.id);
      await trx
        .deleteFrom("goal_events")
        .where("completion_id", "=", existing.id)
        .execute();
      await trx
        .deleteFrom("activity_completions")
        .where("id", "=", existing.id)
        .execute();
    });

    await recomputeAffectedCycles(db, userId, {
      activityId: existing.activity_id,
      groupId: activity?.group_id ?? null,
    });

    return true;
  },

  logTime: async (args: { input: LogTimeInput }) => {
    const userId = requireUserId();
    const { input } = args;
    const minutes = validatePositiveDuration(input.durationMinutes);
    const occurrenceDate = validateOccurrenceDate(
      input.occurrenceDate ?? new Date().toISOString().slice(0, 10),
    );

    const activity = await fetchOwnedActivity(input.activityId, userId);
    if (!activity) {
      throw new InvalidCompletionError("activity not found");
    }

    const now = new Date().toISOString();
    const event = await db
      .insertInto("goal_events")
      .values({
        user_id: userId,
        source_type: "time_log",
        activity_id: activity.id,
        group_id: activity.group_id,
        completion_id: null,
        occurred_at: now,
        occurrence_date: occurrenceDate,
        metric: "duration",
        amount: minutes,
        metadata: input.notes
          ? JSON.stringify({ notes: input.notes })
          : null,
        created_at: now,
      } as NewGoalEvent)
      .returningAll()
      .executeTakeFirstOrThrow();

    await recomputeAffectedCycles(db, userId, {
      activityId: activity.id,
      groupId: activity.group_id,
    });

    return {
      ...event,
      amount: asNumber(event.amount),
    };
  },

  ...GoalMutation,
  ...RewardMutation,
};

export const resolvers = {
  Query,
  Mutation,
};
