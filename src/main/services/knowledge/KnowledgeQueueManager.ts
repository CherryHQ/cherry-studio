import { loggerService } from '@logger'
import PQueue from 'p-queue'

import { MAX_WORKLOAD } from './vectorstores/types'

const logger = loggerService.withContext('KnowledgeQueueManager')

type QueueStatus = {
  queueSize: number
  processingCount: number
  currentWorkload: number
}

export class KnowledgeQueueManager {
  private queue: PQueue
  private controllers = new Map<string, AbortController>()
  private pendingWorkloads = new Map<string, number>()
  private processingWorkloads = new Map<string, number>()
  private readonly maxWorkload: number

  constructor(config?: { concurrency?: number; maxWorkload?: number }) {
    this.queue = new PQueue({ concurrency: config?.concurrency ?? 1 })
    this.maxWorkload = config?.maxWorkload ?? MAX_WORKLOAD
  }

  enqueue<T>(id: string, workload: number, task: (signal: AbortSignal) => Promise<T>): Promise<T | void> {
    if (this.controllers.has(id)) {
      logger.debug('Task already enqueued, skipping', { id })
      return Promise.reject(new Error(`Task ${id} already enqueued`))
    }

    const controller = new AbortController()
    this.controllers.set(id, controller)
    this.pendingWorkloads.set(id, workload)

    if (workload > this.maxWorkload) {
      logger.warn('Task workload exceeds max workload', { id, workload, maxWorkload: this.maxWorkload })
    }

    return this.queue
      .add(
        async ({ signal }) => {
          this.pendingWorkloads.delete(id)
          this.processingWorkloads.set(id, workload)
          try {
            return await task(signal ?? controller.signal)
          } finally {
            this.processingWorkloads.delete(id)
          }
        },
        { id, signal: controller.signal }
      )
      .finally(() => {
        this.pendingWorkloads.delete(id)
        this.processingWorkloads.delete(id)
        this.controllers.delete(id)
      })
  }

  cancel(id: string): { status: 'cancelled' | 'ignored' } {
    const controller = this.controllers.get(id)
    if (!controller) {
      return { status: 'ignored' }
    }

    controller.abort()
    return { status: 'cancelled' }
  }

  isQueued(id: string): boolean {
    return this.pendingWorkloads.has(id)
  }

  isProcessing(id: string): boolean {
    return this.processingWorkloads.has(id)
  }

  getStatus(): QueueStatus {
    return {
      queueSize: this.queue.size,
      processingCount: this.queue.pending,
      currentWorkload: this.getCurrentWorkload()
    }
  }

  private getCurrentWorkload(): number {
    let total = 0
    for (const workload of this.processingWorkloads.values()) {
      total += workload
    }
    return total
  }
}

export const knowledgeQueueManager = new KnowledgeQueueManager()
