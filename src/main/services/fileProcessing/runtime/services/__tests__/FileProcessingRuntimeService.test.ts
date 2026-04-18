import { BaseService } from '@main/core/lifecycle'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS,
  FILE_PROCESSING_TASK_TTL_MS,
  FileProcessingRuntimeService
} from '../FileProcessingRuntimeService'

describe('FileProcessingRuntimeService', () => {
  let service: FileProcessingRuntimeService

  beforeEach(async () => {
    service = new FileProcessingRuntimeService()
    await service._doInit()
  })

  afterEach(async () => {
    if (!service.isStopped && !service.isDestroyed) {
      await service._doStop()
    }
    BaseService.resetInstances()
    vi.useRealTimers()
  })

  it('initializes task runtime and exposes task operations', () => {
    service.createTask('doc2x', 'task-1', {
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing' as const,
      createdAt: 1
    })

    expect(service.getTask('doc2x', 'task-1')).toEqual({
      apiHost: 'https://example.com',
      apiKey: 'secret',
      stage: 'parsing',
      createdAt: 1
    })
  })

  it('clears task state on stop', async () => {
    service.createTask('open-mineru', 'task-2', {
      status: 'processing' as const,
      progress: 10
    })

    await service._doStop()
    expect((service as any).tasks).toBeNull()
    expect((service as any).pruneTimer).toBeNull()
  })

  it('throws when accessed after stop', async () => {
    await service._doStop()

    expect(() => service.getTask('doc2x', 'task-1')).toThrow('FileProcessingRuntimeService is not initialized')
  })

  it('isolates states by processor even when provider task ids match', () => {
    service.createTask('doc2x', 'shared-task-id', { stage: 'parsing' as const })
    service.createTask('mineru', 'shared-task-id', { apiHost: 'https://mineru.net' })

    expect(service.getTask('doc2x', 'shared-task-id')).toEqual({ stage: 'parsing' })
    expect(service.getTask('mineru', 'shared-task-id')).toEqual({ apiHost: 'https://mineru.net' })
  })

  it('updates existing task state', () => {
    const updated = service.createTask('open-mineru', 'task-2', {
      status: 'processing' as const,
      progress: 10
    })

    expect(updated).toEqual({
      status: 'processing',
      progress: 10
    })

    const next = service.updateTask<{ status: 'processing'; progress: number }>('open-mineru', 'task-2', (current) => ({
      ...current,
      progress: 80
    }))

    expect(next).toEqual({
      status: 'processing',
      progress: 80
    })
    expect(service.getTask('open-mineru', 'task-2')).toEqual({
      status: 'processing',
      progress: 80
    })
  })

  it('throws when updating a missing task', () => {
    expect(() =>
      service.updateTask('paddleocr', 'missing-task', (current: { progress: number }) => ({
        ...current,
        progress: 100
      }))
    ).toThrow('File processing task not found for paddleocr:missing-task')
  })

  it('deletes task state explicitly', () => {
    service.createTask('mineru', 'task-3', { apiHost: 'https://mineru.net' })

    expect(service.deleteTask('mineru', 'task-3')).toBe(true)
    expect(service.getTask('mineru', 'task-3')).toBeUndefined()
  })

  it('does not full-prune unrelated expired tasks on write, but prunes the accessed task on demand', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      service.createTask('doc2x', 'expired-task', { stage: 'parsing' as const })

      now = FILE_PROCESSING_TASK_TTL_MS
      service.createTask('mineru', 'fresh-task', { stage: 'running' as const })

      expect((service as any).tasks?.size).toBe(2)
      expect(service.getTask('doc2x', 'expired-task')).toBeUndefined()
      expect(service.getTask('mineru', 'fresh-task')).toEqual({ stage: 'running' })
    } finally {
      Date.now = originalNow
    }
  })

  it('prunes tasks that have been idle for longer than the ttl on read', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      service.createTask('doc2x', 'expired-on-read', { stage: 'parsing' as const })

      now = FILE_PROCESSING_TASK_TTL_MS

      expect(service.getTask('doc2x', 'expired-on-read')).toBeUndefined()
    } finally {
      Date.now = originalNow
    }
  })

  it('refreshes task ttl on successful reads', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      service.createTask('doc2x', 'read-refresh-task', { stage: 'parsing' as const })

      now = FILE_PROCESSING_TASK_TTL_MS / 2
      expect(service.getTask('doc2x', 'read-refresh-task')).toEqual({ stage: 'parsing' })

      now = FILE_PROCESSING_TASK_TTL_MS + FILE_PROCESSING_TASK_TTL_MS / 2 - 1
      expect(service.getTask('doc2x', 'read-refresh-task')).toEqual({ stage: 'parsing' })
    } finally {
      Date.now = originalNow
    }
  })

  it('treats expired tasks as missing on update', () => {
    const originalNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      service.createTask('open-mineru', 'expired-on-update', {
        status: 'processing' as const,
        progress: 10
      })

      now = FILE_PROCESSING_TASK_TTL_MS

      expect(() =>
        service.updateTask<{ status: 'processing'; progress: number }>(
          'open-mineru',
          'expired-on-update',
          (current) => ({
            ...current,
            progress: 80
          })
        )
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
      service.createTask('open-mineru', 'task-4', {
        status: 'processing' as const,
        progress: 10
      })

      now = FILE_PROCESSING_TASK_TTL_MS / 2
      service.updateTask<{ status: 'processing'; progress: number }>('open-mineru', 'task-4', (current) => ({
        ...current,
        progress: 60
      }))

      now = FILE_PROCESSING_TASK_TTL_MS + FILE_PROCESSING_TASK_TTL_MS / 2 - 1
      service.createTask('paddleocr', 'task-5', { progress: 0 })

      expect(service.getTask('open-mineru', 'task-4')).toEqual({
        status: 'processing',
        progress: 60
      })
    } finally {
      Date.now = originalNow
    }
  })

  it('prunes expired tasks from the background interval even without subsequent reads or writes', async () => {
    vi.useFakeTimers({
      shouldAdvanceTime: false
    })
    vi.setSystemTime(0)
    await service._doStop()
    BaseService.resetInstances()

    const intervalBackedService = new FileProcessingRuntimeService()

    try {
      await intervalBackedService._doInit()
      intervalBackedService.createTask('mineru', 'background-expired', { stage: 'running' as const })

      expect((intervalBackedService as any).tasks?.size).toBe(1)

      vi.setSystemTime(FILE_PROCESSING_TASK_TTL_MS)
      vi.advanceTimersByTime(FILE_PROCESSING_TASK_PRUNE_INTERVAL_MS)

      expect((intervalBackedService as any).tasks?.size).toBe(0)
    } finally {
      if (!intervalBackedService.isStopped && !intervalBackedService.isDestroyed) {
        await intervalBackedService._doStop()
      }
    }
  })
})
