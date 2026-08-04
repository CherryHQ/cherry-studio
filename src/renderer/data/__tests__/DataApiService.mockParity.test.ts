/**
 * Mock-fidelity parity test for the data change fan-out.
 *
 * The DataApiService mock re-implements the frozen dispatch semantics
 * (`dispatchDataChange`), and consumer tests — including the real
 * `useDataChange` hook's own tests — trust that re-implementation. Nothing
 * else pins the two together, so drift would be silent. This suite runs the
 * same scenario scripts against the real service and the mock and asserts
 * identical delivery logs: any semantic divergence fails loudly here.
 */
import type { DataApiDataChangeEffect, GetMethodApiPaths } from '@shared/data/api/types'
import { describe, expect, it, vi } from 'vitest'

// The global renderer setup replaces this module with a mock for consuming
// components; this suite needs the real implementation to compare against.
vi.unmock('@data/DataApiService')

import { DataApiService } from '@data/DataApiService'

import { createMockDataApiService } from '../../../../tests/__mocks__/renderer/DataApiService'

/** The surface both implementations share: register listeners, deliver one notification. */
interface FanOutSurface {
  subscribe: (
    endpoints: GetMethodApiPaths | GetMethodApiPaths[],
    listener: (effects: DataApiDataChangeEffect[]) => void
  ) => () => void
  emit: (effects: DataApiDataChangeEffect[]) => void
}

function realSurface(): FanOutSurface {
  let channelCallback: ((effects: DataApiDataChangeEffect[]) => void) | undefined
  vi.stubGlobal('api', {
    dataApi: {
      onDataChanged: (callback: (effects: DataApiDataChangeEffect[]) => void) => {
        channelCallback = callback
        return () => {}
      }
    }
  })
  const service = new DataApiService()
  return {
    subscribe: (endpoints, listener) => service.onDataChanged(endpoints, listener),
    emit: (effects) => channelCallback!(effects)
  }
}

function mockSurface(): FanOutSurface {
  const mock = createMockDataApiService()
  return {
    subscribe: (endpoints, listener) => mock.onDataChanged(endpoints, listener),
    emit: (effects) => mock._emitDataChange(effects)
  }
}

/** Ordered record of every delivery: [listener name, batch received]. */
type DeliveryLog = Array<[string, DataApiDataChangeEffect[]]>

function expectParity(script: (surface: FanOutSurface, log: DeliveryLog) => void): void {
  const run = (surface: FanOutSurface): DeliveryLog => {
    const log: DeliveryLog = []
    script(surface, log)
    return log
  }
  const realLog = run(realSurface())
  expect(run(mockSurface())).toEqual(realLog)
  expect(realLog.length).toBeGreaterThan(0)
}

function record(log: DeliveryLog, name: string) {
  return (effects: DataApiDataChangeEffect[]) => log.push([name, effects])
}

describe('DataApiService mock parity (fan-out semantics)', () => {
  it('matches on routing, batch merge, and unmatched-entry drop', () => {
    expectParity((surface, log) => {
      surface.subscribe(['/topics', '/topics/latest'], record(log, 'multi'))
      surface.subscribe('/tags', record(log, 'tags'))
      surface.emit([
        { endpoint: '/topics', kind: 'membership', entityIds: ['t1'] },
        { endpoint: '/topics/latest' },
        { endpoint: '/pins', kind: 'projection' }
      ])
    })
  })

  it('matches on per-notification delivery without cross-notification aggregation', () => {
    expectParity((surface, log) => {
      surface.subscribe('/topics', record(log, 'topics'))
      surface.emit([{ endpoint: '/topics', kind: 'projection' }])
      surface.emit([{ endpoint: '/topics', kind: 'order', dimension: 'lastActivityAt' }])
    })
  })

  it('matches on registration shape: duplicate endpoints, duplicate listener, unsubscribe', () => {
    expectParity((surface, log) => {
      const shared = record(log, 'shared')
      const unsubscribeFirst = surface.subscribe('/topics', shared)
      surface.subscribe('/topics', shared)
      surface.subscribe(['/tags', '/tags'], record(log, 'dedup'))
      unsubscribeFirst()
      surface.emit([
        { endpoint: '/topics', kind: 'projection' },
        { endpoint: '/tags', kind: 'membership' }
      ])
    })
  })

  it('matches on listener error isolation', () => {
    expectParity((surface, log) => {
      surface.subscribe('/topics', () => {
        throw new Error('bad consumer')
      })
      surface.subscribe('/topics', record(log, 'good'))
      surface.emit([{ endpoint: '/topics', kind: 'projection' }])
    })
  })
})
