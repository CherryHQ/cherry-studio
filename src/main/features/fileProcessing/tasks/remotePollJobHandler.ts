import type { JobHandler } from '@main/core/job/types'

import { createFileProcessingJobOutput } from '../persistence/artifacts'
import { prepareFileProcessingJob } from './jobExecution'
import { executeRemotePolling } from './remotePolling'
import { type FileProcessingJobPayload, fileProcessingQueue } from './shared'

/**
 * Handles capability handlers whose execution model is "submit → poll":
 * doc2x / mineru / paddleocr document-to-markdown. Persists the minimum state
 * needed to resume polling across a process restart in jobTable.metadata.
 *
 * Whitelist persistence: ONLY publishable identifiers (providerTaskId, stage,
 * apiHost) are written to metadata via `capability.toPersistable(...)`. The
 * apiKey and any other sensitive material is re-read from FileProcessorMerged
 * config (which is sourced from PreferenceService) on every execute() — never
 * persisted to the job row. `rehydrate(persisted, config)` is the entry point
 * back into a typed in-memory remoteContext after restart.
 *
 * Recovery: 'retry'. After restart, JobManager resets running → pending and
 * re-dispatches; this handler sees the prior metadata via ctx.metadata and
 * skips startRemote(), going straight to pollRemote() with the recovered
 * providerTaskId.
 */
export const remotePollJobHandler: JobHandler<FileProcessingJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => fileProcessingQueue(input.processorId),
  defaultConcurrency: 2,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 30 * 60_000,
  async execute(ctx) {
    const { config, prepared } = await prepareFileProcessingJob(ctx, 'remote-poll')
    const output = await executeRemotePolling(ctx, prepared, config)
    return await createFileProcessingJobOutput(ctx, output)
  }
}
