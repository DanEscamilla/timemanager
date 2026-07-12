import { OnConflictBuilder, Transaction } from "kysely";
import { getContext } from "@getcronit/pylon";
import { db } from "../../db/database.ts";
import type {
  Activity as ActivityRow,
  Database,
  NewActivity,
  NewRecurrencePattern,
  RecurrencePattern as RecurrencePatternRow,
} from "../../db/types/schema.ts";
import { CreateActivityInput, RecurrenceConfig, RecurrencePatternInput, UpdateActivityInput } from "../types.ts";
import { validateActivitySchedule } from "../validation.ts";

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

// Pylon resolves nested GraphQL fields from (possibly async) properties on
// the returned object, not from a separate resolver map — so recurrence data
// is attached inline here rather than via a standalone resolver export.
function withRecurrencePattern(activity: ActivityRow) {
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
  };
}

export const Query = {
  activities: async (args?: Record<string, never>) => {
    void args;
    const userId = requireUserId();
    const rows = await db
      .selectFrom('activities')
      .where('user_id', '=', userId)
      .selectAll()
      .execute()
    return rows.map(withRecurrencePattern);
  },
  activity: async (args: { id: number }) => {
    const userId = requireUserId();
    const { id } = args;
    const row = await db
      .selectFrom('activities')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .selectAll()
      .executeTakeFirst()
    return row ? withRecurrencePattern(row) : null;
  },
}

export const Mutation = {
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

    const activity = await db.transaction().execute(async (trx: Transaction<Database>) => {
      const activity = await trx
        .insertInto('activities')
        .values({
          user_id: userId,
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: input.isRecurring,
          date: input.isRecurring ? null : (input.date ?? null),
        } as NewActivity)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (input.isRecurring && input.recurrencePattern) {
        const now = new Date().toISOString();
        await trx
          .insertInto('recurrence_patterns')
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

    return withRecurrencePattern(activity);
  },

  updateActivity: async (
    args: { id: number; input: UpdateActivityInput },
  ) => {
    const { id, input } = args;
    const userId = requireUserId();

    const existing = await db
      .selectFrom('activities')
      .where('id', '=', id)
      .where('user_id', '=', userId)
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

    const activity = await db.transaction().execute(async (trx: Transaction<Database>) => {
      const activity = await trx
        .updateTable('activities')
        .set({
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: isRecurring,
          date: isRecurring ? null : (date ?? null),
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
        .returningAll()
        .executeTakeFirstOrThrow();

      if (isRecurring && input.recurrencePattern) {
        const now = new Date().toISOString();
        await trx
          .insertInto('recurrence_patterns')
          .values({
            activity_id: activity.id,
            recurrence_type: input.recurrencePattern.recurrenceType,
            config: JSON.stringify(input.recurrencePattern.config),
            created_at: now,
            updated_at: now,
          } as NewRecurrencePattern)
          .onConflict((oc: OnConflictBuilder<any, any>) =>
            oc.columns(['activity_id']).doUpdateSet({
              recurrence_type: input.recurrencePattern!.recurrenceType,
              config: JSON.stringify(input.recurrencePattern!.config),
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      } else if (!isRecurring) {
        // Clean up any stale pattern once an activity stops recurring.
        await trx
          .deleteFrom('recurrence_patterns')
          .where('activity_id', '=', activity.id)
          .execute();
      }

      return activity;
    });

    return withRecurrencePattern(activity);
  },

  deleteActivity: async (
    args: { id: number },
  ) => {
    const { id } = args;
    const userId = requireUserId();

    const result = await db
      .deleteFrom('activities')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .execute();

    return result.length > 0;
  },
}

export const resolvers = {
  Query,
  Mutation,
}
