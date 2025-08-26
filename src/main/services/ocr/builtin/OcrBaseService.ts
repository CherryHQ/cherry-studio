import { BuiltinOcrProvider, OcrResult, SupportedOcrFile } from '@types'

export abstract class OcrBaseService {
  protected provider: BuiltinOcrProvider

  abstract ocr(file: SupportedOcrFile): Promise<OcrResult>

  constructor(provider: BuiltinOcrProvider) {
    if (!provider) {
      throw new Error('OCR provider is not set')
    }
    this.provider = provider
  }
}
