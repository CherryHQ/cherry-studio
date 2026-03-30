import { beforeEach, describe, expect, it } from 'vitest'

import { FileProcessingTaskStore } from '../FileProcessingTaskStore'

describe('FileProcessingTaskStore', () => {
  let store: FileProcessingTaskStore

  beforeEach(() => {
    store = new FileProcessingTaskStore()
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
})
