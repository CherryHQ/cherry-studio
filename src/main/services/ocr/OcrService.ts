import { loggerService } from '@logger'
import { ImageFileMetadata, isImageFile } from '@types'
import {
  ImageOcrProvider,
  isBuiltinOcrProvider,
  isImageOcrProvider,
  OcrProvider,
  OcrResult,
  SupportedOcrFile
} from 'src/renderer/src/types/ocr'

import { getTesseractWorker } from './TesseractService'

const logger = loggerService.withContext('OcrService')

/**
 * ocr by tesseract
 * @param file image file
 * @returns ocr result
 * @throws {Error}
 */
const tesseractOcr = async (file: ImageFileMetadata): Promise<string> => {
  try {
    const worker = await getTesseractWorker()
    const ret = await worker.recognize(file.path)
    return ret.data.text
  } catch (e) {
    const message = 'Failed to ocr with tesseract.'
    logger.error(message, e as Error)
    throw new Error(message)
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
    let text: string
    switch (provider.id) {
      case 'tesseract':
        text = await tesseractOcr(file)
        return { text }
      default:
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
