import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import PQueue from 'p-queue'

export interface AddTaskEntry {
  base: KnowledgeBase
  item: KnowledgeItem
}

export interface AddTaskContext extends AddTaskEntry {
  controller: AbortController
  interruptedBy?: 'delete' | 'stop'
}

type QueueEntry = AddTaskContext & {
  status: 'pending' | 'running'
  promise: Promise<void>
}

export class KnowledgeAddQueue {
  private readonly concurrency: number
  private readonly executeAdd: (entry: AddTaskContext) => Promise<void>
  private queue: PQueue
  private entries = new Map<string, QueueEntry>()

  constructor(concurrency: number, executeAdd: (entry: AddTaskContext) => Promise<void>) {
    this.concurrency = concurrency
    this.executeAdd = executeAdd
    this.queue = this.createQueue()
  }

  reset(): void {
    this.queue.clear()
    this.queue = this.createQueue()
    this.entries.clear()
  }

  enqueue(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    const existingEntry = this.entries.get(item.id)
    if (existingEntry) {
      return existingEntry.promise
    }

    const entry = this.createEntry(base, item)
    this.entries.set(item.id, entry)
    this.schedule(entry)

    return entry.promise
  }

  interrupt(itemIds: string[], interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    const interruptedEntries = this.getEntriesByIds(itemIds)

    for (const entry of interruptedEntries) {
      if (entry.status === 'pending') {
        entry.controller.abort(reason)
        this.deleteEntry(entry)
        continue
      }

      entry.interruptedBy = interruptedBy
      entry.controller.abort(reason)
    }

    return interruptedEntries
  }

  interruptBase(baseId: string, interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    const itemIds = this.getEntriesForBase(baseId).map((entry) => entry.item.id)
    return this.interrupt(itemIds, interruptedBy, reason)
  }

  interruptAll(interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    return this.interrupt([...this.entries.keys()], interruptedBy, reason)
  }

  async waitForRunning(itemIds: string[]): Promise<void> {
    const executions = this.getEntriesByIds(itemIds)
      .filter((entry): entry is QueueEntry & { status: 'running' } => entry.status === 'running')
      .map((entry) => entry.promise)

    if (executions.length === 0) {
      return
    }

    await Promise.allSettled(executions)
  }

  private createQueue(): PQueue {
    return new PQueue({
      concurrency: this.concurrency
    })
  }

  private createEntry(base: KnowledgeBase, item: KnowledgeItem): QueueEntry {
    const controller = new AbortController()
    return {
      base,
      item,
      promise: Promise.resolve(),
      controller,
      status: 'pending' as const,
      interruptedBy: undefined
    }
  }

  private schedule(entry: QueueEntry): void {
    entry.promise = this.queue
      .add(
        async () => {
          if (this.entries.get(entry.item.id) !== entry) {
            return
          }

          entry.status = 'running'
          await this.executeAdd(entry)
        },
        { signal: entry.controller.signal }
      )
      .finally(() => {
        this.deleteEntry(entry)
      })
  }

  private getEntriesByIds(itemIds: string[]): QueueEntry[] {
    const entries = new Map<string, QueueEntry>()

    for (const itemId of new Set(itemIds)) {
      const entry = this.entries.get(itemId)
      if (entry) {
        entries.set(itemId, entry)
      }
    }

    return [...entries.values()]
  }

  private getEntriesForBase(baseId: string): QueueEntry[] {
    return [...this.entries.values()].filter((entry) => entry.base.id === baseId)
  }

  private deleteEntry(entry: QueueEntry): void {
    if (this.entries.get(entry.item.id) === entry) {
      this.entries.delete(entry.item.id)
    }
  }
}
