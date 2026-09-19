import { describe, expect, it } from 'vitest'

import {
  clearLastWrittenEndpointConfigs,
  getLastWrittenEndpointConfigs,
  serializeEndpointConfigsWrite,
  setLastWrittenEndpointConfigs
} from '../endpointConfigsWriteCoordinator'

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('endpointConfigsWriteCoordinator', () => {
  it('runs overlapping writes sequentially in enqueue order', async () => {
    const order: string[] = []
    const gate = deferred()

    const first = serializeEndpointConfigsWrite('provider-a', async () => {
      order.push('first-start')
      await gate.promise
      order.push('first-end')
      return 1
    })
    const second = serializeEndpointConfigsWrite('provider-a', async () => {
      order.push('second')
      return 2
    })

    await Promise.resolve()
    await Promise.resolve()
    expect(order).toEqual(['first-start'])

    gate.resolve()
    await expect(first).resolves.toBe(1)
    await expect(second).resolves.toBe(2)
    expect(order).toEqual(['first-start', 'first-end', 'second'])
  })

  it('keeps the chain alive after a failing write', async () => {
    const failing = serializeEndpointConfigsWrite('provider-b', async () => {
      throw new Error('patch failed')
    })
    await expect(failing).rejects.toThrow('patch failed')

    const next = serializeEndpointConfigsWrite('provider-b', async () => 'recovered')
    await expect(next).resolves.toBe('recovered')
  })

  it('shares the last completed snapshot across writer instances', () => {
    const configs = { chat: { baseUrl: 'https://example.com' } } as any

    expect(getLastWrittenEndpointConfigs('provider-c')).toBeUndefined()
    setLastWrittenEndpointConfigs('provider-c', configs)
    expect(getLastWrittenEndpointConfigs('provider-c')).toBe(configs)
    clearLastWrittenEndpointConfigs('provider-c')
    expect(getLastWrittenEndpointConfigs('provider-c')).toBeUndefined()
  })

  it('isolates chains and snapshots by provider', async () => {
    const gate = deferred()
    let otherRan = false

    const blocked = serializeEndpointConfigsWrite('provider-d', () => gate.promise)
    const other = serializeEndpointConfigsWrite('provider-e', async () => {
      otherRan = true
    })

    await other
    expect(otherRan).toBe(true)

    gate.resolve()
    await blocked
  })
})
