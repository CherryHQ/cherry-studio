import fs from 'node:fs/promises'

import { loggerService } from '@logger'
import { isLinux, isMac, isWin } from '@main/core/platform'
import { transcodeToPng } from '@main/utils/image'
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

interface MacTextObservation {
  text: string
  confidence: number
  x: number
  y: number
  width: number
  height: number
}

interface MacOcrResult {
  text: string
  observations: MacTextObservation[]
}

interface MacOcrModule {
  default: {
    RECOGNITION_LEVEL_ACCURATE: number
    recognizeFromPath(
      imagePath: string,
      options?: { languages?: string; recognitionLevel?: number }
    ): Promise<MacOcrResult>
  }
}

let macOcrModulePromise: Promise<MacOcrModule> | undefined

function loadSystemOcr() {
  if (!systemOcrModulePromise) {
    systemOcrModulePromise = import('@napi-rs/system-ocr').catch((error) => {
      systemOcrModulePromise = undefined
      throw error
    })
  }
  return systemOcrModulePromise
}

function loadMacSpatialOcr(): Promise<MacOcrModule> {
  if (!macOcrModulePromise) {
    // Kept as a variable import because this optional, darwin-only native module is
    // absent on Windows/Linux installations. electron-vite externalizes it from
    // optionalDependencies in production.
    const moduleName = '@cherrystudio/mac-system-ocr'
    macOcrModulePromise = import(moduleName).catch((error) => {
      macOcrModulePromise = undefined
      throw error
    }) as Promise<MacOcrModule>
  }
  return macOcrModulePromise
}

export const systemImageToTextHandler: FileProcessingCapabilityHandler<'image_to_text'> = {
  mode: 'background',
  imageOcrOutput: isMac ? 'spatial-text' : 'plain-text',
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

        if (isMac) {
          return recognizeMacSpatialText(context, executionContext.signal)
        }

        const { OcrAccuracy, recognize } = await loadSystemOcr()

        // On Windows the binding only ever reaches a PNG decoder — path input hardcodes it and
        // buffer input sniffs nothing else (#18326) — so it has to be fed PNG bytes.
        const image = isWin
          ? await transcodeToPng(await fs.readFile(context.file.path, { signal: executionContext.signal }))
          : context.file.path

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

async function recognizeMacSpatialText(context: PreparedSystemOcrContext, signal: AbortSignal) {
  signal.throwIfAborted()
  const MacOCR = (await loadMacSpatialOcr()).default
  const result = await MacOCR.recognizeFromPath(context.file.path, {
    recognitionLevel: MacOCR.RECOGNITION_LEVEL_ACCURATE,
    ...(context.langs?.length ? { languages: context.langs.join(',') } : {})
  })
  signal.throwIfAborted()

  // Vision reports normalized bottom-left-origin rectangles. Screenshot overlays
  // consume source-image pixels with a top-left origin, so convert once at the
  // processor boundary and keep that coordinate contract provider-independent.
  const sharp = (await import('sharp')).default
  const metadata = await sharp(context.file.path).metadata()
  if (!metadata.width || !metadata.height) {
    throw new Error('System OCR could not determine source image dimensions')
  }

  const lines = result.observations
    .filter((observation) => observation.text.trim().length > 0)
    .map((observation) => [
      {
        text: observation.text,
        confidence: observation.confidence,
        box: {
          x: Math.round(observation.x * metadata.width),
          y: Math.round((1 - observation.y - observation.height) * metadata.height),
          width: Math.round(observation.width * metadata.width),
          height: Math.round(observation.height * metadata.height)
        }
      }
    ])

  return { kind: 'spatial-text' as const, text: result.text, lines }
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
