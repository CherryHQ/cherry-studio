import { loggerService } from '@logger'
import { DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { BaseService } from '@main/core/lifecycle'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'

import { fileProcessingFacade } from './facade/FileProcessingFacade'

const logger = loggerService.withContext('FileProcessingIpcService')

@Injectable('FileProcessingIpcService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CacheService', 'PreferenceService'])
export class FileProcessingIpcService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
    logger.info('File processing IPC service initialized')
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.FileProcessing_ExtractText, (_, file: FileMetadata, processorId?: FileProcessorId) =>
      fileProcessingFacade.extractText(file, processorId)
    )
    this.ipcHandle(
      IpcChannel.FileProcessing_StartMarkdownConversionTask,
      (_, file: FileMetadata, processorId?: FileProcessorId) =>
        fileProcessingFacade.startMarkdownConversionTask(file, processorId)
    )
    this.ipcHandle(
      IpcChannel.FileProcessing_GetMarkdownConversionTaskResult,
      (_, providerTaskId: string, processorId: FileProcessorId) =>
        fileProcessingFacade.getMarkdownConversionTaskResult(providerTaskId, processorId)
    )
  }
}
