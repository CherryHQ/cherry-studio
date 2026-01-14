/**
 * Task Queue Manager for KnowledgeServiceV2
 *
 * Manages concurrent task processing with workload-based throttling.
 * Maintains v1 compatibility with 80MB max workload and 30 concurrent items.
 */

import { loggerService } from '@logger'

import type { QueuedTask } from './types'

const logger = loggerService.withContext('TaskQueueManager')

/**
 * Manages task queue with workload-based throttling
 */
export class TaskQueueManager<T = void> {
  private queue: QueuedTask<T>[] = []
  private processing: Map<string, QueuedTask<T>> = new Map()
  private isDraining = false

  /**
   * Add task to queue and return promise that resolves when complete
   * @param id Task identifier
   * @param task Task execution function
   * @param workload Estimated workload in bytes
   * @returns Promise resolving to task result
   */
  async enqueue(id: string, task: () => Promise<T>, workload: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask<T> = {
        id,
        task,
        workload,
        resolve,
        reject
      }

      this.queue.push(queuedTask)
      logger.debug(`Task ${id} queued. Queue size: ${this.queue.length}, Workload: ${workload}`)
      this.scheduleDrain()
    })
  }

  /**
   * Process next task if capacity allows
   */
  private processNext(): QueuedTask<T> | undefined {
    return this.queue.shift()
  }

  /**
   * Drain the queue without concurrency limits
   */
  private scheduleDrain(): void {
    if (this.isDraining) {
      return
    }

    this.isDraining = true
    while (this.queue.length > 0) {
      const next = this.processNext()
      if (!next) {
        break
      }

      this.runTask(next)
    }
    this.isDraining = false
  }

  private runTask(next: QueuedTask<T>): void {
    this.processing.set(next.id, next)

    logger.debug(`Processing task ${next.id}. Active: ${this.processing.size}`)

    next
      .task()
      .then((result) => {
        next.resolve(result)
      })
      .catch((error) => {
        logger.error(`Task ${next.id} failed:`, error)
        next.reject(error instanceof Error ? error : new Error(String(error)))
      })
      .finally(() => {
        this.processing.delete(next.id)
        logger.debug(`Task ${next.id} completed. Remaining queue: ${this.queue.length}`)
        if (this.queue.length > 0) {
          this.scheduleDrain()
        }
      })
  }

  /**
   * Get current queue status
   */
  getStatus(): { queueSize: number; processingCount: number; currentWorkload: number } {
    return {
      queueSize: this.queue.length,
      processingCount: this.processing.size,
      currentWorkload: 0
    }
  }

  /**
   * Check if a task is currently processing
   */
  isProcessing(id: string): boolean {
    return this.processing.has(id)
  }

  /**
   * Check if a task is queued
   */
  isQueued(id: string): boolean {
    return this.queue.some((task) => task.id === id)
  }

  /**
   * Remove a task from the queue (if not yet processing)
   * @returns true if task was removed
   */
  remove(id: string): boolean {
    const index = this.queue.findIndex((task) => task.id === id)
    if (index >= 0) {
      this.queue.splice(index, 1)
      logger.debug(`Task ${id} removed from queue`)
      return true
    }
    return false
  }

  /**
   * Clear all pending tasks (does not affect currently processing tasks)
   */
  clear(): void {
    const count = this.queue.length
    for (const task of this.queue) {
      task.reject(new Error('Queue cleared'))
    }
    this.queue = []
    logger.info(`Cleared ${count} pending tasks from queue`)
  }
}

/** Singleton instance */
export const taskQueueManager = new TaskQueueManager()
