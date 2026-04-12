import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type { FileMetadata } from '@types'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import type {
  ExtractTextInput,
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult,
  GetMarkdownConversionTaskResultInput,
  StartMarkdownConversionTaskInput
} from './contracts/types'
import { createMarkdownConversionProcessor, createTextExtractionProcessor } from './processors/factory'

const logger = loggerService.withContext('FileProcessingOrchestrationService')

@Injectable('FileProcessingOrchestrationService')
@ServicePhase(Phase.WhenReady)
export class FileProcessingOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
    logger.info('File processing orchestration service initialized')
  }

  async extractText({ file, processorId, signal }: ExtractTextInput): Promise<FileProcessingTextExtractionResult> {
    const resolvedConfig = resolveProcessorConfigByFeature('text_extraction', processorId)
    const processor = createTextExtractionProcessor(resolvedConfig.id)

    logger.debug('Extracting text with file-processing orchestration service', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    return await processor.extractText(file, resolvedConfig, signal)
  }

  async startMarkdownConversionTask({
    file,
    processorId,
    signal
  }: StartMarkdownConversionTaskInput): Promise<FileProcessingMarkdownTaskStartResult> {
    const resolvedConfig = resolveProcessorConfigByFeature('markdown_conversion', processorId)
    const processor = createMarkdownConversionProcessor(resolvedConfig.id)

    logger.debug('Starting markdown conversion task with file-processing orchestration service', {
      processorId: resolvedConfig.id,
      fileId: file.id
    })

    return await processor.startMarkdownConversionTask(file, resolvedConfig, signal)
  }

  async getMarkdownConversionTaskResult({
    providerTaskId,
    processorId,
    signal
  }: GetMarkdownConversionTaskResultInput): Promise<FileProcessingMarkdownTaskResult> {
    const processor = createMarkdownConversionProcessor(processorId)

    logger.debug('Getting markdown conversion task result with file-processing orchestration service', {
      processorId,
      providerTaskId
    })

    return await processor.getMarkdownConversionTaskResult(providerTaskId, signal)
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.FileProcessing_ExtractText, (_event, file: FileMetadata, processorId?: FileProcessorId) =>
      this.extractText({ file, processorId })
    )
    this.ipcHandle(
      IpcChannel.FileProcessing_StartMarkdownConversionTask,
      (_event, file: FileMetadata, processorId?: FileProcessorId) =>
        this.startMarkdownConversionTask({ file, processorId })
    )
    this.ipcHandle(
      IpcChannel.FileProcessing_GetMarkdownConversionTaskResult,
      (_event, providerTaskId: string, processorId: FileProcessorId) =>
        this.getMarkdownConversionTaskResult({ providerTaskId, processorId })
    )
  }
}
