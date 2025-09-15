import { isLinux, isWin } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import { ImageFileMetadata, isImageFileMetadata, OcrResult, OcrSystemConfig, SupportedOcrFile } from '@types'

import { OcrBaseService } from './OcrBaseService'

// const logger = loggerService.withContext('SystemOcrService')
export class SystemOcrService extends OcrBaseService {
  constructor() {
    super()
  }

  private async ocrImage(file: ImageFileMetadata, options?: OcrSystemConfig): Promise<OcrResult> {
    if (isLinux) {
      return { text: '' }
    }
    const buffer = await loadOcrImage(file)
    const langs = isWin ? options?.langs : undefined
    const result = await recognize(buffer, OcrAccuracy.Accurate, langs)
    return { text: result.text }
  }

  public ocr = async (file: SupportedOcrFile, options?: OcrSystemConfig): Promise<OcrResult> => {
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file, options)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const systemOcrService = new SystemOcrService()
