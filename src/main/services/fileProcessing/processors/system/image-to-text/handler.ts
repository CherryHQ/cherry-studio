import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/constant'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileMetadata } from '@types'
import { isImageFileMetadata } from '@types'

import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedSystemOcrContext } from '../types'
import { SystemOcrOptionsSchema } from '../types'

const logger = loggerService.withContext('FileProcessing:SystemImageToTextHandler')

export const systemImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const context = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        logger.debug('Running system OCR for image_to_text', {
          fileId: context.file.id,
          filePath: context.file.path,
          langs: context.langs
        })

        const result = await recognize(
          context.file.path,
          OcrAccuracy.Accurate,
          isWin ? context.langs : undefined,
          executionContext.signal
        )

        return {
          kind: 'text',
          text: result.text
        }
      }
    }
  }
}

function prepareContext(
  file: FileMetadata,
  config: FileProcessorMerged,
  signal?: AbortSignal
): PreparedSystemOcrContext {
  signal?.throwIfAborted()

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
  if (!parsedOptions.success) {
    logger.warn('Invalid system OCR options; falling back to platform defaults', parsedOptions.error, {
      processorId: config.id
    })
  }

  const langs = parsedOptions.success ? parsedOptions.data.langs?.filter(Boolean) : undefined

  return {
    file,
    langs: langs?.length ? langs : undefined
  }
}
