import { describe, expect, it } from 'vitest'

import { CoalescingTask } from '..'

describe('CoalescingTask', () => {
  it('runs only the latest pending callback and shares the entire drain result', async () => {
    const task = new CoalescingTask()
    const firstGate = Promise.withResolvers<void>()
    const lastGate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = task.run(() => {
      order.push('first')
      return firstGate.promise
    })
    const skipped = task.run(() => {
      order.push('skipped')
    })
    const last = task.run(() => {
      order.push('last')
      return lastGate.promise
    })
    expect(first).toBe(skipped)
    expect(first).toBe(last)
    expect(order).toEqual(['first'])
    firstGate.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first', 'last'])
    expect(task.isRunning).toBe(true)
    lastGate.resolve()
    await first
    expect(task.promise).toBeUndefined()
  })

  it('admits a synchronously reentrant request without overlapping callbacks', async () => {
    const task = new CoalescingTask()
    const order: string[] = []
    let joined: Promise<void> | undefined
    const first = task.run(() => {
      order.push('first:start')
      joined = task.run(() => {
        order.push('second')
      })
      order.push('first:end')
    })
    expect(joined).toBe(first)
    expect(order).toEqual(['first:start', 'first:end'])
    await first
    expect(order).toEqual(['first:start', 'first:end', 'second'])
  })

  it('does not lose a request arriving in the microtask when the previous task finishes', async () => {
    const task = new CoalescingTask()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = task.run(() => {
      order.push('first')
      return gate.promise
    })
    gate.resolve()
    await Promise.resolve()
    const second = task.run(() => {
      order.push('second')
    })
    await Promise.all([first, second])
    expect(order).toEqual(['first', 'second'])
  })

  it('rejects the whole drain, drops pending work, and permits a fresh explicit run', async () => {
    const task = new CoalescingTask()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = task.run(() => gate.promise)
    const joined = task.run(() => {
      order.push('discarded')
    })
    expect(joined).toBe(first)
    const error = new Error('save failed')
    const rejected = expect(first).rejects.toBe(error)
    gate.reject(error)
    await rejected
    expect(task.isRunning).toBe(false)
    await task.run(() => {
      order.push('retry')
    })
    expect(order).toEqual(['retry'])
  })
})
