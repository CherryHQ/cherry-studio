import type { CatchUpPolicy, Trigger } from '@main/core/job/scheduleTypes'
import type { JobError } from '@shared/data/api/schemas/jobs'
import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { createUpdateTimestamps, uuidPrimaryKey, uuidPrimaryKeyOrdered } from './_columnHelpers'

/**
 * Persistent schedule registry for recurring/once jobs.
 *
 * Each row maps a logical `type` (+ optional `name` for multi-instance types)
 * to a `Trigger` (cron / interval / once) and a `jobInputTemplate` that becomes
 * the `input` of every job spawned by this schedule. JobManager.registerJobSchedule
 * owns the lifecycle; SchedulerService receives a `() => jobManager.enqueue(...)`
 * callback and does not look at this table.
 *
 * NOTE: `name=''` is the singleton sentinel for single-instance types. The
 * external API schema (JobScheduleNameAtomSchema) rejects empty strings, so
 * only JobScheduleService writes `''` internally. UNIQUE(type, name) then
 * DB-enforces the "one schedule per single-instance type" invariant — every
 * empty string compares equal under SQLite UNIQUE semantics.
 */
export const jobScheduleTable = sqliteTable(
  'job_schedule',
  {
    id: uuidPrimaryKey(),
    type: text().notNull(),
    name: text().notNull().default(''),
    trigger: text({ mode: 'json' }).$type<Trigger>().notNull(),
    jobInputTemplate: text({ mode: 'json' }).$type<unknown>().notNull(),
    enabled: integer({ mode: 'boolean' }).notNull().default(true),
    nextRun: integer(),
    lastRun: integer(),
    catchUpPolicy: text({ mode: 'json' }).$type<CatchUpPolicy>().notNull(),
    metadata: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    ...createUpdateTimestamps
  },
  (t) => [
    uniqueIndex('job_schedule_type_name_uq').on(t.type, t.name),
    index('job_schedule_enabled_next_run_idx').on(t.enabled, t.nextRun),
    index('job_schedule_type_idx').on(t.type)
  ]
)

/**
 * Single source of truth for every job's lifecycle. Six states:
 *   pending → running → completed
 *           ↘ failed
 *           ↘ cancelled
 *           ↘ delayed (scheduledAt > now or retry backoff) → pending
 *
 * dispatch path reads: WHERE queue=? AND status='pending' AND scheduledAt<=now()
 * ORDER BY priority ASC, scheduledAt ASC LIMIT 1. The composite index
 * job_queue_status_scheduled_at_idx covers it.
 *
 * idempotencyKey partial unique guarantees at most one non-terminal job per key.
 * scheduleId index by (scheduleId, finishedAt) supports
 * "last N terminal jobs by schedule" — used by handler.onSettled for circuit
 * breaker logic (no separate tracker table needed).
 */
export const jobTable = sqliteTable(
  'job',
  {
    id: uuidPrimaryKeyOrdered(),
    type: text().notNull(),
    status: text().notNull(),
    priority: integer().notNull().default(0),
    queue: text().notNull(),
    idempotencyKey: text(),
    scheduleId: text().references(() => jobScheduleTable.id, { onDelete: 'set null' }),
    scheduledAt: integer().notNull(),
    startedAt: integer(),
    finishedAt: integer(),
    attempt: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(3),
    input: text({ mode: 'json' }).$type<unknown>().notNull(),
    output: text({ mode: 'json' }).$type<unknown>(),
    error: text({ mode: 'json' }).$type<JobError>(),
    parentId: text(),
    cancelRequested: integer({ mode: 'boolean' }).notNull().default(false),
    metadata: text({ mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    timeoutMs: integer(),
    ...createUpdateTimestamps
  },
  (t) => [
    check('job_status_check', sql`${t.status} IN ('pending','delayed','running','completed','failed','cancelled')`),
    index('job_queue_status_scheduled_at_idx').on(t.queue, t.status, t.scheduledAt),
    index('job_status_idx').on(t.status),
    index('job_schedule_id_finished_at_idx').on(t.scheduleId, t.finishedAt),
    index('job_parent_id_idx').on(t.parentId),
    uniqueIndex('job_idempotency_key_partial_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL AND ${t.status} NOT IN ('completed','failed','cancelled')`),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id]
    }).onDelete('set null')
  ]
)

export type JobRow = typeof jobTable.$inferSelect
export type InsertJobRow = typeof jobTable.$inferInsert
export type JobScheduleRow = typeof jobScheduleTable.$inferSelect
export type InsertJobScheduleRow = typeof jobScheduleTable.$inferInsert
