/**
 * Task Queue Manager for KnowledgeServiceV2
 *
 * Manages concurrent task processing with workload-based throttling.
 * Maintains v1 compatibility with 80MB max workload and 30 concurrent items.
 */

import { loggerService } from '@logger'
import type { LoaderReturn } from '@shared/config/types'

import { MAX_CONCURRENT, MAX_WORKLOAD, type QueuedTask } from './types'

const logger = loggerService.withContext('TaskQueueManager')

/**
 * Manages task queue with workload-based throttling
 */
export class TaskQueueManager {
  private queue: QueuedTask[] = []
  private processing: Map<string, QueuedTask> = new Map()
  private currentWorkload = 0
  private readonly maxWorkload: number
  private readonly maxConcurrent: number

  constructor(config?: { maxWorkload?: number; maxConcurrent?: number }) {
    this.maxWorkload = config?.maxWorkload ?? MAX_WORKLOAD
    this.maxConcurrent = config?.maxConcurrent ?? MAX_CONCURRENT
  }

  /**
   * Add task to queue and return promise that resolves when complete
   * @param id Task identifier
   * @param task Task execution function
   * @param workload Estimated workload in bytes
   * @returns Promise resolving to LoaderReturn
   */
  async enqueue(id: string, task: () => Promise<LoaderReturn>, workload: number): Promise<LoaderReturn> {
    return new Promise((resolve, reject) => {
      const queuedTask: QueuedTask = {
        id,
        task,
        workload,
        resolve,
        reject
      }

      this.queue.push(queuedTask)
      logger.debug(`Task ${id} queued. Queue size: ${this.queue.length}, Workload: ${workload}`)
      this.processNext()
    })
  }

  /**
   * Process next task if capacity allows
   */
  private processNext(): void {
    if (this.isAtCapacity()) {
      logger.debug(
        `At capacity. Processing: ${this.processing.size}/${this.maxConcurrent}, Workload: ${this.currentWorkload}/${this.maxWorkload}`
      )
      return
    }

    const next = this.queue.shift()
    if (!next) {
      return
    }

    this.processing.set(next.id, next)
    this.currentWorkload += next.workload

    logger.debug(
      `Processing task ${next.id}. Active: ${this.processing.size}, Workload: ${this.currentWorkload}/${this.maxWorkload}`
    )

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
        this.currentWorkload -= next.workload
        logger.debug(`Task ${next.id} completed. Remaining queue: ${this.queue.length}`)
        this.processNext()
      })
  }

  /**
   * Check if queue is at capacity
   */
  private isAtCapacity(): boolean {
    return this.processing.size >= this.maxConcurrent || this.currentWorkload >= this.maxWorkload
  }

  /**
   * Get current queue status
   */
  getStatus(): { queueSize: number; processingCount: number; currentWorkload: number } {
    return {
      queueSize: this.queue.length,
      processingCount: this.processing.size,
      currentWorkload: this.currentWorkload
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
