import { application } from '@application'
import { loggerService } from '@logger'
import type { EnqueueOptions } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { ListAvailableFileProcessorsResultSchema } from '@shared/data/types/fileProcessing'

import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { processorRegistry } from './processors/registry'
import { backgroundJobHandler } from './tasks/backgroundJobHandler'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'
import { remotePollJobHandler } from './tasks/remotePollJobHandler'
import type { FileProcessingJobPayload } from './tasks/shared'
import type { ListAvailableFileProcessorsResult, StartFileProcessingJobInput } from './types'

const logger = loggerService.withContext('FileProcessingService')

@Injectable('FileProcessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
export class FileProcessingService extends BaseService {
  protected onInit(): void {
    // Register handlers in onInit (NOT onReady) so JobManager.onAllReady's
    // startup recovery sweep sees them when re-dispatching non-terminal jobs.
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('file-processing.background', backgroundJobHandler)
    jobManager.registerHandler('file-processing.remote-poll', remotePollJobHandler)
    logger.info('File processing service initialized')
  }

  /**
   * Enqueue a file-processing job.
   *
   * Each call creates a fresh processing job. Neither the `file` handle (a path
   * or entry reference) nor `context.dataId` (a provider-specific task id, e.g.
   * MinerU's data_id) is a content-version identity, so do not use either as an
   * idempotency key. If we add reuse later, scope it to a contentHash plus
   * processor/config/version.
   *
   * The handler.mode field on the capability handler determines the JobRegistry
   * type to enqueue under (background vs remote-poll). This is a synchronous
   * lookup — no `await prepare()` is needed at enqueue time.
   */
  async startJob(
    input: StartFileProcessingJobInput,
    options: Pick<EnqueueOptions, 'parentId'> = {}
  ): Promise<JobSnapshot> {
    const { feature, file, output, context, processorId } = input
    // `document_to_markdown` always produces a markdown/zip artifact that needs a
    // path output target. Reject the illegal state here, before enqueueing (and
    // before any remote API call), instead of failing late in artifact persistence.
    if (feature === 'document_to_markdown' && output?.kind !== 'path') {
      throw new Error("File processing feature 'document_to_markdown' requires a path output target")
    }
    const config = resolveProcessorConfigByFeature(feature, processorId)
    const handler = getCapabilityHandler(config.id, feature)
    const fileInfo = await resolveFileProcessingFileInfo(file)
    assertFileTypeSupported(fileInfo, feature, config)

    const payload: FileProcessingJobPayload = {
      feature,
      file,
      processorId: config.id,
      ...(output ? { output } : {}),
      ...(context ? { context } : {})
    }

    const type = handler.mode === 'background' ? 'file-processing.background' : 'file-processing.remote-poll'
    const jobManager = application.get('JobManager')
    const handle = await jobManager.enqueue(type, payload, options.parentId ? { parentId: options.parentId } : {})

    logger.debug('Enqueued file processing job', {
      jobId: handle.id,
      type,
      feature,
      processorId: config.id,
      file,
      output
    })

    return handle.snapshot
  }

  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const processorIds = Object.entries(processorRegistry)
      .filter(([, processor]) => processor.isAvailable())
      .map(([processorId]) => processorId as FileProcessorId)
    return ListAvailableFileProcessorsResultSchema.parse({ processorIds })
  }
}
