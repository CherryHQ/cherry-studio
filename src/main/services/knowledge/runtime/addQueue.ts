import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

export interface AddTaskEntry {
  base: KnowledgeBase
  item: KnowledgeItem
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

export interface RunningAddEntry extends AddTaskEntry {
  controller: AbortController
  execution: Promise<void>
  interruptedBy?: 'delete' | 'stop'
}

export class KnowledgeAddQueue {
  private concurrency: number
  private executeAdd: (entry: RunningAddEntry) => Promise<void>
  private pendingAddIds: string[] = []
  private pendingAdds = new Map<string, AddTaskEntry>()
  private runningAdds = new Map<string, RunningAddEntry>()

  constructor(concurrency: number, executeAdd: (entry: RunningAddEntry) => Promise<void>) {
    this.concurrency = concurrency
    this.executeAdd = executeAdd
  }

  reset(): void {
    this.pendingAddIds = []
    this.pendingAdds.clear()
    this.runningAdds.clear()
  }

  enqueue(base: KnowledgeBase, item: KnowledgeItem): Promise<void> {
    const existingPending = this.pendingAdds.get(item.id)
    if (existingPending) {
      return existingPending.promise
    }

    const existingRunning = this.runningAdds.get(item.id)
    if (existingRunning) {
      return existingRunning.promise
    }

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const entry: AddTaskEntry = {
      base,
      item,
      promise,
      resolve,
      reject
    }

    this.pendingAddIds.push(item.id)
    this.pendingAdds.set(item.id, entry)
    this.pump()

    return entry.promise
  }

  interrupt(itemIds: string[], interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    const uniqueItemIds = [...new Set(itemIds)]
    const interruptedEntries = this.getEntries(uniqueItemIds)

    this.pendingAddIds = this.pendingAddIds.filter((itemId) => {
      if (!uniqueItemIds.includes(itemId)) {
        return true
      }

      const entry = this.pendingAdds.get(itemId)
      if (entry) {
        entry.reject(new Error(reason))
        this.pendingAdds.delete(itemId)
      }

      return false
    })

    for (const itemId of uniqueItemIds) {
      const entry = this.runningAdds.get(itemId)
      if (!entry) {
        continue
      }

      entry.interruptedBy = interruptedBy
      entry.controller.abort(reason)
    }

    return interruptedEntries
  }

  interruptBase(baseId: string, interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    const itemIds = [...new Set(this.getEntriesForBase(baseId).map((entry) => entry.item.id))]
    return this.interrupt(itemIds, interruptedBy, reason)
  }

  interruptAll(interruptedBy: 'delete' | 'stop', reason: string): AddTaskEntry[] {
    const allItemIds = [...new Set([...this.pendingAddIds, ...this.runningAdds.keys()])]
    return this.interrupt(allItemIds, interruptedBy, reason)
  }

  async waitForRunning(itemIds: string[]): Promise<void> {
    const executions = [...new Set(itemIds)]
      .map((itemId) => this.runningAdds.get(itemId)?.execution)
      .filter((execution): execution is Promise<void> => execution !== undefined)

    if (executions.length === 0) {
      return
    }

    await Promise.allSettled(executions)
  }

  private getEntries(itemIds: string[]): AddTaskEntry[] {
    const entries = new Map<string, AddTaskEntry>()

    for (const itemId of itemIds) {
      const pendingEntry = this.pendingAdds.get(itemId)
      if (pendingEntry) {
        entries.set(itemId, pendingEntry)
        continue
      }

      const runningEntry = this.runningAdds.get(itemId)
      if (runningEntry) {
        entries.set(itemId, runningEntry)
      }
    }

    return [...entries.values()]
  }

  private getEntriesForBase(baseId: string): AddTaskEntry[] {
    const entries = new Map<string, AddTaskEntry>()

    for (const entry of this.pendingAdds.values()) {
      if (entry.base.id === baseId) {
        entries.set(entry.item.id, entry)
      }
    }

    for (const entry of this.runningAdds.values()) {
      if (entry.base.id === baseId) {
        entries.set(entry.item.id, entry)
      }
    }

    return [...entries.values()]
  }

  private pump(): void {
    while (this.runningAdds.size < this.concurrency && this.pendingAddIds.length > 0) {
      const itemId = this.pendingAddIds.shift()
      if (!itemId) {
        return
      }

      const pendingEntry = this.pendingAdds.get(itemId)
      if (!pendingEntry) {
        continue
      }

      this.pendingAdds.delete(itemId)

      const runningEntry: RunningAddEntry = {
        ...pendingEntry,
        controller: new AbortController(),
        execution: Promise.resolve()
      }

      const execution = this.executeAdd(runningEntry)
        .catch(() => undefined)
        .finally(() => {
          this.runningAdds.delete(itemId)
          this.pump()
        })

      runningEntry.execution = execution
      this.runningAdds.set(itemId, runningEntry)
    }
  }
}
