import { application } from '@application'
import { loggerService } from '@logger'
import type { EnqueueOptions, JobHandle } from '@main/core/job/types'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_FEATURES, FILE_PROCESSOR_IDS } from '@shared/data/preference/preferenceTypes'
import {
  FileProcessingImageToTextInputSchema,
  type FileProcessingImageToTextIpcResult,
  FileProcessingImageToTextIpcResultSchema,
  FileProcessingImageToTextResultSchema,
  FileProcessingJobOutputSchema,
  FileProcessingOutputTargetSchema,
  getFileProcessingImageToTextErrorCode,
  ListAvailableFileProcessorsResultSchema
} from '@shared/data/types/fileProcessing'
import type { FileHandle } from '@shared/file/types'
import { FileHandleSchema } from '@shared/file/types'
import { IpcChannel } from '@shared/IpcChannel'
import * as z from 'zod'

import { resolveDefaultImageToTextProcessor } from './config/defaultImageToTextProcessor'
import { resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { processorRegistry } from './processors/registry'
import { backgroundJobHandler } from './tasks/backgroundJobHandler'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'
import { remotePollJobHandler } from './tasks/remotePollJobHandler'
import type { FileProcessingJobPayload } from './tasks/shared'
import type { ListAvailableFileProcessorsResult, StartFileProcessingJobInput } from './types'

const logger = loggerService.withContext('FileProcessingService')

const FileProcessorFeatureSchema = z.enum(FILE_PROCESSOR_FEATURES)
const FileProcessorIdSchema = z.enum(FILE_PROCESSOR_IDS)
const DEFAULT_IMAGE_TO_TEXT_CANCEL_REASON = 'file-processing-image-to-text-cancelled'

const StartJobPayloadSchema = z
  .object({
    feature: FileProcessorFeatureSchema,
    file: FileHandleSchema,
    output: FileProcessingOutputTargetSchema.optional(),
    context: z
      .object({
        dataId: z.string().trim().min(1).optional()
      })
      .strict()
      .optional(),
    processorId: FileProcessorIdSchema.optional()
  })
  .strict()

const CancelImageToTextPayloadSchema = z
  .object({
    requestId: z.string().trim().min(1),
    reason: z.string().trim().min(1).max(200).optional()
  })
  .strict()

@Injectable('FileProcessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
export class FileProcessingService extends BaseService {
  private readonly pendingImageToTextRequestIds = new Set<string>()
  private readonly imageToTextRequestJobIds = new Map<string, string>()
  private readonly cancelledImageToTextRequests = new Map<string, string>()

  protected async onInit(): Promise<void> {
    // Register handlers in onInit (NOT onReady) so JobManager.onAllReady's
    // startup recovery sweep sees them when re-dispatching non-terminal jobs.
    const jobManager = application.get('JobManager')
    jobManager.registerHandler('file-processing.background', backgroundJobHandler)
    jobManager.registerHandler('file-processing.remote-poll', remotePollJobHandler)
    this.registerIpcHandlers()
    await this.initializeDefaultImageToTextProcessor()
    logger.info('File processing service initialized')
  }

  private async initializeDefaultImageToTextProcessor(): Promise<void> {
    const preferenceService = application.get('PreferenceService')

    if (preferenceService.get('feature.file_processing.default_image_to_text') !== null) {
      return
    }

    await preferenceService.set('feature.file_processing.default_image_to_text', resolveDefaultImageToTextProcessor())
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
    const handle = await this.enqueueJob(input, options)
    return handle.snapshot
  }

  private async enqueueJob(
    input: StartFileProcessingJobInput,
    options: Pick<EnqueueOptions, 'parentId'> = {}
  ): Promise<JobHandle> {
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

    return handle
  }

  async imageToText(input: unknown) {
    const parsed = FileProcessingImageToTextInputSchema.parse(input)
    const requestId = parsed.requestId
    if (requestId) {
      this.pendingImageToTextRequestIds.add(requestId)
    }

    try {
      const handle = await this.enqueueJob({
        feature: 'image_to_text',
        file: parsed.file as FileHandle
      })

      if (requestId) {
        this.pendingImageToTextRequestIds.delete(requestId)
        this.imageToTextRequestJobIds.set(requestId, handle.id)

        const cancelReason = this.cancelledImageToTextRequests.get(requestId)
        if (cancelReason) {
          await this.cancelImageToTextJob(handle.id, cancelReason)
        }
      }

      const result = await handle.finished

      if (result.status !== 'completed') {
        throw new Error(result.error?.message ?? `File processing image_to_text job ${result.status}`)
      }

      const output = FileProcessingJobOutputSchema.parse(result.output)

      if (output.artifact.kind !== 'text') {
        throw new Error('File processing image_to_text did not return text')
      }

      return FileProcessingImageToTextResultSchema.parse({ text: output.artifact.text })
    } finally {
      if (requestId) {
        this.pendingImageToTextRequestIds.delete(requestId)
        this.imageToTextRequestJobIds.delete(requestId)
        this.cancelledImageToTextRequests.delete(requestId)
      }
    }
  }

  async cancelImageToText(requestId: string, reason: string = DEFAULT_IMAGE_TO_TEXT_CANCEL_REASON): Promise<void> {
    const parsed = CancelImageToTextPayloadSchema.parse({ requestId, reason })
    const cancelReason = parsed.reason ?? DEFAULT_IMAGE_TO_TEXT_CANCEL_REASON
    const jobId = this.imageToTextRequestJobIds.get(parsed.requestId)

    if (!jobId) {
      if (this.pendingImageToTextRequestIds.has(parsed.requestId)) {
        this.cancelledImageToTextRequests.set(parsed.requestId, cancelReason)
      }
      return
    }

    await this.cancelImageToTextJob(jobId, cancelReason)
  }

  private async cancelImageToTextJob(jobId: string, reason: string): Promise<void> {
    await application.get('JobManager').cancel(jobId, reason)
  }

  private async imageToTextForIpc(input: unknown): Promise<FileProcessingImageToTextIpcResult> {
    try {
      const result = await this.imageToText(input)
      return FileProcessingImageToTextIpcResultSchema.parse({ ok: true, text: result.text })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? '')
      return FileProcessingImageToTextIpcResultSchema.parse({
        ok: false,
        code: getFileProcessingImageToTextErrorCode(error),
        message
      })
    }
  }

  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const processorIds = Object.entries(processorRegistry)
      .filter(([, processor]) => processor.isAvailable())
      .map(([processorId]) => processorId as FileProcessorId)
    return ListAvailableFileProcessorsResultSchema.parse({ processorIds })
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.FileProcessing_StartJob, async (_, payload: unknown) => {
      const parsed = StartJobPayloadSchema.parse(payload)
      return await this.startJob({ ...parsed, file: parsed.file as FileHandle })
    })
    this.ipcHandle(IpcChannel.FileProcessing_CancelImageToText, async (_, payload: unknown) => {
      const parsed = CancelImageToTextPayloadSchema.parse(payload)
      await this.cancelImageToText(parsed.requestId, parsed.reason)
    })
    this.ipcHandle(IpcChannel.FileProcessing_ImageToText, async (_, payload: unknown) => {
      return await this.imageToTextForIpc(payload)
    })
    this.ipcHandle(IpcChannel.FileProcessing_ListAvailableProcessors, () => {
      return this.listAvailableProcessors()
    })
  }
}
