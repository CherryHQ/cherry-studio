import { loggerService } from '@logger'
import PQueue from 'p-queue'

import type {
  EnqueueKnowledgeTaskOptions,
  IndexLeafTaskEntry,
  KnowledgeQueueSnapshot,
  KnowledgeQueueTaskContext,
  KnowledgeQueueTaskDescriptor,
  PrepareRootTaskEntry
} from './types'

const logger = loggerService.withContext('KnowledgeQueueManager')
const DEFAULT_CONCURRENCY = 5

class KnowledgeQueueInterruptedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeQueueInterruptedError'
  }
}

type KnowledgeQueueTaskStatus = 'pending' | 'running'

type QueueEntry = EnqueueKnowledgeTaskOptions & {
  controller: AbortController
  interruptError?: KnowledgeQueueInterruptedError
  reject: (error: Error) => void
  resolve: () => void
  runPromise?: Promise<void>
  promise: Promise<void>
  status: KnowledgeQueueTaskStatus
  settled: boolean
}

export class KnowledgeQueueManager {
  private queue: PQueue
  private isResetting = false
  private resetReason: string | null = null
  private readonly entries = new Map<string, QueueEntry>()
  // Per-base serialization protects vector-store writes and status completion ordering.
  private readonly baseWriteLocks = new Map<string, Promise<void>>()

  constructor() {
    this.queue = this.createQueue()
  }

  async reset(reason: string): Promise<KnowledgeQueueTaskDescriptor[]> {
    if (this.isResetting) {
      throw this.createResetError()
    }

    this.resetReason = reason
    this.isResetting = true

    try {
      const interruptedEntries = this.interruptAll(reason)
      this.queue.clear()
      await this.waitForRunning(interruptedEntries.map((entry) => entry.itemId))
      this.queue = this.createQueue()
      this.baseWriteLocks.clear()

      return interruptedEntries
    } finally {
      this.isResetting = false
      this.resetReason = null
    }
  }

  enqueue(options: EnqueueKnowledgeTaskOptions): Promise<void> {
    if (this.isResetting) {
      return Promise.reject(this.createResetError())
    }

    const existingEntry = this.entries.get(options.item.id)
    if (existingEntry) {
      return existingEntry.promise
    }

    const entry = this.createEntry(options)
    this.entries.set(entry.item.id, entry)
    this.schedule(entry)

    return entry.promise
  }

  interruptItems(itemIds: string[], reason: string): KnowledgeQueueTaskDescriptor[] {
    const interruptedEntries = this.getEntriesByIds(itemIds)

    for (const entry of interruptedEntries) {
      entry.interruptError ??= new KnowledgeQueueInterruptedError(reason)

      if (!entry.controller.signal.aborted) {
        entry.controller.abort(entry.interruptError)
      }

      if (entry.status === 'pending') {
        this.rejectEntry(entry, this.createInterruptError(entry))
      }
    }

    return interruptedEntries.map((entry) => this.createDescriptor(entry))
  }

  interruptBase(baseId: string, reason: string): KnowledgeQueueTaskDescriptor[] {
    const itemIds = [...this.entries.values()].filter((entry) => entry.base.id === baseId).map((entry) => entry.item.id)

    return this.interruptItems(itemIds, reason)
  }

  interruptAll(reason: string): KnowledgeQueueTaskDescriptor[] {
    return this.interruptItems([...this.entries.keys()], reason)
  }

  async waitForRunning(itemIds: string[]): Promise<void> {
    const runningPromises = this.getEntriesByIds(itemIds)
      .filter((entry) => !entry.settled && entry.status === 'running')
      .map((entry) => entry.runPromise ?? entry.promise)

    if (runningPromises.length === 0) {
      return
    }

    await Promise.allSettled(runningPromises)
  }

  getSnapshot(): KnowledgeQueueSnapshot {
    const snapshot: KnowledgeQueueSnapshot = {
      pending: [],
      running: []
    }

    for (const entry of this.entries.values()) {
      if (entry.settled) {
        continue
      }

      snapshot[entry.status].push({
        ...this.createDescriptor(entry)
      })
    }

    return snapshot
  }

  async runWithBaseWriteLockForBase<T>(baseId: string, task: () => Promise<T>): Promise<T> {
    const previousLock = this.baseWriteLocks.get(baseId) ?? Promise.resolve()
    let releaseCurrentLock!: () => void
    const currentLock = new Promise<void>((resolve) => {
      releaseCurrentLock = resolve
    })
    const nextLock = previousLock.catch(() => undefined).then(() => currentLock)

    this.baseWriteLocks.set(baseId, nextLock)

    try {
      await previousLock.catch(() => undefined)
      return await task()
    } finally {
      releaseCurrentLock()

      if (this.baseWriteLocks.get(baseId) === nextLock) {
        this.baseWriteLocks.delete(baseId)
      }
    }
  }

  private createQueue(): PQueue {
    return new PQueue({ concurrency: DEFAULT_CONCURRENCY })
  }

  private createEntry(options: EnqueueKnowledgeTaskOptions): QueueEntry {
    const controller = new AbortController()
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    return {
      ...options,
      controller,
      promise,
      reject,
      resolve,
      settled: false,
      status: 'pending'
    }
  }

  private schedule(entry: QueueEntry): void {
    void this.queue.add(async () => {
      if (this.entries.get(entry.item.id) !== entry || entry.settled || entry.status !== 'pending') {
        return
      }

      entry.status = 'running'
      entry.runPromise = this.executeEntry(entry)
      await entry.runPromise
    })
  }

  private async executeEntry(entry: QueueEntry): Promise<void> {
    try {
      this.throwIfInterrupted(entry)
      await this.executeQueueEntry(entry)

      this.throwIfInterrupted(entry)
      this.resolveEntry(entry)
    } catch (error) {
      const taskError = error instanceof Error ? error : new Error(String(error))

      if (taskError !== entry.interruptError) {
        logger.error('Knowledge queue task failed unexpectedly', taskError, {
          baseId: entry.base.id,
          itemId: entry.item.id,
          kind: entry.kind
        })
      }

      this.rejectEntry(entry, taskError)
    }
  }

  private async executeQueueEntry(entry: QueueEntry): Promise<void> {
    if (entry.kind === 'index-leaf') {
      const context: KnowledgeQueueTaskContext<IndexLeafTaskEntry> = {
        base: entry.base,
        baseId: entry.base.id,
        item: entry.item,
        itemId: entry.item.id,
        itemType: entry.item.type,
        kind: entry.kind,
        signal: entry.controller.signal,
        runWithBaseWriteLock: (task) => this.runWithBaseWriteLock(entry, task)
      }

      await entry.execute(context)
      return
    }

    const context: KnowledgeQueueTaskContext<PrepareRootTaskEntry> = {
      base: entry.base,
      baseId: entry.base.id,
      item: entry.item,
      itemId: entry.item.id,
      itemType: entry.item.type,
      kind: entry.kind,
      signal: entry.controller.signal,
      runWithBaseWriteLock: (task) => this.runWithBaseWriteLock(entry, task)
    }

    await entry.execute(context)
  }

  private async runWithBaseWriteLock<T>(entry: QueueEntry, task: () => Promise<T>): Promise<T> {
    this.throwIfInterrupted(entry)

    return await this.runWithBaseWriteLockForBase(entry.base.id, async () => {
      this.throwIfInterrupted(entry)

      const result = await task()
      this.throwIfInterrupted(entry)
      return result
    })
  }

  private getEntriesByIds(itemIds: string[]): QueueEntry[] {
    const entries: QueueEntry[] = []

    for (const itemId of new Set(itemIds)) {
      const entry = this.entries.get(itemId)
      if (entry) {
        entries.push(entry)
      }
    }

    return entries
  }

  private deleteEntry(entry: QueueEntry): void {
    if (this.entries.get(entry.item.id) === entry) {
      this.entries.delete(entry.item.id)
    }
  }

  private createDescriptor(entry: QueueEntry): KnowledgeQueueTaskDescriptor {
    return {
      base: entry.base,
      baseId: entry.base.id,
      itemId: entry.item.id,
      itemType: entry.item.type,
      kind: entry.kind
    }
  }

  private resolveEntry(entry: QueueEntry): void {
    if (entry.settled) {
      return
    }

    entry.settled = true
    entry.resolve()
    this.deleteEntry(entry)
  }

  private rejectEntry(entry: QueueEntry, error: Error): void {
    if (entry.settled) {
      return
    }

    entry.settled = true
    entry.reject(error)
    this.deleteEntry(entry)
  }

  private throwIfInterrupted(entry: QueueEntry): void {
    if (entry.controller.signal.aborted) {
      throw this.createInterruptError(entry)
    }
  }

  private createInterruptError(entry: QueueEntry): Error {
    if (!entry.interruptError) {
      throw new Error('Knowledge queue entry was aborted without an interrupt error')
    }

    return entry.interruptError
  }

  private createResetError(): Error {
    return new KnowledgeQueueInterruptedError(this.resetReason!)
  }
}
