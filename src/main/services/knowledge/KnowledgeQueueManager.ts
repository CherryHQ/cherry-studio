import { loggerService } from '@logger'
import PQueue from 'p-queue'

const logger = loggerService.withContext('KnowledgeQueueManager')

type QueueStatus = {
  queueSize: number
  processingCount: number
}

export class KnowledgeQueueManager {
  private queue: PQueue
  private controllers = new Map<string, AbortController>()
  private processingIds = new Set<string>()

  constructor(config?: { concurrency?: number }) {
    this.queue = new PQueue({ concurrency: config?.concurrency ?? 1 })
  }

  async enqueue<T>(id: string, task: (signal: AbortSignal) => Promise<T>): Promise<T | void> {
    if (this.controllers.has(id)) {
      logger.debug('Task already enqueued, skipping', { id })
      return Promise.reject(new Error(`Task ${id} already enqueued`))
    }

    const controller = new AbortController()
    this.controllers.set(id, controller)

    return this.queue
      .add(
        async ({ signal }) => {
          this.processingIds.add(id)
          try {
            return await task(signal ?? controller.signal)
          } finally {
            this.processingIds.delete(id)
          }
        },
        { id, signal: controller.signal }
      )
      .finally(() => {
        this.processingIds.delete(id)
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
    return this.controllers.has(id) && !this.processingIds.has(id)
  }

  isProcessing(id: string): boolean {
    return this.processingIds.has(id)
  }

  getStatus(): QueueStatus {
    return {
      queueSize: this.queue.size,
      processingCount: this.queue.pending
    }
  }
}

export const knowledgeQueueManager = new KnowledgeQueueManager()
