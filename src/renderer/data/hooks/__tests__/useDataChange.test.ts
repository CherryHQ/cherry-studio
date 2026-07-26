/**
 * useDataChange hook tests (real hook implementation).
 *
 * The hook is a thin lifecycle binding over DataApiService.onDataChanged; the
 * globally mocked '@data/DataApiService' provides a functional fan-out with
 * production batch semantics, so these tests drive it via
 * `_emitDataChange(...)` and verify subscribe/unsubscribe lifetime, stable
 * resubscription behavior, and latest-listener delivery.
 */
import { dataApiService } from '@data/DataApiService'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Tests exercise the real hook; the global renderer setup otherwise replaces
// the useDataApi module with a mock for consuming components.
vi.unmock('@data/hooks/useDataApi')

import { useDataChange } from '../useDataApi'

const mockService = dataApiService as unknown as {
  onDataChanged: ReturnType<typeof vi.fn>
  _emitDataChange: (effects: DataApiDataChangeEffect[]) => void
  _resetMockState: () => void
}

describe('useDataChange', () => {
  beforeEach(() => {
    mockService._resetMockState()
    mockService.onDataChanged.mockClear()
  })

  it('subscribes on mount and delivers matching effects', () => {
    const listener = vi.fn()
    renderHook(() => useDataChange('/topics', listener))

    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'membership', entityIds: ['t1'] }
    mockService._emitDataChange([effect])

    expect(listener).toHaveBeenCalledExactlyOnceWith([effect])
  })

  it('unsubscribes on unmount', () => {
    const listener = vi.fn()
    const { unmount } = renderHook(() => useDataChange('/topics', listener))

    unmount()
    mockService._emitDataChange([{ endpoint: '/topics', kind: 'projection' }])

    expect(listener).not.toHaveBeenCalled()
  })

  it('subscribes to nothing for an empty endpoints array', () => {
    renderHook(() => useDataChange([], vi.fn()))

    expect(mockService.onDataChanged).not.toHaveBeenCalled()
  })

  it('does not resubscribe when re-rendered with an equal inline endpoint array', () => {
    const listener = vi.fn()
    const { rerender } = renderHook(() => useDataChange(['/topics', '/topics/latest'], listener))

    rerender()

    expect(mockService.onDataChanged).toHaveBeenCalledTimes(1)
  })

  it('invokes the latest listener without resubscribing', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ listener }) => useDataChange('/topics', listener), {
      initialProps: { listener: first }
    })

    rerender({ listener: second })
    const effect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'projection' }
    mockService._emitDataChange([effect])

    expect(mockService.onDataChanged).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith([effect])
  })
})
