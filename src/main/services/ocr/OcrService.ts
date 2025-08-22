import { loggerService } from '@logger'
import { MB } from '@shared/config/constant'
import {
  ImageFileMetadata,
  ImageOcrProvider,
  isBuiltinOcrProvider,
  isImageFile,
  isImageOcrProvider,
  OcrProvider,
  OcrResult,
  SupportedOcrFile
} from '@types'
import { statSync } from 'fs'
import { readFile } from 'fs/promises'

import { getTesseractWorker } from './tesseract/TesseractService'

const logger = loggerService.withContext('main:OcrService')

/**
 * ocr by tesseract
 * @param file image file or base64 string
 * @returns ocr result
 * @throws {Error}
 */
const tesseractOcr = async (file: ImageFileMetadata | string): Promise<Tesseract.RecognizeResult> => {
  try {
    const worker = await getTesseractWorker()
    let ret: Tesseract.RecognizeResult
    if (typeof file === 'string') {
      ret = await worker.recognize(file)
    } else {
      const stat = statSync(file.path)
      if (stat.size > 50 * MB) {
        throw new Error('This image is too large (max 50MB)')
      }
      const buffer = await readFile(file.path)
      ret = await worker.recognize(buffer)
    }
    return ret
  } catch (e) {
    logger.error('Failed to ocr with tesseract.', e as Error)
    throw e
  }
}

/**
 * ocr image file
 * @param file image file
 * @param provider ocr provider that supports image ocr
 * @returns ocr result
 * @throws {Error}
 */
const imageOcr = async (file: ImageFileMetadata, provider: ImageOcrProvider): Promise<OcrResult> => {
  if (isBuiltinOcrProvider(provider)) {
    if (provider.id === 'tesseract') {
      const result = await tesseractOcr(file)
      return { text: result.data.text }
    } else {
      throw new Error(`Unsupported built-in ocr provider: ${provider.id}`)
    }
  }
  throw new Error(`Provider ${provider.id} is not supported.`)
}

/**
 * ocr a file
 * @param file any supported file
 * @param provider ocr provider
 * @returns ocr result
 * @throws {Error}
 */
export const ocr = async (file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> => {
  if (isImageFile(file) && isImageOcrProvider(provider)) {
    return imageOcr(file, provider)
  }
  throw new Error(`File type and provider capability is not matched, otherwise one of them is not supported.`)
}

/**
 * ocr a file
 * @param _ ipc event
 * @param file any supported file
 * @param provider ocr provider
 * @returns ocr result
 * @throws {Error}
 */
export const ipcOcr = async (_: Electron.IpcMainInvokeEvent, ...args: Parameters<typeof ocr>) => {
  return ocr(...args)
}
