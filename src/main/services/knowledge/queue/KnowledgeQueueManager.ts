/**
 * KnowledgeQueueManager - Manages knowledge processing job queue with concurrency control
 *
 * Provides fair scheduling across knowledge bases with configurable concurrency limits.
 */

import { loggerService } from '@logger'

import type { KnowledgeStageRunner } from '../types'
import { ConcurrencyPool } from './ConcurrencyPool'
import { ProgressTracker } from './ProgressTracker'
import type {
  JobEntry,
  KnowledgeJob,
  KnowledgeJobTask,
  KnowledgeJobTaskContext,
  QueueStatus,
  SchedulerConfig
} from './types'
import { DEFAULT_SCHEDULER_CONFIG, PROGRESS_THROTTLE_MS, PROGRESS_TTL_MS } from './types'

const logger = loggerService.withContext('KnowledgeQueueManager')

export class KnowledgeQueueManager {
  private config: SchedulerConfig
  private baseQueues = new Map<string, Array<JobEntry<unknown>>>()
  private baseOrder: string[] = []
  private baseCursor = 0
  private activeGlobal = 0
  private activeByBase = new Map<string, number>()
  private jobs = new Map<string, JobEntry<unknown>>()
  private processingIds = new Set<string>()
  private isDraining = false

  private ioPool: ConcurrencyPool
  private embeddingPool: ConcurrencyPool
  private writePool: ConcurrencyPool

  private progressTracker = new ProgressTracker(PROGRESS_TTL_MS)
  private progressTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private pendingProgress = new Map<string, number>()

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = this.normalizeConfig({ ...DEFAULT_SCHEDULER_CONFIG, ...config })
    this.ioPool = new ConcurrencyPool(this.config.ioConcurrency)
    this.embeddingPool = new ConcurrencyPool(this.config.embeddingConcurrency)
    this.writePool = new ConcurrencyPool(this.config.writeConcurrency)
  }

  enqueue<T>(job: KnowledgeJob, task: KnowledgeJobTask<T>): Promise<T>
  enqueue<T>(id: string, task: (signal: AbortSignal) => Promise<T>): Promise<T>
  enqueue<T>(
    jobOrId: KnowledgeJob | string,
    task: KnowledgeJobTask<T> | ((signal: AbortSignal) => Promise<T>)
  ): Promise<T> {
    const { job, task: normalizedTask } = this.normalizeJob(jobOrId, task)
    const itemId = job.itemId

    if (this.jobs.has(itemId)) {
      logger.debug('Task already enqueued, skipping', { itemId })
      return Promise.reject(new Error(`Task ${itemId} already enqueued`))
    }

    if (this.config.maxQueueSize && this.getQueueSize() >= this.config.maxQueueSize) {
      logger.warn('Queue is full, rejecting task', { itemId, maxQueueSize: this.config.maxQueueSize })
      return Promise.reject(new Error('Queue is full'))
    }

    const controller = new AbortController()

    return new Promise<T>((resolve, reject) => {
      const entry: JobEntry<T> = {
        job,
        task: normalizedTask,
        controller,
        resolve,
        reject
      }

      this.jobs.set(itemId, entry as JobEntry<unknown>)
      this.enqueueJob(entry as JobEntry<unknown>)
    })
  }

  cancel(id: string): { status: 'cancelled' | 'ignored' } {
    const entry = this.jobs.get(id)
    if (!entry) {
      return { status: 'ignored' }
    }

    if (!this.processingIds.has(id)) {
      this.removeFromQueue(entry)
      entry.controller.abort()
      entry.reject(this.createAbortError(id))
      return { status: 'cancelled' }
    }

    entry.controller.abort()
    return { status: 'cancelled' }
  }

  isQueued(id: string): boolean {
    return this.jobs.has(id) && !this.processingIds.has(id)
  }

  isProcessing(id: string): boolean {
    return this.processingIds.has(id)
  }

  getStatus(): QueueStatus {
    const perBaseQueue: Record<string, number> = {}
    let queueSize = 0

    for (const [baseId, queue] of this.baseQueues.entries()) {
      perBaseQueue[baseId] = queue.length
      queueSize += queue.length
    }

    return {
      queueSize,
      processingCount: this.activeGlobal,
      perBaseQueue
    }
  }

  getProgress(itemId: string): number | undefined {
    return this.progressTracker.get(itemId)
  }

  getProgressForItems(ids: string[]): Record<string, number> {
    const result: Record<string, number> = {}
    for (const id of ids) {
      const progress = this.progressTracker.get(id)
      if (progress !== undefined) {
        result[id] = progress
      }
    }
    return result
  }

  updateProgress(itemId: string, progress: number, options?: { immediate?: boolean }): void {
    const clamped = Math.min(100, Math.max(0, progress))
    const current = this.progressTracker.get(itemId) ?? 0
    const next = Math.max(current, clamped)

    if (options?.immediate || next >= 100) {
      this.setProgressImmediate(itemId, next)
      return
    }

    const pending = this.pendingProgress.get(itemId) ?? next
    this.pendingProgress.set(itemId, Math.max(pending, next))

    if (this.progressTimers.has(itemId)) {
      return
    }

    const timer = setTimeout(() => {
      const value = this.pendingProgress.get(itemId)
      if (value !== undefined) {
        this.progressTracker.set(itemId, value)
        this.pendingProgress.delete(itemId)
      }
      this.progressTimers.delete(itemId)
    }, PROGRESS_THROTTLE_MS)

    this.progressTimers.set(itemId, timer)
  }

  clearProgress(itemId: string): void {
    this.clearProgressTimers(itemId)
    this.progressTracker.delete(itemId)
  }

  private runStage: KnowledgeStageRunner = async (stage, task) => {
    switch (stage) {
      case 'read':
        return await this.ioPool.run(task)
      case 'embed':
        return await this.embeddingPool.run(task)
      case 'write':
        return await this.writePool.run(task)
      default:
        return await task()
    }
  }

  private enqueueJob(entry: JobEntry<unknown>): void {
    const baseId = entry.job.baseId
    const queue = this.baseQueues.get(baseId)

    if (!queue) {
      this.baseQueues.set(baseId, [entry])
      this.baseOrder.push(baseId)
    } else {
      queue.push(entry)
    }

    this.setProgressImmediate(entry.job.itemId, 0)
    this.schedule()
  }

  private schedule(): void {
    if (this.isDraining) {
      return
    }

    this.isDraining = true
    try {
      while (this.activeGlobal < this.config.globalConcurrency) {
        const next = this.dequeueNext()
        if (!next) {
          break
        }
        this.startJob(next)
      }
    } finally {
      this.isDraining = false
    }
  }

  private dequeueNext(): JobEntry<unknown> | undefined {
    if (this.baseOrder.length === 0) {
      return undefined
    }

    const totalBases = this.baseOrder.length
    for (let i = 0; i < totalBases; i += 1) {
      const index = (this.baseCursor + i) % totalBases
      const baseId = this.baseOrder[index]
      const queue = this.baseQueues.get(baseId)
      if (!queue || queue.length === 0) {
        continue
      }

      const activeForBase = this.activeByBase.get(baseId) ?? 0
      if (activeForBase >= this.config.perBaseConcurrency) {
        continue
      }

      this.baseCursor = (index + 1) % totalBases
      return queue.shift()
    }

    return undefined
  }

  private startJob(entry: JobEntry<unknown>): void {
    const { job } = entry
    const baseId = job.baseId

    this.processingIds.add(job.itemId)
    this.activeGlobal += 1
    this.activeByBase.set(baseId, (this.activeByBase.get(baseId) ?? 0) + 1)

    const context: KnowledgeJobTaskContext = {
      job,
      signal: entry.controller.signal,
      runStage: this.runStage,
      updateProgress: (progress, options) => this.updateProgress(job.itemId, progress, options)
    }

    Promise.resolve()
      .then(async () => await entry.task(context))
      .then((result) => {
        entry.resolve(result)
      })
      .catch((error) => {
        entry.reject(error instanceof Error ? error : new Error(String(error)))
      })
      .finally(() => {
        this.finishJob(entry)
      })
  }

  private finishJob(entry: JobEntry<unknown>): void {
    const { job } = entry
    const baseId = job.baseId

    this.processingIds.delete(job.itemId)
    this.activeGlobal = Math.max(0, this.activeGlobal - 1)

    const activeForBase = Math.max(0, (this.activeByBase.get(baseId) ?? 1) - 1)
    if (activeForBase === 0) {
      this.activeByBase.delete(baseId)
    } else {
      this.activeByBase.set(baseId, activeForBase)
    }

    this.jobs.delete(job.itemId)
    this.clearProgressTimers(job.itemId)
    this.pruneBase(baseId)
    this.schedule()
  }

  private removeFromQueue(entry: JobEntry<unknown>): void {
    const { job } = entry
    const baseId = job.baseId
    const queue = this.baseQueues.get(baseId)

    if (!queue) {
      return
    }

    const index = queue.findIndex((queued) => queued.job.itemId === job.itemId)
    if (index >= 0) {
      queue.splice(index, 1)
    }

    this.jobs.delete(job.itemId)
    this.clearProgress(job.itemId)
    this.pruneBase(baseId)
    this.schedule()
  }

  private pruneBase(baseId: string): void {
    const queue = this.baseQueues.get(baseId)
    if (queue && queue.length > 0) {
      return
    }

    if (this.activeByBase.has(baseId)) {
      return
    }

    this.baseQueues.delete(baseId)
    const index = this.baseOrder.indexOf(baseId)
    if (index >= 0) {
      this.baseOrder.splice(index, 1)
      if (index < this.baseCursor && this.baseCursor > 0) {
        this.baseCursor -= 1
      }
      if (this.baseCursor >= this.baseOrder.length) {
        this.baseCursor = 0
      }
    }
  }

  private normalizeJob<T>(
    jobOrId: KnowledgeJob | string,
    task: KnowledgeJobTask<T> | ((signal: AbortSignal) => Promise<T>)
  ): { job: KnowledgeJob; task: KnowledgeJobTask<T> } {
    if (typeof jobOrId === 'string') {
      const job: KnowledgeJob = {
        baseId: 'default',
        itemId: jobOrId,
        createdAt: Date.now()
      }
      const legacyTask = task as (signal: AbortSignal) => Promise<T>
      return {
        job,
        task: async ({ signal }) => await legacyTask(signal)
      }
    }

    const normalizedJob: KnowledgeJob = {
      ...jobOrId,
      baseId: jobOrId.baseId || 'default',
      createdAt: jobOrId.createdAt ?? Date.now()
    }

    return {
      job: normalizedJob,
      task: task as KnowledgeJobTask<T>
    }
  }

  private setProgressImmediate(itemId: string, progress: number): void {
    this.clearProgressTimers(itemId)
    this.progressTracker.set(itemId, progress)
  }

  private clearProgressTimers(itemId: string): void {
    const timer = this.progressTimers.get(itemId)
    if (timer) {
      clearTimeout(timer)
      this.progressTimers.delete(itemId)
    }
    this.pendingProgress.delete(itemId)
  }

  private createAbortError(itemId: string): Error {
    const error = new Error(`Task ${itemId} cancelled`)
    error.name = 'AbortError'
    return error
  }

  private getQueueSize(): number {
    let count = 0
    for (const queue of this.baseQueues.values()) {
      count += queue.length
    }
    return count
  }

  private normalizeConfig(config: SchedulerConfig): SchedulerConfig {
    const normalize = (value: number) => Math.max(1, value)
    return {
      ...config,
      globalConcurrency: normalize(config.globalConcurrency),
      perBaseConcurrency: normalize(config.perBaseConcurrency),
      ioConcurrency: normalize(config.ioConcurrency),
      embeddingConcurrency: normalize(config.embeddingConcurrency),
      writeConcurrency: normalize(config.writeConcurrency)
    }
  }
}

export const knowledgeQueueManager = new KnowledgeQueueManager()
