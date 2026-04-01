import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FileProcessingTaskStore } from '../FileProcessingTaskStore'

describe('FileProcessingTaskStore', () => {
  let store: FileProcessingTaskStore

  beforeEach(() => {
    store = new FileProcessingTaskStore()
  })

  afterEach(() => {
    store.destroy()
    vi.useRealTimers()
  })

  it('stores task state per processor and provider task id', () => {
    store.create('doc2x', 'task-1', {
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing' as const,
      createdAt: 1
    })

    expect(store.get('doc2x', 'task-1')).toEqual({
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing',
      createdAt: 1
    })
  })

  it('isolates states by processor even when provider task ids match', () => {
    store.create('doc2x', 'shared-task-id', { stage: 'parsing' as const })
    store.create('mineru', 'shared-task-id', { apiHost: 'https://mineru.net' })

    expect(store.get('doc2x', 'shared-task-id')).toEqual({ stage: 'parsing' })
    expect(store.get('mineru', 'shared-task-id')).toEqual({ apiHost: 'https://mineru.net' })
  })

  it('updates existing task state', () => {
    const updated = store.create('open-mineru', 'task-2', {
      status: 'processing' as const,
      progress: 10
    })

    expect(updated).toEqual({
      status: 'processing',
      progress: 10
    })

    const next = store.update<{ status: 'processing'; progress: number }>('open-mineru', 'task-2', (current) => ({
      ...current,
      progress: 80
    }))

    expect(next).toEqual({
      status: 'processing',
      progress: 80
    })
    expect(store.get('open-mineru', 'task-2')).toEqual({
      status: 'processing',
      progress: 80
    })
  })

  it('throws when updating a missing task', () => {
    expect(() =>
      store.update('paddleocr', 'missing-task', (current: { progress: number }) => ({
        ...current,
        progress: 100
      }))
    ).toThrow('File processing task not found for paddleocr:missing-task')
  })

  it('deletes task state explicitly', () => {
    store.create('mineru', 'task-3', { apiHost: 'https://mineru.net' })

    expect(store.delete('mineru', 'task-3')).toBe(true)
    expect(store.get('mineru', 'task-3')).toBeUndefined()
  })

  it('does not full-prune unrelated expired tasks on write, but prunes the accessed task on demand', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      store.create('doc2x', 'expired-task', { stage: 'parsing' as const })

      now = 60 * 60 * 1000
      store.create('mineru', 'fresh-task', { stage: 'running' as const })

      expect((store as any).tasks.size).toBe(2)
      expect(store.get('doc2x', 'expired-task')).toBeUndefined()
      expect(store.get('mineru', 'fresh-task')).toEqual({ stage: 'running' })
    } finally {
      Date.now = originalNow
    }
  })

  it('prunes tasks that have been idle for more than one hour on read', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      store.create('doc2x', 'expired-on-read', { stage: 'parsing' as const })

      now = 60 * 60 * 1000

      expect(store.get('doc2x', 'expired-on-read')).toBeUndefined()
    } finally {
      Date.now = originalNow
    }
  })

  it('treats expired tasks as missing on update', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      store.create('open-mineru', 'expired-on-update', {
        status: 'processing' as const,
        progress: 10
      })

      now = 60 * 60 * 1000

      expect(() =>
        store.update<{ status: 'processing'; progress: number }>('open-mineru', 'expired-on-update', (current) => ({
          ...current,
          progress: 80
        }))
      ).toThrow('File processing task not found for open-mineru:expired-on-update')
    } finally {
      Date.now = originalNow
    }
  })

  it('keeps tasks alive when they are updated within the ttl window', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      store.create('open-mineru', 'task-4', {
        status: 'processing' as const,
        progress: 10
      })

      now = 30 * 60 * 1000
      store.update<{ status: 'processing'; progress: number }>('open-mineru', 'task-4', (current) => ({
        ...current,
        progress: 60
      }))

      now = 89 * 60 * 1000
      store.create('paddleocr', 'task-5', { progress: 0 })

      expect(store.get('open-mineru', 'task-4')).toEqual({
        status: 'processing',
        progress: 60
      })
    } finally {
      Date.now = originalNow
    }
  })

  it('prunes expired tasks from the background interval even without subsequent reads or writes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)

    const autoPruneStore = new FileProcessingTaskStore({
      autoPruneIntervalMs: 1_000
    }) as any

    try {
      autoPruneStore.create('mineru', 'background-expired', { stage: 'running' as const })

      expect(autoPruneStore.tasks.size).toBe(1)

      vi.setSystemTime(60 * 60 * 1000)
      vi.advanceTimersByTime(1_000)

      expect(autoPruneStore.tasks.size).toBe(0)
    } finally {
      autoPruneStore.destroy()
    }
  })
})
