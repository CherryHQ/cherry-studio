import { MockUseDataApiUtils, mockUseInfiniteQuery } from '@test-mocks/renderer/useDataApi'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTopicMessages } from '../useTopicMessages'

describe('useTopicMessages data convergence', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('refreshes only when the changed topic id matches the mounted conversation', () => {
    const mutate = vi.fn().mockResolvedValue([])
    mockUseInfiniteQuery.mockReturnValue({
      pages: [],
      isLoading: false,
      isRefreshing: false,
      error: undefined,
      hasNext: false,
      loadNext: vi.fn(),
      refresh: vi.fn().mockResolvedValue(undefined),
      reset: vi.fn(),
      mutate
    })

    renderHook(() => useTopicMessages('aggregate-topic'))

    act(() => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/topics/:id', entityIds: ['another-topic'] }])
    })
    expect(mutate).not.toHaveBeenCalled()

    act(() => {
      MockUseDataApiUtils.emitDataChange([{ endpoint: '/topics/:id', entityIds: ['aggregate-topic'] }])
    })
    expect(mutate).toHaveBeenCalledTimes(1)
  })
})
