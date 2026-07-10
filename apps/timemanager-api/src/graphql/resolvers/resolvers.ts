import { OnConflictBuilder, Transaction } from "kysely";
import { db } from "../../db/database.ts";
import type { Activity as ActivityType, NewActivity, NewRecurrencePattern, RecurrencePattern as RecurrencePatternType } from "../../db/types/schema.ts";
import { Context, CreateActivityInput, UpdateActivityInput } from "../types.ts";

export const Query = {
  activities: async (args: Record<string, never>, context: Context) => {
    return await db
      .selectFrom('activities')
      .where('user_id', '=', context.userId)
      .selectAll()
      .execute()
  },
  activity: async (args: { id: number }, context: Context) => {
    const { id } = args;
    return await db
      .selectFrom('activities')
      .where('id', '=', id)
      .where('user_id', '=', context.userId)
      .selectAll()
      .executeTakeFirst()
  },
}

export const Mutation = {
  createActivity: async (
    args: { input: CreateActivityInput },
    context: Context
  ) => {
    const { input } = args;
    const { userId } = context;

    const activity = await db.transaction().execute(async (trx: Transaction<any>) => {
      const activity = await trx
        .insertInto('activities')
        .values({
          user_id: userId,
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: input.isRecurring,
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

    return activity;
  },

  updateActivity: async (
    args: { id: number; input: UpdateActivityInput },
    context: Context
  ) => {
    const { id, input } = args;
    const { userId } = context;

    return await db.transaction().execute(async (trx: Transaction<any>) => {
      const activity = await trx
        .updateTable('activities')
        .set({
          title: input.title,
          description: input.description,
          start_time: input.startTime,
          end_time: input.endTime,
          is_recurring: input.isRecurring,
          updated_at: new Date().toISOString(),
        })
        .where('id', '=', id)
        .where('user_id', '=', userId)
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
          .onConflict((oc: OnConflictBuilder<any, any>) =>
            oc.columns(['activity_id']).doUpdateSet({
              recurrence_type: input.recurrencePattern!.recurrenceType,
              config: JSON.stringify(input.recurrencePattern!.config),
              updated_at: new Date().toISOString(),
            })
          )
          .execute();
      }

      return activity;
    });
  },

  deleteActivity: async (
    args: { id: number },
    context: Context
  ) => {
    const { id } = args;
    const { userId } = context;

    const result = await db
      .deleteFrom('activities')
      .where('id', '=', id)
      .where('user_id', '=', userId)
      .execute();

    return result.length > 0;
  },
}

export const ActivityResolver = {
  recurrencePattern: async (parent: ActivityType) => {
    if (!parent.is_recurring) return null;
    return await db
      .selectFrom('recurrence_patterns')
      .where('activity_id', '=', parent.id)
      .selectAll()
      .executeTakeFirst();
  }
}

export const RecurrencePatternResolver = {
  config: (parent: RecurrencePatternType) => {
    try {
      return typeof parent.config === 'string' ? JSON.parse(parent.config) : parent.config;
    } catch {
      return null;
    }
  }
}

export const resolvers = {
  Query,
  Mutation,
} 