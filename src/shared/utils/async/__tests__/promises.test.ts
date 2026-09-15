import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { raceCancellation } from '..'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('raceCancellation', () => {
  it('stops waiting promptly and leaves shared work running', async () => {
    const task = Promise.withResolvers<string>()
    const controller = new AbortController()
    const reason = new Error('waiter stopped')
    const rejected = expect(raceCancellation(task.promise, controller.signal)).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    task.resolve('shared result')
    await expect(task.promise).resolves.toBe('shared result')
  })

  it('observes rejected work even when cancellation preceded the call', async () => {
    const controller = new AbortController()
    controller.abort(null)
    await expect(raceCancellation(Promise.reject(new Error('work failed')), controller.signal)).rejects.toBeNull()
    await vi.advanceTimersByTimeAsync(0)
  })

  it.each(['resolve', 'reject'] as const)('cleans the listener when the task settles: %s', async (outcome) => {
    const task = Promise.withResolvers<string>()
    const controller = new AbortController()
    const mappedReasons: unknown[] = []
    const waiting = raceCancellation(task.promise, controller.signal, (signal) => {
      mappedReasons.push(signal.reason)
      return signal.reason
    })
    const result =
      outcome === 'resolve' ? expect(waiting).resolves.toBe('result') : expect(waiting).rejects.toBe('result')
    task[outcome]('result')
    await result
    controller.abort(new Error('owner stopped after settlement'))
    expect(mappedReasons).toEqual([])
  })

  it('uses the owner reason mapping when cancellation wins', async () => {
    const task = Promise.withResolvers<string>()
    const controller = new AbortController()
    const mappedReason = new Error('mapped boundary cancellation')
    const waiting = raceCancellation(task.promise, controller.signal, () => mappedReason)
    const rejected = expect(waiting).rejects.toBe(mappedReason)

    controller.abort('raw owner reason')
    await rejected
    task.resolve('late shared result')
    await expect(task.promise).resolves.toBe('late shared result')
  })

  it('observes late work rejection when a pre-aborted reason mapper throws', async () => {
    const task = Promise.withResolvers<string>()
    const controller = new AbortController()
    const failure = new Error('owner reason mapping failed')
    controller.abort('owner stopped')

    await expect(
      raceCancellation(task.promise, controller.signal, () => {
        throw failure
      })
    ).rejects.toBe(failure)
    task.reject(new Error('late work failure'))
    await vi.advanceTimersByTimeAsync(0)
  })
})
