/**
 * Jobs / Schedules domain API Schema definitions.
 *
 * Entity schemas live here (Rule C/D in api/README.md). Field atoms,
 * discriminated unions for Trigger / CatchUpPolicy / RetryPolicy, and the
 * Job + JobSchedule snapshots that both the DataApi response and the renderer
 * useJob hook consume.
 *
 * NOTE: Handler runtime types (JobHandler / JobContext / JobMissEvent /
 * JobSettledEvent) are NOT in shared — they belong to main-process internals
 * at src/main/core/job/types.ts. Renderer never instantiates them.
 */

import * as z from 'zod'

// ============================================================================
// Field atoms
// ============================================================================

export const JobStatusAtomSchema = z.enum(['pending', 'delayed', 'running', 'completed', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof JobStatusAtomSchema>

/** Terminal states: jobs in these states are finished and never resume. */
export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled'] as const satisfies readonly JobStatus[]

export const isTerminalStatus = (status: JobStatus): boolean =>
  (TERMINAL_JOB_STATUSES as readonly JobStatus[]).includes(status)

/**
 * Stable error structure crossing the IPC boundary. `code` is an English
 * constant; renderer maps it to a localized message via
 * `t(\`errors.jobs.${code.toLowerCase()}\`, params)`.
 */
export const JobErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean()
})
export type JobError = z.infer<typeof JobErrorSchema>

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
// Job entity (renderer-visible snapshot)
// ============================================================================

export const JobSnapshotSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  status: JobStatusAtomSchema,
  priority: z.number().int(),
  queue: z.string(),
  idempotencyKey: z.string().nullable(),
  scheduleId: z.string().nullable(),
  scheduledAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  attempt: z.number().int().min(0),
  maxAttempts: z.number().int().min(1),
  input: z.unknown(),
  output: z.unknown().nullable(),
  error: JobErrorSchema.nullable(),
  parentId: z.string().nullable(),
  cancelRequested: z.boolean(),
  metadata: z.record(z.string(), z.unknown()),
  timeoutMs: z.number().int().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type JobSnapshot = z.infer<typeof JobSnapshotSchema>

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
// JobProgress (cache value at jobs.progress.${id}, never DB-persisted)
// ============================================================================

export const JobProgressSchema = z.strictObject({
  progress: z.number().min(0).max(100),
  detail: z.unknown().optional()
})
export type JobProgress = z.infer<typeof JobProgressSchema>

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

// ============================================================================
// Error codes (constants for JobManager + DataApi handler + renderer i18n)
// ============================================================================

export const JOB_ERROR_CODES = {
  UNKNOWN_TYPE: 'JOB_UNKNOWN_TYPE',
  PAYLOAD_TOO_LARGE: 'JOB_PAYLOAD_TOO_LARGE',
  CANCEL_REASON_TOO_LONG: 'JOB_CANCEL_REASON_TOO_LONG',
  SCHEDULE_NOT_FOUND_BY_NAME: 'JOB_SCHEDULE_NOT_FOUND_BY_NAME',
  SCHEDULE_NAME_REQUIRED: 'JOB_SCHEDULE_NAME_REQUIRED',
  SCHEDULE_NAME_INVALID: 'JOB_SCHEDULE_NAME_INVALID',
  SCHEDULE_NAME_CONFLICT: 'JOB_SCHEDULE_NAME_CONFLICT',
  SCHEDULE_SINGLETON_EXISTS: 'JOB_SCHEDULE_SINGLETON_EXISTS',
  HANDLER_TIMEOUT: 'JOB_HANDLER_TIMEOUT',
  HANDLER_THREW: 'JOB_HANDLER_THREW',
  CANCELLED: 'JOB_CANCELLED'
} as const
export type JobErrorCode = (typeof JOB_ERROR_CODES)[keyof typeof JOB_ERROR_CODES]

// ============================================================================
// API endpoint schemas
// ============================================================================

/**
 * Comma-separated status filter, e.g. `?status=pending,running`. Empty string
 * decays to undefined (no filter). Validation rejects unknown status values
 * up-front so the handler does not silently drop them.
 */
const StatusListQuerySchema = z
  .string()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length === 0) return undefined
    const out: JobStatus[] = []
    for (const part of parts) {
      const parsed = JobStatusAtomSchema.safeParse(part)
      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `invalid status value: ${part}` })
        return z.NEVER
      }
      out.push(parsed.data)
    }
    return out
  })

export const ListJobsQuerySchema = z.strictObject({
  status: StatusListQuerySchema,
  queue: z.string().optional(),
  type: z.string().optional(),
  scheduleId: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional()
})
/** Input shape (URL query strings). Use {@link ListJobsQuerySchema} to parse. */
export type ListJobsQueryParams = z.input<typeof ListJobsQuerySchema>

export type JobSchemas = {
  '/jobs': {
    /** List jobs, ordered by createdAt DESC. Supports status/queue/type/scheduleId filters and pagination. */
    GET: {
      query?: ListJobsQueryParams
      response: JobSnapshot[]
    }
  }
  '/jobs/:id': {
    /** Fetch a single job snapshot. 404 if id does not exist. */
    GET: {
      params: { id: string }
      response: JobSnapshot
    }
  }
}
