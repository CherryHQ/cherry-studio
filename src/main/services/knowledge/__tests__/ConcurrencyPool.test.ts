import { describe, expect, it } from 'vitest'

import { ConcurrencyPool } from '../queue/ConcurrencyPool'

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

describe('ConcurrencyPool', () => {
  it('runs tasks sequentially when limit is 1', async () => {
    const pool = new ConcurrencyPool(1)
    const firstGate = createDeferred<void>()

    let secondStarted = false

    const firstTask = pool.run(async () => {
      await firstGate.promise
      return 'first'
    })

    const secondTask = pool.run(async () => {
      secondStarted = true
      return 'second'
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)

    firstGate.resolve()

    await expect(firstTask).resolves.toBe('first')
    await expect(secondTask).resolves.toBe('second')
  })

  it('releases slot when a task throws', async () => {
    const pool = new ConcurrencyPool(1)

    const failedTask = pool.run(async () => {
      throw new Error('boom')
    })

    await expect(failedTask).rejects.toThrow('boom')

    await expect(pool.run(async () => 42)).resolves.toBe(42)
  })

  it('does not throttle when limit is non-positive', async () => {
    const pool = new ConcurrencyPool(0)
    const gate = createDeferred<void>()

    let started = 0

    const taskA = pool.run(async () => {
      started += 1
      await gate.promise
      return 'a'
    })

    const taskB = pool.run(async () => {
      started += 1
      await gate.promise
      return 'b'
    })

    await Promise.resolve()
    expect(started).toBe(2)

    gate.resolve()
    await expect(Promise.all([taskA, taskB])).resolves.toEqual(['a', 'b'])
  })
})
