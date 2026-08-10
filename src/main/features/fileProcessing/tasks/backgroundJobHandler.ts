import type { JobContext, JobHandler } from '@main/core/job/types'

import { createFileProcessingJobOutput } from '../persistence/artifacts'
import { prepareFileProcessingJob } from './jobExecution'
import { type FileProcessingJobPayload, fileProcessingQueue, localFileProcessingQueue } from './shared'

/**
 * Runs a capability handler whose execution is a single awaited call returning
 * the final output in one shot (tesseract, system OCR, mistral OCR, …). Shared
 * verbatim by both background job types below — they differ only in which queue
 * they dispatch on and how many jobs that queue admits at once.
 */
async function executeBackgroundJob(ctx: JobContext<FileProcessingJobPayload>): Promise<unknown> {
  const { prepared } = await prepareFileProcessingJob(ctx, 'background')
  const output = await prepared.execute({
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
 * No metadata persistence: a background attempt is stateless from JobManager's
 * point of view. Re-running starts from progress 0 every time.
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
