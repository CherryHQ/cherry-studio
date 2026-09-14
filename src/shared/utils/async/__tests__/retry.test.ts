import { afterEach, describe, expect, it, vi } from 'vitest'

import { retry } from '..'

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
