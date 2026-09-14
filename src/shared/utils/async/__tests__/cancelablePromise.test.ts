import { describe, expect, it } from 'vitest'

import { createCancelablePromise, delay, raceCancellation } from '..'

describe('createCancelablePromise', () => {
  it('starts eagerly and delivers the original result', async () => {
    const result = { value: 42 }
    let started = false
    const task = createCancelablePromise(() => {
      started = true
      return result
    })
    expect(started).toBe(true)
    await expect(task).resolves.toBe(result)
  })

  it.each(['sync', 'async'] as const)('preserves a %s factory failure as a rejection', async (mode) => {
    const error = new Error('cannot load')
    const task = createCancelablePromise(() => {
      if (mode === 'sync') throw error
      return Promise.reject(error)
    })
    await expect(task).rejects.toBe(error)
  })

  it.each([null, 'owner stopped', new Error('owner stopped')])(
    'rejects with the first cancellation reason while non-cooperative work continues: %s',
    async (reason) => {
      const work = Promise.withResolvers<string>()
      let signal!: AbortSignal
      const task = createCancelablePromise((taskSignal) => {
        signal = taskSignal
        return work.promise
      })
      const rejected = expect(task).rejects.toBe(reason)
      task.cancel(reason)
      task.cancel(new Error('second cancellation'))
      expect(signal.aborted).toBe(true)
      expect(signal.reason).toBe(reason)
      await rejected
      work.resolve('finished later')
      await expect(work.promise).resolves.toBe('finished later')
    }
  )

  it('uses native AbortError cancellation and stops cooperative work', async () => {
    let completed = false
    const task = createCancelablePromise(async (signal) => {
      await delay(1000, signal)
      completed = true
    })
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    task.cancel()
    await rejected
    expect(completed).toBe(false)
  })

  it('leaves shared disposable results untouched unless cleanup was explicitly supplied', async () => {
    const work = Promise.withResolvers<{ dispose(): void }>()
    let disposed = false
    const resource = {
      dispose: () => {
        disposed = true
      }
    }
    const task = createCancelablePromise(() => work.promise)
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    task.cancel()
    await rejected
    work.resolve(resource)
    expect(await work.promise).toBe(resource)
    await delay(0)
    expect(disposed).toBe(false)
  })

  it.each(['pending', 'resolved'] as const)('cleans an owned late result exactly once: %s producer', async (state) => {
    const work = Promise.withResolvers<{ dispose(): void }>()
    const cleaned = Promise.withResolvers<void>()
    let releases = 0
    const resource = {
      dispose: () => {
        releases++
      }
    }
    if (state === 'resolved') work.resolve(resource)
    const task = createCancelablePromise(
      () => work.promise,
      async (value) => {
        await Promise.resolve()
        value.dispose()
        cleaned.resolve()
      }
    )
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' })
    task.cancel()
    task.cancel()
    await rejected
    work.resolve(resource)
    await cleaned.promise
    task.cancel()
    expect(releases).toBe(1)
  })

  it.each(['resolve', 'reject'] as const)('does not abort after delivering a producer outcome: %s', async (outcome) => {
    const work = Promise.withResolvers<string>()
    let signal!: AbortSignal
    let cleaned = false
    const task = createCancelablePromise(
      (taskSignal) => {
        signal = taskSignal
        return work.promise
      },
      () => {
        cleaned = true
      }
    )
    const delivered = outcome === 'resolve' ? expect(task).resolves.toBe('result') : expect(task).rejects.toBe('result')
    work[outcome]('result')
    await delivered
    task.cancel()
    expect(signal.aborted).toBe(false)
    expect(cleaned).toBe(false)
  })

  it('cancels one waiter without cancelling the owned task or another waiter', async () => {
    const work = Promise.withResolvers<string>()
    let signal!: AbortSignal
    const task = createCancelablePromise((taskSignal) => {
      signal = taskSignal
      return work.promise
    })
    const waiter = new AbortController()
    const abandoned = raceCancellation(task, waiter.signal)
    const kept = task.then((value) => value.toUpperCase())
    const rejected = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    waiter.abort()
    await rejected
    expect(signal.aborted).toBe(false)
    expect('cancel' in kept).toBe(false)
    work.resolve('ready')
    await expect(kept).resolves.toBe('READY')
    await expect(task).resolves.toBe('ready')
  })

  it.each(['producer', 'sync cleanup', 'async cleanup'] as const)(
    'observes a late %s failure without replacing the cancellation reason',
    async (failure) => {
      const work = Promise.withResolvers<string>()
      const reason = new Error('cancelled')
      const lateError = new Error('late failure')
      const task = createCancelablePromise(
        () => work.promise,
        () => {
          if (failure === 'sync cleanup') throw lateError
          return Promise.reject(lateError)
        }
      )
      const rejected = expect(task).rejects.toBe(reason)
      task.cancel(reason)
      await rejected
      if (failure === 'producer') work.reject(lateError)
      else work.resolve('late result')
      await delay(0)
      await expect(task).rejects.toBe(reason)
    }
  )
})
