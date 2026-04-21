import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import { assertHasFilePath, getRequiredApiHost, getRequiredApiKey, getRequiredCapability } from '../../utils/provider'
import type { OcrProvider } from '../OcrProvider'
import type { PreparedPaddleQueryContext, PreparedPaddleStartContext } from './paddle/types'
import { createJob, resolveJsonlResult, waitForJobCompletion } from './paddle/utils'

export const paddleOcrProvider: OcrProvider = {
  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const startContext = prepareStartContext(config, signal, file)
    const job = await createJob(startContext)
    const queryContext: PreparedPaddleQueryContext = {
      apiHost: startContext.apiHost,
      apiKey: startContext.apiKey,
      signal: startContext.signal
    }
    const jobResult = await waitForJobCompletion(job.jobId, queryContext)

    if (jobResult.state === 'failed') {
      throw new Error(jobResult.errorMsg || 'PaddleOCR text extraction failed')
    }

    return {
      text: await resolveJsonlResult(job.jobId, jobResult, queryContext.apiHost, queryContext.signal)
    }
  }
}

function prepareStartContext(
  config: FileProcessorMerged,
  signal: AbortSignal | undefined,
  file: FileMetadata
): PreparedPaddleStartContext {
  const capability = getRequiredCapability(config, 'text_extraction', 'paddleocr')
  assertHasFilePath(file)

  if (!isImageFileMetadata(file)) {
    throw new Error('PaddleOCR text extraction only supports image files')
  }

  const model = capability.modelId?.trim() || undefined

  if (model === 'PP-OCRv5') {
    throw new Error('PaddleOCR model PP-OCRv5 is not supported yet')
  }

  return {
    apiHost: getRequiredApiHost(capability),
    apiKey: getRequiredApiKey(config, 'paddleocr'),
    signal,
    file,
    model,
    feature: 'text_extraction'
  }
}
