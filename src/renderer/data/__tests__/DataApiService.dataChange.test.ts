/**
 * DataApiService data change fan-out tests (real implementation).
 *
 * Verifies the renderer subscription facility's frozen semantics: single
 * construction-time attach of the fixed IPC channel, exact endpoint routing,
 * one merged callback per notification per listener, array-only callback
 * payloads, unsubscribe behavior, and per-listener error isolation.
 */
import type { DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The global renderer setup replaces this module with a mock for consuming
// components; these tests exercise the real implementation.
vi.unmock('@data/DataApiService')

import { DataApiService } from '@data/DataApiService'

/** Captures the channel callback that the service attaches via preload. */
let channelCallback: ((effects: DataApiDataChangeEffect[]) => void) | undefined
const onDataChangedBridge = vi.fn((callback: (effects: DataApiDataChangeEffect[]) => void) => {
  channelCallback = callback
  return () => {
    channelCallback = undefined
  }
})

function emit(effects: DataApiDataChangeEffect[]): void {
  expect(channelCallback, 'channel listener must be attached before emitting').toBeDefined()
  channelCallback!(effects)
}

describe('DataApiService.onDataChanged', () => {
  let service: DataApiService

  beforeEach(() => {
    channelCallback = undefined
    onDataChangedBridge.mockClear()
    vi.stubGlobal('api', { dataApi: { onDataChanged: onDataChangedBridge } })
    service = new DataApiService()
  })

  it('attaches the underlying fixed channel once, at construction', () => {
    expect(onDataChangedBridge).toHaveBeenCalledTimes(1)

    service.onDataChanged('/topics', vi.fn())
    service.onDataChanged('/tags', vi.fn())

    expect(onDataChangedBridge).toHaveBeenCalledTimes(1)
  })

  it('constructs without the preload bridge (test environments) without throwing', () => {
    vi.stubGlobal('api', {})

    expect(() => new DataApiService()).not.toThrow()
  })

  it('routes by exact endpoint match and always delivers an array', () => {
    const topicsListener = vi.fn()
    const tagsListener = vi.fn()
    service.onDataChanged('/topics', topicsListener)
    service.onDataChanged('/tags', tagsListener)

    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection', entityIds: ['t1'] }
    emit([effect])

    expect(topicsListener).toHaveBeenCalledExactlyOnceWith([effect])
    expect(tagsListener).not.toHaveBeenCalled()
  })

  it('merges all matching entries of one notification into a single callback', () => {
    const listener = vi.fn()
    service.onDataChanged(['/topics', '/topics/latest'], listener)

    const membership: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'membership', entityIds: ['t1'] }
    const order: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt' }
    const latest: DataApiDataChangeEffect = { endpoint: '/topics/latest' }
    const unrelated: DataApiDataChangeEffect = { endpoint: '/tags', kind: 'projection' }
    emit([membership, order, latest, unrelated])

    expect(listener).toHaveBeenCalledExactlyOnceWith([membership, order, latest])
  })

  it('does not aggregate across notifications', () => {
    const listener = vi.fn()
    service.onDataChanged('/topics', listener)

    const first: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    const second: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'membership' }
    emit([first])
    emit([second])

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, [first])
    expect(listener).toHaveBeenNthCalledWith(2, [second])
  })

  it('accepts a single endpoint and an endpoint array equivalently', () => {
    const single = vi.fn()
    const asArray = vi.fn()
    service.onDataChanged('/topics', single)
    service.onDataChanged(['/topics'], asArray)

    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    emit([effect])

    expect(single).toHaveBeenCalledExactlyOnceWith([effect])
    expect(asArray).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('does not double-deliver for a duplicated endpoint within one subscription', () => {
    const listener = vi.fn()
    service.onDataChanged(['/topics', '/topics'], listener)

    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    emit([effect])

    expect(listener).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('keeps registrations of the same listener function independent', () => {
    const listener = vi.fn()
    const unsubscribeFirst = service.onDataChanged('/topics', listener)
    service.onDataChanged('/topics', listener)

    unsubscribeFirst()
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    emit([effect])

    // The second registration must survive the first registration's unsubscribe.
    expect(listener).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('is not affected by the caller mutating its endpoints array after subscribing', () => {
    const listener = vi.fn()
    const endpoints: GetMethodApiPaths[] = ['/topics']
    const unsubscribe = service.onDataChanged(endpoints, listener)
    endpoints.length = 0

    unsubscribe()
    emit([{ endpoint: '/topics', kind: 'projection' }])

    expect(listener).not.toHaveBeenCalled()
  })

  it('stops delivering after unsubscribe without affecting other subscribers', () => {
    const unsubscribed = vi.fn()
    const remaining = vi.fn()
    const unsubscribe = service.onDataChanged('/topics', unsubscribed)
    service.onDataChanged('/topics', remaining)

    unsubscribe()
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    emit([effect])

    expect(unsubscribed).not.toHaveBeenCalled()
    expect(remaining).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('isolates a throwing listener so other listeners still run', () => {
    const bad = vi.fn(() => {
      throw new Error('bad consumer')
    })
    const good = vi.fn()
    service.onDataChanged('/topics', bad)
    service.onDataChanged('/topics', good)

    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    expect(() => emit([effect])).not.toThrow()

    expect(good).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('silently drops entries for endpoints without subscribers', () => {
    service.onDataChanged('/topics', vi.fn())

    expect(() => emit([{ endpoint: '/tags', kind: 'membership' }])).not.toThrow()
  })
})
