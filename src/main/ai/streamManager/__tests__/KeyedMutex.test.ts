import { describe, expect, it } from 'vitest'

import { KeyedMutex } from '../KeyedMutex'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('KeyedMutex', () => {
  it('serialises tasks sharing a key — no interleave', async () => {
    const km = new KeyedMutex()
    const order: string[] = []
    const task = (id: string) => async () => {
      order.push(`${id}:start`)
      await tick()
      order.push(`${id}:end`)
      return id
    }

    const results = await Promise.all([km.runExclusive('k', task('a')), km.runExclusive('k', task('b'))])

    expect(results).toEqual(['a', 'b'])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end'])
  })

  it('runs different keys concurrently', async () => {
    const km = new KeyedMutex()
    const order: string[] = []
    const task = (id: string) => async () => {
      order.push(`${id}:start`)
      await tick()
      order.push(`${id}:end`)
    }

    await Promise.all([km.runExclusive('k1', task('a')), km.runExclusive('k2', task('b'))])

    // Both started before either finished → they ran concurrently.
    expect(order.slice(0, 2)).toEqual(['a:start', 'b:start'])
  })

  it('releases the lock after a task throws', async () => {
    const km = new KeyedMutex()
    await expect(
      km.runExclusive('k', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    // Lock is free again → a subsequent task on the same key still runs.
    await expect(km.runExclusive('k', async () => 'ok')).resolves.toBe('ok')
  })
})
