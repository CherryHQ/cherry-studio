import { application } from '@application'
import type { JobHandler } from '@main/core/job/types'
import { toFileInfo } from '@main/services/file'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import {
  assertFileTypeSupported,
  assertModeMatches,
  commitFileProcessingOutput,
  type FileProcessingJobOutput,
  type FileProcessingJobPayload,
  getCapabilityHandler
} from './shared'

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
    const entry = await application.get('FileManager').getById(fileEntryId)
    const file = await toFileInfo(entry)
    const handler = getCapabilityHandler(config.id, feature)
    assertModeMatches(handler, 'background')
    assertFileTypeSupported(file, feature, config)

    const prepared = await handler.prepare(file, config, ctx.signal)
    assertModeMatches(prepared, 'background')
    const background = prepared

    const output = await background.execute({
      signal: ctx.signal,
      reportProgress: (progress) => ctx.reportProgress(progress)
    })

    if (ctx.signal.aborted) {
      throw new DOMException('aborted', 'AbortError')
    }

    const artifacts = await commitFileProcessingOutput(ctx.jobId, output, ctx.signal)
    return { artifacts } satisfies FileProcessingJobOutput
  }
}
