import { loggerService } from '@logger'
import { isOcrApiProvider, OcrProvider, OcrResult, SupportedOcrFile } from '@renderer/types'

import { OcrApiClientFactory } from './clients/OcrApiClientFactory'

const logger = loggerService.withContext('renderer:OcrService')

/**
 * ocr a file
 * @param file any supported file
 * @param provider ocr provider
 * @returns ocr result
 * @throws {Error}
 */
export const ocr = async (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> => {
  logger.info(`ocr file ${file.path}`)
  if (isOcrApiProvider(provider)) {
    const client = OcrApiClientFactory.create(provider)
    return client.ocr(file, provider.config)
  } else {
    return window.api.ocr.ocr(file, provider)
  }
}
