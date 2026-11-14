import type { JobHandler } from '@main/core/job/types'

import { createFileProcessingJobOutput } from '../persistence/artifacts'
import { prepareFileProcessingJob } from './jobExecution'
import { executeRemotePolling } from './remotePolling'
import { type FileProcessingJobPayload, fileProcessingQueue } from './shared'

/**
 * Handles capability handlers whose execution model is "submit → poll":
 * doc2x / mineru / paddleocr document-to-markdown. Persists the minimum state
 * needed to resume polling in jobTable.metadata.
 *
 * Whitelist persistence: ONLY publishable identifiers (providerTaskId, stage,
 * apiHost) are written to metadata via `capability.toPersistable(...)`. The
 * apiKey and any other sensitive material is re-read from FileProcessorMerged
 * config (which is sourced from PreferenceService) on every execute() — never
 * persisted to the job row. `rehydrate(persisted, config)` is the entry point
 * back into a typed in-memory remoteContext from that recorded state.
 *
 * Recovery: 'abandon' — no task survives a restart. A run that finds prior
 * metadata via ctx.metadata still skips startRemote() and goes straight to
 * pollRemote() with the recorded providerTaskId, so a durable consumer can turn
 * resuming back on (#22706).
 */
export const remotePollJobHandler: JobHandler<FileProcessingJobPayload> = {
  recovery: 'abandon',
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
