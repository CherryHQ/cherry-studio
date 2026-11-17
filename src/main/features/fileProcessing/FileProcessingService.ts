import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { TerminalJobStatus } from '@shared/data/api/schemas/jobs'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileHandle } from '@shared/data/types/file'
import { ListAvailableFileProcessorsResultSchema } from '@shared/data/types/fileProcessing'

import { getFileProcessorConfigById, resolveProcessorConfigByFeature } from './config/resolveProcessorConfig'
import { ocrImageToText } from './ocrImageToText'
import { probeOpenMineru } from './processors/openMineru/protocol'
import { processorRegistry } from './processors/registry'
import { backgroundJobHandler, localBackgroundJobHandler } from './tasks/backgroundJobHandler'
import {
  isFileProcessingJobType,
  toFileProcessingTask,
  toFileProcessingTaskId,
  toQueuedTask,
  toSettledTask,
  withTaskUpdates
} from './tasks/fileProcessingTask'
import { assertFileTypeSupported, getCapabilityHandler, resolveFileProcessingFileInfo } from './tasks/jobExecution'
import { remotePollJobHandler } from './tasks/remotePollJobHandler'
import type { FileProcessingJobPayload } from './tasks/shared'
import type {
  FileProcessingTask,
  FileProcessingTaskCancelOutcome,
  FileProcessingTaskId,
  ListAvailableFileProcessorsResult,
  StartedFileProcessingTask,
  StartFileProcessingTaskInput
} from './types'
import { getApiKey, getRequiredApiHost, getRequiredCapability } from './utils/provider'

const logger = loggerService.withContext('FileProcessingService')

/** How long a settled task stays in the shared cache; `getTask` reads it from its job row after that. */
const SETTLED_TASK_TTL_MS = 60_000

function taskCacheKey(id: FileProcessingTaskId): `file_processing.task.${string}` {
  return `file_processing.task.${id}`
}

@Injectable('FileProcessingService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['FileManager', 'JobManager'])
export class FileProcessingService extends BaseService {
  private readonly _onDidChangeTask = new Emitter<FileProcessingTask>()
  /** Fires on every status change and progress report of every task. */
  readonly onDidChangeTask: Event<FileProcessingTask> = this._onDidChangeTask.event

  protected onInit(): void {
    // Register in onInit (NOT onReady): JobManager cancels each type's rows left by the
    // previous launch when its handler registers, before anything can wait on them.
    const jobManager = application.get('JobManager')
    const publish = (task: FileProcessingTask) => this.publishTask(task)
    jobManager.registerHandler('file-processing.background', withTaskUpdates(backgroundJobHandler, publish))
    jobManager.registerHandler('file-processing.background-local', withTaskUpdates(localBackgroundJobHandler, publish))
    jobManager.registerHandler('file-processing.remote-poll', withTaskUpdates(remotePollJobHandler, publish))
    logger.info('File processing service initialized')
  }

  protected onDestroy(): void {
    this._onDidChangeTask.dispose()
  }

  /**
   * Queue a conversion as a new task.
   *
   * Each call starts a fresh task. Neither the `file` handle (a path or entry
   * reference) nor `context.dataId` (a provider-specific task id, e.g. MinerU's
   * data_id) is a content-version identity, so neither deduplicates a task. If we
   * add reuse later, scope it to a contentHash plus processor/config/version.
   */
  async startTask(input: StartFileProcessingTaskInput): Promise<StartedFileProcessingTask> {
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

    // The capability handler's mode picks the job type (background vs remote-poll), and for
    // background the processor's `runtime` picks the local or remote half — no `prepare()` needed.
    const type =
      handler.mode === 'remote-poll'
        ? 'file-processing.remote-poll'
        : processorRegistry[config.id].runtime === 'local'
          ? 'file-processing.background-local'
          : 'file-processing.background'
    const handle = application.get('JobManager').enqueue(type, payload)

    logger.debug('Enqueued file processing job', {
      jobId: handle.id,
      type,
      feature,
      processorId: config.id,
      file,
      output
    })

    const id = toFileProcessingTaskId(handle.id)
    const task = toQueuedTask(id, payload)
    this.publishTask(task)
    const done = handle.finished.then((snapshot) =>
      // `finished` resolves only with a terminal snapshot.
      toSettledTask(id, payload, { ...snapshot, status: snapshot.status as TerminalJobStatus })
    )
    return { task, done }
  }

  /** A task's current state, or null when no such task exists. */
  async getTask(id: FileProcessingTaskId): Promise<FileProcessingTask | null> {
    const snapshot = await application.get('JobManager').get(id)
    if (!snapshot || !isFileProcessingJobType(snapshot.type)) {
      return null
    }
    const live = application.get('CacheService').getShared(taskCacheKey(id))
    return toFileProcessingTask(snapshot, live?.status === 'processing' ? live.progress : 0)
  }

  /** Cancel a task that has not settled. Resolves once its conversion stops, or gives up waiting. */
  async cancelTask(id: FileProcessingTaskId, reason?: string): Promise<FileProcessingTaskCancelOutcome> {
    const jobManager = application.get('JobManager')
    const snapshot = await jobManager.get(id)
    if (!snapshot || !isFileProcessingJobType(snapshot.type)) {
      return 'not-cancellable'
    }
    return (await jobManager.cancel(id, reason)).outcome
  }

  private publishTask(task: FileProcessingTask): void {
    const settled = task.status !== 'queued' && task.status !== 'processing'
    application.get('CacheService').setShared(taskCacheKey(task.id), task, settled ? SETTLED_TASK_TTL_MS : undefined)
    this._onDidChangeTask.fire(task)
  }

  /**
   * OCR an image into plain text using the user's configured `image_to_text`
   * processor — the synchronous, content-version-cached path used by the AI chat
   * attachment flow (`attachmentRouting` / `read_file`). Keeps OCR processor /
   * handler internals owned by this domain instead of being deep-imported from
   * `ai/`. Throws on failure / no configured processor; callers turn that into a
   * model-facing note.
   */
  ocrImage(file: FileHandle, signal?: AbortSignal): Promise<string> {
    return ocrImageToText(file, signal)
  }

  /**
   * Processors this machine could run — the settings pages list exactly these.
   *
   * Filters on platform support only. A processor whose local model is not
   * downloaded yet still belongs in the list: hiding it strands the user, since
   * its settings entry is where the download button lives.
   */
  listAvailableProcessors(): ListAvailableFileProcessorsResult {
    const processorIds = Object.entries(processorRegistry)
      .filter(([, processor]) => processor.isSupported())
      .map(([processorId]) => processorId as FileProcessorId)
    return ListAvailableFileProcessorsResultSchema.parse({ processorIds })
  }

  /** Reachability is distinct from a successful protocol or authentication check. */
  async checkOpenMineruConnectivity(): Promise<boolean> {
    const processorId = 'open-mineru'
    const feature = 'document_to_markdown'
    const config = getFileProcessorConfigById(processorId)
    const capability = getRequiredCapability(config, feature, processorId)

    let apiHost: string
    try {
      apiHost = getRequiredApiHost(capability)
    } catch {
      // No host to reach — the user cleared it, which is its own kind of "down".
      return false
    }

    try {
      const probe = await probeOpenMineru({ apiHost, apiKey: getApiKey(config, processorId) })
      return probe.kind === 'supported' || probe.kind === 'http-error'
    } catch (error) {
      logger.debug('File processor connectivity probe failed', { processorId, apiHost, error })
      return false
    }
  }
}
