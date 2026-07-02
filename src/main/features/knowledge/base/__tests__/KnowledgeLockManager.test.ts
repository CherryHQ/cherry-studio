import { describe, expect, it } from 'vitest'

import { KnowledgeLockManager } from '../KnowledgeLockManager'

function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function getBaseMutexCount(lockManager: KnowledgeLockManager): number {
  return (
    lockManager as unknown as {
      baseMutexes: Map<string, unknown>
    }
  ).baseMutexes.size
}

describe('KnowledgeLockManager', () => {
  it('serializes overlapping tasks for the same base', async () => {
    const lockManager = new KnowledgeLockManager()
    const releaseFirst = createDeferred()
    const order: string[] = []

    const firstTask = lockManager.withBaseMutationLock('kb-1', async () => {
      order.push('first-start')
      await releaseFirst.promise
      order.push('first-end')
    })
    const secondTask = lockManager.withBaseMutationLock('kb-1', async () => {
      order.push('second-start')
    })

    await flushMicrotasks()
    expect(order).toEqual(['first-start'])

    releaseFirst.resolve()
    await Promise.all([firstTask, secondTask])

    expect(order).toEqual(['first-start', 'first-end', 'second-start'])
  })

  it('runs tasks for different bases concurrently', async () => {
    const lockManager = new KnowledgeLockManager()
    const releaseFirst = createDeferred()
    const order: string[] = []

    const firstTask = lockManager.withBaseMutationLock('kb-1', async () => {
      order.push('first-start')
      await releaseFirst.promise
      order.push('first-end')
    })
    const secondTask = lockManager.withBaseMutationLock('kb-2', async () => {
      order.push('second-start')
    })

    await flushMicrotasks()
    expect(order).toEqual(['first-start', 'second-start'])

    releaseFirst.resolve()
    await firstTask
    await secondTask
  })

  it('releases a base lock when the task throws', async () => {
    const lockManager = new KnowledgeLockManager()
    const order: string[] = []

    await expect(
      lockManager.withBaseMutationLock('kb-1', async () => {
        order.push('throwing')
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    await lockManager.withBaseMutationLock('kb-1', async () => {
      order.push('after-throw')
    })

    expect(order).toEqual(['throwing', 'after-throw'])
  })

  it('removes idle base mutex entries after tasks complete', async () => {
    const lockManager = new KnowledgeLockManager()

    await lockManager.withBaseMutationLock('kb-1', async () => {
      expect(getBaseMutexCount(lockManager)).toBe(1)
    })

    expect(getBaseMutexCount(lockManager)).toBe(0)
  })
})
