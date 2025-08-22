import { OcrProvider, OcrResult, SupportedOcrFile } from '@renderer/types/ocr'

// const logger = loggerService.withContext('main:OcrService')

/**
 * ocr a file
 * @param file any supported file
 * @param provider ocr provider
 * @returns ocr result
 * @throws {Error}
 */
export const ocr = async (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> => {
  return window.api.ocr.ocr(file, provider)
}
