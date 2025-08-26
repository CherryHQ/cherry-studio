import { isMac, isWin } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import { recognize } from '@napi-rs/system-ocr'
import { ImageFileMetadata, isImageFileMetadata as isImageFileMetadata, OcrResult, SupportedOcrFile } from '@types'

// const logger = loggerService.withContext('SystemOcrService')

// export class SystemOcrService extends OcrBaseService {
// TODO: make it configurable
export class SystemOcrService {
  constructor() {
    if (!isWin && !isMac) {
      throw new Error('System OCR is only supported on Windows and macOS')
    }
  }

  private async ocrImage(file: ImageFileMetadata): Promise<OcrResult> {
    const buffer = await loadOcrImage(file)
    const result = await recognize(buffer)
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

export const systemOcrService = new SystemOcrService()
