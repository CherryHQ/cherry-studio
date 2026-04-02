import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/constant'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { FileProcessingTextExtractionResult } from '../../../contracts/types'
import { BaseTextExtractionProcessor } from '../../base/BaseFileProcessor'
import type { PreparedSystemOcrContext } from './type'
import { SystemOcrOptionsSchema } from './type'

const logger = loggerService.withContext('FileProcessing:SystemOcrProcessor')

export class SystemOcrProcessor extends BaseTextExtractionProcessor {
  constructor() {
    super('system')
  }

  async extractText(
    file: FileMetadata,
    config: FileProcessorMerged,
    signal?: AbortSignal
  ): Promise<FileProcessingTextExtractionResult> {
    const context = this.prepareContext(file, config, signal)

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

  private prepareContext(
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
}
