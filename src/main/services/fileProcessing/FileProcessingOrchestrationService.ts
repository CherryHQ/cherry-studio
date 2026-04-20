import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import { FileMetadataSchema } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { ocrService } from './ocr/OcrService'
import type {
  ExtractTextInput,
  FileProcessingMarkdownTaskResult,
  FileProcessingMarkdownTaskStartResult,
  FileProcessingTextExtractionResult,
  GetMarkdownConversionTaskResultInput,
  StartMarkdownConversionTaskInput
} from './types'

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
    taskId: z.string().trim().min(1)
  })
  .strict()

@Injectable('FileProcessingOrchestrationService')
@ServicePhase(Phase.WhenReady)
export class FileProcessingOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
    logger.info('File processing service initialized')
  }

  async extractText({ file, processorId, signal }: ExtractTextInput): Promise<FileProcessingTextExtractionResult> {
    logger.debug('Dispatching OCR request', {
      requestedProcessorId: processorId,
      fileId: file.id
    })

    return ocrService.extractText({
      file,
      processorId,
      signal
    })
  }

  async startMarkdownConversionTask({
    file,
    processorId,
    signal
  }: StartMarkdownConversionTaskInput): Promise<FileProcessingMarkdownTaskStartResult> {
    const markdownTaskService = application.get('MarkdownTaskService')

    logger.debug('Dispatching markdown task start request', {
      requestedProcessorId: processorId,
      fileId: file.id
    })

    return markdownTaskService.startTask({
      file,
      processorId,
      signal
    })
  }

  async getMarkdownConversionTaskResult({
    taskId,
    signal
  }: GetMarkdownConversionTaskResultInput): Promise<FileProcessingMarkdownTaskResult> {
    const markdownTaskService = application.get('MarkdownTaskService')

    logger.debug('Dispatching markdown task query request', {
      taskId
    })

    return markdownTaskService.getTaskResult({
      taskId,
      signal
    })
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
