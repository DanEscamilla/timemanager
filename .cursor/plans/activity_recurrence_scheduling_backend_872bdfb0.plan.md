---
name: Activity recurrence scheduling backend
overview: Finish and correct the partially-built recurrence support in `timemanager-api` so activities can be either one-off (with a specific date) or recurring on a weekly / monthly / every-X-days schedule, with proper validation, a fixed DB constraint bug, and a real read path.
todos:
  - id: migration
    content: "Write migration: activities.date column + CHECK, recurrence_type CHECK update, unique constraint on recurrence_patterns.activity_id"
    status: completed
  - id: types
    content: Update db/types/schema.ts, graphql/types.ts, and graphql/schema.ts (docs) for new date field and 3-type recurrence config shape
    status: completed
  - id: validation
    content: Add validation.ts with validateActivitySchedule() and wire into createActivity/updateActivity
    status: completed
  - id: resolvers
    content: "Fix resolvers.ts: remove dead field-resolver exports, return recurrencePattern inline per Pylon convention, clean up stale patterns when isRecurring turns false, tighten Transaction typing"
    status: completed
  - id: tests
    content: Add validation.test.ts covering required-field and per-type rules; run deno test
    status: completed
  - id: verify
    content: Run migration locally, regenerate/check .pylon/schema.graphql, manually exercise all 3 recurrence types + one-off date via GraphQL
    status: completed
isProject: false
---

## Context

The DB and API already have unfinished scaffolding for this (`activities.is_recurring`, `recurrence_patterns` table with a `config` jsonb column), but it's inconsistent and has real bugs:

- `activities` has no calendar `date` at all — only `start_time`/`end_time` (time-of-day). One-off activities can't be scheduled on a specific day today.
- `recurrence_patterns.recurrence_type` CHECK allows `'daily' | 'weekly' | 'monthly' | 'custom'` with overlapping interval fields (`days_interval` vs `custom_interval`) — decided to consolidate to exactly `'weekly' | 'monthly' | 'every_x_days'`.
- `recurrence_patterns.activity_id` has **no unique constraint**, but `updateActivity` already does `onConflict(['activity_id'])` — this upsert is broken today.
- `ActivityResolver` / `RecurrencePatternResolver` are exported from `resolvers.ts` but never wired in — Pylon doesn't use resolver maps like that; it expects nested fields returned as (possibly async) properties directly on the object returned from `Query`/`Mutation` functions. So recurrence is currently write-only; there's no way to read it back over GraphQL.
- `graphql/types.ts` config shape (`is_last_day_of_month`, `days_interval`, `custom_interval`) doesn't match `db/types/schema.ts` (`days_of_month: (number|'last')[]`, `days_interval`, `custom_interval`).

This plan is **backend-only** (confirmed with user) — `apps/timemanager` Flutter client is not touched, but it will need follow-up work later since it currently always sends `isRecurring: false` and never reads/writes a date.

## Data model changes

Add a migration `apps/timemanager-api/src/db/migrations/2026-07-12T16:45:00_activity_scheduling.ts`:

1. `ALTER TABLE activities ADD COLUMN date date` (nullable).
2. `ALTER TABLE activities ADD CONSTRAINT activities_date_or_recurring CHECK ((is_recurring AND date IS NULL) OR (NOT is_recurring AND date IS NOT NULL))` — DB-level guarantee that non-recurring activities have a date and recurring ones don't.
3. Drop and recreate the `recurrence_type` CHECK constraint on `recurrence_patterns` to allow only `'weekly' | 'monthly' | 'every_x_days'`.
4. Replace the plain `recurrence_patterns_activity_id_index` with a **unique** index/constraint on `activity_id` (fixes the existing `onConflict` bug — one pattern per activity).

`down()` reverses all four steps.

## Type layer

- [apps/timemanager-api/src/db/types/schema.ts](apps/timemanager-api/src/db/types/schema.ts): add `date: string | null` to `ActivitiesTable`; change `RecurrencePatternsTable.recurrence_type` to `'weekly' | 'monthly' | 'every_x_days'`; unify `config` to:

```typescript
config: ColumnType<{
  days_of_week?: number[]        // weekly: 0-6, Sun=0
  days_of_month?: (number | 'last')[]  // monthly: 1-31 or 'last'
  interval_days?: number         // every_x_days: >= 1
  start_date: string
  end_date?: string | null
}, string, string>
```

- [apps/timemanager-api/src/graphql/types.ts](apps/timemanager-api/src/graphql/types.ts): mirror the same `RecurrenceConfig` shape and `recurrenceType` union; add `date?: string | null` to `CreateActivityInput`/`UpdateActivityInput`.
- [apps/timemanager-api/src/graphql/schema.ts](apps/timemanager-api/src/graphql/schema.ts) (currently unused/aspirational doc file): update to match, so it doesn't mislead future readers.

## Validation logic

Extract a small pure function (testable without a DB), e.g. `apps/timemanager-api/src/graphql/validation.ts`:

```typescript
export function validateActivitySchedule(input: {
  isRecurring: boolean
  date?: string | null
  recurrencePattern?: { recurrenceType: string; config: RecurrenceConfig } | null
}): void
```

Rules:
- `isRecurring: true` → `recurrencePattern` required; reject if missing.
  - `weekly` → `config.days_of_week` must be a non-empty array of integers 0-6.
  - `monthly` → `config.days_of_month` must be a non-empty array, each either 1-31 or `'last'`.
  - `every_x_days` → `config.interval_days` must be an integer >= 1.
  - `config.start_date` always required.
- `isRecurring: false` → `date` required (reject if missing/null).

`createActivity`/`updateActivity` call this before touching the DB. When `isRecurring` is true, force `date: null` on the row; when false, ignore/clear any `recurrencePattern` and (on update) delete any existing `recurrence_patterns` row for that activity so stale patterns don't linger.

## Resolvers (`apps/timemanager-api/src/graphql/resolvers/resolvers.ts`)

- Remove the dead `ActivityResolver` / `RecurrencePatternResolver` exports.
- In `Query.activities` / `Query.activity`, return each row with an inline `recurrencePattern` accessor (Pylon's actual convention — nested fields are plain/async properties on the returned object, not a separate resolver map), fetching from `recurrence_patterns` only when `is_recurring` is true.
- Apply the same pattern to the objects returned from `createActivity`/`updateActivity` so the created/updated pattern can be read back immediately.
- Fix `db.transaction().execute(async (trx: Transaction<any>) => ...)` → type as `Transaction<Database>` where feasible, since Pylon infers the GraphQL return type from the TS signature; today mutations return an opaque `Object!` (verify via `.pylon/schema.graphql` regeneration after the change, and adjust if Pylon still can't infer it).
- Call `validateActivitySchedule` at the top of `createActivity`/`updateActivity` before the transaction.

## Tests

Add `apps/timemanager-api/src/graphql/validation.test.ts` (`deno test`, no DB needed) covering:
- Throws when `isRecurring: true` with no `recurrencePattern`.
- Throws when `isRecurring: false` with no `date`.
- Throws for weekly pattern missing/invalid `days_of_week`.
- Throws for monthly pattern with an out-of-range day (e.g. `32`).
- Throws for `every_x_days` with `interval_days < 1`.
- Accepts one valid case per recurrence type, and a valid non-recurring case.

## Verification

- Run `nx run timemanager-api:migrate` against the local Postgres to confirm the migration applies cleanly, then spot-check with a manual GraphQL mutation for each of the 3 recurrence types plus a one-off date.
- Re-check `.pylon/schema.graphql` (regenerated on `nx serve timemanager-api`) to confirm the new enum/fields appear and mutation return types are usable.
- Run `deno test` from `apps/timemanager-api` for the new validation tests.

## Out of scope (follow-up, not this plan)

- `apps/timemanager` Flutter client: `models/activity.dart`, `services/activity_repository.dart`, and `screens/activity_form_screen.dart` still hardcode `isRecurring: false` and don't expose date/recurrence UI. Left for a separate task.
- `activity_completions` table remains unused (no queries/mutations) — not needed for this feature.
