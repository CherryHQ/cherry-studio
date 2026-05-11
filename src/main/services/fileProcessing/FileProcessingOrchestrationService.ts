import { loggerService } from '@logger'
import { application } from '@main/core/application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import { ListAvailableFileProcessorsResultSchema } from '@shared/data/types/fileProcessing'
import { FileMetadataSchema } from '@shared/data/types/knowledge'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import type {
  CancelFileProcessingTaskInput,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult,
  GetFileProcessingTaskInput,
  GetFileProcessingTaskOptions,
  ListAvailableFileProcessorsResult,
  StartFileProcessingTaskInput,
  StartFileProcessingTaskOptions
} from './types'

const logger = loggerService.withContext('FileProcessingOrchestrationService')

const FileProcessorFeatureSchema = z.enum(FILE_PROCESSOR_FEATURES)
const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)

const StartTaskPayloadSchema = z
  .object({
    feature: FileProcessorFeatureSchema,
    file: FileMetadataSchema,
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

const GetTaskPayloadSchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict()

const CancelTaskPayloadSchema = z
  .object({
    taskId: z.string().trim().min(1)
  })
  .strict()

@Injectable('FileProcessingOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileProcessingTaskService'])
export class FileProcessingOrchestrationService extends BaseService {
  protected onInit(): void {
    this.registerIpcHandlers()
    logger.info('File processing service initialized')
  }

  async startTask(
    input: StartFileProcessingTaskInput,
    options?: StartFileProcessingTaskOptions
  ): Promise<FileProcessingTaskStartResult> {
    logger.debug('Dispatching file processing task start request', {
      feature: input.feature,
      requestedProcessorId: input.processorId,
      fileId: input.file.id
    })

    return application.get('FileProcessingTaskService').startTask(input, options)
  }

  async getTask(
    input: GetFileProcessingTaskInput,
    options?: GetFileProcessingTaskOptions
  ): Promise<FileProcessingTaskResult> {
    logger.debug('Dispatching file processing task query request', {
      taskId: input.taskId
    })

    return application.get('FileProcessingTaskService').getTask(input, options)
  }

  async cancelTask(input: CancelFileProcessingTaskInput): Promise<FileProcessingTaskResult> {
    logger.debug('Dispatching file processing task cancel request', {
      taskId: input.taskId
    })

    return application.get('FileProcessingTaskService').cancelTask(input)
  }

  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    return ListAvailableFileProcessorsResultSchema.parse({
      processorIds: application.get('FileProcessingTaskService').listAvailableProcessorIds()
    })
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.FileProcessing_StartTask, async (_, payload: unknown) => {
      return await this.startTask(StartTaskPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_GetTask, async (_, payload: unknown) => {
      return await this.getTask(GetTaskPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_CancelTask, async (_, payload: unknown) => {
      return await this.cancelTask(CancelTaskPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_ListAvailableProcessors, () => {
      return this.listAvailableProcessors()
    })
  }
}
