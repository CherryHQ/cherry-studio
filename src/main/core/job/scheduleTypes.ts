/**
 * Schedule / Trigger / Policy types — main-process only.
 *
 * These types describe how JobManager arms schedules, computes retry backoff,
 * and decides catch-up behavior. They never cross the IPC boundary: renderer
 * does not list, create, or update schedules through DataApi (job triggering
 * is owned by business services in main). Hence they live here rather than in
 * `src/shared/`.
 *
 * Only `JobScheduleSnapshot` is conceptually a candidate for IPC exposure, but
 * the current `JobSchemas` route table exposes no schedule endpoints, so it
 * stays main-only too. If a schedule management surface is ever added, move
 * the entity (and its sub-schemas) back to shared.
 */

import * as z from 'zod'

// ============================================================================
// Trigger (discriminated union: cron / interval / once)
// ============================================================================

export const CronTriggerSchema = z.strictObject({
  kind: z.literal('cron'),
  expr: z.string().min(1),
  timezone: z.string().optional(),
  /** Stop after N firings (croner maxRuns). For trial/test windows. */
  limit: z.number().int().min(1).optional()
})

export const IntervalTriggerSchema = z.strictObject({
  kind: z.literal('interval'),
  ms: z.number().int().min(1),
  anchor: z.enum(['createdAt', 'lastRun']).optional()
})

export const OnceTriggerSchema = z.strictObject({
  kind: z.literal('once'),
  /** Unix ms timestamp at which to fire exactly once. */
  at: z.number().int().min(0)
})

export const TriggerSchema = z.discriminatedUnion('kind', [CronTriggerSchema, IntervalTriggerSchema, OnceTriggerSchema])
export type Trigger = z.infer<typeof TriggerSchema>

// ============================================================================
// CatchUpPolicy (Phase 1: skip-missed / after-startup; after-idle descoped)
// ============================================================================

export const CatchUpPolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('skip-missed') }),
  z.strictObject({ kind: z.literal('after-startup'), minutes: z.number().int().min(0) })
])
export type CatchUpPolicy = z.infer<typeof CatchUpPolicySchema>

// ============================================================================
// RetryPolicy
// ============================================================================

export const RetryPolicySchema = z.strictObject({
  maxAttempts: z.number().int().min(1),
  backoff: z.enum(['exponential', 'fixed', 'none']),
  baseDelayMs: z.number().int().min(0),
  maxDelayMs: z.number().int().min(0)
})
export type RetryPolicy = z.infer<typeof RetryPolicySchema>

// ============================================================================
// JobSchedule entity
// ============================================================================

export const JobScheduleSnapshotSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  name: z.string().nullable(),
  trigger: TriggerSchema,
  jobInputTemplate: z.unknown(),
  enabled: z.boolean(),
  nextRun: z.string().nullable(),
  lastRun: z.string().nullable(),
  catchUpPolicy: CatchUpPolicySchema,
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type JobScheduleSnapshot = z.infer<typeof JobScheduleSnapshotSchema>

// ============================================================================
// Schedule name atom
// ============================================================================

/**
 * Name soft-constraint validator. Length 1-200, no control chars, trim
 * surrounding whitespace, no `__` prefix (reserved for system schedules).
 * Allows Unicode (中文/emoji ok) — name is a user-facing label.
 */
export const JobScheduleNameAtomSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((s) => s === s.trim(), { message: 'name must be trimmed' })
  .refine(
    (s) => {
      for (let i = 0; i < s.length; i++) {
        const code = s.charCodeAt(i)
        if (code === 0 || code === 9 || code === 10 || code === 13) return false
      }
      return true
    },
    { message: 'name cannot contain control characters (NUL/TAB/LF/CR)' }
  )
  .refine((s) => !s.startsWith('__'), { message: 'name cannot start with "__" (reserved)' })

// ============================================================================
// Schedule DTOs (consumed by JobScheduleService.create / update and
// JobManager.registerJobSchedule / updateJobSchedule)
// ============================================================================

export const CreateJobScheduleInputSchema = z.strictObject({
  type: z.string().min(1),
  name: JobScheduleNameAtomSchema.nullable().optional(),
  trigger: TriggerSchema,
  jobInputTemplate: z.unknown(),
  catchUpPolicy: CatchUpPolicySchema,
  metadata: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional()
})
export type CreateJobScheduleDto = z.infer<typeof CreateJobScheduleInputSchema>

export const UpdateJobScheduleInputSchema = z.strictObject({
  name: JobScheduleNameAtomSchema.nullable().optional(),
  trigger: TriggerSchema.optional(),
  jobInputTemplate: z.unknown().optional(),
  catchUpPolicy: CatchUpPolicySchema.optional(),
  enabled: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
})
export type UpdateJobScheduleDto = z.infer<typeof UpdateJobScheduleInputSchema>
