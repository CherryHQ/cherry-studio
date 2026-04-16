import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'
import { describe, expect, it, vi } from 'vitest'

import { KnowledgeAddQueue } from '../KnowledgeAddQueue'

function createBase(): KnowledgeBase {
  return {
    id: 'kb-1',
    name: 'KB',
    dimensions: 1024,
    embeddingModelId: 'ollama::nomic-embed-text',
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createItem(id: string): KnowledgeItem {
  return {
    id,
    baseId: 'kb-1',
    groupId: null,
    type: 'note',
    data: { content: id },
    status: 'idle',
    error: null,
    createdAt: '2026-04-08T00:00:00.000Z',
    updatedAt: '2026-04-08T00:00:00.000Z'
  }
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('KnowledgeAddQueue', () => {
  it('deduplicates queued work for the same item', async () => {
    const deferred = createDeferred<void>()
    const executeAdd = vi.fn(async () => {
      await deferred.promise
    })
    const queue = new KnowledgeAddQueue(1, executeAdd)
    const base = createBase()
    const item = createItem('item-1')

    const firstPromise = queue.enqueue(base, item)
    const secondPromise = queue.enqueue(base, item)

    await vi.waitFor(() => {
      expect(executeAdd).toHaveBeenCalledTimes(1)
    })

    deferred.resolve()

    await expect(Promise.all([firstPromise, secondPromise])).resolves.toEqual([undefined, undefined])
  })

  it('interrupts pending and running items and returns their entries', async () => {
    const deferred = createDeferred<void>()
    const executeAdd = vi.fn(async (entry) => {
      if (entry.item.id === runningItem.id) {
        await deferred.promise
      }

      if (entry.interruptedBy) {
        throw new Error('Knowledge task interrupted by item deletion')
      }
    })
    const queue = new KnowledgeAddQueue(1, executeAdd)
    const base = createBase()
    const runningItem = createItem('item-running')
    const pendingItem = createItem('item-pending')

    const runningPromise = queue.enqueue(base, runningItem)
    const pendingPromise = queue.enqueue(base, pendingItem)

    await vi.waitFor(() => {
      expect(executeAdd).toHaveBeenCalledTimes(1)
    })

    const interruptedEntries = queue.interrupt(
      [runningItem.id, pendingItem.id],
      'delete',
      'Knowledge task interrupted by item deletion'
    )

    expect(interruptedEntries.map((entry) => entry.item.id)).toEqual([runningItem.id, pendingItem.id])
    expect(executeAdd.mock.calls[0][0].interruptedBy).toBe('delete')

    deferred.resolve()

    await queue.waitForRunning([runningItem.id, pendingItem.id])

    await expect(runningPromise).rejects.toThrow('Knowledge task interrupted by item deletion')
    await expect(pendingPromise).rejects.toThrow('Knowledge task interrupted by item deletion')
  })

  it('rejects the public promise when executeAdd throws and continues with later work', async () => {
    const queue = new KnowledgeAddQueue(1, async (entry) => {
      if (entry.item.id === firstItem.id) {
        throw new Error('execute failed')
      }
    })
    const base = createBase()
    const firstItem = createItem('item-failed')
    const secondItem = createItem('item-next')

    const firstPromise = queue.enqueue(base, firstItem)
    const secondPromise = queue.enqueue(base, secondItem)

    await expect(firstPromise).rejects.toThrow('execute failed')
    await expect(secondPromise).resolves.toBeUndefined()
  })
})
