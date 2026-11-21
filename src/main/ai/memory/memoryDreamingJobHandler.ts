import { application } from '@application'
import type { JobHandlerFor } from '@main/core/job/types'

declare module '@main/core/job/jobRegistry' {
  interface JobRegistry {
    'memory.dreaming': Record<string, never>
  }
}

export const memoryDreamingJobHandler: JobHandlerFor<'memory.dreaming'> = {
  recovery: 'abandon',
  defaultQueue: () => 'memory.dreaming',
  defaultConcurrency: 1,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 5 * 60_000,
  execute(ctx) {
    return application.get('MemoryDreamingService').execute(ctx)
  }
}
