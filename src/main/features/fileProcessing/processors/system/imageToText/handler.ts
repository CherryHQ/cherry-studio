import fs from 'node:fs/promises'

import type * as SystemOcrModule from '@napi-rs/system-ocr'

import { loggerService } from '@logger'
import { isLinux, isWin } from '@main/core/platform'
import { clampImageForModel, transcodeToPng } from '@main/utils/image'
import type { FileProcessorMerged } from '@shared/data/presets/fileProcessing'
import { FILE_TYPE, type FileInfo } from '@shared/types/file'

import type { FileProcessingCapabilityHandler } from '../../types'
import type { PreparedSystemOcrContext } from '../types'
import { SystemOcrOptionsSchema } from '../types'

const logger = loggerService.withContext('FileProcessing:SystemImageToTextHandler')

// Windows OCR rejects images beyond its MaxImageDimension (10000px) with 0x80070057.
const SYSTEM_OCR_MAX_IMAGE_EDGE = 8000

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

        // On Windows the binding only ever reaches a PNG decoder — path input hardcodes it and
        // buffer input sniffs nothing else (#18326) — so it has to be fed PNG bytes.
        let image: string | Uint8Array = context.file.path
        if (isWin) {
          const bytes = await fs.readFile(context.file.path, { signal: executionContext.signal })
          let clamped: Uint8Array | null = null
          try {
            clamped = await clampImageForModel(bytes, SYSTEM_OCR_MAX_IMAGE_EDGE)
          } catch (error) {
            executionContext.signal.throwIfAborted()
            // OCR can accept screenshots rejected by the stricter model-input decoder.
            // Keep its existing native-decoder path when best-effort resizing fails.
            logger.warn('Could not resize system OCR image; trying original bytes', error as Error)
          }
          image = await transcodeToPng(clamped ?? bytes)
        }

        const result = await recognize(
          image,
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
