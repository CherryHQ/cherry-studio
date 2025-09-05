import { loggerService } from '@logger'
import { isLinux } from '@main/constant'
import { BuiltinOcrProviderIds, OcrHandler, OcrProvider, OcrResult, SupportedOcrFile } from '@types'

import { ppocrService } from './builtin/PpocrService'
import { systemOcrService } from './builtin/SystemOcrService'
import { tesseractService } from './builtin/TesseractService'

const logger = loggerService.withContext('OcrService')

export class OcrService {
  private registry: Map<string, OcrHandler> = new Map()

  register(providerId: string, handler: OcrHandler): void {
    if (this.registry.has(providerId)) {
      logger.warn(`Provider ${providerId} has existing handler. Overwrited.`)
    }
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
    return handler(file, provider.config)
  }
}

export const ocrService = new OcrService()

// Register built-in providers
ocrService.register(BuiltinOcrProviderIds.tesseract, tesseractService.ocr.bind(tesseractService))

!isLinux && ocrService.register(BuiltinOcrProviderIds.system, systemOcrService.ocr.bind(systemOcrService))

ocrService.register(BuiltinOcrProviderIds.paddleocr, ppocrService.ocr.bind(ppocrService))
