/**
 * Tests for the `useDataChange` hook.
 *
 * Exercises the real hook (the global renderer setup otherwise replaces the
 * useDataApi module with a mock) against the mocked `dataApiService`, whose
 * `onDataChanged` maintains a real listener registry so `triggerDataChange`
 * can fan out notifications.
 */
import { dataApiService } from '@data/DataApiService'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.unmock('@data/hooks/useDataApi')

import { useDataChange } from '../useDataApi'

const topicsEffect: DataApiDataChangeEffect = { endpoint: '/topics', kind: 'membership', entityIds: ['t1'] }
const pinsEffect: DataApiDataChangeEffect = { endpoint: '/pins', kind: 'membership', entityIds: ['p1'] }

beforeEach(() => {
  MockDataApiUtils.resetMocks()
})

describe('useDataChange', () => {
  it('subscribes on mount and delivers matching notifications', () => {
    const listener = vi.fn()
    renderHook(() => useDataChange('/topics', listener))

    expect(dataApiService.onDataChanged).toHaveBeenCalledTimes(1)

    MockDataApiUtils.triggerDataChange([topicsEffect])
    expect(listener).toHaveBeenCalledWith([topicsEffect])
  })

  it('unsubscribes on unmount (delivery stops)', () => {
    const listener = vi.fn()
    const { unmount } = renderHook(() => useDataChange('/topics', listener))

    unmount()
    MockDataApiUtils.triggerDataChange([topicsEffect])
    expect(listener).not.toHaveBeenCalled()
  })

  it('does not re-subscribe when only the listener identity changes, and calls the latest listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { rerender } = renderHook(({ listener }) => useDataChange('/topics', listener), {
      initialProps: { listener: first }
    })

    rerender({ listener: second })
    // Endpoint set unchanged → the subscription is not rebuilt.
    expect(dataApiService.onDataChanged).toHaveBeenCalledTimes(1)

    MockDataApiUtils.triggerDataChange([topicsEffect])
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith([topicsEffect])
  })

  it('re-subscribes when the endpoint set changes', () => {
    const listener = vi.fn()
    const { rerender } = renderHook(({ endpoint }) => useDataChange(endpoint, listener), {
      initialProps: { endpoint: '/topics' as const }
    })

    rerender({ endpoint: '/pins' as any })
    expect(dataApiService.onDataChanged).toHaveBeenCalledTimes(2)

    MockDataApiUtils.triggerDataChange([topicsEffect])
    expect(listener).not.toHaveBeenCalled()

    MockDataApiUtils.triggerDataChange([pinsEffect])
    expect(listener).toHaveBeenCalledWith([pinsEffect])
  })
})
