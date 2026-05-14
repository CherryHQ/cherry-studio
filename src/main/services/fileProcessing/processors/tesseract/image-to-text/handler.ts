import { application } from '@application'
import { loggerService } from '@logger'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileInfo } from '@shared/file/types'
import type { LanguageCode } from 'tesseract.js'

import type { FileProcessingCapabilityHandler } from '../../types'
import { type PreparedTesseractContext, TesseractProcessorOptionsSchema } from '../types'

const DEFAULT_LANGS = ['chi_sim', 'chi_tra', 'eng'] satisfies LanguageCode[]
const logger = loggerService.withContext('FileProcessing:TesseractHandler')

export function prepareContext(
  file: FileInfo,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedTesseractContext {
  signal?.throwIfAborted()

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

export const tesseractImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    const context: PreparedTesseractContext = prepareContext(file, config, signal)

    return {
      mode: 'background',
      execute(executionContext) {
        return application.get('TesseractRuntimeService').extract({
          ...context,
          signal: executionContext.signal
        })
      }
    }
  }
}
