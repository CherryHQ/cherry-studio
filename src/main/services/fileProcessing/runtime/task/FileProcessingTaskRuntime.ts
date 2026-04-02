import { loggerService } from '@logger'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'

export const FILE_PROCESSING_TASK_TTL_MS = 60 * 60 * 1000
export const FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS = 5 * 60 * 1000

const logger = loggerService.withContext('FileProcessingRuntimeService')

interface FileProcessingTaskEntry<TState> {
  processorId: FileProcessorId
  state: TState
  createdAt: number
  updatedAt: number
}

export class FileProcessingTaskRuntime {
  private readonly tasks = new Map<string, FileProcessingTaskEntry<unknown>>()
  private readonly pruneTimer?: NodeJS.Timeout

  constructor(options?: { autoPruneIntervalMs?: number }) {
    if (options?.autoPruneIntervalMs) {
      this.pruneTimer = setInterval(() => {
        this.pruneExpiredTasks()
      }, options.autoPruneIntervalMs)
      this.pruneTimer.unref?.()
    }
  }

  create<TState>(processorId: FileProcessorId, providerTaskId: string, state: TState): TState {
    const key = `${processorId}:${providerTaskId}`
    const now = Date.now()

    this.tasks.set(key, {
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

  get<TState>(processorId: FileProcessorId, providerTaskId: string): TState | undefined {
    const key = `${processorId}:${providerTaskId}`
    const now = Date.now()
    const task = this.getTaskIfFresh<TState>(key, now)

    if (!task) {
      logger.debug('File processing task state not found', {
        processorId,
        providerTaskId
      })
      return undefined
    }

    this.tasks.set(key, {
      processorId: task.processorId,
      state: task.state,
      createdAt: task.createdAt,
      updatedAt: now
    })

    return task.state
  }

  update<TState>(processorId: FileProcessorId, providerTaskId: string, updater: (current: TState) => TState): TState {
    const key = `${processorId}:${providerTaskId}`
    const current = this.getTaskIfFresh<TState>(key)

    if (!current) {
      throw new Error(`File processing task not found for ${processorId}:${providerTaskId}`)
    }

    const nextState = updater(current.state)

    this.tasks.set(key, {
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

  delete(processorId: FileProcessorId, providerTaskId: string): boolean {
    const key = `${processorId}:${providerTaskId}`
    const task = this.getTaskIfFresh(key)

    if (!task) {
      logger.debug('Deleted file processing task state', {
        processorId,
        providerTaskId,
        deleted: false
      })
      return false
    }

    const deleted = this.tasks.delete(key)

    logger.debug('Deleted file processing task state', {
      processorId,
      providerTaskId,
      deleted
    })

    return deleted
  }

  clear(): void {
    this.tasks.clear()
    logger.debug('Cleared all file processing task state')
  }

  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer)
    }
  }

  get size(): number {
    return this.tasks.size
  }

  private pruneExpiredTasks(now = Date.now()): void {
    const expiredTasks: string[] = []

    for (const [key, task] of this.tasks) {
      if (now - task.updatedAt >= FILE_PROCESSING_TASK_TTL_MS) {
        this.tasks.delete(key)
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
    const task = this.tasks.get(key) as FileProcessingTaskEntry<TState> | undefined

    if (!task) {
      return undefined
    }

    if (now - task.updatedAt < FILE_PROCESSING_TASK_TTL_MS) {
      return task
    }

    this.tasks.delete(key)
    logger.debug('Pruned expired file processing task state on access', {
      expiredTask: key
    })
    return undefined
  }
}
