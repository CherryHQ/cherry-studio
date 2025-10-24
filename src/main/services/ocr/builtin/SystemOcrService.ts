import { isLinux, isWin } from '@main/constant'
import { loadOcrImage } from '@main/utils/ocr'
import { OcrAccuracy, recognize } from '@napi-rs/system-ocr'
import type { ImageFileMetadata, OcrProviderConfig, OcrResult, OcrSystemConfig, SupportedOcrFile } from '@types'
import { isImageFileMetadata, isOcrSystemConfig } from '@types'

import { OcrBaseService } from './OcrBaseService'

// const logger = loggerService.withContext('SystemOcrService')
export class SystemOcrService extends OcrBaseService {
  constructor() {
    super()
  }

  private async ocrImage(file: ImageFileMetadata, config?: OcrSystemConfig): Promise<OcrResult> {
    if (isLinux) {
      return { text: '' }
    }
    const buffer = await loadOcrImage(file)
    const langs = isWin ? config?.langs : undefined
    const result = await recognize(buffer, OcrAccuracy.Accurate, langs)
    return { text: result.text }
  }

  public ocr = async (file: SupportedOcrFile, config?: OcrProviderConfig): Promise<OcrResult> => {
    if (!isOcrSystemConfig(config)) {
      throw new Error('Invalid OCR configuration')
    }
    if (isImageFileMetadata(file)) {
      return this.ocrImage(file, config)
    } else {
      throw new Error('Unsupported file type, currently only image files are supported')
    }
  }
}

export const systemOcrService = !isLinux ? new SystemOcrService() : undefined
