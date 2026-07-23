/**
 * Renderer DataApiService.onDataChanged fan-out tests.
 *
 * Exercises the real service (the global renderer setup otherwise replaces it
 * with a mock). A controllable `window.api.dataApi.onDataChanged` captures the
 * fixed-channel IPC callback the service attaches at construction; firing it
 * simulates a main-side broadcast.
 */
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/DataApiService')

// The IPC callback the service registers in its constructor.
let ipcCallback: ((effects: DataApiDataChangeEffect[]) => void) | undefined
const onDataChanged = vi.fn((cb: (effects: DataApiDataChangeEffect[]) => void) => {
  ipcCallback = cb
  return () => {}
})

beforeEach(() => {
  vi.resetModules()
  ipcCallback = undefined
  onDataChanged.mockClear()

  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { dataApi: { onDataChanged } }
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function createService() {
  const { DataApiService } = await import('../DataApiService')
  return new DataApiService()
}

const topicsMembership: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'membership', entityIds: ['t1'] }
const topicsOrder: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'order', dimension: 'orderKey' }
const topicScalar: DataApiDataChangeEffect = { endpoint: '/topics/:id', entityIds: ['t1'] }
const pinsMembership: DataApiDataChangeEffect = { endpoint: '/pins', kind: 'membership', entityIds: ['p1'] }

describe('DataApiService.onDataChanged', () => {
  it('attaches the fixed-channel IPC listener at construction', async () => {
    // Importing the module also constructs the exported singleton (one attach);
    // clear so the assertion isolates this explicit construction.
    const { DataApiService } = await import('../DataApiService')
    onDataChanged.mockClear()
    ipcCallback = undefined

    new DataApiService()
    expect(onDataChanged).toHaveBeenCalledTimes(1)
    expect(ipcCallback).toBeTypeOf('function')
  })

  it('delivers only effects whose endpoint matches exactly (no prefix/wildcard)', async () => {
    const service = await createService()
    const listener = vi.fn()
    service.onDataChanged('/topics', listener)

    ipcCallback!([topicScalar]) // '/topics/:id' must NOT match '/topics'
    expect(listener).not.toHaveBeenCalled()

    ipcCallback!([topicsMembership])
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([topicsMembership])
  })

  it('delivers a single effect as a one-element array (array-only output)', async () => {
    const service = await createService()
    const listener = vi.fn()
    service.onDataChanged('/topics', listener)

    ipcCallback!([topicsMembership])
    const arg = listener.mock.calls[0][0]
    expect(Array.isArray(arg)).toBe(true)
    expect(arg).toEqual([topicsMembership])
  })

  it('merges all matching entries of one notification into a single callback', async () => {
    const service = await createService()
    const listener = vi.fn()
    service.onDataChanged('/topics', listener)

    ipcCallback!([topicsMembership, topicsOrder, pinsMembership])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([topicsMembership, topicsOrder])
  })

  it('gives a multi-endpoint subscriber one merged callback', async () => {
    const service = await createService()
    const listener = vi.fn()
    service.onDataChanged(['/topics', '/pins'], listener)

    ipcCallback!([topicsMembership, pinsMembership])

    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith([topicsMembership, pinsMembership])
  })

  it('isolates a throwing listener so others still receive the notification', async () => {
    const service = await createService()
    const throwing = vi.fn(() => {
      throw new Error('listener boom')
    })
    const healthy = vi.fn()
    service.onDataChanged('/topics', throwing)
    service.onDataChanged('/topics', healthy)

    expect(() => ipcCallback!([topicsMembership])).not.toThrow()
    expect(throwing).toHaveBeenCalledTimes(1)
    expect(healthy).toHaveBeenCalledTimes(1)
  })

  it('stops delivery after unsubscribe', async () => {
    const service = await createService()
    const listener = vi.fn()
    const unsubscribe = service.onDataChanged('/topics', listener)

    unsubscribe()
    ipcCallback!([topicsMembership])
    expect(listener).not.toHaveBeenCalled()
  })
})
