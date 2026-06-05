import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isLinux } from '@main/core/platform'
import { IpcChannel } from '@shared/IpcChannel'
import {
  OcrAsyncTaskResultSchema,
  OcrAsyncTaskStartResultSchema,
  OcrAsyncTaskStatusSchema
} from '@shared/ocr/async'
import type { OcrProvider, OcrResult, OcrTaskResult, OcrTaskStartResult, OcrTaskStatus, SupportedOcrFile } from '@types'
import { BuiltinOcrProviderIds } from '@types'

import type { OcrBaseService as OcrProviderService } from './builtin/OcrBaseService'
import { ovOcrService } from './builtin/OvOcrService'
import { ppocrService } from './builtin/PpocrService'
import { systemOcrService } from './builtin/SystemOcrService'
import { tesseractService } from './builtin/TesseractService'

const logger = loggerService.withContext('OcrService')

type LocalOcrTaskRecord = {
  status: OcrTaskStatus['status']
  progress: number
  result?: OcrTaskResult['result']
  error?: Error
}

@Injectable('OcrService')
@ServicePhase(Phase.WhenReady)
export class OcrService extends BaseService {
  private registry: Map<string, OcrProviderService> = new Map()
  private localTasks = new Map<string, LocalOcrTaskRecord>()

  protected async onInit(): Promise<void> {
    this.registerBuiltinProviders()
    this.registerIpcHandlers()
  }

  protected async onStop(): Promise<void> {
    this.localTasks.clear()
    await tesseractService.dispose()
  }

  register(providerId: string, service: OcrProviderService): void {
    if (this.registry.has(providerId)) {
      logger.warn(`Provider ${providerId} has existing handler. Overwrited.`)
    }
    this.registry.set(providerId, service)
  }

  unregister(providerId: string): void {
    this.registry.delete(providerId)
  }

  public listProviderIds(): string[] {
    return Array.from(this.registry.keys())
  }

  public async ocr(file: SupportedOcrFile, provider: OcrProvider): Promise<OcrResult> {
    const service = this.getRegisteredProvider(provider)

    if (service.ocr) {
      return service.ocr(file, provider.config)
    }

    throw new Error(`Provider ${provider.id} does not support one-shot OCR`)
  }

  public async startTask(file: SupportedOcrFile, provider: OcrProvider): Promise<OcrTaskStartResult> {
    const service = this.getRegisteredProvider(provider)

    if (service.startTask) {
      return service.startTask(file, provider.config)
    }

    if (!service.ocr) {
      throw new Error(`Provider ${provider.id} does not support async OCR tasks`)
    }

    const taskId = crypto.randomUUID()
    this.localTasks.set(taskId, {
      status: 'processing',
      progress: 1
    })

    void service
      .ocr(file, provider.config)
      .then((result) => {
        this.localTasks.set(taskId, {
          status: 'completed',
          progress: 100,
          result: {
            text: result.text,
            pages: [{ text: result.text }]
          }
        })
      })
      .catch((error) => {
        const taskError = error instanceof Error ? error : new Error(String(error))
        logger.error(`Local OCR task ${taskId} failed`, taskError)
        this.localTasks.set(taskId, {
          status: 'failed',
          progress: 0,
          error: taskError
        })
      })

    return OcrAsyncTaskStartResultSchema.parse({
      taskId,
      providerTaskId: taskId,
      status: 'processing'
    })
  }

  public async getTaskStatus(taskId: string, provider: OcrProvider): Promise<OcrTaskStatus> {
    const service = this.getRegisteredProvider(provider)

    if (service.getTaskStatus) {
      return service.getTaskStatus(taskId, provider.config)
    }

    const task = this.getLocalTask(taskId)

    return OcrAsyncTaskStatusSchema.parse({
      taskId,
      providerTaskId: taskId,
      status: task.status,
      progress: task.progress
    })
  }

  public async getTaskResult(taskId: string, provider: OcrProvider): Promise<OcrTaskResult> {
    const service = this.getRegisteredProvider(provider)

    if (service.getTaskResult) {
      return service.getTaskResult(taskId, provider.config)
    }

    const task = this.getLocalTask(taskId)

    if (task.status === 'failed') {
      throw task.error ?? new Error(`OCR task ${taskId} failed`)
    }

    if (task.status !== 'completed' || !task.result) {
      throw new Error(`OCR task ${taskId} is not completed`)
    }

    return OcrAsyncTaskResultSchema.parse({
      taskId,
      providerTaskId: taskId,
      status: 'completed',
      progress: 100,
      result: task.result
    })
  }

  private registerBuiltinProviders(): void {
    this.register(BuiltinOcrProviderIds.tesseract, tesseractService)

    if (!isLinux) {
      this.register(BuiltinOcrProviderIds.system, systemOcrService)
    }

    this.register(BuiltinOcrProviderIds.paddleocr, ppocrService)

    if (ovOcrService.isAvailable()) {
      this.register(BuiltinOcrProviderIds.ovocr, ovOcrService)
    }
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.OCR_Start, (_, file: SupportedOcrFile, provider: OcrProvider) => this.startTask(file, provider))
    this.ipcHandle(IpcChannel.OCR_GetStatus, (_, taskId: string, provider: OcrProvider) => this.getTaskStatus(taskId, provider))
    this.ipcHandle(IpcChannel.OCR_GetResult, (_, taskId: string, provider: OcrProvider) => this.getTaskResult(taskId, provider))
    this.ipcHandle(IpcChannel.OCR_ListProviders, () => this.listProviderIds())
  }

  private getRegisteredProvider(provider: OcrProvider): OcrProviderService {
    const service = this.registry.get(provider.id)
    if (!service) {
      throw new Error(`Provider ${provider.id} is not registered`)
    }
    return service
  }

  private getLocalTask(taskId: string): LocalOcrTaskRecord {
    const task = this.localTasks.get(taskId)
    if (!task) {
      throw new Error(`OCR task ${taskId} was not found`)
    }
    return task
  }
}
