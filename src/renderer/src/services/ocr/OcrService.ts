import { loggerService } from '@logger'
import type { OcrParams, OcrResult, SupportedOcrFile } from '@renderer/types'

const logger = loggerService.withContext('renderer:OcrService')

/**
 * ocr a file
 * @param file any supported file
 * @param provider ocr provider
 * @returns ocr result
 * @throws {Error}
 */
export const ocr = async (file: SupportedOcrFile, params: OcrParams): Promise<OcrResult> => {
  logger.info(`ocr file ${file.path}`)
  return window.api.ocr.ocr(file, params)
}
