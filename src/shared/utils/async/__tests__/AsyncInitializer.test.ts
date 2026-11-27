import { afterEach, describe, expect, it, vi } from 'vitest'

import { AsyncInitializer } from '..'

afterEach(() => vi.useRealTimers())

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
