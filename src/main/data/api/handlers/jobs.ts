/**
 * Job API Handlers — Read-only.
 *
 * GET-only surface for the renderer's `useJob` / `useJobProgress` consumers.
 * Triggering / cancelling jobs is workflow orchestration and lives in main:
 * business services call `application.get('JobManager').enqueue(...)`, and
 * renderer-initiated triggering goes through a dedicated IPC channel.
 */

import { jobService } from '@data/services/JobService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { HandlersFor } from '@shared/data/api/apiTypes'
import { type JobSchemas, ListJobsQuerySchema } from '@shared/data/api/schemas/jobs'

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
    }
  },

  '/jobs/:id': {
    GET: async ({ params }) => {
      const snapshot = await jobService.getById(params.id)
      if (!snapshot) throw DataApiErrorFactory.notFound('Job', params.id)
      return snapshot
    }
  }
}
