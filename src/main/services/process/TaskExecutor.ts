import { loggerService } from '@logger'

import type { ProcessManagerService } from './ProcessManagerService'
import type { UtilityProcessHandle } from './UtilityProcessHandle'

export interface TaskExecutorOptions {
  id: string
  modulePath: string
  max: number
  idleTimeoutMs?: number
  env?: Record<string, string>
  killTimeoutMs?: number
}

interface PendingTask<T = unknown> {
  taskId: string
  taskType: string
  payload: unknown
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

interface WorkerEntry {
  handle: UtilityProcessHandle
  busy: boolean
  idleTimer: ReturnType<typeof setTimeout> | undefined
  cleanup: () => void
}

interface TaskResponse {
  taskId: string
  result?: unknown
  error?: string
}

export class TaskExecutor {
  readonly id: string

  private readonly pm: ProcessManagerService
  private readonly options: Required<TaskExecutorOptions>
  private readonly logger: ReturnType<typeof loggerService.withContext>

  private readonly workers = new Map<string, WorkerEntry>()
  private readonly pendingTasks = new Map<string, PendingTask>()
  private readonly taskQueue: PendingTask[] = []

  private workerCounter = 0
  private shuttingDown = false

  constructor(pm: ProcessManagerService, options: TaskExecutorOptions) {
    this.id = options.id
    this.pm = pm
    this.options = {
      idleTimeoutMs: 30_000,
      env: {},
      killTimeoutMs: 5_000,
      ...options
    }
    this.logger = loggerService.withContext(`TaskExecutor:${options.id}`)
  }

  async exec<T>(taskType: string, payload: unknown): Promise<T> {
    if (this.shuttingDown) {
      throw new Error(`TaskExecutor '${this.id}' is shutting down`)
    }

    const taskId = `${this.id}-task-${Date.now()}-${Math.random().toString(36).slice(2)}`

    return new Promise<T>((resolve, reject) => {
      const task: PendingTask<T> = {
        taskId,
        taskType,
        payload,
        resolve,
        reject
      }

      this.taskQueue.push(task as PendingTask)
      this.logger.debug(`Queued task ${taskId} (type=${taskType})`)

      this.dispatch()
    })
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) {
      return
    }

    this.shuttingDown = true
    this.logger.info(`Shutting down TaskExecutor '${this.id}'`)

    // Reject all queued tasks
    const shutdownError = new Error(`TaskExecutor '${this.id}' shut down`)
    for (const task of this.taskQueue.splice(0)) {
      task.reject(shutdownError)
    }

    // Reject all in-flight tasks
    for (const task of this.pendingTasks.values()) {
      task.reject(shutdownError)
    }
    this.pendingTasks.clear()

    // Stop and unregister all workers
    await Promise.all(
      Array.from(this.workers.entries()).map(async ([workerId, entry]) => {
        clearTimeout(entry.idleTimer)
        entry.cleanup()
        try {
          await entry.handle.stop()
        } catch (err) {
          this.logger.error(`Failed to stop worker '${workerId}'`, err as Error)
        }
        try {
          this.pm.unregister(workerId)
        } catch (err) {
          this.logger.error(`Failed to unregister worker '${workerId}'`, err as Error)
        }
      })
    )

    this.workers.clear()
    this.logger.info(`TaskExecutor '${this.id}' shut down complete`)
  }

  private dispatch(): void {
    if (this.taskQueue.length === 0) {
      return
    }

    // Find an idle worker
    for (const [, entry] of this.workers) {
      if (!entry.busy) {
        this.assignTask(entry)
        return
      }
    }

    // Spawn a new worker if under the limit
    if (this.workers.size < this.options.max) {
      this.spawnWorker()
        .then(() => {
          // After spawning, find the newly idle worker and assign
          for (const [, entry] of this.workers) {
            if (!entry.busy) {
              this.assignTask(entry)
              return
            }
          }
        })
        .catch((err: unknown) => {
          this.logger.error('Failed to spawn worker', err as Error)
        })
    }
    // Otherwise task stays queued until a worker finishes
  }

  private assignTask(entry: WorkerEntry): void {
    if (this.taskQueue.length === 0) {
      return
    }

    const task = this.taskQueue.shift()!
    entry.busy = true

    // Cancel idle timer
    if (entry.idleTimer !== undefined) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = undefined
    }

    this.pendingTasks.set(task.taskId, task)
    this.logger.debug(`Assigning task ${task.taskId} to worker '${entry.handle.id}'`)

    entry.handle.postMessage({ taskId: task.taskId, taskType: task.taskType, payload: task.payload })
  }

  private async spawnWorker(): Promise<WorkerEntry> {
    const workerId = `${this.id}-worker-${this.workerCounter++}`
    this.logger.info(`Spawning worker '${workerId}'`)

    const handle = this.pm.register({
      type: 'utility',
      id: workerId,
      modulePath: this.options.modulePath,
      env: this.options.env,
      killTimeoutMs: this.options.killTimeoutMs
    })

    const cleanup = handle.onMessage((message: unknown) => {
      this.handleWorkerMessage(workerId, message as TaskResponse)
    })

    const entry: WorkerEntry = {
      handle,
      busy: false,
      idleTimer: undefined,
      cleanup
    }

    this.workers.set(workerId, entry)

    await handle.start()
    this.logger.info(`Worker '${workerId}' started (pid=${handle.pid})`)

    return entry
  }

  private handleWorkerMessage(workerId: string, message: TaskResponse): void {
    const { taskId, result, error } = message

    const task = this.pendingTasks.get(taskId)
    if (!task) {
      this.logger.warn(`Received response for unknown taskId '${taskId}' from worker '${workerId}'`)
      return
    }

    this.pendingTasks.delete(taskId)

    const entry = this.workers.get(workerId)
    if (entry) {
      entry.busy = false
      this.scheduleIdleTimeout(workerId, entry)
    }

    if (error !== undefined) {
      this.logger.debug(`Task ${taskId} failed: ${error}`)
      task.reject(new Error(error))
    } else {
      this.logger.debug(`Task ${taskId} completed successfully`)
      task.resolve(result)
    }

    // Try to dispatch next queued task
    this.dispatch()
  }

  private scheduleIdleTimeout(workerId: string, entry: WorkerEntry): void {
    if (this.shuttingDown) {
      return
    }

    entry.idleTimer = setTimeout(() => {
      const current = this.workers.get(workerId)
      if (!current || current.busy) {
        return
      }

      this.logger.info(`Worker '${workerId}' idle timeout reached, stopping`)
      current.cleanup()
      this.workers.delete(workerId)

      current.handle
        .stop()
        .then(() => {
          try {
            this.pm.unregister(workerId)
          } catch (err) {
            this.logger.error(`Failed to unregister idle worker '${workerId}'`, err as Error)
          }
        })
        .catch((err: unknown) => {
          this.logger.error(`Failed to stop idle worker '${workerId}'`, err as Error)
        })
    }, this.options.idleTimeoutMs)
  }
}
