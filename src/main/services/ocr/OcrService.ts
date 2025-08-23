import { BuiltinOcrProviderIds, FileMetadata, OcrProvider, OcrResult, SupportedOcrFile } from '@types'

import { tesseractService } from './tesseract/TesseractService'

type OcrHandler = (file: FileMetadata) => Promise<OcrResult>

export class OcrService {
  private registry: Map<string, OcrHandler> = new Map()

  register(providerId: string, handler: OcrHandler): void {
    this.registry.set(providerId, handler)
  }

  unregister(providerId: string): void {
    this.registry.delete(providerId)
  }

  public async ocr(file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> {
    const handler = this.registry.get(provider.id)
    if (!handler) {
      throw new Error(`Provider ${provider.id} is not registered`)
    }
    return handler(file)
  }
}

export const ocrService = new OcrService()

// Register built-in providers
ocrService.register(BuiltinOcrProviderIds.tesseract, async (file) => {
  return tesseractService.ocr(file)
})
