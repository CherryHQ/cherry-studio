import { loggerService } from '@logger'
import { isLinux } from '@main/constant'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcChannel } from '@shared/IpcChannel'
import type { OcrHandler, OcrProvider, OcrResult, SupportedOcrFile } from '@types'
import { BuiltinOcrProviderIds } from '@types'

import { ovOcrService } from './builtin/OvOcrService'
import { ppocrService } from './builtin/PpocrService'
import { systemOcrService } from './builtin/SystemOcrService'
import { tesseractService } from './builtin/TesseractService'

const logger = loggerService.withContext('OcrService')

@Injectable('OcrService')
@ServicePhase(Phase.WhenReady)
export class OcrService extends BaseService {
  private registry: Map<string, OcrHandler> = new Map()

  protected async onInit(): Promise<void> {
    this.registerBuiltinProviders()
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    await tesseractService.dispose()
  }

  register(providerId: string, handler: OcrHandler): void {
    if (this.registry.has(providerId)) {
      logger.warn(`Provider ${providerId} has existing handler. Overwrited.`)
    }
    this.registry.set(providerId, handler)
  }

  unregister(providerId: string): void {
    this.registry.delete(providerId)
  }

  public listProviderIds(): string[] {
    return Array.from(this.registry.keys())
  }

  public async ocr(file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> {
    const handler = this.registry.get(provider.id)
    if (!handler) {
      throw new Error(`Provider ${provider.id} is not registered`)
    }
    return handler(file, provider.config)
  }

  private registerBuiltinProviders(): void {
    this.register(BuiltinOcrProviderIds.tesseract, tesseractService.ocr.bind(tesseractService))

    if (!isLinux) {
      this.register(BuiltinOcrProviderIds.system, systemOcrService.ocr.bind(systemOcrService))
    }

    this.register(BuiltinOcrProviderIds.paddleocr, ppocrService.ocr.bind(ppocrService))

    if (ovOcrService.isAvailable()) {
      this.register(BuiltinOcrProviderIds.ovocr, ovOcrService.ocr.bind(ovOcrService))
    }
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.OCR_ocr, (_, file: SupportedOcrFile, provider: OcrProvider) => this.ocr(file, provider))
    this.ipcHandle(IpcChannel.OCR_ListProviders, () => this.listProviderIds())
  }
}
