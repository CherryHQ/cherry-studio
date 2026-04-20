import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import { getApiKey, getRequiredCapability } from '../../utils/provider'
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
      text: await resolveJsonlResult(job.jobId, jobResult, queryContext.signal)
    }
  }
}

function prepareStartContext(
  config: FileProcessorMerged,
  signal: AbortSignal | undefined,
  file: FileMetadata
): PreparedPaddleStartContext {
  const capability = getRequiredCapability(config, 'text_extraction', 'paddleocr')

  if (!file.path) {
    throw new Error('File path is required')
  }

  if (!isImageFileMetadata(file)) {
    throw new Error('PaddleOCR text extraction only supports image files')
  }

  const apiHost = capability.apiHost?.trim().replace(/\/+$/, '')
  if (!apiHost) {
    throw new Error('API host is required')
  }

  const apiKey = getApiKey(config, 'paddleocr')
  if (!apiKey) {
    throw new Error('API key is required')
  }

  const model = capability.modelId?.trim() || undefined

  if (model === 'PP-OCRv5') {
    throw new Error('PaddleOCR model PP-OCRv5 is not supported yet')
  }

  return {
    apiHost,
    apiKey,
    signal,
    file,
    model,
    feature: 'text_extraction'
  }
}
