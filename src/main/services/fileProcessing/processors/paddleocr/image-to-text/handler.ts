import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import {
  assertHasFilePath,
  getRequiredApiHost,
  getRequiredApiKey,
  getRequiredCapability
} from '../../../utils/provider'
import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedPaddleQueryContext, PreparedPaddleStartContext } from '../types'
import { createJob, resolveJsonlResult, waitForJobCompletion } from '../utils'

export const paddleImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const startContext = prepareStartContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        const job = await createJob({
          ...startContext,
          signal: executionContext.signal
        })
        const queryContext: PreparedPaddleQueryContext = {
          apiHost: startContext.apiHost,
          apiKey: startContext.apiKey,
          signal: executionContext.signal
        }
        const jobResult = await waitForJobCompletion(job.jobId, queryContext)

        if (jobResult.state === 'failed') {
          throw new Error(jobResult.errorMsg || 'PaddleOCR text extraction failed')
        }

        return {
          kind: 'text',
          text: await resolveJsonlResult(job.jobId, jobResult, queryContext.apiHost, queryContext.signal)
        }
      }
    }
  }
}

function prepareStartContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedPaddleStartContext {
  signal?.throwIfAborted()

  const capability = getRequiredCapability(config, 'image_to_text', 'paddleocr')
  assertHasFilePath(file)

  if (!isImageFileMetadata(file)) {
    throw new Error('PaddleOCR text extraction only supports image files')
  }

  const model = capability.modelId?.trim() || undefined

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    file,
    model,
    feature: 'image_to_text'
  }
}
