import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/constant'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessingTextExtractionResult } from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { OcrProvider } from '../OcrProvider'
import type { PreparedSystemOcrContext } from './system/types'
import { SystemOcrOptionsSchema } from './system/types'

const logger = loggerService.withContext('FileProcessing:SystemOcrProvider')

export const systemOcrProvider: OcrProvider = {
  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = prepareContext(file, config, signal)

    logger.debug('Running system OCR for text extraction', {
      fileId: context.file.id,
      filePath: context.file.path,
      langs: context.langs
    })

    const result = await recognize(
      context.file.path,
      OcrAccuracy.Accurate,
      isWin ? context.langs : undefined,
      context.signal
    )

    return {
      text: result.text
    }
  }
}

function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedSystemOcrContext {
  if (isLinux) {
    throw new Error('System OCR is not supported on Linux')
  }

  if (!file.path) {
    throw new Error('File path is required')
  }

  if (!isImageFileMetadata(file)) {
    throw new Error('System OCR only supports image files')
  }

  const parsedOptions = SystemOcrOptionsSchema.safeParse(config.options ?? {})
  const langs = parsedOptions.success ? parsedOptions.data.langs?.filter(Boolean) : undefined

  return {
    file,
    signal,
    langs: langs?.length ? langs : undefined
  }
}
