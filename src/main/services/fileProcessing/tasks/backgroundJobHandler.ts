import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import type { PreparedBackgroundTask } from '../processors/types'
import {
  assertFileTypeSupported,
  assertModeMatches,
  cleanupFileProcessingResultsDir,
  createArtifacts,
  type FileProcessingJobOutput,
  type FileProcessingJobPayload,
  getCapabilityHandler,
  resolveFileProcessingFileInfo
} from './shared'

const logger = loggerService.withContext('FileProcessing:BackgroundJobHandler')

/**
 * Handles capability handlers whose execution is a single awaited call against
 * a local runtime or remote API that returns the final output in one shot
 * (tesseract, system OCR, mistral OCR, etc).
 *
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
export const backgroundJobHandler: JobHandler<FileProcessingJobPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `file-processing.${input.processorId}`,
  defaultConcurrency: 2,
  defaultRetryPolicy: { maxAttempts: 1, backoff: 'none', baseDelayMs: 0, maxDelayMs: 0 },
  defaultTimeoutMs: 15 * 60_000,
  async execute(ctx) {
    const { feature, fileEntryId, processorId } = ctx.input
    const config = resolveProcessorConfigByFeature(feature, processorId)
    const handler = getCapabilityHandler(config.id, feature)
    assertModeMatches(handler, 'background')
    const file = await resolveFileProcessingFileInfo(fileEntryId)
    assertFileTypeSupported(file, feature, config)

    const prepared = await handler.prepare(file, config, ctx.signal, { fileEntryId })
    assertModeMatches(prepared, 'background')
    const background = prepared as PreparedBackgroundTask

    let artifactsMayExist = false
    try {
      const output = await background.execute({
        signal: ctx.signal,
        reportProgress: (progress) => ctx.reportProgress(progress)
      })

      if (ctx.signal.aborted) {
        throw new DOMException('aborted', 'AbortError')
      }

      artifactsMayExist = true
      const artifacts = await createArtifacts(ctx.jobId, output, ctx.signal)
      return { artifacts } satisfies FileProcessingJobOutput
    } catch (error) {
      if (artifactsMayExist) {
        const cleaned = await cleanupFileProcessingResultsDir(ctx.jobId)
        logger.warn('Background execution failed after artifacts may have been created', {
          jobId: ctx.jobId,
          processorId: config.id,
          feature,
          cleaned
        })
      }
      throw error
    }
  }
}
