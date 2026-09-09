import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createDeferred, createDisposableTimeoutSignal, delay, raceCancellation, raceTimeout, withTimeout } from '..'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('delay', () => {
  it('waits for the requested duration and releases its timer', async () => {
    let finished = false
    const waiting = delay(100).then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(99)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(finished).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([false, true])('preserves cancellation reason, already aborted: %s', async (alreadyAborted) => {
    const controller = new AbortController()
    const reason = new Error('owner stopped')
    if (alreadyAborted) controller.abort(reason)
    const rejected = expect(delay(100, controller.signal)).rejects.toBe(reason)
    if (!alreadyAborted) controller.abort(reason)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('createDisposableTimeoutSignal', () => {
  it('creates the owner reason only at expiry and keeps it after later parent cancellation', async () => {
    const parent = new AbortController()
    const reason = new Error('task deadline')
    let reasonCreated = false
    const deadline = createDisposableTimeoutSignal(
      100,
      () => {
        reasonCreated = true
        return reason
      },
      parent.signal
    )

    await vi.advanceTimersByTimeAsync(99)
    expect(reasonCreated).toBe(false)
    expect(deadline.signal.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)

    expect(reasonCreated).toBe(true)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason).toBe(reason)
    parent.abort(new Error('owner stopped'))
    expect(deadline.signal.reason).toBe(reason)
    deadline.dispose()
  })

  it.each([new Error('owner stopped'), null])(
    'preserves a parent reason after the deadline expires: %s',
    async (reason) => {
      const parent = new AbortController()
      const deadline = createDisposableTimeoutSignal(100, () => new Error('task deadline'), parent.signal)

      parent.abort(reason)
      expect(deadline.signal.aborted).toBe(true)
      expect(deadline.signal.reason).toBe(reason)
      await vi.advanceTimersByTimeAsync(100)

      expect(deadline.signal.reason).toBe(reason)
      deadline.dispose()
    }
  )

  it('disposes only the deadline and retains future parent cancellation', async () => {
    const parent = new AbortController()
    let reasonCreated = false
    const deadline = createDisposableTimeoutSignal(
      100,
      () => {
        reasonCreated = true
        return new Error('task deadline')
      },
      parent.signal
    )

    deadline.dispose()
    deadline.dispose()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)

    expect(reasonCreated).toBe(false)
    expect(deadline.signal.aborted).toBe(false)
    parent.abort(null)
    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason).toBeNull()
  })

  it('preserves pre-existing parent cancellation without eagerly creating a timeout reason', () => {
    let reasonCreated = false
    const deadline = createDisposableTimeoutSignal(
      100,
      () => {
        reasonCreated = true
        return new Error('task deadline')
      },
      AbortSignal.abort(null)
    )

    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason).toBeNull()
    expect(reasonCreated).toBe(false)
    deadline.dispose()
  })

  it('expires with the exact owner reason when there is no parent', async () => {
    const reason = new Error('task deadline')
    const deadline = createDisposableTimeoutSignal(100, () => reason)

    await vi.advanceTimersByTimeAsync(100)

    expect(deadline.signal.aborted).toBe(true)
    expect(deadline.signal.reason).toBe(reason)
    expect(vi.getTimerCount()).toBe(0)
    deadline.dispose()
  })
})

describe('raceTimeout', () => {
  it.each(['resolve', 'reject'] as const)('clears the deadline when work settles: %s', async (outcome) => {
    const task = Promise.withResolvers<string>()
    const fallback = vi.fn(() => 'timeout')
    const waiting = raceTimeout(task.promise, 100, fallback)
    const result =
      outcome === 'resolve' ? expect(waiting).resolves.toBe('result') : expect(waiting).rejects.toBe('result')
    task[outcome]('result')
    await result
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(100)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('returns a fallback without cancelling the underlying work', async () => {
    const task = Promise.withResolvers<string>()
    const waiting = raceTimeout(task.promise, 100, () => null)
    await vi.advanceTimersByTimeAsync(100)
    await expect(waiting).resolves.toBeNull()
    task.resolve('late result')
    await expect(task.promise).resolves.toBe('late result')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects with the caller error and observes a late task rejection', async () => {
    const task = Promise.withResolvers<string>()
    const reason = new Error('request deadline')
    const waiting = withTimeout(task.promise, 100, () => reason)
    const rejected = expect(waiting).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(100)
    await rejected
    task.reject(new Error('late task failure'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

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

describe('createDeferred', () => {
  it('observes early rejection while preserving the original rejected promise for late waiters', async () => {
    const deferred = createDeferred<string>()
    const error = new Error('generation failed before a waiter attached')
    deferred.reject(error)
    await vi.advanceTimersByTimeAsync(0)
    await expect(deferred.promise).rejects.toBe(error)
  })
})
