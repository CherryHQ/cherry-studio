/**
 * Job API Handlers
 *
 * Read paths go through jobService (jobTable owning service); write paths go
 * through the JobManager lifecycle service so AbortControllers, cache pushes,
 * and dispatch state machine remain authoritative. Handler is the IPC trust
 * boundary — payload size / status enum / type whitelist are re-validated by
 * JobManager.enqueue and surfaced as JOB_* error codes.
 *
 * JobManager.makeError() attaches a `code` field to the thrown Error.
 * `translateJobError` maps known JOB_* codes to DataApiError shapes so the
 * renderer receives a typed error instead of a generic 500 that buries the
 * code inside the message string.
 */

import { application } from '@application'
import { jobService } from '@data/services/JobService'
import type { JobType } from '@main/core/job/jobRegistry'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import {
  CancelJobInputSchema,
  EnqueueJobInputSchema,
  JOB_ERROR_CODES,
  type JobSchemas,
  ListJobsQuerySchema
} from '@shared/data/api/schemas/jobs'

function translateJobError(err: unknown): never {
  if (err instanceof Error) {
    const code = (err as Error & { code?: unknown }).code
    // Input-validation errors → invalidOperation. Renderer reads `error.code`
    // / `error.message` to localize. Other errors fall through to the generic
    // 500 path so unexpected failures still surface loudly.
    if (
      typeof code === 'string' &&
      (code === JOB_ERROR_CODES.UNKNOWN_TYPE ||
        code === JOB_ERROR_CODES.PAYLOAD_TOO_LARGE ||
        code === JOB_ERROR_CODES.CANCEL_REASON_TOO_LONG)
    ) {
      throw DataApiErrorFactory.invalidOperation(`${code}: ${err.message}`)
    }
  }
  throw err
}

export const jobHandlers: HandlersFor<JobSchemas> = {
  '/jobs': {
    GET: async ({ query }) => {
      const parsed = ListJobsQuerySchema.parse(query ?? {})
      return await jobService.list({
        status: parsed.status,
        queue: parsed.queue,
        type: parsed.type,
        scheduleId: parsed.scheduleId,
        limit: parsed.limit,
        offset: parsed.offset
      })
    },

    POST: async ({ body }) => {
      const parsed = EnqueueJobInputSchema.parse(body)
      const scheduledAtMs = parsed.scheduledAt ? Date.parse(parsed.scheduledAt) : undefined
      try {
        const handle = await application.get('JobManager').enqueue(parsed.type as JobType, parsed.input as never, {
          queue: parsed.queue,
          priority: parsed.priority,
          idempotencyKey: parsed.idempotencyKey,
          scheduledAt: scheduledAtMs,
          parentId: parsed.parentId,
          timeoutMs: parsed.timeoutMs,
          maxAttempts: parsed.maxAttempts,
          metadata: parsed.metadata
        })
        return handle.snapshot
      } catch (err) {
        translateJobError(err)
      }
    }
  },

  '/jobs/:id': {
    GET: async ({ params }) => {
      const snapshot = await jobService.getById(params.id)
      if (!snapshot) throw DataApiErrorFactory.notFound('Job', params.id)
      return snapshot
    },

    DELETE: async ({ params, query }) => {
      const existing = await jobService.getById(params.id)
      if (!existing) throw DataApiErrorFactory.notFound('Job', params.id)
      const parsedQuery = query ? CancelJobInputSchema.parse(query) : {}
      try {
        await application.get('JobManager').cancel(params.id, parsedQuery.reason)
      } catch (err) {
        translateJobError(err)
      }
      return undefined
    }
  }
}
