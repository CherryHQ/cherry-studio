import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/core/platform'
import type * as SystemOcrModule from '@napi-rs/system-ocr'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { FILE_TYPE, type FileInfo } from '@shared/types/file'

import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedSystemOcrContext } from '../types'
import { SystemOcrOptionsSchema } from '../types'

const logger = loggerService.withContext('FileProcessing:SystemImageToTextHandler')

// Load the native OCR binding lazily so a missing or broken binding only fails this
// feature when it's actually used, instead of throwing at module load and crashing the
// whole main process at startup (some builds, e.g. macOS x64, may ship without a working
// @napi-rs/system-ocr native binding).
let systemOcrModulePromise: Promise<typeof SystemOcrModule> | undefined

function loadSystemOcr() {
  if (!systemOcrModulePromise) {
    systemOcrModulePromise = import('@napi-rs/system-ocr').catch((error) => {
      systemOcrModulePromise = undefined
      throw error
    })
  }
  return systemOcrModulePromise
}

export const systemImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  prepare(file, config, signal) {
    signal?.throwIfAborted()
    const context = prepareContext(file, config, signal)

    return {
      mode: 'background',
      async execute(executionContext) {
        logger.debug('Running system OCR for image_to_text', {
          filePath: context.file.path,
          langs: context.langs
        })

        const { OcrAccuracy, recognize } = await loadSystemOcr()

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

function prepareContext(file: FileInfo, config: FileProcessorMerged, signal?: AbortSignal): PreparedSystemOcrContext {
  signal?.throwIfAborted()

  if (isLinux) {
    throw new Error('System OCR is not supported on Linux')
  }

  if (file.type !== FILE_TYPE.IMAGE) {
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
