import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { KnowledgeQueueManager } from '../queue/KnowledgeQueueManager'
import { type KnowledgeJob, PROGRESS_THROTTLE_MS } from '../queue/types'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function createJob(overrides: Partial<KnowledgeJob> = {}): KnowledgeJob {
  return {
    baseId: 'base-1',
    itemId: 'item-1',
    createdAt: Date.now(),
    ...overrides
  }
}

describe('KnowledgeQueueManager', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects duplicate item ids', async () => {
    const manager = new KnowledgeQueueManager({ globalConcurrency: 1, perBaseConcurrency: 1 })
    const gate = createDeferred<void>()

    const firstTask = manager.enqueue(createJob(), async () => {
      await gate.promise
      return 'done'
    })

    const duplicateTask = manager.enqueue(createJob(), async () => 'duplicate')

    await expect(duplicateTask).rejects.toThrow('already enqueued')

    gate.resolve()
    await expect(firstTask).resolves.toBe('done')
  })

  it('enforces max queue size', async () => {
    const manager = new KnowledgeQueueManager({
      globalConcurrency: 1,
      perBaseConcurrency: 1,
      maxQueueSize: 1
    })
    const gate = createDeferred<void>()

    const firstTask = manager.enqueue(createJob({ itemId: 'item-1' }), async () => {
      await gate.promise
      return 'first'
    })

    const secondTask = manager.enqueue(createJob({ itemId: 'item-2' }), async () => 'second')
    const overflowTask = manager.enqueue(createJob({ itemId: 'item-3' }), async () => 'third')

    await expect(overflowTask).rejects.toThrow('Queue is full')

    gate.resolve()
    await expect(firstTask).resolves.toBe('first')
    await expect(secondTask).resolves.toBe('second')
  })

  it('cancels queued jobs', async () => {
    const manager = new KnowledgeQueueManager({ globalConcurrency: 1, perBaseConcurrency: 1 })
    const gate = createDeferred<void>()

    const firstTask = manager.enqueue(createJob({ itemId: 'item-1' }), async () => {
      await gate.promise
      return 'first'
    })

    const queuedTask = manager.enqueue(createJob({ itemId: 'item-2' }), async () => 'second')

    expect(manager.isQueued('item-2')).toBe(true)
    expect(manager.cancel('item-2')).toEqual({ status: 'cancelled' })
    expect(manager.isQueued('item-2')).toBe(false)

    await expect(queuedTask).rejects.toMatchObject({ name: 'AbortError' })

    gate.resolve()
    await expect(firstTask).resolves.toBe('first')
  })

  it('throttles progress updates and applies immediate updates', () => {
    vi.useFakeTimers()
    const manager = new KnowledgeQueueManager()

    manager.updateProgress('item-1', 20)
    expect(manager.getProgress('item-1')).toBeUndefined()

    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS - 1)
    expect(manager.getProgress('item-1')).toBeUndefined()

    vi.advanceTimersByTime(1)
    expect(manager.getProgress('item-1')).toBe(20)

    manager.updateProgress('item-1', 10)
    vi.advanceTimersByTime(PROGRESS_THROTTLE_MS)
    expect(manager.getProgress('item-1')).toBe(20)

    manager.updateProgress('item-1', 120)
    expect(manager.getProgress('item-1')).toBe(100)

    manager.updateProgress('item-2', 33, { immediate: true })
    expect(manager.getProgress('item-2')).toBe(33)

    expect(manager.getProgressForItems(['item-1', 'item-2', 'missing'])).toEqual({
      'item-1': 100,
      'item-2': 33
    })
  })
})
