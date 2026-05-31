import { application } from '@application'
import { loggerService } from '@logger'
import type { EnqueueOptions } from '@main/core/job/types'
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
import type { ListAvailableFileProcessorsResult, StartFileProcessingJobInput } from './types'

const logger = loggerService.withContext('FileProcessingOrchestrationService')

const FileProcessorFeatureSchema = z.enum(FILE_PROCESSOR_FEATURES)
const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)

const StartJobPayloadSchema = z
  .object({
    feature: FileProcessorFeatureSchema,
    fileEntryId: FileEntryIdSchema,
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

@Injectable('FileProcessingOrchestrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
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
   * Each call creates a fresh processing job. Do not use FileEntryId as an
   * idempotency key: it is not a content-version identity. If we add reuse
   * later, scope it to a contentHash plus processor/config/version.
   *
   * The handler.mode field on the capability handler determines the JobRegistry
   * type to enqueue under (background vs remote-poll). This is a synchronous
   * lookup — no `await prepare()` is needed at enqueue time.
   */
  async startJob(
    input: StartFileProcessingJobInput,
    options: Pick<EnqueueOptions, 'parentId'> = {}
  ): Promise<JobSnapshot> {
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
      options.parentId ? { parentId: options.parentId } : {}
    )

    logger.debug('Enqueued file processing job', {
      jobId: handle.id,
      type,
      feature,
      processorId: config.id,
      fileEntryId
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
    this.ipcHandle(IpcChannel.FileProcessing_StartJob, async (_, payload: unknown) => {
      return await this.startJob(StartJobPayloadSchema.parse(payload))
    })
    this.ipcHandle(IpcChannel.FileProcessing_ListAvailableProcessors, () => {
      return this.listAvailableProcessors()
    })
  }
}
