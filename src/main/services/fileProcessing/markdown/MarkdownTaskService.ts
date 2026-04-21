import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { v4 as uuidv4 } from 'uuid'

import { resolveProcessorConfigByFeature } from '../config/resolveProcessorConfig'
import type { GetMarkdownConversionTaskResultInput, StartMarkdownConversionTaskInput } from '../types'
import { createMarkdownProvider } from './createMarkdownProvider'
import { markdownResultStore } from './MarkdownResultStore'
import type {
  MarkdownBackgroundTaskProvider,
  MarkdownProviderPollResult,
  MarkdownRemoteTaskProvider,
  MarkdownTaskRecord
} from './types'
import { toTaskResult, toTaskStartResult } from './types'

const logger = loggerService.withContext('MarkdownTaskService')

export const FILE_PROCESSING_TASK_TTL_MS = 10 * 60 * 1000
export const FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS = 5 * 60 * 1000

interface InFlightQuery {
  controller: AbortController
  promise: Promise<ReturnType<typeof toTaskResult>>
}

interface BackgroundExecution {
  controller: AbortController
  promise: Promise<void>
}

@Injectable('MarkdownTaskService')
@ServicePhase(Phase.WhenReady)
export class MarkdownTaskService extends BaseService {
  private tasks: Map<string, MarkdownTaskRecord> | null = null
  private pruneTimer: NodeJS.Timeout | null = null
  private readonly inFlightQueries = new Map<string, InFlightQuery>()
  private readonly backgroundExecutions = new Map<string, BackgroundExecution>()

  protected async onInit(): Promise<void> {
    this.tasks = new Map()
    this.startPruneTimer()

    logger.info('MarkdownTaskService initialized')
  }

  protected async onStop(): Promise<void> {
    const inFlightQueries = Array.from(this.inFlightQueries.values())
    const backgroundExecutions = Array.from(this.backgroundExecutions.values())

    for (const query of inFlightQueries) {
      query.controller.abort(this.createAbortError('Markdown task service is stopping'))
    }

    for (const execution of backgroundExecutions) {
      execution.controller.abort(this.createAbortError('Markdown task service is stopping'))
    }

    await Promise.allSettled([
      ...inFlightQueries.map((query) => query.promise),
      ...backgroundExecutions.map((execution) => execution.promise)
    ])

    this.inFlightQueries.clear()
    this.backgroundExecutions.clear()
    this.tasks?.clear()
    this.tasks = null

    logger.debug('MarkdownTaskService cleanup completed', {
      abortedQueryCount: inFlightQueries.length,
      abortedExecutionCount: backgroundExecutions.length
    })
  }

  async startTask({
    file,
    processorId,
    signal
  }: StartMarkdownConversionTaskInput): Promise<ReturnType<typeof toTaskStartResult>> {
    const resolvedConfig = resolveProcessorConfigByFeature('markdown_conversion', processorId)
    const provider = createMarkdownProvider(resolvedConfig.id)
    const taskId = uuidv4()

    logger.debug('Starting markdown conversion task', {
      taskId,
      processorId: resolvedConfig.id,
      fileId: file.id,
      providerMode: provider.mode
    })

    if (provider.mode === 'remote-poll') {
      const startedTask = await provider.startTask(file, resolvedConfig, signal)
      const now = Date.now()
      const taskRecord: MarkdownTaskRecord = {
        taskId,
        processorId: resolvedConfig.id,
        providerTaskId: startedTask.providerTaskId,
        fileId: file.id,
        status: startedTask.status,
        progress: clampProgress(startedTask.progress),
        queryContext: startedTask.queryContext,
        createdAt: now,
        updatedAt: now
      }

      this.setTask(taskRecord)
      return toTaskStartResult(taskRecord)
    }

    const startedTask = await provider.startTask(file, resolvedConfig, signal)
    const now = Date.now()
    const taskRecord: MarkdownTaskRecord = {
      taskId,
      processorId: resolvedConfig.id,
      providerTaskId: startedTask.providerTaskId,
      fileId: file.id,
      status: startedTask.status,
      progress: clampProgress(startedTask.progress),
      createdAt: now,
      updatedAt: now
    }

    this.setTask(taskRecord)
    this.startBackgroundExecution(taskRecord, provider, file, resolvedConfig)

    return toTaskStartResult(taskRecord)
  }

  async getTaskResult({ taskId, signal }: GetMarkdownConversionTaskResultInput) {
    signal?.throwIfAborted()

    const task = this.getRequiredTask(taskId)

    if (task.status === 'completed' || task.status === 'failed') {
      return toTaskResult(task)
    }

    const provider = createMarkdownProvider(task.processorId)

    if (provider.mode === 'background') {
      this.touchTask(taskId)
      return toTaskResult(this.getRequiredTask(taskId))
    }

    return this.runDedupedQuery(taskId, provider, signal)
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

  private runDedupedQuery(
    taskId: string,
    provider: MarkdownRemoteTaskProvider,
    callerSignal?: AbortSignal
  ): Promise<ReturnType<typeof toTaskResult>> {
    const existingQuery = this.inFlightQueries.get(taskId)

    if (existingQuery) {
      return this.withCallerAbort(existingQuery.promise, callerSignal)
    }

    const controller = new AbortController()
    const promise = this.queryTask(taskId, provider, controller.signal).finally(() => {
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

  private async queryTask(
    taskId: string,
    provider: MarkdownRemoteTaskProvider,
    signal: AbortSignal
  ): Promise<ReturnType<typeof toTaskResult>> {
    const task = this.getRequiredTask(taskId)

    if (!task.queryContext) {
      throw new Error(`Markdown task ${taskId} is missing query context`)
    }

    const pollResult = await provider.pollTask(
      {
        providerTaskId: task.providerTaskId,
        queryContext: task.queryContext
      },
      signal
    )

    return this.applyRemotePollResult(taskId, pollResult, signal)
  }

  private async applyRemotePollResult(
    taskId: string,
    pollResult: MarkdownProviderPollResult,
    signal: AbortSignal
  ): Promise<ReturnType<typeof toTaskResult>> {
    switch (pollResult.status) {
      case 'pending':
      case 'processing': {
        this.updateTask(taskId, (current) => ({
          ...current,
          status: pollResult.status,
          progress: clampProgress(pollResult.progress),
          queryContext: pollResult.queryContext ?? current.queryContext,
          updatedAt: Date.now()
        }))

        return toTaskResult(this.getRequiredTask(taskId))
      }

      case 'failed': {
        this.updateTask(taskId, (current) => ({
          ...current,
          status: 'failed',
          progress: 0,
          error: pollResult.error,
          updatedAt: Date.now()
        }))

        return toTaskResult(this.getRequiredTask(taskId))
      }

      case 'completed': {
        const task = this.getRequiredTask(taskId)
        const markdownPath = await markdownResultStore.persistResult({
          fileId: task.fileId,
          taskId,
          result: pollResult.result,
          signal
        })

        this.updateTask(taskId, (current) => ({
          ...current,
          status: 'completed',
          progress: 100,
          markdownPath,
          error: undefined,
          updatedAt: Date.now()
        }))

        return toTaskResult(this.getRequiredTask(taskId))
      }
    }
  }

  private startBackgroundExecution(
    task: MarkdownTaskRecord,
    provider: MarkdownBackgroundTaskProvider,
    file: StartMarkdownConversionTaskInput['file'],
    config: ReturnType<typeof resolveProcessorConfigByFeature>
  ): void {
    const controller = new AbortController()
    const promise = this.runBackgroundExecution(task.taskId, provider, file, config, controller.signal)
      .catch((error) => {
        logger.error('Markdown background execution failed', error as Error, {
          taskId: task.taskId,
          processorId: task.processorId
        })
      })
      .finally(() => {
        const current = this.backgroundExecutions.get(task.taskId)

        if (current?.promise === promise) {
          this.backgroundExecutions.delete(task.taskId)
        }
      })

    this.backgroundExecutions.set(task.taskId, {
      controller,
      promise
    })
  }

  private async runBackgroundExecution(
    taskId: string,
    provider: MarkdownBackgroundTaskProvider,
    file: StartMarkdownConversionTaskInput['file'],
    config: ReturnType<typeof resolveProcessorConfigByFeature>,
    signal: AbortSignal
  ): Promise<void> {
    try {
      const result = await provider.executeTask(file, config, {
        signal,
        reportProgress: (progress) => {
          this.tryUpdateTask(taskId, (current) => ({
            ...current,
            status: 'processing',
            progress: clampProgress(progress),
            updatedAt: Date.now()
          }))
        }
      })

      const currentTask = this.getTask(taskId)

      if (!currentTask) {
        return
      }

      const markdownPath = await markdownResultStore.persistResult({
        fileId: currentTask.fileId,
        taskId,
        result,
        signal
      })

      this.tryUpdateTask(taskId, (current) => ({
        ...current,
        status: 'completed',
        progress: 100,
        markdownPath,
        error: undefined,
        updatedAt: Date.now()
      }))
    } catch (error) {
      this.tryUpdateTask(taskId, (current) => ({
        ...current,
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: Date.now()
      }))
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
        this.abortTask(taskId, 'Markdown task expired')
        tasks.delete(taskId)
        expiredTaskIds.push(taskId)
      }
    }

    if (expiredTaskIds.length > 0) {
      logger.debug('Pruned expired markdown tasks', {
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
  }

  private getRequiredTasks(): Map<string, MarkdownTaskRecord> {
    if (!this.tasks) {
      throw new Error('MarkdownTaskService is not initialized')
    }

    return this.tasks
  }

  private getTask(taskId: string): MarkdownTaskRecord | undefined {
    return this.getRequiredTasks().get(taskId)
  }

  private getRequiredTask(taskId: string): MarkdownTaskRecord {
    const task = this.getTask(taskId)

    if (!task) {
      throw new Error(`Markdown task not found: ${taskId}`)
    }

    this.touchTask(taskId)

    return this.getRequiredTasks().get(taskId)!
  }

  private setTask(task: MarkdownTaskRecord): void {
    this.getRequiredTasks().set(task.taskId, task)
  }

  private updateTask(taskId: string, updater: (current: MarkdownTaskRecord) => MarkdownTaskRecord): MarkdownTaskRecord {
    const current = this.getTask(taskId)

    if (!current) {
      throw new Error(`Markdown task not found: ${taskId}`)
    }

    const next = updater(current)
    this.setTask(next)
    return next
  }

  private tryUpdateTask(taskId: string, updater: (current: MarkdownTaskRecord) => MarkdownTaskRecord): void {
    if (!this.getTask(taskId)) {
      return
    }

    this.updateTask(taskId, updater)
  }

  private touchTask(taskId: string): void {
    const task = this.getTask(taskId)

    if (!task) {
      return
    }

    task.updatedAt = Date.now()
    this.setTask(task)
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

function clampProgress(progress: number): number {
  return Math.min(100, Math.max(0, Math.round(progress)))
}
