import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import { FileMetadataSchema } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

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
const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)

const ExtractTextPayloadSchema = z
  .object({
    file: FileMetadataSchema,
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

const StartMarkdownConversionTaskPayloadSchema = z
  .object({
    file: FileMetadataSchema,
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

const GetMarkdownConversionTaskResultPayloadSchema = z
  .object({
    providerTaskId: z.string().trim().min(1),
    processorId: FileProcessorIdSchema
  })
  .strict()

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
    this.ipcHandle(IpcChannel.FileProcessing_ExtractText, async (_, payload: unknown) => {
      return await this.extractText(ExtractTextPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_StartMarkdownConversionTask, async (_, payload: unknown) => {
      return await this.startMarkdownConversionTask(StartMarkdownConversionTaskPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_GetMarkdownConversionTaskResult, async (_, payload: unknown) => {
      return await this.getMarkdownConversionTaskResult(GetMarkdownConversionTaskResultPayloadSchema.parse(payload))
    })
  }
}
