import { MockUseDataApiUtils } from '@test-mocks/renderer/useDataApi'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useQuery } from '@data/hooks/useDataApi'

import { useChannels } from '../useChannels'
import { useSession } from '../useSession'

describe('identity-scoped agent queries', () => {
  beforeEach(() => {
    MockUseDataApiUtils.resetMocks()
    vi.clearAllMocks()
  })

  it('disables keepPreviousData for session detail queries', () => {
    renderHook(() => useSession('session-1'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/agent-sessions/:sessionId',
      expect.objectContaining({
        enabled: true,
        swrOptions: { keepPreviousData: false }
      })
    )
  })

  it('disables keepPreviousData for channel queries', () => {
    renderHook(() => useChannels('telegram'))

    expect(vi.mocked(useQuery)).toHaveBeenCalledWith(
      '/agent-channels',
      expect.objectContaining({
        query: { type: 'telegram' },
        swrOptions: { keepPreviousData: false }
      })
    )
  })
})
