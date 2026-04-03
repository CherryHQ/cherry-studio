import { BaseService } from '@main/core/lifecycle'
import { MockMainDbServiceUtils } from '@test-mocks/main/DbService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeExecutionServiceMock = vi.hoisted(() => ({
  execute: vi.fn()
}))

const knowledgeItemServiceMock = vi.hoisted(() => ({
  update: vi.fn()
}))

vi.mock('../KnowledgeExecutionService', () => ({
  knowledgeExecutionService: knowledgeExecutionServiceMock
}))

vi.mock('@main/data/services/KnowledgeItemService', () => ({
  knowledgeItemService: knowledgeItemServiceMock
}))

import { KnowledgeTaskService } from '../KnowledgeTaskService'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void

  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve
    reject = innerReject
  })

  return { promise, resolve, reject }
}

function createDbMock(interruptedItems: Array<{ id: string }> = []) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn().mockResolvedValue(interruptedItems)
      }))
    }))
  }
}

async function flushAsyncWork() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('KnowledgeTaskService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T00:00:00.000Z'))
    BaseService.resetInstances()

    knowledgeExecutionServiceMock.execute.mockResolvedValue({ type: 'completed' })
    knowledgeItemServiceMock.update.mockResolvedValue({
      id: 'item-1'
    })

    MockMainDbServiceUtils.resetMocks()
    MockMainDbServiceUtils.setDb(createDbMock())
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('deduplicates enqueueMany by item id across pending tasks', async () => {
    const service = new KnowledgeTaskService()
    await service._doInit()

    await service.enqueueMany([
      {
        itemId: 'item-1',
        baseId: 'base-1',
        stage: 'embed',
        readyAt: Date.now() + 1_000
      },
      {
        itemId: 'item-1',
        baseId: 'base-1',
        stage: 'embed',
        readyAt: Date.now() + 2_000
      }
    ])

    expect(knowledgeItemServiceMock.update).toHaveBeenCalledTimes(1)
    expect(knowledgeItemServiceMock.update).toHaveBeenCalledWith('item-1', {
      status: 'pending',
      error: null
    })
    expect(knowledgeExecutionServiceMock.execute).not.toHaveBeenCalled()
  })

  it('waits until readyAt before executing a task', async () => {
    const service = new KnowledgeTaskService()
    await service._doInit()

    const readyAt = Date.now() + 5_000

    await service.enqueueMany([
      {
        itemId: 'item-1',
        baseId: 'base-1',
        stage: 'embed',
        readyAt
      }
    ])

    expect(knowledgeExecutionServiceMock.execute).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(4_999)
    expect(knowledgeExecutionServiceMock.execute).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledTimes(1)
    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledWith({
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'embed',
      readyAt,
      createdAt: Date.now() - 5_000
    })
  })

  it('schedules round-robin across bases while respecting global and per-base concurrency limits', async () => {
    const deferredByItem = new Map<string, ReturnType<typeof createDeferred<{ type: 'completed' }>>>()
    knowledgeExecutionServiceMock.execute.mockImplementation((task: { itemId: string }) => {
      const deferred = createDeferred<{ type: 'completed' }>()
      deferredByItem.set(task.itemId, deferred)
      return deferred.promise
    })

    const service = new KnowledgeTaskService()
    await service._doInit()

    await service.enqueueMany([
      {
        itemId: 'item-1',
        baseId: 'base-1',
        stage: 'embed'
      },
      {
        itemId: 'item-2',
        baseId: 'base-1',
        stage: 'embed'
      },
      {
        itemId: 'item-3',
        baseId: 'base-2',
        stage: 'embed'
      },
      {
        itemId: 'item-4',
        baseId: 'base-3',
        stage: 'embed'
      }
    ])

    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledTimes(3)
    expect(knowledgeExecutionServiceMock.execute.mock.calls.map(([task]) => task.itemId)).toEqual([
      'item-1',
      'item-3',
      'item-4'
    ])

    deferredByItem.get('item-1')?.resolve({ type: 'completed' })
    await flushAsyncWork()

    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledTimes(4)
    expect(knowledgeExecutionServiceMock.execute.mock.calls[3][0]).toMatchObject({
      itemId: 'item-2',
      baseId: 'base-1',
      stage: 'embed'
    })
  })

  it('re-enqueues next results and executes the follow-up task', async () => {
    knowledgeExecutionServiceMock.execute
      .mockResolvedValueOnce({
        type: 'next',
        task: {
          itemId: 'item-1',
          baseId: 'base-1',
          stage: 'file_processing_poll',
          readyAt: Date.now()
        }
      })
      .mockResolvedValueOnce({ type: 'completed' })

    const service = new KnowledgeTaskService()
    await service._doInit()

    await service.enqueueMany([
      {
        itemId: 'item-1',
        baseId: 'base-1',
        stage: 'file_processing_submit'
      }
    ])

    await flushAsyncWork()

    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledTimes(2)
    expect(knowledgeExecutionServiceMock.execute.mock.calls[0][0]).toMatchObject({
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'file_processing_submit'
    })
    expect(knowledgeExecutionServiceMock.execute.mock.calls[1][0]).toMatchObject({
      itemId: 'item-1',
      baseId: 'base-1',
      stage: 'file_processing_poll'
    })
  })

  it('fails interrupted persisted items during onInit without attempting recovery', async () => {
    MockMainDbServiceUtils.setDb(createDbMock([{ id: 'stale-1' }, { id: 'stale-2' }]))

    const service = new KnowledgeTaskService()
    await service._doInit()

    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(1, 'stale-1', {
      status: 'failed',
      error: 'Knowledge task interrupted before scheduler startup'
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenNthCalledWith(2, 'stale-2', {
      status: 'failed',
      error: 'Knowledge task interrupted before scheduler startup'
    })
    expect(knowledgeExecutionServiceMock.execute).not.toHaveBeenCalled()
  })

  it('marks queued and running tasks as failed during onStop', async () => {
    const runningTask = createDeferred<{ type: 'completed' }>()
    knowledgeExecutionServiceMock.execute.mockImplementationOnce(() => runningTask.promise)

    const service = new KnowledgeTaskService()
    await service._doInit()

    await service.enqueueMany([
      {
        itemId: 'item-running',
        baseId: 'base-1',
        stage: 'embed'
      },
      {
        itemId: 'item-pending',
        baseId: 'base-2',
        stage: 'embed',
        readyAt: Date.now() + 60_000
      }
    ])

    expect(knowledgeExecutionServiceMock.execute).toHaveBeenCalledTimes(1)

    await service._doStop()

    expect(knowledgeItemServiceMock.update).toHaveBeenCalledWith('item-running', {
      status: 'failed',
      error: 'Knowledge task interrupted by scheduler shutdown'
    })
    expect(knowledgeItemServiceMock.update).toHaveBeenCalledWith('item-pending', {
      status: 'failed',
      error: 'Knowledge task interrupted by scheduler shutdown'
    })
  })
})
