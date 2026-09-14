import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import { delay } from '@shared/utils/async'

import { createFileProcessingJobOutput } from '../persistence/artifacts'
import type {
  FileProcessingRemoteContext,
  FileProcessingRemotePollResult,
  PersistableRemoteState
} from '../processors/types'
import { prepareFileProcessingJob } from './jobExecution'
import { type FileProcessingJobPayload, fileProcessingQueue } from './shared'

const logger = loggerService.withContext('FileProcessing:RemotePollJobHandler')

const POLL_INTERVAL_MS = 1_000

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
    ctx.signal.throwIfAborted()
    const { feature, config, prepared } = await prepareFileProcessingJob(ctx, 'remote-poll')

    let providerTaskId: string
    let remoteContext: FileProcessingRemoteContext

    const persisted = ctx.metadata.remoteState as PersistableRemoteState | undefined
    if (persisted?.providerTaskId) {
      const rehydrated = prepared.rehydrate(persisted, config)
      providerTaskId = rehydrated.providerTaskId
      remoteContext = rehydrated.remoteContext
      logger.debug('Resumed remote-poll job from persisted state', {
        jobId: ctx.jobId,
        providerTaskId,
        stage: persisted.stage
      })
    } else {
      ctx.signal.throwIfAborted()
      const start = await prepared.startRemote(ctx.signal)
      providerTaskId = start.providerTaskId
      remoteContext = start.remoteContext
      await ctx.patchMetadata({ remoteState: prepared.toPersistable(remoteContext, providerTaskId) })
      ctx.reportProgress(start.progress, { stage: 'started' })
    }

    while (true) {
      ctx.signal.throwIfAborted()
      const result: FileProcessingRemotePollResult = await prepared.pollRemote(
        { providerTaskId, remoteContext },
        ctx.signal
      )

      // Save remote transitions before cancellation so recovery resumes the correct stage.
      if (
        (result.status === 'pending' || result.status === 'processing') &&
        result.remoteContext !== undefined &&
        result.remoteContext !== remoteContext
      ) {
        remoteContext = result.remoteContext
        await ctx.patchMetadata({ remoteState: prepared.toPersistable(remoteContext, providerTaskId) })
      }
      ctx.signal.throwIfAborted()

      if (result.status === 'failed') {
        const message =
          result.error?.trim() || `${config.id} ${feature} failed (no diagnostic, providerTaskId=${providerTaskId})`
        throw new Error(message)
      }

      if (result.status === 'completed') {
        return await createFileProcessingJobOutput(ctx, result.output)
      }

      ctx.reportProgress(result.progress, { stage: 'polling' })

      await delay(POLL_INTERVAL_MS, ctx.signal)
    }
  }
}
