import { loggerService } from '@logger'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import type { ExtractTextInput } from '../types'
import { createOcrProvider } from './createOcrProvider'

const logger = loggerService.withContext('FileProcessing:OcrService')

class OcrService {
  async extractText({ file, processorId, signal }: ExtractTextInput) {
    const resolvedConfig = resolveProcessorConfigByFeature('text_extraction', processorId)
    const provider = createOcrProvider(resolvedConfig.id)

    logger.debug('Executing OCR request', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    return provider.extractText(file, resolvedConfig, signal)
  }
}

export const ocrService = new OcrService()
