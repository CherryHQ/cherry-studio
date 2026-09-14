import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FlushController } from '../FlushController'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000)
})
afterEach(() => vi.useRealTimers())

describe('FlushController', () => {
  it('retains an update arriving between callback completion and flight settlement', async () => {
    const gate = Promise.withResolvers<void>()
    let starts = 0
    const task = new FlushController(() => {
      starts++
      return starts === 1 ? gate.promise : Promise.resolve()
    })
    const first = task.flush()
    gate.resolve()
    queueMicrotask(() => void task.flush())
    await first
    await vi.runAllTimersAsync()
    expect(starts).toBe(2)
  })

  it('retains mutual exclusion and existing waiters when reset during a flush', async () => {
    const gate = Promise.withResolvers<void>()
    let starts = 0
    const task = new FlushController(async () => {
      starts++
      if (starts === 1) await gate.promise
    })
    const first = task.flush()
    let finished = false
    const waiting = task.waitForFlush().then(() => {
      finished = true
    })
    task.reset()
    await task.flush()
    expect(starts).toBe(1)
    expect(finished).toBe(false)
    gate.resolve()
    await Promise.all([first, waiting])
    expect(finished).toBe(true)
    await vi.runAllTimersAsync()
    expect(starts).toBe(2)
  })

  it('uses the adapter interval for a trailing update', async () => {
    const starts: number[] = []
    const task = new FlushController(async () => {
      starts.push(Date.now())
    })
    await task.flush()
    await task.throttledUpdate(1000)
    await vi.advanceTimersByTimeAsync(999)
    expect(starts).toEqual([1000])
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toEqual([1000, 2000])
  })

  it('keeps callbacks nonoverlapping while current-flush wait excludes the queued rerun', async () => {
    const firstGate = Promise.withResolvers<void>()
    const secondGate = Promise.withResolvers<void>()
    const starts: number[] = []
    const task = new FlushController(() => {
      starts.push(Date.now())
      return starts.length === 1 ? firstGate.promise : secondGate.promise
    })
    const first = task.flush()
    await task.flush()
    const waiting = task.waitForFlush()
    expect(starts).toHaveLength(1)
    firstGate.resolve()
    await Promise.all([first, waiting])
    expect(starts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toHaveLength(2)
    secondGate.resolve()
    await task.waitForFlush()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('retains an existing throttled timer instead of adding an immediate rerun', async () => {
    const gate = Promise.withResolvers<void>()
    const starts: number[] = []
    const task = new FlushController(() => {
      starts.push(Date.now())
      return starts.length === 1 ? gate.promise : Promise.resolve()
    })
    const first = task.flush()
    await task.throttledUpdate()
    await task.flush()
    gate.resolve()
    await first
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(199)
    expect(starts).toEqual([1000])
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toEqual([1000, 1200])
  })

  it('waits for the current failure without rejecting waiters or running after completion', async () => {
    const gate = Promise.withResolvers<void>()
    let starts = 0
    const task = new FlushController(() => {
      starts++
      return gate.promise
    })
    const first = task.flush()
    const waiting = task.waitForFlush()
    await task.flush()
    task.complete()
    const error = new Error('flush failed')
    const rejected = expect(first).rejects.toBe(error)
    gate.reject(error)
    await rejected
    await expect(waiting).resolves.toBeUndefined()
    await vi.runAllTimersAsync()
    await task.flush()
    expect(starts).toBe(1)
    expect(task.isCompleted).toBe(true)
  })

  it('batches after a long gap and releases pending work on completion', async () => {
    vi.setSystemTime(3000)
    let starts = 0
    const task = new FlushController(async () => {
      starts++
    })
    await task.throttledUpdate()
    expect(starts).toBe(0)
    await vi.advanceTimersByTimeAsync(299)
    expect(starts).toBe(0)
    task.complete()
    expect(vi.getTimerCount()).toBe(0)
    await task.throttledUpdate()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(starts).toBe(0)
    task.reset()
    expect(task.isCompleted).toBe(false)
    await task.throttledUpdate()
    await vi.advanceTimersByTimeAsync(300)
    expect(starts).toBe(1)
  })
})
