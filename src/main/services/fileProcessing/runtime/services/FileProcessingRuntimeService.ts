import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

const logger = loggerService.withContext('FileProcessingRuntimeService')
export const FILE_PROCESSING_TASK_TTL_MS = 10 * 60 * 1000
export const FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS = 5 * 60 * 1000

interface FileProcessingTaskEntry<TState> {
  processorId: FileProcessorId
  state: TState
  createdAt: number
  updatedAt: number
}

@Injectable('FileProcessingRuntimeService')
@ServicePhase(Phase.BeforeReady)
export class FileProcessingRuntimeService extends BaseService {
  private tasks: Map<string, FileProcessingTaskEntry<unknown>> | null = null
  private pruneTimer: NodeJS.Timeout | null = null

  protected async onInit(): Promise<void> {
    this.tasks = new Map()
    this.startPruneTimer()

    logger.info('FileProcessingRuntimeService initialized')
  }

  protected async onStop(): Promise<void> {
    if (!this.tasks) {
      return
    }

    this.tasks.clear()

    logger.debug('FileProcessingRuntimeService cleanup completed')
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

      this.tasks = null
    })
  }

  createTask<TState>(processorId: FileProcessorId, providerTaskId: string, state: TState): TState {
    const tasks = this.getRequiredTasks()
    const key = this.buildTaskKey(processorId, providerTaskId)
    const now = Date.now()

    tasks.set(key, {
      processorId,
      state,
      createdAt: now,
      updatedAt: now
    })

    logger.debug('Created file processing task state', {
      processorId,
      providerTaskId
    })

    return state
  }

  getTask<TState>(processorId: FileProcessorId, providerTaskId: string): TState | undefined {
    const tasks = this.getRequiredTasks()
    const key = this.buildTaskKey(processorId, providerTaskId)
    const now = Date.now()
    const task = this.getTaskIfFresh<TState>(key, now)

    if (!task) {
      logger.debug('File processing task state not found', {
        processorId,
        providerTaskId
      })
      return undefined
    }

    tasks.set(key, {
      processorId: task.processorId,
      state: task.state,
      createdAt: task.createdAt,
      updatedAt: now
    })

    return task.state
  }

  updateTask<TState>(
    processorId: FileProcessorId,
    providerTaskId: string,
    updater: (current: TState) => TState
  ): TState {
    const tasks = this.getRequiredTasks()
    const key = this.buildTaskKey(processorId, providerTaskId)
    const current = this.getTaskIfFresh<TState>(key)

    if (!current) {
      throw new Error(`File processing task not found for ${processorId}:${providerTaskId}`)
    }

    const nextState = updater(current.state)

    tasks.set(key, {
      processorId,
      state: nextState,
      createdAt: current.createdAt,
      updatedAt: Date.now()
    })

    logger.debug('Updated file processing task state', {
      processorId,
      providerTaskId
    })

    return nextState
  }

  deleteTask(processorId: FileProcessorId, providerTaskId: string): boolean {
    const tasks = this.getRequiredTasks()
    const key = this.buildTaskKey(processorId, providerTaskId)
    const task = this.getTaskIfFresh(key)

    if (!task) {
      logger.debug('Deleted file processing task state', {
        processorId,
        providerTaskId,
        deleted: false
      })
      return false
    }

    const deleted = tasks.delete(key)

    logger.debug('Deleted file processing task state', {
      processorId,
      providerTaskId,
      deleted
    })

    return deleted
  }

  clearTasks(): void {
    this.getRequiredTasks().clear()
  }

  private getRequiredTasks(): Map<string, FileProcessingTaskEntry<unknown>> {
    if (!this.tasks) {
      throw new Error('FileProcessingRuntimeService is not initialized')
    }

    return this.tasks
  }

  private buildTaskKey(processorId: FileProcessorId, providerTaskId: string): string {
    return `${processorId}:${providerTaskId}`
  }

  private pruneExpiredTasks(now = Date.now()): void {
    const tasks = this.getRequiredTasks()
    const expiredTasks: string[] = []

    for (const [key, task] of tasks) {
      if (now - task.updatedAt >= FILE_PROCESSING_TASK_TTL_MS) {
        tasks.delete(key)
        expiredTasks.push(key)
      }
    }

    if (expiredTasks.length > 0) {
      logger.debug('Pruned expired file processing task state', {
        expiredTaskCount: expiredTasks.length,
        expiredTasks
      })
    }
  }

  private getTaskIfFresh<TState>(key: string, now = Date.now()): FileProcessingTaskEntry<TState> | undefined {
    const tasks = this.getRequiredTasks()
    const task = tasks.get(key) as FileProcessingTaskEntry<TState> | undefined

    if (!task) {
      return undefined
    }

    if (now - task.updatedAt < FILE_PROCESSING_TASK_TTL_MS) {
      return task
    }

    tasks.delete(key)
    logger.debug('Pruned expired file processing task state on access', {
      expiredTask: key
    })
    return undefined
  }
}
