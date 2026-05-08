import { loggerService } from '@logger'
import { BaseService, Emitter, type Event, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileProcessorFeature, FileProcessorId } from '@shared/data/preference/preferenceTypes'
import type { FileProcessorMerged } from '@shared/data/presets/file-processing'
import type { FileProcessorInput } from '@shared/data/presets/file-processing'
import type { FileType } from '@shared/data/types/file'
import type {
  FileProcessingArtifact,
  FileProcessingTaskResult,
  FileProcessingTaskStartResult,
  FileProcessingTaskStatus
} from '@shared/data/types/fileProcessing'
import type { FileMetadata } from '@types'
import { v4 as uuidv4 } from 'uuid'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import { cleanupFileProcessingResultsDir, markdownResultStore } from '../persistence/MarkdownResultStore'
import { processorRegistry } from '../processors/registry'
import type {
  FileProcessingCapabilityHandler,
  FileProcessingHandlerOutput,
  FileProcessingProcessorCapabilities,
  FileProcessingRemoteContext,
  FileProcessingRemotePollResult,
  PreparedBackgroundTask,
  PreparedRemoteTask
} from '../processors/types'
import type {
  CancelFileProcessingTaskInput,
  GetFileProcessingTaskInput,
  GetFileProcessingTaskOptions,
  StartFileProcessingTaskInput,
  StartFileProcessingTaskOptions
} from '../types'

const logger = loggerService.withContext('FileProcessingTaskService')

export const FILE_PROCESSING_TASK_TTL_MS = 10 * 60 * 1000
export const FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS = 5 * 60 * 1000

interface FileProcessingTaskRecord {
  taskId: string
  feature: FileProcessorFeature
  processorId: FileProcessorId
  fileId: string
  status: FileProcessingTaskStatus
  progress: number
  createdAt: number
  updatedAt: number
  providerTaskId?: string
  remoteContext?: FileProcessingRemoteContext
  remoteTask?: PreparedRemoteTask<FileProcessorFeature, FileProcessingRemoteContext>
  artifacts?: FileProcessingArtifact[]
  error?: string
  reason?: string
}

interface InFlightQuery {
  controller: AbortController
  promise: Promise<FileProcessingTaskResult>
}

interface BackgroundExecution {
  controller: AbortController
  promise: Promise<void>
}

interface RemoteStart {
  controller: AbortController
  promise: Promise<void>
}

type ActiveTaskStatus = Extract<FileProcessingTaskStatus, 'pending' | 'processing'>
type TaskOp =
  | 'create-background'
  | 'create-remote'
  | 'remote-started'
  | 'background-processing'
  | 'poll-processing'
  | 'complete'
  | 'fail'
  | 'cancel'
  | 'prune'
  | 'poll-deduped'
  | 'cancel-preserved'

interface MarkProcessingTaskInput {
  op?: TaskOp
  status?: ActiveTaskStatus
  progress?: number
  providerTaskId?: string
  remoteContext?: FileProcessingRemoteContext
  remoteTask?: PreparedRemoteTask<FileProcessorFeature, FileProcessingRemoteContext>
}

@Injectable('FileProcessingTaskService')
@ServicePhase(Phase.WhenReady)
export class FileProcessingTaskService extends BaseService {
  private tasks: Map<string, FileProcessingTaskRecord> | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private readonly inFlightQueries = new Map<string, InFlightQuery>()
  private readonly backgroundExecutions = new Map<string, BackgroundExecution>()
  private readonly inFlightStarts = new Map<string, RemoteStart>()
  private readonly _onTaskChanged = new Emitter<FileProcessingTaskResult>()
  public readonly onTaskChanged: Event<FileProcessingTaskResult> = this._onTaskChanged.event

  protected async onInit(): Promise<void> {
    this.tasks = new Map()
    this.startPruneTimer()

    logger.info('FileProcessingTaskService initialized')
  }

  protected async onStop(): Promise<void> {
    const inFlightQueries = Array.from(this.inFlightQueries.values())
    const backgroundExecutions = Array.from(this.backgroundExecutions.values())
    const inFlightStarts = Array.from(this.inFlightStarts.values())

    for (const query of inFlightQueries) {
      query.controller.abort(this.createAbortError('File processing task service is stopping'))
    }

    for (const start of inFlightStarts) {
      start.controller.abort(this.createAbortError('File processing task service is stopping'))
    }

    for (const execution of backgroundExecutions) {
      execution.controller.abort(this.createAbortError('File processing task service is stopping'))
    }

    await Promise.allSettled([
      ...inFlightQueries.map((query) => query.promise),
      ...inFlightStarts.map((start) => start.promise),
      ...backgroundExecutions.map((execution) => execution.promise)
    ])

    this.inFlightQueries.clear()
    this.inFlightStarts.clear()
    this.backgroundExecutions.clear()
    this.tasks?.clear()
    this.tasks = null

    logger.debug('FileProcessingTaskService cleanup completed', {
      abortedQueryCount: inFlightQueries.length,
      abortedStartCount: inFlightStarts.length,
      abortedExecutionCount: backgroundExecutions.length
    })
  }

  protected onDestroy(): void {
    this._onTaskChanged.dispose()
  }

  async startTask(
    { feature, file, processorId }: StartFileProcessingTaskInput,
    options: StartFileProcessingTaskOptions = {}
  ): Promise<FileProcessingTaskStartResult> {
    const { signal } = options

    signal?.throwIfAborted()

    const config = resolveProcessorConfigByFeature(feature, processorId)
    const handler = this.getCapabilityHandler(config.id, feature)
    this.assertFileTypeSupported(file, feature, config)

    const taskId = uuidv4()
    const now = Date.now()
    const baseTaskRecord: Omit<FileProcessingTaskRecord, 'status'> = {
      taskId,
      feature,
      processorId: config.id,
      fileId: file.id,
      progress: 0,
      createdAt: now,
      updatedAt: now
    }

    const preparedTask = await handler.prepare(file, config, signal)

    if (preparedTask.mode === 'remote-poll') {
      signal?.throwIfAborted()
      const taskRecord: FileProcessingTaskRecord = {
        ...baseTaskRecord,
        status: 'pending',
        remoteTask: preparedTask
      }
      this.setTask(taskRecord, 'create-remote')
      this.startRemoteExecution(taskRecord.taskId, preparedTask, taskRecord.processorId, signal)
    } else {
      signal?.throwIfAborted()
      const taskRecord: FileProcessingTaskRecord = {
        ...baseTaskRecord,
        status: 'processing'
      }
      const backgroundController = new AbortController()
      this.setTask(taskRecord, 'create-background')
      this.startBackgroundExecution(taskRecord.taskId, preparedTask, backgroundController)
    }

    logger.debug('Started file processing task', {
      taskId,
      feature,
      processorId: config.id,
      fileId: file.id,
      handlerMode: preparedTask.mode
    })

    const currentTask = this.getRequiredTask(taskId)
    return toTaskStartResult(currentTask)
  }

  async getTask(
    { taskId }: GetFileProcessingTaskInput,
    options: GetFileProcessingTaskOptions = {}
  ): Promise<FileProcessingTaskResult> {
    const { signal } = options

    signal?.throwIfAborted()

    const task = this.getRequiredTask(taskId)

    if (isTerminalStatus(task.status)) {
      return toTaskResult(task)
    }

    if (!task.remoteTask) {
      this.touchTask(taskId)
      return toTaskResult(this.getRequiredTask(taskId))
    }

    return this.pollRemoteExecution(taskId, signal)
  }

  async cancelTask({ taskId }: CancelFileProcessingTaskInput): Promise<FileProcessingTaskResult> {
    const task = this.getRequiredTask(taskId)

    if (isTerminalStatus(task.status)) {
      return toTaskResult(task)
    }

    this.abortTask(taskId, 'File processing task cancelled')
    this.markCancelled(taskId)

    return toTaskResult(this.getRequiredTask(taskId))
  }

  private getCapabilityHandler<Feature extends FileProcessorFeature>(
    processorId: FileProcessorId,
    feature: Feature
  ): FileProcessingCapabilityHandler<Feature> {
    const capabilities: FileProcessingProcessorCapabilities = processorRegistry[processorId].capabilities
    const handler = capabilities[feature]

    if (!handler) {
      throw new Error(`File processor ${processorId} does not support ${feature}`)
    }

    return handler
  }

  private assertFileTypeSupported(
    file: FileMetadata,
    feature: FileProcessorFeature,
    config: FileProcessorMerged
  ): void {
    const presetCapability = config.capabilities.find((item) => item.feature === feature)

    if (!presetCapability) {
      throw new Error(`File processor ${config.id} does not support ${feature}`)
    }

    if (!isSupportedFileType(file.type, presetCapability.inputs)) {
      throw new Error(`File processor ${config.id} ${feature} does not support ${file.type} files`)
    }
  }

  private startPruneTimer(): void {
    if (this.pruneTimer) {
      return
    }

    const pruneTimer = setInterval(() => {
      this.pruneExpiredTasks()
    }, FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS)

    pruneTimer.unref?.()
    this.pruneTimer = pruneTimer

    this.registerDisposable(() => {
      clearInterval(pruneTimer)

      if (this.pruneTimer === pruneTimer) {
        this.pruneTimer = null
      }
    })
  }

  private pollRemoteExecution(taskId: string, callerSignal?: AbortSignal): Promise<FileProcessingTaskResult> {
    const task = this.getRequiredTask(taskId)

    if (isTerminalStatus(task.status)) {
      return Promise.resolve(toTaskResult(task))
    }

    if (!task.remoteTask || !task.providerTaskId || task.remoteContext === undefined) {
      this.touchTask(taskId)
      return Promise.resolve(toTaskResult(this.getRequiredTask(taskId)))
    }

    const existingQuery = this.inFlightQueries.get(taskId)

    if (existingQuery) {
      this.logTaskOp(this.getRequiredTask(taskId), 'poll-deduped')
      return this.withCallerAbort(existingQuery.promise, callerSignal)
    }

    const controller = new AbortController()
    const promise = this.runRemoteExecutionPoll(taskId, controller.signal).finally(() => {
      const current = this.inFlightQueries.get(taskId)

      if (current?.promise === promise) {
        this.inFlightQueries.delete(taskId)
      }
    })

    this.inFlightQueries.set(taskId, {
      controller,
      promise
    })

    return this.withCallerAbort(promise, callerSignal)
  }

  private async runRemoteExecutionPoll(taskId: string, signal: AbortSignal): Promise<FileProcessingTaskResult> {
    const task = this.getRequiredTask(taskId)

    if (isTerminalStatus(task.status)) {
      return toTaskResult(task)
    }

    if (!task.remoteTask || !task.providerTaskId || task.remoteContext === undefined) {
      throw new Error(`File processing task ${taskId} is missing remote context`)
    }

    let pollResult: FileProcessingRemotePollResult

    try {
      pollResult = await task.remoteTask.pollRemote(
        {
          providerTaskId: task.providerTaskId,
          remoteContext: task.remoteContext
        },
        signal
      )
    } catch (error) {
      if (!isAbortError(error)) {
        logger.warn('File processing remote poll failed', error as Error, {
          taskId,
          processorId: task.processorId,
          providerTaskId: task.providerTaskId
        })
      }
      throw error
    }

    signal.throwIfAborted()

    return this.applyRemoteSnapshot(taskId, pollResult, signal)
  }

  private async applyRemoteSnapshot(
    taskId: string,
    snapshot: FileProcessingRemotePollResult,
    signal: AbortSignal
  ): Promise<FileProcessingTaskResult> {
    switch (snapshot.status) {
      case 'pending':
      case 'processing':
        const activeTask = this.markProcessing(taskId, {
          op: 'poll-processing',
          status: snapshot.status,
          progress: snapshot.progress,
          remoteContext: snapshot.remoteContext
        })

        if (activeTask && isTerminalStatus(activeTask.status)) {
          this.logTaskOp(activeTask, 'cancel-preserved', {
            status: activeTask.status
          })

          return toTaskResult(activeTask)
        }

        return toTaskResult(this.getRequiredTask(taskId))

      case 'failed':
        const failedTask = this.markFailed(taskId, snapshot.error, {
          error: getFailureMessage(snapshot.error)
        })

        if (failedTask && failedTask.status !== 'failed') {
          this.logTaskOp(failedTask, 'cancel-preserved', {
            status: failedTask.status
          })

          return toTaskResult(failedTask)
        }

        return toTaskResult(this.getRequiredTask(taskId))

      case 'completed': {
        const terminalTask = this.preserveTerminalTask(taskId, signal)

        if (terminalTask) {
          this.logTaskOp(terminalTask, 'cancel-preserved', {
            status: terminalTask.status
          })
          return toTaskResult(terminalTask)
        }

        if (!this.getTaskRecord(taskId)) {
          logger.warn('File processing task vanished after remote poll completed', {
            taskId
          })
          await this.cleanupOrphanedArtifacts(taskId)
          throw this.createAbortError(signal.reason ?? 'File processing task expired')
        }

        const task = this.getRequiredTask(taskId)
        let artifacts: FileProcessingArtifact[]

        try {
          artifacts = await this.createArtifacts(task, snapshot.output, signal)
        } catch (error) {
          const preservedTask = this.preserveTerminalTask(taskId, signal, error)

          if (preservedTask) {
            if (preservedTask.status !== 'completed') {
              await this.cleanupOrphanedArtifacts(taskId)
            }
            this.logTaskOp(preservedTask, 'cancel-preserved', {
              status: preservedTask.status
            })
            return toTaskResult(preservedTask)
          }

          if (!this.getTaskRecord(taskId)) {
            await this.cleanupOrphanedArtifacts(taskId)
            throw this.createAbortError(signal.reason ?? 'File processing task expired')
          }

          this.markFailed(taskId, error, {
            error: getFailureMessage(error)
          })

          return toTaskResult(this.getRequiredTask(taskId))
        }

        const preservedTask = this.preserveTerminalTask(taskId, signal)

        if (preservedTask) {
          if (preservedTask.status !== 'completed') {
            await this.cleanupOrphanedArtifacts(taskId)
          }
          this.logTaskOp(preservedTask, 'cancel-preserved', {
            status: preservedTask.status
          })
          return toTaskResult(preservedTask)
        }

        if (!this.getTaskRecord(taskId)) {
          await this.cleanupOrphanedArtifacts(taskId)
          throw this.createAbortError(signal.reason ?? 'File processing task expired')
        }

        this.markCompleted(taskId, artifacts, {
          artifactCount: artifacts.length
        })

        return toTaskResult(this.getRequiredTask(taskId))
      }
    }
  }

  private startRemoteExecution(
    taskId: string,
    preparedTask: PreparedRemoteTask,
    processorId: FileProcessorId,
    callerSignal?: AbortSignal
  ): void {
    const controller = new AbortController()
    let removeCallerAbortListener: (() => void) | undefined
    const promise = this.runRemoteExecutionStart(taskId, preparedTask, processorId, controller.signal)
      .catch((error) => {
        logger.error('File processing remote start failed', error as Error, {
          taskId
        })
      })
      .finally(() => {
        removeCallerAbortListener?.()
        const current = this.inFlightStarts.get(taskId)

        if (current?.promise === promise) {
          this.inFlightStarts.delete(taskId)
        }
      })

    this.inFlightStarts.set(taskId, {
      controller,
      promise
    })

    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort(this.createAbortError(callerSignal.reason))
      } else {
        const abortHandler = () => controller.abort(this.createAbortError(callerSignal.reason))
        callerSignal.addEventListener('abort', abortHandler, { once: true })
        removeCallerAbortListener = () => callerSignal.removeEventListener('abort', abortHandler)
      }
    }
  }

  private async runRemoteExecutionStart(
    taskId: string,
    preparedTask: PreparedRemoteTask,
    processorId: FileProcessorId,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const remoteStart = await preparedTask.startRemote(signal)

      if (signal.aborted) {
        throw this.createAbortError(signal.reason)
      }

      const task = this.markProcessing(taskId, {
        op: 'remote-started',
        status: remoteStart.status,
        providerTaskId: remoteStart.providerTaskId,
        remoteContext: remoteStart.remoteContext,
        remoteTask: preparedTask,
        progress: remoteStart.progress
      })

      if (!task) {
        logger.warn('Remote start succeeded but local task vanished', {
          taskId,
          processorId,
          providerTaskId: remoteStart.providerTaskId
        })
        return
      }

      if (isTerminalStatus(task.status)) {
        this.logTaskOp(task, 'cancel-preserved', {
          status: task.status,
          providerTaskId: remoteStart.providerTaskId
        })
      }
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        const abortError = this.createAbortError(signal.reason || error)
        this.markCancelled(taskId, abortError)
        return
      }

      this.markFailed(taskId, error, {
        error: getFailureMessage(error)
      })
    }
  }

  private startBackgroundExecution(
    taskId: string,
    preparedTask: PreparedBackgroundTask,
    controller: AbortController
  ): void {
    const promise = this.runBackgroundExecution(taskId, preparedTask, controller.signal)
      .catch((error) => {
        logger.error('File processing background execution failed', error as Error, {
          taskId
        })
      })
      .finally(() => {
        const current = this.backgroundExecutions.get(taskId)

        if (current?.promise === promise) {
          this.backgroundExecutions.delete(taskId)
        }
      })

    this.backgroundExecutions.set(taskId, {
      controller,
      promise
    })
  }

  private async runBackgroundExecution(
    taskId: string,
    preparedTask: PreparedBackgroundTask,
    signal: AbortSignal
  ): Promise<void> {
    let artifactsMayExist = false

    try {
      const output = await preparedTask.execute({
        signal,
        reportProgress: (progress) => {
          this.markProcessing(taskId, { op: 'background-processing', progress })
        }
      })

      if (signal.aborted) {
        throw this.createAbortError(signal.reason)
      }

      const currentTask = this.getTaskRecord(taskId)

      if (!currentTask) {
        logger.warn('File processing task vanished after background execution finished', {
          taskId
        })
        await this.cleanupOrphanedArtifacts(taskId)
        return
      }

      if (this.preserveTerminalTask(taskId, signal)) {
        return
      }

      artifactsMayExist = true
      const artifacts = await this.createArtifacts(currentTask, output, signal)

      const preservedTask = this.preserveTerminalTask(taskId, signal)

      if (preservedTask) {
        if (preservedTask.status !== 'completed') {
          await this.cleanupOrphanedArtifacts(taskId)
        }
        return
      }

      if (!this.getTaskRecord(taskId)) {
        await this.cleanupOrphanedArtifacts(taskId)
        return
      }

      this.markCompleted(taskId, artifacts, {
        artifactCount: artifacts.length
      })
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        const cancelledTask = this.markCancelled(taskId, error)

        if (artifactsMayExist && (!cancelledTask || cancelledTask.status !== 'completed')) {
          await this.cleanupOrphanedArtifacts(taskId)
        }
        return
      }

      const preservedTask = this.preserveTerminalTask(taskId, signal, error)

      if (preservedTask) {
        if (artifactsMayExist && preservedTask.status !== 'completed') {
          await this.cleanupOrphanedArtifacts(taskId)
        }
        return
      }

      if (artifactsMayExist && !this.getTaskRecord(taskId)) {
        await this.cleanupOrphanedArtifacts(taskId)
        return
      }

      this.markFailed(taskId, error, {
        error: getFailureMessage(error)
      })
    }
  }

  private markProcessing(taskId: string, input: MarkProcessingTaskInput = {}): FileProcessingTaskRecord | undefined {
    const status = input.status ?? 'processing'

    return this.transitionTask(
      taskId,
      (current) =>
        isTerminalStatus(current.status)
          ? current
          : {
              ...current,
              status,
              progress: input.progress === undefined ? current.progress : clampProgress(input.progress),
              providerTaskId: input.providerTaskId ?? current.providerTaskId,
              remoteContext: input.remoteContext ?? current.remoteContext,
              remoteTask: input.remoteTask ?? current.remoteTask,
              updatedAt: Date.now()
            },
      input.op ?? 'background-processing'
    )
  }

  private markCompleted(
    taskId: string,
    artifacts: FileProcessingArtifact[],
    extra: Record<string, unknown> = {}
  ): FileProcessingTaskRecord | undefined {
    return this.transitionTask(
      taskId,
      (current) =>
        isTerminalStatus(current.status)
          ? current
          : {
              ...current,
              status: 'completed',
              progress: 100,
              artifacts,
              error: undefined,
              updatedAt: Date.now()
            },
      'complete',
      extra
    )
  }

  private markFailed(
    taskId: string,
    error: unknown,
    extra: Record<string, unknown> = {}
  ): FileProcessingTaskRecord | undefined {
    return this.transitionTask(
      taskId,
      (current) =>
        isTerminalStatus(current.status)
          ? current
          : {
              ...current,
              status: 'failed',
              error: getFailureMessage(error),
              updatedAt: Date.now()
            },
      'fail',
      extra
    )
  }

  private markCancelled(taskId: string, reason?: unknown): FileProcessingTaskRecord | undefined {
    return this.transitionTask(
      taskId,
      (current) =>
        isTerminalStatus(current.status)
          ? current
          : {
              ...current,
              status: 'cancelled',
              reason: getCancellationReason(reason),
              updatedAt: Date.now()
            },
      'cancel',
      {
        reason: getCancellationReason(reason)
      }
    )
  }

  private preserveTerminalTask(
    taskId: string,
    signal?: AbortSignal,
    reason?: unknown
  ): FileProcessingTaskRecord | undefined {
    const current = this.getTaskRecord(taskId)

    if (!current) {
      return undefined
    }

    if (isTerminalStatus(current.status)) {
      return current
    }

    if (!signal?.aborted) {
      return undefined
    }

    return this.markCancelled(taskId, reason ?? signal.reason)
  }

  private logTaskOp(task: FileProcessingTaskRecord, op: TaskOp, extra: Record<string, unknown> = {}): void {
    logger.debug(`task[${task.taskId}] ${op}`, {
      op,
      taskId: task.taskId,
      feature: task.feature,
      processorId: task.processorId,
      status: task.status,
      progress: task.progress,
      ...extra
    })
  }

  private async createArtifacts(
    task: FileProcessingTaskRecord,
    output: FileProcessingHandlerOutput,
    signal: AbortSignal
  ): Promise<FileProcessingArtifact[]> {
    switch (output.kind) {
      case 'text':
        return [
          {
            kind: 'text',
            format: 'plain',
            text: output.text
          }
        ]

      case 'markdown':
      case 'remote-zip-url':
      case 'response-zip':
        return [
          {
            kind: 'file',
            format: 'markdown',
            path: await markdownResultStore.persistResult({
              taskId: task.taskId,
              result: output,
              signal
            })
          }
        ]
    }
  }

  private pruneExpiredTasks(now = Date.now()): void {
    const tasks = this.tasks

    if (!tasks) {
      return
    }

    const expiredTaskIds: string[] = []

    for (const [taskId, task] of tasks) {
      if (now - task.updatedAt >= FILE_PROCESSING_TASK_TTL_MS) {
        this.logTaskOp(task, 'prune', {
          expiredTaskId: taskId
        })
        this.abortTask(taskId, 'File processing task expired')
        this.markCancelled(taskId, this.createAbortError('File processing task expired'))
        tasks.delete(taskId)
        expiredTaskIds.push(taskId)
      }
    }

    if (expiredTaskIds.length > 0) {
      logger.info('Pruned expired file processing tasks', {
        expiredTaskCount: expiredTaskIds.length,
        expiredTaskIds
      })
    }
  }

  private abortTask(taskId: string, reason: string): void {
    const query = this.inFlightQueries.get(taskId)
    if (query) {
      query.controller.abort(this.createAbortError(reason))
    }

    const backgroundExecution = this.backgroundExecutions.get(taskId)
    if (backgroundExecution) {
      backgroundExecution.controller.abort(this.createAbortError(reason))
    }

    const start = this.inFlightStarts.get(taskId)
    if (start) {
      start.controller.abort(this.createAbortError(reason))
    }
  }

  private getRequiredTasks(): Map<string, FileProcessingTaskRecord> {
    if (!this.tasks) {
      throw new Error('FileProcessingTaskService is not initialized')
    }

    return this.tasks
  }

  private getTaskRecord(taskId: string): FileProcessingTaskRecord | undefined {
    return this.getRequiredTasks().get(taskId)
  }

  private getRequiredTask(taskId: string): FileProcessingTaskRecord {
    const task = this.getTaskRecord(taskId)

    if (!task) {
      throw new Error(`File processing task not found: ${taskId}`)
    }

    this.touchTask(taskId)
    return this.getRequiredTasks().get(taskId)!
  }

  private setTask(task: FileProcessingTaskRecord, op: TaskOp, extra: Record<string, unknown> = {}): void {
    this.getRequiredTasks().set(task.taskId, task)
    this._onTaskChanged.fire(toTaskResult(task))
    this.logTaskOp(task, op, extra)
  }

  private transitionTask(
    taskId: string,
    updater: (current: FileProcessingTaskRecord) => FileProcessingTaskRecord,
    op: TaskOp,
    extra: Record<string, unknown> = {}
  ): FileProcessingTaskRecord | undefined {
    const current = this.getTaskRecord(taskId)

    if (!current) {
      logger.warn('File processing task transition skipped because task record is missing', {
        taskId,
        op
      })
      return undefined
    }

    const next = updater(current)

    if (next === current) {
      return current
    }

    this.setTask(next, op, extra)
    return next
  }

  private async cleanupOrphanedArtifacts(taskId: string): Promise<void> {
    const cleaned = await cleanupFileProcessingResultsDir(taskId)

    if (cleaned) {
      logger.warn('Cleaned up orphaned file processing artifacts after terminal state changed', {
        taskId
      })
    }
  }

  private touchTask(taskId: string): void {
    const task = this.getTaskRecord(taskId)

    if (!task) {
      return
    }

    task.updatedAt = Date.now()
    this.getRequiredTasks().set(taskId, task)
  }

  private withCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return promise
    }

    if (signal.aborted) {
      return Promise.reject(this.createAbortError(signal.reason))
    }

    return new Promise<T>((resolve, reject) => {
      const abortHandler = () => reject(this.createAbortError(signal.reason))

      signal.addEventListener('abort', abortHandler, { once: true })

      void promise.then(
        (value) => {
          signal.removeEventListener('abort', abortHandler)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abortHandler)
          reject(error)
        }
      )
    })
  }

  private createAbortError(reason: unknown): Error {
    if (reason instanceof Error && reason.name === 'AbortError') {
      return reason
    }

    if (reason instanceof Error) {
      const error = new Error(reason.message)
      error.name = 'AbortError'
      return error
    }

    const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
    error.name = 'AbortError'
    return error
  }
}

function toTaskStartResult(record: FileProcessingTaskRecord): FileProcessingTaskStartResult {
  return {
    taskId: record.taskId,
    feature: record.feature,
    status: record.status === 'pending' ? 'pending' : 'processing',
    progress: record.progress,
    processorId: record.processorId
  }
}

function toTaskResult(record: FileProcessingTaskRecord): FileProcessingTaskResult {
  const base = {
    taskId: record.taskId,
    feature: record.feature,
    processorId: record.processorId,
    progress: record.progress
  }

  switch (record.status) {
    case 'pending':
      return {
        ...base,
        status: 'pending'
      }
    case 'processing':
      return {
        ...base,
        status: 'processing'
      }
    case 'completed':
      if (!record.artifacts?.length) {
        throw new Error(`File processing task ${record.taskId} is completed without artifacts`)
      }

      return {
        ...base,
        status: 'completed',
        progress: 100,
        artifacts: record.artifacts
      }
    case 'failed':
      return {
        ...base,
        status: 'failed',
        error: record.error || 'File processing failed'
      }
    case 'cancelled':
      return {
        ...base,
        status: 'cancelled',
        reason: record.reason
      }
  }
}

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)))
}

function isTerminalStatus(status: FileProcessingTaskStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function isSupportedFileType(
  fileType: FileType,
  inputs: readonly FileProcessorInput[]
): fileType is FileProcessorInput {
  return inputs.includes(fileType as FileProcessorInput)
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getFailureMessage(error: unknown): string {
  return getErrorMessage(error) || 'File processing failed'
}

function getCancellationReason(reason: unknown): string {
  if (reason === undefined) {
    return 'cancelled'
  }

  return getErrorMessage(reason) || 'cancelled'
}
