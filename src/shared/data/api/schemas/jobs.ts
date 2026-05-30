/**
 * Jobs DataApi schema definitions — read-only surface.
 *
 * This file holds only entities the renderer consumes through `useJob` /
 * `useJobProgress` and via cache values at `jobs.state.${id}` /
 * `jobs.progress.${id}`. The Job DataApi exposes GET endpoints only;
 * triggering / cancelling / scheduling jobs is workflow orchestration on
 * infrastructure and lives in main (`JobManager` + business services).
 *
 * Schedule, Trigger, RetryPolicy, CatchUpPolicy, and `JOB_ERROR_CODES` are
 * main-process-only types — they do not cross the IPC boundary and live in
 * `src/main/core/job/scheduleTypes.ts` and `src/main/core/job/errorCodes.ts`.
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
 * constant (see `src/main/core/job/errorCodes.ts`); renderer maps it to a
 * localized message via `t(\`errors.jobs.${code.toLowerCase()}\`, params)`.
 */
export const JobErrorSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
  retryable: z.boolean()
})
export type JobError = z.infer<typeof JobErrorSchema>

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
// JobProgress (cache value at jobs.progress.${id}, never DB-persisted)
// ============================================================================

export const JobProgressSchema = z.strictObject({
  progress: z.number().min(0).max(100),
  detail: z.unknown().optional()
})
export type JobProgress = z.infer<typeof JobProgressSchema>

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
