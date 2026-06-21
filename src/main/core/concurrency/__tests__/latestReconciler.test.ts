import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { describe, expect, it, vi } from 'vitest'

import { createLatestReconciler } from '../latestReconciler'

/**
 * Contract coverage for {@link createLatestReconciler}: coalescing (latest-wins, no replay),
 * single-flight, terminal-failure (no spin), convergence after a failing apply, the async
 * `getSnapshot` window, `dispose`, error routing, and `flush()` resolving on quiescence.
 *
 * No fake timers — real microtask scheduling with inline deferreds + `vi.waitFor` keeps the tests
 * honest about the actual await ordering the loop relies on.
 */

interface Deferred<T = void> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
}

function createDeferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Flush pending microtasks and the timer phase so loop passes settle deterministically. */
const flushTasks = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

describe('createLatestReconciler', () => {
  it('coalesces intermediate requests: applies only the first and the latest snapshot', async () => {
    const world = { value: 0 }
    let lastApplied = -1
    const applied: number[] = []
    const gates: Array<Deferred> = []

    const reconciler = createLatestReconciler<{ value: number }>({
      name: 'test',
      getSnapshot: () => ({ value: world.value }),
      isSettled: (snap) => snap.value === lastApplied,
      apply: async (snap) => {
        applied.push(snap.value)
        const gate = createDeferred()
        gates.push(gate)
        await gate.promise
        lastApplied = snap.value
      }
    })

    world.value = 1
    reconciler.request()
    await vi.waitFor(() => expect(applied).toEqual([1]))

    // Push two more while apply(1) is in flight — they must collapse to the latest.
    world.value = 2
    reconciler.request()
    world.value = 3
    reconciler.request()

    gates[0].resolve() // finish apply(1)
    await vi.waitFor(() => expect(applied).toEqual([1, 3])) // 2 folded away, never applied

    gates[1].resolve() // finish apply(3)
    await reconciler.flush()
    expect(applied).toEqual([1, 3])
    expect(lastApplied).toBe(3)
  })

  it('never runs two applies concurrently (single-flight) and converges to the latest target', async () => {
    let target = 0
    let settled = -1
    let inFlight = 0
    let maxInFlight = 0
    const gates: Array<Deferred> = []

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => target,
      isSettled: (t) => t === settled,
      apply: async (t) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        const gate = createDeferred()
        gates.push(gate)
        await gate.promise
        inFlight--
        settled = t
      }
    })

    target = 1
    reconciler.request()
    target = 2
    reconciler.request()
    target = 3
    reconciler.request()

    // Drain however many passes the loop needs, one apply at a time.
    for (let i = 0; i < 5 && settled !== 3; i++) {
      await vi.waitFor(() => expect(gates.length).toBeGreaterThan(i))
      gates[i].resolve()
      await flushTasks()
    }
    await reconciler.flush()

    expect(maxInFlight).toBe(1)
    expect(settled).toBe(3)
  })

  it('does not auto-retry a failed apply for a stable target (no spin), but a new request re-applies', async () => {
    let target = 0
    let settled = -1
    let fail = true
    const onError = vi.fn()

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => target,
      isSettled: (t) => t === settled,
      apply: async (t) => {
        if (fail) throw new Error('boom')
        settled = t
      },
      onError
    })

    target = 1
    reconciler.request()
    await reconciler.flush() // resolves on quiescence even though never settled
    expect(onError).toHaveBeenCalledTimes(1)
    expect(reconciler.getLastError()).toBeInstanceOf(Error)

    // Give the loop room to (wrongly) retry the same failing target.
    await flushTasks()
    await flushTasks()
    expect(onError).toHaveBeenCalledTimes(1)

    // A fresh request re-converges (now succeeding) and clears the recorded error.
    fail = false
    reconciler.request()
    await reconciler.flush()
    expect(settled).toBe(1)
    expect(reconciler.getLastError()).toBeNull()
  })

  it('after a failing apply, a request that arrived meanwhile still converges', async () => {
    let target = 0
    let settled = -1
    const applied: number[] = []
    const gate1 = createDeferred()

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => target,
      isSettled: (t) => t === settled,
      apply: async (t) => {
        applied.push(t)
        if (t === 1) {
          await gate1.promise
          throw new Error('boom')
        }
        settled = t
      },
      onError: vi.fn()
    })

    target = 1
    reconciler.request()
    await vi.waitFor(() => expect(applied).toEqual([1]))

    // A request lands during the in-flight failing apply(1).
    target = 2
    reconciler.request()
    gate1.resolve() // apply(1) now throws

    await reconciler.flush()
    expect(applied).toEqual([1, 2]) // converged to 2 despite apply(1) failing
    expect(settled).toBe(2)
  })

  it('does not lose a request that arrives during an async getSnapshot', async () => {
    let target = 7
    let settled = 7 // start settled
    let snapCalls = 0
    const applied: number[] = []
    const snapGate = createDeferred()

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: async () => {
        const captured = target // capture at entry, so a late request reads as stale
        snapCalls++
        if (snapCalls === 1) await snapGate.promise
        return captured
      },
      isSettled: (t) => t === settled,
      apply: (t) => {
        applied.push(t)
        settled = t
      }
    })

    reconciler.request() // kicks the loop while target === settled === 7
    await vi.waitFor(() => expect(snapCalls).toBe(1)) // parked in the first (slow) snapshot

    target = 9 // world changes during the async snapshot
    reconciler.request() // dirty — must not be lost even though the stale read looks settled
    snapGate.resolve() // first getSnapshot returns the stale, settled value 7

    await reconciler.flush()
    expect(applied).toEqual([9]) // dirty forced a re-read that discovered the real work
    expect(settled).toBe(9)
  })

  it('does not start new work after dispose; an in-flight apply still completes', async () => {
    let target = 0
    let settled = -1
    const applied: number[] = []
    const gate = createDeferred()

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => target,
      isSettled: (t) => t === settled,
      apply: async (t) => {
        applied.push(t)
        await gate.promise
        settled = t
      }
    })

    target = 1
    reconciler.request()
    await vi.waitFor(() => expect(applied).toEqual([1]))

    target = 2
    reconciler.request() // queue a follow-up target
    reconciler.dispose()
    expect(reconciler.isDisposed).toBe(true)

    gate.resolve() // apply(1) completes
    await reconciler.flush()
    expect(applied).toEqual([1]) // apply(2) never ran — disposed
  })

  it('ignores request() after dispose', async () => {
    const applied: number[] = []
    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => 1,
      isSettled: () => false,
      apply: (t) => {
        applied.push(t)
      }
    })

    reconciler.dispose()
    reconciler.request()
    await flushTasks()
    expect(applied).toEqual([])
  })

  it('routes errors to onError and never rejects request()/flush()', async () => {
    const settled = -1
    const onError = vi.fn()
    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => 1,
      isSettled: (t) => t === settled,
      apply: () => {
        throw new Error('sync boom')
      },
      onError
    })

    expect(() => reconciler.request()).not.toThrow()
    await expect(reconciler.flush()).resolves.toBeUndefined()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 1)
  })

  it('logs via loggerService by default and does not let errors escape', async () => {
    mockMainLoggerService.error.mockClear()
    const reconciler = createLatestReconciler<number>({
      name: 'defaultErr',
      getSnapshot: () => 1,
      isSettled: (t) => t === 2, // 1 !== 2 → not settled → apply runs and throws
      apply: () => {
        throw new Error('boom')
      }
    })

    reconciler.request()
    await reconciler.flush()
    expect(mockMainLoggerService.error).toHaveBeenCalled()
  })

  it('reports getLastError from getSnapshot failures too', async () => {
    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => {
        throw new Error('snapshot boom')
      },
      isSettled: () => false,
      apply: vi.fn(),
      onError: vi.fn()
    })

    reconciler.request()
    await reconciler.flush()
    expect(reconciler.getLastError()).toBeInstanceOf(Error)
    expect((reconciler.getLastError() as Error).message).toBe('snapshot boom')
  })

  it('coalesces a request during an async getSnapshot even when the stale snapshot is not settled', async () => {
    let desired = 'A'
    let actual = 'none'
    const applied: string[] = []
    const snapGate = createDeferred()
    let snapCalls = 0

    const reconciler = createLatestReconciler<{ desired: string; actual: string }>({
      name: 'test',
      getSnapshot: async () => {
        const captured = { desired, actual } // capture at entry → a late request reads as stale
        snapCalls++
        if (snapCalls === 1) await snapGate.promise
        return captured
      },
      isSettled: (snap) => snap.desired === snap.actual,
      apply: (snap) => {
        applied.push(snap.desired)
        actual = snap.desired
      }
    })

    reconciler.request() // desired=A, actual=none → NOT settled
    await vi.waitFor(() => expect(snapCalls).toBe(1)) // parked in the slow read, captured {A,none}

    desired = 'B' // superseded during the read
    reconciler.request() // dirty
    snapGate.resolve() // the first read returns the stale, NOT-settled {A,none}

    await reconciler.flush()
    expect(applied).toEqual(['B']) // stale 'A' must never be applied (latest-wins)
    expect(actual).toBe('B')
  })

  it('keeps getLastError as the last failure until a clean pass completes (no transient null mid-apply)', async () => {
    let target = 0
    let settled = -1
    let failNext = false
    let gateApply = false
    let applyStarts = 0
    const applyGate = createDeferred()

    const reconciler = createLatestReconciler<number>({
      name: 'test',
      getSnapshot: () => target,
      isSettled: (t) => t === settled,
      apply: async (t) => {
        applyStarts++
        if (failNext) throw new Error('boom')
        if (gateApply) await applyGate.promise
        settled = t
      },
      onError: vi.fn()
    })

    failNext = true
    target = 1
    reconciler.request()
    await reconciler.flush()
    expect(reconciler.getLastError()).toBeInstanceOf(Error)

    // A fresh pass whose apply is in flight must not prematurely clear the prior failure.
    failNext = false
    gateApply = true
    reconciler.request()
    await vi.waitFor(() => expect(applyStarts).toBe(2))
    expect(reconciler.getLastError()).toBeInstanceOf(Error) // still the last failure, mid-apply

    applyGate.resolve()
    await reconciler.flush()
    expect(reconciler.getLastError()).toBeNull() // cleared only after the clean pass completed
  })
})
