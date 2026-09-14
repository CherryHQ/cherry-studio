import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncInitializer, IdleTimeoutController, retry, Sequencer, SequencerByKey } from '..'

afterEach(() => vi.useRealTimers())

describe('retry', () => {
  it('uses the caller backoff and stops immediately after the final failed attempt', async () => {
    vi.useFakeTimers()
    const attempts: number[] = []
    const error = new Error('locked')
    const task = retry(
      async () => {
        attempts.push(Date.now())
        throw error
      },
      {
        maxAttempts: 3,
        delayMs: (attempt) => attempt * 100,
        shouldRetry: () => true
      }
    )
    const rejected = expect(task).rejects.toBe(error)
    await vi.advanceTimersByTimeAsync(300)
    await rejected
    expect(attempts.map((time) => time - attempts[0])).toEqual([0, 100, 300])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns a recovered result, and never retries a permanent failure', async () => {
    vi.useFakeTimers()
    const transient = new Error('busy')
    let attempts = 0
    const task = retry(
      async () => {
        if (++attempts === 1) throw transient
        return 'saved'
      },
      {
        maxAttempts: 3,
        delayMs: 100,
        shouldRetry: (error) => error === transient
      }
    )
    await vi.advanceTimersByTimeAsync(100)
    await expect(task).resolves.toBe('saved')
    const permanent = new Error('denied')
    await expect(
      retry(
        async () => {
          throw permanent
        },
        {
          maxAttempts: 3,
          delayMs: 100,
          shouldRetry: () => false
        }
      )
    ).rejects.toBe(permanent)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a backoff promptly without starting another attempt', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let attempts = 0
    const task = retry(
      async () => {
        attempts++
        throw new Error('busy')
      },
      {
        maxAttempts: 3,
        delayMs: 100,
        shouldRetry: () => true,
        signal: controller.signal
      }
    )
    const reason = new Error('owner stopped')
    const rejected = expect(task).rejects.toBe(reason)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort(reason)
    await rejected
    await vi.advanceTimersByTimeAsync(300)
    expect(attempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('sequences', () => {
  it('runs every task in order even after its predecessor fails', async () => {
    const sequence = new Sequencer()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = sequence.queue(async () => {
      order.push('first')
      await gate.promise
      throw new Error('failed')
    })
    const second = sequence.queue(() => {
      order.push('second')
      return 'result'
    })
    const rejected = expect(first).rejects.toThrow('failed')
    await Promise.resolve()
    expect(order).toEqual(['first'])
    gate.resolve()
    await rejected
    await expect(second).resolves.toBe('result')
    expect(order).toEqual(['first', 'second'])
  })

  it('isolates keys, preserves same-key order, and flushes unsettled work after failure', async () => {
    const sequence = new SequencerByKey<string>()
    const gate = Promise.withResolvers<void>()
    const order: string[] = []
    const first = sequence.queue('a', async () => {
      await gate.promise
      throw new Error('failed')
    })
    const rejected = expect(first).rejects.toThrow('failed')
    const second = sequence.queue('a', () => {
      order.push('a')
      return 'saved'
    })
    await sequence.queue('b', () => order.push('b'))
    await sequence.flush('b')
    expect(order).toEqual(['b'])
    let flushed = false
    const flushing = sequence.flush().then(() => {
      flushed = true
    })
    await Promise.resolve()
    expect(flushed).toBe(false)
    gate.resolve()
    await rejected
    await flushing
    await expect(second).resolves.toBe('saved')
    expect(order).toEqual(['b', 'a'])
  })
})

describe('AsyncInitializer', () => {
  it('starts immediately and returns the same factory promise before and after settlement', async () => {
    const gate = Promise.withResolvers<string>()
    let starts = 0
    const initializer = new AsyncInitializer(() => {
      starts++
      return gate.promise
    })
    const first = initializer.get()
    expect(starts).toBe(1)
    expect(first).toBe(gate.promise)
    expect(initializer.get()).toBe(first)
    gate.resolve('ready')
    await expect(first).resolves.toBe('ready')
    expect(initializer.get()).toBe(first)
    expect(starts).toBe(1)
  })

  it('returns synchronous factory throws as rejections and retries on the next call', async () => {
    let attempts = 0
    const error = new Error('factory could not start')
    const initializer = new AsyncInitializer(() => {
      if (++attempts === 1) throw error
      return Promise.resolve('ready')
    })
    const first = initializer.get()
    await expect(first).rejects.toBe(error)
    expect(attempts).toBe(1)
    await expect(initializer.get()).resolves.toBe('ready')
    expect(attempts).toBe(2)
  })

  it('shares one resource across concurrent and later consumers', async () => {
    const gate = Promise.withResolvers<void>()
    let allocated = 0
    const initializer = new AsyncInitializer(async () => {
      await gate.promise
      return { id: ++allocated }
    })
    expect(allocated).toBe(0)
    const first = initializer.get()
    const second = initializer.get()
    gate.resolve()
    const resource = await first
    expect(await second).toBe(resource)
    expect(await initializer.get()).toBe(resource)
    expect(allocated).toBe(1)
  })

  it('shares initialization failure without allocating another resource', async () => {
    let attempts = 0
    const error = new Error('initialization failed')
    const initializer = new AsyncInitializer(async () => {
      attempts++
      throw error
    })
    const first = initializer.get()
    await expect(first).rejects.toBe(error)
    expect(initializer.get()).toBe(first)
    await expect(initializer.get()).rejects.toBe(error)
    expect(attempts).toBe(1)
  })
})

describe('IdleTimeoutController reason', () => {
  it('retains TimeoutError by default and allows the native AbortError contract', async () => {
    vi.useFakeTimers()
    const standard = new IdleTimeoutController(100)
    const native = new IdleTimeoutController(100, () => undefined)
    await vi.advanceTimersByTimeAsync(100)
    expect(standard.signal.reason).toMatchObject({ name: 'TimeoutError', message: 'Idle timeout exceeded' })
    expect(native.signal.reason).toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
