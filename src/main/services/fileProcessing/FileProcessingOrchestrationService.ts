import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import { FileEntryIdSchema } from '@shared/data/types/file'
import { ListAvailableFileProcessorsResultSchema } from '@shared/data/types/fileProcessing'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { processorRegistry } from './processors/registry'
import { backgroundJobHandler } from './tasks/backgroundJobHandler'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'
import { remotePollJobHandler } from './tasks/remotePollJobHandler'
import type { ListAvailableFileProcessorsResult, StartFileProcessingTaskInput } from './types'

const logger = loggerService.withContext('FileProcessingOrchestrationService')

const FileProcessorFeatureSchema = z.enum(FILE_PROCESSOR_FEATURES)
const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)

const StartTaskPayloadSchema = z
  .object({
    feature: FileProcessorFeatureSchema,
    fileEntryId: FileEntryIdSchema,
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

interface StartTaskOptions {
  idempotencyKey?: string
  parentId?: string
}

@Injectable('FileProcessingOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['JobManager'])
export class FileProcessingOrchestrationService extends BaseService {
  protected onInit(): void {
    // Register handlers in onInit (NOT onReady) so JobManager.onAllReady's
    // startup recovery sweep sees them when re-dispatching non-terminal jobs.
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('file-processing.background', backgroundJobHandler)
    jobManager.registerHandler('file-processing.remote-poll', remotePollJobHandler)
    this.registerIpcHandlers()
    logger.info('File processing orchestration service initialized')
  }

  /**
   * Enqueue a file-processing job.
   *
   * Idempotency invariant: `input.fileEntryId` identifies a FileEntry, so the
   * same entry + processor + feature reuses the same pending job.
   *
   * The handler.mode field on the capability handler determines the JobRegistry
   * type to enqueue under (background vs remote-poll). This is a synchronous
   * lookup — no `await prepare()` is needed at enqueue time.
   */
  async startTask(input: StartFileProcessingTaskInput, options: StartTaskOptions = {}): Promise<JobSnapshot> {
    const { feature, fileEntryId, processorId } = input
    const config = resolveProcessorConfigByFeature(feature, processorId)
    const handler = getCapabilityHandler(config.id, feature)
    const file = await resolveFileProcessingFileInfo(fileEntryId)
    assertFileTypeSupported(file, feature, config)

    const type = handler.mode === 'background' ? 'file-processing.background' : 'file-processing.remote-poll'
    const jobManager = application.get('JobManager')
    const handle = await jobManager.enqueue(
      type,
      { feature, fileEntryId, processorId: config.id },
      {
        idempotencyKey: options.idempotencyKey ?? `fp:${fileEntryId}:${config.id}:${feature}`,
        ...(options.parentId ? { parentId: options.parentId } : {})
      }
    )
    const { id, snapshot } = handle

    logger.debug('Enqueued file processing job', {
      jobId: id,
      type,
      feature,
      processorId: config.id,
      fileEntryId,
      reusedExisting: snapshot.status !== 'pending'
    })

    return handle.snapshot
  }

  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const processorIds = Object.entries(processorRegistry)
      .filter(([, processor]) => processor.isAvailable())
      .map(([processorId]) => processorId as FileProcessorId)
    return ListAvailableFileProcessorsResultSchema.parse({ processorIds })
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.FileProcessing_StartTask, async (_, payload: unknown) => {
      return await this.startTask(StartTaskPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_ListAvailableProcessors, () => {
      return this.listAvailableProcessors()
    })
  }
}
