import { loggerService } from '@logger'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'
import type { LanguageCode } from 'tesseract.js'

import { type PreparedTesseractContext, TesseractProcessorOptionsSchema } from '../types'

const DEFAULT_LANGS = ['chi_sim', 'chi_tra', 'eng'] satisfies LanguageCode[]
const logger = loggerService.withContext('FileProcessing:TesseractPrepare')

export function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedTesseractContext {
  signal?.throwIfAborted()

  if (!isImageFileMetadata(file)) {
    throw new Error('Tesseract OCR only supports image files')
  }

  const optionsResult = TesseractProcessorOptionsSchema.safeParse(config.options ?? {})
  if (!optionsResult.success) {
    logger.warn('Invalid Tesseract OCR options; falling back to default languages', optionsResult.error, {
      processorId: config.id
    })
  }

  const enabledLangs = optionsResult.success
    ? (optionsResult.data.langs ?? [])
        .map((lang) => lang.trim())
        .filter(Boolean)
        .sort()
        .map((lang) => lang as LanguageCode)
    : []

  return {
    file,
    langs: enabledLangs.length === 0 ? DEFAULT_LANGS : enabledLangs
  }
}
