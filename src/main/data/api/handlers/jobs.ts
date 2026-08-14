/**
 * Job API Handlers
 *
 * DataApi is read-only for jobs. Lifecycle commands such as enqueue/cancel
 * stay on JobManager or dedicated IPC owned by the business feature.
 */

import { jobService } from '@data/services/JobService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { type JobSchemas, ListJobsQuerySchema } from '@shared/data/api/schemas/jobs'
import type { HandlersFor } from '@shared/data/api/types'

export const jobHandlers: HandlersFor<JobSchemas> = {
  '/jobs': {
    GET: async ({ query }) => {
      const parsed = ListJobsQuerySchema.parse(query ?? {})
      return jobService.list({
        status: parsed.status,
        queue: parsed.queue,
        type: parsed.type,
        scheduleId: parsed.scheduleId,
        parentId: parsed.parentId,
        limit: parsed.limit,
        offset: parsed.offset
      })
    }
  },

  '/jobs/:id': {
    GET: async ({ params }) => {
      const snapshot = jobService.getById(params.id)
      if (!snapshot) throw DataApiErrorFactory.notFound('Job', params.id)
      return snapshot
    }
  }
}
