import type { JobContext, JobHandler } from '@main/core/job/types'

import { createFileProcessingJobOutput } from '../persistence/artifacts'
import { prepareFileProcessingJob } from './jobExecution'
import { executeRemotePolling } from './remotePolling'
import { type FileProcessingJobPayload, fileProcessingQueue, localFileProcessingQueue } from './shared'

// Auto capabilities keep their persisted job type while selecting a protocol at execution time.
async function executeBackgroundJob(ctx: JobContext<FileProcessingJobPayload>): Promise<unknown> {
  const { config, prepared } = await prepareFileProcessingJob(ctx, 'background')
  const output =
    prepared.mode === 'remote-poll'
      ? await executeRemotePolling(ctx, prepared, config)
      : await prepared.execute({
          signal: ctx.signal,
          reportProgress: (progress) => ctx.reportProgress(progress)
        })

  if (ctx.signal.aborted) {
    throw new DOMException('aborted', 'AbortError')
  }

  return await createFileProcessingJobOutput(ctx, output)
}

/**
 * Recovery: 'retry'. After restart, non-terminal jobs of this type are reset
 * to pending and re-dispatched. We pick retry (over abandon) because several
 * background-mode capabilities are paid remote APIs (mistral image_to_text,
 * mistral document_to_markdown) where the quota has already been consumed on
 * the prior attempt — re-running has a non-zero refund cost but is preferable
 * to silently dropping the request.
 *
 * Auto capabilities may prepare a remote job and resume it from metadata.
 * Single-call background capabilities restart from progress 0.
 */
const backgroundJobDefaults = {
  recovery: 'retry',
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 15 * 60_000,
  execute: executeBackgroundJob
} as const satisfies Partial<JobHandler<FileProcessingJobPayload>>

/**
 * Background processors whose work happens over a socket. Two at a time: our
 * process is idle while waiting, so a second job is real throughput.
 */
export const backgroundJobHandler: JobHandler<FileProcessingJobPayload> = {
  ...backgroundJobDefaults,
  defaultQueue: (input) => fileProcessingQueue(input.processorId),
  defaultConcurrency: 2
}

/**
 * Background processors whose work happens on this machine. One at a time: the
 * runtimes behind them are already serialized — tesseract's extraction queue,
 * and the single OcrInferenceService worker that both local-paddleocr and
 * local-document share — so a second concurrent job gains nothing. It would
 * only interleave inside that runtime, stretching both jobs while both of their
 * timeout clocks keep running.
 */
export const localBackgroundJobHandler: JobHandler<FileProcessingJobPayload> = {
  ...backgroundJobDefaults,
  defaultQueue: (input) => localFileProcessingQueue(input.processorId),
  defaultConcurrency: 1
}
