import { loggerService } from '@logger'
import { isMac } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import { ImageFileMetadata, isImageFileMetadata as isImageFileMetadata, OcrResult, SupportedOcrFile } from '@types'

const logger = loggerService.withContext('MacOcrService')

// TODO: make it configurable
// export class MacOcrService extends OcrBaseService {
export class MacOcrService {
  // uncomment this line to enable type hint
  // private MacOCR: typeof import('@cherrystudio/mac-system-ocr').default
  private MacOCR: any // cannot use type definition from platform specific dependency, otherwise typecheck ci on linux will throw error

  // constructor(provider: OcrMacProvider) {
  constructor() {
    // super(provider)
    if (!isMac) {
      throw new Error('MacOcrSerivece is only available on macOS')
    }
  }

  private async initMacOCR() {
    if (!this.MacOCR) {
      try {
        // This module is optional and only installed/available on macOS. Runtime checks prevent execution on other platforms.
        // @ts-ignore only macOS could import. ci typecheck on linux will throw type error since missing dependency
        const module = await import('@cherrystudio/mac-system-ocr')
        this.MacOCR = module.default
        return this.MacOCR
      } catch (error) {
        logger.error('Failed to load mac-system-ocr:', error as Error)
        throw error
      }
    } else {
      return this.MacOCR
    }
  }

  // private getRecognitionLevel(level?: number) {
  //   if (!this.MacOCR) {
  //     throw new Error('MacOCR is not set.')
  //   }
  //   return level === 0 ? this.MacOCR.RECOGNITION_LEVEL_FAST : this.MacOCR.RECOGNITION_LEVEL_ACCURATE
  // }

  private async ocrImage(file: ImageFileMetadata): Promise<OcrResult> {
    const MacOcr = await this.initMacOCR()
    const buffer = await loadOcrImage(file)
    const result = await MacOcr.recognizeFromBuffer(buffer, { recognitionLevel: MacOcr.RECOGNITION_LEVEL_ACCURATE })
    return { text: result.text }
  }

  public async ocr(file: SupportedOcrFile): Promise<OcrResult> {
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const macOcrService = new MacOcrService()
